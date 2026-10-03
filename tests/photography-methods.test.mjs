import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { PHOTOGRAPHY_METHOD_VERSION, PHOTOGRAPHY_SOURCE, PHOTOGRAPHY_MODULES, mergePhotographyModules, photographyMethodPrompt } from '../lib/photography-methods.mjs';
import { REALISM_PRESETS, legacyRealismPrompt, realismPrompt, isRealismPreset, buildRealismComparison } from '../lib/photo-realism.mjs';
import { compileBaselinePrompt, compileAdjustmentPrompt, compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS, ADJUSTMENT_CATEGORIES } from '../server/domain.mjs';

const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `${key} locked`, certainty: 'user_confirmed', strongLock: true }]));
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-photography-test-'));
process.env.AI_COS_DATA_DIR = testRoot;
const store = await import('../server/store.mjs');
test.after(async () => fs.rm(testRoot, { recursive: true, force: true }));

void test('八个方法模块符合 schema，保留固定来源且只有 style 可作成像预设', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/prompt-module.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  assert.equal(PHOTOGRAPHY_MODULES.length, 8);
  assert.equal(new Set(PHOTOGRAPHY_MODULES.map((item) => item.id)).size, 8);
  for (const preset of [...REALISM_PRESETS, ...PHOTOGRAPHY_MODULES]) {
    assert.equal(validate(preset), true, JSON.stringify(validate.errors));
    assert.equal(isRealismPreset(preset.id), preset.category === 'style');
  }
  for (const preset of PHOTOGRAPHY_MODULES) {
    assert.equal(preset.provenance.revision, PHOTOGRAPHY_SOURCE.revision);
    assert.ok(preset.provenance.sources.length);
    assert.ok(preset.provenance.sources.every((source) => source.url.includes(PHOTOGRAPHY_SOURCE.revision)));
    assert.doesNotMatch(preset.normalizedText, /韩国网红|白皙皮肤|masterpiece|8K|阿茶/);
  }
});

void test('新版模块幂等添加，用户编辑与归档优先，返回副本不污染预设', () => {
  const edited = { ...PHOTOGRAPHY_MODULES[0], version: 3, normalizedText: '用户修改', archivedAt: '2026-09-08' };
  const previous = [edited, { id: 'private', normalizedText: '私人内容' }];
  const before = structuredClone(previous);
  const merged = mergePhotographyModules(previous);
  assert.equal(merged.length, 9);
  assert.deepEqual(merged.slice(0, 2), before);
  assert.deepEqual(mergePhotographyModules(merged), merged);
  merged[2].provenance.sources[0].title = '只改返回副本';
  assert.notEqual(PHOTOGRAPHY_MODULES[1].provenance.sources[0].title, '只改返回副本');
  assert.deepEqual(previous, before);
});

void test('基准与重拍编译分别注入摄影关系，保持原始角色与优先级', () => {
  const before = structuredClone(card);
  const baseline = compileBaselinePrompt({ characterCard: card, aspectRatio: '9:16', styleModule: PHOTOGRAPHY_MODULES[0] });
  assert.match(baseline, /concise-photo-v1/);
  assert.match(baseline, /不复制插画亮点或发光虹膜/);
  assert.match(baseline, /不因强调脸部而拉近镜头/);
  assert.match(baseline, /角色卡和主图优先于摄影风格/);
  assert.ok(baseline.indexOf('【摄影风格】') < baseline.indexOf('【用户确认的角色强约束】'));
  const pack = { name: '测试', globalStyle: 'natural', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, []])), avoid: [] };
  pack.pools.moment = ['自然回头'];
  const reshoot = compileReshootPrompt({ characterCard: card, pack, realismStyle: PHOTOGRAPHY_MODULES[1] });
  assert.match(reshoot, /concise-photo-v1/);
  assert.match(reshoot, /视线、表情、手部、重心与衣料受力/);
  assert.doesNotMatch(reshoot, /未绑定脸模时建立/);
  assert.deepEqual(card, before);
});

void test('八类单项调整有独立边界，背景不重做脸部照明、妆容不重塑五官', () => {
  const prompts = ADJUSTMENT_CATEGORIES.map((category) => compileAdjustmentPrompt({ characterCard: card, category, request: '本轮要求' }));
  assert.equal(new Set(ADJUSTMENT_CATEGORIES.map((category) => photographyMethodPrompt('adjustment', category))).size, 8);
  for (const prompt of prompts) {
    assert.match(prompt, /concise-photo-v1/);
    assert.match(prompt, /不进行全图美化/);
    assert.doesNotMatch(prompt, /未绑定脸模时建立/);
  }
  assert.match(photographyMethodPrompt('adjustment', 'background'), /不顺带重新布光整张脸/);
  assert.match(photographyMethodPrompt('adjustment', 'makeup'), /不以妆容编辑之名放大眼睛/);
  assert.throws(() => photographyMethodPrompt('unknown'), /未知/);
  assert.throws(() => photographyMethodPrompt('adjustment', 'unknown'), /未知/);
});

void test('摄影 A/B 成对移除基础与阶段规则，兼容旧 Prompt 并拒绝手改扩展', () => {
  for (const scope of ['baseline', 'reshoot', 'series', 'adjustment']) {
    const prompt = `【前文】身份锁定\n\n${realismPrompt(scope)}\n\n【后文】保持水印`;
    const pair = buildRealismComparison(prompt);
    assert.ok(pair);
    assert.doesNotMatch(pair.control, /realism-v1|photography-v2/);
    assert.match(pair.control, /身份锁定/);
    assert.match(pair.control, /保持水印/);
    assert.equal(pair.treatment, prompt);
    assert.equal(buildRealismComparison(prompt.replace('细节必须有光源', '用户手改')), null);
  }
  const legacy = `【前文】旧版\n\n${legacyRealismPrompt()}\n\n【后文】不改`;
  assert.equal(buildRealismComparison(legacy).ruleVersion, 'realism-v1');
});

void test('真实存储路径新增模块、冻结网页 Prompt 和来源；编辑素材不会改写交接', async () => {
  const data = await store.getBootstrap();
  assert.equal(data.prompts.filter((item) => item.tags.includes('摄影方法')).length, 8);
  const preset = data.prompts.find((item) => item.id === PHOTOGRAPHY_MODULES[0].id);
  const dataUrl = `data:image/png;base64,${(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer()).toString('base64')}`;
  const job = await store.createJob({ title: '摄影方法测试', mainReference: { dataUrl } });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, card);
  await store.saveCharacterCard(job.id, card);
  const queued = await store.configureAndQueueBaseline(job.id, { backend: 'chatgpt-web-manual', styleModuleId: preset.id, aspectRatio: '9:16' });
  const snapshot = structuredClone(queued.executionRuns.at(-1).handoff);
  assert.match(snapshot.prompt, /concise-photo-v1/);
  assert.equal(snapshot.snapshot.styleSnapshot.provenance.ruleVersion, PHOTOGRAPHY_METHOD_VERSION);
  const edited = await store.createPromptModule({ ...preset, normalizedText: '用户编辑后用于下一次' });
  assert.equal(edited.version, 2);
  assert.deepEqual(edited.provenance, preset.provenance);
  await store.ensureDataRoot();
  const after = await store.getBootstrap();
  assert.equal(after.prompts.find((item) => item.id === preset.id).normalizedText, '用户编辑后用于下一次');
  assert.deepEqual(after.jobs.find((item) => item.id === job.id).executionRuns.at(-1).handoff, snapshot);
});
