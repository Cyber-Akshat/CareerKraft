const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const client = fs.readFileSync(require.resolve('../auth-api.js'), 'utf8');
const accessibilityClient = () => fs.readFileSync(require.resolve('../accessibility.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(t, user, { accessibility = false } = {}) {
  const dom = new JSDOM('<!doctype html><head></head><body><button id="dashboard-theme-toggle">Theme</button></body>', {
    url: 'http://localhost:3000/dashboard.html', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => url === '/api/session' ? { session: user ? { user } : null } : { success: true } };
  };
  return { window: dom.window, calls, start: () => {
    if (accessibility) dom.window.eval(accessibilityClient());
    dom.window.eval(client);
  } };
}

test('saved account appearance is applied throughout authenticated pages', async t => {
  const page = setup(t, { id: 1, preferences: { theme: 'dark', reducedMotion: true } });
  page.start();
  const result = await page.window.careerAuth.getSession();
  assert.equal(result.data.session.user.id, 1);
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.window.document.documentElement.dataset.reducedMotion, 'true');
  assert.equal(page.window.localStorage.getItem('careerkraft-theme'), 'dark');
  assert.equal(page.window.localStorage.getItem('careerkraft-reduced-motion'), 'true');
  assert.equal(page.window.document.querySelector('button').getAttribute('aria-label'), 'Switch to light mode');
});

test('unsaved account preferences preserve the existing browser appearance', async t => {
  const page = setup(t, { id: 1 });
  page.window.document.documentElement.dataset.theme = 'dark';
  page.window.localStorage.setItem('careerkraft-reduced-motion', 'true');
  page.start();
  await page.window.careerAuth.getSession();
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.window.document.documentElement.dataset.reducedMotion, 'true');
});

test('theme controls save the new preference for the signed-in account', async t => {
  const page = setup(t, { id: 1 });
  page.start();
  await page.window.careerAuth.getSession();
  page.window.document.querySelector('button').addEventListener('click', () => {
    page.window.document.documentElement.dataset.theme = 'dark';
  });
  page.window.document.querySelector('button').click();
  await settle();
  const request = page.calls.find(call => call.url === '/api/settings/preferences');
  assert.equal(request.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(request.body), { theme: 'dark', reducedMotion: false });
  await page.window.careerAuth.signOut();
  page.window.document.querySelector('button').click();
  assert.equal(page.calls.filter(call => call.url === '/api/settings/preferences').length, 1);
});

test('account preferences still apply when browser storage is unavailable', async t => {
  const page = setup(t, { id: 1, preferences: { theme: 'dark', reducedMotion: true } });
  Object.defineProperty(page.window, 'localStorage', { get() { throw new Error('Blocked'); } });
  page.start();
  await page.window.careerAuth.getSession();
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.window.document.documentElement.dataset.reducedMotion, 'true');
});

test('account accessibility preferences replace browser preferences across authenticated pages', async t => {
  const preferences = { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'grayscale', cursorSize: 'large' };
  const page = setup(t, { id: 1, preferences: { theme: 'dark', reducedMotion: true, ...preferences } }, { accessibility: true });
  page.window.localStorage.setItem('careerkraft-accessibility', JSON.stringify({ ...preferences, fontSize: 'small', cursorSize: 'small' }));
  page.start();
  await page.window.careerAuth.getSession();
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.careerAccessibility.read())), preferences);
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('careerkraft-accessibility')), preferences);
  assert.equal(page.window.document.documentElement.dataset.fontSize, 'large');
  assert.equal(page.window.document.documentElement.dataset.contrast, 'high');
  assert.equal(page.window.document.documentElement.dataset.dyslexiaFont, 'true');
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
});

test('older account sessions without accessibility fields preserve browser accessibility settings', async t => {
  const preferences = { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'small' };
  for (const accountPreferences of [undefined, { theme: 'dark', reducedMotion: true }]) {
    const page = setup(t, { id: 1, preferences: accountPreferences }, { accessibility: true });
    page.window.localStorage.setItem('careerkraft-accessibility', JSON.stringify(preferences));
    page.start();
    await page.window.careerAuth.getSession();
    assert.deepEqual(JSON.parse(JSON.stringify(page.window.careerAccessibility.read())), preferences);
    assert.equal(page.window.document.documentElement.dataset.fontSize, 'large');
    assert.equal(page.window.document.documentElement.dataset.cursorSize, 'small');
  }
});

test('account accessibility remains usable when storage is blocked', async t => {
  const preferences = { dyslexiaFont: true, fontSize: 'small', contrast: 'high', saturation: 'grayscale', cursorSize: 'large' };
  const page = setup(t, { id: 1, preferences }, { accessibility: true });
  Object.defineProperty(page.window, 'localStorage', { get() { throw new Error('Blocked'); } });
  page.start();
  await page.window.careerAuth.getSession();
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.careerAccessibility.read())), preferences);
  assert.equal(page.window.document.documentElement.dataset.fontSize, 'small');
  assert.equal(page.window.document.documentElement.dataset.saturation, 'grayscale');
});

test('theme toggle requests do not overwrite saved account accessibility choices', async t => {
  const preferences = { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' };
  const page = setup(t, { id: 1, preferences: { theme: 'light', reducedMotion: true, ...preferences } }, { accessibility: true });
  page.start();
  await page.window.careerAuth.getSession();
  page.window.document.querySelector('button').addEventListener('click', () => {
    page.window.document.documentElement.dataset.theme = 'dark';
  });
  page.window.document.querySelector('button').click();
  await settle();
  const request = page.calls.find(call => call.url === '/api/settings/preferences');
  assert.deepEqual(JSON.parse(request.body), { theme: 'dark', reducedMotion: true });
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.careerAccessibility.read())), preferences);
});

test('settings email confirmations return through sign-in without allowing external redirects', t => {
  const page = setup(t, null);
  page.start();
  const emailToken = 'a'.repeat(64);
  page.window.history.replaceState(null, '', `/auth.html?next=${encodeURIComponent(`settings.html?emailToken=${emailToken}`)}`);
  assert.equal(page.window.careerAuth.settingsReturnUrl().href, `http://localhost:3000/settings.html?emailToken=${emailToken}`);
  for (const next of ['https://evil.example/settings.html', '//evil.example/settings.html', 'dashboard.html', 'settings.html/other']) {
    page.window.history.replaceState(null, '', `/auth.html?next=${encodeURIComponent(next)}`);
    assert.equal(page.window.careerAuth.settingsReturnUrl(), null);
  }
  page.window.history.replaceState(null, '', '/auth.html?next=settings.html%3FemailToken%3Dbad%26redirect%3Dhttps%3A%2F%2Fevil.example');
  assert.equal(page.window.careerAuth.settingsReturnUrl().href, 'http://localhost:3000/settings.html');
});

test('the dashboard uses the private account photo and links to settings', async t => {
  const dom = new JSDOM(fs.readFileSync(require.resolve('../dashboard.html'), 'utf8'), {
    url: 'http://localhost:3000/dashboard.html', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.careerAuth = {
    getSession: async () => ({ data: { session: { user: { display_name: 'Alex', avatar_url: '/api/settings/avatar?v=1' } } } }),
    request: async endpoint => ({ data: endpoint === 'skills' ? { skills: [], summary: {} } : { roadmap: null } })
  };
  window.eval(fs.readFileSync(require.resolve('../dashboard.js'), 'utf8'));
  await settle();
  const avatar = window.document.querySelector('#dashboard-avatar img');
  assert.equal(avatar.getAttribute('src'), '/api/settings/avatar?v=1');
  assert.equal(avatar.closest('a').getAttribute('href'), 'settings.html');
  avatar.dispatchEvent(new window.Event('error'));
  assert.equal(window.document.querySelector('#dashboard-avatar').textContent, 'A');
});
