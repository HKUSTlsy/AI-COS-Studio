#!/usr/bin/env node
// Inert protocol fixture: no model calls, file writes, or shell tools.
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let index; (index = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') send({ id: message.id, result: {} });
    if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-fixture' } } });
    if (message.method === 'turn/start') {
      if (process.env.AI_COS_TEST_EARLY === '1') send({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed' } } });
      send({ id: message.id, result: { turn: { id: 'turn-fixture' } } });
    }
    if (message.method === 'turn/interrupt') {
      send({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id: 'turn-fixture', status: 'interrupted' } } });
      setTimeout(() => send({ id: message.id, result: {} }), 300);
    }
  }
});
