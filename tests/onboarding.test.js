const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../onboarding.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../onboarding.js'), 'utf8');

function load(auth) {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/onboarding.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.scrollTo = () => {};
  window.careerAuth = auth;
  const timers = [];
  window.setTimeout = callback => { timers.push(callback); return timers.length; };
  window.clearTimeout = () => {};
  window.eval(script);
  return { dom, document: window.document, timers };
}

test('onboarding completes all questions, validates choices, supports back, retake and theme', async t => {
  const { dom, document, timers } = load({
    getSession: async () => ({ data: { session: { user: { email: 'tester@example.com', display_name: 'Tester' } } } }),
    request: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null })
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => setImmediate(resolve));
  const active = () => Number(document.querySelector('.onboarding-screen.active').dataset.screen);
  assert.equal(active(), 0);
  document.querySelector('[data-screen="0"] [data-next]').click();
  assert.equal(active(), 1);
  document.querySelector('[data-screen="1"] [data-next]').click();
  assert.equal(active(), 1);
  assert.match(document.querySelector('[data-screen="1"] .selection-hint').textContent, /at least 2/);
  for (let step = 1; step <= 4; step++) {
    const screen = document.querySelector(`[data-screen="${step}"]`);
    const grid = screen.querySelector('[data-question]');
    const cards = grid.querySelectorAll('.choice-card');
    for (let i = 0; i < Number(grid.dataset.min); i++) cards[i].click();
    assert.equal(cards[0].getAttribute('aria-pressed'), 'true');
    if (step === 4) {
      cards[1].click(); cards[2].click(); cards[3].click();
      assert.equal(grid.querySelectorAll('.selected').length, 3);
      screen.querySelector('#analyse-button').click();
    } else {
      screen.querySelector('[data-next]').click();
    }
    assert.equal(active(), step === 4 ? 5 : step + 1);
  }
  while (timers.length) {
    timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(active(), 6);
  assert.equal(document.querySelector('#progress-bar-fill').style.width, '100%');
  document.querySelector('#retake-button').click();
  assert.equal(active(), 1);
  document.querySelector('[data-screen="1"] [data-back]').click();
  assert.equal(active(), 0);
  const theme = document.documentElement.dataset.theme;
  document.querySelector('#onboarding-theme-toggle').click();
  assert.notEqual(document.documentElement.dataset.theme, theme);
});

test('missing auth or a rejected session request does not break onboarding buttons', async t => {
  for (const auth of [undefined, { getSession: async () => { throw new Error('Offline'); } }]) {
    const { dom, document } = load(auth);
    t.after(() => dom.window.close());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('#onboarding-session-message').hidden, false);
    document.querySelector('[data-screen="0"] [data-next]').click();
    assert.equal(document.querySelector('.onboarding-screen.active').dataset.screen, '1');
    document.querySelector('#onboarding-theme-toggle').click();
    assert.equal(document.documentElement.dataset.theme, 'light');
  }
});

test('failed assessment save preserves answers and offers a retry without showing unsaved results', async t => {
  const { dom, document, timers } = load({
    getSession: async () => ({ data: { session: { user: { email: 'tester@example.com', display_name: 'Tester' } } } }),
    request: async endpoint => endpoint === 'assessments'
      ? { data: {}, error: { message: 'Database unavailable.' } }
      : { data: {}, error: null },
    signOut: async () => ({ error: null })
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => setImmediate(resolve));

  for (let step = 1; step <= 4; step++) {
    const screen = document.querySelector(`[data-screen="${step}"]`);
    const grid = screen.querySelector('[data-question]');
    const cards = grid.querySelectorAll('.choice-card');
    for (let i = 0; i < Number(grid.dataset.min); i++) cards[i].click();
    if (step < 4) screen.querySelector('[data-next]').click();
  }

  document.querySelector('#analyse-button').click();
  await new Promise(resolve => setImmediate(resolve));
  while (timers.length) {
    timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(Number(document.querySelector('.onboarding-screen.active').dataset.screen), 4);
  assert.equal(document.querySelectorAll('.career-result-card').length, 0);
  assert.match(document.querySelector('#onboarding-session-message').textContent, /Database unavailable/);
  assert.equal(document.querySelector('#analyse-button').disabled, false);
  assert.ok(document.querySelector('[data-screen="1"] .choice-card.selected'));
});

test('returning to My matches restores saved suggestions without restarting or resaving the quiz', async t => {
  const requests = [];
  const { dom, document } = load({
    getSession: async () => ({ data: { session: { user: { display_name: 'Tester' } } } }),
    request: async (endpoint, body) => {
      requests.push({ endpoint, body });
      return endpoint === 'assessment'
        ? { data: { matches: [{ id: 'teacher', title: 'Teacher', category: 'Education', score: 91, reasons: ['Helping people'] }] }, error: null }
        : { data: {}, error: null };
    }
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelector('.onboarding-screen.active').dataset.screen, '6');
  assert.equal(document.title, 'Your career matches | CareerKraft');
  assert.equal(document.querySelectorAll('.career-result-card').length, 1);
  assert.match(document.querySelector('.career-result-card').textContent, /Teacher/);
  assert.equal(document.querySelector('.career-select-button').dataset.careerId, 'teacher');
  assert.equal(requests.some(request => request.endpoint === 'assessments'), false);
  document.querySelector('#retake-button').click();
  assert.equal(document.querySelector('.onboarding-screen.active').dataset.screen, '1');
  assert.equal(document.title, 'Build your career profile | CareerKraft');
});

test('an empty career match response explains how to retry and preserves the answers', async t => {
  const { dom, document, timers } = load({
    getSession: async () => ({ data: { session: { user: { name: 'Alex' } } } }),
    request: async endpoint => ({ data: endpoint === 'assessments' ? { matches: [] } : {} })
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => setImmediate(resolve));
  for (let number = 1; number <= 4; number++) {
    const screen = document.querySelector(`[data-screen="${number}"]`);
    const grid = screen.querySelector('[data-question]');
    [...grid.querySelectorAll('.choice-card')].slice(0, Number(grid.dataset.min)).forEach(card => card.click());
  }
  document.querySelector('#analyse-button').click();
  while (timers.length) {
    timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(document.querySelector('.onboarding-screen.active').dataset.screen, '6');
  assert.match(document.querySelector('#career-results [role="status"]').textContent, /Change your answers.*try again/);
  document.querySelector('#retake-button').click();
  assert.equal(document.querySelector('.onboarding-screen.active').dataset.screen, '1');
  assert.equal(document.querySelectorAll('[data-screen="1"] .choice-card.selected').length, 2);
});
