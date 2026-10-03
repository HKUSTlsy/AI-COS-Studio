// Applied only when a reshoot draft is confirmed for the manual web backend.
// Keep the finalized variant, handoff files and archived output prompt identical.
export const WEB_RESHOOT_WATERMARK = [
  '【Studio 网页重拍默认署名】',
  '在最终图片右下角添加且仅添加一处中文署名水印，文字准确为“阿茶”（两个字，不带引号）。采用自然连贯的草书手写签名，笔画有轻重、提按与连笔感，不用印刷体；保持文字可辨认，不增字、不漏字、不写成其他名字。',
  '署名小巧低调，宽度约占画面宽度的 6%–9%，距离右边和底边各保留约 3% 的安全边距；根据背景使用柔和的浅色或深色，保证适度对比。置于右下角留白，避开脸部、手部、发饰、服装关键细节与鞋袜；不移动或裁切人物来放置署名。',
  '本节是上述“无水印／不添加署名／禁止文字／no watermark／no text”等摄影模板约束的唯一署名例外，这些约束仍适用于其他额外文字、水印和标识。不要把本节说明文字写进画面，不复制参考图中的其他签名或水印；不改变人物身份、角色设定、摄影方案和安全要求。',
].join('\n');

export function withWebReshootWatermark(prompt) {
  // A fixed resolution section may have been appended after a copied handoff.
  // Relocate only our exact owned block; never duplicate it or remove user text.
  const original = String(prompt).split(WEB_RESHOOT_WATERMARK).join('').trim();
  // Replace the compiler-owned series default; preserve user-authored content,
  // resolving imported photography restrictions with the scoped exception above.
  const base = original.replaceAll(
    '默认不添加署名或水印。',
    '除 Studio 明确指定的署名外，不添加其他署名或水印。',
  );
  return `${base}\n\n${WEB_RESHOOT_WATERMARK}`;
}
