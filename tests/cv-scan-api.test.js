const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { createApp } = require('../server');

const cvText = 'Student CV\nEducation: Computer Science\n\n- built a student timetable app using JavaScript';
const validAnalysis = () => ({
  overallScore: 78,
  scores: { structure: 85, clarity: 80, evidence: 65, relevance: 82 },
  strengths: ['Clear education section', 'Relevant project', 'Specific technology'],
  priorityImprovements: ['Explain the project goal', 'Link verified evidence', 'Clarify the approach'],
  verifiedSkillsMissingFromCv: [],
  bulletRewrites: [{ original: 'built a student timetable app using JavaScript',
    improved: 'Built a student timetable app using JavaScript.', reason: 'Use sentence case and punctuation.' }],
  careerAlignmentSummary: 'The project gives a starting point for exploring software development.'
});

async function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-cv-api-'));
  const uploadDirectory = path.join(directory, 'uploads');
  mkdirSync(uploadDirectory);
  const inputs = [];
  let analyse = validAnalysis;
  const { app, db } = createApp({ database: ':memory:', cvUploadDir: uploadDirectory,
    analyseCvWithLumia: async input => { inputs.push(input); return analyse(input); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-cv-api-'));
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'cv-first@example.test','First',1,1),(2,'cv-second@example.test','Second',1,1)`);
  for (const user of [1, 2]) {
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)').run(
      createHash('sha256').update(`cv-session-${user}`).digest('hex'), user, Date.now() + 60000);
  }
  async function submit(body, { user = 1, origin = 'http://localhost:3000', method = 'POST' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cv/scan`, {
      method, headers: { Origin: origin, ...(user ? { Cookie: `ck_session=cv-session-${user}` } : {}) }, body
    });
    return { status: response.status, data: await response.json() };
  }
  function upload(value = cvText, name = 'student-cv.txt', field = 'cv', mime = 'text/plain') {
    const body = new FormData();
    body.append(field, new Blob([value], { type: mime }), name);
    return body;
  }
  const noFiles = () => assert.deepEqual(readdirSync(uploadDirectory), []);
  const noScans = () => assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cv_scans').get().count, 0);
  return { db, inputs, submit, upload, noFiles, noScans, setAnalysis: value => { analyse = value; } };
}

async function docx(text) {
  const archive = new JSZip();
  archive.file('[Content_Types].xml', '<Types/>');
  archive.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return archive.generateAsync({ type: 'nodebuffer' });
}

function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 50 150 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let value = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  value += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

test('CV scanning uses canonical account context, saves the validated analysis and deletes the upload', async t => {
  const h = await setup(t);
  h.db.exec(`INSERT INTO selected_career VALUES
    (1,'software-developer','Software Developer',1),(2,'teacher','Private Teacher Career',1);
    INSERT INTO user_skills(user_id,skill_name,normalized_name,verified_count,first_verified_at,last_verified_at) VALUES
    (1,'Network Analysis','network analysis',2,1,90),(1,'Research','research',3,1,100),
    (1,'Unverified Claim','unverified claim',0,1,200),(2,'Private Skill','private skill',10,1,300)`);
  h.setAnalysis(() => ({ ...validAnalysis(), verifiedSkillsMissingFromCv: ['Research', 'Network Analysis'] }));
  const body = h.upload(`  ${cvText}\r\n`);
  body.append('userId', '2');
  body.append('targetCareer', 'Invented browser career');
  body.append('verifiedSkills', JSON.stringify([{ name: 'Invented Skill', verifiedCount: 99 }]));
  const result = await h.submit(body);
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.ok(result.data.scanId > 0);
  assert.equal(result.data.fileName, 'student-cv.txt');
  assert.equal(result.data.targetCareer, 'Software Developer');
  assert.deepEqual(h.inputs, [{ cvText, targetCareer: 'Software Developer', verifiedSkills: [
    { name: 'Research', verifiedCount: 3 }, { name: 'Network Analysis', verifiedCount: 2 }
  ] }]);
  const saved = h.db.prepare('SELECT * FROM cv_scans WHERE id=?').get(result.data.scanId);
  assert.equal(saved.user_id, 1);
  assert.equal(saved.file_name, 'student-cv.txt');
  assert.equal(saved.extracted_text, cvText);
  assert.ok(saved.created_at > 1700000000000);
  assert.equal(result.data.createdAt, saved.created_at);
  assert.deepEqual(result.data.verifiedSkills, [
    { name: 'Research', verifiedCount: 3 }, { name: 'Network Analysis', verifiedCount: 2 }
  ]);
  assert.deepEqual(JSON.parse(saved.analysis_json), result.data.analysis);
  assert.deepEqual([saved.overall_score, saved.structure_score, saved.clarity_score,
    saved.evidence_score, saved.relevance_score], [78, 85, 80, 65, 82]);
  assert.deepEqual(result.data.analysis.verifiedSkillsMissingFromCv, ['Research', 'Network Analysis']);
  h.noFiles();
});

test('students without a career or verified skills can scan and account results stay isolated', async t => {
  const h = await setup(t);
  const first = await h.submit(h.upload());
  const second = await h.submit(h.upload('Second student CV with a distinct education section.'), { user: 2 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.data.targetCareer, null);
  assert.equal(second.data.targetCareer, null);
  assert.equal(h.inputs[0].targetCareer, null);
  assert.deepEqual(h.inputs[0].verifiedSkills, []);
  assert.deepEqual(h.inputs[1].verifiedSkills, []);
  assert.notEqual(first.data.scanId, second.data.scanId);
  assert.equal(h.db.prepare('SELECT user_id FROM cv_scans WHERE id=?').get(first.data.scanId).user_id, 1);
  assert.equal(h.db.prepare('SELECT user_id FROM cv_scans WHERE id=?').get(second.data.scanId).user_id, 2);
  h.noFiles();
});

test('CV analysis is normalized and unsupported skill claims and rewrites are removed before saving', async t => {
  const h = await setup(t);
  h.db.exec(`INSERT INTO user_skills
    (user_id,skill_name,normalized_name,verified_count,first_verified_at,last_verified_at) VALUES
    (1,'Research','research',1,1,1),(1,'JavaScript','javascript',1,1,1)`);
  h.setAnalysis(() => ({
    ...validAnalysis(), overallScore: 101.8,
    scores: { structure: 200, clarity: -1, evidence: 65.9, relevance: 82 },
    strengths: [' Clear education ', '', 'Relevant project', 'Specific technology', 'Fourth strength'],
    verifiedSkillsMissingFromCv: ['Invented Skill', 'Research', 'JavaScript', 'Research'],
    bulletRewrites: [{ original: 'built a student timetable app using JavaScript',
      improved: 'Built a student timetable app using JavaScript, increasing efficiency by 50%.',
      reason: 'Add an unsupported result.' }]
  }));
  const result = await h.submit(h.upload());
  assert.equal(result.status, 200);
  assert.equal(result.data.analysis.overallScore, 100);
  assert.deepEqual(result.data.analysis.scores, { structure: 100, clarity: 0, evidence: 66, relevance: 82 });
  assert.deepEqual(result.data.analysis.strengths, ['Clear education', 'Relevant project', 'Specific technology']);
  assert.deepEqual(result.data.analysis.verifiedSkillsMissingFromCv, ['Research']);
  assert.deepEqual(result.data.analysis.bulletRewrites, []);
  const stored = JSON.parse(h.db.prepare('SELECT analysis_json FROM cv_scans WHERE id=?').get(result.data.scanId).analysis_json);
  assert.deepEqual(stored, result.data.analysis);
  h.noFiles();
});

test('CV uploads reuse real DOCX and PDF extraction and accept case-insensitive extensions', async t => {
  const h = await setup(t);
  h.setAnalysis(() => ({ ...validAnalysis(), bulletRewrites: [] }));
  const text = 'Education Computer Science. Created a student timetable application using JavaScript.';
  for (const [name, bytes, mime] of [
    ['student.DOCX', await docx(text), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['student.PDF', pdf(text), 'application/pdf']
  ]) {
    const result = await h.submit(h.upload(bytes, name, 'cv', mime));
    assert.equal(result.status, 200, name);
    assert.equal(result.data.fileName, name);
    assert.match(h.inputs.at(-1).cvText, /Created a student timetable application using JavaScript/);
    assert.equal(h.db.prepare('SELECT extracted_text FROM cv_scans WHERE id=?')
      .get(result.data.scanId).extracted_text, h.inputs.at(-1).cvText);
    h.noFiles();
  }
});

test('CV scanning checks authentication and origin before processing uploads', async t => {
  const h = await setup(t);
  assert.equal((await h.submit(h.upload(), { user: 0 })).status, 401);
  assert.equal((await h.submit(h.upload(), { origin: 'https://untrusted.example' })).status, 403);
  assert.equal(h.inputs.length, 0);
  h.noScans();
  h.noFiles();
});

test('CV uploads reject missing, unsupported, duplicate, unexpected and oversized files cleanly', async t => {
  const h = await setup(t);
  const duplicate = h.upload();
  duplicate.append('cv', new Blob([cvText]), 'second.txt');
  const cases = [
    [new FormData(), 400], [h.upload(cvText, 'old-cv.doc'), 400],
    [h.upload(cvText, 'cv.md'), 400], [h.upload(cvText, 'cv.txt', 'file'), 400],
    [duplicate, 400], [h.upload(Buffer.alloc(10 * 1024 * 1024 + 1, 97)), 413]
  ];
  for (const [body, status] of cases) {
    const result = await h.submit(body);
    assert.equal(result.status, status);
    assert.equal(typeof result.data.error, 'string');
    h.noFiles();
  }
  assert.equal(h.inputs.length, 0);
  h.noScans();
});

test('blank, binary, corrupt, unreadable and truncated CVs are never analysed or saved', async t => {
  const h = await setup(t);
  for (const [bytes, name] of [
    ['   \r\n', 'empty.txt'], [Buffer.from([0, 1, 2, 3]), 'binary.txt'],
    ['not a PDF file', 'fake.pdf'], ['not a Word archive', 'fake.docx'],
    [pdf(''), 'unreadable.pdf'], ['CV text '.repeat(3000), 'too-long.txt']
  ]) {
    const result = await h.submit(h.upload(bytes, name));
    assert.equal(result.status, 400, name);
    assert.equal(typeof result.data.error, 'string');
    h.noFiles();
  }
  assert.equal(h.inputs.length, 0);
  h.noScans();
});

test('CV analysis failures and malformed responses return a generic error without storing a scan', async t => {
  const h = await setup(t);
  for (const analyser of [
    () => { throw new Error('PRIVATE provider body and key'); }, () => null, () => [], () => ({})
  ]) {
    h.setAnalysis(analyser);
    const result = await h.submit(h.upload());
    assert.ok([500, 502, 503].includes(result.status));
    assert.equal(typeof result.data.error, 'string');
    assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE|provider body|key/);
    h.noScans();
    h.noFiles();
  }
});

test('CV scan storage failures return a generic error and delete the original upload', async t => {
  const h = await setup(t);
  h.db.exec(`CREATE TRIGGER fail_cv_save BEFORE INSERT ON cv_scans
    BEGIN SELECT RAISE(ABORT,'PRIVATE storage details'); END`);
  const result = await h.submit(h.upload());
  assert.ok([500, 503].includes(result.status));
  assert.equal(typeof result.data.error, 'string');
  assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE|storage details/);
  h.noScans();
  h.noFiles();
});
