'use strict';

// New API's legacy ratio is quota per model token, with 500,000 quota per USD.
// These are base catalog prices. Routing/group discounts and prepaid token
// debits are separate quantities and must never be inferred from this table.
function panelBasePrices(row) {
  const prices = { input_usd: null, output_usd: null, per_call_usd: null };
  const readPrice = (value) => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
    ? null : Number(value);
  const reference = row && row.reference_price;
  if (reference && typeof reference === 'object') {
    prices.input_usd = readPrice(reference.input_usd);
    prices.output_usd = readPrice(reference.output_usd);
    prices.per_call_usd = readPrice(reference.request_usd);
    if (Object.values(prices).some((value) => value != null)) return prices;
  }
  if (Number(row.quota_type) === 1) {
    prices.per_call_usd = readPrice(row.model_price);
    return prices;
  }
  // An expression can depend on context or other request fields; a legacy
  // ratio alongside it is not necessarily the expression's actual price.
  if (row.billing_expr) return prices;
  const ratio = readPrice(row.model_ratio);
  const completion = readPrice(row.completion_ratio);
  if (ratio != null && Number.isFinite(ratio * 2)) prices.input_usd = ratio * 2;
  if (prices.input_usd != null && completion != null && Number.isFinite(prices.input_usd * completion)) {
    prices.output_usd = prices.input_usd * completion;
  }
  return prices;
}

module.exports = { panelBasePrices };
