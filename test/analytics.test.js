'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalytics, normalizeLogRows } = require('../lib/analytics');
const { classifyModelHealth } = require('../lib/health');
const { publicBaseUrlFor, statusUrlFor } = require('../lib/public-url');
const { buildServiceTelemetry } = require('../lib/service-telemetry');
const { panelBasePrices } = require('../lib/pricing');

const toCredits = (quota) => Number(quota || 0) / 50;

test('panel tariffs preserve model-specific USD rates separately from token usage', () => {
  assert.deepEqual(panelBasePrices({ quota_type: 0, model_ratio: 0.1, completion_ratio: 5 }),
    { input_usd: 0.2, output_usd: 1, per_call_usd: null });
  assert.deepEqual(panelBasePrices({ quota_type: 0, model_ratio: 0.01, completion_ratio: 6 }),
    { input_usd: 0.02, output_usd: 0.12, per_call_usd: null });
  assert.deepEqual(panelBasePrices({ quota_type: 1, model_price: 0.02, model_ratio: 0, completion_ratio: 0 }),
    { input_usd: null, output_usd: null, per_call_usd: 0.02 });
  for (const row of [{}, { model_ratio: -1 }, { model_ratio: 0.1, billing_expr: 'dynamic' }]) {
    assert.deepEqual(panelBasePrices(row), { input_usd: null, output_usd: null, per_call_usd: null });
  }
});

test('analytics ignores service rows and does not call them failures', () => {
  const rows = [
    { type: 1, content: 'top up', created_at: 100 },
    { type: 4, content: 'system', created_at: 101 },
    { type: 2, request_id: 'ok-1', model_name: 'gpt-test', quota: 50, prompt_tokens: 10, completion_tokens: 5, created_at: 102 },
  ];
  const result = buildAnalytics(rows, toCredits, new Date('2026-08-18T00:00:00Z'));
  assert.equal(result.total_requests, 1);
  assert.equal(result.success_rate, 1);
  assert.equal(result.ignored_rows, 2);
  assert.equal(result.spent_tokens, 15);
  assert.equal(result.spent_credits, 1);
});

test('a successful retry wins over an error with the same request id', () => {
  const rows = [
    { type: 5, request_id: 'retry-1', model_name: 'gpt-test', content: 'first channel failed', created_at: 100 },
    { type: 2, request_id: 'retry-1', model_name: 'gpt-test', quota: 25, prompt_tokens: 20, completion_tokens: 10, created_at: 101 },
  ];
  const normalized = normalizeLogRows(rows, toCredits);
  assert.equal(normalized.records.length, 1);
  assert.equal(normalized.records[0].success, true);
  assert.equal(normalized.collapsed_rows, 1);
});

test('cache token variants are normalized', () => {
  const rows = [{
    type: 2,
    request_id: 'cache-1',
    model_name: 'gpt-test',
    other: JSON.stringify({ prompt_tokens_details: { cached_tokens: 12 }, cache_creation_tokens: 3 }),
  }];
  assert.equal(normalizeLogRows(rows, toCredits).records[0].cached, 15);
});

test('raw token charge comes from settlement metadata, never priced quota', () => {
  const rows = [
    {
      type: 2,
      request_id: 'reseller-1',
      quota: 7442,
      prompt_tokens: 71562,
      completion_tokens: 572,
      other: JSON.stringify({ reseller_token_quota: 72134 }),
    },
    {
      type: 2,
      request_id: 'raw-1',
      quota: 500,
      prompt_tokens: 900,
      completion_tokens: 100,
      other: JSON.stringify({ token_quota_mode: 'tokens', raw_token_quota: 1000 }),
    },
    {
      type: 2,
      request_id: 'wallet-1',
      quota: 7442,
      prompt_tokens: 71562,
      completion_tokens: 572,
    },
  ];

  const records = normalizeLogRows(rows, toCredits).records;
  assert.equal(records[0].charged_tokens, 72134);
  assert.equal(records[1].charged_tokens, 1000);
  assert.equal(records[2].charged_tokens, null);
  assert.equal(records[2].credits, 148.84);
});

test('paid image generation is preserved with its package-unit contribution', () => {
  const rows = [{
    type: 2,
    request_id: 'image-1',
    model_name: 'gpt-5.6-terra',
    quota: 100638,
    prompt_tokens: 6608,
    completion_tokens: 46,
    other: JSON.stringify({
      group_ratio: 1,
      reseller_base_cost_per_million: '0.08',
      reseller_token_quota: 2515950,
      tool_surcharges: [{ name: 'image_generation', count: 1, price: 201 }],
    }),
  }];

  const [record] = normalizeLogRows(rows, toCredits).records;
  assert.deepEqual(record.tool_surcharges, [{
    name: 'image_generation',
    count: 1,
    price_per_thousand: 201,
    cost_usd: 0.201,
    package_units: 2512500,
  }]);
});

test('model health is unknown without enough real observations', () => {
  assert.equal(classifyModelHealth({}).state, 'unknown');
  assert.equal(classifyModelHealth({ local: { requests: 2, success_pct: 100 } }).state, 'unknown');
  assert.equal(classifyModelHealth({ local: { requests: 3, success_pct: 100 } }).state, 'available');
});

test('provider no-traffic filler never becomes operational', () => {
  const result = classifyModelHealth({ provider: { uptime: 100, samples: 0, active: true } });
  assert.equal(result.state, 'unknown');
});

test('service telemetry aggregates the admin log by model and time bucket', () => {
  const now = new Date('2026-08-18T12:00:00Z');
  const ts = Math.floor(now.getTime() / 1000) - 60;
  const result = buildServiceTelemetry([
    { type: 2, request_id: 'ok-1', model_name: 'gpt-test', use_time: 2, created_at: ts },
    { type: 5, request_id: 'bad-1', model_name: 'gpt-test', created_at: ts + 1 },
    { type: 1, model_name: 'gpt-test', created_at: ts + 2 },
  ], '24h', now);
  const model = result.models.get('gpt-test');
  assert.equal(result.sample_count, 2);
  assert.equal(result.overall_uptime, 50);
  assert.equal(model.samples, 2);
  assert.equal(model.uptime, 50);
  assert.equal(model.buckets.filter((bucket) => bucket.s === 'data').length, 1);
});

test('public URLs derive from reverse proxy headers unless overridden', () => {
  const req = {
    headers: {
      host: 'internal:3401',
      'x-forwarded-host': 'seller.example',
      'x-forwarded-proto': 'https',
    },
    socket: {},
  };
  assert.equal(publicBaseUrlFor(req), 'https://seller.example/v1');
  assert.equal(statusUrlFor(req), 'https://seller.example/status');
  assert.equal(publicBaseUrlFor(req, { publicBaseUrl: 'https://api.example/custom/' }), 'https://api.example/custom');
  assert.equal(statusUrlFor(req, { publicBaseUrl: 'https://api.example/custom/' }), 'https://api.example/status');
});
