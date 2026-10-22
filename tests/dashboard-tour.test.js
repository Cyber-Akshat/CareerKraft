const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const scriptPath = path.join(__dirname, '..', 'dashboard-tour.js');
const savedKey = id => `careerkraft-dashboard-tour:${id}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
const fixture = `<!doctype html><html><body>
  <button id="existing-control">Existing control</button>
  <button id="dashboard-tour-launch" disabled>Take a tour</button>
  <main aria-busy="false">
    <section class="career-dashboard-hero"><h1>Your career dashboard</h1></section>
    <section id="roadmap"><div class="section-heading-row"><h2>Your roadmap</h2></div></section>
    <button id="start-next-step-button">Start next activity</button>
    <a id="career-explore-button" href="careers.html">Explore careers</a>
    <a id="skills-nav-link" href="#skills">Skills</a>
    <button id="lumia-launcher">Ask Lumia</button>
    <a class="profile-avatar" href="settings.html">Account</a>
  </main>
  <section class="cookie-banner" hidden><button id="cookie-dismiss">Reject optional</button></section>
  <div id="level-transition-overlay" class="level-transition-overlay" hidden aria-hidden="true"></div>
</body></html>`;

function setup(t, { html = fixture, saved = {}, cookieVisible = false, reducedMotion = false, storageBlocked = false, request } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/dashboard.html#roadmap', runScripts: 'outside-only', virtualConsole
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const state = { calls: [], scrolls: [], scrollX: 0, scrollY: 220 };
  Object.defineProperties(window, {
    innerWidth: { value: 1280, configurable: true },
    innerHeight: { value: 800, configurable: true },
    scrollX: { get: () => state.scrollX },
    scrollY: { get: () => state.scrollY }
  });
  window.scrollTo = (first, second) => {
    state.scrolls.push({ method: 'scrollTo', first, second });
    state.scrollX = typeof first === 'object' ? first.left || 0 : first;
    state.scrollY = typeof first === 'object' ? first.top || 0 : second;
  };
  window.matchMedia = query => ({ matches: reducedMotion && query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(window.performance.now()), 0);
  window.cancelAnimationFrame = window.clearTimeout.bind(window);
  window.HTMLElement.prototype.scrollIntoView = function(options) {
    state.scrolls.push({ method: 'scrollIntoView', target: this.id || this.className, options });
  };
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    const hidden = this.closest('[hidden], [aria-hidden="true"]') || this.style.display === 'none';
    const width = hidden ? 0 : this.id === 'dashboard-tour' ? 360 : 240;
    const height = hidden ? 0 : this.id === 'dashboard-tour' ? 270 : 80;
    return { x: 80, y: 100, left: 80, top: 100, right: 80 + width, bottom: 100 + height, width, height, toJSON() {} };
  };
  window.HTMLElement.prototype.getClientRects = function() {
    return this.getBoundingClientRect().width ? [this.getBoundingClientRect()] : [];
  };
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  for (const [key, value] of Object.entries(saved)) window.localStorage.setItem(key, value);
  if (storageBlocked) Object.defineProperty(window, 'localStorage', {
    get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); }
  });
  window.careerAuth = { request: async (endpoint, body) => {
    state.calls.push({ endpoint, body: body && JSON.parse(JSON.stringify(body)) });
    return request ? request(endpoint, body) : { data: { success: true } };
  } };
  document.querySelector('.cookie-banner').hidden = !cookieVisible;
  document.querySelector('#cookie-dismiss').addEventListener('click', () => {
    document.querySelector('.cookie-banner').hidden = true;
  });
  window.eval(readFileSync(scriptPath, 'utf8'));
  const page = {
    window, document, state, errors,
    dialog: () => document.querySelector('#dashboard-tour'),
    open: () => Boolean(document.querySelector('#dashboard-tour')?.open),
    button: id => document.getElementById(`dashboard-tour-${id}`),
    async ready(user = { id: 41, dashboardTourSeen: false }, hasRoadmap = true) {
      window.dispatchEvent(new window.CustomEvent('careerkraft:dashboard-ready', { detail: { user, hasRoadmap } }));
      await settle();
    },
    async click(id) {
      const button = document.getElementById(`dashboard-tour-${id}`);
      assert.ok(button, `Tour provides a ${id} control`);
      button.click();
      await settle();
    }
  };
  return page;
}

function progress(page) {
  return page.dialog()?.textContent.match(/Step\s+(\d+)\s+of\s+(\d+)/i)?.slice(1).map(Number);
}

function namedText(document, element, attribute) {
  return (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
}

test('the first authenticated dashboard opens one named, described tour after dashboard readiness', async t => {
  const page = setup(t);
  await settle();
  assert.equal(page.open(), false, 'Loading the script alone does not interrupt the page');
  await page.ready();
  assert.equal(page.open(), true);
  assert.equal(page.document.querySelectorAll('#dashboard-tour').length, 1);
  assert.ok(namedText(page.document, page.dialog(), 'aria-labelledby'), 'The dialog has an accessible title');
  assert.ok(namedText(page.document, page.dialog(), 'aria-describedby'), 'The dialog has explanatory text');
  assert.deepEqual(progress(page), [1, 6]);
  assert.equal(page.state.calls.length, 0, 'Viewing the tour does not mark it seen');
  await page.ready();
  assert.equal(page.document.querySelectorAll('#dashboard-tour').length, 1);
  assert.deepEqual(progress(page), [1, 6], 'A repeated ready event does not restart the active tour');
  assert.equal(page.state.calls.length, 0);
});

test('loading, failed authentication and legacy users without an explicit first-visit flag never open a tour', async t => {
  for (const user of [null, {}, { id: 0, dashboardTourSeen: false }, { id: -1, dashboardTourSeen: false },
    { id: 41 }, { id: 41, dashboardTourSeen: true }, { id: 41, dashboardTourSeen: 'false' }]) {
    const page = setup(t);
    await page.ready(user);
    assert.equal(page.open(), false, `No automatic tour for ${JSON.stringify(user)}`);
    assert.deepEqual(page.state.calls, []);
  }
});

test('a first visit waits for cookie choice and then opens once', async t => {
  const page = setup(t, { cookieVisible: true });
  await page.ready();
  assert.equal(page.open(), false);
  assert.deepEqual(page.state.calls, []);
  page.document.querySelector('#cookie-dismiss').click();
  await settle();
  assert.equal(page.open(), true);
  assert.deepEqual(progress(page), [1, 6]);
});

test('another modal, roadmap level transition or Lumia builder defers the tour until it closes', async t => {
  for (const kind of ['dialog', 'transition', 'builder']) {
    const page = setup(t);
    let blocker;
    if (kind === 'dialog') {
      blocker = page.document.createElement('dialog');
      blocker.open = true;
      page.document.body.append(blocker);
    } else if (kind === 'transition') {
      blocker = page.document.getElementById('level-transition-overlay');
      blocker.hidden = false;
      blocker.setAttribute('aria-hidden', 'false');
    } else {
      blocker = page.document.createElement('div');
      blocker.className = 'lumia-builder-overlay';
      page.document.body.append(blocker);
    }
    await page.ready();
    assert.equal(page.open(), false, kind);
    if (kind === 'dialog') blocker.close();
    else if (kind === 'transition') { blocker.hidden = true; blocker.setAttribute('aria-hidden', 'true'); }
    else blocker.remove();
    await settle();
    assert.equal(page.open(), true, `Tour resumes after ${kind}`);
  }
});

test('forward and backward navigation explain all dashboard areas and only Finish records completion', async t => {
  const page = setup(t);
  await page.ready();
  assert.equal(page.button('back').disabled || page.button('back').hidden, true);
  const firstTitle = namedText(page.document, page.dialog(), 'aria-labelledby');
  await page.click('next');
  assert.deepEqual(progress(page), [2, 6]);
  assert.notEqual(namedText(page.document, page.dialog(), 'aria-labelledby'), firstTitle);
  await page.click('back');
  assert.deepEqual(progress(page), [1, 6]);
  assert.equal(namedText(page.document, page.dialog(), 'aria-labelledby'), firstTitle);
  for (let step = 2; step <= 6; step++) {
    await page.click('next');
    assert.deepEqual(progress(page), [step, 6]);
    assert.equal(page.state.calls.length, 0, 'Navigation does not save before finishing');
  }
  assert.equal(page.button('next').textContent.trim(), 'Finish tour');
  await page.click('next');
  assert.equal(page.open(), false);
  assert.equal(page.window.localStorage.getItem(savedKey(41)), 'seen');
  assert.deepEqual(page.state.calls, [{ endpoint: 'settings/dashboard-tour', body: { status: 'completed' } }]);
});

for (const action of ['skip', 'close', 'escape']) {
  test(`${action} dismisses the tour, remembers the account, and prevents another automatic opening`, async t => {
    const page = setup(t);
    await page.ready();
    if (action === 'escape') {
      page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
    } else await page.click(action);
    assert.equal(page.open(), false);
    assert.equal(page.window.localStorage.getItem(savedKey(41)), 'seen');
    assert.deepEqual(page.state.calls, [{ endpoint: 'settings/dashboard-tour', body: { status: 'skipped' } }]);
    await page.ready();
    assert.equal(page.open(), false);
    assert.equal(page.state.calls.length, 1, 'Repeated ready events do not save again');
  });
}

test('seen state belongs to an account and survives a later page load', async t => {
  const saved = { [savedKey(41)]: 'seen' };
  const returning = setup(t, { saved });
  await returning.ready();
  assert.equal(returning.open(), false);
  const otherAccount = setup(t, { saved });
  await otherAccount.ready({ id: 42, dashboardTourSeen: false });
  assert.equal(otherAccount.open(), true, 'A second account receives its own introduction');
  await otherAccount.click('skip');
  assert.equal(otherAccount.window.localStorage.getItem(savedKey(41)), 'seen');
  assert.equal(otherAccount.window.localStorage.getItem(savedKey(42)), 'seen');
  const serverSeen = setup(t);
  await serverSeen.ready({ id: 43, dashboardTourSeen: true });
  assert.equal(serverSeen.open(), false, 'Server state also prevents repetition on another device');
  assert.equal(serverSeen.state.calls.length, 0);
});

test('a locally dismissed tour retries account persistence once when a later dashboard still reports unseen', async t => {
  const page = setup(t, { saved: { [savedKey(41)]: 'seen' } });
  await page.ready();
  assert.equal(page.open(), false);
  assert.equal(page.state.calls.length, 1);
  assert.equal(page.state.calls[0].endpoint, 'settings/dashboard-tour');
  assert.equal(page.state.calls[0].body.status, 'skipped');
  await page.ready();
  assert.equal(page.state.calls.length, 1);
});

test('the explicit tour button replays a seen account and returns keyboard focus to that button', async t => {
  const page = setup(t);
  await page.ready({ id: 41, dashboardTourSeen: true });
  const launch = page.document.getElementById('dashboard-tour-launch');
  assert.equal(launch.disabled, false);
  launch.focus();
  launch.click();
  await settle();
  assert.equal(page.open(), true);
  assert.ok(page.dialog().contains(page.document.activeElement), 'Focus enters the modal');
  await page.click('skip');
  assert.equal(page.document.activeElement, launch);
  launch.click();
  await settle();
  assert.equal(page.open(), true, 'Manual replay remains available after a dismissal');
  assert.deepEqual(progress(page), [1, 6]);
});

test('manual replay also waits for a visible cookie notice', async t => {
  const page = setup(t, { cookieVisible: true });
  await page.ready({ id: 41, dashboardTourSeen: true });
  page.document.getElementById('dashboard-tour-launch').click();
  await settle();
  assert.equal(page.open(), false);
  page.document.querySelector('#cookie-dismiss').click();
  await settle();
  assert.equal(page.open(), true);
});

test('dismissing an automatic tour restores focus, scroll position, and the current hash', async t => {
  const page = setup(t);
  const original = page.document.getElementById('existing-control');
  original.focus();
  const hash = page.window.location.hash;
  await page.ready();
  page.state.scrollY = 740;
  await page.click('skip');
  assert.equal(page.document.activeElement, original);
  assert.equal(page.window.scrollY, 220);
  assert.equal(page.window.location.hash, hash);
});

test('a missing optional Lumia launcher is omitted without blocking completion', async t => {
  const page = setup(t, { html: fixture.replace('<button id="lumia-launcher">Ask Lumia</button>', '') });
  await page.ready();
  assert.equal(page.open(), true);
  assert.deepEqual(progress(page), [1, 5]);
  for (let step = 2; step <= 5; step++) {
    await page.click('next');
    assert.deepEqual(progress(page), [step, 5]);
  }
  assert.equal(page.button('next').textContent.trim(), 'Finish tour');
  await page.click('next');
  assert.equal(page.open(), false);
  assert.equal(page.state.calls[0].body.status, 'completed');
});

test('a target removed after the tour starts is safely skipped', async t => {
  const page = setup(t);
  await page.ready();
  page.document.getElementById('lumia-launcher').remove();
  let moves = 0;
  while (page.open() && moves++ < 8) await page.click('next');
  assert.equal(page.open(), false);
  assert.equal(page.state.calls.length, 1);
  assert.equal(page.state.calls[0].body.status, 'completed');
  assert.deepEqual(page.errors, []);
});

test('a dashboard without a roadmap introduces choosing a career instead of its disabled activity button', async t => {
  const page = setup(t);
  page.document.getElementById('start-next-step-button').disabled = true;
  await page.ready({ id: 41, dashboardTourSeen: false }, false);
  assert.equal(page.open(), true);
  await page.click('next');
  await page.click('next');
  assert.deepEqual(progress(page), [3, 6]);
  const copy = namedText(page.document, page.dialog(), 'aria-labelledby') + ' ' + namedText(page.document, page.dialog(), 'aria-describedby');
  assert.match(copy, /career/i);
  assert.equal(page.document.getElementById('start-next-step-button').disabled, true);
  assert.equal(page.window.location.pathname, '/dashboard.html', 'The tutorial does not navigate to career selection');
  assert.equal(page.state.calls.length, 0);
});

test('hidden optional targets are omitted just like missing targets', async t => {
  const page = setup(t);
  page.document.getElementById('lumia-launcher').hidden = true;
  await page.ready();
  assert.equal(page.open(), true);
  assert.deepEqual(progress(page), [1, 5]);
  assert.deepEqual(page.errors, []);
});

test('the roadmap introduction remains usable when its richer heading layout is absent', async t => {
  const page = setup(t);
  page.document.querySelector('#roadmap .section-heading-row').remove();
  await page.ready();
  await page.click('next');
  assert.equal(page.open(), true);
  assert.deepEqual(progress(page), [2, 6]);
  assert.match(namedText(page.document, page.dialog(), 'aria-labelledby'), /roadmap/i);
  assert.deepEqual(page.errors, []);
});

test('blocked local storage still allows dismissal and does not restart the same page', async t => {
  const page = setup(t, { storageBlocked: true });
  await page.ready();
  assert.equal(page.open(), true);
  await page.click('skip');
  assert.equal(page.open(), false);
  await page.ready();
  assert.equal(page.open(), false);
  assert.equal(page.state.calls.length, 1);
  assert.deepEqual(page.errors, []);
});

test('account persistence errors do not trap the user or lose the local dismissal', async t => {
  for (const request of [async () => ({ error: { message: 'Unavailable' } }), async () => { throw new Error('Network unavailable'); }]) {
    const page = setup(t, { request });
    await page.ready();
    await page.click('skip');
    assert.equal(page.open(), false);
    assert.equal(page.window.localStorage.getItem(savedKey(41)), 'seen');
    await page.ready();
    assert.equal(page.open(), false);
    assert.deepEqual(page.errors, []);
  }
});

test('keyboard focus stays within the guide and native cancellation records skipping', async t => {
  const page = setup(t);
  await page.ready();
  page.button('close').focus();
  const reverse = new page.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  page.button('close').dispatchEvent(reverse);
  assert.equal(reverse.defaultPrevented, true);
  assert.equal(page.document.activeElement, page.button('next'));
  const forward = new page.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  page.button('next').dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, true);
  assert.equal(page.document.activeElement, page.button('close'));
  page.dialog().dispatchEvent(new page.window.Event('cancel', { cancelable: true }));
  await settle();
  assert.equal(page.open(), false);
  assert.equal(page.state.calls[0].body.status, 'skipped');
});

test('the tour respects reduced motion while visiting targets and restoring the page', async t => {
  const page = setup(t, { reducedMotion: true });
  await page.ready();
  await page.click('next');
  await page.click('skip');
  const smooth = page.state.scrolls.filter(call => call.options?.behavior === 'smooth' || call.first?.behavior === 'smooth');
  assert.deepEqual(smooth, []);
  assert.deepEqual(page.errors, []);
});
