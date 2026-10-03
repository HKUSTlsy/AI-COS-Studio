'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control */
import { useEffect, useState } from 'react';
import { Plus, Sparkles, Users, Copy, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { api, request, assetUrl, fileToDataUrl } from '@/lib/ai-cos-api';
import { useLocalDraft } from '@/hooks/use-local-draft';
import { faceReviewState } from '@/lib/baseline-face.mjs';
import type {
  AspectRatio,
  BootstrapData,
  GenerationBackend,
  GenerationJob,
} from '@/lib/ai-cos-types';
import type {
  CreationPerson,
  PromptCreation,
  VscCapability,
} from '@/lib/prompt-creation-types';
import { useUploadGuard, confirmLeavingUploads } from './workspace-tools';

type Mutate = (
  action: () => Promise<unknown>,
  success: string,
) => Promise<void>;
const person = (): CreationPerson => ({
  sourceType: 'text',
  description: '',
  scope: 'original',
  position: '',
  adultConfirmed: false,
  stylingConfirmed: false,
});
const outputs = (job: GenerationJob) =>
  [
    ...job.baselineVersions,
    ...job.adjustmentVersions,
    ...job.reshootVersions,
  ].filter(
    (image) =>
      (!('mode' in image) || image.mode !== 'multi_person') &&
      !faceReviewState(job, image).blocked,
  );
const send = <T,>(id: string, action: string, body: unknown, method = 'POST') =>
  request<T>(`/api/prompt-creations/${id}/${action}`, {
    method,
    body: JSON.stringify(body),
  });
const status: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  waiting_user: '等待网页导回',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已取消 / 中断',
  partial: '部分完成',
};
const backendName: Record<GenerationBackend, string> = {
  'built-in-imagegen': 'Codex 内置生成',
  'chatgpt-web-manual': 'ChatGPT 网页交接',
};

export function launchVsc(seed: Partial<CreationPerson>) {
  window.dispatchEvent(new CustomEvent('ai-cos:open-vsc', { detail: seed }));
}

export function PromptCreationPage({
  data,
  mutate,
  seed,
}: {
  data: BootstrapData;
  mutate: Mutate;
  seed?: Partial<CreationPerson>;
}) {
  const [capabilities, setCapabilities] = useState<VscCapability[]>([]);
  const [capabilityError, setCapabilityError] = useState('');
  const [selectedId, setSelectedId] = useLocalDraft('vsc-selection', '');
  const [isNew, setIsNew] = useState(Boolean(seed));
  const [form, setForm] = useLocalDraft('vsc-form', {
    brief: '',
    skill: 'vsc',
    quantity: 3,
    aspectRatio: 'source' as AspectRatio,
    participants: [person()],
  });
  useEffect(() => {
    if (seed)
      queueMicrotask(() => {
        setForm((current) => ({
          ...current,
          participants: [{ ...person(), ...seed }],
        }));
        setIsNew(true);
      });
  }, [seed, setForm]);
  const loadCapabilities = () =>
    request<VscCapability[]>('/api/vsc/capabilities')
      .then((items) => {
        setCapabilities(items);
        setCapabilityError('');
      })
      .catch((error: Error) => setCapabilityError(error.message));
  useEffect(() => {
    void loadCapabilities();
  }, []);
  const records = [...(data.promptCreations || [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const current = !isNew
    ? records.find((item) => item.id === selectedId)
    : null;
  const selectedCapability = capabilities.find(
    (entry) => entry.name === form.skill,
  );
  const updatePerson = (index: number, patch: Partial<CreationPerson>) =>
    setForm((previous) => ({
      ...previous,
      participants: previous.participants.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    }));
  const create = () =>
    mutate(async () => {
      const item = await request<PromptCreation>('/api/prompt-creations', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSelectedId(item.id);
      setIsNew(false);
    }, '已交给 VSC 构思；完成后会显示完整 Prompt，不会自动生图');
  return (
    <div className="vsc-workspace space-y-5">
      <div className="page-heading">
        <div>
          <span className="eyebrow">VSC · Prompt creation</span>
          <h1>Prompt 创作</h1>
          <p>
            先描述想拍什么，再编辑完整提示词。可以没有图片，也可以让角色、脸模一起入镜。
          </p>
        </div>
        <Button variant="outline" onClick={() => { if (confirmLeavingUploads()) setIsNew(true); }}>
          <Plus /> 新创作
        </Button>
      </div>
      <label className="field-label">
        创作记录
        <select
          className="native-select"
          value={current?.id || ''}
          onChange={(e) => {
            if (!confirmLeavingUploads()) return;
            setSelectedId(e.target.value);
            setIsNew(!e.target.value);
          }}
        >
          <option value="">准备新创作</option>
          {records.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.drafts.length} 条 Prompt ·{' '}
              {item.outputs.length} 张图
            </option>
          ))}
        </select>
      </label>
      {!data.bridge.connected && (
        <div className="soft-warning">
          Codex 暂未连接。已保存的草稿和网页导回仍可用，文字创作会保留在队列中。
        </div>
      )}
      {current ? (
        <CreationEditor
          key={`${current.id}:${current.version}`}
          item={current}
          mutate={mutate}
          onReuse={() => {
            if (!confirmLeavingUploads()) return;
            setForm({
              brief: current.brief,
              skill: current.skill,
              quantity: current.quantity,
              aspectRatio: current.aspectRatio,
              participants: current.participants,
            });
            setIsNew(true);
          }}
        />
      ) : (
        <>
          <Card className="studio-card">
            <CardHeader>
              <CardTitle>想拍什么？</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="field-label">
                照片类型与内容
                <Textarea
                  className="min-h-28"
                  maxLength={10000}
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder="例如：纲手在雨后街边买咖啡，3 组自然抓拍，服装换成日常便装，保留妆发与额头标记。"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="field-label">
                  创作方向
                  <select
                    className="native-select"
                    aria-label="创作方向"
                    aria-describedby={
                      selectedCapability?.description
                        ? 'creation-direction-description'
                        : undefined
                    }
                    value={form.skill}
                    onChange={(e) =>
                      setForm({ ...form, skill: e.target.value })
                    }
                  >
                    {capabilities.map((entry) => (
                      <option
                        key={entry.name}
                        value={entry.name}
                        disabled={!entry.available}
                      >
                        {entry.label}
                        {!entry.available ? ' · 未安装' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Prompt 数量
                  <select
                    className="native-select"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({ ...form, quantity: Number(e.target.value) })
                    }
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} 组
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  目标画幅
                  <select
                    className="native-select"
                    value={form.aspectRatio}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        aspectRatio: e.target.value as AspectRatio,
                      })
                    }
                  >
                    {['source', '1:1', '4:3', '3:4', '16:9', '9:16'].map(
                      (ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio === 'source'
                            ? '跟随源图 / 无图时随创意'
                            : ratio}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {selectedCapability?.description && (
                <p
                  id="creation-direction-description"
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  {selectedCapability.description}{' '}
                  {selectedCapability.sourceUrl && (
                    <a
                      href={selectedCapability.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4"
                    >
                      查看原 Skill 文章
                    </a>
                  )}
                </p>
              )}
              {capabilityError && (
                <p role="alert">
                  {capabilityError}{' '}
                  <Button
                    variant="outline"
                    onClick={() => void loadCapabilities()}
                  >
                    重新检查
                  </Button>
                </p>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            {form.participants.map((p, index) => {
              const selectedJob = data.jobs.find((job) => job.id === p.jobId);
              const source =
                p.sourceType === 'face'
                  ? data.faces.find((face) => face.id === p.faceId)?.coverImage
                  : selectedJob &&
                    outputs(selectedJob).find(
                      (image) => image.id === p.outputId,
                    )?.url;
              return (
                <Card key={index} className="studio-card">
                  <CardHeader>
                    <CardTitle className="flex justify-between">
                      <span>人物 {'ABCD'[index]}</span>
                      {form.participants.length > 1 && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setForm({
                              ...form,
                              participants: form.participants.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          移除
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="field-label">
                      人物来源
                      <select
                        className="native-select"
                        value={p.sourceType}
                        onChange={(e) =>
                          updatePerson(index, {
                            sourceType: e.target
                              .value as CreationPerson['sourceType'],
                            faceId: '',
                            jobId: '',
                            outputId: '',
                            stylingConfirmed: false,
                          })
                        }
                      >
                        <option value="text">
                          角色名 / 文字描述（无需图片）
                        </option>
                        <option value="output">已有角色基准 / 单人版本</option>
                        <option value="face">已授权脸模</option>
                      </select>
                    </label>
                    {p.sourceType === 'face' && (
                      <label className="field-label">
                        选择脸模
                        <select
                          className="native-select"
                          value={p.faceId || ''}
                          onChange={(e) =>
                            updatePerson(index, { faceId: e.target.value })
                          }
                        >
                          <option value="">请选择</option>
                          {data.faces
                            .filter(
                              (face) =>
                                !face.archivedAt && face.authorizationConfirmed,
                            )
                            .map((face) => (
                              <option key={face.id} value={face.id}>
                                {face.name}
                              </option>
                            ))}
                        </select>
                        <small>
                          只固定五官，妆发、身材和服装请在描述中指定。
                        </small>
                      </label>
                    )}
                    {p.sourceType === 'output' && (
                      <>
                        <label className="field-label">
                          角色作品
                          <select
                            className="native-select"
                            value={p.jobId || ''}
                            onChange={(e) =>
                              updatePerson(index, {
                                jobId: e.target.value,
                                outputId: '',
                              })
                            }
                          >
                            <option value="">请选择已有作品</option>
                            {data.jobs
                              .filter((job) => outputs(job).length)
                              .map((job) => (
                                <option key={job.id} value={job.id}>
                                  {job.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field-label">
                          单人源版本
                          <select
                            className="native-select"
                            value={p.outputId || ''}
                            onChange={(e) =>
                              updatePerson(index, { outputId: e.target.value })
                            }
                          >
                            <option value="">请选择已通过面部验收的版本</option>
                            {selectedJob &&
                              outputs(selectedJob).map((image) => (
                                <option key={image.id} value={image.id}>
                                  {image.id}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    )}
                    {source && (
                      <img
                        className="h-36 max-w-full rounded-xl object-contain"
                        src={assetUrl(source)}
                        alt={`人物 ${'ABCD'[index]} 来源`}
                      />
                    )}
                    <label className="field-label">
                      角色名 / 人物和造型描述
                      <Textarea
                        maxLength={3000}
                        value={p.description}
                        onChange={(e) =>
                          updatePerson(index, { description: e.target.value })
                        }
                        placeholder="例如：火影忍者的纲手；真人 COS，不采用动漫五官比例"
                      />
                      {form.participants.length === 1 && <small>已在上方说明人物时可留空，不必重复填写。</small>}
                    </label>
                    <label className="field-label">
                      创作范围
                      <select
                        className="native-select"
                        value={p.scope}
                        onChange={(e) =>
                          updatePerson(index, {
                            scope: e.target.value as CreationPerson['scope'],
                            stylingConfirmed: false,
                          })
                        }
                      >
                        <option value="original">
                          原装 COS · 保留完整角色设计
                        </option>
                        <option value="character">
                          角色演绎 · 保留妆发发饰，允许换装
                        </option>
                        <option value="free">
                          自由写真 · 固定脸部身份，开放造型
                        </option>
                      </select>
                    </label>
                    {form.participants.length > 1 && (
                      <label className="field-label">
                        站位与互动关系
                        <Input
                          maxLength={500}
                          value={p.position}
                          onChange={(e) =>
                            updatePerson(index, { position: e.target.value })
                          }
                          placeholder="例如：画面左侧，转头和 B 交谈"
                        />
                      </label>
                    )}
                    <label className="consent-row">
                      <Checkbox
                        checked={p.adultConfirmed}
                        onCheckedChange={(v) =>
                          updatePerson(index, { adultConfirmed: v === true })
                        }
                      />
                      我确认这位角色 / 人物为成年人
                    </label>
                    {p.scope !== 'original' && (
                      <label className="consent-row">
                        <Checkbox
                          checked={p.stylingConfirmed}
                          onCheckedChange={(v) =>
                            updatePerson(index, {
                              stylingConfirmed: v === true,
                            })
                          }
                        />
                        {p.scope === 'character'
                          ? '允许此人换装；身份、妆容、发型发饰与瞳色继续锁定'
                          : '允许此人改变妆发与服装；不更换面部和身体身份'}
                      </label>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={form.participants.length >= 4}
              onClick={() =>
                setForm({
                  ...form,
                  participants: [...form.participants, person()],
                })
              }
            >
              <Users /> 添加同框人物（最多 4 人）
            </Button>
            <Button
              onClick={() => void create()}
              disabled={
                !form.brief.trim() ||
                !capabilities.some(
                  (entry) => entry.name === form.skill && entry.available,
                ) ||
                form.participants.some(
                  (p) =>
                    (form.participants.length > 1 &&
                      p.sourceType === 'text' &&
                      !p.description.trim()) ||
                    (p.sourceType === 'face' && !p.faceId) ||
                    (p.sourceType === 'output' && !p.outputId) ||
                    (form.participants.length > 1 && !p.position.trim()) ||
                    (p.scope !== 'original' &&
                      (!p.adultConfirmed || !p.stylingConfirmed)),
                )
              }
            >
              <Sparkles /> 生成完整 Prompt
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CreationEditor({
  item,
  mutate,
  onReuse,
}: {
  item: PromptCreation;
  mutate: Mutate;
  onReuse: () => void;
}) {
  const [drafts, setDrafts] = useLocalDraft(
    `vsc-drafts:${item.id}:${item.version}`,
    item.drafts,
  );
  const [selected, setSelected] = useState(
    item.drafts.map((draft) => draft.id),
  );
  const [feedback, setFeedback] = useLocalDraft(`vsc-feedback:${item.id}`, '');
  const [backend, setBackend] = useLocalDraft<GenerationBackend>(
    'vsc-backend',
    'built-in-imagegen',
  );
  const [imports, setImports] = useState<Record<string, string>>({});
  const [partial, setPartial] = useState(false);
  useUploadGuard(Object.keys(imports).length > 0);
  const run = item.executionRuns.find((entry) => entry.id === item.activeRunId);
  const lastRun = run || item.executionRuns.at(-1);
  const batch = item.batches.find((entry) => entry.runId === run?.id);
  const dirty =
    JSON.stringify(drafts.map((d) => [d.id, d.title, d.prompt])) !==
    JSON.stringify(item.drafts.map((d) => [d.id, d.title, d.prompt]));
  const selectFile = (id: string, file?: File) =>
    file &&
    mutate(async () => {
      const dataUrl = await fileToDataUrl(file);
      setImports((current) => ({ ...current, [id]: dataUrl }));
    }, '图片已预览，尚未归档');
  const copy = (text: string) =>
    mutate(() => navigator.clipboard.writeText(text), '已复制完整 Prompt');
  return (
    <div className="space-y-4">
      <Card className="studio-card">
        <CardHeader>
          <CardTitle>{item.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-wrap">{item.brief}</p>
          <p>
            {item.participants.length} 人 · {item.quantity} 组 · 草稿 v
            {item.version}
          </p>
          <Button variant="outline" onClick={onReuse}>
            沿用输入另开创作 / 修改人物
          </Button>
          <details className="version-details">
            <summary>人物来源与创作权限</summary>
            {item.participants.map((p, i) => (
              <p key={i}>
                {'ABCD'[i]} · {p.sourceType} · {p.description} · {p.scope} ·{' '}
                {p.position}
              </p>
            ))}
          </details>
        </CardContent>
      </Card>
      {lastRun && (
        <output className="soft-warning block">
          <b>
            {status[lastRun.status]} · {lastRun.progress}
          </b>
          {lastRun.error && <p>{lastRun.error.message}</p>}
          <div className="mt-3 flex gap-3">
            {run && (
              <Button
                variant="outline"
                onClick={() =>
                  void mutate(async () => {
                    await api.cancelWebHandoff(run.id);
                    setImports({});
                  }, '本轮已停止，旧图与输入已保留')
                }
              >
                取消本次任务
              </Button>
            )}
            {!run &&
              lastRun.kind === 'prompt_compose' &&
              ['failed', 'interrupted'].includes(lastRun.status) && (
                <Button
                  onClick={() =>
                    void mutate(
                      () => api.retryRun(lastRun.id),
                      '已手动重试 Prompt 构思',
                    )
                  }
                >
                  重试构思
                </Button>
              )}
          </div>
        </output>
      )}
      {!drafts.length && (
        <p className="text-muted-foreground">
          Prompt 完成后自动显示在这里。可以离开页面，稍后从创作记录继续。
        </p>
      )}
      <fieldset disabled={Boolean(run)} className="space-y-4">
        {drafts.map((draft, index) => (
          <Card className="studio-card" key={draft.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Checkbox
                  checked={selected.includes(draft.id)}
                  onCheckedChange={(v) =>
                    setSelected((current) =>
                      v
                        ? [...current, draft.id]
                        : current.filter((id) => id !== draft.id),
                    )
                  }
                />
                方案 {index + 1}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="field-label">
                名称
                <Input
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) =>
                    setDrafts((current) =>
                      current.map((d) =>
                        d.id === draft.id ? { ...d, title: e.target.value } : d,
                      ),
                    )
                  }
                />
              </label>
              <label className="field-label">
                完整 Prompt
                <Textarea
                  aria-label="完整 Prompt"
                  maxLength={30000}
                  className="min-h-52"
                  value={draft.prompt}
                  onChange={(e) =>
                    setDrafts((current) =>
                      current.map((d) =>
                        d.id === draft.id
                          ? { ...d, prompt: e.target.value }
                          : d,
                      ),
                    )
                  }
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void copy(draft.prompt)}
                >
                  <Copy /> 复制正文
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void mutate(
                      () =>
                        api.saveFullPrompt({
                          name: draft.title,
                          rawText: draft.prompt,
                        }),
                      '已整段保存到完整 Prompt 库，未拆分',
                    )
                  }
                >
                  收藏完整 Prompt
                </Button>
                <Button
                  variant="outline"
                  disabled={dirty || !feedback.trim()}
                  onClick={() =>
                    void mutate(
                      () =>
                        send(item.id, 'revise', {
                          version: item.version,
                          draftIds: [draft.id],
                          feedback,
                        }),
                      '只修改这一组，其余草稿保留',
                    )
                  }
                >
                  只修改这组
                </Button>
              </div>
              <details className="version-details">
                <summary>
                  最终生图 Prompt · {backendName[backend]}
                  {dirty ? '（请先保存编辑）' : ''}
                </summary>
                <pre>
                  {
                    item.drafts.find((d) => d.id === draft.id)?.previews[
                      backend
                    ]
                  }
                </pre>
              </details>
            </CardContent>
          </Card>
        ))}
        {drafts.length > 0 && (
          <Card className="studio-card">
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={!dirty}
                  onClick={() =>
                    void mutate(
                      () =>
                        send(
                          item.id,
                          'drafts',
                          { version: item.version, drafts },
                          'PATCH',
                        ),
                      '草稿已保存，原版本仍在历史中',
                    )
                  }
                >
                  保存编辑
                </Button>
                <span className="text-sm">
                  {dirty
                    ? '有未保存修改；保存后才能重新构思或生图'
                    : '已保存。以下操作仅影响勾选的方案。'}
                </span>
              </div>
              <label className="field-label">
                继续修改 / 重写要求
                <Textarea
                  value={feedback}
                  maxLength={3000}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="例如：换成室外场景，保留人物和服装，只调整镜头与动作"
                />
              </label>
              <Button
                variant="outline"
                disabled={dirty || !selected.length || !feedback.trim()}
                onClick={() =>
                  void mutate(
                    () =>
                      send(item.id, 'revise', {
                        version: item.version,
                        draftIds: selected,
                        feedback,
                      }),
                    '已交给 VSC 修改选中方案',
                  )
                }
              >
                修改选中方案
              </Button>
              <label className="field-label">
                生成方式
                <select
                  aria-label="生成方式"
                  className="native-select"
                  value={backend}
                  onChange={(e) =>
                    setBackend(e.target.value as GenerationBackend)
                  }
                >
                  {Object.entries(backendName).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-muted-foreground">
                确认后逐条生成，一条 Prompt
                对应一张照片。原生最大尺寸仅是请求目标，不强制裁切或放大。网页交接保留右下角“阿茶”署名。
              </p>
              <Button
                disabled={dirty || !selected.length}
                onClick={() =>
                  void mutate(
                    () =>
                      send(item.id, 'generate', {
                        version: item.version,
                        draftIds: selected,
                        backend,
                      }),
                    backend === 'chatgpt-web-manual'
                      ? '网页交接已准备'
                      : '已确认生成，逐张归档结果',
                  )
                }
              >
                确认 {selected.length} 组 Prompt 并
                {backend === 'chatgpt-web-manual' ? '准备网页交接' : '生成图片'}
              </Button>
            </CardContent>
          </Card>
        )}
      </fieldset>
      {run?.status === 'waiting_user' && run.handoff && batch && (
        <Card className="studio-card">
          <CardHeader>
            <CardTitle>ChatGPT 网页交接</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              在网页手动生成，然后把每张结果放回对应槽位。这里只准备素材，不操作
              ChatGPT 登录或页面。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() =>
                  void copy(
                    batch.variants
                      .map((v, i) => `方案 ${i + 1}\n${v.compiledPrompt}`)
                      .join('\n\n'),
                  )
                }
              >
                复制全部 Prompt
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void mutate(
                    () => send(item.id, 'reveal-assets', { runId: run.id }),
                    '已打开本轮参考图目录',
                  )
                }
              >
                <FolderOpen /> 显示参考图
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {run.handoff.assets.map((asset, i) => (
                <div key={asset.path}>
                  <img
                    className="h-28 w-full object-contain"
                    src={assetUrl(asset.url)}
                    alt={asset.purpose}
                  />
                  <small>
                    图 {i + 1} · {asset.purpose}
                  </small>
                </div>
              ))}
            </div>
            {batch.variants.map((variant) => (
              <div
                className="space-y-3 rounded-xl border p-4"
                key={variant.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void selectFile(variant.id, e.dataTransfer.files[0]);
                }}
              >
                <b>结果槽位 {variant.index}</b>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void copy(variant.compiledPrompt)}
                  >
                    复制本组 Prompt
                  </Button>
                  <a
                    className="underline"
                    href="https://chatgpt.com/images"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开 ChatGPT 图片
                  </a>
                </div>
                <label className="field-label">
                  拖入或选择网页生成结果
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      void selectFile(variant.id, e.target.files?.[0]);
                    }}
                  />
                </label>
                {imports[variant.id] && (
                  <>
                    <img
                      className="max-h-80 w-full object-contain"
                      src={imports[variant.id]}
                      alt={`槽位 ${variant.index} 待确认结果`}
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setImports((values) => {
                          const next = { ...values };
                          delete next[variant.id];
                          return next;
                        })
                      }
                    >
                      移除预览
                    </Button>
                  </>
                )}
              </div>
            ))}
            <label className="consent-row">
              <Checkbox
                checked={partial}
                onCheckedChange={(v) => setPartial(v === true)}
              />
              只归档已放入的图片，其余槽位标记为跳过
            </label>
            <Button
              disabled={
                !Object.keys(imports).length ||
                (!partial &&
                  Object.keys(imports).length !== batch.variants.length)
              }
              onClick={() =>
                void mutate(async () => {
                  await send(item.id, 'import-outputs', {
                    runId: run.id,
                    outputs: Object.entries(imports).map(
                      ([variantId, outputDataUrl]) => ({
                        variantId,
                        outputDataUrl,
                      }),
                    ),
                    finishPartial: partial,
                  });
                  setImports({});
                }, '图片已逐张归档')
              }
            >
              确认预览并归档
            </Button>
          </CardContent>
        </Card>
      )}
      {!!item.outputs.length && (
        <div className="grid gap-4 md:grid-cols-2">
          {item.outputs.map((output) => (
            <Card key={output.id} className="studio-card">
              <CardContent className="space-y-3 pt-5">
                <a href={assetUrl(output.url)} target="_blank" rel="noreferrer">
                  <img
                    className="max-h-[36rem] w-full object-contain"
                    src={assetUrl(output.url)}
                    alt={`创作结果 v${output.version}`}
                  />
                </a>
                <p>
                  v{output.version} · {backendName[output.backend]} ·{' '}
                  {output.pixelWidth} × {output.pixelHeight} px
                </p>
                <p>
                  目标{' '}
                  {output.aspectRatio === 'source'
                    ? '跟随源图 / 创意'
                    : output.aspectRatio}{' '}
                  · 实际 {output.actualRatio}
                </p>
                <a
                  className="underline"
                  href={assetUrl(output.url)}
                  download={output.fileName}
                >
                  打开 / 导出原图
                </a>
                <details className="version-details">
                  <summary>对应 Prompt 与来源</summary>
                  <pre>{output.prompt}</pre>
                  <pre>
                    {JSON.stringify(
                      item.batches.find((b) => b.id === output.batchId)
                        ?.inputSnapshot,
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <details className="version-details">
        <summary>历史草稿、执行和失败记录</summary>
        <pre>
          {JSON.stringify(
            {
              drafts: item.draftHistory,
              runs: item.executionRuns,
              batches: item.batches,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
