'use client';
/* oxlint-disable next/no-img-element, jsx-a11y/label-has-associated-control */
import './studio-design.css';
import { OutputDimensions, OutputResolutionNotice } from './output-resolution';
import { FullPromptLibrary, FullPromptReshootPanel, CreativeWardrobeControls, initialCreativePolicy } from './full-prompt-tools';
import { PromptCreationPage, launchVsc } from './prompt-creation';
import type { CreationPerson, PromptCreation } from '@/lib/prompt-creation-types';

import { createContext, useContext, useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  Aperture,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  Clipboard,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Images,
  Layers3,
  Library,
  LoaderCircle,
  Paintbrush,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, assetUrl, fileToDataUrl } from '@/lib/ai-cos-api';
import { useLocalDraft } from '@/hooks/use-local-draft';
import { PhotoConflictNotice, RealismStyleSelector, PhotographyMethodNotice, PhotographyLibraryGuide, PhotographySourceDetails } from './photo-realism-tools';
import { FaceInspection } from './baseline-face-tools';
import { faceReviewState } from '@/lib/baseline-face.mjs';
import { latestStageFailure, baselineBlockReason, selectImportRecord } from '@/lib/studio-ux';
import { BatchHistory, VersionCompare, LibraryFilter, ReferencePreviews, useUploadGuard, confirmLeavingUploads } from './workspace-tools';
import type {
  AdjustmentCategory,
  AspectRatio,
  BaselineVersion,
  BootstrapData,
  CharacterCard,
  CharacterCardKey,
  ExecutionRun,
  FaceProfile,
  FullPrompt,
  CreativePolicy,
  GenerationBackend,
  GenerationJob,
  PhotographyPack,
  PhotographyPackDraft,
  PhotographyPoolKey,
  PromptCategory,
  PromptDraft,
  PromptModule,
  RunStatus,
  ReshootLockKey,
  SeriesPlanDraft,
  SeriesPlanPackDraft,
  WorkflowStep,
} from '@/lib/ai-cos-types';

type Section = 'studio' | 'compose' | 'faces' | 'prompts' | 'history';
const SubmissionContext = createContext(false);
type OutputVersion =
  | BaselineVersion
  | GenerationJob['adjustmentVersions'][number]
  | GenerationJob['reshootVersions'][number];

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

const navItems: Array<{
  id: Section;
  label: string;
  icon: typeof WandSparkles;
}> = [
  { id: 'studio', label: '创作台', icon: WandSparkles },
  { id: 'compose', label: 'Prompt 创作', icon: Sparkles },
  { id: 'faces', label: '脸模库', icon: ScanFace },
  { id: 'prompts', label: 'Prompt 库', icon: Layers3 },
  { id: 'history', label: '作品历史', icon: Images },
];

const workflowSteps: Array<{ id: WorkflowStep; label: string; note: string }> = [
  { id: 'references', label: '角色参考', note: '上传并解析' },
  { id: 'character_card', label: '角色还原卡', note: '确认与微调' },
  { id: 'configuration', label: '基准生成', note: '脸模与摄影风格' },
  { id: 'adjustment', label: '后期创作', note: '调整 / 随机重拍 / 系列写真' },
];

const runLabels: Record<RunStatus, string> = {
  queued: '排队中',
  running: '执行中',
  waiting_user: '等待导回',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
};
const importStatusLabels: Record<string, string> = {
  queued: '排队中', running: '解析中', draft_ready: '草稿待确认',
  completed: '已入库', failed: '解析失败', interrupted: '已中断',
};

const backendLabels: Record<GenerationBackend, string> = {
  'built-in-imagegen': 'Codex 内置生成',
  'chatgpt-web-manual': 'ChatGPT 网页手动生成',
};

const GENERATION_BACKEND_STORAGE_KEY = 'ai-cos-generation-backend';
const RESHOOT_QUANTITY_STORAGE_KEY = 'ai-cos-reshoot-quantity';

const qualityAxisMeta = [
  ['seriesPackage', '写真套餐'],
  ['lightingExposure', '布光曝光'],
  ['colorRelation', '色彩关系'],
  ['imagingTexture', '成像质感'],
  ['subjectEventExpression', '人物事件与表情'],
  ['visualHierarchy', '画面信息层级'],
  ['absoluteFidelity', '原作企划保真'],
] as const;

const seriesDnaMeta: Array<[keyof SeriesPlanPackDraft['seriesDNA'], string]> = [
  ['themeFramework', '主题世界'],
  ['editorialTone', '时代与编辑气质'],
  ['makeupSystem', '妆容体系'],
  ['hairSystem', '发型体系'],
  ['outfitSystem', '服装体系'],
  ['sceneSystem', '场景体系'],
  ['propSystem', '道具体系'],
];

const imagingMeta: Array<[keyof SeriesPlanPackDraft['imagingProfile'], string]> = [
  ['whiteBalance', '白平衡'], ['colorCast', '色偏'], ['blackPoint', '黑位'],
  ['highlightRollOff', '高光滚降'], ['sharpness', '锐度'], ['microContrast', '微反差'],
  ['softening', '柔化'], ['noiseCompression', '噪点 / 压缩'], ['depthOfField', '景深'],
];

const hierarchyMeta: Array<[keyof SeriesPlanPackDraft['visualHierarchy'], string]> = [
  ['subjectClarity', '主体清晰区'], ['dominantShapes', '主导大形'],
  ['secondaryDetails', '次级细节'], ['lowDetailSpace', '低细节区 / 留白'],
];

const workflowRuleMeta: Array<[keyof SeriesPlanPackDraft['workflowRules'], string]> = [
  ['referenceAssignment', '参考图职责'], ['lightingTopology', '光照拓扑'],
  ['subjectEventCausality', '人物事件与表情因果'], ['storyboardDiversity', '分镜差异'],
  ['antiCommercialPolish', '去商业抛光'], ['redoPolicy', '返工重置'],
];

const photographyPoolMeta: Array<{
  key: PhotographyPoolKey;
  label: string;
}> = [
  { key: 'expression', label: '表情' },
  { key: 'outfitStyle', label: '服装' },
  { key: 'scene', label: '场景' },
  { key: 'moment', label: '动作瞬间' },
  { key: 'shotScale', label: '景别' },
  { key: 'focalLength', label: '焦段' },
  { key: 'cameraPosition', label: '机位' },
  { key: 'composition', label: '构图' },
  { key: 'foreground', label: '前景' },
  { key: 'lighting', label: '光线' },
  { key: 'palette', label: '色彩' },
  { key: 'captureState', label: '摄影状态' },
];

const reshootLockMeta = photographyPoolMeta.filter(
  (item): item is { key: ReshootLockKey; label: string } =>
    item.key !== 'expression' && item.key !== 'outfitStyle',
);

const cardFields: Array<{
  key: CharacterCardKey;
  label: string;
  placeholder: string;
}> = [
  { key: 'hairstyle', label: '发型', placeholder: '长度、分区、刘海、发色与纹理' },
  { key: 'hairAccessories', label: '发饰', placeholder: '位置、数量、造型与材质' },
  { key: 'iris', label: '瞳孔', placeholder: '颜色、虹膜纹理、异色瞳等' },
  { key: 'makeup', label: '妆容', placeholder: '眼妆、唇色、面部纹样' },
  {
    key: 'bodySilhouette',
    label: '真人化身材比例',
    placeholder: '高挑、娇小、纤细、健美等可信真人特征',
  },
  {
    key: 'outfitLayers',
    label: '服装分层',
    placeholder: '从内到外描述结构、剪裁和遮盖关系',
  },
  { key: 'colors', label: '角色配色', placeholder: '主色、辅色、点缀色及其位置' },
  { key: 'materials', label: '服饰材质', placeholder: '织物、皮革、金属和光泽度' },
  { key: 'accessories', label: '配件', placeholder: '武器、饰品、手套、腰带等' },
  { key: 'footwear', label: '鞋袜', placeholder: '袜型、靴型、鞋底、材质与颜色' },
];

const categoryMeta: Record<PromptCategory, { label: string; hint: string }> = {
  style: { label: '摄影风格', hint: '画面质感与色彩科学' },
  camera_angle: { label: '视角 / 景别', hint: '机位、焦段和构图' },
  scene_lighting: { label: '场景 / 灯光', hint: '环境与光源关系' },
  pose: { label: '姿态', hint: '动作与角色轮廓' },
  outfit: { label: '服饰', hint: '服装结构、材质与配件' },
  body_proportion: { label: '身材比例', hint: '真人化体态与轮廓' },
  makeup: { label: '妆容', hint: '眼妆、唇色与面部细节' },
  hair_accessory: { label: '发型 / 发饰', hint: '发丝结构与头部装饰' },
};

const aspectRatioMeta: Array<{
  id: AspectRatio;
  label: string;
  hint: string;
}> = [
  { id: 'source', label: '跟随主图', hint: '保留主图构图' },
  { id: '1:1', label: '1:1', hint: '方形' },
  { id: '4:3', label: '4:3', hint: '横向屏幕' },
  { id: '3:4', label: '3:4', hint: '竖向屏幕' },
  { id: '16:9', label: '16:9', hint: '宽屏' },
  { id: '9:16', label: '9:16', hint: '手机竖屏' },
];

const adjustmentMeta: Record<
  AdjustmentCategory,
  { label: string; hint: string }
> = {
  pose: { label: '动作', hint: '姿态、手势或身体朝向' },
  outfit: { label: '服饰', hint: '结构、材质、配色或配件' },
  background: { label: '背景', hint: '地点、陈设或环境氛围' },
  body_proportion: { label: '身材比例', hint: '可信真人体态与轮廓' },
  makeup: { label: '妆容', hint: '眼妆、唇色或面部纹样' },
  hair_accessory: { label: '发型 / 发饰', hint: '发丝结构与头部装饰' },
  camera_lighting: { label: '镜头 / 光线', hint: '机位、焦段与照明' },
  other: { label: '其他细节', hint: '一个明确、可定位的问题' },
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getActiveRun(job: GenerationJob) {
  return job.executionRuns.find((run) => run.id === job.activeRunId) || null;
}

function isBlockingRun(run: ExecutionRun | null) {
  return Boolean(run && ['queued', 'running'].includes(run.status));
}

function useGenerationBackendPreference() {
  const [backend, setBackendState] = useState<GenerationBackend>(
    'built-in-imagegen',
  );
  useEffect(() => {
    const saved = window.localStorage.getItem(GENERATION_BACKEND_STORAGE_KEY);
    if (saved === 'built-in-imagegen' || saved === 'chatgpt-web-manual')
      queueMicrotask(() => setBackendState(saved));
  }, []);
  const setBackend = (next: GenerationBackend) => {
    setBackendState(next);
    window.localStorage.setItem(GENERATION_BACKEND_STORAGE_KEY, next);
  };
  return [backend, setBackend] as const;
}

function latestFailedRun(job: GenerationJob, kind?: ExecutionRun['kind']) {
  return latestStageFailure(job.executionRuns, kind);
}

function RunBadge({ run }: { run: ExecutionRun | null }) {
  if (!run) return <Badge variant="outline">等待操作</Badge>;
  return (
    <Badge
      variant="outline"
      className={cx(
        'status-badge',
        ['queued', 'running', 'waiting_user'].includes(run.status) &&
          'status-badge-active',
        run.status === 'succeeded' && 'status-badge-success',
        ['failed', 'interrupted'].includes(run.status) && 'status-badge-error',
      )}
    >
      {['queued', 'running'].includes(run.status) && (
        <LoaderCircle className="size-3 animate-spin" />
      )}
      {run.status === 'waiting_user' && <Clock3 className="size-3" />}
      {runLabels[run.status]}
    </Badge>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Images;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function RunProgress({
  job,
  kind,
  onRetry,
}: {
  job: GenerationJob;
  kind: ExecutionRun['kind'];
  onRetry: (runId: string) => void;
}) {
  const active = getActiveRun(job);
  const run = active?.kind === kind ? active : latestFailedRun(job, kind);
  if (!run || ['succeeded', 'waiting_user'].includes(run.status)) return null;
  return (
    <div
      className={cx(
        'run-progress',
        ['failed', 'interrupted'].includes(run.status) && 'run-progress-error',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {['queued', 'running'].includes(run.status) ? (
            <LoaderCircle className="size-4 animate-spin text-violet-300" />
          ) : (
            <CircleAlert className="size-4 text-rose-300" />
          )}
          <b>{run.progress}</b>
        </div>
        <RunBadge run={run} />
      </div>
      <div className="run-events">
        {run.events.slice(-4).map((event, index) => (
          <span key={`${event.at}-${index}`}>{event.message}</span>
        ))}
      </div>
      {['failed', 'interrupted'].includes(run.status) &&
        run.backend !== 'chatgpt-web-manual' &&
        run.kind !== 'reshoot' && (
        <Button size="sm" variant="outline" onClick={() => onRetry(run.id)}>
          <RotateCcw /> 重试本阶段
        </Button>
      )}
    </div>
  );
}

function GenerationBackendSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: GenerationBackend;
  onChange: (value: GenerationBackend) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="field-label mb-2">生成方式</span>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as GenerationBackend)}
        className="backend-options"
        disabled={disabled}
      >
        <label className={cx('backend-option', value === 'built-in-imagegen' && 'backend-option-active')}>
          <RadioGroupItem value="built-in-imagegen" />
          <span>
            <b>Codex 内置生成</b>
            <small>全自动读取参考图、生成并归档</small>
          </span>
        </label>
        <label className={cx('backend-option', value === 'chatgpt-web-manual' && 'backend-option-active')}>
          <RadioGroupItem value="chatgpt-web-manual" />
          <span>
            <b>ChatGPT 网页交接</b>
            <small>Studio 准备素材，你在网页手动生成后导回；重拍默认添加右下角“阿茶”草书署名。</small>
          </span>
        </label>
      </RadioGroup>
    </div>
  );
}

function ReshootWebHandoffPanel({
  run,
  mutate,
}: {
  run: ExecutionRun;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const handoff = run.handoff!;
  const prompts = handoff.prompts || [];
  const [outputs, setOutputs] = useState<
    Record<string, { dataUrl: string; name: string }>
  >({});
  const [finishPartial, setFinishPartial] = useState(false);
  const [message, setMessage] = useState('');
  useUploadGuard(Object.keys(outputs).length > 0);
  const loadOutput = async (variantId: string, file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessage('仅支持 PNG、JPG 或 WEBP 图片');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage('每张生成结果不能超过 20 MB');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setOutputs((current) => ({ ...current, [variantId]: { dataUrl, name: file.name } }));
    setMessage('');
  };
  const copy = async (text: string, note: string, open = false) => {
    if (open) {
      const opened = window.open('https://chatgpt.com/images', '_blank');
      if (opened) opened.opener = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      setMessage(note);
    } catch {
      setMessage('浏览器未允许自动复制，请展开 Prompt 手动复制');
    }
  };
  const selectedCount = Object.keys(outputs).length;
  return (
    <div className="web-handoff">
      <div className="web-handoff-heading">
        <div>
          <span className="eyebrow">Batch web handoff</span>
          <h3>网页版创意重拍素材已准备</h3>
          <p>共享参考图只保存一份；每个方案有独立 Prompt 和结果槽位。</p>
        </div>
        <RunBadge run={run} />
      </div>
      <div className="web-handoff-actions">
        <Button
          onClick={() =>
            void copy(
              prompts.map((item) => `===== ${String(item.index).padStart(2, '0')} =====\n${item.prompt}`).join('\n\n'),
              '全部 Prompt 已复制，ChatGPT 图片已打开',
              true,
            )
          }
          className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
        >
          <Clipboard /> 复制全部并打开 ChatGPT <ExternalLink />
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void mutate(
              () => api.revealWebHandoffAssets(run.id),
              '已在 Finder 中显示本次共享参考素材',
            )
          }
        >
          <FolderOpen /> 在 Finder 中显示素材
        </Button>
      </div>
      {message && <p className="web-handoff-note">{message}</p>}
      <div className="handoff-assets">
        {handoff.assets.map((asset, index) => (
          <a key={`${asset.path}-${index}`} href={assetUrl(asset.url)} download={asset.fileName} className="handoff-asset">
            <img src={assetUrl(asset.url)} alt={asset.purpose} />
            <span><b>{asset.fileName}</b><small>{asset.purpose}</small></span>
          </a>
        ))}
      </div>
      <div className="reshoot-handoff-grid">
        {prompts.map((item) => {
          const output = outputs[item.variantId];
          return (
            <div className="reshoot-handoff-slot" key={item.variantId}>
              <PhotoConflictNotice text={item.prompt} />
              <div className="flex items-center justify-between gap-2">
                <b>方案 {String(item.index).padStart(2, '0')}</b>
                <Button size="sm" variant="outline" onClick={() => void copy(item.prompt, `方案 ${item.index} Prompt 已复制`)}>
                  <Clipboard /> 复制
                </Button>
              </div>
              <details className="version-details">
                <summary>查看完整 Prompt</summary>
                <div><pre>{item.prompt}</pre></div>
              </details>
              <ol className="space-y-1 text-sm">{item.orderedAssets?.map((asset) => <li key={asset.inputNumber}>图 {asset.inputNumber} · {asset.fileName}<span className="block text-muted-foreground">{asset.purpose}</span></li>)}</ol>
              {!item.orderedAssets && <p className="text-sm text-amber-200">此旧交接没有逐张顺序记录，建议取消后重新准备。</p>}
              {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
              <div role="button" tabIndex={0} aria-label={`导入方案 ${item.index}`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.querySelector('input')?.click(); } }} className={cx('result-dropzone', output && 'result-dropzone-ready')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void loadOutput(item.variantId, event.dataTransfer.files[0]); }}>
                {output ? (
                  <><img src={output.dataUrl} alt={`方案 ${item.index} 导入预览`} /><b>{output.name}</b></>
                ) : (
                  <><Upload /><b>导入方案 {item.index} 的结果</b><span>PNG / JPG / WEBP</span></>
                )}
                <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void loadOutput(item.variantId, event.target.files?.[0])} />
              </div>
              {output && (
                <Button size="sm" variant="outline" onClick={() => setOutputs((current) => {
                  const next = { ...current };
                  delete next[item.variantId];
                  return next;
                })}><Trash2 /> 移除</Button>
              )}
            </div>
          );
        })}
      </div>
      {selectedCount > 0 && selectedCount < prompts.length && (
        <label className="consent-row">
          <Checkbox checked={finishPartial} onCheckedChange={(checked) => setFinishPartial(checked === true)} />
          <span>以已导入的 {selectedCount} 张结果结束批次；其余槽位记为用户跳过</span>
        </label>
      )}
      <div className="panel-actions">
        <Button variant="outline" onClick={() => void mutate(() => api.cancelWebHandoff(run.id), '已取消本次网页版重拍交接')}>
          <X /> 取消交接
        </Button>
        <Button
          disabled={!selectedCount || (selectedCount < prompts.length && !finishPartial)}
          className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
          onClick={() =>
            void mutate(
              () => api.importWebHandoffOutputs(
                run.id,
                Object.entries(outputs).map(([variantId, value]) => ({ variantId, outputDataUrl: value.dataUrl })),
                finishPartial,
              ),
              '网页版创意重拍结果已归档',
            )
          }
        >
          <Check /> 确认归档 {selectedCount} 张
        </Button>
      </div>
    </div>
  );
}

function WebHandoffPanel({
  run,
  mutate,
}: {
  run: ExecutionRun;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const handoff = run.handoff;
  const [outputDataUrl, setOutputDataUrl] = useState('');
  useUploadGuard(Boolean(outputDataUrl));
  const [outputName, setOutputName] = useState('');
  const [fileError, setFileError] = useState('');
  const [copyState, setCopyState] = useState('');
  if (!handoff) return null;
  if (handoff.kind === 'reshoot_batch')
    return <ReshootWebHandoffPanel run={run} mutate={mutate} />;

  const loadOutput = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFileError('仅支持 PNG、JPG 或 WEBP 图片');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFileError('生成结果不能超过 20 MB');
      return;
    }
    setOutputDataUrl(await fileToDataUrl(file));
    setOutputName(file.name);
    setFileError('');
  };

  const copyAndOpen = () => {
    const opened = window.open('https://chatgpt.com/images', '_blank');
    if (opened) opened.opener = null;
    if (!navigator.clipboard?.writeText) {
      setCopyState(
        opened
          ? '已打开 ChatGPT 图片；当前浏览器不支持自动复制，请展开下方 Prompt 手动复制'
          : '无法自动复制或打开新页面，请展开下方 Prompt 手动复制',
      );
      return;
    }
    void navigator.clipboard
      .writeText(handoff.prompt)
      .then(() =>
        setCopyState(
          opened
            ? 'Prompt 已复制，ChatGPT 图片已打开'
            : 'Prompt 已复制；浏览器拦截了新页面，请手动打开 ChatGPT',
        ),
      )
      .catch(() =>
        setCopyState('无法自动复制，请展开下方 Prompt 后手动复制'),
      );
  };

  return (
    <div className="web-handoff">
      <div className="web-handoff-heading">
        <div>
          <span className="eyebrow">Web handoff</span>
          <h3>网页版素材已经准备好</h3>
          <p>Studio 不会访问你的登录信息。请在 ChatGPT 网页手动上传素材并生成。</p>
        </div>
        <RunBadge run={run} />
      </div>
      <div className="web-handoff-actions">
        <Button onClick={copyAndOpen} className="bg-violet-300 text-zinc-950 hover:bg-violet-200">
          <Clipboard /> 复制 Prompt 并打开 ChatGPT 图片 <ExternalLink />
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void mutate(
              () => api.revealWebHandoffAssets(run.id),
              '已在 Finder 中显示本次参考素材',
            )
          }
        >
          <FolderOpen /> 在 Finder 中显示参考图
        </Button>
      </div>
      {copyState && <p className="web-handoff-note">{copyState}</p>}
      <PhotoConflictNotice text={handoff.prompt} />
      <div className="handoff-assets">
        {handoff.assets.map((asset, index) => (
          <a
            key={`${asset.path}-${index}`}
            href={assetUrl(asset.url)}
            download={asset.fileName}
            className="handoff-asset"
          >
            <img src={assetUrl(asset.url)} alt={asset.purpose} />
            <span>
              <b>{asset.fileName}</b>
              <small>{asset.purpose}</small>
            </span>
          </a>
        ))}
      </div>
      <details className="version-details">
        <summary>查看或手动复制完整 Prompt</summary>
        <div>
          <pre>{handoff.prompt}</pre>
        </div>
      </details>
      <div
        className={cx('result-dropzone', outputDataUrl && 'result-dropzone-ready')}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void loadOutput(event.dataTransfer.files?.[0]);
        }}
      >
        {outputDataUrl ? (
          <>
            <img src={outputDataUrl} alt="待导入的网页生成结果" />
            <div>
              <b>{outputName}</b>
              <p>请确认这是本次网页版生成结果，再正式归档。</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOutputDataUrl('');
                  setOutputName('');
                }}
              >
                <Trash2 /> 重新选择
              </Button>
            </div>
          </>
        ) : (
          <>
            <Upload />
            <b>把网页生成结果拖到这里</b>
            <span>或点击选择 PNG、JPG、WEBP，最大 20 MB</span>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void loadOutput(event.target.files?.[0])}
            />
          </>
        )}
      </div>
      {fileError && <small className="text-rose-300">{fileError}</small>}
      <div className="panel-actions">
        <Button
          variant="outline"
          onClick={() =>
            void mutate(
              () => api.cancelWebHandoff(run.id),
              '已取消本次网页版交接，素材和记录仍保留',
            )
          }
        >
          <X /> 取消本次交接
        </Button>
        <Button
          disabled={!outputDataUrl}
          className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
          onClick={() =>
            void mutate(
              () => api.importWebHandoffOutput(run.id, outputDataUrl),
              'ChatGPT 网页生成结果已归档',
            )
          }
        >
          <Check /> 确认导入并归档
        </Button>
      </div>
    </div>
  );
}

export function AICosWorkbench() {
  const [section, setSectionValue] = useState<Section>('studio');
  const [vscSeed, setVscSeed] = useState<Partial<CreationPerson> | undefined>();
  useEffect(() => {
    const open = (event: Event) => { if (confirmLeavingUploads()) { setVscSeed((event as CustomEvent<Partial<CreationPerson>>).detail); setSectionValue('compose'); } };
    window.addEventListener('ai-cos:open-vsc', open);
    return () => window.removeEventListener('ai-cos:open-vsc', open);
  }, []);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
  const [newCreation, setNewCreation] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'ok'; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const setSection = useCallback((next: Section) => {
    if (confirmLeavingUploads()) { if (next !== 'compose') setVscSeed(undefined); setSectionValue(next); setNotice(null); }
  }, []);
  useEffect(() => {
    if (notice?.type !== 'ok') return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await api.bootstrap();
      setData(next);
      setFocusJobId((current) =>
        current && next.jobs.some((job) => job.id === current)
          ? current
          : next.jobs[0]?.id || null,
      );
      if (!quiet) setNotice(null);
    } catch (error) {
      setData((current) => current ? { ...current, bridge: { ...current.bridge, connected: false, status: 'offline' } } : current);
      setNotice({
          type: 'error',
          text: error instanceof Error ? error.message : '无法连接本地数据服务',
        });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'read_ai_cos_workspace',
          title: '读取 AI COS 工作台',
          description: '读取本地 AI COS 工作台数量、当前步骤和桥接状态。',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async () => {
            const state = await api.bootstrap();
            const current = state.jobs[0];
            return {
              faceCount: state.faces.length,
              promptCount: state.prompts.length,
              jobCount: state.jobs.length,
              bridge: state.bridge,
              currentJob: current
                ? {
                    id: current.id,
                    title: current.title,
                    workflowStep: current.workflowStep,
                    activeRun: getActiveRun(current),
                  }
                : null,
            };
          },
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: 'navigate_ai_cos_section',
          title: '打开工作台页面',
          description: '切换到创作台、脸模库、Prompt 库或作品历史。',
          inputSchema: {
            type: 'object',
            properties: {
              section: {
                type: 'string',
                enum: ['studio', 'compose', 'faces', 'prompts', 'history'],
              },
            },
            required: ['section'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: async (input: unknown) => {
            const target = (input as { section?: Section }).section;
            if (!target || !navItems.some((item) => item.id === target))
              throw new Error('无效页面');
            setSection(target);
            return { section: target };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => {});
    return () => lifecycle.abort();
  }, [setSection]);

  const activeJob = data?.jobs.find((job) => job.id === focusJobId) || null;
  const submitting = useRef(false);
  const mutate = async (action: () => Promise<unknown>, success: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      setNotice(null);
      await action();
      await refresh(true);
      setNotice({ type: 'ok', text: success });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : '操作失败',
      });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <main className="studio-shell min-h-screen bg-background text-foreground">
      <header className="studio-topbar">
        <button
          className="flex items-center gap-3 text-left"
          disabled={pending}
          onClick={() => setSection('studio')}
        >
          <div className="brand-mark">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.02em]">
              AI COS Studio
            </p>
          </div>
        </button>
        <nav className="studio-main-nav" aria-label="工作台导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setSection(id)} disabled={pending}
              aria-current={section === id ? 'page' : undefined}
              className={cx('studio-nav-link', section === id && 'is-active')}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="studio-connection flex items-center gap-2">
          <Badge
            variant="outline"
            className={cx(
              data?.bridge.connected
                ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
                : 'border-amber-400/20 bg-amber-400/8 text-amber-200',
            )}
          >
            {data?.bridge.status === 'running' ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <span className="size-1.5 rounded-full bg-current" />
            )}
            {data?.bridge.connected ? 'Codex 已连接' : data?.bridge.status === 'offline' ? 'Codex 未连接' : '桥接连接中'}
          </Badge>
          <Button variant="ghost" size="icon" aria-label="刷新工作台" disabled={pending} onClick={() => void refresh()}>
            <RefreshCw />
          </Button>
        </div>
      </header>

      <div>
        <section className="studio-content">
          {notice && (
            <div role={notice.type === 'error' ? 'alert' : 'status'} className={cx('notice', notice.type === 'error' ? 'notice-error' : 'notice-ok')}>
              {notice.type === 'error' ? <CircleAlert /> : <CircleCheck />}
              <span>{notice.text}</span>
              <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X />
              </button>
            </div>
          )}
          {pending && <output className="submission-status"><LoaderCircle className="size-4 animate-spin" />正在保存，请稍候…</output>}
          <SubmissionContext.Provider value={pending}>
          <fieldset className="workspace-fieldset" disabled={pending} aria-busy={pending}>
          {loading ? (
            <div className="grid min-h-[60vh] place-items-center">
              <LoaderCircle className="size-7 animate-spin text-violet-300" />
            </div>
          ) : section === 'studio' ? (
            <Studio
              data={data!}
              job={newCreation ? null : activeJob}
              onNew={() => { if (confirmLeavingUploads()) setNewCreation(true); }}
              onCreated={(id) => {
                setFocusJobId(id);
                setNewCreation(false);
              }}
              mutate={mutate}
            />
          ) : section === 'compose' ? (
            <PromptCreationPage data={data!} mutate={mutate} seed={vscSeed} />
          ) : section === 'faces' ? (
            <FaceLibrary faces={data!.faces} mutate={mutate} />
          ) : section === 'prompts' ? (
            <PromptLibrary data={data!} mutate={mutate} />
          ) : (
            <History
              jobs={data!.jobs}
              creations={data!.promptCreations || []}
              onOpenCreation={(id) => {
                window.localStorage.setItem('ai-cos:draft:vsc-selection', JSON.stringify(id));
                setVscSeed(undefined);
                setSection('compose');
              }}
              onOpen={(id) => {
                setFocusJobId(id);
                setNewCreation(false);
                setSection('studio');
              }}
            />
          )}
          </fieldset>
          </SubmissionContext.Provider>
        </section>
      </div>
    </main>
  );
}

function Studio({
  data,
  job,
  onNew,
  onCreated,
  mutate,
}: {
  data: BootstrapData;
  job: GenerationJob | null;
  onNew: () => void;
  onCreated: (id: string) => void;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const run = job ? getActiveRun(job) : null;
  const blockingRun = isBlockingRun(run);
  return (
    <>
      <div className={cx('page-heading', job && 'creation-heading')}>
        <div>
          {!job && <span className="eyebrow">Creation desk</span>}
          <h1>{job ? job.title : '把角色设定，带进真实镜头'}</h1>
          <p>
            {job
              ? '本地作品 · 旧图与所有输入版本均保留'
              : '上传角色图后自动解析；确认角色卡和摄影配置后，可自动生成或交给 ChatGPT 网页。'}
          </p>
        </div>
        {job && (
          <div className="flex items-center gap-2">
            <RunBadge run={run} />
            <Button variant="outline" onClick={onNew} disabled={blockingRun}>
              <Plus /> 新建创作
            </Button>
          </div>
        )}
      </div>
      {!job ? (
        <NewJobForm onCreated={onCreated} mutate={mutate} bridge={data.bridge} />
      ) : (
        <JobWorkspace
          job={job}
          allJobs={data.jobs}
          faces={data.faces.filter((item) => !item.archivedAt)}
          prompts={data.prompts.filter((item) => !item.archivedAt)}
          photographyPacks={(data.photographyPacks || []).filter((item) => !item.archivedAt)}
          fullPrompts={data.fullPrompts || []}
          mutate={mutate}
        />
      )}
    </>
  );
}

function NewJobForm({
  onCreated,
  mutate,
  bridge,
}: {
  onCreated: (id: string) => void;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: BootstrapData['bridge'];
}) {
  const [title, setTitle] = useLocalDraft('new-work-title', '');
  const [main, setMain] = useState<File | null>(null);
  const [extras, setExtras] = useState<File[]>([]);
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = () =>
    mutate(async () => {
      if (!main) throw new Error('请先上传动漫角色主图');
      setBusy(true);
      try {
        const job = await api.createJob({
          title,
          mainReference: { dataUrl: await fileToDataUrl(main) },
          extraReferences: await Promise.all(
            extras.map(async (file, index) => ({
              dataUrl: await fileToDataUrl(file),
              purpose: purposes[file.name] || `补充角色设定 ${index + 1}`,
            })),
          ),
        });
        onCreated(job.id);
      } finally {
        setBusy(false);
      }
    }, '参考图已保存，Codex 会自动解析角色卡');
  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <Card className="studio-card">
        <CardHeader>
          <CardTitle>1. 角色参考</CardTitle>
          <CardDescription>
            主图决定首次出图的角色设计、姿态、构图、视角和可见背景。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="field-label">
            作品名称
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：月下剑士 COS"
            />
          </label>
          <label className="upload-zone">
            <Upload />
            <b>{main ? main.name : '上传动漫角色主图'}</b>
            <span>PNG、JPG 或 WEBP，最大 20 MB</span>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setMain(event.target.files?.[0] || null)}
            />
          </label>
          <label className="field-label">
            补充参考图（可选，最多 6 张）
            <Input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) =>
                setExtras(Array.from(event.target.files || []).slice(0, 6))
              }
            />
            <small>可补充服装局部、侧面或背面，不会改变主图构图。</small>
          </label>
          <ReferencePreviews main={main} extras={extras} setExtras={setExtras} purposes={purposes} setPurposes={setPurposes} />
          <Button
            className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
            disabled={!main || busy}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            确认并自动解析
          </Button>
        </CardContent>
      </Card>
      <Card className="studio-card bridge-explainer">
        <CardHeader>
          <CardTitle>接下来会自动发生什么</CardTitle>
          <CardDescription>无需切换到 Codex 对话框。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            ['01', '本地保存', '角色图写入被 Git 忽略的私人素材目录。'],
            ['02', 'Codex 解析', '后台临时会话读取图片并写回十项角色卡。'],
            ['03', '人工确认', '你可以逐项修改、强锁定，再进入生成。'],
          ].map(([number, name, text]) => (
            <div className="explain-row" key={number}>
              <span>{number}</span>
              <div>
                <b>{name}</b>
                <p>{text}</p>
              </div>
            </div>
          ))}
          {!bridge.connected && (
            <div className="soft-warning">
              <CircleAlert />
              <span>
                Codex 桥接正在连接。素材仍可提交，任务会留在本地队列中等待连接。
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobWorkspace({
  job,
  allJobs,
  faces,
  prompts,
  photographyPacks,
  fullPrompts,
  mutate,
}: {
  job: GenerationJob;
  allJobs: GenerationJob[];
  faces: FaceProfile[];
  prompts: PromptModule[];
  photographyPacks: PhotographyPack[];
  fullPrompts: FullPrompt[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [step, setStep] = useState<WorkflowStep>(job.workflowStep);
  const lastServerStep = useRef(job.workflowStep);
  const active = getActiveRun(job);
  const blockingRun = isBlockingRun(active);
  // Existing images stay reachable for single-category repairs even while a
  // new baseline is waiting for face acceptance. Reshoot gates are server-side.
  const unlocked = job.baselineVersions.length ? 3 : workflowSteps.findIndex((item) => item.id === job.workflowStep);
  useEffect(() => {
    if (lastServerStep.current === job.workflowStep) return;
    const next = workflowSteps.findIndex((item) => item.id === job.workflowStep);
    const shown = workflowSteps.findIndex((item) => item.id === step);
    if (next > shown) queueMicrotask(() => setStep(job.workflowStep));
    lastServerStep.current = job.workflowStep;
  }, [job.workflowStep, step]);
  const retry = (runId: string) =>
    void mutate(() => api.retryRun(runId), '本阶段已重新排队');
  const go = (target: WorkflowStep) => {
    if (blockingRun) return;
    if (!confirmLeavingUploads()) return;
    const targetIndex = workflowSteps.findIndex((item) => item.id === target);
    if (targetIndex <= unlocked) setStep(target);
  };
  return (
    <div className="job-workspace space-y-5">
      <div className="workflow-nav">
        {workflowSteps.map((item, index) => (
          <button
            key={item.id}
            aria-current={step === item.id ? 'step' : undefined}
            title={item.note}
            className={cx(
              'workflow-step',
              step === item.id && 'workflow-step-active',
              index <= unlocked && 'workflow-step-unlocked',
            )}
            disabled={blockingRun || index > unlocked}
            onClick={() => go(item.id)}
          >
            <span>{index + 1}</span>
            <div>
              <b>{item.label}</b>
              <small>{item.note}</small>
            </div>
          </button>
        ))}
      </div>
      {step === 'references' ? (
        <ReferencePanel
          job={job}
          mutate={mutate}
          retry={retry}
          onNext={() => setStep('character_card')}
        />
      ) : step === 'character_card' ? (
        <CharacterCardPanel
          key={`${job.id}-${job.characterCardVersion}`}
          job={job}
          mutate={mutate}
          retry={retry}
          onBack={() => go('references')}
          onNext={() => setStep('configuration')}
        />
      ) : step === 'configuration' ? (
        <ConfigurationPanel
          job={job}
          faces={faces}
          prompts={prompts}
          mutate={mutate}
          retry={retry}
          onBack={() => go('character_card')}
          onNext={() => setStep('adjustment')}
        />
      ) : (
        <AdjustmentPanel
          key={job.id}
          job={job}
          allJobs={allJobs}
          prompts={prompts}
          photographyPacks={photographyPacks}
          fullPrompts={fullPrompts}
          mutate={mutate}
          retry={retry}
          onBack={() => go('configuration')}
        />
      )}
      <BatchHistory job={job} mutate={mutate} />
    </div>
  );
}

function ReferencePanel({
  job,
  mutate,
  retry,
  onNext,
}: {
  job: GenerationJob;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  retry: (runId: string) => void;
  onNext: () => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [main, setMain] = useState<File | null>(null);
  const [extras, setExtras] = useState<File[]>([]);
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [replaceExtras, setReplaceExtras] = useState(false);
  const active = getActiveRun(job);
  const blockingRun = isBlockingRun(active);
  const submit = () =>
    mutate(async () => {
      await api.updateReferences(job.id, {
        title,
        ...(main ? { mainReference: { dataUrl: await fileToDataUrl(main) } } : {}),
        ...(replaceExtras || extras.length
          ? {
              extraReferences: await Promise.all(
                extras.map(async (file, index) => ({
                  dataUrl: await fileToDataUrl(file),
                  purpose: purposes[file.name] || `补充角色设定 ${index + 1}`,
                })),
              ),
            }
          : {}),
      });
      setMain(null);
      setExtras([]);
      setReplaceExtras(false);
    }, '新参考版本已保存，并重新进入自动解析');
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Card className="studio-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>角色参考 · v{job.referenceVersion}</CardTitle>
              <CardDescription>
                修改会创建新版本并重新解析，旧角色卡和图片不会删除。
              </CardDescription>
            </div>
            <Badge variant="outline">{job.references.length} 张</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="reference-gallery">
            {job.references
              .filter((reference) => reference.role.startsWith('character_'))
              .map((reference) => (
                <figure key={reference.path}>
                  <img src={assetUrl(reference.url)} alt={reference.purpose} />
                  <figcaption>
                    {reference.role === 'character_main' ? '主图' : '补充图'}
                    <small>{reference.purpose}</small>
                  </figcaption>
                </figure>
              ))}
          </div>
          <RunProgress job={job} kind="analysis" onRetry={retry} />
          {!active && job.characterCardVersion > 0 && (
            <div className="mt-5 flex justify-end">
              <Button onClick={onNext} className="bg-violet-300 text-zinc-950 hover:bg-violet-200">
                查看角色还原卡 <ChevronRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="studio-card">
        <CardHeader>
          <CardTitle>返回修改参考</CardTitle>
          <CardDescription>不选新文件时会沿用当前图片。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="field-label">
            作品名称
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field-label">
            替换主图（可选）
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setMain(event.target.files?.[0] || null)}
            />
          </label>
          <label className="field-label">
            替换全部补充图（可选）
            <Input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) =>
                setExtras(Array.from(event.target.files || []).slice(0, 6))
              }
            />
          </label>
          <ReferencePreviews main={main} extras={extras} setExtras={(files) => { setExtras(files); setReplaceExtras(true); }} purposes={purposes} setPurposes={setPurposes} />
          <Button variant="outline" disabled={blockingRun} onClick={() => { setExtras([]); setReplaceExtras(true); }}>清空补充图（保存新版本后生效）</Button>
          {replaceExtras && !extras.length && <p className="text-sm text-amber-200">新参考版本将只保留主图，旧版本不变。</p>}
          <Button
            variant="outline"
            className="w-full"
            disabled={blockingRun || (!main && !extras.length && !replaceExtras && title === job.title)}
            onClick={() => void submit()}
          >
            <RefreshCw /> 保存新版本并重新解析
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CharacterCardPanel({
  job,
  mutate,
  retry,
  onBack,
  onNext,
}: {
  job: GenerationJob;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  retry: (runId: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [card, setCard] = useLocalDraft<CharacterCard>(`card:${job.id}:${job.characterCardVersion}`, structuredClone(job.characterCard));
  const reference = job.references.find((image) => image.role === 'character_main') || job.references[0];
  const active = getActiveRun(job);
  const blockingRun = isBlockingRun(active);
  if (!job.characterCardVersion) {
    return (
      <Card className="studio-card">
        <CardContent className="pt-6">
          <RunProgress job={job} kind="analysis" onRetry={retry} />
          {!active && (
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft /> 返回修改参考
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }
  const save = () =>
    mutate(async () => {
      await api.saveCharacterCard(job.id, card);
      onNext();
    }, '角色还原卡已保存，修改字段已标记为用户确认');
  return (
    <Card className="studio-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>角色还原卡 · v{job.characterCardVersion}</CardTitle>
            <CardDescription>
              Codex 只根据角色参考填写；你修改的字段会变为“用户已确认”。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">参考图可见</Badge>
            <Badge variant="outline">不可见信息标记为推断</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="character-review-layout">
          {reference && <figure className="character-review-reference"><img src={assetUrl(reference.url)} alt={`${job.title} · 角色卡核对参考`} /><figcaption>对照主图微调 · 未修改字段保留原判定</figcaption></figure>}
        <section className="character-card-grid" aria-label="角色还原卡字段">
          {cardFields.map((field) => {
            const item = card[field.key];
            return (
              <div className="character-field" key={field.key}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`character-${job.id}-${field.key}`}>{field.label}</label>
                  <Badge variant="outline" className="text-[10px]">
                    {item.value !== job.characterCard[field.key].value || item.strongLock !== job.characterCard[field.key].strongLock ? '已微调 · 待保存' : item.certainty === 'observed'
                      ? '参考图可见'
                      : item.certainty === 'inferred'
                        ? '推断'
                        : '用户已确认'}
                  </Badge>
                </div>
                <Textarea
                  id={`character-${job.id}-${field.key}`}
                  value={item.value}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setCard((current) => ({
                      ...current,
                      [field.key]: { ...current[field.key], value: event.target.value },
                    }))
                  }
                />
                <label className="lock-row">
                  <Checkbox
                    aria-label={`强锁定${field.label}`}
                    checked={item.strongLock}
                    onCheckedChange={(checked) =>
                      setCard((current) => ({
                        ...current,
                        [field.key]: {
                          ...current[field.key],
                          strongLock: checked === true,
                        },
                      }))
                    }
                  />
                  强锁定此项，不允许摄影风格改变
                </label>
              </div>
            );
          })}
        </section>
        </div>
        {cardFields.some((field) => !card[field.key].value.trim()) && <output className="mt-3 block text-sm text-amber-200">请补充：{cardFields.filter((field) => !card[field.key].value.trim()).map((field) => field.label).join('、')}。不可见部分可以填写推断。</output>}
        <div className="panel-actions">
          <Button variant="outline" disabled={blockingRun} onClick={onBack}>
            <ArrowLeft /> 返回角色参考
          </Button>
          <Button
            disabled={blockingRun || cardFields.some((field) => !card[field.key].value.trim())}
            onClick={() => void save()}
            className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
          >
            <Check /> 保存并选择脸模与风格
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigurationPanel({
  job,
  faces,
  prompts,
  mutate,
  retry,
  onBack,
  onNext,
}: {
  job: GenerationJob;
  faces: FaceProfile[];
  prompts: PromptModule[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  retry: (runId: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const styles = prompts.filter((prompt) => prompt.category === 'style');
  const [faceId, setFaceId] = useState(job.faceProfileId || '');
  const [styleId, setStyleId] = useState(job.styleModuleId ?? '');
  const [previewId, setPreviewId] = useState('');
  const [previewFit, setPreviewFit] = useState<'contain' | 'cover'>('contain');
  const pending = useContext(SubmissionContext);
  useEffect(() => {
    if (faceId && !faces.some((item) => item.id === faceId)) queueMicrotask(() => setFaceId(''));
    if (styleId && !styles.some((item) => item.id === styleId)) queueMicrotask(() => setStyleId(''));
  }, [faces, styles, faceId, styleId]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    job.aspectRatio || 'source',
  );
  const [backend, setBackend] = useGenerationBackendPreference();
  const active = getActiveRun(job);
  const blockingRun = isBlockingRun(active);
  const manualRun =
    active?.kind === 'baseline' &&
    active.status === 'waiting_user' &&
    active.backend === 'chatgpt-web-manual'
      ? active
      : null;
  const latest = job.baselineVersions.at(-1);
  const shown = job.baselineVersions.find((version) => version.id === previewId) || latest;
  const reference = job.references.find((image) => image.role === 'character_main') || job.references[0];
  const selectedFace = faces.find((face) => face.id === faceId);
  const faceImage = selectedFace?.images.find((image) => image.path === selectedFace.coverImage) || selectedFace?.images[0];
  const blockedReason = baselineBlockReason(blockingRun, faceId, faces);
  const submit = () =>
    mutate(
      () =>
        api.generateBaseline(job.id, {
          faceProfileId: faceId || null,
          styleModuleId: styleId || null,
          aspectRatio,
          backend,
        }),
      backend === 'chatgpt-web-manual'
        ? '网页版生图素材已准备完成'
        : latest
          ? '新基准版本已排队，旧版本会保留'
          : '已排队生成一张高忠实基准图',
    );
  return (
    <div className="baseline-workspace">
      <div className="comparison-stage" style={{ '--preview-fit': previewFit } as React.CSSProperties}>
        <fieldset className="comparison-view-toggle" aria-label="图片显示方式">
          <button aria-pressed={previewFit === 'contain'} onClick={() => setPreviewFit('contain')}>完整显示</button>
          <button aria-pressed={previewFit === 'cover'} onClick={() => setPreviewFit('cover')} title="仅预览裁切，不修改或导出裁切后的文件">放大查看</button>
        </fieldset>
        <figure className="comparison-frame">
          <figcaption>动漫角色参考 <span>当前输入 · v{job.referenceVersion}</span></figcaption>
          {reference && <img src={assetUrl(reference.url)} alt={`${job.title} · 当前动漫角色主图`} />}
          {reference?.pixelWidth && reference.pixelHeight && <span className="image-dimensions">{reference.pixelWidth} × {reference.pixelHeight}</span>}
        </figure>
        <figure className="comparison-frame">
          <figcaption>真人基准 {shown && <span>· v{shown.version}</span>}</figcaption>
          {shown ? <>
            <select className="preview-version-select" aria-label="查看基准历史版本" value={shown.id} onChange={(event) => setPreviewId(event.target.value)}>
              {[...job.baselineVersions].reverse().map((version) => <option key={version.id} value={version.id}>基准 v{version.version}{version.id === latest?.id ? ' · 最新' : ''}</option>)}
            </select>
            <img src={assetUrl(shown.url)} alt={`${job.title} · 真人基准 v${shown.version}`} />
            <span className="image-dimensions">{shown.pixelWidth && shown.pixelHeight ? `${shown.pixelWidth} × ${shown.pixelHeight} · 实际 ${shown.actualRatio || '—'}` : '尺寸尚未记录'}<br />目标 {shown.aspectRatio === 'source' ? '跟随主图' : shown.aspectRatio} · {backendLabels[shown.backend]}</span>
          </> : <EmptyState icon={ImageIcon} title={active ? '正在准备你的基准图' : '让角色走进真实镜头'} description={active ? '可以留在这里查看进度，完成后图片会自动出现。' : '确认下方配置，生成第一张真人 COS 基准图。'} />}
        </figure>
      </div>
      {shown && <OutputDimensions image={shown} />}
      <div className="configuration-dock">
        <label className="dock-field">脸部身份
          <div className="dock-face-input">{faceImage && <img src={assetUrl(faceImage.url)} alt="所选脸模" />}
            <select aria-label="脸部身份" className="native-select" value={faceId} disabled={blockingRun} onChange={(event) => setFaceId(event.target.value)}>
              <option value="">原创脸部 · 不绑定脸模</option>
              {faces.map((face) => <option value={face.id} key={face.id}>{face.name}{!face.authorizationConfirmed ? ' · 未确认授权' : ''}</option>)}
            </select>
          </div>
        </label>
        <label className="dock-field">摄影风格
          <select className="native-select" value={styleId} disabled={blockingRun} onChange={(event) => setStyleId(event.target.value)} title={styles.find((style) => style.id === styleId)?.normalizedText || '忠实还原主图，不叠加摄影风格'}>
            <option value="">忠实还原 · 无附加风格</option>
            {styles.map((style) => <option value={style.id} key={style.id}>{style.name}</option>)}
          </select>
        </label>
        <div className="dock-field"><span id="baseline-ratio-label">目标画幅</span>
          <fieldset className="dock-ratios" aria-labelledby="baseline-ratio-label">
            {aspectRatioMeta.map((ratio) => <button key={ratio.id} type="button" aria-pressed={aspectRatio === ratio.id} disabled={blockingRun} title={ratio.hint} onClick={() => setAspectRatio(ratio.id)}>{ratio.id === 'source' ? '跟随主图' : ratio.label}</button>)}
          </fieldset>
        </div>
        <label className="dock-field">生成方式
          <select className="native-select" value={backend} disabled={blockingRun} onChange={(event) => setBackend(event.target.value as GenerationBackend)}>
            <option value="built-in-imagegen">Codex 内置 · 自动</option>
            <option value="chatgpt-web-manual">ChatGPT 网页 · 手动</option>
          </select>
        </label>
        <div className="dock-submit">
          <Button disabled={pending || !!blockedReason} onClick={() => void submit()} className="baseline-generate">
            {pending || blockingRun ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
            {pending ? '正在提交…' : backend === 'chatgpt-web-manual' ? '准备网页交接' : latest ? '生成新基准图' : '生成首张基准图'}
          </Button>
          <small>生成 1 张 · 原版本保留</small>
          {shown && <Button variant="ghost" disabled={!!active || faceReviewState(job, shown).blocked} onClick={() => void mutate(async () => { await api.selectOutput(job.id, shown.id); onNext(); }, `已选择基准 v${shown.version}，可继续后期创作`)}>使用当前基准继续 <ChevronRight /></Button>}
        </div>
      </div>
      <div className="configuration-footnote">
        <Button variant="ghost" disabled={blockingRun} onClick={onBack}><ArrowLeft /> 返回角色卡</Button>
        <p>动漫提供角色妆造与瞳色；真人脸模决定五官结构，不照搬动漫大眼与宝石高光。目标比例不保证精确像素，不裁切原文件。</p>
      </div>
      <p className="text-sm text-muted-foreground">脸模参考建议使用经授权、五官清楚且修饰较少的照片。重度磨皮或放大眼睛的参考会限制面部判断；系统不会推测原本长相，也不会自动替换脸模。</p>
      {shown && <FaceInspection job={job} source={shown} mutate={mutate} />}
      {shown && <Button variant="outline" onClick={() => launchVsc({ sourceType: 'output', jobId: job.id, outputId: shown.id, description: job.title })}><Sparkles /> 用 VSC 创作 Prompt / 多人合拍</Button>}
      {blockedReason && <output className="soft-warning">{blockedReason}</output>}
      <PhotoConflictNotice text={styles.find((style) => style.id === styleId)?.normalizedText || ''} />
      <PhotographyMethodNotice stage="baseline" />
      <OutputResolutionNotice aspectRatio={aspectRatio} source={reference} />
      {active?.kind === 'baseline' ? <RunProgress job={job} kind="baseline" onRetry={retry} /> : latestFailedRun(job, 'baseline') && (
        <details className="version-details previous-attempt"><summary>最近一次尝试未完成{shown ? ' · 已有基准图仍可使用' : ''}</summary><RunProgress job={job} kind="baseline" onRetry={retry} /></details>
      )}
      {manualRun && <WebHandoffPanel run={manualRun} mutate={mutate} />}
      {shown && <details className="version-details"><summary>查看此基准图的生成配置与完整 Prompt</summary><p>角色卡 v{shown.characterCardVersion} · 参考图 v{shown.referenceVersion} · {backendLabels[shown.backend]}</p><pre>{shown.prompt}</pre></details>}
    </div>
  );
}

function AdjustmentPanel({
  job,
  allJobs,
  prompts,
  photographyPacks,
  fullPrompts,
  mutate,
  retry,
  onBack,
}: {
  job: GenerationJob;
  allJobs: GenerationJob[];
  prompts: PromptModule[];
  photographyPacks: PhotographyPack[];
  fullPrompts: FullPrompt[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  retry: (runId: string) => void;
  onBack: () => void;
}) {
  const activeBatch = job.reshootBatches.find((batch) => batch.id === job.activeReshootBatchId);
  const [mode, setMode] = useLocalDraft<string>(`mode:${job.id}`, activeBatch?.mode === 'full_prompt' ? 'full' : activeBatch?.mode === 'multi_person' ? 'group' : activeBatch?.mode === 'series_plan' ? 'series' : activeBatch ? 'variable' : 'single');
  return (
    <div className="space-y-4"><VersionCompare job={job} mutate={mutate} />
    <Button variant="outline" onClick={() => launchVsc({ sourceType: 'output', jobId: job.id, outputId: job.selectedOutputId || undefined, description: job.title })}><Sparkles /> 用选中版本开始 VSC 创作</Button>
    <Tabs value={mode} onValueChange={(value) => setMode(String(value))} className="space-y-4">
      <TabsList className="h-auto flex-wrap bg-white/5 p-1">
        <TabsTrigger value="single" className="px-4">
          <SlidersHorizontal /> 单项调整
        </TabsTrigger>
        <TabsTrigger value="variable" className="px-4"><Shuffle /> 随机重拍</TabsTrigger>
        <TabsTrigger value="full" className="px-4"><Clipboard /> 完整 Prompt</TabsTrigger>
        <TabsTrigger value="series" className="px-4"><Aperture /> 系列写真</TabsTrigger>
        <TabsTrigger value="group" className="px-4"><Users /> 多人合影</TabsTrigger>
      </TabsList>
      <TabsContent value="single" keepMounted>
        <SingleAdjustmentPanel
          job={job}
          prompts={prompts}
          mutate={mutate}
          retry={retry}
          onBack={onBack}
        />
      </TabsContent>
      <TabsContent value="group" keepMounted>
        <MultiPersonPanel job={job} allJobs={allJobs} photographyPacks={photographyPacks} mutate={mutate} />
      </TabsContent>
      <TabsContent value="full" keepMounted>
        <FullPromptReshootPanel job={job} templates={fullPrompts} mutate={mutate}
          renderFace={(source) => <FaceInspection job={job} source={source} mutate={mutate} />}
          renderRun={(run) => run.status === 'waiting_user' ? <WebHandoffPanel run={run} mutate={mutate} /> : <RunProgress job={job} kind={run.kind} onRetry={retry} />} />
      </TabsContent>
        <CreativeReshootPanel
          job={job}
          prompts={prompts}
          photographyPacks={photographyPacks}
          mutate={mutate}
          onBack={onBack}
        />
    </Tabs></div>
  );
}

type GroupPersonInput = { jobId: string; outputId: string; position: string; adultConfirmed: boolean; wardrobe: 'locked' | 'swimwear'; outfitConfirmed: boolean; outfitDirection: string };
const singleOutputs = (job: GenerationJob): OutputVersion[] => [...job.baselineVersions, ...job.adjustmentVersions, ...job.reshootVersions.filter((image) => image.mode !== 'multi_person')];
const newGroupPerson = (jobId = '', outputId = '', position = ''): GroupPersonInput => ({ jobId, outputId, position, adultConfirmed: false, wardrobe: 'locked', outfitConfirmed: false, outfitDirection: '' });

function MultiPersonPanel({ job, allJobs, photographyPacks, mutate }: {
  job: GenerationJob; allJobs: GenerationJob[]; photographyPacks: PhotographyPack[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const packs = photographyPacks.filter((pack) => pack.kind === 'variable_pool');
  const initialSource = singleOutputs(job).find((image) => image.id === job.selectedOutputId) || singleOutputs(job).at(-1);
  const [people, setPeople] = useLocalDraft<GroupPersonInput[]>(`group-people:${job.id}`, [newGroupPerson(job.id, initialSource?.id, '画面左侧'), newGroupPerson('', '', '画面右侧')]);
  const [packId, setPackId] = useLocalDraft(`group-pack:${job.id}`, '');
  const pack = packs.find((item) => item.id === packId) || packs[0];
  const [event, setEvent] = useLocalDraft(`group-event:${job.id}`, '');
  const [medium, setMedium] = useLocalDraft(`group-medium:${job.id}`, '');
  const [locks, setLocks] = useLocalDraft<Partial<Record<ReshootLockKey, string>>>(`group-locks:${job.id}`, {});
  const [aspectRatio, setAspectRatio] = useLocalDraft<AspectRatio>(`group-ratio:${job.id}`, 'source');
  const [backend, setBackend] = useGenerationBackendPreference();
  const [sceneReference, setSceneReference] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [prompts, setPrompts] = useLocalDraft<Record<string, string>>(`group-prompts:${job.id}`, {});
  const [preparing, setPreparing] = useState(false);
  const submitting = useContext(SubmissionContext);
  useUploadGuard(Boolean(sceneReference));
  const active = getActiveRun(job);
  const batch = job.reshootBatches.find((item) => item.id === job.activeReshootBatchId && item.mode === 'multi_person') || [...job.reshootBatches].reverse().find((item) => item.mode === 'multi_person' && item.status === 'draft');
  const activeGroup = active?.id === batch?.runId ? active : null;
  const latestGroup = job.reshootBatches.filter((item) => item.mode === 'multi_person').at(-1);
  const editable = !active && !preparing && !submitting;
  const sourceJobs = allJobs.filter((item) => singleOutputs(item).length);
  const changePerson = (index: number, change: Partial<GroupPersonInput>) => setPeople((current) => current.map((person, i) => i === index ? { ...person, ...change } : person));
  const selectedSource = (person: GroupPersonInput) => {
    const work = allJobs.find((item) => item.id === person.jobId);
    return { work, image: work && singleOutputs(work).find((item) => item.id === person.outputId) };
  };
  const participantError = people.some((person) => {
    const { work, image } = selectedSource(person);
    return !work || !image || faceReviewState(work, image).blocked || !person.position.trim() || !person.adultConfirmed || (person.wardrobe === 'swimwear' && !person.outfitConfirmed);
  });
  const duplicate = new Set(people.map((person) => person.jobId)).size !== people.length;
  const createDraft = () => mutate(async () => {
    setPreparing(true);
    try {
      await api.createMultiPersonDraft(job.id, { participants: people, packId: pack?.id, event, medium, locks, aspectRatio, sceneReferenceDataUrl: sceneReference || undefined });
      setSceneReference('');
    } finally { setPreparing(false); }
  }, '多人合影 Prompt 已准备，请检查后再确认生图');
  const restore = (output: GenerationJob['reshootVersions'][number]) => {
    const group = output.multiPerson;
    if (!group) return;
    setPeople(group.participants.map((person) => ({ jobId: person.jobId, outputId: person.outputId, position: person.position, adultConfirmed: person.adultConfirmed, wardrobe: person.wardrobe, outfitConfirmed: person.outfitConfirmed, outfitDirection: person.outfitDirection })));
    setEvent(group.event); setMedium(group.medium); setPackId(output.packId || ''); setAspectRatio(output.aspectRatio);
    const originalBatch = job.reshootBatches.find((item) => item.id === output.batchId);
    setLocks(originalBatch?.locks || {});
    setSceneReference('');
    // Preserve the saved scene reference when preparing again from original inputs.
    if (group.sceneReference) void mutate(async () => {
      const response = await fetch(assetUrl(group.sceneReference!.url));
      if (!response.ok) throw new Error('原场景参考读取失败，请重新上传');
      setSceneReference(await fileToDataUrl(new File([await response.blob()], 'scene-reference')));
    }, '原人物与场景配置已载入，尚未生图');
  };
  return <div className="space-y-5">
    <Card className="studio-card"><CardHeader><CardTitle className="flex items-center gap-2"><Users /> 多人合影</CardTitle><CardDescription>2–4 位角色，一张照片，一个共同事件。先分别做好单人基准并验收面部，再在这里组合；每人的身份、服装和参考图独立保存。</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={!editable} className="space-y-5 disabled:opacity-60">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field-label">人数<select className="native-select" value={people.length} onChange={(e) => setPeople((current) => Array.from({ length: Number(e.target.value) }, (_, i) => current[i] || newGroupPerson('', '', i === 2 ? '画面中景' : '画面后景')))}>{[2, 3, 4].map((count) => <option key={count} value={count}>{count} 人 · 每次一张合影</option>)}</select></label>
            <label className="field-label">摄影方案包<select className="native-select" value={pack?.id || ''} onChange={(e) => setPackId(e.target.value)}>{!packs.length && <option value="">请先在 Prompt 库确认摄影方案包</option>}{packs.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">{people.map((person, index) => {
            const { work, image } = selectedSource(person);
            const blocked = work && image && faceReviewState(work, image).blocked;
            const options = index === 0 ? [job] : sourceJobs.filter((entry) => entry.id !== job.id);
            return <div key={index} className="rounded-xl border border-white/10 p-4 space-y-3">
              <h3 className="font-medium">角色 {'ABCD'[index]} · 独立身份</h3>
              <label className="field-label">来源作品<select className="native-select" value={person.jobId} disabled={index === 0} onChange={(e) => { const next = allJobs.find((entry) => entry.id === e.target.value); changePerson(index, { ...newGroupPerson(e.target.value, next && singleOutputs(next).at(-1)?.id, person.position) }); }}><option value="">选择另一位角色的作品</option>{options.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
              <label className="field-label">单人源版本<select className="native-select" value={person.outputId} onChange={(e) => changePerson(index, { outputId: e.target.value, adultConfirmed: false, outfitConfirmed: false })}><option value="">选择已验收的单人图</option>{work && singleOutputs(work).map((entry) => <option key={entry.id} value={entry.id}>{entry.id}{faceReviewState(work, entry).blocked ? ' · 待面部验收' : ''}</option>)}</select></label>
              {image && <img className="h-44 w-full rounded-lg object-contain bg-black/20" src={assetUrl(image.url)} alt={`角色 ${'ABCD'[index]} 的身份源图`} />}
              {blocked && <p role="alert" className="text-sm text-amber-200">此源图尚未通过面部验收。请在该作品的基准或单项调整页面验收后继续。</p>}
              <label className="field-label">画面位置 / 前后层次<Input value={person.position} maxLength={500} onChange={(e) => changePerson(index, { position: e.target.value })} /></label>
              <label className="consent-row"><Checkbox checked={person.adultConfirmed} onCheckedChange={(v) => changePerson(index, { adultConfirmed: v === true })} /><span>我确认此人物明确成年，参考素材有权使用；年龄不明不能勾选。</span></label>
              <label className="field-label">此人的服装<select className="native-select" value={person.wardrobe} onChange={(e) => changePerson(index, { wardrobe: e.target.value as GroupPersonInput['wardrobe'], outfitConfirmed: false })}><option value="locked">锁定原角色服装</option><option value="swimwear">转译为角色主题泳装</option></select></label>
              {person.wardrobe === 'swimwear' && <><div className="soft-warning">只解锁这一人的服装、材质、配件和鞋袜；其他人物不跟随换装。</div><label className="field-label">泳装设计要求（可选）<Input list={`outfits-${job.id}`} value={person.outfitDirection} maxLength={500} onChange={(e) => changePerson(index, { outfitDirection: e.target.value })} /></label><label className="consent-row"><Checkbox checked={person.outfitConfirmed} onCheckedChange={(v) => changePerson(index, { outfitConfirmed: v === true })} /><span>允许这位成年角色换装，仍锁定身份、身材、妆发和瞳色。</span></label></>}
            </div>;
          })}</div>
          {sourceJobs.length < 2 && <div className="soft-info">还需要另一位角色：新建一个单人作品，完成基准图和面部验收后，即可在这里选择。无需重新导入已完成的角色。</div>}
          {duplicate && <p role="alert" className="text-sm text-amber-200">每个人应来自不同作品，不能用同一角色的两张图充当两个人。</p>}
          <datalist id={`outfits-${job.id}`}>{pack?.kind === 'variable_pool' && pack.pools.outfitStyle.map((v) => <option key={v} value={v}>{v}</option>)}</datalist>
          <label className="field-label">共同事件<Textarea value={event} maxLength={2000} placeholder="例如：A 将一杯冰饮递给 B；B 伸手接杯并笑着回应。所有人围绕这一件事互动。" onChange={(e) => setEvent(e.target.value)} /></label>
          {pack?.kind === 'variable_pool' && Boolean(pack.groupInteractions?.length) && <label className="field-label">从方案包选一个事件<select className="native-select" value="" onChange={(e) => setEvent(e.target.value)}><option value="">选取后仍可修改</option>{pack.groupInteractions?.filter((v) => ![...v.matchAll(/角色\s*([ABCD])/g)].some((match) => 'ABCD'.indexOf(match[1]) >= people.length)).map((v) => <option key={v} value={v}>{v}</option>)}</select></label>}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field-label">一种成像介质<Input list={`media-${job.id}`} value={medium} maxLength={500} onChange={(e) => setMedium(e.target.value)} placeholder="选择方案包建议或填写，例如自然手机抓拍" /><datalist id={`media-${job.id}`}>{pack?.kind === 'variable_pool' && pack.imagingMedia?.map((v) => <option key={v} value={v}>{v}</option>)}</datalist></label>
            <label className="field-label">目标画幅<select className="native-select" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}>{['source', '1:1', '4:3', '3:4', '16:9', '9:16'].map((value) => <option key={value} value={value}>{value === 'source' ? '跟随角色 A 源图' : value}</option>)}</select></label>
          </div>
          <details className="version-details"><summary>可选：锁定共享场景、机位和光线</summary><div className="grid gap-3 md:grid-cols-2">{photographyPoolMeta.filter((entry) => ['scene', 'shotScale', 'focalLength', 'cameraPosition', 'composition', 'lighting'].includes(entry.key)).map((entry) => <label className="field-label" key={entry.key}>{entry.label}<Input list={`group-${job.id}-${entry.key}`} value={locks[entry.key as ReshootLockKey] || ''} maxLength={500} placeholder="留空时从摄影包抽取" onChange={(e) => setLocks((current) => ({ ...current, [entry.key]: e.target.value }))} /><datalist id={`group-${job.id}-${entry.key}`}>{pack?.kind === 'variable_pool' && pack.pools[entry.key].map((v) => <option key={v} value={v}>{v}</option>)}</datalist></label>)}</div></details>
          <label className="field-label">可选场景参考 · 只控制环境，不控制人物<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { setUploadError('请上传不超过 20 MB 的 PNG、JPG 或 WEBP'); return; } void fileToDataUrl(file).then((url) => { setSceneReference(url); setUploadError(''); }).catch(() => setUploadError('图片读取失败，请重新选择')); }} /></label>
          {uploadError && <p role="alert">{uploadError}</p>}{sceneReference && <div className="flex items-center gap-3"><img src={sceneReference} alt="共享场景参考" className="h-28 w-40 rounded-lg object-contain" /><Button variant="outline" onClick={() => setSceneReference('')}>移除场景参考</Button></div>}
          <OutputResolutionNotice aspectRatio={aspectRatio} source={selectedSource(people[0]).image} />
          <Button disabled={!pack || participantError || duplicate || !event.trim() || !medium.trim()} onClick={() => void createDraft()}><Sparkles /> 准备合影 Prompt（不生图）</Button>
        </fieldset>
      </CardContent></Card>
    {batch?.status === 'draft' && <Card className="studio-card"><CardHeader><CardTitle>确认多人方案</CardTitle><CardDescription>当前草稿已冻结 {batch.multiPerson?.participants.length} 位人物和输入版本。上方修改需再次点“准备合影 Prompt”才能写入此草稿。</CardDescription></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{batch.multiPerson?.participants.map((p) => `${p.label}：${p.name} / ${p.outputId} / ${p.position}`).join('；')}</p>
      {batch.variants.map((v) => <label className="field-label" key={v.id}>完整 Prompt<Textarea className="min-h-80" maxLength={20000} disabled={!editable} value={prompts[v.id] ?? v.compiledPrompt} onChange={(e) => setPrompts((current) => ({ ...current, [v.id]: e.target.value }))} /></label>)}
      <GenerationBackendSelector value={backend} onChange={setBackend} disabled={!editable} />
      <div className="flex flex-wrap gap-3"><Button disabled={!editable} onClick={() => void mutate(async () => { await api.updateReshootDraft(job.id, batch.id, { variants: batch.variants.map((v) => ({ id: v.id, compiledPrompt: prompts[v.id] ?? v.compiledPrompt })) }); await api.confirmReshootDraft(job.id, batch.id, backend); }, backend === 'chatgpt-web-manual' ? '多人网页交接已准备' : '多人合影已加入生成队列')}><Camera /> {backend === 'chatgpt-web-manual' ? '确认并准备网页交接' : '确认生成一张合影'}</Button><Button variant="outline" disabled={!editable} onClick={() => void mutate(() => api.discardReshoot(job.id, batch.id), '草稿已取消，原图和历史仍保留')}>取消此草稿</Button></div>
    </CardContent></Card>}
    {activeGroup?.status === 'waiting_user' ? <WebHandoffPanel run={activeGroup} mutate={mutate} /> : activeGroup && <RunProgress job={job} kind="reshoot" onRetry={() => {}} />}
    {latestGroup && ['failed', 'interrupted', 'cancelled'].includes(latestGroup.status) && <div className="soft-warning" aria-live="polite"><CircleAlert /><span>上次多人合影未完成，原图与输入已保留。{latestGroup.variants.map((v) => v.error?.message).filter(Boolean).join('；')} 可修改上方配置重新准备，或在下方“任务与分镜记录”中从失败方案建立新草稿；不会自动重试。</span></div>}
    {job.reshootVersions.filter((image) => image.mode === 'multi_person').length > 0 && <Card className="studio-card"><CardHeader><CardTitle>多人合影结果</CardTitle><CardDescription>请逐人检查身份、肢体归属和服装。再次创作回到各人的单人源图，不把合影输入单人调整。</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">{[...job.reshootVersions].reverse().filter((image) => image.mode === 'multi_person').map((image) => <div key={image.id} className="space-y-3"><a href={assetUrl(image.url)} target="_blank" rel="noreferrer"><img src={assetUrl(image.url)} alt={`${image.multiPerson?.participants.length} 人合影 ${image.id}`} className="max-h-[520px] w-full rounded-xl object-contain" /></a><p>{image.id} · {backendLabels[image.backend]}</p><OutputDimensions image={image} /><details className="version-details"><summary>人物来源与完整 Prompt</summary><p>{image.multiPerson?.participants.map((p) => `${p.label}：${p.name} / ${p.outputId}`).join('；')}</p><pre>{image.prompt}</pre></details><Button variant="outline" disabled={!editable} onClick={() => restore(image)}>载入原始人物，再拍一张</Button></div>)}</CardContent></Card>}
  </div>;
}

function CreativeReshootPanel({
  job,
  prompts,
  photographyPacks,
  mutate,
  onBack,
}: {
  job: GenerationJob;
  prompts: PromptModule[];
  photographyPacks: PhotographyPack[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  onBack: () => void;
}) {
  return (
    <>
      <TabsContent value="variable" keepMounted>
        <VariableReshootPanel job={job} prompts={prompts} photographyPacks={photographyPacks.filter((pack) => pack.kind === 'variable_pool')} mutate={mutate} onBack={onBack} />
      </TabsContent>
      <TabsContent value="series" keepMounted>
        <SeriesReshootPanel job={job} prompts={prompts} photographyPacks={photographyPacks.filter((pack) => pack.kind === 'series_plan')} mutate={mutate} onBack={onBack} />
      </TabsContent>
    </>
  );
}

function VariableReshootPanel({
  job,
  prompts,
  photographyPacks,
  mutate,
  onBack,
}: {
  job: GenerationJob;
  prompts: PromptModule[];
  photographyPacks: PhotographyPack[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  onBack: () => void;
}) {
  const outputs: OutputVersion[] = [
    ...job.baselineVersions,
    ...job.adjustmentVersions,
    ...(job.reshootVersions || []).filter((image) => image.mode !== 'multi_person'),
  ];
  const [selectedId, setSelectedId] = useState(
    job.selectedOutputId || outputs.at(-1)?.id || '',
  );
  const [packId, setPackId] = useState(photographyPacks[0]?.id || '');
  const [realismStyleId, setRealismStyleId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('source');
  const [creative, setCreative] = useState<CreativePolicy>(initialCreativePolicy);
  const [outfitReference, setOutfitReference] = useState('');
  const allowOutfit = creative.mode === 'character';
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [locks, setLocks] = useState<Partial<Record<ReshootLockKey, string>>>({});
  const [backend, setBackend] = useGenerationBackendPreference();
  const [variantPrompts, setVariantPrompts] = useLocalDraft<Record<string, string>>(`variable-prompts:${job.id}`, {});
  useEffect(() => {
    if (!photographyPacks.some((pack) => pack.id === packId))
      queueMicrotask(() => setPackId(photographyPacks[0]?.id || ''));
  }, [packId, photographyPacks]);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(RESHOOT_QUANTITY_STORAGE_KEY) || 1);
    if (Number.isInteger(saved) && saved >= 1 && saved <= 4)
      queueMicrotask(() => setQuantity(saved));
  }, []);
  const active = getActiveRun(job);
  const batch =
    job.reshootBatches?.find((item) => item.id === job.activeReshootBatchId && item.mode === 'variable_pool') ||
    [...(job.reshootBatches || [])].reverse().find((item) => item.mode === 'variable_pool' && item.status === 'draft') ||
    null;
  const batchSnapshot = batch
    ? JSON.stringify({ id: batch.id, updatedAt: batch.updatedAt, variants: batch.variants })
    : '';
  useEffect(() => {
    if (!batchSnapshot) return;
    const snapshot = JSON.parse(batchSnapshot) as {
      variants: Array<{ id: string; compiledPrompt: string }>;
    };
    queueMicrotask(() =>
      setVariantPrompts((current) => ({ ...Object.fromEntries(snapshot.variants.map((item) => [item.id, item.compiledPrompt])), ...current })),
    );
  }, [batchSnapshot, setVariantPrompts]);
  const source = batch?.sourceImage || outputs.find((output) => output.id === selectedId) || outputs.at(-1);
  const manualRun =
    active?.kind === 'reshoot' &&
    batch?.mode === 'variable_pool' && active.id === batch.runId &&
    active.status === 'waiting_user' &&
    active.backend === 'chatgpt-web-manual'
      ? active
      : null;
  const createDraft = () =>
    mutate(
      () => {
        window.localStorage.setItem(RESHOOT_QUANTITY_STORAGE_KEY, String(quantity));
        return api.createReshootDraft(job.id, {
          realismStyleId: realismStyleId || null,
          sourceOutputId: source?.id,
          packId,
          quantity,
          aspectRatio,
          allowOutfit,
          adultConfirmed,
          creativePolicy: creative,
          outfitReferenceDataUrl: outfitReference || undefined,
          locks,
        });
      },
      `已生成 ${quantity} 条可编辑重拍方案，尚未调用 imagegen`,
    );
  const savePrompts = async () => {
    if (!batch) return;
    await api.updateReshootDraft(
      job.id,
      batch.id,
      {
        variants: batch.variants.map((variant) => ({
          id: variant.id,
          compiledPrompt: variantPrompts[variant.id] || variant.compiledPrompt,
        })),
      },
    );
  };
  const confirm = () =>
    batch &&
    mutate(async () => {
      await savePrompts();
      await api.confirmReshootDraft(job.id, batch.id, backend);
    }, backend === 'chatgpt-web-manual' ? '网页版重拍批次素材已准备' : '创意重拍已进入 Codex 队列');
  const reroll = (variantId?: string) => batch && mutate(async () => {
    if (!variantId && !window.confirm('整体重抽会替换本批摄影方案。当前编辑将先保存，是否继续？')) return;
    await savePrompts();
    const result = await api.rerollReshootDraft(job.id, batch.id, variantId);
    const next = result.reshootBatches.find((item) => item.id === batch.id);
    setVariantPrompts((current) => ({ ...current, ...Object.fromEntries((next?.variants || []).filter((item) => !variantId || item.id === variantId).map((item) => [item.id, item.compiledPrompt])) }));
  }, '所选方案已重抽，其他编辑保持不变');
  if (!source) {
    return (
      <Card className="studio-card">
        <CardContent className="pt-6">
          <EmptyState
            icon={Camera}
            title="还没有可重拍的源图"
            description="先返回上一步生成一张基准还原图。"
            action={<Button variant="outline" onClick={onBack}><ArrowLeft /> 返回生成基准图</Button>}
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <Card className="studio-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>创意重拍源版本</CardTitle>
              <CardDescription>可以从基准图、调整图或旧重拍图继续分支。</CardDescription>
            </div>
            <Button variant="outline" disabled={Boolean(active)} onClick={onBack}>
              <ArrowLeft /> 返回脸模与风格
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="version-rail">
            {outputs.map((output) => (
              <button
                key={output.id}
                disabled={Boolean(active) || batch?.status === 'draft'}
                className={cx('version-tile', selectedId === output.id && 'version-tile-active')}
                onClick={() => {
                  setSelectedId(output.id);
                  void mutate(() => api.selectOutput(job.id, output.id), `已选择 ${output.id} 作为重拍源图`);
                }}
              >
                <img src={assetUrl(output.url)} alt={output.id} />
                <span>{output.id}</span>
                {output.kind !== 'baseline' && <small>源自 {output.sourceOutputId}</small>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      {manualRun && <WebHandoffPanel run={manualRun} mutate={mutate} />}
      {active?.kind === 'reshoot' && !manualRun && (
        <Card className="studio-card"><CardContent className="pt-6"><RunProgress job={job} kind="reshoot" onRetry={() => {}} /></CardContent></Card>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="studio-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div><CardTitle>当前源图</CardTitle><CardDescription>{source.id} · 从这张图重拍</CardDescription></div>
              <Badge variant="outline"><GitBranch /> {source.kind}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <img className="baseline-preview" src={assetUrl(source.url)} alt="创意重拍源图" />
            <OutputDimensions image={source} />
            <FaceInspection job={job} source={source} mutate={mutate} />
            <div className="version-meta">
              <Badge variant="outline">人物身份锁定</Badge>
              <Badge variant="outline">角色发型与瞳色锁定</Badge>
              <Badge variant="outline">服装{(batch?.allowOutfit ?? allowOutfit) ? '已解锁' : '锁定'}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="studio-card">
          <CardHeader><CardTitle>生成摄影方案</CardTitle><CardDescription>先生成 1–4 条草稿，确认后才调用图片工具。</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <RealismStyleSelector prompts={prompts} value={batch ? batch.realismStyleSnapshot?.id || '' : realismStyleId} snapshot={batch?.realismStyleSnapshot} disabled={Boolean(batch) || Boolean(active)} onChange={setRealismStyleId} />
            <PhotographyMethodNotice stage="reshoot" />
            <OutputResolutionNotice aspectRatio={batch?.aspectRatio || aspectRatio} source={source} saved={batch?.outputResolution} />
            {batch || photographyPacks.length ? (
              <label className="field-label">摄影方案包
                <select className="native-select" value={batch?.packId || packId} onChange={(event) => setPackId(event.target.value)} disabled={Boolean(batch)}>
                  {(batch?.packSnapshot ? [batch.packSnapshot] : photographyPacks).map((pack) => <option value={pack.id} key={pack.id}>{pack.name} · v{pack.version}</option>)}
                </select>
              </label>
            ) : (
              <div className="soft-warning"><CircleAlert /><span>还没有摄影方案包。请先到 Prompt 库导入并确认。</span></div>
            )}
            <label className="field-label">输出数量
              <select className="native-select" value={batch?.quantity ?? quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={Boolean(batch)}>
                {[1, 2, 3, 4].map((count) => <option value={count} key={count}>{count} 张不同方案</option>)}
              </select>
            </label>
            <label className="field-label">目标画幅
              <select className="native-select" value={batch?.aspectRatio || aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)} disabled={Boolean(batch)}>
                {aspectRatioMeta.map((item) => <option value={item.id} key={item.id}>{item.id === 'source' ? '跟随源图' : item.label}</option>)}
              </select>
            </label>
            <details className="version-details">
              <summary>锁定摄影变量（可选）</summary>
              <div className="reshoot-lock-grid">
                {reshootLockMeta.map((item) => (
                  <label className="field-label" key={item.key}>{item.label}
                    <Input
                      value={(batch?.locks || locks)[item.key] || ''}
                      disabled={Boolean(batch)}
                      onChange={(event) => setLocks((current) => ({ ...current, [item.key]: event.target.value }))}
                      placeholder="留空则自动抽取"
                    />
                  </label>
                ))}
              </div>
            </details>
            <CreativeWardrobeControls value={batch?.creativePolicy || (batch ? { ...initialCreativePolicy, mode: batch.allowOutfit ? 'character' : 'original' } : creative)} onChange={setCreative} adultConfirmed={batch?.adultConfirmed ?? adultConfirmed} onAdultChange={setAdultConfirmed} reference={outfitReference} onReferenceChange={setOutfitReference} savedReference={assetUrl(batch?.outfitReference?.url)} disabled={Boolean(batch) || Boolean(active)} />
            {!batch && (
              <Button
                className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
                disabled={!packId || Boolean(active) || faceReviewState(job, source).blocked || (allowOutfit && !adultConfirmed)}
                onClick={() => void createDraft()}
              ><Shuffle /> 生成方案（不生图）</Button>
            )}
            {batch?.status === 'draft' && (
              <div className="soft-info"><ShieldCheck /><span>方案已冻结源图和方案包 v{batch.packVersion} 快照。可以在左侧编辑完整 Prompt。</span></div>
            )}
          </CardContent>
        </Card>
      </div>
      {batch?.status === 'draft' && (
        <Card className="studio-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>确认重拍 Prompt</CardTitle><CardDescription>每张都有独立随机种子和变量组合；可以单独重抽或手动编辑。</CardDescription></div>
              <div className="flex gap-2"><Button variant="outline" onClick={() => void mutate(async () => { await savePrompts(); await api.discardReshoot(job.id, batch.id); }, '草稿已保留，可以修改配置并创建新方案')}>返回修改配置</Button><Button variant="outline" onClick={() => void reroll()}><Shuffle /> 整体重抽</Button></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {batch.variants.map((variant) => (
              <div className="reshoot-variant" key={variant.id}>
                <div className="reshoot-variant-heading">
                  <div><b>方案 {String(variant.index).padStart(2, '0')}</b><small>seed · {variant.seed}</small></div>
                  <Button size="sm" variant="outline" onClick={() => void reroll(variant.id)}><RefreshCw /> 单独重抽</Button>
                </div>
                <div className="reshoot-variable-chips">
                  {Object.entries(variant.selections).map(([key, value]) => <span key={key}>{photographyPoolMeta.find((item) => item.key === key)?.label || key} · {value}</span>)}
                </div>
                <Textarea
                  className="min-h-72 font-mono text-xs"
                  value={variantPrompts[variant.id] ?? variant.compiledPrompt}
                  onChange={(event) => setVariantPrompts((current) => ({ ...current, [variant.id]: event.target.value }))}
                />
                <PhotoConflictNotice text={variantPrompts[variant.id] ?? variant.compiledPrompt} />
              </div>
            ))}
            <GenerationBackendSelector value={backend} onChange={setBackend} />
            <div className="panel-actions">
              <Button variant="outline" onClick={() => void mutate(savePrompts, '重拍 Prompt 草稿已保存')}>保存草稿</Button>
              <Button
                className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
                disabled={faceReviewState(job, source).blocked || batch.variants.some((variant) => !(variantPrompts[variant.id] || variant.compiledPrompt).trim())}
                onClick={() => void confirm()}
              ><Camera /> {backend === 'chatgpt-web-manual' ? '准备网页版批次' : `确认生成 ${batch.quantity} 张`}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {(job.reshootBatches || []).some((item) => ['succeeded', 'partial', 'failed'].includes(item.status)) && (
        <Card className="studio-card">
          <CardHeader><CardTitle>重拍批次历史</CardTitle><CardDescription>成功图片会保留；失败方案不会静默重试。</CardDescription></CardHeader>
          <CardContent className="execution-log">
            {[...(job.reshootBatches || [])].reverse().filter((item) => item.mode === 'variable_pool' && item.status !== 'draft').map((item) => (
              <div key={item.id}><Badge variant="outline">{item.status}</Badge><b>{item.packSnapshot?.name} · {item.quantity} 张</b><span>{formatTime(item.createdAt)} · {item.backend ? backendLabels[item.backend] : '未执行'}</span></div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SeriesPlanEditor({
  draft,
  references,
  onChange,
}: {
  draft: SeriesPlanDraft;
  references: GenerationJob['reshootBatches'][number]['photographyReferences'];
  onChange: (draft: SeriesPlanDraft) => void;
}) {
  const updateSetup = (index: number, patch: Partial<SeriesPlanDraft['lightingSetups'][number]>) =>
    onChange({ ...draft, lightingSetups: draft.lightingSetups.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const updateShot = (index: number, patch: Partial<SeriesPlanDraft['shots'][number]>) =>
    onChange({ ...draft, shots: draft.shots.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const availableReferences = references.filter(
    (reference) => !draft.excludedReferenceIds.includes(reference.id),
  );
  const toggleExcludedReference = (referenceId: string, checked: boolean) => {
    const excludedReferenceIds = checked
      ? [...new Set([...draft.excludedReferenceIds, referenceId])]
      : draft.excludedReferenceIds.filter((id) => id !== referenceId);
    onChange({
      ...draft,
      excludedReferenceIds,
      lightingSetups: draft.lightingSetups.map((setup) => ({
        ...setup,
        referenceIds: checked
          ? setup.referenceIds.filter((id) => id !== referenceId)
          : setup.referenceIds,
      })),
      shots: draft.shots.map((shot) => ({
        ...shot,
        mainReferenceId:
          checked && shot.mainReferenceId === referenceId
            ? draft.lightingSetups
                .find((setup) => setup.id === shot.lightingSetupId)
                ?.referenceIds.find((id) => !excludedReferenceIds.includes(id)) || ''
            : shot.mainReferenceId,
        auxiliaryReferenceIds: checked
          ? shot.auxiliaryReferenceIds.filter((id) => id !== referenceId)
          : shot.auxiliaryReferenceIds,
      })),
    });
  };
  return (
    <div className="space-y-5">
      <div className="photography-pool-grid">
        {([
          ['theme', '主题世界'], ['editorialTone', '编辑气质'], ['makeupHair', '妆发母体'],
          ['wardrobe', '服装体系'], ['sceneProps', '场景与道具'],
        ] as const).map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea value={draft.commonPackage[key]} onChange={(event) => onChange({ ...draft, commonPackage: { ...draft.commonPackage, [key]: event.target.value } })} /></label>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="field-label">成像机制<Textarea className="min-h-36" value={draft.imagingProfile} onChange={(event) => onChange({ ...draft, imagingProfile: event.target.value })} /></label>
        <label className="field-label">画面信息层级<Textarea className="min-h-36" value={draft.visualHierarchy} onChange={(event) => onChange({ ...draft, visualHierarchy: event.target.value })} /></label>
      </div>
      <div className="field-label">
        离群参考（不参与企划与生成）
        <div className="flex flex-wrap gap-2">
          {references.map((reference) => (
            <label className="consent-row" key={reference.id}>
              <Checkbox
                checked={draft.excludedReferenceIds.includes(reference.id)}
                onCheckedChange={(checked) =>
                  toggleExcludedReference(reference.id, checked === true)
                }
              />
              <span>{reference.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-3"><h3 className="font-medium">布光子方案</h3>{draft.lightingSetups.map((setup, index) => (
        <div className="reshoot-variant" key={setup.id}>
          <div className="grid gap-3 md:grid-cols-2"><label className="field-label">名称<Input value={setup.name} onChange={(event) => updateSetup(index, { name: event.target.value })} /></label><div className="field-label">包含参考图<div className="flex flex-wrap gap-2">{availableReferences.map((reference) => <label className="consent-row" key={reference.id}><Checkbox checked={setup.referenceIds.includes(reference.id)} onCheckedChange={(checked) => updateSetup(index, { referenceIds: checked ? [...setup.referenceIds, reference.id] : setup.referenceIds.filter((id) => id !== reference.id) })} /><span>{reference.name}</span></label>)}</div></div></div>
          <label className="field-label">布光与曝光<Textarea value={setup.description} onChange={(event) => updateSetup(index, { description: event.target.value })} /></label>
          <label className="field-label">世界空间光照拓扑<Textarea value={setup.topology} onChange={(event) => updateSetup(index, { topology: event.target.value })} /></label>
        </div>
      ))}</div>
      <div className="space-y-3"><h3 className="font-medium">新分镜</h3>{draft.shots.map((shot, index) => (
        <div className="reshoot-variant" key={shot.id}>
          <div className="reshoot-variant-heading"><b>P{String(index + 1).padStart(2, '0')} · {shot.title}</b><Badge variant="outline">{shot.lightingSetupId}</Badge></div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="field-label">分镜名称<Input value={shot.title} onChange={(event) => updateShot(index, { title: event.target.value })} /></label>
            <label className="field-label">布光子方案<select className="native-select" value={shot.lightingSetupId} onChange={(event) => updateShot(index, { lightingSetupId: event.target.value, mainReferenceId: draft.lightingSetups.find((setup) => setup.id === event.target.value)?.referenceIds.filter((id) => !draft.excludedReferenceIds.includes(id))[0] || '', auxiliaryReferenceIds: [] })}>{draft.lightingSetups.map((setup) => <option value={setup.id} key={setup.id}>{setup.name || setup.id}</option>)}</select></label>
            <label className="field-label">主摄影参考<select className="native-select" value={shot.mainReferenceId} onChange={(event) => updateShot(index, { mainReferenceId: event.target.value, auxiliaryReferenceIds: shot.auxiliaryReferenceIds.filter((id) => id !== event.target.value) })}>{availableReferences.filter((reference) => draft.lightingSetups.find((setup) => setup.id === shot.lightingSetupId)?.referenceIds.includes(reference.id)).map((reference) => <option value={reference.id} key={reference.id}>{reference.name}</option>)}</select></label>
          </div>
          <div className="field-label">辅助参考（最多两张）<div className="flex flex-wrap gap-2">{availableReferences.filter((reference) => reference.id !== shot.mainReferenceId && Boolean(draft.lightingSetups.find((setup) => setup.id === shot.lightingSetupId)?.referenceIds.includes(reference.id))).map((reference) => <label className="consent-row" key={reference.id}><Checkbox checked={shot.auxiliaryReferenceIds.includes(reference.id)} onCheckedChange={(checked) => { const next = checked ? [...shot.auxiliaryReferenceIds, reference.id].slice(0, 2) : shot.auxiliaryReferenceIds.filter((id) => id !== reference.id); updateShot(index, { auxiliaryReferenceIds: next }); }} /><span>{reference.name}</span></label>)}</div></div>
          <div className="photography-pool-grid">{([
            ['shotScale', '景别'], ['camera', '机位与镜头'], ['composition', '构图'],
            ['subjectEvent', '现场触发事件'], ['expressionResponse', '表情与身体响应'],
            ['poseGazeProps', '动作、视线与道具'], ['lightingPrediction', '新机位光照预测'],
            ['customPrompt', '补充指令'],
          ] as const).map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea value={shot[key]} onChange={(event) => updateShot(index, { [key]: event.target.value })} /></label>)}</div>
        </div>
      ))}</div>
    </div>
  );
}

function SeriesQualityCard({
  job,
  output,
  mutate,
}: {
  job: GenerationJob;
  output: GenerationJob['reshootVersions'][number];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const initialAxes = Object.fromEntries(qualityAxisMeta.map(([key]) => [key, output.qualityReview?.axes[key] || { status: 'unreviewed', note: '' }]));
  const [axes, setAxes] = useState(initialAxes);
  const [technicalIssues, setTechnicalIssues] = useState((output.qualityReview?.technicalIssues || []).join('\n'));
  const [summary, setSummary] = useState(output.qualityReview?.summary || '');
  const save = (confirmFinal = false) => mutate(
    () => api.updateReshootQuality(job.id, output.batchId, output.variantId, {
      axes,
      technicalIssues: technicalIssues.split('\n').map((item) => item.trim()).filter(Boolean),
      summary,
      reviewer: 'user',
      confirmFinal,
    }),
    confirmFinal ? `${output.id} 已标记为最终采用` : `${output.id} 的质量检查已保存`,
  );
  return (
    <><OutputDimensions image={output} /><details className="version-details">
      <summary><span>{output.id} · 质量验收</span><Badge variant="outline">{output.qualityReview?.adoptionStatus || '待验收'}</Badge></summary>
      <div className="space-y-3 pt-3">
        <div className="photography-pool-grid">{qualityAxisMeta.map(([key, label]) => {
          const value = axes[key] as { status: string; note: string };
          return <div className="field-label" key={key}><span>{label}</span><select className="native-select" value={value.status} onChange={(event) => setAxes((current) => ({ ...current, [key]: { ...value, status: event.target.value } }))}><option value="unreviewed">未检查</option><option value="pass">通过</option><option value="warn">需留意</option><option value="fail">未通过</option></select><Input value={value.note} onChange={(event) => setAxes((current) => ({ ...current, [key]: { ...value, note: event.target.value } }))} placeholder="检查说明" /></div>;
        })}</div>
        <label className="field-label">人体、身份或角色技术问题（每行一条）<Textarea value={technicalIssues} onChange={(event) => setTechnicalIssues(event.target.value)} /></label>
        <label className="field-label">验收摘要<Textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <div className="panel-actions"><Button variant="outline" onClick={() => void save(false)}>保存检查</Button><Button className="bg-violet-300 text-zinc-950 hover:bg-violet-200" disabled={Object.values(axes).some((item) => (item as { status: string }).status !== 'pass')} onClick={() => void save(true)}><Check /> 确认最终采用</Button></div>
      </div>
    </details></>
  );
}

function SeriesReshootPanel({
  job,
  prompts,
  photographyPacks,
  mutate,
  onBack,
}: {
  job: GenerationJob;
  prompts: PromptModule[];
  photographyPacks: PhotographyPack[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  onBack: () => void;
}) {
  const outputs: OutputVersion[] = [...job.baselineVersions, ...job.adjustmentVersions, ...(job.reshootVersions || []).filter((image) => image.mode !== 'multi_person')];
  const [selectedId, setSelectedId] = useState(job.selectedOutputId || outputs.at(-1)?.id || '');
  const [packId, setPackId] = useState(photographyPacks[0]?.id || '');
  const [realismStyleId, setRealismStyleId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('source');
  const [creative, setCreative] = useState<CreativePolicy>(initialCreativePolicy);
  const [outfitReference, setOutfitReference] = useState('');
  const allowOutfit = creative.mode === 'character';
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [locks, setLocks] = useState<Partial<Record<ReshootLockKey, string>>>({});
  const [referenceInputs, setReferenceInputs] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [referenceError, setReferenceError] = useState('');
  const [backend, setBackend] = useGenerationBackendPreference();
  const [savedPlans, setSavedPlans] = useLocalDraft<Record<string, SeriesPlanDraft>>(`series-plans:${job.id}`, {});
  const [variantPrompts, setVariantPrompts] = useLocalDraft<Record<string, string>>(`series-prompts:${job.id}`, {});
  const [redoTarget, setRedoTarget] = useState('');
  const [redoFeedback, setRedoFeedback] = useState('');
  useEffect(() => {
    if (!photographyPacks.some((pack) => pack.id === packId))
      queueMicrotask(() => setPackId(photographyPacks[0]?.id || ''));
  }, [packId, photographyPacks]);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(RESHOOT_QUANTITY_STORAGE_KEY) || 1);
    if (Number.isInteger(saved) && saved >= 1 && saved <= 4)
      queueMicrotask(() => setQuantity(saved));
  }, []);
  const active = getActiveRun(job);
  const batch = job.reshootBatches?.find((item) => item.id === job.activeReshootBatchId && item.mode === 'series_plan') || [...job.reshootBatches].reverse().find((item) => item.mode === 'series_plan' && ['plan_ready', 'draft'].includes(item.status)) || null;
  const planDraft = batch ? savedPlans[batch.id] || batch.seriesPlanDraft : null;
  useUploadGuard(Boolean(referenceInputs.length && !batch));
  const setPlanDraft = (next: SeriesPlanDraft) => { if (batch) setSavedPlans((current) => ({ ...current, [batch.id]: next })); };
  const source = batch?.sourceImage || outputs.find((output) => output.id === selectedId) || outputs.at(-1);
  const seriesOutputs = job.reshootVersions.filter((output) => output.mode === 'series_plan');
  const manualRun = active?.kind === 'reshoot' && active.status === 'waiting_user' && active.backend === 'chatgpt-web-manual' && batch?.mode === 'series_plan' ? active : null;
  const batchSnapshot = batch ? JSON.stringify({ id: batch.id, plan: batch.seriesPlanDraft, variants: batch.variants }) : '';
  useEffect(() => {
    if (!batchSnapshot) return;
    const snapshot = JSON.parse(batchSnapshot) as { id: string; plan: SeriesPlanDraft | null; variants: Array<{ id: string; compiledPrompt: string }> };
    queueMicrotask(() => {
      setVariantPrompts((current) => ({ ...Object.fromEntries(snapshot.variants.map((item) => [item.id, item.compiledPrompt])), ...current }));
    });
  }, [batchSnapshot, setVariantPrompts]);
  const chooseReferences = async (files: FileList | null) => {
    try {
      const selected = [...(files || [])];
      if (!selected.length) return;
      if (selected.length > 8) throw new Error('最多上传 8 张写真参考图');
      for (const file of selected) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024)
          throw new Error(`${file.name} 格式不支持或超过 20 MB`);
      }
      setReferenceInputs(await Promise.all(selected.map(async (file) => ({ name: file.name, dataUrl: await fileToDataUrl(file) }))));
      setReferenceError('');
    } catch (error) {
      setReferenceInputs([]);
      setReferenceError(error instanceof Error ? error.message : '写真参考图读取失败');
    }
  };
  const createPlan = () => mutate(() => {
    window.localStorage.setItem(RESHOOT_QUANTITY_STORAGE_KEY, String(quantity));
    return api.createSeriesPlanReshoot(job.id, {
      realismStyleId: realismStyleId || null,
      sourceOutputId: source?.id,
      packId,
      quantity,
      aspectRatio,
      allowOutfit,
      adultConfirmed,
      locks,
      photographyReferences: referenceInputs,
      creativePolicy: creative,
      outfitReferenceDataUrl: outfitReference || undefined,
    });
  }, '写真参考已进入 Codex 企划解析队列');
  const savePlan = async () => {
    if (!batch || !planDraft) return;
    await api.updateSeriesPlanDraft(job.id, batch.id, planDraft);
  };
  const compilePlan = () => batch && planDraft && mutate(async () => {
    await savePlan();
    const compiled = await api.compileSeriesPlan(job.id, batch.id);
    const variants = compiled.reshootBatches.find((item) => item.id === batch.id)?.variants || [];
    setVariantPrompts((current) => ({ ...current, ...Object.fromEntries(variants.map((item) => [item.id, item.compiledPrompt])) }));
  }, '系列企划已冻结，完整 Prompt 已生成');
  const savePrompts = async () => {
    if (!batch) return;
    await api.updateReshootDraft(job.id, batch.id, { variants: batch.variants.map((variant) => ({ id: variant.id, compiledPrompt: variantPrompts[variant.id] || variant.compiledPrompt })) });
  };
  const confirm = () => batch && mutate(async () => {
    await savePrompts();
    await api.confirmReshootDraft(job.id, batch.id, backend);
  }, backend === 'chatgpt-web-manual' ? '网页版系列写真素材已准备' : '系列写真已进入 Codex 队列');
  if (!source) return <Card className="studio-card"><CardContent className="pt-6"><EmptyState icon={Aperture} title="还没有可用的真人 COS 源图" description="先返回上一步生成基准图。" action={<Button variant="outline" onClick={onBack}><ArrowLeft /> 返回生成基准图</Button>} /></CardContent></Card>;
  return (
    <div className="space-y-5">
      {manualRun && <WebHandoffPanel run={manualRun} mutate={mutate} />}
      {batch && ['queued', 'running', 'failed', 'interrupted'].includes(batch.status) && <Card className="studio-card"><CardContent className="space-y-3 pt-6"><RunProgress job={job} kind="series_deconstruct" onRetry={(runId) => void mutate(() => api.retryRun(runId), '系列写真解析已重新入队')} />{!active && <Button variant="outline" onClick={() => void mutate(() => api.discardReshoot(job.id, batch.id), '旧批次已保留，请修改参考后重新解析')}>放弃本次，返回修改参考</Button>}</CardContent></Card>}
      {batch && ['plan_ready', 'draft'].includes(batch.status) && !active && <div className="flex gap-2">{batch.status === 'draft' && <Button variant="outline" onClick={() => void mutate(async () => { await savePrompts(); await api.discardReshoot(job.id, batch.id, true); }, '已返回企划，手改 Prompt 保存在历史中')}>返回企划编辑</Button>}<Button variant="outline" onClick={() => void mutate(() => api.discardReshoot(job.id, batch.id), '本批次已保留，可以重新选择参考和配置')}>放弃本草稿，修改配置</Button></div>}
      {active?.kind === 'reshoot' && batch?.mode === 'series_plan' && !manualRun && <Card className="studio-card"><CardContent className="pt-6"><RunProgress job={job} kind="reshoot" onRetry={() => {}} /></CardContent></Card>}
      <FaceInspection job={job} source={source} mutate={mutate} />
      {!batch && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="studio-card"><CardHeader><CardTitle>系列写真源版本</CardTitle><CardDescription>人物身份和角色设计只来自这里。</CardDescription></CardHeader><CardContent><div className="version-rail">{outputs.map((output) => <button className={cx('version-tile', source.id === output.id && 'version-tile-active')} key={output.id} disabled={Boolean(active)} onClick={() => setSelectedId(output.id)}><img src={assetUrl(output.url)} alt={output.id} /><span>{output.id}</span></button>)}</div><img className="baseline-preview mt-4" src={assetUrl(source.url)} alt="系列写真源图" /></CardContent></Card>
        <Card className="studio-card"><CardHeader><CardTitle>准备系列写真企划</CardTitle><CardDescription>先拆解参考组，不会立即调用图片工具。</CardDescription></CardHeader><CardContent className="space-y-4">
          <RealismStyleSelector prompts={prompts} value={realismStyleId} onChange={setRealismStyleId} disabled={Boolean(active)} />
          <PhotographyMethodNotice stage="series" />
          <OutputResolutionNotice aspectRatio={aspectRatio} source={source} />
          {photographyPacks.length ? <label className="field-label">系列企划包<select className="native-select" value={packId} onChange={(event) => setPackId(event.target.value)}>{photographyPacks.map((pack) => <option value={pack.id} key={pack.id}>{pack.name} · v{pack.version}</option>)}</select></label> : <div className="soft-warning"><CircleAlert /><span>还没有参考写真方案包，请先到 Prompt 库选择“参考写真”并导入你的摄影资料。</span></div>}
          <label className="field-label">写真参考组（1–8 张）<Input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void chooseReferences(event.target.files)} /></label>
          {referenceError && <div className="soft-warning"><CircleAlert /><span>{referenceError}</span></div>}
          {referenceInputs.length > 0 && <div className="reference-grid">{referenceInputs.map((item, index) => <div className="reference-card" key={`${item.name}-${index}`}><img src={item.dataUrl} alt={item.name} /><span>{item.name}</span></div>)}</div>}
          <div className="grid grid-cols-2 gap-3"><label className="field-label">输出数量<select className="native-select" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option value={count} key={count}>{count} 张</option>)}</select></label><label className="field-label">目标画幅<select className="native-select" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>{aspectRatioMeta.map((item) => <option value={item.id} key={item.id}>{item.id === 'source' ? '跟随源图' : item.label}</option>)}</select></label></div>
          <details className="version-details"><summary>用户锁定变量（可选）</summary><div className="reshoot-lock-grid pt-3">{reshootLockMeta.map((item) => <label className="field-label" key={item.key}>{item.label}<Input value={locks[item.key] || ''} onChange={(event) => setLocks((current) => ({ ...current, [item.key]: event.target.value }))} /></label>)}</div></details>
          <CreativeWardrobeControls value={creative} onChange={setCreative} adultConfirmed={adultConfirmed} onAdultChange={setAdultConfirmed} reference={outfitReference} onReferenceChange={setOutfitReference} disabled={Boolean(active)} />
          <Button className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200" disabled={!packId || !referenceInputs.length || Boolean(active) || faceReviewState(job, source).blocked || (allowOutfit && !adultConfirmed)} onClick={() => void createPlan()}><Aperture /> 解析写真企划（不生图）</Button>
        </CardContent></Card>
      </div>}
      {batch?.status === 'plan_ready' && planDraft && <Card className="studio-card"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>编辑系列写真企划</CardTitle><CardDescription>确认共同套餐、布光与每张分镜的参考职责。</CardDescription></div><Badge variant="outline">{batch.photographyReferences.length} 张原始参考</Badge></div></CardHeader><CardContent className="space-y-5"><SeriesPlanEditor draft={planDraft} references={batch.photographyReferences} onChange={(next) => { setPlanDraft(next); }} /><div className="panel-actions"><Button variant="outline" onClick={() => void mutate(savePlan, '系列企划草稿已保存')}>保存草稿</Button><Button className="bg-violet-300 text-zinc-950 hover:bg-violet-200" onClick={() => void compilePlan()}><Sparkles /> 确认企划并编译 Prompt</Button></div></CardContent></Card>}
{batch?.status === 'draft' && <Card className="studio-card"><CardHeader><CardTitle>确认系列写真 Prompt</CardTitle><CardDescription>每条 Prompt 已绑定本张主参考和同布光辅助参考。</CardDescription></CardHeader><CardContent className="space-y-4"><RealismStyleSelector prompts={prompts} value={batch.realismStyleSnapshot?.id || ''} snapshot={batch.realismStyleSnapshot} disabled onChange={() => {}} />{batch.variants.map((variant) => <div className="reshoot-variant" key={variant.id}><div className="reshoot-variant-heading"><b>P{String(variant.index).padStart(2, '0')} · {variant.shotSpec?.title}</b><small>{variant.referenceRoles?.map((item) => item.referenceId).join(' + ')}</small></div><Textarea className="min-h-72 font-mono text-xs" value={variantPrompts[variant.id] ?? variant.compiledPrompt} onChange={(event) => setVariantPrompts((current) => ({ ...current, [variant.id]: event.target.value }))} /><PhotoConflictNotice text={variantPrompts[variant.id] ?? variant.compiledPrompt} /></div>)}<GenerationBackendSelector value={backend} onChange={setBackend} /><div className="panel-actions"><Button variant="outline" onClick={() => void mutate(savePrompts, '系列写真 Prompt 已保存')}>保存 Prompt</Button><Button className="bg-violet-300 text-zinc-950 hover:bg-violet-200" disabled={faceReviewState(job, source).blocked} onClick={() => void confirm()}><Camera /> {backend === 'chatgpt-web-manual' ? '准备网页版批次' : `确认生成 ${batch.quantity} 张`}</Button></div></CardContent></Card>}
      {seriesOutputs.length > 0 && <Card className="studio-card"><CardHeader><CardTitle>系列写真结果与验收</CardTitle><CardDescription>质量检查不会自动触发返工；只有你能确认最终采用。</CardDescription></CardHeader><CardContent className="space-y-4">{seriesOutputs.map((output) => <div className="reshoot-variant" key={output.id}><div className="grid gap-4 md:grid-cols-[180px_1fr]"><img className="w-full rounded-xl" src={assetUrl(output.url)} alt={output.id} /><div><b>{output.id} · {output.shotSpec?.title}</b><p className="mt-2 text-sm text-muted-foreground">{output.qualityReview?.summary || '等待质量验收'}</p><SeriesQualityCard job={job} output={output} mutate={mutate} /></div></div></div>)}</CardContent></Card>}
      {seriesOutputs.length > 0 && !batch && <Card className="studio-card"><CardHeader><CardTitle>从原始输入返工</CardTitle><CardDescription>上一张结果只用于诊断，不会再次传给图片工具。</CardDescription></CardHeader><CardContent className="space-y-3"><select className="native-select" value={redoTarget} onChange={(event) => setRedoTarget(event.target.value)}><option value="">选择要返工的结果</option>{seriesOutputs.map((output) => <option value={output.id} key={output.id}>{output.id} · {output.shotSpec?.title}</option>)}</select><Textarea value={redoFeedback} onChange={(event) => setRedoFeedback(event.target.value)} placeholder="说明失败层：布光、成像、构图、表情或其他具体问题…" /><Button disabled={!redoTarget || !redoFeedback.trim()} onClick={() => { const output = seriesOutputs.find((item) => item.id === redoTarget); if (output) void mutate(() => api.recompileSeriesPlan(job.id, output.batchId, { variantId: output.variantId, diagnosticOutputId: output.id, feedback: redoFeedback }), '已从原始参考重新编译返工 Prompt'); }}><RotateCcw /> 创建返工批次</Button></CardContent></Card>}
    </div>
  );
}

function SingleAdjustmentPanel({
  job,
  prompts,
  mutate,
  retry,
  onBack,
}: {
  job: GenerationJob;
  prompts: PromptModule[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
  retry: (runId: string) => void;
  onBack: () => void;
}) {
  const outputs: OutputVersion[] = [
    ...job.baselineVersions,
    ...job.adjustmentVersions,
    ...(job.reshootVersions || []).filter((image) => image.mode !== 'multi_person'),
  ];
  const [selectedId, setSelectedId] = useLocalDraft(`adjustment-source:${job.id}`, job.selectedOutputId || outputs.at(-1)?.id || '');
  const [category, setCategory] = useLocalDraft<AdjustmentCategory>(`adjustment-category:${job.id}`, 'pose');
  const [request, setRequest] = useLocalDraft(`adjustment-request:${job.id}`, '');
  const [moduleId, setModuleId] = useLocalDraft(`adjustment-module:${job.id}`, '');
  const [adjustmentReference, setAdjustmentReference] = useState('');
  const [adjustmentReferenceName, setAdjustmentReferenceName] = useState('');
  const [adjustmentReferenceError, setAdjustmentReferenceError] = useState('');
  const [useAnnotation, setUseAnnotation] = useState(false);
  const [annotation, setAnnotation] = useState('');
  useUploadGuard(Boolean(adjustmentReference || annotation));
  const [backend, setBackend] = useGenerationBackendPreference();
  const active = getActiveRun(job);
  const blockingRun = isBlockingRun(active);
  const manualRun =
    active?.kind === 'adjustment' &&
    active.status === 'waiting_user' &&
    active.backend === 'chatgpt-web-manual'
      ? active
      : null;
  const source = outputs.find((output) => output.id === selectedId) || outputs.at(-1);
  const allowedModuleCategories: PromptCategory[] =
    category === 'pose'
      ? ['pose']
      : category === 'outfit'
        ? ['outfit']
      : category === 'background'
        ? ['scene_lighting']
        : category === 'body_proportion'
          ? ['body_proportion']
          : category === 'makeup'
            ? ['makeup']
            : category === 'hair_accessory'
              ? ['hair_accessory']
        : category === 'camera_lighting'
          ? ['camera_angle', 'scene_lighting', 'style']
          : [];
  const suggestions = prompts.filter((module) =>
    allowedModuleCategories.includes(module.category),
  );
  const submit = () =>
    mutate(async () => {
      await api.createAdjustment(job.id, {
        sourceOutputId: source?.id,
        category,
        request,
        promptModuleId: moduleId || null,
        annotationDataUrl: useAnnotation && annotation ? annotation : null,
        adjustmentReferenceDataUrl: adjustmentReference || null,
        backend,
      });
      setRequest('');
      setModuleId('');
      setAnnotation('');
      setUseAnnotation(false);
      setAdjustmentReference('');
      setAdjustmentReferenceName('');
      setAdjustmentReferenceError('');
    }, backend === 'chatgpt-web-manual' ? '网页版调整素材已准备完成' : '单项调整已进入 Codex 队列');
  if (!source) {
    return (
      <Card className="studio-card">
        <CardContent className="pt-6">
          <EmptyState
            icon={ImageIcon}
            title="还没有可调整的图片"
            description="先返回上一步生成一张基准还原图。"
            action={
              <Button variant="outline" onClick={onBack}>
                <ArrowLeft /> 返回生成基准图
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <Card className="studio-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>版本与分支</CardTitle>
              <CardDescription>
                选择任意基准图或调整图作为下一轮源图，旧图永不覆盖。
              </CardDescription>
            </div>
            <Button variant="outline" disabled={blockingRun} onClick={onBack}>
              <ArrowLeft /> 返回脸模与风格
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="version-rail">
            {outputs.map((output) => (
              <button
                key={output.id}
                disabled={Boolean(active)}
                className={cx('version-tile', selectedId === output.id && 'version-tile-active')}
                onClick={() => {
                  setSelectedId(output.id);
                  void mutate(() => api.selectOutput(job.id, output.id), `已选择 ${output.id} 作为调整源图`);
                }}
              >
                <img src={assetUrl(output.url)} alt={output.id} />
                <span>{output.id}</span>
                {output.kind !== 'baseline' && <small>源自 {output.sourceOutputId}</small>}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="studio-card">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>当前源图</CardTitle>
                <CardDescription>{source.id} · {formatTime(source.createdAt)}</CardDescription>
              </div>
              <Badge variant="outline"><GitBranch /> 从此版本继续</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <RunProgress job={job} kind="adjustment" onRetry={retry} />
            {manualRun && <WebHandoffPanel run={manualRun} mutate={mutate} />}
            <img className="baseline-preview" src={assetUrl(source.url)} alt="当前调整源图" />
            <OutputDimensions image={source} />
            <FaceInspection job={job} source={source} mutate={mutate} />
            <div className="version-meta">
              <Badge variant="outline">参考 v{source.referenceVersion}</Badge>
              <Badge variant="outline">角色卡 v{source.characterCardVersion}</Badge>
              <Badge variant="outline">配置 v{source.configurationVersion}</Badge>
              <Badge variant="outline">
                画幅 {source.actualRatio || (source.kind === 'adjustment' ? source.sourceAspectRatio : source.aspectRatio) || '跟随源图'}
              </Badge>
              <Badge variant="outline">{backendLabels[source.backend]}</Badge>
            </div>
            <details className="version-details">
              <summary>查看此版本的生成配置与 Prompt</summary>
              <div>
                {source.kind === 'baseline' ? (
                  <>
                    <p>类型：高忠实基准图</p>
                    <p>脸模：{source.faceSnapshot?.name || '原创真人面部'}</p>
                    <p>摄影风格：{source.styleSnapshot?.name || '默认真人摄影'}</p>
                  </>
                ) : source.kind === 'adjustment' ? (
                  <>
                    <p>类型：{adjustmentMeta[source.category].label}调整</p>
                    <p>来源：{source.sourceOutputId}</p>
                    <p>文字要求：{source.request || '未填写'}</p>
                    <p>Prompt 模块：{source.promptModule?.name || '未使用'}</p>
                    <p>调整参考图：{source.adjustmentReference ? '已使用' : '未使用'}</p>
                    {source.adjustmentReference && (
                      <img
                        className="saved-adjustment-reference"
                        src={assetUrl(source.adjustmentReference.url)}
                        alt="该版本使用的调整参考图"
                      />
                    )}
                  </>
                ) : (
                  <>
                    <p>类型：创意重拍</p>
                    <p>来源：{source.sourceOutputId}</p>
                    <p>{source.mode === 'full_prompt' ? `完整 Prompt：${source.templateSnapshot?.name} · v${source.templateSnapshot?.version}` : `摄影方案包：${source.packSnapshot?.name} · v${source.packVersion}`}</p>
                    {source.realismStyleSnapshot && <p>成像预设：{source.realismStyleSnapshot.name} · v{source.realismStyleSnapshot.version}</p>}
                    <p>随机种子：{source.seed}</p>
                  </>
                )}
                <pre>{source.prompt}</pre>
              </div>
            </details>
            {useAnnotation && (
              <div className="mt-4">
                <AnnotationCanvas imageUrl={assetUrl(source.url)} onChange={setAnnotation} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="studio-card">
          <CardHeader>
            <CardTitle>本轮只调整一项</CardTitle>
            <CardDescription>多项修改请分成连续版本，便于比较与回退。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="adjustment-grid">
              {(Object.keys(adjustmentMeta) as AdjustmentCategory[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cx('adjustment-choice', category === item && 'adjustment-choice-active')}
                  onClick={() => {
                    setCategory(item);
                    setModuleId('');
                  }}
                >
                  <b>{adjustmentMeta[item].label}</b>
                  <span>{adjustmentMeta[item].hint}</span>
                </button>
              ))}
            </div>
            <label className="field-label">
              修改要求（可选）
              <Textarea
                className="min-h-28"
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                placeholder={`只描述${adjustmentMeta[category].label}要如何改变…`}
              />
            </label>
            <PhotoConflictNotice text={`${request}\n${suggestions.find((item) => item.id === moduleId)?.normalizedText || ''}`} />
            <PhotographyMethodNotice stage="adjustment" />
            <OutputResolutionNotice source={source} />
            {suggestions.length > 0 && (
              <label className="field-label">
                Prompt 库建议（可选）
                <select className="native-select" value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
                  <option value="">不使用模块</option>
                  {suggestions.map((module) => (
                    <option value={module.id} key={module.id}>{module.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="field-label">
              <span>
                调整参考图（可选）
                <small>只影响本轮选中类别</small>
              </span>
              {adjustmentReference ? (
                <div className="adjustment-reference-preview">
                  <img src={adjustmentReference} alt="调整参考图预览" />
                  <div>
                    <b>{adjustmentReferenceName}</b>
                    <p>用途：仅参考{adjustmentMeta[category].label}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdjustmentReference('');
                        setAdjustmentReferenceName('');
                        setAdjustmentReferenceError('');
                      }}
                    >
                      <Trash2 /> 移除
                    </Button>
                  </div>
                </div>
              ) : (
                <label className="compact-upload">
                  <Upload />
                  <span>上传 PNG / JPG / WEBP，最大 20 MB</span>
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                        setAdjustmentReferenceError('仅支持 PNG、JPG 或 WEBP');
                        return;
                      }
                      if (file.size > 20 * 1024 * 1024) {
                        setAdjustmentReferenceError('调整参考图不能超过 20 MB');
                        return;
                      }
                      void fileToDataUrl(file).then((dataUrl) => {
                        setAdjustmentReference(dataUrl);
                        setAdjustmentReferenceName(file.name);
                        setAdjustmentReferenceError('');
                      });
                    }}
                  />
                </label>
              )}
              {adjustmentReferenceError && (
                <small className="text-rose-300">{adjustmentReferenceError}</small>
              )}
            </div>
            <label className="consent-row">
              <Checkbox checked={useAnnotation} onCheckedChange={(checked) => setUseAnnotation(checked === true)} />
              <span>在源图上画红色标注，帮助定位调整区域</span>
            </label>
            <div className="soft-info">
              <ShieldCheck />
              <span>
                冲突时按“文字要求 &gt; 调整参考图 &gt; Prompt 模块”处理；源图和保持项锁定其他类别。
              </span>
            </div>
            <GenerationBackendSelector
              value={backend}
              onChange={setBackend}
              disabled={Boolean(active)}
            />
            <Button
              className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
              disabled={
                Boolean(active) ||
                (!request.trim() && !moduleId && !adjustmentReference) ||
                (useAnnotation && !annotation)
              }
              onClick={() => void submit()}
            >
              {active?.kind === 'adjustment' && active.status !== 'waiting_user' ? (
                <LoaderCircle className="animate-spin" />
              ) : active?.status === 'waiting_user' ? (
                <Clock3 />
              ) : (
                <Paintbrush />
              )}
              {backend === 'chatgpt-web-manual'
                ? '准备网页版调整素材'
                : '生成一个调整版本'}
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card className="studio-card">
        <CardHeader>
          <CardTitle>执行记录</CardTitle>
          <CardDescription>保留排队、运行、失败、中断与人工重试记录。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="execution-log">
            {[...job.executionRuns].reverse().map((run) => (
              <div key={run.id}>
                <RunBadge run={run} />
                <b>{run.kind}</b>
                <span>
                  {formatTime(run.createdAt)} · {run.backend ? backendLabels[run.backend] : 'Codex 任务'} · {run.progress}
                </span>
                {run.error && <small>{run.error.message}</small>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AnnotationCanvas({
  imageUrl,
  onChange,
}: {
  imageUrl: string;
  onChange: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / image.naturalWidth);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      setLoaded(true);
      onChange('');
    };
    image.src = imageUrl;
  }, [imageUrl, onChange]);
  useEffect(() => drawImage(), [drawImage]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
      y: ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
    };
  };
  return (
    <div className="annotation-wrap">
      <canvas
        ref={canvasRef}
        className="annotation-canvas"
        onPointerDown={(event) => {
          const ctx = event.currentTarget.getContext('2d');
          if (!ctx) return;
          drawing.current = true;
          const p = point(event);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.strokeStyle = '#ff365f';
          ctx.lineWidth = Math.max(5, event.currentTarget.width / 140);
          ctx.lineCap = 'round';
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = event.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = point(event);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={(event) => {
          drawing.current = false;
          onChange(event.currentTarget.toDataURL('image/png'));
        }}
      />
      <div className="annotation-toolbar">
        <span>{loaded ? '在需要修改的位置画红色标注' : '载入源图…'}</span>
        <Button type="button" size="sm" variant="outline" onClick={drawImage}>
          <Trash2 /> 清除标注
        </Button>
      </div>
    </div>
  );
}

function FaceLibrary({
  faces,
  mutate,
}: {
  faces: FaceProfile[];
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingFace, setEditingFace] = useState<FaceProfile | null>(null);
  const [removeAngles, setRemoveAngles] = useState<string[]>([]);
  const visibleFaces = faces.filter((face) => (showArchived || !face.archivedAt) && face.name.toLowerCase().includes(query.toLowerCase()));
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'preset' | 'private'>('private');
  const [authorized, setAuthorized] = useState(false);
  const [coverAngle, setCoverAngle] = useState<'front' | 'three_quarter' | 'profile'>('front');
  const [files, setFiles] = useState<Record<string, File | null>>({
    front: null,
    three_quarter: null,
    profile: null,
  });
  useUploadGuard(Object.values(files).some(Boolean));
  const submit = () =>
    mutate(async () => {
      const images = await Promise.all(
        Object.entries(files)
          .filter(([, file]) => file)
          .map(async ([angle, file]) => ({ angle, dataUrl: await fileToDataUrl(file!) })),
      );
      const payload = {
        name,
        sourceType,
        authorizationConfirmed: authorized,
        coverAngle,
        images,
        removeAngles,
      };
      if (editingFace) await api.updateFace(editingFace.id, payload);
      else await api.createFace(payload);
      setEditingFace(null);
      setRemoveAngles([]);
      setName('');
      setFiles({ front: null, three_quarter: null, profile: null });
    }, '脸模已安全保存到本机');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Identity library</span>
          <h1>脸模库</h1>
          <p>脸模只锁定五官身份，不接管角色身材、服装或发型。</p>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Card className="studio-card">
          <CardHeader>
            <CardTitle>{editingFace ? `编辑 ${editingFace.name}` : '导入脸模'}</CardTitle>
            <CardDescription>建议提供正面、三分之二侧面和侧面。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingFace && <><Button variant="outline" onClick={() => { setEditingFace(null); setName(''); setFiles({ front: null, three_quarter: null, profile: null }); }}>退出编辑</Button><div className="reference-grid">{editingFace.images.map((image) => <label key={image.angle}><img src={assetUrl(image.url)} alt={image.angle} /><input type="checkbox" checked={removeAngles.includes(image.angle)} onChange={(event) => setRemoveAngles((current) => event.target.checked ? [...current, image.angle] : current.filter((angle) => angle !== image.angle))} />移除此角度</label>)}</div><small>未选择新照片的角度会沿用；旧版本照片不会删除。</small></>}
            <label className="field-label">
              名称
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：私人脸模 A" />
            </label>
            <label className="field-label">
              来源
              <select className="native-select" value={sourceType} onChange={(event) => setSourceType(event.target.value as 'preset' | 'private')}>
                <option value="private">私人脸模</option>
                <option value="preset">预置脸模</option>
              </select>
            </label>
            {([
              ['front', '正面'],
              ['three_quarter', '三分之二侧面'],
              ['profile', '侧面'],
            ] as const).map(([angle, label]) => (
              <label className="file-row" key={angle}>
                <span>{label}</span>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setFiles((current) => ({ ...current, [angle]: event.target.files?.[0] || null }))}
                />
              </label>
            ))}
            <label className="field-label">
              封面角度
              <select className="native-select" value={coverAngle} onChange={(event) => setCoverAngle(event.target.value as typeof coverAngle)}>
                <option value="front">正面</option>
                <option value="three_quarter">三分之二侧面</option>
                <option value="profile">侧面</option>
              </select>
            </label>
            <label className="consent-row">
              <Checkbox checked={authorized} onCheckedChange={(checked) => setAuthorized(checked === true)} />
              <span>我确认拥有这些真人照片的使用权，并获授权用于 AI COS 创作。</span>
            </label>
            <Button
              disabled={!name.trim() || (!editingFace && !Object.values(files).some(Boolean)) || !authorized}
              onClick={() => void submit()}
              className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
            >
              <ShieldCheck /> 保存脸模
            </Button>
          </CardContent>
        </Card>
        <div><LibraryFilter query={query} setQuery={setQuery} archived={showArchived} setArchived={setShowArchived} />
        {visibleFaces.length ? (
          <div className="face-grid">
            {visibleFaces.map((face) => (
              <Card key={face.id} className="studio-card overflow-hidden">
                <div className="aspect-[4/3] bg-white/3">
                  {face.coverImage ? (
                    <img src={assetUrl(face.coverImage)} alt={face.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center"><ScanFace /></div>
                  )}
                </div>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between"><b>{face.name}</b><Badge variant="outline">v{face.version}</Badge></div>
                  <Button className="mt-3" variant="outline" disabled={!face.authorizationConfirmed || Boolean(face.archivedAt)} onClick={() => launchVsc({ sourceType: 'face', faceId: face.id })}><Sparkles /> 用此脸模进行 VSC 创作</Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {face.images.length} 个角度 · {face.sourceType === 'private' ? '私人已授权' : '预置来源'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEditingFace(face); setName(face.name); setAuthorized(face.authorizationConfirmed); setSourceType(face.sourceType); setCoverAngle(face.coverAngle); setRemoveAngles([]); setFiles({ front: null, three_quarter: null, profile: null }); }}>编辑照片与授权</Button><Button size="sm" variant="outline" onClick={() => void mutate(() => api.archiveMaterial('face', face.id, !face.archivedAt), '归档状态已更新，历史素材仍保留')}>{face.archivedAt ? '恢复' : '归档'}</Button></div>
                  <details className="version-details mt-2"><summary>角度与版本历史</summary>{face.images.map((image) => <a key={image.angle} href={assetUrl(image.url)} target="_blank" rel="noreferrer">{image.angle} · </a>)}<pre>{JSON.stringify(face.versions || [], null, 2)}</pre></details>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={ScanFace} title="没有匹配的脸模" description="可调整搜索条件或导入获授权的参考照片。" />
        )}</div>
      </div>
    </>
  );
}

function PromptLibrary({
  data,
  mutate,
}: {
  data: BootstrapData;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [tab, setTab] = useState('full');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Prompt system</span>
          <h1>Prompt 与摄影方案库</h1>
          <p>完整 Prompt 保留整套创意；模块用于单项调整；摄影方案包用于随机组合和参考写真。</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="space-y-5">
        <TabsList className="h-auto flex-wrap bg-white/5 p-1">
          <TabsTrigger value="full" className="px-4"><Clipboard /> 完整 Prompt</TabsTrigger>
          <TabsTrigger value="modules" className="px-4"><Layers3 /> Prompt 模块</TabsTrigger>
          <TabsTrigger value="packs" className="px-4"><Library /> 摄影方案包</TabsTrigger>
        </TabsList>
        <TabsContent value="full"><FullPromptLibrary data={data} mutate={mutate} showModules={() => setTab('modules')} showPacks={() => setTab('packs')} /></TabsContent>
        <TabsContent value="modules">
          <PromptModuleLibrary data={data} mutate={mutate} />
        </TabsContent>
        <TabsContent value="packs">
          <PhotographyPackLibrary data={data} mutate={mutate} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function PhotographyPackDraftEditor({
  draft,
  onChange,
}: {
  draft: PhotographyPackDraft;
  onChange: (next: PhotographyPackDraft) => void;
}) {
  const set = <K extends keyof PhotographyPackDraft>(key: K, value: PhotographyPackDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const setSeriesGroup = <K extends 'seriesDNA' | 'imagingProfile' | 'visualHierarchy' | 'workflowRules'>(
    group: K,
    key: string,
    value: string,
  ) => {
    if (draft.kind !== 'series_plan') return;
    onChange({
      ...draft,
      [group]: { ...draft[group], [key]: value },
    });
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="field-label">方案包名称<Input value={draft.name} onChange={(event) => set('name', event.target.value)} /></label>
        <label className="field-label">标签<Input value={draft.tags.join('，')} onChange={(event) => set('tags', event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))} /></label>
      </div>
      <label className="field-label">说明<Textarea value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
      <label className="field-label">全局摄影风格<Textarea className="min-h-28" value={draft.globalStyle} onChange={(event) => set('globalStyle', event.target.value)} /></label>
      {draft.kind === 'variable_pool' ? (
        <div className="photography-pool-grid">
          {photographyPoolMeta.map((item) => (
            <label className="field-label" key={item.key}>
              {item.label}变量池 <small>每行一条 · {draft.pools[item.key]?.length || 0} 条</small>
              <Textarea
                className="min-h-28"
                value={(draft.pools[item.key] || []).join('\n')}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    pools: {
                      ...draft.pools,
                      [item.key]: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <>
          <div><h3 className="mb-3 font-medium">系列视觉 DNA</h3><div className="photography-pool-grid">
            {seriesDnaMeta.map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea value={draft.seriesDNA[key]} onChange={(event) => setSeriesGroup('seriesDNA', key, event.target.value)} /></label>)}
          </div></div>
          <div><h3 className="mb-3 font-medium">成像机制</h3><div className="photography-pool-grid">
            {imagingMeta.map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea value={draft.imagingProfile[key]} onChange={(event) => setSeriesGroup('imagingProfile', key, event.target.value)} /></label>)}
          </div></div>
          <div><h3 className="mb-3 font-medium">画面信息层级</h3><div className="photography-pool-grid">
            {hierarchyMeta.map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea value={draft.visualHierarchy[key]} onChange={(event) => setSeriesGroup('visualHierarchy', key, event.target.value)} /></label>)}
          </div></div>
          <div><h3 className="mb-3 font-medium">企划工作流</h3><div className="photography-pool-grid">
            {workflowRuleMeta.map(([key, label]) => <label className="field-label" key={key}>{label}<Textarea className="min-h-28" value={draft.workflowRules[key]} onChange={(event) => setSeriesGroup('workflowRules', key, event.target.value)} /></label>)}
          </div></div>
          <label className="field-label">质量门禁（每行一条）<Textarea value={draft.qualityGates.join('\n')} onChange={(event) => onChange({ ...draft, qualityGates: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>
        </>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="field-label">避免项（每行一条）<Textarea value={draft.avoid.join('\n')} onChange={(event) => set('avoid', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>
        <label className="field-label">已排除的默认人物 / 肤色 / 身材 / 身份（每行一条）<Textarea value={draft.excludedDefaults.join('\n')} onChange={(event) => set('excludedDefaults', event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>
      </div>
      {draft.kind === 'variable_pool' && <div className="grid gap-3 md:grid-cols-2">
        <label className="field-label">多人共同事件（仅用于多人模式，每行一条）<Textarea value={(draft.groupInteractions || []).join('\n')} onChange={(event) => onChange({ ...draft, groupInteractions: event.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })} /></label>
        <label className="field-label">成像介质（每行一个互斥方案）<Textarea value={(draft.imagingMedia || []).join('\n')} onChange={(event) => onChange({ ...draft, imagingMedia: event.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })} /></label>
      </div>}
      <div>{draft.kind === 'variable_pool' && <label className="consent-row"><Checkbox checked={draft.rules.candidOcclusion === 'full'} onCheckedChange={(checked) => onChange({ ...draft, rules: { ...draft.rules, candidOcclusion: checked ? 'full' : 'none' } })} /><span>允许采用变量明确要求的抓拍遮挡或局部出画（清晰全身写真建议关闭）</span></label>}<div className="soft-info"><ShieldCheck /><span>{draft.kind === 'series_plan' ? '固定规则：身份只来自 Studio、写真人物不承担身份、返工回到原始输入、服装默认锁定、默认无水印。' : '固定规则：用户锁定优先、批次尽量不重复、忠于抓拍遮挡尺度、服装池默认关闭。'}</span></div></div>
    </div>
  );
}

function PhotographyPackLibrary({
  data,
  mutate,
}: {
  data: BootstrapData;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const imports = data.photographyPackImports || [];
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const packs = (data.photographyPacks || []).filter((pack) => (showArchived || !pack.archivedAt) && `${pack.name} ${pack.description} ${pack.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const [sourceMode, setSourceMode] = useState<'github' | 'paste'>('github');
  const [packKind, setPackKind] = useState<'variable_pool' | 'series_plan'>('variable_pool');
  const [title, setTitle] = useLocalDraft('pack-import-title', '');
  const [sourceUrl, setSourceUrl] = useLocalDraft('pack-import-url', '');
  const [rawText, setRawText] = useLocalDraft('pack-import-text', '');
  const [authorizationNote, setAuthorizationNote] = useState('仅供个人本地使用；请自行确认上游授权条款。');
  const [selectedImportId, setSelectedImportId] = useState('');
  const [draftCache, setDraftCache] = useLocalDraft<Record<string, PhotographyPackDraft | null>>('pack-import-drafts', {});
  const [editingPack, setEditingPack] = useLocalDraft<PhotographyPack | null>('editing-pack', null);
  const [addingPack, setAddingPack] = useState(false);
  const selectedImport = selectImportRecord(imports, selectedImportId);
  const draft = selectedImport ? draftCache[selectedImport.id] || selectedImport.draft : null;
  const setDraft = (next: PhotographyPackDraft | null) => { if (selectedImport) setDraftCache((current) => ({ ...current, [selectedImport.id]: next })); };
  const importSnapshot = selectedImport
    ? JSON.stringify({ id: selectedImport.id, updatedAt: selectedImport.updatedAt, draft: selectedImport.draft })
    : '';
  useEffect(() => {
    if (!importSnapshot) return;
    const snapshot = JSON.parse(importSnapshot) as { id: string; draft: PhotographyPackDraft | null };
    if (!selectedImportId) queueMicrotask(() => setSelectedImportId(snapshot.id));
  }, [importSnapshot, selectedImportId]);
  const run = selectedImport
    ? selectedImport.executionRuns.find((item) => item.id === selectedImport.activeRunId) || selectedImport.executionRuns.at(-1) || null
    : null;
  const createImport = () =>
    mutate(async () => {
      const created = await api.createPhotographyPackImport({
        title,
        authorizationNote,
        packKind,
        ...(sourceMode === 'github' ? { sourceUrl } : { rawText }),
      });
      setSelectedImportId(created.id);
      setTitle('');
      setRawText('');
    }, '摄影资料已进入 Codex 解析队列');
  const confirm = () =>
    selectedImport && draft && mutate(async () => {
      await api.updatePhotographyPackDraft(selectedImport.id, draft);
      await api.confirmPhotographyPackImport(selectedImport.id);
    }, '摄影方案包已确认入库');
  return (
    <div className="space-y-5">
      <details className="library-add-panel" open={addingPack} onToggle={(event) => setAddingPack(event.currentTarget.open)}>
      <summary><Plus className="size-4" /><b>导入摄影方案包</b><span>{selectedImport && selectedImport.status !== 'completed' ? `${selectedImport.title} · ${importStatusLabels[selectedImport.status]}（展开查看）` : '随机重拍 / 参考写真 · GitHub 链接或粘贴资料'}</span><ChevronRight className="size-4" /></summary>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card className="studio-card">
          <CardHeader><CardTitle>导入摄影资料</CardTitle><CardDescription>可粘贴完整 Skill / Prompt，或导入公开 GitHub 的仓库根、tree、blob、raw 链接。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-3" aria-label="摄影方案类型">
            <button
              type="button"
              className="photography-import-card"
              aria-pressed={packKind === 'variable_pool'}
              onClick={() => setPackKind('variable_pool')}
            >
              <Camera /><span><b>随机重拍</b><small>提取动作、场景、镜头与光线变量，组合生成不同的摄影方案。</small></span>{packKind === 'variable_pool' ? <Check /> : <ChevronRight />}
            </button>
            <button
              type="button"
              className="photography-import-card"
              aria-pressed={packKind === 'series_plan'}
              onClick={() => setPackKind('series_plan')}
            >
              <Aperture /><span><b>参考写真</b><small>提取参考拆解、布光、分镜与返工规则，用于参考写真创作。</small></span>{packKind === 'series_plan' ? <Check /> : <ChevronRight />}
            </button>
            </fieldset>
            <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as 'github' | 'paste')}>
              <TabsList><TabsTrigger value="github">GitHub 链接</TabsTrigger><TabsTrigger value="paste">粘贴原文</TabsTrigger></TabsList>
              <TabsContent value="github"><Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://github.com/owner/repo" /></TabsContent>
              <TabsContent value="paste"><Textarea className="min-h-44" maxLength={102400} value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴完整 Skill 或摄影 Prompt 资料…" /></TabsContent>
            </Tabs>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="导入名称" />
            <label className="field-label">授权备注<Input value={authorizationNote} onChange={(event) => setAuthorizationNote(event.target.value)} /></label>
            <div className="soft-warning"><CircleAlert /><span>系列企划最多读取同仓库 8 个文档、合计 100 KiB；不会执行仓库里的 Agent、脚本、测试或评测文件。</span></div>
            <Button
              className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
              disabled={sourceMode === 'github' ? !sourceUrl.trim() : !rawText.trim()}
              onClick={() => void createImport()}
            ><Sparkles /> 导入并解析为草稿</Button>
          </CardContent>
        </Card>
        <Card className="studio-card">
          <CardHeader><CardTitle>导入记录</CardTitle><CardDescription>Codex 只写回草稿，必须由你确认才进入素材库。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {imports.length ? (
              <>
                <select className="native-select" value={selectedImport?.id || ''} onChange={(event) => setSelectedImportId(event.target.value)}>
                  {imports.map((item) => <option value={item.id} key={item.id}>{item.title} · {importStatusLabels[item.status] || item.status}</option>)}
                </select>
                {selectedImport && <div className="prompt-import-status"><div><RunBadge run={run} /><b>{selectedImport.title}</b><Badge variant="outline">{selectedImport.packKind === 'series_plan' ? '系列企划' : '随机变量'}</Badge></div><p>{run?.progress || selectedImport.status}</p><small>SHA-256 · {selectedImport.sourceHash.slice(0, 16)}…</small>{selectedImport.revision && <small>revision · {selectedImport.revision}</small>}{selectedImport.sourceFiles.length > 0 && <small>{selectedImport.sourceFiles.length} 个来源文件</small>}{selectedImport.sourceUrl && <small>{selectedImport.sourceUrl}</small>}{selectedImport.error && <small>{selectedImport.error.message}</small>}{['failed', 'interrupted'].includes(selectedImport.status) && run && <Button size="sm" variant="outline" onClick={() => void mutate(() => api.retryRun(run.id), '摄影方案包解析已重新入队')}><RotateCcw /> 手动重试</Button>}</div>}
                {selectedImport && (
                  <details className="version-details">
                    <summary>来源、哈希与许可快照</summary>
                    <div className="space-y-2 pt-3 text-xs text-muted-foreground">
                      <p>导入时间：{formatTime(selectedImport.createdAt)}</p>
                      <p>授权备注：{selectedImport.authorizationNote || '未填写'}</p>
                      <p>许可：{selectedImport.licenseSnapshot ? selectedImport.licenseSnapshot.split('\n')[0] : '未随来源读取到 LICENSE'}</p>
                      {selectedImport.sourceFiles.map((file) => (
                        <p key={file.path}>{file.path} · {file.bytes} bytes · {file.hash.slice(0, 16)}…</p>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : <EmptyState icon={Library} title="还没有导入记录" description="从左侧粘贴资料或填入 GitHub 链接。" />}
          </CardContent>
        </Card>
      </div>
      </details>
      {selectedImport?.status === 'draft_ready' && draft && (
        <Card className="studio-card">
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>编辑待确认方案包</CardTitle><CardDescription>删除默认人物、肤色、身材或身份设定后再确认。</CardDescription></div><Badge variant="outline">{draft.kind === 'series_plan' ? '系列写真企划' : '12 个变量池'}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            <PhotographyPackDraftEditor draft={draft} onChange={setDraft} />
            <div className="panel-actions"><Button variant="outline" onClick={() => void mutate(() => api.updatePhotographyPackDraft(selectedImport.id, draft), '方案包草稿已保存')}>保存草稿</Button><Button className="bg-violet-300 text-zinc-950 hover:bg-violet-200" disabled={!draft.name.trim() || !draft.globalStyle.trim()} onClick={() => void confirm()}><Check /> 确认入库</Button></div>
          </CardContent>
        </Card>
      )}
      {editingPack && (
        <Card className="studio-card">
          <CardHeader><CardTitle>编辑 {editingPack.name}</CardTitle><CardDescription>保存会创建 v{editingPack.version + 1}；旧作品继续使用原快照。</CardDescription></CardHeader>
          <CardContent className="space-y-4"><PhotographyPackDraftEditor draft={editingPack} onChange={(next) => setEditingPack({ ...editingPack, ...next })} /><div className="panel-actions"><Button variant="outline" onClick={() => setEditingPack(null)}>取消</Button><Button className="bg-violet-300 text-zinc-950 hover:bg-violet-200" onClick={() => void mutate(async () => { await api.updatePhotographyPack(editingPack.id, editingPack); setEditingPack(null); }, '摄影方案包新版本已保存')}><Check /> 保存新版本</Button></div></CardContent>
        </Card>
      )}
      <div><LibraryFilter query={query} setQuery={setQuery} archived={showArchived} setArchived={setShowArchived} /><div className="mb-4"><h2 className="text-lg font-semibold">已入库摄影方案包</h2><p className="text-xs text-muted-foreground">服装默认关闭；新版本不会改变既有重拍批次。</p></div>{packs.length ? <div className="pack-grid">{packs.map((pack) => <div className="pack-card" key={pack.id}><div className="flex items-start justify-between gap-2"><b>{pack.name}</b><span className="flex gap-2"><Badge variant="outline">{pack.kind === 'series_plan' ? '系列企划' : '随机变量'}</Badge><Badge variant="outline">v{pack.version}</Badge></span></div><p>{pack.description || pack.globalStyle}</p>{pack.kind === 'variable_pool' ? <div className="pack-counts">{photographyPoolMeta.map((item) => pack.pools[item.key]?.length ? <span key={item.key}>{item.label} {pack.pools[item.key].length}</span> : null)}</div> : <div className="pack-counts"><span>光照拓扑</span><span>人物事件</span><span>背景层级</span><span>{pack.qualityGates.length} 项门禁</span></div>}<small>{pack.source.url || '本地粘贴导入'} · {pack.source.hash.slice(0, 12)}…</small><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditingPack(structuredClone(pack))}>编辑</Button><Button size="sm" variant="outline" onClick={() => void mutate(() => api.archiveMaterial('pack', pack.id, !pack.archivedAt), '素材归档状态已更新')}>{pack.archivedAt ? '恢复' : '归档'}</Button></div><details className="version-details"><summary>来源与版本历史</summary><pre>{JSON.stringify({ source: pack.source, versions: pack.versions || [] }, null, 2)}</pre></details></div>)}</div> : <EmptyState icon={Library} title="还没有正式方案包" description="导入资料、编辑草稿并确认后会出现在这里。" />}</div>
    </div>
  );
}

function PromptModuleLibrary({
  data,
  mutate,
}: {
  data: BootstrapData;
  mutate: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useLocalDraft<PromptModule | null>('editing-prompt', null);
  const editorRef = useRef<HTMLDetailsElement>(null);
  const [filter, setFilter] = useState<'all' | PromptCategory>('all');
  const [importTitle, setImportTitle] = useLocalDraft('prompt-import-title', '');
  const [importRaw, setImportRaw] = useLocalDraft('prompt-import-text', '');
  const [selectedImportId, setSelectedImportId] = useState('');
  const [draftCache, setDraftCache] = useLocalDraft<Record<string, PromptDraft[]>>('prompt-import-drafts', {});
  const [form, setForm] = useLocalDraft('prompt-module-form', {
    name: '',
    category: 'style' as PromptCategory,
    rawText: '',
    normalizedText: '',
    avoid: '',
    tags: '',
  });
  const [adding, setAdding] = useState(Boolean(editing || importRaw || form.name));
  const imports = data.promptImports || data.promptInbox || [];
  const selectedImport = selectImportRecord(imports, selectedImportId);
  const drafts = selectedImport ? draftCache[selectedImport.id] || selectedImport.drafts : [];
  const setDrafts = (update: SetStateAction<PromptDraft[]>) => { if (selectedImport) setDraftCache((current) => ({ ...current, [selectedImport.id]: typeof update === 'function' ? update(current[selectedImport.id] || selectedImport.drafts) : update })); };
  const selectedImportSnapshot = selectedImport
    ? JSON.stringify({
        id: selectedImport.id,
        updatedAt: selectedImport.updatedAt,
        drafts: selectedImport.drafts,
      })
    : '';
  useEffect(() => {
    if (!selectedImportSnapshot) return;
    const snapshot = JSON.parse(selectedImportSnapshot) as {
      id: string;
      drafts: PromptDraft[];
    };
    if (!selectedImportId) queueMicrotask(() => setSelectedImportId(snapshot.id));
  }, [selectedImportSnapshot, selectedImportId]);
  const createImport = () =>
    mutate(async () => {
      const created = await api.createPromptImport({
        title: importTitle,
        rawText: importRaw,
      });
      setSelectedImportId(created.id);
      setImportTitle('');
      setImportRaw('');
    }, '完整 Prompt 已入队，Codex 会自动拆分');
  const saveDrafts = () =>
    selectedImport &&
    mutate(
      () => api.updatePromptDrafts(selectedImport.id, drafts),
      '草稿编辑已保存',
    );
  const confirmDrafts = () =>
    selectedImport &&
    mutate(async () => {
      await api.updatePromptDrafts(selectedImport.id, drafts);
      await api.confirmPromptImport(selectedImport.id);
    }, `已确认添加 ${drafts.filter((draft) => draft.included).length} 个 Prompt 模块`);
  const submit = () =>
    mutate(async () => {
      await api.createPrompt({
        id: editing?.id,
        ...form,
        avoid: form.avoid.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean),
        tags: form.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      });
      setEditing(null);
      setForm({ name: '', category: 'style', rawText: '', normalizedText: '', avoid: '', tags: '' });
    }, editing ? 'Prompt 新版本已保存' : 'Prompt 模块已保存');
  const edit = (module: PromptModule) => {
    setAdding(true);
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setEditing(module);
    setForm({
      name: module.name,
      category: module.category,
      rawText: module.rawText,
      normalizedText: module.normalizedText,
      avoid: module.avoid.join('；'),
      tags: module.tags.join('，'),
    });
  };
  const importRun = selectedImport
    ? selectedImport.executionRuns.find(
        (run) => run.id === selectedImport.activeRunId,
      ) || selectedImport.executionRuns.at(-1) || null
    : null;
  const updateDraft = (index: number, patch: Partial<PromptDraft>) =>
    setDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
    );
  const visiblePrompts = data.prompts.filter(
    (item) => (filter === 'all' || item.category === filter) && (showArchived || !item.archivedAt) && `${item.name} ${item.normalizedText} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PhotographyLibraryGuide onShowModules={() => { setFilter('all'); setQuery('摄影方法'); setShowArchived(false); }} />
      <details className="library-add-panel" ref={editorRef} open={adding} onToggle={(event) => setAdding(event.currentTarget.open)}>
      <summary><Plus className="size-4" /><b>{editing ? '正在编辑 Prompt 模块' : '添加 Prompt'}</b><span>{selectedImport && selectedImport.status !== 'completed' ? `${selectedImport.title} · ${importStatusLabels[selectedImport.status]}（展开查看）` : '整段自动拆分 / 分项手动添加 / 导入记录'}</span><ChevronRight className="size-4" /></summary>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="studio-card">
          <CardHeader>
            <CardTitle>自动拆分整段 Prompt</CardTitle>
            <CardDescription>最多 30,000 字符；每个检测到的分类最多生成一条草稿。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input aria-label="这组 Prompt 的名称" placeholder="这组 Prompt 的名称" value={importTitle} onChange={(event) => setImportTitle(event.target.value)} />
            <label className="field-label">
              完整 Prompt
              <Textarea
                className="min-h-44"
                maxLength={30000}
                placeholder="粘贴包含摄影风格、动作、服饰、妆容等内容的完整 Prompt…"
                value={importRaw}
                onChange={(event) => setImportRaw(event.target.value)}
              />
              <small>{importRaw.length.toLocaleString()} / 30,000</small>
            </label>
            <Button
              className="w-full bg-violet-300 text-zinc-950 hover:bg-violet-200"
              disabled={!importRaw.trim() || importRaw.length > 30000}
              onClick={() => void createImport()}
            >
              <Sparkles /> 自动拆分为待确认草稿
            </Button>
            {imports.length > 0 && (
              <label className="field-label pt-2">
                导入记录
                <select
                  className="native-select"
                  value={selectedImport?.id || ''}
                  onChange={(event) => setSelectedImportId(event.target.value)}
                >
                  {imports.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title} · {importStatusLabels[item.status] || item.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedImport && (
              <div className="prompt-import-status">
                <div>
                  <RunBadge run={importRun} />
                  <b>{selectedImport.title}</b>
                </div>
                <p>{importRun?.progress || `状态：${selectedImport.status}`}</p>
                {selectedImport.error && <small>{selectedImport.error.message}</small>}
                {['failed', 'interrupted'].includes(selectedImport.status) && importRun && (
                  <Button size="sm" variant="outline" onClick={() => void mutate(() => api.retryRun(importRun.id), 'Prompt 拆分已重新入队')}>
                    <RotateCcw /> 手动重试
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="studio-card">
          <CardHeader>
            <CardTitle>{editing ? `编辑 ${editing.name}` : '分项添加'}</CardTitle>
            <CardDescription>保留原来的手动入库方式；编辑时会生成新版本。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="模块名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <select aria-label="模块分类" className="native-select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as PromptCategory })}>
              {(Object.keys(categoryMeta) as PromptCategory[]).map((category) => (
                <option value={category} key={category}>{categoryMeta[category].label}</option>
              ))}
            </select>
            <Textarea placeholder="原始文本" value={form.rawText} onChange={(event) => setForm({ ...form, rawText: event.target.value })} />
            <Textarea placeholder="规范化片段（进入最终 Prompt）" value={form.normalizedText} onChange={(event) => setForm({ ...form, normalizedText: event.target.value })} />
            <PhotoConflictNotice text={form.normalizedText} />
            <Input placeholder="避免项，用；分隔" value={form.avoid} onChange={(event) => setForm({ ...form, avoid: event.target.value })} />
            <Input placeholder="标签，用逗号分隔" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
            <div className="flex gap-2">
              <Button disabled={!form.name.trim() || !form.normalizedText.trim()} onClick={() => void submit()} className="flex-1 bg-violet-300 text-zinc-950 hover:bg-violet-200">
                保存模块
              </Button>
              {editing && <Button variant="outline" onClick={() => {
                setEditing(null);
                setForm({ name: '', category: 'style', rawText: '', normalizedText: '', avoid: '', tags: '' });
              }}>取消</Button>}
            </div>
          </CardContent>
        </Card>
      </div>
      </details>
      {selectedImport?.status === 'draft_ready' && drafts.length > 0 && (
        <Card className="studio-card mt-5">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>编辑拆分草稿</CardTitle>
                <CardDescription>可修改名称、分类和 Prompt，也可取消任意一项导入。</CardDescription>
              </div>
              <Badge variant="outline">{drafts.filter((draft) => draft.included).length} / {drafts.length} 条将入库</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {drafts.map((draft, index) => (
              <div className={cx('prompt-draft', !draft.included && 'prompt-draft-excluded')} key={draft.draftId}>
                <label className="consent-row">
                  <Checkbox checked={draft.included} onCheckedChange={(checked) => updateDraft(index, { included: checked === true })} />
                  <span>确认时导入这一项</span>
                </label>
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <Input value={draft.name} onChange={(event) => updateDraft(index, { name: event.target.value })} />
                  <select className="native-select" value={draft.category} onChange={(event) => updateDraft(index, { category: event.target.value as PromptCategory })}>
                    {(Object.keys(categoryMeta) as PromptCategory[]).map((category) => (
                      <option
                        value={category}
                        key={category}
                        disabled={drafts.some((item, itemIndex) => itemIndex !== index && item.category === category)}
                      >
                        {categoryMeta[category].label}
                      </option>
                    ))}
                  </select>
                </div>
                <Textarea className="min-h-20" value={draft.rawText} onChange={(event) => updateDraft(index, { rawText: event.target.value })} placeholder="原文来源片段" />
                <Textarea className="min-h-24" value={draft.normalizedText} onChange={(event) => updateDraft(index, { normalizedText: event.target.value })} placeholder="规范化 Prompt" />
                <PhotoConflictNotice text={draft.normalizedText} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={draft.avoid.join('；')} onChange={(event) => updateDraft(index, { avoid: event.target.value.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean) })} placeholder="避免项，用；分隔" />
                  <Input value={draft.tags.join('，')} onChange={(event) => updateDraft(index, { tags: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="标签，用逗号分隔" />
                </div>
              </div>
            ))}
            <div className="panel-actions">
              <Button variant="outline" onClick={() => void saveDrafts()}>保存草稿</Button>
              <Button
                className="bg-violet-300 text-zinc-950 hover:bg-violet-200"
                disabled={!drafts.some((draft) => draft.included) || drafts.some((draft) => !draft.name.trim() || !draft.rawText.trim() || !draft.normalizedText.trim())}
                onClick={() => void confirmDrafts()}
              >
                <Check /> 确认添加选中模块
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">已入库模块</h2>
            <p className="text-xs text-muted-foreground">确认前的拆分草稿不会出现在这里。</p>
          </div>
          <div className="prompt-filter">
            <button aria-pressed={filter === 'all'} className={cx(filter === 'all' && 'prompt-filter-active')} onClick={() => setFilter('all')}>全部</button>
            {(Object.keys(categoryMeta) as PromptCategory[]).map((category) => (
              <button key={category} aria-pressed={filter === category} className={cx(filter === category && 'prompt-filter-active')} onClick={() => setFilter(category)}>
                {categoryMeta[category].label}
              </button>
            ))}
          </div>
        </div>
        <LibraryFilter query={query} setQuery={setQuery} archived={showArchived} setArchived={setShowArchived} />
        {visiblePrompts.length ? (
          <div className="prompt-grid">
            {visiblePrompts.map((module) => (
              <div key={module.id} className="prompt-card">
                <div className="flex items-start justify-between gap-2"><b>{module.name}</b><Badge variant="outline">v{module.version}</Badge></div>
                <Badge variant="secondary">{categoryMeta[module.category].label}</Badge>
                <p>{module.normalizedText}</p>
                <div>{module.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                {module.avoid.length > 0 && <small>避免：{module.avoid.join('；')}</small>}
                <PhotographySourceDetails module={module} />
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => edit(module)}>编辑</Button><Button size="sm" variant="outline" onClick={() => void mutate(() => api.archiveMaterial('prompt', module.id, !module.archivedAt), '素材归档状态已更新')}>{module.archivedAt ? '恢复' : '归档'}</Button></div>
                <details className="version-details"><summary>版本历史与原文</summary><pre>{module.rawText}</pre><pre>{JSON.stringify(module.versions || [], null, 2)}</pre></details>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Layers3} title="该分类暂无模块" description="可从上方自动拆分或分项添加。" />
        )}
      </div>
    </>
  );
}

function History({ jobs, onOpen, creations, onOpenCreation }: { jobs: GenerationJob[]; onOpen: (id: string) => void; creations: PromptCreation[]; onOpenCreation: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const visibleJobs = jobs.filter((job) => job.title.toLowerCase().includes(query.toLowerCase()) && (!favorites || Object.values(job.outputAnnotations || {}).some((item) => item.favorite)));
  const visibleCreations = favorites ? [] : creations.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Local archive</span>
          <h1>作品历史</h1>
          <p>参考、角色卡、配置、基准图、单项调整和创意重拍分支都保存在本机。</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3"><Input className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品名称…" /><label className="flex gap-2 text-sm"><input type="checkbox" checked={favorites} onChange={(event) => setFavorites(event.target.checked)} />含收藏图片</label><Button variant="outline" onClick={() => { setBackupMessage('正在备份…'); void api.backup().then((file) => { const a = document.createElement('a'); a.href = assetUrl(file.url); a.download = file.name; a.click(); setBackupMessage('完整备份已保存在本机，并开始下载'); }).catch((error) => setBackupMessage(error.message)); }}>备份整个工作台</Button><span className="text-sm">{backupMessage}</span></div>
      {!!visibleCreations.length && <div className="history-list mb-4">{visibleCreations.map((item) => <button key={item.id} className="history-row" onClick={() => onOpenCreation(item.id)}><div className="history-thumb">{item.outputs.at(-1) ? <img src={assetUrl(item.outputs.at(-1)?.url)} alt="" /> : <Sparkles />}</div><div className="min-w-0 flex-1"><b>{item.name}</b><p>{formatTime(item.updatedAt)}</p><small>{item.participants.length} 人 · {item.drafts.length} 组完整 Prompt · {item.outputs.length} 张照片</small></div><Badge variant="outline">VSC 创作</Badge><ChevronRight /></button>)}</div>}
      {visibleJobs.length ? (
        <div className="history-list">
          {visibleJobs.map((job) => {
            const outputs: OutputVersion[] = [
              ...job.baselineVersions,
              ...job.adjustmentVersions,
              ...(job.reshootVersions || []),
            ];
            const selected = outputs.find((item) => item.id === (job.coverOutputId || job.selectedOutputId)) || outputs.at(-1);
            return (
              <button key={job.id} className="history-row" onClick={() => onOpen(job.id)}>
                <div className="history-thumb">
                  {selected?.url || job.references[0]?.url ? (
                    <img src={assetUrl(selected?.url || job.references[0]?.url)} alt="" />
                  ) : (
                    <ImageIcon />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <b>{job.title}</b>
                  <p>{formatTime(job.updatedAt)}</p>
                  <small>
                    {job.baselineVersions.length} 个基准版本 · {job.adjustmentVersions.length} 次调整 · {job.reshootVersions?.length || 0} 张重拍 · {job.backend ? backendLabels[job.backend] : '尚未生成'}
                  </small>
                </div>
                <Badge variant="outline">{workflowSteps.find((item) => item.id === job.workflowStep)?.label}</Badge>
                <ChevronRight />
              </button>
            );
          })}
        </div>
      ) : !visibleCreations.length ? (
        <EmptyState icon={Clock3} title="没有匹配的创作记录" description="可从 Prompt 创作直接描述照片，或从创作台上传角色参考图开始。" />
      ) : null}
    </>
  );
}
