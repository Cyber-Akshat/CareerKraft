const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const { createApp } = require('../server');
const { inspectEvidenceFile } = require('../evidence-files');

const criteria = ['Explains the investigation', 'Presents relevant findings'];
const imageText = 'IMAGE OBSERVATIONS\nThe image visibly labels three investigation findings and explains their relevance.';
const audioText = 'AUDIO TRANSCRIPT\nI investigated three sources and compared their timestamps before identifying the relevant findings.';
const videoText = 'VIDEO AUDIO TRANSCRIPT\nThe investigation compares three sources.\n\nVIDEO VISUAL SAMPLE\nThree sampled frames visibly label the findings.';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([12, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(4)]);
const wav = Buffer.alloc(46);
wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(2, 40);
const isoMedia = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);

function observation(type) {
  return { type, text: type === 'image' ? imageText : type === 'audio' ? audioText : videoText,
    autoReviewable: true, metadata: type === 'image' ? { visionAnalysed: true }
      : type === 'audio' ? { transcription: true }
      : { transcriptAvailable: true, visualAnalysisAvailable: true, sampledFrames: 3 } };
}

async function harness(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'careerkraft-media-flow-'));
  const uploadDirectory = path.join(directory, 'uploads');
  const processingDirectory = path.join(directory, 'processing');
  const mediaInputs = [], reviewInputs = [];
  const { app, db } = createApp({ database: ':memory:', evidenceUploadDir: uploadDirectory,
    evidenceProcessingDir: processingDirectory,
    processMediaEvidence: async input => {
      mediaInputs.push(input);
      assert.ok(existsSync(input.path), 'The original must be stored privately before processing.');
      assert.deepEqual(readFileSync(input.path), input.buffer);
      return options.process ? options.process(input) : observation(input.fileType);
    },
    reviewEvidenceWithAI: async input => {
      reviewInputs.push(input);
      return { decision: 'approved', confidence: 0.99, taskCompleted: true,
        relevantEvidence: true, sufficientDetail: true,
        feedback: 'The available evidence demonstrates the saved criteria.',
        skillsDetected: ['Investigation', 'Unrelated Skill'],
        criteriaResults: input.verificationCriteria.map((criterion, index) => ({
          criterion, met: options.unmetCriterion !== index, feedback: 'Assessment of the actual evidence.'
        })), ...options.review };
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {
    server.close(); db.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-media-flow-'));
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`INSERT INTO users(id,email,name,verified,created_at) VALUES
    (1,'media-student@example.com','Student',1,1),(2,'media-other@example.com','Other',1,1),(3,'media-reviewer@example.com','Reviewer',1,1);
    INSERT INTO reviewers VALUES(3,1);
    INSERT INTO roadmaps(id,user_id,career_id,career_title,status,created_at) VALUES(1,1,'content-producer','Content Producer','active',1);
    INSERT INTO roadmap_steps(id,roadmap_id,phase_number,phase_title,step_number,title,evidence_required) VALUES
      (1,1,1,'Investigation',1,'Present your findings',1),(2,1,1,'Investigation',2,'Continue your investigation',1);`);
  db.prepare(`INSERT INTO roadmap_step_content(roadmap_step_id,introduction,learning_objectives,key_concepts,task_content,verification_criteria,target_skills,generated_at)
    VALUES(1,'Investigation','[]','[]','{}',?,'["Investigation"]',1)`).run(JSON.stringify(criteria));
  for (const user of [1, 2, 3]) db.prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run(createHash('sha256').update(`media-${user}`).digest('hex'), user, Date.now() + 60000);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, user = 1, body) => fetch(`${base}${url}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: 'http://localhost:3000', ...(user ? { Cookie: `ck_session=media-${user}` } : {}) }, body
  });
  const submit = async (name, bytes, mime = 'application/octet-stream', note = '', user = 1) => {
    const body = new FormData(); body.append('evidenceFile', new Blob([bytes], { type: mime }), name);
    if (note) body.append('textContent', note);
    const response = await request('/api/roadmap/steps/1/evidence', user, body);
    return { status: response.status, data: await response.json() };
  };
  return { directory, uploadDirectory, processingDirectory, db, mediaInputs, reviewInputs, request, submit };
}

test('image, audio and video uploads pass real processing observations to the criteria reviewer', async t => {
  for (const [name, bytes, mime, type] of [
    ['diagram.png', png, 'image/png', 'image'], ['design.jpg', jpeg, 'image/jpeg', 'image'],
    ['output.webp', webp, 'image/webp', 'image'], ['interview.mp3', Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'), 'audio/mpeg', 'audio'],
    ['interview.wav', wav, 'audio/wav', 'audio'], ['interview.m4a', isoMedia, 'audio/mp4', 'audio'],
    ['interview.ogg', Buffer.from('OggS\u0000\u0002' + '\u0000'.repeat(24)), 'audio/ogg', 'audio'],
    ['demonstration.mp4', isoMedia, 'video/mp4', 'video'], ['demonstration.mov', isoMedia, 'video/quicktime', 'video'],
    ['demonstration.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), 'video/webm', 'video']
  ]) {
    await t.test(name, async child => {
      const h = await harness(child);
      const result = await h.submit(name, bytes, mime);
      assert.equal(result.status, 201);
      assert.equal(h.mediaInputs.length, 1);
      assert.equal(h.mediaInputs[0].fileType, type);
      assert.equal(h.mediaInputs[0].fileName, name);
      assert.equal(h.reviewInputs.length, 1);
      const input = h.reviewInputs[0];
      assert.equal(input.textContent, null, 'A separate explanation is optional.');
      assert.equal(input.uploadedEvidence.fileType, type);
      assert.equal(input.uploadedEvidence.extractedText, observation(type).text);
      assert.equal(input.uploadedEvidence.autoReviewable, true);
      for (const [key, value] of Object.entries(observation(type).metadata)) assert.equal(input.uploadedEvidence.metadata[key], value);
      assert.deepEqual(input.verificationCriteria, criteria);
      assert.deepEqual(input.targetSkills, ['Investigation']);
      assert.equal(result.data.evidence.status, 'approved');
      assert.equal(result.data.evidence.reviewScope, 'uploaded_work');
      assert.equal(result.data.roadmapStepCompleted, true);
      assert.ok(result.data.evidence.criteriaResults.every(item => item.met));
      assert.equal(h.db.prepare('SELECT status FROM roadmap_progress WHERE roadmap_step_id=1').get().status, 'completed');
      assert.deepEqual(h.db.prepare('SELECT skill_name,verified_count FROM user_skills').all().map(row => ({ ...row })), [{ skill_name: 'Investigation', verified_count: 1 }]);
      const saved = h.db.prepare('SELECT file_storage_key FROM evidence_submissions').get();
      assert.deepEqual(readFileSync(path.join(h.uploadDirectory, saved.file_storage_key)), bytes);
      assert.deepEqual(readdirSync(h.uploadDirectory), [saved.file_storage_key]);
    });
  }
});

test('failed, unreadable and malformed media analysis cannot approve a file or award skills', async t => {
  for (const [name, process] of [
    ['provider failure', () => { throw new Error('Synthetic provider failure'); }],
    ['no extracted text', () => ({ type: 'image', text: '', autoReviewable: true, metadata: { visionAnalysed: true } })],
    ['unreadable output', () => ({ ...observation('image'), autoReviewable: false })],
    ['malformed output', () => ({ type: 'image', text: { invalid: 'not text' }, autoReviewable: true })],
    ['missing output', () => null],
    ['analysis without inspection proof', () => ({ type: 'image', text: imageText, autoReviewable: true })],
    ['processing failure flag', () => ({ ...observation('image'), metadata: { visionAnalysed: true, processingFailed: true } })],
    ['truncated visual analysis', () => ({ ...observation('image'), metadata: { visionAnalysed: true, truncated: true } })],
    ['oversized extracted evidence', () => ({ ...observation('image'), text: 'x'.repeat(20001) })]
  ]) {
    await t.test(name, async child => {
      const h = await harness(child, { process });
      const result = await h.submit('diagram.png', png, 'image/png');
      assert.equal(result.status, 201);
      assert.equal(result.data.evidence.status, 'review_required');
      assert.equal(result.data.evidence.reviewScope, 'human_review');
      assert.equal(result.data.roadmapStepCompleted, false);
      assert.equal(h.reviewInputs.length, 0, 'An approving reviewer cannot override unreadable evidence.');
      assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM user_skills').get().count, 0);
      assert.equal(h.db.prepare('SELECT status FROM roadmap_progress').get().status, 'in_progress');
      const download = await h.request(result.data.evidence.fileUrl);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    });
  }
});

test('media approval is still blocked when a saved module criterion is unmet', async t => {
  const h = await harness(t, { unmetCriterion: 1 });
  const result = await h.submit('diagram.png', png, 'image/png');
  assert.equal(result.status, 201);
  assert.equal(h.reviewInputs.length, 1);
  assert.equal(result.data.evidence.status, 'review_required');
  assert.equal(result.data.roadmapStepCompleted, false);
  assert.deepEqual(result.data.evidence.criteriaResults.map(item => [item.criterion, item.met]), [[criteria[0], true], [criteria[1], false]]);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM user_skills').get().count, 0);
});

test('a WebM container with an audio-only stream is reviewed as a transcript', async t => {
  const h = await harness(t, { process: () => observation('audio') });
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
  const result = await h.submit('spoken-interview.webm', bytes, 'audio/webm');
  assert.equal(result.status, 201);
  assert.equal(result.data.evidence.status, 'approved');
  assert.equal(result.data.evidence.reviewScope, 'uploaded_work');
  assert.equal(h.reviewInputs.length, 1);
  assert.equal(h.reviewInputs[0].uploadedEvidence.fileType, 'audio');
  assert.equal(h.reviewInputs[0].uploadedEvidence.extractedText, audioText);
  assert.equal(h.reviewInputs[0].uploadedEvidence.metadata.transcription, true);
});

test('an unreadable media attachment with a written answer reviews only the answer', async t => {
  const h = await harness(t, { process: () => ({ ...observation('image'), text: 'PARTIAL_IMAGE_TEXT_MUST_NOT_BE_ASSESSED', autoReviewable: false }) });
  const note = 'I compared the timestamps in three login records and explained the relevant findings in the written response.';
  const result = await h.submit('diagram.png', png, 'image/png', note);
  assert.equal(result.status, 201);
  assert.equal(h.reviewInputs.length, 1);
  assert.equal(h.reviewInputs[0].textContent, note);
  assert.equal(h.reviewInputs[0].uploadedEvidence.extractedText, '');
  assert.equal(h.reviewInputs[0].uploadedEvidence.autoReviewable, false);
  assert.equal(result.data.evidence.reviewScope, 'written_response_only');
  assert.match(result.data.evidence.feedback, /Only your written response was assessed/);
  assert.match(result.data.evidence.feedback, /uploaded file has not been inspected/);
});

test('media authentication, ownership and private processing paths remain enforced', async t => {
  const h = await harness(t);
  assert.equal((await h.submit('diagram.png', png, 'image/png', '', 0)).status, 401);
  assert.equal((await h.submit('diagram.png', png, 'image/png', '', 2)).status, 404);
  assert.equal(h.mediaInputs.length, 0);
  const result = await h.submit('diagram.png', png, 'image/png');
  assert.equal(result.status, 201);
  assert.equal((await h.request(result.data.evidence.fileUrl, 0)).status, 401);
  assert.equal((await h.request(result.data.evidence.fileUrl, 2)).status, 404);
  for (const user of [1, 3]) {
    const download = await h.request(result.data.evidence.fileUrl, user);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  }
  const saved = h.db.prepare('SELECT file_storage_key FROM evidence_submissions').get();
  if (existsSync(h.processingDirectory)) writeFileSync(path.join(h.processingDirectory, 'private-frame.jpg'), png);
  for (const url of [`/evidence-uploads/${saved.file_storage_key}`, `/data/evidence-uploads/${saved.file_storage_key}`,
    '/evidence-processing/private-frame.jpg', '/data/evidence-processing/private-frame.jpg', '/media-evidence.js']) {
    assert.equal((await h.request(url, 0)).status, 404, url);
  }
});

async function powerpoint(slides, { visual = false } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join('')}</Relationships>`);
  slides.forEach((text, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`));
  if (visual) zip.file('ppt/media/image1.png', png);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('PowerPoint keeps bounded slide text and describes its coverage without claiming visual inspection', async t => {
  const bytes = await powerpoint(['Cyber security awareness', 'Phishing warning signs: unexpected sender, urgent language, suspicious link']);
  const h = await harness(t);
  const result = await h.submit('awareness.pptx', bytes);
  assert.equal(result.status, 201);
  assert.equal(h.mediaInputs.length, 0, 'The existing bounded Office reader handles slides.');
  assert.equal(h.reviewInputs.length, 1);
  const evidence = h.reviewInputs[0].uploadedEvidence;
  assert.equal(evidence.fileType, 'pptx');
  assert.match(evidence.extractedText, /Cyber security awareness/);
  assert.match(evidence.extractedText, /Phishing warning signs/);
  assert.equal(evidence.metadata.slideCount, 2);
  assert.equal(evidence.metadata.analysedSlides, 2);
  assert.equal(evidence.metadata.visionAnalysed === true, false);
  assert.equal(result.data.evidence.status, 'approved');
});

test('PowerPoint visual content and slides beyond the 40-slide sample cannot be auto-approved', async t => {
  for (const [name, bytes] of [
    ['visual-deck.pptx', await powerpoint(['The visible diagram is essential to this investigation.'], { visual: true })],
    ['long-deck.pptx', await powerpoint(Array.from({ length: 41 }, (_, index) => `Findings on slide ${index + 1}`))]
  ]) {
    await t.test(name, async child => {
      const h = await harness(child);
      const result = await h.submit(name, bytes);
      assert.equal(result.status, 201);
      assert.equal(result.data.evidence.status, 'review_required');
      assert.equal(result.data.roadmapStepCompleted, false);
      assert.equal(h.mediaInputs.length, 0);
      assert.equal(h.reviewInputs.length, 0);
      const download = await h.request(result.data.evidence.fileUrl);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    });
  }
  const inspected = await inspectEvidenceFile({ originalname: 'long.pptx', buffer: await powerpoint(Array.from({ length: 41 }, (_, index) => `Findings on slide ${index + 1}`)) });
  assert.equal(inspected.metadata.slideCount, 41);
  assert.equal(inspected.metadata.analysedSlides, 40);
  assert.doesNotMatch(inspected.textContent, /Findings on slide 41/);
});

test('corrupt image and presentation uploads cannot complete an activity or crash later requests', async t => {
  const h = await harness(t, { process: () => { throw new Error('Cannot decode malformed media'); } });
  for (const name of ['corrupt.png', 'corrupt.jpg', 'corrupt.webp', 'corrupt.pptx', 'corrupt.mp4', 'corrupt.wav']) {
    const result = await h.submit(name, Buffer.from('This is not valid media.'));
    assert.ok([400, 201].includes(result.status), name);
    if (result.status === 201) {
      assert.equal(result.data.evidence.status, 'review_required', name);
      assert.equal(result.data.roadmapStepCompleted, false, name);
    }
    assert.equal(h.reviewInputs.length, 0, name);
  }
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM user_skills').get().count, 0);
  assert.equal((await h.request('/api/roadmap/steps/1')).status, 200);
});

function actualReviewer() {
  const source = readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('async function reviewEvidenceWithAI(');
  const end = source.indexOf('async function analyseCareerQuizWithLumia(', start);
  assert.ok(start >= 0 && end > start);
  const requests = [];
  const context = vm.createContext({ process: { env: { GROQ_API_KEY: 'test-key' } }, AbortSignal, console,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ decision: 'approved', confidence: 0.99,
        taskCompleted: true, relevantEvidence: true, sufficientDetail: true, feedback: 'The visible observations demonstrate the criteria.',
        skillsDetected: ['Investigation'], criteriaResults: criteria.map(criterion => ({ criterion, met: true, feedback: 'Demonstrated.' })) }) } }] }) };
    } });
  vm.runInContext(source.slice(start, end), context);
  return { requests, review: overrides => context.reviewEvidenceWithAI({ careerTitle: 'Content Producer', stepTitle: 'Present findings',
    stepDescription: 'Explain the investigation findings', submissionType: 'file', verificationCriteria: criteria,
    targetSkills: ['Investigation'], ...overrides }) };
}

test('the actual reviewer treats media observations as untrusted evidence with explicit modality limits', async () => {
  const h = actualReviewer();
  for (const type of ['image', 'audio', 'video']) {
    const evidence = observation(type);
    const result = await h.review({ uploadedEvidence: { fileName: 'submitted-work', fileType: type,
      extractedText: evidence.text, autoReviewable: true, metadata: evidence.metadata } });
    assert.equal(result.decision, 'approved', type);
    const request = h.requests.at(-1);
    const system = request.messages.find(message => message.role === 'system').content;
    assert.match(system, /MEDIA EVIDENCE RULES/);
    assert.match(system, /untrusted/i);
    assert.match(system, /sample[ds]? (?:video[- ])?frames|sample of frames/i);
    assert.match(system, /transcript/i);
    const payload = JSON.parse(request.messages.find(message => message.role === 'user').content);
    assert.equal(payload.reviewScope, 'uploaded_work');
    assert.equal(payload.uploadedEvidence.extractedText, evidence.text);
    assert.equal(payload.uploadedEvidence.beginStudentWork, '--- BEGIN STUDENT WORK ---');
    assert.equal(payload.uploadedEvidence.endStudentWork, '--- END STUDENT WORK ---');
    assert.deepEqual(payload.uploadedEvidence.metadata, evidence.metadata);
  }
});

test('the actual reviewer never grades a media filename, incomplete observations or failed analysis', async () => {
  const h = actualReviewer();
  for (const [type, metadata, autoReviewable] of [
    ['image', {}, true], ['image', { visionAnalysed: true }, false],
    ['image', { visionAnalysed: true, processingFailed: true }, true],
    ['audio', { transcription: false }, true], ['audio', { transcription: true, truncated: true }, true],
    ['video', { transcriptAvailable: true, visualAnalysisAvailable: false, sampledFrames: 0 }, true],
    ['video', { transcriptAvailable: false, visualAnalysisAvailable: true, sampledFrames: 3, audioPresent: true }, true],
    ['video', { transcriptAvailable: true, visualAnalysisAvailable: true, sampledFrames: 4 }, true]
  ]) {
    const result = await h.review({ uploadedEvidence: { fileName: `submitted.${type}`, fileType: type,
      extractedText: observation(type).text, autoReviewable, metadata } });
    assert.equal(result.decision, 'review_required', JSON.stringify({ type, metadata, autoReviewable }));
    assert.deepEqual(Array.from(result.skillsDetected), []);
  }
  assert.equal(h.requests.length, 0, 'Incomplete media must bypass the model entirely.');
});

test('a confirmed silent video can be reviewed from sampled frames without inventing a transcript', async () => {
  const h = actualReviewer();
  const extractedText = 'VIDEO VISUAL SAMPLE\nThree sampled frames show the investigation findings and labels.';
  const result = await h.review({ uploadedEvidence: { fileName: 'silent-demonstration.mp4', fileType: 'video', extractedText,
    autoReviewable: true, metadata: { audioPresent: false, transcriptAvailable: false, visualAnalysisAvailable: true, sampledFrames: 3 } } });
  assert.equal(result.decision, 'approved');
  assert.equal(h.requests.length, 1);
  const payload = JSON.parse(h.requests[0].messages.find(message => message.role === 'user').content);
  assert.equal(payload.uploadedEvidence.extractedText, extractedText);
  assert.equal(payload.uploadedEvidence.metadata.transcriptAvailable, false);
  assert.equal(payload.uploadedEvidence.metadata.audioPresent, false);
});
