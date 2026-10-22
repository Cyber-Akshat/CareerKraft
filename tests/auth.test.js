const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server');

test('existing roadmap tables are migrated to include updated_at', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-roadmap-'));
  const filename = path.join(directory, 'accounts.sqlite');
  const oldDb = new DatabaseSync(filename);
  oldDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users(id) VALUES (1);
    CREATE TABLE roadmaps (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      career_id TEXT NOT NULL,
      career_title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, career_id)
    );
    INSERT INTO roadmaps(user_id,career_id,career_title,status,created_at)
      VALUES (1,'software-developer','Software Developer','active',1234);
  `);
  oldDb.close();
  const { db } = createApp({ database: filename });
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const columns = db.prepare('PRAGMA table_info(roadmaps)').all().map(column => column.name);
  assert.ok(columns.includes('updated_at'));
  assert.equal(db.prepare('SELECT updated_at FROM roadmaps WHERE id=1').get().updated_at, 1234);
});

test('registration, verification, login, reset and logout use private server sessions', async t => {
  const mails = [];
  const { app, db } = createApp({ database: ':memory:', sendMail: async mail => mails.push(mail) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); db.close(); });
  async function request(endpoint, body, cookie = '', origin = 'http://localhost:3000') {
    const response = await fetch(address + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'
    });
    return { status: response.status, cookie: response.headers.get('set-cookie'), data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
  }
  const details = { email: 'tester@example.com', name: 'Tester', password: 'original-password', terms: true };
  assert.equal((await request('/api/register', details, '', 'https://attacker.example')).status, 403);
  assert.equal((await request('/api/register', { ...details, terms: false })).status, 400);
  const registered = await request('/api/register', details);
  assert.equal(registered.status, 202);
  assert.equal(registered.data.session, null);
  assert.equal(mails.length, 1);
  const saved = db.prepare('SELECT * FROM users').get();
  assert.notEqual(saved.password, details.password);
  assert.equal((await request('/api/login', details)).data.code, 'invalid_credentials');
  const verificationToken = new URL(mails[0].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  assert.notEqual(db.prepare('SELECT hash FROM tokens').get().hash, verificationToken);
  assert.match(verificationToken, /^[a-f0-9]{64}$/);
  const expires = db.prepare('SELECT expires FROM tokens').get().expires;
  assert.ok(expires > Date.now() + 59 * 60000 && expires <= Date.now() + 60 * 60000);
  assert.equal((await request('/api/verify', { token: 'bad' })).status, 400);
  const verified = await request('/api/verify', { token: verificationToken });
  assert.equal(verified.status, 200);
  assert.match(verified.cookie, /HttpOnly/);
  assert.match(verified.cookie, /SameSite=Lax/);
  const cookie = verified.cookie.split(';')[0];
  assert.equal((await request('/api/session', undefined, cookie)).data.user.email, details.email);
  assert.equal((await request('/api/profile', undefined, cookie)).data.profile, null);
  assert.equal((await request('/api/profile', { display_name: 'Tester' }, cookie)).status, 200);
  assert.deepEqual((await request('/api/profile', undefined, cookie)).data.profile, {
    display_name: 'Tester', selected_career: null, onboarding_completed: 0
  });
  const noCareerRoadmap = await request('/api/roadmap', undefined, cookie);
  assert.equal(noCareerRoadmap.status, 200);
  assert.deepEqual(noCareerRoadmap.data, { roadmap: null, selectedCareer: null });
  assert.equal((await request('/api/assessments', {
    interests: ['technology'], subjects: ['computing'], strengths: ['analysis'],
    work_style: ['research'], matches: [{ id: 'software-developer', title: 'Software Developer', category: 'Technology', description: 'Build software.', score: 4, reasons: ['Technology'] }]
  }, cookie)).status, 200);
  assert.deepEqual(JSON.parse(db.prepare('SELECT matches FROM career_assessments WHERE user_id=?').get(saved.id).matches), [
    { id: 'software-developer', title: 'Software Developer', category: 'Technology', description: 'Build software.', score: 4, reasons: ['Technology'] }
  ]);
  assert.deepEqual({ ...db.prepare('SELECT rank,career_id,title,category,score,reasons FROM career_matches WHERE user_id=?').get(saved.id) }, {
    rank: 1, career_id: 'software-developer', title: 'Software Developer', category: 'Technology', score: 4, reasons: '["Technology"]'
  });
  assert.equal((await request('/api/profile/career', { career_id: 'software-developer' }, cookie)).status, 200);
  assert.equal((await request('/api/profile', undefined, cookie)).data.profile.onboarding_completed, 1);
  assert.deepEqual({ ...db.prepare('SELECT career_id,title FROM selected_career WHERE user_id=?').get(saved.id) }, {
    career_id: 'software-developer', title: 'Software Developer'
  });
  const emptyRoadmap = await request('/api/roadmap', undefined, cookie);
  assert.equal(emptyRoadmap.status, 200);
  assert.equal(emptyRoadmap.data.roadmap, null);
  assert.deepEqual(emptyRoadmap.data.selectedCareer, { id: 'software-developer', title: 'Software Developer' });
  const createdRoadmap = await request('/api/roadmap', {}, cookie);
  assert.equal(createdRoadmap.status, 201, JSON.stringify(createdRoadmap.data));
  assert.equal(createdRoadmap.data.existing, false);
  assert.equal(createdRoadmap.data.totalSteps, 7);
  const roadmapRow = db.prepare('SELECT id,career_id,career_title,status,created_at,updated_at FROM roadmaps WHERE user_id=?').get(saved.id);
  assert.equal(roadmapRow.id, createdRoadmap.data.roadmapId);
  assert.equal(roadmapRow.career_id, 'software-developer');
  assert.equal(roadmapRow.updated_at, roadmapRow.created_at);
  const roadmap = await request('/api/roadmap', undefined, cookie);
  assert.equal(roadmap.status, 200);
  assert.deepEqual(roadmap.data.roadmap.career, {
    id: 'software-developer', title: 'Software Developer'
  });
  assert.equal(roadmap.data.roadmap.totalSteps, 7);
  assert.equal(roadmap.data.roadmap.progress, 0);
  assert.equal(roadmap.data.roadmap.completedSteps, 0);
  assert.deepEqual(roadmap.data.roadmap.nextStep, {
    level: 'beginner',
    levelStepNumber: 1,
    id: roadmap.data.roadmap.phases[0].steps[0].id,
    title: 'Understand how software is built',
    description: 'Learn how developers turn a problem into a working website, app or digital system.',
    estimatedMinutes: 20,
    activityType: 'learning',
    evidenceRequired: true,
    evidenceStatus: null
  });
  assert.deepEqual(roadmap.data.roadmap.phases.map(phase => ({
    phaseNumber: phase.phaseNumber,
    title: phase.title,
    stepCount: phase.steps.length
  })), [
    { phaseNumber: 1, title: 'Understand the foundations', stepCount: 3 },
    { phaseNumber: 2, title: 'Try the career', stepCount: 2 },
    { phaseNumber: 3, title: 'Build proof', stepCount: 1 },
    { phaseNumber: 4, title: 'Prepare for opportunities', stepCount: 1 }
  ]);
  assert.equal(roadmap.data.roadmap.phases[0].steps[0].status, 'not_started');
  db.prepare(`UPDATE roadmap_progress SET status='completed', completed_at=?
    WHERE user_id=? AND roadmap_step_id IN (?,?)`).run(
    Date.now(),
    saved.id,
    roadmap.data.roadmap.phases[0].steps[0].id,
    roadmap.data.roadmap.phases[0].steps[1].id
  );
  const updatedRoadmap = await request('/api/roadmap', undefined, cookie);
  assert.equal(updatedRoadmap.data.roadmap.completedSteps, 2);
  assert.equal(updatedRoadmap.data.roadmap.progress, 29);
  assert.equal(updatedRoadmap.data.roadmap.nextStep.title, 'Learn Git and version control');
  assert.equal(updatedRoadmap.data.roadmap.phases[0].steps[0].status, 'completed');
  const existingRoadmap = await request('/api/roadmap', {}, cookie);
  assert.equal(existingRoadmap.status, 200);
  assert.equal(existingRoadmap.data.existing, true);
  const careerData = await request('/api/assessment', undefined, cookie);
  assert.equal(careerData.status, 200);
  assert.deepEqual(careerData.data.assessment, {
    interests: ['technology'], subjects: ['computing'], strengths: ['analysis'], work_style: ['research']
  });
  assert.deepEqual(careerData.data.matches[0].reasons, ['Technology']);
  assert.equal(careerData.data.matches[0].description, 'Build software.');
  assert.deepEqual(careerData.data.selectedCareer, { id: 'software-developer', title: 'Software Developer' });
  assert.equal((await request('/api/assessments', {
    interests: ['technology'], subjects: ['computing'], strengths: ['analysis'],
    work_style: ['research'], matches: [{ id: 'invalid', title: 'Bad', category: 'Bad', score: Infinity }]
  }, cookie)).status, 400);
  // Every career uses the shared template, including careers absent from the old inline list.
  for (const [id, template] of Object.entries(require('../roadmap-templates'))) {
    db.prepare('UPDATE selected_career SET career_id=?, title=? WHERE user_id=?').run(id, id, saved.id);
    const built = await request('/api/roadmap', {}, cookie);
    assert.ok([200, 201].includes(built.status), JSON.stringify(built.data));
    const loaded = (await request('/api/roadmap', undefined, cookie)).data.roadmap;
    assert.equal(loaded.career.id, id);
    assert.equal(loaded.totalSteps, template.length);
    assert.ok(loaded.phases.flatMap(phase => phase.steps).every(step => step.evidenceRequired));
    assert.deepEqual(loaded.phases.flatMap(phase => phase.steps.map(step => step.title)), template.map(step => step.title));
  }
  assert.equal((await request('/api/early-access', { email: ' Person@Example.com ' })).status, 201);
  assert.equal((await request('/api/early-access', { email: 'person@example.com' })).data.code, 'duplicate_email');
  assert.equal(db.prepare('SELECT email FROM early_access').get().email, 'person@example.com');
  assert.equal((await request('/api/profile')).status, 401);
  assert.equal((await request('/api/assessment')).status, 401);
  assert.equal((await request('/api/roadmap')).status, 401);
  assert.equal((await request('/api/verify', { token: verificationToken })).status, 400);
  assert.equal((await request('/api/login', { ...details, password: 'wrong' })).status, 401);
  assert.equal((await request('/api/login', details)).status, 200);
  assert.equal((await request('/api/forgot-password', { email: details.email })).status, 200);
  const resetToken = new URL(mails[1].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  assert.equal((await request('/api/reset-password', { token: resetToken, password: 'updated-password-for-tests' })).status, 200);
  assert.equal((await request('/api/session', undefined, cookie)).data.session, null);
  assert.equal((await request('/api/reset-password', { token: resetToken, password: 'another-password' })).status, 400);
  assert.equal((await request('/api/login', details)).status, 401);
  const loggedIn = await request('/api/login', { ...details, password: 'updated-password-for-tests' });
  assert.equal(loggedIn.status, 200);
  const newCookie = loggedIn.cookie.split(';')[0];
  assert.equal((await request('/api/logout', {}, newCookie)).status, 200);
  assert.equal((await request('/api/session', undefined, newCookie)).data.session, null);
  for (const file of ['/.env', '/server.js', '/data/accounts.sqlite', '/package.json', '/tests/auth.test.js']) {
    assert.equal((await request(file)).status, 404, file);
  }
  for (const file of ['/auth.html', '/verify-email.html', '/onboarding.html', '/career.html', '/dashboard.html', '/career.css', '/career.js', '/career-data.js', '/dashboard.css', '/dashboard.js', '/auth-api.js', '/reset-password.html']) {
    assert.equal((await request(file)).status, 200, file);
  }
  assert.equal((await request('/api/google/callback?state=invalid&code=invalid')).status, 302);
});

test('resending replaces the previous link, and the fourth email request is rate limited', async t => {
  const mails = [];
  const { app, db } = createApp({ database: ':memory:', sendMail: async mail => mails.push(mail) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  async function post(endpoint, body) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/${endpoint}`, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  const email = 'resend@example.com';
  assert.equal((await post('register', { email, name: 'Resend', password: 'test-password-for-auth', terms: true })).status, 202);
  const getToken = mail => new URL(mail.text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  const original = getToken(mails[0]);
  assert.equal((await post('resend', { email })).status, 200);
  const replacement = getToken(mails[1]);
  assert.notEqual(replacement, original);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 1);
  assert.equal((await post('verify', { token: original })).status, 400);
  assert.equal(db.prepare('SELECT verified FROM users').get().verified, 0);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await post('resend', { email })).status, 200);
  const deliveredCount = mails.length;
  const limited = await post('resend', { email });
  assert.equal(limited.status, 429);
  assert.equal(mails.length, deliveredCount);
  const latest = getToken(mails.at(-1));
  assert.equal((await post('verify', { token: replacement })).status, 400);
  assert.equal((await post('verify', { token: latest })).status, 200);
  assert.equal((await post('verify', { token: latest })).status, 400);
});

test('expired links cannot verify accounts and failed email sending is recoverable', async t => {
  let fail = true;
  const mails = [];
  const { app, db } = createApp({ database: ':memory:', sendMail: async mail => { if (fail) throw new Error('SMTP unavailable'); mails.push(mail); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  async function post(endpoint, body) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/${endpoint}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  assert.equal((await post('register', { email: 'second@example.com', name: 'Second', password: 'test-password-for-auth', terms: true })).status, 202);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  fail = false;
  assert.equal((await post('resend', { email: 'second@example.com' })).status, 200);
  db.prepare('UPDATE tokens SET expires=0').run();
  const value = new URL(mails[0].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  assert.equal((await post('verify', { token: value })).status, 400);
  assert.equal(db.prepare('SELECT verified FROM users').get().verified, 0);
});
