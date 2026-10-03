// Studio-authored, image-first writing. Only compiler-owned scaffolding is
// shortened; user text, selected variables, references and snapshots stay intact.
export const CONCISE_PROMPT_VERSION = 'concise-photo-v1';

export const CONCISE_BASELINE_FACE_RULES = `【基准面部真人化 · baseline-face-v2】动漫图只提供角色妆发与配色；面部结构以真人脸模为准，包括眼裂、眼球与虹膜的相对尺寸。无脸模时建立原创真人五官，不照搬动漫大眼、小鼻或尖下巴。保留已确认瞳色与色环，以正常尺寸美瞳呈现；角膜反光和眼白受当前现场光线影响，不复制插画亮点或发光虹膜。保留自然左右差异、眼睑厚度、鼻翼与唇缘体积；不擅自卸妆、老化、换肤色、增加痣或雀斑。重修饰脸模只映射可见身份，不猜测真实素颜。不要为了展示脸部而自动改成大头照。`;

const adjustmentNotes = {
  pose: '视线、表情、手部、重心与衣料受力随本轮动作自然响应。',
  outfit: '只改授权衣物与配件；接缝、厚度、褶皱和皮肤接触符合新穿搭。',
  background: '仅替换背景和必要的边缘接触；不顺带重新布光整张脸。',
  body_proportion: '仅改指定身体比例，合理更新衣物贴合、承重与遮挡，五官不变。',
  makeup: '妆面附着于原有骨相，不放大眼睛、缩鼻、瘦脸或重塑唇形。',
  hair_accessory: '只改指定发型或发饰；发根连接、发束遮挡与发饰固定可信，脸型及肤质不变。',
  camera_lighting: '只更新所选镜头或光照及对应透视、景深、受光和反射，角色设计不变。',
  other: '只改指定细节，不扩大为全图重建。',
};
export function conciseRealismPrompt(scope, category = 'other') {
  if (!['baseline', 'reshoot', 'series', 'adjustment', 'multi'].includes(scope)) throw new Error('未知摄影阶段');
  if (scope === 'adjustment') {
    if (!Object.hasOwn(adjustmentNotes, category)) throw new Error('未知摄影调整类别');
    return `【局部呈现 · ${CONCISE_PROMPT_VERSION}】${adjustmentNotes[category]}细化仅限本轮已选类别及其必要影响区域。`;
  }
  return `【真人质感 · ${CONCISE_PROMPT_VERSION}】保留身份和妆容；眼睑、鼻翼与唇部有自然体积，皮肤、发丝与衣料各自响应现场光线，不磨成蜡面、不添加身份标记。纹理随景别和焦点衰减，全身或远景不强行表现每个毛孔，也不因强调脸部而拉近镜头。暗部、反光与阴影对应已有光源；不默认加噪点、补光、散景或运动模糊。${scope === 'reshoot' || scope === 'multi' ? '视线、表情、手部、重心与衣料受力共同回应已选事件。' : ''}`;
}

// Group the literal selections by visual relationship. Do not truncate, split,
// translate or infer any new material. Locks replace selections before grouping.
export function photographyNarrative(selections = {}, locks = {}, { group = false } = {}) {
  const chosen = { ...selections };
  for (const [key, value] of Object.entries(locks)) if (String(value || '').trim()) chosen[key] = value;
  const line = (keys) => keys.map(([key, label]) => {
    const value = String(chosen[key] || '').trim();
    return value ? `${label}${String(locks[key] || '').trim() ? '（用户锁定）' : ''}：${value}` : '';
  }).filter(Boolean).join('；');
  const pairedExpression = /本组表情优先/.test(String(chosen.moment || ''));
  return [
    ['画面', line([['scene', '环境'], ...(!group ? [['moment', '正在发生'], ...(!pairedExpression ? [['expression', '表情']] : [])] : [])])],
    ['观看方式', line([['shotScale', '景别'], ['cameraPosition', '机位'], ['composition', '构图'], ['focalLength', '镜头感觉'], ['foreground', '前景']])],
    ['光线与成像', line([['lighting', '光线'], ['palette', '色彩'], ...(!group ? [['captureState', '拍摄状态']] : [])])],
  ].filter(([, content]) => content).map(([label, content]) => `【${label}】${content}。`).join('\n\n');
}
