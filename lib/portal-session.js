'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = '__Host-api_portal_session';

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  });
  return cookies;
}

function sessionDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createPortalSessionStore(options = {}) {
  const requestedTtlMs = Number(options.ttlMs);
  const ttlMs = Number.isFinite(requestedTtlMs) && requestedTtlMs >= 60_000
    ? Math.floor(requestedTtlMs)
    : 12 * 60 * 60 * 1000;
  const requestedMaxSessions = Number(options.maxSessions);
  const maxSessions = Number.isFinite(requestedMaxSessions) && requestedMaxSessions >= 1
    ? Math.floor(requestedMaxSessions)
    : 5000;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const sessions = new Map();

  function cookie(token, maxAgeSeconds) {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
  }

  function removeExpired() {
    const timestamp = now();
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(digest);
    }
  }

  return {
    create(apiKey, previousCookieHeader = '') {
      removeExpired();
      const previous = parseCookies(previousCookieHeader)[COOKIE_NAME];
      if (previous) sessions.delete(sessionDigest(previous));
      while (sessions.size >= maxSessions) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined) break;
        sessions.delete(oldest);
      }
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(sessionDigest(token), { apiKey, expiresAt: now() + ttlMs });
      return cookie(token, Math.floor(ttlMs / 1000));
    },

    get(cookieHeader) {
      const token = parseCookies(cookieHeader)[COOKIE_NAME];
      if (!token) return '';
      const digest = sessionDigest(token);
      const session = sessions.get(digest);
      if (!session) return '';
      if (session.expiresAt <= now()) {
        sessions.delete(digest);
        return '';
      }
      return session.apiKey;
    },

    destroy(cookieHeader) {
      const token = parseCookies(cookieHeader)[COOKIE_NAME];
      if (token) sessions.delete(sessionDigest(token));
      return cookie('', 0);
    },
  };
}

module.exports = {
  COOKIE_NAME,
  createPortalSessionStore,
  parseCookies,
};
