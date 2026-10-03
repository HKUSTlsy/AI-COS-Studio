import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_FACE_RULES, BASELINE_FACE_VERSION, buildBaselineFaceComparison, sourceFaceContext, faceReviewState, normalizeFaceReview, assertFaceReviewed } from '../lib/baseline-face.mjs';
import { compileBaselinePrompt, compileAdjustmentPrompt, compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';
import { CONCISE_BASELINE_FACE_RULES } from '../lib/concise-prompts.mjs';
import { realismPrompt } from '../lib/photo-realism.mjs';

const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `${key} locked`, certainty: 'user_confirmed', strongLock: true }]));
card.iris.value = '金色瞳孔、蓝紫色内环、宝石感和固定亮点';
const checks = { identity: true, anatomy: true, texture: true };

void test('基准分离角色配色和真人五官结构，不改写角色卡或偷偷卸妆', () => {
  const before = structuredClone(card);
  const prompt = compileBaselinePrompt({ characterCard: card, faceProfile: { name: 'Authorized face' }, aspectRatio: '9:16' });
  assert.ok(prompt.includes(CONCISE_BASELINE_FACE_RULES));
  assert.ok(prompt.indexOf(CONCISE_BASELINE_FACE_RULES) < prompt.indexOf('【用户确认的角色强约束】'));
  assert.match(prompt, /眼裂、眼球与虹膜的相对尺寸/);
  assert.match(prompt, /面部结构以真人脸模为准/);
  assert.match(prompt, /保留已确认瞳色与色环/);
  assert.match(prompt, /反光和眼白受当前现场光线影响/);
  assert.match(prompt, /不擅自卸妆、老化/);
  assert.match(prompt, /不要为了展示脸部而自动改成大头照/);
  assert.match(prompt, /Authorized face/);
  assert.match(prompt, /9:16/);
  assert.deepEqual(card, before);
});

void test('历史面部 A/B 只移除旧版完整面部块，新编译保留固定真人方案', () => {
  const prompt = `${BASELINE_FACE_RULES}\n\n${realismPrompt()}\n\n【角色】${card.iris.value}`;
  const pair = buildBaselineFaceComparison(prompt);
  assert.equal(pair.ruleVersion, BASELINE_FACE_VERSION);
  assert.equal(pair.treatment, prompt);
  assert.equal(pair.control, prompt.replace(`${BASELINE_FACE_RULES}\n\n`, ''));
  assert.match(pair.control, /realism-v1/);
  assert.match(pair.control, /金色瞳孔、蓝紫色内环/);
  assert.equal(buildBaselineFaceComparison(pair.control), null);
  assert.equal(buildBaselineFaceComparison(`${prompt}\n${BASELINE_FACE_RULES}`), null);
  assert.equal(buildBaselineFaceComparison(prompt.replace('眼睑厚度', '用户已改写')), null);
  assert.equal(buildBaselineFaceComparison(compileBaselinePrompt({ characterCard: card })), null);
});

void test('面部重构规则不注入单项调整或随机重拍，不破坏源图身份锁定', () => {
  const adjustment = compileAdjustmentPrompt({ characterCard: card, category: 'background', request: '灰墙', preserve: ['identity'] });
  const pack = { name: 'synthetic', globalStyle: 'natural', pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, []])), avoid: [] };
  pack.pools.moment = ['自然回头'];
  const reshoot = compileReshootPrompt({ characterCard: card, pack });
  assert.ok(!adjustment.includes(BASELINE_FACE_VERSION));
  assert.ok(!reshoot.includes(BASELINE_FACE_VERSION));
  assert.match(reshoot, /严格保留干净源图中已经建立的面部身份/);
});

void test('历史脸模解析只查分支和冻结快照，不借用当前脸模', () => {
  const oldFace = { id: 'old', name: '旧脸模', version: 1 };
  const old = { id: 'b1', kind: 'baseline', configurationVersion: 1, faceSnapshot: oldFace };
  const original = { id: 'b2', kind: 'baseline', inputSnapshot: { faceSnapshot: null } };
  const adjustment = { id: 'a1', kind: 'adjustment', sourceOutputId: 'b1' };
  const legacy = { id: 'b0', kind: 'baseline', configurationVersion: 0 };
  const job = { faceSnapshot: { id: 'current', name: '当前脸模' }, baselineVersions: [old, original, legacy], adjustmentVersions: [adjustment], configurationHistory: [{ version: 2, faceSnapshot: { id: 'other' } }] };
  assert.deepEqual(sourceFaceContext(job, adjustment), { face: oldFace, known: true });
  assert.deepEqual(sourceFaceContext(job, original), { face: null, known: true });
  assert.deepEqual(sourceFaceContext(job, legacy), { face: null, known: false });
  assert.deepEqual(sourceFaceContext(job, { id: 'cycle', sourceOutputId: 'cycle' }), { face: null, known: false });
});

void test('新基准及未验收分支阻止重拍，旧图不迁移；修正图可独立验收', () => {
  const baseline = { id: 'b1', kind: 'baseline', prompt: compileBaselinePrompt({ characterCard: card }) };
  const correction = { id: 'a1', kind: 'adjustment', sourceOutputId: 'b1' };
  const job = { baselineVersions: [baseline], adjustmentVersions: [correction], outputAnnotations: {} };
  const before = structuredClone(job);
  assert.throws(() => assertFaceReviewed(job, baseline), /人工验收/);
  assert.equal(faceReviewState(job, correction).blocked, true);
  assert.deepEqual(job, before);
  assert.equal(faceReviewState(job, { id: 'old', kind: 'baseline', prompt: 'old prompt' }).status, 'legacy');
  assert.equal(faceReviewState(job, { id: 'old', kind: 'baseline', prompt: 'old prompt' }).blocked, false);
  job.outputAnnotations.b1 = { faceReview: normalizeFaceReview({ status: 'rejected' }) };
  job.outputAnnotations.a1 = { faceReview: normalizeFaceReview({ status: 'accepted', checks }) };
  assert.doesNotThrow(() => assertFaceReviewed(job, correction));
  assert.throws(() => assertFaceReviewed(job, baseline), /人工验收/);
  assert.equal(faceReviewState(job, { id: 'reshoot', sourceOutputId: 'a1' }).reviewedOutputId, 'a1');
  assert.equal(faceReviewState(job, { id: 'broken', sourceOutputId: 'missing' }).blocked, true);
});

void test('验收必须由用户逐项确认，拒绝伪造自动审阅标识、空白勾选和非法状态', () => {
  assert.throws(() => normalizeFaceReview({ status: 'accepted' }), /分别确认/);
  assert.throws(() => normalizeFaceReview({ status: 'accepted', checks: { ...checks, texture: 'true' } }), /分别确认/);
  assert.throws(() => normalizeFaceReview({ status: 'machine-pass' }), /无效/);
  const review = normalizeFaceReview({ status: 'accepted', checks, reviewer: 'codex', reviewedAt: 'fake', note: 'x'.repeat(3000) });
  assert.equal(review.reviewer, 'user');
  assert.notEqual(review.reviewedAt, 'fake');
  assert.equal(review.note.length, 2000);
});
