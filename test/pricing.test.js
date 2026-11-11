'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { panelBasePrices } = require('../lib/pricing');

test('expression pricing publishes the upstream reference USD prices', () => {
  assert.deepEqual(panelBasePrices({
    billing_expr: 'tier("short", p * 1 + c * 5)',
    model_ratio: 999,
    completion_ratio: 999,
    reference_price: {
      input_usd: 1,
      output_usd: 5,
      request_usd: null,
    },
  }), {
    input_usd: 1,
    output_usd: 5,
    per_call_usd: null,
  });
});

test('legacy price calculation remains the fallback without a reference price', () => {
  assert.deepEqual(panelBasePrices({ model_ratio: 0.5, completion_ratio: 5 }), {
    input_usd: 1,
    output_usd: 5,
    per_call_usd: null,
  });
});
