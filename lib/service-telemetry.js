'use strict';

const { normalizeLogRows } = require('./analytics');

function latencyLevel(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  if (medianMs <= 3000) return 'low';
  if (medianMs <= 10000) return 'medium';
  return 'high';
}

function buildServiceTelemetry(rows, rangeRaw, now = new Date()) {
  const range = rangeRaw === '7d' ? '7d' : '24h';
  const rangeSeconds = range === '7d' ? 7 * 24 * 3600 : 24 * 3600;
  const bucketSeconds = range === '7d' ? 3 * 3600 : 30 * 60;
  const bucketCount = Math.ceil(rangeSeconds / bucketSeconds);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const rangeStart = nowSeconds - rangeSeconds;
  const normalized = normalizeLogRows(rows, Number).records
    .filter((row) => row.created_at >= rangeStart && row.created_at <= nowSeconds);
  const byModel = new Map();

  for (const row of normalized) {
    if (!row.model || row.model === 'unknown') continue;
    let model = byModel.get(row.model);
    if (!model) {
      model = {
        total: 0,
        ok: 0,
        latency: [],
        buckets: Array.from({ length: bucketCount }, (_, index) => ({
          start_ts: rangeStart + index * bucketSeconds,
          total: 0,
          ok: 0,
          latency: [],
        })),
      };
      byModel.set(row.model, model);
    }
    model.total += 1;
    if (row.success) model.ok += 1;
    if (row.success && row.latency_ms > 0) model.latency.push(row.latency_ms);
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((row.created_at - rangeStart) / bucketSeconds)),
    );
    const bucket = model.buckets[bucketIndex];
    bucket.total += 1;
    if (row.success) bucket.ok += 1;
    if (row.success && row.latency_ms > 0) bucket.latency.push(row.latency_ms);
  }

  const models = new Map();
  let total = 0;
  let ok = 0;
  for (const [name, model] of byModel) {
    total += model.total;
    ok += model.ok;
    models.set(name, {
      uptime: model.total ? model.ok / model.total * 100 : null,
      latency_level: latencyLevel(model.latency),
      active: true,
      samples: model.total,
      buckets: model.buckets.map((bucket) => ({
        t: bucket.start_ts,
        s: bucket.total ? 'data' : 'none',
        u: bucket.total ? bucket.ok / bucket.total * 100 : null,
        l: latencyLevel(bucket.latency),
        p: 0,
      })),
    });
  }

  const recentCutoff = nowSeconds - 3 * 3600;
  const recent = normalized.filter((row) => row.created_at >= recentCutoff);
  const recentOk = recent.filter((row) => row.success).length;
  return {
    models,
    overall_uptime: total ? ok / total * 100 : null,
    recent_uptime: recent.length ? recentOk / recent.length * 100 : null,
    range,
    bucket_seconds: bucketSeconds,
    generated_at: now.toISOString(),
    stale: false,
    last_success_at: now.toISOString(),
    sample_count: total,
  };
}

module.exports = { buildServiceTelemetry, latencyLevel };
