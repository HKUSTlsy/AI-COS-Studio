import assert from 'node:assert/strict';
import test from 'node:test';
import { maximumNativeResolution, nativeResolutionPrompt, withNativeResolution, outputResolutionRecord } from '../lib/image-output-policy.mjs';
import { withWebReshootWatermark } from '../server/web-reshoot-watermark.mjs';
import { compileBaselinePrompt, compileAdjustmentPrompt, compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';

void test('常用画幅选择官方上限内最大精确比例，且不声称支持硬尺寸参数', () => {
  const sizes = { '1:1': [2880, 2880], '4:3': [3264, 2448], '3:4': [2448, 3264], '16:9': [3840, 2160], '9:16': [2160, 3840] };
  for (const [ratio, [width, height]] of Object.entries(sizes)) {
    const policy = maximumNativeResolution(ratio);
    assert.deepEqual([policy.pixelWidth, policy.pixelHeight], [width, height]);
    assert.equal(policy.control, 'prompt_only');
    assert.equal(width % 16, 0);
    assert.equal(height % 16, 0);
    assert.ok(width <= 3840 && height <= 3840 && width * height <= 8294400);
    const [a, b] = ratio.split(':').map(Number);
    assert.equal(width / height, a / b);
    assert.ok(width + 16 * a > 3840 || height + 16 * b > 3840 || (width + 16 * a) * (height + 16 * b) > 8294400);
  }
  assert.throws(() => maximumNativeResolution('8:7'), /画幅/);
});

void test('跟随源图限制比例误差并诚实处理未知或超宽比例', () => {
  for (const [width, height] of [[941, 1672], [1024, 1536], [1300, 1300], [3000, 1000]]) {
    const p = maximumNativeResolution('source', { pixelWidth: width, pixelHeight: height });
    assert.ok(p.pixelWidth * p.pixelHeight <= 8294400);
    assert.ok(Math.abs(p.pixelWidth / p.pixelHeight / (width / height) - 1) <= 0.005);
  }
  for (const source of [{}, { pixelWidth: 0, pixelHeight: 0 }, { pixelWidth: 5000, pixelHeight: 500 }]) {
    assert.equal(maximumNativeResolution('source', source).pixelWidth, null);
  }
});

void test('尺寸块替换幂等，保留用户补充与唯一阿茶水印', () => {
  const policy = maximumNativeResolution('9:16');
  const original = `保持五官\n\n${nativeResolutionPrompt(policy)}\n用户补充保留银簪\n\n【避免】新增道具`;
  const prompt = withNativeResolution(original, policy);
  assert.equal(withNativeResolution(prompt, policy), prompt);
  assert.match(prompt, /用户补充保留银簪/);
  const web = withWebReshootWatermark(prompt);
  assert.equal(web.split('【原生输出尺寸').length, 2);
  assert.equal(withWebReshootWatermark(web), web);
  const reconfirmed = withWebReshootWatermark(withNativeResolution(web, policy));
  assert.equal(reconfirmed.split('【Studio 网页重拍默认署名】').length, 2);
  assert.equal(reconfirmed.split('【原生输出尺寸').length, 2);
  assert.match(web, /“阿茶”/);
  assert.match(web, /不能|不代表强制参数/);
});

void test('尺寸验收只记录真实文件，不放大、不拒收、不回填旧任务', () => {
  const policy = maximumNativeResolution('9:16');
  for (const [width, height, status] of [[2160, 3840, 'matched'], [1080, 1920, 'below_target'], [1024, 1024, 'different_ratio'], [4320, 7680, 'different_size']]) {
    assert.equal(outputResolutionRecord(policy, { pixelWidth: width, pixelHeight: height }).resolutionCheck.status, status);
  }
  assert.deepEqual(outputResolutionRecord(null, { pixelWidth: 512, pixelHeight: 512 }), {});
  assert.equal(outputResolutionRecord(maximumNativeResolution(), {}).resolutionCheck.status, 'unknown');
});

void test('新基准、调整、随机重拍都有尺寸目标与用途隔离，不改写角色卡', () => {
  const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: key, certainty: 'observed', strongLock: true }]));
  const before = JSON.stringify(card);
  const references = [{ role: 'character_main', purpose: '角色核对', path: 'x', pixelWidth: 1, pixelHeight: 1 }];
  const baseline = compileBaselinePrompt({ characterCard: card, references, aspectRatio: '16:9' });
  assert.match(baseline, /3840 × 2160/);
  const adjustment = compileAdjustmentPrompt({ characterCard: card, references, category: 'makeup', request: '改唇妆', outputResolution: maximumNativeResolution('1:1') });
  assert.match(adjustment, /2880 × 2880/);
  assert.match(adjustment, /保持源图曝光、白平衡/);
  const reshoot = compileReshootPrompt({ characterCard: card, references, aspectRatio: '3:4', pack: { name: 'test', globalStyle: 'natural photo', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'moment' ? ['turning'] : []])) } });
  assert.match(reshoot, /2448 × 3264/);
  assert.match(reshoot, /图 1 是干净真人 COS 源图/);
  assert.match(reshoot, /图 2.*角色核对/);
  assert.equal(JSON.stringify(card), before);
});
