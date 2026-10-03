import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import { applyPromptPatches } from '../lib/prompt-adaptation.mjs';
import { compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-full-prompts-'));
process.env.AI_COS_DATA_DIR = root;
const store = await import('../server/store.mjs');
const { CodexBridge, buildTaskPrompt } = await import('../server/codex-bridge.mjs');
const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ffffff' } }).png().toBuffer();
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const pngPath = path.join(root, 'synthetic-output.png');
await fs.writeFile(pngPath, png);
const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `LOCKED_${key}`, certainty: 'observed', strongLock: true }]));
const original = '  A blonde woman wearing a white shirt leans against a blue wall.\nSide window light follows the folds of the shirt.  ';
const patches = [{ before: 'A blonde woman', after: 'The same COS character with LOCKED_hairstyle', reason: '只替换人物与发型，保留摄影关系', included: true }];
const policy = { mode: 'character', outfitSource: 'template', outfitDirection: '', propPolicy: 'free' };
const batchOf = (job) => job.reshootBatches.find((batch) => batch.id === job.activeReshootBatchId);
test.after(async () => fs.rm(root, { recursive: true, force: true }));
async function sourceJob() {
  const job = await store.createJob({ title: '完整模板测试', mainReference: { dataUrl } });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, card);
  await store.saveCharacterCard(job.id, card);
  await store.configureAndQueueBaseline(job.id, {});
  await store.claimJob(job.id, 'baseline');
  const result = await store.attachOutput(job.id, pngPath, 'baseline');
  return store.updateOutputMetadata(job.id, { outputId: result.selectedOutputId, faceReview: { status: 'accepted', checks: { identity: true, anatomy: true, texture: true } } });
}
async function prepared(extra = {}) {
  const job = await sourceJob();
  const template = await store.saveFullPrompt({ name: '窗边衬衫', rawText: original });
  const queued = await store.createFullPromptReshoot(job.id, { templateId: template.id, creativePolicy: policy, adultConfirmed: true, ...extra });
  return { job: queued, template, batch: batchOf(queued) };
}
async function adapted(extra = {}) {
  const f = await prepared(extra);
  await store.claimJob(f.job.id, 'prompt_adapt');
  const job = await store.applyFullPromptAdaptation(f.job.id, { patches, warnings: [] });
  return { ...f, job, batch: batchOf(job) };
}

void test('完整收藏不拆分、不入队；逐字保存并版本化，旧原文及收藏保持不变', async () => {
  const before = await store.getBootstrap();
  const item = await store.saveFullPrompt({ name: '完整原文', rawText: original });
  const after = await store.getBootstrap();
  assert.equal(item.rawText, original);
  assert.equal(item.originalText, original);
  assert.equal(after.promptImports.length, before.promptImports.length);
  assert.equal(after.prompts.length, before.prompts.length);
  const next = await store.saveFullPrompt({ ...item, rawText: `${original}\nUser addition.` });
  assert.equal(next.version, 2);
  assert.equal(next.versions[0].rawText, original);
  assert.equal(next.originalText, original);
  await assert.rejects(store.saveFullPrompt({ ...item, rawText: 'stale edit' }), /已更新/);
  await assert.rejects(store.saveFullPrompt({ name: 'too long', rawText: 'x'.repeat(30001) }), /30,000/);
  await assert.rejects(store.saveFullPrompt({ name: 'bad URL', rawText: original, sourceUrl: 'javascript:alert(1)' }), /HTTP/);
});

void test('适配只替换唯一原文片段，保留空白与关系；拒绝重复、重叠和虚构来源', () => {
  const result = applyPromptPatches(original, patches);
  assert.equal(result, original.replace(patches[0].before, patches[0].after));
  assert.equal(applyPromptPatches(original, [{ ...patches[0], included: false }]), original);
  assert.equal(applyPromptPatches(original, []), original);
  assert.throws(() => applyPromptPatches(original, [{ ...patches[0], before: 'shirt' }]), /重复/);
  assert.throws(() => applyPromptPatches(original, [{ ...patches[0], before: 'not here' }]), /缺失/);
  assert.throws(() => applyPromptPatches(original, [...patches, { ...patches[0], before: 'blonde' }]), /重叠/);
});

void test('适配任务只返回草稿，两次用户确认前都不生图；新模板版本不改变已冻结原文', async () => {
  const f = await prepared();
  assert.equal(f.job.executionRuns.at(-1).kind, 'prompt_adapt');
  assert.equal(f.batch.variants.length, 0);
  await assert.rejects(store.confirmReshootDraft(f.job.id, f.batch.id, {}), /已有任务/);
  await store.saveFullPrompt({ ...f.template, rawText: 'A completely different new template.' });
  await store.claimJob(f.job.id, 'prompt_adapt');
  await assert.rejects(store.claimJob(f.job.id, 'prompt_adapt'), /已被领取/);
  const ready = await store.applyFullPromptAdaptation(f.job.id, { patches });
  assert.equal(ready.activeRunId, null);
  assert.equal(batchOf(ready).status, 'plan_ready');
  assert.equal(batchOf(ready).templateSnapshot.rawText, original);
  await assert.rejects(store.confirmReshootDraft(f.job.id, f.batch.id, {}), /只有草稿/);
  const compiled = await store.editFullPromptAdaptation(f.job.id, f.batch.id, { patches }, true);
  assert.equal(compiled.activeRunId, null);
  const batch = batchOf(compiled);
  assert.equal(batch.variants.length, 1);
  assert.match(batch.variants[0].compiledPrompt, /white shirt leans against a blue wall/);
  assert.doesNotMatch(batch.variants[0].compiledPrompt, /LOCKED_outfitLayers/);
  assert.match(batch.variants[0].compiledPrompt, /LOCKED_hairAccessories/);
  await assert.rejects(store.rerollReshootDraft(f.job.id, batch.id), /只有随机/);
  const ajv = new Ajv2020({ strict: false });
  ajv.addSchema(JSON.parse(await fs.readFile(new URL('../schemas/character-profile.schema.json', import.meta.url), 'utf8')));
  const check = ajv.compile(JSON.parse(await fs.readFile(new URL('../schemas/generation-job.schema.json', import.meta.url), 'utf8')));
  assert.equal(check(compiled), true, JSON.stringify(check.errors));
  await store.discardReshootDraft(f.job.id, batch.id);
});

void test('角色演绎清理旧服装锁，原装重拍和角色身份仍保留；无成年确认不能换装', async () => {
  const pack = { name: '旧包', globalStyle: '真实摄影，不重染角色服装。', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'scene' ? ['blue wall'] : []])), avoid: ['服装结构偷换', '不得改变角色身份、肤色、妆造和服装设计'] };
  const input = { characterCard: card, pack, selections: { outfitStyle: 'WHITE_SHIRT' } };
  const locked = compileReshootPrompt(input);
  const free = compileReshootPrompt({ ...input, creative: policy });
  assert.match(locked, /LOCKED_outfitLayers/);
  assert.match(locked, /服装锁定/);
  assert.doesNotMatch(free, /不重染角色服装|服装结构偷换|LOCKED_outfitLayers/);
  assert.match(free, /WHITE_SHIRT/);
  assert.match(free, /LOCKED_hairstyle/);
  assert.match(free, /LOCKED_makeup/);
  assert.match(free, /LOCKED_bodySilhouette/);
  assert.match(free, /不要求携带/);
  const job = await sourceJob();
  const template = await store.saveFullPrompt({ name: '模板', rawText: original });
  await assert.rejects(store.createFullPromptReshoot(job.id, { templateId: template.id, creativePolicy: policy }), /成年/);
  await assert.rejects(store.createFullPromptReshoot(job.id, { templateId: template.id, creativePolicy: { ...policy, outfitSource: 'reference' }, adultConfirmed: true, outfitReferenceDataUrl: 'data:image/png;base64,eA==' }), /图片|签名|损坏/);
});

void test('网页交接按源图、服装图、角色图排序；导回保留原文适配、像素和非覆盖版本', async () => {
  const f = await adapted({ creativePolicy: { ...policy, outfitSource: 'reference' }, outfitReferenceDataUrl: dataUrl });
  await store.editFullPromptAdaptation(f.job.id, f.batch.id, { patches }, true);
  const waiting = await store.confirmReshootDraft(f.job.id, f.batch.id, { backend: 'chatgpt-web-manual' });
  const handoff = await store.getWebHandoff(waiting.activeRunId);
  assert.deepEqual(handoff.prompts[0].orderedAssets.slice(0, 3).map((item) => item.role), ['edit_source', 'outfit_reference', 'character_main']);
  assert.match(handoff.prompts[0].prompt, /阿茶/);
  assert.equal((await store.nextQueuedTask())?.targetId === f.job.id, false);
  const finished = await store.importWebHandoffOutputs(waiting.activeRunId, [{ variantId: f.batch.id && batchOf(waiting).variants[0].id, outputDataUrl: dataUrl }]);
  const output = finished.reshootVersions.at(-1);
  assert.equal(output.fileName, 'reshoot-v001.png');
  assert.equal(output.templateSnapshot.rawText, original);
  assert.equal(output.adaptationSnapshot.adaptedText, applyPromptPatches(original, patches));
  assert.equal(output.pixelWidth, 32);
  assert.equal(output.creativePolicy.mode, 'character');
  await assert.rejects(store.importWebHandoffOutputs(waiting.activeRunId, [{ variantId: batchOf(waiting).variants[0].id, outputDataUrl: dataUrl }]), /失效|完成/);
});

void test('内置领取与 CLI 呈现使用同一服装图顺序，逐张归档不改写适配', async () => {
  const f = await adapted({ creativePolicy: { ...policy, outfitSource: 'reference' }, outfitReferenceDataUrl: dataUrl });
  await store.editFullPromptAdaptation(f.job.id, f.batch.id, { patches }, true);
  const queued = await store.confirmReshootDraft(f.job.id, f.batch.id, { backend: 'built-in-imagegen' });
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/ai-cosctl.mjs', 'claim', '--job', f.job.id, '--kind', 'reshoot', '--run', queued.activeRunId, '--json'], { cwd: store.PROJECT_ROOT, env: process.env, encoding: 'utf8' }));
  const variant = result.execution.activeReshootBatch.variants[0];
  assert.deepEqual(variant.orderedInputFiles.slice(0, 3).map((item) => item.role), ['edit_source', 'outfit_reference', 'character_main']);
  const done = await store.attachReshootOutput(f.job.id, variant.id, pngPath);
  assert.equal(done.activeRunId, null);
  assert.equal(done.reshootVersions.at(-1).prompt, variant.compiledPrompt);
  assert.equal(done.reshootVersions.at(-1).templateSnapshot.rawText, original);
});

void test('中断适配保留输入，手动重试防止旧执行写回；未领取任务仍排队', async () => {
  const f = await prepared();
  const firstRun = f.job.activeRunId;
  await store.claimJob(f.job.id, 'prompt_adapt');
  await store.interruptRun(f.job.id, firstRun, 'fixture disconnect');
  const retry = await store.retryRun(firstRun);
  assert.notEqual(retry.activeRunId, firstRun);
  assert.equal(batchOf(retry).templateSnapshot.rawText, original);
  await assert.rejects(store.withExecutionIdentity({ type: 'job', id: f.job.id, runId: firstRun }, () => store.applyFullPromptAdaptation(f.job.id, { patches })), /过期|替换/);
  assert.equal((await store.getJob(f.job.id)).activeRunId, retry.activeRunId);
  await store.interruptRun(f.job.id, retry.activeRunId, 'test finished');
  await store.saveCharacterCard(f.job.id, { ...card, iris: { ...card.iris, value: 'USER_UPDATED_IRIS' } });
  await assert.rejects(store.retryRun(retry.activeRunId), /输入已变化/);
});

void test('完整 Prompt 桥接采用临时线程并只写适配草稿，不创建生成任务', async () => {
  const f = await prepared();
  const previous = process.env.AI_COS_CODEX_PATH;
  const fixture = path.resolve('tests/fixtures/bridge-full-prompt.mjs');
  await fs.chmod(fixture, 0o755);
  process.env.AI_COS_CODEX_PATH = fixture;
  const bridge = new CodexBridge();
  try {
    await bridge.run('job', f.job.id, f.job.executionRuns.at(-1));
    const ready = await store.getJob(f.job.id);
    assert.equal(batchOf(ready).status, 'plan_ready');
    assert.equal(ready.activeRunId, null);
    assert.equal(ready.reshootVersions.length, 0);
    assert.equal(batchOf(ready).variants.length, 0);
    const protocol = JSON.parse(await fs.readFile(path.join(root, 'fixture-thread.json'), 'utf8'));
    assert.equal(protocol.ephemeral, true);
    assert.equal(Object.hasOwn(protocol, 'model'), false);
    assert.match(buildTaskPrompt(f.job.id, 'prompt_adapt', 'job', f.job.activeRunId), /不拆分、不随机组合/);
  } finally {
    bridge.stop();
    if (previous === undefined) delete process.env.AI_COS_CODEX_PATH; else process.env.AI_COS_CODEX_PATH = previous;
  }
});

void test('真实本地 API 与模拟桥接：原文收藏、适配审核、网页交接和导回完整链路', async () => {
  const job = await sourceJob();
  const portProbe = net.createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/local-api.mjs'], {
    cwd: store.PROJECT_ROOT,
    env: { ...process.env, AI_COS_API_PORT: String(port), AI_COS_CODEX_PATH: path.resolve('tests/fixtures/bridge-full-prompt.mjs') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => { log += data; });
  child.stderr.on('data', (data) => { log += data; });
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`mock API timed out: ${log}`);
  };
  try {
    await waitFor(async () => { try { return (await fetch(`${base}/health`)).ok; } catch { return false; } });
    const { token } = await (await fetch(`${base}/api/session`)).json();
    const write = async (route, body, method = 'POST', status = 200) => {
      // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- this helper only sends POST or PATCH
      const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', 'x-ai-cos-token': token }, body: JSON.stringify(body) });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    };
    const template = await write('/api/full-prompts', { name: 'HTTP 原文', rawText: original }, 'POST', 201);
    const library = await (await fetch(`${base}/api/bootstrap`)).json();
    assert.equal(library.fullPrompts.find((entry) => entry.id === template.id).rawText, original);
    const queued = await write(`/api/jobs/${job.id}/reshoots/full-prompt`, { templateId: template.id, templateVersion: template.version, creativePolicy: policy, adultConfirmed: true }, 'POST', 201);
    const batchId = queued.activeReshootBatchId;
    await waitFor(async () => (await store.getJob(job.id)).reshootBatches.find((batch) => batch.id === batchId).status === 'plan_ready');
    const route = `/api/jobs/${job.id}/reshoots/${batchId}`;
    const ready = await write(`${route}/adaptation`, { patches }, 'PATCH');
    assert.equal(ready.activeRunId, null);
    assert.equal(batchOf(ready).variants.length, 0);
    const compiled = await write(`${route}/adaptation/confirm`, { patches });
    assert.equal(compiled.activeRunId, null);
    const waiting = await write(`${route}/confirm`, { backend: 'chatgpt-web-manual' });
    const finished = await write(`/api/runs/${waiting.activeRunId}/import-outputs`, { outputs: [{ variantId: batchOf(waiting).variants[0].id, outputDataUrl: dataUrl }], finishPartial: false });
    assert.equal(finished.reshootVersions.at(-1).templateSnapshot.rawText, original);
    assert.equal(finished.reshootVersions.at(-1).backend, 'chatgpt-web-manual');
    assert.equal(finished.activeRunId, null);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(killTimer);
  }
});
