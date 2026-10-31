const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

const sourceProject = 'I built a dashboard using Python.';
const suggestedProject = 'Built a dashboard using Python.';
const sourceText = 'Alex Morgan\n\nComputing student\n\nalex@example.test\n\nI am a computing student.\n\n' + sourceProject + '\n\nPython';
const initialCv = () => ({
  name: 'Alex Morgan', headline: 'Computing student', contact: ['alex@example.test'],
  profile: 'I am a computing student.', education: [], experience: [sourceProject],
  projects: [sourceProject, 'Documented the interface.'], skills: ['Python'], certifications: []
});

async function setup(t) {
  const { app, db } = createApp({ database: ':memory:' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'cv-review-first@example.test','Alex Morgan',1,1),(2,'cv-review-second@example.test','Other Student',1,1)`);
  for (const userId of [1, 2]) {
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)').run(
      createHash('sha256').update(`cv-review-session-${userId}`).digest('hex'), userId, Date.now() + 60000);
    db.prepare("INSERT INTO cv_scans(id,user_id,extracted_text,analysis_json,created_at) VALUES (?,?,?,'{}',1)")
      .run(userId * 10, userId, sourceText);
  }
  for (const [id, userId] of [[17, 1], [18, 1], [27, 2]]) {
    db.prepare(`INSERT INTO cv_builds
      (id,user_id,cv_scan_id,original_cv_text,current_cv_json,total_suggestions,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,1)`).run(id, userId, userId * 10, sourceText, JSON.stringify(initialCv()), id === 17 ? 3 : 1);
  }
  const insert = db.prepare(`INSERT INTO cv_build_suggestions
    (id,cv_build_id,section_name,suggestion_type,original_text,suggested_text,reason,evidence_json,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'[]',?,1,1)`);
  insert.run(41, 17, 'Projects', 'strengthen_project', sourceProject, suggestedProject, 'Start with the action.', 1);
  insert.run(42, 17, 'Skills', 'add_verified_skill', null, 'Research', 'Include a verified skill.', 2);
  insert.run(43, 17, 'Profile', 'improve_profile', 'I am a computing student.', 'A computing student.', 'Use a concise introduction.', 3);
  insert.run(48, 18, 'Projects', 'strengthen_project', sourceProject, suggestedProject, 'Another build.', 1);
  insert.run(51, 27, 'Projects', 'strengthen_project', sourceProject, suggestedProject, 'Private suggestion.', 1);

  async function patch(body = { status: 'accepted', finalText: suggestedProject },
    { buildId = 17, suggestionId = 41, user = 1, origin = 'http://localhost:3000' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cv/build/${buildId}/suggestions/${suggestionId}`, {
      method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json',
        ...(user ? { Cookie: `ck_session=cv-review-session-${user}` } : {}) }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  const build = (id = 17) => db.prepare('SELECT * FROM cv_builds WHERE id=?').get(id);
  const suggestion = (id = 41) => db.prepare('SELECT * FROM cv_build_suggestions WHERE id=?').get(id);
  const cv = () => JSON.parse(build().current_cv_json);
  const snapshot = () => ({ builds: db.prepare('SELECT * FROM cv_builds ORDER BY id').all(),
    suggestions: db.prepare('SELECT * FROM cv_build_suggestions ORDER BY id').all() });
  return { db, patch, build, suggestion, cv, snapshot };
}

function assertProgress(value, { accepted = 0, edited = 0, rejected = 0, pending = 3 } = {}) {
  assert.deepEqual(value, { accepted, edited, rejected, pending, reviewed: accepted + edited + rejected });
}

test('accepting a stored suggestion updates one CV entry, decision and counts together and returns the canonical snapshot', async t => {
  const h = await setup(t);
  const otherBuild = h.build(27);
  const response = await h.patch({ status: 'accepted', finalText: suggestedProject,
    structuredCv: { name: 'Invented browser CV' }, userId: 2, sectionName: 'Experience' });
  assert.equal(response.status, 200);
  assert.equal(response.data.success, true);
  assert.deepEqual(response.data.suggestion, { id: 41, status: 'accepted', finalText: suggestedProject });
  assertProgress(response.data.progress, { accepted: 1, pending: 2 });
  assert.equal(response.data.buildStatus, 'reviewing');
  const expected = initialCv();
  expected.projects[0] = suggestedProject;
  assert.deepEqual(h.cv(), expected);
  assert.deepEqual(response.data.structuredCv, expected);
  assert.deepEqual(response.data.suggestions.map(item => item.id), [41, 42, 43]);
  assert.deepEqual(response.data.suggestions.map(item => item.status), ['accepted', 'pending', 'pending']);
  assert.equal(response.data.suggestions[0].finalText, suggestedProject);
  const build = h.build();
  const saved = h.suggestion();
  assert.equal(saved.status, 'accepted');
  assert.equal(saved.final_text, suggestedProject);
  assert.equal(saved.original_text, sourceProject);
  assert.equal(saved.suggested_text, suggestedProject);
  assert.equal(build.original_cv_text, sourceText);
  assert.equal(build.accepted_count, 1);
  assert.equal(build.edited_count, 0);
  assert.equal(build.rejected_count, 0);
  assert.equal(build.total_suggestions, 3);
  assert.ok(build.updated_at > 1);
  assert.equal(saved.updated_at, build.updated_at);
  assert.equal(build.created_at, 1);
  assert.deepEqual(h.build(27), otherBuild);
  assert.equal(h.db.isTransaction, false);
});

test('edited text is retained literally, skill additions appear once, and the last decision marks the build reviewed', async t => {
  const h = await setup(t);
  const editedText = "Built a dashboard using Python ($& and $').";
  const edited = await h.patch({ status: 'edited', finalText: ` ${editedText} ` });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.suggestion.finalText, editedText);
  assert.equal(h.cv().projects[0], editedText);
  assert.equal(h.cv().experience[0], sourceProject);
  assertProgress(edited.data.progress, { edited: 1, pending: 2 });
  const added = await h.patch({ status: 'accepted', finalText: 'Research' }, { suggestionId: 42 });
  assert.equal(added.status, 200);
  assert.deepEqual(h.cv().skills, ['Python', 'Research']);
  assertProgress(added.data.progress, { accepted: 1, edited: 1, pending: 1 });
  const rejected = await h.patch({ status: 'rejected', finalText: 'Ignore this browser text' }, { suggestionId: 43 });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.suggestion.finalText, 'I am a computing student.');
  assertProgress(rejected.data.progress, { accepted: 1, edited: 1, rejected: 1, pending: 0 });
  assert.equal(rejected.data.buildStatus, 'reviewed');
  const build = h.build();
  assert.equal(build.status, 'reviewed');
  assert.deepEqual([build.accepted_count, build.edited_count, build.rejected_count], [1, 1, 1]);
  assert.equal(h.cv().profile, initialCv().profile);
  assert.equal(build.original_cv_text, sourceText);
  assert.deepEqual(rejected.data.structuredCv, h.cv());
});

test('rejecting a new addition stores an empty original and never inserts the rejected browser text', async t => {
  const h = await setup(t);
  const response = await h.patch({ status: 'rejected', finalText: 'Invented qualification' }, { suggestionId: 42 });
  assert.equal(response.status, 200);
  assert.equal(response.data.suggestion.finalText, '');
  assert.equal(h.suggestion(42).final_text, '');
  assert.deepEqual(h.cv(), initialCv());
  assertProgress(response.data.progress, { rejected: 1, pending: 2 });
});

test('identical retries are idempotent while changing a completed decision returns a conflict', async t => {
  const h = await setup(t);
  const body = { status: 'accepted', finalText: 'Research' };
  const first = await h.patch(body, { suggestionId: 42 });
  assert.equal(first.status, 200);
  const saved = h.snapshot();
  const again = await h.patch(body, { suggestionId: 42 });
  assert.equal(again.status, 200);
  assert.deepEqual(again.data, first.data);
  assert.deepEqual(h.snapshot(), saved, 'A retry must not change timestamps, repeat additions or recount twice');
  for (const change of [{ status: 'edited', finalText: 'Research and investigation' }, { status: 'rejected', finalText: '' }]) {
    const conflict = await h.patch(change, { suggestionId: 42 });
    assert.equal(conflict.status, 409);
    assert.deepEqual(h.snapshot(), saved);
  }
});

test('review requests validate session, origin, positive IDs, decisions and bounded final text before any mutation', async t => {
  const h = await setup(t);
  const before = h.snapshot();
  assert.equal((await h.patch(undefined, { user: 0 })).status, 401);
  assert.equal((await h.patch(undefined, { origin: 'https://untrusted.example' })).status, 403);
  for (const value of ['0', '-1', '1.5', 'invalid', '9007199254740992']) {
    assert.equal((await h.patch(undefined, { buildId: value })).status, 400, value);
    assert.equal((await h.patch(undefined, { suggestionId: value })).status, 400, value);
  }
  for (const body of [
    {}, { status: 'pending' }, { status: 'approved', finalText: suggestedProject },
    { status: 'accepted' }, { status: 'accepted', finalText: '' }, { status: 'accepted', finalText: {} },
    { status: 'edited', finalText: ' \n ' }, { status: 'edited', finalText: [] },
    { status: 'edited', finalText: 'x'.repeat(2001) }, { status: 'edited', finalText: 'Bad\u0000text' },
    { status: 'accepted', finalText: 'Built a dashboard for Google, increasing revenue by 50%.' }
  ]) assert.equal((await h.patch(body)).status, 400, JSON.stringify(body));
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.db.isTransaction, false);
});

test('review ownership checks isolate accounts, builds and their suggestions with generic missing responses', async t => {
  const h = await setup(t);
  const before = h.snapshot();
  const missingBuild = await h.patch(undefined, { buildId: 999, suggestionId: 51 });
  const privateBuild = await h.patch(undefined, { buildId: 27, suggestionId: 51 });
  assert.equal(missingBuild.status, 404);
  assert.equal(privateBuild.status, 404);
  assert.deepEqual(privateBuild.data, missingBuild.data);
  const missingSuggestion = await h.patch(undefined, { suggestionId: 999 });
  const anotherBuildSuggestion = await h.patch(undefined, { suggestionId: 48 });
  const privateSuggestion = await h.patch(undefined, { suggestionId: 51 });
  for (const response of [missingSuggestion, anotherBuildSuggestion, privateSuggestion]) {
    assert.equal(response.status, 404);
    assert.deepEqual(response.data, missingSuggestion.data);
  }
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.db.isTransaction, false);
});

test('ambiguous, absent and partial original targets cannot replace unrelated current CV text', async t => {
  const h = await setup(t);
  for (const projects of [[sourceProject, sourceProject], ['Another project.'], [`Before. ${sourceProject} After.`]]) {
    const cv = initialCv();
    cv.projects = projects;
    h.db.prepare('UPDATE cv_builds SET current_cv_json=? WHERE id=17').run(JSON.stringify(cv));
    const before = h.snapshot();
    const response = await h.patch();
    assert.equal(response.status, 409, JSON.stringify(projects));
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.db.isTransaction, false);
  }
  const cv = initialCv();
  cv.projects = ['  i built a dashboard\nusing Python.  '];
  h.db.prepare('UPDATE cv_builds SET current_cv_json=? WHERE id=17').run(JSON.stringify(cv));
  assert.equal((await h.patch()).status, 200);
  assert.deepEqual(h.cv().projects, [suggestedProject]);
});

test('saving failure rolls back both the suggestion and CV update and leaves a retry clean', async t => {
  const h = await setup(t);
  const before = h.snapshot();
  h.db.exec(`CREATE TRIGGER fail_cv_review_build_update BEFORE UPDATE ON cv_builds
    WHEN NEW.id=17 BEGIN SELECT RAISE(ABORT,'PRIVATE review write failure'); END`);
  const failed = await h.patch();
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed.data), /PRIVATE|review write failure/);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.db.isTransaction, false);
  h.db.exec('DROP TRIGGER fail_cv_review_build_update');
  assert.equal((await h.patch()).status, 200);
  assert.equal(h.suggestion().status, 'accepted');
  assert.equal(h.cv().projects[0], suggestedProject);
  assert.equal(h.build().accepted_count, 1);
});

test('name, headline and contact changes are scoped to their stored section and enforce field lengths', async t => {
  for (const [section, original, replacement] of [
    ['Name', 'Alex Morgan', 'ALEX MORGAN'], ['Headline', 'Computing student', 'Computing Student'],
    ['Contact', 'alex@example.test', 'Alex@example.test']
  ]) {
    const h = await setup(t);
    h.db.prepare('UPDATE cv_build_suggestions SET section_name=?, original_text=?, suggested_text=? WHERE id=41')
      .run(section, original, replacement);
    const response = await h.patch({ status: 'accepted', finalText: replacement });
    assert.equal(response.status, 200);
    const expected = initialCv();
    expected[section.toLowerCase()] = section === 'Contact' ? [replacement] : replacement;
    assert.deepEqual(h.cv(), expected);
  }
  const h = await setup(t);
  h.db.prepare("UPDATE cv_build_suggestions SET section_name='Name', original_text='Alex Morgan' WHERE id=41").run();
  const before = h.snapshot();
  assert.equal((await h.patch({ status: 'edited', finalText: 'N'.repeat(256) })).status, 400);
  assert.deepEqual(h.snapshot(), before);
});

test('parallel decisions preserve both CV changes and exact counters, including duplicate retries', async t => {
  const h = await setup(t);
  const responses = await Promise.all([
    h.patch(), h.patch(), h.patch({ status: 'accepted', finalText: 'Research' }, { suggestionId: 42 })
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
  assert.equal(h.cv().projects[0], suggestedProject);
  assert.deepEqual(h.cv().skills, ['Python', 'Research']);
  assert.deepEqual([h.build().accepted_count, h.build().edited_count, h.build().rejected_count], [2, 0, 0]);
  const last = await h.patch({ status: 'rejected' }, { suggestionId: 43 });
  assert.equal(last.status, 200);
  assertProgress(last.data.progress, { accepted: 2, rejected: 1, pending: 0 });
  assert.equal(last.data.buildStatus, 'reviewed');
  assert.equal(h.db.isTransaction, false);
});

test('a build closed for review cannot accept a new decision', async t => {
  const h = await setup(t);
  h.db.prepare("UPDATE cv_builds SET status='completed' WHERE id=17").run();
  const before = h.snapshot();
  assert.equal((await h.patch()).status, 409);
  assert.deepEqual(h.snapshot(), before);
});
