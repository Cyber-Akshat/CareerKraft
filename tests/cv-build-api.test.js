const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');
const { generateCvBuildWithLumia, validateCvBuildOutput } = require('../cv-builder');

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

async function setup(t, { generator = validOutput, fetchLumia } = {}) {
  const inputs = [];
  const transactionStates = [];
  let generate = generator;
  const { app, db } = createApp({ database: ':memory:', fetchLumia, generateCvBuildWithLumia: async (input, options) => {
    inputs.push(input);
    transactionStates.push(db.isTransaction);
    return generate(input, options);
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
    return { status: response.status, headers: Object.fromEntries(response.headers), data: await response.json() };
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

test('the real Lumia helper recovers source layout through HTTP before saving only safe pending suggestions', async t => {
  const project = `${sourceBullet}\nI documented the interface with classmates.`;
  const source = `  Alex Morgan\nLondon, UK\nalex@example.test\ngithub.com/alex\n\nProjects\n${project}\n\nSkills\nPython\n `;
  const model = validOutput();
  Object.assign(model.structuredCv, {
    contact: ['alex@example.test', 'https://github.com/alex'],
    projects: [sourceBullet, 'I documented the interface with classmates.'], skills: ['Python']
  });
  // A model can return plausible JSON while changing layout: the original
  // guard correctly rejects URL reformatting and fragments of a paragraph.
  assert.throws(() => validateCvBuildOutput(model, {
    cvText: source, verifiedSkills: [{ name: 'Research', verifiedCount: 3 }]
  }), /unsupported|source/);
  const providerCalls = [];
  const h = await setup(t, {
    generator: (input, options) => generateCvBuildWithLumia(input, { ...options, apiKey: 'test-only-cv-build-key' }),
    fetchLumia: async (url, options) => {
      providerCalls.push({ url, body: JSON.parse(options.body) });
      assert.equal(options.headers.Authorization, 'Bearer test-only-cv-build-key');
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(model) } }] }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  h.db.prepare('UPDATE cv_scans SET extracted_text = ? WHERE id = ?').run(source, 10);
  const response = await h.submit();
  assert.equal(response.status, 200, 'The generated fallback must also pass the route validation before persistence');
  assert.equal(response.data.success, true);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(JSON.parse(providerCalls[0].body.messages[1].content).cvText, source);
  assert.deepEqual(h.transactionStates, [false], 'Model generation and source recovery happen before the transaction');
  assert.deepEqual(response.data.structuredCv, {
    name: 'Alex Morgan', headline: '', contact: ['London, UK', 'alex@example.test', 'github.com/alex'],
    profile: '', education: [], experience: [], projects: [project], skills: ['Python'], certifications: []
  });
  assert.equal(response.data.suggestions.length, 1, 'Fragment rewrites are discarded; the verified skill remains a pending suggestion');
  const suggestion = response.data.suggestions[0];
  assert.ok(Number.isSafeInteger(suggestion.id) && suggestion.id > 0);
  assert.equal(suggestion.suggestionType, 'add_verified_skill');
  assert.equal(suggestion.suggestedText, 'Research');
  assert.equal(suggestion.status, 'pending');
  assert.equal(suggestion.finalText, null);
  assert.deepEqual(suggestion.evidence, ['Research']);
  const build = h.db.prepare('SELECT * FROM cv_builds WHERE id = ?').get(response.data.buildId);
  assert.equal(build.original_cv_text, source, 'The uploaded text stays complete and unchanged');
  assert.deepEqual(JSON.parse(build.current_cv_json), response.data.structuredCv);
  assert.equal(build.total_suggestions, 1);
  assert.deepEqual([build.accepted_count, build.edited_count, build.rejected_count], [0, 0, 0]);
  const saved = h.db.prepare('SELECT * FROM cv_build_suggestions WHERE cv_build_id = ?').all(build.id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, suggestion.id);
  assert.equal(saved[0].status, 'pending');
  assert.equal(saved[0].suggested_text, 'Research');
  assert.equal(h.db.isTransaction, false);
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
  const logs = [];
  t.mock.method(console, 'error', (...items) => logs.push(items));
  h.db.exec(`CREATE TRIGGER fail_second_cv_build_suggestion BEFORE INSERT ON cv_build_suggestions
    WHEN NEW.sort_order=2 BEGIN SELECT RAISE(ABORT,'PRIVATE suggestion storage failure'); END`);
  const failed = await h.submit();
  assert.ok([500, 503].includes(failed.status));
  assert.equal(typeof failed.data.error, 'string');
  assert.doesNotMatch(JSON.stringify(failed.data), /PRIVATE|suggestion storage failure/);
  assert.deepEqual(logs, [['CV Builder creation failed.', { stage: 'suggestions', code: 'CV_BUILD_FAILED' }]]);
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

test('coded Lumia failures return useful retry errors and safe diagnostics without saving a partial build', async t => {
  const h = await setup(t);
  const logs = [];
  t.mock.method(console, 'error', (...items) => logs.push(items));
  const scenarios = [
    { code: 'CV_BUILD_RATE_LIMITED', status: 503, providerStatus: 429, retryAfterSeconds: 15, message: /busy/i },
    { code: 'CV_BUILD_TIMEOUT', status: 504, message: /too long/i },
    { code: 'CV_BUILD_PROVIDER_HTTP', status: 502, providerStatus: 401, message: /reliable CV draft/i },
    { code: 'CV_BUILD_PROVIDER_NETWORK', status: 502, message: /reliable CV draft/i },
    { code: 'CV_BUILD_RESPONSE_TOO_LARGE', status: 502, message: /reliable CV draft/i },
    { code: 'CV_BUILD_INVALID_JSON', status: 502, message: /reliable CV draft/i },
    { code: 'CV_BUILD_INCOMPLETE', status: 502, message: /reliable CV draft/i },
    { code: 'CV_BUILD_VALIDATION', status: 502, validationReason: 'unsupported_facts', message: /reliable CV draft/i },
    { code: 'CV_BUILD_INPUT', status: 500, message: /couldn't prepare/i },
    { code: 'CV_BUILD_CONFIG', status: 500, message: /couldn't prepare/i },
    { code: 'CV_BUILD_CONTEXT_TOO_LARGE', status: 500, message: /couldn't prepare/i },
    { code: 'CV_BUILD_FAILED', status: 500, message: /couldn't prepare/i }
  ];
  for (const scenario of scenarios) {
    const error = Object.assign(new Error(`PRIVATE CV source and provider credentials: ${cvText}`), {
      code: scenario.code, providerStatus: scenario.providerStatus,
      validationReason: scenario.validationReason, retryAfterSeconds: scenario.retryAfterSeconds,
      sql: `PRIVATE SQL ${cvText}`, sqlMessage: 'PRIVATE database body', response: { body: 'PRIVATE provider body' }
    });
    h.setGenerator(() => { throw error; });
    const response = await h.submit();
    assert.equal(response.status, scenario.status, scenario.code);
    assert.equal(response.data.code, scenario.code);
    assert.match(response.data.error, scenario.message);
    const diagnostic = { stage: 'lumia', code: scenario.code };
    if (scenario.providerStatus) diagnostic.providerStatus = scenario.providerStatus;
    if (scenario.validationReason) diagnostic.validationReason = scenario.validationReason;
    assert.deepEqual(logs.at(-1), ['CV Builder creation failed.', diagnostic]);
    assert.doesNotMatch(JSON.stringify([logs, response.data]), /PRIVATE|alex@example|credentials/);
    assert.equal(response.headers['retry-after'], scenario.retryAfterSeconds ? '15' : undefined);
    assert.equal(response.data.retryAfterSeconds, scenario.retryAfterSeconds);
    assert.equal(h.db.isTransaction, false);
    h.noBuilds();
  }
  assert.ok(h.transactionStates.every(state => state === false));
});

test('provider retry hints are bounded and unrecognised error details never become public or logged', async t => {
  const h = await setup(t);
  const logs = [];
  t.mock.method(console, 'error', (...items) => logs.push(items));
  for (const [hint, expected] of [[1, 1], [999999, 300], [0, undefined], [-5, undefined], [1.5, undefined], ['PRIVATE', undefined]]) {
    h.setGenerator(() => { throw Object.assign(new Error('PRIVATE secret'), {
      code: 'CV_BUILD_RATE_LIMITED', providerStatus: 429, retryAfterSeconds: hint
    }); });
    const response = await h.submit();
    assert.equal(response.status, 503);
    assert.equal(response.data.retryAfterSeconds, expected);
    assert.equal(response.headers['retry-after'], expected === undefined ? undefined : String(expected));
  }
  h.setGenerator(() => { throw Object.assign(new Error('PRIVATE source and key'), {
    code: 'PRIVATE_ERROR_CODE', providerStatus: 1000, validationReason: 'PRIVATE_CV',
    sqlState: 'PRIVATE_SQL_STATE', sqlMessage: 'PRIVATE MySQL body', sql: `SELECT '${cvText}'`
  }); });
  const response = await h.submit();
  assert.equal(response.status, 500);
  assert.equal(response.data.code, 'CV_BUILD_FAILED');
  assert.deepEqual(logs.at(-1), ['CV Builder creation failed.', { stage: 'lumia', code: 'CV_BUILD_FAILED' }]);
  assert.doesNotMatch(JSON.stringify([logs, response.data]), /PRIVATE|alex@example/);
  h.noBuilds();
});

test('database failures identify the source stage using only allowlisted driver metadata', async t => {
  const h = await setup(t);
  const logs = [];
  t.mock.method(console, 'error', (...items) => logs.push(items));
  const prepare = h.db.prepare.bind(h.db);
  t.mock.method(h.db, 'prepare', sql => {
    if (/SELECT id, extracted_text FROM cv_scans/.test(sql)) return {
      get() {
        throw Object.assign(new Error(`PRIVATE source ${cvText}`), {
          code: 'ER_NO_SUCH_TABLE', sqlState: '42S02', sqlMessage: 'PRIVATE schema information', sql
        });
      }
    };
    return prepare(sql);
  });
  const response = await h.submit();
  assert.equal(response.status, 500);
  assert.equal(response.data.code, 'CV_BUILD_FAILED');
  assert.deepEqual(logs, [['CV Builder creation failed.', {
    stage: 'source', code: 'CV_BUILD_FAILED', databaseCode: 'ER_NO_SUCH_TABLE', sqlState: '42S02'
  }]]);
  assert.doesNotMatch(JSON.stringify([logs, response.data]), /PRIVATE|alex@example|SELECT/);
  assert.equal(h.inputs.length, 0);
  h.noBuilds();
});
