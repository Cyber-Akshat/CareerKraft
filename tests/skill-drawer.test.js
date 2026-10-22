const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require.resolve('../dashboard.html'), 'utf8');
const readScript = () => fs.readFileSync(require.resolve('../dashboard.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function skill(overrides = {}) {
  return {
    id: 21,
    name: 'Problem Solving',
    verifiedCount: 7,
    firstVerifiedAt: Date.UTC(2026, 9, 12, 12),
    lastVerifiedAt: Date.UTC(2026, 9, 18, 12),
    evidenceDepth: { highestLevel: 'intermediate', counts: { beginner: 4, intermediate: 3, advanced: 0 } },
    verifications: [{
      id: 71,
      verifiedAt: Date.UTC(2026, 9, 18, 12),
      activity: { id: 35, title: 'Analyse suspicious activity', level: 'intermediate', type: 'challenge', levelStepNumber: 2 },
      career: { id: 'cyber-security-analyst', title: 'Cyber Security Analyst' },
      evidence: { id: 8, submissionType: 'file', fileName: 'investigation-report.pdf', fileUrl: '/api/evidence/8/file', textContent: 'I compared the login records.', feedback: 'Your work shows structured reasoning.', submittedAt: Date.UTC(2026, 9, 18, 11), reviewedAt: Date.UTC(2026, 9, 18, 12) }
    }],
    ...overrides
  };
}

function load(t, request = async () => ({ data: { skill: skill() } })) {
  const dom = new JSDOM(html, { url: 'http://localhost/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  const frames = [];
  t.after(() => window.close());
  window.console.error = () => {};
  window.HTMLMediaElement.prototype.play = () => undefined;
  window.HTMLMediaElement.prototype.pause = () => {};
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.cancelAnimationFrame = () => {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('[autofocus]')?.focus();
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.careerAuth = {
    // Leave unrelated dashboard initialization paused while testing the live script.
    getSession: () => new Promise(() => {}),
    request: (endpoint, body) => { calls.push({ endpoint, body }); return request(endpoint, body); }
  };
  window.eval(readScript());
  const d = window.document;
  return {
    w: window, d, calls,
    el: id => d.getElementById(id),
    flushFrames() { while (frames.length) frames.shift()(0); },
    open: (id = 21, trigger) => window.openSkillDetail(id, trigger),
    close: () => window.closeSkillDrawer()
  };
}

test('skill details load from the authenticated API and display actual history, depth and dates', async t => {
  const ui = load(t);
  await ui.open();
  ui.flushFrames();
  assert.deepEqual(ui.calls.map(call => call.endpoint), ['skills/21']);
  assert.equal(ui.calls[0].body, undefined);
  assert.equal(ui.el('skill-detail-drawer').open, true);
  assert.equal(ui.d.body.classList.contains('skill-detail-open'), true);
  assert.equal(ui.el('skill-detail-loading').hidden, true);
  assert.equal(ui.el('skill-detail-error').hidden, true);
  assert.equal(ui.el('skill-detail-content').hidden, false);
  assert.equal(ui.el('skill-detail-name').textContent, 'Problem Solving');
  assert.equal(ui.el('skill-detail-verification-count').textContent, '7');
  assert.equal(ui.el('skill-detail-highest-level').textContent, 'Intermediate');
  assert.equal(ui.el('skill-depth-beginner-count').textContent, '4 demonstrations');
  assert.equal(ui.el('skill-depth-intermediate-count').textContent, '3 demonstrations');
  assert.equal(ui.el('skill-depth-advanced-count').textContent, '0 demonstrations');
  assert.equal(ui.el('skill-depth-beginner-bar').style.width, '100%');
  assert.equal(ui.el('skill-depth-intermediate-bar').style.width, '75%');
  assert.equal(ui.el('skill-depth-advanced-bar').style.width, '0%');
  assert.equal(ui.el('skill-depth-intermediate').classList.contains('is-highest'), true);
  assert.equal(ui.el('skill-depth-advanced').classList.contains('has-evidence'), false);
  assert.equal(ui.el('skill-history-count').textContent, '1 activity');
  assert.equal(ui.el('skill-history-empty').hidden, true);
  const entry = ui.el('skill-verification-history').firstElementChild;
  assert.match(entry.textContent, /Analyse suspicious activity/);
  assert.match(entry.textContent, /Cyber Security Analyst/);
  assert.match(entry.textContent, /Intermediate/);
  assert.match(entry.textContent, /challenge/i);
  assert.match(entry.textContent, /structured reasoning/);
  const file = entry.querySelector('[data-verification-file-link]');
  assert.equal(file.hidden, false);
  assert.equal(file.getAttribute('href'), '/api/evidence/8/file');
  assert.match(file.textContent, /investigation-report\.pdf/);
  assert.equal(entry.querySelector('[data-verification-written-work]').hidden, false);
  assert.match(entry.querySelector('[data-verification-written-text]').textContent, /compared the login records/);
  assert.equal(ui.el('skill-first-verified').textContent, '12 Oct 2026');
  assert.equal(ui.el('skill-last-verified').textContent, '18 Oct 2026');
  assert.match(ui.el('skill-lumia-message').textContent, /Intermediate/);
  assert.equal(ui.calls.length, 1, 'the insight uses saved evidence rather than another AI request');
});

test('opening another skill immediately clears previous details while the next request is pending', async t => {
  const waiting = deferred();
  const ui = load(t, endpoint => endpoint === 'skills/21' ? Promise.resolve({ data: { skill: skill() } }) : waiting.promise);
  await ui.open();
  ui.flushFrames();
  const pending = ui.open(22);
  assert.equal(ui.el('skill-detail-loading').hidden, false);
  assert.equal(ui.el('skill-detail-content').hidden, true);
  assert.equal(ui.el('skill-detail-error').hidden, true);
  assert.equal(ui.el('skill-verification-history').children.length, 0);
  assert.notEqual(ui.el('skill-detail-verification-count').textContent, '7');
  assert.notEqual(ui.el('skill-detail-highest-level').textContent, 'Intermediate');
  assert.equal(ui.el('skill-first-verified').textContent, '—');
  assert.equal(ui.el('skill-last-verified').textContent, '—');
  assert.equal(ui.el('skill-depth-intermediate-bar').style.width, '0%');
  waiting.resolve({ data: { skill: skill({ id: 22, name: 'User Research' }) } });
  await pending;
  assert.equal(ui.el('skill-detail-name').textContent, 'User Research');
});

test('API errors show a retry state and retry the same skill without retaining stale data', async t => {
  let attempts = 0;
  const ui = load(t, async () => ++attempts === 1 ? { error: { message: 'Connection interrupted' } } : { data: { skill: skill() } });
  await ui.open();
  assert.equal(ui.el('skill-detail-loading').hidden, true);
  assert.equal(ui.el('skill-detail-content').hidden, true);
  assert.equal(ui.el('skill-detail-error').hidden, false);
  assert.match(ui.el('skill-detail-error-message').textContent, /Connection interrupted/);
  ui.el('skill-detail-retry').click();
  await settle();
  assert.deepEqual(ui.calls.map(call => call.endpoint), ['skills/21', 'skills/21']);
  assert.equal(ui.el('skill-detail-error').hidden, true);
  assert.equal(ui.el('skill-detail-content').hidden, false);
  assert.equal(ui.el('skill-detail-name').textContent, 'Problem Solving');
});

test('a rejected request and a missing skill both display recoverable errors', async t => {
  for (const response of [() => Promise.reject(new Error('Offline')), async () => ({ data: {} })]) {
    const ui = load(t, response);
    await ui.open();
    assert.equal(ui.el('skill-detail-error').hidden, false);
    assert.equal(ui.el('skill-detail-content').hidden, true);
    assert.equal(ui.el('skill-detail-loading').hidden, true);
    assert.notEqual(ui.el('skill-detail-error-message').textContent.trim(), '');
  }
});

test('rapid selection keeps the newest skill when responses arrive out of order', async t => {
  const first = deferred();
  const second = deferred();
  const ui = load(t, endpoint => endpoint === 'skills/21' ? first.promise : second.promise);
  const oldRequest = ui.open(21);
  const newRequest = ui.open(22);
  second.resolve({ data: { skill: skill({ id: 22, name: 'User Research' }) } });
  await newRequest;
  first.resolve({ data: { skill: skill() } });
  await oldRequest;
  ui.flushFrames();
  assert.equal(ui.el('skill-detail-name').textContent, 'User Research');
  assert.equal(ui.el('skill-detail-content').hidden, false);
});

test('a stale failure cannot replace a newer successful skill', async t => {
  const stale = deferred();
  const ui = load(t, endpoint => endpoint === 'skills/21' ? stale.promise : Promise.resolve({ data: { skill: skill({ id: 22, name: 'Communication' }) } }));
  const oldRequest = ui.open(21);
  await ui.open(22);
  stale.reject(new Error('Old connection failed'));
  await oldRequest;
  assert.equal(ui.el('skill-detail-name').textContent, 'Communication');
  assert.equal(ui.el('skill-detail-error').hidden, true);
});

test('closing the drawer invalidates in-flight results and restores focus and page scrolling', async t => {
  const waiting = deferred();
  const ui = load(t, () => waiting.promise);
  const trigger = ui.d.createElement('button');
  trigger.textContent = 'Problem Solving';
  ui.d.body.append(trigger);
  trigger.focus();
  const pending = ui.open(21, trigger);
  assert.equal(ui.el('skill-detail-drawer').open, true);
  ui.close();
  assert.equal(ui.el('skill-detail-drawer').open, false);
  assert.equal(ui.d.body.classList.contains('skill-detail-open'), false);
  assert.equal(ui.d.activeElement, trigger);
  waiting.resolve({ data: { skill: skill() } });
  await pending;
  ui.flushFrames();
  assert.equal(ui.el('skill-detail-drawer').open, false);
  assert.equal(ui.el('skill-detail-content').hidden, true);
});

test('closing and reopening is not overwritten by a previous request or animation frame', async t => {
  const old = deferred();
  const latest = deferred();
  const ui = load(t, endpoint => endpoint === 'skills/21' ? old.promise : latest.promise);
  const oldRequest = ui.open(21);
  ui.close();
  const latestRequest = ui.open(22);
  old.resolve({ data: { skill: skill() } });
  await oldRequest;
  ui.flushFrames();
  assert.equal(ui.el('skill-detail-loading').hidden, false);
  assert.equal(ui.el('skill-detail-content').hidden, true);
  assert.equal(ui.el('skill-depth-intermediate-bar').style.width, '0%');
  latest.resolve({ data: { skill: skill({ id: 22, name: 'Planning' }) } });
  await latestRequest;
  assert.equal(ui.el('skill-detail-name').textContent, 'Planning');
});

test('deferred evidence bar frames from a previous selection cannot populate a new loading state', async t => {
  const pending = deferred();
  const ui = load(t, endpoint => endpoint === 'skills/21' ? Promise.resolve({ data: { skill: skill() } }) : pending.promise);
  await ui.open(21);
  const request = ui.open(22);
  ui.flushFrames();
  assert.equal(ui.el('skill-depth-intermediate-bar').style.width, '0%');
  pending.resolve({ error: { message: 'Unavailable' } });
  await request;
});

test('empty history and evidence depth do not invent Beginner demonstrations', async t => {
  const ui = load(t, async () => ({ data: { skill: skill({ verifiedCount: 0, verifications: [], firstVerifiedAt: null, lastVerifiedAt: 'invalid', evidenceDepth: { highestLevel: null, counts: {} } }) } }));
  await ui.open();
  ui.flushFrames();
  assert.equal(ui.el('skill-detail-verification-count').textContent, '0');
  assert.notEqual(ui.el('skill-detail-highest-level').textContent, 'Beginner');
  assert.equal(ui.el('skill-history-count').textContent, '0 activities');
  assert.equal(ui.el('skill-history-empty').hidden, false);
  assert.equal(ui.el('skill-verification-history').children.length, 0);
  assert.equal(ui.el('skill-first-verified').textContent, '—');
  assert.equal(ui.el('skill-last-verified').textContent, '—');
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    assert.equal(ui.el(`skill-depth-${level}-count`).textContent, '0 demonstrations');
    assert.equal(ui.el(`skill-depth-${level}-bar`).style.width, '0%');
    assert.equal(ui.el(`skill-depth-${level}`).classList.contains('is-highest'), false);
  }
  assert.doesNotMatch(ui.el('skill-lumia-message').textContent, /^\s*you(?:'ve| have) (?:started|demonstrated)/i);
});

test('plain text evidence remains readable and absent uploaded work has no download link', async t => {
  const value = skill();
  value.verifications[0].evidence = { id: 8, submissionType: 'text', textContent: 'Step one\n  An indented explanation.', feedback: '' };
  const ui = load(t, async () => ({ data: { skill: value } }));
  await ui.open();
  const entry = ui.el('skill-verification-history').firstElementChild;
  assert.equal(entry.querySelector('[data-verification-file-link]').hidden, true);
  assert.equal(entry.querySelector('[data-verification-file-link]').hasAttribute('href'), false);
  assert.equal(entry.querySelector('[data-verification-written-work]').hidden, false);
  assert.equal(entry.querySelector('[data-verification-written-text]').textContent, 'Step one\n  An indented explanation.');
  assert.equal(entry.querySelector('[data-verification-review]').hidden, true);
});

test('untrusted names, feedback, filenames and written answers render as text', async t => {
  const value = skill({ name: '<img src=x onerror="alert(1)">' });
  const verification = value.verifications[0];
  verification.activity.title = '<svg onload="alert(2)">';
  verification.career.title = '<script>alert(3)</script>';
  verification.evidence.fileName = '<img src=x onerror="alert(4)">.pdf';
  verification.evidence.feedback = '<b onclick="alert(5)">Review</b>';
  verification.evidence.textContent = '<iframe src="javascript:alert(6)"></iframe>';
  const ui = load(t, async () => ({ data: { skill: value } }));
  await ui.open();
  const content = ui.el('skill-detail-content');
  assert.equal(content.querySelector('img, svg, script, iframe, [onerror], [onload], [onclick]'), null);
  assert.equal(ui.el('skill-detail-name').textContent, value.name);
  const entry = ui.el('skill-verification-history').firstElementChild;
  assert.match(entry.textContent, /<svg onload/);
  assert.match(entry.textContent, /<script>alert/);
  assert.match(entry.textContent, /<b onclick/);
  assert.match(entry.textContent, /<iframe/);
  assert.match(entry.querySelector('[data-verification-file-link]').textContent, /<img/);
});

test('history never creates executable, external or unrelated evidence links', async t => {
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,hello', 'https://evil.example/api/evidence/8/file', '//evil.example/api/evidence/8/file', '/auth.html']) {
    const value = skill();
    value.verifications[0].evidence.fileUrl = unsafe;
    const ui = load(t, async () => ({ data: { skill: value } }));
    await ui.open();
    const link = ui.el('skill-verification-history').querySelector('[data-verification-file-link]');
    assert.equal(link.hidden || !link.hasAttribute('href'), true, unsafe);
  }
});

test('invalid skill identifiers never start a details request', async t => {
  const ui = load(t);
  for (const invalid of [undefined, null, '', 0, -1, 1.5, 'not-a-skill', '../private']) await ui.w.openSkillDetail(invalid);
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.el('skill-detail-drawer').open, false);
});

test('the close button, Escape and native dialog cancellation release the drawer', async t => {
  const ui = load(t);
  await ui.open();
  ui.el('skill-detail-close').click();
  assert.equal(ui.el('skill-detail-drawer').open, false);
  await ui.open();
  ui.d.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ui.el('skill-detail-drawer').open, false);
  await ui.open();
  ui.el('skill-detail-drawer').dispatchEvent(new ui.w.Event('cancel', { cancelable: true }));
  assert.equal(ui.el('skill-detail-drawer').open, false);
  assert.equal(ui.d.body.classList.contains('skill-detail-open'), false);
});

test('Tab wraps at drawer boundaries while interior navigation and browser shortcuts remain available', async t => {
  const ui = load(t);
  await ui.open();
  const drawer = ui.el('skill-detail-drawer');
  const controls = [...drawer.querySelectorAll('button:not(:disabled), a[href], summary')]
    .filter(element => !element.closest('[hidden]'));
  for (const control of controls) control.getClientRects = () => [{ left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }];
  assert.equal(controls.length, 3, 'close, authenticated file download and written-answer summary are visible');
  const first = controls[0];
  const interior = controls[1];
  const last = controls.at(-1);
  const pressTab = (element, options = {}) => {
    element.focus();
    const event = new ui.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event;
  };
  assert.equal(first, ui.el('skill-detail-close'));
  assert.equal(pressTab(first, { shiftKey: true }).defaultPrevented, true);
  assert.equal(ui.d.activeElement, last);
  assert.equal(pressTab(last).defaultPrevented, true);
  assert.equal(ui.d.activeElement, first);
  assert.equal(pressTab(interior).defaultPrevented, false);
  assert.equal(ui.d.activeElement, interior, 'ordinary Tab uses the browser default action');
  assert.equal(pressTab(last, { ctrlKey: true }).defaultPrevented, false);
  assert.equal(ui.d.activeElement, last, 'Ctrl+Tab remains a browser shortcut');
  ui.close();
  const closedEvent = new ui.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  ui.d.dispatchEvent(closedEvent);
  assert.equal(closedEvent.defaultPrevented, false);
});

test('a click on the native backdrop closes while clicks inside the panel keep it open', async t => {
  const ui = load(t);
  await ui.open();
  const drawer = ui.el('skill-detail-drawer');
  drawer.getBoundingClientRect = () => ({ left: 500, right: 1060, top: 0, bottom: 800, width: 560, height: 800 });
  ui.el('skill-detail-name').click();
  assert.equal(drawer.open, true);
  drawer.dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, clientX: 300, clientY: 100 }));
  assert.equal(drawer.open, false);
  assert.equal(ui.el('skill-detail-backdrop').hidden, true, 'native modal uses its own backdrop');
});

test('dashboard skill planets open real details by click, Enter and Space without changing their artwork', async t => {
  const ui = load(t, async endpoint => endpoint === 'skills' ? { data: { skills: [{ id: 21, name: 'Problem Solving', verifiedCount: 7 }], summary: { totalSkills: 1, totalVerifications: 7 } } } : { data: { skill: skill() } });
  await ui.w.loadSkills();
  const planet = ui.el('skills-list').querySelector('.skill-item');
  assert.equal(planet.dataset.skillId, '21');
  assert.equal(planet.tabIndex, 0);
  assert.equal(planet.getAttribute('role'), 'button');
  assert.match(planet.getAttribute('aria-label'), /Problem Solving/);
  assert.equal(planet.querySelector('.sticker-badge')?.tagName.toLowerCase(), 'svg');
  for (const key of [null, 'Enter', ' ']) {
    if (key === null) planet.click();
    else {
      const event = new ui.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      planet.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }
    await settle();
    assert.equal(ui.el('skill-detail-drawer').open, true);
    assert.equal(ui.el('skill-detail-name').textContent, 'Problem Solving');
    ui.close();
  }
  const before = ui.calls.length;
  planet.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(ui.calls.length, before);
});

test('the Skills Profile retains radar charts and exposes each skill as a native details button', async t => {
  const ui = load(t, async endpoint => endpoint === 'skills' ? { data: { skills: [{ id: 21, name: 'Problem Solving', verifiedCount: 7 }], summary: { totalSkills: 1, totalVerifications: 7 }, levels: [{ id: 'beginner', skills: [{ id: 21, name: 'Problem Solving', verifiedCount: 4 }] }, { id: 'intermediate', skills: [{ id: 21, name: 'Problem Solving', verifiedCount: 3 }] }, { id: 'advanced', skills: [] }] } } : { data: { skill: skill() } });
  ui.w.history.replaceState(null, '', '#skills');
  await ui.w.loadSkills();
  assert.equal(ui.el('skills-list').querySelectorAll('.level-skill-chart').length, 3);
  assert.equal(ui.el('skills-list').querySelectorAll('svg').length, 2);
  const buttons = [...ui.el('skills-list').querySelectorAll('.skill-radar-counts .skill-detail-trigger')];
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(button.dataset.skillId, '21');
    assert.match(button.textContent, /Problem Solving/);
  }
  buttons[0].click();
  await settle();
  assert.equal(ui.el('skill-detail-drawer').open, true);
  assert.equal(ui.el('skill-detail-name').textContent, 'Problem Solving');
});
