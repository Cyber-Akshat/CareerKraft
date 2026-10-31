const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'cv-results.html'), 'utf8');
const storageKey = 'careerkraft-cv-scan-result';
const buildStorageKey = 'careerkraft-cv-build';
const buildResult = () => ({
  success: true, buildId: 17, targetCareer: 'Cyber Security Analyst',
  structuredCv: { summary: 'A student exploring cybersecurity.', education: [], experience: [], projects: [], skills: [] },
  suggestions: []
});
const response = (value = buildResult(), ok = true) => ({ ok, json: async () => value });
const settled = () => new Promise(resolve => setImmediate(resolve));
const buttonLabel = element => element.textContent.replace(/\s+/g, ' ').trim();
const result = () => ({
  success: true, scanId: 4, fileName: 'student-cv.txt', targetCareer: 'Cyber Security Analyst',
  analysis: {
    overallScore: 78, scores: { structure: 85, clarity: 80, evidence: 65, relevance: 82 },
    strengths: ['Clear education section', 'Relevant project'],
    priorityImprovements: ['Explain the project goal', 'Link verified evidence'],
    verifiedSkillsMissingFromCv: ['Research', 'Network Analysis'],
    bulletRewrites: [
      { original: 'I researched network traffic.', improved: 'Researched network traffic.', reason: 'Start with the action.' },
      { original: 'built a dashboard', improved: 'Built a dashboard.', reason: '' }
    ],
    careerAlignmentSummary: 'Your research project provides a starting point for this career.'
  }
});

function load(t, saved = result(), { storageError = false, dashboard = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: `http://localhost:3000/${dashboard ? 'dashboard.html#cv-results' : 'cv-results.html'}`,
    runScripts: 'outside-only', virtualConsole
  });
  const { window } = dom;
  if (dashboard) {
    const view = window.document.createElement('div');
    view.id = 'cv-results-view';
    window.document.body.appendChild(view);
  }
  const storage = window.sessionStorage;
  if (saved !== null) storage.setItem(storageKey, typeof saved === 'string' ? saved : JSON.stringify(saved));
  if (storageError) Object.defineProperty(window, 'sessionStorage', {
    configurable: true, get() { throw new window.DOMException('Storage unavailable', 'SecurityError'); }
  });
  let now = 0;
  let nextFrame = 0;
  const frames = new Map();
  const alerts = [];
  let printCalls = 0;
  Object.defineProperty(window.performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.alert = message => alerts.push(message);
  window.print = () => { printCalls++; };
  window.fetch = async () => response();
  assert.doesNotThrow(() => window.eval(readFileSync(path.join(root, 'cv-results.js'), 'utf8')));
  t.after(() => window.close());
  function flush() {
    for (let iteration = 0; iteration < 5 && frames.size; iteration++) {
      now += 1000;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(now));
    }
    assert.equal(frames.size, 0, 'Number and graphic animations complete');
  }
  return {
    window, document: window.document, storage, frames, alerts, flush, printCalls: () => printCalls,
    element: id => window.document.getElementById(id),
    navigations: () => errors.filter(error => /navigation/i.test(error.message)),
    restore() { window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })); }
  };
}

test('CV results render the saved API response, category scores, graphics and rewrite details', t => {
  const value = result();
  const h = load(t, value);
  h.flush();
  assert.equal(h.element('overallScore').textContent, '78');
  assert.equal(h.element('scoreTitle').textContent, 'Strong foundation');
  assert.equal(h.element('targetCareer').textContent, value.targetCareer);
  assert.equal(h.element('careerAlignmentSummary').textContent, value.analysis.careerAlignmentSummary);
  for (const [category, score] of Object.entries(value.analysis.scores)) {
    assert.equal(h.element(`${category}Score`).textContent, String(score));
    assert.equal(h.element(`${category}Bar`).style.width, `${score}%`);
  }
  assert.ok(Math.abs(Number(h.element('scoreRingProgress').style.strokeDashoffset) - 326.73 * 0.22) < 0.001);
  assert.equal(h.element('strengthsList').children.length, 2);
  assert.equal(h.element('improvementsList').children.length, 2);
  assert.deepEqual([...h.element('missingSkillsList').querySelectorAll('.skill-name')].map(item => item.textContent), ['Research', 'Network Analysis']);
  assert.ok(h.element('missingSkillsEmpty').classList.contains('hidden'));
  const rewrites = h.element('bulletRewritesList').children;
  assert.equal(rewrites.length, 2);
  assert.equal(rewrites[0].querySelector('.rewrite-label').textContent, 'Before');
  assert.equal(rewrites[0].querySelector('.rewrite-label.improved').textContent, 'Lumia suggestion');
  assert.deepEqual([...rewrites[0].querySelectorAll('.rewrite-text')].map(item => item.textContent),
    ['I researched network traffic.', 'Researched network traffic.']);
  assert.equal(rewrites[0].querySelector('.rewrite-reason').textContent, 'Why this is stronger: Start with the action.');
  assert.equal(rewrites[1].querySelector('.rewrite-reason'), null);
  assert.equal(h.navigations().length, 0);
});

test('CV results clamp numeric scores and select the appropriate score title', t => {
  for (const [score, title] of [
    [130, 'Excellent shape'], [90, 'Excellent shape'], [89, 'Strong foundation'],
    [80, 'Strong foundation'], [75, 'Strong foundation'], [74, 'Good potential'],
    [70, 'Good potential'], [60, 'Good potential'], [59, 'Focused improvements'],
    [45, 'Focused improvements'], [44, 'Room to grow'], [-8, 'Room to grow']
  ]) {
    const value = result();
    value.analysis.overallScore = score;
    value.analysis.scores = { structure: 300, clarity: -10, evidence: '65.6', relevance: 'invalid' };
    const h = load(t, value);
    h.flush();
    assert.equal(h.element('scoreTitle').textContent, title);
    assert.equal(h.element('overallScore').textContent, String(Math.max(0, Math.min(100, score))));
    assert.deepEqual(['structure', 'clarity', 'evidence', 'relevance'].map(name => h.element(`${name}Score`).textContent),
      ['100', '0', '66', '0']);
  }
});

test('non-numeric cached score objects, arrays and booleans cannot throw or coerce into a score', t => {
  for (const score of [{ toString: null }, { valueOf: null }, { toString: null, valueOf: null }, [90], [], true, false]) {
    const value = result();
    value.analysis.overallScore = score;
    value.analysis.scores = { structure: score, clarity: 85, evidence: score, relevance: '82' };
    const h = load(t, value);
    h.flush();
    assert.equal(h.element('overallScore').textContent, '0');
    assert.deepEqual(['structure', 'clarity', 'evidence', 'relevance'].map(name => h.element(`${name}Score`).textContent),
      ['0', '85', '0', '82']);
    assert.equal(h.element('structureBar').style.width, '0%');
    assert.equal(h.element('evidenceBar').style.width, '0%');
    assert.equal(Number(h.element('scoreRingProgress').style.strokeDashoffset), 326.73);
    assert.equal(h.navigations().length, 0);
  }
});

test('CV feedback and profile content are inserted as text rather than executable HTML', t => {
  const hostile = '<img src=x onerror="window.cvInjected=true"><script>window.cvInjected=true</script>';
  const value = result();
  value.fileName = hostile;
  value.targetCareer = hostile;
  value.analysis.careerAlignmentSummary = hostile;
  value.analysis.strengths = [hostile];
  value.analysis.priorityImprovements = [hostile];
  value.analysis.verifiedSkillsMissingFromCv = [hostile];
  value.analysis.bulletRewrites = [{ original: hostile, improved: hostile, reason: hostile }];
  const h = load(t, value);
  h.flush();
  for (const id of ['cvReportMeta', 'targetCareer', 'careerAlignmentSummary', 'strengthsList', 'improvementsList', 'missingSkillsList', 'bulletRewritesList']) {
    assert.ok(h.element(id).textContent.includes(hostile), id);
    assert.equal(h.element(id).querySelector('img,script'), null, id);
  }
  assert.equal(h.window.cvInjected, undefined);
});

test('CV lists filter invalid items before numbering, respect limits and show empty states after filtering', t => {
  const value = result();
  value.analysis.strengths = [null, ' First ', 42, '', 'Second', 'Third', 'Fourth'];
  value.analysis.priorityImprovements = [' ', false, 'One', 'Two', 'Three', 'Four'];
  value.analysis.verifiedSkillsMissingFromCv = [null, ' ', 42];
  value.analysis.bulletRewrites = [null, 42, [], {}, { original: '', improved: 'Incomplete' }];
  const h = load(t, value);
  h.flush();
  for (const id of ['strengthsList', 'improvementsList']) {
    assert.equal(h.element(id).children.length, 3);
    assert.deepEqual([...h.element(id).querySelectorAll('.result-list-number')].map(item => item.textContent), ['1', '2', '3']);
  }
  assert.ok(h.element('strengthsList').children[0].textContent.endsWith('First'));
  for (const [list, empty] of [['missingSkillsList', 'missingSkillsEmpty'], ['bulletRewritesList', 'bulletRewritesEmpty']]) {
    assert.equal(h.element(list).children.length, 0);
    assert.ok(h.element(list).classList.contains('hidden'));
    assert.equal(h.element(empty).classList.contains('hidden'), false);
  }
});

test('missing, invalid and inaccessible CV cache redirects without fabricating a result', t => {
  for (const saved of [null, '{not JSON}', 'null', '[]', {}, { analysis: null }, { analysis: [] }, { analysis: 'invalid' }]) {
    const h = load(t, saved);
    assert.equal(h.navigations().length, 1);
    assert.equal(h.frames.size, 0);
    assert.equal(h.element('strengthsList').children.length, 0);
  }
  const blocked = load(t, result(), { storageError: true });
  assert.equal(blocked.navigations().length, 1);
  assert.equal(blocked.frames.size, 0);
});

test('CV results use readable fallbacks and scan another clears the saved scan', t => {
  const value = result();
  value.targetCareer = null;
  value.analysis.careerAlignmentSummary = '';
  const h = load(t, value);
  h.flush();
  assert.equal(h.element('targetCareer').textContent, 'No target career selected');
  assert.equal(h.element('careerAlignmentSummary').textContent,
    'Lumia has reviewed the structure, clarity, evidence and career relevance of your CV.');
  assert.ok(h.storage.getItem(storageKey));
  h.element('scanAnotherButton').click();
  assert.equal(h.storage.getItem(storageKey), null);
  assert.equal(h.navigations().length, 1);
});

test('Improve my CV builds from the fresh saved scan, blocks duplicate requests and saves the response', async t => {
  const h = load(t);
  h.flush();
  const fresh = result();
  fresh.scanId = 12;
  h.storage.setItem(storageKey, JSON.stringify(fresh));
  const calls = [];
  let finishBuild;
  h.window.fetch = (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finishBuild = resolve; });
  };
  const button = h.element('improveCvButton');
  button.click();
  button.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, 1, 'Only one build can be requested at a time');
  assert.equal(calls[0].url, '/api/cv/build');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(new Headers(calls[0].options.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { scanId: 12 });
  assert.equal(button.disabled, true);
  assert.match(buttonLabel(button), /Preparing.*Lumia/i);
  assert.equal(h.storage.getItem(buildStorageKey), null);
  assert.equal(h.navigations().length, 0);
  h.restore();
  h.flush();
  button.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, 1, 'History restoration cannot duplicate a pending build');
  assert.equal(button.disabled, true);
  const built = buildResult();
  finishBuild(response(built));
  await settled();
  const saved = JSON.parse(h.storage.getItem(buildStorageKey));
  assert.equal(saved.buildId, built.buildId);
  assert.deepEqual(saved.structuredCv, built.structuredCv);
  assert.deepEqual(saved.suggestions, built.suggestions);
  assert.equal(saved.targetCareer, built.targetCareer);
  assert.equal(h.navigations().length, 1);
  assert.deepEqual(h.alerts, []);
});

test('starting a new scan cancels the old builder redirect and cannot disturb a newer pending build', async t => {
  for (const oldFails of [false, true]) {
    const h = load(t, result(), { dashboard: true });
    h.flush();
    const button = h.element('improveCvButton');
    const originalLabel = buttonLabel(button);
    const requests = [];
    h.window.fetch = (url, options) => new Promise((resolve, reject) => {
      requests.push({ options, resolve, reject });
    });
    button.click();
    assert.equal(button.disabled, true);
    h.element('scanAnotherButton').click();
    assert.equal(h.window.location.hash, '#cv-scanner');
    assert.equal(h.storage.getItem(storageKey), null);
    assert.equal(button.disabled, false);
    assert.equal(buttonLabel(button), originalLabel);

    const fresh = result();
    fresh.scanId = 12;
    h.storage.setItem(storageKey, JSON.stringify(fresh));
    h.window.location.hash = '#cv-results';
    h.window.dispatchEvent(new h.window.CustomEvent('careerkraft:dashboard-view', { detail: { view: 'cv-results' } }));
    button.click();
    assert.deepEqual(requests.map(item => JSON.parse(item.options.body).scanId), [4, 12]);
    if (oldFails) requests[0].reject(new Error('Old request failed'));
    else requests[0].resolve(response({ ...buildResult(), buildId: 100 }));
    await settled();
    assert.equal(button.disabled, true, 'An obsolete response cannot reset the newer pending action');
    assert.equal(h.storage.getItem(buildStorageKey), null);
    assert.equal(h.navigations().length, 0);
    assert.equal(h.window.location.hash, '#cv-results');
    assert.deepEqual(h.alerts, []);
    requests[1].resolve(response({ ...buildResult(), buildId: 101 }));
    await settled();
    assert.equal(JSON.parse(h.storage.getItem(buildStorageKey)).buildId, 101);
    assert.equal(h.navigations().length, 1);
  }
});

test('leaving CV results discards a build whose response body is still being read', async t => {
  const h = load(t, result(), { dashboard: true });
  h.flush();
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  let finishBody;
  h.window.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) });
  button.click();
  await settled();
  assert.equal(typeof finishBody, 'function');
  h.window.location.hash = '#skills';
  h.window.dispatchEvent(new h.window.CustomEvent('careerkraft:dashboard-view', { detail: { view: 'skills' } }));
  assert.equal(button.disabled, false);
  assert.equal(buttonLabel(button), originalLabel);
  finishBody(buildResult());
  await settled();
  assert.equal(h.window.location.hash, '#skills');
  assert.equal(h.storage.getItem(buildStorageKey), null);
  assert.equal(h.navigations().length, 0);
  assert.deepEqual(h.alerts, []);
});

test('a changed scan cache makes a pending build obsolete even without a view event', async t => {
  const h = load(t);
  h.flush();
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  let finishBuild;
  h.window.fetch = () => new Promise(resolve => { finishBuild = resolve; });
  button.click();
  const fresh = result();
  fresh.scanId = 12;
  h.storage.setItem(storageKey, JSON.stringify(fresh));
  finishBuild(response());
  await settled();
  assert.equal(button.disabled, false);
  assert.equal(buttonLabel(button), originalLabel);
  assert.equal(h.storage.getItem(buildStorageKey), null);
  assert.equal(h.navigations().length, 0);
  assert.deepEqual(h.alerts, []);
});

test('CV build request failures restore the action and never save or navigate to a stale build', async t => {
  const h = load(t);
  h.flush();
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  const failures = [
    async () => { throw new Error('Network unavailable'); },
    async () => response({ error: 'This scan could not be used.' }, false),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Not JSON'); } }),
    async () => response(null),
    async () => response({}),
    async () => response({ ...buildResult(), success: false }),
    async () => response({ ...buildResult(), buildId: 0 }),
    async () => response({ ...buildResult(), structuredCv: [] }),
    async () => response({ ...buildResult(), suggestions: 'invalid' })
  ];
  for (const fetchImpl of failures) {
    h.window.fetch = fetchImpl;
    const previousAlerts = h.alerts.length;
    button.click();
    await settled();
    assert.equal(button.disabled, false);
    assert.equal(buttonLabel(button), originalLabel);
    assert.equal(h.alerts.length, previousAlerts + 1);
    assert.equal(typeof h.alerts.at(-1), 'string');
    assert.ok(h.alerts.at(-1).trim());
    assert.equal(h.storage.getItem(buildStorageKey), null);
    assert.equal(h.navigations().length, 0);
  }
});

test('CV builder refuses missing or malformed cached scan IDs without contacting the API', async t => {
  const h = load(t);
  h.flush();
  let requests = 0;
  h.window.fetch = async () => { requests++; return response(); };
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  for (const saved of [null, '{not JSON}', 'null', '[]', '{}',
    JSON.stringify({ ...result(), scanId: 0 }), JSON.stringify({ ...result(), scanId: -1 }),
    JSON.stringify({ ...result(), scanId: 1.5 }), JSON.stringify({ ...result(), scanId: '4' })]) {
    if (saved === null) h.storage.removeItem(storageKey);
    else h.storage.setItem(storageKey, saved);
    const previousAlerts = h.alerts.length;
    button.click();
    await settled();
    assert.equal(requests, 0);
    assert.equal(button.disabled, false);
    assert.equal(buttonLabel(button), originalLabel);
    assert.equal(h.alerts.length, previousAlerts + 1);
    assert.equal(h.storage.getItem(buildStorageKey), null);
    assert.equal(h.navigations().length, 0);
  }
});

test('CV build storage failures restore the action without redirecting to an unsaved result', async t => {
  const h = load(t);
  h.flush();
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  t.mock.method(h.window.Storage.prototype, 'setItem', () => { throw new Error('Storage unavailable'); });
  button.click();
  await settled();
  assert.equal(button.disabled, false);
  assert.equal(buttonLabel(button), originalLabel);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.storage.getItem(buildStorageKey), null);
  assert.equal(h.navigations().length, 0);
});

test('CV builder handles unavailable scan storage without sending a request', async t => {
  const h = load(t);
  h.flush();
  let requests = 0;
  h.window.fetch = async () => { requests++; return response(); };
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  t.mock.method(h.window.Storage.prototype, 'getItem', () => { throw new Error('Storage unavailable'); });
  button.click();
  await settled();
  assert.equal(requests, 0);
  assert.equal(button.disabled, false);
  assert.equal(buttonLabel(button), originalLabel);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.navigations().length, 0);
});

test('restoring the completed builder action from browser history permits a new build', async t => {
  const h = load(t);
  h.flush();
  const button = h.element('improveCvButton');
  const originalLabel = buttonLabel(button);
  let requests = 0;
  h.window.fetch = async () => { requests++; return response(); };
  button.click();
  await settled();
  assert.equal(requests, 1);
  assert.equal(h.navigations().length, 1);
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide', { persisted: true }));
  h.restore();
  h.flush();
  assert.equal(button.disabled, false);
  assert.equal(buttonLabel(button), originalLabel);
  button.click();
  await settled();
  assert.equal(requests, 2);
  assert.equal(h.navigations().length, 2);
});

test('restoring CV results from browser history refreshes the cache without duplicate cards', t => {
  const h = load(t);
  h.flush();
  const updated = result();
  updated.scanId = 5;
  updated.targetCareer = 'Software Developer';
  updated.analysis.overallScore = 94;
  updated.analysis.strengths = ['Updated feedback'];
  updated.analysis.verifiedSkillsMissingFromCv = [];
  updated.analysis.bulletRewrites = [];
  h.storage.setItem(storageKey, JSON.stringify(updated));
  h.restore();
  h.flush();
  assert.equal(h.element('overallScore').textContent, '94');
  assert.equal(h.element('targetCareer').textContent, 'Software Developer');
  assert.equal(h.element('strengthsList').children.length, 1);
  assert.ok(h.element('strengthsList').textContent.includes('Updated feedback'));
  assert.equal(h.element('bulletRewritesList').children.length, 0);
  assert.equal(h.element('missingSkillsEmpty').classList.contains('hidden'), false);
  h.storage.removeItem(storageKey);
  h.restore();
  assert.equal(h.navigations().length, 1);
});

test('report metadata uses the actual CV filename and supplied date without inventing a scan date', t => {
  const value = result();
  const h = load(t, value);
  h.flush();
  assert.ok(h.element('cvReportMeta').textContent.includes(value.fileName));
  assert.match(h.element('cvReportMeta').textContent, /Lumia CV analysis/i);
  assert.doesNotMatch(h.element('cvReportMeta').textContent, /\b20\d{2}\b/);

  value.createdAt = Date.UTC(2026, 9, 30, 12);
  const dated = load(t, value);
  dated.flush();
  assert.ok(dated.element('cvReportMeta').textContent.includes(value.fileName));
  assert.match(dated.element('cvReportMeta').textContent, /2026/);
});

test('category captions respond to scores and verified skill cards only name supplied platform skills', t => {
  const high = result();
  const low = result();
  for (const category of ['structure', 'clarity', 'evidence', 'relevance']) {
    high.analysis.scores[category] = 90;
    low.analysis.scores[category] = 35;
  }
  const strong = load(t, high);
  const improving = load(t, low);
  strong.flush();
  improving.flush();
  for (const category of ['structure', 'clarity', 'evidence', 'relevance']) {
    const highCaption = strong.element(`${category}Caption`).textContent.trim();
    const lowCaption = improving.element(`${category}Caption`).textContent.trim();
    assert.ok(highCaption, `${category} has an explanatory caption`);
    assert.ok(lowCaption, `${category} has an explanatory caption at low scores`);
    assert.notEqual(highCaption, lowCaption, `${category} feedback reflects its score`);
  }
  assert.deepEqual([...strong.element('missingSkillsList').querySelectorAll('.skill-name')]
    .map(item => item.textContent), high.analysis.verifiedSkillsMissingFromCv);
  for (const chip of strong.element('missingSkillsList').children) {
    assert.equal(chip.querySelector('.skill-verification-label').textContent, 'Verified on CareerKraft');
    assert.doesNotMatch(chip.textContent, /\d+\s+(?:verifications?|activities?|projects?)/i);
  }
});

test('rewrite controls show one real suggestion at a time and respect both navigation bounds', t => {
  const value = result();
  value.analysis.bulletRewrites.push({ original: 'I planned a project.', improved: 'Planned a project.', reason: 'Use direct wording.' });
  const h = load(t, value);
  h.flush();
  const previous = h.element('previousRewriteButton');
  const next = h.element('nextRewriteButton');
  const position = () => h.element('rewritePosition').textContent.replace(/\s/g, '');
  const visible = () => [...h.element('bulletRewritesList').querySelectorAll('.rewrite-card')].filter(card => !card.hidden);
  assert.equal(h.element('bulletRewritesList').children.length, 3);
  assert.equal(visible().length, 1);
  assert.ok(visible()[0].textContent.includes(value.analysis.bulletRewrites[0].original));
  assert.equal(position(), '1/3');
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, false);
  next.click();
  assert.equal(position(), '2/3');
  assert.equal(visible().length, 1);
  assert.ok(visible()[0].textContent.includes(value.analysis.bulletRewrites[1].original));
  next.click();
  assert.equal(position(), '3/3');
  assert.equal(next.disabled, true);
  next.click();
  assert.equal(position(), '3/3');
  previous.click();
  previous.click();
  assert.equal(position(), '1/3');
  assert.equal(previous.disabled, true);

  value.analysis.bulletRewrites = [value.analysis.bulletRewrites[2]];
  h.storage.setItem(storageKey, JSON.stringify(value));
  h.restore();
  h.flush();
  assert.equal(position(), '1/1');
  assert.equal(visible().length, 1);
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
});

test('Download report opens the native print dialog without changing or clearing the saved scan', t => {
  const value = result();
  const h = load(t, value);
  h.flush();
  h.element('downloadReportButton').click();
  assert.equal(h.printCalls(), 1);
  assert.deepEqual(JSON.parse(h.storage.getItem(storageKey)), value);
  assert.equal(h.navigations().length, 0);
});

test('skill verification counts appear only for matching positive integer platform metadata', t => {
  const value = result();
  value.verifiedSkills = [
    { name: ' ＲＥＳＥＡＲＣＨ ', verifiedCount: 2 },
    { name: 'network analysis', verifiedCount: 1 },
    { name: 'Unlisted skill', verifiedCount: 99 }
  ];
  const h = load(t, value);
  h.flush();
  const labels = () => [...h.element('missingSkillsList').querySelectorAll('.skill-verification-label')]
    .map(item => item.textContent);
  assert.deepEqual(labels(), ['Verified 2 times', 'Verified 1 time']);
  assert.deepEqual([...h.element('missingSkillsList').querySelectorAll('.skill-name')]
    .map(item => item.textContent), value.analysis.verifiedSkillsMissingFromCv);
  for (const metadata of [
    [{ name: 'Different skill', verifiedCount: 99 }],
    [{ name: 'Research', verifiedCount: 0 }, { name: 'Network Analysis', verifiedCount: -2 }],
    [{ name: 'Research', verifiedCount: '3' }, { name: 'Network Analysis', verifiedCount: 1.5 }],
    [{ name: 'Research', verifiedCount: Number.MAX_SAFE_INTEGER + 1 }, null, false],
    null
  ]) {
    value.verifiedSkills = metadata;
    h.storage.setItem(storageKey, JSON.stringify(value));
    h.restore();
    h.flush();
    assert.deepEqual(labels(), ['Verified on CareerKraft', 'Verified on CareerKraft']);
  }
});
