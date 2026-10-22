const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

test('review queue requires reviewer access and returns only pending submissions oldest first', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'reviewer@example.com','Reviewer',1,1),(2,'student@example.com','Student',1,1)").run();
  for (const [id, session] of [[1, 'reviewer-test'], [2, 'student-test']]) {
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), id, Date.now() + 60000);
  }
  async function queue(session) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reviewer/evidence`, { headers: session ? { Cookie: `ck_session=${session}` } : {} });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await queue()).status, 401);
  assert.deepEqual(await queue('student-test'), { status: 403, data: { error: 'Reviewer access required.' } });
  db.prepare('INSERT INTO reviewers VALUES (1,1)').run();
  assert.deepEqual(await queue('reviewer-test'), { status: 200, data: { submissions: [] } });
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,2,'teacher','Teacher','active',1,1)").run();
  const addStep = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,activity_type) VALUES (?,1,1,'Foundations',?,'Sample lesson','project')");
  const addEvidence = db.prepare("INSERT INTO evidence_submissions(id,user_id,roadmap_step_id,submission_type,text_content,link_url,status,submitted_at) VALUES (?,2,?,?,?,?,?,?)");
  addStep.run(1, 1); addStep.run(2, 2); addStep.run(3, 3);
  addEvidence.run(1, 1, 'text', 'My work', null, 'submitted', 200);
  addEvidence.run(2, 2, 'link', null, 'https://example.com/', 'submitted', 100);
  addEvidence.run(3, 3, 'text', 'Approved work', null, 'approved', 50);
  const result = await queue('reviewer-test');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.submissions.map(item => item.id), [2, 1]);
  assert.deepEqual(result.data.submissions[0], {
    id: 2, stepId: 2, stepTitle: 'Sample lesson', activityType: 'project',
    phaseNumber: 1, phaseTitle: 'Foundations', career: { id: 'teacher', title: 'Teacher' },
    student: { id: 2, name: 'Student', email: 'student@example.com' },
    submissionType: 'link', textContent: null, linkUrl: 'https://example.com/',
    fileName: null, status: 'submitted', feedback: null, submittedAt: 100, reviewedAt: null
  });
  assert.equal((await queue('student-test')).status, 403);
});

test('review actions validate access and state, request feedback, and approve progress atomically', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'reviewer@example.com','Reviewer',1,1),(2,'student@example.com','Student',1,1)").run();
  for (const [id, session] of [[1, 'reviewer'], [2, 'student']]) db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), id, Date.now() + 60000);
  db.prepare('INSERT INTO reviewers VALUES (1,1)').run();
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,2,'teacher','Teacher','active',1,1)").run();
  for (const id of [1, 2, 3]) {
    db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES (?,1,1,'Foundations',?,'Lesson')").run(id, id);
    db.prepare("INSERT INTO evidence_submissions(id,user_id,roadmap_step_id,text_content,status,submitted_at) VALUES (?,2,?,'Work','submitted',1)").run(id, id);
  }
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status,started_at) VALUES (2,1,'in_progress',123)").run();
  async function action(id, route = 'approve', body = {}, session = 'reviewer') {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/reviewer/evidence/${id}/${route}`, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(session ? { Cookie: `ck_session=${session}` } : {}) }, body: JSON.stringify(body)
    });
    return { status: r.status, data: await r.json() };
  }
  for (const route of ['approve', 'request-changes']) {
    assert.equal((await action(1, route, { feedback: 'Improve' }, '')).status, 401);
    assert.equal((await action(1, route, { feedback: 'Improve' }, 'student')).status, 403);
    for (const id of ['bad', 0, -1, '1.5']) assert.equal((await action(id, route, { feedback: 'Improve' })).status, 400);
    assert.equal((await action(999, route, { feedback: 'Improve' })).status, 404);
  }
  for (const feedback of [undefined, '', ' ', 123, 'x'.repeat(2001)]) assert.equal((await action(1, 'request-changes', { feedback })).status, 400);
  const changes = await action(1, 'request-changes', { feedback: ' Add an explanation. ' });
  assert.equal(changes.status, 200);
  assert.equal(changes.data.evidence.feedback, 'Add an explanation.');
  assert.equal(db.prepare('SELECT status FROM roadmap_progress WHERE roadmap_step_id=1').get().status, 'in_progress');
  assert.equal((await action(1)).status, 409);
  assert.equal((await action(1, 'request-changes', { feedback: 'More' })).status, 409);
  db.prepare("UPDATE evidence_submissions SET status='submitted' WHERE id=1").run();
  const approval = await action(1);
  assert.equal(approval.status, 200);
  assert.equal(approval.data.evidence.status, 'approved');
  const row = db.prepare('SELECT * FROM roadmap_progress WHERE roadmap_step_id=1').get();
  assert.equal(row.status, 'completed');
  assert.equal(row.started_at, 123);
  assert.equal(row.completed_at, approval.data.evidence.reviewedAt);
  assert.equal(db.prepare('SELECT feedback FROM evidence_submissions WHERE id=1').get().feedback, null);
  assert.equal(db.prepare('SELECT updated_at FROM roadmaps WHERE id=1').get().updated_at, row.completed_at);
  assert.equal((await action(1)).status, 409);
  assert.equal((await action(2)).status, 200);
  assert.equal(db.prepare('SELECT status FROM roadmap_progress WHERE roadmap_step_id=2').get().status, 'completed');
  db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON roadmap_progress WHEN NEW.roadmap_step_id=3 BEGIN SELECT RAISE(ABORT, 'Test failure'); END;");
  assert.equal((await action(3)).status, 500);
  assert.equal(db.prepare('SELECT status FROM evidence_submissions WHERE id=3').get().status, 'submitted');
  assert.equal(db.prepare('SELECT reviewed_at FROM evidence_submissions WHERE id=3').get().reviewed_at, null);
});
