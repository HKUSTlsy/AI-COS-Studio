import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { createLocalSecurity } from '../server/local-security.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-regressions-'));
process.env.AI_COS_DATA_DIR = testRoot;
const domain = await import(pathToFileURL(path.join(project, 'server/domain.mjs')));
const store = await import(pathToFileURL(path.join(project, 'server/store.mjs')));
test.after(async () => fs.rm(testRoot, { recursive: true, force: true }));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function validPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 100, 150, 200, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const png = validPng();
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const originalCard = Object.fromEntries([
  'hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette',
  'outfitLayers', 'colors', 'materials', 'accessories', 'footwear',
].map((key) => [key, {
  value: `ORIGINAL_${key}_TOKEN`, certainty: 'observed', strongLock: true,
}]));

void test('本地 API 拒绝外站写入、伪造 Host、缺失令牌和 text/plain', () => {
  const guard = createLocalSecurity();
  const req = { method: 'POST', headers: { host: '127.0.0.1:4318', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json', 'x-ai-cos-token': guard.token } };
  assert.equal(guard.validate(req), null);
  for (const changes of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, { 'content-type': 'text/plain' }, { 'x-ai-cos-token': 'wrong' }])
    assert.ok(guard.validate({ ...req, headers: { ...req.headers, ...changes } }));
});

void test('取消旧 run 后迟到的领取、写回和失败不能影响新 run', async () => {
  const job = await configuredJob();
  const oldRun = job.activeRunId;
  await store.withExecutionIdentity({ type: 'job', id: job.id, runId: oldRun }, () => store.claimJob(job.id, 'baseline'));
  await store.interruptRun(job.id, oldRun, 'cancelled');
  const retried = await store.retryRun(oldRun);
  const currentRun = retried.activeRunId;
  await store.withExecutionIdentity({ type: 'job', id: job.id, runId: currentRun }, () => store.claimJob(job.id, 'baseline'));
  const stale = (fn) => store.withExecutionIdentity({ type: 'job', id: job.id, runId: oldRun }, fn);
  await assert.rejects(() => stale(() => store.claimJob(job.id, 'baseline')), /过期|替换/);
  await assert.rejects(() => stale(() => store.failJob(job.id, 'old_failure', 'old')), /过期|替换/);
  const source = path.join(testRoot, 'late-output.png');
  await fs.writeFile(source, png);
  await assert.rejects(() => stale(() => store.attachOutput(job.id, source, 'baseline')), /过期|替换/);
  const current = await store.getJob(job.id);
  assert.equal(current.activeRunId, currentRun);
  assert.equal(current.baselineVersions.length, 0);
  assert.equal(current.executionRuns.at(-1).status, 'running');
});

void test('摄影素材版本与归档不删除旧素材，作品封面不改变源版本，导出包含记录', async () => {
  const face = await store.createFace({ name: 'A', sourceType: 'preset', authorizationConfirmed: true, images: [{ angle: 'front', dataUrl }] });
  const updated = await store.updateFace(face.id, { name: 'B', authorizationConfirmed: true, images: [] });
  assert.equal(updated.versions[0].name, 'A');
  assert.equal(updated.images[0].path, face.images[0].path);
  await store.archiveMaterial('face', face.id, true);
  assert.ok((await store.getBootstrap()).faces.find((item) => item.id === face.id).archivedAt);
  const { job } = await baselineJob();
  const changed = await store.updateOutputMetadata(job.id, { outputId: job.selectedOutputId, favorite: true, cover: true });
  assert.equal(changed.selectedOutputId, job.selectedOutputId);
  assert.equal(changed.coverOutputId, job.selectedOutputId);
  const exported = await store.createLocalBackup(job.id);
  assert.ok((await fs.stat(path.join(testRoot, exported.path))).size > 0);
  await assert.rejects(() => store.createFace({ name: 'Unauthorized preset', sourceType: 'preset', images: [{ angle: 'front', dataUrl }] }), /授权/);
});

void test('系列草稿可返回企划重新编译，失败分镜恢复为新草稿且不生图', async () => {
  const { job, batch } = await compiledSeries();
  await store.discardReshootDraft(job.id, batch.id, true);
  const plan = structuredClone(batch.seriesPlanDraft);
  plan.shots[0].subjectEvent = 'NEW_RECOMPILED_EVENT';
  await store.updateSeriesPlanDraft(job.id, batch.id, plan);
  const compiled = await store.compileSeriesPlan(job.id, batch.id);
  assert.match(compiled.reshootBatches.at(-1).variants[0].compiledPrompt, /NEW_RECOMPILED_EVENT/);
  await store.confirmReshootDraft(job.id, batch.id, { backend: 'built-in-imagegen' });
  await store.claimJob(job.id, 'reshoot');
  for (const variant of batch.variants) await store.failReshootVariant(job.id, variant.id, 'test', 'Synthetic failure');
  const recovered = await store.recoverReshootVariants(job.id, batch.id, [batch.variants[0].id]);
  assert.equal(recovered.activeRunId, null);
  assert.equal(recovered.reshootBatches.at(-1).status, 'draft');
  assert.notEqual(recovered.reshootBatches.at(-1).variants[0].id, batch.variants[0].id);
  assert.equal(recovered.reshootBatches.at(-1).sourceOutputId, batch.sourceOutputId);
});

async function configuredJob() {
  const job = await store.createJob({ title: 'Isolated regression', mainReference: { dataUrl } });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, originalCard);
  await store.saveCharacterCard(job.id, originalCard);
  const style = (await store.getBootstrap()).prompts.find((item) => item.category === 'style');
  return store.configureAndQueueBaseline(job.id, { styleModuleId: style.id });
}

async function baselineJob() {
  const job = await configuredJob();
  await store.claimJob(job.id, 'baseline');
  const source = path.join(testRoot, `${job.id}-fixture.png`);
  await fs.writeFile(source, png);
  const generated = await store.attachOutput(job.id, source, 'baseline');
  const accepted = await store.updateOutputMetadata(job.id, { outputId: generated.selectedOutputId, faceReview: { status: 'accepted', checks: { identity: true, anatomy: true, texture: true } } });
  return { job: accepted, source };
}

async function makePack(kind = 'variable_pool') {
  const common = {
    name: 'Regression pack', kind, description: 'synthetic fixture',
    globalStyle: 'natural documentary photography', avoid: ['identity drift'],
    excludedDefaults: ['reference identity'], tags: ['test'],
  };
  const draft = kind === 'variable_pool' ? {
    ...common,
    pools: Object.fromEntries(domain.PHOTOGRAPHY_POOL_KEYS.map((key) => [key, [`${key} A`, `${key} B`, `${key} C`]])),
  } : {
    ...common,
    seriesDNA: Object.fromEntries(['themeFramework', 'editorialTone', 'makeupSystem', 'hairSystem', 'outfitSystem', 'sceneSystem', 'propSystem'].map((key) => [key, `${key} rules`])),
    imagingProfile: Object.fromEntries(['whiteBalance', 'colorCast', 'blackPoint', 'highlightRollOff', 'sharpness', 'microContrast', 'softening', 'noiseCompression', 'depthOfField'].map((key) => [key, `${key} rules`])),
    visualHierarchy: Object.fromEntries(['subjectClarity', 'dominantShapes', 'secondaryDetails', 'lowDetailSpace'].map((key) => [key, `${key} rules`])),
    workflowRules: Object.fromEntries(['referenceAssignment', 'lightingTopology', 'subjectEventCausality', 'storyboardDiversity', 'antiCommercialPolish', 'redoPolicy'].map((key) => [key, `${key} rules`])),
    qualityGates: domain.SERIES_QUALITY_AXES.map((key) => domain.SERIES_QUALITY_LABELS[key]),
  };
  const item = await store.createPhotographyPackImport({ title: 'Regression import', packKind: kind, rawText: 'Synthetic method fixture' });
  await store.claimPhotographyPackImport(item.id);
  await store.applyPhotographyPackDraft(item.id, draft);
  return (await store.confirmPhotographyPackImport(item.id)).pack;
}

void test('面部验收持久化、冻结阶段保护及修正入口；确认批次时再次检查', async () => {
  const { job, source } = await baselineJob();
  const output = job.baselineVersions[0];
  const original = structuredClone(output);
  const checks = { identity: true, anatomy: true, texture: true };
  await store.updateOutputMetadata(job.id, { outputId: output.id, faceReview: { status: 'pending' }, adopted: true });
  await assert.rejects(() => store.updateOutputMetadata(job.id, { outputId: output.id, faceReview: { status: 'accepted', checks: { identity: true } } }), /分别确认/);
  await assert.rejects(() => store.updateOutputMetadata(job.id, { outputId: 'foreign', faceReview: { status: 'accepted', checks } }), /输出不存在/);
  const pack = await makePack();
  await assert.rejects(() => store.createReshootDraft(job.id, { sourceOutputId: output.id, packId: pack.id }), /人工验收/);
  await assert.rejects(() => store.createSeriesPlanReshoot(job.id, { sourceOutputId: output.id }), /人工验收/);
  // Pending or rejected baseline must remain available for an explicit repair.
  await store.createAdjustment(job.id, { sourceOutputId: output.id, category: 'makeup', request: '减轻面部磨皮' });
  await assert.rejects(() => store.updateOutputMetadata(job.id, { outputId: output.id, faceReview: { status: 'accepted', checks } }), /完成或取消/);
  await store.claimJob(job.id, 'adjustment');
  const repaired = await store.attachOutput(job.id, source, 'adjustment');
  const child = repaired.adjustmentVersions.at(-1);
  await store.updateOutputMetadata(job.id, { outputId: child.id, faceReview: { status: 'accepted', checks, note: 'Synthetic acceptance' } });
  const drafted = await store.createReshootDraft(job.id, { sourceOutputId: child.id, packId: pack.id });
  await store.updateOutputMetadata(job.id, { outputId: child.id, faceReview: { status: 'rejected', note: 'Synthetic recheck' } });
  await assert.rejects(() => store.confirmReshootDraft(job.id, drafted.activeReshootBatchId, { backend: 'chatgpt-web-manual' }), /人工验收/);
  const saved = await store.getJob(job.id);
  assert.equal(saved.activeRunId, null);
  assert.equal(saved.outputAnnotations[child.id].faceReviewHistory.length, 2);
  assert.equal(saved.outputAnnotations[child.id].faceReview.status, 'rejected');
  assert.equal(saved.outputAnnotations[output.id].adopted, true);
  assert.deepEqual(saved.baselineVersions[0], original);
});

async function preparedWebBatch() {
  const { job } = await baselineJob();
  const pack = await makePack();
  const drafted = await store.createReshootDraft(job.id, { sourceOutputId: job.selectedOutputId, packId: pack.id, quantity: 2 });
  const batch = drafted.reshootBatches.at(-1);
  const prepared = await store.confirmReshootDraft(job.id, batch.id, { backend: 'chatgpt-web-manual' });
  return { job: prepared, batch, run: prepared.executionRuns.at(-1) };
}

function seriesPlan() {
  return {
    commonPackage: { theme: 'Quiet room', editorialTone: 'natural', makeupHair: 'locked', wardrobe: 'locked', sceneProps: 'window and chair' },
    imagingProfile: 'soft highlights and natural noise', visualHierarchy: 'face, window frame, low-detail wall',
    lightingSetups: [{ id: 'light-01', name: 'window', referenceIds: ['photo-ref-01', 'photo-ref-02'], description: 'left window key', topology: 'world-space left key' }],
    excludedReferenceIds: ['photo-ref-03'],
    shots: [
      { id: 'shot-01', title: 'Main B', mainReferenceId: 'photo-ref-02', auxiliaryReferenceIds: ['photo-ref-01'], lightingSetupId: 'light-01', shotScale: 'medium', camera: 'eye level', composition: 'off center', subjectEvent: 'turning', expressionResponse: 'attentive gaze', poseGazeProps: 'hand on chair', lightingPrediction: 'left cheek illuminated', customPrompt: '' },
      { id: 'shot-02', title: 'Main A', mainReferenceId: 'photo-ref-01', auxiliaryReferenceIds: [], lightingSetupId: 'light-01', shotScale: 'full body', camera: 'low angle', composition: 'diagonal', subjectEvent: 'standing up', expressionResponse: 'curious gaze', poseGazeProps: 'looking at window', lightingPrediction: 'left side brighter', customPrompt: '' },
    ],
  };
}

async function compiledSeries() {
  const { job, source } = await baselineJob();
  const pack = await makePack('series_plan');
  const queued = await store.createSeriesPlanReshoot(job.id, {
    sourceOutputId: job.selectedOutputId, packId: pack.id, quantity: 2,
    photographyReferences: ['REFERENCE_A', 'REFERENCE_B', 'EXCLUDED_C'].map((name) => ({ name, dataUrl })),
  });
  await store.claimJob(job.id, 'series_deconstruct');
  await store.applySeriesPlanDraft(job.id, seriesPlan());
  const compiled = await store.compileSeriesPlan(job.id, queued.reshootBatches.at(-1).id);
  return { job: compiled, source, batch: compiled.reshootBatches.at(-1) };
}

void test('完整图片解码：有合法签名的损坏 PNG/JPEG/WEBP 不能创建任务', async () => {
  const before = (await store.getBootstrap()).jobs.length;
  const malformed = [
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', Buffer.from([255, 216, 255, 217])],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ];
  for (const [mime, buffer] of malformed) {
    await assert.rejects(() => store.createJob({ mainReference: { dataUrl: `data:${String(mime)};base64,${buffer.toString('base64')}` } }), /图片|损坏|解码|无效/);
  }
  assert.equal((await store.getBootstrap()).jobs.length, before);
});

void test('网页批量导回原子性：后一个坏图不能留下前一个输出，修正后可再次导入', async () => {
  const { job, batch, run } = await preparedWebBatch();
  const outputDir = path.join(testRoot, 'outputs', job.id);
  const filesBefore = (await fs.readdir(outputDir)).sort();
  const makeInputs = (second) => batch.variants.map((variant, index) => ({ variantId: variant.id, outputDataUrl: index ? second : dataUrl }));
  await assert.rejects(() => store.importWebHandoffOutputs(run.id, makeInputs('data:image/png;base64,ZmFrZQ==')));
  assert.deepEqual((await fs.readdir(outputDir)).sort(), filesBefore, '事务失败不能留下未登记的 reshoot 文件');
  const unchanged = await store.getJob(job.id);
  assert.equal(unchanged.reshootVersions.length, 0);
  assert.equal(unchanged.executionRuns.at(-1).status, 'waiting_user');
  const imported = await store.importWebHandoffOutputs(run.id, makeInputs(dataUrl));
  assert.equal(imported.reshootVersions.length, 2);
  assert.deepEqual(imported.reshootVersions.map((output) => output.fileName), ['reshoot-v001.png', 'reshoot-v002.png']);
});

void test('网页导回在落盘前拒绝重复或外部 variant，不损坏待交接任务', async () => {
  const { job, batch, run } = await preparedWebBatch();
  const outputDir = path.join(testRoot, 'outputs', job.id);
  const before = (await fs.readdir(outputDir)).sort();
  const known = { variantId: batch.variants[0].id, outputDataUrl: dataUrl };
  await assert.rejects(() => store.importWebHandoffOutputs(run.id, [known, known]), /重复/);
  await assert.rejects(() => store.importWebHandoffOutputs(run.id, [known, { variantId: 'foreign-variant', outputDataUrl: dataUrl }]), /不匹配/);
  assert.deepEqual((await fs.readdir(outputDir)).sort(), before);
  assert.equal((await store.getJob(job.id)).activeRunId, run.id);
});

void test('连续调整保留已采用妆容，旧分支不借用当前编辑器的新瞳色', async () => {
  const { job, source } = await baselineJob();
  await store.createAdjustment(job.id, { category: 'makeup', request: 'NEW_ACCEPTED_MAKEUP', sourceOutputId: job.selectedOutputId });
  await store.claimJob(job.id, 'adjustment');
  const madeUp = await store.attachOutput(job.id, source, 'adjustment');
  const changed = structuredClone(originalCard);
  changed.iris.value = 'NEW_EDITOR_IRIS_TOKEN';
  await store.saveCharacterCard(job.id, changed);
  const next = await store.createAdjustment(job.id, { category: 'pose', request: 'Turn left', sourceOutputId: madeUp.selectedOutputId });
  assert.doesNotMatch(next.compiledAdjustmentPrompt, /ORIGINAL_makeup_TOKEN/, '不得恢复调整前的妆容');
  assert.doesNotMatch(next.compiledAdjustmentPrompt, /NEW_EDITOR_IRIS_TOKEN/, '旧分支不得混入最新角色卡');
  assert.match(next.compiledAdjustmentPrompt, /ORIGINAL_iris_TOKEN/);
});

void test('调整 Prompt 编号与干净源图、标注、部位参考和角色参考的真实输入位置一致', async () => {
  const { job } = await baselineJob();
  const prepared = await store.createAdjustment(job.id, {
    category: 'background', request: 'Only follow reference background',
    sourceOutputId: job.selectedOutputId, backend: 'chatgpt-web-manual',
    annotationDataUrl: dataUrl, adjustmentReferenceDataUrl: dataUrl,
  });
  const handoff = prepared.executionRuns.at(-1).handoff;
  assert.deepEqual(handoff.assets.slice(0, 4).map((asset) => asset.role), ['edit_source', 'annotation', 'adjustment_reference', 'character_main']);
  assert.match(handoff.prompt, /图\s*4[^\n]*character_main/);
  assert.doesNotMatch(handoff.prompt, /图\s*1[^\n]*character_main/);
  assert.doesNotMatch(handoff.prompt, /生成原创且不对应现实人物的面部/);
  assert.doesNotMatch(handoff.prompt, /不得从此图复制[^\n。]*背景/, '背景参考不能同时被禁止作为背景来源');
});

void test('原配置重试不能混用旧 Prompt 与新角色卡：拒绝输入变化或完整恢复原快照', async () => {
  const configured = await configuredJob();
  const originalVersion = configured.characterCardVersion;
  const originalPrompt = configured.compiledPrompt;
  await store.claimJob(configured.id, 'baseline');
  const failed = await store.failJob(configured.id, 'fixture_failure', 'Synthetic failure');
  const changed = structuredClone(originalCard);
  changed.iris.value = 'NEW_IRIS_TOKEN';
  await store.saveCharacterCard(configured.id, changed);
  let retried;
  try {
    retried = await store.retryRun(failed.executionRuns.at(-1).id);
  } catch (error) {
    assert.match(error.message, /输入|版本|配置|变化|改变|重新确认/);
    assert.equal((await store.getJob(configured.id)).activeRunId, null);
    return;
  }
  assert.equal(retried.compiledPrompt, originalPrompt);
  // Restoring a run-local snapshot is also valid; claim must present that snapshot.
  const claimed = await store.claimJob(configured.id, 'baseline');
  assert.equal(claimed.characterCard.iris.value, originalCard.iris.value);
  assert.equal(claimed.characterCardVersion, originalVersion);
});

void test('系列返工冻结原始角色设定，修改当前卡片后不能把新内容混入旧版本 Prompt', async () => {
  const { job, source, batch } = await compiledSeries();
  await store.confirmReshootDraft(job.id, batch.id, { backend: 'built-in-imagegen' });
  await store.claimJob(job.id, 'reshoot');
  await store.attachReshootOutput(job.id, batch.variants[0].id, source);
  const completed = await store.attachReshootOutput(job.id, batch.variants[1].id, source);
  const changed = structuredClone(originalCard);
  changed.iris.value = 'NEW_IRIS_TOKEN';
  await store.saveCharacterCard(job.id, changed);
  const redo = await store.recompileSeriesPlan(job.id, batch.id, {
    variantId: batch.variants[0].id,
    diagnosticOutputId: completed.reshootVersions[0].id,
    feedback: 'Preserve original directional window light',
  });
  const next = redo.reshootBatches.at(-1);
  assert.match(next.variants[0].compiledPrompt, /ORIGINAL_iris_TOKEN/);
  assert.doesNotMatch(next.variants[0].compiledPrompt, /NEW_IRIS_TOKEN/);
  assert.equal(next.characterCardVersion, batch.characterCardVersion);
  assert.equal(next.sourceOutputId, batch.sourceOutputId);
  assert.deepEqual(next.photographyReferences, batch.photographyReferences);
  const handed = await store.confirmReshootDraft(job.id, next.id, { backend: 'chatgpt-web-manual' });
  assert.ok(handed.executionRuns.at(-1).handoff.assets.every((asset) => asset.path !== completed.reshootVersions[0].path));
});

// Contract proposal: handoff.prompts[].orderedAssets must be the complete ordered
// list for that single prompt, while handoff.assets remains the shared file pool.
void test('系列网页交接逐分镜提供准确顺序，主辅助交换且离群图不进入上传清单', async () => {
  const { job, batch } = await compiledSeries();
  const handed = await store.confirmReshootDraft(job.id, batch.id, { backend: 'chatgpt-web-manual' });
  const handoff = handed.executionRuns.at(-1).handoff;
  for (const [index, variant] of batch.variants.entries()) {
    const slot = handoff.prompts.find((item) => item.variantId === variant.id);
    assert.ok(Array.isArray(slot.orderedAssets), '每条 Prompt 必须具有独立上传顺序');
    const ordered = slot.orderedAssets;
    assert.equal(ordered[0].role, 'edit_source');
    assert.equal(ordered[1].id || ordered[1].referenceId, variant.shotSpec.mainReferenceId);
    const photoIds = ordered.filter((asset) => ['photo_main', 'photo_auxiliary', 'photography_reference'].includes(asset.role)).map((asset) => asset.referenceId || asset.id);
    assert.deepEqual(photoIds, [variant.shotSpec.mainReferenceId, ...variant.shotSpec.auxiliaryReferenceIds]);
    assert.ok(!photoIds.includes('photo-ref-03'));
    assert.match(slot.prompt, index === 0 ? /图 2 .*REFERENCE_B/ : /图 2 .*REFERENCE_A/);
  }
});
