'use strict';

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stateFromPercent(value) {
  if (value < 40) return 'down';
  if (value < 90) return 'degraded';
  return 'available';
}

function classifyModelHealth({ provider, log, local }) {
  if (provider && provider.active === false) {
    return { state: 'down', source: 'provider', success_pct: null };
  }

  const providerUptime = finite(provider && provider.uptime);
  const providerSamples = Number(provider && provider.samples) || 0;
  if (providerUptime != null && providerSamples > 0) {
    return {
      state: stateFromPercent(providerUptime),
      source: 'provider',
      success_pct: providerUptime,
    };
  }

  const logTotal = Number(log && log.total) || 0;
  if (logTotal >= 3) {
    const success = (Number(log.ok) || 0) / logTotal * 100;
    return { state: stateFromPercent(success), source: 'log', success_pct: success };
  }

  const localTotal = Number(local && local.requests) || 0;
  const localSuccess = finite(local && local.success_pct);
  if (localTotal >= 3 && localSuccess != null) {
    return { state: stateFromPercent(localSuccess), source: 'local', success_pct: localSuccess };
  }

  return { state: 'unknown', source: null, success_pct: null };
}

module.exports = { classifyModelHealth, stateFromPercent };
