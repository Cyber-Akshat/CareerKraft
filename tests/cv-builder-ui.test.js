const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const storageKey = 'careerkraft-cv-build';
const finalKey = 'careerkraft-final-cv';
const sourceBullet = 'I built a dashboard using Python.';
const improvedBullet = 'Built a dashboard using Python.';
const settled = () => new Promise(resolve => setImmediate(resolve));
const response = (value = { success: true }, ok = true) => ({ ok, json: async () => value });
const fixture = () => ({
  success: true, buildId: 17, targetCareer: 'Software Developer',
  structuredCv: {
    name: 'Alex Morgan', headline: 'Computing student', contact: ['alex@example.test'],
    profile: 'I am a computing student.', education: ['BSc Computer Science.'], experience: [],
    projects: [sourceBullet, 'Documented the interface.'], skills: ['Python'], certifications: []
  },
  suggestions: [
    { id: 101, sectionName: 'Projects', suggestionType: 'strengthen_project', originalText: sourceBullet,
      suggestedText: improvedBullet, reason: 'Start with the action.', evidence: [sourceBullet],
      status: 'pending', finalText: null, sortOrder: 1 },
    { id: 102, sectionName: 'Skills', suggestionType: 'add_verified_skill', originalText: '',
      suggestedText: 'Research', reason: 'Include a verified CareerKraft skill.', evidence: ['Research'],
      status: 'pending', finalText: null, sortOrder: 2 },
    { id: 103, sectionName: 'Profile', suggestionType: 'improve_profile', originalText: 'I am a computing student.',
      suggestedText: 'A computing student.', reason: 'Use a concise introduction.', evidence: ['I am a computing student.'],
      status: 'pending', finalText: null, sortOrder: 3 }
  ]
});

function load(t, saved = fixture(), { query = '?build=17', storageError = false, reducedMotion = true, fetch } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(readFileSync(path.join(root, 'cv-builder.html'), 'utf8'), {
    url: `http://localhost:3000/cv-builder.html${query}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  t.after(() => window.close());
  const storage = window.sessionStorage;
  if (saved !== null) storage.setItem(storageKey, typeof saved === 'string' ? saved : JSON.stringify(saved));
  if (storageError) Object.defineProperty(window, 'sessionStorage', {
    configurable: true, get() { throw new window.DOMException('Storage unavailable', 'SecurityError'); }
  });
  const calls = [];
  const alerts = [];
  const confirms = [];
  const scrolls = [];
  let confirmValue = true;
  window.structuredClone = structuredClone;
  window.matchMedia = () => ({ matches: reducedMotion });
  window.HTMLElement.prototype.scrollIntoView = function(options) { scrolls.push({ element: this, options }); };
  window.scrollTo = () => {};
  window.alert = value => alerts.push(value);
  window.confirm = value => { confirms.push(value); return confirmValue; };
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    return fetch ? fetch(url, options) : response();
  };
  assert.doesNotThrow(() => window.eval(readFileSync(path.join(root, 'cv-builder-ui.js'), 'utf8')));
  const doc = window.document;
  return {
    window, document: doc, storage, calls, alerts, confirms, scrolls,
    element: id => doc.getElementById(id),
    cached: () => JSON.parse(storage.getItem(storageKey)),
    section: field => doc.querySelector(`.cv-section[data-section="${field}"]`),
    navigations: () => errors.filter(error => /navigation/i.test(error.message)),
    confirm: value => { confirmValue = value; },
    restore() { window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })); }
  };
}

async function click(h, id) {
  h.element(id).click();
  await settled();
  await settled();
}

function assertReviewed(h, { accepted = 0, edited = 0, rejected = 0, total = 3 } = {}) {
  assert.equal(h.element('acceptedCount').textContent, String(accepted));
  assert.equal(h.element('editedCount').textContent, String(edited));
  assert.equal(h.element('rejectedCount').textContent, String(rejected));
  const percentage = total ? Math.round((accepted + edited + rejected) / total * 100) : 100;
  assert.equal(h.element('suggestionProgressFill').style.width, `${percentage}%`);
  assert.equal(h.document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), String(percentage));
}

test('CV Builder loads the cached original CV, highlights the current section and leaves absent sections empty', t => {
  const h = load(t);
  assert.equal(h.element('cvName').textContent, 'Alex Morgan');
  assert.equal(h.element('cvHeadline').textContent, 'Computing student');
  assert.equal(h.element('cvContact').textContent, 'alex@example.test');
  assert.equal(h.element('cvProfile').textContent, 'I am a computing student.');
  assert.match(h.element('cvProjects').textContent, /I built a dashboard using Python\./);
  assert.equal(h.section('experience').hidden, true);
  assert.equal(h.section('certifications').hidden, true);
  assert.equal(h.section('projects').classList.contains('lumia-highlight'), true);
  assert.equal(h.element('originalText').textContent, sourceBullet);
  assert.equal(h.element('suggestedText').textContent, improvedBullet);
  assert.equal(h.element('evidenceChips').textContent, sourceBullet);
  assert.equal(h.element('previousSuggestionButton').disabled, true);
  assert.equal(h.element('nextSuggestionButton').disabled, false);
  assert.equal(h.element('editArea').hidden, true);
  assert.equal(h.element('decisionState').hidden, true);
  assertReviewed(h);
  assert.equal(h.calls.length, 0);
});

test('CV Builder treats CV, suggestions and evidence as literal text instead of executable HTML', t => {
  const value = fixture();
  const hostile = '<img src=x onerror="window.__injected=1"><script>window.__injected=1</script>';
  value.structuredCv.name = hostile;
  value.structuredCv.contact = [hostile];
  value.structuredCv.projects = [hostile];
  value.suggestions[0].originalText = hostile;
  value.suggestions[0].suggestedText = hostile;
  value.suggestions[0].reason = hostile;
  value.suggestions[0].evidence = [hostile];
  const h = load(t, value);
  assert.equal(h.element('cvName').textContent, hostile);
  assert.equal(h.element('originalText').textContent, hostile);
  assert.equal(h.element('evidenceChips').textContent, hostile);
  assert.equal(h.element('cvDocument').querySelector('img,script'), null);
  assert.equal(h.element('suggestedText').querySelector('img,script'), null);
  assert.equal(h.window.__injected, undefined);
});

test('missing, corrupt, mismatched and inaccessible builder cache redirects safely without calling the API', t => {
  for (const value of [null, 'not JSON', 'null', '[]', '{}', { ...fixture(), buildId: 0 },
    { ...fixture(), structuredCv: null }, { ...fixture(), suggestions: {} },
    { ...fixture(), structuredCv: { ...fixture().structuredCv, projects: [{ text: sourceBullet }] } }]) {
    const h = load(t, value);
    assert.ok(h.navigations().length > 0);
    assert.equal(h.calls.length, 0);
  }
  for (const query of ['?build=18', '?build=0', '?build=bad', '?build=17&build=18']) {
    const h = load(t, fixture(), { query });
    assert.ok(h.navigations().length > 0);
    assert.equal(h.calls.length, 0);
  }
  const unavailable = load(t, fixture(), { storageError: true });
  assert.ok(unavailable.navigations().length > 0);
  assert.equal(unavailable.calls.length, 0);
});

test('duplicate persisted suggestion IDs and unknown review statuses reject the cached queue safely', t => {
  for (const alter of [
    value => { value.suggestions[1].id = value.suggestions[0].id; },
    value => { value.suggestions[0].status = 'applying'; },
    value => { value.suggestions[0].status = 'accepted'; value.suggestions[0].finalText = null; }
  ]) {
    const value = fixture();
    alter(value);
    const h = load(t, value);
    assert.ok(h.navigations().length > 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.element('finishButton').disabled, true);
  }
});

test('an accepted rewrite changes only its section after the server confirms and persists the decision before advancing', async t => {
  let resolve;
  const value = fixture();
  value.structuredCv.experience = [sourceBullet];
  const h = load(t, value, { fetch: () => new Promise(done => { resolve = done; }) });
  const before = h.storage.getItem(storageKey);
  h.element('acceptButton').click();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/cv/build/17/suggestions/101');
  assert.equal(h.calls[0].options.method, 'PATCH');
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { status: 'accepted', finalText: improvedBullet });
  assert.equal(h.storage.getItem(storageKey), before);
  assert.match(h.element('cvProjects').textContent, /I built/);
  assertReviewed(h);
  resolve(response());
  await settled();
  await settled();
  assert.equal(h.cached().structuredCv.projects[0], improvedBullet);
  assert.equal(h.cached().structuredCv.experience[0], sourceBullet);
  assert.equal(h.cached().suggestions[0].status, 'accepted');
  assert.equal(h.cached().suggestions[0].finalText, improvedBullet);
  assert.equal(h.element('suggestionCounter').textContent, '2 / 3');
  assert.equal(h.section('skills').classList.contains('lumia-highlight'), true);
  assertReviewed(h, { accepted: 1 });
});

test('a saved decision adopts the authoritative CV and other decisions instead of overwriting concurrent progress', async t => {
  const serverBuild = fixture();
  serverBuild.structuredCv.projects[0] = improvedBullet;
  serverBuild.structuredCv.skills.push('Research');
  Object.assign(serverBuild.suggestions[0], { status: 'accepted', finalText: improvedBullet });
  Object.assign(serverBuild.suggestions[1], { status: 'accepted', finalText: 'Research' });
  serverBuild.suggestions = [serverBuild.suggestions[1], serverBuild.suggestions[0], serverBuild.suggestions[2]];
  const h = load(t, fixture(), { fetch: async () => response({
    success: true, buildId: 17, suggestion: { id: 101, status: 'accepted', finalText: improvedBullet },
    structuredCv: serverBuild.structuredCv, suggestions: serverBuild.suggestions, buildStatus: 'reviewing',
    progress: { accepted: 2, edited: 0, rejected: 0, pending: 1, reviewed: 2 }
  }) });
  await click(h, 'acceptButton');
  assert.deepEqual(h.cached().structuredCv, serverBuild.structuredCv);
  assert.deepEqual(h.cached().suggestions, serverBuild.suggestions);
  assert.deepEqual(h.cached().structuredCv.skills, ['Python', 'Research']);
  assert.equal(h.cached().buildStatus, 'reviewing');
  assertReviewed(h, { accepted: 2 });
  assert.equal(h.element('suggestionCounter').textContent, '3 / 3');
  assert.equal(h.section('profile').classList.contains('lumia-highlight'), true);
  assert.equal(h.alerts.length, 0);
});

test('partial or inconsistent authoritative review responses never mutate the displayed or cached build', async t => {
  const valid = () => {
    const value = fixture();
    value.structuredCv.projects[0] = improvedBullet;
    Object.assign(value.suggestions[0], { status: 'accepted', finalText: improvedBullet });
    return { success: true, buildId: 17,
      suggestion: { id: 101, status: 'accepted', finalText: improvedBullet },
      structuredCv: value.structuredCv, suggestions: value.suggestions, buildStatus: 'reviewing' };
  };
  for (const alter of [
    value => { value.buildId = 18; },
    value => { value.buildId = '17'; },
    value => { value.suggestion.id = 102; },
    value => { value.suggestion.status = 'rejected'; },
    value => { value.suggestion.finalText = 'Unexpected wording.'; },
    value => { value.suggestion = null; },
    value => { delete value.structuredCv; },
    value => { delete value.suggestions; },
    value => { value.structuredCv = null; },
    value => { value.structuredCv.projects = [{}]; },
    value => { value.suggestions = value.suggestions.slice(1); },
    value => { value.suggestions[0].status = 'pending'; value.suggestions[0].finalText = null; },
    value => { value.suggestions[0].finalText = 'Unexpected stored wording.'; },
    value => { value.suggestions[1].id = value.suggestions[0].id; },
    value => { delete value.suggestions[1].id; },
    value => { value.buildStatus = 'unknown'; }
  ]) {
    const body = valid();
    alter(body);
    const h = load(t, fixture(), { fetch: async () => response(body) });
    const before = h.storage.getItem(storageKey);
    await click(h, 'acceptButton');
    assert.equal(h.calls.length, 1);
    assert.equal(h.storage.getItem(storageKey), before);
    assert.match(h.element('cvProjects').textContent, /I built a dashboard/);
    assertReviewed(h);
    assert.equal(h.element('acceptButton').disabled, false);
    assert.ok(h.alerts.length > 0);
  }
});

test('a decision acknowledgement without a full snapshot still must match the requested record and text', async t => {
  for (const ack of [
    { id: 102, status: 'accepted', finalText: improvedBullet },
    { id: 101, status: 'edited', finalText: improvedBullet },
    { id: 101, status: 'accepted', finalText: 'Wrong text.' }
  ]) {
    const h = load(t, fixture(), { fetch: async () => response({ success: true, suggestion: ack }) });
    const before = h.storage.getItem(storageKey);
    await click(h, 'acceptButton');
    assert.equal(h.storage.getItem(storageKey), before);
    assertReviewed(h);
  }
  const h = load(t, fixture(), { fetch: async () => response({ success: true,
    suggestion: { id: 101, status: 'accepted', finalText: improvedBullet } }) });
  await click(h, 'acceptButton');
  assert.equal(h.cached().structuredCv.projects[0], improvedBullet);
  assertReviewed(h, { accepted: 1 });
});

test('a pending save blocks duplicate and competing decisions, editing, navigation and finishing', async t => {
  let resolve;
  const h = load(t, fixture(), { fetch: () => new Promise(done => { resolve = done; }) });
  h.element('acceptButton').click();
  for (const id of ['acceptButton','rejectButton','editButton','nextSuggestionButton','previousSuggestionButton','finishButton']) {
    h.element(id).dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  }
  assert.equal(h.calls.length, 1);
  assert.equal(h.element('suggestionCounter').textContent, '1 / 3');
  assert.equal(h.element('editArea').hidden, true);
  assert.equal(h.storage.getItem(finalKey), null);
  assert.equal(h.navigations().length, 0);
  resolve(response());
  await settled();
  await settled();
  assert.equal(h.calls.length, 1);
  assertReviewed(h, { accepted: 1 });
});

test('failed, malformed and declined save responses leave the original CV, cache and counters unchanged', async t => {
  for (const fetch of [
    async () => { throw new Error('Network unavailable'); },
    async () => response({ error: 'Could not save this decision.' }, false),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Not JSON'); } }),
    async () => response({ success: false }), async () => response(null)
  ]) {
    const h = load(t, fixture(), { fetch });
    const before = h.storage.getItem(storageKey);
    await click(h, 'acceptButton');
    assert.equal(h.storage.getItem(storageKey), before);
    assert.match(h.element('cvProjects').textContent, /I built a dashboard/);
    assertReviewed(h);
    assert.equal(h.element('acceptButton').disabled, false);
    assert.equal(h.element('nextSuggestionButton').disabled, false);
    assert.equal(h.navigations().length, 0);
  }
});

test('a confirmed server decision stays confirmed in memory when browser persistence fails and cannot be saved twice', async t => {
  const h = load(t);
  const before = h.storage.getItem(storageKey);
  const setItem = h.window.Storage.prototype.setItem;
  h.window.Storage.prototype.setItem = function(key, value) {
    if (key === storageKey) throw new h.window.DOMException('Storage quota exceeded', 'QuotaExceededError');
    return setItem.call(this, key, value);
  };
  await click(h, 'acceptButton');
  assert.equal(h.calls.length, 1);
  assert.equal(h.storage.getItem(storageKey), before, 'The browser cache did not falsely appear persisted');
  assert.match(h.element('cvProjects').textContent, /Built a dashboard using Python\./);
  assert.doesNotMatch(h.element('cvProjects').textContent, /I built/);
  assertReviewed(h, { accepted: 1 });
  assert.ok(h.alerts.some(message => /decision was saved/i.test(message) && /reload/i.test(message)));
  await click(h, 'previousSuggestionButton');
  assert.equal(h.element('decisionState').classList.contains('accepted'), true);
  h.element('acceptButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(h.calls.length, 1);
});

test('missing suggestion IDs and ambiguous, absent or partial source targets never send a destructive request', async t => {
  const cases = [
    value => { delete value.suggestions[0].id; },
    value => { value.suggestions[0].id = 'undefined'; },
    value => { value.structuredCv.projects.push(sourceBullet); },
    value => { value.structuredCv.projects = ['Another project.']; },
    value => { value.structuredCv.projects = [`Before. ${sourceBullet} After.`]; },
    value => { value.suggestions[0].sectionName = 'Projects"] [data-section="skills'; }
  ];
  for (const alter of cases) {
    const value = fixture();
    alter(value);
    const h = load(t, value);
    const before = h.storage.getItem(storageKey);
    await click(h, 'acceptButton');
    assert.equal(h.calls.length, 0);
    assert.equal(h.storage.getItem(storageKey), before);
    assertReviewed(h);
  }
});

test('Edit and Cancel synchronize native hidden state, focus the input and leave the CV unchanged', async t => {
  const h = load(t);
  const before = h.storage.getItem(storageKey);
  await click(h, 'editButton');
  assert.equal(h.element('editArea').hidden, false);
  assert.equal(h.element('editArea').classList.contains('hidden'), false);
  assert.equal(h.element('suggestionActions').hidden, true);
  assert.equal(h.element('editSuggestionInput').value, improvedBullet);
  assert.equal(h.document.activeElement, h.element('editSuggestionInput'));
  h.element('editSuggestionInput').value = 'Changed but cancelled.';
  await click(h, 'cancelEditButton');
  assert.equal(h.element('editArea').hidden, true);
  assert.equal(h.element('suggestionActions').hidden, false);
  assert.equal(h.storage.getItem(storageKey), before);
  assert.equal(h.calls.length, 0);
});

test('opening Edit cancels a pending highlight scroll so the focused editor stays in view', async t => {
  const h = load(t);
  await click(h, 'editButton');
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(h.scrolls.length, 0);
  assert.equal(h.element('editArea').hidden, false);
  assert.equal(h.document.activeElement, h.element('editSuggestionInput'));
});

test('edits reject blank text and apply the exact student text without replacement-token interpretation', async t => {
  const h = load(t);
  await click(h, 'editButton');
  h.element('editSuggestionInput').value = ' \n ';
  await click(h, 'saveEditButton');
  assert.equal(h.calls.length, 0);
  assert.equal(h.element('editArea').hidden, false);
  const edited = "Built a dashboard using Python ($& and $').";
  h.element('editSuggestionInput').value = edited;
  await click(h, 'saveEditButton');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { status: 'edited', finalText: edited });
  assert.equal(h.cached().structuredCv.projects[0], edited);
  assert.equal(h.cached().suggestions[0].status, 'edited');
  assert.equal(h.cached().suggestions[0].finalText, edited);
  assertReviewed(h, { edited: 1 });
});

test('rejecting a suggestion retains original content and pending navigation wraps around earlier skipped suggestions', async t => {
  const h = load(t);
  await click(h, 'nextSuggestionButton');
  assert.equal(h.element('suggestionCounter').textContent, '2 / 3');
  await click(h, 'rejectButton');
  assert.equal(h.cached().suggestions[1].status, 'rejected');
  assert.deepEqual(h.cached().structuredCv.skills, ['Python']);
  assert.equal(h.element('suggestionCounter').textContent, '3 / 3');
  await click(h, 'rejectButton');
  assert.equal(h.element('suggestionCounter').textContent, '1 / 3');
  await click(h, 'rejectButton');
  assertReviewed(h, { rejected: 3 });
  assert.equal(h.document.querySelector('.lumia-highlight'), null);
  assert.equal(h.element('suggestionActions').hidden, true);
  assert.equal(h.element('decisionState').hidden, false);
  assert.match(h.element('decisionState').textContent, /reviewed|rejected|complete/i);
});

test('accepting a verified skill addition inserts it once and refreshing the cached build never applies it again', async t => {
  const value = fixture();
  value.suggestions = [value.suggestions[1]];
  const h = load(t, value);
  await click(h, 'acceptButton');
  assert.deepEqual(h.cached().structuredCv.skills, ['Python', 'Research']);
  assertReviewed(h, { accepted: 1, total: 1 });
  const restored = load(t, h.cached());
  assert.equal(restored.element('cvSkills').textContent.match(/Research/g)?.length, 1);
  assert.deepEqual(restored.cached().structuredCv.skills, ['Python', 'Research']);
  assertReviewed(restored, { accepted: 1, total: 1 });
  assert.equal(restored.calls.length, 0);
  assert.equal(restored.element('suggestionActions').hidden, true);
});

test('previous/next show saved decision states without permitting a second save', async t => {
  const h = load(t);
  await click(h, 'acceptButton');
  await click(h, 'previousSuggestionButton');
  assert.equal(h.element('suggestionCounter').textContent, '1 / 3');
  assert.equal(h.element('decisionState').hidden, false);
  assert.equal(h.element('decisionState').classList.contains('accepted'), true);
  assert.equal(h.element('suggestionActions').hidden, true);
  h.element('acceptButton').dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(h.calls.length, 1);
});

test('name, headline and contact suggestions highlight the header and mutate only the named field', async t => {
  for (const [field, original, replacement] of [
    ['Name', 'Alex Morgan', 'ALEX MORGAN'], ['Headline', 'Computing student', 'Computing Student'],
    ['Contact', 'alex@example.test', 'Alex@example.test']
  ]) {
    const value = fixture();
    value.suggestions = [{ ...value.suggestions[0], sectionName: field, originalText: original, suggestedText: replacement }];
    const h = load(t, value);
    assert.equal(h.document.querySelector('.cv-header').classList.contains('lumia-highlight'), true);
    await click(h, 'acceptButton');
    const expected = structuredClone(value.structuredCv);
    expected[field.toLowerCase()] = field === 'Contact' ? [replacement] : replacement;
    assert.deepEqual(h.cached().structuredCv, expected);
  }
});

test('a build with no suggestions renders a complete empty review state with safe navigation bounds', t => {
  const value = fixture();
  value.suggestions = [];
  const h = load(t, value);
  assert.equal(h.element('suggestionCounter').textContent, '0 / 0');
  assert.equal(h.element('previousSuggestionButton').disabled, true);
  assert.equal(h.element('nextSuggestionButton').disabled, true);
  assert.equal(h.element('suggestionActions').hidden, true);
  assert.equal(h.element('evidenceCard').hidden, true);
  assertReviewed(h, { total: 0 });
  assert.equal(h.calls.length, 0);
});

test('finishing confirms unreviewed suggestions and exports only the current approved CV snapshot', async t => {
  const h = load(t);
  h.confirm(false);
  await click(h, 'finishButton');
  assert.equal(h.confirms.length, 1);
  assert.equal(h.storage.getItem(finalKey), null);
  assert.equal(h.navigations().length, 0);
  h.confirm(true);
  await click(h, 'finishButton');
  const final = JSON.parse(h.storage.getItem(finalKey));
  assert.equal(final.buildId, 17);
  assert.deepEqual(final.structuredCv, fixture().structuredCv);
  assert.ok(h.navigations().length > 0);
  assert.equal(h.calls.length, 0);
});

test('a final CV storage failure keeps the review open without navigating to an unavailable snapshot', async t => {
  const h = load(t);
  const before = h.storage.getItem(storageKey);
  const setItem = h.window.Storage.prototype.setItem;
  h.window.Storage.prototype.setItem = function(key, value) {
    if (key === finalKey) throw new h.window.DOMException('Storage quota exceeded', 'QuotaExceededError');
    return setItem.call(this, key, value);
  };
  await click(h, 'finishButton');
  assert.equal(h.storage.getItem(finalKey), null);
  assert.equal(h.storage.getItem(storageKey), before);
  assert.equal(h.navigations().length, 0);
  assert.ok(h.alerts.length > 0);
  assert.equal(h.element('finishButton').disabled, false);
});

test('a pending decision cannot update an obsolete page after pagehide, even when fetch ignores cancellation', async t => {
  let resolve;
  const h = load(t, fixture(), { fetch: () => new Promise(done => { resolve = done; }) });
  const before = h.storage.getItem(storageKey);
  h.element('acceptButton').click();
  h.window.dispatchEvent(new h.window.PageTransitionEvent('pagehide', { persisted: true }));
  resolve(response());
  await settled();
  await settled();
  assert.equal(h.storage.getItem(storageKey), before);
  assert.match(h.element('cvProjects').textContent, /I built/);
  assertReviewed(h);
  h.restore();
  assert.equal(h.element('acceptButton').disabled, false);
});

test('section scrolling respects a reduced-motion preference', async t => {
  const h = load(t, fixture(), { reducedMotion: true });
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.ok(h.scrolls.length > 0);
  assert.ok(h.scrolls.every(scroll => scroll.options?.behavior !== 'smooth'));
});
