const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');

async function harness(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-skill-detail-'));
  const { app, db } = createApp({ database: ':memory:', evidenceUploadDir: directory,
    evidenceProcessingDir: path.join(directory, 'processing'),
    reviewEvidenceWithAI: async () => { throw new Error('Skill details must not call Lumia.'); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-skill-detail-'));
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'skill-owner@example.com','Student',1,1),
    (2,'other-skills@example.com','Other student',1,1),
    (3,'skill-reviewer@example.com','Reviewer',1,1),
    (4,'unverified-skill@example.com','Unverified',0,1);
    INSERT INTO reviewers VALUES(3,1);
    INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES
      (1,1,'cyber-security-analyst','Cyber Security Analyst','active',1),
      (2,2,'teacher','Teacher','active',1);`);
  for (const user of [1, 2, 3, 4]) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      createHash('sha256').update(`skill-detail-${user}`).digest('hex'), user, Date.now() + 60000);
  }
  const get = (route, user = 1) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    headers: user ? { Cookie: `ck_session=skill-detail-${user}` } : {}
  });
  function skill({ id = 1, user = 1, name = 'Problem Solving', count = 1, first = 10, last = 900 } = {}) {
    db.prepare(`INSERT INTO user_skills
      (id,user_id,skill_name,normalized_name,verified_count,first_verified_at,last_verified_at)
      VALUES(?,?,?,?,?,?,?)`).run(id, user, name, name.toLowerCase(), count, first, last);
    return id;
  }
  function step({ id = 1, roadmap = 1, level = 'beginner', type = 'challenge', title = 'Investigate suspicious activity' } = {}) {
    db.prepare(`INSERT INTO roadmap_steps
      (id,roadmap_id,phase_number,phase_title,step_number,title,activity_type,evidence_required,level,level_step_number)
      VALUES(?,?,1,'Investigate',?,?,?,1,?,?)`).run(id, roadmap, id, title, type, level, id);
    return id;
  }
  function evidence({ id = 1, user = 1, step = id, status = 'approved', text = null, filename = null,
    key = null, feedback = null, type = filename ? 'file' : 'text' } = {}) {
    db.prepare(`INSERT INTO evidence_submissions
      (id,user_id,roadmap_step_id,submission_type,text_content,link_url,file_name,file_storage_key,
       status,feedback,submitted_at,reviewed_at,file_mime_type)
      VALUES(?,?,?,?,?,'https://private-legacy.example.test',?,?,?,?,100,200,'application/pdf')`)
      .run(id, user, step, type, text, filename, key, status, feedback);
    return id;
  }
  function verification({ id = 1, user = 1, skill = 1, evidence = id, step = id, at = 300 } = {}) {
    db.prepare(`INSERT INTO skill_verifications
      (id,user_id,user_skill_id,evidence_submission_id,roadmap_step_id,created_at)
      VALUES(?,?,?,?,?,?)`).run(id, user, skill, evidence, step, at);
  }
  return { db, get, skill, step, evidence, verification, directory };
}

test('skill details require a verified signed-in account and hide other students even from reviewers', async t => {
  const h = await harness(t);
  h.skill();
  for (const user of [null, 4]) {
    assert.equal((await h.get('/api/skills/1', user)).status, 401);
    assert.equal((await h.get('/api/skills/not-an-id', user)).status, 401);
  }
  for (const user of [2, 3]) {
    const response = await h.get('/api/skills/1', user);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Verified skill not found.' });
  }
  assert.equal((await h.get('/api/skills/999')).status, 404);
  const owner = await h.get('/api/skills/1');
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('cache-control'), 'no-store');
});

test('skill IDs reject partial numbers, decimals, unsafe integers and injection text', async t => {
  const h = await harness(t);
  h.skill();
  for (const id of ['0', '-1', '01', '1.5', '1.0', '1e0', '0x1', '+1', ' 1 ', '1junk',
    'Infinity', 'NaN', '9007199254740992', "1 OR 1=1", '1;DROP TABLE user_skills']) {
    const response = await h.get(`/api/skills/${encodeURIComponent(id)}`);
    assert.equal(response.status, 400, id);
    assert.deepEqual(await response.json(), { error: 'Invalid skill.' }, id);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) AS total FROM user_skills').get().total, 1);
});

test('skill details return real level depth, ordered activity proof, file access, feedback and dates', async t => {
  const h = await harness(t);
  h.skill({ count: 4 });
  const levels = ['beginner', 'beginner', 'intermediate', 'advanced'];
  for (let index = 0; index < levels.length; index += 1) {
    const id = index + 1;
    h.step({ id, level: levels[index], type: id === 4 ? 'project' : 'challenge', title: `Investigation ${id}` });
    h.evidence({ id, text: id === 1 ? 'My reasoning based on login records.' : null,
      filename: id === 4 ? 'investigation-report.pdf' : null,
      key: id === 4 ? 'a'.repeat(64) : null,
      feedback: id === 4 ? 'Your investigation showed structured reasoning.' : null });
    h.verification({ id, at: id === 1 ? 100 : 400 });
  }
  writeFileSync(path.join(h.directory, 'a'.repeat(64)), '%PDF-1.7\nPrivate student report');
  const response = await h.get('/api/skills/1');
  const { skill } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(skill.name, 'Problem Solving');
  assert.equal(skill.verifiedCount, 4);
  assert.equal(skill.firstVerifiedAt, 10);
  assert.equal(skill.lastVerifiedAt, 900);
  assert.deepEqual(skill.evidenceDepth, { highestLevel: 'advanced', counts: { beginner: 2, intermediate: 1, advanced: 1 } });
  assert.deepEqual(skill.verifications.map(item => item.id), [4, 3, 2, 1]);
  assert.deepEqual(skill.verifications[0], {
    id: 4, verifiedAt: 400,
    activity: { id: 4, title: 'Investigation 4', level: 'advanced', type: 'project', levelStepNumber: 4 },
    career: { id: 'cyber-security-analyst', title: 'Cyber Security Analyst' },
    evidence: { id: 4, submissionType: 'file', fileName: 'investigation-report.pdf', fileUrl: '/api/evidence/4/file',
      textContent: null, feedback: 'Your investigation showed structured reasoning.', submittedAt: 100, reviewedAt: 200 }
  });
  assert.equal(skill.verifications[3].evidence.textContent, 'My reasoning based on login records.');
  assert.equal(skill.verifications[3].evidence.fileUrl, null);
  assert.equal(skill.verifications[3].evidence.feedback, null);
  const serialized = JSON.stringify(skill);
  for (const secret of ['a'.repeat(64), h.directory, 'private-legacy.example.test', 'file_storage_key', 'linkUrl']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  const download = await h.get(skill.verifications[0].evidence.fileUrl);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="investigation-report\.pdf"/);
  assert.match(await download.text(), /Private student report/);
  assert.equal((await h.get('/api/evidence/4/file', 2)).status, 404);
});

test('legacy skill counts and dates remain intact without inventing missing verification history', async t => {
  const h = await harness(t);
  h.skill({ count: 7, first: 123, last: 456 });
  const { skill } = await (await h.get('/api/skills/1')).json();
  assert.equal(skill.verifiedCount, 7);
  assert.equal(skill.firstVerifiedAt, 123);
  assert.equal(skill.lastVerifiedAt, 456);
  assert.deepEqual(skill.verifications, []);
  assert.deepEqual(skill.evidenceDepth, { highestLevel: null, counts: { beginner: 0, intermediate: 0, advanced: 0 } });
  const stored = h.db.prepare('SELECT verified_count,first_verified_at,last_verified_at FROM user_skills WHERE id=1').get();
  assert.deepEqual({ ...stored }, { verified_count: 7, first_verified_at: 123, last_verified_at: 456 });
});

test('unknown activity levels stay in proof history but cannot assert Beginner or Advanced depth', async t => {
  const h = await harness(t);
  h.skill({ count: 2 });
  for (const [id, level] of [[1, 'expert'], [2, 'Advanced']]) {
    h.step({ id, level });
    h.evidence({ id });
    h.verification({ id });
  }
  const { skill } = await (await h.get('/api/skills/1')).json();
  assert.equal(skill.verifications.length, 2);
  assert.ok(skill.verifications.every(item => item.activity.level === null));
  assert.equal(skill.evidenceDepth.highestLevel, null);
  assert.deepEqual(skill.evidenceDepth.counts, { beginner: 0, intermediate: 0, advanced: 0 });
});

test('verification history excludes corrupt cross-owner links, mismatched activities and unapproved evidence', async t => {
  const h = await harness(t);
  h.skill({ count: 9 });
  h.skill({ id: 2, user: 2, name: 'Private Research' });
  for (let id = 1; id <= 10; id += 1) h.step({ id, roadmap: id === 4 ? 2 : 1 });
  h.evidence({ id: 1, text: 'Valid owned approved work' });
  h.verification({ id: 1 });
  h.evidence({ id: 2, user: 2, text: 'Another student private evidence' });
  h.verification({ id: 2 });
  h.evidence({ id: 3 });
  h.verification({ id: 3, user: 2 });
  h.evidence({ id: 4 });
  h.verification({ id: 4 });
  h.evidence({ id: 5 });
  h.verification({ id: 5, step: 6 });
  for (const [id, status] of [[7, 'submitted'], [8, 'review_required'], [9, 'needs_changes']]) {
    h.evidence({ id, status });
    h.verification({ id });
  }
  h.evidence({ id: 10 });
  h.verification({ id: 10, skill: 2 });
  const response = await h.get('/api/skills/1');
  const { skill } = await response.json();
  assert.deepEqual(skill.verifications.map(item => item.id), [1]);
  assert.deepEqual(skill.evidenceDepth, { highestLevel: 'beginner', counts: { beginner: 1, intermediate: 0, advanced: 0 } });
  assert.equal(skill.verifiedCount, 9);
  assert.equal(JSON.stringify(skill).includes('Another student'), false);
  assert.deepEqual((await (await h.get('/api/skills/2', 2)).json()).skill.verifications, []);
});

test('a stale filename without valid stored file data does not create a broken or unsafe evidence link', async t => {
  const h = await harness(t);
  h.skill();
  h.step();
  h.evidence({ filename: 'old-report.pdf', key: '../../private.env' });
  h.verification();
  const { skill } = await (await h.get('/api/skills/1')).json();
  assert.equal(skill.verifications[0].evidence.fileName, 'old-report.pdf');
  assert.equal(skill.verifications[0].evidence.fileUrl, null);
  assert.equal(JSON.stringify(skill).includes('../../private.env'), false);
});
