'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOther(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function seconds(value) {
  const parsed = number(value, 0);
  return parsed > 1e12 ? Math.floor(parsed / 1000) : Math.floor(parsed);
}

function requestOutcome(row) {
  const type = Number(row && row.type);
  if (type === 2) return 'success';
  if (type === 5) return 'failed';

  if (row && typeof row.success === 'boolean') return row.success ? 'success' : 'failed';
  const raw = String((row && (row.status || row.state)) || '').toLowerCase();
  if (['success', 'succeeded', 'ok', 'completed'].includes(raw)) return 'success';
  if (['failed', 'failure', 'error'].includes(raw)) return 'failed';

  const statusCode = number(row && (row.status_code || row.http_status), 0);
  if (statusCode >= 200 && statusCode < 400) return 'success';
  if (statusCode >= 400) return 'failed';
  return null;
}

function cachedTokens(row, other) {
  const details = (other && (other.prompt_tokens_details || other.input_tokens_details)) || {};
  const read = number(other && (
    other.cache_tokens
    ?? other.cached_tokens
    ?? other.cache_read_input_tokens
    ?? details.cached_tokens
    ?? details.cache_read_tokens
  ), 0);
  const created = number(other && (other.cache_creation_tokens ?? other.cache_creation_input_tokens), 0);
  return read + created;
}

function requestIdentity(row, other, index) {
  const id = row.request_id
    || row.upstream_request_id
    || other.request_id
    || other.upstream_request_id;
  return id ? `request:${id}` : `row:${index}`;
}

function normalizeLogRows(rows, toCredits) {
  const convert = typeof toCredits === 'function' ? toCredits : (value) => number(value, 0);
  const source = Array.isArray(rows) ? rows : [];
  const byRequest = new Map();
  let ignored = 0;

  source.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      ignored += 1;
      return;
    }
    const outcome = requestOutcome(row);
    if (!outcome) {
      ignored += 1;
      return;
    }

    const other = parseOther(row.other);
    const createdAt = seconds(row.created_at || row.createdAt);
    const normalized = {
      request_id: String(row.request_id || row.upstream_request_id || other.request_id || ''),
      created_at: createdAt,
      ts: createdAt ? new Date(createdAt * 1000).toISOString() : '',
      model: String(row.model_name || row.model || 'unknown'),
      input: number(row.prompt_tokens ?? row.input_tokens, 0),
      output: number(row.completion_tokens ?? row.output_tokens, 0),
      cached: cachedTokens(row, other),
      credits: convert(row.quota),
      success: outcome === 'success',
      error: outcome === 'success'
        ? ''
        : String(row.content || other.user_response || other.error || '').slice(0, 400),
      request_path: String(other.request_path || row.request_path || ''),
      stream: Boolean(row.is_stream ?? other.is_stream),
      latency_ms: Math.max(0, number(row.use_time ?? row.use_time_seconds, 0) * 1000),
      _index: index,
    };

    const id = requestIdentity(row, other, index);
    const previous = byRequest.get(id);
    if (!previous
      || (normalized.success && !previous.success)
      || (normalized.success === previous.success && normalized.created_at >= previous.created_at)) {
      byRequest.set(id, normalized);
    }
  });

  const records = [...byRequest.values()]
    .sort((a, b) => (b.created_at - a.created_at) || (a._index - b._index));
  records.forEach((row) => { delete row._index; });

  return {
    records,
    ignored_rows: ignored,
    collapsed_rows: Math.max(0, source.length - ignored - records.length),
  };
}

function dayKey(timestamp) {
  const date = new Date(timestamp * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function buildAnalytics(rows, toCredits, now = new Date()) {
  const normalized = normalizeLogRows(rows, toCredits);
  const list = normalized.records;
  let ok = 0;
  let spentCredits = 0;
  let spentTokens = 0;
  let cached = 0;
  const byDay = new Map();
  const byModel = new Map();

  for (const row of list) {
    if (row.success) ok += 1;
    const tokens = row.input + row.output;
    spentCredits += row.credits;
    spentTokens += tokens;
    cached += row.cached;

    if (row.created_at) {
      const key = dayKey(row.created_at);
      const day = byDay.get(key) || { tokens: 0, credits: 0 };
      day.tokens += tokens;
      day.credits += row.credits;
      byDay.set(key, day);
    }

    const model = byModel.get(row.model) || {
      model: row.model,
      tokens: 0,
      cached_tokens: 0,
      requests: 0,
      credits: 0,
    };
    model.tokens += tokens;
    model.cached_tokens += row.cached;
    model.requests += 1;
    model.credits += row.credits;
    byModel.set(row.model, model);
  }

  const days = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const day = byDay.get(key);
    days.push({
      date: key,
      tokens: day ? day.tokens : 0,
      credits: day ? Math.round(day.credits * 100) / 100 : 0,
    });
  }

  const timestamps = list.map((row) => row.created_at).filter(Boolean);
  return {
    available: Array.isArray(rows),
    total_requests: list.length,
    success_rate: list.length ? ok / list.length : null,
    spent_credits: Math.round(spentCredits * 100) / 100,
    spent_tokens: spentTokens,
    cached_tokens: cached,
    tokens_by_day: days,
    by_model: [...byModel.values()]
      .map((item) => ({ ...item, credits: Math.round(item.credits * 100) / 100 }))
      .sort((a, b) => b.credits - a.credits || b.tokens - a.tokens),
    recent: list.slice(0, 50),
    ignored_rows: normalized.ignored_rows,
    collapsed_rows: normalized.collapsed_rows,
    history_from: timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString() : null,
    history_to: timestamps.length ? new Date(Math.max(...timestamps) * 1000).toISOString() : null,
  };
}

module.exports = {
  buildAnalytics,
  normalizeLogRows,
  parseOther,
  requestOutcome,
};
