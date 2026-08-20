'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const children = [];
let shuttingDown = false;

function run(label, file, env = {}) {
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (data) => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${label}] ${data}`));
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[demo] ${label} exited with code ${code}`);
      shutdown(code || 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 100).unref();
}

run('upstream', 'dev/mock-upstream.js');
run('portal', 'server.js', {
  HOST: '127.0.0.1',
  PORT: process.env.PORT || '3401',
  UPSTREAM_BASE: 'http://127.0.0.1:3501',
  UPSTREAM_KEY: 'demo-upstream-key',
  CLIENT_KEYS: 'demo-key',
  PASSTHROUGH: '0',
  UPSTREAM_DASHBOARD_TOKEN: 'demo-management-token',
  PORTAL_NAME: 'API PORTAL / DEMO',
  PUBLIC_ORIGIN: `http://127.0.0.1:${process.env.PORT || '3401'}`,
  CREDITS_PER_USD: '10000',
});

console.log('[demo] open http://127.0.0.1:3401 and sign in with: demo-key');
console.log('[demo] press Ctrl+C to stop both processes');

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
