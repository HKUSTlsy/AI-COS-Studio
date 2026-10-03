import assert from 'node:assert/strict';
import test from 'node:test';
import { REALISM_PRESETS, REALISM_RULES, detectPhotoConflicts, mergeRealismPresets, realismPrompt, buildRealismComparison } from '../lib/photo-realism.mjs';
import { compileBaselinePrompt, compileAdjustmentPrompt, compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';

const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `${key} locked`, certainty: 'user_confirmed', strongLock: true }]));
const pack = { name: '测试包', globalStyle: 'natural photography', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, []])), avoid: [] };
pack.pools.moment = ['回头'];

void test('四个原创成像预设作为 style 模块提供，内容没有默认人物或署名', () => {
  assert.equal(REALISM_PRESETS.length, 4);
  assert.equal(new Set(REALISM_PRESETS.map((item) => item.id)).size, 4);
  for (const item of REALISM_PRESETS) {
    assert.equal(item.category, 'style');
    assert.equal(item.version, 1);
    assert.doesNotMatch(item.normalizedText, /韩国网红|白皙皮肤|BubbleBrain|8K|masterpiece/i);
    assert.deepEqual(detectPhotoConflicts(item.normalizedText), []);
  }
});

void test('补充预设幂等，不重置编辑、不复活归档、不改动历史数据', () => {
  const existing = [{ ...REALISM_PRESETS[0], version: 3, normalizedText: '用户修改', archivedAt: '2026-09-08' }, { id: 'private', normalizedText: '私人模板' }];
  const before = structuredClone(existing);
  const merged = mergeRealismPresets(existing);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged.slice(0, 2), before);
  assert.deepEqual(mergeRealismPresets(merged), merged);
  assert.deepEqual(existing, before);
});

void test('新基准和随机重拍加入真人规则，优先保持角色，不默认加颗粒', () => {
  const prompt = compileBaselinePrompt({ characterCard: card });
  assert.match(prompt, /concise-photo-v1/);
  assert.ok(prompt.indexOf('【用户确认的角色强约束】') < prompt.indexOf('【真人质感'));
  assert.ok(prompt.indexOf('【摄影风格】') < prompt.indexOf('【真人质感'));
  assert.match(prompt, /全身或远景不强行表现每个毛孔/);
  assert.match(prompt, /不默认加噪点/);
  assert.match(prompt, /不擅自卸妆/);
  assert.match(prompt, /保留全部已确认设计/);
  const reshoot = compileReshootPrompt({ characterCard: card, pack, realismStyle: REALISM_PRESETS[1] });
  assert.match(reshoot, /【可选成像预设】/);
  assert.match(reshoot, /手机生活照片/);
  assert.match(reshoot, /服装锁定/);
});

void test('单项调整的真人细化不能扩散成全图美化', () => {
  const prompt = compileAdjustmentPrompt({ characterCard: card, category: 'background', request: '背景改成灰墙', preserve: ['脸模与妆容不变'] });
  assert.match(prompt, /仅限本轮已选类别及其必要影响区域/);
  assert.match(prompt, /不进行全图美化/);
  assert.match(prompt, /脸模与妆容不变/);
  assert.ok(prompt.indexOf('【必须保持不变】') < prompt.indexOf('【局部呈现'));
});

void test('中英文光源冲突包含可核对原句且不改写输入', () => {
  for (const input of ['只有一根蜡烛照明。正面补光灯照亮脸部。', 'lit only by a single candle; softbox fill light on the face']) {
    const warnings = detectPhotoConflicts(input);
    assert.equal(warnings[0].id, 'light-source');
    assert.equal(warnings[0].evidence.length, 2);
    assert.ok(warnings[0].evidence.every((line) => input.includes(line)));
  }
});

void test('皮肤标记、过度修饰、景深和糊脸分别给出建议', () => {
  const warnings = detectPhotoConflicts('新增雀斑。flawless skin。全画面清晰。背景完全模糊。脸部严重模糊。');
  assert.deepEqual(warnings.map((item) => item.id), ['identity-marks', 'skin-texture', 'focus-depth', 'face-readability']);
});

void test('否定句和系统真人规则不触发假冲突', () => {
  assert.deepEqual(detectPhotoConflicts('仅烛光；不要正面补光；不新增雀斑；no flawless skin; avoid blurred face'), []);
  assert.deepEqual(detectPhotoConflicts(REALISM_RULES), []);
  assert.deepEqual(detectPhotoConflicts(realismPrompt('adjustment')), []);
});

void test('历史 A/B 规则仍可读取；新简洁编译不再产生 A/B 分支', () => {
  const prompt = `【角色强约束】原设计\n\n${realismPrompt()}\n\n【风格】手机生活照片\n\n【署名】右下角草书阿茶`;
  const pair = buildRealismComparison(prompt);
  assert.ok(pair);
  assert.equal(pair.treatment, prompt);
  assert.doesNotMatch(pair.control, /realism-v1/);
  assert.match(pair.control, /手机生活照片/);
  assert.match(pair.control, /角色强约束/);
  assert.match(pair.control, /右下角草书阿茶/);
  assert.equal(buildRealismComparison('历史提示词，无新增规则'), null);
  assert.equal(buildRealismComparison(prompt.replace('真实感不等于', '手动修改')), null);
  assert.equal(buildRealismComparison(prompt + realismPrompt()), null);
  const reshoot = compileReshootPrompt({ characterCard: card, pack });
  assert.equal(buildRealismComparison(reshoot), null);
  assert.equal(buildRealismComparison(compileAdjustmentPrompt({ characterCard: card, category: 'background', request: '灰墙' })), null);
});
