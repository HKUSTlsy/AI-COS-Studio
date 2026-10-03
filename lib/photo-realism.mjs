// Studio-authored rules; source cases are research references, not copied templates.
import { PHOTOGRAPHY_METHOD_VERSION, PHOTOGRAPHY_MODULES, photographyMethodPrompt } from './photography-methods.mjs';
export const REALISM_RULE_VERSION = 'realism-v1';
export const REALISM_RULES = [
  `【真人质感基础 · ${REALISM_RULE_VERSION}】`,
  '角色卡、脸模身份、用户锁定与本轮修改范围优先。真实感不等于改变五官、年龄、肤色或身体比例；不为增加真实感新增雀斑、痘痘、皱纹、痣或其他身份标记。',
  '皮肤细节与景别、焦点和光线相符：近景可见细微自然纹理，全身或远景不强行表现每个毛孔；避免整脸统一磨皮、蜡感、重复毛孔贴图或人为强化毛孔。保留角色妆容，让粉底、眼影与唇妆呈现附着于皮肤的真实质感，不擅自卸妆。',
  '保留发型轮廓与发饰位置，发丝分束和遮挡自然，发饰固定关系可信；织物、金属和皮革按各自材质响应现场光线，不把全部表面做成同一种塑料反光。',
  '人物与道具、衣物、座面的接触、遮挡、承重和受力褶皱可信；只细化当前动作，不另换姿态、服装结构或道具。',
  '高光、阴影和眼部反光对应现场光源；清晰度随焦点与距离变化，不让所有层级同等锐利。颗粒、手持感与运动模糊仅在所选摄影方案支持时适量出现，不默认加噪点、磨损、补光或背景虚化。',
].join('\n');

export function legacyRealismPrompt(scope = 'baseline') {
  return `${REALISM_RULES}\n${scope === 'adjustment'
    ? '单项调整中，上述细化仅限本轮已选类别及其必要影响区域；非调整部分的肤质、材质、清晰度、光线与源图保持一致，不进行全图美化。'
    : '以上只约束照片的可信呈现，不解锁角色设定，不覆盖既定姿态、构图、背景或画幅。'}`;
}

export function realismPrompt(scope = 'baseline', category = 'other') {
  return `${legacyRealismPrompt(scope)}\n\n${photographyMethodPrompt(scope, category)}`;
}

const sourceUrl = 'https://github.com/freestylefly/awesome-gpt-image-2';
export const REALISM_PRESETS = [
  ['natural', '自然相机摄影', '在既定场景、机位和光源下呈现自然相机摄影。主体焦点清楚，细节随距离自然递减；保留适合景别的皮肤与服装纹理，克制锐化与修饰。不额外添加影棚补光、强散景、颗粒或运动模糊。'],
  ['phone', '手机生活抓拍', '采用手机生活照片的自然成像：曝光与局部反差服从现场光线，背景保持符合既定镜头的可读性。若当前动作与拍摄条件支持，可有轻微手持感或仅在运动部位出现的少量模糊；静止主体不强加运动痕迹。不为随拍感改变人物姿态、构图或背景，不追加广告棚拍光。'],
  ['low-light', '弱光现场摄影', '当既定场景为弱光时，采用弱光现场成像：保留合理暗部、渐进的细节损失和克制暗部噪点，高光不过度提亮；冷暖色偏须对应现场已有光源。不为照清整张脸额外补光，不新增手机、蜡烛或灯具。若原场景明亮，保留原曝光与光照，不擅自变成夜景。'],
  ['digicam', '复古数码相机', '采用克制的早期便携数码相机成像：有限动态范围、轻微数字颗粒和压缩感，细节不过分锐利。仅当摄影方案明确使用直闪时才呈现直闪高光；运动拖影须有动作依据。不使用夸张鱼眼、严重糊脸、强烈色散或自动改变场景，不模拟胶片划痕和日期印章。'],
].map(([key, name, normalizedText]) => ({
  id: `realism-${key}-v1`, name, category: 'style',
  rawText: normalizedText, normalizedText,
  avoid: ['不得改变角色身份、肤色、妆造和服装设计'],
  tags: ['预置', '真人质感', '成像预设'], thumbnail: null,
  version: 1, source: 'preset',
  provenance: { sourceUrl, method: 'Studio 原创改写；借鉴摄影方法，不复制示例人物或图片' },
  createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
}));

export function isRealismPreset(id) {
  return [...REALISM_PRESETS, ...PHOTOGRAPHY_MODULES.filter((item) => item.category === 'style')].some((preset) => preset.id === id);
}

export function mergeRealismPresets(existing) {
  // Existing edits and archived records win; never resurrect or reset them.
  return [...existing, ...REALISM_PRESETS.filter((preset) => !existing.some((item) => item.id === preset.id)).map((preset) => structuredClone(preset))];
}

export function buildRealismComparison(text) {
  const marker = `【真人质感基础 · ${REALISM_RULE_VERSION}】`;
  const start = text.indexOf(marker);
  if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) return null;
  const rules = [
    ...['baseline', 'reshoot', 'series'].map((scope) => realismPrompt(scope)),
    ...['pose', 'outfit', 'background', 'body_proportion', 'makeup', 'hair_accessory', 'camera_lighting', 'other'].map((category) => realismPrompt('adjustment', category)),
    legacyRealismPrompt('baseline'), legacyRealismPrompt('adjustment'),
  ];
  // Match the entire compiler block, including its stage extension. A legacy
  // block followed by an edited v2 extension must not masquerade as a valid A/B.
  const rule = rules.find((candidate) => {
    if (!text.startsWith(candidate, start)) return false;
    const rest = text.slice(start + candidate.length).replace(/^(?:\s|\\n)+/, '');
    if (rest && !rest.startsWith('【')) return false;
    return candidate.includes(PHOTOGRAPHY_METHOD_VERSION) || !rest.startsWith('【分阶段摄影关系');
  });
  if (!rule) return null;
  const end = start + rule.length;
  return {
    control: text.slice(0, start) + text.slice(end),
    treatment: text,
    ruleVersion: rule.includes(PHOTOGRAPHY_METHOD_VERSION) ? `${REALISM_RULE_VERSION}+${PHOTOGRAPHY_METHOD_VERSION}` : REALISM_RULE_VERSION,
  };
}

// Advisory heuristics, not a semantic validator or a generation safety gate.
// Keep evidence visible and never rewrite the caller's text.
export function detectPhotoConflicts(text) {
  const clauses = String(text || '').split(/[\n。；;，,]+/).map((line) => line.trim()).filter(Boolean);
  const negative = /(?:不要|不得|禁止|避免|不允许|不能|不新增|不添加|不擅自|不强|不额外|不为|\bno\b|\bnot\b|\bwithout\b|\bavoid\b|\bnever\b)/i;
  const positive = (pattern) => clauses.find((line) => pattern.test(line) && !negative.test(line));
  const warnings = [];
  const add = (id, message, evidence) => warnings.push({ id, message, evidence });
  const candle = positive(/(?:仅|只有|单一|唯一|只由|只靠).{0,12}(?:烛光|蜡烛)|(?:lit only by|single candle|candlelight only)/i);
  const fill = positive(/正面补光|补光灯|柔光箱|环形灯|\bfill light\b|\bfill lighting\b|\bsoftbox\b|\bring light\b/i);
  if (candle && fill) add('light-source', '单一烛光与额外补光可能冲突，请明确实际光源。', [candle, fill]);
  const blemish = positive(/(?:添加|新增|加上|增加).{0,12}(?:雀斑|痣|痘痘|皱纹)|(?:add|new).{0,20}(?:freckles|moles|acne|wrinkles)/i);
  if (blemish) add('identity-marks', '新增皮肤标记可能改变脸模特征；真实感不要求增加瑕疵。请核对角色与身份锁定。', [blemish]);
  const smooth = positive(/(?:无瑕|瓷娃娃|陶瓷般|完全光滑|强磨皮|磨平毛孔)|(?:poreless|flawless skin|porcelain skin|airbrushed skin)/i);
  if (smooth) add('skin-texture', '无瑕或陶瓷皮肤描述可能与自然肤质冲突；请确认是否刻意追求美妆修饰。', [smooth]);
  const sharp = positive(/(?:全画面|所有层级|从前到后).{0,10}(?:锐利|清晰)|(?:tack.sharp throughout|everything in sharp focus|sharp from foreground to background)/i);
  const blur = positive(/(?:极浅景深|背景完全模糊|奶油散景)|(?:extremely shallow depth|background completely blurred|creamy bokeh)/i);
  if (sharp && blur) add('focus-depth', '全画面清晰与极浅景深可能冲突，请指定清晰区和虚化区。', [sharp, blur]);
  const motion = positive(/(?:全画面|整张|脸部).{0,12}(?:强烈模糊|严重模糊|运动模糊)|(?:heavy motion blur across (?:the entire|the whole)|blurred face)/i);
  if (motion) add('face-readability', '大范围或脸部模糊可能影响身份辨识；建议明确运动部位。', [motion]);
  return warnings;
}
