'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalytics, normalizeLogRows } = require('../lib/analytics');
const { classifyModelHealth } = require('../lib/health');
const { publicBaseUrlFor, statusUrlFor } = require('../lib/public-url');

const toCredits = (quota) => Number(quota || 0) / 50;

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

test('model health is unknown without enough real observations', () => {
  assert.equal(classifyModelHealth({}).state, 'unknown');
  assert.equal(classifyModelHealth({ local: { requests: 2, success_pct: 100 } }).state, 'unknown');
  assert.equal(classifyModelHealth({ local: { requests: 3, success_pct: 100 } }).state, 'available');
});

test('provider no-traffic filler never becomes operational', () => {
  const result = classifyModelHealth({ provider: { uptime: 100, samples: 0, active: true } });
  assert.equal(result.state, 'unknown');
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
