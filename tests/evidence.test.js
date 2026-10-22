const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

test('evidence validates ownership and content, replaces submissions and preserves completed progress', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1),(2,'two@example.com','Two',1,1)").run();
  const session = 'evidence-test';
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), 1, Date.now() + 60000);
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1),(2,2,'teacher','Teacher','active',1,1)").run();
  const insert = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES (?,?,1,'Foundations',?,'Plan a lesson',?)");
  insert.run(1, 1, 1, 1); insert.run(2, 1, 2, 0); insert.run(3, 2, 1, 1);
  const body = { submissionType: 'text', textContent: ' My sample lesson. ' };
  async function submit(id, payload = body, signedIn = true) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/${id}/evidence`, {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(signedIn ? { Cookie: `ck_session=${session}` } : {}) }, body: JSON.stringify(payload)
    });
    return { status: r.status, data: await r.json() };
  }
  assert.equal((await submit(1, body, false)).status, 401);
  for (const id of ['bad', '0', '-1', '1.5']) assert.equal((await submit(id)).status, 400);
  for (const id of [3, 999]) assert.equal((await submit(id)).status, 404);
  assert.equal((await submit(2)).status, 400);
  for (const payload of [{}, { submissionType: 'file' }, { submissionType: 'text', textContent: ' ' }, { submissionType: 'text', textContent: 123 }, { submissionType: 'link', linkUrl: '' }, { submissionType: 'link', linkUrl: 'not-a-link' }, { submissionType: 'link', linkUrl: 'javascript:alert(1)' }, { submissionType: 'link', linkUrl: 'ftp://example.com/file' }]) {
    assert.equal((await submit(1, payload)).status, 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evidence_submissions').get().n, 0);
  const created = await submit(1);
  assert.equal(created.status, 201);
  assert.equal(created.data.evidence.stepTitle, 'Plan a lesson');
  assert.equal(created.data.evidence.status, 'review_required');
  db.prepare("INSERT INTO selected_career(user_id,career_id,title,updated_at) VALUES (1,'teacher','Teacher',1)").run();
  const dashboardResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap`, { headers: { Cookie: `ck_session=${session}` } });
  const dashboard = (await dashboardResponse.json()).roadmap;
  assert.equal(dashboard.nextStep.evidenceStatus, 'review_required');
  assert.equal(dashboard.phases[0].steps[0].evidenceStatus, 'review_required');
  assert.equal(dashboard.completedSteps, 0);
  const row = db.prepare('SELECT * FROM evidence_submissions').get();
  assert.equal(row.text_content, 'My sample lesson.');
  assert.equal(row.link_url, null);
  const progress = db.prepare('SELECT * FROM roadmap_progress').get();
  assert.equal(progress.status, 'in_progress');
  assert.equal(progress.started_at, created.data.evidence.submittedAt);
  assert.ok(db.prepare('SELECT updated_at FROM roadmaps WHERE id=1').get().updated_at >= progress.started_at);
  db.prepare("UPDATE evidence_submissions SET status='reviewed',feedback='Old feedback',reviewed_at=1").run();
  const replaced = await submit(1, { submissionType: 'text', textContent: ' Updated lesson plan. ' });
  assert.equal(replaced.status, 201);
  const changed = db.prepare('SELECT * FROM evidence_submissions').get();
  assert.equal(changed.id, row.id);
  assert.equal(changed.text_content, 'Updated lesson plan.');
  assert.equal(changed.link_url, null);
  assert.ok(changed.feedback);
  assert.ok(changed.reviewed_at);
  assert.equal(changed.status, 'review_required');
  assert.equal(db.prepare('SELECT started_at FROM roadmap_progress').get().started_at, progress.started_at);
  db.prepare("UPDATE roadmap_progress SET status='completed',completed_at=123").run();
  assert.equal((await submit(1)).status, 201);
  assert.equal(db.prepare('SELECT status FROM roadmap_progress').get().status, 'completed');
  assert.equal(db.prepare('SELECT completed_at FROM roadmap_progress').get().completed_at, 123);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM evidence_submissions').get().n, 1);
});

test('all templates and saved roadmap steps require evidence without resetting progress', t => {
  const templates = require('../roadmap-templates');
  assert.ok(Object.values(templates).flat().every(step => step.evidence === true));
  const { mkdtempSync, rmSync } = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-evidence-policy-'));
  const filename = path.join(directory, 'accounts.sqlite');
  let db = createApp({ database: filename }).db;
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1)").run();
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1)").run();
  db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES (1,1,1,'Foundations',1,'Learn',0)").run();
  db.prepare("INSERT INTO roadmap_progress(user_id,roadmap_step_id,status,started_at,completed_at) VALUES (1,1,'completed',10,20)").run();
  db.close();
  db = createApp({ database: filename }).db;
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(db.prepare('SELECT evidence_required FROM roadmap_steps WHERE id=1').get().evidence_required, 1);
  const progress = db.prepare('SELECT status,started_at,completed_at FROM roadmap_progress').get();
  assert.equal(progress.status, 'completed');
  assert.equal(progress.started_at, 10);
  assert.equal(progress.completed_at, 20);
});

test('GET evidence checks ownership and returns the saved public evidence fields', async t => {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.prepare("INSERT INTO users(id,email,name,verified,created_at) VALUES (1,'one@example.com','One',1,1),(2,'two@example.com','Two',1,1)").run();
  const session = 'get-evidence-test';
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(session).digest('hex'), 1, Date.now() + 60000);
  db.prepare("INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES (1,1,'teacher','Teacher','active',1,1),(2,2,'teacher','Teacher','active',1,1)").run();
  const insert = db.prepare("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES (?,?,1,'Foundations',?,'Plan a lesson',?)");
  insert.run(1, 1, 1, 1); insert.run(2, 1, 2, 0); insert.run(3, 2, 1, 1);
  async function get(id, signedIn = true) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/${id}/evidence`, { headers: signedIn ? { Cookie: `ck_session=${session}` } : {} });
    return { status: r.status, data: await r.json() };
  }
  assert.equal((await get(1, false)).status, 401);
  for (const id of ['bad', '0', '-1', '1.5']) assert.equal((await get(id)).status, 400);
  for (const id of [3, 999]) assert.equal((await get(id)).status, 404);
  for (const id of [1, 2]) assert.deepEqual(await get(id), { status: 200, data: { evidence: null } });
  db.prepare("INSERT INTO evidence_submissions(user_id,roadmap_step_id,submission_type,text_content,file_name,file_storage_key,status,feedback,submitted_at,reviewed_at) VALUES (1,1,'text','My work','work.txt','private-key','review_required',NULL,123,NULL)").run();
  const saved = (await get(1)).data.evidence;
  assert.deepEqual(saved, { id: 1, submissionType: 'text', textContent: 'My work', linkUrl: null, fileName: 'work.txt', status: 'review_required', feedback: null, submittedAt: 123, reviewedAt: null });
  assert.equal(Object.hasOwn(saved, 'fileStorageKey'), false);
  db.prepare("UPDATE evidence_submissions SET submission_type='link',text_content=NULL,link_url='https://example.com/',status='approved',feedback='Good work',reviewed_at=456").run();
  const reviewed = (await get(1)).data.evidence;
  assert.equal(reviewed.submissionType, 'link');
  assert.equal(reviewed.linkUrl, 'https://example.com/');
  assert.equal(reviewed.feedback, 'Good work');
  assert.equal(reviewed.reviewedAt, 456);
});

test('AI outcomes complete approved steps, return feedback, and preserve work on failure', async t => {
  let decision = 'needs_changes';
  const { app, db } = createApp({ database: ':memory:', reviewEvidenceWithAI: async input => {
    assert.equal(input.careerTitle, 'Teacher');
    if (decision === 'fail') throw new Error('Provider unavailable');
    return { decision, confidence: 0.95, feedback: 'Explain your lesson plan.', skillsDetected: [' Planning ', 'planning', '', 42, 'x'.repeat(81)] };
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.exec("INSERT INTO users(id,email,name,verified,created_at) VALUES(1,'ai@example.com','Student',1,1); INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at,updated_at) VALUES(1,1,'teacher','Teacher','active',1,1); INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES(1,1,1,'Basics',1,'Plan a lesson',1)");
  const savePlanningModule = db.prepare(`INSERT INTO roadmap_step_content (
    roadmap_step_id, introduction, learning_objectives, key_concepts,
    task_content, verification_criteria, target_skills, generated_at
  ) VALUES (?, 'Plan a lesson.', '[]', '[]', '{}', '[]', '["Planning"]', 1)`);
  savePlanningModule.run(1);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('ai-test').digest('hex'),1,Date.now()+60000);
  const submit = async (text, stepId = 1) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/roadmap/steps/${stepId}/evidence`, { method:'POST', headers:{ Origin:'http://localhost:3000', 'Content-Type':'application/json', Cookie:'ck_session=ai-test' }, body:JSON.stringify({submissionType:'text',textContent:text}) });
    return { status:response.status, data:await response.json() };
  };
  assert.equal((await submit('x'.repeat(3001))).status,400);
  assert.equal((await submit('hello')).data.evidence.status,'needs_changes');
  assert.equal(db.prepare('SELECT status FROM roadmap_progress').get().status,'in_progress');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_skills').get().n, 0);
  decision='fail';
  assert.equal((await submit('My draft')).data.evidence.status,'review_required');
  assert.equal(db.prepare('SELECT text_content FROM evidence_submissions').get().text_content,'My draft');
  decision='approved';
  const approved=await submit('Detailed lesson plan');
  assert.equal(approved.data.roadmapStepCompleted,true);
  assert.deepEqual(approved.data.evidence.skillsDetected, [{ id: 1, name: 'Planning', verifiedCount: 1 }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM skill_verifications').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM roadmap_progress').get().status,'completed');
  assert.equal((await submit('Replacement')).status,409);
  db.exec("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES(2,1,1,'Basics',2,'Another lesson',1)");
  savePlanningModule.run(2);
  assert.equal((await submit('Another detailed lesson', 2)).data.evidence.skillsDetected[0].verifiedCount, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_skills').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM skill_verifications').get().n, 2);
  // Replaying the same source cannot count as a third verified activity.
  db.exec("UPDATE evidence_submissions SET status='needs_changes' WHERE roadmap_step_id=2");
  assert.equal((await submit('Another detailed lesson', 2)).data.evidence.skillsDetected[0].verifiedCount, 2);
  db.exec("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES(3,1,1,'Basics',3,'Final lesson',1); CREATE TRIGGER fail_skill BEFORE INSERT ON skill_verifications BEGIN SELECT RAISE(ABORT,'Verification failed'); END");
  savePlanningModule.run(3);
  assert.equal((await submit('Final detailed lesson', 3)).status, 500);
  assert.equal(db.prepare('SELECT status FROM evidence_submissions WHERE roadmap_step_id=3').get().status, 'submitted');
  assert.equal(db.prepare('SELECT status FROM roadmap_progress WHERE roadmap_step_id=3').get().status, 'in_progress');
  assert.equal(db.prepare('SELECT verified_count FROM user_skills').get().verified_count, 2);
});
