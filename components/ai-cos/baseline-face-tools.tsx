'use client';
/* oxlint-disable next/no-img-element */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { api, assetUrl } from '@/lib/ai-cos-api';
import { faceReviewState, sourceFaceContext } from '@/lib/baseline-face.mjs';
import type { FaceProfile, GenerationJob, FaceReview, BaselineVersion, AdjustmentVersion, CreativeReshootVersion } from '@/lib/ai-cos-types';

type Output = BaselineVersion | AdjustmentVersion | CreativeReshootVersion;
type Mutate = (action: () => Promise<unknown>, success: string) => Promise<void>;

function FaceZoom({ url, label }: { url: string; label: string }) {
  const id = useId();
  const [zoom, setZoom] = useState(2);
  const [x, setX] = useState(50);
  const [y, setY] = useState(20);
  return <figure className="space-y-2 min-w-0">
    <figcaption className="text-sm font-medium">{label}</figcaption>
    <div className="face-inspection-viewport"><img src={assetUrl(url)} alt={label} style={{ transform: `scale(${zoom})`, transformOrigin: `${x}% ${y}%` }} /></div>
    <div className="face-inspection-controls">
      <span id={`${id}-zoom`}>放大 {zoom}×</span><Slider aria-labelledby={`${id}-zoom`} min={1} max={5} step={0.5} value={[zoom]} onValueChange={(value) => setZoom(Array.isArray(value) ? value[0] : value)} />
      <span id={`${id}-x`}>查看位置 · 左右</span><Slider aria-labelledby={`${id}-x`} min={0} max={100} value={[x]} onValueChange={(value) => setX(Array.isArray(value) ? value[0] : value)} />
      <span id={`${id}-y`}>查看位置 · 上下</span><Slider aria-labelledby={`${id}-y`} min={0} max={100} value={[y]} onValueChange={(value) => setY(Array.isArray(value) ? value[0] : value)} />
    </div>
    <a className="text-sm underline" href={assetUrl(url)} target="_blank" rel="noreferrer">打开原图核对</a>
  </figure>;
}

export function SourceIdentityNotice({ job, source }: { job: GenerationJob; source: Output }) {
  const context = sourceFaceContext(job, source);
  const face = context.face as FaceProfile | null;
  return <div className="source-identity-note text-sm">
    <p><b>实际源版本：{source.id}</b> · 角色卡 v{source.characterCardVersion} · 配置 v{source.configurationVersion}</p>
    <p>绑定脸模：{face ? `${face.name} · v${face.version}` : context.known ? '未绑定脸模 · 沿用源图中的原创身份' : '旧版本未记录脸模快照 · 不推测当前脸模'}</p>
    <p>后期创作沿用这张源图的脸。第 3 步更换脸模只影响新基准，不会替换旧图身份。</p>
  </div>;
}

export function FaceInspection({ job, source, mutate }: { job: GenerationJob; source: Output; mutate: Mutate }) {
  const state = faceReviewState(job, source);
  const review = job.outputAnnotations?.[source.id]?.faceReview;
  return <section className="face-inspection space-y-3">
    <div><h3 className="font-semibold">面部放大验收</h3><p className="text-sm text-muted-foreground">{state.status === 'accepted' ? `已验收：${state.reviewedOutputId}${state.reviewedOutputId !== source.id ? '（沿用上游验收，仍建议核对当前图）' : ''}` : state.status === 'legacy' ? '旧版本未验收：建议先检查；原有流程与交接仍可继续。' : state.status === 'rejected' ? '面部暂不采用：请重做基准或单项修正后再验收。' : '新基准需要人工验收后才能重拍。单项调整仍可用于修正。'}</p></div>
    <SourceIdentityNotice job={job} source={source} />
    <details open={state.blocked} className="version-details"><summary>放大检查五官与肤质 · 不调用生图</summary>
      <FaceInspectionForm key={`${source.id}:${review?.reviewedAt || ''}`} job={job} source={source} mutate={mutate} />
    </details>
  </section>;
}

function FaceInspectionForm({ job, source, mutate }: { job: GenerationJob; source: Output; mutate: Mutate }) {
  const id = useId();
  const review = job.outputAnnotations?.[source.id]?.faceReview;
  const [checks, setChecks] = useState(review?.checks || { identity: false, anatomy: false, texture: false });
  const [note, setNote] = useState(review?.note || '');
  const [saving, setSaving] = useState(false);
  const face = sourceFaceContext(job, source).face as FaceProfile | null;
  const faceImage = face?.images.find((image) => image.angle === 'front') || face?.images[0];
  const save = async (status: FaceReview['status']) => {
    setSaving(true);
    try { await mutate(() => api.outputMetadata(job.id, { outputId: source.id, faceReview: { status, checks, note } }), status === 'accepted' ? '面部人工验收已保存，可继续重拍' : '面部验收已记录，旧图片不会删除'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-4 pt-3">
    <p className="text-sm">移动“查看位置”对准脸部。只放大原图，不锐化、不补细节、不另生成头像。远景细节不足时，不应把看不清当作通过。</p>
    <div className={`grid gap-4 ${faceImage ? 'md:grid-cols-2' : ''}`}>
      <FaceZoom url={source.url} label={`${source.id} · 生成结果`} />
      {faceImage && <FaceZoom url={faceImage.url} label={`${face?.name} · 该版本绑定的脸模参考`} />}
    </div>
    <fieldset disabled={saving || Boolean(job.activeRunId)} className="space-y-3">
      <legend className="text-sm font-medium mb-2">逐项人工确认（不是自动评分，也不等于最终采用）</legend>
      {([
        ['identity', face ? '脸部身份与绑定脸模一致，没有另换一张网红脸' : '原创脸部身份可接受，五官可辨识'],
        ['anatomy', '眼裂、虹膜、鼻口和下颌比例可信，没有动漫大眼或玻璃珠感'],
        ['texture', '脸部受光、眼睑、鼻翼与唇缘自然，没有统一蜡面或过锐毛孔贴图'],
      ] as const).map(([key, label]) => <label className="flex items-start gap-2 text-sm" key={key}><Checkbox className="mt-1" disabled={saving || Boolean(job.activeRunId)} checked={checks[key]} onCheckedChange={(checked) => setChecks({ ...checks, [key]: checked === true })} />{label}</label>)}
      <label className="block text-sm" htmlFor={`${id}-note`}>问题或验收备注（可选）</label>
      <Textarea id={`${id}-note`} className="min-h-20" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：虹膜过大、鼻翼过平滑；不要只写“不够真人”" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={!Object.values(checks).every(Boolean)} onClick={() => void save('accepted')}>确认面部通过</Button>
        <Button variant="outline" onClick={() => void save('rejected')}>暂不采用这张脸</Button>
        {review && <Button variant="ghost" onClick={() => void save('pending')}>重新验收</Button>}
      </div>
    </fieldset>
    {job.activeRunId && <p className="text-sm text-muted-foreground">请先完成或取消当前任务，再修改验收记录。正在等待的网页交接不会被自动修改。</p>}
  </div>;
}
