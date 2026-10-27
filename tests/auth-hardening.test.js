const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, scryptSync } = require('node:crypto');
const { createApp } = require('../server');

const password = 'an original test passphrase';
const legacy = `legacy-test-salt:${scryptSync(password, 'legacy-test-salt', 64).toString('hex')}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const settle = () => new Promise(resolve => setImmediate(resolve));
const accountNotFound = { error: 'An account with this email address does not exist.', code: 'account_not_found' };

async function setup(t, options = {}) {
  const mails = [];
  const { app, db } = createApp({ database: ':memory:', sendMail: async mail => mails.push(mail), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  for (const [id, email, verified, encoded] of [
    [1, 'member@example.com', 1, legacy], [2, 'unverified@example.com', 0, legacy],
    [3, 'google@example.com', 1, null], [4, 'corrupt@example.com', 1, 'broken:hash']
  ]) db.prepare('INSERT INTO users(id,email,name,password,verified,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, email, 'Test member', encoded, verified, Date.now());
  async function request(endpoint, body, { cookie = '', headers = {}, raw = false } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Origin: options.base || 'http://localhost:3000', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Cookie: cookie, ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  function session(secret, userId = 1, { created = Date.now(), seen = Date.now(), expires = Date.now() + 3600000 } = {}) {
    const hash = digest(secret);
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash, userId, expires);
    db.prepare('INSERT INTO session_activity VALUES (?,?,?)').run(hash, created, seen);
    return `ck_session=${secret}`;
  }
  return { db, mails, request, session };
}

test('login failures keep existing account verification, Google and damaged-hash state private', async t => {
  const { db, request } = await setup(t);
  const expected = { error: 'Unable to sign in with these details.', code: 'invalid_credentials' };
  for (const body of [
    { email: 'member@example.com', password: 'wrong' },
    { email: 'unverified@example.com', password }, { email: 'google@example.com', password },
    { email: 'corrupt@example.com', password }, { email: { $ne: null }, password },
    { email: "' OR 1=1 --@example.com", password }, { email: 'member@example.com', password: ['bad'] }
  ]) {
    const result = await request('/api/login', body);
    assert.equal(result.status, 401);
    assert.deepEqual(result.data, expected);
    assert.equal(result.cookie, '');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('login reports normalized unknown accounts without creating an account or authentication state', async t => {
  const { db, mails, request } = await setup(t);
  for (const body of [
    { email: 'missing@example.com', password },
    { email: '  MISSING@Example.COM  ', password: 'x' },
    { email: 'missing@example.com', password: 'x'.repeat(128) }
  ]) {
    const result = await request('/api/login', body);
    assert.equal(result.status, 404);
    assert.deepEqual(result.data, accountNotFound);
    assert.equal(result.cookie, '');
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  await settle();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  assert.deepEqual(mails, []);
});

test('missing or malformed login credentials retain generic failures even for an unknown account', async t => {
  const { request } = await setup(t);
  const expected = { error: 'Unable to sign in with these details.', code: 'invalid_credentials' };
  for (const body of [
    { email: 'missing@example.com' },
    { email: 'missing@example.com', password: '' },
    { email: 'missing@example.com', password: ['password'] },
    { email: 'missing@example.com', password: 'x'.repeat(129) },
    { email: 'not-an-email', password },
    { email: { address: 'missing@example.com' }, password }
  ]) {
    const result = await request('/api/login', body);
    assert.equal(result.status, 401);
    assert.deepEqual(result.data, expected);
    assert.equal(result.cookie, '');
  }
});

test('registration never reveals duplicates or mail transport failures and cannot assign account privileges', async t => {
  const { db, request } = await setup(t, { sendMail: async () => { throw new Error('private SMTP test failure'); } });
  const details = { email: 'new@example.com', name: 'New member', password: 'a unique new test passphrase', terms: true,
    verified: true, google_sub: 'attacker', id: 99 };
  const fresh = await request('/api/register', details);
  const duplicate = await request('/api/register', details);
  const existing = await request('/api/register', { ...details, email: 'member@example.com' });
  assert.equal(fresh.status, 202);
  assert.equal(duplicate.status, fresh.status);
  assert.equal(existing.status, fresh.status);
  assert.deepEqual(duplicate.data, fresh.data);
  assert.deepEqual(existing.data, fresh.data);
  assert.deepEqual(Object.keys(fresh.data).sort(), ['message', 'session', 'success']);
  const saved = db.prepare('SELECT * FROM users WHERE email=?').get(details.email);
  assert.equal(saved.verified, 0);
  assert.equal(saved.google_sub, null);
  assert.notEqual(saved.id, 99);
  assert.match(saved.password, /^scrypt\$v1\$131072\$8\$1\$/);
  assert.equal(db.prepare('SELECT name,password FROM users WHERE id=1').get().password, legacy);
  await settle();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
});

test('registration and existing-account recovery respond without waiting for mail while missing accounts get a clear error', async t => {
  const pending = [];
  const { db, request } = await setup(t, { sendMail: () => new Promise(resolve => pending.push(resolve)) });
  try {
    const registered = await request('/api/register', { email: 'queued@example.com', name: 'Queued member', password: 'a queued mail test passphrase', terms: true });
    assert.equal(registered.status, 202);
    const known = await request('/api/forgot-password', { email: 'member@example.com' });
    const unverified = await request('/api/forgot-password', { email: '  UNVERIFIED@Example.COM  ' });
    const tokenCount = db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count;
    const unknown = await request('/api/forgot-password', { email: '  UNKNOWN@Example.COM  ' });
    assert.equal(known.status, 200);
    assert.equal(unverified.status, known.status, 'An unverified account exists but is not eligible for reset mail');
    assert.deepEqual(unverified.data, known.data);
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.data, accountNotFound);
    assert.equal(unknown.cookie, '');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, tokenCount);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens WHERE user_id=2').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 5);
    assert.equal(pending.length, 2);
  } finally { pending.forEach(resolve => resolve()); await settle(); await settle(); }
});

test('recovery validates email input and verification resends stay neutral for unknown accounts', async t => {
  const { db, mails, request } = await setup(t, { authSecurityLimits: { emailIP: 10 } });
  for (const email of ['not-an-email', 'member\u0000@example.com', { address: 'member@example.com' }]) {
    const invalid = await request('/api/forgot-password', { email });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.data, { error: 'Enter a valid email address.' });
    assert.equal(invalid.cookie, '');
  }
  const unknown = await request('/api/resend', { email: 'unknown@example.com' });
  const verified = await request('/api/resend', { email: 'member@example.com' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.data, verified.data);
  await settle();
  assert.deepEqual(mails, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
});

test('server rejects bypassed validation, malformed JSON, control characters, oversize data and forged origins', async t => {
  const { db, request } = await setup(t, { authSecurityLimits: { registrationAccount: 10 } });
  const details = { email: 'valid@example.com', name: 'Member', password: 'a valid new registration passphrase', terms: true };
  for (const body of [
    { ...details, name: {} }, { ...details, name: 'a\u0000b' }, { ...details, email: 'member\u0000@example.com' },
    { ...details, terms: 'true' }, { ...details, password: 'short' }
  ]) assert.equal((await request('/api/register', body)).status, 400);
  assert.equal((await request('/api/register', details)).status, 429, 'invalid attempts are rate limited too');
  assert.equal((await request('/api/login', [], {})).status, 400);
  assert.equal((await request('/api/login', '{', { raw: true })).status, 400);
  assert.equal((await request('/api/login', { email: 'x'.repeat(20000), password })).status, 413);
  assert.equal((await request('/api/login', { email: 'member@example.com', password }, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/login', { email: 'member@example.com', password }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 4);
});

test('queued recovery messages cannot recreate valid reset tokens after email or password changes', async t => {
  const pending = [];
  const recipients = [];
  const { db, request } = await setup(t, { sendMail: mail => {
    recipients.push(mail.to);
    return new Promise(resolve => pending.push(resolve));
  } });
  db.prepare('INSERT INTO users(id,email,name,password,verified,created_at) VALUES (?,?,?,?,1,?)')
    .run(5, 'waiting@example.com', 'Waiting member', legacy, Date.now());
  db.prepare('UPDATE users SET verified=1 WHERE id=2').run();
  try {
    for (const email of ['member@example.com', 'corrupt@example.com', 'waiting@example.com', 'unverified@example.com']) {
      assert.equal((await request('/api/forgot-password', { email })).status, 200);
    }
    assert.equal(pending.length, 2);
    db.prepare('UPDATE users SET email=? WHERE id=5').run('changed@example.com');
    db.prepare('UPDATE users SET password=? WHERE id=2').run('changed-credential-record');
  } finally { pending.forEach(resolve => resolve()); await settle(); await settle(); }
  assert.deepEqual(recipients, ['member@example.com', 'corrupt@example.com']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens WHERE user_id IN (2,5)').get().count, 0);
});

test('dedicated login and register throttles run before password work and reject untrusted forwarded headers', async t => {
  const { request } = await setup(t, { trustProxy: '192.0.2.1', authSecurityLimits: { loginIP: 2, loginAccount: 10, registrationIP: 2 } });
  const login = { email: 'unknown@example.com', password };
  assert.equal((await request('/api/login', login)).status, 404);
  assert.equal((await request('/api/login', login)).status, 404);
  const limited = await request('/api/login', login, { headers: { 'X-Forwarded-For': '198.51.100.42' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  const registration = { email: 'member@example.com', name: 'Member', password, terms: true };
  assert.equal((await request('/api/register', registration)).status, 202);
  assert.equal((await request('/api/register', { ...registration, email: 'other@example.com' })).status, 202);
  const blocked = await request('/api/register', { ...registration, email: 'last@example.com' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.data, limited.data);
});

test('one-proxy default uses the nearest forwarded client IP for login throttling', async t => {
  const { request } = await setup(t, { authSecurityLimits: { loginIP: 2, loginAccount: 10 } });
  for (let index = 0; index < 3; index++) {
    const result = await request('/api/login', { email: `unknown-${index}@example.com`, password }, {
      headers: { 'X-Forwarded-For': `198.51.100.${index + 1}, 203.0.113.42` }
    });
    assert.equal(result.status, index === 2 ? 429 : 404);
  }
  const otherClient = await request('/api/login', { email: 'other-client@example.com', password }, {
    headers: { 'X-Forwarded-For': '203.0.113.43' }
  });
  assert.equal(otherClient.status, 404);
});

test('login upgrades old hashes and rotates an existing cookie while keeping the newly issued session within its cap', async t => {
  const { db, request, session } = await setup(t);
  const oldCookie = session('old-current-session');
  for (let index = 0; index < 12; index += 1) {
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(`old-device-${index}`), 1, Date.now() + 7 * 86400000);
  }
  const loggedIn = await request('/api/login', { email: '  MEMBER@Example.COM  ', password }, { cookie: oldCookie });
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.data.user.email, 'member@example.com');
  assert.notEqual(loggedIn.cookie, oldCookie);
  assert.match(loggedIn.headers.get('set-cookie'), /HttpOnly/);
  assert.match(loggedIn.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=1').get().count, 10);
  assert.match(db.prepare('SELECT password FROM users WHERE id=1').get().password, /^scrypt\$v1\$131072\$8\$1\$/);
  assert.equal((await request('/api/session', undefined, { cookie: oldCookie })).data.session, null);
  assert.equal((await request('/api/session', undefined, { cookie: loggedIn.cookie })).data.user.id, 1);
});

test('idle and absolute session expiry invalidate sessions and all associated security proofs', async t => {
  const { db, request, session } = await setup(t);
  const now = Date.now();
  const idle = session('idle-expired-session', 1, { seen: now - 31 * 60000 });
  db.prepare('INSERT INTO settings_session_verifications VALUES (?,?)').run(digest('idle-expired-session'), now);
  assert.equal((await request('/api/session', undefined, { cookie: idle })).data.session, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM settings_session_verifications').get().count, 0);
  const absolute = session('absolute-expired-session', 1, { created: now - 25 * 3600000 });
  assert.equal((await request('/api/session', undefined, { cookie: absolute })).data.session, null);
  const active = session('active-test-session');
  assert.equal((await request('/api/session', undefined, { cookie: active })).data.user.id, 1);
  assert.equal((await request('/api/session', undefined, { cookie: active + '; ' + active })).data.session, null);
});

test('production recognises HTTPS behind one proxy and issues host-only secure session cookies', async t => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  assert.throws(() => createApp({ database: ':memory:', base: 'http://localhost:3000' }), /HTTPS/);
  assert.throws(() => createApp({ database: ':memory:', base: 'https://secure.example', trustProxy: true }), /TRUST_PROXY/);
  const { request } = await setup(t, { base: 'https://secure.example' });
  assert.equal((await request('/api/session')).status, 400);
  const headers = { 'X-Forwarded-Proto': 'https' };
  const login = await request('/api/login', { email: 'member@example.com', password }, { headers });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^__Host-ck_session=/);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.equal(cookie.includes('Domain='), false);
  assert.match(login.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal((await request('/api/session', undefined, { cookie: login.cookie, headers })).data.user.id, 1);
  assert.equal((await request('/api/session', undefined, { cookie: login.cookie.replace('__Host-ck_session=', 'ck_session='), headers })).data.session, null);
  const untrusted = await setup(t, { base: 'https://untrusted.example', trustProxy: '192.0.2.1' });
  assert.equal((await untrusted.request('/api/session', undefined, { headers })).status, 400, 'untrusted forwarded proto cannot bypass HTTPS');
});
