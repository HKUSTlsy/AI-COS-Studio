#!/usr/bin/env node
// Simulates protocol and deterministic text substitutions only. No model calls.
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_ROOT, claimJob, applyFullPromptAdaptation, withExecutionIdentity } from '../../server/store.mjs';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let threadId;
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'thread/start') {
    threadId = `fixture-${randomUUID()}`;
    await fs.writeFile(path.join(DATA_ROOT, 'fixture-thread.json'), JSON.stringify(message.params));
    send({ id: message.id, result: { thread: { id: threadId } } });
  }
  if (message.method === 'turn/start') {
    const text = message.params.input.find((input) => input.type === 'text').text;
    const id = text.match(/任务 ID：(job-[\w-]+)/)[1];
    const runId = text.match(/执行版本：(run-[\w-]+)/)[1];
    const turnId = `fixture-${runId}`;
    send({ id: message.id, result: { turn: { id: turnId } } });
    try {
      await withExecutionIdentity({ type: 'job', id, runId }, async () => {
        await claimJob(id, 'prompt_adapt');
        await applyFullPromptAdaptation(id, { patches: [{ before: 'A blonde woman', after: 'The same COS character', reason: 'fixture identity adaptation', included: true }], warnings: [] });
      });
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
    } catch (error) {
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'failed', error: { message: error.message } } } });
    }
  }
}
