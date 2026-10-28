const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { createApp } = require('../server');
const { createDatabase } = require('../database');
const { migrateSqliteToMysql } = require('../scripts/migrate-sqlite-to-mysql');

const testUrl = process.env.MYSQL_TEST_URL;

async function isolatedDatabase(t) {
  const url = new URL(testUrl);
  const name = `careerkraft_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const connection = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password)
  };
  const admin = await mysql.createConnection(connection);
  t.after(async () => {
    // The generated name is the only database this test may remove.
    assert.match(name, /^careerkraft_test_[0-9]+_[a-f0-9]{12}$/);
    try { await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); }
    finally { await admin.end(); }
  });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  return { ...connection, database: name };
}

test('MySQL CV scans preserve analysis, enforce constraints and cascade per account', { skip: !testUrl }, async t => {
  const connection = await isolatedDatabase(t);
  const db = createDatabase({ mysql: connection });
  t.after(() => db.close());
  await db.ready;
  const firstUser = await db.prepare('INSERT INTO users(email,name,created_at) VALUES (?,?,?)')
    .run('cv-one@example.test', 'One', 1792929600123);
  const secondUser = await db.prepare('INSERT INTO users(email,name,created_at) VALUES (?,?,?)')
    .run('cv-two@example.test', 'Two', 1792929600123);
  const insert = db.prepare(`INSERT INTO cv_scans
    (user_id,extracted_text,analysis_json,created_at) VALUES (?,?,?,?)`);
  const text = 'Research project: analysed network traffic. \u{1f4c4}\n'.repeat(2500);
  const analysis = { strengths: ['Clear project'], improvements: ['Explain the approach'],
    missingVerifiedSkills: ['Research'], rewrittenBullets: ['Analysed network traffic in a research project.'] };
  const scan = await insert.run(firstUser.lastInsertRowid, text, JSON.stringify(analysis), 1792929600123);
  const other = await insert.run(secondUser.lastInsertRowid, 'Other CV', '{}', 1792929600456);
  assert.ok(scan.lastInsertRowid > 0);
  assert.ok(other.lastInsertRowid > scan.lastInsertRowid);
  const row = await db.prepare('SELECT * FROM cv_scans WHERE id=?').get(scan.lastInsertRowid);
  assert.equal(row.file_name, null);
  assert.equal(row.extracted_text, text);
  assert.equal(row.created_at, 1792929600123);
  assert.deepEqual(typeof row.analysis_json === 'string' ? JSON.parse(row.analysis_json) : row.analysis_json, analysis);
  for (const score of ['overall_score', 'structure_score', 'clarity_score', 'evidence_score', 'relevance_score']) {
    assert.equal(row[score], 0, score);
  }
  await assert.rejects(insert.run(firstUser.lastInsertRowid, null, '{}', 1), { code: 'ER_BAD_NULL_ERROR' });
  await assert.rejects(insert.run(firstUser.lastInsertRowid, 'CV', '{invalid JSON}', 1), { code: 'ER_INVALID_JSON_TEXT' });
  await assert.rejects(insert.run(999999, 'CV', '{}', 1), { code: 'ER_NO_REFERENCED_ROW_2' });
  const reopened = createDatabase({ mysql: connection });
  try {
    await reopened.ready;
    assert.equal((await reopened.prepare('SELECT COUNT(*) AS count FROM cv_scans').get()).count, 2);
  } finally { await reopened.close(); }
  await db.prepare('DELETE FROM users WHERE id=?').run(firstUser.lastInsertRowid);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM cv_scans WHERE user_id=?')
    .get(firstUser.lastInsertRowid)).count, 0);
  assert.equal((await db.prepare('SELECT id FROM cv_scans WHERE user_id=?')
    .get(secondUser.lastInsertRowid)).id, other.lastInsertRowid);
});

test('MySQL supports account security, settings, roadmaps, conversations and deletion', { skip: !testUrl }, async t => {
  const connection = await isolatedDatabase(t);
  const mails = [];
  const password = 'An original violet compass phrase!';
  const replacement = 'A replacement violet compass phrase!';
  const { app, db, ready } = createApp({
    mysql: connection, sendMail: async mail => mails.push(mail),
    analyseCareerQuizWithLumia: async () => ({ summary: 'Technology', recommendations: [{
      id: 'software-developer', title: 'Software Developer', category: 'Technology',
      matchScore: 90, reason: 'Enjoys building software', strengths: ['Analysis'], roadmapSupported: true
    }] })
  });
  t.after(() => db.close());
  await ready;
  assert.equal(db.dialect, 'mysql');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let cookie = '';
  async function request(endpoint, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Cookie: cookie, Origin: 'http://localhost:3000',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const replacementCookie = response.headers.getSetCookie().find(value => value.startsWith('ck_session='));
    if (replacementCookie) cookie = replacementCookie.split(';')[0];
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    return { status: response.status, data };
  }
  async function waitForMail(count) {
    for (let attempt = 0; attempt < 200 && mails.length < count; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(mails.length, count);
    return new URL(mails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  }
  const details = { email: 'mysql-student@example.test', name: 'MySQL Student', password, terms: true };
  assert.equal((await request('/api/register', details)).status, 202);
  const verification = await waitForMail(1);
  assert.equal((await request('/api/verify', { token: verification })).status, 200);
  assert.equal((await request('/api/verify', { token: verification })).status, 400);
  assert.equal((await request('/api/login', details)).status, 200);
  const member = (await request('/api/session')).data.user;
  assert.equal(member.email, details.email);
  assert.equal((await db.prepare('SELECT created_at FROM users WHERE id=?').get(member.id)).created_at > 1700000000000, true);
  assert.equal((await request('/api/settings/profile', { displayName: 'A new display name' })).status, 200);
  assert.equal((await request('/api/settings/preferences', { theme: 'dark', reducedMotion: true })).status, 200);
  assert.equal((await request('/api/settings')).data.settings.theme, 'dark');
  assert.equal((await request('/api/assessments', {
    interests: ['technology'], subjects: ['computing'], strengths: ['analysis'], work_style: ['research'], matches: []
  })).status, 200);
  assert.equal((await request('/api/profile/career', { career_id: 'software-developer' })).status, 200);
  assert.equal((await request('/api/roadmap', {})).status, 201);
  assert.equal((await request('/api/roadmap', {})).data.existing, true);
  const roadmap = (await request('/api/roadmap')).data.roadmap;
  assert.equal(roadmap.totalSteps, 7);
  const step = roadmap.phases[0].steps[0];
  assert.equal((await request(`/api/roadmap/steps/${step.id}/start`, {})).status, 200);
  assert.equal((await request('/api/lumia/history')).status, 200);
  assert.equal((await request('/api/early-access', { email: details.email })).status, 201);
  assert.equal((await request('/api/early-access', { email: details.email })).status, 409);
  const exported = await request('/api/settings/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.data.account.email, details.email);
  assert.equal(exported.data.roadmaps.length, 1);
  assert.ok((await db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get()).count > 0);
  const previousCookie = cookie;
  assert.equal((await request('/api/forgot-password', { email: details.email })).status, 200);
  const reset = await waitForMail(2);
  const resetResults = await Promise.all([
    request('/api/reset-password', { token: reset, password: replacement }),
    request('/api/reset-password', { token: reset, password: replacement })
  ]);
  assert.deepEqual(resetResults.map(result => result.status).sort(), [200, 400]);
  cookie = previousCookie;
  assert.equal((await request('/api/session')).data.session, null);
  assert.equal((await request('/api/login', { ...details, password: replacement })).status, 200);
  assert.equal((await request('/api/settings/delete', { currentPassword: replacement, confirmation: 'DELETE' })).status, 200);
  for (const table of ['users', 'sessions', 'tokens', 'roadmaps', 'roadmap_steps', 'roadmap_progress', 'account_settings', 'lumia_conversations']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count, 0, table);
  }
});

test('SQLite imports into real MySQL without changing the source and refuses a second import', { skip: !testUrl }, async t => {
  const connection = await isolatedDatabase(t);
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-mysql-live-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'accounts.sqlite');
  const legacy = createApp({ database: filename });
  legacy.db.prepare('INSERT INTO users(id,email,name,password,verified,created_at) VALUES (?,?,?,?,?,?)')
    .run(42, 'existing@example.test', 'Existing student', 'preserved-password-hash', 1, 1792929600123);
  legacy.db.prepare('INSERT INTO account_settings(user_id,theme,updated_at) VALUES (?,?,?)').run(42, 'dark', 1792929600123);
  legacy.db.close();
  const before = readFileSync(filename);
  const createTarget = () => createDatabase({ mysql: connection });
  const result = await migrateSqliteToMysql({ sourcePath: filename, createTarget });
  assert.equal(result.counts.users, 1);
  assert.deepEqual(readFileSync(filename), before);
  const db = createTarget();
  try {
    const imported = await db.prepare('SELECT id,password,created_at FROM users').get();
    assert.deepEqual(imported, { id: 42, password: 'preserved-password-hash', created_at: 1792929600123 });
    assert.equal((await db.prepare('SELECT theme FROM account_settings WHERE user_id=42').get()).theme, 'dark');
  } finally { await db.close(); }
  await assert.rejects(migrateSqliteToMysql({ sourcePath: filename, createTarget }), { code: 'target_not_empty' });
});
