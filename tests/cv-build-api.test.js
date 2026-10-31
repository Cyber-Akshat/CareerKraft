const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

const sourceBullet = 'I built a dashboard using Python.';
const cvText = `  Alex Morgan\n\nalex@example.test\n\n${sourceBullet}\n `;

function validOutput() {
  return {
    structuredCv: {
      name: 'Alex Morgan', headline: '', contact: ['alex@example.test'], profile: '',
      education: [], experience: [], projects: [sourceBullet], skills: [], certifications: []
    },
    suggestions: [
      { sectionName: 'Projects', suggestionType: 'rewrite', originalText: sourceBullet,
        suggestedText: 'Built a dashboard using Python.', reason: 'Start with the action.', evidence: [sourceBullet] },
      { sectionName: 'Skills', suggestionType: 'add_verified_skill', originalText: '',
        suggestedText: 'Research', reason: 'Include a verified CareerKraft skill.', evidence: ['Research'] }
    ]
  };
}

async function setup(t) {
  const inputs = [];
  const transactionStates = [];
  let generate = validOutput;
  const { app, db } = createApp({ database: ':memory:', generateCvBuildWithLumia: async input => {
    inputs.push(input);
    transactionStates.push(db.isTransaction);
    return generate(input);
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'build-first@example.test','Alex Morgan',1,1),(2,'build-second@example.test','Second',1,1);
    INSERT INTO selected_career(user_id,career_id,title,updated_at) VALUES
    (1,'software-developer','Software Developer',1),(2,'teacher','Private Teacher Career',1);
    INSERT INTO user_skills(user_id,skill_name,normalized_name,verified_count,first_verified_at,last_verified_at) VALUES
    (1,'Network Analysis','network analysis',2,1,90),(1,'Research','research',3,1,100),
    (1,'Unverified Claim','unverified claim',0,1,200),(2,'Private Skill','private skill',10,1,300)`);
  const scan = db.prepare(`INSERT INTO cv_scans
    (id,user_id,file_name,extracted_text,analysis_json,created_at) VALUES (?,?,?,?,'{}',1)`);
  scan.run(10, 1, 'student-cv.txt', cvText);
  scan.run(20, 2, 'private-cv.txt', 'Private student CV.');
  for (const user of [1, 2]) {
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)').run(
      createHash('sha256').update(`cv-build-session-${user}`).digest('hex'), user, Date.now() + 60000);
  }
  async function submit(body = { scanId: 10 }, { user = 1, origin = 'http://localhost:3000' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cv/build`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        ...(user ? { Cookie: `ck_session=cv-build-session-${user}` } : {}) }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  const noBuilds = () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_builds').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions').get().count, 0);
  };
  return { db, inputs, transactionStates, submit, noBuilds, setGenerator: callback => { generate = callback; } };
}

test('CV builds use the owned scan and canonical profile, then persist all pending suggestions in order', async t => {
  const h = await setup(t);
  const expected = validOutput();
  const response = await h.submit({
    scanId: 10, userId: 2, targetCareer: 'Browser career', cvText: 'Invented browser CV',
    verifiedSkills: [{ name: 'Invented Skill', verifiedCount: 99 }]
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.success, true);
  assert.ok(Number.isSafeInteger(response.data.buildId) && response.data.buildId > 0);
  assert.equal(response.data.targetCareer, 'Software Developer');
  assert.deepEqual(h.inputs, [{ cvText, targetCareer: 'Software Developer', verifiedSkills: [
    { name: 'Research', verifiedCount: 3 }, { name: 'Network Analysis', verifiedCount: 2 }
  ] }]);
  assert.deepEqual(h.transactionStates, [false], 'The Lumia request happens outside a database transaction');
  assert.equal(h.db.isTransaction, false);
  assert.deepEqual(response.data.structuredCv, expected.structuredCv);
  assert.deepEqual(response.data.suggestions.map(item => item.sortOrder), [1, 2]);

  const build = h.db.prepare('SELECT * FROM cv_builds WHERE id=?').get(response.data.buildId);
  assert.equal(build.user_id, 1);
  assert.equal(build.cv_scan_id, 10);
  assert.equal(build.target_career, 'Software Developer');
  assert.equal(build.original_cv_text, cvText, 'The uploaded CV text is retained verbatim');
  assert.deepEqual(JSON.parse(build.current_cv_json), expected.structuredCv);
  assert.equal(build.status, 'reviewing');
  assert.deepEqual([build.total_suggestions, build.accepted_count, build.rejected_count, build.edited_count], [2, 0, 0, 0]);
  assert.ok(build.created_at > 1700000000000);
  assert.equal(build.updated_at, build.created_at);
  const suggestions = h.db.prepare('SELECT * FROM cv_build_suggestions WHERE cv_build_id=? ORDER BY sort_order,id')
    .all(build.id);
  assert.equal(suggestions.length, 2);
  for (const [index, suggestion] of suggestions.entries()) {
    const model = expected.suggestions[index];
    const returned = response.data.suggestions[index];
    assert.ok(Number.isSafeInteger(returned.id) && returned.id > 0);
    assert.equal(returned.id, suggestion.id);
    assert.equal(returned.status, suggestion.status);
    assert.equal(returned.finalText, suggestion.final_text);
    assert.equal(returned.sortOrder, suggestion.sort_order);
    assert.equal(suggestion.section_name, model.sectionName);
    assert.equal(suggestion.suggestion_type, model.suggestionType);
    assert.equal(suggestion.original_text ?? '', model.originalText);
    assert.equal(suggestion.suggested_text, model.suggestedText);
    assert.equal(suggestion.reason, model.reason);
    assert.deepEqual(JSON.parse(suggestion.evidence_json), model.evidence);
    assert.equal(suggestion.status, 'pending');
    assert.equal(suggestion.final_text, null);
    assert.equal(suggestion.sort_order, index + 1);
    assert.equal(suggestion.created_at, build.created_at);
    assert.equal(suggestion.updated_at, build.created_at);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM cv_builds WHERE user_id=2').get().count, 0);
  const second = await h.submit();
  assert.equal(second.status, 200);
  const secondIds = h.db.prepare('SELECT id FROM cv_build_suggestions WHERE cv_build_id=? ORDER BY sort_order,id')
    .all(second.data.buildId).map(item => item.id);
  assert.deepEqual(second.data.suggestions.map(item => item.id), secondIds);
  assert.ok(secondIds.every(id => !response.data.suggestions.some(item => item.id === id)),
    'A later build returns its actual saved IDs, not suggestion positions');
});

test('a student without a selected career or verified skills can create a build with no suggestions', async t => {
  const h = await setup(t);
  h.db.exec('DELETE FROM selected_career WHERE user_id=1; DELETE FROM user_skills WHERE user_id=1');
  h.setGenerator(() => ({ structuredCv: validOutput().structuredCv, suggestions: [] }));
  const response = await h.submit();
  assert.equal(response.status, 200);
  assert.equal(response.data.targetCareer, null);
  assert.deepEqual(response.data.suggestions, []);
  assert.deepEqual(h.inputs, [{ cvText, targetCareer: null, verifiedSkills: [] }]);
  const build = h.db.prepare('SELECT * FROM cv_builds WHERE id=?').get(response.data.buildId);
  assert.equal(build.target_career, null);
  assert.equal(build.status, 'reviewing');
  assert.equal(build.total_suggestions, 0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions').get().count, 0);
});

test('CV build requests require a session, trusted origin, valid scan ID and ownership before contacting Lumia', async t => {
  const h = await setup(t);
  assert.equal((await h.submit({ scanId: 10 }, { user: 0 })).status, 401);
  assert.equal((await h.submit({ scanId: 10 }, { origin: 'https://untrusted.example' })).status, 403);
  for (const scanId of [undefined, null, true, false, {}, [], 1.5, 0, -1, 'not-an-id', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await h.submit({ scanId })).status, 400, JSON.stringify(scanId));
  }
  const missing = await h.submit({ scanId: 999 });
  const anotherStudent = await h.submit({ scanId: 20 });
  assert.equal(missing.status, 404);
  assert.equal(anotherStudent.status, 404);
  assert.deepEqual(anotherStudent.data, missing.data, 'Scan ownership is not disclosed by different error responses');
  assert.equal(h.inputs.length, 0);
  h.noBuilds();
});

test('Lumia failures and malformed CV builds return a generic error without starting partial builds', async t => {
  const h = await setup(t);
  for (const generate of [
    () => { throw new Error('PRIVATE provider body, CV and credentials'); },
    () => null, () => [], () => ({}), () => ({ structuredCv: {}, suggestions: [] })
  ]) {
    h.setGenerator(generate);
    const response = await h.submit();
    assert.equal(response.status, 500);
    assert.equal(typeof response.data.error, 'string');
    assert.doesNotMatch(JSON.stringify(response.data), /PRIVATE|credentials|provider body/);
    assert.equal(h.db.isTransaction, false);
    h.noBuilds();
  }
  assert.ok(h.transactionStates.every(state => state === false));
});

test('failure saving a later suggestion rolls back the entire build and permits a clean retry', async t => {
  const h = await setup(t);
  h.db.exec(`CREATE TRIGGER fail_second_cv_build_suggestion BEFORE INSERT ON cv_build_suggestions
    WHEN NEW.sort_order=2 BEGIN SELECT RAISE(ABORT,'PRIVATE suggestion storage failure'); END`);
  const failed = await h.submit();
  assert.ok([500, 503].includes(failed.status));
  assert.equal(typeof failed.data.error, 'string');
  assert.doesNotMatch(JSON.stringify(failed.data), /PRIVATE|suggestion storage failure/);
  assert.equal(h.db.isTransaction, false);
  h.noBuilds();
  assert.equal(h.db.prepare('SELECT extracted_text FROM cv_scans WHERE id=10').get().extracted_text, cvText);
  h.db.exec('DROP TRIGGER fail_second_cv_build_suggestion');
  const retry = await h.submit();
  assert.equal(retry.status, 200);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM cv_builds').get().count, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM cv_build_suggestions').get().count, 2);
  assert.equal(h.db.isTransaction, false);
  assert.deepEqual(h.transactionStates, [false, false]);
});
