const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const FINAL_KEY = 'careerkraft-final-cv';
const BUILD_KEY = 'careerkraft-cv-build';
const SCAN_KEY = 'careerkraft-cv-scan-result';
const fields = ['name', 'headline', 'contact', 'profile', 'education', 'experience', 'projects', 'skills', 'certifications'];
const sections = ['profile', 'education', 'experience', 'projects', 'skills', 'certifications'];
const finalCv = () => ({
  buildId: 17,
  structuredCv: {
    name: 'Alex Morgan', headline: 'Computing student', contact: ['alex@example.test', 'github.com/alex'],
    profile: 'A computing student exploring software development.', education: ['BSc Computer Science.'],
    experience: ['Documented student project requirements.'], projects: ['Built a dashboard using Python.'],
    skills: ['Python', 'Research'], certifications: ['Introduction to programming.']
  }
});
const build = (final = finalCv()) => ({
  success: true, buildId: 17, targetCareer: 'Software Developer',
  structuredCv: structuredClone(final.structuredCv),
  suggestions: [
    { id: 101, status: 'accepted' }, { id: 102, status: 'edited' }, { id: 103, status: 'rejected' }
  ]
});

function load(t, saved = finalCv(), options = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const query = options.query === undefined ? '?build=17' : options.query;
  const dom = new JSDOM(readFileSync(path.join(root, 'cv-preview.html'), 'utf8'), {
    url: `http://localhost:3000/cv-preview.html${query}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  t.after(() => window.close());
  const storage = window.sessionStorage;
  const metadata = Object.hasOwn(options, 'build') ? options.build : build(saved && typeof saved === 'object' && saved.structuredCv ? saved : finalCv());
  if (saved !== null) storage.setItem(FINAL_KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  if (metadata !== null) storage.setItem(BUILD_KEY, typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
  storage.setItem(SCAN_KEY, JSON.stringify({ scanId: 4 }));
  const originalGet = window.Storage.prototype.getItem;
  const originalRemove = window.Storage.prototype.removeItem;
  if (options.buildStorageError) window.Storage.prototype.getItem = function(key) {
    if (key === BUILD_KEY) throw new window.DOMException('Unavailable metadata', 'SecurityError');
    return originalGet.call(this, key);
  };
  if (options.removeError) window.Storage.prototype.removeItem = function(key) {
    if (key === (options.removeError === true ? SCAN_KEY : options.removeError)) throw new window.DOMException('Cannot remove cache', 'SecurityError');
    return originalRemove.call(this, key);
  };
  if (options.storageError) Object.defineProperty(window, 'sessionStorage', {
    configurable: true, get() { throw new window.DOMException('Storage unavailable', 'SecurityError'); }
  });
  const alerts = [];
  const requests = [];
  const navigations = [];
  let printCalls = 0;
  window.console.error = () => {};
  window.alert = message => alerts.push(message);
  window.print = () => { printCalls++; };
  window.fetch = (...args) => { requests.push(args); throw new Error('Preview should not send a network request.'); };
  // JSDOM does not navigate to a different document. Observe the location
  // boundary while keeping its DOM, storage and events intact for the script.
  const initialUrl = new URL(window.location.href);
  const navigate = value => navigations.push(new URL(value, initialUrl).href);
  const location = {
    get href() { return initialUrl.href; }, set href(value) { navigate(value); },
    get search() { return initialUrl.search; }, get hash() { return initialUrl.hash; },
    get pathname() { return initialUrl.pathname; }, get origin() { return initialUrl.origin; },
    assign: navigate, replace: navigate
  };
  const browser = new Proxy(window, { get(target, key) {
    if (key === 'location') return location;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  window.__previewTestWindow = browser;
  assert.doesNotThrow(() => window.eval(`((window) => {\n${readFileSync(path.join(root, 'cv-preview.js'), 'utf8')}\n})(globalThis.__previewTestWindow);`));
  delete window.__previewTestWindow;
  return {
    window, document: window.document, storage, alerts, requests, navigations, errors,
    element: id => window.document.getElementById(id), printCalls: () => printCalls,
    restore() { window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })); }
  };
}

function assertNoPrint(h) {
  h.element('downloadButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  h.element('printButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  assert.equal(h.printCalls(), 0);
}

test('final CV preview renders all source sections and matching review totals without changing saved data', t => {
  const value = finalCv();
  const metadata = build(value);
  const h = load(t, value, { build: metadata });
  assert.equal(h.element('cvName').textContent, value.structuredCv.name);
  assert.equal(h.element('cvHeadline').textContent, value.structuredCv.headline);
  for (const field of sections) {
    const id = `cv${field[0].toUpperCase()}${field.slice(1)}`;
    const source = value.structuredCv[field];
    for (const text of Array.isArray(source) ? source : [source]) assert.ok(h.element(id).textContent.includes(text), field);
    assert.equal(h.element(`${field}Section`).hidden, false);
  }
  assert.equal(h.element('cvContact').children.length, 2);
  assert.equal(h.element('acceptedTotal').textContent, '1');
  assert.equal(h.element('editedTotal').textContent, '1');
  assert.equal(h.element('rejectedTotal').textContent, '1');
  assert.equal(h.element('targetCareer').textContent, 'Software Developer');
  assert.match(h.element('completionLabel').textContent, /review complete/i);
  assert.equal(h.element('downloadButton').disabled, false);
  assert.equal(h.element('printButton').disabled, false);
  assert.doesNotMatch(h.element('downloadButton').title, /coming soon/i);
  assert.deepEqual(JSON.parse(h.storage.getItem(FINAL_KEY)), value);
  assert.deepEqual(JSON.parse(h.storage.getItem(BUILD_KEY)), metadata);
  assert.equal(h.requests.length, 0);
  assert.equal(h.navigations.length, 0);
});

test('preview renders simple structured entries and numeric source values without coercing nested objects', t => {
  const value = finalCv();
  value.structuredCv.contact = [{ email: 'alex@example.test', phone: 1234567890 }];
  value.structuredCv.education = [{ qualification: 'BSc Computer Science', year: 2025 }];
  value.structuredCv.projects = [{ title: 'Network traffic project', bullets: ['Mapped endpoints.', 'Reviewed requirements.'] }];
  const h = load(t, value);
  assert.match(h.element('cvContact').textContent, /alex@example\.test/);
  assert.match(h.element('cvContact').textContent, /1234567890/);
  assert.match(h.element('cvEducation').textContent, /2025/);
  assert.equal(h.element('cvProjects').querySelectorAll('li').length, 2);
  assert.doesNotMatch(h.element('cvDocument').textContent, /\[object Object\]|undefined|null/);
  assert.equal(h.navigations.length, 0);
});

test('empty and whitespace-only CV sections are hidden without adding placeholder claims', t => {
  const value = finalCv();
  value.structuredCv.profile = ' \n ';
  value.structuredCv.education = [' ', '\n'];
  value.structuredCv.experience = [];
  value.structuredCv.projects = [{}, { title: '', bullets: [] }];
  value.structuredCv.skills = [];
  value.structuredCv.certifications = [];
  value.structuredCv.headline = '';
  value.structuredCv.contact = [' ', {}];
  const h = load(t, value);
  for (const field of sections) assert.equal(h.element(`${field}Section`).hidden, true, field);
  assert.doesNotMatch(h.element('cvDocument').textContent, /No content added|No profile added/);
  assert.equal(h.element('cvContact').children.length, 0);
  assert.equal(h.navigations.length, 0);
});

test('CV, contact, review and target-career markup is rendered as literal text', t => {
  const value = finalCv();
  const hostile = '<img src=x onerror="window.__previewInjected=1"><script>window.__previewInjected=1</script>';
  value.structuredCv.name = hostile;
  value.structuredCv.profile = hostile;
  value.structuredCv.contact = [{ email: hostile }];
  value.structuredCv.projects = [{ title: hostile, bullets: [hostile] }];
  const metadata = build(value);
  metadata.targetCareer = hostile;
  const h = load(t, value, { build: metadata });
  assert.equal(h.element('cvName').textContent, hostile);
  assert.ok(h.element('cvProjects').textContent.includes(hostile));
  assert.equal(h.element('targetCareer').textContent, hostile);
  assert.equal(h.element('cvDocument').querySelector('img,script'), null);
  assert.equal(h.element('targetCareer').querySelector('img,script'), null);
  assert.equal(h.window.__previewInjected, undefined);
});

test('missing, malformed and structurally invalid final CV data redirects without enabling printing', t => {
  const invalid = [null, 'not JSON', 'null', '[]', '{}', { ...finalCv(), buildId: 0 },
    { ...finalCv(), buildId: -1 }, { ...finalCv(), buildId: '17' }, { ...finalCv(), buildId: 1.5 },
    { ...finalCv(), buildId: Number.MAX_SAFE_INTEGER + 1 }, { buildId: 17, structuredCv: null },
    { buildId: 17, structuredCv: [] }, { buildId: 17, structuredCv: {} },
    { ...finalCv(), structuredCv: { ...finalCv().structuredCv, profile: {} } },
    { ...finalCv(), structuredCv: { ...finalCv().structuredCv, projects: 'Not an array' } },
    { ...finalCv(), structuredCv: { ...finalCv().structuredCv, name: 'x'.repeat(256) } },
    { ...finalCv(), structuredCv: { ...finalCv().structuredCv, profile: 'x'.repeat(20001) } }];
  for (const value of invalid) {
    const h = load(t, value);
    assert.ok(h.navigations.some(url => url.endsWith('/cv-scanner.html')));
    assertNoPrint(h);
    assert.equal(h.requests.length, 0);
  }
});

test('preview validates its build URL against the finished snapshot and permits a missing query', t => {
  for (const query of ['?build=18', '?build=0', '?build=bad', '?build=17&build=18', '?build=17&build=17']) {
    const h = load(t, finalCv(), { query });
    assert.ok(h.navigations.some(url => url.endsWith('/cv-scanner.html')), query);
    assertNoPrint(h);
  }
  const h = load(t, finalCv(), { query: '' });
  assert.equal(h.element('cvName').textContent, 'Alex Morgan');
  assert.equal(h.navigations.length, 0);
});

test('optional missing, corrupt or unrelated build metadata cannot lend its career or review counts to the preview', t => {
  const unrelated = build();
  unrelated.buildId = 18;
  unrelated.targetCareer = 'Unrelated career';
  unrelated.suggestions = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, status: 'accepted' }));
  for (const metadata of [null, 'not JSON', 'null', '[]', {}, unrelated,
    { ...build(), suggestions: null }, { ...build(), suggestions: [null] },
    { ...build(), suggestions: [{ status: 'invented-status' }] }]) {
    const h = load(t, finalCv(), { build: metadata });
    assert.equal(h.element('cvName').textContent, 'Alex Morgan');
    assert.notEqual(h.element('acceptedTotal').textContent, '7');
    assert.doesNotMatch(h.element('targetCareer').textContent, /Unrelated career/);
    assert.doesNotMatch(h.element('completionLabel').textContent, /review complete/i);
    assert.equal(h.element('downloadButton').disabled, false);
    assert.equal(h.navigations.length, 0);
  }
});

test('a newer current build cannot label an older final snapshot with its review history', t => {
  const metadata = build();
  metadata.structuredCv.profile = 'A newer profile that has not been finished.';
  metadata.suggestions = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, status: 'accepted' }));
  const h = load(t, finalCv(), { build: metadata });
  assert.equal(h.element('cvProfile').textContent, finalCv().structuredCv.profile);
  assert.notEqual(h.element('acceptedTotal').textContent, '7');
  assert.doesNotMatch(h.element('completionLabel').textContent, /review complete/i);
  assert.equal(h.navigations.length, 0);
});

test('Finish-anyway previews show pending review truthfully while retaining only the saved final CV', t => {
  const metadata = build();
  metadata.suggestions.push({ id: 104, status: 'pending' }, { id: 105, status: 'pending' });
  const h = load(t, finalCv(), { build: metadata });
  assert.equal(h.element('acceptedTotal').textContent, '1');
  assert.equal(h.element('editedTotal').textContent, '1');
  assert.equal(h.element('rejectedTotal').textContent, '1');
  assert.doesNotMatch(h.element('completionLabel').textContent, /review complete/i);
  assert.match(h.document.querySelector('.completion-banner').textContent, /2|pending|remaining|left/i);
  assert.equal(h.element('cvProfile').textContent, finalCv().structuredCv.profile);
});

test('a valid build with zero suggestions shows zero totals and remains printable', t => {
  const metadata = build();
  metadata.suggestions = [];
  const h = load(t, finalCv(), { build: metadata });
  for (const id of ['acceptedTotal', 'editedTotal', 'rejectedTotal']) assert.equal(h.element(id).textContent, '0');
  assert.equal(h.element('downloadButton').disabled, false);
  assert.equal(h.element('printButton').disabled, false);
  assert.equal(h.navigations.length, 0);
});

test('Download CV and Print preview each open browser print without changing CV workflow data', t => {
  const h = load(t);
  const before = [FINAL_KEY, BUILD_KEY, SCAN_KEY].map(key => h.storage.getItem(key));
  h.element('downloadButton').click();
  h.element('printButton').click();
  assert.equal(h.printCalls(), 2);
  assert.deepEqual([FINAL_KEY, BUILD_KEY, SCAN_KEY].map(key => h.storage.getItem(key)), before);
  assert.equal(h.requests.length, 0);
  assert.equal(h.navigations.length, 0);
});

test('printing cannot reuse a removed or mismatched final CV cache', t => {
  for (const replace of [null, { ...finalCv(), buildId: 18 }]) {
    const h = load(t);
    if (replace === null) h.storage.removeItem(FINAL_KEY);
    else h.storage.setItem(FINAL_KEY, JSON.stringify(replace));
    assertNoPrint(h);
    assert.ok(h.navigations.some(url => url.endsWith('/cv-scanner.html')));
  }
});

test('native browser printing refreshes the saved snapshot and never prints a removed stale CV', t => {
  const h = load(t);
  const next = finalCv();
  next.structuredCv.projects = ['Latest CV version for printing.'];
  h.storage.setItem(FINAL_KEY, JSON.stringify(next));
  h.storage.setItem(BUILD_KEY, JSON.stringify(build(next)));
  h.window.dispatchEvent(new h.window.Event('beforeprint'));
  assert.equal(h.element('cvProjects').textContent, 'Latest CV version for printing.');
  assert.equal(h.printCalls(), 0, 'The browser print event must not recursively open another dialog');
  h.storage.removeItem(FINAL_KEY);
  h.window.dispatchEvent(new h.window.Event('beforeprint'));
  assert.equal(h.element('cvDocument').hidden, true);
  assert.equal(h.element('cvProjects').textContent, '');
  assert.equal(h.navigations.length, 0, 'Native print validation does not navigate while the dialog is opening');
});

test('Back to Builder preserves the actual finished build ID even without matching summary metadata', t => {
  const h = load(t, finalCv(), { build: { ...build(), buildId: 18 } });
  h.element('backToBuilderButton').click();
  assert.equal(h.navigations.at(-1), 'http://localhost:3000/cv-builder.html?build=17');
});

test('Scan another CV clears only the three CV workflow keys and preserves session and user preferences', t => {
  const h = load(t);
  const unrelated = { 'auth-state': 'signed-in-fixture', 'careerkraft-theme': 'dark', 'other-workflow': 'keep' };
  for (const [key, value] of Object.entries(unrelated)) h.storage.setItem(key, value);
  h.window.localStorage.setItem('careerkraft-accessibility', JSON.stringify({ fontSize: 'large' }));
  h.element('scanAnotherButton').click();
  for (const key of [FINAL_KEY, BUILD_KEY, SCAN_KEY]) assert.equal(h.storage.getItem(key), null);
  for (const [key, value] of Object.entries(unrelated)) assert.equal(h.storage.getItem(key), value);
  assert.equal(h.window.localStorage.getItem('careerkraft-accessibility'), JSON.stringify({ fontSize: 'large' }));
  assert.equal(h.navigations.at(-1), 'http://localhost:3000/cv-scanner.html');
});

test('a failed CV cache reset keeps the preview open and does not clear unrelated browser state', t => {
  const h = load(t, finalCv(), { removeError: true });
  const originalFinal = h.storage.getItem(FINAL_KEY);
  h.storage.setItem('auth-state', 'signed-in-fixture');
  h.element('scanAnotherButton').click();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.storage.getItem(FINAL_KEY), originalFinal);
  assert.equal(h.storage.getItem('auth-state'), 'signed-in-fixture');
  assert.ok(h.alerts.length > 0);
});

test('a partially failed CV reset restores the workflow entries it already removed', t => {
  const h = load(t, finalCv(), { removeError: BUILD_KEY });
  const before = [SCAN_KEY, BUILD_KEY, FINAL_KEY].map(key => h.storage.getItem(key));
  h.element('scanAnotherButton').click();
  assert.deepEqual([SCAN_KEY, BUILD_KEY, FINAL_KEY].map(key => h.storage.getItem(key)), before);
  assert.equal(h.navigations.length, 0);
  assert.ok(h.alerts.length > 0);
});

test('Practise with Lumia uses the existing dashboard companion without sending CV content or messages', t => {
  const h = load(t);
  const before = h.storage.getItem(FINAL_KEY);
  h.element('practiceButton').click();
  assert.equal(h.navigations.at(-1), 'http://localhost:3000/dashboard.html#lumia');
  assert.equal(h.storage.getItem(FINAL_KEY), before);
  assert.equal(h.requests.length, 0);
});

test('browser-history restoration reloads current saved CV and matching summary without duplicate sections or handlers', t => {
  const h = load(t);
  const next = finalCv();
  next.structuredCv.projects = ['A newly finished project version.'];
  const metadata = build(next);
  metadata.targetCareer = 'Research Analyst';
  metadata.suggestions = [{ id: 201, status: 'edited' }];
  h.storage.setItem(FINAL_KEY, JSON.stringify(next));
  h.storage.setItem(BUILD_KEY, JSON.stringify(metadata));
  h.restore();
  h.restore();
  assert.equal(h.element('cvProjects').textContent, 'A newly finished project version.');
  assert.equal(h.element('cvProjects').children.length, 1);
  assert.equal(h.element('targetCareer').textContent, 'Research Analyst');
  assert.equal(h.element('acceptedTotal').textContent, '0');
  assert.equal(h.element('editedTotal').textContent, '1');
  h.element('printButton').click();
  assert.equal(h.printCalls(), 1);
  assert.equal(h.requests.length, 0);
});

test('restoring a preview after its CV workflow was cleared cannot print the stale document', t => {
  const h = load(t);
  for (const key of [FINAL_KEY, BUILD_KEY, SCAN_KEY]) h.storage.removeItem(key);
  h.restore();
  assertNoPrint(h);
  assert.ok(h.navigations.some(url => url.endsWith('/cv-scanner.html')));
});

test('unavailable essential browser storage redirects safely while unavailable optional metadata still permits preview', t => {
  const unavailable = load(t, finalCv(), { storageError: true });
  assert.ok(unavailable.navigations.some(url => url.endsWith('/cv-scanner.html')));
  assertNoPrint(unavailable);
  const metadataUnavailable = load(t, finalCv(), { buildStorageError: true });
  assert.equal(metadataUnavailable.element('cvName').textContent, 'Alex Morgan');
  assert.equal(metadataUnavailable.element('downloadButton').disabled, false);
  assert.doesNotMatch(metadataUnavailable.element('completionLabel').textContent, /review complete/i);
  assert.equal(metadataUnavailable.navigations.length, 0);
});
