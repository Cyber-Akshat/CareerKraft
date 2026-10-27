const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const authClient = readFileSync(path.join(root, 'auth-api.js'), 'utf8');
const siteClient = readFileSync(path.join(root, 'site.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function visible(element) {
  return Boolean(element && !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.style.display !== 'none');
}

function page(t, { site = true, fetch, readyState = 'complete' } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><button id="existing-control">Existing control</button></main></body></html>', {
    url: 'https://careerkraft.example/dashboard.html',
    runScripts: 'outside-only',
    virtualConsole
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = 1_792_584_000_000;
  let nextId = 0;
  const timers = new Map();
  const revealed = [];
  Object.defineProperty(window.document, 'readyState', { configurable: true, get: () => readyState });
  window.Date.now = () => now;
  window.setTimeout = (callback, delay = 0) => {
    const id = ++nextId;
    timers.set(id, { callback, time: now + Number(delay) });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  window.fetch = fetch || (() => { throw new Error('Unexpected network request'); });
  window.localStorage.setItem('careerkraft-cookie-consent', JSON.stringify({ version: 1, choice: 'rejected', savedAt: now }));

  const status = () => window.document.querySelector('.career-loading');
  function advance(duration) {
    const target = now + duration;
    let iterations = 0;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.time <= target).sort((a, b) => a[1].time - b[1].time)[0];
      if (!due) break;
      assert.ok(++iterations < 1000, 'Controlled browser timers settle');
      now = due[1].time;
      timers.delete(due[0]);
      due[1].callback();
      if (visible(status())) revealed.push(now);
    }
    now = target;
  }
  function loadSite() {
    window.eval(siteClient);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  window.eval(authClient);
  if (site) loadSite();
  return { window, document: window.document, advance, status, loadSite, errors, revealed };
}

test('slow work shows an accessible loading status without moving focus or blocking the page', t => {
  const browser = page(t);
  const { window, document, advance, status } = browser;
  document.getElementById('existing-control').focus();
  const finish = window.careerLoading.begin('Saving your changes…');
  advance(100);
  assert.ok(!visible(status()), 'A short wait does not flash the indicator');
  advance(100);
  assert.ok(visible(status()));
  assert.equal(status().getAttribute('role'), 'status');
  assert.equal(status().getAttribute('aria-live'), 'polite');
  assert.ok(status().textContent.includes('Saving your changes…'));
  assert.equal(new URL(status().querySelector('img').src).pathname, '/ripples.svg');
  assert.equal(status().querySelector('img').alt, '', 'The adjacent status text names the decorative spinner');
  assert.equal(document.activeElement.id, 'existing-control');
  assert.equal(status().getAttribute('aria-modal'), null);
  assert.equal(document.body.getAttribute('aria-busy'), null, 'Unrelated page content stays available');
  finish();
  advance(1000);
  assert.ok(!visible(status()));
  assert.deepEqual(browser.errors, []);
});

test('fast work finishes before the reveal delay and never flashes a loading card', t => {
  const { window, advance, status, revealed } = page(t);
  const finish = window.careerLoading.begin('Saving…');
  advance(50);
  finish();
  advance(2000);
  assert.ok(!visible(status()));
  assert.deepEqual(revealed, []);
});

test('overlapping work remains visible until every operation finishes, including duplicate cleanup', t => {
  const { window, advance, status } = page(t);
  const first = window.careerLoading.begin('Loading profile…');
  advance(50);
  const second = window.careerLoading.begin('Loading resources…');
  advance(200);
  assert.ok(visible(status()));
  first();
  first();
  advance(1000);
  assert.ok(visible(status()), 'Repeated cleanup cannot finish another operation');
  second();
  advance(1000);
  assert.ok(!visible(status()));
  const next = window.careerLoading.begin('Saving…');
  advance(200);
  assert.ok(visible(status()), 'A subsequent operation can reuse the same indicator');
  assert.equal(window.document.querySelectorAll('.career-loading').length, 1);
  next();
});

test('an API request started before the shared script stays loading through response parsing', async t => {
  const response = deferred();
  const json = deferred();
  const browser = page(t, { site: false, fetch: () => response.promise });
  const request = browser.window.careerAuth.request('session');
  assert.equal(browser.window.careerAuth.pendingRequests.size, 1);
  browser.loadSite();
  browser.advance(200);
  assert.ok(visible(browser.status()), 'Deferred shared scripts discover work already in progress');
  response.resolve({ ok: true, json: () => json.promise });
  await Promise.resolve();
  browser.advance(1000);
  assert.ok(visible(browser.status()), 'Receiving headers does not finish reading the response');
  json.resolve({ session: null });
  const result = await request;
  assert.equal(result.error, null);
  assert.equal(browser.window.careerAuth.pendingRequests.size, 0);
  browser.advance(1000);
  assert.ok(!visible(browser.status()));
});

test('a fast API request that finishes before the shared script loads does not leave stale loading work', async t => {
  const browser = page(t, { site: false, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  await browser.window.careerAuth.request('session');
  assert.equal(browser.window.careerAuth.pendingRequests.size, 0);
  browser.loadSite();
  browser.advance(2000);
  assert.ok(!visible(browser.status()));
  assert.deepEqual(browser.revealed, []);
});

for (const failure of ['HTTP error', 'network rejection', 'invalid JSON']) {
  test(`${failure} clears its request while another pending request keeps the logo visible`, async t => {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const browser = page(t, { fetch: () => (++call === 1 ? first.promise : second.promise) });
    const events = [];
    browser.document.addEventListener('career:loading-change', () => events.push(browser.window.careerAuth.pendingRequests.size));
    const failed = browser.window.careerAuth.request('session');
    const successful = browser.window.careerAuth.request('profile');
    browser.advance(200);
    assert.ok(visible(browser.status()));
    if (failure === 'network rejection') first.reject(new Error('Connection closed'));
    else first.resolve({ ok: failure !== 'HTTP error', json: failure === 'invalid JSON' ? async () => { throw new SyntaxError('Invalid response'); } : async () => ({ error: 'Try again.' }) });
    assert.ok((await failed).error);
    assert.equal(browser.window.careerAuth.pendingRequests.size, 1);
    browser.advance(1000);
    assert.ok(visible(browser.status()));
    second.resolve({ ok: true, json: async () => ({ success: true }) });
    assert.equal((await successful).error, null);
    assert.equal(browser.window.careerAuth.pendingRequests.size, 0);
    browser.advance(1000);
    assert.ok(!visible(browser.status()));
    assert.deepEqual(events, [1, 2, 1, 0], 'Subscribers receive each start and finish');
    assert.deepEqual(browser.errors, []);
  });
}

test('leaving a page hides stale work and restoring it recovers requests still in flight', async t => {
  const response = deferred();
  const browser = page(t, { fetch: () => response.promise });
  const request = browser.window.careerAuth.request('session');
  browser.advance(200);
  assert.ok(visible(browser.status()));
  browser.window.dispatchEvent(new browser.window.Event('pagehide'));
  assert.ok(!visible(browser.status()));
  browser.advance(1000);
  assert.ok(!visible(browser.status()), 'A hidden page has no reveal timer left behind');
  browser.window.dispatchEvent(new browser.window.Event('pageshow'));
  browser.advance(200);
  assert.ok(visible(browser.status()), 'A restored page reflects an unfinished request');
  response.resolve({ ok: true, json: async () => ({}) });
  await request;
  browser.advance(1000);
  assert.ok(!visible(browser.status()));
});

test('the initial page load releases its indicator after the load event', t => {
  const browser = page(t, { readyState: 'loading' });
  browser.advance(200);
  assert.ok(visible(browser.status()));
  browser.window.dispatchEvent(new browser.window.Event('load'));
  browser.advance(1000);
  assert.ok(!visible(browser.status()));
});

test('the spinner respects both system and saved reduced-motion preferences', t => {
  const { document } = page(t);
  const style = document.createElement('style');
  style.textContent = readFileSync(path.join(root, 'site.css'), 'utf8');
  document.head.append(style);
  const rules = [...style.sheet.cssRules];
  const systemRules = rules
    .filter(rule => rule.conditionText?.includes('prefers-reduced-motion: reduce'))
    .flatMap(rule => [...rule.cssRules])
    .filter(rule => rule.selectorText?.includes('.career-loading'));
  const savedRules = rules.filter(rule => rule.selectorText?.includes('[data-reduced-motion="true"]') && rule.selectorText.includes('.career-loading'));
  for (const [source, matches] of [['system', systemRules], ['saved account', savedRules]]) {
    assert.ok(matches.length, `The ${source} preference covers the loading indicator`);
    assert.ok(matches.some(rule => rule.selectorText.includes('img') && rule.style.getPropertyValue('display') === 'none'), `The ${source} preference hides the SVG's independent animation`);
    assert.ok(matches.some(rule => rule.selectorText.includes('.career-loading-static') && ['block', 'inline-block', 'grid', 'flex'].includes(rule.style.getPropertyValue('display'))), `The ${source} preference displays a static loading mark`);
  }
  assert.ok(document.querySelector('.career-loading-static'), 'A static mark remains available when animation is disabled');
});
