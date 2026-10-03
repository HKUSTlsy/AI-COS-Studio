import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineBlockReason, latestStageFailure, selectImportRecord } from '../lib/studio-ux.ts';

await test('baseline accepts original face and no extra style', () => {
  assert.equal(baselineBlockReason(false, '', []), null);
  assert.equal(baselineBlockReason(false, 'authorized', [{ id: 'authorized', authorizationConfirmed: true }]), null);
});

await test('baseline explains running, missing face, and missing authorization', () => {
  assert.match(baselineBlockReason(true, '', []), /正在执行/);
  assert.match(baselineBlockReason(false, 'missing', []), /重新选择/);
  assert.match(baselineBlockReason(false, 'private', [{ id: 'private', authorizationConfirmed: false }]), /使用授权/);
});

await test('later success or pending work supersedes stale stage failures', () => {
  const failed = { kind: 'baseline', status: 'failed', id: '1' };
  assert.equal(latestStageFailure([failed], 'baseline'), failed);
  for (const status of ['queued', 'running', 'succeeded', 'waiting_user']) {
    assert.equal(latestStageFailure([failed, { kind: 'baseline', status }], 'baseline'), undefined);
  }
  assert.equal(latestStageFailure([failed, { kind: 'adjustment', status: 'failed' }], 'baseline'), failed);
  assert.equal(latestStageFailure([], 'baseline'), undefined);
});

await test('import library prioritizes live work and preserves explicit historical selection', () => {
  const recent = { id: 'new', status: 'completed' };
  const old = { id: 'old', status: 'failed' };
  const draft = { id: 'draft', status: 'draft_ready' };
  const running = { id: 'running', status: 'running' };
  assert.equal(selectImportRecord([recent, old]), recent);
  assert.equal(selectImportRecord([recent, old], 'old'), old);
  assert.equal(selectImportRecord([recent, old, draft]), draft);
  assert.equal(selectImportRecord([draft, running]), running);
  assert.equal(selectImportRecord([]), null);
});
