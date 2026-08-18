'use strict';

function withoutTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim();
}

function originFromRequest(req, trustProxy = true) {
  const headers = (req && req.headers) || {};
  const forwardedProto = trustProxy ? firstHeader(headers['x-forwarded-proto']) : '';
  const forwardedHost = trustProxy ? firstHeader(headers['x-forwarded-host']) : '';
  const protocol = forwardedProto || (req && req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = forwardedHost || firstHeader(headers.host) || 'localhost';
  return `${protocol}://${host}`;
}

function joinPath(origin, pathname) {
  const cleanOrigin = withoutTrailingSlash(origin);
  const cleanPath = '/' + String(pathname || '').replace(/^\/+|\/+$/g, '');
  return cleanPath === '/' ? cleanOrigin : cleanOrigin + cleanPath;
}

function publicOriginFor(req, options = {}) {
  const explicit = withoutTrailingSlash(options.publicOrigin);
  if (explicit) return explicit;
  const baseUrl = withoutTrailingSlash(options.publicBaseUrl);
  if (baseUrl) {
    try { return new URL(baseUrl).origin; } catch (_) { /* fall through */ }
  }
  return originFromRequest(req, options.trustProxy !== false);
}

function publicBaseUrlFor(req, options = {}) {
  const override = withoutTrailingSlash(options.publicBaseUrl);
  if (override) return override;
  return joinPath(publicOriginFor(req, options), options.apiPath || '/v1');
}

function statusUrlFor(req, options = {}) {
  const override = withoutTrailingSlash(options.statusUrl);
  if (override) return override;
  return joinPath(publicOriginFor(req, options), '/status');
}

module.exports = {
  originFromRequest,
  publicBaseUrlFor,
  publicOriginFor,
  statusUrlFor,
};
