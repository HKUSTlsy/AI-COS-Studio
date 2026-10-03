#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { multiPersonAssets } from '../server/multi-person.mjs';
import { getPromptCreation, claimPromptCreation, applyCreationDrafts, attachCreationOutput, failCreationVariant, finishPromptCreationRun, presentCreation, vscCapabilities } from '../server/prompt-creation.mjs';

import {
  DATA_ROOT,
  PROJECT_ROOT,
  applyCharacterCard,
  applyPhotographyPackDraft,
  applyPromptDrafts,
  applyReshootQuality,
  applySeriesPlanDraft,
  applyFullPromptAdaptation,
  saveFullPrompt,
  reshootAssets,
  attachOutput,
  attachReshootOutput,
  claimJob,
  claimPromptImport,
  claimPhotographyPackImport,
  currentJob,
  currentPromptImport,
  currentPhotographyPackImport,
  createPhotographyPackImport,
  ensureDataRoot,
  failJob,
  failPromptImport,
  failPhotographyPackImport,
  failReshootVariant,
  getJob,
  getPromptImport,
  getPhotographyPackImport,
  outputContext,
  reviseMaterialCollection,
  listMaterialCollection,
  withExecutionIdentity,
} from '../server/store.mjs';

function value(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function print(valueToPrint, json = false) {
  process.stdout.write(
    `${json ? JSON.stringify(valueToPrint, null, 2) : valueToPrint}\n`,
  );
}

function presentJob(job) {
  if (!job) return null;
  const absolute = (relativePath) =>
    relativePath ? path.join(DATA_ROOT, relativePath) : null;
  const activeRun =
    job.executionRuns?.find((run) => run.id === job.activeRunId) || null;
  const activeReshootBatch = job.reshootBatches?.find(
    (batch) => batch.id === job.activeReshootBatchId,
  ) || null;
  const cleanSourcePath = absolute(
    activeReshootBatch?.sourceImage?.path || job.activeAdjustment?.sourceImage?.path,
  );
  const annotationPath = absolute(job.activeAdjustment?.annotation?.path);
  const adjustmentReferencePath = absolute(
    job.activeAdjustment?.adjustmentReference?.path,
  );
  const referenceFiles = (
    ['reshoot', 'series_deconstruct', 'prompt_adapt'].includes(activeRun?.kind)
      ? (activeReshootBatch?.inputSnapshot || outputContext(job, activeReshootBatch.sourceImage)).references
      : activeRun?.kind === 'adjustment' ? job.activeAdjustment?.references || [] : job.references || []
  ).map((reference) => ({
    role: reference.role,
    purpose: reference.purpose,
    path: absolute(reference.path),
  }));
  const orderedInputFiles = [
    cleanSourcePath
      ? { role: 'edit_source', purpose: '干净源图，锁定所有非调整项', path: cleanSourcePath }
      : null,
    annotationPath
      ? { role: 'annotation', purpose: '只用于定位调整区域', path: annotationPath }
      : null,
    adjustmentReferencePath
      ? {
          role: 'adjustment_reference',
          purpose: job.activeAdjustment.adjustmentReference.purpose,
          path: adjustmentReferencePath,
        }
      : null,
    ...referenceFiles,
  ].filter(Boolean);
  const seriesReferenceFiles = (activeReshootBatch?.photographyReferences || []).map(
    (reference) => ({
      id: reference.id,
      role: reference.role,
      purpose: reference.purpose,
      name: reference.name,
      path: absolute(reference.path),
    }),
  );
  const presentedBatch = activeReshootBatch
    ? {
        ...activeReshootBatch,
        outfitReference: activeReshootBatch.outfitReference ? { ...activeReshootBatch.outfitReference, path: absolute(activeReshootBatch.outfitReference.path) } : null,
        photographyReferences: seriesReferenceFiles,
        variants: (activeReshootBatch.variants || []).map((variant) => {
          const assets = reshootAssets(job, activeReshootBatch);
          const photographyFiles = (variant.referenceRoles || []).map((role) => {
            const reference = seriesReferenceFiles.find((item) => item.id === role.referenceId);
            return reference ? { ...reference, role: role.role, purpose: role.purpose } : null;
          }).filter(Boolean);
          return {
            ...variant,
            orderedInputFiles: activeReshootBatch.mode === 'multi_person'
              ? multiPersonAssets(activeReshootBatch.multiPerson).map((ref) => ({ ...ref, path: absolute(ref.path) }))
              : [
              cleanSourcePath
                ? {
                    role: 'edit_source',
                    purpose: assets[0].purpose,
                    path: cleanSourcePath,
                  }
                : null,
              ...photographyFiles,
              ...assets.filter((ref) => ref.role === 'outfit_reference' || ref.role.startsWith('character_') || ref.role.startsWith('face_')).map((ref) => ({ ...ref, path: absolute(ref.path) })),
            ].filter(Boolean),
          };
        }),
      }
    : null;
  return {
    ...job,
    execution: {
      backend: 'built-in-imagegen',
      run: activeRun,
      referenceFiles,
      orderedInputFiles:
        activeRun?.kind === 'series_deconstruct'
          ? seriesReferenceFiles
          : activeRun?.kind === 'prompt_adapt'
            ? reshootAssets(job, activeReshootBatch).map((ref) => ({ ...ref, path: absolute(ref.path) }))
          : activeRun?.kind === 'reshoot' && activeReshootBatch?.mode === 'multi_person'
            ? presentedBatch.variants[0].orderedInputFiles
          : orderedInputFiles,
      seriesReferenceFiles,
      cleanSourcePath,
      annotationPath,
      adjustmentReferencePath,
      activeReshootBatch: presentedBatch,
      // Compatibility alias for old Skill callers.
      cleanCandidatePath: absolute(job.activeAdjustment?.sourceImage?.path),
      outputArchiveDirectory: path.join(DATA_ROOT, 'outputs', job.id),
    },
  };
}

function presentPromptImport(item) {
  if (!item) return null;
  const activeRun =
    item.executionRuns?.find((run) => run.id === item.activeRunId) || null;
  return { ...item, execution: { run: activeRun, backend: 'codex-app-server' } };
}

function presentPackImport(item) {
  if (!item) return null;
  const activeRun =
    item.executionRuns?.find((run) => run.id === item.activeRunId) || null;
  return { ...item, execution: { run: activeRun, backend: 'codex-app-server' } };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function jsonInput() {
  const file = value('--file');
  const raw = file
    ? await fs.readFile(path.resolve(file), 'utf8')
    : await readStdin();
  if (!raw.trim())
    throw new Error('请通过 --file 提供 JSON，或从 stdin 输入 JSON');
  return JSON.parse(raw);
}

async function isHealthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

async function openWorkbench() {
  const health = 'http://127.0.0.1:4318/health';
  const workbench = 'http://127.0.0.1:4317';
  const apiWasHealthy = await isHealthy(health);
  if (!apiWasHealthy && !(await isHealthy(workbench))) {
    await ensureDataRoot();
    const logFile = await fs.open(
      path.join(DATA_ROOT, 'runtime', 'workbench.log'),
      'a',
    );
    const child = spawn('npm', ['run', 'dev'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      env: process.env,
    });
    child.unref();
    await logFile.close();
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await isHealthy(health)) && (await isHealthy(workbench))) {
      print(workbench);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `工作台启动失败，请查看 ${path.join(DATA_ROOT, 'runtime', 'workbench.log')}`,
  );
}

function usage() {
  return `AI COS 本地任务控制器

用法：
  ai-cosctl open
  ai-cosctl vsc-capabilities --json
  ai-cosctl show-creation --creation <id> --json
  ai-cosctl claim-creation --creation <id> --run <runId> --json
  ai-cosctl apply-creation-drafts --creation <id> --run <runId> --file <json>
  ai-cosctl attach-creation-output --creation <id> --run <runId> --variant <id> --path <png>
  ai-cosctl fail-creation-variant --creation <id> --run <runId> --variant <id> --message <reason>
  ai-cosctl fail-creation --creation <id> --run <runId> --message <reason>
  ai-cosctl list-materials [--json]
  ai-cosctl revise-materials --file <review-plan.json> [--apply] [--json]
  ai-cosctl current [--json]
  ai-cosctl claim --job <id> --kind analysis|baseline|adjustment|reshoot|prompt_adapt [--json]
  ai-cosctl apply-full-prompt-adaptation --job <id> --run <runId> --file <json>
  ai-cosctl save-full-prompt --file <json>
  ai-cosctl apply-character-card --job <id> --file <card.json>
  ai-cosctl attach-output --job <id> --kind baseline|adjustment --path <png>
  ai-cosctl fail --job <id> --type <type> --message <message>
  ai-cosctl current-prompt [--json]
  ai-cosctl claim-prompt-import --inbox <id> [--json]
  ai-cosctl apply-prompt-drafts --inbox <id> --file <drafts.json>
  ai-cosctl fail-prompt-import --inbox <id> --type <type> --message <message>
  ai-cosctl current-pack [--json]
  ai-cosctl create-pack-import --file <source.json> [--json]
  ai-cosctl claim-pack-import --import <id> [--json]
  ai-cosctl apply-pack-draft --import <id> --file <draft.json>
  ai-cosctl fail-pack-import --import <id> --type <type> --message <message>
  ai-cosctl claim-series-plan --job <id> [--json]
  ai-cosctl apply-series-plan-draft --job <id> --file <draft.json>
  ai-cosctl fail-series-plan --job <id> --type <type> --message <message>
  ai-cosctl attach-reshoot-output --job <id> --variant <variantId> --path <png>
  ai-cosctl apply-reshoot-quality --job <id> --variant <variantId> --file <quality.json>
  ai-cosctl fail-reshoot-variant --job <id> --variant <variantId> --type <type> --message <message>

所有 claim/apply/attach/fail 命令必须附加 --run <runId>；运行期间不得改换执行版本。可先 show/show-prompt/show-pack 读取执行版本。
兼容：apply-prompt-modules 仅写回待确认草稿，不直接入库。

兼容：generation/refinement/candidate 会映射到新版 baseline/adjustment。`;
}

async function main() {
  const creationCommand = process.argv[2];
  const creationId = value('--creation');
  if (creationCommand === 'vsc-capabilities') return print(await vscCapabilities(), true);
  if (creationCommand === 'show-creation') return print(presentCreation(await getPromptCreation(creationId)), true);
  if (creationCommand === 'claim-creation') return print(presentCreation(await claimPromptCreation(creationId, value('--run'))), true);
  if (creationCommand === 'apply-creation-drafts') return print(await applyCreationDrafts(creationId, value('--run'), await jsonInput()), true);
  if (creationCommand === 'attach-creation-output') return print(await attachCreationOutput(creationId, value('--run'), value('--variant'), value('--path')), true);
  if (creationCommand === 'fail-creation-variant') return print(await failCreationVariant(creationId, value('--run'), value('--variant'), value('--message')), true);
  if (creationCommand === 'fail-creation') return print(await finishPromptCreationRun(creationId, value('--run'), 'failed', value('--message'), value('--type', 'execution')), true);
  await ensureDataRoot();
  const command = process.argv[2];
  const json = process.argv.includes('--json');
  if (command === 'open') await openWorkbench();
  else if (command === 'list-materials') print(await listMaterialCollection(), true);
  else if (command === 'revise-materials') {
    const result = await reviseMaterialCollection(await jsonInput(), { apply: process.argv.includes('--apply') });
    print(json ? result : `${result.applied ? '已版本化修订' : '待应用修订'} ${result.count} 项素材`, json);
  }
  else if (command === 'current') {
    const job = await currentJob();
    if (!job) throw new Error('当前没有任务');
    print(
      json
        ? presentJob(job)
        : `${job.id}\t${job.workflowStep}\t${job.title}`,
      json,
    );
  } else if (command === 'claim') {
    const job = await claimJob(value('--job'), value('--kind'));
    print(
      json
        ? presentJob(job)
        : `已领取 ${job.id}，类型：${value('--kind')}`,
      json,
    );
  } else if (command === 'apply-character-card') {
    const job = await applyCharacterCard(value('--job'), await jsonInput());
    print(json ? job : `角色卡已写入 ${job.id}，等待用户确认`, json);
  } else if (command === 'attach-output') {
    const job = await attachOutput(
      value('--job'),
      value('--path'),
      value('--kind'),
    );
    print(json ? job : `输出已归档，当前步骤：${job.workflowStep}`, json);
  } else if (command === 'fail') {
    const message = value('--message');
    if (!message) throw new Error('--message 不能为空');
    const job = await failJob(
      value('--job'),
      value('--type', 'execution'),
      message,
    );
    print(json ? job : `已记录失败：${job.error.message}`, json);
  } else if (command === 'current-prompt') {
    const item = await currentPromptImport();
    if (!item) throw new Error('当前没有待拆分 Prompt');
    print(json ? presentPromptImport(item) : `${item.id}\t${item.title}`, json);
  } else if (command === 'claim-prompt-import') {
    const item = await claimPromptImport(value('--inbox'));
    print(
      json
        ? presentPromptImport(item)
        : `已领取 ${item.id}，类型：prompt_split`,
      json,
    );
  } else if (
    command === 'apply-prompt-drafts' ||
    command === 'apply-prompt-modules'
  ) {
    const payload = await jsonInput();
    const drafts = Array.isArray(payload)
      ? payload
      : payload.drafts || payload.modules;
    const result = await applyPromptDrafts(value('--inbox'), drafts || []);
    print(
      json
        ? result
        : `已写回 ${result.drafts.length} 条待确认 Prompt 草稿`,
      json,
    );
  } else if (command === 'fail-prompt-import') {
    const message = value('--message');
    if (!message) throw new Error('--message 不能为空');
    const item = await failPromptImport(
      value('--inbox'),
      value('--type', 'execution'),
      message,
    );
    print(json ? item : `已记录 Prompt 拆分失败：${item.error.message}`, json);
  } else if (command === 'create-pack-import') {
    const item = await createPhotographyPackImport(await jsonInput());
    print(json ? presentPackImport(item) : `已排队摄影方案包解析：${item.id}`, json);
  } else if (command === 'current-pack') {
    const item = await currentPhotographyPackImport();
    if (!item) throw new Error('当前没有待解析摄影方案包');
    print(json ? presentPackImport(item) : `${item.id}\t${item.title}`, json);
  } else if (command === 'claim-pack-import') {
    const item = await claimPhotographyPackImport(value('--import'));
    print(
      json ? presentPackImport(item) : `已领取 ${item.id}，类型：pack_parse`,
      json,
    );
  } else if (command === 'apply-pack-draft') {
    const payload = await jsonInput();
    const item = await applyPhotographyPackDraft(
      value('--import'),
      payload.draft || payload,
    );
    print(json ? item : `已写回摄影方案包草稿：${item.draft.name}`, json);
  } else if (command === 'fail-pack-import') {
    const message = value('--message');
    if (!message) throw new Error('--message 不能为空');
    const item = await failPhotographyPackImport(
      value('--import'),
      value('--type', 'execution'),
      message,
    );
    print(json ? item : `已记录摄影方案包解析失败：${item.error.message}`, json);
  } else if (command === 'save-full-prompt') {
    print(await saveFullPrompt(await jsonInput()), true);
  } else if (command === 'apply-full-prompt-adaptation') {
    const job = await applyFullPromptAdaptation(value('--job'), await jsonInput());
    print(json ? presentJob(job) : `完整 Prompt 适配草稿已写回 ${job.id}`, json);
  } else if (command === 'claim-series-plan') {
    const job = await claimJob(value('--job'), 'series_deconstruct');
    print(json ? presentJob(job) : `已领取 ${job.id}，类型：series_deconstruct`, json);
  } else if (command === 'apply-series-plan-draft') {
    const payload = await jsonInput();
    const job = await applySeriesPlanDraft(value('--job'), payload.draft || payload);
    print(json ? presentJob(job) : `系列写真企划草稿已写回 ${job.id}`, json);
  } else if (command === 'fail-series-plan') {
    const message = value('--message');
    if (!message) throw new Error('--message 不能为空');
    const job = await failJob(value('--job'), value('--type', 'execution'), message);
    print(json ? presentJob(job) : `已记录系列写真解析失败：${message}`, json);
  } else if (command === 'attach-reshoot-output') {
    const job = await attachReshootOutput(
      value('--job'),
      value('--variant'),
      value('--path'),
    );
    print(json ? job : `重拍图片已归档：${value('--variant')}`, json);
  } else if (command === 'apply-reshoot-quality') {
    const payload = await jsonInput();
    const job = await applyReshootQuality(
      value('--job'),
      value('--variant'),
      payload.qualityReview || payload,
    );
    print(json ? presentJob(job) : `重拍质量检查已写回：${value('--variant')}`, json);
  } else if (command === 'fail-reshoot-variant') {
    const message = value('--message');
    if (!message) throw new Error('--message 不能为空');
    const job = await failReshootVariant(
      value('--job'),
      value('--variant'),
      value('--type', 'imagegen'),
      message,
    );
    print(json ? job : `已记录单张重拍失败：${value('--variant')}`, json);
  } else if (command === 'show-prompt') {
    print(presentPromptImport(await getPromptImport(value('--inbox'))), true);
  } else if (command === 'show') {
    const job = await getJob(value('--job'));
    print(presentJob(job), true);
  } else if (command === 'show-pack') {
    print(presentPackImport(await getPhotographyPackImport(value('--import'))), true);
  } else {
    print(usage());
    process.exitCode = command ? 1 : 0;
  }
}

try {
  const command = process.argv[2];
  if (/^(claim|apply-|attach-|fail)/.test(command || '')) {
    const type = /creation/.test(command) ? 'prompt_creation' : command === 'apply-full-prompt-adaptation' ? 'job' : /prompt/.test(command) ? 'prompt_import' : /pack/.test(command) ? 'pack_import' : 'job';
    await withExecutionIdentity({
      type, id: value(type === 'prompt_creation' ? '--creation' : type === 'job' ? '--job' : type === 'prompt_import' ? '--inbox' : '--import'),
      runId: value('--run'), quality: command === 'apply-reshoot-quality',
    }, main);
  } else await main();
} catch (error) {
  process.stderr.write(`ai-cosctl: ${error.message}\n`);
  process.exitCode = 1;
}
