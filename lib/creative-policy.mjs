// A creative run's permissions are independent of a photography pack's defaults.
export function creativePolicy(input = {}) {
  const mode = input.mode ?? (input.allowOutfit ? 'character' : 'original');
  if (!['original', 'character'].includes(mode)) throw new Error('创作方式无效');
  const outfitSource = input.outfitSource ?? 'template';
  if (!['template', 'text', 'reference'].includes(outfitSource)) throw new Error('服装来源无效');
  const propPolicy = input.propPolicy ?? 'preserve';
  if (!['preserve', 'free'].includes(propPolicy)) throw new Error('角色道具选项无效');
  const outfitDirection = String(input.outfitDirection ?? '');
  if (outfitDirection.length > 3000) throw new Error('服装要求最多 3,000 字符');
  return { mode, outfitSource: mode === 'original' ? 'template' : outfitSource, outfitDirection: mode === 'original' ? '' : outfitDirection, propPolicy };
}

export function creativeSourcePurpose(policy) {
  return policy?.mode === 'character'
    ? '干净源图仅固定同一人物身份、身体身份、发色、发型、发饰、瞳色和标志性妆容；不提供本轮服装、鞋袜或服装配件，不锁定原姿态、构图、背景'
    : '干净源图固定同一人物身份与角色妆发、服装；不锁定原姿态、构图或背景';
}

// Scope known legacy wardrobe locks to the NEW approved wardrobe. Never mutate
// source records or remove identity/safety clauses wholesale.
export function scopeCreativeText(text, policy = {}) {
  if (policy.mode !== 'character') return String(text || '');
  return String(text || '')
    .replace(/不重染角色服装/g, '服装配色采用本轮已确认方案')
    .replace(/服装结构偷换/g, '偏离本轮已确认服装方案')
    .replace(/原(?:COS\s*)?服装|源图(?:中|中的)?(?:服装|衣服)/g, '本轮已确认服装')
    .replace(/不得改变角色身份、肤色、妆造和服装设计/g, '不得改变人物身份、肤色、妆造；服装按本轮已确认方案')
    .replace(/不另换姿态、服装结构或道具/g, '不偏离本轮已确认的动作、服装与道具方案');
}

export function wardrobePrompt(policy, templateDirection = '') {
  if (policy.mode !== 'character') return '【服装锁定】原装重拍：保持源图中的服装层级、配色、材质、服装配件及鞋袜；模板或参考图的其他服装不生效。';
  const direction = policy.outfitSource === 'reference'
    ? `按专门标记的服装参考图采用服装的结构、配色、材质和穿搭；图中人物不提供脸、身体、妆发或姿态。${policy.outfitDirection}`
    : policy.outfitSource === 'text' ? policy.outfitDirection : templateDirection;
  return `【角色演绎 · 已授权换装】本轮服装方向：${direction || '按本轮完整摄影方案确定合适服装；未指定时保留源图服装，不凭空增加要求'}。允许服装层级、配色、材质、服装配件及鞋袜改变；源图旧服装不构成锁定。不改变脸部和身体身份、发色、发型、头部发饰、瞳色或标志性妆容；头部发饰不属于可更换的服装配件。`;
}

export function propPrompt(policy) {
  return policy.propPolicy === 'free'
    ? '【角色道具】不要求携带原角色武器或手持道具；道具及持握方式服从本轮摄影方案，头部发饰与身份特征继续锁定。'
    : '【角色道具】保留角色原有标志性道具的设计；可按本轮动作改变其位置和持握方式，不锁定原图手势。';
}
