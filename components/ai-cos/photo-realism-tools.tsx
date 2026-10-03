'use client';

import { useId } from 'react';
import { detectPhotoConflicts, isRealismPreset } from '@/lib/photo-realism.mjs';
import { Button } from '@/components/ui/button';
import type { PromptModule } from '@/lib/ai-cos-types';
import { PHOTOGRAPHY_METHOD_VERSION, PHOTOGRAPHY_SOURCE, PHOTOGRAPHY_SOURCES, PHOTOGRAPHY_STAGE_NOTES } from '@/lib/photography-methods.mjs';
import { IMAGE_PROMPT_GUIDE_VERSION } from '@/lib/image-output-policy.mjs';

export function PhotographyMethodNotice({ stage }: { stage: keyof typeof PHOTOGRAPHY_STAGE_NOTES }) {
  return <details className="version-details">
    <summary>新 Prompt 已接入分阶段摄影规则</summary>
    <p className="text-sm">{PHOTOGRAPHY_STAGE_NOTES[stage]}</p>
    <p className="text-sm">已按 <a className="underline" href="https://developers.openai.com/api/docs/guides/image-prompting" target="_blank" rel="noreferrer">OpenAI 官方提示词指南</a>补充参考用途、可见摄影关系与局部编辑边界。尺寸与颗粒、柔焦等风格分开；只有导回文件才代表实际像素。<small className="block text-muted-foreground">{IMAGE_PROMPT_GUIDE_VERSION}</small></p>
    <p className="text-sm text-muted-foreground">{PHOTOGRAPHY_METHOD_VERSION} · 只影响新编译的 Prompt，已有图片、草稿和交接保持原样。不需要额外勾选；细分方法可从 Prompt 库选择。实际效果仍需看生成结果，不保证消除 AI 感。</p>
  </details>;
}

export function PhotographySourceDetails({ module }: { module: PromptModule }) {
  const provenance = module.provenance;
  if (!provenance) return null;
  return <details className="version-details"><summary>摄影方法来源与使用边界</summary>
    <p className="text-sm">{provenance.method}</p>
    {provenance.sources?.map((source) => <p className="text-sm" key={source.caseId}><a className="underline" href={source.url} target="_blank" rel="noreferrer">案例 {source.caseId} · {source.title}</a>：{source.adaptation}</p>)}
    <p className="text-sm text-muted-foreground">{provenance.ruleVersion || '历史预设'} · 来源仅用于方法追溯，不代表示例人物授权或生成效果保证。</p>
  </details>;
}

export function PhotographyLibraryGuide({ onShowModules }: { onShowModules: () => void }) {
  return <div className="studio-card space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><b>真人摄影方法</b><p className="text-sm text-muted-foreground">基础规则自动应用；8 个分项模块按需选用，原有模块继续保留。</p></div><Button variant="outline" onClick={onShowModules}>查看摄影方法模块</Button></div>
    <details className="version-details"><summary>四个阶段怎么使用 · 研究来源与排除项</summary>
      {Object.entries(PHOTOGRAPHY_STAGE_NOTES).map(([stage, note]) => <p className="text-sm" key={stage}>{note}</p>)}
      <p className="text-sm">基准生成可选“自然面部与妆面成像”或“现场纪实成像”；创意重拍在“成像预设”选择。其他模块在单项调整的对应分类中选择。你仍可编辑、归档或完全不用这些预设。</p>
      <p className="text-sm">只借鉴摄影关系，不导入默认人物、肤色、身材、示例服装或道具，也不采用“动漫风真人脸”、无瑕陶瓷皮肤或盲目堆叠 8K 等描述。</p>
      {PHOTOGRAPHY_SOURCES.map((source) => <p key={source.caseId} className="text-sm"><a className="underline" href={source.url} target="_blank" rel="noreferrer">案例 {source.caseId} · {source.title}</a>：{source.adaptation}</p>)}
      <p className="text-sm text-muted-foreground">原创改写 · {PHOTOGRAPHY_METHOD_VERSION} · 核对日期 {PHOTOGRAPHY_SOURCE.reviewedAt} · 未复制第三方图片或完整 Prompt，未自动同步上游。</p>
    </details>
  </div>;
}

export function PhotoConflictNotice({ text }: { text: string }) {
  const warnings = detectPhotoConflicts(text);
  if (!warnings.length) return null;
  return (
    <aside className="photo-conflicts" aria-label="摄影提示词冲突提示" aria-live="polite">
      <b>有 {warnings.length} 处可能的摄影冲突</b>
      <p>仅作规则提示，不会修改 Prompt，也不阻止继续。请按你的创作意图核对。</p>
      {warnings.map((warning) => (
        <details key={warning.id}>
          <summary>{warning.message}</summary>
          <ul>{warning.evidence.map((line: string, index: number) => <li key={index}>{line}</li>)}</ul>
        </details>
      ))}
    </aside>
  );
}

export function RealismStyleSelector({ prompts, value, snapshot, disabled, onChange }: {
  prompts: PromptModule[];
  value: string;
  snapshot?: PromptModule | null;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const styles = prompts.filter((item) => item.category === 'style' && isRealismPreset(item.id) && !item.archivedAt);
  const options = snapshot ? [snapshot, ...styles.filter((item) => item.id !== snapshot.id)] : styles;
  const selected = options.find((item) => item.id === value);
  return (
    <div className="space-y-2">
      <label className="field-label" htmlFor={id}>成像预设（可选）</label>
      <select id={id} className="native-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-hint`}>
        <option value="">沿用摄影方案 · 不叠加预设</option>
        {options.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
      </select>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">成像预设不替换脸模、妆造或场景；方案中的光照与锁定项优先。可到 Prompt 库编辑。</p>
      {selected && <details className="version-details"><summary>查看成像预设内容</summary><p className="text-sm">{selected.normalizedText}</p></details>}
      {selected && <PhotographySourceDetails module={selected} />}
    </div>
  );
}
