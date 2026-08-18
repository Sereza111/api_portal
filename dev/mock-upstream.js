'use strict';

const http = require('node:http');

const now = Math.floor(Date.now() / 1000);
const models = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-sonnet-4-5'];

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': data.length });
  res.end(data);
}

function statusModel(name, uptime, latency) {
  return {
    model_name: name,
    active: true,
    uptime,
    latency_level: latency,
    buckets: Array.from({ length: 48 }, (_, index) => ({
      start_ts: now - (47 - index) * 1800,
      state: index < 7 ? 'no_traffic' : 'data',
      uptime: index === 31 && name === 'gpt-5.6-terra' ? 84 : uptime,
      latency_level: latency,
    })),
  };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://mock');
  if (url.pathname === '/api/usage/token/') {
    return json(res, 200, { data: {
      total_granted: 500000,
      total_used: 132500,
      total_available: 367500,
      unlimited_quota: false,
      model_limits_enabled: false,
      model_limits: {},
      expires_at: 0,
    } });
  }
  if (url.pathname === '/v1/models') {
    return json(res, 200, { data: models.map((id) => ({ id })) });
  }
  if (url.pathname === '/api/pricing') {
    return json(res, 200, {
      group_ratio: { default: 1 },
      data: models.map((model, index) => ({
        model_name: model,
        quota_type: 0,
        model_ratio: .00025 * (index + 1),
        completion_ratio: 5,
        cache_ratio: .1,
        group_ratio: { default: 1 },
      })),
    });
  }
  if (url.pathname === '/api/log/token') {
    return json(res, 200, { data: [
      { type: 5, request_id: 'retry-1', model_name: 'gpt-5.6-sol', content: 'temporary channel error', created_at: now - 80 },
      { type: 2, request_id: 'retry-1', model_name: 'gpt-5.6-sol', quota: 1200, prompt_tokens: 8400, completion_tokens: 2100, use_time: 3, created_at: now - 70, other: '{"cache_tokens":2200}' },
      { type: 4, content: 'service event', created_at: now - 60 },
      { type: 2, request_id: 'ok-2', model_name: 'gpt-5.6-terra', quota: 850, prompt_tokens: 3100, completion_tokens: 940, use_time: 2, created_at: now - 86400, other: '{}' },
      { type: 2, request_id: 'ok-3', model_name: 'gpt-5.6-luna', quota: 430, prompt_tokens: 1900, completion_tokens: 440, use_time: 1, created_at: now - 172800, other: '{}' },
    ] });
  }
  if (url.pathname === '/api/service-status') {
    return json(res, 200, { success: true, data: {
      overall_uptime: 99.7,
      recent_uptime: 100,
      range: url.searchParams.get('range') || '24h',
      bucket_seconds: 1800,
      generated_at: now,
      models: [
        statusModel('gpt-5.6-sol', 100, 'low'),
        statusModel('gpt-5.6-terra', 96.4, 'medium'),
        statusModel('gpt-5.6-luna', 100, 'low'),
        statusModel('claude-sonnet-4-5', 99.8, 'medium'),
      ],
    } });
  }
  return json(res, 404, { error: 'not_found' });
}).listen(3501, '127.0.0.1', () => {
  console.log('mock upstream listening on 127.0.0.1:3501');
});
