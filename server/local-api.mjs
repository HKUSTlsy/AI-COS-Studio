import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLocalSecurity } from './local-security.mjs';
import { IMAGE_PROMPT_GUIDE_VERSION } from '../lib/image-output-policy.mjs';
import { createPromptCreation, getPromptCreation, editCreationDrafts, reviseCreation, confirmCreationGeneration, importCreationOutputs, finishPromptCreationRun, vscCapabilities } from './prompt-creation.mjs';

import { createBridgeWorker } from './codex-bridge.mjs';
import {
  DATA_ROOT,
  saveFullPrompt, createFullPromptReshoot, editFullPromptAdaptation,
  applyReshootQuality,
  applyPromptInbox,
  confirmPromptImport,
  confirmPhotographyPackImport,
  confirmReshootDraft,
  configureAndConfirmJob,
  configureAndQueueBaseline,
  createAdjustment,
  createFace,
  createJob,
  createPromptInbox,
  createPromptImport,
  createPromptModule,
  createPhotographyPackImport,
  createReshootDraft,
  createMultiPersonDraft,
  createSeriesPlanReshoot,
  createRefinement,
  cancelWebHandoff,
  ensureDataRoot,
  getBootstrap,
  getJob,
  getWebHandoff,
  importWebHandoffOutput,
  importWebHandoffOutputs,
  revealWebHandoffAssets,
  requestAnalysis,
  resolveUnder,
  retryRun,
  saveCharacterCard,
  setSelectedOutput,
  rerollReshootDraft,
  recompileSeriesPlan,
  updatePhotographyPack,
  updatePhotographyPackImportDraft,
  updatePromptImportDrafts,
  updateReshootDraft,
  updateSeriesPlanDraft,
  compileSeriesPlan,
  updateReferences,
  discardReshootDraft, recoverReshootVariants, findExecutionRun, interruptTaskRun,
  updateFace, archiveMaterial, updateOutputMetadata, createLocalBackup,
} from './store.mjs';

const HOST = process.env.AI_COS_API_HOST || '127.0.0.1';
if (HOST !== '127.0.0.1') throw new Error('AI COS 只允许绑定 127.0.0.1');
const PORT = Number(process.env.AI_COS_API_PORT || 4318);
const security = createLocalSecurity(PORT);
const JSON_LIMIT = 225 * 1024 * 1024;
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

function corsHeaders(origin) {
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
    origin || '',
  )
    ? origin
    : `http://${HOST}:4317`;
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,x-ai-cos-token',
    vary: 'Origin',
  };
}

function send(res, status, body, origin, extra = {}) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(origin),
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(payload);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error('请求体超过 225 MB');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求 JSON 无效');
  }
}

async function serveAsset(res, pathname, origin) {
  const relative = decodeURIComponent(pathname.replace(/^\/assets\//, ''));
  const file = resolveUnder(DATA_ROOT, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('资源不存在');
  const extension = path.extname(file).toLowerCase();
  const data = await fs.readFile(file);
  res.writeHead(200, {
    ...corsHeaders(origin),
    'content-type': MIME_BY_EXTENSION[extension] || 'application/octet-stream',
    'content-length': data.length,
    'cache-control': 'private, max-age=60',
  });
  res.end(data);
}

function routeId(pathname, suffix = '') {
  const pattern = suffix
    ? new RegExp(`^/api/jobs/([^/]+)/${suffix}$`)
    : /^\/api\/jobs\/([^/]+)$/;
  return pathname.match(pattern)?.[1] || null;
}

function runRouteId(pathname, suffix) {
  return pathname.match(new RegExp(`^/api/runs/([^/]+)/${suffix}$`))?.[1] || null;
}

await ensureDataRoot();
const bridgeWorker = createBridgeWorker();
void bridgeWorker.start();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const denied = security.validate(req);
  if (denied) return send(res, 403, { error: denied }, origin);
  if (req.method === 'OPTIONS') return send(res, 204, null, origin);
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/session')
      return send(res, 200, { token: security.token }, origin);
    if (req.method === 'GET' && url.pathname === '/health')
      return send(
        res,
        200,
        {
          ok: true,
          service: 'ai-cos-local-api',
          promptGuideVersion: IMAGE_PROMPT_GUIDE_VERSION,
          outputResolutionControl: 'prompt_only',
          completePrompt: { enabled: true, rawSave: true, reviewedAdaptation: true },
          multiPerson: { enabled: true, minParticipants: 2, maxParticipants: 4, imagesPerRun: 1 },
          bridge: await bridgeWorker.health(),
        },
        origin,
      );
    if (req.method === 'GET' && url.pathname === '/api/bridge/health')
      return send(res, 200, await bridgeWorker.health(), origin);
    if (req.method === 'GET' && url.pathname === '/api/vsc/capabilities') return send(res, 200, await vscCapabilities(), origin);
    const creationRoute = url.pathname.match(/^\/api\/prompt-creations\/([^/]+)(?:\/(drafts|revise|generate|import-outputs|reveal-assets))?$/);
    if (req.method === 'GET' && creationRoute && !creationRoute[2]) return send(res, 200, await getPromptCreation(creationRoute[1]), origin);
    if (req.method === 'GET' && url.pathname === '/api/bootstrap')
      return send(
        res,
        200,
        { ...(await getBootstrap()), bridge: await bridgeWorker.health() },
        origin,
      );
    const jobId = routeId(url.pathname);
    if (req.method === 'GET' && jobId)
      return send(res, 200, await getJob(jobId), origin);
    if (req.method === 'GET' && url.pathname.startsWith('/assets/'))
      return await serveAsset(res, url.pathname, origin);

    const handoffId = runRouteId(url.pathname, 'handoff');
    if (req.method === 'GET' && handoffId)
      return send(res, 200, await getWebHandoff(handoffId), origin);

    const body = await readBody(req);
    if (req.method === 'POST' && url.pathname === '/api/prompt-creations') return send(res, 201, await createPromptCreation(body), origin);
    if (creationRoute) {
      const id = creationRoute[1], action = creationRoute[2];
      if (req.method === 'PATCH' && action === 'drafts') return send(res, 200, await editCreationDrafts(id, body), origin);
      if (req.method === 'POST' && action === 'revise') return send(res, 200, await reviseCreation(id, body), origin);
      if (req.method === 'POST' && action === 'generate') return send(res, 201, await confirmCreationGeneration(id, body), origin);
      if (req.method === 'POST' && action === 'import-outputs') return send(res, 200, await importCreationOutputs(id, body.runId, body.outputs, body.finishPartial === true), origin);
      if (req.method === 'POST' && action === 'reveal-assets') {
        const item = await getPromptCreation(id);
        const run = item.executionRuns.find((entry) => entry.id === body.runId);
        if (!run?.handoff || run.status !== 'waiting_user') throw new Error('网页交接已失效');
        const { execFile } = await import('node:child_process');
        const directory = path.join('jobs', item.id, 'handoffs', run.id);
        if (directory !== run.handoff.directory) throw new Error('交接目录不匹配');
        await new Promise((resolve, reject) => execFile('open', [resolveUnder(DATA_ROOT, directory)], (error) => error ? reject(error) : resolve()));
        return send(res, 200, { ok: true }, origin);
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/full-prompts') return send(res, 201, await saveFullPrompt(body), origin);
    const fullPromptJob = routeId(url.pathname, 'reshoots/full-prompt');
    if (req.method === 'POST' && fullPromptJob) return send(res, 201, await createFullPromptReshoot(fullPromptJob, body), origin);
    const adaptation = url.pathname.match(/^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/adaptation(\/confirm)?$/);
    if (adaptation && ((req.method === 'PATCH' && !adaptation[3]) || (req.method === 'POST' && adaptation[3]))) return send(res, 200, await editFullPromptAdaptation(adaptation[1], adaptation[2], body, Boolean(adaptation[3])), origin);
    const faceEdit = url.pathname.match(/^\/api\/faces\/([^/]+)$/);
    if (req.method === 'PATCH' && faceEdit) return send(res, 200, await updateFace(faceEdit[1], body), origin);
    const archive = url.pathname.match(/^\/api\/materials\/(face|prompt|pack)\/([^/]+)\/archive$/);
    if (req.method === 'POST' && archive) return send(res, 200, await archiveMaterial(archive[1], archive[2], body.archived), origin);
    const outputMeta = routeId(url.pathname, 'output-metadata');
    if (req.method === 'PATCH' && outputMeta) return send(res, 200, await updateOutputMetadata(outputMeta, body), origin);
    if (req.method === 'POST' && url.pathname === '/api/backups') return send(res, 201, await createLocalBackup(body.jobId || null), origin);
    const discard = url.pathname.match(/^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/(discard|back-to-plan|recover)$/);
    if (req.method === 'POST' && discard) return send(res, 200,
      discard[3] === 'recover' ? await recoverReshootVariants(discard[1], discard[2], body.variantIds)
        : await discardReshootDraft(discard[1], discard[2], discard[3] === 'back-to-plan'), origin);
    const cancelRunId = runRouteId(url.pathname, 'cancel');
    if (req.method === 'POST' && cancelRunId) {
      const { type, target, run } = await findExecutionRun(cancelRunId);
      if (type === 'prompt_creation' && run.status === 'waiting_user') return send(res, 200, await finishPromptCreationRun(target.id, run.id, 'interrupted', '用户取消了网页交接；历史和素材已保留'), origin);
      if (run.status === 'waiting_user') return send(res, 200, await cancelWebHandoff(cancelRunId), origin);
      if (!['queued', 'running'].includes(run.status)) return send(res, 200, target, origin);
      if (bridgeWorker.bridge.active?.runId === cancelRunId) await bridgeWorker.bridge.interruptActiveRun(cancelRunId);
      else await interruptTaskRun(type, target.id, cancelRunId, '用户取消了本次执行，输入和历史已保留');
      return send(res, 200, (await findExecutionRun(cancelRunId)).target, origin);
    }
    if (req.method === 'POST' && url.pathname === '/api/faces')
      return send(res, 201, await createFace(body), origin);
    if (req.method === 'POST' && url.pathname === '/api/prompts')
      return send(res, 201, await createPromptModule(body), origin);
    if (req.method === 'POST' && url.pathname === '/api/prompts/inbox')
      return send(res, 201, await createPromptInbox(body), origin);
    if (req.method === 'POST' && url.pathname === '/api/prompts/imports')
      return send(res, 201, await createPromptImport(body), origin);
    if (req.method === 'POST' && url.pathname === '/api/photography-packs/imports')
      return send(res, 201, await createPhotographyPackImport(body), origin);
    const packImportDraftId = url.pathname.match(
      /^\/api\/photography-packs\/imports\/([^/]+)\/draft$/,
    )?.[1];
    if (req.method === 'PATCH' && packImportDraftId)
      return send(
        res,
        200,
        await updatePhotographyPackImportDraft(packImportDraftId, body.draft || body),
        origin,
      );
    const packImportConfirmId = url.pathname.match(
      /^\/api\/photography-packs\/imports\/([^/]+)\/confirm$/,
    )?.[1];
    if (req.method === 'POST' && packImportConfirmId)
      return send(
        res,
        200,
        await confirmPhotographyPackImport(packImportConfirmId),
        origin,
      );
    const packId = url.pathname.match(/^\/api\/photography-packs\/([^/]+)$/)?.[1];
    if (req.method === 'PATCH' && packId)
      return send(res, 200, await updatePhotographyPack(packId, body), origin);
    const promptDraftsId = url.pathname.match(
      /^\/api\/prompts\/imports\/([^/]+)\/drafts$/,
    )?.[1];
    if (req.method === 'PATCH' && promptDraftsId)
      return send(
        res,
        200,
        await updatePromptImportDrafts(promptDraftsId, body.drafts || []),
        origin,
      );
    const promptConfirmId = url.pathname.match(
      /^\/api\/prompts\/imports\/([^/]+)\/confirm$/,
    )?.[1];
    if (req.method === 'POST' && promptConfirmId)
      return send(
        res,
        200,
        await confirmPromptImport(promptConfirmId),
        origin,
      );
    if (
      req.method === 'POST' &&
      /^\/api\/prompts\/inbox\/[^/]+\/apply$/.test(url.pathname)
    ) {
      const id = url.pathname.split('/')[4];
      return send(
        res,
        200,
        await applyPromptInbox(id, body.modules || []),
        origin,
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs')
      return send(res, 201, await createJob(body), origin);

    const referencesId = routeId(url.pathname, 'references');
    if (req.method === 'PATCH' && referencesId)
      return send(res, 200, await updateReferences(referencesId, body), origin);
    const characterCardId = routeId(url.pathname, 'character-card');
    if (req.method === 'PATCH' && characterCardId)
      return send(
        res,
        200,
        await saveCharacterCard(characterCardId, body.characterCard || body),
        origin,
      );
    const baselineId = routeId(url.pathname, 'generate-baseline');
    if (req.method === 'POST' && baselineId)
      return send(
        res,
        200,
        await configureAndQueueBaseline(baselineId, body),
        origin,
      );
    const adjustmentsId = routeId(url.pathname, 'adjustments');
    if (req.method === 'POST' && adjustmentsId)
      return send(
        res,
        200,
        await createAdjustment(adjustmentsId, body),
        origin,
      );
    const reshootDraftId = routeId(url.pathname, 'reshoots/draft');
    if (req.method === 'POST' && reshootDraftId)
      return send(res, 201, await createReshootDraft(reshootDraftId, body), origin);
    const multiPersonId = routeId(url.pathname, 'reshoots/multi-person');
    if (req.method === 'POST' && multiPersonId)
      return send(res, 201, await createMultiPersonDraft(multiPersonId, body), origin);
    const seriesPlanId = routeId(url.pathname, 'reshoots/series-plan');
    if (req.method === 'POST' && seriesPlanId)
      return send(res, 201, await createSeriesPlanReshoot(seriesPlanId, body), origin);
    const seriesPlanRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/series-plan$/,
    );
    if (req.method === 'PATCH' && seriesPlanRoute)
      return send(
        res,
        200,
        await updateSeriesPlanDraft(seriesPlanRoute[1], seriesPlanRoute[2], body.draft || body),
        origin,
      );
    const seriesCompileRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/compile$/,
    );
    if (req.method === 'POST' && seriesCompileRoute)
      return send(
        res,
        200,
        await compileSeriesPlan(seriesCompileRoute[1], seriesCompileRoute[2]),
        origin,
      );
    const seriesRecompileRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/recompile$/,
    );
    if (req.method === 'POST' && seriesRecompileRoute)
      return send(
        res,
        200,
        await recompileSeriesPlan(seriesRecompileRoute[1], seriesRecompileRoute[2], body),
        origin,
      );
    const qualityRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/variants\/([^/]+)\/quality$/,
    );
    if (req.method === 'PATCH' && qualityRoute)
      return send(
        res,
        200,
        await applyReshootQuality(qualityRoute[1], qualityRoute[3], body, {
          userFinal: body.confirmFinal === true,
          batchId: qualityRoute[2],
        }),
        origin,
      );
    const reshootDraftRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/draft$/,
    );
    if (req.method === 'PATCH' && reshootDraftRoute)
      return send(
        res,
        200,
        await updateReshootDraft(reshootDraftRoute[1], reshootDraftRoute[2], body),
        origin,
      );
    const reshootRerollRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/reroll$/,
    );
    if (req.method === 'POST' && reshootRerollRoute)
      return send(
        res,
        200,
        await rerollReshootDraft(reshootRerollRoute[1], reshootRerollRoute[2], body),
        origin,
      );
    const reshootConfirmRoute = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/reshoots\/([^/]+)\/confirm$/,
    );
    if (req.method === 'POST' && reshootConfirmRoute)
      return send(
        res,
        200,
        await confirmReshootDraft(reshootConfirmRoute[1], reshootConfirmRoute[2], body),
        origin,
      );
    const selectedOutputId = routeId(url.pathname, 'select-output');
    if (req.method === 'POST' && selectedOutputId)
      return send(
        res,
        200,
        await setSelectedOutput(selectedOutputId, body.outputId),
        origin,
      );
    const retryId = url.pathname.match(/^\/api\/runs\/([^/]+)\/retry$/)?.[1];
    if (req.method === 'POST' && retryId)
      return send(res, 200, await retryRun(retryId), origin);
    const revealHandoffId = runRouteId(url.pathname, 'reveal-assets');
    if (req.method === 'POST' && revealHandoffId)
      return send(
        res,
        200,
        await revealWebHandoffAssets(revealHandoffId),
        origin,
      );
    const importHandoffId = runRouteId(url.pathname, 'import-output');
    if (req.method === 'POST' && importHandoffId)
      return send(
        res,
        200,
        await importWebHandoffOutput(importHandoffId, body.outputDataUrl),
        origin,
      );
    const importHandoffOutputsId = runRouteId(url.pathname, 'import-outputs');
    if (req.method === 'POST' && importHandoffOutputsId)
      return send(
        res,
        200,
        await importWebHandoffOutputs(
          importHandoffOutputsId,
          body.outputs || [],
          body.finishPartial === true,
        ),
        origin,
      );
    const cancelHandoffId = runRouteId(url.pathname, 'cancel');
    if (req.method === 'POST' && cancelHandoffId)
      return send(res, 200, await cancelWebHandoff(cancelHandoffId), origin);

    // Compatibility routes for v1 clients.
    const analysisId = routeId(url.pathname, 'request-analysis');
    if (req.method === 'POST' && analysisId)
      return send(res, 200, await requestAnalysis(analysisId), origin);
    const confirmId = routeId(url.pathname, 'confirm');
    if (req.method === 'POST' && confirmId)
      return send(
        res,
        200,
        await configureAndConfirmJob(confirmId, body),
        origin,
      );
    const refinementId = routeId(url.pathname, 'refinement');
    if (req.method === 'POST' && refinementId)
      return send(res, 200, await createRefinement(refinementId, body), origin);
    return send(res, 404, { error: '未找到接口' }, origin);
  } catch (error) {
    const code = error.code === 'ENOENT' ? 404 : 400;
    return send(res, code, { error: error.message || '请求失败' }, origin);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`AI COS local API: http://${HOST}:${PORT}\n`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await bridgeWorker.stop();
    server.close(() => process.exit(0));
  });
}
