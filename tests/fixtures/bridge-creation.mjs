#!/usr/bin/env node
// Protocol fixture: creates synthetic text and raster outputs, never invokes a model.
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DATA_ROOT } from '../../server/store.mjs';
import {
  claimPromptCreation,
  applyCreationDrafts,
  attachCreationOutput,
} from '../../server/prompt-creation.mjs';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let threadId;
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: {} });
  if (message.method === 'thread/start') {
    threadId = `thread-${Date.now()}`;
    await fs.writeFile(
      path.join(DATA_ROOT, 'fixture-thread.json'),
      JSON.stringify(message.params),
    );
    send({ id: message.id, result: { thread: { id: threadId } } });
  }
  if (message.method === 'turn/start') {
    await fs.writeFile(
      path.join(DATA_ROOT, 'fixture-turn.json'),
      JSON.stringify(message.params),
    );
    const text = message.params.input[0].text;
    const id = text.match(/--creation ([\w-]+)/)[1],
      runId = text.match(/--run ([\w-]+)/)[1];
    const turnId = `turn-${runId}`;
    send({ id: message.id, result: { turn: { id: turnId } } });
    try {
      const item = await claimPromptCreation(id, runId);
      const run = item.executionRuns.find((r) => r.id === runId);
      if (run.kind === 'prompt_compose') {
        const ids = run.request.requestedIds;
        await applyCreationDrafts(id, runId, {
          selectedSkill:
            item.skill === 'vsc' ? 'character-candid-photography' : item.skill,
          drafts: Array.from(
            { length: ids.length || item.quantity },
            (_, i) => ({
              id: ids[i],
              title: `模拟方案 ${i + 1}`,
              prompt: `  模拟完整提示词 ${i + 1}。\n保留原段落与空格。  `,
            }),
          ),
        });
      } else {
        const batch = item.batches.find((b) => b.runId === runId);
        for (const variant of batch.variants) {
          const output = path.join(DATA_ROOT, `fixture-${variant.id}.png`);
          await sharp({
            create: {
              width: 24,
              height: 32,
              channels: 3,
              background: { r: variant.index * 40, g: 90, b: 50 },
            },
          })
            .png()
            .toFile(output);
          await attachCreationOutput(id, runId, variant.id, output);
        }
      }
      send({
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      });
    } catch (error) {
      send({
        method: 'turn/completed',
        params: {
          threadId,
          turn: {
            id: turnId,
            status: 'failed',
            error: { message: error.message },
          },
        },
      });
    }
  }
}
