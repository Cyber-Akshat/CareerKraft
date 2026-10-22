const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../server');

async function harness(t, useLegacyDirectory = false) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'careerkraft-upload-'));
  const legacyDirectory = useLegacyDirectory ? path.join(directory, 'legacy') : undefined;
  if (legacyDirectory) mkdirSync(legacyDirectory);
  const inputs = [];
  let decision = 'needs_changes';
  const { app, db } = createApp({ database: ':memory:', evidenceUploadDir: directory, legacyEvidenceUploadDir: legacyDirectory,
    reviewEvidenceWithAI: async input => {
      inputs.push(input);
      if (decision === 'fail') throw new Error('Simulated review outage');
      return { decision, confidence: 0.99, feedback: 'Review of the submitted work.',
        skillsDetected: ['Planning'],
        criteriaResults: input.verificationCriteria.map(criterion => ({ criterion, met: true, feedback: 'Demonstrated in the work.' })) };
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close(); db.close();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('careerkraft-upload-'));
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'upload@example.com','Student',1,1),(2,'other-upload@example.com','Other',1,1),(3,'upload-reviewer@example.com','Reviewer',1,1);
    INSERT INTO reviewers VALUES(3,1);
    INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES
      (1,1,'teacher','Teacher','active',1),(2,2,'teacher','Teacher','active',1);
    INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES
      (1,1,1,'Foundations',1,'Prepare a lesson plan',1),(2,1,1,'Foundations',2,'Next activity',1),
      (3,2,1,'Foundations',1,'Private activity',1);
    INSERT INTO roadmap_step_content(roadmap_step_id,introduction,learning_objectives,key_concepts,task_content,verification_criteria,target_skills,generated_at)
      VALUES(1,'Lesson','[]','[]','{}','["Contains a practical lesson plan"]','["Planning"]',1);`);
  for (const id of [1, 2, 3]) db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    createHash('sha256').update(`upload-${id}`).digest('hex'), id, Date.now() + 60000
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (endpoint, body, user = 1, origin = 'http://localhost:3000') => {
    const multipart = body instanceof FormData;
    return fetch(`${url}/api/${endpoint}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(user ? { Cookie: `ck_session=upload-${user}` } : {}), Origin: origin,
        ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
  };
  const submit = async (body, user = 1, step = 1, origin) => {
    const response = await request(`roadmap/steps/${step}/evidence`, body, user, origin);
    return { status: response.status, data: await response.json() };
  };
  const upload = (text = 'A complete lesson plan with objectives and activities.', note = '', name = 'lesson.txt', type = 'text/plain') => {
    const body = new FormData();
    body.append('submissionType', 'file');
    body.append('file', new Blob([text], { type }), name);
    if (note) body.append('textContent', note);
    return body;
  };
  return { db, directory, legacyDirectory, inputs, request, submit, upload, setDecision: value => { decision = value; } };
}

test('evidenceFile multipart submissions work without an explicit type and still permit only one file', async t => {
  const h = await harness(t);
  const body = new FormData();
  body.append('evidenceFile', new Blob(['My actual completed research.'], { type: 'text/plain' }), 'research.txt');
  body.append('textContent', '  An optional note.  ');
  const result = await h.submit(body);
  assert.equal(result.status, 201);
  assert.equal(result.data.evidence.submissionType, 'file');
  assert.equal(result.data.evidence.fileName, 'research.txt');
  assert.equal(h.inputs.at(-1).uploadedFile.textContent, 'My actual completed research.');
  assert.equal(h.inputs.at(-1).textContent, 'An optional note.');
  const before = h.db.prepare('SELECT * FROM evidence_submissions').get();
  const twoFiles = h.upload();
  twoFiles.append('evidenceFile', new Blob(['Another file.'], { type: 'text/plain' }), 'extra.txt');
  assert.equal((await h.submit(twoFiles)).status, 400);
  assert.deepEqual(h.db.prepare('SELECT * FROM evidence_submissions').get(), before);
  assert.deepEqual(readdirSync(h.directory), [before.file_storage_key]);
  const textOnly = new FormData();
  textOnly.append('textContent', 'My complete written answer.');
  assert.equal((await h.submit(textOnly)).status, 201);
  assert.equal(h.inputs.at(-1).uploadedFile, null);
});

test('existing private uploads remain downloadable and are cleaned up when replaced', async t => {
  const h = await harness(t, true);
  const saved = await h.submit(h.upload());
  const row = h.db.prepare('SELECT * FROM evidence_submissions').get();
  const currentPath = path.join(h.directory, row.file_storage_key);
  const legacyPath = path.join(h.legacyDirectory, row.file_storage_key);
  writeFileSync(legacyPath, readFileSync(currentPath));
  unlinkSync(currentPath);
  const response = await h.request(saved.data.evidence.fileUrl.replace('/api/', ''));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /complete lesson plan/);
  for (const publicPath of ['../evidence-uploads/', '../data/evidence-uploads/', '../data/evidence/']) {
    assert.equal((await h.request(publicPath + row.file_storage_key, undefined, 0)).status, 404);
  }
  assert.equal((await h.submit(h.upload('Updated work.'))).status, 201);
  assert.deepEqual(readdirSync(h.legacyDirectory), []);
});

test('file alone, file with an optional note, and text alone are accepted; empty and link submissions are rejected', async t => {
  const h = await harness(t);
  const fileOnly = await h.submit(h.upload());
  assert.equal(fileOnly.status, 201);
  assert.equal(fileOnly.data.evidence.submissionType, 'file');
  assert.equal(fileOnly.data.evidence.fileName, 'lesson.txt');
  assert.equal(h.inputs.at(-1).textContent, null);
  assert.equal(h.inputs.at(-1).uploadedFile.reviewable, true);
  assert.match(h.inputs.at(-1).uploadedFile.textContent, /complete lesson plan/);
  const row = h.db.prepare('SELECT * FROM evidence_submissions').get();
  assert.equal(row.text_content, null);
  assert.equal(row.link_url, null);
  assert.equal(row.file_mime_type, 'text/plain');
  assert.match(row.file_storage_key, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path.join(h.directory, row.file_storage_key), 'utf8'), h.inputs.at(-1).uploadedFile.textContent);
  const withNote = await h.submit(h.upload('My improved lesson plan.', '  The worksheet is included.  '));
  assert.equal(withNote.status, 201);
  assert.equal(h.inputs.at(-1).textContent, 'The worksheet is included.');
  assert.equal(readdirSync(h.directory).length, 1);
  const written = await h.submit({ submissionType: 'text', textContent: 'Here is my written lesson plan.' });
  assert.equal(written.status, 201);
  assert.equal(written.data.evidence.submissionType, 'text');
  assert.equal(h.inputs.at(-1).uploadedFile, null);
  assert.equal(readdirSync(h.directory).length, 0);
  for (const body of [{}, { submissionType: 'file' }, { submissionType: 'link', linkUrl: 'https://example.com/work' }]) {
    assert.equal((await h.submit(body)).status, 400);
  }
  const approved = h.upload();
  h.setDecision('approved');
  const result = await h.submit(approved);
  assert.equal(result.data.roadmapStepCompleted, true);
  assert.equal(result.data.evidence.skillsDetected[0].name, 'Planning');
  assert.equal((await h.submit(h.upload())).status, 409);
  assert.equal(readdirSync(h.directory).length, 1);
});

test('uploads stay private and can be downloaded only by their owner or an authorised reviewer', async t => {
  const h = await harness(t);
  h.setDecision('review_required');
  const saved = await h.submit(h.upload());
  const fileUrl = saved.data.evidence.fileUrl.replace('/api/', '');
  assert.equal((await h.request(fileUrl, undefined, 0)).status, 401);
  assert.equal((await h.request(fileUrl, undefined, 2)).status, 404);
  for (const user of [1, 3]) {
    const response = await h.request(fileUrl, undefined, user);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await response.text(), /complete lesson plan/);
  }
  const evidence = await (await h.request('roadmap/steps/1/evidence')).json();
  assert.equal(evidence.evidence.fileUrl, saved.data.evidence.fileUrl);
  assert.equal(Object.hasOwn(evidence.evidence, 'fileStorageKey'), false);
  const queue = await (await h.request('reviewer/evidence', undefined, 3)).json();
  assert.equal(queue.submissions[0].fileUrl, saved.data.evidence.fileUrl);
});

test('invalid uploads, unauthorised requests, oversized files and failed storage do not replace saved work', async t => {
  const h = await harness(t);
  assert.equal((await h.submit(h.upload(), 0)).status, 401);
  assert.equal((await h.submit(h.upload(), 1, 3)).status, 404);
  assert.equal((await h.submit(h.upload(), 1, 1, 'https://untrusted.example')).status, 403);
  assert.equal((await h.submit(h.upload('code', '', 'script.exe', 'application/octet-stream'))).status, 400);
  assert.equal((await h.submit(h.upload('not a PDF', '', 'work.pdf', 'application/pdf'))).status, 400);
  assert.equal((await h.submit(h.upload(new Uint8Array(10 * 1024 * 1024 + 1)))).status, 413);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM evidence_submissions').get().n, 0);
  assert.equal(readdirSync(h.directory).length, 0);
  await h.submit(h.upload());
  const before = h.db.prepare('SELECT * FROM evidence_submissions').get();
  h.db.exec("CREATE TRIGGER fail_evidence_save BEFORE UPDATE ON evidence_submissions BEGIN SELECT RAISE(ABORT,'Cannot save'); END");
  assert.equal((await h.submit(h.upload('New work that could not be saved.'))).status, 503);
  assert.deepEqual(h.db.prepare('SELECT * FROM evidence_submissions').get(), before);
  assert.deepEqual(readdirSync(h.directory), [before.file_storage_key]);
});

test('review-provider failures preserve uploaded work for human review without asking for a description', async t => {
  const h = await harness(t);
  h.setDecision('fail');
  const saved = await h.submit(h.upload());
  assert.equal(saved.status, 201);
  assert.equal(saved.data.evidence.status, 'review_required');
  assert.equal(saved.data.roadmapStepCompleted, false);
  assert.equal((await h.request(saved.data.evidence.fileUrl.replace('/api/', ''))).status, 200);
  assert.equal(h.db.prepare('SELECT text_content FROM evidence_submissions').get().text_content, null);
});

test('image-only work bypasses AI, while an accompanying written answer is assessed with an explicit scope', async t => {
  const h = await harness(t);
  h.setDecision('approved');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2k0YAAAAASUVORK5CYII=', 'base64');
  const manual = await h.submit(h.upload(image, '', 'worksheet.png', 'image/png'));
  assert.equal(manual.status, 201);
  assert.equal(manual.data.evidence.status, 'review_required');
  assert.equal(manual.data.evidence.reviewScope, 'human_review');
  assert.equal(h.inputs.length, 0);
  assert.equal(manual.data.roadmapStepCompleted, false);
  const written = await h.submit(h.upload(image, 'My plan begins with an objective, then a guided activity and a check of understanding.', 'worksheet.png', 'image/png'));
  assert.equal(written.data.evidence.status, 'approved');
  assert.equal(written.data.evidence.reviewScope, 'written_response_only');
  assert.match(written.data.evidence.feedback, /Only your written response was assessed/);
  assert.match(written.data.evidence.feedback, /uploaded file has not been inspected/);
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0].uploadedEvidence.fileType, 'image');
  assert.equal(h.inputs[0].uploadedEvidence.extractedText, '');
  assert.equal(h.inputs[0].uploadedEvidence.autoReviewable, false);
  assert.equal(written.data.roadmapStepCompleted, true);
});

test('oversized extracted text remains saved but cannot bypass the automatic-review limit', async t => {
  const h = await harness(t);
  h.setDecision('approved');
  const result = await h.submit(h.upload('a'.repeat(20001)));
  assert.equal(result.status, 201);
  assert.equal(result.data.evidence.status, 'review_required');
  assert.equal(h.inputs.length, 0);
  const download = await h.request(result.data.evidence.fileUrl.replace('/api/', ''));
  assert.equal((await download.text()).length, 20001);
});

test('Lumia reviews extracted uploaded work with optional notes; unreadable work bypasses automatic assessment', async () => {
  const source = readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('async function reviewEvidenceWithAI(');
  const end = source.indexOf('async function analyseCareerQuizWithLumia(', start);
  let request;
  const context = vm.createContext({ process: { env: { GROQ_API_KEY: 'test-only' } }, AbortSignal, console,
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        decision: 'approved', confidence: 0.99, taskCompleted: true, relevantEvidence: true, sufficientDetail: true,
        feedback: 'The uploaded plan meets the criteria.', skillsDetected: ['Planning'], criteriaResults: [{ met: true, feedback: 'The plan is complete.' }]
      }) } }] }) };
    }
  });
  vm.runInContext(source.slice(start, end), context);
  const input = { submissionType: 'file', textContent: null, verificationCriteria: ['Contains a practical plan'], targetSkills: ['Planning'],
    uploadedFile: { fileName: 'plan.txt', textContent: 'A detailed, practical plan.', reviewable: true } };
  assert.equal((await context.reviewEvidenceWithAI(input)).decision, 'approved');
  const user = JSON.parse(request.messages[1].content);
  assert.equal(user.uploadedEvidence.extractedText, input.uploadedFile.textContent);
  assert.equal(user.studentEvidence, '');
  assert.match(request.messages[0].content, /supporting text is optional/i);
  assert.match(request.messages[0].content, /do NOT require an additional written explanation/i);
  request = null;
  const manual = await context.reviewEvidenceWithAI({ ...input, uploadedFile: { ...input.uploadedFile, textContent: '', reviewable: false } });
  assert.equal(manual.decision, 'review_required');
  assert.equal(request, null);
});
