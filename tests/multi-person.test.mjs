import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import { PHOTOGRAPHY_POOL_KEYS, normalizePhotographyPackDraft } from '../server/domain.mjs';
import { validateGroupParticipants, multiPersonAssets } from '../server/multi-person.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-group-test-'));
process.env.AI_COS_DATA_DIR = root;
const store = await import('../server/store.mjs');
const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#ffffff' } }).png().toBuffer();
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const pngPath = path.join(root, 'synthetic-output.png');
await fs.writeFile(pngPath, png);
test.after(async () => fs.rm(root, { recursive: true, force: true }));
const card = (name) => Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `${name}:${key}`, certainty: 'observed', strongLock: true }]));
const packDraft = {
  name: '合影测试包', globalStyle: '自然同伴抓拍',
  pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'scene' ? ['TEST_SCENE'] : key === 'captureState' ? ['NOT_SELECTED_CAMERA'] : []])),
  groupInteractions: ['角色 A 递水给角色 B'], imagingMedia: ['TEST_MEDIUM'],
};
let pack;
test.before(async () => {
  const imported = await store.createPhotographyPackImport({ title: 'fixture', rawText: 'Test fixture only.' });
  await store.claimPhotographyPackImport(imported.id);
  await store.applyPhotographyPackDraft(imported.id, packDraft);
  assert.equal((await store.getBootstrap()).photographyPacks.length, 0);
  pack = (await store.confirmPhotographyPackImport(imported.id)).pack;
});
async function person(name) {
  const job = await store.createJob({ title: name, mainReference: { dataUrl } });
  await store.claimJob(job.id, 'analysis');
  await store.applyCharacterCard(job.id, card(name));
  await store.saveCharacterCard(job.id, card(name));
  await store.configureAndQueueBaseline(job.id, {});
  await store.claimJob(job.id, 'baseline');
  const output = await store.attachOutput(job.id, pngPath, 'baseline');
  await store.updateOutputMetadata(job.id, { outputId: output.selectedOutputId, faceReview: { status: 'accepted', checks: { identity: true, anatomy: true, texture: true } } });
  return { jobId: job.id, outputId: output.selectedOutputId, adultConfirmed: true, position: name, wardrobe: 'locked' };
}
async function fixture(count = 2) {
  const participants = [];
  for (let i = 0; i < count; i++) participants.push(await person(`人物-${i + 1}-${Date.now()}`));
  return { participants, packId: pack.id, event: '角色 A 递水给角色 B，其余已选人物笑着回应同一次递水。', medium: 'TEST_MEDIUM', aspectRatio: '16:9', sceneReferenceDataUrl: dataUrl };
}
const batchOf = (job) => job.reshootBatches.find((batch) => batch.id === job.activeReshootBatchId);

void test('多人独立映射、人数和逐人授权校验；普通摄影包不凭空补充共同事件', () => {
  const ps = ['a', 'b'].map((jobId) => ({ jobId, outputId: 'baseline-v001', position: jobId, adultConfirmed: true }));
  assert.equal(validateGroupParticipants(ps), true);
  for (const count of [0, 1, 5]) assert.throws(() => validateGroupParticipants(Array.from({ length: count }, (_, i) => ({ ...ps[0], jobId: String(i) }))), /2–4/);
  assert.throws(() => validateGroupParticipants([ps[0], ps[0]]), /不同作品/);
  assert.throws(() => validateGroupParticipants([ps[0], { ...ps[1], adultConfirmed: false }]), /明确成年/);
  assert.throws(() => validateGroupParticipants([ps[0], { ...ps[1], wardrobe: 'swimwear' }]), /单独确认/);
  assert.throws(() => normalizePhotographyPackDraft({ ...packDraft, groupInteractions: 'not-list' }), /列表/);
  assert.deepEqual(normalizePhotographyPackDraft({ name: '普通', globalStyle: '真实', pools: packDraft.pools }).groupInteractions, []);
});

void test('2–4 人草稿独立冻结角色、衣服许可与编号；只准备一个 Prompt 不进入队列', async () => {
  for (const count of [2, 3, 4]) {
    const input = await fixture(count);
    input.participants[1] = { ...input.participants[1], wardrobe: 'swimwear', outfitConfirmed: true, outfitDirection: 'B 独有蓝色运动泳装' };
    const result = await store.createMultiPersonDraft(input.participants[0].jobId, input);
    const batch = batchOf(result);
    assert.equal(result.activeRunId, null);
    assert.equal(batch.variants.length, 1);
    assert.equal(batch.mode, 'multi_person');
    assert.equal(batch.quantity, 1);
    assert.equal(batch.multiPerson.participants.length, count);
    const assets = multiPersonAssets(batch.multiPerson);
    assert.deepEqual(assets.slice(0, count).map((image) => image.role), ['A', 'B', 'C', 'D'].slice(0, count).map((letter) => `participant_${letter}_source`));
    assert.equal(assets[count].role, 'group_scene');
    assert.ok(assets.slice(count + 1).every((image) => image.purpose.includes('仅核对角色')));
    const prompt = batch.variants[0].compiledPrompt;
    assert.ok(prompt.indexOf('TEST_SCENE') < prompt.indexOf('逐人身份与角色保持'));
    assert.match(prompt, /逐人保持项优先/);
    assert.ok(prompt.includes('B 独有蓝色运动泳装'));
    assert.ok(prompt.includes('服装锁定'));
    assert.ok(!prompt.includes('NOT_SELECTED_CAMERA'));
    assert.ok(prompt.includes('3840 × 2160'));
    assert.equal(batch.multiPerson.participants[0].wardrobe, 'locked');
    const originalB = batch.multiPerson.participants[1].context.characterCard;
    await store.saveCharacterCard(input.participants[1].jobId, card('B编辑器新值'));
    assert.deepEqual(batchOf(await store.getJob(result.id)).multiPerson.participants[1].context.characterCard, originalB);
    const schema = JSON.parse(await fs.readFile(new URL('../schemas/generation-job.schema.json', import.meta.url), 'utf8'));
    const cardSchema = JSON.parse(await fs.readFile(new URL('../schemas/character-profile.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ strict: false, validateFormats: false }).addSchema(cardSchema).compile(schema);
    assert.equal(validate(result), true, JSON.stringify(validate.errors));
  }
});

void test('多人网页交接逐人编号与文件一致，保留阿茶；导回一次后不能重复或进入单人路径', async () => {
  const input = await fixture();
  const prepared = await store.createMultiPersonDraft(input.participants[0].jobId, input);
  const batch = batchOf(prepared);
  const waiting = await store.confirmReshootDraft(prepared.id, batch.id, { backend: 'chatgpt-web-manual' });
  const run = waiting.executionRuns.find((r) => r.id === waiting.activeRunId);
  assert.equal(run.status, 'waiting_user');
  assert.equal(run.handoff.prompts.length, 1);
  assert.match(run.handoff.prompts[0].prompt, /阿茶/);
  const originalAssets = multiPersonAssets(batch.multiPerson);
  assert.deepEqual(run.handoff.prompts[0].orderedAssets.map((a) => a.role), originalAssets.map((a) => a.role));
  assert.deepEqual(run.handoff.prompts[0].orderedAssets.map((a) => a.inputNumber), originalAssets.map((_, i) => i + 1));
  for (const asset of run.handoff.assets) assert.deepEqual(await fs.readFile(path.join(root, asset.path)), png);
  const done = await store.importWebHandoffOutputs(run.id, [{ variantId: batch.variants[0].id, outputDataUrl: dataUrl }]);
  const result = done.reshootVersions.at(-1);
  assert.equal(result.mode, 'multi_person');
  assert.equal(result.backend, 'chatgpt-web-manual');
  assert.equal(result.multiPerson.participants.length, 2);
  assert.equal(result.pixelWidth, 32);
  assert.equal(result.pixelHeight, 24);
  await assert.rejects(() => store.importWebHandoffOutputs(run.id, [{ variantId: batch.variants[0].id, outputDataUrl: dataUrl }]), /失效/);
  assert.throws(() => store.outputContext(done, result), /多人结果/);
  await assert.rejects(() => store.createAdjustment(done.id, { sourceOutputId: result.id, category: 'background', request: '换背景' }), /多人结果/);
  await assert.rejects(() => store.createReshootDraft(done.id, { sourceOutputId: result.id, packId: pack.id }), /多人结果/);
  const backup = await store.createLocalBackup(done.id);
  const files = execFileSync('/usr/bin/tar', ['-tzf', path.join(root, backup.path)], { encoding: 'utf8' });
  assert.ok(files.includes(batch.multiPerson.participants[1].sourceImage.path));
});

void test('内置多人运行 claim 的 variant 清单正确；只允许归档一次且保留完整参与者快照', async () => {
  const input = await fixture(3);
  const prepared = await store.createMultiPersonDraft(input.participants[0].jobId, input);
  const batch = batchOf(prepared);
  const queued = await store.confirmReshootDraft(prepared.id, batch.id, { backend: 'built-in-imagegen' });
  const payload = JSON.parse(execFileSync(process.execPath, ['scripts/ai-cosctl.mjs', 'claim', '--job', prepared.id, '--kind', 'reshoot', '--run', queued.activeRunId, '--json'], { encoding: 'utf8', env: { ...process.env, AI_COS_DATA_DIR: root } }));
  const variant = payload.execution.activeReshootBatch.variants[0];
  const expected = multiPersonAssets(batch.multiPerson);
  assert.deepEqual(variant.orderedInputFiles.map((ref) => ref.path), expected.map((ref) => path.join(root, ref.path)));
  assert.deepEqual(payload.execution.orderedInputFiles, variant.orderedInputFiles);
  assert.equal(variant.compiledPrompt, batch.variants[0].compiledPrompt);
  await assert.rejects(() => store.claimJob(prepared.id, 'reshoot'), /领取|可领取/);
  const done = await store.attachReshootOutput(prepared.id, variant.id, pngPath);
  assert.equal(done.reshootVersions.at(-1).multiPerson.participants.length, 3);
  assert.equal(done.reshootVersions.at(-1).backend, 'built-in-imagegen');
  assert.equal(done.activeRunId, null);
  await assert.rejects(() => store.attachReshootOutput(prepared.id, variant.id, pngPath), /没有正在执行/);
});

void test('多人失败只记录错误，用户恢复为新草稿；不能借普通重抽改变参与者或数量', async () => {
  const input = await fixture();
  const prepared = await store.createMultiPersonDraft(input.participants[0].jobId, input);
  const batch = batchOf(prepared);
  await assert.rejects(() => store.updateReshootDraft(prepared.id, batch.id, { quantity: 2 }), /对应编辑器/);
  await assert.rejects(() => store.rerollReshootDraft(prepared.id, batch.id), /不支持随机/);
  await store.confirmReshootDraft(prepared.id, batch.id, {});
  await store.claimJob(prepared.id, 'reshoot');
  await store.failReshootVariant(prepared.id, batch.variants[0].id, 'policy', '模拟真实审查失败');
  const failed = await store.getJob(prepared.id);
  assert.equal(failed.activeRunId, null);
  assert.equal(failed.reshootVersions.length, 0);
  const recovered = await store.recoverReshootVariants(prepared.id, batch.id, [batch.variants[0].id]);
  assert.notEqual(batchOf(recovered).id, batch.id);
  assert.equal(batchOf(recovered).status, 'draft');
  assert.equal(batchOf(recovered).mode, 'multi_person');
  assert.deepEqual(batchOf(recovered).multiPerson, batch.multiPerson);
});

void test('错误参考、未验收与撤回验收拦截；后端不信任客户端输入路径、角色卡或授权快照', async () => {
  const input = await fixture();
  const id = input.participants[0].jobId;
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, participants: [input.participants[0]], quantity: 1 }), /2–4/);
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, quantity: 4 }), /一张/);
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, event: '' }), /共同事件/);
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, event: '角色 D 把杯子递给角色 A' }), /未选择的角色 D/);
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, sceneReferenceDataUrl: 'data:image/png;base64,eA==' }), /图片|图像|PNG|格式/);
  await assert.rejects(() => store.createMultiPersonDraft(id, { ...input, participants: [input.participants[0], { ...input.participants[1], outputId: '../../foo' }] }), /源版本不存在/);
  const prepared = await store.createMultiPersonDraft(id, { ...input, participants: input.participants.map((p) => ({ ...p, context: { characterCard: card('FORGED') }, sourceImage: { path: '/etc/passwd' } })) });
  assert.ok(!batchOf(prepared).variants[0].compiledPrompt.includes('FORGED'));
  await store.updateOutputMetadata(input.participants[1].jobId, { outputId: input.participants[1].outputId, faceReview: { status: 'rejected', checks: {} } });
  await assert.rejects(() => store.confirmReshootDraft(id, batchOf(prepared).id, {}), /人工验收/);
  assert.equal((await store.getJob(id)).activeRunId, null);
});
