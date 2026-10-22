const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateModuleContent, validateModuleContent, normalizeEvidenceInstructions } = require('../module-content');
const fixture = require('./fixtures/module');

const step = {
  title: fixture.title, description: 'Analyse digital evidence.', level: 'beginner',
  activity_type: 'challenge', estimated_minutes: 30, evidence_required: 1
};

test('old link-submission guidance becomes upload guidance without changing genuine written tasks', () => {
  assert.match(normalizeEvidenceInstructions('Submit a link to your completed research document.'), /Upload your completed work/);
  assert.match(normalizeEvidenceInstructions('Provide a URL to your project.'), /optional note/);
  const reflection = 'Explain what you learned in three sentences.';
  assert.equal(normalizeEvidenceInstructions(reflection), reflection);
  const reasoning = 'Explain the link between the two observations.';
  assert.equal(normalizeEvidenceInstructions(reasoning), reasoning);
});

test('module evidence types are controlled by CareerKraft rather than the model', () => {
  const generated = validateModuleContent({
    ...fixture, evidence: { ...fixture.evidence, required: false, acceptedTypes: ['link'] }
  }, step);
  assert.deepEqual(generated.evidence.acceptedTypes, ['text', 'file']);
  assert.equal(generated.evidence.required, true);
  const learningOnly = validateModuleContent(fixture, { ...step, evidence_required: 0 });
  assert.equal(learningOnly.evidence.required, false);
});

test('module author accepts uploaded work without a duplicate explanation and preserves genuine reasoning objectives', async t => {
  const previousKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'module-test-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
  });
  let payload;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(fixture) } }] })
    };
  });
  const content = await generateModuleContent({
    career: { id: 'digital-forensics-investigator', title: 'Digital Forensics Investigator' },
    step, assessment: {}, previousJourney: {}
  });
  const prompt = payload.messages[0].content;
  assert.match(prompt, /file upload and text response/);
  assert.match(prompt, /NO external-link submission option/);
  assert.match(prompt, /Uploaded work is sufficient as a submission/);
  assert.match(prompt, /supporting note is OPTIONAL/);
  assert.match(prompt, /unless it is part of this activity's learning objective/);
  assert.match(prompt, /inside the uploaded work or in the optional text response/);
  assert.match(prompt, /a direct text response is sufficient/);
  assert.match(prompt, /Never instruct the student to provide an external URL or link as evidence/);
  assert.deepEqual(content.evidence.acceptedTypes, ['text', 'file']);
});
