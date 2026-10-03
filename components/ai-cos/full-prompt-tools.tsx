'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control */
import { useEffect, useState, type ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, assetUrl, fileToDataUrl } from '@/lib/ai-cos-api';
import { useLocalDraft } from '@/hooks/use-local-draft';
import { useUploadGuard } from './workspace-tools';
import { OutputDimensions, OutputResolutionNotice } from './output-resolution';
import { applyPromptPatches } from '@/lib/prompt-adaptation.mjs';
import { faceReviewState } from '@/lib/baseline-face.mjs';
import type { AspectRatio, BootstrapData, CreativePolicy, CreativeReshootBatch, ExecutionRun, FullPrompt, GenerationBackend, GenerationJob, PromptPatch } from '@/lib/ai-cos-types';

type Mutate = (action: () => Promise<unknown>, success: string) => Promise<void>;
type Output = GenerationJob['baselineVersions'][number] | GenerationJob['adjustmentVersions'][number] | GenerationJob['reshootVersions'][number];
export const initialCreativePolicy: CreativePolicy = { mode: 'original', outfitSource: 'template', outfitDirection: '', propPolicy: 'preserve' };

export function CreativeWardrobeControls({ value, onChange, adultConfirmed, onAdultChange, reference, onReferenceChange, savedReference, disabled = false }: {
  value: CreativePolicy; onChange: (value: CreativePolicy) => void;
  adultConfirmed: boolean; onAdultChange: (value: boolean) => void;
  reference: string; onReferenceChange: (value: string) => void;
  savedReference?: string; disabled?: boolean;
}) {
  const [error, setError] = useState('');
  useUploadGuard(Boolean(reference) && !disabled);
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-white/10 p-4">
    <legend className="px-2 text-sm font-semibold">角色与服装</legend>
    <label className="field-label">创作方式<select className="native-select" value={value.mode} onChange={(e) => { onChange({ ...value, mode: e.target.value as CreativePolicy['mode'], outfitSource: 'template', outfitDirection: '' }); onReferenceChange(''); onAdultChange(false); }}>
      <option value="original">原装重拍 · 保留 COS 服装</option><option value="character">角色演绎 · 保留角色妆发，自由换装</option>
    </select></label>
    <p className="text-sm text-muted-foreground">脸部与身体身份、发色、发型、头部发饰、瞳色和标志性妆容始终保留；表情、动作与摄影按本次方案。</p>
    {value.mode === 'character' && <>
      <label className="field-label">服装来源<select className="native-select" value={value.outfitSource} onChange={(e) => { onChange({ ...value, outfitSource: e.target.value as CreativePolicy['outfitSource'] }); onReferenceChange(''); }}>
        <option value="template">采用完整 Prompt / 摄影方案中的服装</option><option value="text">我来描述服装</option><option value="reference">参考服装图片</option>
      </select></label>
      {value.outfitSource !== 'template' && <label className="field-label">{value.outfitSource === 'text' ? '服装要求（必填）' : '服装补充要求（可选）'}<Textarea maxLength={3000} value={value.outfitDirection} onChange={(e) => onChange({ ...value, outfitDirection: e.target.value })} placeholder="例如白衬衫与牛仔裤；不改变发型、发饰和妆容" /></label>}
      {value.outfitSource === 'reference' && <div className="space-y-2"><label className="field-label">服装参考 · PNG/JPG/WEBP，最大 20 MB<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void fileToDataUrl(file).then((data) => { onReferenceChange(data); setError(''); }).catch((err) => setError(String(err.message))); }} /></label>
        {(reference || savedReference) && <><img src={reference || savedReference} className="max-h-52 w-full rounded-lg object-contain" alt="仅用于服装的参考图" /><Button variant="outline" type="button" onClick={() => onReferenceChange('')}>移除参考图</Button></>}
        <p className="text-sm text-muted-foreground">只借鉴穿搭，不借用参考人物的脸、身材、妆发或姿态。</p>
      </div>}
      <label className="consent-row consent-warning"><Checkbox checked={adultConfirmed} onCheckedChange={(v) => onAdultChange(v === true)} /><span>我确认角色明确成年，并授权本次服装、配色、材质、服装配件和鞋袜变化。</span></label>
    </>}
    <label className="field-label">角色手持道具<select className="native-select" value={value.propPolicy} onChange={(e) => onChange({ ...value, propPolicy: e.target.value as CreativePolicy['propPolicy'] })}>
      <option value="preserve">保留原角色标志性道具</option><option value="free">按摄影方案，不强制携带原道具</option>
    </select></label>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </fieldset>;
}

export function FullPromptLibrary({ data, mutate, showModules, showPacks }: { data: BootstrapData; mutate: Mutate; showModules: () => void; showPacks: () => void }) {
  const [form, setForm] = useLocalDraft<{ id?: string; version?: number; name: string; rawText: string; sourceUrl: string }>('full-prompt-library-form', { name: '', rawText: '', sourceUrl: '' });
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const work = async (action: () => Promise<unknown>, message: string) => { setBusy(true); try { await mutate(action, message); } finally { setBusy(false); } };
  const items = (data.fullPrompts || []).filter((item) => `${item.name} ${item.rawText}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-5">
    <Card className="studio-card"><CardHeader><CardTitle>{form.id ? '编辑收藏 · 保存为新版本' : '收藏完整 Prompt'}</CardTitle><CardDescription>原文整段保存，不调用 Codex、不拆分、不自动优化。使用时再确认角色适配。</CardDescription></CardHeader><CardContent className="space-y-4">
      <label className="field-label">名称<Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field-label">完整原文<Textarea className="min-h-56" value={form.rawText} maxLength={30000} onChange={(e) => setForm({ ...form, rawText: e.target.value })} placeholder="将喜欢的摄影 Prompt 整段粘贴到这里，原文的语言、段落和配合关系都会保留。" /></label>
      <label className="field-label">来源链接（可选，只记录，不访问）<Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></label>
      <div className="flex gap-3"><Button disabled={busy || !form.name.trim() || !form.rawText.trim()} onClick={() => void work(async () => { await api.saveFullPrompt(form); setForm({ name: '', rawText: '', sourceUrl: '' }); }, '完整 Prompt 已收藏，原文未拆分')}>{form.id ? '保存新版本' : '原文收藏'}</Button>{form.id && <Button variant="outline" onClick={() => setForm({ name: '', rawText: '', sourceUrl: '' })}>取消编辑</Button>}</div>
    </CardContent></Card>
    <Input aria-label="搜索完整 Prompt" placeholder="搜索收藏名称或原文…" value={query} onChange={(e) => setQuery(e.target.value)} />
    <div className="grid gap-4 lg:grid-cols-2">{items.map((item) => <Card className="studio-card" key={item.id}><CardHeader><CardTitle>{item.name} · v{item.version}</CardTitle><CardDescription>在第 4 步“完整 Prompt”中选择使用</CardDescription></CardHeader><CardContent className="space-y-3">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{item.rawText}</pre>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setForm({ id: item.id, version: item.version, name: item.name, rawText: item.rawText, sourceUrl: item.sourceUrl })}>编辑为新版本</Button>
      <Button variant="outline" disabled={busy} onClick={() => void work(async () => { await api.createPromptImport({ title: item.name, rawText: item.rawText }); showModules(); }, '已另建模块拆分草稿，完整收藏保持不变')}>另存为模块</Button>
      <Button variant="outline" disabled={busy} onClick={() => void work(async () => { await api.createPhotographyPackImport({ title: item.name, rawText: item.rawText, packKind: 'variable_pool', sourceType: 'paste' }); showPacks(); }, '已另建随机方案包解析，完整收藏保持不变')}>提取随机方案包</Button></div>
      <details className="version-details"><summary>最初原文、来源与旧版本</summary><pre>{item.originalText}</pre><p>{item.sourceUrl || '本地粘贴'}</p>{item.versions?.map((version) => <details key={version.version}><summary>v{version.version} · {version.name}</summary><pre>{version.rawText}</pre></details>)}</details>
    </CardContent></Card>)}</div>
    {!items.length && <p className="text-sm text-muted-foreground">还没有匹配的完整 Prompt；模块和摄影方案包仍保留在各自标签页。</p>}
    {Boolean(data.promptImports?.length) && <details className="version-details"><summary>从旧拆分记录找回完整原文</summary><div className="space-y-3 p-3">{data.promptImports.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3"><span>{item.title}</span><Button variant="outline" disabled={busy} onClick={() => void work(() => api.saveFullPrompt({ name: item.title, rawText: item.rawText }), '旧记录原文已另存为完整收藏，原模块未改变')}>另存为完整收藏</Button></div>)}</div></details>}
  </div>;
}

function AdaptationEditor({ job, batch, mutate, disabled }: { job: GenerationJob; batch: CreativeReshootBatch; mutate: Mutate; disabled: boolean }) {
  const [patches, setPatches] = useLocalDraft<PromptPatch[]>(`full-adaptation:${batch.id}:${batch.runId}`, batch.adaptationDraft?.patches || []);
  const original = batch.templateSnapshot?.rawText || '';
  let adapted = '';
  let error = '';
  try { adapted = applyPromptPatches(original, patches); } catch (err) { error = err instanceof Error ? err.message : '适配修改无效'; }
  const change = (index: number, patch: Partial<PromptPatch>) => setPatches(patches.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const body = { patches, warnings: batch.adaptationDraft?.warnings || [] };
  return <Card className="studio-card"><CardHeader><CardTitle>确认角色适配</CardTitle><CardDescription>只替换冲突片段，其他原文字句不变。可以修改替换内容、取消单项修改或补充修改。</CardDescription></CardHeader><CardContent className="space-y-5">
    <div className="grid gap-4 lg:grid-cols-2"><div><h3>完整原文 · 不覆盖</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{original}</pre></div><div><h3>适配后预览</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{adapted}</pre></div></div>
    {patches.map((patch, index) => <fieldset key={index} disabled={disabled} className="space-y-3 rounded-xl border border-white/10 p-4"><label className="consent-row"><Checkbox checked={patch.included} onCheckedChange={(v) => change(index, { included: v === true })} /><span>采用修改 {index + 1}</span></label><label className="field-label">原文中的准确片段<Textarea value={patch.before} onChange={(e) => change(index, { before: e.target.value })} /></label><label className="field-label">替换为（可留空删除该片段）<Textarea value={patch.after} onChange={(e) => change(index, { after: e.target.value })} /></label><label className="field-label">修改原因<Input value={patch.reason} onChange={(e) => change(index, { reason: e.target.value })} /></label><Button variant="outline" onClick={() => setPatches(patches.filter((_, i) => i !== index))}>移除此项</Button></fieldset>)}
    {!patches.length && <p>没有提出文字替换。确认后仍会加上你选择的角色保持项和服装规则。</p>}
    {body.warnings.map((warning, index) => <p className="soft-warning" key={index}>{warning}</p>)}
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={disabled || patches.length >= 60} onClick={() => setPatches([...patches, { before: '', after: '', reason: '用户手动调整', included: true }])}>补充修改</Button><Button variant="outline" disabled={disabled || Boolean(error)} onClick={() => void mutate(() => api.editFullPromptAdaptation(job.id, batch.id, body), '适配草稿已保存，原文未改变')}>保存草稿</Button><Button disabled={disabled || Boolean(error)} onClick={() => void mutate(() => api.editFullPromptAdaptation(job.id, batch.id, body, true), '适配已确认，完整生图 Prompt 已准备，尚未生图')}>确认适配，准备完整 Prompt</Button></div>
  </CardContent></Card>;
}

export function FullPromptReshootPanel({ job, templates, mutate, renderRun, renderFace }: {
  job: GenerationJob; templates: FullPrompt[]; mutate: Mutate;
  renderRun: (run: ExecutionRun) => ReactNode; renderFace: (source: Output) => ReactNode;
}) {
  const outputs = [...job.baselineVersions, ...job.adjustmentVersions, ...job.reshootVersions.filter((image) => image.mode !== 'multi_person')];
  const [sourceId, setSourceId] = useState(job.selectedOutputId || outputs.at(-1)?.id || '');
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  const [policy, setPolicy] = useState<CreativePolicy>(initialCreativePolicy);
  const [adult, setAdult] = useState(false);
  const [reference, setReference] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('source');
  const [backend, setBackend] = useState<GenerationBackend>('built-in-imagegen');
  useEffect(() => {
    const saved = window.localStorage.getItem('ai-cos-generation-backend');
    if (saved === 'built-in-imagegen' || saved === 'chatgpt-web-manual') queueMicrotask(() => setBackend(saved));
  }, []);
  const [busy, setBusy] = useState(false);
  const [prompts, setPrompts] = useLocalDraft<Record<string, string>>(`full-reshoot-prompts:${job.id}`, {});
  const batch = job.reshootBatches.find((item) => item.id === job.activeReshootBatchId && item.mode === 'full_prompt');
  const active = job.executionRuns.find((run) => run.id === job.activeRunId);
  const source = batch?.sourceImage || outputs.find((item) => item.id === sourceId) || outputs.at(-1);
  const frozen = Boolean(batch);
  const work: Mutate = async (action, message) => { setBusy(true); try { await mutate(action, message); } finally { setBusy(false); } };
  const selectedTemplate = templates.find((item) => item.id === templateId) || templates[0];
  if (!source) return <p>请先生成并确认一张单人基准图。</p>;
  const blocked = busy || Boolean(active);
  return <div className="space-y-5">
    <Card className="studio-card"><CardHeader><CardTitle>完整 Prompt 创作</CardTitle><CardDescription>整套使用摄影创意，不拆分成模块。先检查角色适配，再确认生成一张图片。</CardDescription></CardHeader><CardContent className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-3"><label className="field-label">人物源版本<select disabled={blocked || frozen} className="native-select" value={source.id} onChange={(e) => setSourceId(e.target.value)}>{outputs.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><img src={assetUrl(source.url)} className="max-h-96 w-full rounded-xl object-contain" alt="完整 Prompt 创作的人物源图" />{renderFace(source)}</div>
      <div className="space-y-4"><label className="field-label">完整 Prompt 收藏<select className="native-select" disabled={blocked || frozen} value={batch?.templateSnapshot?.id || selectedTemplate?.id || ''} onChange={(e) => setTemplateId(e.target.value)}>{(batch?.templateSnapshot ? [batch.templateSnapshot] : templates).map((item) => <option value={item.id} key={item.id}>{item.name} · v{item.version}</option>)}</select></label>
        {!selectedTemplate && !batch && <p className="soft-warning">请先到 Prompt 库的“完整 Prompt”收藏一段原文。</p>}
        <CreativeWardrobeControls value={batch?.creativePolicy || policy} onChange={setPolicy} adultConfirmed={batch?.adultConfirmed ?? adult} onAdultChange={setAdult} reference={reference} onReferenceChange={setReference} savedReference={assetUrl(batch?.outfitReference?.url)} disabled={blocked || frozen} />
        <label className="field-label">目标画幅<select className="native-select" disabled={blocked || frozen} value={batch?.aspectRatio || aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}>{['source', '1:1', '4:3', '3:4', '16:9', '9:16'].map((ratio) => <option value={ratio} key={ratio}>{ratio === 'source' ? '跟随源图' : ratio}</option>)}</select></label>
        <OutputResolutionNotice aspectRatio={batch?.aspectRatio || aspectRatio} source={source} saved={batch?.outputResolution} />
        {!batch && <Button disabled={blocked || !selectedTemplate || faceReviewState(job, source).blocked || (policy.mode === 'character' && (!adult || (policy.outfitSource === 'text' && !policy.outfitDirection.trim()) || (policy.outfitSource === 'reference' && !reference)))} onClick={() => void work(() => api.createFullPromptReshoot(job.id, { templateId: selectedTemplate?.id, templateVersion: selectedTemplate?.version, sourceOutputId: source.id, creativePolicy: policy, adultConfirmed: adult, outfitReferenceDataUrl: reference || undefined, aspectRatio }), '已排队检查角色适配，不会自动生图')}>检查并适配角色（不生图）</Button>}
        {batch && !active && <Button variant="outline" disabled={busy} onClick={() => void work(() => api.discardReshoot(job.id, batch.id), '旧适配与历史已保留，可以修改配置')}>返回配置，重新准备</Button>}
      </div>
    </CardContent></Card>
    {active && batch?.runId === active.id && renderRun(active)}
    {batch?.status === 'plan_ready' && batch.adaptationDraft && <AdaptationEditor key={`${batch.id}:${batch.runId}`} job={job} batch={batch} mutate={work} disabled={blocked} />}
    {batch?.status === 'draft' && <Card className="studio-card"><CardHeader><CardTitle>确认完整生图 Prompt</CardTitle><CardDescription>角色适配已经确认。以下是实际交给生成工具的完整内容，包含角色保持项与本轮服装规则。</CardDescription></CardHeader><CardContent className="space-y-4">
      {batch.variants.map((variant) => <label className="field-label" key={variant.id}>完整 Prompt<Textarea className="min-h-80" maxLength={80000} disabled={blocked} value={prompts[variant.id] ?? variant.compiledPrompt} onChange={(e) => setPrompts({ ...prompts, [variant.id]: e.target.value })} /></label>)}
      <label className="field-label">生成方式<select className="native-select" disabled={blocked} value={backend} onChange={(e) => { setBackend(e.target.value as GenerationBackend); window.localStorage.setItem('ai-cos-generation-backend', e.target.value); }}><option value="built-in-imagegen">Codex 内置生成</option><option value="chatgpt-web-manual">ChatGPT 网页交接</option></select></label>
      <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={blocked} onClick={() => void work(() => api.discardReshoot(job.id, batch.id, true), '已返回角色适配，旧生图草稿保留')}>返回修改适配</Button><Button disabled={blocked || faceReviewState(job, source).blocked} onClick={() => void work(async () => { await api.updateReshootDraft(job.id, batch.id, { variants: batch.variants.map((v) => ({ id: v.id, compiledPrompt: prompts[v.id] ?? v.compiledPrompt })) }); await api.confirmReshootDraft(job.id, batch.id, backend); }, backend === 'chatgpt-web-manual' ? '网页交接已准备，请手动生成并导回' : '已排队生成一张图片')}>{backend === 'chatgpt-web-manual' ? '确认并准备网页交接' : '确认生成一张图片'}</Button></div>
    </CardContent></Card>}
    {batch && ['failed', 'interrupted'].includes(batch.status) && <div className="soft-warning">{job.error?.message || '适配未完成'}。原文和输入已保留；可返回配置，或在任务记录中手动重试。</div>}
    {job.reshootVersions.some((item) => item.mode === 'full_prompt') && <div className="grid gap-4 lg:grid-cols-2">{[...job.reshootVersions].reverse().filter((item) => item.mode === 'full_prompt').map((item) => <Card className="studio-card" key={item.id}><CardHeader><CardTitle>{item.templateSnapshot?.name} · {item.id}</CardTitle></CardHeader><CardContent><a href={assetUrl(item.url)} target="_blank" rel="noreferrer"><img src={assetUrl(item.url)} className="max-h-96 w-full object-contain" alt={item.id} /></a><OutputDimensions image={item} /><details className="version-details"><summary>原文、适配和生成记录</summary><pre>{JSON.stringify({ template: item.templateSnapshot, adaptation: item.adaptationSnapshot, creativePolicy: item.creativePolicy, prompt: item.prompt }, null, 2)}</pre></details></CardContent></Card>)}</div>}
  </div>;
}
