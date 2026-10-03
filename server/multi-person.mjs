import { validateCharacterCard, normalizePhotographyPackDraft } from './domain.mjs';
import { nativeResolutionPrompt, PHOTO_EXECUTION_RULES } from '../lib/image-output-policy.mjs';
import { photographyNarrative } from '../lib/concise-prompts.mjs';

export const GROUP_LABELS = ['A', 'B', 'C', 'D'];
const OUTFIT_KEYS = new Set(['outfitLayers', 'colors', 'materials', 'accessories', 'footwear']);
const FIELD_LABELS = { hairstyle: '发型', hairAccessories: '发饰', iris: '瞳色', makeup: '妆容', bodySilhouette: '身体轮廓', outfitLayers: '服装层级', colors: '角色配色', materials: '材质', accessories: '配件', footwear: '鞋袜' };

export function validateGroupParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > 4)
    throw new Error('多人合影需要 2–4 位角色');
  const seen = new Set();
  for (const [index, person] of participants.entries()) {
    if (!person.jobId || !person.outputId) throw new Error(`角色 ${GROUP_LABELS[index]} 缺少单人源版本`);
    // One work represents one identity. Use different works, not two poses of one person.
    if (seen.has(person.jobId)) throw new Error('每位角色必须来自不同作品，不能重复使用同一人物');
    seen.add(person.jobId);
    if (person.adultConfirmed !== true) throw new Error(`请确认角色 ${GROUP_LABELS[index]} 明确成年；年龄不明时不能继续`);
    if (!String(person.position || '').trim() || String(person.position).length > 500)
      throw new Error(`请填写角色 ${GROUP_LABELS[index]} 的位置（最多 500 字符）`);
    if (person.wardrobe !== undefined && !['locked', 'swimwear'].includes(person.wardrobe))
      throw new Error('服装模式无效');
    if (person.wardrobe === 'swimwear' && person.outfitConfirmed !== true)
      throw new Error(`角色 ${GROUP_LABELS[index]} 的泳装转换需要单独确认`);
  }
  return true;
}

// Single source of truth for built-in input files, numbered prompts and web assets.
export function multiPersonAssets(group) {
  const sources = group.participants.map((person) => ({
    ...person.sourceImage, id: `${person.label}-source`, role: `participant_${person.label}_source`,
    purpose: `只提供角色 ${person.label}（${person.name}）的干净真人 COS 身份与锁定设计；不得分配给其他人物`,
  }));
  const details = group.participants.flatMap((person) => person.context.references.map((ref, index) => ({
    ...ref, id: `${person.label}-detail-${index + 1}`, role: `participant_${person.label}_${ref.role}`,
    purpose: `仅核对角色 ${person.label} 的${ref.role.startsWith('face_') ? '脸部身份' : '角色设计细节'}；干净源版本优先，不恢复已调整的旧设计，不作用于其他人`,
  })));
  return [...sources, ...(group.sceneReference ? [{ ...group.sceneReference, id: 'group-scene', role: 'group_scene', purpose: '仅参考共享场景、空间布局与光线；图中人物不提供身份、身体、服装或额外人数' }] : []), ...details];
}

export function compileMultiPersonPrompt({ group, pack, selections, aspectRatio, outputResolution }) {
  validateGroupParticipants(group.participants);
  for (const match of group.event.matchAll(/角色\s*([ABCD])/g)) {
    if (GROUP_LABELS.indexOf(match[1]) >= group.participants.length)
      throw new Error(`共同事件引用了未选择的角色 ${match[1]}`);
  }
  const normalized = normalizePhotographyPackDraft(pack);
  if (normalized.kind !== 'variable_pool') throw new Error('多人合影使用随机变量摄影包');
  const assets = multiPersonAssets(group);
  const people = group.participants.map((person, index) => {
    validateCharacterCard(person.context.characterCard);
    const card = Object.entries(person.context.characterCard)
      .filter(([key]) => person.wardrobe !== 'swimwear' || !OUTFIT_KEYS.has(key))
      .map(([key, field]) => `${FIELD_LABELS[key] || key}：${field.value}`).join('；');
    const outfit = person.wardrobe === 'swimwear'
      ? `已逐人授权泳装转换：仅将该角色服装转译为适合成年人的日常泳装；保留自己的配色、标志和可穿戴结构，不照搬其他人物的泳装。方向：${person.outfitDirection || '依据该角色原服装的轮廓与配色设计'}。只解锁服装、材质、配件和鞋袜。`
      : '服装锁定：严格保持此人源版本的服装层级、配色、材质、配件及鞋袜，方案包中的泳装建议对本人物不生效。';
    return `角色 ${person.label}（${person.name}）仅对应图 ${index + 1}；位置：${person.position}。\n身份以自己的真人源图为准，脸模仅固定五官，不固定身材；不与其他人平均、交换或融合脸部。\n保持项：${card}。\n${outfit}`;
  });
  return [
    `【任务】生成一张包含恰好 ${group.participants.length} 位明确成年人物的真人 COS 合影。所有人物处于同一真实空间、同一连续瞬间；单图不是单人，也不是拼图、横排角色展示或多个独立故事。`,
    `【本张唯一共同事件】${group.event}\n各人的表情、视线、重心和手势必须是对此事件的不同响应，不要求所有人看镜头。按已确认人数补足参与者的反应，不从变量文字新增任何人。`,
    photographyNarrative(selections, {}, { group: true }),
    `【共享摄影方案】${normalized.globalStyle}；同一场景光源与透视，人物前后层次、接触及遮挡合理；逐人保持项优先。`,
    `【唯一成像介质】${group.medium}\n只采用这一种相机介质，不混合胶片、CCD、手机等相互冲突的成像机制。皮肤、头发和织物按实际受光呈现细节；不新增雀斑、痘痘或统一美颜脸。水滴、湿发和湿衣只在事件确有因果时出现，不借此增加身体暴露。`,
    `【参考图编号与用途】\n${assets.map((ref, i) => `图 ${i + 1}：${ref.purpose}`).join('\n')}`,
    `【逐人身份与角色保持 · 最高优先级】\n${people.join('\n\n')}\n禁止串脸、串装、串发色、串瞳色、复制人物或合并身体；不改变各人年龄、肤色、身体身份和妆发，五官结构保持真人比例。`,
    `【目标画幅】${aspectRatio === 'source' ? '跟随角色 A 源图比例' : aspectRatio}；在目标画布原生构图，不后期裁切、拉伸或补边。${normalized.rules.candidOcclusion === 'full' ? '仅在已选构图要求时允许自然局部出画或轻微前景遮挡，但各人仍可辨认且肢体归属清楚。' : '保持所有人物清楚可辨，不自动裁去人物或增加遮挡。'}`,
    PHOTO_EXECUTION_RULES,
    `【安全与避免】这是有知情同意的日常度假摄影，不是偷拍、色情化构图、裸体或内衣窥视。不得把未成年或年龄不明角色自动改为成年人来继续本任务；发现年龄或授权不符合时停止并如实记录。不要新增摄影者身体或路人，画面人数恰好 ${group.participants.length}。不要网格、联系表、分镜、UI、日期或第三方署名。${normalized.avoid.join('；')}。`,
    nativeResolutionPrompt(outputResolution),
  ].join('\n\n');
}
