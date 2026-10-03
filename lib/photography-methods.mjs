// Original Studio adaptations of photographic methods, not third-party prompt copies.
export const PHOTOGRAPHY_METHOD_VERSION = 'photography-v2';
export const PHOTOGRAPHY_SOURCE = {
  repository: 'https://github.com/freestylefly/awesome-gpt-image-2',
  revision: 'b477278bb2a36d4c59655eb0daa4ce48e8dbc4c4',
  reviewedAt: '2026-09-08',
};
export const PHOTOGRAPHY_SOURCES = [
  [383, '日常手机成像', '现场曝光与条件性手持感；不默认糊脸或降低清晰度。'],
  [414, '窗光与自然妆面', '面部受光渐变、细微反光与妆面附着；排除示例人物、肤色和房间设定。'],
  [450, '单光源与材质响应', '眼部、皮肤和刺绣回应同一光源；不自动添加蜡烛、汗水或暗场。'],
  [466, '人物事件与焦点层级', '事件连接视线、表情与身体响应；不导入猫、追逐、鱼眼或夸张模糊。'],
  [499, '全身人物与环境联系', '衣料、接触和环境尺度可信；不导入示例服装、身份或广告式修饰。'],
  [505, '现场冷暖混光', '局部反射与细节损失对应实际光源；不自动新增手机、眼镜或灯具。'],
  [535, '局部改变与身份一致', '改变发型时保持五官结构；扩展为单项调整的范围约束。'],
].map(([caseId, title, adaptation]) => ({
  caseId, title, adaptation,
  url: `${PHOTOGRAPHY_SOURCE.repository}/blob/${PHOTOGRAPHY_SOURCE.revision}/docs/gallery-part-2.md#case-${caseId}`,
}));

export const PHOTOGRAPHY_STAGE_NOTES = {
  baseline: '基准图：把动漫设计转成实体妆造，面部受光与眼部反光遵循真实摄影；不额外改姿态、背景或五官身份。',
  reshoot: '随机重拍：连接现场事件、视线与身体响应，明确焦点和前后景；颗粒、模糊、直闪仅按已选方案使用。',
  series: '系列写真：沿用确认的布光拓扑、色彩和成像机制；主参考优先，写真参考人物不提供身份。',
  adjustment: '单项调整：只改变所选类别及必要的接触、阴影关系；不顺带重做整张脸、妆容或全图色调。',
};

const stageRules = {
  baseline: '先把可见的角色设计落实为真实穿戴、假发、美瞳与化妆，再拍摄这位真人；动漫平涂阴影不是涂在脸上的色块，虹膜花纹不是自发光宝石。保留眼睑厚度、眼球曲面与鼻翼、唇部的自然体积，反光服从已有光源与头部朝向。未绑定脸模时建立自然成年真人五官，不照搬动漫眼球大小；绑定时以脸模为准。不得以真实感为由改妆、改瞳色、瘦脸、换肤色或替换姿态背景。全身构图优先五官形体与受光可信，不用放大毛孔伪装近摄细节。',
  reshoot: '把已抽中的动作瞬间理解为一次正在发生的具体事件，使视线、表情、手部、重心与衣料受力相互呼应；不得为了故事新增未授权道具或改写锁定变量。按本张构图设定主要关注区、次要环境与前景层级，不机械叠加大散景。皮肤、眼睛、头发、织物的明暗与反光来自同一现场；新机位下光源仍位于原定世界空间。局部遮挡按已选遮挡规则执行，不以纪实感擅自糊脸或遮住身份特征。',
  series: '使用本张已确认分镜事件，不另抽故事或增加道具。全系列保持共同曝光逻辑、色彩关系、黑位、高光过渡与锐度尺度；变化来自分镜、实际距离和已确认布光子方案，不给每张单独套不相干滤镜。机位变化时重新计算受光面与眼部反光，光源不随相机转动。主摄影参考决定光照和成像，辅助参考只补缺失信息；不得把多张互斥光源、人物长相或妆面强行混合。',
};
const adjustmentRules = {
  pose: '动作改变时仅更新对应表情响应、重心、关节、接触与衣物受力；不另换脸、妆造或场景。',
  outfit: '仅调整服装及获准配件，保持人体身份；接缝、厚度、重力褶皱、皮肤接触和材质反光有依据。',
  background: '仅替换背景与必要的边缘、接触关系；不顺带重新布光整张脸。若需要大幅改变人物照明，应另选镜头/光线调整。',
  body_proportion: '只调整本轮指定的身体比例，保持五官、妆造和衣服设计；衣物贴合、承重与遮挡随比例变化合理更新。',
  makeup: '只改变指定妆面；化妆附着于原有皮肤与骨骼，不以妆容编辑之名放大眼睛、缩鼻、瘦脸或重塑唇形。',
  hair_accessory: '只改指定发型或发饰，保持脸型、眼距、鼻口与肤质；发际连接、发束遮挡和发饰固定可信。',
  camera_lighting: '只改变指定镜头或光照以及由此产生的透视、景深、受光和反射；不顺带改变身份、妆容颜色或服装设计。',
  other: '只处理文字明确指定的局部细节，不扩大为整张照片的真实感重建。',
};

export function photographyMethodPrompt(scope = 'baseline', category = 'other') {
  if (!Object.hasOwn(PHOTOGRAPHY_STAGE_NOTES, scope)) throw new Error('未知摄影阶段');
  if (scope === 'adjustment' && !Object.hasOwn(adjustmentRules, category)) throw new Error('未知摄影调整类别');
  return [
    `【分阶段摄影关系 · ${PHOTOGRAPHY_METHOD_VERSION} · ${scope}】`,
    '本节是角色、参考职责、用户锁定与本轮范围之下的成像规则，不授权改变身份或凭空补充内容。细节必须有光源、距离、材质和动作原因；摄影术语不代表真实相机元数据，也不承诺精确像素或必然更像真人。',
    scope === 'adjustment' ? adjustmentRules[category] : stageRules[scope],
    '保留符合已有曝光的暗部，不为看清一切自动补光；眼部反光数量、方向和明暗对应实际光源，皮肤与衣料各自响应。只有已选方案明确支持时才采用弱光噪点、压缩损失或运动痕迹。避免动漫与真人混合脸、陶瓷式统一高光、无原因的锐化与美颜。',
  ].join('\n');
}

/** @type {Array<[string, string, string, number[], string]>} */
const moduleDefinitions = [
  ['face-light', '自然面部与妆面成像', 'style', [414, 450], '在既定光源下，眼睑、鼻翼、唇部有自然体积，面部不同朝向呈连续明暗变化。保留原有身份、肤色和妆容；粉底、眼影和唇妆呈真实附着与局部反光，不形成统一塑料光泽。虹膜与眼白回应现场照明，不发光、不扩大眼球。全身照片不强行添加近摄毛孔。'],
  ['onsite', '现场纪实成像', 'style', [383, 466, 505], '忠于已选现场光照与构图，焦点、动态范围和局部清晰度有拍摄原因。暗部可保留细节衰减，人物身份仍清楚；只有弱光或运动条件确实存在时才有克制噪点或局部运动痕迹。不另加补光、道具、模糊或夸张鱼眼，不擅改动作。'],
  ['window', '窗侧光的自然渐变', 'scene_lighting', [414], '本轮获准改变光照时，以侧方窗光为主要照明：靠窗与背光面有连续曝光落差，眼部反光和材质高光方向一致；不过度抬亮暗面。不添加第二套商业轮廓光，不改变脸部身份。若本轮仅调整背景，窗景不得自动改写人物原有受光。'],
  ['mixed-light', '现场冷暖光关系', 'scene_lighting', [450, 505], '本轮获准改变照明时，明确已有光源的冷暖、方向与覆盖范围，让皮肤、金属、织物的局部色偏对应其受光，不把整张照片统一染色。保留实际亮暗关系，不自动补光或新增发光道具。若仅改变背景，保留人物原有照明。'],
  ['event', '自然动作与视线响应', 'pose', [466], '围绕本轮已指定动作形成自然瞬间：视线指向当前互动对象，头颈、肩膀、手部与重心互相配合，表情是动作的轻微自然响应。没有指定对象时不新增道具；不强迫夸张表情，不改变面部身份、服装或场景。'],
  ['makeup', '真实妆面附着', 'makeup', [414, 450], '让本轮指定妆容真实附着于原有面部：粉底保留适合景别的纹理，眼影沿原眼睑铺陈，唇妆高光对应嘴唇曲面和既定光线。保留原五官结构、肤色和年龄，不擅自卸妆、添加雀斑或重塑眼鼻口。'],
  ['hair', '真实发丝与发饰固定', 'hair_accessory', [535], '只处理本轮指定发型或发饰：发根、分束、交叠与重力方向合理，发饰具有可行的固定位置与接触阴影。身份、脸型、眼距、妆面和身体保持不变；不改变未被指定的头发颜色或配件设计，不新增随风飘动。'],
  ['fabric', '实体衣料与接触受力', 'outfit', [450, 499], '在本轮允许的服装范围内建立真实厚度、接缝、垂坠与接触褶皱，刺绣、织物、金属与皮革分别回应既定光线。衣料随当前姿态承重，不用塑料反光替代全部材质；不借材质细化改变未授权的层级、配色、身体比例或裸露程度。'],
];
export const PHOTOGRAPHY_MODULES = moduleDefinitions.map(([key, name, category, cases, normalizedText]) => ({
  id: `photography-${key}-v2`, name, category, rawText: normalizedText, normalizedText,
  avoid: ['不覆盖身份、用户锁定、参考用途或本轮调整范围'],
  tags: ['预置', '摄影方法', category === 'style' ? '基准与重拍' : '单项调整'],
  thumbnail: null, version: 1, source: 'preset',
  provenance: {
    sourceUrl: PHOTOGRAPHY_SOURCE.repository, revision: PHOTOGRAPHY_SOURCE.revision,
    method: 'Studio 原创方法改写；示例人物、肤色、身材与场景不作为默认设定',
    ruleVersion: PHOTOGRAPHY_METHOD_VERSION,
    sources: PHOTOGRAPHY_SOURCES.filter((item) => cases.includes(item.caseId)),
  },
  createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
}));

export function mergePhotographyModules(existing) {
  return [...existing, ...PHOTOGRAPHY_MODULES.filter((module) => !existing.some((item) => item.id === module.id)).map((module) => structuredClone(module))];
}
