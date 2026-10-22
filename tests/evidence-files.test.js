const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync } = require('node:zlib');
const { MAX_EVIDENCE_FILE_SIZE, SUPPORTED_EVIDENCE_ACCEPT, inspectEvidenceFile } = require('../evidence-files');

function upload(originalname, value, mimetype = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return { originalname, buffer, mimetype, size: buffer.length };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries, compress = false) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const encoded = compress ? deflateRawSync(data) : data;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(compress ? 8 : 0, 8);
    localHeader.writeUInt32LE(crc32(data), 14);
    localHeader.writeUInt32LE(encoded.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(compress ? 8 : 0, 10);
    directory.writeUInt32LE(crc32(data), 16);
    directory.writeUInt32LE(encoded.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(localHeader, filename, encoded);
    central.push(directory, filename);
    offset += localHeader.length + filename.length + encoded.length;
  }
  const directoryData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryData, end]);
}

const wordXml = text => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
const slideXml = text => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
const docx = (text, extras = []) => zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', wordXml(text)], ...extras]);
const pptx = (slides, extras = []) => zip([
  ['[Content_Types].xml', '<Types/>'],
  ['ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`],
  ['ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`],
  ...slides.map((text, index) => [`ppt/slides/slide${index + 1}.xml`, slideXml(text)]),
  ...extras
]);

function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 50 150 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  value += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

test('evidence accepts text formats and safely retains filenames without local paths', async () => {
  const result = await inspectEvidenceFile(upload('C:\\private\\folder\\research.md', '  # Investigation\r\n\r\nFindings and reasons.  ', 'text/markdown'));
  assert.equal(result.fileName, 'research.md');
  assert.equal(result.mimeType, 'text/markdown');
  assert.equal(result.textContent, '# Investigation\n\nFindings and reasons.');
  assert.equal(result.reviewable, true);
  const csv = await inspectEvidenceFile(upload('../../data.csv', 'source,relevance\nlogin,high', 'text/csv'));
  assert.equal(csv.fileName, 'data.csv');
  assert.equal(csv.reviewable, true);
  assert.match(SUPPORTED_EVIDENCE_ACCEPT, /\.pptx/);
  assert.match(SUPPORTED_EVIDENCE_ACCEPT, /\.docx/);
  const longName = await inspectEvidenceFile(upload(`${'a'.repeat(250)}.txt`, 'Evidence'));
  assert.equal(longName.fileName.length, 180);
  assert.ok(longName.fileName.endsWith('.txt'));
});

test('UTF-16 written work can be submitted without a second explanation', async () => {
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('A useful research finding.', 'utf16le')]);
  const result = await inspectEvidenceFile(upload('notes.txt', buffer, 'text/plain'));
  assert.equal(result.textContent, 'A useful research finding.');
  assert.equal(result.reviewable, true);
});

test('empty uploads, unsupported extensions and invalid structured files are rejected', async () => {
  for (const file of [undefined, upload('empty.txt', ''), upload('script.exe', 'Work'), upload('photo.png', 'pretend image', 'image/png'), upload('work.pdf', 'not a PDF', 'application/pdf'), upload('work.docx', 'not a ZIP')]) {
    await assert.rejects(inspectEvidenceFile(file), error => error.status === 400);
  }
});

test('filename policy handles browser MIME differences and unreadable text remains a submission', async () => {
  assert.equal((await inspectEvidenceFile(upload('notes.txt', 'Completed research work.', 'image/png'))).reviewable, true);
  for (const file of [upload('empty.txt', ' \n '), upload('bad.txt', Buffer.from([0xff, 0, 1]))]) {
    const result = await inspectEvidenceFile(file);
    assert.equal(result.reviewable, false);
    assert.equal(result.textContent, '');
  }
});

test('10 MB upload limit is enforced before any extraction', async () => {
  await assert.rejects(inspectEvidenceFile(upload('huge.txt', Buffer.alloc(MAX_EVIDENCE_FILE_SIZE + 1, 65))), error => error.status === 413);
});

test('legacy Word files are accepted only with a binary document signature and await human inspection', async () => {
  const buffer = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer);
  const result = await inspectEvidenceFile(upload('assignment.doc', buffer, 'application/msword'));
  assert.equal(result.mimeType, 'application/msword');
  assert.equal(result.reviewable, false);
  assert.equal(result.textContent, '');
  await assert.rejects(inspectEvidenceFile(upload('fake.doc', 'Not a Word document.', 'application/msword')), error => error.status === 400);
});

test('truncated extracted text is retained for manual review and never auto-approved', async () => {
  const result = await inspectEvidenceFile(upload('long.txt', 'a'.repeat(20001)));
  assert.equal(result.textContent.length, 20000);
  assert.equal(result.reviewable, false);
});

test('uploaded PNG image is accepted without supporting writing and kept for manual review', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2k0YAAAAASUVORK5CYII=', 'base64');
  const result = await inspectEvidenceFile(upload('design.png', image, 'image/png'));
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.textContent, '');
  assert.equal(result.reviewable, false);
  assert.deepEqual(result.buffer, image);
});

test('Word work extracts actual document text and supplemental notes', async () => {
  const result = await inspectEvidenceFile(upload('research.docx', docx('Relevant source &amp; reasoning.', [['word/header1.xml', wordXml('Research report')], ['word/footnotes.xml', wordXml('A further detail.')]])));
  assert.equal(result.textContent, 'Relevant source & reasoning.\n\nResearch report\n\nA further detail.');
  assert.equal(result.reviewable, true);
});

test('Word files with visual work or malformed content are routed to manual review', async () => {
  const image = await inspectEvidenceFile(upload('research.docx', docx('Report with supporting diagram.', [['word/media/image1.png', Buffer.from([1, 2, 3])]])));
  assert.equal(image.reviewable, false);
  assert.match(image.textContent, /Report/);
  const malformed = await inspectEvidenceFile(upload('malformed.docx', zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<unclosed>']])));
  assert.equal(malformed.reviewable, false);
});

test('PPTX extracts slide work in order and decodes XML text', async () => {
  const result = await inspectEvidenceFile(upload('presentation.pptx', pptx(['Audience &amp; research', 'Findings and priorities'])));
  assert.equal(result.textContent, 'Slide 1\nAudience & research\n\nSlide 2\nFindings and priorities');
  assert.equal(result.reviewable, true);
});

test('visual or partly unreadable PPTX work is accepted for manual review', async () => {
  const image = await inspectEvidenceFile(upload('presentation.pptx', pptx(['Design proposal'], [['ppt/media/image1.png', Buffer.from([1, 2, 3])]])));
  assert.equal(image.reviewable, false);
  const blankSlide = await inspectEvidenceFile(upload('presentation.pptx', pptx(['Introduction', ''])));
  assert.equal(blankSlide.reviewable, false);
});

test('Office package type, unsafe declarations, duplicate entries and excessive expansion are rejected', async () => {
  await assert.rejects(inspectEvidenceFile(upload('wrong.docx', pptx(['Work']))), error => error.status === 400);
  await assert.rejects(inspectEvidenceFile(upload('unsafe.docx', docx('Work', [['word/custom.xml', '<!DOCTYPE x [<!ENTITY data SYSTEM "file:///private">]><x>&data;</x>']]))), error => error.status === 400);
  await assert.rejects(inspectEvidenceFile(upload('duplicate.docx', docx('Work', [['word/document.xml', wordXml('Other')]]))), error => error.status === 400);
  const largeExpansion = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', wordXml('Work')], ['word/media/data.bin', Buffer.alloc(26 * 1024 * 1024, 65)]], true);
  assert.ok(largeExpansion.length < MAX_EVIDENCE_FILE_SIZE);
  await assert.rejects(inspectEvidenceFile(upload('expanded.docx', largeExpansion)), error => error.status === 413);
});

test('text-based PDF extracts uploaded work without detaching the original saved buffer', async () => {
  const original = pdf('Login records show unusual access from an unknown device.');
  const result = await inspectEvidenceFile(upload('report.pdf', original, 'application/pdf'));
  assert.match(result.textContent, /Login records show unusual access/);
  assert.equal(result.reviewable, true);
  assert.equal(result.buffer.length, original.length);
  assert.ok(result.buffer.length > 0);
});

test('PDF without extractable writing is still accepted for manual review', async () => {
  const result = await inspectEvidenceFile(upload('scanned-work.pdf', pdf(''), 'application/pdf'));
  assert.equal(result.reviewable, false);
  assert.equal(result.textContent, '');
});

test('PDF header alone does not make malformed data a valid submission', async () => {
  await assert.rejects(inspectEvidenceFile(upload('fake.pdf', '%PDF-1.4\nnot a document\n%%EOF', 'application/pdf')), error => error.status === 400);
});
