import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileReshootPrompt, PHOTOGRAPHY_POOL_KEYS } from '../server/domain.mjs';
import { withWebReshootWatermark } from '../server/web-reshoot-watermark.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-material-review-'));
process.env.AI_COS_DATA_DIR = root;
const store = await import('../server/store.mjs');
test.after(async () => fs.rm(root, { recursive: true, force: true }));
const card = Object.fromEntries(['hairstyle', 'hairAccessories', 'iris', 'makeup', 'bodySilhouette', 'outfitLayers', 'colors', 'materials', 'accessories', 'footwear'].map((key) => [key, { value: `${key} locked`, certainty: 'user_confirmed', strongLock: true }]));

void test('素材修订先预览、一次版本化整批；原文、旧版本和作品文件不变', async () => {
  const before = await store.getBootstrap();
  const originals = before.prompts.slice(0, 2);
  const jobsBefore = await fs.readFile(path.join(root, 'jobs', 'index.json'), 'utf8');
  const plan = { kind: 'prompt', edits: originals.map((p) => ({ id: p.id, expectedVersion: p.version, changes: { normalizedText: '优化后的明确摄影关系' }, reason: '测试修订' })) };
  const preview = await store.reviseMaterialCollection(plan);
  assert.equal(preview.applied, false);
  assert.deepEqual((await store.getBootstrap()).prompts, before.prompts);
  const result = await store.reviseMaterialCollection(plan, { apply: true });
  assert.equal(result.count, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.backupDirectory, 'before.json'), 'utf8')), before.prompts);
  const after = (await store.getBootstrap()).prompts;
  for (const old of originals) {
    const updated = after.find((p) => p.id === old.id);
    assert.equal(updated.version, old.version + 1);
    assert.equal(updated.rawText, old.rawText);
    assert.deepEqual(updated.versions.at(-1), old);
  }
  assert.equal(await fs.readFile(path.join(root, 'jobs', 'index.json'), 'utf8'), jobsBefore);
  await assert.rejects(() => store.reviseMaterialCollection(plan, { apply: true }), /版本已变化/);
  assert.deepEqual((await store.getBootstrap()).prompts, after);
});

void test('错误目标、越权字段和批次后项错误均不会写入前项', async () => {
  const before = (await store.getBootstrap()).prompts;
  const p = before[0];
  const edit = { id: p.id, expectedVersion: p.version, changes: { normalizedText: '不能写入' }, reason: '测试' };
  for (const edits of [
    [edit, { ...edit, id: 'missing' }],
    [edit, edit],
    [{ ...edit, changes: { rawText: '不要覆盖原文' } }],
    [{ ...edit, changes: { version: 999 } }],
    [{ ...edit, reason: '' }],
  ]) await assert.rejects(() => store.reviseMaterialCollection({ kind: 'prompt', edits }, { apply: true }));
  assert.deepEqual((await store.getBootstrap()).prompts, before);
});

void test('动作表情组合不再叠加第二种随机表情，避免项去重且网页署名仅一处', () => {
  const pack = { name: 'synthetic', globalStyle: 'natural photography', avoid: ['塑料皮肤', '过度磨皮', '重复负面词', '重复负面词'], pools: Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, []])) };
  pack.pools.moment = ['回头'];
  const prompt = compileReshootPrompt({ characterCard: card, pack, selections: { expression: '独立随机表情', moment: '忍不住笑＋单手捂嘴（本组表情优先）', palette: '绿色与白色' }, aspectRatio: '1:1' });
  assert.doesNotMatch(prompt, /独立随机表情/);
  assert.match(prompt, /忍不住笑＋单手捂嘴/);
  assert.match(prompt, /环境色偏不重染角色配色/);
  assert.match(prompt, /角色卡不锁定旧手势与构图/);
  assert.equal(prompt.split('重复负面词').length - 1, 1);
  const web = withWebReshootWatermark(prompt);
  assert.equal(withWebReshootWatermark(web), web);
  assert.equal(web.split('【Studio 网页重拍默认署名】').length - 1, 1);
  assert.match(web, /“阿茶”/);
});

void test('摄影包修订保留导入来源、全部旧池与锁定规则', async () => {
  const imported = await store.createPhotographyPackImport({ title: '测试包', packKind: 'variable_pool', rawText: 'synthetic fixture' });
  await store.claimPhotographyPackImport(imported.id);
  const pools = Object.fromEntries(PHOTOGRAPHY_POOL_KEYS.map((key) => [key, key === 'moment' ? ['回头'] : []]));
  await store.applyPhotographyPackDraft(imported.id, { name: '测试包', kind: 'variable_pool', globalStyle: '原始风格', pools, avoid: [], tags: [], excludedDefaults: [] });
  const { pack } = await store.confirmPhotographyPackImport(imported.id);
  const plan = { kind: 'pack', edits: [{ id: pack.id, expectedVersion: pack.version, reason: '去掉模板冲突', changes: { globalStyle: '新的明确摄影方法' } }] };
  await store.reviseMaterialCollection(plan, { apply: true });
  const updated = (await store.getBootstrap()).photographyPacks.find((p) => p.id === pack.id);
  assert.equal(updated.version, pack.version + 1);
  assert.deepEqual(updated.source, pack.source);
  assert.deepEqual(updated.pools, pack.pools);
  assert.deepEqual(updated.rules, pack.rules);
  assert.deepEqual(updated.versions.at(-1), Object.fromEntries(Object.entries(pack).filter(([key]) => key !== 'versions')));
});
