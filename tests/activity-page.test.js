const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require.resolve('../activity.html'), 'utf8');
const script = fs.readFileSync(require.resolve('../activity.js'), 'utf8');
const evidencePolicyScript = fs.readFileSync(require.resolve('../evidence-policy.js'), 'utf8');
const evidencePolicy = require('../evidence-policy');
const settle = () => new Promise(resolve => setImmediate(resolve));
const step = { id: 24, title: 'Explore teaching', description: 'Learn about the role.', phaseNumber: 1, phaseTitle: 'Foundations', stepNumber: 1, estimatedMinutes: 20, activityType: 'learning', evidenceRequired: false, status: 'in_progress', career: { id: 'teacher', title: 'Teacher' } };
function load(t, request, query = '?step=24', contentRequest = async () => ({ data: { content: require('./fixtures/module') } })) {
  const dom = new JSDOM(html, { url: `http://localhost/activity.html${query}`, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.careerAuth = { getSession: async () => ({ data: { session: { user: { name: 'Alex' } } } }), request: (endpoint, body) => endpoint.endsWith('/content') ? contentRequest() : request(endpoint, body) };
  dom.window.HTMLMediaElement.prototype.play = () => undefined;
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  const timers = [];
  dom.window.setTimeout = fn => { timers.push(fn); };
  dom.window.eval(fs.readFileSync(require.resolve('../module-formatting.js'), 'utf8'));
  dom.window.eval(evidencePolicyScript);
  dom.window.eval(script);
  return { d: dom.window.document, timers };
}
test('activity loads, starts a fresh step, completes it and schedules return to dashboard', async t => {
  const calls = [];
  let started = false;
  const { d, timers } = load(t, async (endpoint, body) => {
    calls.push(endpoint);
    if (endpoint.endsWith('/start')) { started = true; return { data: { success: true } }; }
    if (endpoint.endsWith('/complete')) { assert.equal(JSON.stringify(body), '{}'); return { data: { success: true } }; }
    return { data: { step: { ...step, status: started ? 'in_progress' : 'not_started' } } };
  });
  await settle();
  assert.deepEqual(calls, ['roadmap/steps/24', 'roadmap/steps/24/start', 'roadmap/steps/24']);
  assert.equal(d.querySelector('#activity-title').textContent, step.title);
  const button = d.querySelector('#activity-complete-button');
  assert.equal(button.disabled, false);
  button.click();
  await settle();
  assert.equal(calls.at(-1), 'roadmap/steps/24/complete');
  assert.equal(d.querySelector('#activity-status-label').textContent, 'Completed');
  assert.equal(button.disabled, true);
  assert.equal(timers.length, 2);
  assert.equal(d.querySelectorAll('.completion-confetti span').length, 90);
  assert.match(script, /"dashboard\.html"/);
});
test('evidence and completed activities cannot be completed directly', async t => {
  for (const activity of [{ ...step, evidenceRequired: true }, { ...step, status: 'completed' }]) {
    const calls = [];
    const { d } = load(t, async endpoint => { calls.push(endpoint); return { data: { step: activity } }; });
    await settle();
    assert.equal(d.querySelector('#activity-complete-button').disabled, true);
    if (activity.evidenceRequired) assert.equal(d.querySelector('#activity-evidence-badge').textContent, 'Evidence required');
    d.querySelector('#activity-complete-button').click();
    assert.equal(calls.length, 1);
    assert.equal(d.querySelector('#activity-evidence-box').hidden, !activity.evidenceRequired);
  }
});
test('invalid links and failed refresh leave completion disabled', async t => {
  const invalid = load(t, async () => { throw Error('Should not request'); }, '?step=bad');
  await settle();
  assert.match(invalid.d.querySelector('#activity-status').textContent, /invalid/);
  assert.equal(invalid.d.querySelector('#activity-complete-button').disabled, true);
  let gets = 0;
  const failed = load(t, async endpoint => endpoint.endsWith('/start') ? { data: {} } : ++gets === 1 ? { data: { step: { ...step, status: 'not_started' } } } : { error: { message: 'Offline' } });
  await settle();
  assert.match(failed.d.querySelector('#activity-status').textContent, /Offline/);
  assert.equal(failed.d.querySelector('#activity-complete-button').disabled, true);
});

test('a failed initial activity request stops loading and retry restores the real activity', async t => {
  let attempts = 0;
  const { d } = load(t, async () => ++attempts === 1 ? { error: { message: 'Activity unavailable.' } } : { data: { step } });
  await settle();
  assert.doesNotMatch(d.querySelector('#activity-title').textContent, /Loading/);
  assert.doesNotMatch(d.querySelector('#activity-career').textContent, /Loading/);
  assert.equal(d.querySelector('.activity-content-grid').hidden, true);
  assert.equal(d.querySelector('#activity-complete-button').disabled, true);
  d.querySelector('#activity-retry').click();
  await settle();
  assert.equal(d.querySelector('#activity-title').textContent, step.title);
  assert.equal(d.querySelector('.activity-content-grid').hidden, false);
  assert.equal(d.querySelector('#activity-complete-button').disabled, false);
});

test('thrown completion requests restore controls and keep the activity in progress', async t => {
  const { d } = load(t, async endpoint => {
    if (endpoint.endsWith('/complete')) throw new Error('Disconnected');
    return { data: { step } };
  });
  await settle();
  d.querySelector('#activity-complete-button').click();
  await settle();
  assert.equal(d.querySelector('#activity-complete-button').disabled, false);
  assert.notEqual(d.querySelector('#activity-status-label').textContent, 'Completed');
  assert.match(d.querySelector('#activity-status').textContent, /connection.*try again/i);
});

test('an empty evidence response preserves the draft and never claims submission succeeded', async t => {
  const { d } = load(t, async endpoint => endpoint.endsWith('/evidence')
    ? { data: {} }
    : { data: { step: { ...step, evidenceRequired: true } } });
  await settle();
  d.querySelector('#evidence-text-input').value = 'The written work I want to submit.';
  d.querySelector('#submit-evidence-button').click();
  await settle();
  assert.equal(d.querySelector('#submit-evidence-button').disabled, false);
  assert.equal(d.querySelector('#evidence-text-input').value, 'The written work I want to submit.');
  assert.equal(d.querySelector('#evidence-submit-status').classList.contains('error'), true);
  assert.match(d.querySelector('#evidence-submit-status').textContent, /couldn't confirm/);
});

function chooseFile(d, name = 'my-work.txt', contents = 'My completed work', type = 'text/plain') {
  const file = new d.defaultView.File([contents], name, { type });
  const input = d.querySelector('#evidence-file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new d.defaultView.Event('change', { bubbles: true }));
  return file;
}

test('the picker and file selection use the shared evidence policy', async t => {
  const { d } = load(t, async () => ({ data: { step: { ...step, evidenceRequired: true } } }));
  await settle();
  const scripts = [...d.querySelectorAll('script[src]')].map(element => element.getAttribute('src'));
  assert.equal(scripts.indexOf('evidence-policy.js') < scripts.indexOf('activity.js'), true);
  assert.equal(d.querySelector('#evidence-file-input').accept, evidencePolicy.SUPPORTED_EVIDENCE_ACCEPT);
  assert.deepEqual(new Set(d.querySelector('#evidence-file-input').accept.split(',')), evidencePolicy.ALLOWED_EVIDENCE_EXTENSIONS);
  assert.equal(d.querySelector('#evidence-upload-help').textContent, 'Documents, code, spreadsheets, notebooks, images, audio or video · up to 10 MB');
  for (const extension of evidencePolicy.ALLOWED_EVIDENCE_EXTENSIONS) {
    const name = `completed-work${extension}`;
    chooseFile(d, name);
    assert.equal(d.querySelector('#evidence-file-name').textContent, name, extension);
    assert.equal(d.querySelector('#evidence-submit-status').hidden, true, extension);
  }
});

test('upload picker shows the selected work, removes it and preserves the optional note', async t => {
  const { d } = load(t, async () => ({ data: { step: { ...step, evidenceRequired: true } } }));
  await settle();
  assert.equal(d.querySelector('#evidence-link-input'), null);
  assert.equal(d.querySelector('#evidence-link-option'), null);
  assert.match(d.querySelector('#evidence-file-input').accept, /\.pptx/);
  d.querySelector('#evidence-text-input').value = 'My draft';
  chooseFile(d, 'research-notes.txt');
  assert.equal(d.querySelector('#evidence-file-selection').hidden, false);
  assert.equal(d.querySelector('#evidence-file-name').textContent, 'research-notes.txt');
  assert.match(d.querySelector('#evidence-file-size').textContent, /KB/);
  assert.match(d.querySelector('#evidence-text-input').placeholder, /Anything you'd like Lumia/);
  d.querySelector('#evidence-file-remove').click();
  assert.equal(d.querySelector('#evidence-file-selection').hidden, true);
  assert.equal(d.querySelector('#evidence-text-input').value, 'My draft');
  assert.match(d.querySelector('#evidence-text-input').placeholder, /Write your response/);
});

test('evidence form requires work and accepts a text-only response', async t => {
  const calls = [];
  const { d } = load(t, async (endpoint, body) => {
    calls.push({ endpoint, body });
    return endpoint.endsWith('/evidence') ? { data: { evidence: { status: 'submitted' } } } : { data: { step: { ...step, evidenceRequired: true } } };
  });
  await settle();
  const button = d.querySelector('#submit-evidence-button');
  const status = d.querySelector('#evidence-submit-status');
  button.click();
  assert.equal(status.textContent, 'Upload your work or provide a written response.');
  assert.equal(calls.length, 1);
  d.querySelector('#evidence-text-input').value = ' My work ';
  button.click();
  assert.equal(button.disabled, true);
  await settle();
  assert.equal(calls.at(-1).endpoint, 'roadmap/steps/24/evidence');
  const submitted = calls.at(-1).body;
  assert.equal(submitted instanceof d.defaultView.FormData, true);
  assert.deepEqual([...submitted.entries()], [['textContent', 'My work']]);
  assert.equal(status.classList.contains('success'), true);
  assert.match(status.textContent, /waiting for review/);
  assert.equal(button.textContent, 'Update evidence \u2192');
  assert.equal(d.querySelector('#activity-complete-button').disabled, true);
});

test('uploaded work submits alone or with an optional note using multipart evidence', async t => {
  for (const note of ['', ' Please check the second section. ']) {
    let submitted;
    const { d } = load(t, async (endpoint, body) => {
      if (endpoint.endsWith('/evidence')) {
        submitted = body;
        return { data: { evidence: { status: 'needs_changes', feedback: 'Add your conclusion.' } } };
      }
      return { data: { step: { ...step, evidenceRequired: true } } };
    });
    await settle();
    chooseFile(d, 'report.txt', 'Research, analysis and conclusions');
    d.querySelector('#evidence-text-input').value = note;
    d.querySelector('#submit-evidence-button').click();
    assert.equal(d.querySelector('#evidence-file-input').disabled, true);
    await settle();
    assert.equal(submitted instanceof d.defaultView.FormData, true);
    assert.equal(submitted.get('evidenceFile').name, 'report.txt');
    assert.equal(submitted.get('evidenceFile').size, 34);
    assert.deepEqual([...submitted.keys()], note ? ['evidenceFile', 'textContent'] : ['evidenceFile']);
    assert.equal(submitted.get('textContent'), note.trim() || null);
    assert.equal(d.querySelector('#evidence-file-input').disabled, false);
    assert.equal(d.querySelector('#evidence-file-selection').hidden, false);
    assert.equal(d.querySelector('#lumia-result-feedback').textContent, 'Add your conclusion.');
  }
});

test('documents, images, Python, spreadsheets and notebooks reach the evidence endpoint as multipart files', async t => {
  const uploads = [
    { name: 'research-report.pdf', contents: '%PDF-1.7 report fixture', type: 'application/pdf' },
    { name: 'lesson-plan.docx', contents: 'Document fixture', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'completed-design.png', contents: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), type: 'image/png' },
    { name: 'analysis.py', contents: 'values = [3, 4, 5]\nprint(sum(values))\n', type: 'text/x-python' },
    { name: 'results.XLSX', contents: 'Spreadsheet fixture', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { name: 'investigation.ipynb', contents: JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(42)'] }], nbformat: 4 }), type: 'application/x-ipynb+json' }
  ];
  for (const upload of uploads) {
    let submitted;
    let submittedEndpoint;
    const { d } = load(t, async (endpoint, body) => {
      if (endpoint.endsWith('/evidence')) {
        submittedEndpoint = endpoint;
        submitted = body;
        return { data: { evidence: { status: 'submitted' } } };
      }
      return { data: { step: { ...step, evidenceRequired: true } } };
    });
    await settle();
    const file = chooseFile(d, upload.name, upload.contents, upload.type);
    d.querySelector('#submit-evidence-button').click();
    await settle();
    assert.equal(submittedEndpoint, 'roadmap/steps/24/evidence', upload.name);
    assert.equal(submitted instanceof d.defaultView.FormData, true, upload.name);
    assert.deepEqual([...submitted.keys()], ['evidenceFile'], upload.name);
    assert.equal(submitted.get('evidenceFile'), file, upload.name);
    assert.equal(submitted.get('evidenceFile').type, upload.type, upload.name);
    assert.equal(d.querySelector('#evidence-submit-status').classList.contains('success'), true, upload.name);
    assert.equal(d.querySelector('#submit-evidence-button').disabled, false, upload.name);
  }
});

test('evidence API errors restore the inputs and preserve uploaded work and note', async t => {
  const { d } = load(t, async endpoint => endpoint.endsWith('/evidence')
    ? { error: { message: 'Review is temporarily unavailable.' } }
    : { data: { step: { ...step, evidenceRequired: true } } });
  await settle();
  chooseFile(d, 'work.txt');
  const input = d.querySelector('#evidence-text-input');
  input.value = 'My supporting note';
  const button = d.querySelector('#submit-evidence-button');
  button.click();
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(input.value, 'My supporting note');
  assert.equal(input.disabled, false);
  assert.equal(d.querySelector('#evidence-file-input').disabled, false);
  assert.equal(d.querySelector('#evidence-file-selection').hidden, false);
  assert.equal(d.querySelector('#evidence-file-name').textContent, 'work.txt');
  assert.equal(d.querySelector('#evidence-submit-status').classList.contains('error'), true);
  assert.match(d.querySelector('#evidence-submit-status').textContent, /temporarily unavailable/);
});

test('upload validation rejects unsupported, empty and oversized files without submitting', async t => {
  const calls = [];
  const { d } = load(t, async endpoint => { calls.push(endpoint); return { data: { step: { ...step, evidenceRequired: true } } }; });
  await settle();
  chooseFile(d, 'run.exe');
  assert.match(d.querySelector('#evidence-submit-status').textContent, /Unsupported file extension/);
  chooseFile(d, 'empty.txt', '');
  assert.match(d.querySelector('#evidence-submit-status').textContent, /empty/);
  chooseFile(d, 'huge.pdf', new Uint8Array(10 * 1024 * 1024 + 1), 'application/pdf');
  assert.match(d.querySelector('#evidence-submit-status').textContent, /10 MB/);
  assert.equal(d.querySelector('#evidence-file-selection').hidden, true);
  d.querySelector('#submit-evidence-button').click();
  assert.equal(calls.length, 1);
});

test('invalid replacement files preserve the selected work and supporting note', async t => {
  let submitted;
  const { d } = load(t, async (endpoint, body) => {
    if (endpoint.endsWith('/evidence')) {
      submitted = body;
      return { data: { evidence: { status: 'needs_changes', feedback: 'Add your conclusion.' } } };
    }
    return { data: { step: { ...step, evidenceRequired: true } } };
  });
  await settle();
  chooseFile(d, 'finished-report.txt', 'My completed report');
  d.querySelector('#evidence-text-input').value = 'See the final section.';
  chooseFile(d, 'unsupported.exe');
  assert.match(d.querySelector('#evidence-submit-status').textContent, /Unsupported file extension/);
  assert.equal(d.querySelector('#evidence-file-name').textContent, 'finished-report.txt');
  assert.equal(d.querySelector('#evidence-file-selection').hidden, false);
  d.querySelector('#submit-evidence-button').click();
  assert.equal(d.querySelector('#activity-evidence-box').getAttribute('aria-busy'), 'true');
  await settle();
  assert.equal(submitted.get('evidenceFile').name, 'finished-report.txt');
  assert.equal(submitted.get('textContent'), 'See the final section.');
  assert.equal(d.querySelector('#activity-evidence-box').getAttribute('aria-busy'), 'false');
});

test('dropping uploaded work sends the selected file and approval locks evidence inputs', async t => {
  let uploaded;
  const { d } = load(t, async (endpoint, body) => {
    if (endpoint.endsWith('/evidence')) {
      uploaded = body.get('evidenceFile');
      return { data: { evidence: { status: 'approved', feedback: 'Your uploaded work meets the criteria.', skillsDetected: [] }, roadmapStepCompleted: true } };
    }
    return { data: { step: { ...step, evidenceRequired: true } } };
  });
  await settle();
  const file = new d.defaultView.File(['Notes'], 'notes.md', { type: 'text/markdown' });
  const drop = new d.defaultView.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
  d.querySelector('#evidence-dropzone').dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  d.querySelector('#submit-evidence-button').click();
  await settle();
  assert.equal(uploaded.name, 'notes.md');
  assert.equal(d.querySelector('#activity-status-label').textContent, 'Completed');
  assert.equal(d.querySelector('#evidence-file-input').disabled, true);
  assert.equal(d.querySelector('#evidence-text-input').disabled, true);
  assert.equal(d.querySelector('#evidence-file-remove').disabled, true);
});

test('file approval keeps the Lumia animation running until its processing sound finishes', async t => {
  const progression = { advanced: true, generated: true, previousLevel: 'beginner', level: 'intermediate', stepsCreated: 7 };
  const { d } = load(t, async endpoint => endpoint.endsWith('/evidence')
    ? { data: { evidence: { status: 'approved', feedback: 'Your report demonstrates the criteria.', skillsDetected: [] }, roadmapStepCompleted: true, levelProgression: progression } }
    : { data: { step: { ...step, evidenceRequired: true } } });
  await settle();
  const sound = d.querySelector('#lumia-processing-sound');
  sound.play = () => Promise.resolve();
  chooseFile(d, 'report.txt');
  d.querySelector('#submit-evidence-button').click();
  await settle();
  assert.equal(d.querySelector('#lumia-overlay').hidden, false);
  assert.equal(d.querySelector('#lumia-overlay').dataset.state, 'processing');
  assert.equal(d.querySelector('#lumia-result').hidden, true);
  assert.equal(d.querySelector('#submit-evidence-button').disabled, true);
  sound.dispatchEvent(new d.defaultView.Event('ended'));
  await settle();
  assert.equal(d.querySelector('#lumia-overlay').dataset.state, 'approved');
  assert.equal(d.querySelector('#lumia-result').hidden, false);
  assert.equal(d.querySelectorAll('.completion-confetti span').length, 90);
  assert.deepEqual(JSON.parse(d.defaultView.sessionStorage.getItem('careerkraft-level-progression')), progression);
});

test('module content displays safely and generation failure offers retry before completion', async t => {
  const fixture = require('./fixtures/module');
  let fail = true;
  const { d } = load(t, async () => ({ data: { step } }), '?step=24', async () => fail
    ? { error: { message: 'Generation unavailable' } }
    : { data: { content: { ...fixture, introduction: '<img src=x onerror=alert(1)>', task: { title: 'Task', instructions: 'Write your reasoning.' } } } });
  await settle();
  assert.equal(d.querySelector('#module-error').hidden, false);
  assert.equal(d.querySelector('#module-retry-button').disabled, false);
  assert.equal(d.querySelector('#activity-complete-button').disabled, true);
  fail = false;
  d.querySelector('#module-retry-button').click();
  await settle();
  assert.equal(d.querySelector('#module-content').hidden, false);
  assert.equal(d.querySelector('#activity-learning-content').hidden, true);
  assert.equal(d.querySelector('#activity-complete-button').disabled, false);
  assert.equal(d.querySelector('#module-introduction').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(d.querySelector('#module-introduction img'), null);
  assert.match(d.querySelector('#module-content').textContent, /What Lumia will look for/);
  assert.equal(d.querySelector('#module-verification-criteria li').textContent, fixture.verificationCriteria[0]);
  assert.equal(d.querySelectorAll('.module-concept-card').length, fixture.keyConcepts.length);
  assert.equal(d.querySelector('.evidence-header p').textContent, fixture.evidence.instructions);
});

test('module player shows loading until content arrives and hides evidence guidance for learning steps', async t => {
  const fixture = require('./fixtures/module');
  let resolveContent;
  const { d } = load(t, async () => ({ data: { step } }), '?step=24', () => new Promise(resolve => { resolveContent = resolve; }));
  await settle();
  assert.equal(d.querySelector('#module-loading').hidden, false);
  assert.equal(d.querySelector('#module-learning').getAttribute('aria-busy'), 'true');
  assert.equal(d.querySelector('#module-content').hidden, true);
  assert.equal(d.querySelector('#submit-evidence-button').disabled, true);
  resolveContent({ data: { cached: true, content: { ...fixture, targetSkills: fixture.skills, evidenceInstructions: fixture.evidence.instructions } } });
  await settle();
  assert.equal(d.querySelector('#module-loading').hidden, true);
  assert.equal(d.querySelector('#module-learning').getAttribute('aria-busy'), 'false');
  assert.equal(d.querySelector('#module-content').classList.contains('hidden'), false);
  assert.equal(d.querySelector('#module-evidence-guidance').hidden, true);
  assert.equal(d.querySelectorAll('.module-skill-chip').length, fixture.skills.length);
  assert.equal(d.querySelector('#module-task-instructions').textContent, fixture.task.instructions);
});

test('module resources render safe links and topic-specific study guidance', async t => {
  const fixture = require('./fixtures/module');
  const { d } = load(t, async () => ({data:{step}}), '?step=24', async () => ({data:{content:fixture}}));
  await settle();
  assert.equal(d.querySelector('#module-resources-section').hidden,false);
  const card = d.querySelector('.module-resource-card');
  assert.equal(card.children.length, 2);
  assert.equal(card.children[0].className, 'module-resource-main');
  assert.equal(card.children[1].className, 'module-resource-action');
  assert.equal(card.querySelector('.module-resource-provider').textContent, fixture.resources[0].provider);
  assert.equal(card.querySelector('.module-resource-type').textContent, fixture.resources[0].resourceType);
  assert.equal(card.querySelector('.module-resource-focus strong').textContent, 'Focus on');
  assert.equal(card.querySelector('.module-resource-focus p').textContent, fixture.resources[0].studyFocus);
  assert.match(d.querySelector('.module-resource-focus').textContent,/Evidence handling/);
  const link=d.querySelector('.module-resource-card a');
  assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(link.href,fixture.resources[0].url);
});

test('saved module instructions and walkthrough render as readable steps and bullet lists', async t => {
  const fixture = require('./fixtures/module');
  const content = { ...fixture,
    task: { title: 'Prepare your evidence', instructions: '1. **Choose a source** - Explain your choice. 2. **Review it** - Record what you found. 3. **Submit** - Include these items:\n- `notes.txt` with your findings\n- A short reflection' },
    example: { ...fixture.example, walkthrough: '1. **Prepare** - Choose relevant evidence. 2. **Compare** - Check the timestamps.' }
  };
  const { d } = load(t, async () => ({ data: { step } }), '?step=24', async () => ({ data: { cached: true, content } }));
  await settle();
  assert.equal(d.querySelectorAll('#module-task-instructions > ol > li').length, 3);
  assert.equal(d.querySelectorAll('#module-task-instructions ol ul li').length, 2);
  assert.equal(d.querySelector('#module-task-instructions code').textContent, 'notes.txt');
  assert.equal(d.querySelector('#module-task-instructions strong').textContent, 'Choose a source');
  assert.equal(d.querySelectorAll('#module-example-walkthrough > ol > li').length, 2);
  assert.equal(d.querySelector('#module-task-instructions').textContent.includes('**'), false);
});

test('resource-free modules remain usable with an explicit empty state', async t => {
  const fixture = require('./fixtures/module');
  const { d } = load(t, async () => ({data:{step}}), '?step=24', async () => ({data:{content:{...fixture,resources:[]}}}));
  await settle();
  assert.equal(d.querySelector('#module-content').hidden,false);
  assert.equal(d.querySelector('#activity-complete-button').disabled,false);
  assert.equal(d.querySelector('#module-resources-section').hidden,false);
  const lines=[...d.querySelectorAll('.module-resources-empty p')].map(p=>p.textContent);
  assert.deepEqual(lines,['No recommended resources available for this module right now.','You can still continue with the learning content below.']);
});
