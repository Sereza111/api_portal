'use strict';

const DEFAULT_QUOTA_PER_UNIT = 500000;

function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function quotaPerUnitFor(usage) {
  const configured = nonNegativeNumber(usage && usage.quota_per_unit);
  return configured > 0 ? configured : DEFAULT_QUOTA_PER_UNIT;
}

function quotaConversionSource(usage) {
  const configured = nonNegativeNumber(usage && usage.quota_per_unit);
  return configured > 0 ? 'quota_per_unit' : 'legacy_default_500000';
}

function quotaToUsd(quota, usage) {
  return (nonNegativeNumber(quota) ?? 0) / quotaPerUnitFor(usage);
}

function normalizeUsageBalance(usage) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const quotaMode = source.quota_mode === 'tokens' ? 'tokens' : 'money';
  const unlimited = Boolean(source.unlimited_quota);

  if (quotaMode === 'tokens') {
    const granted = nonNegativeNumber(source.total_granted) ?? 0;
    const used = nonNegativeNumber(source.total_used) ?? 0;
    const explicitAvailable = nonNegativeNumber(source.total_available);

    return {
      quotaMode,
      currency: 'tokens',
      conversionSource: 'token_units',
      quotaPerUnit: null,
      unlimited,
      granted,
      used,
      available: unlimited
        ? null
        : explicitAvailable ?? Math.max(0, granted - used),
    };
  }

  const quotaPerUnit = quotaPerUnitFor(source);
  const convertedSource = quotaConversionSource(source);
  let usedExactUsd = false;
  let usedQuotaConversion = false;
  const moneyValue = (usdValue, rawValue) => {
    const explicitUsd = nonNegativeNumber(usdValue);
    if (explicitUsd != null) {
      usedExactUsd = true;
      return explicitUsd;
    }
    usedQuotaConversion = true;
    return (nonNegativeNumber(rawValue) ?? 0) / quotaPerUnit;
  };

  const granted = moneyValue(source.total_granted_usd, source.total_granted);
  const used = moneyValue(source.total_used_usd, source.total_used);
  const explicitAvailableUsd = nonNegativeNumber(source.total_available_usd);
  const rawAvailable = nonNegativeNumber(source.total_available);
  let available;
  if (explicitAvailableUsd != null) {
    usedExactUsd = true;
    available = explicitAvailableUsd;
  } else if (rawAvailable != null) {
    usedQuotaConversion = true;
    available = rawAvailable / quotaPerUnit;
  } else {
    available = Math.max(0, granted - used);
  }

  const conversionSource = usedExactUsd && usedQuotaConversion
    ? 'mixed'
    : usedExactUsd
      ? 'exact_usd'
      : convertedSource;

  return {
    quotaMode,
    currency: 'USD',
    conversionSource,
    quotaPerUnit,
    unlimited,
    granted,
    used,
    available: unlimited ? null : available,
  };
}

module.exports = { normalizeUsageBalance, quotaToUsd };
