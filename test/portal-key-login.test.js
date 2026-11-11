'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function waitForHealth(origin, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`portal exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch (_) { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('portal did not become healthy');
}

test('ordinary API key opens a USD-scoped portal session without browser key persistence', async (t) => {
  let proxiedCookie;
  const upstream = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer sk-ordinary-key') {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'invalid_key' }));
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/usage/token/') {
      return res.end(JSON.stringify({
        data: {
          quota_mode: 'money',
          billing_basis: 'money',
          currency: 'USD',
          quota_per_unit: 500000,
          total_granted: 500000,
          total_used: 125000,
          total_available: 375000,
          total_granted_usd: 1,
          total_used_usd: 0.25,
          total_available_usd: 0.75,
          unlimited_quota: false,
          model_limits_enabled: false,
          model_limits: {},
        },
      }));
    }
    if (req.url === '/api/log/token') {
      return res.end(JSON.stringify({
        data: [{
          type: 2,
          request_id: 'request-1',
          model_name: 'gpt-test',
          quota: 125000,
          prompt_tokens: 10,
          completion_tokens: 2,
          created_at: Math.floor(Date.now() / 1000),
        }],
      }));
    }
    if (req.url === '/v1/models') {
      return res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
    }
    if (req.url === '/v1/models?proxy=1') {
      proxiedCookie = req.headers.cookie;
      res.setHeader('set-cookie', '__Host-api_portal_session=upstream-overwrite; Secure; Path=/');
      return res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
    }
    res.statusCode = 404;
    return res.end('{}');
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const probe = http.createServer();
  const portalPort = await listen(probe);
  await close(probe);
  const portalOrigin = `http://127.0.0.1:${portalPort}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(portalPort),
      UPSTREAM_BASE: `http://127.0.0.1:${upstreamPort}`,
      PASSTHROUGH: '1',
      PUBLIC_ORIGIN: portalOrigin,
      TRUST_PROXY: '1',
      PORTAL_LOGIN_MAX_ATTEMPTS: '3',
      PORTAL_LOGIN_BODY_BYTES: '1024',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  t.after(() => {
    if (child.exitCode == null) child.kill('SIGTERM');
  });
  await waitForHealth(portalOrigin, child);

  const login = await fetch(`${portalOrigin}/api/portal/me`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.1, 203.0.113.9',
    },
    body: JSON.stringify({ key: 'sk-ordinary-key', refresh: true }),
  });
  assert.equal(login.status, 200, stderr);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(setCookie, /ordinary-key/);
  const payload = await login.json();
  assert.equal(payload.currency, 'USD');
  assert.equal(payload.limit_usd, 1);
  assert.equal(payload.used_usd, 0.25);
  assert.equal(payload.remaining_usd, 0.75);
  assert.equal(payload.remaining_credits, undefined);
  assert.equal(payload.analytics.recent[0].usd, 0.25);
  assert.equal(payload.analytics.by_model[0].usd, 0.25);
  assert.equal(payload.analytics.by_model[0].credits, undefined);
  assert.equal(payload.analytics.tokens_by_day.at(-1).usd, 0.25);
  assert.equal(payload.analytics.tokens_by_day.at(-1).credits, undefined);

  const restored = await fetch(`${portalOrigin}/api/portal/me`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: setCookie.split(';', 1)[0],
    },
    body: '{}',
  });
  assert.equal(restored.status, 200, stderr);
  assert.equal((await restored.json()).remaining_usd, 0.75);

  const proxied = await fetch(`${portalOrigin}/v1/models?proxy=1`, {
    headers: {
      authorization: 'Bearer sk-ordinary-key',
      cookie: setCookie.split(';', 1)[0],
    },
  });
  assert.equal(proxied.status, 200, stderr);
  assert.equal(proxiedCookie, undefined, 'portal session cookie must not cross the proxy boundary');
  assert.equal(proxied.headers.get('set-cookie'), null, 'upstream cookies must not reach the browser');

  for (const [index, suffix] of ['one', 'two'].entries()) {
    const rejected = await fetch(`${portalOrigin}/api/portal/me`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${index + 2}, 203.0.113.9`,
      },
      body: JSON.stringify({ key: `sk-invalid-${suffix}`, refresh: true }),
    });
    assert.equal(rejected.status, 401, stderr);
  }
  const limited = await fetch(`${portalOrigin}/api/portal/me`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.99, 203.0.113.9',
    },
    body: JSON.stringify({ key: 'sk-invalid-three', refresh: true }),
  });
  assert.equal(limited.status, 429, stderr);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  const oversized = await fetch(`${portalOrigin}/api/portal/me`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: `sk-${'x'.repeat(2048)}` }),
  });
  assert.equal(oversized.status, 413, stderr);

  const logout = await fetch(`${portalOrigin}/api/portal/logout`, {
    method: 'POST',
    headers: { cookie: setCookie.split(';', 1)[0] },
  });
  assert.equal(logout.status, 200, stderr);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  const afterLogout = await fetch(`${portalOrigin}/api/portal/me`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: setCookie.split(';', 1)[0],
    },
    body: '{}',
  });
  assert.equal(afterLogout.status, 400, stderr);
});
