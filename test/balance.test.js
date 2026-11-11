'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsageBalance, quotaToUsd } = require('../lib/balance');

test('wallet log quota uses the same server-provided USD scale', () => {
  assert.equal(quotaToUsd(125000, { quota_per_unit: 250000 }), 0.5);
  assert.equal(quotaToUsd(250000, {}), 0.5);
});

test('money-mode usage prefers upstream USD totals', () => {
  assert.deepEqual(normalizeUsageBalance({
    quota_mode: 'money',
    quota_per_unit: 100,
    total_granted: 9000,
    total_used: 4000,
    total_available: 5000,
    total_granted_usd: 12.5,
    total_used_usd: 3.25,
    total_available_usd: 9.25,
  }), {
    quotaMode: 'money',
    currency: 'USD',
    conversionSource: 'exact_usd',
    quotaPerUnit: 100,
    unlimited: false,
    granted: 12.5,
    used: 3.25,
    available: 9.25,
  });
});

test('money-mode usage falls back to raw quota divided by a valid quota_per_unit', () => {
  assert.deepEqual(normalizeUsageBalance({
    quota_per_unit: '250000',
    total_granted: 500000,
    total_used: 125000,
    total_available: 375000,
  }), {
    quotaMode: 'money',
    currency: 'USD',
    conversionSource: 'quota_per_unit',
    quotaPerUnit: 250000,
    unlimited: false,
    granted: 2,
    used: 0.5,
    available: 1.5,
  });
});

test('legacy money-mode usage defaults to 500000 quota per USD', () => {
  for (const quotaPerUnit of [undefined, 0, -1, 'invalid']) {
    const normalized = normalizeUsageBalance({
      quota_per_unit: quotaPerUnit,
      total_granted: 1000000,
      total_used: 250000,
    });
    assert.equal(normalized.granted, 2);
    assert.equal(normalized.used, 0.5);
    assert.equal(normalized.available, 1.5);
  }
});

test('unlimited usage has no finite available balance', () => {
  assert.equal(normalizeUsageBalance({
    unlimited_quota: true,
    total_available_usd: 99,
  }).available, null);
  assert.equal(normalizeUsageBalance({
    quota_mode: 'tokens',
    unlimited_quota: true,
    total_available: 123456,
  }).available, null);
});

test('token-mode usage remains in tokens and ignores USD conversion fields', () => {
  assert.deepEqual(normalizeUsageBalance({
    quota_mode: 'tokens',
    quota_per_unit: 500000,
    total_granted: 1000000,
    total_used: 250000,
    total_granted_usd: 2,
    total_used_usd: 0.5,
  }), {
    quotaMode: 'tokens',
    currency: 'tokens',
    conversionSource: 'token_units',
    quotaPerUnit: null,
    unlimited: false,
    granted: 1000000,
    used: 250000,
    available: 750000,
  });
});
