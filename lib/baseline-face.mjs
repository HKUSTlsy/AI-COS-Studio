// Baseline-only translation contract. Never retroactively rewrite saved prompts.
import { CONCISE_BASELINE_FACE_RULES } from './concise-prompts.mjs';
export const BASELINE_FACE_VERSION = 'baseline-face-v1';
export const BASELINE_FACE_RULES = [
  `【基准面部真人化 · ${BASELINE_FACE_VERSION}】`,
  '面部映射分工：动漫参考与角色卡提供瞳色、妆容色系、发型发饰及角色设计；已授权真人脸模提供面部身份、骨相、眼眶、眼裂、眼球与虹膜的相对尺寸、鼻口结构及下颌比例。面部结构以真人脸模为准，不把动漫五官几何当作一比一还原目标。无脸模时使用可信、原创的真人面部结构，不套用动漫大眼、小鼻或尖削下巴。',
  '角色卡中“宝石感”、插画亮点、放大的虹膜等描述，只保留其角色配色与可实现的妆造含义，不照搬发光材质、固定高光位置、玻璃珠眼球或放大眼球。保留已确认瞳色与色环，以佩戴合适尺寸彩色隐形眼镜的真人眼睛呈现；瞳孔、角膜反光和眼白受当前现场光线影响，不让整颗虹膜均匀自发光。',
  '面部真实感首先来自可信结构和受光，而非堆叠毛孔：保留脸模已有的自然左右差异、眼睑厚度与遮挡、鼻翼和唇缘的软组织过渡，阴影随面部体积连续变化。不要自动放大眼睛、缩鼻、削下巴、统一成网红娃娃脸，也不要重新设计脸模身份。',
  '在当前景别可分辨的尺度呈现额头、面颊、鼻翼与嘴唇不同的细微质感和反光；不将面部磨成均匀蜡面，不在眼睛嘴唇周围贴锐利纹理。保留角色妆容与美感，不擅自卸妆、老化、增加雀斑痘痘皱纹或改变肤色。脸模照片若经重度修饰，只按可见身份结构映射，不虚构其未经修饰的真实长相。',
  '此规则限定动漫设计到真人面部的翻译方式，优先于摄影模板和插画表现描述；不解锁服装、发饰、瞳色色系、身体设定、原图姿态、构图或背景。不要为了展示脸部而自动改成大头照。',
].join('\n');

export function buildBaselineFaceComparison(text) {
  const block = `${BASELINE_FACE_RULES}\n\n`;
  const start = text.indexOf(block);
  if (start < 0 || text.indexOf(BASELINE_FACE_RULES, start + block.length) >= 0) return null;
  return { control: text.slice(0, start) + text.slice(start + block.length), treatment: text, ruleVersion: BASELINE_FACE_VERSION };
}

const outputsOf = (job) => [...(job.baselineVersions || []), ...(job.adjustmentVersions || []), ...(job.reshootVersions || [])];

export function requiresBaselineFaceReview(prompt) {
  return Boolean(prompt?.includes(BASELINE_FACE_RULES) || prompt?.includes(CONCISE_BASELINE_FACE_RULES));
}

// Mirrors server outputContext's identity precedence. Explicit null is a frozen
// original identity; the current editor face must never fill a historical gap.
export function sourceFaceContext(job, output, seen = new Set()) {
  if (!output || seen.has(output.id)) return { face: null, known: false };
  seen.add(output.id);
  if (output.inputSnapshot && Object.hasOwn(output.inputSnapshot, 'faceSnapshot'))
    return { face: output.inputSnapshot.faceSnapshot, known: true };
  if (output.sourceOutputId) return sourceFaceContext(job, outputsOf(job).find((item) => item.id === output.sourceOutputId), seen);
  const config = job.configurationHistory?.find((item) => item.version === output.configurationVersion);
  const face = output.faceSnapshot ?? config?.faceSnapshot ?? null;
  return { face, known: Object.hasOwn(output, 'faceSnapshot') || Boolean(config && Object.hasOwn(config, 'faceSnapshot')) };
}

export function faceReviewState(job, output, seen = new Set()) {
  if (!output || seen.has(output.id)) return { status: 'pending', blocked: true, reviewedOutputId: null };
  seen.add(output.id);
  const review = job.outputAnnotations?.[output.id]?.faceReview;
  if (review) return { status: review.status, blocked: review.status !== 'accepted', reviewedOutputId: output.id };
  if (output.kind === 'baseline') {
    // Older handoffs/outputs retain their original behavior. No migration writes.
    const required = requiresBaselineFaceReview(output.prompt);
    return { status: required ? 'pending' : 'legacy', blocked: required, reviewedOutputId: output.id };
  }
  return faceReviewState(job, outputsOf(job).find((item) => item.id === output.sourceOutputId), seen);
}

export function assertFaceReviewed(job, output) {
  if (faceReviewState(job, output).blocked)
    throw new Error('请先放大检查源图面部并完成人工验收；不满意时可返回生成新基准，或使用单项调整修正后验收。');
}

export function normalizeFaceReview(value) {
  if (!value || !['accepted', 'rejected', 'pending'].includes(value.status)) throw new Error('面部验收状态无效');
  const checks = Object.fromEntries(['identity', 'anatomy', 'texture'].map((key) => [key, value.checks?.[key] === true]));
  if (value.status === 'accepted' && Object.values(checks).some((checked) => !checked))
    throw new Error('请分别确认身份、五官结构与面部质感后再通过验收');
  if (value.note != null && typeof value.note !== 'string') throw new Error('验收备注必须为文字');
  return { status: value.status, checks, note: (value.note || '').slice(0, 2000), reviewer: 'user', reviewedAt: new Date().toISOString() };
}
