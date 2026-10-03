import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DATA_ROOT,
  readJson,
  writeJsonAtomic,
  withLock,
  newRun,
  ensureDataRoot,
  getJob,
  outputContext,
  resolveOutputResolution,
  copyOutput,
  persistImportedOutputData,
  createReshootWebHandoffDirectory,
  resolveUnder,
  withTrackedFiles,
} from './store.mjs';
import { assertFaceReviewed } from '../lib/baseline-face.mjs';
import { validateAspectRatio, validateGenerationBackend } from './domain.mjs';
import {
  nativeResolutionPrompt,
  outputResolutionRecord,
} from '../lib/image-output-policy.mjs';
import { WEB_RESHOOT_WATERMARK } from './web-reshoot-watermark.mjs';
import { conciseRealismPrompt } from '../lib/concise-prompts.mjs';

const file = () => path.join(DATA_ROOT, 'prompts', 'creations.json');
const stamp = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const SKILLS = {
  vsc: '自动选择',
  'character-candid-photography': '色狼偷拍感（虚构摆拍）',
  'vibeshot-candid-photography': '生活人像',
  'summer-boyfriend-pov': '夏日朋友视角 / 合拍',
  'rare-style-explorer': '少见风格探索',
  'shan-ze-school': '东方幻想（非写实）',
};
// Keep the installed skill ID stable for existing creations and VSC routing.
// This is the same character-candid skill, not a second implementation.
const SKILL_DETAILS = {
  'character-candid-photography': {
    description:
      '原“角色自然抓拍”：门框、货架或玻璃遮挡，长焦观察、手机快拍与偶尔回头发现镜头。仅限成年角色、知情同意的虚构摆拍，不涉及真实非自愿偷拍或私密偷窥。',
    sourceUrl: 'https://x.com/VoxcatAI/status/2097511865857507750',
  },
};
const txt = (value, max, label, optional = false) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!optional && !value.trim())
  )
    throw new Error(`${label}须为${optional ? '0' : '1'}–${max}字符`);
  return value;
};
const count = (value, max = 4) => {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`数量须为 1–${max}`);
  return value;
};

export async function vscCapabilities() {
  const root =
    process.env.AI_COS_VSC_ROOT ||
    path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
      'skills',
    );
  return Promise.all(
    Object.entries(SKILLS).map(async ([name, label]) => {
      const skillPath = path.join(root, name, 'SKILL.md');
      try {
        const source = await fs.readFile(skillPath, 'utf8');
        if (!new RegExp(`^name: ["']?${name}["']?\\s*$`, 'm').test(source))
          throw new Error('名称不匹配');
        return {
          name,
          label,
          ...SKILL_DETAILS[name],
          path: skillPath,
          available: true,
          hash: crypto.createHash('sha256').update(source).digest('hex'),
        };
      } catch {
        return {
          name,
          label,
          ...SKILL_DETAILS[name],
          available: false,
          path: skillPath,
          hash: null,
        };
      }
    }),
  );
}

export async function listPromptCreations() {
  return readJson(file(), []);
}
export async function getPromptCreation(id) {
  const item = (await listPromptCreations()).find((entry) => entry.id === id);
  if (!item) throw new Error('Prompt 创作不存在');
  return item;
}
export async function mutatePromptCreation(id, updater) {
  await ensureDataRoot();
  return withLock('prompt-creations', () =>
    withTrackedFiles(async () => {
      const items = await listPromptCreations();
      const item = items.find((entry) => entry.id === id);
      if (!item) throw new Error('Prompt 创作不存在');
      await updater(item);
      item.updatedAt = stamp();
      await writeJsonAtomic(file(), items);
      return item;
    }),
  );
}

function idle(item, version) {
  if (item.activeRunId)
    throw new Error('当前创作正在执行或等待导回，请先完成或取消');
  if (version !== item.version) throw new Error('草稿已更新，请刷新后再操作');
}
function running(item, runId, kinds, statuses = ['running']) {
  const run = item.executionRuns.find((entry) => entry.id === runId);
  if (
    !runId ||
    item.activeRunId !== runId ||
    !run ||
    !statuses.includes(run.status) ||
    !kinds.includes(run.kind)
  )
    throw new Error('执行已结束、未领取或版本失效');
  return run;
}
function finish(item, run, status, message, type = status) {
  run.status = status;
  run.progress = message;
  run.completedAt = stamp();
  run.error = status === 'succeeded' ? null : { type, message };
  run.events.push({ at: stamp(), type: status, message });
  item.activeRunId = null;
}
function batchOf(item, run) {
  return item.batches.find((entry) => entry.runId === run.id);
}
function finishBatch(item, run) {
  const batch = batchOf(item, run);
  if (
    batch.variants.some(
      (variant) =>
        !['succeeded', 'failed', 'skipped_by_user'].includes(variant.status),
    )
  )
    return;
  const successes = batch.variants.filter(
    (variant) => variant.status === 'succeeded',
  ).length;
  batch.status =
    successes === batch.variants.length
      ? 'succeeded'
      : successes
        ? 'partial'
        : 'failed';
  finish(
    item,
    run,
    successes ? 'succeeded' : 'failed',
    `${successes}/${batch.variants.length} 张已归档；未自动重试`,
  );
  if (run.handoff) {
    run.handoff.status = 'completed';
    run.handoff.importedAt = stamp();
  }
}

async function participantsSnapshot(inputs) {
  if (!Array.isArray(inputs)) throw new Error('请设置人物');
  count(inputs.length);
  const used = new Set();
  const faces = await readJson(path.join(DATA_ROOT, 'faces', 'index.json'), []);
  return Promise.all(
    inputs.map(async (input, index) => {
      if (!['text', 'face', 'output'].includes(input.sourceType))
        throw new Error('人物来源无效');
      if (!['original', 'character', 'free'].includes(input.scope))
        throw new Error('人物创作范围无效');
      if (
        input.scope !== 'original' &&
        (!input.adultConfirmed || !input.stylingConfirmed)
      )
        throw new Error('换装或自由写真须逐人确认成年与造型修改');
      const person = {
        label: 'ABCD'[index],
        sourceType: input.sourceType,
        scope: input.scope,
        description: txt(
          input.description || '',
          3000,
          '人物描述',
          input.sourceType !== 'text' || inputs.length === 1,
        ),
        position: txt(input.position || '', 500, '站位', inputs.length === 1),
        adultConfirmed: input.adultConfirmed === true,
        stylingConfirmed: input.stylingConfirmed === true,
        images: [],
        context: null,
        sourceId: null,
      };
      if (input.sourceType === 'face') {
        const face = faces.find(
          (entry) => entry.id === input.faceId && !entry.archivedAt,
        );
        if (!face?.authorizationConfirmed || !face.images?.length)
          throw new Error('请使用已有授权且含照片的脸模');
        person.sourceId = `face:${face.id}`;
        person.faceId = face.id;
        person.faceSnapshot = structuredClone(face);
        person.images = face.images
          .slice(0, 3)
          .map((image) => ({
            ...image,
            role: `person_${person.label}_face`,
            purpose: `仅人物 ${person.label} 的面部身份；同人的互补角度，不提供身材、发型、妆容、服装或额外人数`,
          }));
      } else if (input.sourceType === 'output') {
        const job = await getJob(input.jobId);
        const source = [
          ...job.baselineVersions,
          ...job.adjustmentVersions,
          ...(job.reshootVersions || []),
        ].find((output) => output.id === input.outputId);
        if (!source || source.mode === 'multi_person')
          throw new Error('请选择一个已有单人版本，不能把合影当作一个人');
        assertFaceReviewed(job, source);
        person.context = outputContext(job, source);
        if (
          person.context.faceSnapshot &&
          !person.context.faceSnapshot.authorizationConfirmed
        )
          throw new Error('源图脸模尚未授权');
        person.sourceId = `output:${job.id}:${source.id}`;
        person.jobId = job.id;
        person.outputId = source.id;
        person.images = [
          {
            ...source,
            role: `person_${person.label}_source`,
            purpose: `仅人物 ${person.label} 的干净单人源图；保持范围由该人物 scope 决定`,
          },
        ];
      }
      if (person.sourceId) {
        const identityKey =
          person.faceId || person.context?.faceSnapshot?.id || person.jobId;
        if (used.has(identityKey))
          throw new Error('不同人物不能重复使用同一身份源');
        used.add(identityKey);
      }
      return person;
    }),
  );
}

export function creationAssets(item) {
  return item.participants.flatMap((person) =>
    person.images.map((image) => ({
      path: image.path,
      url: image.url,
      mime: image.mime,
      role: image.role,
      purpose: image.purpose,
    })),
  );
}
export function creationScope(item) {
  return item.participants
    .map((p) => {
      const preserved =
        p.scope === 'original'
          ? '保持身份、身体与原角色妆容、发型发饰、瞳色、服装设计'
          : p.scope === 'character'
            ? '保持身份、身体、角色妆容、发型发饰和瞳色；服装与道具可按本轮创意改变'
            : '保持面部身份；仅本轮已授权的发型、妆容与服装可以改变，不改变身体身份';
      const card = Object.entries(p.context?.characterCard || {})
        .filter(
          ([key]) =>
            p.scope === 'original' ||
            (p.scope === 'character'
              ? [
                  'hairstyle',
                  'hairAccessories',
                  'iris',
                  'makeup',
                  'bodySilhouette',
                ].includes(key)
              : key === 'bodySilhouette'),
        )
        .map(([key, field]) => `${key}：${field.value}`)
        .filter((line) => !line.endsWith('：'))
        .join('；');
      return `${p.label}：${p.description || p.faceSnapshot?.name || p.outputId}。${preserved}。${p.position ? `站位：${p.position}。` : ''}${p.sourceType === 'text' ? '角色设计来自文字；未提供真人身份参考，面部为原创，不宣称已精确复刻真人。' : p.sourceType === 'face' ? '脸模只固定五官身份，不沿用照片中人物的身材和造型。' : ''}${card}`;
    })
    .join('\n');
}
export function compiledCreationPrompt(item, draft, backend) {
  const assets = creationAssets(item);
  return [
    draft.prompt,
    '【人物与参考职责】',
    creationScope(item),
    ...assets.map((ref, index) => `图 ${index + 1}：${ref.purpose}`),
    item.participants.length > 1
      ? `共 ${item.participants.length} 人在同一画面中互动，身份、发饰与服装不能串人；不拼图、不额外加人。`
      : '',
    '人物与参考职责高于摄影风格默认设定。禁止未成年或年龄不明人物性化；仅使用已授权身份。不复制参考署名。',
    item.aspectRatio === 'source' && !assets.length
      ? '无源图时按本轮文字选择自然构图。'
      : '',
    draft.selectedSkill !== 'shan-ze-school'
      ? conciseRealismPrompt('reshoot').replace(
          '保留身份和妆容',
          '保留身份及本轮确认的妆容',
        )
      : '',
    !assets.length && item.aspectRatio === 'source'
      ? nativeResolutionPrompt(item.outputResolution).replace(
          '保持源图宽高比',
          '采用本轮文字所选构图',
        )
      : nativeResolutionPrompt(item.outputResolution),
    backend === 'chatgpt-web-manual' ? WEB_RESHOOT_WATERMARK : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
function previews(item) {
  for (const draft of item.drafts)
    draft.previews = Object.fromEntries(
      ['built-in-imagegen', 'chatgpt-web-manual'].map((backend) => [
        backend,
        compiledCreationPrompt(item, draft, backend),
      ]),
    );
}
function queueCompose(item, requestedIds, feedback, retryOf = null) {
  const run = newRun('prompt_compose', retryOf);
  run.request = { requestedIds, feedback };
  item.executionRuns.push(run);
  item.activeRunId = run.id;
  return run;
}
export async function createPromptCreation(input) {
  await ensureDataRoot();
  const brief = txt(input.brief, 10000, '照片需求');
  const quantity = count(input.quantity ?? 3);
  const skill = input.skill || 'vsc';
  const capabilities = await vscCapabilities();
  if (!capabilities.some((entry) => entry.name === skill && entry.available))
    throw new Error('该 VSC 技能尚未安装或不可读');
  const participants = await participantsSnapshot(input.participants);
  const aspectRatio = validateAspectRatio(input.aspectRatio || 'source');
  const item = {
    id: uid('creation'),
    version: 1,
    name: brief.slice(0, 40),
    brief,
    quantity,
    skill,
    capabilities: capabilities.filter((entry) => entry.available),
    participants,
    aspectRatio,
    outputResolution: await resolveOutputResolution(
      aspectRatio,
      participants.flatMap((p) => p.images)[0],
    ),
    drafts: [],
    draftHistory: [],
    executionRuns: [],
    activeRunId: null,
    batches: [],
    outputs: [],
    createdAt: stamp(),
    updatedAt: stamp(),
  };
  queueCompose(item, [], '');
  await withLock('prompt-creations', async () =>
    writeJsonAtomic(file(), [...(await listPromptCreations()), item]),
  );
  return item;
}
export async function claimPromptCreation(id, runId) {
  return mutatePromptCreation(id, async (item) => {
    const run = running(
      item,
      runId,
      ['prompt_compose', 'prompt_render'],
      ['queued'],
    );
    if (run.kind === 'prompt_compose') {
      const current = await vscCapabilities();
      const requested = item.capabilities.find(
        (entry) => entry.name === item.skill,
      );
      if (
        !current.some(
          (entry) =>
            entry.name === requested.name && entry.hash === requested.hash,
        )
      )
        throw new Error('VSC 技能已更改，请创建新创作以冻结新版本');
    } else if (run.backend !== 'built-in-imagegen')
      throw new Error('网页交接不能由 Codex 领取');
    run.status = 'running';
    run.startedAt = stamp();
    run.progress =
      run.kind === 'prompt_compose'
        ? 'VSC 正在构思完整 Prompt'
        : '正在按已确认 Prompt 生图';
    if (run.kind === 'prompt_render') batchOf(item, run).status = 'running';
  });
}
export async function applyCreationDrafts(id, runId, input) {
  const currentSkills = await vscCapabilities();
  return mutatePromptCreation(id, (item) => {
    const run = running(item, runId, ['prompt_compose']);
    const allowed = item.capabilities.filter(
      (entry) =>
        entry.name !== 'vsc' &&
        (entry.name !== 'shan-ze-school' || item.skill === 'shan-ze-school'),
    );
    if (
      !allowed.some((entry) => entry.name === input.selectedSkill) ||
      (item.skill !== 'vsc' && item.skill !== input.selectedSkill)
    )
      throw new Error('返回的技能不在本轮可用范围');
    const expectedSkill = allowed.find(
      (entry) => entry.name === input.selectedSkill,
    );
    if (
      !currentSkills.some(
        (entry) =>
          entry.name === expectedSkill.name &&
          entry.hash === expectedSkill.hash,
      )
    )
      throw new Error('使用的技能已更改，请重新创建任务');
    const expected = run.request.requestedIds;
    if (
      !Array.isArray(input.drafts) ||
      input.drafts.length !== (expected.length || item.quantity)
    )
      throw new Error('返回 Prompt 数量与本轮要求不一致');
    const seen = new Set();
    const next = input.drafts.map((draft) => {
      if (
        expected.length &&
        (!expected.includes(draft.id) || seen.has(draft.id))
      )
        throw new Error('修改草稿编号不匹配');
      seen.add(draft.id);
      return {
        id: expected.length ? draft.id : uid('draft'),
        title: txt(draft.title, 120, '草稿名称'),
        prompt: txt(draft.prompt, 30000, '完整 Prompt'),
        selectedSkill: input.selectedSkill,
      };
    });
    item.draftHistory.push({
      version: item.version,
      drafts: structuredClone(item.drafts),
      at: stamp(),
    });
    item.drafts = expected.length
      ? item.drafts.map(
          (draft) => next.find((entry) => entry.id === draft.id) || draft,
        )
      : next;
    item.version += 1;
    previews(item);
    finish(
      item,
      run,
      'succeeded',
      '完整 Prompt 已写回，等待用户编辑和确认；没有生成图片',
    );
  });
}
export async function editCreationDrafts(id, input) {
  return mutatePromptCreation(id, (item) => {
    idle(item, input.version);
    if (
      !Array.isArray(input.drafts) ||
      input.drafts.length !== item.drafts.length ||
      new Set(input.drafts.map((d) => d.id)).size !== item.drafts.length
    )
      throw new Error('草稿集合不一致');
    const next = input.drafts.map((draft) => {
      const previous = item.drafts.find((entry) => entry.id === draft.id);
      if (!previous) throw new Error('草稿不存在');
      return {
        ...previous,
        title: txt(draft.title, 120, '名称'),
        prompt: txt(draft.prompt, 30000, '完整 Prompt'),
      };
    });
    item.draftHistory.push({
      version: item.version,
      drafts: structuredClone(item.drafts),
      at: stamp(),
    });
    item.drafts = next;
    item.version += 1;
    previews(item);
  });
}
export async function reviseCreation(id, input) {
  return mutatePromptCreation(id, (item) => {
    idle(item, input.version);
    const ids = input.draftIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((draftId) => !item.drafts.some((d) => d.id === draftId))
    )
      throw new Error('请选择要修改的草稿');
    queueCompose(item, ids, txt(input.feedback, 3000, '修改要求'));
  });
}
export async function confirmCreationGeneration(id, input) {
  return mutatePromptCreation(id, async (item) => {
    idle(item, input.version);
    const backend = validateGenerationBackend(input.backend);
    if (
      !Array.isArray(input.draftIds) ||
      !input.draftIds.length ||
      new Set(input.draftIds).size !== input.draftIds.length
    )
      throw new Error('请选择 1–4 条不重复的 Prompt');
    const drafts = input.draftIds.map((draftId) =>
      item.drafts.find((d) => d.id === draftId),
    );
    if (drafts.some((d) => !d)) throw new Error('草稿不存在');
    // Recheck revocable authorization and source review, without replacing any frozen inputs.
    await participantsSnapshot(item.participants);
    const run = newRun('prompt_render', null, backend);
    const batch = {
      id: uid('creation-batch'),
      mode: 'prompt_creation',
      runId: run.id,
      backend,
      status: 'queued',
      inputSnapshot: {
        participants: structuredClone(item.participants),
        brief: item.brief,
        capabilities: item.capabilities,
        version: item.version,
      },
      variants: drafts.map((d, index) => ({
        id: uid('variant'),
        draftId: d.id,
        index: index + 1,
        compiledPrompt: d.previews[backend],
        selectedSkill: d.selectedSkill,
        outputResolution: item.outputResolution,
        status: 'pending',
        outputId: null,
      })),
      createdAt: stamp(),
      aspectRatio: item.aspectRatio,
    };
    if (backend === 'chatgpt-web-manual') {
      run.status = 'waiting_user';
      run.progress = '素材已准备，等待网页生成后导回';
      run.handoff = await createReshootWebHandoffDirectory(
        item,
        run,
        batch,
        creationAssets(item),
      );
      batch.status = 'waiting_user';
    }
    item.batches.push(batch);
    item.executionRuns.push(run);
    item.activeRunId = run.id;
  });
}
export async function finishPromptCreationRun(
  id,
  runId,
  status,
  message,
  type = status,
) {
  return mutatePromptCreation(id, (item) => {
    const run = item.executionRuns.find((entry) => entry.id === runId);
    if (
      !run ||
      item.activeRunId !== runId ||
      !['queued', 'running', 'waiting_user'].includes(run.status)
    )
      return;
    if (batchOf(item, run)) batchOf(item, run).status = status;
    if (run.handoff) {
      run.handoff.status = 'invalidated';
      run.handoff.invalidatedAt = stamp();
    }
    finish(item, run, status, message, type);
  });
}
export async function retryPromptCreationRun(id, runId) {
  return mutatePromptCreation(id, (item) => {
    if (item.activeRunId) throw new Error('当前已有任务');
    const previous = item.executionRuns.find((r) => r.id === runId);
    if (
      !previous ||
      !['failed', 'interrupted'].includes(previous.status) ||
      previous.kind !== 'prompt_compose' ||
      item.executionRuns.at(-1).id !== runId
    )
      throw new Error(
        '只能重试最新失败的 Prompt 构思；图片请重新确认生成新批次',
      );
    queueCompose(
      item,
      previous.request.requestedIds,
      previous.request.feedback,
      runId,
    );
  });
}
function archiveRecord(item, run, variant, image) {
  const output = {
    ...image,
    id: uid('creation-output'),
    version: item.outputs.length + 1,
    variantId: variant.id,
    batchId: batchOf(item, run).id,
    prompt: variant.compiledPrompt,
    backend: run.backend,
    createdAt: stamp(),
    ...outputResolutionRecord(item.outputResolution, image),
    aspectRatio: item.aspectRatio,
  };
  item.outputs.push(output);
  variant.status = 'succeeded';
  variant.outputId = output.id;
  if (run.handoff) {
    const slot = run.handoff.prompts.find((p) => p.variantId === variant.id);
    slot.outputId = output.id;
    slot.importStatus = 'imported';
    run.handoff.outputIds.push(output.id);
  }
}
export async function attachCreationOutput(id, runId, variantId, sourcePath) {
  return mutatePromptCreation(id, async (item) => {
    const run = running(item, runId, ['prompt_render']);
    const variant = batchOf(item, run).variants.find((v) => v.id === variantId);
    if (!variant || variant.status !== 'pending')
      throw new Error('该图片槽位已结束或不存在');
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 50 * 1024 * 1024)
      throw new Error('输出必须是 50 MB 以内的普通图片文件');
    const hash = crypto
      .createHash('sha256')
      .update(await fs.readFile(sourcePath))
      .digest('hex');
    if (batchOf(item, run).variants.some((v) => v.sourceHash === hash))
      throw new Error('不能将同一张图片归档到多个方案');
    const image = await copyOutput(
      sourcePath,
      item.id,
      `reshoot-v${String(item.outputs.length + 1).padStart(3, '0')}.png`,
    );
    variant.sourceHash = hash;
    archiveRecord(item, run, variant, image);
    finishBatch(item, run);
  });
}
export async function failCreationVariant(id, runId, variantId, message) {
  return mutatePromptCreation(id, (item) => {
    const run = running(item, runId, ['prompt_render']);
    const variant = batchOf(item, run).variants.find((v) => v.id === variantId);
    if (!variant || variant.status !== 'pending')
      throw new Error('槽位已结束或不存在');
    variant.status = 'failed';
    variant.error = txt(message, 4000, '失败原因');
    finishBatch(item, run);
  });
}
export async function importCreationOutputs(
  id,
  runId,
  inputs,
  finishPartial = false,
) {
  return mutatePromptCreation(id, async (item) => {
    const run = running(item, runId, ['prompt_render'], ['waiting_user']);
    if (
      run.backend !== 'chatgpt-web-manual' ||
      !Array.isArray(inputs) ||
      !inputs.length ||
      new Set(inputs.map((v) => v.variantId)).size !== inputs.length
    )
      throw new Error('导回槽位无效或重复');
    const batch = batchOf(item, run);
    if (
      inputs.some(
        (v) =>
          !batch.variants.some(
            (target) =>
              target.id === v.variantId && target.status === 'pending',
          ),
      )
    )
      throw new Error('槽位已结束或不属于本批次');
    if (
      !finishPartial &&
      inputs.length !==
        batch.variants.filter((v) => v.status === 'pending').length
    )
      throw new Error('请补齐图片，或明确以部分结果结束批次');
    const createdFiles = [];
    try {
      for (const input of inputs) {
        const image = await persistImportedOutputData(
          input.outputDataUrl,
          { id: item.id, reshootVersions: item.outputs },
          'reshoot',
        );
        createdFiles.push(resolveUnder(DATA_ROOT, image.path));
        archiveRecord(
          item,
          run,
          batch.variants.find((v) => v.id === input.variantId),
          image,
        );
      }
    } catch (error) {
      await Promise.all(
        createdFiles.map((target) => fs.unlink(target).catch(() => {})),
      );
      throw error;
    }
    for (const variant of batch.variants.filter(
      (v) => v.status === 'pending',
    )) {
      variant.status = 'skipped_by_user';
      run.handoff.prompts.find((p) => p.variantId === variant.id).importStatus =
        'skipped_by_user';
    }
    finishBatch(item, run);
  });
}
export function presentCreation(item) {
  const run = item.executionRuns.find((r) => r.id === item.activeRunId);
  return {
    ...item,
    execution: {
      run,
      scope: creationScope(item),
      batch: run ? batchOf(item, run) : null,
      orderedInputFiles: creationAssets(item).map((ref) => ({
        ...ref,
        path: resolveUnder(DATA_ROOT, ref.path),
      })),
    },
  };
}
