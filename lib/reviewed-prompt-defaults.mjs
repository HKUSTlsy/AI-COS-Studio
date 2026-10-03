// Studio-authored defaults reviewed against the official image-prompting guide.
// Only seed new entries; never rewrite user edits or historical snapshots.
import { CONCISE_PROMPT_DEFAULTS } from './concise-prompt-defaults.mjs';
export const REVIEWED_PROMPT_DEFAULTS = {
  "preset-01": {
    "normalizedText": "【目标表现】真人 COS 摄影，采用电影人像的克制高光过渡：面部受光侧到背光侧逐渐变暗，眼鼻口保留体积，背景明暗与主体有主次。\n【实现与边界】冷暖层次来自既定光源与环境反射，角色固有配色、妆面、姿态和场景不变；不另加雾、补光或发光轮廓。"
  },
  "preset-02": {
    "normalizedText": "【目标表现】真人时装摄影质感：在已确认灯光下保留颧面、鼻翼与下颌的明暗转折，衣料厚度、接缝和金属反光各自可辨。\n【实现与边界】皮肤与织物不使用同一种锐化和高光；身份、妆容、构图不变。仅当原布光包含轮廓光时保留，不追加灯光或广告式磨皮。"
  },
  "preset-03": {
    "normalizedText": "【目标表现】自然纪实人像。\n【实现与边界】保留现场曝光与明暗关系，焦点落在人物所在距离，衣料在接触处形成合理褶皱；背景细节随既定景深递减。只有已选胶片成像才加入克制颗粒，不因纪实风格更换动作、构图或场景。"
  },
  "preset-04": {
    "normalizedText": "【目标表现】平视中景，完整头顶至腰部附近入画，面部位于上半部，保留正在互动的双手和已有道具；必要时稍放宽下边界。\n【实现与边界】采用约 85mm 人像镜头的自然透视感，以拍摄距离实现取景；焦段不代表实际设备参数，不改变人物五官或身材。"
  },
  "preset-05": {
    "normalizedText": "【目标表现】三分之四侧向的全身构图，摄影机位于腰部附近。\n【实现与边界】完整头顶至鞋底入画，上方留少量空间；以拍摄距离实现取景，不通过拉长四肢表现全身。三分之四指人物朝向而非裁掉四分之一身体；保持人物身份、所选动作、服装与场景。",
    "name": "三分之四侧向全身"
  },
  "preset-06": {
    "normalizedText": "【目标表现】A real full-body portrait from a subtly low camera position.\n【实现与边界】Include the top of the head and both feet, with the camera looking gently upward rather than from ground level. Keep natural facial perspective and believable limb lengths; convey presence through framing, not an enlarged head or stretched legs. Preserve the selected pose, outfit and setting."
  },
  "preset-07": {
    "normalizedText": "【目标表现】安静月下庭院，环境以冷月光为主。\n【实现与边界】仅在镜头/光线调整时采用庭院已有灯光形成较弱暖色边缘反射；仅改背景时保持人物原有受光，不额外新增灯具。"
  },
  "preset-08": {
    "normalizedText": "【目标表现】深炭灰无缝影棚背景。\n【实现与边界】若本轮允许调整灯光，以大柔光箱为主光、较弱轮廓光为辅；仅改背景时不重新照亮人物。"
  },
  "preset-09": {
    "normalizedText": "【目标表现】安静窗边晨光场景。\n【实现与边界】若本轮允许改灯光，窗光为主、已有浅色墙面反射为弱辅光，保留面部明暗梯度；仅改背景时不覆盖人物原有受光。"
  },
  "preset-10": {
    "normalizedText": "【目标表现】由当前角色的站姿方向形成重心稳定、关节放松的站立动作。\n【实现与边界】双手自然并保持解剖正确；仅与现有道具互动，不强制放下角色原有手持物。"
  },
  "preset-11": {
    "normalizedText": "【目标表现】A subtle over-the-shoulder glance toward the camera: the torso remains turned slightly away, the head turns back gently, and the eyes meet the camera without forcing the neck.\n【实现与边界】Shoulders remain relaxed and the spine follows the torso naturally. Keep existing hand-held objects and clothing; change only the pose and its natural expression response."
  },
  "preset-12": {
    "normalizedText": "【目标表现】An action-ready pause before movement: one foot slightly forward, knees softly flexed, weight supported by both feet, and the gaze directed toward the intended movement.\n【实现与边界】Keep the costume silhouette readable and any existing hand-held object securely held. Do not add a weapon or prop; preserve facial identity, clothing design and setting."
  },
  "realism-natural-v1": {
    "normalizedText": "【目标表现】真实相机拍摄的真人 COS 照片。\n【实现与边界】依照当前取景保留自然透视，面部关键形体在所在焦平面内清楚，离开焦点的细节逐渐减弱；近景看得到适量妆面和唇纹，全身照先保证五官形体可信。保持原场景、机位、光源和人物身份，不额外添加磨皮、影棚补光、强散景或颗粒。"
  },
  "realism-phone-v1": {
    "normalizedText": "【目标表现】真实的手机生活照片：沿用当前机位、构图与现场曝光，面部保留自然眼睑、鼻翼和唇部边界，背景在既定景深内可读。\n【实现与边界】静止面部保持清楚；只在正在运动的部位或实际弱光条件下出现轻微运动痕迹、噪点。保留身份、妆造和动作，不启用大眼瘦脸、美颜磨皮或额外棚拍光。"
  },
  "realism-low-light-v1": {
    "normalizedText": "【目标表现】当既定场景为弱光时，采用弱光现场成像：保留合理暗部、渐进的细节损失和克制暗部噪点，高光不过度提亮；冷暖色偏须对应现场已有光源。\n【实现与边界】不为照清整张脸额外补光，不新增手机、蜡烛或灯具。若原场景明亮，保留原曝光与光照，不擅自变成夜景。"
  },
  "realism-digicam-v1": {
    "normalizedText": "【目标表现】早期便携数码相机的成像外观。\n【实现与边界】保留有限动态范围、轻微数字颗粒和压缩痕迹，面部所在焦平面内眼睑、鼻翼与唇缘仍可辨；只在已指定直闪时表现直闪高光，运动拖影须有动作依据。旧相机质感在工作台目标像素画布上原生呈现，不要求低分辨率文件，不进行缩小再放大，不加日期印章、胶片划痕或新场景。"
  },
  "photography-face-light-v2": {
    "normalizedText": "【目标表现】把当前人物拍成真实 COS 肖像：眼睑包覆眼球，鼻翼与唇部有连续体积，面颊到下颌的明暗随既定光线渐变。\n【实现与边界】近景保留细微妆面和唇纹，全身照以可辨的五官结构为主；眼部反光服从光源，虹膜不是发光宝石。保持脸模身份、肤色、原妆和瞳色，不放大眼球、重塑鼻口、增加皮肤标记或全脸统一磨皮。"
  },
  "photography-onsite-v2": {
    "normalizedText": "【目标表现】忠于已选现场光照与构图，焦点、动态范围和局部清晰度有拍摄原因。\n【实现与边界】暗部可保留细节衰减，人物身份仍清楚；只有弱光或运动条件确实存在时才有克制噪点或局部运动痕迹。不另加补光、道具、模糊或夸张鱼眼，不擅改动作。"
  },
  "photography-window-v2": {
    "normalizedText": "【目标表现】本轮获准改变光照时，以侧方窗光为主要照明：靠窗与背光面有连续曝光落差，眼部反光和材质高光方向一致；不过度抬亮暗面。\n【实现与边界】不添加第二套商业轮廓光，不改变脸部身份。若本轮仅调整背景，窗景不得自动改写人物原有受光。"
  },
  "photography-mixed-light-v2": {
    "normalizedText": "【目标表现】本轮获准改变照明时，明确已有光源的冷暖、方向与覆盖范围，让皮肤、金属、织物的局部色偏对应其受光，不把整张照片统一染色。\n【实现与边界】保留实际亮暗关系，不自动补光或新增发光道具。若仅改变背景，保留人物原有照明。"
  },
  "photography-event-v2": {
    "normalizedText": "【目标表现】只表现本轮已选动作的一个连贯瞬间。\n【实现与边界】若有互动对象，视线落在该对象上，手指顺着已有物体的形状自然接触或握持，头颈、肩膀与重心配合；若已指定看镜头或别处，遵从该视线。表情只作轻微自然响应；没有对象时不新增道具，不改变身份、服装或场景。"
  },
  "photography-makeup-v2": {
    "normalizedText": "【目标表现】只改变本轮指定妆面：粉底顺应原有皮肤起伏，眼影沿原眼睑铺陈，唇妆沿原唇缘并回应既定光线。\n【实现与边界】修改区域之外保留原有饱和度、反差、皮肤细节、光照与背景；脸型、眼距、鼻口结构和肤色不变，不顺带卸掉其他妆容、增加雀斑或重塑五官。"
  },
  "photography-hair-v2": {
    "normalizedText": "【目标表现】只处理本轮指定发型或发饰：发根、分束、交叠与重力方向合理，发饰具有可行的固定位置与接触阴影。\n【实现与边界】身份、脸型、眼距、妆面和身体保持不变；不改变未被指定的头发颜色或配件设计，不新增随风飘动。"
  },
  "photography-fabric-v2": {
    "normalizedText": "【目标表现】在本轮允许的服装范围内建立真实厚度、接缝、垂坠与接触褶皱，刺绣、织物、金属与皮革分别回应既定光线。\n【实现与边界】衣料随当前姿态承重，不用塑料反光替代全部材质；不借材质细化改变未授权的层级、配色、身体比例或裸露程度。"
  }
};

export function reviewedPromptDefault(entry) {
  const changes = REVIEWED_PROMPT_DEFAULTS[entry.id];
  return changes ? { ...entry, ...changes, normalizedText: CONCISE_PROMPT_DEFAULTS[entry.id] || changes.normalizedText } : entry;
}
