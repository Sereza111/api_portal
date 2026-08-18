'use strict';

/**
 * API portal + transparent proxy to a New API-compatible upstream
 *
 *   GET  /                        -> our own portal (public/index.html)
 *   POST /api/portal/me           -> key info + usage analytics (from upstream.example)
 *   GET  /api/model-status        -> per-model availability + our own latency
 *   GET  /api/pricing             -> model prices in credits
 *   GET  /api/news                -> news banner items
 *   GET  /api/config              -> base_url for the frontend
 *   ANY  /v1/*                    -> transparent proxy to https://upstream.example/v1/*
 *
 * Client keys listed in CLIENT_KEYS are swapped for the real upstream key, so
 * the upstream key never leaves the server. Any other key is forwarded as-is
 * (upstream validates it), which lets upstream.example customers use our domain too.
 *
 * Zero npm dependencies — plain node:http / node:https, fully streaming (SSE ok).
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { buildAnalytics, normalizeLogRows } = require('./lib/analytics');
const { classifyModelHealth } = require('./lib/health');
const {
  publicBaseUrlFor,
  publicOriginFor,
  statusUrlFor,
} = require('./lib/public-url');

const PORT = parseInt(process.env.PORT || '3401', 10);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://upstream.example').replace(/\/+$/, '');
const UPSTREAM_KEY = process.env.UPSTREAM_KEY || '';
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const STATUS_URL = (process.env.STATUS_URL || '').replace(/\/+$/, '');
const API_PATH = '/' + String(process.env.API_PATH || 'v1').replace(/^\/+|\/+$/g, '');
const TRUST_PROXY = (process.env.TRUST_PROXY || '1') !== '0';
const PORTAL_NAME = String(process.env.PORTAL_NAME || 'API PORTAL').trim() || 'API PORTAL';
const MAX_BODY = parseInt(process.env.MAX_BODY_BYTES || String(64 * 1024 * 1024), 10);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const NEWS_FILE = process.env.NEWS_FILE || path.join(__dirname, 'news.json');

const CLIENT_KEYS = new Set(
  (process.env.CLIENT_KEYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// When on, a client key that is NOT in CLIENT_KEYS is forwarded upstream
// unchanged (clients bring their own upstream.example key).
const PASSTHROUGH = (process.env.PASSTHROUGH || '1') !== '0';

// ---- upstream dashboard session (status telemetry only) ----
// /api/service-status is a DASHBOARD endpoint: a Bearer API key is rejected, it
// only accepts a browser session cookie AND a New-Api-User header carrying the
// numeric account id. Both are required -- cookie alone answers
// "Unauthorized, New-Api-User header not provided" and a wrong id answers
// "New-Api-User does not match logged in user".
//
// This is the provider's own aggregated telemetry (24h uptime and latency per
// model, 30-minute buckets), which is far better than what we can infer from our
// own traffic. Sessions expire, so every consumer must survive it going 401.
const UPSTREAM_SESSION = process.env.UPSTREAM_SESSION || '';
const UPSTREAM_SESSION_USER = process.env.UPSTREAM_SESSION_USER || '';

if (!UPSTREAM_KEY && CLIENT_KEYS.size) {
  console.error('[portal] FATAL: CLIENT_KEYS set but UPSTREAM_KEY is empty');
  process.exit(1);
}
if (!UPSTREAM_KEY && !PASSTHROUGH) {
  console.error('[portal] FATAL: need UPSTREAM_KEY or PASSTHROUGH=1');
  process.exit(1);
}

// ---- credit economy ----------------------------------------------------
// The upstream bills in its own "quota" units that are just US dollars in a
// fixed scale: 500 000 quota == $1 (verified against every model on the
// upstream price list). We never expose that: the portal speaks only in our
// own credits.
//
//   credits = quota * CREDITS_PER_USD / UPSTREAM_QUOTA_PER_USD
//
// With the default 10 000 credits per $1 of upstream cost, 1 credit is worth
// $0.0001 upstream and the quota->credit divisor is a clean 50. The markup is
// NOT applied here on purpose: balance and prices must scale by the same
// factor or the numbers stop adding up. Margin is made on the sale price of a
// credit pack, not on the accounting rate.
const UPSTREAM_QUOTA_PER_USD = 500000;
const CREDITS_PER_USD = Number(process.env.CREDITS_PER_USD || 10000);
const QUOTA_TO_CREDIT = CREDITS_PER_USD / UPSTREAM_QUOTA_PER_USD;

/** Upstream quota -> our credits. */
function toCredits(quota, decimals = 2) {
  const v = Number(quota || 0) * QUOTA_TO_CREDIT;
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * Plan label key for the portal.
 *
 * Every key sold is the same product -- credits that do not expire -- so there
 * is one label and no tiering. The previous size-derived ladder (Старт/Базовый/
 * Про/Максимум) implied service levels that do not exist: a small package and a
 * large one get identical models, rate limit and support.
 *
 * The upstream key's own name is never used here: it is an internal label
 * ("Ключ реселлера") that leaks how the account is provisioned. Only a key is
 * returned; the frontend owns the display text so both languages stay in the
 * i18n table.
 */
const PLAN_TIER = 'nolimit';

function planTierFor() {
  return PLAN_TIER;
}

/**
 * Some upstream models are billed with a tiered expression instead of a flat
 * ratio, e.g.
 *   len <= 272000 ? tier("short_context", p * 2.5 + c * 15 + cr * 0.25)
 *                 : tier("long_context",  p * 5   + c * 22.5 + cr * 0.5)
 * The flat `model_ratio` only describes the cheap tier, so a long request costs
 * more than the published price. We extract the threshold and the ratio between
 * the two tiers' prompt coefficients so the portal can warn about it.
 * Returns null when the model has no tiering or the expression is unparseable.
 */
function longContextTier(row) {
  const expr = row && typeof row.billing_expr === 'string' ? row.billing_expr : '';
  if (!expr) return null;
  const thr = expr.match(/len\s*<=?\s*(\d+)/);
  if (!thr) return null;
  // Prompt coefficient of each branch, in source order: short then long.
  const coeffs = [...expr.matchAll(/\bp\s*\*\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (coeffs.length < 2) return null;
  const [short, long] = coeffs;
  if (!(short > 0) || !(long > 0)) return null;
  const multiplier = Math.round((long / short) * 100) / 100;
  if (!(multiplier > 1)) return null;
  return { threshold: Number(thr[1]), multiplier };
}

/**
 * The upstream charges model_ratio * group_ratio, where group_ratio is a
 * per-model map keyed by billing group ("default" for our key). Missing or
 * malformed maps fall back to the catalog-level map and finally to 1, so a
 * price never silently collapses to zero.
 */
function groupRatioOf(row, fallback = null, group = 'default') {
  for (const src of [row && row.group_ratio, fallback]) {
    if (src && typeof src === 'object') {
      const v = Number(src[group]);
      if (Number.isFinite(v) && v > 0) return v;
      const first = Object.values(src).map(Number).find((x) => Number.isFinite(x) && x > 0);
      if (first) return first;
    }
  }
  return 1;
}

const UP = new URL(UPSTREAM_BASE);
const upstreamLib = UP.protocol === 'https:' ? https : http;
const agent = new upstreamLib.Agent({ keepAlive: true, maxSockets: 256 });

function publicUrlOptions() {
  return {
    publicOrigin: PUBLIC_ORIGIN,
    publicBaseUrl: PUBLIC_BASE_URL,
    statusUrl: STATUS_URL,
    apiPath: API_PATH,
    trustProxy: TRUST_PROXY,
  };
}

// ---------------------------------------------------------------- helpers

const STRIP_REQ = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length',
  'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-real-ip',
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
]);

const STRIP_RES = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
  'content-length', 'content-encoding',
  'strict-transport-security', 'alt-svc', 'report-to', 'nel',
  'cf-ray', 'cf-cache-status', 'server',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, obj) {
  if (res.headersSent) { try { res.end(); } catch (_) {} return; }
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function jsonError(res, status, code, message) {
  sendJson(res, status, { error: { message, type: 'invalid_request_error', code } });
}

function extractClientKey(req) {
  const auth = req.headers['authorization'];
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(String(auth).trim());
    if (m) return m[1].trim();
    return String(auth).trim();
  }
  const xk = req.headers['x-api-key'];
  if (xk) return String(xk).trim();
  return '';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload_too_large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Resolve which key we actually send upstream for a given client key. */
function resolveUpstreamKey(clientKey) {
  if (CLIENT_KEYS.has(clientKey)) return { key: UPSTREAM_KEY, ours: true };
  if (PASSTHROUGH) return { key: clientKey, ours: false };
  return null;
}

/** Simple JSON GET against the upstream API using a bearer key. */
function upstreamGet(pathname, bearer, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const req = upstreamLib.request({
      agent,
      method: 'GET',
      hostname: UP.hostname,
      port: UP.port || (UP.protocol === 'https:' ? 443 : 80),
      path: pathname,
      servername: UP.hostname,
      headers: {
        host: UP.host,
        authorization: 'Bearer ' + bearer,
        accept: 'application/json',
        'accept-encoding': 'identity',
        'user-agent': 'api-portal/1.0',
      },
    }, (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* non-JSON */ }
        resolve({ status: up.statusCode || 0, json, raw });
      });
      up.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    req.end();
  });
}

/**
 * JSON GET against the upstream DASHBOARD API using the session cookie.
 *
 * Separate from upstreamGet() because the auth shape is different: no Bearer
 * (it is rejected outright), and both the session cookie and New-Api-User are
 * mandatory. Referer is sent because the dashboard rejects some requests
 * without it.
 */
function upstreamDashGet(pathname, timeoutMs = 15000) {
  if (!UPSTREAM_SESSION || !UPSTREAM_SESSION_USER) {
    return Promise.resolve({ status: 0, json: null, raw: '' });
  }
  return new Promise((resolve) => {
    const req = upstreamLib.request({
      agent,
      method: 'GET',
      hostname: UP.hostname,
      port: UP.port || (UP.protocol === 'https:' ? 443 : 80),
      path: pathname,
      servername: UP.hostname,
      headers: {
        host: UP.host,
        cookie: 'session=' + UPSTREAM_SESSION,
        'new-api-user': String(UPSTREAM_SESSION_USER),
        accept: 'application/json',
        'accept-encoding': 'identity',
        referer: UPSTREAM_BASE + '/service-status',
        'user-agent': 'api-portal/1.0',
      },
    }, (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* non-JSON */ }
        resolve({ status: up.statusCode || 0, json, raw });
      });
      up.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    req.end();
  });
}

// ------------------------------------------------------------ model telemetry
// Live per-model health, measured on the traffic that already flows through our
// own /v1 proxy. Active probing was rejected: a single chat probe took 40s,
// costs real money per model, and shares the upstream per-key rate-limit budget
// with the portal. Observing real requests costs nothing and cannot be
// throttled.
const MODEL_STAT_WINDOW_MS = 30 * 60 * 1000;
const MODEL_STAT_MAX_SAMPLES = 200;
const modelStats = new Map();

function recordModelCall(model, status, latencyMs) {
  if (!model) return;
  const now = Date.now();
  let s = modelStats.get(model);
  if (!s) {
    s = { samples: [] };
    modelStats.set(model, s);
  }
  s.samples.push({ at: now, status, latencyMs });
  if (s.samples.length > MODEL_STAT_MAX_SAMPLES) {
    s.samples.splice(0, s.samples.length - MODEL_STAT_MAX_SAMPLES);
  }
}

function modelStatsFor(model) {
  const s = modelStats.get(model);
  if (!s) return null;
  const cutoff = Date.now() - MODEL_STAT_WINDOW_MS;
  const rows = s.samples.filter((x) => x.at >= cutoff);
  if (!rows.length) return null;
  // 401/403 is the client's key problem, not the model's, so it must not drag
  // the model's health down.
  const counted = rows.filter((x) => x.status !== 401 && x.status !== 403);
  if (!counted.length) return null;
  const ok = counted.filter((x) => x.status >= 200 && x.status < 300);
  const lat = ok.map((x) => x.latencyMs).sort((a, b) => a - b);
  return {
    requests: counted.length,
    success_pct: Number(((ok.length / counted.length) * 100).toFixed(1)),
    latency_ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    last_at: rows[rows.length - 1].at,
  };
}

/** Best-effort model name from an OpenAI/Anthropic-style request body. */
function modelFromBody(bodyBuf) {
  if (!bodyBuf || !bodyBuf.length || bodyBuf.length > 2 * 1024 * 1024) return '';
  try {
    const j = JSON.parse(bodyBuf.toString('utf8'));
    return j && typeof j.model === 'string' ? j.model : '';
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------- /v1 proxy

function proxy(req, res, { path: reqPath, bearer, publicOrigin }) {
  const outHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQ.has(k.toLowerCase())) continue;
    outHeaders[k] = v;
  }
  outHeaders['host'] = UP.host;
  outHeaders['accept-encoding'] = 'identity';
  if (bearer) {
    outHeaders['authorization'] = 'Bearer ' + bearer;
    delete outHeaders['x-api-key'];
  }

  const doRequest = (bodyBuf) => {
    if (bodyBuf && bodyBuf.length) outHeaders['content-length'] = String(bodyBuf.length);
    else delete outHeaders['content-length'];

    // Passive health sampling: we already have the model name and the response
    // status here, so per-model stats cost nothing extra.
    const statModel = modelFromBody(bodyBuf);
    const startedAt = Date.now();

    const upReq = upstreamLib.request({
      agent,
      method: req.method,
      hostname: UP.hostname,
      port: UP.port || (UP.protocol === 'https:' ? 443 : 80),
      path: reqPath,
      headers: outHeaders,
      servername: UP.hostname,
    }, (up) => {
      const resHeaders = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (STRIP_RES.has(k.toLowerCase())) continue;
        resHeaders[k] = v;
      }
      if (resHeaders['location']) {
        resHeaders['location'] = String(resHeaders['location'])
          .split(UPSTREAM_BASE).join(publicOrigin);
      }
      recordModelCall(statModel, up.statusCode || 502, Date.now() - startedAt);
      if (!res.headersSent) res.writeHead(up.statusCode || 502, resHeaders);
      up.pipe(res);
      up.on('error', () => { if (!res.writableEnded) res.end(); });
    });

    upReq.on('error', (err) => {
      console.error('[portal] upstream error:', err.message);
      recordModelCall(statModel, 0, Date.now() - startedAt);
      jsonError(res, 502, 'bad_gateway', 'Upstream request failed: ' + err.message);
    });
    upReq.setTimeout(0);

    if (bodyBuf && bodyBuf.length) upReq.end(bodyBuf);
    else upReq.end();
  };

  if (req.method === 'GET' || req.method === 'HEAD') doRequest(null);
  else {
    readBody(req).then(doRequest).catch((err) => {
      if (err && err.tooLarge) jsonError(res, 413, 'payload_too_large', 'Request body too large');
      else jsonError(res, 400, 'bad_request', 'Failed to read request body');
    });
  }
}

// ---------------------------------------------------------------- portal data

// Per-key snapshot cache. Each portal login fans out to three upstream
// endpoints, and upstream.example rate-limits that burst, so a plain page refresh
// would otherwise hand the user a 429. Fresh hits are served from cache and a
// rate-limited refresh falls back to the last good snapshot.
const ME_TTL_MS = 60 * 1000;
const ME_STALE_MS = 10 * 60 * 1000;
const ME_CACHE_MAX = 200;
const meCache = new Map();

// The upstream rate-limits per KEY (an unauthenticated call is rejected with
// 401, not 429), sharing one budget across /api/usage/token/ and
// /api/log/token: measured at ~8 calls per 15s window, recovering after 15s.
// A cold login used to burn three calls at once, so three refreshes tripped it.
// Three defences, cheapest first:
//   1. ENTITLED_TTL_MS - the model list barely changes, so it is fetched on its
//                       own long TTL instead of on every login.
//   2. meInflight     - concurrent logins with the same key share one fetch
//                       instead of multiplying the burst.
//   3. ME_MIN_GAP_MS  - a hard floor between upstream refreshes per key; inside
//                       the gap we serve the cached snapshot rather than risk
//                       spending the budget.
const ME_MIN_GAP_MS = 10 * 1000;
const UPSTREAM_RETRY_AFTER_S = 15;
const meInflight = new Map();
const lastUpstreamHit = new Map();

// ---- what a given key may call ----
// Entitlement is a property of the KEY, not of our server: two clients can hold
// keys with different model sets (7 vs 18 observed live). One shared cache feeds
// the "available models" chips, the price list and the status list, so all three
// always describe the same set.
//
// Keyed by hash of the UPSTREAM key, not the client key: every allowlisted
// client key resolves to the same upstream token, so keying by client would hold
// N identical copies and spend N /v1/models calls to learn one thing. Long TTL,
// entitlement changes far slower than usage does.
const ENTITLED_TTL_MS = 10 * 60 * 1000;
const entitledCache = new Map();
const entitledInflight = new Map();

async function getEntitledFor(upstreamKey) {
  const ck = meCacheKey(upstreamKey);
  const hit = entitledCache.get(ck);
  if (hit && Date.now() - hit.at < ENTITLED_TTL_MS) return hit.ids;

  // Collapse concurrent refreshes: the dashboard asks for chips, prices and
  // status at once, and three identical /v1/models calls would burn the same
  // per-key rate-limit budget to learn one thing.
  let job = entitledInflight.get(ck);
  if (!job) {
    job = (async () => {
      const r = await upstreamGet('/v1/models', upstreamKey, 8000);
      const ids = r.json && Array.isArray(r.json.data)
        ? r.json.data.map((m) => m.id).filter(Boolean)
        : null;
      // A failed refresh keeps the previous list. Publishing "no models" to a
      // client whose key is perfectly fine would be worse than a stale list.
      if (ids && ids.length) {
        if (entitledCache.size >= ME_CACHE_MAX) {
          const oldest = entitledCache.keys().next().value;
          if (oldest !== undefined) entitledCache.delete(oldest);
        }
        entitledCache.set(ck, { at: Date.now(), ids });
      }
      const cur = entitledCache.get(ck);
      return cur ? cur.ids : [];
    })().finally(() => entitledInflight.delete(ck));
    entitledInflight.set(ck, job);
  }
  return job;
}

function meCacheKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function meCacheGet(key) {
  const hit = meCache.get(meCacheKey(key));
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age > ME_STALE_MS) return null;
  return { payload: hit.payload, age, fresh: age < ME_TTL_MS };
}

function meCacheDrop(key) {
  meCache.delete(meCacheKey(key));
}

function meCacheSet(key, payload) {
  if (meCache.size >= ME_CACHE_MAX) {
    const oldest = meCache.keys().next().value;
    if (oldest !== undefined) meCache.delete(oldest);
  }
  meCache.set(meCacheKey(key), { at: Date.now(), payload });
}

async function handlePortalMe(req, res) {
  let body = null;
  try {
    const buf = await readBody(req);
    body = buf && buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch (_) {
    return jsonError(res, 400, 'bad_request', 'Malformed JSON body');
  }

  const clientKey = (body && body.key ? String(body.key) : '').trim() || extractClientKey(req);
  if (!clientKey) return jsonError(res, 400, 'missing_key', 'API key is required');

  const resolved = resolveUpstreamKey(clientKey);
  if (!resolved) return sendJson(res, 401, { error: 'invalid_key' });

  const cached = meCacheGet(clientKey);
  if (cached && cached.fresh) {
    return sendJson(res, 200, { ...cached.payload, cached: true });
  }

  const ck = meCacheKey(clientKey);

  // Hard floor between upstream refreshes for one key. Inside the gap we would
  // only be spending the shared rate-limit budget to learn nothing new, so serve
  // the snapshot we already have instead of risking a 429.
  const sinceHit = Date.now() - (lastUpstreamHit.get(ck) || 0);
  if (cached && sinceHit < ME_MIN_GAP_MS) {
    return sendJson(res, 200, { ...cached.payload, cached: true, stale_ms: cached.age });
  }

  // Collapse concurrent refreshes of the same key into one upstream round-trip.
  let job = meInflight.get(ck);
  if (!job) {
    job = fetchMeSnapshot(
      clientKey,
      resolved,
      cached,
      publicBaseUrlFor(req, publicUrlOptions()),
    ).finally(() => meInflight.delete(ck));
    meInflight.set(ck, job);
  }
  const out = await job;
  return sendJson(res, out.status, out.body);
}

async function fetchMeSnapshot(clientKey, resolved, cached, baseUrl) {
  lastUpstreamHit.set(meCacheKey(clientKey), Date.now());

  // Only ONE guaranteed per-key call now: the model list rides its own long TTL
  // and the request log goes through the shared per-key cache that the status
  // list also reads. Fetching the log directly here meant a login spent two
  // calls on the same rows, which is exactly the budget that trips the 429.
  const [usage, logRes, modelIdsCached] = await Promise.all([
    upstreamGet('/api/usage/token/', resolved.key),
    getUpstreamLogResult(resolved.key),
    getEntitledFor(resolved.key),
  ]);
  const models = { json: { data: (modelIdsCached || []).map((id) => ({ id })) } };

  // Only a genuine auth rejection means "bad key". Rate limits and upstream
  // faults must NOT be reported as invalid_key, otherwise a 429 looks to the
  // user like their key stopped working.
  if (usage.status === 401 || usage.status === 403) {
    meCacheDrop(clientKey);
    return { status: 401, body: { error: 'invalid_key' } };
  }

  // Transient upstream trouble: serve the last good snapshot if we have one,
  // so a refresh during a rate-limit window still shows the dashboard.
  const transient = usage.status === 429 || usage.status >= 500 || !usage.status || !(usage.json && usage.json.data);
  if (transient) {
    if (cached) return { status: 200, body: { ...cached.payload, cached: true, stale_ms: cached.age } };
    // No snapshot to fall back on: tell the client how long to wait instead of
    // leaving the retry timing to guesswork.
    if (usage.status === 429) {
      return { status: 429, body: { error: 'rate_limited', retry_after: UPSTREAM_RETRY_AFTER_S } };
    }
    if (!usage.status) return { status: 502, body: { error: 'upstream_unreachable' } };
    return { status: 502, body: { error: 'upstream_error', status: usage.status } };
  }

  const u = usage.json.data;

  const granted = Number(u.total_granted || 0);
  const used = Number(u.total_used || 0);
  const available = u.total_available != null ? Number(u.total_available) : Math.max(0, granted - used);
  const unlimited = !!u.unlimited_quota;

  const modelIds = models.json && Array.isArray(models.json.data)
    ? models.json.data.map((m) => m.id).filter(Boolean)
    : [];
  const limits = u.model_limits_enabled && u.model_limits && Object.keys(u.model_limits).length
    ? Object.keys(u.model_limits)
    : null;

  // The log endpoint is rate-limited independently of the usage endpoint: it
  // can 429 while the balance comes back fine. buildAnalytics(null) would then
  // publish a zeroed history (0 requests, empty chart) as if the client had
  // never called the API. Keep the previous snapshot's analytics instead, and
  // don't let a degraded snapshot become the cached "last good" one.
  const logRows = logRes && logRes.ok ? logRes.rows : null;
  const analyticsDegraded = logRows === null;
  const cachedAnalytics = cached && cached.payload && cached.payload.analytics;
  const analytics = analyticsDegraded
    ? cachedAnalytics || null
    : buildAnalytics(logRows, toCredits);
  const analyticsStatus = analyticsDegraded
    ? (cachedAnalytics ? 'stale' : 'unavailable')
    : 'live';

  const payload = {
    // The upstream key's own name is an internal label (e.g. "Ключ реселлера")
    // and must not surface in the portal. One fixed label for every key: the
    // product is the same regardless of package size.
    plan_tier: planTierFor(),
    balance_mode: 'package',
    unlimited,
    // Balance is published in our own credits only. The upstream quota numbers
    // (and the dollars behind them) never reach the client.
    currency: 'credits',
    limit_credits: unlimited ? 0 : toCredits(granted),
    used_credits: toCredits(used),
    remaining_credits: unlimited ? null : toCredits(available),
    held_credits: 0,
    expires_at: u.expires_at ? new Date(Number(u.expires_at) * 1000).toISOString() : null,
    allowed_models: limits || modelIds,
    analytics,
    analytics_status: analyticsStatus,
    synced_at: new Date().toISOString(),
    _base_url: baseUrl,
  };

  // A snapshot with borrowed/empty analytics must not overwrite the last good
  // one, or the gap would outlive the rate-limit window.
  if (!analyticsDegraded) meCacheSet(clientKey, payload);
  return { status: 200, body: payload };
}

// ---- model pricing (live from upstream, cached) ----
// The provider's price list is the same for everyone, so the raw catalog is
// cached once globally. What differs per client is ENTITLEMENT: the visitor's
// key may be allowed 18 models while our own reseller key is allowed 7. Pricing
// is therefore computed from the shared catalog and filtered with the caller's
// own entitlement -- publishing our set to every visitor made the price/status
// list disagree with the "available models" chips right next to it.
const PRICING_TTL_MS = 10 * 60 * 1000;
let catalogCache = { at: 0, rows: null, group: null };
let catalogInflight = null;

async function getCatalog(upstreamKey) {
  if (catalogCache.rows && Date.now() - catalogCache.at < PRICING_TTL_MS) return catalogCache;
  if (catalogInflight) return catalogInflight;

  catalogInflight = (async () => {
    const r = await upstreamGet('/api/pricing', UPSTREAM_KEY || upstreamKey, 10000);
    const rows = r.json && Array.isArray(r.json.data) ? r.json.data : null;
    if (rows) {
      catalogCache = {
        at: Date.now(),
        rows,
        group: r.json && r.json.group_ratio ? r.json.group_ratio : null,
      };
    } else {
      catalogCache.at = Date.now(); // back off on failure, keep old rows
    }
    return catalogCache;
  })().finally(() => { catalogInflight = null; });

  return catalogInflight;
}

/**
 * opts.all = ignore entitlement and return the whole provider catalog.
 *
 * Only the public status subdomain uses it: that page reports what the SERVICE
 * offers, not what one key may call, so filtering it by our own reseller key
 * showed 7 of 19 models and read like the rest were missing. Nothing is
 * purchased from that page, so listing a model the visitor's future key may not
 * have cannot produce a surprise 403 the way the dashboard price list would.
 */
async function getPricingFor(upstreamKey, opts) {
  const includeAll = !!(opts && opts.all);
  const [cat, entitled] = await Promise.all([
    getCatalog(upstreamKey),
    includeAll ? null : getEntitledFor(upstreamKey),
  ]);
  const rows = cat && cat.rows;
  if (!rows) return { currency: 'credits', unit: '1M', items: [] };
  // Unknown entitlement (cold start + upstream failure) publishes NOTHING. The
  // old fallback published the whole catalog, which advertised 19 models to a
  // key entitled to 7 -- every extra one answers 403 "This token has no access
  // to model ...". An empty payload makes the frontend keep its previous render
  // and retry, so a transient blip costs a stale list instead of a wrong one.
  if (!includeAll && (!entitled || !entitled.length)) {
    return { currency: 'credits', unit: '1M', items: [] };
  }
  const allowed = includeAll ? null : new Set(entitled);

  // Upstream quota for 1M tokens = model_ratio * group_ratio * 1e6, converted
  // straight into credits with the same rate used for balances. Both sides must
  // share one rate, otherwise the published price stops matching what actually
  // gets deducted. Margin lives in the sale price of a credit pack, not here.
  const groupFallback = cat.group;
  const items = rows
    .map((m) => {
      const ratio = Number(m.model_ratio || 0);
      const compl = Number(m.completion_ratio || 0);
      const group = groupRatioOf(m, groupFallback);
      const perM = (x) => toCredits(x * group * 1e6, 2);
      const perCallQuota = Number(m.quota_type) === 1
        ? Number(m.model_price || 0) * UPSTREAM_QUOTA_PER_USD * group
        : null;
      const tier = longContextTier(m);
      return {
        model: m.model_name || '',
        input_credits: ratio > 0 ? perM(ratio) : null,
        output_credits: ratio > 0 && compl > 0 ? perM(ratio * compl) : null,
        cache_credits: ratio > 0 && Number(m.cache_ratio || 0) > 0
          ? perM(ratio * Number(m.cache_ratio))
          : null,
        context_length: Number(m.context_length || 0),
        per_call_credits: perCallQuota != null ? toCredits(perCallQuota, 4) : null,
        // Some models cost more once a request crosses a context threshold.
        // Publishing only the cheap tier would understate the real charge.
        long_context_from: tier ? tier.threshold : null,
        long_context_multiplier: tier ? tier.multiplier : null,
        _sort: ratio > 0 ? ratio * group : Number(m.model_price || 0) * group,
      };
    })
    // Never publish a price for a model the key cannot call: it would return
    // 403 "This token has no access to model ...".
    .filter((x) => x.model && (!allowed || allowed.has(x.model)));

  items.sort((a, b) => (a._sort || 0) - (b._sort || 0));
  for (const it of items) delete it._sort;

  return { currency: 'credits', unit: '1M', items };
}

// ---- shared upstream request log ----
// /api/log/token shares the per-key rate-limit budget with the portal, so every
// consumer reads it through ONE cache per key instead of issuing its own call.
// A failed refresh keeps the previous rows so a rate-limit blip cannot erase
// history.
//
// Keyed per upstream key: the log endpoint only ever returns the rows of the
// token that asked, so serving our own rows to a passthrough client would
// describe traffic that is not theirs.
const LOG_TTL_MS = 60 * 1000;
const logCaches = new Map();
const logInflight = new Map();

// Returns { rows, ok }. `ok` is false only when we have never managed to read
// this key's log, which is the one case where an empty array must not be
// mistaken for "this key genuinely has no requests": callers that publish usage
// history need to tell those apart, or a rate-limited refresh would render a
// zeroed chart for a client with a perfectly good history.
async function getUpstreamLogResult(upstreamKey) {
  const ck = meCacheKey(upstreamKey);
  const hit = logCaches.get(ck);
  if (hit && Date.now() - hit.at < LOG_TTL_MS) return { rows: hit.rows, ok: hit.ok };

  const pending = logInflight.get(ck);
  if (pending) return pending;

  const job = (async () => {
    const r = await upstreamGet('/api/log/token', upstreamKey, 8000);
    const rows = r.json && Array.isArray(r.json.data) ? r.json.data : null;
    const prev = logCaches.get(ck);
    if (logCaches.size >= ME_CACHE_MAX && !logCaches.has(ck)) {
      const oldest = logCaches.keys().next().value;
      if (oldest !== undefined) logCaches.delete(oldest);
    }
    // Back off on failure but keep whatever rows we had: dropping to an empty
    // list would reset every model to "no data" during a rate-limit window.
    const entry = rows
      ? { at: Date.now(), rows, ok: true }
      : { at: Date.now(), rows: prev ? prev.rows : [], ok: prev ? prev.ok : false };
    logCaches.set(ck, entry);
    return { rows: entry.rows, ok: entry.ok };
  })().finally(() => { logInflight.delete(ck); });

  logInflight.set(ck, job);
  return job;
}

async function getUpstreamLog(upstreamKey) {
  return (await getUpstreamLogResult(upstreamKey)).rows;
}

/**
 * Per-model outcomes from the upstream request log.
 * type 2 = success, type 5 = error (observed live). This is the only signal that
 * survives a restart and that sees failures from other clients, which our
 * in-memory proxy telemetry cannot.
 */
function logStatsByModel(rows, windowSec) {
  const cutoff = Math.floor(Date.now() / 1000) - windowSec;
  const out = new Map();
  const normalized = normalizeLogRows(rows, toCredits).records;
  for (const r of normalized) {
    if (Number(r.created_at || 0) < cutoff) continue;
    const model = r.model;
    if (!model) continue;
    let s = out.get(model);
    if (!s) { s = { total: 0, ok: 0, useTimes: [] }; out.set(model, s); }
    s.total += 1;
    if (r.success) {
      s.ok += 1;
      const t = Number(r.latency_ms || 0);
      if (t > 0) s.useTimes.push(t);
    }
  }
  return out;
}

// ---- provider telemetry (authoritative health source) ----
// The upstream dashboard aggregates its OWN per-model health: 24h uptime,
// a coarse latency level and 48 half-hour buckets. That beats anything we can
// infer locally, because it sees every request the provider served, not just the
// slice that went through us -- our own log showed 0 requests for 12 of 19
// models while the provider had real numbers for them.
//
// One global cache, not per key: this is a property of the SERVICE, and the
// session belongs to our account regardless of which client asks.
const SERVICE_STATUS_TTL_MS = 60 * 1000;
// The provider accepts only these two windows: anything else answers 400
// "range must be 24h or 7d", so an unknown value is coerced instead of relayed.
const SERVICE_STATUS_RANGES = ['24h', '7d'];
function normalizeRange(v) {
  return SERVICE_STATUS_RANGES.includes(v) ? v : '24h';
}
// Cached per range, not globally: 24h and 7d are different measurements with
// different bucket widths, and one shared slot let whichever request landed
// first decide which window the other caller was shown.
const serviceStatusCache = new Map();
const serviceStatusInflight = new Map();

async function getServiceStatus(rangeRaw) {
  const range = normalizeRange(rangeRaw);
  const slot = serviceStatusCache.get(range);
  if (slot && slot.data && Date.now() - slot.at < SERVICE_STATUS_TTL_MS) {
    return slot.data;
  }
  const pending = serviceStatusInflight.get(range);
  if (pending) return pending;

  const job = (async () => {
    // 24h is the provider's default, so the parameter is only sent when it
    // actually changes the window.
    const qs = range === '24h' ? '' : '?range=' + encodeURIComponent(range);
    const r = await upstreamDashGet('/api/service-status' + qs, 10000);
    const d = r.json && r.json.success && r.json.data ? r.json.data : null;
    const rows = d && Array.isArray(d.models) ? d.models : null;
    if (!rows) {
      // Back off but keep the previous snapshot: an expired session must not
      // blank the page, it should keep showing the last known good telemetry.
      const prev = serviceStatusCache.get(range);
      const previous = prev && prev.data;
      const fallback = previous
        ? { ...previous, stale: true, last_attempt_at: new Date().toISOString() }
        : null;
      serviceStatusCache.set(range, { at: Date.now(), data: fallback });
      return fallback;
    }

    const byModel = new Map();
    for (const m of rows) {
      const name = m && m.model_name;
      if (!name) continue;
      const buckets = Array.isArray(m.buckets) ? m.buckets : [];
      // 'no_traffic' buckets carry a filler uptime of 100, so counting them as
      // measurements would report a model nobody called as verified healthy.
      const withData = buckets.filter((b) => b && b.state === 'data');
      byModel.set(name, {
        uptime: Number(m.uptime),
        latency_level: m.latency_level || null,
        active: m.active !== false,
        samples: withData.length,
        // Kept in wire order (oldest -> newest) for the timeline strip. Only the
        // fields the bar needs are copied: the raw payload is ~107 KB and the
        // page would pay for it on every 60s refresh.
        buckets: buckets.map((b) => ({
          t: Number(b.start_ts) || 0,
          s: b.state === 'data' ? 'data' : 'none',
          u: b.state === 'data' && Number.isFinite(Number(b.uptime)) ? Number(b.uptime) : null,
          l: b.latency_level || null,
          p: b.partial === true ? 1 : 0,
        })),
      });
    }

    const data = {
      models: byModel,
      overall_uptime: Number(d.overall_uptime),
      recent_uptime: Number(d.recent_uptime),
      range: d.range || null,
      // Width of one timeline bucket; the page labels the strip with it instead
      // of hardcoding "30 min", since ?range=7d switches it to 3h.
      bucket_seconds: Number(d.bucket_seconds) || null,
      generated_at: d.generated_at ? new Date(d.generated_at * 1000).toISOString() : null,
      stale: false,
      last_success_at: new Date().toISOString(),
    };
    serviceStatusCache.set(range, { at: Date.now(), data });
    return data;
  })().finally(() => { serviceStatusInflight.delete(range); });

  serviceStatusInflight.set(range, job);
  return job;
}

// ---- per-model status page ----
// Health is derived from observed traffic, not active probing: one chat probe
// took 40s, costs money per model, and shares the portal's per-key rate limit.
//
// Two list shapes, chosen by the caller:
//   * default    -- narrowed by getPricingFor() to models THIS key may actually
//                   call, because the dashboard sits next to a price list and
//                   an unusable model there answers 403 "This token has no
//                   access to model ...".
//   * opts.all   -- the whole provider catalog, for the public status subdomain:
//                   that page describes the SERVICE, and filtering it by our own
//                   reseller key showed 7 of 19 and read like the rest were gone.
//
// Cached per upstream key, since two keys can be entitled to different sets and
// a single shared snapshot showed our own 7 models to a client holding 18.
//
// Two traffic signals decide the state, log first:
//   * the upstream request log  = survives restarts, sees every client,
//   * our own proxy telemetry   = in-memory, only this process since boot.
const MODEL_STATUS_TTL_MS = 60 * 1000;
const modelStatusCache = new Map();

async function getModelStatus(upstreamKey, opts) {
  const includeAll = !!(opts && opts.all);
  const range = normalizeRange(opts && opts.range);
  const now = Date.now();
  // Separate cache slot for the unfiltered variant: it shares the upstream key
  // with the dashboard's own status call, so one slot would let whichever ran
  // first decide whether the other saw 7 models or all 19. The range joins the
  // key for the same reason: 24h and 7d are different measurements.
  const ck = (includeAll ? 'all:' : 'key:') + range + ':' + meCacheKey(upstreamKey);
  const hit = modelStatusCache.get(ck);
  if (hit && now - hit.at < MODEL_STATUS_TTL_MS) return hit.data;

  // getPricingFor() decides the set (entitled-only, or the full catalog when
  // includeAll), so the status list needs no entitlement check of its own.
  const [pricing, logRows, svc] = await Promise.all([
    getPricingFor(upstreamKey, { all: includeAll }),
    getUpstreamLog(upstreamKey),
    getServiceStatus(range),
  ]);

  const catalog = (pricing && pricing.items) || [];

  // Signal priority:
  //   1. provider telemetry  = every request the provider served, 24h window,
  //   2. the upstream request log = our token's traffic, survives restarts,
  //   3. our own proxy telemetry  = in-memory, this process only.
  // The provider's own numbers win because our log had zero rows for 12 of 19
  // models the provider had real uptime for.
  const byLog = logStatsByModel(logRows, 3 * 3600);
  const svcModels = (svc && svc.models) || null;

  const models = catalog.map((it) => {
    const local = modelStatsFor(it.model);
    const lg = byLog.get(it.model);
    const sv = svcModels ? svcModels.get(it.model) : null;

    const evidence = classifyModelHealth({ provider: sv, log: lg, local });
    const source = evidence.source;
    let requests = 0;
    let latency = null;
    let latencyLevel = null;
    let uptimePct = null;

    if (source === 'provider') {
      requests = Number(sv && sv.samples) || 0;
      uptimePct = sv && Number.isFinite(sv.uptime) ? Number(sv.uptime.toFixed(2)) : null;
      latencyLevel = (sv && sv.latency_level) || null;
    } else if (source === 'log') {
      requests = Number(lg && lg.total) || 0;
      if (lg && lg.useTimes.length) {
        const sorted = lg.useTimes.slice().sort((a, b) => a - b);
        latency = Math.round(sorted[Math.floor(sorted.length / 2)]);
      }
    } else if (source === 'local') {
      requests = Number(local && local.requests) || 0;
      latency = local && local.latency_ms;
    }

    const successPct = evidence.success_pct == null
      ? null
      : Number(evidence.success_pct.toFixed(1));

    return {
      model: it.model,
      state: evidence.state,
      requests,
      success_pct: requests ? successPct : null,
      latency_ms: latency,
      uptime_pct: uptimePct,
      latency_level: latencyLevel,
      source,
      // Half-hour timeline for the per-model strip, oldest -> newest.
      buckets: (sv && sv.buckets) || null,
    };
  });

  // Worst first so incidents lead the list.
  const order = { down: 0, degraded: 1, unknown: 2, available: 3 };
  models.sort((a, b) => (order[a.state] - order[b.state]) || a.model.localeCompare(b.model));

  const healthy = models.filter((m) => m.state === 'available').length;
  const bad = models.filter((m) => m.state === 'down' || m.state === 'degraded').length;
  const total = models.length;
  // 'unknown' is an absence of measurement, not an incident: counting it as
  // unhealthy would flip the banner to "partial outage" simply because a model
  // saw no traffic. Only observed failures move the banner off green.
  // An empty list means the catalog itself could not be read, not an outage.
  const overall = !total
    ? 'unknown'
    : bad === 0 ? 'operational'
    : bad === total ? 'outage'
    : 'partial';

  const data = {
    overall,
    available: healthy,
    total,
    models,
    // Provider-side aggregates, shown as the headline number when available.
    overall_uptime: svc && Number.isFinite(svc.overall_uptime) ? Number(svc.overall_uptime.toFixed(2)) : null,
    recent_uptime: svc && Number.isFinite(svc.recent_uptime) ? Number(svc.recent_uptime.toFixed(2)) : null,
    range: (svc && svc.range) || null,
    bucket_seconds: (svc && svc.bucket_seconds) || null,
    source: svcModels ? 'provider' : 'local',
    stale: Boolean(svc && svc.stale),
    updated_at: (svc && (svc.generated_at || svc.last_success_at)) || new Date(now).toISOString(),
  };
  if (modelStatusCache.size >= ME_CACHE_MAX) {
    const oldest = modelStatusCache.keys().next().value;
    if (oldest !== undefined) modelStatusCache.delete(oldest);
  }
  modelStatusCache.set(ck, { at: now, data });
  return data;
}

function readNews() {
  try {
    const raw = fs.readFileSync(NEWS_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.items)) return j.items;
    return [];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------- static

/**
 * Version stamp for /app.js and /style.css, derived from their size+mtime.
 * The HTML is served with no-cache while the assets are cached for minutes,
 * so without a changing query string a deploy leaves clients running the old
 * bundle until the TTL expires. Recomputed at most once a second.
 */
let assetVer = { at: 0, tag: '0' };
function assetVersion() {
  const now = Date.now();
  if (now - assetVer.at < 1000) return assetVer.tag;
  const parts = [];
  for (const f of ['app.js', 'style.css']) {
    try {
      const s = fs.statSync(path.join(PUBLIC_DIR, f));
      parts.push(`${s.size}-${Math.floor(s.mtimeMs)}`);
    } catch (_) {
      parts.push('0');
    }
  }
  assetVer = {
    at: now,
    tag: crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10),
  };
  return assetVer.tag;
}

function stampAssets(html) {
  const v = assetVersion();
  return html
    .replace(/(["'])\/app\.js(["'])/g, `$1/app.js?v=${v}$2`)
    .replace(/(["'])\/style\.css(["'])/g, `$1/style.css?v=${v}$2`);
}

async function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';

  const full = path.resolve(PUBLIC_DIR, rel);
  if (!full.startsWith(path.resolve(PUBLIC_DIR))) {
    return jsonError(res, 403, 'forbidden', 'Path traversal rejected');
  }

  let stat;
  try {
    stat = await fsp.stat(full);
    if (stat.isDirectory()) return false;
  } catch (_) {
    return false;
  }

  const ext = path.extname(full).toLowerCase();
  // HTML goes through the stamper so the asset URLs it points at change with
  // every deploy; content-length below would be wrong otherwise.
  if (ext === '.html') {
    const html = stampAssets(await fsp.readFile(full, 'utf8'));
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-cache',
    });
    res.end(buf);
    return true;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

/**
 * Which document a bare "/" resolves to, decided by Host.
 *
 * The status subdomain is served by the SAME process and the SAME port as the
 * portal: it reads the exact payloads the dashboard already publishes
 * (/api/model-status, /api/pricing), so a second service would duplicate the
 * caches and double the upstream calls those endpoints make.
 */
function isStatusHost(req) {
  const h = String((req.headers && req.headers.host) || '').toLowerCase();
  return h.split(':')[0].startsWith('status.');
}

// Everything the status page needs, and nothing else. Kept next to
// isStatusHost so adding an asset to status.html forces a look here.
const STATUS_HOST_PATHS = new Set([
  '/',
  '/style.css',
  '/api/config',
  '/api/model-status',
  '/healthz',
]);

async function serveIndex(res, req, explicitDoc) {
  const doc = explicitDoc || (req && isStatusHost(req) ? 'status.html' : 'index.html');
  const idx = path.join(PUBLIC_DIR, doc);
  try {
    const buf = Buffer.from(stampAssets(await fsp.readFile(idx, 'utf8')), 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': buf.length,
      'cache-control': 'no-cache',
    });
    res.end(buf);
  } catch (_) {
    jsonError(res, 404, 'not_found', 'Not found');
  }
}

// ---------------------------------------------------------------- router

const server = http.createServer(async (req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, 'http://local');
  } catch (_) {
    return jsonError(res, 400, 'bad_request', 'Malformed request URL');
  }
  const pathname = parsed.pathname;

  try {
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }

    // ---- status subdomain: availability only ----
    // The status host shares this process with the portal, so without an
    // allow-list every portal route (/index.html, /api/portal/me, /v1/...) would
    // also answer on status.*. The subdomain is meant to be a read-only service
    // indicator with no auth surface at all, so anything outside the status page
    // and its one payload is 404 here — reachable on the apex as before.
    if (isStatusHost(req) && !STATUS_HOST_PATHS.has(pathname)) {
      return jsonError(res, 404, 'not_found', 'Not found');
    }

    // ---- OpenAI-compatible proxy ----
    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      const clientKey = extractClientKey(req);
      if (!clientKey) return jsonError(res, 401, 'missing_api_key', 'Missing Authorization header');
      const resolved = resolveUpstreamKey(clientKey);
      if (!resolved) return jsonError(res, 401, 'invalid_api_key', 'Invalid or inactive API key');
      return proxy(req, res, {
        path: req.url,
        bearer: resolved.key,
        publicOrigin: publicOriginFor(req, publicUrlOptions()),
      });
    }

    // ---- portal API ----
    if (pathname === '/api/portal/me') {
      if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', 'Use POST');
      return handlePortalMe(req, res);
    }

    if (pathname === '/api/model-status') {
      // Entitlement follows the caller's key. An anonymous hit (landing page)
      // falls back to our own token so the public list still renders; an
      // unknown key must NOT silently fall back, or a visitor would be shown a
      // catalog that is not theirs.
      const ck = extractClientKey(req);
      const rs = ck ? resolveUpstreamKey(ck) : null;
      if (ck && !rs) return jsonError(res, 401, 'invalid_api_key', 'Invalid or inactive API key');
      const bearer = rs ? rs.key : UPSTREAM_KEY;
      // The status subdomain reports the whole service, so it is not narrowed by
      // any key's entitlement -- our own reseller key sees 7 of 19 models and the
      // page would look like the rest do not exist.
      const all = isStatusHost(req) || !ck;
      // Window is chosen by the caller. Only the provider's two supported values
      // pass; anything else falls back to 24h rather than relaying a 400.
      const range = normalizeRange(parsed.searchParams.get('range'));
      return sendJson(
        res,
        200,
        (await getModelStatus(bearer, { all, range })) || { overall: 'unknown', models: [] },
      );
    }

    if (pathname === '/api/news') {
      const limitRaw = parseInt(parsed.searchParams.get('limit') || '20', 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
      return sendJson(res, 200, { items: readNews().slice(0, limit) });
    }

    if (pathname === '/api/news/latest') {
      return sendJson(res, 200, { item: readNews()[0] || null });
    }

    if (pathname === '/api/pricing') {
      // Same rule as /api/model-status: prices are filtered by the caller's own
      // entitlement, anonymous hits get our public set.
      const ck = extractClientKey(req);
      const rs = ck ? resolveUpstreamKey(ck) : null;
      if (ck && !rs) return jsonError(res, 401, 'invalid_api_key', 'Invalid or inactive API key');
      return sendJson(res, 200, await getPricingFor(rs ? rs.key : UPSTREAM_KEY));
    }

    if (pathname === '/api/config') {
      return sendJson(res, 200, {
        base_url: publicBaseUrlFor(req, publicUrlOptions()),
        public_url: publicOriginFor(req, publicUrlOptions()),
        status_url: statusUrlFor(req, publicUrlOptions()),
        portal_name: PORTAL_NAME,
        languages: ['ru', 'en'],
      });
    }

    if (pathname.startsWith('/api/')) {
      return jsonError(res, 404, 'not_found', 'Unknown endpoint');
    }

    // A same-origin status page always works, even when no status.* DNS record
    // exists. STATUS_URL may still point the dashboard button elsewhere.
    if (pathname === '/status' || pathname === '/status/') {
      return serveIndex(res, req, 'status.html');
    }

    // ---- static site ----
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    // "/" is host-dependent, so it must not reach serveStatic: that helper
    // rewrites a bare path to index.html and would hand the portal to the
    // status subdomain. Assets (/app.js, /style.css) still resolve normally.
    if (pathname !== '/') {
      const served = await serveStatic(pathname, res);
      if (served) return undefined;
    }
    return serveIndex(res, req);
  } catch (err) {
    console.error('[portal] handler error:', err && err.stack ? err.stack : err);
    if (!res.headersSent) jsonError(res, 500, 'internal_error', 'Internal error');
    else if (!res.writableEnded) res.end();
    return undefined;
  }
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 75000;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`[portal] listening on ${HOST}:${PORT}`);
  console.log(`[portal] upstream = ${UPSTREAM_BASE}`);
  console.log(`[portal] public   = ${PUBLIC_BASE_URL || PUBLIC_ORIGIN || 'auto from request'}`);
  console.log(`[portal] static   = ${PUBLIC_DIR}`);
  console.log(`[portal] client keys = ${CLIENT_KEYS.size ? CLIENT_KEYS.size + ' allowlisted' : 'none'}`);
  console.log(`[portal] passthrough = ${PASSTHROUGH ? 'on' : 'off'}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
