'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, assetUrl } from '@/lib/ai-cos-api';
import type { GenerationJob } from '@/lib/ai-cos-types';

type Mutate = (action: () => Promise<unknown>, success: string) => Promise<void>;
const statusLabels: Record<string, string> = { draft: '待确认', queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断', waiting_user: '等待网页导回', partial: '部分完成', skipped_by_user: '用户跳过', cancelled: '已放弃', plan_ready: '待确认企划' };

export function BatchHistory({ job, mutate }: { job: GenerationJob; mutate: Mutate }) {
  return <details className="version-details"><summary>任务与分镜记录（{job.executionRuns.length} 次执行）</summary>
    <div className="space-y-4 p-3">{[...job.executionRuns].reverse().map((run) => <div key={run.id} className="rounded-lg border border-white/10 p-3 text-sm">
      <b>{({ analysis: '角色解析', baseline: '基准图', adjustment: '单项调整', reshoot: '重拍', series_deconstruct: '写真解析', prompt_adapt: '完整 Prompt 适配', prompt_split: 'Prompt 拆分', pack_parse: '摄影包解析' })[run.kind]} · {statusLabels[run.status]}</b>
      <p>{run.error?.message || run.progress}</p>
      {['queued', 'running', 'waiting_user'].includes(run.status) && <Button size="sm" variant="outline" onClick={() => void mutate(() => api.cancelWebHandoff(run.id), '本次执行已结束，素材和历史已保留')}>{run.status === 'queued' ? '取消排队' : run.status === 'running' ? '停止本次' : '取消交接'}</Button>}
      {['failed', 'interrupted'].includes(run.status) && !['reshoot'].includes(run.kind) && run.backend !== 'chatgpt-web-manual' && <Button size="sm" variant="outline" disabled={Boolean(job.activeRunId)} onClick={() => void mutate(() => api.retryRun(run.id), '已按未改变的输入重新排队')}>按原输入重试</Button>}
      <details><summary>执行详情</summary>{run.events.map((event, i) => <p key={i}>{event.message}</p>)}</details>
    </div>)}
    {[...job.reshootBatches].reverse().map((batch) => <div key={batch.id} className="rounded-lg border border-white/10 p-3"><b>{batch.mode === 'full_prompt' ? `完整 Prompt · ${batch.templateSnapshot?.name}` : batch.mode === 'multi_person' ? `多人合影 · ${batch.multiPerson?.participants.length} 人` : batch.mode === 'series_plan' ? '系列写真' : '随机重拍'} · {statusLabels[batch.status]}</b>
      {batch.creativePolicy && <p className="text-sm">{batch.creativePolicy.mode === 'character' ? '角色演绎 · 妆发身份锁定，服装按本轮方案' : '原装重拍 · 原 COS 服装锁定'}</p>}
      {batch.templateSnapshot && <details><summary>完整原文与角色适配</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ source: batch.templateSnapshot, adaptation: batch.adaptationDraft }, null, 2)}</pre></details>}
      {batch.realismStyleSnapshot && <p className="text-sm">成像预设：{batch.realismStyleSnapshot.name} · v{batch.realismStyleSnapshot.version}</p>}
      {batch.variants.map((variant) => <div key={variant.id} className="my-3 border-t border-white/10 pt-2 text-sm"><b>方案 {variant.index} · {statusLabels[variant.status]}</b><p>{variant.error?.message}</p>
        {['failed', 'skipped_by_user'].includes(variant.status) && <Button size="sm" variant="outline" disabled={Boolean(job.activeRunId)} onClick={() => void mutate(() => api.recoverReshoot(job.id, batch.id, [variant.id]), '已创建独立草稿，请确认后再生成')}>从此方案建立新草稿</Button>}
        <details><summary>查看本张 Prompt</summary><pre className="whitespace-pre-wrap">{variant.compiledPrompt}</pre></details>
      </div>)}
    </div>)}</div>
  </details>;
}

export function VersionCompare({ job, mutate }: { job: GenerationJob; mutate: Mutate }) {
  const outputs = [...job.baselineVersions, ...job.adjustmentVersions, ...job.reshootVersions];
  const [left, setLeft] = useState(outputs[0]?.id || '');
  const [right, setRight] = useState(job.selectedOutputId || outputs.at(-1)?.id || '');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  if (!outputs.length) return null;
  const filtered = outputs.filter((output) => !onlyFavorites || job.outputAnnotations?.[output.id]?.favorite);
  return <details className="version-details"><summary>版本对比、收藏与成套导出（{outputs.length} 张）</summary><div className="space-y-4 p-3">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyFavorites} onChange={(event) => setOnlyFavorites(event.target.checked)} />只看收藏</label>
    <div className="grid gap-4 md:grid-cols-2">{[{ id: left, set: setLeft }, { id: right, set: setRight }].map((slot, index) => {
      const image = filtered.find((item) => item.id === slot.id) || filtered[0];
      return <div key={index} className="space-y-2"><select className="native-select" aria-label={`对比图片 ${index + 1}`} value={image?.id || ''} onChange={(event) => slot.set(event.target.value)}>{filtered.map((item) => <option key={item.id} value={item.id}>{item.id}{job.outputAnnotations?.[item.id]?.favorite ? ' ★' : ''}</option>)}</select>
        {image && <><a href={assetUrl(image.url)} target="_blank" rel="noreferrer" title="打开原图查看细节"><img className="h-80 w-full rounded-lg object-contain bg-black/20" src={assetUrl(image.url)} alt={image.id} /></a>
          <p className="text-sm text-muted-foreground">{'sourceOutputId' in image ? `来源：${image.sourceOutputId}` : '原始基准'} · {image.pixelWidth} × {image.pixelHeight}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void mutate(() => api.outputMetadata(job.id, { outputId: image.id, favorite: !job.outputAnnotations?.[image.id]?.favorite }), '收藏已更新')}>{job.outputAnnotations?.[image.id]?.favorite ? '取消收藏' : '收藏'}</Button>
          <Button size="sm" variant="outline" onClick={() => void mutate(() => api.outputMetadata(job.id, { outputId: image.id, cover: true }), '作品封面已更新，不影响生成源图')}>{job.coverOutputId === image.id ? '当前封面' : '设为封面'}</Button>
          <Button size="sm" variant="outline" onClick={() => void mutate(() => api.outputMetadata(job.id, { outputId: image.id, adopted: !job.outputAnnotations?.[image.id]?.adopted }), '采用标记已更新')}>{job.outputAnnotations?.[image.id]?.adopted ? '已采用 · 取消' : '标记采用'}</Button></div></>}
      </div>;
    })}</div>
    <p className="text-sm text-muted-foreground">版本分支（每行保留来源关系）</p>{outputs.map((image) => <p className="text-sm" key={image.id}>{'sourceOutputId' in image ? image.sourceOutputId : '角色参考'} → {image.id}{job.outputAnnotations?.[image.id]?.adopted ? ' · 已采用' : ''}</p>)}
    <Button variant="outline" onClick={() => void mutate(async () => { const file = await api.backup(job.id); const a = document.createElement('a'); a.href = assetUrl(file.url); a.download = file.name; a.click(); }, '作品及其 Prompt、素材版本已成套导出')}>导出本作品与全部版本</Button>
  </div></details>;
}

export function LibraryFilter({ query, setQuery, archived, setArchived }: { query: string; setQuery: (value: string) => void; archived: boolean; setArchived: (value: boolean) => void }) {
  return <div className="my-3 flex flex-wrap items-center gap-3"><Input className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、标签或内容…" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />显示已归档</label></div>;
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); queueMicrotask(() => setUrl(next)); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <img className="h-36 w-full rounded-lg object-contain" src={url} alt={file.name} /> : null;
}

export function ReferencePreviews({ main, extras, setExtras, purposes, setPurposes }: {
  main: File | null; extras: File[]; setExtras: (files: File[]) => void;
  purposes: Record<string, string>; setPurposes: (value: Record<string, string>) => void;
}) {
  useUploadGuard(Boolean(main || extras.length));
  const move = (index: number, offset: number) => { const next = [...extras]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setExtras(next); };
  return <div className="space-y-3">{main && <div><b className="text-sm">主图预览</b><FilePreview file={main} /></div>}{extras.map((file, index) => <div className="rounded-lg border border-white/10 p-3" key={`${file.name}-${index}`}><FilePreview file={file} /><p className="text-sm">补充 {index + 1} · {file.name}</p><Input value={purposes[file.name] || ''} onChange={(event) => setPurposes({ ...purposes, [file.name]: event.target.value })} placeholder="用途：例如背面服装、发饰细节、鞋袜…" /><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={index === 0} onClick={() => move(index, -1)}>上移</Button><Button size="sm" variant="outline" disabled={index === extras.length - 1} onClick={() => move(index, 1)}>下移</Button><Button size="sm" variant="outline" onClick={() => setExtras(extras.filter((_, i) => i !== index))}>移除</Button></div></div>)}</div>;
}

let pendingUploadForms = 0;
export function confirmLeavingUploads() {
  return pendingUploadForms === 0 || window.confirm('尚有未提交的图片，离开后需要重新选择。文字草稿会保留，是否离开？');
}
export function useUploadGuard(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    pendingUploadForms += 1;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { pendingUploadForms -= 1; window.removeEventListener('beforeunload', warn); };
  }, [pending]);
}
