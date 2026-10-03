import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withWebReshootWatermark, WEB_RESHOOT_WATERMARK } from '../server/web-reshoot-watermark.mjs';

void test('网页重拍署名准确指定内容、字形、位置与角色保持项', () => {
  const result = withWebReshootWatermark('【角色保持】保留发饰和人物身份。');
  assert.ok(result.startsWith('【角色保持】保留发饰和人物身份。'));
  for (const phrase of ['“阿茶”', '草书手写', '右下角', '安全边距', '不改变人物身份'])
    assert.ok(result.includes(phrase));
  assert.equal(withWebReshootWatermark(result), result);
});

void test('替换系列默认无水印规则，局部例外不删除其他质量或安全约束', () => {
  const result = withWebReshootWatermark('避免多余手指、色情化构图、no watermark、no text；默认不添加署名或水印。');
  assert.ok(!result.includes('默认不添加署名或水印。'));
  assert.match(result, /避免多余手指、色情化构图/);
  assert.match(result, /唯一署名例外/);
  assert.ok(result.endsWith(WEB_RESHOOT_WATERMARK));
});
