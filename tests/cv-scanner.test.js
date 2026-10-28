const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'cv-scanner.html'), 'utf8');
const maximumBytes = 10 * 1024 * 1024;
const result = () => ({
  success: true, scanId: 4, fileName: 'student-cv.txt', targetCareer: null,
  analysis: {
    overallScore: 78, scores: { structure: 85, clarity: 80, evidence: 65, relevance: 82 },
    strengths: [], priorityImprovements: [], verifiedSkillsMissingFromCv: [],
    bulletRewrites: [], careerAlignmentSummary: ''
  }
});
const response = (value = result(), ok = true) => ({ ok, json: async () => value });
const settled = () => new Promise(resolve => setImmediate(resolve));

function load(t, fetchImpl = async () => response()) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/cv-scanner.html', runScripts: 'outside-only', virtualConsole
  });
  const { window } = dom;
  const { document } = window;
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimer = 0;
  let pickerClicks = 0;
  window.scrollTo = () => {};
  window.fetch = fetchImpl;
  window.setInterval = callback => { intervals.set(++nextTimer, callback); return nextTimer; };
  window.clearInterval = id => intervals.delete(id);
  window.setTimeout = (callback, delay) => { timeouts.set(++nextTimer, { callback, delay }); return nextTimer; };
  window.clearTimeout = id => timeouts.delete(id);
  const input = document.getElementById('cvFileInput');
  const nativeClick = input.click.bind(input);
  input.click = () => { pickerClicks++; nativeClick(); };
  let inputValue = '';
  Object.defineProperty(input, 'value', {
    configurable: true, get: () => inputValue, set: value => { inputValue = value; }
  });
  window.eval(readFileSync(path.join(root, 'cv-scanner.js'), 'utf8'));
  t.after(() => dom.window.close());
  const element = id => document.getElementById(id);
  const file = (name = 'student-cv.txt', contents = 'Education and a student project.') =>
    new window.File([contents], name, { type: 'application/octet-stream' });
  function choose(value) {
    inputValue = value ? `C:\\fakepath\\${value.name}` : '';
    Object.defineProperty(input, 'files', { configurable: true, value: value ? [value] : [] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  function drag(type, files = []) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    element('uploadZone').dispatchEvent(event);
    return event;
  }
  function tick(count = 1) {
    for (let index = 0; index < count; index++) [...intervals.values()].forEach(callback => callback());
  }
  return {
    window, document, element, input, file, choose, drag, tick, intervals, timeouts,
    pickerClicks: () => pickerClicks,
    stored: () => JSON.parse(window.sessionStorage.getItem('careerkraft-cv-scan-result'))
  };
}

test('CV browse and keyboard controls open one picker without bubbling through the upload zone', t => {
  const h = load(t);
  assert.equal(h.element('scanCvButton').disabled, true);
  assert.ok(h.element('selectedFileCard').classList.contains('hidden'));
  assert.ok(h.element('uploadError').classList.contains('hidden'));
  h.element('browseButton').click();
  assert.equal(h.pickerClicks(), 1);
  h.element('uploadZone').querySelector('h3').click();
  assert.equal(h.pickerClicks(), 2);
  for (const key of ['Enter', ' ']) {
    const event = new h.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    h.element('uploadZone').dispatchEvent(event);
    assert.ok(event.defaultPrevented);
  }
  assert.equal(h.pickerClicks(), 4);
  h.element('browseButton').dispatchEvent(new h.window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true
  }));
  assert.equal(h.pickerClicks(), 4, 'Nested native buttons keep their own keyboard activation');
  h.input.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(h.pickerClicks(), 4, 'Input clicks cannot reopen the picker');
});

test('CV selection validates files, renders names safely and supports removal and reselection', t => {
  const h = load(t);
  const name = '<img src=x onerror=alert(1)>.PDF';
  h.choose(h.file(name, 'x'.repeat(2048)));
  assert.equal(h.element('selectedFileName').textContent, name);
  assert.equal(h.element('selectedFileName').querySelector('img'), null);
  assert.equal(h.element('selectedFileSize').textContent, '2.0 KB');
  assert.equal(h.element('selectedFileCard').querySelector('.file-icon').textContent, 'PDF');
  assert.equal(h.element('scanCvButton').disabled, false);
  assert.equal(h.element('selectedFileCard').classList.contains('hidden'), false);
  h.element('removeFileButton').click();
  assert.equal(h.input.value, '');
  assert.equal(h.element('scanCvButton').disabled, true);
  assert.ok(h.element('selectedFileCard').classList.contains('hidden'));
  for (const file of [h.file('cv.doc'), h.file('cv.md'), h.file('cv'), h.file('cv.txt', ''),
    h.file('cv.txt', new Uint8Array(maximumBytes + 1))]) {
    h.choose(file);
    assert.equal(h.element('scanCvButton').disabled, true, file.name);
    assert.ok(h.element('selectedFileCard').classList.contains('hidden'));
    assert.equal(h.element('uploadError').classList.contains('hidden'), false);
    assert.ok(h.element('uploadError').textContent.trim());
    assert.equal(h.input.value, '', 'Invalid selections can be chosen again');
  }
  h.choose(h.file('CV.TXT', new Uint8Array(maximumBytes)));
  assert.equal(h.element('scanCvButton').disabled, false, 'Exactly 10 MiB is allowed');
  assert.equal(h.element('selectedFileCard').querySelector('.file-icon').textContent, 'TXT');
  assert.ok(h.element('uploadError').classList.contains('hidden'));
});

test('CV drag and drop prevents navigation, updates drag feedback and selects a document', t => {
  const h = load(t);
  assert.ok(h.drag('dragenter').defaultPrevented);
  assert.ok(h.element('uploadZone').classList.contains('dragging'));
  assert.ok(h.drag('dragover').defaultPrevented);
  h.drag('dragleave');
  assert.equal(h.element('uploadZone').classList.contains('dragging'), false);
  const selected = h.file('student.docx');
  assert.ok(h.drag('drop', [selected]).defaultPrevented);
  assert.equal(h.element('selectedFileName').textContent, selected.name);
  assert.equal(h.element('selectedFileCard').querySelector('.file-icon').textContent, 'DOCX');
  assert.equal(h.element('scanCvButton').disabled, false);
  assert.equal(h.element('uploadZone').classList.contains('dragging'), false);
});

test('CV scan sends one multipart request, caps pending progress and stores results before redirecting', async t => {
  const calls = [];
  let resolveRequest;
  const h = load(t, (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { resolveRequest = resolve; });
  });
  const selected = h.file();
  h.choose(selected);
  h.element('scanCvButton').click();
  h.element('scanCvButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, 1, 'Only one scan can be in flight');
  assert.equal(calls[0].url, '/api/cv/scan');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.body.get('cv').name, selected.name);
  assert.equal(calls[0].options.body.get('cv').size, selected.size);
  assert.equal(new Headers(calls[0].options.headers).has('Content-Type'), false);
  assert.equal(h.element('scanCvButton').disabled, true);
  assert.ok(h.element('analysingView').classList.contains('active-view'));
  assert.equal(h.element('uploadView').classList.contains('active-view'), false);
  h.tick(80);
  assert.equal(h.element('analysisPercentage').textContent, '92%');
  assert.equal(h.element('analysisProgressFill').style.width, '92%');
  assert.ok(h.document.querySelector('[data-step="feedback"]').classList.contains('active'));
  assert.equal(h.stored(), null);
  assert.equal(h.timeouts.size, 0);
  const analysis = result();
  resolveRequest(response(analysis));
  await settled();
  assert.deepEqual(h.stored(), analysis);
  assert.equal(h.element('analysisPercentage').textContent, '100%');
  assert.equal(h.document.querySelectorAll('.analysis-step.completed').length, 5);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 1);
  assert.equal([...h.timeouts.values()][0].delay, 650);
  assert.equal(h.window.location.pathname, '/cv-scanner.html');
});

test('CV request failures preserve the selected file for retry and stop progress without saving a result', async t => {
  const h = load(t);
  h.choose(h.file());
  for (const fetchImpl of [
    async () => { throw new Error('Network unavailable'); },
    async () => response({ error: 'This CV could not be read.' }, false),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Not JSON'); } }),
    async () => response(null), async () => response({})
  ]) {
    h.window.fetch = fetchImpl;
    h.element('scanCvButton').click();
    await settled();
    assert.ok(h.element('uploadView').classList.contains('active-view'));
    assert.equal(h.element('analysingView').classList.contains('active-view'), false);
    assert.equal(h.element('selectedFileCard').classList.contains('hidden'), false);
    assert.equal(h.element('scanCvButton').disabled, false);
    assert.equal(h.element('uploadError').classList.contains('hidden'), false);
    assert.ok(h.element('uploadError').textContent.trim());
    assert.equal(h.stored(), null);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timeouts.size, 0);
  }
  h.window.fetch = async () => response();
  h.element('scanCvButton').click();
  await settled();
  assert.deepEqual(h.stored(), result());
});

test('CV result storage failures show a recoverable error instead of redirecting without the result', async t => {
  const h = load(t);
  t.mock.method(h.window.Storage.prototype, 'setItem', () => { throw new Error('Storage unavailable'); });
  h.choose(h.file());
  h.element('scanCvButton').click();
  await settled();
  assert.ok(h.element('uploadView').classList.contains('active-view'));
  assert.equal(h.element('scanCvButton').disabled, false);
  assert.equal(h.element('uploadError').classList.contains('hidden'), false);
  assert.ok(h.element('uploadError').textContent.trim());
  assert.equal(h.stored(), null);
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 0);
});

test('returning from browser history restores completed scans and resumes pending scans without duplicate requests', async t => {
  let requests = 0;
  let resolvePending;
  const h = load(t, () => {
    requests++;
    return requests === 1 ? Promise.resolve(response())
      : new Promise(resolve => { resolvePending = resolve; });
  });
  const transition = type => h.window.dispatchEvent(new h.window.PageTransitionEvent(type, { persisted: true }));
  h.choose(h.file());
  h.element('scanCvButton').click();
  await settled();
  assert.equal(h.element('analysisPercentage').textContent, '100%');
  assert.equal(h.timeouts.size, 1);
  transition('pagehide');
  transition('pageshow');
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.ok(h.element('uploadView').classList.contains('active-view'));
  assert.equal(h.element('scanCvButton').disabled, false);
  assert.equal(h.element('selectedFileCard').classList.contains('hidden'), false);

  h.element('scanCvButton').click();
  assert.equal(requests, 2, 'The same selected file can be scanned again after returning');
  h.tick(2);
  const progress = Number.parseInt(h.element('analysisPercentage').textContent);
  transition('pagehide');
  assert.equal(h.intervals.size, 0);
  transition('pageshow');
  assert.equal(h.intervals.size, 1);
  assert.ok(h.element('analysingView').classList.contains('active-view'));
  assert.equal(h.element('scanCvButton').disabled, true);
  h.element('scanCvButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(requests, 2, 'Returning during a pending scan cannot create a duplicate');
  h.tick(2);
  assert.ok(Number.parseInt(h.element('analysisPercentage').textContent) > progress);
  assert.ok(Number.parseInt(h.element('analysisPercentage').textContent) < 100);
  const completed = { ...result(), scanId: 5 };
  resolvePending(response(completed));
  await settled();
  assert.deepEqual(h.stored(), completed);
  assert.equal(h.element('analysisPercentage').textContent, '100%');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 1);
});
