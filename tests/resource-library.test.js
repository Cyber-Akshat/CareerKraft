const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chooseLearningResources } = require('../learning-resource-library');

test('UX and UI foundations receive direct free user-research and design guides', () => {
  const resources = chooseLearningResources({ step: { title: 'Understand UX and UI', description: 'Explore user needs and usable interfaces.' } });
  assert.equal(resources.length, 2);
  assert.deepEqual(resources.map(resource => resource.provider), ['GOV.UK Service Manual', 'GOV.UK Service Manual']);
  assert.match(resources[0].url, /how-user-research-improves-service-design$/);
  assert.match(resources[1].url, /introduction-designing-government-services$/);
  assert.ok(resources.every(resource => resource.description && resource.studyFocus));
  assert.ok(resources.every(resource => !('keywords' in resource)));
});

test('job posting modules rank relevant Acas adverts and templates above incidental design words', () => {
  const resources = chooseLearningResources({ step: { title: 'Design a Simple Job Posting', description: 'Write an inclusive job advertisement for recruitment.' } });
  assert.equal(resources.length, 2);
  assert.deepEqual(resources.map(resource => resource.provider), ['Acas', 'Acas']);
  assert.match(resources[0].url, /how-to-advertise-a-job$/);
  assert.match(resources[1].url, /job-description-templates$/);
});

test('pandas modules rank two pandas tutorials before Python fundamentals', () => {
  const resources = chooseLearningResources({ step: { title: 'Explore a pandas DataFrame', description: 'Read CSV data with pandas in Python.' } });
  assert.ok(resources.length >= 2 && resources.length <= 4);
  assert.deepEqual(resources.slice(0, 2).map(resource => resource.provider), ['pandas Documentation', 'pandas Documentation']);
  assert.match(resources[0].url, /01_table_oriented\.html$/);
  assert.match(resources[1].url, /02_read_write\.html$/);
});

test('unknown topics receive no unrelated links and ui does not match building', () => {
  assert.deepEqual(chooseLearningResources({ step: { title: 'Building a garden', description: 'Grow vegetables and prepare a planting plan.' } }), []);
  assert.deepEqual(chooseLearningResources({ step: { title: 'Prepare a nutritious meal', description: 'Compare ingredients and cooking techniques.' } }), []);
  assert.deepEqual(chooseLearningResources(), []);
});

test('module outline takes priority over incidental context while genuine concept topics remain usable', () => {
  const resources = chooseLearningResources({
    step: { title: 'Use the Fetch API', description: 'Make an API request and read the response.' },
    content: { learningObjectives: ['Consider accessibility when presenting results'] }
  });
  assert.match(resources[0].url, /Using_Fetch$/);
  const contextOnly = chooseLearningResources({ content: { keyConcepts: [{ title: 'Employment contracts' }] } });
  assert.equal(contextOnly.length, 2);
  assert.ok(contextOnly.every(resource => resource.provider === 'Acas'));
});
