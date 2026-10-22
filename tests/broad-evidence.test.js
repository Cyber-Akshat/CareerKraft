const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  MAX_EVIDENCE_FILE_SIZE, MAX_EVIDENCE_TEXT_LENGTH, SUPPORTED_EVIDENCE_ACCEPT,
  inspectEvidenceFile, extractUploadedEvidence
} = require('../evidence-files');
const { ALLOWED_EVIDENCE_EXTENSIONS, isAllowedEvidenceFilename } = require('../evidence-policy');
const { createApp } = require('../server');

function upload(originalname, content, mimetype = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { originalname, mimetype, buffer, size: buffer.length };
}

function officeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function xlsx({ formula = 'B2*C2', drawing = false } = {}) {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return officeZip([
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="office" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${main}" xmlns:r="${officeRel}"><sheets><sheet name="Project budget" sheetId="1" r:id="sheet1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="sheet1" Type="${officeRel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${main}" xmlns:r="${officeRel}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c><c r="C1" t="inlineStr"><is><t>Unit cost</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Research cards</t></is></c><c r="B2"><v>6</v></c><c r="C2"><v>7</v></c><c r="D2"><f>${formula}</f><v>999</v></c></row></sheetData>${drawing ? '<drawing r:id="drawing1"/>' : ''}</worksheet>`],
    ...(drawing ? [
      ['xl/worksheets/_rels/sheet1.xml.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="drawing1" Type="${officeRel}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`],
      ['xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>']
    ] : [])
  ]);
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-broad-evidence-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-broad-evidence-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

const sourceFormats = [
  'py', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'kts', 'dart', 'sh', 'sql',
  'yaml', 'yml', 'toml', 'ini', 'json', 'xml'
];
const manualFormats = ['rtf', 'xls', 'ods', 'ppt', 'odp', 'gif', 'svg', 'mp3', 'wav', 'm4a', 'mp4', 'mov', 'webm'];
const blockedFormats = ['exe', 'bat', 'cmd', 'msi', 'dll', 'scr', 'com', 'apk', 'dmg', 'pkg', 'iso', 'zip'];

test('the evidence filename policy covers work formats and checks the final extension', () => {
  const accepted = new Set(SUPPORTED_EVIDENCE_ACCEPT.split(','));
  for (const extension of [...sourceFormats, ...manualFormats, 'ipynb', 'xlsx']) {
    assert.ok(ALLOWED_EVIDENCE_EXTENSIONS.has(`.${extension}`), extension);
    assert.ok(accepted.has(`.${extension}`), extension);
    assert.equal(isAllowedEvidenceFilename(`completed-work.${extension.toUpperCase()}`), true, extension);
  }
  for (const extension of blockedFormats) {
    assert.equal(isAllowedEvidenceFilename(`completed-work.${extension}`), false, extension);
    assert.equal(isAllowedEvidenceFilename(`completed-work.py.${extension.toUpperCase()}`), false, extension);
    assert.equal(accepted.has(`.${extension}`), false, extension);
  }
  for (const filename of ['', 'work', 'work.py\u0000.exe', 'work.py\r\n', 'work.exe ', 'work.exe.']) {
    assert.equal(isAllowedEvidenceFilename(filename), false, JSON.stringify(filename));
  }
});

test('source and data files are read as text with either common browser MIME declaration', async () => {
  const content = 'Completed student work\r\nExplain the input, transformation, and result.';
  for (const extension of sourceFormats) {
    for (const mimetype of ['text/plain', 'application/octet-stream']) {
      const inspected = await inspectEvidenceFile(upload(`work.${extension}`, content, mimetype));
      assert.equal(inspected.textContent, 'Completed student work\nExplain the input, transformation, and result.', `${extension}: ${mimetype}`);
      assert.equal(inspected.reviewable, true, `${extension}: ${mimetype}`);
      const extracted = await extractUploadedEvidence(inspected);
      assert.equal(extracted.text, inspected.textContent, extension);
      assert.equal(extracted.autoReviewable, true, extension);
    }
  }
  const mismatchedMime = await inspectEvidenceFile(upload('solution.py', 'print("Completed work")', 'application/pdf'));
  assert.equal(mismatchedMime.mimeType, 'text/plain');
  assert.equal(mismatchedMime.reviewable, true);
});

test('uploaded JavaScript remains source text and is never executed in memory or from disk', async t => {
  const directory = temporaryDirectory(t);
  const marker = path.join(directory, 'source-was-executed');
  const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\nmodule.exports = 'My completed algorithm';`;
  const inspected = await inspectEvidenceFile(upload('solution.js', source, 'application/javascript'));
  assert.equal(inspected.textContent, source);
  assert.equal(inspected.reviewable, true);
  assert.equal(existsSync(marker), false);
  const filePath = path.join(directory, 'solution.js');
  writeFileSync(filePath, source);
  const extracted = await extractUploadedEvidence({ path: filePath, originalname: 'solution.js', mimetype: 'application/javascript' });
  assert.equal(extracted.text, source);
  assert.equal(extracted.autoReviewable, true);
  assert.equal(existsSync(marker), false);
});

test('code extraction preserves indentation, blank lines and trailing whitespace that affect source meaning', async () => {
  const source = '    # An indented source fragment\n    message = """first\n\n\n\nlast  \n"""\n    return message\n';
  const result = await inspectEvidenceFile(upload('fragment.py', source, 'text/plain'));
  assert.equal(result.textContent, source);
  assert.equal(result.reviewable, true);
  const extracted = await extractUploadedEvidence(result);
  assert.equal(extracted.text, source);
  assert.equal(extracted.autoReviewable, true);
});

test('HTML, JSON and XML are preserved as inert source without rendering or entity expansion', async t => {
  const directory = temporaryDirectory(t);
  const secret = path.join(directory, 'local-secret.txt');
  const secretText = 'THIS_LOCAL_FILE_MUST_NOT_BE_EXPANDED';
  writeFileSync(secret, secretText);
  const xml = `<!DOCTYPE report [<!ENTITY local SYSTEM "file:///${secret.replace(/\\/g, '/')}">]><report>&local;</report>`;
  for (const [name, source, mime] of [
    ['report.xml', xml, 'application/xml'],
    ['report.json', '{ "html": "<script>throw new Error(\'must not run\')</script>"', 'application/json'],
    ['index.html', '<html><script>throw new Error("must not run")</script><body>My completed page</body></html>', 'text/html']
  ]) {
    const result = await inspectEvidenceFile(upload(name, source, mime));
    assert.equal(result.textContent, source);
    assert.equal(result.reviewable, true);
    assert.equal(result.textContent.includes(secretText), false);
  }
});

function notebook(cells) {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { hidden: 'NOTEBOOK_METADATA_IS_NOT_WORK' }, cells });
}

test('notebooks extract markdown, code and raw source cells in order while ignoring execution output', async () => {
  const source = notebook([
    { cell_type: 'markdown', metadata: {}, source: ['# Investigation\n', 'I compared two inputs.'] },
    { cell_type: 'code', metadata: {}, source: 'answer = 6 * 7\nprint(answer)', execution_count: 1,
      outputs: [{ output_type: 'stream', name: 'stdout', text: ['OUTPUT_IS_NOT_SOURCE\n'] }] },
    { cell_type: 'raw', metadata: {}, source: ['Conclusion: the result is reproducible.'] }
  ]);
  const result = await inspectEvidenceFile(upload('investigation.ipynb', source, 'application/x-ipynb+json'));
  assert.equal(result.reviewable, true);
  const parts = ['# Investigation\nI compared two inputs.', 'answer = 6 * 7\nprint(answer)', 'Conclusion: the result is reproducible.'];
  let previous = -1;
  for (const part of parts) {
    const position = result.textContent.indexOf(part);
    assert.ok(position > previous, part);
    previous = position;
  }
  assert.equal(result.textContent.includes('OUTPUT_IS_NOT_SOURCE'), false);
  assert.equal(result.textContent.includes('NOTEBOOK_METADATA_IS_NOT_WORK'), false);
  const extracted = await extractUploadedEvidence(result);
  assert.equal(extracted.text, result.textContent);
  assert.equal(extracted.autoReviewable, true);
});

test('notebook visual output and attachments need human review and never enter extracted source', async t => {
  const directory = temporaryDirectory(t);
  const marker = path.join(directory, 'notebook-was-executed');
  const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`;
  for (const cell of [
    { cell_type: 'code', source: code, outputs: [{ output_type: 'display_data', data: {
      'text/html': '<script>OUTPUT_HTML_MUST_NOT_BE_EXTRACTED</script>', 'image/png': 'BASE64_IMAGE_MUST_NOT_BE_EXTRACTED'
    } }] },
    { cell_type: 'markdown', source: 'My diagram explains the algorithm.', attachments: {
      'diagram.png': { 'image/png': 'BASE64_ATTACHMENT_MUST_NOT_BE_EXTRACTED' }
    } }
  ]) {
    const result = await inspectEvidenceFile(upload('visual-work.ipynb', notebook([cell])));
    assert.equal(result.reviewable, false);
    assert.ok(result.textContent.includes(cell.source));
    assert.doesNotMatch(result.textContent, /OUTPUT_HTML_MUST_NOT_BE_EXTRACTED|BASE64_IMAGE_MUST_NOT_BE_EXTRACTED|BASE64_ATTACHMENT_MUST_NOT_BE_EXTRACTED/);
    assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
  }
  assert.equal(existsSync(marker), false);
});

test('malformed notebooks and unreadable source are retained without automatic approval', async () => {
  for (const content of ['{invalid json', '{}', notebook([{ cell_type: 'code', source: { invalid: 'source' } }])]) {
    const result = await inspectEvidenceFile(upload('unfinished.ipynb', content));
    assert.equal(result.reviewable, false);
    assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
  }
  const result = await inspectEvidenceFile(upload('unreadable.py', Buffer.from([0xc3, 0x28, 0x00, 0xff])));
  assert.equal(result.reviewable, false);
  assert.equal(result.textContent, '');
  assert.equal((await extractUploadedEvidence(result)).autoReviewable, false);
});

test('media and formats without a safe reader are accepted for human review', async () => {
  for (const extension of manualFormats) {
    const content = extension === 'svg'
      ? '<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("never render")</script></svg>'
      : Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const result = await inspectEvidenceFile(upload(`work.${extension}`, content));
    assert.equal(result.reviewable, false, extension);
    assert.equal(result.textContent, '', extension);
    assert.equal((await extractUploadedEvidence(result)).autoReviewable, false, extension);
  }
});

test('readable source and notebooks obey the 20,000-character automatic review boundary', async () => {
  const boundary = await inspectEvidenceFile(upload('boundary.py', 'a'.repeat(MAX_EVIDENCE_TEXT_LENGTH)));
  assert.equal(boundary.textContent.length, MAX_EVIDENCE_TEXT_LENGTH);
  assert.equal(boundary.reviewable, true);
  for (const [name, content] of [
    ['large.py', 'a'.repeat(MAX_EVIDENCE_TEXT_LENGTH + 1)],
    ['large.ipynb', notebook([{ cell_type: 'code', source: 'a'.repeat(MAX_EVIDENCE_TEXT_LENGTH + 1), outputs: [] }])]
  ]) {
    const result = await inspectEvidenceFile(upload(name, content));
    assert.equal(result.textContent.length, MAX_EVIDENCE_TEXT_LENGTH);
    assert.equal(result.reviewable, false);
    const extracted = await extractUploadedEvidence(result);
    assert.equal(extracted.text.length, MAX_EVIDENCE_TEXT_LENGTH);
    assert.equal(extracted.autoReviewable, false);
  }
});

test('new work formats retain the upload size limit and reject executable or archive extensions', async () => {
  for (const extension of ['py', 'ipynb', 'mp4']) {
    await assert.rejects(inspectEvidenceFile(upload(`large.${extension}`, Buffer.alloc(MAX_EVIDENCE_FILE_SIZE + 1))), error => error.status === 413);
  }
  for (const extension of blockedFormats) {
    await assert.rejects(inspectEvidenceFile(upload(`solution.py.${extension}`, 'not permitted')), error => error.status === 400, extension);
  }
});

async function harness(t) {
  const directory = temporaryDirectory(t);
  const inputs = [];
  let decision = 'needs_changes';
  const { app, db } = createApp({ database: ':memory:', evidenceUploadDir: directory,
    reviewEvidenceWithAI: async input => {
      inputs.push(input);
      return { decision, confidence: 0.99, feedback: 'Feedback on the actual submitted work.', skillsDetected: [],
        criteriaResults: input.verificationCriteria.map(criterion => ({ criterion, met: decision === 'approved', feedback: 'Feedback on the submitted work.' })) };
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'source-student@example.com','Student',1,1),(2,'source-other@example.com','Other',1,1),(3,'source-reviewer@example.com','Reviewer',1,1);
    INSERT INTO reviewers VALUES(3,1);
    INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES(1,1,'developer','Developer','active',1);
    INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required)
      VALUES(1,1,1,'Foundations',1,'Implement an algorithm',1);
    INSERT INTO roadmap_step_content(roadmap_step_id,introduction,learning_objectives,key_concepts,task_content,verification_criteria,target_skills,generated_at)
      VALUES(1,'Algorithm','[]','[]','{}','["Explains an algorithm using completed work"]','[]',1);`);
  for (const user of [1, 2, 3]) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(`broad-${user}`).digest('hex'), user, Date.now() + 60000);
  }
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, user = 1, body) => fetch(`${base}${url}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000', ...(user ? { Cookie: `ck_session=broad-${user}` } : {}) }, body
  });
  const submit = async (name, content, type = 'application/octet-stream', note = '') => {
    const body = new FormData();
    body.append('evidenceFile', new Blob([content], { type }), name);
    if (note) body.append('textContent', note);
    const response = await request('/api/roadmap/steps/1/evidence', 1, body);
    return { status: response.status, data: await response.json() };
  };
  return { directory, db, inputs, request, submit, setDecision: value => { decision = value; } };
}

test('a source upload reaches AI as actual file content without requiring supporting prose', async t => {
  const h = await harness(t);
  const marker = path.join(h.directory, 'source-was-executed');
  const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\nconst answer = 6 * 7;`;
  const result = await h.submit('algorithm.js', source, 'application/javascript');
  assert.equal(result.status, 201);
  assert.equal(result.data.evidence.reviewScope, 'uploaded_work');
  assert.equal(h.inputs.length, 1);
  assert.equal(h.inputs[0].textContent, null);
  assert.equal(h.inputs[0].uploadedEvidence.extractedText, source);
  assert.equal(h.inputs[0].uploadedEvidence.extractedText, h.inputs[0].uploadedFile.textContent);
  assert.equal(h.inputs[0].uploadedEvidence.autoReviewable, true);
  assert.equal(existsSync(marker), false);
  const row = h.db.prepare('SELECT * FROM evidence_submissions').get();
  assert.equal(row.file_mime_type, 'text/plain');
  assert.equal(readFileSync(path.join(h.directory, row.file_storage_key), 'utf8'), source);
  assert.deepEqual(readdirSync(h.directory), [row.file_storage_key]);
});

test('an actual XLSX multipart upload reviews cells and cached formulas without evaluating them', async t => {
  const h = await harness(t);
  h.setDecision('approved');
  h.db.exec("INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES(2,1,1,'Foundations',2,'Next activity',1)");
  const workbook = xlsx();
  const result = await h.submit('project-budget.xlsx', workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(result.status, 201);
  assert.equal(result.data.evidence.status, 'approved');
  assert.equal(result.data.evidence.reviewScope, 'uploaded_work');
  assert.equal(result.data.roadmapStepCompleted, true);
  assert.equal(result.data.evidence.criteriaResults.length, 1);
  assert.equal(result.data.evidence.criteriaResults[0].met, true);
  assert.equal(h.inputs.length, 1);
  const input = h.inputs[0];
  assert.equal(input.textContent, null);
  assert.equal(input.uploadedEvidence.fileType, 'spreadsheet');
  assert.equal(input.uploadedEvidence.autoReviewable, true);
  assert.equal(input.uploadedEvidence.extractedText, 'WORKSHEET: Project budget\nROW 1: Item | Quantity | Unit cost\nROW 2: Research cards | 6 | 7 | FORMULA: B2*C2 → 999');
  // The deliberately stale cache must survive rather than being recalculated to 42.
  assert.doesNotMatch(input.uploadedEvidence.extractedText, /FORMULA: B2\*C2 → 42\b/);
  const row = h.db.prepare('SELECT * FROM evidence_submissions').get();
  assert.equal(row.file_mime_type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(row.file_size, workbook.length);
  assert.deepEqual(readFileSync(path.join(h.directory, row.file_storage_key)), workbook);
  assert.deepEqual(readdirSync(h.directory), [row.file_storage_key]);
  const download = await h.request(result.data.evidence.fileUrl);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), workbook);
});

test('XLSX visual content and external formulas keep the real workbook for human review without AI', async t => {
  const h = await harness(t);
  h.setDecision('approved');
  for (const [name, workbook] of [
    ['visual-budget.xlsx', xlsx({ drawing: true })],
    ['linked-budget.xlsx', xlsx({ formula: "'[external.xlsx]Sheet1'!A1" })]
  ]) {
    const result = await h.submit(name, workbook);
    assert.equal(result.status, 201, name);
    assert.equal(result.data.evidence.status, 'review_required', name);
    assert.equal(result.data.evidence.reviewScope, 'human_review', name);
    assert.equal(result.data.roadmapStepCompleted, false, name);
    assert.equal(h.inputs.length, 0, name);
    const row = h.db.prepare('SELECT * FROM evidence_submissions').get();
    assert.equal(row.file_name, name);
    assert.deepEqual(readFileSync(path.join(h.directory, row.file_storage_key)), workbook, name);
    const download = await h.request(result.data.evidence.fileUrl);
    assert.equal(download.status, 200, name);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), workbook, name);
  }
});

test('media, unreadable code and oversized extraction are saved without invoking automatic review', async t => {
  const h = await harness(t);
  for (const [name, content, mime] of [
    ['demonstration.mp4', Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]), 'video/mp4'],
    ['diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("never render")</script></svg>', 'image/svg+xml'],
    ['not-readable.py', Buffer.from([0xc3, 0x28, 0x00, 0xff]), 'text/plain'],
    ['long.ts', 'x'.repeat(MAX_EVIDENCE_TEXT_LENGTH + 1), 'text/plain']
  ]) {
    const result = await h.submit(name, content, mime);
    assert.equal(result.status, 201, name);
    assert.equal(result.data.evidence.status, 'review_required', name);
    assert.equal(result.data.evidence.reviewScope, 'human_review', name);
    assert.equal(result.data.roadmapStepCompleted, false, name);
    assert.equal(h.inputs.length, 0, name);
    const response = await h.request(result.data.evidence.fileUrl);
    assert.equal(response.status, 200, name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.isBuffer(content) ? content : Buffer.from(content), name);
  }
});

test('active source downloads require an owner or reviewer and force private inert attachments', async t => {
  const h = await harness(t);
  const source = '<html><script>alert("uploaded source must not render")</script></html>';
  const saved = await h.submit('student-page.html', source, 'text/html');
  assert.equal(saved.status, 201);
  const fileUrl = saved.data.evidence.fileUrl;
  assert.equal((await h.request(fileUrl, 0)).status, 401);
  assert.equal((await h.request(fileUrl, 2)).status, 404);
  for (const user of [1, 3]) {
    const response = await h.request(fileUrl, user);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.match(response.headers.get('content-type'), /^text\/plain\b/);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), source);
  }
  const row = h.db.prepare('SELECT file_storage_key FROM evidence_submissions').get();
  for (const publicPath of [`/evidence-uploads/${row.file_storage_key}`, `/data/evidence-uploads/${row.file_storage_key}`,
    '/server.js', '/evidence-files.js', '/data/careerkraft.db', '/.env']) {
    assert.equal((await h.request(publicPath, 0)).status, 404, publicPath);
  }
});

test('HTTP rejection of blocked final extensions preserves the existing private submission', async t => {
  const h = await harness(t);
  assert.equal((await h.submit('completed.py', 'print("my completed work")')).status, 201);
  const before = h.db.prepare('SELECT * FROM evidence_submissions').get();
  const contents = readdirSync(h.directory);
  for (const extension of blockedFormats) {
    const result = await h.submit(`completed.py.${extension.toUpperCase()}`, 'not permitted');
    assert.equal(result.status, 400, extension);
    assert.deepEqual(h.db.prepare('SELECT * FROM evidence_submissions').get(), before, extension);
    assert.deepEqual(readdirSync(h.directory), contents, extension);
  }
  assert.equal(h.inputs.length, 1);
});
