export const MAX_FULL_PROMPT = 30000;

// Patches reference exact, unambiguous source spans. Unchanged bytes, language,
// order, and photographic relationships are retained by construction.
export function applyPromptPatches(source, patches) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_FULL_PROMPT) throw new Error('完整 Prompt 必须为 1–30,000 字符');
  if (!Array.isArray(patches) || patches.length > 60) throw new Error('适配修改最多 60 项');
  const ranges = patches.map((patch, index) => {
    if (!patch || typeof patch.before !== 'string' || !patch.before || typeof patch.after !== 'string' || patch.after.length > 10000 || typeof patch.reason !== 'string' || !patch.reason.trim() || patch.reason.length > 1000) throw new Error(`第 ${index + 1} 项需要准确原文、替换内容和修改原因`);
    const start = source.indexOf(patch.before);
    if (start < 0 || source.indexOf(patch.before, start + 1) >= 0) throw new Error(`第 ${index + 1} 项原文缺失或重复，请增加上下文以唯一定位`);
    return { ...patch, start, end: start + patch.before.length, included: patch.included !== false };
  }).sort((a, b) => a.start - b.start);
  if (ranges.some((patch, index) => index > 0 && patch.start < ranges[index - 1].end)) throw new Error('适配修改不可重叠');
  let cursor = 0;
  let text = '';
  for (const patch of ranges) {
    text += source.slice(cursor, patch.start) + (patch.included ? patch.after : patch.before);
    cursor = patch.end;
  }
  text += source.slice(cursor);
  if (!text.trim() || text.length > 50000) throw new Error('适配后的 Prompt 为空或超过 50,000 字符');
  return text;
}

export function normalizeAdaptation(source, input) {
  const patches = input?.patches;
  const adaptedText = applyPromptPatches(source, patches);
  if (input.warnings !== undefined && (!Array.isArray(input.warnings) || input.warnings.length > 20 || input.warnings.some((s) => typeof s !== 'string' || s.length > 1000))) throw new Error('适配提示格式无效');
  return { patches: patches.map(({ before, after, reason, included }) => ({ before, after, reason, included: included !== false })), adaptedText, warnings: input.warnings || [] };
}
