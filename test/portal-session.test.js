'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COOKIE_NAME, createPortalSessionStore } = require('../lib/portal-session');

test('portal session keeps the API key server-side and expires it', () => {
  let timestamp = 1_000_000;
  const sessions = createPortalSessionStore({ ttlMs: 60_000, now: () => timestamp });
  const setCookie = sessions.create('sk-secret-value');
  assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
  assert.doesNotMatch(setCookie, /sk-secret-value/);
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);

  const cookieHeader = setCookie.split(';', 1)[0];
  assert.equal(sessions.get(cookieHeader), 'sk-secret-value');
  timestamp += 60_001;
  assert.equal(sessions.get(cookieHeader), '');
});

test('logout invalidates the opaque session and clears the cookie', () => {
  const sessions = createPortalSessionStore();
  const cookieHeader = sessions.create('sk-secret-value').split(';', 1)[0];
  const clearCookie = sessions.destroy(cookieHeader);
  assert.equal(sessions.get(cookieHeader), '');
  assert.match(clearCookie, new RegExp(`^${COOKIE_NAME}=;`));
  assert.match(clearCookie, /Max-Age=0/);
});

test('portal session store evicts the oldest session at its configured bound', () => {
  const sessions = createPortalSessionStore({ maxSessions: 2 });
  const first = sessions.create('sk-first').split(';', 1)[0];
  const second = sessions.create('sk-second').split(';', 1)[0];
  const third = sessions.create('sk-third').split(';', 1)[0];

  assert.equal(sessions.get(first), '');
  assert.equal(sessions.get(second), 'sk-second');
  assert.equal(sessions.get(third), 'sk-third');
});
