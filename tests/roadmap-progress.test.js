const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

test('start step requires ownership, preserves timestamps and never reopens completed steps', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1),(2,'two@example.com','Two',1,1)").run();
  const session = 'start-step-test';
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), 1, Date.now() + 60000);
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1),(2,2,'teacher','Teacher','active',1,1)").run();
  const insert = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES (?,?,1,'Foundations',?,'Learn')");
  insert.run(1, 1, 1); insert.run(2, 1, 2); insert.run(3, 2, 1);
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status,started_at,completed_at) VALUES (1,2,'completed',10,20)").run();
  async function start(id, signedIn = true) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/${id}/start`, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(signedIn ? { Cookie: `ck_session=${session}` } : {}) }, body: '{}'
    });
    return { status: r.status, data: await r.json() };
  }
  assert.equal((await start(1, false)).status, 401);
  for (const id of ['bad', '0', '-1', '1.5']) assert.equal((await start(id)).status, 400);
  assert.equal((await start(999)).status, 404);
  assert.equal((await start(3)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_progress WHERE roadmap_step_id=3').get().n, 0);
  const started = await start(1);
  assert.equal(started.status, 200);
  assert.deepEqual(started.data, { success: true, stepId: 1, status: 'in_progress' });
  const first = db.prepare('SELECT * FROM roadmap_progress WHERE roadmap_step_id=1').get();
  assert.ok(first.started_at > 1);
  assert.equal(db.prepare('SELECT updated_at FROM roadmaps WHERE id=1').get().updated_at, first.started_at);
  assert.equal((await start(1)).data.status, 'in_progress');
  assert.equal(db.prepare('SELECT started_at FROM roadmap_progress WHERE roadmap_step_id=1').get().started_at, first.started_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_progress WHERE roadmap_step_id=1').get().n, 1);
  assert.deepEqual((await start(2)).data, { success: true, status: 'completed' });
  assert.equal(db.prepare('SELECT completed_at FROM roadmap_progress WHERE roadmap_step_id=2').get().completed_at, 20);
  db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title) VALUES (4,1,1,'Foundations',3,'Practice')").run();
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) VALUES (1,4,'not_started')").run();
  assert.equal((await start(4)).data.status, 'in_progress');
  assert.ok(db.prepare('SELECT started_at FROM roadmap_progress WHERE roadmap_step_id=4').get().started_at);
});

test('complete step enforces start and evidence rules and updates roadmap progress', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1),(2,'two@example.com','Two',1,1)").run();
  const session = 'complete-step-test';
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), 1, Date.now() + 60000);
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1),(2,2,'teacher','Teacher','active',1,1)").run();
  db.prepare("INSERT INTO selected_career(user_id,career_id,title,updated_at) VALUES (1,'teacher','Teacher',1)").run();
  const insert = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES (?,?,1,'Foundations',?,'Learn',?)");
  insert.run(1, 1, 1, 0); insert.run(2, 1, 2, 1); insert.run(3, 2, 1, 0); insert.run(4, 1, 3, 0);
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status) VALUES (1,4,'not_started')").run();
  async function request(endpoint, signedIn = true, post = true) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/${endpoint}`, {
      method: post ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(signedIn ? { Cookie: `ck_session=${session}` } : {}) }, ...(post ? { body: '{}' } : {})
    });
    return { status: r.status, data: await r.json() };
  }
  const complete = (id, signedIn = true) => request(`roadmap/steps/${id}/complete`, signedIn);
  assert.equal((await complete(1, false)).status, 401);
  for (const id of ['bad', '0', '-1', '1.5']) assert.equal((await complete(id)).status, 400);
  assert.equal((await complete(999)).status, 404);
  assert.equal((await complete(3)).status, 404);
  for (const id of [1, 4]) {
    const result = await complete(id);
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'step_not_started');
  }
  assert.equal((await complete(2)).data.code, 'evidence_required');
  await request('roadmap/steps/2/start');
  const evidence = await complete(2);
  assert.equal(evidence.status, 409);
  assert.equal(evidence.data.code, 'evidence_required');
  assert.equal(db.prepare('SELECT status FROM roadmap_progress WHERE roadmap_step_id=2').get().status, 'in_progress');
  await request('roadmap/steps/1/start');
  const startedAt = db.prepare('SELECT started_at FROM roadmap_progress WHERE roadmap_step_id=1').get().started_at;
  const completed = await complete(1);
  assert.deepEqual(completed, { status: 200, data: { success: true, stepId: 1, status: 'completed',
    levelProgression: { advanced: false, level: 'beginner', progress: { total: 3, completed: 1, complete: false } } } });
  const row = db.prepare('SELECT * FROM roadmap_progress WHERE roadmap_step_id=1').get();
  assert.equal(row.started_at, startedAt);
  assert.ok(row.completed_at >= startedAt);
  assert.equal(db.prepare('SELECT updated_at FROM roadmaps WHERE id=1').get().updated_at, row.completed_at);
  assert.equal((await complete(1)).status, 200);
  assert.equal(db.prepare('SELECT completed_at FROM roadmap_progress WHERE roadmap_step_id=1').get().completed_at, row.completed_at);
  const loaded = (await request('roadmap', true, false)).data.roadmap;
  assert.equal(loaded.completedSteps, 1);
  assert.equal(loaded.progress, 33);
  assert.equal(loaded.nextStep.id, 2);
  db.prepare("UPDATE roadmap_progress SET status='completed',completed_at=123 WHERE roadmap_step_id=2").run();
  assert.equal((await complete(2)).status, 200);
  assert.equal(db.prepare('SELECT completed_at FROM roadmap_progress WHERE roadmap_step_id=2').get().completed_at, 123);
});

test('single-step endpoint returns owned activity details and current progress', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1),(2,'two@example.com','Two',1,1)").run();
  const session = 'get-step-test';
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), 1, Date.now() + 60000);
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1),(2,2,'teacher','Teacher','active',1,1)").run();
  const insert = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,description,estimated_minutes,activity_type,evidence_required) VALUES (?,?,2,'Try teaching',?,'Plan a lesson','Write a sample lesson.',30,'challenge',?)");
  insert.run(1, 1, 3, 1); insert.run(2, 2, 1, 0); insert.run(3, 1, 4, 0);
  async function get(id, signedIn = true) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/${id}`, {
      headers: signedIn ? { Cookie: `ck_session=${session}` } : {}
    });
    return { status: r.status, data: await r.json() };
  }
  assert.equal((await get(1, false)).status, 401);
  for (const id of ['bad', '0', '-1', '1.5']) assert.equal((await get(id)).status, 400);
  assert.equal((await get(999)).status, 404);
  assert.equal((await get(2)).status, 404);
  const expected = {
    id: 1, stepNumber: 3, phaseNumber: 2, phaseTitle: 'Try teaching',
    title: 'Plan a lesson', description: 'Write a sample lesson.', estimatedMinutes: 30,
    activityType: 'challenge', evidenceRequired: true, status: 'not_started',
    startedAt: null, completedAt: null, career: { id: 'teacher', title: 'Teacher' }
  };
  expected.level = 'beginner';
  expected.levelStepNumber = 3;
  assert.deepEqual(await get(1), { status: 200, data: { step: expected } });
  assert.equal((await get(3)).data.step.evidenceRequired, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roadmap_progress').get().n, 0);
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status,started_at) VALUES (1,1,'in_progress',123)").run();
  assert.deepEqual((await get(1)).data.step, { ...expected, status: 'in_progress', startedAt: 123 });
  db.prepare("UPDATE roadmap_progress SET status='completed',completed_at=456 WHERE roadmap_step_id=1").run();
  assert.deepEqual((await get(1)).data.step, { ...expected, status: 'completed', startedAt: 123, completedAt: 456 });
});
