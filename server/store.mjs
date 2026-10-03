import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withWebReshootWatermark } from './web-reshoot-watermark.mjs';
import { isRealismPreset, mergeRealismPresets } from '../lib/photo-realism.mjs';
import { mergePhotographyModules } from '../lib/photography-methods.mjs';
import { assertFaceReviewed, normalizeFaceReview, requiresBaselineFaceReview } from '../lib/baseline-face.mjs';
import { maximumNativeResolution, outputResolutionRecord, withNativeResolution } from '../lib/image-output-policy.mjs';
import { reviewedPromptDefault } from '../lib/reviewed-prompt-defaults.mjs';
import { GROUP_LABELS, validateGroupParticipants, multiPersonAssets, compileMultiPersonPrompt } from './multi-person.mjs';
import { creativePolicy, creativeSourcePurpose } from '../lib/creative-policy.mjs';
import { MAX_FULL_PROMPT, normalizeAdaptation } from '../lib/prompt-adaptation.mjs';
import { listPromptCreations, getPromptCreation, mutatePromptCreation, finishPromptCreationRun, retryPromptCreationRun } from './prompt-creation.mjs';

import {
  ADJUSTMENT_CATEGORIES,
  RESHOOT_LOCK_KEYS,
  PROMPT_CATEGORIES,
  buildAdjustmentPreserve,
  compileAdjustmentPrompt,
  compileBaselinePrompt,
  compileReshootPrompt,
  compileFullPromptReshoot,
  compileSeriesReshootPrompt,
  nextVersionName,
  normalizePhotographyPackDraft,
  normalizeReshootQuality,
  normalizeSeriesPlanDraft,
  normalizeOutputKind,
  normalizeRunKind,
  publicAssetPath,
  selectPhotographyVariables,
  sortReferences,
  validateAspectRatio,
  validateCharacterCard,
  validateGenerationBackend,
  validatePromptDrafts,
} from './domain.mjs';

const execFileAsync = promisify(execFile);

export const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL('..', import.meta.url)),
);
export const DATA_ROOT = path.resolve(
  process.env.AI_COS_DATA_DIR || path.join(PROJECT_ROOT, 'local-data'),
);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OUTPUT_MAX_BYTES = 50 * 1024 * 1024;
const MAX_PACK_SOURCE_BYTES = 100 * 1024;
export const VIBESHOT_SKILL_URL =
  'https://github.com/vibeshotclub/vsc-skills/tree/main/vibeshot-candid-photography';
export const NUYOAH_SKILL_URL =
  'https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt';
const MAX_PACK_SOURCE_FILES = 8;
const COLLECTIONS = [
  'faces',
  'characters',
  'prompts',
  'jobs',
  'outputs',
  'runtime',
];
const IMAGE_MIMES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const seededPrompts = [
  [
    '电影柔光',
    'style',
    'cinematic portrait photography, soft halation, nuanced cool and warm color contrast',
    ['不要改变角色配色'],
  ],
  [
    '棚拍高定',
    'style',
    'luxury editorial studio photography, sculpted rim light, clean tonal separation',
    ['避免过度磨皮'],
  ],
  [
    '自然纪实',
    'style',
    'natural documentary portrait, restrained film grain, candid realism',
    ['避免夸张戏剧色调'],
  ],
  [
    '平视中景',
    'camera_angle',
    'eye-level medium shot, 85mm portrait lens, natural perspective',
    ['避免广角变形'],
  ],
  [
    '三分之二全身',
    'camera_angle',
    'three-quarter full-body composition, camera at waist height, balanced headroom',
    ['避免切断鞋袜'],
  ],
  [
    '低机位英雄镜头',
    'camera_angle',
    'subtle low-angle full-body portrait, controlled heroic presence, natural anatomy',
    ['避免极端仰拍'],
  ],
  [
    '月下庭院',
    'scene_lighting',
    'quiet moonlit courtyard, cool ambient moonlight with warm motivated edge light',
    ['避免背景喧宾夺主'],
  ],
  [
    '无缝影棚',
    'scene_lighting',
    'charcoal seamless studio, large softbox key light, restrained rim light',
    ['避免纯白过曝背景'],
  ],
  [
    '窗边晨光',
    'scene_lighting',
    'soft morning window light, delicate bounce fill, calm indoor atmosphere',
    ['避免错误投影'],
  ],
  [
    '角色立绘站姿',
    'pose',
    'balanced standing pose derived from the character reference, hands relaxed and visible',
    ['避免僵硬木偶姿态'],
  ],
  [
    '轻微回眸',
    'pose',
    'subtle over-the-shoulder glance with natural torso rotation',
    ['避免过度扭转脊柱'],
  ],
  [
    '动态准备式',
    'pose',
    'controlled action-ready stance with readable costume silhouette',
    ['避免动态模糊遮挡服装'],
  ],
].map(([name, category, normalizedText, avoid], index) => ({
  id: `preset-${String(index + 1).padStart(2, '0')}`,
  name,
  category,
  rawText: normalizedText,
  normalizedText,
  avoid,
  tags: ['预置'],
  thumbnail: null,
  version: 1,
  source: 'preset',
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
}));

let initialized = false;
const fileTransaction = new AsyncLocalStorage();
const executionIdentity = new AsyncLocalStorage();
export function withExecutionIdentity(identity, callback) {
  if (!identity?.runId || !identity?.id) throw new Error('缺少执行版本 --run，禁止不带版本的写回');
  return executionIdentity.run(identity, callback);
}
function checkExecutionIdentity(target, type = 'job') {
  const identity = executionIdentity.getStore();
  if (!identity) return;
  if (identity.id !== target.id || identity.type !== type) throw new Error('执行目标不一致');
  if (identity.quality) {
    const run = target.executionRuns.find((item) => item.id === identity.runId);
    if (!run || !['running', 'succeeded'].includes(run.status)) throw new Error('质量检查的执行已失效');
  } else assertRunIdentity(target, identity.runId);
}
function trackNewFile(file) { fileTransaction.getStore()?.push(file); }
export async function withTrackedFiles(callback) {
  const files = [];
  try { return await fileTransaction.run(files, callback); }
  catch (error) { await Promise.all(files.map((file) => fs.unlink(file).catch(() => {}))); throw error; }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await fs.rename(temp, file);
}

export function resolveUnder(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error('路径越界');
  return resolved;
}

export async function withLock(name, callback) {
  const lock = resolveUnder(DATA_ROOT, path.join('runtime', `${name}.lock`));
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      handle = await fs.open(lock, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      );
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.unlink(lock).catch(() => {});
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (!handle) throw new Error('本地任务存储繁忙，请稍后重试');
  try {
    return await callback();
  } finally {
    await handle.close();
    await fs.unlink(lock).catch(() => {});
  }
}

async function parseImageData(dataUrl) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
      dataUrl || '',
    );
  if (!match) throw new Error('仅支持 PNG、JPG、WEBP 图片');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES)
    throw new Error('图片为空或超过 20 MB');
  const mime = match[1];
  const valid =
    mime === 'image/png'
      ? buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg'
        ? buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer.at(-2) === 0xff &&
          buffer.at(-1) === 0xd9
        : buffer.subarray(0, 4).toString() === 'RIFF' &&
          buffer.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new Error('图片内容损坏或扩展格式不匹配');
  await validateDecodedImage(buffer, mime);
  return { buffer, extension: IMAGE_MIMES[mime], mime };
}

async function validateDecodedImage(buffer, mime = 'image/png') {
  try {
    const decoder = sharp(buffer, { failOn: 'warning', limitInputPixels: 40_000_000 });
    const info = await decoder.metadata();
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mime];
    if (info.format !== expected || !info.width || !info.height || (info.pages || 1) > 1)
      throw new Error('无效或多帧图片');
    await decoder.raw().toBuffer();
    return { pixelWidth: info.width, pixelHeight: info.height };
  } catch {
    throw new Error('图片无法完整解码，请重新导出静态 PNG/JPG/WEBP（最多 4000 万像素）');
  }
}

async function persistDataImage(dataUrl, relativeDirectory, stem) {
  const { buffer, extension, mime } = await parseImageData(dataUrl);
  const directory = resolveUnder(DATA_ROOT, relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  const name = `${stem}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const absolute = resolveUnder(directory, name);
  await fs.writeFile(absolute, buffer, { flag: 'wx' });
  const relativePath = path.relative(DATA_ROOT, absolute);
  return {
    path: relativePath,
    url: publicAssetPath(relativePath),
    mime,
    bytes: buffer.length,
    ...imageDimensions(buffer, mime),
  };
}

export async function resolveOutputResolution(aspectRatio, source) {
  let dimensions = source || {};
  if ((!dimensions.pixelWidth || !dimensions.pixelHeight) && source?.path) {
    const metadata = await sharp(resolveUnder(DATA_ROOT, source.path)).metadata();
    dimensions = { pixelWidth: metadata.width, pixelHeight: metadata.height };
  }
  return maximumNativeResolution(aspectRatio, dimensions);
}

async function readCollection(name) {
  return readJson(path.join(DATA_ROOT, name, 'index.json'), []);
}

async function writeCollection(name, value) {
  return writeJsonAtomic(path.join(DATA_ROOT, name, 'index.json'), value);
}

function emptyCard() {
  return Object.fromEntries(
    [
      'hairstyle',
      'hairAccessories',
      'iris',
      'makeup',
      'bodySilhouette',
      'outfitLayers',
      'colors',
      'materials',
      'accessories',
      'footwear',
    ].map((key) => [
      key,
      { value: '', certainty: 'inferred', strongLock: false },
    ]),
  );
}

export function newRun(kind, retryOf = null, backend = null) {
  const now = new Date().toISOString();
  return {
    id: `run-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    kind,
    status: 'queued',
    progress: '等待 Codex',
    events: [{ at: now, type: 'queued', message: '任务已进入本地队列' }],
    retryOf,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    backend,
    handoff: null,
  };
}

function activeRun(job) {
  return job.executionRuns?.find((run) => run.id === job.activeRunId) || null;
}

function hasBlockingRun(job) {
  const run = activeRun(job);
  return Boolean(job.activeRunId && (!run || run.status !== 'waiting_user'));
}

const inboxFile = () => path.join(DATA_ROOT, 'prompts', 'inbox.json');
const packFile = () => path.join(DATA_ROOT, 'prompts', 'photography-packs.json');
const packImportsFile = () => path.join(DATA_ROOT, 'prompts', 'pack-imports.json');
const fullPromptsFile = () => path.join(DATA_ROOT, 'prompts', 'full-prompts.json');

export async function saveFullPrompt(input) {
  await ensureDataRoot();
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('请填写 1–120 字符的名称');
  if (typeof input.rawText !== 'string' || !input.rawText.trim() || input.rawText.length > MAX_FULL_PROMPT) throw new Error('完整 Prompt 必须为 1–30,000 字符');
  const sourceUrl = String(input.sourceUrl || '').trim();
  if (sourceUrl && (!/^https?:\/\//i.test(sourceUrl) || sourceUrl.length > 2000)) throw new Error('来源链接必须为 HTTP(S) 地址');
  return withLock('full-prompts', async () => {
    const items = await readJson(fullPromptsFile(), []);
    const previous = input.id ? items.find((item) => item.id === input.id) : null;
    if (input.id && !previous) throw new Error('完整 Prompt 不存在');
    if (previous && previous.version !== input.version) throw new Error('该 Prompt 已更新，请刷新后再编辑');
    const now = new Date().toISOString();
    const item = {
      id: previous?.id || `full-prompt-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      name: input.name.trim(), rawText: input.rawText,
      originalText: previous?.originalText ?? input.rawText,
      sourceUrl, sourceHash: crypto.createHash('sha256').update(input.rawText).digest('hex'),
      version: (previous?.version || 0) + 1,
      versions: previous ? [...(previous.versions || []), withoutVersions(previous)] : [],
      createdAt: previous?.createdAt || now, updatedAt: now,
    };
    await writeJsonAtomic(fullPromptsFile(), previous ? items.map((entry) => entry.id === item.id ? item : entry) : [...items, item]);
    return item;
  });
}

function activeImportRun(promptImport) {
  return (
    promptImport.executionRuns?.find(
      (run) => run.id === promptImport.activeRunId,
    ) || null
  );
}

function activePackImportRun(packImport) {
  return (
    packImport.executionRuns?.find(
      (run) => run.id === packImport.activeRunId,
    ) || null
  );
}

function normalizePackImport(item) {
  return {
    ...item,
    packKind: item.packKind || 'variable_pool',
    sourceFiles: item.sourceFiles || [],
    revision: item.revision || null,
    licenseSnapshot: item.licenseSnapshot || null,
    draft: item.draft || null,
    packId: item.packId || null,
    executionRuns: item.executionRuns || [],
    activeRunId: item.activeRunId || null,
    error: item.error || null,
  };
}

async function mutatePackImports(updater) {
  await ensureDataRoot();
  return withLock('pack-imports', async () => {
    const imports = (await readJson(packImportsFile(), [])).map(normalizePackImport);
    const identity = executionIdentity.getStore();
    if (identity) checkExecutionIdentity(imports.find((item) => item.id === identity.id) || {}, 'pack_import');
    const result = await updater(imports);
    await writeJsonAtomic(packImportsFile(), imports);
    return result;
  });
}

function queueRun(job, kind, retryOf = null) {
  if (job.activeRunId) throw new Error('当前已有 Codex 任务正在排队或执行');
  const backend = ['baseline', 'adjustment', 'reshoot'].includes(kind)
    ? 'built-in-imagegen'
    : null;
  const run = newRun(kind, retryOf, backend);
  run.inputSnapshot = executionInputs(job, kind);
  return {
    ...job,
    executionRuns: [...(job.executionRuns || []), run],
    activeRunId: run.id,
    error: null,
  };
}

function executionInputs(job, kind) {
  return structuredClone({
    kind, referenceVersion: job.referenceVersion,
    characterCardVersion: job.characterCardVersion,
    configurationVersion: job.configurationVersion,
    characterCard: job.characterCard, references: job.references,
    faceSnapshot: job.faceSnapshot || null, styleSnapshot: job.styleSnapshot || null,
    compiledPrompt: job.compiledPrompt || null,
    compiledAdjustmentPrompt: kind === 'adjustment' ? job.compiledAdjustmentPrompt : null,
    activeAdjustment: kind === 'adjustment' ? job.activeAdjustment : null,
    aspectRatio: job.aspectRatio || 'source',
    outputResolution: kind === 'adjustment' ? job.activeAdjustment?.outputResolution : job.outputResolution,
  });
}

export function assertRunIdentity(target, expectedRunId) {
  if (expectedRunId && target.activeRunId !== expectedRunId)
    throw new Error('该执行已结束或被替换，拒绝过期执行写回');
}

// Every output inherits the context of its own branch, never the current editor.
export function outputContext(job, output, seen = new Set()) {
  if (!output || seen.has(output.id)) throw new Error('源版本历史不完整');
  if (output.mode === 'multi_person') throw new Error('多人结果不能作为单人源图；请在多人合影中从原始人物版本重新准备');
  if (output.inputSnapshot) return structuredClone(output.inputSnapshot);
  seen.add(output.id);
  const parent = output.sourceOutputId && allOutputs(job).find((item) => item.id === output.sourceOutputId);
  if (parent) {
    const context = outputContext(job, parent, seen);
    return output.kind === 'adjustment' ? adjustedContext(context, output) : context;
  }
  const card = job.characterCardHistory?.find((item) => item.version === output.characterCardVersion)?.card;
  const config = job.configurationHistory?.find((item) => item.version === output.configurationVersion);
  const refs = job.referenceHistory?.find((item) => item.version === output.referenceVersion)?.references;
  if (!card && output.characterCardVersion !== job.characterCardVersion)
    throw new Error('旧版本缺少角色卡快照，请选择已有完整记录的源图');
  return structuredClone({
    characterCard: card || job.characterCard,
    faceSnapshot: output.faceSnapshot ?? config?.faceSnapshot ?? null,
    references: output.references || refs || job.references,
    referenceVersion: output.referenceVersion, characterCardVersion: output.characterCardVersion,
    configurationVersion: output.configurationVersion,
  });
}

function adjustedContext(context, adjustment) {
  const next = structuredClone(context);
  const keys = {
    makeup: ['makeup'], hair_accessory: ['hairstyle', 'hairAccessories'],
    body_proportion: ['bodySilhouette'],
    outfit: ['outfitLayers', 'colors', 'materials', 'accessories', 'footwear'],
    other: Object.keys(next.characterCard || {}),
  }[adjustment.category] || [];
  for (const key of keys) if (next.characterCard?.[key]) {
    next.characterCard[key].value = '以当前干净源图中已采用的此项设计为准，不恢复更早版本';
    next.characterCard[key].certainty = 'inferred';
  }
  next.appliedAdjustments = [...(next.appliedAdjustments || []), {
    category: adjustment.category, request: adjustment.request,
    promptModule: adjustment.promptModule, adjustmentReference: adjustment.adjustmentReference,
  }];
  return next;
}

function interruptWaitingHandoff(job, message) {
  const run = activeRun(job);
  if (run?.status !== 'waiting_user') return false;
  const at = new Date().toISOString();
  run.status = 'interrupted';
  run.progress = message;
  run.completedAt = at;
  run.error = { type: 'inputs_changed', message };
  run.events.push({ at, type: 'interrupted', message });
  if (run.handoff) {
    run.handoff.status = 'invalidated';
    run.handoff.invalidatedAt = at;
  }
  if (run.kind === 'reshoot') {
    const batch = job.reshootBatches?.find(
      (entry) => entry.id === job.activeReshootBatchId,
    );
    if (batch) batch.status = 'interrupted';
    job.activeReshootBatchId = null;
  }
  job.activeRunId = null;
  job.error = null;
  return true;
}

function invalidateActiveReshootDraft(job, message) {
  const batch = job.reshootBatches?.find(
    (entry) => entry.id === job.activeReshootBatchId,
  );
  if (!batch || !['draft', 'plan_ready', 'failed', 'interrupted'].includes(batch.status)) return false;
  batch.status = 'interrupted';
  batch.invalidatedReason = message;
  batch.updatedAt = new Date().toISOString();
  job.activeReshootBatchId = null;
  return true;
}

function normalizePromptImport(item) {
  if (item.status !== 'pending_analysis') {
    return {
      ...item,
      drafts: item.drafts || [],
      moduleIds: item.moduleIds || [],
      executionRuns: item.executionRuns || [],
      activeRunId: item.activeRunId || null,
      error: item.error || null,
    };
  }
  const run = newRun('prompt_split');
  return {
    ...item,
    status: 'queued',
    drafts: [],
    moduleIds: [],
    executionRuns: [run],
    activeRunId: run.id,
    error: null,
  };
}

async function mutatePromptImports(updater) {
  await ensureDataRoot();
  return withLock('prompt-imports', async () => {
    const imports = (await readJson(inboxFile(), [])).map(normalizePromptImport);
    const identity = executionIdentity.getStore();
    if (identity) checkExecutionIdentity(imports.find((item) => item.id === identity.id) || {}, 'prompt_import');
    const result = await updater(imports);
    await writeJsonAtomic(inboxFile(), imports);
    return result;
  });
}

function pngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return null;
  return { pixelWidth: buffer.readUInt32BE(16), pixelHeight: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    return null;
  const startOfFrameMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (startOfFrameMarkers.has(marker)) {
      return {
        pixelWidth: buffer.readUInt16BE(offset + 7),
        pixelHeight: buffer.readUInt16BE(offset + 5),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += length + 2;
  }
  return null;
}

function webpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString() !== 'RIFF' ||
    buffer.subarray(8, 12).toString() !== 'WEBP'
  )
    return null;
  const chunk = buffer.subarray(12, 16).toString();
  if (chunk === 'VP8X') {
    return {
      pixelWidth: 1 + buffer.readUIntLE(24, 3),
      pixelHeight: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      pixelWidth: buffer.readUInt16LE(26) & 0x3fff,
      pixelHeight: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      pixelWidth: 1 + (bits & 0x3fff),
      pixelHeight: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  return null;
}

function imageDimensions(buffer, mime) {
  if (mime === 'image/png') return pngDimensions(buffer);
  if (mime === 'image/jpeg') return jpegDimensions(buffer);
  if (mime === 'image/webp') return webpDimensions(buffer);
  return null;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function actualRatio(width, height) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function extensionFromStoredImage(image) {
  const extension = path.extname(image.path || '').toLowerCase().replace('.', '');
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return extension;
  return IMAGE_MIMES[image.mime] || 'png';
}

function handoffAssetName(image, index) {
  const role = String(image.role || 'reference')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'reference';
  return `${String(index + 1).padStart(2, '0')}-${role}.${extensionFromStoredImage(image)}`;
}

async function createWebHandoffDirectory(job, run, kind, prompt, assets, snapshot) {
  const relativeDirectory = path.join('jobs', job.id, 'handoffs', run.id);
  const directory = resolveUnder(DATA_ROOT, relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  const storedAssets = [];
  for (const [index, image] of assets.entries()) {
    const source = resolveUnder(DATA_ROOT, image.path);
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error('交接参考素材不存在');
    const fileName = handoffAssetName(image, index);
    const target = resolveUnder(directory, fileName);
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    const relativePath = path.relative(DATA_ROOT, target);
    storedAssets.push({
      ...image,
      fileName,
      path: relativePath,
      url: publicAssetPath(relativePath),
      bytes: stat.size,
    });
  }
  const promptPath = resolveUnder(directory, 'prompt.txt');
  const manifestPath = resolveUnder(directory, 'manifest.json');
  const createdAt = new Date().toISOString();
  const handoff = {
    id: `handoff-${run.id}`,
    kind,
    status: 'prepared',
    directory: relativeDirectory,
    prompt,
    promptFile: path.relative(DATA_ROOT, promptPath),
    manifestFile: path.relative(DATA_ROOT, manifestPath),
    assets: storedAssets,
    snapshot,
    createdAt,
    importedAt: null,
    invalidatedAt: null,
    outputId: null,
  };
  await fs.writeFile(promptPath, `${prompt}\n`, { encoding: 'utf8', flag: 'wx' });
  await writeJsonAtomic(manifestPath, {
    handoffId: handoff.id,
    jobId: job.id,
    runId: run.id,
    kind,
    backend: 'chatgpt-web-manual',
    createdAt,
    prompt,
    assets: storedAssets.map(({ fileName, role, purpose, mime, bytes }) => ({
      fileName,
      role,
      purpose,
      mime: mime || null,
      bytes,
    })),
    snapshot,
  });
  return handoff;
}

async function startWebHandoff(job, kind, prompt, assets, snapshot) {
  if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
  const run = newRun(kind, null, 'chatgpt-web-manual');
  run.status = 'waiting_user';
  run.progress = '等待从 ChatGPT 网页导回图片';
  run.startedAt = run.createdAt;
  run.events = [
    {
      at: run.createdAt,
      type: 'handoff_prepared',
      message: '网页版生图素材已准备完成',
    },
  ];
  run.handoff = await createWebHandoffDirectory(
    job,
    run,
    kind,
    prompt,
    assets,
    snapshot,
  );
  return {
    ...job,
    executionRuns: [...(job.executionRuns || []), run],
    activeRunId: run.id,
    error: null,
  };
}

export async function createReshootWebHandoffDirectory(job, run, batch, assets) {
  const relativeDirectory = path.join('jobs', job.id, 'handoffs', run.id);
  const directory = resolveUnder(DATA_ROOT, relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  const storedAssets = [];
  for (const [index, image] of assets.entries()) {
    const source = resolveUnder(DATA_ROOT, image.path);
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error('重拍交接参考素材不存在');
    const fileName = handoffAssetName(image, index);
    const target = resolveUnder(directory, fileName);
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    const relativePath = path.relative(DATA_ROOT, target);
    storedAssets.push({
      ...image,
      fileName,
      path: relativePath,
      url: publicAssetPath(relativePath),
      bytes: stat.size,
    });
  }
  const prompts = [];
  for (const [index, variant] of batch.variants.entries()) {
    const fileName = `prompt-${String(index + 1).padStart(2, '0')}.txt`;
    const file = resolveUnder(directory, fileName);
    await fs.writeFile(file, `${variant.compiledPrompt}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    prompts.push({
      variantId: variant.id,
      index: index + 1,
      prompt: variant.compiledPrompt,
      promptFile: path.relative(DATA_ROOT, file),
      outputResolution: variant.outputResolution,
      outputId: null,
      importStatus: 'pending',
      orderedAssets: (['multi_person', 'prompt_creation'].includes(batch.mode) ? storedAssets : [
        storedAssets[0],
        ...(variant.referenceRoles || []).map((role) => {
          const asset = storedAssets.find((item) => item.id === role.referenceId);
          if (!asset) throw new Error('分镜参考素材缺失');
          return { ...asset, role: role.role, purpose: role.purpose };
        }),
        ...storedAssets.filter((item) => item.role === 'outfit_reference'),
        ...storedAssets.filter((item) => item.role.startsWith('character_') || item.role.startsWith('face_')),
      ]).map((asset, position) => ({ ...asset, inputNumber: position + 1 })),
    });
  }
  const allPromptPath = resolveUnder(directory, 'prompt-all.txt');
  await fs.writeFile(
    allPromptPath,
    `${prompts.map((item) => `===== ${String(item.index).padStart(2, '0')} =====\n${item.prompt}`).join('\n\n')}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  const manifestPath = resolveUnder(directory, 'manifest.json');
  const createdAt = new Date().toISOString();
  const handoff = {
    id: `handoff-${run.id}`,
    kind: 'reshoot_batch',
    status: 'prepared',
    directory: relativeDirectory,
    prompt: '',
    promptFile: path.relative(DATA_ROOT, allPromptPath),
    prompts,
    manifestFile: path.relative(DATA_ROOT, manifestPath),
    assets: storedAssets,
    snapshot: { batch: structuredClone(batch) },
    createdAt,
    importedAt: null,
    invalidatedAt: null,
    outputId: null,
    outputIds: [],
  };
  await writeJsonAtomic(manifestPath, {
    handoffId: handoff.id,
    jobId: job.id,
    runId: run.id,
    kind: handoff.kind,
    backend: 'chatgpt-web-manual',
    createdAt,
    prompts: prompts.map(({ variantId, index, prompt, promptFile, orderedAssets }) => ({
      variantId,
      index,
      prompt,
      promptFile: path.basename(promptFile),
      orderedAssets: orderedAssets.map(({ inputNumber, fileName, role, purpose }) => ({ inputNumber, fileName, role, purpose })),
    })),
    assets: storedAssets.map(({ fileName, role, purpose, mime, bytes }) => ({
      fileName,
      role,
      purpose,
      mime: mime || null,
      bytes,
    })),
    batchId: batch.id,
  });
  return handoff;
}

async function startReshootWebHandoff(job, batch, assets) {
  if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
  const run = newRun('reshoot', null, 'chatgpt-web-manual');
  run.status = 'waiting_user';
  run.progress = '等待从 ChatGPT 网页导回重拍批次';
  run.startedAt = run.createdAt;
  run.events = [{
    at: run.createdAt,
    type: 'handoff_prepared',
    message: `网页版重拍素材已准备，共 ${batch.variants.length} 条 Prompt`,
  }];
  run.handoff = await createReshootWebHandoffDirectory(job, run, batch, assets);
  batch.runId = run.id;
  batch.backend = 'chatgpt-web-manual';
  batch.status = 'waiting_user';
  return {
    ...job,
    executionRuns: [...(job.executionRuns || []), run],
    activeRunId: run.id,
    activeReshootBatchId: batch.id,
    error: null,
  };
}

function migrateV1Job(job) {
  if ([2, 3, 4, 5].includes(job.schemaVersion)) {
    const baselineVersions = (job.baselineVersions || []).map((item) => ({
      ...item,
      aspectRatio: item.aspectRatio || 'source',
      backend: item.backend || 'built-in-imagegen',
    }));
    const adjustmentVersions = (job.adjustmentVersions || []).map((item) => ({
      ...item,
      sourceAspectRatio: item.sourceAspectRatio || 'source',
      adjustmentReference: item.adjustmentReference || null,
      promptModule: item.promptModule || null,
      conflictPriority:
        item.conflictPriority ||
        ['explicit_text', 'adjustment_reference', 'prompt_module'],
      backend: item.backend || 'built-in-imagegen',
    }));
    return {
      ...job,
      schemaVersion: 5,
      aspectRatio: validateAspectRatio(job.aspectRatio || 'source'),
      referenceVersion: job.referenceVersion || 1,
      characterCardHistory: job.characterCardHistory || [],
      configurationVersion: job.configurationVersion || 0,
      configurationHistory: (job.configurationHistory || []).map((item) => ({
        ...item,
        aspectRatio: item.aspectRatio || 'source',
        backend: item.backend || 'built-in-imagegen',
      })),
      baselineVersions,
      adjustmentVersions,
      reshootBatches: (job.reshootBatches || []).map((item) => ({
        ...item,
        mode: item.mode || 'variable_pool',
        photographyReferences: item.photographyReferences || [],
        seriesPlanDraft: item.seriesPlanDraft || null,
        diagnosticOutputId: item.diagnosticOutputId || null,
      })),
      reshootVersions: (job.reshootVersions || []).map((item) => ({
        ...item,
        backend: item.backend || 'built-in-imagegen',
        aspectRatio: item.aspectRatio || 'source',
        mode: item.mode || 'variable_pool',
        qualityReview: item.qualityReview || null,
      })),
      activeReshootBatchId: job.activeReshootBatchId || null,
      executionRuns: (job.executionRuns || []).map((run) => ({
        ...run,
        backend:
          run.backend ||
          (['baseline', 'adjustment'].includes(run.kind)
            ? 'built-in-imagegen'
            : null),
        handoff: run.handoff || null,
      })),
      activeRunId: job.activeRunId || null,
      selectedOutputId: job.selectedOutputId || null,
      activeAdjustment: job.activeAdjustment || null,
      legacyCandidates: job.legacyCandidates || [],
      backend:
        job.backend ||
        adjustmentVersions.at(-1)?.backend ||
        baselineVersions.at(-1)?.backend ||
        null,
    };
  }
  const now = new Date().toISOString();
  const oldCandidates = job.candidates || [];
  const firstCandidate = oldCandidates[0];
  const baselineVersions = firstCandidate
    ? [
        {
          ...firstCandidate,
          id: 'baseline-v001',
          kind: 'baseline',
          version: 1,
          fileName: firstCandidate.fileName || 'candidate-01.png',
          prompt: job.compiledPrompt || '',
          aspectRatio: 'source',
          referenceVersion: 1,
          characterCardVersion: job.characterCardVersion || 1,
          configurationVersion: job.compiledPrompt ? 1 : 0,
          backend: 'built-in-imagegen',
          migratedFrom: 'candidate',
        },
      ]
    : [];
  const adjustmentVersions = (job.refinements || []).map((item, index) => ({
    ...item,
    id: `adjustment-v${String(index + 1).padStart(3, '0')}`,
    kind: 'adjustment',
    version: index + 1,
    sourceOutputId: 'baseline-v001',
    category: 'other',
    prompt: job.compiledRefinementPrompt || '',
    preserve: item.preserve || [],
    backend: 'built-in-imagegen',
    migratedFrom: 'refinement',
  }));
  let workflowStep = 'references';
  if (baselineVersions.length) workflowStep = 'adjustment';
  else if (job.compiledPrompt) workflowStep = 'configuration';
  else if (job.characterCardVersion) workflowStep = 'character_card';
  const runs = [];
  let activeRunId = null;
  const legacyKind =
    ['ready_for_analysis', 'analyzing'].includes(job.status)
      ? 'analysis'
      : ['ready_for_generation', 'generating'].includes(job.status)
        ? 'baseline'
        : ['ready_for_refinement', 'refining'].includes(job.status)
          ? 'adjustment'
          : null;
  if (legacyKind && !baselineVersions.length) {
    const run = newRun(
      legacyKind,
      null,
      ['baseline', 'adjustment'].includes(legacyKind)
        ? 'built-in-imagegen'
        : null,
    );
    run.status = job.status.startsWith('ready_for_') ? 'queued' : 'interrupted';
    run.progress = run.status === 'queued' ? '等待 Codex' : '旧任务执行被中断';
    if (run.status === 'interrupted') {
      run.completedAt = now;
      run.error = { type: 'migration_interrupted', message: run.progress };
    } else activeRunId = run.id;
    runs.push(run);
  }
  return {
    schemaVersion: 5,
    id: job.id,
    title: job.title,
    characterId: job.characterId,
    workflowStep,
    referenceVersion: 1,
    references: sortReferences(job.references || []),
    referenceHistory: [
      {
        version: 1,
        references: sortReferences(job.references || []).filter(
          (ref) => !ref.role.startsWith('face_'),
        ),
        createdAt: job.createdAt || now,
      },
    ],
    characterCard: job.characterCard || emptyCard(),
    characterCardVersion: job.characterCardVersion || 0,
    characterCardHistory: job.characterCardVersion
      ? [
          {
            version: job.characterCardVersion,
            card: job.characterCard,
            createdAt: job.analysisCompletedAt || job.updatedAt || now,
          },
        ]
      : [],
    faceProfileId: job.faceProfileId || null,
    styleModuleId:
      (job.promptSnapshot || []).find((item) => item.category === 'style')?.id ||
      null,
    faceSnapshot: job.faceSnapshot || null,
    styleSnapshot:
      (job.promptSnapshot || []).find((item) => item.category === 'style') ||
      null,
    configurationVersion: job.compiledPrompt ? 1 : 0,
    configurationHistory: job.compiledPrompt
      ? [
          {
            version: 1,
            faceProfileId: job.faceProfileId || null,
            styleModuleId:
              (job.promptSnapshot || []).find(
                (item) => item.category === 'style',
              )?.id || null,
            compiledPrompt: job.compiledPrompt,
            aspectRatio: 'source',
            backend: 'built-in-imagegen',
            createdAt: job.updatedAt || now,
            migratedFrom: 'v1',
          },
        ]
      : [],
    compiledPrompt: job.compiledPrompt || '',
    aspectRatio: 'source',
    compiledAdjustmentPrompt: job.compiledRefinementPrompt || '',
    baselineVersions,
    adjustmentVersions,
    reshootBatches: [],
    reshootVersions: [],
    activeReshootBatchId: null,
    legacyCandidates: oldCandidates.slice(1),
    executionRuns: runs,
    activeRunId,
    selectedOutputId:
      adjustmentVersions.at(-1)?.id || baselineVersions.at(-1)?.id || null,
    activeAdjustment: job.activeRefinement
      ? {
          id: `adjustment-${crypto.randomUUID().slice(0, 8)}`,
          sourceOutputId: 'baseline-v001',
          sourceImage: job.activeRefinement.cleanCandidate,
          category: 'other',
          request: job.activeRefinement.request,
          preserve: job.activeRefinement.preserve || [],
          annotation: job.activeRefinement.annotation || null,
          adjustmentReference: null,
          promptModule: null,
          conflictPriority: [
            'explicit_text',
            'adjustment_reference',
            'prompt_module',
          ],
          createdAt: job.activeRefinement.createdAt || now,
        }
      : null,
    backend:
      job.backend ||
      adjustmentVersions.at(-1)?.backend ||
      baselineVersions.at(-1)?.backend ||
      null,
    createdAt: job.createdAt || now,
    updatedAt: now,
    error:
      firstCandidate && job.status === 'failed'
        ? null
        : job.error
          ? { ...job.error, legacy: true }
          : null,
    legacyError: firstCandidate && job.status === 'failed' ? job.error : null,
    legacyStatusHistory: job.statusHistory || [],
  };
}

export const migrateLegacyJob = migrateV1Job;

async function migrateJobs() {
  await withLock('jobs-index', async () => {
    const jobs = await readCollection('jobs');
    const migrated = jobs.map(migrateV1Job);
    let changed = jobs.some(
      (job, index) => JSON.stringify(job) !== JSON.stringify(migrated[index]),
    );
    for (const job of migrated) {
      const legacyOutputs = job.storageMigrationVersion === 2 ? [] : [
        ...(job.baselineVersions || [])
          .filter((item) => item.migratedFrom === 'candidate')
          .map((item) => ({ item, fileName: `baseline-v${String(item.version).padStart(3, '0')}.png` })),
        ...(job.adjustmentVersions || [])
          .filter((item) => item.migratedFrom === 'refinement')
          .map((item) => ({ item, fileName: `adjustment-v${String(item.version).padStart(3, '0')}.png` })),
      ];
      for (const { item, fileName } of legacyOutputs) {
        if (item.fileName === fileName) continue;
        const source = resolveUnder(DATA_ROOT, item.path);
        const relativeTarget = path.join('outputs', job.id, fileName);
        const target = resolveUnder(DATA_ROOT, relativeTarget);
        try {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST') continue;
        }
        const stat = await fs.stat(target).catch(() => null);
        if (!stat?.isFile()) continue;
        item.fileName = fileName;
        item.path = relativeTarget;
        item.url = publicAssetPath(relativeTarget);
        item.bytes = stat.size;
        changed = true;
      }
      if (job.storageMigrationVersion !== 2) {
        job.storageMigrationVersion = 2;
        changed = true;
      }
      for (const output of [
        ...(job.baselineVersions || []),
        ...(job.adjustmentVersions || []),
        ...(job.reshootVersions || []),
      ]) {
        if (output.pixelWidth && output.pixelHeight && output.actualRatio) continue;
        const file = resolveUnder(DATA_ROOT, output.path);
        const buffer = await fs.readFile(file).catch(() => null);
        const mime =
          output.mime ||
          (String(output.path).toLowerCase().endsWith('.webp')
            ? 'image/webp'
            : /\.jpe?g$/i.test(String(output.path))
              ? 'image/jpeg'
              : 'image/png');
        const dimensions = buffer ? imageDimensions(buffer, mime) : null;
        if (!dimensions) continue;
        Object.assign(output, dimensions, {
          actualRatio: actualRatio(dimensions.pixelWidth, dimensions.pixelHeight),
        });
        changed = true;
      }
    }
    if (changed)
      await writeCollection('jobs', migrated);
  });
}

export async function ensureDataRoot() {
  if (initialized) return;
  await Promise.all(
    COLLECTIONS.map((name) =>
      fs.mkdir(path.join(DATA_ROOT, name), { recursive: true }),
    ),
  );
  const promptFile = path.join(DATA_ROOT, 'prompts', 'index.json');
  await withLock('prompts-index', async () => {
    const existing = await readJson(promptFile, seededPrompts.map(reviewedPromptDefault));
    const existingIds = new Set(existing.map((entry) => entry.id));
    const merged = mergePhotographyModules(mergeRealismPresets(existing)).map((entry) => existingIds.has(entry.id) ? entry : reviewedPromptDefault(entry));
    if (JSON.stringify(existing) !== JSON.stringify(merged))
      await writeJsonAtomic(promptFile, merged);
  });
  for (const collection of ['faces', 'jobs']) {
    const file = path.join(DATA_ROOT, collection, 'index.json');
    try {
      await fs.access(file);
    } catch {
      await writeJsonAtomic(file, []);
    }
  }
  const promptInboxFile = inboxFile();
  try {
    await fs.access(promptInboxFile);
  } catch {
    await writeJsonAtomic(promptInboxFile, []);
  }
  const legacyImports = await readJson(promptInboxFile, []);
  const normalizedImports = legacyImports.map(normalizePromptImport);
  if (JSON.stringify(legacyImports) !== JSON.stringify(normalizedImports))
    await writeJsonAtomic(promptInboxFile, normalizedImports);
  for (const file of [packFile(), packImportsFile()]) {
    try {
      await fs.access(file);
    } catch {
      await writeJsonAtomic(file, []);
    }
  }
  const legacyPacks = await readJson(packFile(), []);
  const normalizedPacks = legacyPacks.map((pack) => ({
    ...pack,
    kind: pack.kind || 'variable_pool',
  }));
  if (JSON.stringify(legacyPacks) !== JSON.stringify(normalizedPacks))
    await writeJsonAtomic(packFile(), normalizedPacks);
  const legacyPackImports = await readJson(packImportsFile(), []);
  const normalizedPackImports = legacyPackImports.map(normalizePackImport);
  if (JSON.stringify(legacyPackImports) !== JSON.stringify(normalizedPackImports))
    await writeJsonAtomic(packImportsFile(), normalizedPackImports);
  await migrateJobs();
  initialized = true;
}

async function mutateJobs(updater) {
  await ensureDataRoot();
  return withLock('jobs-index', async () => {
    const files = [];
    return fileTransaction.run(files, async () => {
      try {
        const jobs = await readCollection('jobs');
        const result = await updater(jobs);
        await writeCollection('jobs', jobs);
        return result;
      } catch (error) {
        await Promise.all(files.map((file) => fs.unlink(file).catch(() => {})));
        throw error;
      }
    });
  });
}

export async function getBootstrap() {
  await ensureDataRoot();
  const [faces, prompts, jobs, promptInbox, photographyPacks, packImports, fullPrompts] = await Promise.all([
    readCollection('faces'),
    readCollection('prompts'),
    readCollection('jobs'),
    readJson(inboxFile(), []),
    readJson(packFile(), []),
    readJson(packImportsFile(), []),
    readJson(fullPromptsFile(), []),
  ]);
  const promptImports = promptInbox
    .map(normalizePromptImport)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    faces,
    promptCreations: await listPromptCreations(),
    fullPrompts,
    prompts,
    jobs: [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    promptImports,
    promptInbox: promptImports,
    photographyPacks,
    photographyPackImports: packImports
      .map(normalizePackImport)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export async function createFace(input) {
  await ensureDataRoot();
  if (!input.name?.trim()) throw new Error('脸模名称不能为空');
  if (!['preset', 'private'].includes(input.sourceType))
    throw new Error('脸模来源类型无效');
  if (input.authorizationConfirmed !== true)
    throw new Error('所有上传脸模必须确认拥有使用授权');
  if (
    !Array.isArray(input.images) ||
    !input.images.length ||
    input.images.length > 3
  )
    throw new Error('脸模需要 1–3 张参考照片');
  const id = `face-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const images = [];
  for (const [index, image] of input.images.entries()) {
    if (!['front', 'three_quarter', 'profile'].includes(image.angle))
      throw new Error('脸模角度角色无效');
    images.push({
      ...(await persistDataImage(
        image.dataUrl,
        path.join('faces', id),
        `${String(index + 1).padStart(2, '0')}-${image.angle}`,
      )),
      angle: image.angle,
    });
  }
  const now = new Date().toISOString();
  const cover = input.coverAngle
    ? images.find((image) => image.angle === input.coverAngle)
    : images[0];
  if (!cover) throw new Error('封面角度没有对应参考照片');
  const face = {
    id,
    name: input.name.trim(),
    sourceType: input.sourceType,
    authorizationConfirmed: input.authorizationConfirmed === true,
    images,
    coverImage: cover.url,
    coverAngle: cover.angle,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const faces = await readCollection('faces');
  faces.push(face);
  await writeCollection('faces', faces);
  return face;
}

export async function createPromptModule(input) {
  await ensureDataRoot();
  if (!input.name?.trim() || !input.normalizedText?.trim())
    throw new Error('模块名称和规范化片段不能为空');
  if (!PROMPT_CATEGORIES.includes(input.category))
    throw new Error('Prompt 模块类型无效');
  return withLock('prompts-index', async () => {
    const prompts = await readCollection('prompts');
    const existing = input.id
      ? prompts.find((item) => item.id === input.id)
      : null;
    const now = new Date().toISOString();
    const promptModule = {
      id:
        existing?.id ||
        `prompt-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      name: input.name.trim(),
      category: input.category,
      rawText: (input.rawText || input.normalizedText).trim(),
      normalizedText: input.normalizedText.trim(),
      avoid: Array.isArray(input.avoid)
        ? input.avoid.map((item) => String(item).trim()).filter(Boolean)
        : [],
      tags: Array.isArray(input.tags)
        ? input.tags.map((item) => String(item).trim()).filter(Boolean)
        : [],
      thumbnail: input.thumbnail || null,
      version: (existing?.version || 0) + 1,
      source: existing?.source || 'user',
      ...(existing?.provenance ? { provenance: existing.provenance } : {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      archivedAt: existing?.archivedAt || null,
      versions: existing ? [...(existing.versions || []), withoutVersions(existing)] : [],
    };
    const next = existing
      ? prompts.map((item) =>
          item.id === promptModule.id ? promptModule : item,
        )
      : [...prompts, promptModule];
    await writeCollection('prompts', next);
    return promptModule;
  });
}

export async function createPromptImport(input) {
  await ensureDataRoot();
  if (!input.rawText?.trim()) throw new Error('请先粘贴原始 Prompt');
  if (input.rawText.trim().length > 30_000)
    throw new Error('完整 Prompt 不能超过 30,000 个字符');
  if ((input.title || '').trim().length > 120)
    throw new Error('导入名称不能超过 120 个字符');
  const now = new Date().toISOString();
  const run = newRun('prompt_split');
  const item = {
    id: `prompt-import-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    title: input.title?.trim() || '未命名 Prompt 集',
    rawText: input.rawText.trim(),
    status: 'queued',
    drafts: [],
    moduleIds: [],
    executionRuns: [run],
    activeRunId: run.id,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await mutatePromptImports(async (imports) => {
    imports.push(item);
    return item;
  });
  return item;
}

export const createPromptInbox = createPromptImport;

export async function getPromptImport(id) {
  await ensureDataRoot();
  const item = (await readJson(inboxFile(), [])).map(normalizePromptImport).find(
    (entry) => entry.id === id,
  );
  if (!item) throw new Error('未找到 Prompt 导入任务');
  return item;
}

function promptClaimPath(id, runId = executionIdentity.getStore()?.runId) {
  return resolveUnder(
    DATA_ROOT,
    path.join('prompts', 'imports', id, `.claim-prompt_split${runId ? `-${runId}` : ''}.lock`),
  );
}

export async function claimPromptImport(id) {
  const before = await getPromptImport(id);
  checkExecutionIdentity(before, 'prompt_import');
  const lock = promptClaimPath(id, before.activeRunId);
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('Prompt 拆分任务已被领取，拒绝重复执行');
    throw error;
  } finally {
    await handle?.close();
  }
  try {
    return await mutatePromptImports(async (imports) => {
      const item = imports.find((entry) => entry.id === id);
      const run = item ? activeImportRun(item) : null;
      if (!item || !run || run.kind !== 'prompt_split' || run.status !== 'queued')
        throw new Error('当前没有可领取的 prompt_split 任务');
      const at = new Date().toISOString();
      item.status = 'running';
      item.updatedAt = at;
      run.status = 'running';
      run.progress = '正在拆分完整 Prompt';
      run.startedAt = at;
      run.events.push({ at, type: 'claimed', message: 'Codex 已领取 Prompt 拆分任务' });
      return item;
    });
  } catch (error) {
    await fs.unlink(lock).catch(() => {});
    throw error;
  }
}

export async function releasePromptClaim(id, runId = executionIdentity.getStore()?.runId) {
  await fs.unlink(promptClaimPath(id, runId)).catch(() => {});
}

function normalizeDrafts(drafts) {
  validatePromptDrafts(drafts);
  return drafts.map((draft, index) => ({
    draftId:
      draft.draftId || `draft-${String(index + 1).padStart(2, '0')}`,
    name: draft.name.trim(),
    category: draft.category,
    rawText: draft.rawText.trim(),
    normalizedText: draft.normalizedText.trim(),
    avoid: (draft.avoid || []).map((item) => String(item).trim()).filter(Boolean),
    tags: (draft.tags || []).map((item) => String(item).trim()).filter(Boolean),
    included: draft.included !== false,
  }));
}

export async function applyPromptDrafts(id, drafts) {
  const normalized = normalizeDrafts(drafts);
  const item = await mutatePromptImports(async (imports) => {
    const current = imports.find((entry) => entry.id === id);
    const run = current ? activeImportRun(current) : null;
    if (!current || !run || run.kind !== 'prompt_split' || run.status !== 'running')
      throw new Error('Prompt 草稿只能写入正在执行的拆分任务');
    completeActiveRun(current, 'succeeded', 'Prompt 拆分草稿已写回');
    current.status = 'draft_ready';
    current.drafts = normalized;
    current.updatedAt = new Date().toISOString();
    current.error = null;
    return current;
  });
  await releasePromptClaim(id);
  return item;
}

export async function updatePromptImportDrafts(id, drafts) {
  const normalized = normalizeDrafts(drafts);
  return mutatePromptImports(async (imports) => {
    const item = imports.find((entry) => entry.id === id);
    if (!item) throw new Error('未找到 Prompt 导入任务');
    if (item.status !== 'draft_ready')
      throw new Error('只有待确认的草稿可以编辑');
    item.drafts = normalized;
    item.updatedAt = new Date().toISOString();
    return item;
  });
}

export async function confirmPromptImport(id) {
  await ensureDataRoot();
  return withLock('prompt-imports', () => withLock('prompts-index', async () => {
    const imports = (await readJson(inboxFile(), [])).map(normalizePromptImport);
    const item = imports.find((entry) => entry.id === id);
    if (!item) throw new Error('未找到 Prompt 导入任务');
    if (item.status !== 'draft_ready')
      throw new Error('只有待确认的草稿可以正式入库');
    validatePromptDrafts(item.drafts, { requireSelected: true });
    const now = new Date().toISOString();
    const selected = item.drafts.filter((draft) => draft.included !== false);
    const prompts = await readCollection('prompts');
    const modules = selected.map((draft) => ({
      id: `${item.id}-${draft.draftId}`,
      name: draft.name,
      category: draft.category,
      rawText: draft.rawText,
      normalizedText: draft.normalizedText,
      avoid: draft.avoid || [],
      tags: draft.tags || [],
      thumbnail: null,
      version: 1,
      source: 'user',
      sourceImportId: item.id,
      createdAt: now,
      updatedAt: now,
    }));
    const ids = new Set(modules.map((module) => module.id));
    await writeCollection('prompts', [
      ...prompts.filter((prompt) => !ids.has(prompt.id)),
      ...modules,
    ]);
    item.status = 'completed';
    item.moduleIds = modules.map((module) => module.id);
    item.updatedAt = now;
    item.error = null;
    await writeJsonAtomic(inboxFile(), imports);
    return { promptImport: item, modules };
  }));
}

// Compatibility: the old command now writes editable drafts and never bypasses confirmation.
export const applyPromptInbox = applyPromptDrafts;

export function normalizeGitHubSkillUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('GitHub 地址无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('只允许公开 HTTPS GitHub 地址');
  if (!['github.com', 'raw.githubusercontent.com'].includes(url.hostname))
    throw new Error('只允许 github.com 或 raw.githubusercontent.com');
  if (url.port || url.search || url.hash)
    throw new Error('GitHub 地址不能包含端口、查询参数或锚点');
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'raw.githubusercontent.com') {
    if (parts.length < 4) throw new Error('Raw GitHub 地址缺少仓库、版本或文件路径');
    const pathParts = parts.slice(3);
    if (!/\.md$/i.test(pathParts.at(-1) || '')) pathParts.push('SKILL.md');
    return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[2]}/${pathParts.join('/')}`;
  }
  if (parts.length === 2)
    return `https://github.com/${parts[0]}/${parts[1]}`;
  if (parts.length < 5 || !['tree', 'blob'].includes(parts[2]))
    throw new Error('请输入 GitHub 仓库根、tree、blob 或 raw 链接');
  const [owner, repo, mode, ref, ...sourcePath] = parts;
  if (!owner || !repo || !ref) throw new Error('GitHub 地址缺少仓库或版本');
  const targetPath = [...sourcePath];
  if (mode === 'tree' || !/\.md$/i.test(targetPath.at(-1) || ''))
    targetPath.push('SKILL.md');
  if (!targetPath.length) targetPath.push('SKILL.md');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${targetPath.join('/')}`;
}

function parseNormalizedGitHubSource(normalized) {
  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'raw.githubusercontent.com') {
    return {
      owner: parts[0],
      repo: parts[1],
      ref: parts[2],
      entryPath: parts.slice(3).join('/'),
      root: false,
    };
  }
  return { owner: parts[0], repo: parts[1], ref: null, entryPath: 'SKILL.md', root: true };
}

async function githubDefaultRevision(owner, repo, signal) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    redirect: 'error',
    signal,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'AI-COS-Studio/0.5 local-import',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`无法读取 GitHub 仓库信息 (${response.status})`);
  const metadata = await response.json();
  if (!/^[A-Za-z0-9._/-]+$/.test(metadata.default_branch || ''))
    throw new Error('GitHub 默认分支无效');
  const commitResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(metadata.default_branch)}`,
    {
      redirect: 'error',
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'AI-COS-Studio/0.5 local-import',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!commitResponse.ok)
    throw new Error(`无法固定 GitHub 默认分支 revision (${commitResponse.status})`);
  const commit = await commitResponse.json();
  if (!/^[a-f0-9]{40}$/i.test(commit.sha || ''))
    throw new Error('GitHub revision 无效');
  return commit.sha;
}

async function fetchRawGitHubFile(url, signal, remainingBytes) {
  let current = url;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': 'AI-COS-Studio/0.5 local-import' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) throw new Error('GitHub 重定向次数过多');
      current = normalizeGitHubSkillUrl(new URL(location, current).toString());
      if (!current.startsWith('https://raw.githubusercontent.com/'))
        throw new Error('GitHub 文件重定向目标无效');
      continue;
    }
    if (!response.ok) throw new Error(`GitHub 导入失败 (${response.status})`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > remainingBytes)
      throw new Error('摄影资料超过 100 KiB');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('GitHub 响应没有正文');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > remainingBytes) {
        await reader.cancel();
        throw new Error('摄影资料超过 100 KiB');
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);
    return { resolvedUrl: current, rawText: buffer.toString('utf8'), bytes: buffer.length };
  }
  throw new Error('GitHub 导入失败');
}

function linkedMarkdownPaths(rawText, entryPath) {
  const base = path.posix.dirname(entryPath);
  const found = [];
  for (const match of rawText.matchAll(/\]\(([^)]+\.md)(?:#[^)]+)?\)/gi)) {
    const target = decodeURIComponent(match[1].trim());
    if (/^[a-z]+:/i.test(target) || target.startsWith('//')) continue;
    const normalized = path.posix.normalize(path.posix.join(base, target));
    if (normalized.startsWith('../') || normalized.startsWith('/')) continue;
    if (!found.includes(normalized)) found.push(normalized);
  }
  return found;
}

function safeBundlePath(value) {
  const normalized = path.posix.normalize(String(value || ''));
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/'))
    throw new Error('GitHub 文件路径越界');
  return normalized;
}

async function fetchGitHubBundle(sourceUrl, packKind) {
  const normalizedSourceUrl = normalizeGitHubSkillUrl(sourceUrl);
  const source = parseNormalizedGitHubSource(normalizedSourceUrl);
  const signal = AbortSignal.timeout(10_000);
  const revision = source.ref || await githubDefaultRevision(source.owner, source.repo, signal);
  const entryPath = safeBundlePath(source.entryPath);
  if (packKind === 'series_plan' && path.posix.basename(entryPath) !== 'SKILL.md')
    throw new Error('系列企划 GitHub 导入入口必须是仓库中的 SKILL.md');
  const rawUrl = (file) =>
    `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${revision}/${file}`;
  const files = [];
  let remaining = MAX_PACK_SOURCE_BYTES;
  const fetchOne = async (file, required = true) => {
    const safePath = safeBundlePath(file);
    if (files.some((item) => item.path === safePath)) return;
    if (files.length >= MAX_PACK_SOURCE_FILES) throw new Error('摄影资料引用文件超过 8 个');
    try {
      const fetched = await fetchRawGitHubFile(rawUrl(safePath), signal, remaining);
      remaining -= fetched.bytes;
      files.push({
        path: safePath,
        bytes: fetched.bytes,
        hash: crypto.createHash('sha256').update(fetched.rawText).digest('hex'),
        resolvedUrl: fetched.resolvedUrl,
        rawText: fetched.rawText,
      });
    } catch (error) {
      if (required) throw error;
    }
  };
  await fetchOne(entryPath);
  if (packKind === 'series_plan') {
    for (const linked of linkedMarkdownPaths(files[0].rawText, entryPath)) {
      if (/^(?:agents|evals|tests|scripts)(?:\/|$)/i.test(linked)) continue;
      await fetchOne(linked);
    }
    await fetchOne('manifest.json', false);
    await fetchOne('LICENSE', false);
  }
  const manifest = files.find((item) => item.path === 'manifest.json');
  if (manifest) {
    let parsed;
    try { parsed = JSON.parse(manifest.rawText); } catch { parsed = null; }
    const declared = new Map((parsed?.files || []).map((item) => [item.path, item.sha256]));
    for (const file of files) {
      if (declared.has(file.path) && declared.get(file.path) !== file.hash)
        throw new Error(`GitHub manifest 哈希校验失败：${file.path}`);
    }
  }
  const rawText = files
    .filter((item) => /(?:\.md$|SKILL\.md$)/i.test(item.path))
    .map((item) => `--- FILE: ${item.path} ---\n${item.rawText.trim()}`)
    .join('\n\n');
  const sourceHash = crypto.createHash('sha256')
    .update(files.map((item) => `${item.path}:${item.hash}`).join('\n'))
    .digest('hex');
  return {
    normalizedSourceUrl,
    resolvedUrl: files[0].resolvedUrl,
    revision,
    rawText,
    sourceHash,
    files,
    licenseSnapshot: files.find((item) => item.path === 'LICENSE')?.rawText.trim() || null,
  };
}

export async function createPhotographyPackImport(input) {
  await ensureDataRoot();
  const pasted = String(input.rawText || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  if (Boolean(pasted) === Boolean(sourceUrl))
    throw new Error('请只选择粘贴原文或 GitHub 链接其中一种方式');
  const packKind = input.packKind || 'variable_pool';
  if (!['variable_pool', 'series_plan'].includes(packKind))
    throw new Error('摄影方案包类型无效');
  let rawText = pasted;
  let resolvedUrl = null;
  let normalizedSourceUrl = null;
  let revision = null;
  let sourceFiles = [];
  let licenseSnapshot = null;
  let sourceHash = null;
  if (sourceUrl) {
    const fetched = await fetchGitHubBundle(sourceUrl, packKind);
    normalizedSourceUrl = fetched.normalizedSourceUrl;
    rawText = fetched.rawText.trim();
    resolvedUrl = fetched.resolvedUrl;
    revision = fetched.revision;
    sourceFiles = fetched.files;
    licenseSnapshot = fetched.licenseSnapshot;
    sourceHash = fetched.sourceHash;
  }
  if (!rawText) throw new Error('摄影资料不能为空');
  if (Buffer.byteLength(rawText, 'utf8') > MAX_PACK_SOURCE_BYTES)
    throw new Error('摄影资料超过 100 KiB');
  const now = new Date().toISOString();
  const id = `pack-import-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  sourceHash ||= crypto.createHash('sha256').update(rawText).digest('hex');
  const rawRelativePath = path.join('prompts', 'pack-imports', id, 'source-bundle.md');
  const rawAbsolutePath = resolveUnder(DATA_ROOT, rawRelativePath);
  await fs.mkdir(path.dirname(rawAbsolutePath), { recursive: true });
  await fs.writeFile(rawAbsolutePath, `${rawText}\n`, { encoding: 'utf8', flag: 'wx' });
  const storedSourceFiles = [];
  for (const file of sourceFiles) {
    const relativePath = path.join('prompts', 'pack-imports', id, 'files', file.path);
    const absolutePath = resolveUnder(DATA_ROOT, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.rawText, { encoding: 'utf8', flag: 'wx' });
    storedSourceFiles.push({
      path: file.path,
      rawFile: relativePath,
      resolvedUrl: file.resolvedUrl,
      bytes: file.bytes,
      hash: file.hash,
    });
  }
  const run = newRun('pack_parse');
  const item = {
    id,
    title: String(input.title || '').trim().slice(0, 120) || '未命名摄影方案包',
    packKind,
    sourceType: sourceUrl ? 'github' : 'paste',
    sourceUrl: sourceUrl || null,
    normalizedSourceUrl,
    resolvedUrl,
    sourceHash,
    sourceFiles: storedSourceFiles,
    revision,
    licenseSnapshot,
    rawText,
    rawFile: rawRelativePath,
    authorizationNote: String(input.authorizationNote || '').trim().slice(0, 1000),
    status: 'queued',
    draft: null,
    packId: null,
    executionRuns: [run],
    activeRunId: run.id,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await mutatePackImports(async (imports) => {
    imports.push(item);
    return item;
  });
  return item;
}

export async function getPhotographyPackImport(id) {
  await ensureDataRoot();
  const item = (await readJson(packImportsFile(), []))
    .map(normalizePackImport)
    .find((entry) => entry.id === id);
  if (!item) throw new Error('未找到摄影方案包导入任务');
  return item;
}

function packClaimPath(id, runId = executionIdentity.getStore()?.runId) {
  return resolveUnder(
    DATA_ROOT,
    path.join('prompts', 'pack-imports', id, `.claim-pack_parse${runId ? `-${runId}` : ''}.lock`),
  );
}

export async function claimPhotographyPackImport(id) {
  const before = await getPhotographyPackImport(id);
  checkExecutionIdentity(before, 'pack_import');
  const lock = packClaimPath(id, before.activeRunId);
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('摄影方案包解析任务已被领取');
    throw error;
  } finally {
    await handle?.close();
  }
  try {
    return await mutatePackImports(async (imports) => {
      const item = imports.find((entry) => entry.id === id);
      const run = item ? activePackImportRun(item) : null;
      if (!item || !run || run.kind !== 'pack_parse' || run.status !== 'queued')
        throw new Error('当前没有可领取的 pack_parse 任务');
      const at = new Date().toISOString();
      item.status = 'running';
      item.updatedAt = at;
      run.status = 'running';
      run.progress = '正在解析摄影方案包变量';
      run.startedAt = at;
      run.events.push({ at, type: 'claimed', message: 'Codex 已领取摄影方案包解析任务' });
      return item;
    });
  } catch (error) {
    await fs.unlink(lock).catch(() => {});
    throw error;
  }
}

export async function releasePhotographyPackClaim(id, runId = executionIdentity.getStore()?.runId) {
  await fs.unlink(packClaimPath(id, runId)).catch(() => {});
}

export async function applyPhotographyPackDraft(id, draft) {
  const normalized = normalizePhotographyPackDraft(draft);
  const item = await mutatePackImports(async (imports) => {
    const current = imports.find((entry) => entry.id === id);
    const run = current ? activePackImportRun(current) : null;
    if (!current || !run || run.kind !== 'pack_parse' || run.status !== 'running')
      throw new Error('摄影方案草稿只能写入正在执行的解析任务');
    if (normalized.kind !== current.packKind)
      throw new Error('摄影方案草稿类型与导入任务不一致');
    completeActiveRun(current, 'succeeded', '摄影方案包草稿已写回');
    current.status = 'draft_ready';
    current.draft = normalized;
    current.updatedAt = new Date().toISOString();
    current.error = null;
    return current;
  });
  await releasePhotographyPackClaim(id);
  return item;
}

export async function updatePhotographyPackImportDraft(id, draft) {
  const normalized = normalizePhotographyPackDraft(draft);
  return mutatePackImports(async (imports) => {
    const item = imports.find((entry) => entry.id === id);
    if (!item) throw new Error('未找到摄影方案包导入任务');
    if (item.status !== 'draft_ready') throw new Error('只有待确认的草稿可以编辑');
    if (normalized.kind !== item.packKind)
      throw new Error('摄影方案草稿类型与导入任务不一致');
    item.draft = normalized;
    item.updatedAt = new Date().toISOString();
    return item;
  });
}

function packSourceSnapshot(item) {
  return {
    type: item.sourceType,
    url: item.sourceUrl,
    normalizedUrl: item.normalizedSourceUrl,
    resolvedUrl: item.resolvedUrl,
    hash: item.sourceHash,
    rawFile: item.rawFile,
    files: item.sourceFiles || [],
    revision: item.revision || null,
    license: item.licenseSnapshot || null,
    importedAt: item.createdAt,
    authorizationNote: item.authorizationNote || '',
  };
}

export async function confirmPhotographyPackImport(id) {
  await ensureDataRoot();
  return withLock('pack-imports', () => withLock('photography-packs', async () => {
    const imports = (await readJson(packImportsFile(), [])).map(normalizePackImport);
    const item = imports.find((entry) => entry.id === id);
    if (!item) throw new Error('未找到摄影方案包导入任务');
    if (item.status !== 'draft_ready' || !item.draft)
      throw new Error('只有待确认的摄影方案草稿可以正式入库');
    const draft = normalizePhotographyPackDraft(item.draft);
    const packs = await readJson(packFile(), []);
    const sourceMatch = item.normalizedSourceUrl
      ? packs.find((pack) =>
          pack.source?.normalizedUrl === item.normalizedSourceUrl &&
          (pack.kind || 'variable_pool') === item.packKind,
        )
      : null;
    const now = new Date().toISOString();
    const pack = {
      id: sourceMatch?.id || `pack-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      ...draft,
      version: (sourceMatch?.version || 0) + 1,
      sourceImportId: item.id,
      versions: sourceMatch ? [...(sourceMatch.versions || []), withoutVersions(sourceMatch)] : [],
      source: packSourceSnapshot(item),
      createdAt: sourceMatch?.createdAt || now,
      updatedAt: now,
    };
    await writeJsonAtomic(
      packFile(),
      sourceMatch
        ? packs.map((entry) => (entry.id === sourceMatch.id ? pack : entry))
        : [...packs, pack],
    );
    item.status = 'completed';
    item.packId = pack.id;
    item.updatedAt = now;
    item.error = null;
    await writeJsonAtomic(packImportsFile(), imports);
    return { packImport: item, pack };
  }));
}

export async function updatePhotographyPack(id, input) {
  await ensureDataRoot();
  return withLock('photography-packs', async () => {
    const packs = await readJson(packFile(), []);
    const index = packs.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('未找到摄影方案包');
    const normalized = normalizePhotographyPackDraft({ ...packs[index], ...input });
    const updated = {
      ...packs[index],
      ...normalized,
      versions: [...(packs[index].versions || []), withoutVersions(packs[index])],
      version: (packs[index].version || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    packs[index] = updated;
    await writeJsonAtomic(packFile(), packs);
    return updated;
  });
}

// Explicit local maintenance only: review first, version existing records on
// approval, and reject stale input. Never rewrites jobs, imports or handoffs.
export async function listMaterialCollection() {
  await ensureDataRoot();
  return {
    prompts: await readCollection('prompts'),
    packs: await readJson(packFile(), []),
  };
}

export async function reviseMaterialCollection(plan, { apply = false } = {}) {
  await ensureDataRoot();
  const { kind, edits } = plan || {};
  if (!['prompt', 'pack'].includes(kind) || !Array.isArray(edits) || !edits.length)
    throw new Error('素材修订计划无效');
  const allowed = kind === 'prompt'
    ? ['name', 'normalizedText', 'avoid', 'tags']
    : ['name', 'description', 'globalStyle', 'avoid', 'pools', 'groupInteractions', 'imagingMedia', 'seriesDNA', 'imagingProfile', 'visualHierarchy', 'workflowRules', 'qualityGates', 'excludedDefaults', 'rules'];
  return withLock(kind === 'prompt' ? 'prompts-index' : 'photography-packs', async () => {
    const file = kind === 'prompt' ? path.join(DATA_ROOT, 'prompts', 'index.json') : packFile();
    const items = await readJson(file, []);
    const next = structuredClone(items);
    const seen = new Set();
    const changes = [];
    for (const edit of edits) {
      if (seen.has(edit.id)) throw new Error('修订计划包含重复 ID');
      seen.add(edit.id);
      const index = next.findIndex((item) => item.id === edit.id);
      const old = next[index];
      if (!old || old.archivedAt) throw new Error('素材不存在或已归档');
      if (old.version !== edit.expectedVersion) throw new Error(`素材版本已变化：${old.name}`);
      if (!edit.reason?.trim() || !edit.changes || !Object.keys(edit.changes).length || Object.keys(edit.changes).some((key) => !allowed.includes(key)))
        throw new Error('修订包含未授权字段或缺少理由');
      const candidate = { ...old, ...edit.changes };
      if (!candidate.name?.trim() || (kind === 'prompt' && !candidate.normalizedText?.trim())) throw new Error('素材内容不能为空');
      if (!Array.isArray(candidate.avoid) || candidate.avoid.some((item) => typeof item !== 'string')) throw new Error('避免项格式错误');
      const normalized = kind === 'pack' ? normalizePhotographyPackDraft(candidate) : candidate;
      next[index] = {
        ...old, ...normalized, version: old.version + 1,
        versions: [...(old.versions || []), withoutVersions(old)],
        updatedAt: new Date().toISOString(),
      };
      changes.push({ id: old.id, name: old.name, fromVersion: old.version, toVersion: old.version + 1, reason: edit.reason, fields: Object.keys(edit.changes) });
    }
    if (apply) {
      const directory = await fs.mkdtemp(path.join(DATA_ROOT, 'runtime', 'material-review-'));
      await writeJsonAtomic(path.join(directory, 'before.json'), items);
      await writeJsonAtomic(path.join(directory, 'plan.json'), plan);
      await writeJsonAtomic(file, next);
      return { applied: true, kind, count: changes.length, backupDirectory: directory, changes };
    }
    return { applied: false, kind, count: changes.length, changes };
  });
}

function makeCharacterReferences(savedMain, extras) {
  return sortReferences([
    {
      ...savedMain,
      role: 'character_main',
      purpose:
        '锁定角色整体设计、发型、配色、服装结构、姿态、构图与可见背景',
    },
    ...extras.map((saved, index) => ({
      ...saved,
      role: 'character_detail',
      purpose: saved.purpose || `补充角色局部或侧背面设定 ${index + 1}`,
    })),
  ]);
}

export async function createJob(input) {
  await ensureDataRoot();
  if (!input.mainReference?.dataUrl) throw new Error('动漫角色主图为必填项');
  const id = `job-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const characterId = `character-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const main = await persistDataImage(
    input.mainReference.dataUrl,
    path.join('characters', characterId),
    'r001-main',
  );
  const extras = [];
  for (const [index, ref] of (input.extraReferences || [])
    .slice(0, 6)
    .entries()) {
    const saved = await persistDataImage(
      ref.dataUrl,
      path.join('characters', characterId),
      `r001-detail-${String(index + 1).padStart(2, '0')}`,
    );
    extras.push({ ...saved, purpose: ref.purpose });
  }
  const references = makeCharacterReferences(main, extras);
  const now = new Date().toISOString();
  let job = {
    schemaVersion: 5,
    storageMigrationVersion: 2,
    id,
    title: input.title?.trim() || '未命名 AI COS',
    characterId,
    workflowStep: 'references',
    referenceVersion: 1,
    references,
    referenceHistory: [{ version: 1, references, createdAt: now }],
    characterCard: emptyCard(),
    characterCardVersion: 0,
    characterCardHistory: [],
    faceProfileId: null,
    styleModuleId: null,
    faceSnapshot: null,
    styleSnapshot: null,
    aspectRatio: 'source',
    configurationVersion: 0,
    configurationHistory: [],
    compiledPrompt: '',
    compiledAdjustmentPrompt: '',
    baselineVersions: [],
    adjustmentVersions: [],
    reshootBatches: [],
    reshootVersions: [],
    activeReshootBatchId: null,
    legacyCandidates: [],
    executionRuns: [],
    activeRunId: null,
    selectedOutputId: null,
    activeAdjustment: null,
    backend: null,
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  job = queueRun(job, 'analysis');
  await mutateJobs(async (jobs) => {
    jobs.push(job);
    return job;
  });
  return job;
}

export async function getJob(id) {
  await ensureDataRoot();
  const jobs = await readCollection('jobs');
  const job = jobs.find((entry) => entry.id === id);
  if (!job) throw new Error('未找到任务');
  return job;
}

export async function updateJob(id, updater) {
  return mutateJobs(async (jobs) => {
    const index = jobs.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('未找到任务');
    checkExecutionIdentity(jobs[index]);
    jobs[index] = await updater(structuredClone(jobs[index]));
    jobs[index].updatedAt = new Date().toISOString();
    return jobs[index];
  });
}

export async function updateReferences(id, input) {
  const current = await getJob(id);
  if (hasBlockingRun(current)) throw new Error('Codex 执行期间不能修改参考图');
  const nextVersion = current.referenceVersion + 1;
  const currentMain = current.references.find(
    (ref) => ref.role === 'character_main',
  );
  const main = input.mainReference?.dataUrl
    ? await persistDataImage(
        input.mainReference.dataUrl,
        path.join('characters', current.characterId),
        `r${String(nextVersion).padStart(3, '0')}-main`,
      )
    : currentMain;
  if (!main) throw new Error('角色主图不能为空');
  let extras = current.references
    .filter((ref) => ref.role === 'character_detail')
    .map((ref) => ({ ...ref }));
  if (Array.isArray(input.extraReferences)) {
    extras = [];
    for (const [index, ref] of input.extraReferences.slice(0, 6).entries()) {
      const saved = await persistDataImage(
        ref.dataUrl,
        path.join('characters', current.characterId),
        `r${String(nextVersion).padStart(3, '0')}-detail-${String(index + 1).padStart(2, '0')}`,
      );
      extras.push({ ...saved, purpose: ref.purpose });
    }
  }
  const references = makeCharacterReferences(main, extras);
  return updateJob(id, (job) => {
    interruptWaitingHandoff(job, '角色参考已更新，原网页版交接已失效');
    invalidateActiveReshootDraft(job, '角色参考已更新，原重拍草稿已失效');
    const reset = {
      ...job,
      title: input.title?.trim() || job.title,
      workflowStep: 'references',
      referenceVersion: nextVersion,
      references,
      referenceHistory: [
        ...(job.referenceHistory || []),
        { version: nextVersion, references, createdAt: new Date().toISOString() },
      ],
      characterCard: emptyCard(),
      activeAdjustment: null,
    };
    return queueRun(reset, 'analysis');
  });
}

export async function requestAnalysis(id) {
  return updateJob(id, (job) => {
    const run = activeRun(job);
    if (run?.kind === 'analysis' && ['queued', 'running'].includes(run.status))
      return job;
    return queueRun({ ...job, workflowStep: 'references' }, 'analysis');
  });
}

function claimPath(id, kind, runId = null) {
  if (runId && !/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('执行版本无效');
  return resolveUnder(DATA_ROOT, path.join('jobs', id, `.claim-${kind}${runId ? `-${String(runId)}` : ''}.lock`));
}

export async function claimJob(id, requestedKind) {
  const kind = normalizeRunKind(requestedKind);
  if (!['analysis', 'baseline', 'adjustment', 'series_deconstruct', 'prompt_adapt', 'reshoot'].includes(kind))
    throw new Error('领取类型必须为 analysis、baseline、adjustment、series_deconstruct 或 reshoot');
  const beforeClaim = await getJob(id);
  checkExecutionIdentity(beforeClaim);
  const lock = claimPath(id, kind, beforeClaim.activeRunId);
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('任务已被领取，拒绝重复执行');
    throw error;
  } finally {
    await handle?.close();
  }
  try {
    return await updateJob(id, (job) => {
      const run = activeRun(job);
      if (!run || run.kind !== kind || run.status !== 'queued')
        throw new Error(`当前没有可领取的 ${kind} 任务`);
      if (
        ['baseline', 'adjustment', 'reshoot'].includes(kind) &&
        run.backend !== 'built-in-imagegen'
      )
        throw new Error('网页交接任务不能由 Codex 领取');
      const at = new Date().toISOString();
      run.status = 'running';
      run.progress =
        kind === 'analysis'
          ? '正在解析角色参考'
          : kind === 'prompt_adapt' ? '正在适配完整 Prompt，不生成图片'
          : kind === 'series_deconstruct'
            ? '正在拆解写真参考组'
            : '正在调用内置 imagegen';
      run.startedAt = at;
      run.events.push({ at, type: 'claimed', message: 'Codex 已领取任务' });
      if (kind === 'reshoot') {
        const batch = findReshootBatch(job, job.activeReshootBatchId);
        batch.status = 'running';
        batch.variants = batch.variants.map((variant) => ({
          ...variant,
          status: variant.status === 'queued' ? 'running' : variant.status,
        }));
      }
      if (kind === 'series_deconstruct' || kind === 'prompt_adapt') {
        const batch = findReshootBatch(job, job.activeReshootBatchId);
        if (batch.mode !== (kind === 'prompt_adapt' ? 'full_prompt' : 'series_plan')) throw new Error('当前批次与解析类型不符');
        batch.status = 'running';
      }
      return job;
    });
  } catch (error) {
    await fs.unlink(lock).catch(() => {});
    throw error;
  }
}

export async function releaseClaim(id, requestedKind, runId = executionIdentity.getStore()?.runId) {
  const kind = normalizeRunKind(requestedKind);
  await fs.unlink(claimPath(id, kind, runId)).catch(() => {});
}

function completeActiveRun(job, status, progress, error = null) {
  const run = activeRun(job);
  if (!run) throw new Error('当前没有活动执行任务');
  const at = new Date().toISOString();
  run.status = status;
  run.progress = progress;
  run.completedAt = at;
  run.error = error;
  run.events.push({
    at,
    type: status,
    message: error?.message || progress,
  });
  job.activeRunId = null;
  return run;
}

export async function applyCharacterCard(id, card) {
  validateCharacterCard(card);
  const job = await updateJob(id, (current) => {
    const run = activeRun(current);
    if (run?.kind !== 'analysis' || run.status !== 'running')
      throw new Error('角色卡只能写入正在执行的解析任务');
    const version = (current.characterCardVersion || 0) + 1;
    completeActiveRun(current, 'succeeded', '角色还原卡已写回');
    return {
      ...current,
      workflowStep: 'character_card',
      characterCard: card,
      characterCardVersion: version,
      characterCardHistory: [
        ...(current.characterCardHistory || []),
        { version, card, source: 'codex_analysis', createdAt: new Date().toISOString() },
      ],
      error: null,
    };
  });
  await releaseClaim(id, 'analysis');
  return job;
}

export async function saveCharacterCard(id, inputCard) {
  validateCharacterCard(inputCard);
  return updateJob(id, (job) => {
    if (hasBlockingRun(job)) throw new Error('Codex 执行期间不能修改角色卡');
    interruptWaitingHandoff(job, '角色卡已更新，原网页版交接已失效');
    invalidateActiveReshootDraft(job, '角色卡已更新，原重拍草稿已失效');
    const card = structuredClone(inputCard);
    for (const [key, item] of Object.entries(card)) {
      const previous = job.characterCard?.[key];
      if (
        !previous ||
        previous.value !== item.value ||
        previous.strongLock !== item.strongLock
      )
        item.certainty = 'user_confirmed';
    }
    const version = (job.characterCardVersion || 0) + 1;
    return {
      ...job,
      workflowStep: 'configuration',
      characterCard: card,
      characterCardVersion: version,
      characterCardHistory: [
        ...(job.characterCardHistory || []),
        { version, card, source: 'user_edit', createdAt: new Date().toISOString() },
      ],
      error: null,
    };
  });
}

function faceReferences(face) {
  return (face?.images || []).slice(0, 3).map((image) => ({
    ...image,
    role:
      image.angle === 'front'
        ? 'face_front'
        : image.angle === 'three_quarter'
          ? 'face_three_quarter'
          : 'face_profile',
    purpose: '仅用于锁定脸模五官身份',
  }));
}

export async function configureAndQueueBaseline(id, input) {
  const [faces, prompts] = await Promise.all([
    readCollection('faces'),
    readCollection('prompts'),
  ]);
  const backend = validateGenerationBackend(
    input.backend || 'built-in-imagegen',
  );
  return updateJob(id, async (job) => {
    if (hasBlockingRun(job))
      throw new Error('当前已有 Codex 任务正在排队或执行');
    interruptWaitingHandoff(job, '生成配置已更新，原网页交接已失效');
    invalidateActiveReshootDraft(job, '生成配置已更新，原重拍草稿已失效');
    validateCharacterCard(job.characterCard);
    const face = input.faceProfileId
      ? faces.find((entry) => entry.id === input.faceProfileId)
      : null;
    if (input.faceProfileId && (!face || face.archivedAt)) throw new Error('所选脸模不存在或已归档');
    if (face && !face.authorizationConfirmed)
      throw new Error('脸模未确认授权，请在脸模库补充确认');
    const styleId = input.styleModuleId || null;
    const style = input.styleModuleId === null ? null : styleId
      ? prompts.find((entry) => entry.id === styleId && entry.category === 'style')
      : prompts.find((entry) => entry.category === 'style' && !entry.archivedAt) || null;
    if (styleId && (!style || style.archivedAt)) throw new Error('所选摄影风格不存在、已归档或类型错误');
    const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
    const characterRefs = job.references.filter(
      (ref) => !ref.role.startsWith('face_'),
    );
    const references = sortReferences([
      ...characterRefs,
      ...faceReferences(face),
    ]);
    const compiledPrompt = compileBaselinePrompt({
      characterCard: job.characterCard,
      faceProfile: face,
      styleModule: style,
      references,
      aspectRatio,
      outputResolution: await resolveOutputResolution(aspectRatio, characterRefs.find((ref) => ref.role === 'character_main')),
    });
    const version = (job.configurationVersion || 0) + 1;
    const outputResolution = await resolveOutputResolution(aspectRatio, characterRefs.find((ref) => ref.role === 'character_main'));
    const configured = {
      ...job,
      workflowStep: 'configuration',
      faceProfileId: face?.id || null,
      styleModuleId: style?.id || null,
      faceSnapshot: face || null,
      styleSnapshot: style || null,
      aspectRatio,
      outputResolution,
      references,
      compiledPrompt,
      activeAdjustment: null,
      configurationVersion: version,
      configurationHistory: [
        ...(job.configurationHistory || []),
        {
          version,
          faceProfileId: face?.id || null,
          styleModuleId: style?.id || null,
          faceSnapshot: face || null,
          styleSnapshot: style || null,
          aspectRatio,
          outputResolution,
          backend,
          compiledPrompt,
          createdAt: new Date().toISOString(),
        },
      ],
      error: null,
    };
    if (backend === 'built-in-imagegen')
      return queueRun(configured, 'baseline');
    return startWebHandoff(configured, 'baseline', compiledPrompt, references, {
      inputSnapshot: executionInputs(configured, 'baseline'),
      outputResolution,
      referenceVersion: job.referenceVersion,
      characterCardVersion: job.characterCardVersion,
      configurationVersion: version,
      aspectRatio,
      references,
      faceSnapshot: face || null,
      styleSnapshot: style || null,
    });
  });
}

// Compatibility endpoint for the v1 UI and commands.
export async function configureAndConfirmJob(id, input) {
  if (input.characterCard) await saveCharacterCard(id, input.characterCard);
  const prompts = await readCollection('prompts');
  const styleModuleId = (input.promptModuleIds || []).find(
    (moduleId) =>
      prompts.find((item) => item.id === moduleId)?.category === 'style',
  );
  return configureAndQueueBaseline(id, {
    faceProfileId: input.faceProfileId || null,
    styleModuleId: styleModuleId || null,
    aspectRatio: input.aspectRatio || 'source',
    backend: input.backend || 'built-in-imagegen',
  });
}

function allOutputs(job) {
  return [
    ...(job.baselineVersions || []),
    ...(job.adjustmentVersions || []),
    ...(job.reshootVersions || []),
  ];
}

function withoutVersions(item) {
  const { versions: _versions, ...snapshot } = item;
  return structuredClone(snapshot);
}

export async function updateFace(id, input) {
  return withLock('faces-index', async () => {
    const faces = await readCollection('faces');
    const face = faces.find((item) => item.id === id);
    if (!face) throw new Error('脸模不存在');
    if (!input.name?.trim() || input.authorizationConfirmed !== true) throw new Error('请填写名称并确认脸模使用授权');
    let images = face.images.filter((item) => !(input.removeAngles || []).includes(item.angle));
    for (const image of input.images || []) {
      if (!['front', 'three_quarter', 'profile'].includes(image.angle)) throw new Error('无效脸模角度');
      const saved = await persistDataImage(image.dataUrl, path.join('faces', id), `v${face.version + 1}-${image.angle}`);
      images = [...images.filter((item) => item.angle !== image.angle), { ...saved, angle: image.angle }];
    }
    if (!images.length || images.length > 3) throw new Error('请保留 1–3 张照片');
    const cover = images.find((item) => item.angle === input.coverAngle) || images[0];
    const previous = withoutVersions(face);
    Object.assign(face, { name: input.name.trim().slice(0, 120), images, authorizationConfirmed: true,
      coverImage: cover.url, coverAngle: cover.angle, version: face.version + 1,
      versions: [...(face.versions || []), previous], updatedAt: new Date().toISOString() });
    await writeCollection('faces', faces);
    return face;
  });
}

export async function archiveMaterial(kind, id, archived) {
  const collection = { face: 'faces', prompt: 'prompts', pack: 'photography-packs' }[kind];
  if (!collection || typeof archived !== 'boolean') throw new Error('素材归档参数无效');
  return withLock(kind === 'pack' ? collection : `${collection}-index`, async () => {
    const items = kind === 'pack' ? await readJson(packFile(), []) : await readCollection(collection);
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new Error('素材不存在');
    item.archivedAt = archived ? new Date().toISOString() : null;
    item.updatedAt = new Date().toISOString();
    if (kind === 'pack') await writeJsonAtomic(packFile(), items);
    else await writeCollection(collection, items);
    return item;
  });
}

export async function updateOutputMetadata(id, input) {
  return updateJob(id, (job) => {
    if (!allOutputs(job).some((output) => output.id === input.outputId)) throw new Error('输出不存在');
    const review = input.faceReview !== undefined ? normalizeFaceReview(input.faceReview) : null;
    if (review && job.activeRunId) throw new Error('请先完成或取消当前执行，再修改面部验收，避免影响已冻结输入');
    job.outputAnnotations ||= {};
    const before = job.outputAnnotations[input.outputId] || {};
    job.outputAnnotations[input.outputId] = {
      ...before, ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(typeof input.adopted === 'boolean' ? { adopted: input.adopted } : {}),
      ...(typeof input.note === 'string' ? { note: input.note.slice(0, 2000) } : {}),
      ...(review ? { faceReview: review, faceReviewHistory: [...(before.faceReviewHistory || []), review] } : {}),
    };
    if (input.cover === true) job.coverOutputId = input.outputId;
    return job;
  });
}

export async function createLocalBackup(jobId = null) {
  await ensureDataRoot();
  return withLock('jobs-index', async () => {
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}`;
    const directory = resolveUnder(DATA_ROOT, path.join('backups', stamp));
    await fs.mkdir(directory, { recursive: true });
    const archive = path.join(directory, jobId ? 'artwork.tar.gz' : 'studio-backup.tar.gz');
    if (jobId) {
      const job = await getJob(jobId);
      const paths = new Set();
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.path === 'string' && /^(faces|characters|jobs|outputs)\//.test(node.path)) paths.add(node.path);
        for (const value of Object.values(node)) if (typeof value === 'object') walk(value);
      };
      walk(job);
      const manifest = path.join(directory, 'artwork.json');
      await writeJsonAtomic(manifest, job);
      const existing = [];
      for (const file of paths) if ((await fs.stat(resolveUnder(DATA_ROOT, file)).catch(() => null))?.isFile()) existing.push(file);
      await execFileAsync('/usr/bin/tar', ['-czf', archive, '-C', DATA_ROOT, ...existing, path.relative(DATA_ROOT, manifest)]);
    } else await execFileAsync('/usr/bin/tar', ['-czf', archive, '--exclude=runtime', '--exclude=backups', '-C', DATA_ROOT, 'faces', 'characters', 'prompts', 'jobs', 'outputs']);
    const relative = path.relative(DATA_ROOT, archive);
    return { path: relative, url: publicAssetPath(relative), name: path.basename(archive) };
  });
}

function compatibleModuleCategories(category) {
  if (category === 'pose') return ['pose'];
  if (category === 'outfit') return ['outfit'];
  if (category === 'background') return ['scene_lighting'];
  if (category === 'body_proportion') return ['body_proportion'];
  if (category === 'makeup') return ['makeup'];
  if (category === 'hair_accessory') return ['hair_accessory'];
  if (category === 'camera_lighting')
    return ['camera_angle', 'scene_lighting', 'style'];
  return [];
}

export async function createAdjustment(id, input) {
  const prompts = await readCollection('prompts');
  const job = await getJob(id);
  if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
  const backend = validateGenerationBackend(
    input.backend || 'built-in-imagegen',
  );
  if (!ADJUSTMENT_CATEGORIES.includes(input.category))
    throw new Error('请选择一个有效调整类别');
  const requestText = input.request?.trim() || '';
  if (requestText.length > 2000)
    throw new Error('调整要求不能超过 2000 个字符');
  const outputs = allOutputs(job);
  const sourceOutputId =
    input.sourceOutputId || job.selectedOutputId || outputs.at(-1)?.id;
  const sourceImage = outputs.find((item) => item.id === sourceOutputId);
  if (!sourceImage) throw new Error('未找到调整源图');
  const allowedCategories = compatibleModuleCategories(input.category);
  const promptModule = input.promptModuleId
    ? prompts.find((item) => item.id === input.promptModuleId)
    : null;
  if (input.promptModuleId && (!promptModule || promptModule.archivedAt))
    throw new Error('所选 Prompt 模块不存在');
  if (
    promptModule &&
    !allowedCategories.includes(promptModule.category)
  )
    throw new Error('所选 Prompt 模块不适用于本调整类别');
  if (!requestText && !promptModule && !input.adjustmentReferenceDataUrl)
    throw new Error('文字要求、Prompt 模块、调整参考图至少提供一项');
  let annotation = null;
  if (input.annotationDataUrl)
    annotation = await persistDataImage(
      input.annotationDataUrl,
      path.join('jobs', id),
      `annotation-${Date.now()}`,
    );
  let adjustmentReference = null;
  if (input.adjustmentReferenceDataUrl) {
    const saved = await persistDataImage(
      input.adjustmentReferenceDataUrl,
      path.join('jobs', id),
      `adjustment-reference-${input.category}-${Date.now()}`,
    );
    adjustmentReference = {
      ...saved,
      role: 'adjustment_reference',
      category: input.category,
      purpose: `只用于本轮 ${input.category} 调整，不用于脸部身份或其他类别`,
    };
  }
  if (!requestText && !promptModule && !adjustmentReference)
    throw new Error('文字要求、Prompt 模块、调整参考图至少提供一项');
  const context = outputContext(job, sourceImage);
  const preserve = buildAdjustmentPreserve(context.characterCard, input.category);
  const relevantRole =
    input.category === 'makeup'
      ? ['character_main', 'character_detail', 'face_front', 'face_three_quarter']
      : ['character_main', 'character_detail'];
  const references = context.references.filter((ref) =>
    relevantRole.includes(ref.role),
  );
  const compiledPrompt = compileAdjustmentPrompt({
    characterCard: context.characterCard,
    faceProfile: context.faceSnapshot,
    references,
    category: input.category,
    request: requestText,
    preserve,
    promptModule,
    hasAnnotation: Boolean(annotation),
    adjustmentReference,
    outputResolution: await resolveOutputResolution('source', sourceImage),
  });
  return updateJob(id, async (current) => {
    if (current.activeRunId) throw new Error('当前已有任务正在等待或执行');
    invalidateActiveReshootDraft(
      current,
      '已开始单项调整，原重拍草稿已失效',
    );
    const adjustment = {
      id: `adjustment-request-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      sourceOutputId,
      sourceImage,
      outputResolution: await resolveOutputResolution('source', sourceImage),
      inputSnapshot: context,
      category: input.category,
      request: requestText,
      preserve,
      annotation,
      adjustmentReference,
      promptModule,
      references,
      conflictPriority: [
        'explicit_text',
        'adjustment_reference',
        'prompt_module',
      ],
      referenceVersion: context.referenceVersion,
      characterCardVersion: context.characterCardVersion,
      configurationVersion: context.configurationVersion,
      createdAt: new Date().toISOString(),
    };
    const prepared = {
      ...current,
      workflowStep: 'adjustment',
      selectedOutputId: sourceOutputId,
      activeAdjustment: adjustment,
      compiledAdjustmentPrompt: compiledPrompt,
      error: null,
    };
    if (backend === 'built-in-imagegen')
      return queueRun(prepared, 'adjustment');
    const orderedAssets = [
      {
        ...sourceImage,
        role: 'edit_source',
        purpose: '作为干净源图；锁定脸部身份、人物、画幅和所有非调整项',
      },
      ...(annotation
        ? [
            {
              ...annotation,
              role: 'annotation',
              purpose: '只用于定位本轮修改区域，不作为内容来源',
            },
          ]
        : []),
      ...(adjustmentReference ? [adjustmentReference] : []),
      ...references,
    ];
    return startWebHandoff(
      prepared,
      'adjustment',
      compiledPrompt,
      orderedAssets,
      {
        referenceVersion: current.referenceVersion,
        characterCardVersion: current.characterCardVersion,
        configurationVersion: current.configurationVersion,
        activeAdjustment: adjustment,
      },
    );
  });
}

// Compatibility adapter for old refinement callers.
export async function createRefinement(id, input) {
  const job = await getJob(id);
  const candidate = (job.baselineVersions || [])[Number(input.candidateIndex) - 1];
  return createAdjustment(id, {
    sourceOutputId: candidate?.id || job.selectedOutputId,
    category: 'other',
    request: input.request,
    annotationDataUrl: input.annotationDataUrl,
  });
}

function cleanReshootLocks(locks = {}) {
  const result = {};
  for (const key of RESHOOT_LOCK_KEYS) {
    const value = String(locks[key] || '').trim();
    if (value) result[key] = value.slice(0, 500);
  }
  return result;
}

async function resolveRealismStyle(id) {
  if (!id) return null;
  const style = (await readCollection('prompts')).find((item) => item.id === id);
  if (!isRealismPreset(id) || !style || style.archivedAt || style.category !== 'style')
    throw new Error('成像预设不存在或已归档，请重新选择');
  return structuredClone(style);
}

function makeReshootVariants(job, pack, input, previousVariants = []) {
  const quantity = Number(input.quantity || previousVariants.length || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4)
    throw new Error('创意重拍数量必须为 1–4 张');
  const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
  const allowOutfit = input.allowOutfit === true;
  if (allowOutfit && input.adultConfirmed !== true)
    throw new Error('允许换装前必须确认角色为成年人');
  const locks = cleanReshootLocks(input.locks || {});
  const seed = String(
    input.seed || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  const selected = selectPhotographyVariables({
    pack,
    quantity,
    locks,
    seed,
  });
  return selected.map(({ seed: variantSeed, selections }, index) => ({
    id:
      previousVariants[index]?.id ||
      `reshoot-variant-${Date.now()}-${index + 1}-${crypto.randomUUID().slice(0, 5)}`,
    index: index + 1,
    seed: variantSeed,
    selections: allowOutfit
      ? selections
      : Object.fromEntries(
          Object.entries(selections).filter(([key]) => key !== 'outfitStyle'),
        ),
    compiledPrompt: compileReshootPrompt({
      references: job.references,
      outputResolution: input.outputResolution,
      realismStyle: input.realismStyleSnapshot || null,
      characterCard: job.characterCard,
      faceProfile: job.faceSnapshot,
      pack,
      selections: allowOutfit
        ? selections
        : Object.fromEntries(
            Object.entries(selections).filter(([key]) => key !== 'outfitStyle'),
          ),
      locks,
      allowOutfit,
      creative: input.creativePolicy,
      outfitReference: input.outfitReference,
      aspectRatio,
    }),
    userEdited: false,
    outputResolution: input.outputResolution,
    status: 'draft',
    outputId: null,
    error: null,
  }));
}

async function prepareCreativePolicy(id, batchId, input) {
  const policy = creativePolicy(input.creativePolicy || { allowOutfit: input.allowOutfit });
  const allowOutfit = policy.mode === 'character';
  if (allowOutfit && input.adultConfirmed !== true) throw new Error('角色演绎换装前必须确认角色为成年人并授权换装');
  if (allowOutfit && policy.outfitSource === 'text' && !policy.outfitDirection.trim()) throw new Error('请填写服装要求');
  if (policy.outfitSource === 'reference' && !input.outfitReferenceDataUrl) throw new Error('请上传服装参考图');
  if (input.outfitReferenceDataUrl && policy.outfitSource !== 'reference') throw new Error('只有参考图服装来源可上传服装图');
  const outfitReference = policy.outfitSource === 'reference' ? {
    ...await persistDataImage(input.outfitReferenceDataUrl, path.join('jobs', id, 'wardrobe', batchId), 'outfit'),
    id: 'outfit-reference', role: 'outfit_reference', purpose: '只参考本轮服装结构、配色、材质和穿搭，不提供脸、身体、妆容、发型、发饰或姿态',
  } : null;
  return { creativePolicy: policy, allowOutfit, adultConfirmed: input.adultConfirmed === true, outfitReference };
}

export async function createFullPromptReshoot(id, input) {
  await ensureDataRoot();
  const template = (await readJson(fullPromptsFile(), [])).find((item) => item.id === input.templateId);
  if (!template) throw new Error('请先收藏并选择完整 Prompt');
  if (input.templateVersion !== undefined && input.templateVersion !== template.version) throw new Error('完整 Prompt 已更新，请刷新后确认要使用的版本');
  return updateJob(id, async (job) => {
    if (job.activeRunId) throw new Error('请先结束当前执行');
    const sourceImage = allOutputs(job).find((item) => item.id === (input.sourceOutputId || job.selectedOutputId));
    if (!sourceImage) throw new Error('请选择已有单人源图');
    assertFaceReviewed(job, sourceImage);
    const context = outputContext(job, sourceImage);
    if (context.faceSnapshot && !context.faceSnapshot.authorizationConfirmed) throw new Error('脸模未获使用授权');
    const idForBatch = `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const creative = await prepareCreativePolicy(id, idForBatch, input);
    const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
    const now = new Date().toISOString();
    const batch = {
      id: idForBatch, mode: 'full_prompt', status: 'queued', quantity: 1,
      sourceOutputId: sourceImage.id, sourceImage: structuredClone(sourceImage), inputSnapshot: context,
      templateSnapshot: withoutVersions(template), adaptationDraft: null, adaptationConfirmedAt: null,
      packId: null, packVersion: null, packSnapshot: null,
      aspectRatio, outputResolution: await resolveOutputResolution(aspectRatio, sourceImage), ...creative,
      variants: [], photographyReferences: [], seriesPlanDraft: null, diagnosticOutputId: null, locks: {},
      backend: null, runId: null, referenceVersion: context.referenceVersion,
      characterCardVersion: context.characterCardVersion, configurationVersion: context.configurationVersion,
      createdAt: now, updatedAt: now,
    };
    invalidateActiveReshootDraft(job, '已创建完整 Prompt 适配任务，旧草稿保留但不再执行');
    job.reshootBatches.push(batch);
    job.activeReshootBatchId = batch.id;
    job.selectedOutputId = sourceImage.id;
    job.workflowStep = 'adjustment';
    const queued = queueRun(job, 'prompt_adapt');
    batch.runId = queued.activeRunId;
    return queued;
  });
}

export async function applyFullPromptAdaptation(id, input) {
  const result = await updateJob(id, (job) => {
    const run = activeRun(job);
    const batch = findReshootBatch(job, job.activeReshootBatchId);
    if (run?.kind !== 'prompt_adapt' || run.status !== 'running' || batch.mode !== 'full_prompt' || batch.runId !== run.id) throw new Error('没有正在执行的完整 Prompt 适配任务');
    batch.adaptationDraft = normalizeAdaptation(batch.templateSnapshot.rawText, input);
    batch.status = 'plan_ready';
    batch.updatedAt = new Date().toISOString();
    completeActiveRun(job, 'succeeded', '角色适配草稿已返回，等待用户确认；尚未生图');
    job.error = null;
    return job;
  });
  await releaseClaim(id, 'prompt_adapt');
  return result;
}

export async function editFullPromptAdaptation(id, batchId, input, confirm = false) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('执行期间不能修改适配内容');
    const batch = findReshootBatch(job, batchId);
    if (batch.mode !== 'full_prompt' || batch.status !== 'plan_ready' || !batch.adaptationDraft) throw new Error('适配草稿尚未就绪或已确认');
    const draft = normalizeAdaptation(batch.templateSnapshot.rawText, input);
    batch.adaptationDraft = draft;
    batch.updatedAt = new Date().toISOString();
    if (confirm) {
      const context = batch.inputSnapshot;
      batch.variants = [{
        id: `reshoot-variant-${crypto.randomUUID()}`, index: 1, seed: `full-${batch.id}`, selections: {},
        compiledPrompt: compileFullPromptReshoot({ characterCard: context.characterCard, faceProfile: context.faceSnapshot, creative: batch.creativePolicy, adaptedText: draft.adaptedText, references: context.references, outfitReference: batch.outfitReference, aspectRatio: batch.aspectRatio, outputResolution: batch.outputResolution }),
        outputResolution: batch.outputResolution, userEdited: false, status: 'draft', outputId: null, error: null,
      }];
      batch.adaptationConfirmedAt = batch.updatedAt;
      batch.status = 'draft';
    }
    return job;
  });
}

export async function createMultiPersonDraft(id, input) {
  validateGroupParticipants(input.participants);
  if (input.quantity !== undefined && input.quantity !== 1) throw new Error('多人合影每次生成一张独立照片');
  const event = String(input.event || '').trim();
  if (!event || event.length > 2000) throw new Error('请填写一个共同事件（最多 2,000 字符）');
  const medium = String(input.medium || '').trim();
  if (!medium || medium.length > 500) throw new Error('请选择或填写一种成像介质（最多 500 字符）');
  const packs = await readJson(packFile(), []);
  const pack = packs.find((item) => item.id === input.packId && !item.archivedAt);
  if (!pack || pack.kind !== 'variable_pool') throw new Error('请选择已确认的随机变量摄影包');
  const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
  const locks = cleanReshootLocks(input.locks || {});
  return mutateJobs(async (jobs) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) throw new Error('作品不存在');
    if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
    if (input.participants[0].jobId !== id) throw new Error('角色 A 必须来自当前作品');
    const participants = input.participants.map((person, index) => {
      const sourceJob = jobs.find((item) => item.id === person.jobId);
      const sourceImage = sourceJob && allOutputs(sourceJob).find((item) => item.id === person.outputId);
      if (!sourceImage) throw new Error(`角色 ${GROUP_LABELS[index]} 的源版本不存在`);
      if (sourceImage.mode === 'multi_person') throw new Error('请选择单人源图，不能把合影再次当作一个人物');
      assertFaceReviewed(sourceJob, sourceImage);
      const context = outputContext(sourceJob, sourceImage);
      if (context.faceSnapshot && !context.faceSnapshot.authorizationConfirmed) throw new Error('人物脸模未获授权');
      return {
        label: GROUP_LABELS[index], name: sourceJob.title, jobId: sourceJob.id, outputId: sourceImage.id,
        sourceImage: structuredClone(sourceImage), context,
        position: String(person.position).trim(), adultConfirmed: true,
        wardrobe: person.wardrobe === 'swimwear' ? 'swimwear' : 'locked',
        outfitConfirmed: person.outfitConfirmed === true,
        outfitDirection: String(person.outfitDirection || '').trim().slice(0, 500),
      };
    });
    const sceneReference = input.sceneReferenceDataUrl
      ? await persistDataImage(input.sceneReferenceDataUrl, path.join('jobs', id, 'references'), 'group-scene') : null;
    if (sceneReference) trackNewFile(resolveUnder(DATA_ROOT, sceneReference.path));
    const group = { version: 1, participants, event, medium, sceneReference };
    const sourceImage = participants[0].sourceImage;
    const outputResolution = await resolveOutputResolution(aspectRatio, sourceImage);
    const seed = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const selected = selectPhotographyVariables({ pack, quantity: 1, locks, seed })[0];
    const selections = Object.fromEntries(Object.entries(selected.selections).filter(([key]) => !['outfitStyle', 'moment', 'expression', 'captureState'].includes(key)));
    const now = new Date().toISOString();
    const batch = {
      id: `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      status: 'draft', mode: 'multi_person', multiPerson: group,
      inputSnapshot: { ...participants[0].context, mode: 'multi_person', participants, references: multiPersonAssets(group) },
      sourceOutputId: sourceImage.id, sourceImage,
      packId: pack.id, packVersion: pack.version, packSnapshot: structuredClone(pack),
      quantity: 1, aspectRatio, outputResolution, allowOutfit: false, adultConfirmed: true, locks,
      variants: [{ id: `reshoot-variant-${crypto.randomUUID()}`, index: 1, seed: selected.seed, selections,
        compiledPrompt: compileMultiPersonPrompt({ group, pack, selections, aspectRatio, outputResolution }),
        userEdited: false, outputResolution, status: 'draft', outputId: null, error: null }],
      photographyReferences: [], seriesPlanDraft: null, diagnosticOutputId: null, backend: null, runId: null,
      referenceVersion: participants[0].context.referenceVersion,
      characterCardVersion: participants[0].context.characterCardVersion,
      configurationVersion: participants[0].context.configurationVersion, createdAt: now, updatedAt: now,
    };
    invalidateActiveReshootDraft(job, '已准备新的多人合影草稿，上一份草稿已失效');
    job.reshootBatches.push(batch);
    job.activeReshootBatchId = batch.id;
    job.workflowStep = 'adjustment';
    job.selectedOutputId = sourceImage.id;
    job.error = null;
    job.updatedAt = now;
    return structuredClone(job);
  });
}

export async function createReshootDraft(id, input) {
  const [job, packs] = await Promise.all([
    getJob(id),
    readJson(packFile(), []),
  ]);
  if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
  const sourceOutputId = input.sourceOutputId || job.selectedOutputId;
  const sourceImage = allOutputs(job).find((item) => item.id === sourceOutputId);
  if (!sourceImage) throw new Error('未找到创意重拍源图');
  assertFaceReviewed(job, sourceImage);
  const pack = packs.find((entry) => entry.id === input.packId);
  if (!pack || pack.archivedAt) throw new Error('未找到摄影方案包或已归档');
  if ((pack.kind || 'variable_pool') !== 'variable_pool')
    throw new Error('系列企划包请使用系列写真模式');
  const quantity = Number(input.quantity || 1);
  const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
  const batchId = `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const creative = await prepareCreativePolicy(id, batchId, input);
  const { allowOutfit, adultConfirmed } = creative;
  const locks = cleanReshootLocks(input.locks || {});
  const context = outputContext(job, sourceImage);
  const realismStyleSnapshot = await resolveRealismStyle(input.realismStyleId);
  const variants = makeReshootVariants(context, pack, {
    ...creative,
    outputResolution: await resolveOutputResolution(aspectRatio, sourceImage),
    realismStyleSnapshot,
    quantity,
    aspectRatio,
    allowOutfit,
    adultConfirmed,
    locks,
  });
  const now = new Date().toISOString();
  const batch = {
    id: batchId,
    ...creative,
    status: 'draft',
    mode: 'variable_pool',
    outputResolution: await resolveOutputResolution(aspectRatio, sourceImage),
    realismStyleSnapshot,
    inputSnapshot: context,
    sourceOutputId,
    sourceImage: structuredClone(sourceImage),
    packId: pack.id,
    packVersion: pack.version,
    packSnapshot: structuredClone(pack),
    quantity,
    aspectRatio,
    allowOutfit,
    adultConfirmed,
    locks,
    variants,
    photographyReferences: [],
    seriesPlanDraft: null,
    diagnosticOutputId: null,
    backend: null,
    runId: null,
    referenceVersion: context.referenceVersion,
    characterCardVersion: context.characterCardVersion,
    configurationVersion: context.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  return updateJob(id, (current) => {
    assertFaceReviewed(current, sourceImage);
    invalidateActiveReshootDraft(
      current,
      '已创建新的重拍草稿，上一份草稿已失效',
    );
    return {
      ...current,
      workflowStep: 'adjustment',
      selectedOutputId: sourceOutputId,
      activeReshootBatchId: batch.id,
      reshootBatches: [...(current.reshootBatches || []), batch],
      error: null,
    };
  });
}

function makeSeriesVariants(job, batch, plan) {
  const context = batch.inputSnapshot || outputContext(job, batch.sourceImage);
  return plan.shots.map((shot, index) => {
    const referenceIds = [shot.mainReferenceId, ...(shot.auxiliaryReferenceIds || [])];
    return {
      id:
        batch.variants?.[index]?.id ||
        `reshoot-variant-${Date.now()}-${index + 1}-${crypto.randomUUID().slice(0, 5)}`,
      index: index + 1,
      seed: `series-${batch.id}-${String(index + 1).padStart(2, '0')}`,
      selections: {},
      shotSpec: structuredClone(shot),
      referenceRoles: referenceIds.map((referenceId, referenceIndex) => ({
        referenceId,
        role: referenceIndex === 0 ? 'photo_main' : 'photo_auxiliary',
        purpose:
          referenceIndex === 0
            ? '本张主摄影参考，只负责摄影企划，不承担人物身份'
            : '同一布光子方案辅助参考，只补充必要摄影信息',
      })),
      compiledPrompt: compileSeriesReshootPrompt({
        creative: batch.creativePolicy,
        outfitReference: batch.outfitReference,
        outputResolution: batch.outputResolution,
        characterReferences: context.references,
        realismStyle: batch.realismStyleSnapshot || null,
        characterCard: context.characterCard,
        faceProfile: context.faceSnapshot,
        pack: batch.packSnapshot,
        plan,
        shot,
        references: batch.photographyReferences,
        locks: batch.locks,
        allowOutfit: batch.allowOutfit,
        aspectRatio: batch.aspectRatio,
      }),
      userEdited: false,
      outputResolution: batch.outputResolution,
      status: 'draft',
      outputId: null,
      qualityReview: null,
      error: null,
    };
  });
}

export async function createSeriesPlanReshoot(id, input) {
  const [job, packs] = await Promise.all([getJob(id), readJson(packFile(), [])]);
  if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
  const sourceOutputId = input.sourceOutputId || job.selectedOutputId;
  const sourceImage = allOutputs(job).find((item) => item.id === sourceOutputId);
  if (!sourceImage) throw new Error('未找到系列写真源图');
  assertFaceReviewed(job, sourceImage);
  const pack = packs.find((entry) => entry.id === input.packId);
  if (!pack || pack.archivedAt || pack.kind !== 'series_plan') throw new Error('未找到系列写真企划包或已归档');
  const quantity = Number(input.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4)
    throw new Error('系列写真数量必须为 1–4 张');
  if (!Array.isArray(input.photographyReferences) || !input.photographyReferences.length || input.photographyReferences.length > 8)
    throw new Error('系列写真需要 1–8 张摄影参考图');
  const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
  const batchId = `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const creative = await prepareCreativePolicy(id, batchId, input);
  const { allowOutfit, adultConfirmed } = creative;
  const realismStyleSnapshot = await resolveRealismStyle(input.realismStyleId);
  const photographyReferences = [];
  for (const [index, reference] of input.photographyReferences.entries()) {
    const stored = await persistDataImage(
      reference.dataUrl,
      path.join('jobs', id, 'series-references', batchId),
      `photo-${String(index + 1).padStart(2, '0')}`,
    );
    photographyReferences.push({
      ...stored,
      id: `photo-ref-${String(index + 1).padStart(2, '0')}`,
      name: String(reference.name || `写真参考 ${index + 1}`).trim().slice(0, 120),
      role: 'photography_reference',
      purpose: '只用于拆解写真企划、布光、构图和成像质感，不承担人物身份',
    });
  }
  const now = new Date().toISOString();
  const batch = {
    id: batchId,
    mode: 'series_plan',
    ...creative,
    outputResolution: await resolveOutputResolution(aspectRatio, sourceImage),
    realismStyleSnapshot,
    status: 'queued',
    inputSnapshot: outputContext(job, sourceImage),
    sourceOutputId,
    sourceImage: structuredClone(sourceImage),
    packId: pack.id,
    packVersion: pack.version,
    packSnapshot: structuredClone(pack),
    quantity,
    aspectRatio,
    allowOutfit,
    adultConfirmed,
    locks: cleanReshootLocks(input.locks || {}),
    photographyReferences,
    seriesPlanDraft: null,
    variants: [],
    diagnosticOutputId: null,
    feedback: '',
    backend: null,
    runId: null,
    referenceVersion: sourceImage.referenceVersion,
    characterCardVersion: sourceImage.characterCardVersion,
    configurationVersion: sourceImage.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  return updateJob(id, (current) => {
    assertFaceReviewed(current, sourceImage);
    invalidateActiveReshootDraft(current, '已创建新的系列写真企划，上一份草稿已失效');
    const queued = queueRun(current, 'series_deconstruct');
    const run = queued.executionRuns.find((item) => item.id === queued.activeRunId);
    batch.runId = run.id;
    return {
      ...queued,
      workflowStep: 'adjustment',
      selectedOutputId: sourceOutputId,
      activeReshootBatchId: batch.id,
      reshootBatches: [...(current.reshootBatches || []), batch],
    };
  });
}

export async function applySeriesPlanDraft(id, draft) {
  const updated = await updateJob(id, (job) => {
    const run = activeRun(job);
    if (!run || run.kind !== 'series_deconstruct' || run.status !== 'running')
      throw new Error('当前没有正在执行的系列写真解析任务');
    const batch = findReshootBatch(job, job.activeReshootBatchId);
    if (batch.mode !== 'series_plan') throw new Error('当前批次不是系列写真');
    batch.seriesPlanDraft = normalizeSeriesPlanDraft(
      draft,
      batch.photographyReferences,
      batch.quantity,
    );
    batch.status = 'plan_ready';
    batch.updatedAt = new Date().toISOString();
    completeActiveRun(job, 'succeeded', '系列写真企划草稿已写回');
    job.error = null;
    return job;
  });
  await releaseClaim(id, 'series_deconstruct');
  return updated;
}

export async function updateSeriesPlanDraft(id, batchId, draft) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('任务执行期间不能修改系列企划');
    const batch = findReshootBatch(job, batchId);
    if (batch.mode !== 'series_plan' || batch.status !== 'plan_ready')
      throw new Error('只有待确认的系列写真企划可以编辑');
    batch.seriesPlanDraft = normalizeSeriesPlanDraft(
      draft,
      batch.photographyReferences,
      batch.quantity,
    );
    batch.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function compileSeriesPlan(id, batchId) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('任务执行期间不能编译系列企划');
    const batch = findReshootBatch(job, batchId);
    if (batch.mode !== 'series_plan' || batch.status !== 'plan_ready' || !batch.seriesPlanDraft)
      throw new Error('系列写真企划尚未准备完成');
    batch.variants = makeSeriesVariants(job, batch, batch.seriesPlanDraft);
    batch.status = 'draft';
    batch.updatedAt = new Date().toISOString();
    job.activeReshootBatchId = batch.id;
    return job;
  });
}

export async function recompileSeriesPlan(id, batchId, input = {}) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
    const sourceBatch = findReshootBatch(job, batchId);
    if (sourceBatch.mode !== 'series_plan' || !sourceBatch.seriesPlanDraft)
      throw new Error('只有系列写真批次可以按原始输入返工');
    const sourceVariant = sourceBatch.variants.find((item) => item.id === input.variantId);
    if (!sourceVariant) throw new Error('未找到要返工的系列写真分镜');
    const feedback = String(input.feedback || '').trim().slice(0, 3000);
    if (!feedback) throw new Error('返工反馈不能为空');
    const diagnosticOutputId = input.diagnosticOutputId || sourceVariant.outputId || null;
    if (diagnosticOutputId && !allOutputs(job).some((item) => item.id === diagnosticOutputId))
      throw new Error('诊断图片不存在');
    const now = new Date().toISOString();
    const nextId = `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const shot = structuredClone(sourceVariant.shotSpec || sourceBatch.seriesPlanDraft.shots[sourceVariant.index - 1]);
    shot.id = `shot-redo-${crypto.randomUUID().slice(0, 8)}`;
    shot.index = 1;
    shot.customPrompt = [shot.customPrompt, `本轮返工反馈：${feedback}`].filter(Boolean).join('；');
    const plan = normalizeSeriesPlanDraft(
      { ...structuredClone(sourceBatch.seriesPlanDraft), shots: [shot] },
      sourceBatch.photographyReferences,
      1,
    );
    const next = {
      ...structuredClone(sourceBatch),
      inputSnapshot: sourceBatch.inputSnapshot || outputContext(job, sourceBatch.sourceImage),
      id: nextId,
      status: 'plan_ready',
      quantity: 1,
      seriesPlanDraft: plan,
      variants: [],
      diagnosticOutputId,
      feedback,
      backend: null,
      runId: null,
      createdAt: now,
      updatedAt: now,
    };
    next.variants = makeSeriesVariants(job, next, plan);
    next.status = 'draft';
    job.reshootBatches.push(next);
    job.activeReshootBatchId = next.id;
    job.selectedOutputId = next.sourceOutputId;
    job.error = null;
    return job;
  });
}

function findReshootBatch(job, batchId) {
  const batch = job.reshootBatches?.find((entry) => entry.id === batchId);
  if (!batch) throw new Error('未找到创意重拍批次');
  return batch;
}

export async function updateReshootDraft(id, batchId, input) {
  return updateJob(id, async (job) => {
    if (job.activeRunId) throw new Error('任务执行期间不能修改重拍方案');
    const batch = findReshootBatch(job, batchId);
    if (batch.status !== 'draft') throw new Error('只有草稿批次可以修改');
    if (input.creativePolicy !== undefined || input.outfitReferenceDataUrl !== undefined) throw new Error('创作方式和服装来源已冻结，请返回配置重新准备');
    if (Array.isArray(input.variants)) {
      const byId = new Map(input.variants.map((item) => [item.id, item]));
      batch.variants = batch.variants.map((variant) => {
        const edit = byId.get(variant.id);
        if (!edit) return variant;
        const prompt = String(edit.compiledPrompt || '').trim();
        if (!prompt || prompt.length > (batch.mode === 'full_prompt' ? 80000 : 20000))
          throw new Error('重拍 Prompt 为空或超过长度限制');
        return { ...variant, compiledPrompt: prompt, userEdited: true };
      });
    }
    if (
      input.quantity !== undefined ||
      input.aspectRatio !== undefined ||
      input.allowOutfit !== undefined ||
      input.adultConfirmed !== undefined ||
      input.locks !== undefined
    ) {
      if (batch.mode !== 'variable_pool')
        throw new Error('系列或多人草稿请返回对应编辑器重新准备配置');
      const next = {
        outputResolution: await resolveOutputResolution(input.aspectRatio ?? batch.aspectRatio, batch.sourceImage),
        realismStyleSnapshot: batch.realismStyleSnapshot || null,
        creativePolicy: input.allowOutfit === undefined ? batch.creativePolicy : creativePolicy({ ...batch.creativePolicy, mode: input.allowOutfit ? 'character' : 'original' }),
        outfitReference: input.allowOutfit === false ? null : batch.outfitReference,
        quantity: input.quantity ?? batch.quantity,
        aspectRatio: input.aspectRatio ?? batch.aspectRatio,
        allowOutfit: input.allowOutfit ?? batch.allowOutfit,
        adultConfirmed: input.adultConfirmed ?? batch.adultConfirmed,
        locks: input.locks ?? batch.locks,
      };
      batch.quantity = Number(next.quantity);
      batch.aspectRatio = validateAspectRatio(next.aspectRatio);
      batch.outputResolution = next.outputResolution;
      batch.allowOutfit = next.allowOutfit === true;
      batch.creativePolicy = next.creativePolicy;
      batch.outfitReference = next.outfitReference;
      batch.adultConfirmed = next.adultConfirmed === true;
      batch.locks = cleanReshootLocks(next.locks);
      batch.variants = makeReshootVariants(
        batch.inputSnapshot || outputContext(job, batch.sourceImage),
        batch.packSnapshot,
        next,
        batch.variants,
      );
    }
    batch.updatedAt = new Date().toISOString();
    job.activeReshootBatchId = batch.id;
    return job;
  });
}

export async function rerollReshootDraft(id, batchId, input = {}) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('任务执行期间不能重抽方案');
    const batch = findReshootBatch(job, batchId);
    if (batch.status !== 'draft') throw new Error('只有草稿批次可以重抽');
    if (batch.mode !== 'variable_pool') throw new Error('此模式不支持随机重抽；只有随机重拍支持重抽，完整 Prompt 不会被随机拆分');
    const rerolled = makeReshootVariants(
      batch.inputSnapshot || outputContext(job, batch.sourceImage),
      batch.packSnapshot,
      {
        realismStyleSnapshot: batch.realismStyleSnapshot || null,
        creativePolicy: batch.creativePolicy,
        outfitReference: batch.outfitReference,
        quantity: batch.quantity,
        aspectRatio: batch.aspectRatio,
        allowOutfit: batch.allowOutfit,
        adultConfirmed: batch.adultConfirmed,
        locks: batch.locks,
        seed: `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        outputResolution: batch.outputResolution,
      },
      batch.variants,
    );
    const variantId = input.variantId || null;
    batch.variants = variantId
      ? batch.variants.map((variant, index) =>
          variant.id === variantId ? { ...rerolled[index], id: variant.id } : variant,
        )
      : rerolled;
    if (variantId && !batch.variants.some((item) => item.id === variantId))
      throw new Error('未找到要重抽的方案');
    batch.updatedAt = new Date().toISOString();
    return job;
  });
}

export function reshootAssets(job, batch) {
  if (batch.mode === 'multi_person') return multiPersonAssets(batch.multiPerson);
  return [
    {
      ...batch.sourceImage,
      role: 'edit_source',
      purpose: creativeSourcePurpose(batch.creativePolicy || creativePolicy({ allowOutfit: batch.allowOutfit })),
    },
    ...(batch.mode === 'series_plan' ? batch.photographyReferences.filter((ref) =>
      batch.variants.some((variant) => variant.referenceRoles?.some((role) => role.referenceId === ref.id))) : []),
    ...(batch.outfitReference ? [batch.outfitReference] : []),
    ...(batch.inputSnapshot || outputContext(job, batch.sourceImage)).references.map((reference) => ({
      ...reference,
      purpose: batch.allowOutfit ? '只核对身份、发色发型发饰、瞳色与妆容；忽略本图旧服装、手势、姿态与背景；道具按本轮选择' : reference.purpose || '核对角色或脸模身份',
    })),
  ];
}

export async function confirmReshootDraft(id, batchId, input) {
  const backend = validateGenerationBackend(input.backend || 'built-in-imagegen');
  return updateJob(id, async (job) => {
    if (job.activeRunId) throw new Error('当前已有任务正在等待或执行');
    const batch = findReshootBatch(job, batchId);
    if (batch.status !== 'draft') throw new Error('只有草稿批次可以确认生成');
    if (batch.mode === 'full_prompt' && (!batch.adaptationConfirmedAt || !batch.adaptationDraft || batch.variants.length !== 1)) throw new Error('请先确认完整 Prompt 的角色适配');
    assertFaceReviewed(job, batch.sourceImage);
    if (batch.mode === 'multi_person') {
      validateGroupParticipants(batch.multiPerson?.participants);
      if (batch.variants.length !== 1 || batch.quantity !== 1) throw new Error('多人合影只能确认一个方案');
      for (const person of batch.multiPerson.participants) {
        const sourceJob = person.jobId === id ? job : await getJob(person.jobId);
        const source = allOutputs(sourceJob).find((item) => item.id === person.outputId);
        if (!source || source.path !== person.sourceImage.path) throw new Error('多人源版本已变化，请重新准备');
        assertFaceReviewed(sourceJob, source);
        if (person.context.faceSnapshot && !person.context.faceSnapshot.authorizationConfirmed) throw new Error('人物脸模未获授权');
      }
    }
    if (batch.allowOutfit && !batch.adultConfirmed)
      throw new Error('允许换装前必须确认角色为成年人');
    if (!batch.variants.length || batch.variants.some((item) => !item.compiledPrompt?.trim()))
      throw new Error('重拍方案缺少完整 Prompt');
    batch.backend = backend;
    batch.outputResolution ||= await resolveOutputResolution(batch.aspectRatio, batch.sourceImage);
    batch.variants = batch.variants.map((variant) => ({
      ...variant,
      outputResolution: batch.outputResolution,
      compiledPrompt: withNativeResolution(variant.compiledPrompt, batch.outputResolution),
    }));
    batch.updatedAt = new Date().toISOString();
    if (backend === 'chatgpt-web-manual') {
      batch.variants = batch.variants.map((variant) => ({
        ...variant,
        compiledPrompt: withWebReshootWatermark(variant.compiledPrompt),
      }));
      return startReshootWebHandoff(job, batch, reshootAssets(job, batch));
    }
    batch.status = 'queued';
    batch.variants = batch.variants.map((item) => ({ ...item, status: 'queued' }));
    const queued = queueRun(job, 'reshoot');
    const run = queued.executionRuns.find((item) => item.id === queued.activeRunId);
    batch.runId = run.id;
    return {
      ...queued,
      activeReshootBatchId: batch.id,
      workflowStep: 'adjustment',
    };
  });
}

export async function copyOutput(sourcePath, jobId, fileName) {
  const absoluteSource = path.resolve(sourcePath);
  const stat = await fs.stat(absoluteSource);
  if (!stat.isFile() || stat.size <= 0 || stat.size > OUTPUT_MAX_BYTES)
    throw new Error('输出文件无效或超过 50 MB');
  const header = await fs.readFile(absoluteSource);
  await validateDecodedImage(header);
  if (
    !header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('归档输出必须为有效 PNG');
  const dimensions = pngDimensions(header);
  if (!dimensions?.pixelWidth || !dimensions?.pixelHeight)
    throw new Error('无法读取 PNG 实际尺寸');
  const directory = resolveUnder(DATA_ROOT, path.join('outputs', jobId));
  await fs.mkdir(directory, { recursive: true });
  const target = resolveUnder(directory, fileName);
  await fs.copyFile(absoluteSource, target, fs.constants.COPYFILE_EXCL);
  trackNewFile(target);
  const relative = path.relative(DATA_ROOT, target);
  return {
    path: relative,
    url: publicAssetPath(relative),
    fileName,
    bytes: stat.size,
    ...dimensions,
    actualRatio: actualRatio(dimensions.pixelWidth, dimensions.pixelHeight),
  };
}

export async function persistImportedOutputData(dataUrl, job, kind) {
  const { buffer, extension, mime } = await parseImageData(dataUrl);
  const dimensions = imageDimensions(buffer, mime);
  if (!dimensions?.pixelWidth || !dimensions?.pixelHeight)
    throw new Error('无法读取导入图片的实际尺寸');
  const existing =
    kind === 'baseline'
      ? job.baselineVersions || []
      : kind === 'reshoot'
        ? job.reshootVersions || []
        : job.adjustmentVersions || [];
  const fileName = nextVersionName(kind, existing, extension);
  const directory = resolveUnder(DATA_ROOT, path.join('outputs', job.id));
  await fs.mkdir(directory, { recursive: true });
  const target = resolveUnder(directory, fileName);
  await fs.writeFile(target, buffer, { flag: 'wx' });
  trackNewFile(target);
  const relative = path.relative(DATA_ROOT, target);
  return {
    path: relative,
    url: publicAssetPath(relative),
    fileName,
    mime,
    bytes: buffer.length,
    ...dimensions,
    actualRatio: actualRatio(dimensions.pixelWidth, dimensions.pixelHeight),
  };
}

async function findJobRun(runId) {
  await ensureDataRoot();
  const jobs = await readCollection('jobs');
  const job = jobs.find((entry) =>
    entry.executionRuns?.some((run) => run.id === runId),
  );
  const run = job?.executionRuns?.find((entry) => entry.id === runId) || null;
  if (!job || !run) throw new Error('未找到网页版交接任务');
  if (run.backend !== 'chatgpt-web-manual' || !run.handoff)
    throw new Error('该执行记录不是网页版交接任务');
  return { job, run };
}

export async function getWebHandoff(runId) {
  const { job, run } = await findJobRun(runId);
  return {
    jobId: job.id,
    runId: run.id,
    runStatus: run.status,
    ...run.handoff,
  };
}

export async function revealWebHandoffAssets(runId) {
  const { run } = await findJobRun(runId);
  if (run.status !== 'waiting_user') throw new Error('该交接任务已不再等待导入');
  const directory = resolveUnder(DATA_ROOT, run.handoff.directory);
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) throw new Error('交接素材目录不存在');
  await execFileAsync('/usr/bin/open', [directory]);
  return { ok: true, runId };
}

export async function cancelWebHandoff(runId) {
  return mutateJobs(async (jobs) => {
    const job = jobs.find((entry) =>
      entry.executionRuns?.some((run) => run.id === runId),
    );
    const run = job?.executionRuns?.find((entry) => entry.id === runId);
    if (!job || !run) throw new Error('未找到网页版交接任务');
    if (
      run.backend !== 'chatgpt-web-manual' ||
      !run.handoff ||
      run.status !== 'waiting_user' ||
      job.activeRunId !== runId
    )
      throw new Error('该交接任务已不再等待导入');
    const at = new Date().toISOString();
    run.status = 'interrupted';
    run.progress = '用户取消了网页版交接';
    run.completedAt = at;
    run.error = { type: 'manual_cancelled', message: run.progress };
    run.events.push({ at, type: 'interrupted', message: run.progress });
    run.handoff.status = 'cancelled';
    run.handoff.invalidatedAt = at;
    job.activeRunId = null;
    if (run.kind === 'adjustment') job.activeAdjustment = null;
    if (run.kind === 'reshoot') {
      const batch = job.reshootBatches?.find(
        (entry) => entry.id === job.activeReshootBatchId,
      );
      if (batch) batch.status = 'cancelled';
      job.activeReshootBatchId = null;
    }
    job.error = null;
    job.updatedAt = at;
    return job;
  });
}

export async function importWebHandoffOutput(runId, outputDataUrl) {
  if (!outputDataUrl) throw new Error('请选择要导入的生成图片');
  return mutateJobs(async (jobs) => {
    const job = jobs.find((entry) =>
      entry.executionRuns?.some((run) => run.id === runId),
    );
    const run = job?.executionRuns?.find((entry) => entry.id === runId);
    if (!job || !run) throw new Error('未找到网页版交接任务');
    if (
      run.backend !== 'chatgpt-web-manual' ||
      !run.handoff ||
      run.status !== 'waiting_user' ||
      job.activeRunId !== runId
    )
      throw new Error('该交接任务已完成、取消或失效，不能重复导入');
    if (!['baseline', 'adjustment'].includes(run.kind))
      throw new Error('网页版交接输出类型无效');
    const output = await persistImportedOutputData(outputDataUrl, job, run.kind);
    const snapshot = run.handoff.snapshot || {};
    const at = new Date().toISOString();
    if (run.kind === 'baseline') {
      const version = (job.baselineVersions?.length || 0) + 1;
      const baseline = {
        ...output,
        inputSnapshot: snapshot.inputSnapshot || outputContext(job, { ...snapshot, id: 'handoff-baseline' }),
        id: `baseline-v${String(version).padStart(3, '0')}`,
        kind: 'baseline',
        version,
        prompt: run.handoff.prompt,
        ...outputResolutionRecord(snapshot.outputResolution, output),
        aspectRatio: snapshot.aspectRatio || 'source',
        references: snapshot.references || [],
        referenceVersion: snapshot.referenceVersion,
        characterCardVersion: snapshot.characterCardVersion,
        configurationVersion: snapshot.configurationVersion,
        faceSnapshot: snapshot.faceSnapshot || null,
        styleSnapshot: snapshot.styleSnapshot || null,
        createdAt: at,
        backend: 'chatgpt-web-manual',
      };
      job.workflowStep = requiresBaselineFaceReview(baseline.prompt) ? 'configuration' : 'adjustment';
      job.baselineVersions = [...(job.baselineVersions || []), baseline];
      job.selectedOutputId = baseline.id;
      run.handoff.outputId = baseline.id;
    } else {
      const request = snapshot.activeAdjustment;
      if (!request) throw new Error('网页版调整交接缺少输入快照');
      const version = (job.adjustmentVersions?.length || 0) + 1;
      const adjustment = {
        ...output,
        inputSnapshot: adjustedContext(request.inputSnapshot || outputContext(job, request.sourceImage), request),
        id: `adjustment-v${String(version).padStart(3, '0')}`,
        kind: 'adjustment',
        version,
        sourceOutputId: request.sourceOutputId,
        ...outputResolutionRecord(request.outputResolution, output),
        category: request.category,
        request: request.request,
        preserve: request.preserve,
        annotation: request.annotation,
        adjustmentReference: request.adjustmentReference,
        promptModule: request.promptModule,
        references: request.references || [],
        conflictPriority: request.conflictPriority,
        sourceAspectRatio:
          request.sourceImage.actualRatio ||
          request.sourceImage.aspectRatio ||
          request.sourceImage.sourceAspectRatio ||
          'source',
        prompt: run.handoff.prompt,
        referenceVersion: request.referenceVersion,
        characterCardVersion: request.characterCardVersion,
        configurationVersion: request.configurationVersion,
        createdAt: at,
        backend: 'chatgpt-web-manual',
      };
      job.workflowStep = 'adjustment';
      job.adjustmentVersions = [
        ...(job.adjustmentVersions || []),
        adjustment,
      ];
      job.selectedOutputId = adjustment.id;
      job.activeAdjustment = null;
      run.handoff.outputId = adjustment.id;
    }
    run.handoff.status = 'completed';
    run.handoff.importedAt = at;
    completeActiveRun(job, 'succeeded', 'ChatGPT 网页生成结果已归档');
    job.backend = 'chatgpt-web-manual';
    job.error = null;
    job.updatedAt = at;
    return job;
  });
}

export async function importWebHandoffOutputs(runId, inputs, finishPartial = false) {
  if (!Array.isArray(inputs) || !inputs.length)
    throw new Error('请至少选择一张重拍结果');
  const duplicateIds = new Set();
  for (const item of inputs) {
    if (!item?.variantId || !item?.outputDataUrl)
      throw new Error('每张导入图必须对应一个重拍方案');
    if (duplicateIds.has(item.variantId)) throw new Error('同一方案不能重复导入');
    duplicateIds.add(item.variantId);
  }
  return mutateJobs(async (jobs) => {
    const job = jobs.find((entry) =>
      entry.executionRuns?.some((run) => run.id === runId),
    );
    const run = job?.executionRuns?.find((entry) => entry.id === runId);
    if (!job || !run) throw new Error('未找到网页版交接任务');
    if (
      run.kind !== 'reshoot' ||
      run.backend !== 'chatgpt-web-manual' ||
      run.handoff?.kind !== 'reshoot_batch' ||
      run.status !== 'waiting_user' ||
      job.activeRunId !== runId
    )
      throw new Error('该重拍交接已完成、取消或失效');
    const batch = findReshootBatch(job, job.activeReshootBatchId);
    const knownIds = new Set(batch.variants.map((variant) => variant.id));
    if (inputs.some((item) => !knownIds.has(item.variantId)))
      throw new Error('导入结果与重拍方案不匹配');
    const missingAfterImport = batch.variants.filter(
      (variant) =>
        variant.status !== 'succeeded' && !duplicateIds.has(variant.id),
    );
    if (missingAfterImport.length && !finishPartial)
      throw new Error('仍有未导入槽位；请补齐，或明确以已导入结果结束批次');
    const at = new Date().toISOString();
    for (const item of inputs) {
      const variant = batch.variants.find((entry) => entry.id === item.variantId);
      if (variant.status === 'succeeded') throw new Error('该方案已经导入过结果');
      const output = await persistImportedOutputData(item.outputDataUrl, job, 'reshoot');
      const version = (job.reshootVersions?.length || 0) + 1;
      const reshoot = {
        ...output,
        inputSnapshot: batch.allowOutfit ? adjustedContext(batch.inputSnapshot || outputContext(job, batch.sourceImage), { category: 'outfit', request: '采用本次已授权摄影方案服装' }) : (batch.inputSnapshot || outputContext(job, batch.sourceImage)),
        id: `reshoot-v${String(version).padStart(3, '0')}`,
        kind: 'reshoot',
        version,
        sourceOutputId: batch.sourceOutputId,
        batchId: batch.id,
        variantId: variant.id,
        packId: batch.packId,
        packVersion: batch.packVersion,
        packSnapshot: batch.packSnapshot,
        templateSnapshot: batch.templateSnapshot || null,
        adaptationSnapshot: batch.adaptationDraft || null,
        creativePolicy: batch.creativePolicy || null,
        outfitReference: batch.outfitReference || null,
        realismStyleSnapshot: batch.realismStyleSnapshot || null,
        mode: batch.mode || 'variable_pool',
        multiPerson: batch.multiPerson || null,
        seriesPlanSnapshot: batch.seriesPlanDraft || null,
        shotSpec: variant.shotSpec || null,
        referenceRoles: variant.referenceRoles || [],
        diagnosticOutputId: batch.diagnosticOutputId || null,
        seed: variant.seed,
        selections: variant.selections,
        prompt: variant.compiledPrompt,
        ...outputResolutionRecord(variant.outputResolution || batch.outputResolution, output),
        aspectRatio: batch.aspectRatio,
        allowOutfit: batch.allowOutfit,
        referenceVersion: batch.referenceVersion,
        characterCardVersion: batch.characterCardVersion,
        configurationVersion: batch.configurationVersion,
        createdAt: at,
        backend: 'chatgpt-web-manual',
        qualityReview: null,
      };
      job.reshootVersions = [...(job.reshootVersions || []), reshoot];
      variant.status = 'succeeded';
      variant.outputId = reshoot.id;
      variant.error = null;
      job.selectedOutputId = reshoot.id;
      const promptSlot = run.handoff.prompts?.find(
        (entry) => entry.variantId === variant.id,
      );
      if (promptSlot) {
        promptSlot.outputId = reshoot.id;
        promptSlot.importStatus = 'imported';
      }
      run.handoff.outputIds.push(reshoot.id);
    }
    if (finishPartial) {
      for (const variant of batch.variants) {
        if (variant.status !== 'succeeded') {
          variant.status = 'skipped_by_user';
          const promptSlot = run.handoff.prompts?.find(
            (entry) => entry.variantId === variant.id,
          );
          if (promptSlot) promptSlot.importStatus = 'skipped_by_user';
        }
      }
    }
    run.handoff.status = 'completed';
    run.handoff.importedAt = at;
    batch.status = batch.variants.every((variant) => variant.status === 'succeeded')
      ? 'succeeded'
      : 'partial';
    batch.updatedAt = at;
    job.activeReshootBatchId = null;
    completeActiveRun(
      job,
      'succeeded',
      batch.status === 'partial'
        ? 'ChatGPT 网页重拍结果已部分归档'
        : 'ChatGPT 网页重拍批次已全部归档',
    );
    job.workflowStep = 'adjustment';
    job.backend = 'chatgpt-web-manual';
    job.error = null;
    job.updatedAt = at;
    return job;
  });
}

export async function attachOutput(id, sourcePath, requestedKind) {
  const kind = normalizeOutputKind(requestedKind);
  if (!['baseline', 'adjustment'].includes(kind))
    throw new Error('输出类型必须为 baseline 或 adjustment');
  const job = await getJob(id);
  const run = activeRun(job);
  if (
    !run ||
    run.kind !== kind ||
    run.status !== 'running' ||
    run.backend !== 'built-in-imagegen'
  )
    throw new Error(`当前没有正在执行的 ${kind} 任务`);
  if (kind === 'baseline') {
    const updated = await updateJob(id, async (current) => {
      assertRunIdentity(current, run.id);
      const fileName = nextVersionName('baseline', current.baselineVersions || []);
      const output = await copyOutput(sourcePath, id, fileName);
      const version = (current.baselineVersions?.length || 0) + 1;
      const baseline = {
        ...output,
        inputSnapshot: executionInputs(current, 'baseline'),
        id: `baseline-v${String(version).padStart(3, '0')}`,
        kind: 'baseline',
        version,
        prompt: current.compiledPrompt,
        ...outputResolutionRecord(current.outputResolution, output),
        aspectRatio: current.aspectRatio || 'source',
        references: current.references,
        referenceVersion: current.referenceVersion,
        characterCardVersion: current.characterCardVersion,
        configurationVersion: current.configurationVersion,
        faceSnapshot: current.faceSnapshot,
        styleSnapshot: current.styleSnapshot,
        createdAt: new Date().toISOString(),
        backend: 'built-in-imagegen',
      };
      completeActiveRun(current, 'succeeded', '基准还原图已归档');
      return {
        ...current,
        workflowStep: requiresBaselineFaceReview(baseline.prompt) ? 'configuration' : 'adjustment',
        baselineVersions: [...(current.baselineVersions || []), baseline],
        selectedOutputId: baseline.id,
        backend: 'built-in-imagegen',
        error: null,
      };
    });
    await releaseClaim(id, 'baseline');
    return updated;
  }
  if (!job.activeAdjustment) throw new Error('缺少当前调整任务');
  const updated = await updateJob(id, async (current) => {
    assertRunIdentity(current, run.id);
    const fileName = nextVersionName('adjustment', current.adjustmentVersions || []);
    const output = await copyOutput(sourcePath, id, fileName);
    const version = (current.adjustmentVersions?.length || 0) + 1;
    const request = current.activeAdjustment;
    const adjustment = {
      ...output,
      inputSnapshot: adjustedContext(request.inputSnapshot || outputContext(current, request.sourceImage), request),
      id: `adjustment-v${String(version).padStart(3, '0')}`,
      kind: 'adjustment',
      version,
      sourceOutputId: request.sourceOutputId,
      ...outputResolutionRecord(request.outputResolution, output),
      category: request.category,
      request: request.request,
      preserve: request.preserve,
      annotation: request.annotation,
      adjustmentReference: request.adjustmentReference,
      promptModule: request.promptModule,
      references: request.references || [],
      conflictPriority: request.conflictPriority,
      sourceAspectRatio:
        request.sourceImage.actualRatio ||
        request.sourceImage.aspectRatio ||
        request.sourceImage.sourceAspectRatio ||
        'source',
      prompt: current.compiledAdjustmentPrompt,
      referenceVersion: request.referenceVersion,
      characterCardVersion: request.characterCardVersion,
      configurationVersion: request.configurationVersion,
      createdAt: new Date().toISOString(),
      backend: 'built-in-imagegen',
    };
    completeActiveRun(current, 'succeeded', '调整版本已归档');
    return {
      ...current,
      workflowStep: 'adjustment',
      adjustmentVersions: [
        ...(current.adjustmentVersions || []),
        adjustment,
      ],
      selectedOutputId: adjustment.id,
      activeAdjustment: null,
      backend: 'built-in-imagegen',
      error: null,
    };
  });
  await releaseClaim(id, 'adjustment');
  return updated;
}

function finalizeReshootBatchIfDone(job, batch) {
  const terminal = new Set(['succeeded', 'failed', 'skipped_by_user']);
  if (!batch.variants.every((variant) => terminal.has(variant.status))) return false;
  const successCount = batch.variants.filter((variant) => variant.status === 'succeeded').length;
  const failedCount = batch.variants.filter((variant) => variant.status === 'failed').length;
  batch.status =
    successCount === batch.variants.length
      ? 'succeeded'
      : successCount > 0
        ? 'partial'
        : 'failed';
  batch.updatedAt = new Date().toISOString();
  job.activeReshootBatchId = null;
  if (successCount > 0) {
    completeActiveRun(
      job,
      'succeeded',
      batch.status === 'partial'
        ? `创意重拍部分完成：${successCount} 张成功，${failedCount} 张失败或跳过`
        : `创意重拍已完成：${successCount} 张`,
    );
    job.error = null;
  } else {
    const message = '创意重拍批次没有成功归档的图片';
    completeActiveRun(job, 'failed', '创意重拍失败', {
      type: 'reshoot_batch_failed',
      message,
    });
    job.error = {
      type: 'reshoot_batch_failed',
      message,
      recoverable: true,
      at: new Date().toISOString(),
      runId: batch.runId,
      kind: 'reshoot',
      hint: '失败方案不会自动重试；请创建新的创意重拍批次。',
    };
  }
  return true;
}

export async function attachReshootOutput(id, variantId, sourcePath) {
  const job = await getJob(id);
  const run = activeRun(job);
  if (!run || run.kind !== 'reshoot' || run.status !== 'running')
    throw new Error('当前没有正在执行的创意重拍任务');
  const batch = findReshootBatch(job, job.activeReshootBatchId);
  const variant = batch.variants.find((entry) => entry.id === variantId);
  if (!variant || variant.status !== 'running')
    throw new Error('重拍方案不存在或已经完成');
  const updated = await updateJob(id, async (current) => {
    assertRunIdentity(current, run.id);
    const currentBatch = findReshootBatch(current, current.activeReshootBatchId);
    const currentVariant = currentBatch.variants.find((entry) => entry.id === variantId);
    if (!currentVariant || currentVariant.status !== 'running')
      throw new Error('重拍方案不存在或已经完成');
    const fileName = nextVersionName('reshoot', current.reshootVersions || []);
    const output = await copyOutput(sourcePath, id, fileName);
    const version = (current.reshootVersions?.length || 0) + 1;
    const reshoot = {
      ...output,
      inputSnapshot: currentBatch.allowOutfit ? adjustedContext(currentBatch.inputSnapshot || outputContext(current, currentBatch.sourceImage), { category: 'outfit', request: '采用本次已授权摄影方案服装' }) : (currentBatch.inputSnapshot || outputContext(current, currentBatch.sourceImage)),
      id: `reshoot-v${String(version).padStart(3, '0')}`,
      kind: 'reshoot',
      version,
      sourceOutputId: currentBatch.sourceOutputId,
      batchId: currentBatch.id,
      variantId,
      packId: currentBatch.packId,
      packVersion: currentBatch.packVersion,
      packSnapshot: currentBatch.packSnapshot,
      templateSnapshot: currentBatch.templateSnapshot || null,
      adaptationSnapshot: currentBatch.adaptationDraft || null,
      creativePolicy: currentBatch.creativePolicy || null,
      outfitReference: currentBatch.outfitReference || null,
      realismStyleSnapshot: currentBatch.realismStyleSnapshot || null,
      mode: currentBatch.mode || 'variable_pool',
      multiPerson: currentBatch.multiPerson || null,
      seriesPlanSnapshot: currentBatch.seriesPlanDraft || null,
      shotSpec: currentVariant.shotSpec || null,
      referenceRoles: currentVariant.referenceRoles || [],
      diagnosticOutputId: currentBatch.diagnosticOutputId || null,
      seed: currentVariant.seed,
      selections: currentVariant.selections,
      prompt: currentVariant.compiledPrompt,
      ...outputResolutionRecord(currentVariant.outputResolution || currentBatch.outputResolution, output),
      aspectRatio: currentBatch.aspectRatio,
      allowOutfit: currentBatch.allowOutfit,
      referenceVersion: currentBatch.referenceVersion,
      characterCardVersion: currentBatch.characterCardVersion,
      configurationVersion: currentBatch.configurationVersion,
      createdAt: new Date().toISOString(),
      backend: 'built-in-imagegen',
      qualityReview: null,
    };
    current.reshootVersions = [...(current.reshootVersions || []), reshoot];
    currentVariant.status = 'succeeded';
    currentVariant.outputId = reshoot.id;
    currentVariant.error = null;
    current.selectedOutputId = reshoot.id;
    current.workflowStep = 'adjustment';
    current.backend = 'built-in-imagegen';
    finalizeReshootBatchIfDone(current, currentBatch);
    return current;
  });
  if (!updated.activeRunId) await releaseClaim(id, 'reshoot');
  return updated;
}

export async function applyReshootQuality(id, variantId, input, options = {}) {
  return updateJob(id, (job) => {
    const batch = job.reshootBatches?.find((entry) =>
      entry.variants?.some((variant) => variant.id === variantId),
    );
    if (options.batchId && batch?.id !== options.batchId)
      throw new Error('质量检查与重拍批次不匹配');
    const identity = executionIdentity.getStore();
    if (identity && batch?.runId !== identity.runId) throw new Error('质量检查的执行版本不一致');
    const variant = batch?.variants?.find((entry) => entry.id === variantId);
    if (!batch || !variant?.outputId) throw new Error('该重拍方案尚无可检查输出');
    const output = job.reshootVersions?.find((entry) => entry.id === variant.outputId);
    if (!output) throw new Error('未找到重拍输出版本');
    if (identity && output.qualityReview?.adoptionStatus === 'final') throw new Error('不能覆盖用户已采用的验收');
    const userFinal = options.userFinal === true;
    if (userFinal && input?.confirmFinal !== true)
      throw new Error('标记最终采用前必须明确确认');
    const qualityReview = normalizeReshootQuality(input, { userFinal });
    if (
      userFinal &&
      Object.values(qualityReview.axes).some((entry) => entry.status !== 'pass')
    )
      throw new Error('七项质量检查全部通过后才能标记最终采用');
    output.qualityReview = qualityReview;
    variant.qualityReview = qualityReview;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function failReshootVariant(id, variantId, type, message) {
  const updated = await updateJob(id, (job) => {
    const run = activeRun(job);
    if (!run || run.kind !== 'reshoot' || run.status !== 'running')
      throw new Error('当前没有正在执行的创意重拍任务');
    const batch = findReshootBatch(job, job.activeReshootBatchId);
    const variant = batch.variants.find((entry) => entry.id === variantId);
    if (!variant || variant.status !== 'running')
      throw new Error('重拍方案不存在或已经完成');
    variant.status = 'failed';
    variant.error = { type: type || 'imagegen', message };
    run.events.push({
      at: new Date().toISOString(),
      type: 'variant_failed',
      message: `方案 ${variant.index} 失败：${message}`,
    });
    finalizeReshootBatchIfDone(job, batch);
    return job;
  });
  if (!updated.activeRunId) await releaseClaim(id, 'reshoot');
  return updated;
}

export async function failJob(id, type, message) {
  const job = await updateJob(id, (current) => {
    const run = activeRun(current);
    const kind = run?.kind || null;
    if (run?.kind === 'reshoot') {
      const batch = current.reshootBatches?.find(
        (entry) => entry.id === current.activeReshootBatchId,
      );
      if (batch) {
        batch.variants = batch.variants.map((variant) =>
          ['succeeded', 'failed'].includes(variant.status)
            ? variant
            : { ...variant, status: 'failed', error: { type, message } },
        );
        batch.status = batch.variants.some(
          (variant) => variant.status === 'succeeded',
        )
          ? 'partial'
          : 'failed';
      }
      current.activeReshootBatchId = null;
    }
    if (run?.kind === 'series_deconstruct' || run?.kind === 'prompt_adapt') {
      const batch = current.reshootBatches?.find(
        (entry) => entry.id === current.activeReshootBatchId,
      );
      if (batch) batch.status = 'failed';
    }
    if (run) completeActiveRun(current, 'failed', '执行失败', { type, message });
    current.error = {
      type: type || 'execution',
      message,
      recoverable: true,
      at: new Date().toISOString(),
      runId: run?.id || null,
      kind,
      hint: '可以返回修改输入，或手动重试本阶段。',
    };
    return current;
  });
  await Promise.all(
    ['analysis', 'baseline', 'adjustment', 'series_deconstruct', 'prompt_adapt', 'reshoot'].map((kind) => releaseClaim(id, kind)),
  );
  return job;
}

export async function failPromptImport(id, type, message) {
  const item = await mutatePromptImports(async (imports) => {
    const current = imports.find((entry) => entry.id === id);
    if (!current) throw new Error('未找到 Prompt 导入任务');
    const run = activeImportRun(current);
    if (run) completeActiveRun(current, 'failed', 'Prompt 拆分失败', { type, message });
    current.status = 'failed';
    current.updatedAt = new Date().toISOString();
    current.error = {
      type: type || 'execution',
      message,
      recoverable: true,
      at: new Date().toISOString(),
      runId: run?.id || null,
      kind: 'prompt_split',
      hint: '原始 Prompt 已保留，可手动重试拆分。',
    };
    return current;
  });
  await releasePromptClaim(id);
  return item;
}

export async function failPhotographyPackImport(id, type, message) {
  const item = await mutatePackImports(async (imports) => {
    const current = imports.find((entry) => entry.id === id);
    if (!current) throw new Error('未找到摄影方案包导入任务');
    const run = activePackImportRun(current);
    if (run)
      completeActiveRun(current, 'failed', '摄影方案包解析失败', { type, message });
    current.status = 'failed';
    current.updatedAt = new Date().toISOString();
    current.error = {
      type: type || 'execution',
      message,
      recoverable: true,
      at: new Date().toISOString(),
      runId: run?.id || null,
      kind: 'pack_parse',
      hint: '原始摄影资料已保留，可手动重试解析。',
    };
    return current;
  });
  await releasePhotographyPackClaim(id);
  return item;
}

export async function retryRun(runId) {
  await ensureDataRoot();
  const creation = (await listPromptCreations()).find((item) => item.executionRuns.some((run) => run.id === runId));
  if (creation) return retryPromptCreationRun(creation.id, runId);
  const jobs = await readCollection('jobs');
  const jobMatch = jobs.find((entry) =>
    entry.executionRuns?.some((run) => run.id === runId),
  );
  if (jobMatch)
    return mutateJobs(async (currentJobs) => {
      const job = currentJobs.find((entry) => entry.id === jobMatch.id);
      if (!job) throw new Error('未找到执行记录');
      if (job.activeRunId) throw new Error('当前已有 Codex 任务');
      const previous = job.executionRuns.find((run) => run.id === runId);
      if (!['failed', 'interrupted'].includes(previous.status))
        throw new Error('只有失败或中断的任务可以重试');
      if (previous.backend === 'chatgpt-web-manual')
        throw new Error('网页交接已结束，请在当前阶段重新准备一次交接');
      if (!['series_deconstruct', 'prompt_adapt', 'reshoot'].includes(previous.kind)) {
        if (!previous.inputSnapshot || JSON.stringify(previous.inputSnapshot) !== JSON.stringify(executionInputs(job, previous.kind)))
          throw new Error('输入已变化或旧任务没有完整快照，请返回当前阶段重新确认生成；不能用旧 Prompt 配新输入重试');
      }
      if (previous.kind === 'adjustment' && !job.activeAdjustment)
        throw new Error('调整上下文已不存在，请重新提交调整');
      if (previous.kind === 'reshoot')
        throw new Error('重拍批次不会自动重试，请从失败方案新建批次');
      if (previous.kind === 'series_deconstruct' || previous.kind === 'prompt_adapt') {
        const batch = job.reshootBatches?.find(
          (entry) => entry.runId === previous.id,
        );
        if (!batch || batch.mode !== (previous.kind === 'prompt_adapt' ? 'full_prompt' : 'series_plan') || batch.status === 'cancelled')
          throw new Error('解析上下文已不存在，请返回当前阶段重新准备');
        if (previous.kind === 'prompt_adapt' && job.activeReshootBatchId !== batch.id)
          throw new Error('完整 Prompt 适配输入已变化或草稿已放弃，请重新准备，不能重试旧输入');
        batch.status = 'queued';
        job.activeReshootBatchId = batch.id;
      }
      const queued = queueRun(job, previous.kind, previous.id);
      if (['series_deconstruct', 'prompt_adapt'].includes(previous.kind)) findReshootBatch(queued, job.activeReshootBatchId).runId = queued.activeRunId;
      Object.assign(job, queued, { updatedAt: new Date().toISOString() });
      return job;
    });
  const promptImports = (await readJson(inboxFile(), [])).map(normalizePromptImport);
  if (promptImports.some((entry) => entry.executionRuns?.some((run) => run.id === runId)))
    return mutatePromptImports(async (imports) => {
    const item = imports.find((entry) =>
      entry.executionRuns?.some((run) => run.id === runId),
    );
    if (!item) throw new Error('未找到执行记录');
    if (item.activeRunId) throw new Error('当前已有 Codex 任务');
    const previous = item.executionRuns.find((run) => run.id === runId);
    if (!['failed', 'interrupted'].includes(previous.status))
      throw new Error('只有失败或中断的任务可以重试');
    const run = newRun('prompt_split', previous.id);
    item.executionRuns.push(run);
    item.activeRunId = run.id;
    item.status = 'queued';
    item.updatedAt = new Date().toISOString();
    item.error = null;
    return item;
  });
  return mutatePackImports(async (imports) => {
    const item = imports.find((entry) =>
      entry.executionRuns?.some((run) => run.id === runId),
    );
    if (!item) throw new Error('未找到执行记录');
    if (item.activeRunId) throw new Error('当前已有 Codex 任务');
    const previous = item.executionRuns.find((run) => run.id === runId);
    if (!['failed', 'interrupted'].includes(previous.status))
      throw new Error('只有失败或中断的任务可以重试');
    const run = newRun('pack_parse', previous.id);
    item.executionRuns.push(run);
    item.activeRunId = run.id;
    item.status = 'queued';
    item.updatedAt = new Date().toISOString();
    item.error = null;
    return item;
  });
}

export async function setSelectedOutput(id, outputId) {
  return updateJob(id, (job) => {
    if (!allOutputs(job).some((item) => item.id === outputId))
      throw new Error('未找到所选版本');
    const batch = job.reshootBatches?.find(
      (entry) => entry.id === job.activeReshootBatchId,
    );
    if (batch && batch.sourceOutputId !== outputId) {
      interruptWaitingHandoff(job, '重拍源版本已改变，原网页交接已失效');
      invalidateActiveReshootDraft(job, '重拍源版本已改变，原重拍草稿已失效');
    }
    return { ...job, selectedOutputId: outputId };
  });
}

export async function nextQueuedRun() {
  await ensureDataRoot();
  const jobs = await readCollection('jobs');
  return jobs
    .flatMap((job) =>
      (job.executionRuns || [])
        .filter(
          (run) =>
            run.status === 'queued' &&
            run.id === job.activeRunId &&
            (!['baseline', 'adjustment'].includes(run.kind) ||
              run.backend === 'built-in-imagegen'),
        )
        .map((run) => ({ jobId: job.id, run })),
    )
    .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))[0] || null;
}

export async function nextQueuedTask() {
  await ensureDataRoot();
  const [jobs, imports, packImports] = await Promise.all([
    readCollection('jobs'),
    readJson(inboxFile(), []),
    readJson(packImportsFile(), []),
  ]);
  return [
    ...(await listPromptCreations()).flatMap((item) => item.executionRuns.filter((run) => run.status === 'queued' && run.id === item.activeRunId).map((run) => ({ targetType: 'prompt_creation', targetId: item.id, run }))),
    ...jobs.flatMap((job) =>
      (job.executionRuns || [])
        .filter(
          (run) =>
            run.status === 'queued' &&
            run.id === job.activeRunId &&
            (!['baseline', 'adjustment'].includes(run.kind) ||
              run.backend === 'built-in-imagegen'),
        )
        .map((run) => ({ targetType: 'job', targetId: job.id, run })),
    ),
    ...imports.map(normalizePromptImport).flatMap((item) =>
      (item.executionRuns || [])
        .filter((run) => run.status === 'queued' && run.id === item.activeRunId)
        .map((run) => ({
          targetType: 'prompt_import',
          targetId: item.id,
          run,
        })),
    ),
    ...packImports.map(normalizePackImport).flatMap((item) =>
      (item.executionRuns || [])
        .filter((run) => run.status === 'queued' && run.id === item.activeRunId)
        .map((run) => ({
          targetType: 'pack_import',
          targetId: item.id,
          run,
        })),
    ),
  ].sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))[0] || null;
}

export async function queuedRunCount() {
  await ensureDataRoot();
  const [jobs, imports, packImports] = await Promise.all([
    readCollection('jobs'),
    readJson(inboxFile(), []),
    readJson(packImportsFile(), []),
  ]);
  return (await listPromptCreations()).filter((item) => item.executionRuns.some((run) => run.id === item.activeRunId && run.status === 'queued')).length + jobs.reduce(
    (count, job) =>
      count +
      (job.executionRuns || []).filter(
        (run) =>
          run.status === 'queued' &&
          run.id === job.activeRunId &&
          (!['baseline', 'adjustment'].includes(run.kind) ||
            run.backend === 'built-in-imagegen'),
      ).length,
    0,
  ) + imports.map(normalizePromptImport).reduce(
    (count, item) =>
      count +
      (item.executionRuns || []).filter(
        (run) => run.status === 'queued' && run.id === item.activeRunId,
      ).length,
    0,
  ) + packImports.map(normalizePackImport).reduce(
    (count, item) =>
      count +
      (item.executionRuns || []).filter(
        (run) => run.status === 'queued' && run.id === item.activeRunId,
      ).length,
    0,
  );
}

export async function getExecutionTarget(targetType, targetId) {
  if (targetType === 'prompt_creation') return getPromptCreation(targetId);
  if (targetType === 'prompt_import') return getPromptImport(targetId);
  if (targetType === 'pack_import') return getPhotographyPackImport(targetId);
  return getJob(targetId);
}

export async function appendRunEvent(jobId, runId, event) {
  return updateJob(jobId, (job) => {
    const run = job.executionRuns.find((item) => item.id === runId);
    if (!run || !['queued', 'running'].includes(run.status)) return job;
    const entry = {
      at: new Date().toISOString(),
      type: event.type || 'progress',
      message: event.message || 'Codex 正在处理',
    };
    run.progress = entry.message;
    run.events = [...(run.events || []), entry].slice(-60);
    if (event.threadId) run.codexThreadId = event.threadId;
    if (event.turnId) run.codexTurnId = event.turnId;
    return job;
  });
}

export async function appendTaskRunEvent(targetType, targetId, runId, event) {
  if (targetType === 'prompt_creation') return mutatePromptCreation(targetId, (item) => {
    const run = item.executionRuns.find((entry) => entry.id === runId);
    if (!run || !['queued', 'running'].includes(run.status)) return item;
    run.progress = event.message;
    run.events = [...run.events, { ...event, at: new Date().toISOString() }].slice(-60);
    return item;
  });
  if (targetType === 'job') return appendRunEvent(targetId, runId, event);
  if (targetType === 'pack_import')
    return mutatePackImports(async (imports) => {
      const item = imports.find((entry) => entry.id === targetId);
      if (!item) throw new Error('未找到摄影方案包导入任务');
      const run = item.executionRuns.find((entry) => entry.id === runId);
      if (!run || !['queued', 'running'].includes(run.status)) return item;
      const entry = {
        at: new Date().toISOString(),
        type: event.type || 'progress',
        message: event.message || 'Codex 正在处理',
      };
      run.progress = entry.message;
      run.events = [...(run.events || []), entry].slice(-60);
      if (event.threadId) run.codexThreadId = event.threadId;
      if (event.turnId) run.codexTurnId = event.turnId;
      item.updatedAt = entry.at;
      return item;
    });
  return mutatePromptImports(async (imports) => {
    const item = imports.find((entry) => entry.id === targetId);
    if (!item) throw new Error('未找到 Prompt 导入任务');
    const run = item.executionRuns.find((entry) => entry.id === runId);
    if (!run || !['queued', 'running'].includes(run.status)) return item;
    const entry = {
      at: new Date().toISOString(),
      type: event.type || 'progress',
      message: event.message || 'Codex 正在处理',
    };
    run.progress = entry.message;
    run.events = [...(run.events || []), entry].slice(-60);
    if (event.threadId) run.codexThreadId = event.threadId;
    if (event.turnId) run.codexTurnId = event.turnId;
    item.updatedAt = entry.at;
    return item;
  });
}

export async function interruptRun(jobId, runId, message) {
  const updated = await updateJob(jobId, (job) => {
    const run = job.executionRuns.find((item) => item.id === runId);
    if (!run || job.activeRunId !== runId || !['queued', 'running'].includes(run.status)) return job;
    const at = new Date().toISOString();
    run.status = 'interrupted';
    run.progress = message;
    run.completedAt = at;
    run.error = { type: 'interrupted', message };
    run.events.push({ at, type: 'interrupted', message });
    if (job.activeRunId === runId) job.activeRunId = null;
    if (['reshoot', 'series_deconstruct', 'prompt_adapt'].includes(run.kind)) {
      const batch = job.reshootBatches?.find(
        (entry) => entry.id === job.activeReshootBatchId,
      );
      if (batch) batch.status = 'interrupted';
      if (run.kind === 'reshoot') job.activeReshootBatchId = null;
    }
    job.error = {
      type: 'interrupted',
      message,
      recoverable: true,
      at,
      runId,
      kind: run.kind,
      hint: '连接恢复后可手动重试本阶段。',
    };
    return job;
  });
  await Promise.all(
    ['analysis', 'baseline', 'adjustment', 'series_deconstruct', 'prompt_adapt', 'reshoot'].map((kind) =>
      releaseClaim(jobId, kind, runId),
    ),
  );
  return updated;
}

export async function interruptTaskRun(targetType, targetId, runId, message) {
  if (targetType === 'prompt_creation') return finishPromptCreationRun(targetId, runId, 'interrupted', message);
  if (targetType === 'job') return interruptRun(targetId, runId, message);
  if (targetType === 'pack_import') {
    const updated = await mutatePackImports(async (imports) => {
      const item = imports.find((entry) => entry.id === targetId);
      if (!item) throw new Error('未找到摄影方案包导入任务');
      const run = item.executionRuns.find((entry) => entry.id === runId);
      if (!run || !['queued', 'running'].includes(run.status)) return item;
      const at = new Date().toISOString();
      run.status = 'interrupted';
      run.progress = message;
      run.completedAt = at;
      run.error = { type: 'interrupted', message };
      run.events.push({ at, type: 'interrupted', message });
      if (item.activeRunId === runId) item.activeRunId = null;
      item.status = 'interrupted';
      item.updatedAt = at;
      item.error = {
        type: 'interrupted',
        message,
        recoverable: true,
        at,
        runId,
        kind: 'pack_parse',
        hint: '原始摄影资料已保留，请手动重试。',
      };
      return item;
    });
    await releasePhotographyPackClaim(targetId, runId);
    return updated;
  }
  const updated = await mutatePromptImports(async (imports) => {
    const item = imports.find((entry) => entry.id === targetId);
    if (!item) throw new Error('未找到 Prompt 导入任务');
    const run = item.executionRuns.find((entry) => entry.id === runId);
    if (!run || !['queued', 'running'].includes(run.status)) return item;
    const at = new Date().toISOString();
    run.status = 'interrupted';
    run.progress = message;
    run.completedAt = at;
    run.error = { type: 'interrupted', message };
    run.events.push({ at, type: 'interrupted', message });
    if (item.activeRunId === runId) item.activeRunId = null;
    item.status = 'interrupted';
    item.updatedAt = at;
    item.error = {
      type: 'interrupted',
      message,
      recoverable: true,
      at,
      runId,
      kind: 'prompt_split',
      hint: '原始 Prompt 已保留，请手动重试。',
    };
    return item;
  });
  await releasePromptClaim(targetId, runId);
  return updated;
}

export async function failExecutionTarget(targetType, targetId, type, message, runId = null) {
  if (targetType === 'prompt_creation') return finishPromptCreationRun(targetId, runId || executionIdentity.getStore()?.runId, 'failed', message, type);
  if (runId) return withExecutionIdentity({ type: targetType, id: targetId, runId }, () => failExecutionTarget(targetType, targetId, type, message));
  if (targetType === 'prompt_import') return failPromptImport(targetId, type, message);
  if (targetType === 'pack_import')
    return failPhotographyPackImport(targetId, type, message);
  return failJob(targetId, type, message);
}

export async function findExecutionRun(runId) {
  const data = await getBootstrap();
  for (const [type, entries] of [['job', data.jobs], ['prompt_import', data.promptImports], ['pack_import', data.photographyPackImports], ['prompt_creation', data.promptCreations]]) {
    const target = entries.find((item) => item.executionRuns?.some((run) => run.id === runId));
    if (target) return { type, target, run: target.executionRuns.find((run) => run.id === runId) };
  }
  throw new Error('未找到执行记录');
}

export async function discardReshootDraft(id, batchId, reopenPlan = false) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('请先停止本次执行');
    const batch = findReshootBatch(job, batchId);
    if (reopenPlan) {
      if (!['series_plan', 'full_prompt'].includes(batch.mode) || batch.status !== 'draft') throw new Error('只能返回待生成的企划或角色适配');
      batch.promptHistory = [...(batch.promptHistory || []), structuredClone(batch.variants)];
      batch.status = 'plan_ready';
    } else {
      if (['draft', 'plan_ready', 'failed', 'interrupted'].includes(batch.status)) batch.status = 'cancelled';
      if (job.activeReshootBatchId === batch.id) job.activeReshootBatchId = null;
    }
    job.error = null;
    return job;
  });
}

export async function recoverReshootVariants(id, batchId, variantIds) {
  return updateJob(id, (job) => {
    if (job.activeRunId) throw new Error('请先结束当前执行');
    const original = findReshootBatch(job, batchId);
    if (!Array.isArray(variantIds) || !variantIds.length || new Set(variantIds).size !== variantIds.length) throw new Error('请选择失败或跳过的分镜');
    const selected = variantIds.map((variantId) => original.variants.find((item) => item.id === variantId));
    if (selected.some((item) => !item || !['failed', 'skipped_by_user'].includes(item.status))) throw new Error('只能从失败或跳过的方案建立新草稿');
    invalidateActiveReshootDraft(job, '已从失败方案建立新草稿');
    const batch = {
      ...structuredClone(original), id: `reshoot-batch-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      recoveredFrom: original.id, status: 'draft', quantity: selected.length,
      inputSnapshot: original.inputSnapshot || outputContext(job, original.sourceImage),
      runId: null, backend: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      variants: selected.map((item, index) => ({ ...structuredClone(item), id: `reshoot-variant-${crypto.randomUUID()}`, index: index + 1, status: 'draft', outputId: null, error: null, qualityReview: null })),
    };
    if (batch.mode === 'series_plan') batch.seriesPlanDraft.shots = batch.variants.map((item) => item.shotSpec);
    job.reshootBatches.push(batch);
    job.activeReshootBatchId = batch.id;
    job.error = null;
    return job;
  });
}

export async function interruptOrphanedRuns() {
  await ensureDataRoot();
  for (const item of await listPromptCreations()) {
    const run = item.executionRuns.find((entry) => entry.id === item.activeRunId);
    if (run?.status === 'running') await finishPromptCreationRun(item.id, run.id, 'interrupted', '本地服务重启，输入已保存；请手动重试');
  }
  const interruptedIds = [];
  const result = await mutateJobs(async (jobs) => {
    const at = new Date().toISOString();
    for (const job of jobs) {
      const run = activeRun(job);
      if (run?.status !== 'running') continue;
      interruptedIds.push(job.id);
      run.status = 'interrupted';
      run.progress = '本地服务重启，原执行已中断';
      run.completedAt = at;
      run.error = { type: 'service_restart', message: run.progress };
      run.events.push({ at, type: 'interrupted', message: run.progress });
      job.activeRunId = null;
      if (['reshoot', 'series_deconstruct', 'prompt_adapt'].includes(run.kind)) {
        const batch = job.reshootBatches?.find(
          (entry) => entry.id === job.activeReshootBatchId,
        );
        if (batch) batch.status = 'interrupted';
        if (run.kind === 'reshoot') job.activeReshootBatchId = null;
      }
      job.error = {
        type: 'service_restart',
        message: run.progress,
        recoverable: true,
        at,
        runId: run.id,
        kind: run.kind,
        hint: '请手动重试本阶段。',
      };
      job.updatedAt = at;
    }
    return jobs;
  });
  await Promise.all(
    interruptedIds.flatMap((id) =>
      ['analysis', 'baseline', 'adjustment', 'series_deconstruct', 'prompt_adapt', 'reshoot'].map((kind) => releaseClaim(id, kind)),
    ),
  );
  const interruptedImports = await mutatePromptImports(async (imports) => {
    const at = new Date().toISOString();
    const ids = [];
    for (const item of imports) {
      const run = activeImportRun(item);
      if (run?.status !== 'running') continue;
      ids.push(item.id);
      run.status = 'interrupted';
      run.progress = '本地服务重启，Prompt 拆分已中断';
      run.completedAt = at;
      run.error = { type: 'service_restart', message: run.progress };
      run.events.push({ at, type: 'interrupted', message: run.progress });
      item.activeRunId = null;
      item.status = 'interrupted';
      item.updatedAt = at;
      item.error = {
        type: 'service_restart',
        message: run.progress,
        recoverable: true,
        at,
        runId: run.id,
        kind: 'prompt_split',
        hint: '原始 Prompt 已保留，请手动重试。',
      };
    }
    return ids;
  });
  await Promise.all(interruptedImports.map((id) => releasePromptClaim(id)));
  const interruptedPackImports = await mutatePackImports(async (imports) => {
    const at = new Date().toISOString();
    const ids = [];
    for (const item of imports) {
      const run = activePackImportRun(item);
      if (run?.status !== 'running') continue;
      ids.push(item.id);
      run.status = 'interrupted';
      run.progress = '本地服务重启，摄影方案包解析已中断';
      run.completedAt = at;
      run.error = { type: 'service_restart', message: run.progress };
      run.events.push({ at, type: 'interrupted', message: run.progress });
      item.activeRunId = null;
      item.status = 'interrupted';
      item.updatedAt = at;
      item.error = {
        type: 'service_restart',
        message: run.progress,
        recoverable: true,
        at,
        runId: run.id,
        kind: 'pack_parse',
        hint: '原始摄影资料已保留，请手动重试。',
      };
    }
    return ids;
  });
  await Promise.all(
    interruptedPackImports.map((id) => releasePhotographyPackClaim(id)),
  );
  return result;
}

export async function currentJob() {
  await ensureDataRoot();
  const jobs = await readCollection('jobs');
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

export async function currentPromptImport() {
  await ensureDataRoot();
  const imports = (await readJson(inboxFile(), [])).map(normalizePromptImport);
  return [...imports]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((item) => ['queued', 'running'].includes(item.status)) || null;
}

export async function currentPhotographyPackImport() {
  await ensureDataRoot();
  const imports = (await readJson(packImportsFile(), [])).map(normalizePackImport);
  return [...imports]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((item) => ['queued', 'running'].includes(item.status)) || null;
}
