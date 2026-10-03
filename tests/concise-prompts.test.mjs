import test from 'node:test';
import assert from 'node:assert/strict';
import { photographyNarrative, conciseRealismPrompt, CONCISE_BASELINE_FACE_RULES } from '../lib/concise-prompts.mjs';
import { CONCISE_PROMPT_DEFAULTS } from '../lib/concise-prompt-defaults.mjs';
import { REVIEWED_PROMPT_DEFAULTS, reviewedPromptDefault } from '../lib/reviewed-prompt-defaults.mjs';
import { BASELINE_FACE_RULES, requiresBaselineFaceReview } from '../lib/baseline-face.mjs';
import { compileBaselinePrompt, compileFullPromptReshoot } from '../server/domain.mjs';
import { promptSamples, card, references, selections, original } from './fixtures/prompt-samples.mjs';

void test('简洁编译压缩系统说明而非截断内容，六种流程保留单张尺寸与安全约束', () => {
  const samples = promptSamples();
  // Character counts, not tokens. Fixed synthetic inputs make regressions visible.
  const previous = { baseline: 2804, adjustment: 1637, random: 2294, series: 2242, full: 2057, multi: 1787 };
  for (const [kind, prompt] of Object.entries(samples)) {
    assert.ok(prompt.length < previous[kind] * (kind === 'multi' ? 0.94 : 0.65), `${kind}: ${prompt.length}`);
    assert.equal(prompt.split('【原生输出尺寸 · max-native-v1】').length - 1, 1);
    assert.match(prompt, /2160 × 3840/);
    assert.match(prompt, kind === 'adjustment' ? /保持源图宽高比/ : /9:16/);
    assert.match(prompt, /未成年人|年龄不明/);
    assert.doesNotMatch(prompt, /photography-v2|真实摄影执行基础/);
    assert.ok(prompt.split('concise-photo-v1').length - 1 <= 1);
  }
  for (const { value } of Object.values(card)) assert.ok(samples.baseline.includes(value));
  assert.ok(samples.random.indexOf('【画面】') < samples.random.indexOf('【角色'));
  assert.ok(samples.series.indexOf('【本张新分镜】') < samples.series.indexOf('【角色强约束】'));
});

void test('摄影叙述按关系分组，逐项保留原值、条件和用户锁定，不填空或改写参数', () => {
  const input = { ...selections, lighting: '只有原图含窗光时采用侧光；否则保留原光。', focalLength: '85mm f/2, no extra bokeh' };
  const before = structuredClone(input);
  const locked = { scene: '雨后街角', lighting: '阴天漫射光，不追加直闪' };
  const text = photographyNarrative(input, locked);
  for (const [key, value] of Object.entries(input)) assert.ok(text.includes(locked[key] || value), key);
  assert.doesNotMatch(text, /安静的窗边|只有原图含窗光时/);
  assert.match(text, /环境（用户锁定）：雨后街角/);
  assert.ok(text.indexOf('【画面】') < text.indexOf('【观看方式】'));
  assert.ok(text.indexOf('【观看方式】') < text.indexOf('【光线与成像】'));
  assert.deepEqual(input, before);
  assert.equal(photographyNarrative(), '');
  assert.equal(photographyNarrative({ scene: '原环境' }, { scene: '   ' }), '【画面】环境：原环境。');
});

void test('表情动作配对不再抽第二种表情，多人叙述不泄漏单人动作或拍摄状态', () => {
  const paired = photographyNarrative({ ...selections, moment: '本组表情优先：忍不住笑，单手捂嘴' });
  assert.match(paired, /忍不住笑，单手捂嘴/);
  assert.doesNotMatch(paired, /轻微微笑/);
  const group = photographyNarrative(selections, {}, { group: true });
  for (const key of ['moment', 'expression', 'captureState']) assert.ok(!group.includes(selections[key]));
  assert.ok(group.includes(selections.scene));
});

void test('精简不改写完整收藏的空白、长文、摄影关系及阶段优先级', () => {
  const adaptedText = original + '\n' + '既定照明下，手扶木窗，背景保持安静；不要另加逆光。'.repeat(650) + '\n  END  ';
  const input = { characterCard: card, references, adaptedText, creative: { mode: 'original' }, aspectRatio: 'source' };
  const before = structuredClone(input);
  const prompt = compileFullPromptReshoot(input);
  const content = prompt.split('【已确认的完整摄影 Prompt · 保留原文关系】\n')[1].split('\n【完整摄影 Prompt 结束】')[0];
  assert.equal(content, adaptedText);
  assert.ok(prompt.indexOf(adaptedText) < prompt.indexOf('【人物与角色辨识】'));
  assert.match(prompt, /人物身份和角色辨识保持项、用户服装与道具选择 > 已确认完整摄影 Prompt/);
  assert.deepEqual(input, before);
});

void test('新旧面部规则都要求人工验收，单项调整只获得对应的局部说明', () => {
  assert.equal(requiresBaselineFaceReview(BASELINE_FACE_RULES), true);
  assert.equal(requiresBaselineFaceReview(CONCISE_BASELINE_FACE_RULES), true);
  assert.equal(requiresBaselineFaceReview('历史未包含面部规则的 Prompt'), false);
  const background = conciseRealismPrompt('adjustment', 'background');
  assert.match(background, /不顺带重新布光整张脸/);
  assert.doesNotMatch(background, /毛孔|唇部有自然体积|皮肤、发丝/);
  assert.match(conciseRealismPrompt('adjustment', 'makeup'), /不放大眼睛、缩鼻、瘦脸/);
  assert.match(conciseRealismPrompt('adjustment', 'hair_accessory'), /只改指定发型或发饰/);
  assert.throws(() => conciseRealismPrompt('adjustment', 'all'));
  assert.throws(() => conciseRealismPrompt('unknown'));
});

void test('内置短模块保留原记录和原文，基准不因整理而重复句号或修改所选风格', () => {
  assert.equal(Object.keys(CONCISE_PROMPT_DEFAULTS).length, 24);
  for (const [id, normalizedText] of Object.entries(CONCISE_PROMPT_DEFAULTS)) {
    assert.ok(normalizedText.length <= REVIEWED_PROMPT_DEFAULTS[id].normalizedText.length, id);
    const entry = { id, normalizedText: 'old', rawText: '原文\n  不变', version: 3, tags: ['原标签'] };
    const before = structuredClone(entry);
    const next = reviewedPromptDefault(entry);
    assert.equal(next.rawText, entry.rawText);
    assert.equal(next.version, entry.version);
    assert.deepEqual(entry, before);
  }
  const styleModule = { normalizedText: '沿用原布光。', avoid: [] };
  const prompt = compileBaselinePrompt({ characterCard: card, references, styleModule });
  assert.ok(prompt.includes(styleModule.normalizedText));
  assert.doesNotMatch(prompt, /。。/);
});
