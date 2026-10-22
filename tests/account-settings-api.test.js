const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, scryptSync } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server');

const hash = value => createHash('sha256').update(value).digest('hex');
const password = 'original-password';
const newPassword = 'A new violet compass passphrase!';
const storedPassword = `settings-salt:${scryptSync(password, 'settings-salt', 64).toString('hex')}`;
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const defaultPreferences = { theme: null, reducedMotion: false, dyslexiaFont: false,
  fontSize: 'default', contrast: 'default', saturation: 'default', cursorSize: 'default' };

async function harness(t, extra = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-settings-'));
  const mails = [];
  const { app, db } = createApp({ database: ':memory:', avatarUploadDir: path.join(directory, 'avatars'),
    evidenceUploadDir: path.join(directory, 'evidence'), evidenceProcessingDir: path.join(directory, 'processing'),
    sendMail: async mail => mails.push(mail), ...extra });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
  t.after(close);
  for (const id of [1, 2]) {
    db.prepare('INSERT OR IGNORE INTO users(id,email,name,password,verified,created_at) VALUES (?,?,?,?,1,?)')
      .run(id, `settings-${id}@example.com`, `Person ${id}`, storedPassword, 1700000000000);
    db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?,?)').run(hash(`session-${id}`), id, Date.now() + 600000);
  }
  let currentCookie = 'ck_session=session-1';
  async function request(endpoint, body, cookie, extraHeaders = {}) {
    const sentCookie = cookie === undefined ? currentCookie : cookie;
    const usesCurrentSession = cookie === undefined || sentCookie.split(';').map(value => value.trim()).includes(currentCookie);
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Origin: 'http://localhost:3000', Cookie: sentCookie,
        ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) })
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes) : null;
    if (usesCurrentSession) {
      const replacement = response.headers.getSetCookie().find(value => /^(?:__Host-)?ck_session=/.test(value));
      if (replacement) currentCookie = replacement.split(';')[0];
    }
    return { status: response.status, data, bytes, location: response.headers.get('location'), cookie: response.headers.get('set-cookie'), headers: response.headers, sentCookie };
  }
  return { db, request, directory, mails, close };
}

test('settings require authentication and update only the signed-in profile and preferences', async t => {
  const { db, request } = await harness(t);
  assert.equal((await request('/api/settings', undefined, '')).status, 401);
  const original = await request('/api/settings');
  assert.equal(original.data.settings.displayName, 'Person 1');
  assert.deepEqual(original.data.stats, { completedActivities: 0, verifiedSkills: 0 });
  assert.equal(original.data.settings.theme, null);
  assert.equal((await request('/api/settings/profile', { displayName: '   ' })).status, 400);
  const updated = await request('/api/settings/profile', { displayName: '  New name  ', userId: 2 });
  assert.equal(updated.data.settings.displayName, 'New name');
  assert.equal(db.prepare('SELECT name FROM users WHERE id=1').get().name, 'New name');
  assert.equal(db.prepare('SELECT name FROM users WHERE id=2').get().name, 'Person 2');
  assert.equal(db.prepare('SELECT display_name FROM profiles WHERE user_id=1').get().display_name, 'New name');
  assert.equal((await request('/api/settings/preferences', { theme: 'system', reducedMotion: false })).status, 400);
  assert.equal((await request('/api/settings/preferences', { theme: 'dark', reducedMotion: true })).status, 200);
  const session = (await request('/api/session')).data.user;
  assert.deepEqual(session.preferences, { ...defaultPreferences, theme: 'dark', reducedMotion: true });
  assert.equal((await request('/api/settings', undefined, 'ck_session=session-2')).data.settings.theme, null);
  assert.equal((await request('/api/settings/profile', { displayName: 'CSRF' }, undefined, { Origin: 'https://evil.example' })).status, 403);
});

test('accessibility preferences round-trip through settings, session, login and export without changing other accounts', async t => {
  const { request } = await harness(t);
  assert.equal(Object.hasOwn((await request('/api/session')).data.user, 'preferences'), false);
  const preferences = { theme: 'dark', reducedMotion: true, dyslexiaFont: true,
    fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' };
  const saved = await request('/api/settings/preferences', { ...preferences, userId: 2 });
  assert.equal(saved.status, 200);
  const savedPreferences = Object.fromEntries(Object.keys(defaultPreferences).map(key => [key, saved.data.settings[key]]));
  assert.deepEqual(savedPreferences, preferences);
  assert.deepEqual((await request('/api/session')).data.user.preferences, preferences);
  assert.deepEqual((await request('/api/settings/export')).data.preferences, preferences);
  assert.equal(Object.hasOwn((await request('/api/session', undefined, 'ck_session=session-2')).data.user, 'preferences'), false);
  const login = await request('/api/login', { email: 'settings-1@example.com', password });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user.preferences, preferences);
  assert.deepEqual(login.data.session.user.preferences, preferences);
  const profile = await request('/api/settings/profile', { displayName: 'Accessible account' });
  assert.equal(profile.data.settings.dyslexiaFont, true);
  assert.equal(profile.data.settings.cursorSize, 'large');
  const avatar = await request('/api/settings/avatar/character', { characterId: 'nova' });
  assert.equal(avatar.data.settings.fontSize, 'large');
  assert.deepEqual((await request('/api/session')).data.user.preferences, preferences);
  assert.deepEqual((await request('/api/settings/export', undefined, 'ck_session=session-2')).data.preferences, defaultPreferences);
});

test('unsaved accounts leave browser preferences alone until an explicit save, including accessibility-only saves', async t => {
  const { db, request } = await harness(t);
  const settings = (await request('/api/settings')).data.settings;
  assert.deepEqual(Object.fromEntries(Object.keys(defaultPreferences).map(key => [key, settings[key]])), defaultPreferences);
  assert.equal(Object.hasOwn((await request('/api/session')).data.user, 'preferences'), false);
  assert.deepEqual((await request('/api/settings/export')).data.preferences, defaultPreferences);
  // Updating an avatar creates account_settings but must not mark preferences saved.
  assert.equal((await request('/api/settings/avatar/character', { characterId: 'nova' })).status, 200);
  assert.equal(db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=1').get().preferences_saved, 0);
  assert.equal(Object.hasOwn((await request('/api/session')).data.user, 'preferences'), false);
  assert.equal((await request('/api/settings/preferences', { fontSize: 'large' })).status, 200);
  assert.equal(db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=1').get().preferences_saved, 1);
  assert.deepEqual((await request('/api/session')).data.user.preferences, { ...defaultPreferences, fontSize: 'large' });
  assert.equal((await request('/api/settings/avatar/remove', {})).status, 200);
  assert.deepEqual((await request('/api/session')).data.user.preferences, { ...defaultPreferences, fontSize: 'large' });
  // Explicitly saving defaults remains a saved choice even without a theme.
  assert.equal((await request('/api/settings/preferences', { fontSize: 'default' })).status, 200);
  assert.deepEqual((await request('/api/session')).data.user.preferences, defaultPreferences);
});

test('partial preference saves preserve accessibility and allow every supported option and explicit reset', async t => {
  const { request } = await harness(t);
  const initial = { dyslexiaFont: true, fontSize: 'small', contrast: 'high', saturation: 'high', cursorSize: 'small' };
  assert.equal((await request('/api/settings/preferences', initial)).status, 200);
  const themeOnly = await request('/api/settings/preferences', { theme: 'light', reducedMotion: true });
  assert.equal(themeOnly.status, 200);
  for (const [key, value] of Object.entries(initial)) assert.equal(themeOnly.data.settings[key], value);
  assert.equal((await request('/api/settings/preferences', { saturation: 'grayscale' })).data.settings.saturation, 'grayscale');
  const reset = { dyslexiaFont: false, fontSize: 'default', contrast: 'default', saturation: 'default', cursorSize: 'default' };
  const saved = await request('/api/settings/preferences', reset);
  assert.equal(saved.status, 200);
  assert.deepEqual((await request('/api/session')).data.user.preferences, { ...defaultPreferences, theme: 'light', reducedMotion: true });
});

test('invalid accessibility updates are rejected atomically rather than clearing saved preferences', async t => {
  const { request } = await harness(t);
  const preferences = { theme: 'dark', reducedMotion: true, dyslexiaFont: true,
    fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' };
  assert.equal((await request('/api/settings/preferences', preferences)).status, 200);
  const invalidValues = {
    theme: ['system', null, 1], reducedMotion: ['false', null, 0], dyslexiaFont: ['true', null, 1, {}],
    fontSize: ['huge', null, 1, true], contrast: ['low', null, false],
    saturation: ['none', null, 0, []], cursorSize: ['huge', null, 2, {}]
  };
  for (const [field, values] of Object.entries(invalidValues)) {
    for (const value of values) {
      const response = await request('/api/settings/preferences', { theme: 'light', fontSize: 'small', [field]: value });
      assert.equal(response.status, 400, `${field}: ${JSON.stringify(value)}`);
    }
  }
  assert.equal((await request('/api/settings/preferences', {})).status, 400);
  assert.equal((await request('/api/settings/preferences', { dyslexiaFont: false }, '')).status, 401);
  assert.equal((await request('/api/settings/preferences', { dyslexiaFont: false }, undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.deepEqual((await request('/api/session')).data.user.preferences, preferences);
  assert.deepEqual((await request('/api/settings/export')).data.preferences, preferences);
});

test('dashboard tour state starts unseen and requires a valid authenticated dismissal', async t => {
  const { db, request } = await harness(t);
  assert.equal((await request('/api/session')).data.user.dashboardTourSeen, false);
  assert.equal((await request('/api/settings')).data.settings.dashboardTourSeen, false);
  assert.deepEqual((await request('/api/settings/export')).data.uiPreferences, { dashboardTourSeen: false });
  assert.equal((await request('/api/settings/dashboard-tour', { status: 'completed' }, '')).status, 401);
  assert.equal((await request('/api/settings/dashboard-tour', { status: 'completed' }, undefined,
    { Origin: 'https://evil.example' })).status, 403);
  for (const body of [{}, [], null, { status: 'started' }, { status: true }, { status: null }, { dashboardTourSeen: true }]) {
    assert.equal((await request('/api/settings/dashboard-tour', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM account_settings').get().count, 0);
  assert.equal((await request('/api/session')).data.user.dashboardTourSeen, false);
  const completed = await request('/api/settings/dashboard-tour', { status: 'completed', userId: 2 });
  assert.equal(completed.status, 200);
  assert.deepEqual(completed.data, { success: true, dashboardTourSeen: true });
  assert.equal((await request('/api/settings')).data.settings.dashboardTourSeen, true);
  assert.equal((await request('/api/session')).data.user.dashboardTourSeen, true);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-2')).data.user.dashboardTourSeen, false);
  assert.equal((await request('/api/settings', undefined, 'ck_session=session-2')).data.settings.dashboardTourSeen, false);
  assert.equal(db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=1').get().preferences_saved, 0);
  assert.equal(Object.hasOwn((await request('/api/session')).data.user, 'preferences'), false);
  assert.deepEqual((await request('/api/settings/export')).data.preferences, defaultPreferences);
  assert.deepEqual((await request('/api/settings/export')).data.uiPreferences, { dashboardTourSeen: true });
  assert.equal((await request('/api/settings/dashboard-tour', { status: 'reset' })).status, 400);
  assert.equal((await request('/api/session')).data.user.dashboardTourSeen, true);
  const login = await request('/api/login', { email: 'settings-1@example.com', password });
  assert.equal(login.data.user.dashboardTourSeen, true);
  assert.equal(login.data.session.user.dashboardTourSeen, true);
  assert.equal(Object.hasOwn(login.data.user, 'preferences'), false);
});

test('skipping the dashboard tour preserves saved preferences and survives avatar and preference changes', async t => {
  const { request } = await harness(t);
  const preferences = { theme: 'dark', reducedMotion: true, dyslexiaFont: true,
    fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' };
  assert.equal((await request('/api/settings/preferences', preferences)).status, 200);
  assert.equal((await request('/api/settings/avatar/character', { characterId: 'nova' })).status, 200);
  const skipped = await request('/api/settings/dashboard-tour', { status: 'skipped' });
  assert.equal(skipped.status, 200);
  assert.deepEqual(skipped.data, { success: true, dashboardTourSeen: true });
  const settings = (await request('/api/settings')).data.settings;
  assert.equal(settings.avatarCharacter, 'nova');
  assert.deepEqual(Object.fromEntries(Object.keys(defaultPreferences).map(key => [key, settings[key]])), preferences);
  assert.equal((await request('/api/settings/preferences', { fontSize: 'small' })).data.settings.dashboardTourSeen, true);
  assert.equal((await request('/api/settings/avatar/character', { characterId: 'pip' })).data.settings.dashboardTourSeen, true);
  const upload = new FormData();
  upload.append('avatar', new Blob([validPng], { type: 'image/png' }), 'tour-avatar.png');
  assert.equal((await request('/api/settings/avatar', upload)).data.settings.dashboardTourSeen, true);
  assert.equal((await request('/api/settings/avatar/remove', {})).data.settings.dashboardTourSeen, true);
  assert.equal((await request('/api/settings/profile', { displayName: 'Tour complete' })).data.settings.dashboardTourSeen, true);
  assert.deepEqual((await request('/api/session')).data.user.preferences, { ...preferences, fontSize: 'small' });
  assert.equal((await request('/api/settings/dashboard-tour', { status: 'completed' })).status, 200);
  assert.equal((await request('/api/session')).data.user.dashboardTourSeen, true);
});

test('dashboard tour dismissal persists after restart without saving accessibility preferences', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-dashboard-tour-'));
  const filename = path.join(directory, 'accounts.sqlite');
  const first = await harness(t, { database: filename });
  assert.equal((await first.request('/api/settings/dashboard-tour', { status: 'skipped' })).status, 200);
  await first.close();
  const restarted = await harness(t, { database: filename });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal((await restarted.request('/api/session')).data.user.dashboardTourSeen, true);
  assert.equal((await restarted.request('/api/settings')).data.settings.dashboardTourSeen, true);
  assert.equal((await restarted.request('/api/session', undefined, 'ck_session=session-2')).data.user.dashboardTourSeen, false);
  assert.equal(restarted.db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=1').get().preferences_saved, 0);
  assert.equal(Object.hasOwn((await restarted.request('/api/session')).data.user, 'preferences'), false);
  assert.deepEqual((await restarted.request('/api/settings/export')).data.uiPreferences, { dashboardTourSeen: true });
});

test('old account databases gain accessibility defaults and retain saved preferences after the server restarts', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-accessibility-migration-'));
  const filename = path.join(directory, 'accounts.sqlite');
  const oldDb = new DatabaseSync(filename);
  oldDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT, verified INTEGER NOT NULL DEFAULT 0, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE account_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT CHECK(theme IN ('light','dark')), reduced_motion INTEGER NOT NULL DEFAULT 0,
      avatar_key TEXT, avatar_version TEXT, updated_at INTEGER NOT NULL, avatar_character TEXT);
  `);
  oldDb.prepare('INSERT INTO users(id,email,name,password,verified,created_at) VALUES (1,?,?,?,?,?)')
    .run('settings-1@example.com', 'Legacy', storedPassword, 1, 1234);
  oldDb.prepare('INSERT INTO account_settings VALUES (?,?,?,?,?,?,?)').run(1, 'dark', 1, null, 'old-version', 1234, 'nova');
  oldDb.close();
  const first = await harness(t, { database: filename });
  const defaults = { ...defaultPreferences, theme: 'dark', reducedMotion: true };
  assert.deepEqual((await first.request('/api/session')).data.user.preferences, defaults);
  const migrated = (await first.request('/api/settings')).data.settings;
  assert.equal(migrated.dashboardTourSeen, false);
  assert.equal((await first.request('/api/session')).data.user.dashboardTourSeen, false);
  assert.throws(() => first.db.prepare('UPDATE account_settings SET dashboard_tour_seen=2 WHERE user_id=1').run(), /CHECK constraint failed/);
  assert.equal(migrated.avatarCharacter, 'nova');
  assert.equal(migrated.avatarUrl, '/api/settings/avatar?version=old-version');
  for (const [key, value] of Object.entries(defaults)) assert.equal(migrated[key], value);
  const preferences = { ...defaults, dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'grayscale', cursorSize: 'small' };
  assert.equal((await first.request('/api/settings/preferences', preferences)).status, 200);
  assert.equal((await first.request('/api/settings/dashboard-tour', { status: 'completed' })).status, 200);
  await first.close();
  const restarted = await harness(t, { database: filename });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual((await restarted.request('/api/session')).data.user.preferences, preferences);
  assert.deepEqual((await restarted.request('/api/settings/export')).data.preferences, preferences);
  assert.equal((await restarted.request('/api/settings')).data.settings.avatarCharacter, 'nova');
  assert.equal((await restarted.request('/api/session')).data.user.dashboardTourSeen, true);
});

test('saved-preference migration recognizes existing accessibility-only rows and leaves avatar-only rows unsaved', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-preference-marker-'));
  const filename = path.join(directory, 'accounts.sqlite');
  const first = await harness(t, { database: filename });
  assert.equal((await first.request('/api/settings/preferences', { fontSize: 'large' })).status, 200);
  assert.equal((await first.request('/api/settings/avatar/character', { characterId: 'nova' }, 'ck_session=session-2')).status, 200);
  // Simulate the schema before saved-preference tracking existed.
  first.db.exec('ALTER TABLE account_settings DROP COLUMN preferences_saved');
  await first.close();
  const upgraded = await harness(t, { database: filename });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual((await upgraded.request('/api/session')).data.user.preferences, { ...defaultPreferences, fontSize: 'large' });
  assert.equal(upgraded.db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=1').get().preferences_saved, 1);
  assert.equal(Object.hasOwn((await upgraded.request('/api/session', undefined, 'ck_session=session-2')).data.user, 'preferences'), false);
  assert.equal(upgraded.db.prepare('SELECT preferences_saved FROM account_settings WHERE user_id=2').get().preferences_saved, 0);
});

test('password changes require proof, revoke other sessions and reset links, and rotate the current session', async t => {
  const { db, request } = await harness(t);
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash('another-session'), 1, Date.now() + 600000);
  db.prepare('INSERT INTO tokens VALUES (?,?,?,?)').run(hash('reset-link'), 1, 'reset', Date.now() + 600000);
  db.prepare('INSERT INTO tokens VALUES (?,?,?,?)').run(hash('verify-link'), 1, 'verify', Date.now() + 600000);
  db.prepare('INSERT INTO settings_email_changes VALUES (?,?,?,?,?)')
    .run(1, hash('pending-email'), 'settings-1@example.com', 'pending@example.com', Date.now() + 600000);
  db.prepare('INSERT INTO settings_session_verifications VALUES (?,?)').run(hash('session-1'), Date.now());
  db.prepare('INSERT INTO settings_oauth_states(hash,intent,nonce,user_id,session_hash,expires) VALUES (?,?,?,?,?,?)')
    .run(hash('pending-oauth'), 'link', 'nonce', 1, hash('session-1'), Date.now() + 600000);
  assert.equal((await request('/api/settings/password', { currentPassword: 'wrong', newPassword })).status, 401);
  assert.equal((await request('/api/settings/password', { currentPassword: password, newPassword: 'short' })).status, 400);
  assert.equal((await request('/api/settings/password', { currentPassword: password, newPassword: 'Password123456789!' })).status, 400);
  const changed = await request('/api/settings/password', { currentPassword: password, newPassword });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.settings.hasPassword, true);
  assert.equal((await request('/api/session')).data.user.id, 1);
  assert.match(changed.cookie, /ck_session=/);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
  assert.equal((await request('/api/session', undefined, 'ck_session=another-session')).data.user, null);
  assert.match(db.prepare('SELECT password FROM users WHERE id=1').get().password, /^scrypt\$v1\$131072\$8\$1\$/);
  for (const table of ['tokens', 'settings_email_changes', 'settings_oauth_states']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=1`).get().count, 0, table);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM settings_session_verifications').get().count, 0);
  assert.equal((await request('/api/login', { email: 'settings-1@example.com', password })).status, 401);
  assert.equal((await request('/api/login', { email: 'settings-1@example.com', password: newPassword })).status, 200);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-2')).data.user.id, 2);
});

test('email changes require password and a single-use new-address confirmation bound to the account', async t => {
  const { db, request, mails } = await harness(t);
  assert.equal((await request('/api/settings/email', { email: 'new@example.com', currentPassword: 'wrong' })).status, 401);
  assert.equal((await request('/api/settings/email', { email: 'settings-2@example.com', currentPassword: password })).status, 409);
  const pending = await request('/api/settings/email', { email: ' New@Example.com ', currentPassword: password });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.pendingEmail, 'new@example.com');
  assert.equal(pending.data.settings.email, 'settings-1@example.com');
  assert.equal(mails[0].to, 'new@example.com');
  const value = new URL(mails[0].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('emailToken');
  assert.equal((await request('/api/settings/email/confirm', { token: value }, 'ck_session=session-2')).status, 400);
  assert.equal((await request('/api/settings/email/confirm', { token: value }, '')).status, 401);
  const confirmed = await request('/api/settings/email/confirm', { token: value });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.settings.email, 'new@example.com');
  assert.equal((await request('/api/session')).data.user.email, 'new@example.com');
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
  assert.equal((await request('/api/settings/email/confirm', { token: value })).status, 400);
  assert.equal(db.prepare('SELECT email FROM users WHERE id=2').get().email, 'settings-2@example.com');
});

test('failed email delivery preserves existing email and removes unusable confirmation token', async t => {
  const { db, request } = await harness(t, { sendMail: async () => { throw new Error('offline'); } });
  assert.equal((await request('/api/settings/email', { email: 'new@example.com', currentPassword: password })).status, 503);
  assert.equal(db.prepare('SELECT email FROM users WHERE id=1').get().email, 'settings-1@example.com');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM settings_email_changes').get().count, 0);
});

test('expired and superseded email confirmation links cannot replace the account email', async t => {
  const { db, request, mails } = await harness(t);
  const getToken = mail => new URL(mail.text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('emailToken');
  await request('/api/settings/email', { email: 'first@example.com', currentPassword: password });
  await request('/api/settings/email', { email: 'second@example.com', currentPassword: password });
  assert.equal((await request('/api/settings/email/confirm', { token: getToken(mails[0]) })).status, 400);
  db.exec('UPDATE settings_email_changes SET expires=1');
  assert.equal((await request('/api/settings/email/confirm', { token: getToken(mails[1]) })).status, 400);
  assert.equal(db.prepare('SELECT email FROM users WHERE id=1').get().email, 'settings-1@example.com');
});

test('avatar uploads validate bytes, normalize privately and stay isolated from other accounts', async t => {
  const { db, request, directory } = await harness(t);
  const upload = (bytes, name, type) => { const form = new FormData(); form.append('avatar', new Blob([bytes], { type }), name); return form; };
  assert.equal((await request('/api/settings/avatar', upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'evil.svg', 'image/svg+xml'))).status, 400);
  assert.equal((await request('/api/settings/avatar', upload(Buffer.from('<svg></svg>'), 'fake.png', 'image/png'))).status, 400);
  assert.equal((await request('/api/settings/avatar', upload(Buffer.concat([validPng.subarray(0, 33), Buffer.from('IEND')]), 'corrupt.png', 'image/png'))).status, 400);
  assert.equal((await request('/api/settings/avatar', upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'big.png', 'image/png'))).status, 413);
  const saved = await request('/api/settings/avatar', upload(validPng, 'photo.png', 'image/png'));
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.settings.avatarCharacter, null);
  assert.match(saved.data.settings.avatarUrl, /^\/api\/settings\/avatar\?version=[a-f0-9]+$/);
  assert.equal((await request('/api/session')).data.user.avatar_url, saved.data.settings.avatarUrl);
  const download = await request(saved.data.settings.avatarUrl);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.ok(download.bytes.subarray(0, 8).equals(validPng.subarray(0, 8)));
  assert.equal((await request(saved.data.settings.avatarUrl, undefined, '')).status, 401);
  assert.equal((await request(saved.data.settings.avatarUrl, undefined, 'ck_session=session-2')).status, 404);
  const key = db.prepare('SELECT avatar_key FROM account_settings WHERE user_id=1').get().avatar_key;
  assert.equal((await request(`/data/avatars/${key}`)).status, 404);
  const removed = await request('/api/settings/avatar/remove', {});
  assert.equal(removed.data.settings.avatarUrl, null);
  assert.equal(existsSync(path.join(directory, 'avatars', key)), false);
  assert.equal(readdirSync(path.join(directory, 'avatars')).length, 0);
});

test('character avatars persist, stay account-specific and replace uploaded pictures without leaving private files', async t => {
  const { db, request, directory } = await harness(t);
  const endpoint = '/api/settings/avatar/character';
  assert.equal((await request(endpoint, { characterId: 'nova' }, '')).status, 401);
  for (const characterId of ['unknown', '../nova', '/assets/avatars/nova.png', '__proto__', '', null, { id: 'nova' }]) {
    assert.equal((await request(endpoint, { characterId })).status, 400);
  }
  assert.equal((await request(endpoint, { characterId: 'nova' }, undefined, { Origin: 'https://evil.example' })).status, 403);
  const photo = new FormData();
  photo.append('avatar', new Blob([validPng], { type: 'image/png' }), 'photo.png');
  assert.equal((await request('/api/settings/avatar', photo)).status, 200);
  const formerKey = db.prepare('SELECT avatar_key FROM account_settings WHERE user_id=1').get().avatar_key;
  assert.ok(existsSync(path.join(directory, 'avatars', formerKey)));
  const chosen = await request(endpoint, { characterId: 'nova', userId: 2 });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.data.settings.avatarCharacter, 'nova');
  assert.match(chosen.data.settings.avatarUrl, /^\/api\/settings\/avatar\?version=[a-f0-9]{16}$/);
  assert.equal(db.prepare('SELECT avatar_key FROM account_settings WHERE user_id=1').get().avatar_key, null);
  assert.equal(existsSync(path.join(directory, 'avatars', formerKey)), false);
  assert.equal((await request('/api/session')).data.user.avatar_url, chosen.data.settings.avatarUrl);
  assert.equal((await request('/api/settings')).data.settings.avatarCharacter, 'nova');
  assert.equal((await request('/api/settings', undefined, 'ck_session=session-2')).data.settings.avatarCharacter, null);
  assert.equal((await request(chosen.data.settings.avatarUrl, undefined, '')).status, 401);
  assert.equal((await request(chosen.data.settings.avatarUrl, undefined, 'ck_session=session-2')).status, 404);
  const download = await request(chosen.data.settings.avatarUrl);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.ok(download.bytes.equals(readFileSync(path.join(__dirname, '..', 'assets', 'avatars', 'nova.png'))));
  const second = await request(endpoint, { characterId: 'pip' }, 'ck_session=session-2');
  assert.equal(second.status, 200);
  const otherPhoto = await request(chosen.data.settings.avatarUrl, undefined, 'ck_session=session-2');
  assert.ok(otherPhoto.bytes.equals(readFileSync(path.join(__dirname, '..', 'assets', 'avatars', 'pip.png'))));
  assert.equal((await request('/api/settings/preferences', { theme: 'dark', reducedMotion: true })).data.settings.avatarCharacter, 'nova');
  assert.equal((await request('/api/settings/export')).data.account.avatarCharacter, 'nova');
  const newPhoto = new FormData();
  newPhoto.append('avatar', new Blob([validPng], { type: 'image/png' }), 'photo.png');
  const uploaded = await request('/api/settings/avatar', newPhoto);
  assert.equal(uploaded.data.settings.avatarCharacter, null);
  assert.ok(db.prepare('SELECT avatar_key FROM account_settings WHERE user_id=1').get().avatar_key);
  const reselected = await request(endpoint, { characterId: 'luna' });
  assert.equal(reselected.data.settings.avatarCharacter, 'luna');
  const removed = await request('/api/settings/avatar/remove', {});
  assert.equal(removed.data.settings.avatarCharacter, null);
  assert.equal(removed.data.settings.avatarUrl, null);
  assert.equal((await request('/api/settings/avatar')).status, 404);
  assert.equal((await request('/api/session')).data.user.avatar_url, null);
  assert.equal((await request('/api/settings', undefined, 'ck_session=session-2')).data.settings.avatarCharacter, 'pip');
  assert.equal(readdirSync(path.join(directory, 'avatars')).length, 0);
});

test('avatar character migration preserves existing uploaded avatars and stores selections durably', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-avatar-migration-'));
  const filename = path.join(directory, 'accounts.sqlite');
  const oldDb = new DatabaseSync(filename);
  oldDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT, verified INTEGER NOT NULL DEFAULT 0, google_sub TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE account_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT CHECK(theme IN ('light','dark')), reduced_motion INTEGER NOT NULL DEFAULT 0,
      avatar_key TEXT, avatar_version TEXT, updated_at INTEGER NOT NULL);
  `);
  oldDb.prepare('INSERT INTO users(id,email,name,password,verified,created_at) VALUES (1,?,?,?,?,?)')
    .run('legacy@example.com', 'Legacy', storedPassword, 1, 1234);
  oldDb.prepare('INSERT INTO account_settings VALUES (?,?,?,?,?,?)').run(1, 'dark', 1, 'e'.repeat(64), 'previous', 1234);
  oldDb.close();
  const { db, request, directory: uploadRoot } = await harness(t, { database: filename });
  // Registered after harness cleanup so its open connection closes first.
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(uploadRoot, 'avatars', 'e'.repeat(64)), validPng);
  const preserved = (await request('/api/settings')).data.settings;
  assert.equal(preserved.avatarCharacter, null);
  assert.equal(preserved.theme, 'dark');
  assert.equal(preserved.reducedMotion, true);
  assert.equal(preserved.avatarUrl, '/api/settings/avatar?version=previous');
  assert.equal((await request('/api/settings/avatar')).status, 200);
  assert.ok(db.prepare('PRAGMA table_info(account_settings)').all().some(column => column.name === 'avatar_character'));
  assert.equal((await request('/api/settings/avatar/character', { characterId: 'sprout' })).status, 200);
  const reopened = new DatabaseSync(filename);
  try {
    const row = reopened.prepare('SELECT avatar_character,theme,reduced_motion,avatar_key FROM account_settings WHERE user_id=1').get();
    assert.equal(row.avatar_character, 'sprout');
    assert.equal(row.theme, 'dark');
    assert.equal(row.reduced_motion, 1);
    assert.equal(row.avatar_key, null);
  } finally { reopened.close(); }
  assert.equal(existsSync(path.join(uploadRoot, 'avatars', 'e'.repeat(64))), false);
});

test('session revocation keeps the current account session and leaves other accounts alone', async t => {
  const { db, request } = await harness(t);
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash('old-session'), 1, Date.now() + 600000);
  assert.equal((await request('/api/settings/sessions/revoke', {})).status, 200);
  assert.equal((await request('/api/session')).data.user.id, 1);
  assert.equal((await request('/api/session', undefined, 'ck_session=old-session')).data.user, null);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-2')).data.user.id, 2);
});

function seedJourney(db, userId, storageKey) {
  const now = Date.now();
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES (?,?,'teacher','Teacher','active',?)").run(userId, userId, now);
  db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES (?,?,1,'Start',1,'Learn')").run(userId, userId);
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status,completed_at) VALUES (?,?,'completed',?)").run(userId, userId, now);
  db.prepare("INSERT INTO evidence_submissions(id,user_id,roadmap_step_id,file_name,file_storage_key,text_content,submitted_at) VALUES (?,?,?,'work.txt',?,'My learning evidence',?)")
    .run(userId, userId, userId, storageKey, now);
  db.prepare("INSERT INTO user_skills(id,user_id,skill_name,normalized_name,first_verified_at,last_verified_at) VALUES (?,?,'Teaching','teaching',?,?)").run(userId, userId, now, now);
  db.prepare('INSERT INTO skill_verifications(user_id,user_skill_id,evidence_submission_id,roadmap_step_id,created_at) VALUES (?,?,?,?,?)').run(userId, userId, userId, userId, now);
  db.prepare("INSERT INTO lumia_conversations(id,user_id,title,created_at,updated_at) VALUES (?,?,'Career chat',?,?)").run(userId, userId, now, now);
  db.prepare("INSERT INTO lumia_messages(conversation_id,user_id,role,content,created_at) VALUES (?,?,'user',?,?)").run(userId, userId, `Message for ${userId}`, now);
}

test('account export includes owned journey and Lumia data without authentication secrets or storage keys', async t => {
  const { db, request } = await harness(t);
  seedJourney(db, 1, 'a'.repeat(64));
  seedJourney(db, 2, 'b'.repeat(64));
  const exported = await request('/api/settings/export');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment.*careerkraft-account\.json/);
  assert.equal(exported.data.account.email, 'settings-1@example.com');
  assert.equal(exported.data.roadmaps.length, 1);
  assert.equal(exported.data.evidence[0].text_content, 'My learning evidence');
  assert.equal(exported.data.lumia.messages[0].content, 'Message for 1');
  assert.equal(exported.data.skills.length, 1);
  const json = JSON.stringify(exported.data);
  for (const secret of ['password', 'google_sub', 'file_storage_key', 'avatar_key', 'session_hash', 'settings-2@example.com', 'Message for 2', 'a'.repeat(64)]) assert.ok(!json.includes(secret), secret);
});

test('deletion requires explicit confirmation and password and removes owned data and files only', async t => {
  const { db, request, directory } = await harness(t);
  seedJourney(db, 1, 'a'.repeat(64));
  seedJourney(db, 2, 'b'.repeat(64));
  writeFileSync(path.join(directory, 'evidence', 'a'.repeat(64)), 'first file');
  writeFileSync(path.join(directory, 'evidence', 'b'.repeat(64)), 'second file');
  db.prepare('INSERT INTO early_access(email,created_at) VALUES (?,?)').run('settings-1@example.com', 1);
  db.prepare('INSERT INTO tokens VALUES (?,?,?,?)').run(hash('pending-reset'), 1, 'reset', Date.now() + 600000);
  db.prepare('INSERT INTO settings_email_changes VALUES (?,?,?,?,?)').run(1, hash('email'), 'settings-1@example.com', 'future@example.com', Date.now() + 600000);
  db.prepare('INSERT INTO account_settings(user_id,avatar_key,avatar_version,updated_at) VALUES (?,?,?,?)').run(1, 'd'.repeat(64), 'version', Date.now());
  writeFileSync(path.join(directory, 'avatars', 'd'.repeat(64)), validPng);
  db.exec("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES (3,1,1,'Start',2,'Work')");
  db.prepare('INSERT INTO evidence_submissions(id,user_id,roadmap_step_id,file_storage_key,submitted_at) VALUES (3,1,3,?,?)').run('../outside.txt', Date.now());
  writeFileSync(path.join(directory, 'outside.txt'), 'Do not delete this');
  assert.equal((await request('/api/settings/delete', { currentPassword: password, confirmation: 'delete' })).status, 400);
  assert.equal((await request('/api/settings/delete', { currentPassword: 'wrong', confirmation: 'DELETE' })).status, 401);
  const deleted = await request('/api/settings/delete', { currentPassword: password, confirmation: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.match(deleted.cookie, /ck_session=;/);
  for (const table of ['users', 'sessions', 'tokens', 'roadmaps', 'roadmap_progress', 'evidence_submissions', 'user_skills', 'skill_verifications', 'lumia_conversations', 'lumia_messages', 'settings_email_changes', 'account_settings']) {
    const key = table === 'users' ? 'id' : 'user_id';
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key}=1`).get().count, 0, table);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM early_access').get().count, 0);
  assert.equal(existsSync(path.join(directory, 'evidence', 'a'.repeat(64))), false);
  assert.equal(readFileSync(path.join(directory, 'evidence', 'b'.repeat(64)), 'utf8'), 'second file');
  assert.equal(existsSync(path.join(directory, 'avatars', 'd'.repeat(64))), false);
  assert.equal(readFileSync(path.join(directory, 'outside.txt'), 'utf8'), 'Do not delete this');
  assert.equal((await request('/api/session')).data.user, null);
  assert.equal((await request('/api/settings', undefined, 'ck_session=session-2')).status, 200);
});

function fakeGoogle() {
  const flows = new Map();
  let payload = {};
  return {
    flows,
    payload(value) { payload = value; },
    generateAuthUrl(args) { flows.set(args.state, args); return `https://accounts.google.com/test?state=${args.state}`; },
    async getToken(code) { return { tokens: { id_token: code } }; },
    async verifyIdToken({ idToken }) { const flow = flows.get(idToken); return { getPayload: () => ({
      email_verified: true, email: 'google@example.com', sub: 'google-identity', nonce: flow?.nonce,
      ...payload
    }) }; }
  };
}
async function googleFlow(request, google, intent, cookie, callbackCookie) {
  const start = await request(`/api/google?intent=${intent}`, undefined, cookie);
  const state = new URL(start.location).searchParams.get('state');
  const oauthCookie = `ck_oauth=${state}`;
  const response = await request(`/api/google/callback?state=${state}&code=${state}`, undefined,
    `${callbackCookie === undefined ? start.sentCookie : callbackCookie}; ${oauthCookie}`);
  return { response, state, args: google.flows.get(state) };
}

test('Google linking is explicit, session-bound, nonce-checked, single-use and cannot take another linked identity', async t => {
  const google = fakeGoogle();
  const { db, request } = await harness(t, { googleClient: google });
  assert.equal((await request('/api/google?intent=link', undefined, '')).location, '/auth.html?next=settings.html');
  assert.equal((await request('/api/google?intent=link')).location, '/settings.html?error=google_verification_required');
  assert.equal((await request('/api/settings/google/link', { currentPassword: 'wrong' })).status, 401);
  const authorization = await request('/api/settings/google/link', { currentPassword: password });
  assert.equal(authorization.status, 200);
  assert.equal(authorization.data.url, '/api/google?intent=link');
  assert.equal(authorization.data.settings.securityVerified, true);
  const authorizedCookie = authorization.headers.getSetCookie().find(value => value.startsWith('ck_session=')).split(';')[0];
  assert.notEqual(authorizedCookie, 'ck_session=session-1');
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
  assert.equal((await request('/api/settings', undefined, authorizedCookie)).data.settings.securityVerified, true);
  const wrongSession = await googleFlow(request, google, 'link', undefined, 'ck_session=session-2');
  assert.equal(wrongSession.response.location, '/settings.html?error=google_failed');
  google.payload({ nonce: 'forged' });
  assert.equal((await googleFlow(request, google, 'link')).response.location, '/settings.html?error=google_failed');
  google.payload({});
  db.prepare('UPDATE users SET google_sub=? WHERE id=2').run('google-identity');
  assert.equal((await googleFlow(request, google, 'link')).response.location, '/settings.html?error=google_account_in_use');
  db.exec('UPDATE users SET google_sub=NULL WHERE id=2');
  const linked = await googleFlow(request, google, 'link');
  assert.equal(linked.response.location, '/settings.html?google=linked');
  assert.equal(linked.args.prompt, 'select_account');
  const linkedCookie = linked.response.headers.getSetCookie().find(value => value.startsWith('ck_session=')).split(';')[0];
  assert.notEqual(linkedCookie, authorizedCookie);
  assert.equal((await request('/api/session', undefined, authorizedCookie)).data.user, null);
  assert.equal((await request('/api/settings', undefined, linkedCookie)).data.settings.securityVerified, true);
  assert.equal(db.prepare('SELECT google_sub FROM users WHERE id=1').get().google_sub, 'google-identity');
  assert.equal((await request('/api/settings')).data.settings.googleLinked, true);
  assert.equal((await request('/api/settings')).data.settings.securityVerified, true);
  assert.equal((await request(`/api/google/callback?state=${linked.state}&code=${linked.state}`, undefined, `ck_session=session-1; ck_oauth=${linked.state}`)).location, '/auth.html?error=google_failed');
  assert.equal((await request('/api/settings/google/unlink', { currentPassword: 'wrong' })).status, 401);
  assert.equal((await request('/api/settings/google/unlink', { currentPassword: password })).data.settings.googleLinked, false);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
});

test('Google-only sensitive changes require recent reauthentication of the same linked identity and session', async t => {
  const google = fakeGoogle();
  const { db, request } = await harness(t, { googleClient: google });
  db.exec("UPDATE users SET password=NULL,google_sub='google-identity' WHERE id=1");
  assert.equal((await request('/api/settings/password', { newPassword })).data.code, 'reauth_required');
  google.payload({ sub: 'wrong-google-identity' });
  assert.equal((await googleFlow(request, google, 'reauth')).response.location, '/settings.html?error=google_wrong_account');
  google.payload({});
  const verified = await googleFlow(request, google, 'reauth');
  assert.equal(verified.response.location, '/settings.html?google=verified');
  assert.equal(verified.args.prompt, 'select_account');
  const verifiedCookie = verified.response.headers.getSetCookie().find(value => value.startsWith('ck_session=')).split(';')[0];
  assert.notEqual(verifiedCookie, 'ck_session=session-1');
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
  assert.equal(db.prepare('SELECT verified_at FROM settings_session_verifications WHERE session_hash=?').get(hash('session-1')), undefined);
  assert.equal((await request('/api/settings', undefined, verifiedCookie)).data.settings.securityVerified, true);
  assert.equal((await request('/api/settings/google/unlink', {})).data.code, 'password_required');
  db.exec('UPDATE settings_session_verifications SET verified_at=1');
  assert.equal((await request('/api/settings/password', { newPassword })).data.code, 'reauth_required');
  await googleFlow(request, google, 'reauth');
  assert.equal((await request('/api/settings/password', { newPassword })).status, 200);
  assert.equal((await request('/api/session', undefined, 'ck_session=session-1')).data.user, null);
  assert.equal((await request('/api/settings/google/unlink', { currentPassword: newPassword })).status, 200);
  assert.equal((await request('/api/settings')).data.settings.googleLinked, false);
});

test('ordinary Google sign-in never links an existing password account by matching email', async t => {
  const google = fakeGoogle();
  const { db, request } = await harness(t, { googleClient: google });
  google.payload({ email: 'settings-1@example.com' });
  const login = await googleFlow(request, google, 'login', '');
  assert.equal(login.response.location, '/auth.html?error=google_failed');
  assert.equal(db.prepare('SELECT google_sub FROM users WHERE id=1').get().google_sub, null);
});

test('Google sign-in returns to a constrained settings confirmation URL and rejects external redirects', async t => {
  const google = fakeGoogle();
  const { request } = await harness(t, { googleClient: google });
  const emailToken = 'c'.repeat(64);
  const start = await request(`/api/google?next=${encodeURIComponent(`settings.html?emailToken=${emailToken}`)}`, undefined, '');
  const state = new URL(start.location).searchParams.get('state');
  const completed = await request(`/api/google/callback?state=${state}&code=${state}`, undefined, `ck_oauth=${state}`);
  assert.equal(completed.location, `/settings.html?emailToken=${emailToken}`);
  const unsafe = await request(`/api/google?next=${encodeURIComponent('https://evil.example/settings.html')}`, undefined, '');
  const unsafeState = new URL(unsafe.location).searchParams.get('state');
  const safe = await request(`/api/google/callback?state=${unsafeState}&code=${unsafeState}`, undefined, `ck_oauth=${unsafeState}`);
  assert.equal(safe.location, '/onboarding.html');
});
