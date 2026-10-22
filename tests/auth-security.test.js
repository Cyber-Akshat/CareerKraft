const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { JSDOM } = require('jsdom');
const { createAuthSecurity, RATE_LIMIT_RESPONSE, LIMITS } = require('../auth-security');

function harness(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return { db, security: createAuthSecurity({ db, options }) };
}

function call(middleware, { email = 'person@example.com', ip = '192.0.2.1', method = 'POST',
  body = { email }, headers = { 'content-type': 'application/json' } } = {}) {
  const result = { status: 200, headers: {}, passed: false };
  const req = { method, body, headers, ip, socket: { remoteAddress: ip } };
  const res = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; return this; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; }
  };
  middleware(req, res, () => { result.passed = true; });
  return result;
}

function blocked(result, retryAfter) {
  assert.equal(result.status, 429);
  assert.equal(result.passed, false);
  assert.deepEqual(result.body, RATE_LIMIT_RESPONSE);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(Number(result.headers['retry-after']) >= 1);
  if (retryAfter !== undefined) assert.equal(Number(result.headers['retry-after']), retryAfter);
  assert.deepEqual(Object.keys(result.body).sort(), ['code', 'error']);
}

test('login limits every attempt per normalized account across IPs, including successful attempts', t => {
  const { db, security } = harness(t);
  for (let index = 0; index < LIMITS.loginAccount.limit; index++) {
    const response = call(security.loginLimit, {
      email: index % 2 ? `${' '.repeat(1100)}Person@Example.COM  ` : 'person@example.com', ip: `192.0.2.${index + 1}`
    });
    // A successful handler is represented by next(); it does not refund an attempt.
    assert.equal(response.passed, true);
  }
  blocked(call(security.loginLimit, { email: 'PERSON@example.com', ip: '198.51.100.1' }));
  assert.equal(call(security.loginLimit, { email: 'someone-else@example.com', ip: '198.51.100.2' }).passed, true);
  const persisted = JSON.stringify(db.prepare('SELECT * FROM auth_rate_limits').all());
  assert.ok(!persisted.toLowerCase().includes('person@example.com'));
  assert.ok(!persisted.includes('192.0.2.1'));
  for (const row of db.prepare('SELECT key FROM auth_rate_limits').all()) assert.match(row.key, /^[a-f0-9]{64}$/);
});

test('login IP limit applies across accounts and rejected attempts do not allocate new account keys', t => {
  const { db, security } = harness(t);
  for (let index = 0; index < LIMITS.loginIP.limit; index++) {
    assert.equal(call(security.loginLimit, { email: `person-${index}@example.com` }).passed, true);
  }
  blocked(call(security.loginLimit, { email: 'new-person@example.com' }));
  const count = db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count;
  blocked(call(security.loginLimit, { email: 'another-person@example.com' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count, count);
});

test('registration and email enforce both their IP and normalized account windows', t => {
  for (const [name, accountLimit, ipLimit] of [
    ['registrationLimit', LIMITS.registrationAccount, LIMITS.registrationIP],
    ['emailLimit', LIMITS.emailAccount, LIMITS.emailIP]
  ]) {
    const { security } = harness(t);
    for (let index = 0; index < accountLimit.limit; index++) {
      assert.equal(call(security[name], { email: '  User@Example.com ', ip: `192.0.2.${index + 1}` }).passed, true);
    }
    blocked(call(security[name], { email: 'user@example.com', ip: '192.0.2.100' }));
    for (let index = 0; index < ipLimit.limit; index++) {
      assert.equal(call(security[name], { email: `different-${index}@example.com`, ip: '198.51.100.1' }).passed, true);
    }
    blocked(call(security[name], { email: 'another@example.com', ip: '198.51.100.1' }));
  }
});

test('reset/verification tokens and OAuth use independent persistent IP limits', t => {
  const { security } = harness(t);
  for (const name of ['tokenLimit', 'oauthLimit']) {
    for (let index = 0; index < 20; index++) assert.equal(call(security[name], { body: {}, method: name === 'oauthLimit' ? 'GET' : 'POST' }).passed, true);
    blocked(call(security[name], { body: {} }));
    assert.equal(call(security[name], { body: {}, ip: '198.51.100.2' }).passed, true);
  }
});

test('rate limits survive factory replacement and database close/reopen', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-auth-security-'));
  const filename = path.join(directory, 'limits.sqlite');
  let db = new DatabaseSync(filename);
  t.after(() => {
    db.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const options = { authSecurityLimits: { loginAccount: 2 } };
  const first = createAuthSecurity({ db, production: true, base: 'https://careerkraft.example', options });
  assert.equal(call(first.loginLimit).passed, true);
  const replacement = createAuthSecurity({ db, options });
  assert.equal(call(replacement.loginLimit, { ip: '192.0.2.2' }).passed, true);
  db.close();
  db = new DatabaseSync(filename);
  const restarted = createAuthSecurity({ db, production: true, base: 'https://careerkraft.example', options });
  blocked(call(restarted.loginLimit, { ip: '192.0.2.3' }));
});

test('windows expire at the boundary and Retry-After describes the remaining window', t => {
  let timestamp = 1000000;
  const { db, security } = harness(t, {
    authSecurityNow: () => timestamp,
    authSecurityLimits: { loginAccount: { limit: 1, windowMs: 3000 }, loginIP: { limit: 10, windowMs: 3000 } }
  });
  assert.equal(call(security.loginLimit).passed, true);
  blocked(call(security.loginLimit), 3);
  timestamp += 2001;
  blocked(call(security.loginLimit), 1);
  timestamp += 999;
  assert.equal(call(security.loginLimit).passed, true);
  assert.ok(db.prepare('SELECT * FROM auth_rate_limits').all().every(row => row.count === 1));
});

test('malformed emails share one fallback identity instead of creating arbitrary account buckets', t => {
  const { db, security } = harness(t, { authSecurityLimits: { loginAccount: 2 } });
  assert.equal(call(security.loginLimit, { email: { nested: 'first' }, ip: '192.0.2.1' }).passed, true);
  assert.equal(call(security.loginLimit, { email: 'not-an-email', ip: '192.0.2.2' }).passed, true);
  blocked(call(security.loginLimit, { email: 'x'.repeat(2000), ip: '192.0.2.3' }));
  blocked(call(security.loginLimit, { email: ['person@example.com'], ip: '192.0.2.4' }));
  blocked(call(security.loginLimit, { email: 'person\u0000@example.com', ip: '192.0.2.5' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count, 6);
});

test('IPv6 privacy addresses share a /56 bucket and IPv4-mapped addresses share their IPv4 bucket', t => {
  const { security } = harness(t, { authSecurityLimits: { loginIP: 2, loginAccount: 100 } });
  assert.equal(call(security.loginLimit, { ip: '2001:db8:1234:5600::1', email: 'one@example.com' }).passed, true);
  assert.equal(call(security.loginLimit, { ip: '2001:db8:1234:56ff::2', email: 'two@example.com' }).passed, true);
  blocked(call(security.loginLimit, { ip: '2001:db8:1234:5680::3', email: 'three@example.com' }));
  assert.equal(call(security.loginLimit, { ip: '2001:db8:1234:5700::1', email: 'four@example.com' }).passed, true);
  assert.equal(call(security.loginLimit, { ip: '192.0.2.9', email: 'five@example.com' }).passed, true);
  assert.equal(call(security.loginLimit, { ip: '::ffff:192.0.2.9', email: 'six@example.com' }).passed, true);
  blocked(call(security.loginLimit, { ip: '192.0.2.9', email: 'seven@example.com' }));
});

test('spoofed forwarding headers cannot bypass the default Express IP limit', async t => {
  const { security } = harness(t, { authSecurityLimits: { loginIP: 2, loginAccount: 100 } });
  const app = express();
  app.use(express.json());
  app.post('/login', security.loginLimit, (req, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  for (let index = 0; index < 3; index++) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${index + 1}`,
        Forwarded: `for=203.0.113.${index + 1}`, 'X-Real-IP': `203.0.113.${index + 1}` },
      body: JSON.stringify({ email: `person-${index}@example.com` })
    });
    assert.equal(response.status, index === 2 ? 429 : 200);
    if (index === 2) assert.deepEqual(await response.json(), RATE_LIMIT_RESPONSE);
  }
});

test('bucket allocation stays bounded, fails closed at capacity, and reclaims expired rows', t => {
  let timestamp = 1000000;
  const { db, security } = harness(t, { authSecurityNow: () => timestamp, authSecurityMaxKeys: 3 });
  assert.equal(call(security.loginLimit, { email: 'first@example.com' }).passed, true);
  assert.equal(call(security.loginLimit, { email: 'second@example.com' }).passed, true);
  blocked(call(security.loginLimit, { email: 'third@example.com' }));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count, 3);
  assert.equal(call(security.loginLimit, { email: 'first@example.com' }).passed, true);
  timestamp += LIMITS.loginIP.windowMs;
  assert.equal(call(security.loginLimit, { email: 'third@example.com' }).passed, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count, 2);
});

test('unavailable persistent rate-limit storage fails closed with the same generic response', t => {
  const { db, security } = harness(t);
  db.exec('DROP TABLE auth_rate_limits');
  blocked(call(security.loginLimit), 60);
});

test('security headers allow existing inline theme scripts while excluding external scripts and frames', t => {
  const { security } = harness(t);
  const response = call(security.securityHeaders);
  const csp = response.headers['content-security-policy'];
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  for (const directive of ["default-src 'self'", "connect-src 'self'", "frame-src 'none'", "base-uri 'none'",
    "form-action 'self'", "object-src 'none'", "frame-ancestors 'none'", "img-src 'self' data: blob:", "media-src 'self' blob:"]) assert.ok(csp.includes(directive), directive);
  const scriptPolicy = csp.split('; ').find(value => value.startsWith('script-src'));
  assert.ok(!scriptPolicy.includes('unsafe-inline'));
  assert.ok(!scriptPolicy.includes('unsafe-eval'));
  assert.ok(!scriptPolicy.includes('https:'));
  for (const filename of ['index.html', 'terms.html', 'auth.html', 'onboarding.html', 'career.html', 'dashboard.html', 'activity.html', 'settings.html', 'verify-email.html', 'reset-password.html', 'signup.html', '404.html']) {
    const dom = new JSDOM(readFileSync(path.join(__dirname, '..', filename), 'utf8'));
    for (const script of dom.window.document.querySelectorAll('script:not([src])')) {
      if (!script.textContent.trim()) continue;
      const hash = createHash('sha256').update(script.textContent).digest('base64');
      assert.ok(scriptPolicy.includes(`'sha256-${hash}'`), `${filename} inline script must remain allowed`);
    }
    dom.window.close();
  }
  assert.equal(response.headers['strict-transport-security'], undefined);
  assert.ok(!csp.includes('upgrade-insecure-requests'));
});

test('production HTTPS enables HSTS and upgrades while local HTTP remains usable', t => {
  const { db } = harness(t);
  const secure = createAuthSecurity({ db, production: true, base: 'https://careerkraft.example' });
  const secureResponse = call(secure.securityHeaders);
  assert.equal(secureResponse.headers['strict-transport-security'], 'max-age=31536000');
  assert.ok(secureResponse.headers['content-security-policy'].includes('upgrade-insecure-requests'));
  const local = createAuthSecurity({ db, production: true, base: 'http://localhost:3000' });
  const localResponse = call(local.securityHeaders);
  assert.equal(localResponse.headers['strict-transport-security'], undefined);
  assert.ok(!localResponse.headers['content-security-policy'].includes('upgrade-insecure-requests'));
});

test('JSON body validation rejects arrays and null without affecting multipart uploads or object requests', t => {
  const { security } = harness(t);
  for (const body of [null, [], ['person@example.com'], 'text', 2]) {
    const response = call(security.validateJsonBody, { body });
    assert.equal(response.status, 400);
    assert.equal(response.passed, false);
  }
  assert.equal(call(security.validateJsonBody, { body: {} }).passed, true);
  assert.equal(call(security.validateJsonBody, { method: 'GET', body: undefined }).passed, true);
  assert.equal(call(security.validateJsonBody, { body: undefined, headers: { 'content-type': 'multipart/form-data; boundary=example' } }).passed, true);
});
