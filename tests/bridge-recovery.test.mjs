import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cos-bridge-tests-'));
process.env.AI_COS_DATA_DIR = root;
const fixture = path.join(root, 'fake-codex.mjs');
await fs.copyFile(fileURLToPath(new URL('./fixtures/bridge-interrupt.mjs', import.meta.url)), fixture);
await fs.chmod(fixture, 0o755);
process.env.AI_COS_CODEX_PATH = fixture;
process.env.AI_COS_CODEX_TURN_TIMEOUT_MS = '180';
const store = await import('../server/store.mjs');
const { CodexBridge } = await import('../server/codex-bridge.mjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test.after(async () => fs.rm(root, { recursive: true, force: true }));

void test('取消的 completion 早于 ACK：停止结束前不释放下一任务', async () => {
  const item = await store.createPromptImport({ title: 'cancel fixture', rawText: 'pose' });
  const bridge = new CodexBridge();
  // Test cancellation ordering after connection, not the cold-start speed of
  // an executable copied into a fresh macOS temporary directory.
  await bridge.connect();
  let finished = false;
  const running = bridge.run('prompt_import', item.id, item.executionRuns[0]).then(() => { finished = true; });
  try {
    for (let i = 0; !bridge.active?.turnId && i < 200; i++) await delay(5);
    assert.ok(bridge.active?.turnId);
    const stopping = bridge.interruptActiveRun(item.activeRunId);
    await delay(80);
    assert.equal(finished, false);
    assert.equal(bridge.health().status, 'running');
    await Promise.all([running, stopping]);
    assert.equal(bridge.health().status, 'offline');
    assert.equal((await store.getPromptImport(item.id)).status, 'interrupted');
  } finally { bridge.stop(); await running.catch(() => {}); }
});

void test('执行超时会中断旧服务，不自动重试导入', async () => {
  const item = await store.createPromptImport({ title: 'timeout fixture', rawText: 'pose' });
  const bridge = new CodexBridge();
  try {
    await bridge.run('prompt_import', item.id, item.executionRuns[0]);
    const after = await store.getPromptImport(item.id);
    assert.equal(after.status, 'interrupted');
    assert.equal(after.executionRuns.length, 1);
    assert.equal(bridge.health().status, 'offline');
  } finally { bridge.stop(); }
});

void test('提前到达的 turn/completed 被缓存，不误判超时', async () => {
  process.env.AI_COS_TEST_EARLY = '1';
  const item = await store.createPromptImport({ title: 'early fixture', rawText: 'pose' });
  const bridge = new CodexBridge();
  try {
    await bridge.run('prompt_import', item.id, item.executionRuns[0]);
    const after = await store.getPromptImport(item.id);
    assert.equal(after.error.type, 'codex_incomplete');
    assert.equal(after.executionRuns.length, 1);
  } finally { bridge.stop(); delete process.env.AI_COS_TEST_EARLY; }
});
