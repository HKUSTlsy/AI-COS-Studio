import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['server/local-api.mjs'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(
    process.execPath,
    [
      'node_modules/vinext/dist/cli.js',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      '4317',
    ],
    { stdio: 'inherit', env: process.env },
  ),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250).unref();
}

for (const child of processes)
  child.on('exit', (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
