// Prompt-only targets, not capabilities promised by the built-in or web backend.
// Reviewed 2026-09-10: https://developers.openai.com/api/docs/guides/image-prompting
export const IMAGE_PROMPT_GUIDE_VERSION = 'official-image-prompting-2026-09-10';
export const MAX_IMAGE_EDGE = 3840;
export const MAX_IMAGE_PIXELS = 8294400;
const PRESETS = {
  '1:1': [2880, 2880], '4:3': [3264, 2448], '3:4': [2448, 3264],
  '16:9': [3840, 2160], '9:16': [2160, 3840],
};

export function maximumNativeResolution(aspectRatio = 'source', source = {}) {
  if (aspectRatio !== 'source' && !PRESETS[aspectRatio]) throw new Error('目标画幅无效');
  let dimensions = PRESETS[aspectRatio];
  const ratio = Number(source.pixelWidth) / Number(source.pixelHeight);
  if (!dimensions && source.pixelWidth > 0 && source.pixelHeight > 0 && Number.isFinite(ratio) && ratio >= 1 / 3 && ratio <= 3) {
    // Preserve source composition. Grid rounding is at most 0.5%, never a crop.
    let area = 0;
    for (let width = 16; width <= MAX_IMAGE_EDGE; width += 16) {
      for (let height = 16; height <= MAX_IMAGE_EDGE; height += 16) {
        const pixels = width * height;
        if (pixels <= area || pixels > MAX_IMAGE_PIXELS || width / height > 3 || height / width > 3) continue;
        if (Math.abs(width / height / ratio - 1) > 0.005) continue;
        area = pixels;
        dimensions = [width, height];
      }
    }
  }
  return {
    version: 'max-native-v1', guideVersion: IMAGE_PROMPT_GUIDE_VERSION,
    mode: 'maximum_native', control: 'prompt_only', aspectRatio,
    pixelWidth: dimensions?.[0] ?? null, pixelHeight: dimensions?.[1] ?? null,
    experimental: Boolean(dimensions && dimensions[0] * dimensions[1] > 3686400),
    reason: dimensions ? 'target_only' : 'source_ratio_unresolved_or_outside_documented_range',
  };
}

export function nativeResolutionPrompt(policy = maximumNativeResolution()) {
  const target = policy.pixelWidth && policy.pixelHeight
    ? `目标原生输出尺寸 ${policy.pixelWidth} × ${policy.pixelHeight} 像素（宽 × 高）`
    : '保持源图宽高比，使用当前生成服务可提供的最大原生输出尺寸';
  return `【原生输出尺寸 · max-native-v1】${target}，原生生成单张照片，不拼图；不后期放大、拉伸、裁切或补边。颗粒与压缩感只影响外观，不降低输出像素。尺寸是请求目标，不代表强制参数；按实际文件归档，不伪报或自动重试。`;
}

export function withNativeResolution(prompt, policy) {
  // Only our own section is replaced; user content and watermarks stay intact.
  const clean = String(prompt).replace(/(?:\n\n)?【原生输出尺寸 · max-native-v1】[^\n]*/g, '').trim();
  return `${clean}\n\n${nativeResolutionPrompt(policy)}`;
}

export function outputResolutionRecord(policy, image) {
  if (!policy) return {}; // Never retrofit targets onto historical runs.
  const width = Number(image.pixelWidth), height = Number(image.pixelHeight);
  const targetWidth = policy.pixelWidth, targetHeight = policy.pixelHeight;
  let status = 'unknown';
  if (width > 0 && height > 0 && targetWidth && targetHeight) {
    status = width === targetWidth && height === targetHeight ? 'matched'
      : Math.abs(width / height / (targetWidth / targetHeight) - 1) > 0.01 ? 'different_ratio'
      : width * height < targetWidth * targetHeight ? 'below_target' : 'different_size';
  }
  return { outputResolution: structuredClone(policy), resolutionCheck: { status, pixelWidth: width || null, pixelHeight: height || null } };
}

export const PHOTO_EXECUTION_RULES = '【画面执行规则】同一瞬间、相容的光源与透视，手部接触和承重正确。只绘制明确要求的文字，按指定字形与位置呈现；不复制参考署名。';
