const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  MAX_EVIDENCE_TEXT_LENGTH, cleanExtractedEvidenceText, extractUploadedEvidence
} = require('../evidence-files');

function files(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-extraction-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-extraction-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return (originalname, content, mimetype) => {
    const filePath = path.join(directory, originalname);
    writeFileSync(filePath, content);
    return { path: filePath, originalname, mimetype };
  };
}

// Small real documents exercise the public disk reader without external fixtures.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function docx(text) {
  const entries = [
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`]
  ];
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc32(data), 16);
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

function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 50 150 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
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

test('extracted evidence text is cleaned and capped at the public 20,000-character limit', () => {
  assert.equal(MAX_EVIDENCE_TEXT_LENGTH, 20000);
  for (const value of [undefined, null, false, 42, {}, []]) assert.equal(cleanExtractedEvidenceText(value), '');
  assert.equal(cleanExtractedEvidenceText('  First\u0000 line\r\n\r\n\r\n\r\nSecond line  '), 'First line\n\n\nSecond line');
  assert.equal(cleanExtractedEvidenceText('x'.repeat(MAX_EVIDENCE_TEXT_LENGTH + 1)), 'x'.repeat(MAX_EVIDENCE_TEXT_LENGTH));
});

test('disk extraction returns a typed empty result when no upload is supplied', async () => {
  assert.deepEqual(await extractUploadedEvidence(), { type: 'none', text: '', autoReviewable: false });
});

test('disk text extraction uses actual file content and declines truncated automatic review', async t => {
  const write = files(t);
  const text = 'My completed research identifies the source and explains why it is relevant.';
  const result = await extractUploadedEvidence(write('research.txt', `  ${text}\r\n`, 'text/plain'));
  assert.deepEqual(result, { type: 'text', text, autoReviewable: true,
    metadata: { extension: '.txt', originalName: 'research.txt' } });
  const truncated = await extractUploadedEvidence(write('long.txt', 'a'.repeat(MAX_EVIDENCE_TEXT_LENGTH + 1), 'text/plain'));
  assert.equal(truncated.type, 'text');
  assert.equal(truncated.text.length, MAX_EVIDENCE_TEXT_LENGTH);
  assert.equal(truncated.autoReviewable, false);
});

test('unreadable file paths return an extraction failure without throwing', async t => {
  const write = files(t);
  const file = write('present.txt', 'Existing file.', 'text/plain');
  file.path = path.join(path.dirname(file.path), 'missing.txt');
  assert.deepEqual(await extractUploadedEvidence(file), { type: 'extraction_failed', text: '', autoReviewable: false });
});

test('images, legacy Word, and unsupported files remain available for manual review', async t => {
  const write = files(t);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAo0AAAAASUVORK5CYII=', 'base64');
  const legacyWord = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(legacyWord);
  for (const [name, content, mimetype, type] of [
    ['design.png', image, 'image/png', 'image'],
    ['research.doc', legacyWord, 'application/msword', 'doc'],
    ['archive.bin', Buffer.from([1, 2, 3]), 'application/octet-stream', 'unsupported']
  ]) {
    assert.deepEqual(await extractUploadedEvidence(write(name, content, mimetype)), { type, text: '', autoReviewable: false });
  }
});

test('real PDF and DOCX extraction uses minimum text thresholds and preserves blank documents for review', async t => {
  const write = files(t);
  for (const [extension, mime, build, threshold] of [
    ['pdf', 'application/pdf', pdf, 40],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx, 20]
  ]) {
    for (const length of [0, threshold - 1, threshold]) {
      const text = 'R'.repeat(length);
      const result = await extractUploadedEvidence(write(`work-${length}.${extension}`, build(text), mime));
      assert.equal(result.type, extension);
      assert.equal(result.text, text);
      assert.equal(result.autoReviewable, length >= threshold);
    }
  }
});

function actualReviewer() {
  const source = readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('async function reviewEvidenceWithAI(');
  const end = source.indexOf('async function analyseCareerQuizWithLumia(', start);
  const requests = [];
  const context = vm.createContext({
    process: { env: { GROQ_API_KEY: 'test-only-key' } }, AbortSignal, console,
    MAX_EVIDENCE_TEXT_LENGTH, cleanExtractedEvidenceText,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        decision: 'approved', confidence: 0.99, taskCompleted: true, relevantEvidence: true, sufficientDetail: true,
        feedback: 'The work meets the saved criterion.', skillsDetected: ['Research'],
        criteriaResults: [{ met: true, feedback: 'Identifies a source and explains its relevance.' }]
      }) } }] }) };
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    requests,
    review: overrides => context.reviewEvidenceWithAI({
      careerTitle: 'Teacher', stepTitle: 'Investigate a scenario', stepDescription: 'Identify and evaluate evidence.',
      taskInstructions: 'Choose a source and explain why it matters.', submissionType: 'file', textContent: '',
      verificationCriteria: ['Identifies and explains a relevant source'], targetSkills: ['Research'], ...overrides
    })
  };
}

test('Lumia receives uploadedEvidence content and metadata with supporting notes optional', async () => {
  const { review, requests } = actualReviewer();
  const uploadedEvidence = {
    fileName: 'research-report.txt', fileType: 'text',
    extractedText: 'The access log is the relevant source because it records when the suspicious login happened.'
  };
  const result = await review({ uploadedEvidence });
  assert.equal(result.decision, 'approved');
  assert.equal(requests.length, 1);
  const user = requests[0].messages.find(message => message.role === 'user').content;
  for (const value of Object.values(uploadedEvidence)) assert.ok(user.includes(value));
  const payload = JSON.parse(user);
  assert.equal(payload.studentEvidence, '');
  assert.equal(payload.uploadedEvidence.fileName, uploadedEvidence.fileName);
  assert.equal(payload.uploadedEvidence.fileType, uploadedEvidence.fileType);
  assert.equal(payload.uploadedEvidence.extractedText, uploadedEvidence.extractedText);
  const system = requests[0].messages.find(message => message.role === 'system').content;
  assert.match(system, /supporting text is optional/i);
  assert.match(system, /do NOT require an additional written explanation/i);
  assert.match(system, /untrusted/i);
});

test('unreadable uploaded evidence alone bypasses Lumia and requires manual review', async () => {
  const { review, requests } = actualReviewer();
  for (const uploadedEvidence of [
    { fileName: 'diagram.png', fileType: 'image', extractedText: '', autoReviewable: false },
    { fileName: 'scan.pdf', fileType: 'pdf', extractedText: '', autoReviewable: false },
    { fileName: 'unreadable.docx', fileType: 'extraction_failed', extractedText: '', autoReviewable: false },
    { fileName: 'truncated.txt', fileType: 'text', extractedText: 'A partial file must not be treated as complete work.', autoReviewable: false }
  ]) {
    const result = await review({ uploadedEvidence });
    assert.equal(result.decision, 'review_required');
    assert.equal(result.taskCompleted, false);
  }
  assert.equal(requests.length, 0);
});

test('an image with a meaningful written answer reviews the writing with explicit limits on image claims', async () => {
  const { review, requests } = actualReviewer();
  const textContent = 'I selected the access log because it records the unusual login time and helps establish the event sequence.';
  const result = await review({
    textContent, uploadedEvidence: { fileName: 'diagram.png', fileType: 'image', extractedText: '', autoReviewable: false }
  });
  assert.equal(result.decision, 'approved');
  assert.equal(requests.length, 1);
  const user = requests[0].messages.find(message => message.role === 'user').content;
  const payload = JSON.parse(user);
  assert.equal(payload.studentEvidence, textContent);
  assert.equal(payload.reviewScope, 'written_response_only');
  assert.equal(payload.uploadedEvidence.extractedText, '');
  const prompt = requests[0].messages.map(message => message.content).join('\n');
  assert.match(prompt, /(?:cannot|can not|not able to|cannot actually|unable to).{0,80}(?:inspect|view|see|read|assess).{0,80}image|(?:do not|never).{0,80}claim.{0,80}(?:inspect|view|see|read|assess).{0,80}image/i);
  assert.match(prompt, /(?:only|solely).{0,80}(?:written|text)|(?:written|text).{0,80}(?:only|solely)/i);
});

test('written-only reviews exclude incomplete attachment text from the Lumia request', async () => {
  const { review, requests } = actualReviewer();
  const partialText = 'A truncated attachment fragment must not be offered as evidence of the complete work.';
  const textContent = 'The access log records the event time, which establishes the sequence and identifies the relevant source.';
  await review({ textContent, uploadedEvidence: {
    fileName: 'partial-report.txt', fileType: 'text', extractedText: partialText, autoReviewable: false
  } });
  assert.equal(requests.length, 1);
  const user = requests[0].messages.find(message => message.role === 'user').content;
  const payload = JSON.parse(user);
  assert.equal(payload.studentEvidence, textContent);
  assert.equal(payload.uploadedEvidence.extractedText, '');
  assert.equal(payload.reviewScope, 'written_response_only');
  assert.equal(user.includes(partialText), false);
});

test('the AI request preserves code and notebook whitespace and explains that no execution occurred', async () => {
  for (const fileType of ['code', 'notebook']) {
    const { review, requests } = actualReviewer();
    const source = '    message = """first\n\n\n\nlast  \n"""\n    return message\n';
    await review({ uploadedEvidence: { fileName: fileType === 'code' ? 'fragment.py' : 'work.ipynb',
      fileType, extractedText: source, autoReviewable: true } });
    const payload = JSON.parse(requests[0].messages.find(message => message.role === 'user').content);
    assert.equal(payload.uploadedEvidence.extractedText, source);
    const prompt = requests[0].messages.find(message => message.role === 'system').content;
    assert.match(prompt, /has not executed code/);
    assert.match(prompt, /Never claim that you ran tests/);
  }
});
