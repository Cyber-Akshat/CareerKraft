const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(require.resolve('../settings.html'), 'utf8');
const script = fs.readFileSync(require.resolve('../settings.js'), 'utf8');
const accessibilityScript = fs.readFileSync(require.resolve('../accessibility.js'), 'utf8');
const catalogScript = fs.readFileSync(require.resolve('../assets/avatar-characters.js'), 'utf8');
const catalog = require('../assets/avatar-characters');
const defaults = { displayName: 'Alex Morgan', email: 'alex@example.com', avatarUrl: null, avatarCharacter: null, hasPassword: true,
  googleLinked: false, googleConfigured: true, securityVerified: false, theme: null, reducedMotion: false, createdAt: 1704067200000 };
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

async function load(t, options = {}) {
  const dom = new JSDOM(html, { url: options.url || 'http://localhost/settings.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const w = dom.window;
  const calls = [];
  const value = { ...defaults, ...options.settings };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.URL.createObjectURL = () => 'blob:http://localhost/test-preview';
  w.URL.revokeObjectURL = () => {};
  w.careerAuth = {
    getSession: async () => options.session || { data: { session: { user: { name: 'Alex' } } } },
    signOut: options.signOut || (async () => ({ data: { success: true } })),
    request: async (endpoint, body) => {
      calls.push({ endpoint, body });
      if (endpoint === 'settings') return options.loadError ? { error: { message: 'Offline. Try again.' } } : { data: { settings: value, stats: { completedActivities: 7, verifiedSkills: 3 } } };
      return options.request ? options.request(endpoint, body, value) : { data: { settings: value } };
    }
  };
  if (options.theme) { w.localStorage.setItem('careerkraft-theme', options.theme); w.document.documentElement.dataset.theme = options.theme; }
  if (options.reducedMotion) { w.localStorage.setItem('careerkraft-reduced-motion', 'true'); w.document.documentElement.dataset.reducedMotion = 'true'; }
  w.eval(accessibilityScript);
  if (options.accessibility) w.careerAccessibility.apply(options.accessibility);
  if (options.storageDenied) Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable.'); } });
  w.eval(catalogScript);
  if (options.catalog) w.careerAvatarCharacters = options.catalog;
  w.eval(script);
  await settle();
  return { w, d: w.document, calls, value };
}
const submit = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
const input = (w, id, value) => { const field = w.document.getElementById(id); field.value = value; field.dispatchEvent(new w.Event('input', { bubbles: true })); };
const change = (w, id, value) => {
  const field = w.document.getElementById(id);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const accessibilityValues = w => JSON.parse(JSON.stringify(w.careerAccessibility.read()));
const accessibilityDefaults = { dyslexiaFont: false, fontSize: 'default', contrast: 'default', saturation: 'default', cursorSize: 'default' };

test('settings renders real profile data and stats with safe text', async t => {
  const { d } = await load(t, { settings: { displayName: '<img src=x onerror=alert(1)>' } });
  assert.equal(d.getElementById('settings-content').disabled, false);
  assert.equal(d.getElementById('profile-name').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(d.getElementById('profile-name').querySelector('img'), null);
  assert.equal(d.getElementById('completed-stat').textContent, '7');
  assert.equal(d.getElementById('skills-stat').textContent, '3');
  assert.equal(d.getElementById('page-status').hidden, true);
  assert.match(d.getElementById('member-since').textContent, /2024/);
});

test('settings keeps controls unavailable and offers retry after a loading failure', async t => {
  const { d } = await load(t, { loadError: true });
  assert.equal(d.getElementById('settings-content').disabled, true);
  assert.equal(d.getElementById('retry-load').hidden, false);
  assert.match(d.getElementById('page-status').textContent, /Offline/);
});

test('new accounts retain existing browser appearance and motion preferences', async t => {
  const { w, d } = await load(t, { theme: 'dark', reducedMotion: true });
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.equal(d.getElementById('reduced-motion').checked, true);
  assert.equal(w.localStorage.getItem('careerkraft-theme'), 'dark');
});

test('profile editing waits for the server, then shows the saved name', async t => {
  let finish;
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => new Promise(resolve => { finish = () => resolve({ data: { settings: { ...value, displayName: body.displayName } } }); }) });
  d.querySelector('[data-editor="name-editor"]').click();
  input(w, 'display-name', '  Alex Rivera  ');
  submit(w, 'name-editor');
  assert.equal(d.getElementById('profile-name').textContent, 'Alex Morgan');
  assert.equal(d.querySelector('#name-editor button[type="submit"]').disabled, true);
  assert.equal(calls.at(-1).body.displayName, 'Alex Rivera');
  finish(); await settle();
  assert.equal(d.getElementById('profile-name').textContent, 'Alex Rivera');
  assert.equal(d.getElementById('name-editor').hidden, true);
});

test('failed profile save preserves the old profile and allows retry', async t => {
  const { w, d } = await load(t, { request: async () => ({ error: { message: 'Name could not be saved.' } }) });
  d.querySelector('[data-editor="name-editor"]').click();
  input(w, 'display-name', 'Changed'); submit(w, 'name-editor'); await settle();
  assert.equal(d.getElementById('profile-name').textContent, 'Alex Morgan');
  assert.match(d.querySelector('#name-editor .form-status').textContent, /could not be saved/);
  assert.equal(d.querySelector('#name-editor button[type="submit"]').disabled, false);
});

test('email change sends the password and keeps the current email until verification', async t => {
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => ({ data: { settings: value, pendingEmail: body.email } }) });
  d.querySelector('[data-editor="email-editor"]').click();
  input(w, 'new-email', 'new@example.com'); input(w, 'email-password', 'existing password');
  submit(w, 'email-editor'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/email');
  assert.equal(calls.at(-1).body.currentPassword, 'existing password');
  assert.equal(d.getElementById('email-value').textContent, 'alex@example.com');
  assert.match(d.querySelector('#email-editor .form-status').textContent, /new@example.com/);
  assert.equal(d.getElementById('email-password').value, '');
});

test('email confirmation token is consumed and scrubbed from the address', async t => {
  const { d, w, calls } = await load(t, { url: 'http://localhost/settings.html?emailToken=secret-token', request: async (endpoint, body, value) => ({ data: { settings: { ...value, email: 'new@example.com' } } }) });
  assert.equal(w.location.search, '');
  assert.equal(calls.at(-1).endpoint, 'settings/email/confirm');
  assert.equal(calls.at(-1).body.token, 'secret-token');
  assert.equal(d.getElementById('email-value').textContent, 'new@example.com');
  assert.match(d.getElementById('page-status').textContent, /confirmed/);
});

test('password mismatch stays local and successful password change clears credentials', async t => {
  const { w, d, calls } = await load(t);
  d.getElementById('password-edit-button').click();
  input(w, 'current-password', 'old password'); input(w, 'new-password', 'harbour-maple-orbit-31'); input(w, 'confirm-password', 'different-river-stone');
  submit(w, 'password-editor'); await settle();
  assert.equal(calls.length, 1);
  assert.match(d.querySelector('#password-editor .form-status').textContent, /don't match/);
  input(w, 'confirm-password', 'harbour-maple-orbit-31'); submit(w, 'password-editor'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/password');
  assert.equal(calls.at(-1).body.newPassword, 'harbour-maple-orbit-31');
  assert.equal(d.getElementById('current-password').value, '');
  assert.equal(d.getElementById('new-password').value, '');
});

test('new settings passwords enforce15–128 characters while preserving Unicode and whitespace', async t => {
  const { w, d, calls } = await load(t);
  d.getElementById('password-edit-button').click();
  input(w, 'current-password', 'old');
  for (const password of ['short-password', 'x'.repeat(129)]) {
    input(w, 'new-password', password); input(w, 'confirm-password', password);
    submit(w, 'password-editor'); await settle();
    assert.equal(calls.length, 1);
    assert.match(d.querySelector('#password-editor .form-status').textContent, /15–128/);
  }
  const password = '  星空と川のあいだを歩く 😀  ';
  input(w, 'new-password', password); input(w, 'confirm-password', password);
  submit(w, 'password-editor'); await settle();
  assert.equal(calls.at(-1).body.newPassword, password);
  assert.equal(calls.at(-1).body.currentPassword, 'old');
  assert.equal(d.getElementById('new-password').minLength, 15);
  assert.equal(d.getElementById('confirm-password').minLength, 15);
});

test('Google-only accounts require recent identity confirmation and cannot disconnect their only sign-in', async t => {
  const { d } = await load(t, { settings: { hasPassword: false, googleLinked: true } });
  assert.equal(d.getElementById('save-password').disabled, true);
  assert.equal(d.getElementById('verify-google').hidden, false);
  assert.equal(d.getElementById('google-unlink-edit').disabled, true);
  assert.equal(d.getElementById('password-edit-button').textContent, 'Set password');
  assert.equal(d.getElementById('current-password').required, false);
});

test('expired Google confirmation disables sensitive actions again', async t => {
  const { w, d } = await load(t, { settings: { hasPassword: false, googleLinked: true, securityVerified: true }, request: async () => ({ error: { code: 'reauth_required', message: 'Confirm with Google again.' } }) });
  assert.equal(d.getElementById('save-password').disabled, false);
  d.getElementById('password-edit-button').click();
  input(w, 'new-password', 'harbour-maple-orbit-31'); input(w, 'confirm-password', 'harbour-maple-orbit-31'); submit(w, 'password-editor'); await settle();
  assert.equal(d.getElementById('save-password').disabled, true);
  assert.equal(d.getElementById('verify-google').hidden, false);
});

test('Google connection requires password proof before any OAuth navigation', async t => {
  const { w, d, calls } = await load(t, { request: async () => ({ error: { code: 'incorrect_password', message: 'Incorrect password.' } }) });
  d.getElementById('google-connect').click();
  assert.equal(d.getElementById('google-link-editor').hidden, false);
  assert.equal(calls.length, 1);
  input(w, 'link-password', 'wrong'); submit(w, 'google-link-editor'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/google/link');
  assert.equal(calls.at(-1).body.currentPassword, 'wrong');
  assert.match(d.querySelector('#google-link-editor .form-status').textContent, /Incorrect/);
});

test('unconfigured Google connection explains why it is unavailable', async t => {
  const { d } = await load(t, { settings: { googleConfigured: false } });
  assert.equal(d.getElementById('google-connect').disabled, true);
  assert.match(d.getElementById('google-summary').textContent, /isn't configured/);
});

test('theme and motion preferences are persisted to account and browser only after a successful save', async t => {
  let fail = true;
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => fail ? { error: { message: 'Unable to save.' } } : { data: { settings: { ...value, ...body } } } });
  d.querySelector('input[name="theme"][value="dark"]').checked = true;
  d.getElementById('reduced-motion').checked = true;
  submit(w, 'preferences-form'); await settle();
  assert.equal(w.localStorage.getItem('careerkraft-theme'), 'light');
  fail = false; submit(w, 'preferences-form'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/preferences');
  assert.equal(w.localStorage.getItem('careerkraft-theme'), 'dark');
  assert.equal(w.localStorage.getItem('careerkraft-reduced-motion'), 'true');
  assert.equal(d.documentElement.dataset.reducedMotion, 'true');
});

test('accessibility controls have labels, descriptions and all requested choices', async t => {
  const { d } = await load(t);
  const dyslexia = d.getElementById('dyslexia-font');
  assert.equal(dyslexia.type, 'checkbox');
  assert.match(d.getElementById(dyslexia.getAttribute('aria-labelledby')).textContent, /Dyslexia-friendly font/);
  for (const [id, values] of Object.entries({ 'font-size': ['small', 'default', 'large'], contrast: ['default', 'high'], saturation: ['default', 'low', 'high', 'grayscale'], 'cursor-size': ['small', 'default', 'large'] })) {
    const field = d.getElementById(id);
    assert.ok(d.querySelector(`label[for="${id}"]`));
    assert.ok(d.getElementById(field.getAttribute('aria-describedby')));
    assert.deepEqual([...field.options].map(option => option.value), values);
  }
  assert.equal(d.getElementById('reset-accessibility').type, 'button');
  assert.ok(html.indexOf('src="/accessibility.js"') < html.indexOf('document.documentElement.dataset.theme'));
});

test('existing account accessibility settings populate and replace browser settings', async t => {
  const preferences = { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'grayscale', cursorSize: 'large' };
  const { w, d } = await load(t, { settings: { theme: 'light', ...preferences }, accessibility: { fontSize: 'small', saturation: 'high' } });
  assert.equal(d.getElementById('dyslexia-font').checked, true);
  assert.equal(d.getElementById('font-size').value, 'large');
  assert.equal(d.getElementById('contrast').value, 'high');
  assert.equal(d.getElementById('saturation').value, 'grayscale');
  assert.equal(d.getElementById('cursor-size').value, 'large');
  assert.deepEqual(accessibilityValues(w), preferences);
});

test('saved accounts without accessibility settings use defaults and new accounts retain browser settings', async t => {
  const saved = await load(t, { settings: { theme: 'dark' }, accessibility: { dyslexiaFont: true, fontSize: 'large' } });
  assert.deepEqual(accessibilityValues(saved.w), accessibilityDefaults);
  const fresh = await load(t, { accessibility: { dyslexiaFont: true, fontSize: 'large', saturation: 'low' } });
  assert.equal(fresh.d.getElementById('dyslexia-font').checked, true);
  assert.equal(fresh.d.getElementById('font-size').value, 'large');
  assert.equal(fresh.d.getElementById('saturation').value, 'low');
});

test('changing accessibility previews immediately in the browser without an account request', async t => {
  const { w, d, calls } = await load(t);
  change(w, 'dyslexia-font', true);
  change(w, 'font-size', 'large');
  change(w, 'contrast', 'high');
  change(w, 'saturation', 'low');
  change(w, 'cursor-size', 'small');
  assert.deepEqual(accessibilityValues(w), { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'small' });
  assert.equal(calls.length, 1);
  assert.match(d.querySelector('#preferences-form .form-status').textContent, /Save preferences to keep these settings on your account/);
});

test('reset accessibility previews defaults while preserving theme and reduced motion', async t => {
  const { w, d, calls } = await load(t, { settings: { theme: 'dark', reducedMotion: true, dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'low', cursorSize: 'large' } });
  d.getElementById('reset-accessibility').click();
  assert.deepEqual(accessibilityValues(w), accessibilityDefaults);
  assert.equal(d.getElementById('dyslexia-font').checked, false);
  for (const id of ['font-size', 'contrast', 'saturation', 'cursor-size']) assert.equal(d.getElementById(id).value, 'default');
  assert.equal(d.querySelector('input[name="theme"]:checked').value, 'dark');
  assert.equal(d.getElementById('reduced-motion').checked, true);
  assert.equal(calls.length, 1);
  assert.match(d.querySelector('#preferences-form .form-status').textContent, /Save preferences/);
});

test('Save preferences sends every accessibility value and keeps them after a successful response', async t => {
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => ({ data: { settings: { ...value, ...body } } }) });
  change(w, 'dyslexia-font', true); change(w, 'font-size', 'small'); change(w, 'contrast', 'high'); change(w, 'saturation', 'high'); change(w, 'cursor-size', 'large');
  d.querySelector('input[name="theme"][value="dark"]').checked = true;
  d.getElementById('reduced-motion').checked = true;
  submit(w, 'preferences-form'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/preferences');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)), { theme: 'dark', reducedMotion: true, dyslexiaFont: true, fontSize: 'small', contrast: 'high', saturation: 'high', cursorSize: 'large' });
  assert.deepEqual(accessibilityValues(w), { dyslexiaFont: true, fontSize: 'small', contrast: 'high', saturation: 'high', cursorSize: 'large' });
  assert.match(d.querySelector('#preferences-form .form-status').textContent, /have been saved/);
});

test('a failed account save retains the local accessibility preview and explains how to keep it on the account', async t => {
  const { w, d } = await load(t, { request: async () => ({ error: { message: 'Unable to save.' } }) });
  change(w, 'font-size', 'large');
  submit(w, 'preferences-form'); await settle();
  const status = d.querySelector('#preferences-form .form-status');
  assert.match(status.textContent, /Unable to save/);
  assert.match(status.textContent, /preview is still active/);
  assert.match(status.textContent, /Save preferences/);
  assert.equal(status.classList.contains('is-error'), true);
  assert.equal(accessibilityValues(w).fontSize, 'large');
  assert.equal(d.getElementById('font-size').disabled, false);
});

test('pending preferences disable all controls and block a duplicate submission', async t => {
  let finish;
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => new Promise(resolve => { finish = () => resolve({ data: { settings: { ...value, ...body } } }); }) });
  submit(w, 'preferences-form');
  assert.ok([...d.querySelectorAll('#preferences-form input, #preferences-form select, #preferences-form button')].every(field => field.disabled));
  submit(w, 'preferences-form');
  assert.equal(calls.filter(call => call.endpoint === 'settings/preferences').length, 1);
  finish(); await settle();
  assert.ok([...d.querySelectorAll('#preferences-form select')].every(field => !field.disabled));
});

test('accessibility controls and account saving still work when browser storage is denied', async t => {
  const { w, d, calls } = await load(t, { storageDenied: true, request: async (endpoint, body, value) => ({ data: { settings: { ...value, ...body } } }) });
  assert.equal(d.getElementById('settings-content').disabled, false);
  change(w, 'dyslexia-font', true); change(w, 'font-size', 'large');
  submit(w, 'preferences-form'); await settle();
  assert.equal(calls.at(-1).body.dyslexiaFont, true);
  assert.equal(calls.at(-1).body.fontSize, 'large');
  assert.match(d.querySelector('#preferences-form .form-status').textContent, /have been saved/);
});

test('avatar validates type and size, previews locally and uploads FormData on save', async t => {
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => ({ data: { settings: { ...value, avatarUrl: '/api/settings/avatar?version=new' } } }) });
  const field = d.getElementById('avatar-file');
  const choose = file => { Object.defineProperty(field, 'files', { configurable: true, value: [file] }); field.dispatchEvent(new w.Event('change')); };
  choose(new w.File(['bad'], 'bad.svg', { type: 'image/svg+xml' }));
  assert.match(d.getElementById('avatar-status').textContent, /Choose a JPG/);
  assert.equal(calls.length, 1);
  choose(new w.File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
  assert.equal(d.getElementById('avatar-preview-actions').hidden, true);
  choose(new w.File(['image bytes'], 'photo.png', { type: 'image/png' }));
  assert.equal(d.getElementById('avatar-preview-actions').hidden, false);
  assert.equal(calls.length, 1);
  d.getElementById('save-avatar').click(); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/avatar');
  assert.equal(calls.at(-1).body.get('avatar').name, 'photo.png');
  assert.equal(d.getElementById('avatar-preview-actions').hidden, true);
  assert.equal(d.getElementById('remove-avatar').disabled, false);
  assert.match(d.getElementById('profile-avatar').src, /version=new/);
});

test('deletion requires exact confirmation plus password and shows server failures in the dialog', async t => {
  const { w, d, calls } = await load(t, { request: async () => ({ error: { message: 'Incorrect password.' } }) });
  d.getElementById('open-delete').click();
  assert.equal(d.getElementById('delete-dialog').open, true);
  input(w, 'delete-confirmation', 'delete'); input(w, 'delete-password', 'password');
  assert.equal(d.getElementById('confirm-delete').disabled, true);
  input(w, 'delete-confirmation', 'DELETE');
  assert.equal(d.getElementById('confirm-delete').disabled, false);
  submit(w, 'delete-form'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/delete');
  assert.equal(calls.at(-1).body.confirmation, 'DELETE');
  assert.match(d.getElementById('delete-status').textContent, /Incorrect password/);
  assert.equal(d.getElementById('confirm-delete').disabled, false);
  d.getElementById('cancel-delete').click();
  assert.equal(d.getElementById('delete-password').value, '');
});

test('other-session revocation calls the server and retains the current page', async t => {
  const { d, calls } = await load(t);
  d.getElementById('revoke-sessions').click(); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/sessions/revoke');
  assert.match(d.getElementById('sessions-status').textContent, /still signed in here/);
});

test('data export downloads the server JSON response as a file', async t => {
  const { w, d, calls } = await load(t, { request: async () => ({ data: { profile: { displayName: 'Alex' }, progress: [1, 2] } }) });
  let downloaded;
  w.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  let exported;
  w.URL.createObjectURL = blob => { exported = blob; return 'blob:export'; };
  d.getElementById('export-data').click(); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/export');
  assert.match(downloaded, /^careerkraft-data-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(exported.type, 'application/json');
  assert.match(d.getElementById('export-status').textContent, /download has started/);
});

test('character picker shows the shared six-character catalog as accessible radio choices', async t => {
  const { d, calls } = await load(t);
  d.getElementById('choose-character').click();
  assert.equal(d.getElementById('character-dialog').open, true);
  const radios = [...d.querySelectorAll('#character-grid input[type="radio"]')];
  assert.equal(radios.length, 6);
  assert.deepEqual(radios.map(radio => radio.value), catalog.map(character => character.id));
  for (const character of catalog) {
    assert.equal(d.getElementById(`character-name-${character.id}`).textContent, character.name);
    assert.equal(d.getElementById(`character-description-${character.id}`).textContent, character.description);
    assert.match(d.querySelector(`#character-grid input[value="${character.id}"]`).nextElementSibling.querySelector('img').src, new RegExp(`/assets/avatars/${character.id}\\.png$`));
  }
  assert.equal(calls.length, 1);
  assert.ok(html.indexOf('assets/avatar-characters.js') < html.indexOf('src="settings.js"'));
});

test('saved character is shown in the hero and indicated when opening the chooser', async t => {
  const { d } = await load(t, { settings: { avatarCharacter: 'pip', avatarUrl: '/api/settings/avatar?version=saved' } });
  assert.equal(d.getElementById('avatar-character-summary').textContent, 'Your character: Pip');
  assert.match(d.getElementById('profile-avatar').alt, /Pip/);
  d.getElementById('choose-character').click();
  assert.equal(d.querySelector('#character-grid input:checked').value, 'pip');
  assert.equal(d.querySelectorAll('.character-current-badge').length, 1);
  assert.equal(d.getElementById('character-current-pip').textContent, 'Current avatar');
  assert.equal(d.getElementById('character-preview-name').textContent, 'Pip');
});

test('browsing character choices previews them locally without changing the saved profile', async t => {
  const { d, calls } = await load(t, { settings: { avatarCharacter: 'pip', avatarUrl: '/api/settings/avatar?version=saved' } });
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="mochi"]').click();
  assert.equal(d.getElementById('character-preview-name').textContent, 'Mochi');
  assert.match(d.getElementById('character-preview-image').src, /mochi\.png$/);
  assert.equal(calls.length, 1);
  assert.match(d.getElementById('profile-avatar').src, /version=saved$/);
  assert.equal(d.getElementById('avatar-character-summary').textContent, 'Your character: Pip');
});

test('cancel discards the browsed choice and reopening restores the saved selection', async t => {
  const { d, calls } = await load(t, { settings: { avatarCharacter: 'luna', avatarUrl: '/api/settings/avatar?version=saved' } });
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="bloop"]').click();
  d.getElementById('cancel-character').click();
  assert.equal(d.getElementById('character-dialog').open, false);
  assert.equal(d.activeElement, d.getElementById('choose-character'));
  d.getElementById('choose-character').click();
  assert.equal(d.querySelector('#character-grid input:checked').value, 'luna');
  assert.equal(calls.length, 1);
});

test('Use character explicitly saves the selected identity and updates the private avatar URL', async t => {
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => ({ data: { settings: { ...value, avatarCharacter: body.characterId, avatarUrl: '/api/settings/avatar?version=character' } } }) });
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="sprout"]').click();
  submit(w, 'character-form'); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/avatar/character');
  assert.equal(calls.at(-1).body.characterId, 'sprout');
  assert.equal(d.getElementById('character-dialog').open, false);
  assert.match(d.getElementById('profile-avatar').src, /version=character$/);
  assert.equal(d.getElementById('avatar-character-summary').textContent, 'Your character: Sprout');
  assert.match(d.getElementById('avatar-status').textContent, /Sprout is now/);
  d.getElementById('choose-character').click();
  assert.equal(d.querySelector('#character-grid input:checked').value, 'sprout');
});

test('failed character save keeps the previous avatar and allows retrying the selected character', async t => {
  const { w, d } = await load(t, { settings: { avatarCharacter: 'nova', avatarUrl: '/api/settings/avatar?version=saved' }, request: async () => ({ error: { message: 'Could not save your character.' } }) });
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="pip"]').click();
  submit(w, 'character-form'); await settle();
  assert.equal(d.getElementById('character-dialog').open, true);
  assert.equal(d.querySelector('#character-grid input:checked').value, 'pip');
  assert.match(d.getElementById('character-status').textContent, /Could not save/);
  assert.match(d.getElementById('profile-avatar').src, /version=saved$/);
  assert.equal(d.getElementById('avatar-character-summary').textContent, 'Your character: Nova');
  assert.equal(d.getElementById('save-character').disabled, false);
});

test('pending character save prevents duplicate submissions, closing and further selection', async t => {
  let finish;
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => new Promise(resolve => { finish = () => resolve({ data: { settings: { ...value, avatarCharacter: body.characterId, avatarUrl: '/api/settings/avatar?version=saved' } } }); }) });
  d.getElementById('choose-character').click();
  submit(w, 'character-form');
  assert.equal(d.getElementById('save-character').disabled, true);
  assert.equal(d.getElementById('cancel-character').disabled, true);
  assert.ok([...d.querySelectorAll('#character-grid input')].every(radio => radio.disabled));
  submit(w, 'character-form');
  const cancel = new w.Event('cancel', { cancelable: true });
  d.getElementById('character-dialog').dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(calls.filter(call => call.endpoint === 'settings/avatar/character').length, 1);
  finish(); await settle();
  assert.equal(d.getElementById('character-dialog').open, false);
});

test('cancelling the character chooser preserves an unsaved custom photo preview', async t => {
  const { w, d, calls } = await load(t);
  const field = d.getElementById('avatar-file');
  Object.defineProperty(field, 'files', { configurable: true, value: [new w.File(['image bytes'], 'photo.png', { type: 'image/png' })] });
  field.dispatchEvent(new w.Event('change'));
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="luna"]').click();
  d.getElementById('cancel-character').click();
  assert.equal(d.getElementById('avatar-preview-actions').hidden, false);
  assert.equal(d.getElementById('profile-avatar').src, 'blob:http://localhost/test-preview');
  assert.equal(calls.length, 1);
});

test('successfully choosing a character replaces and clears an unsaved photo preview', async t => {
  const { w, d, calls } = await load(t, { request: async (endpoint, body, value) => ({ data: { settings: { ...value, avatarCharacter: body.characterId, avatarUrl: '/api/settings/avatar?version=character' } } }) });
  const field = d.getElementById('avatar-file');
  Object.defineProperty(field, 'files', { configurable: true, value: [new w.File(['image bytes'], 'photo.png', { type: 'image/png' })] });
  field.dispatchEvent(new w.Event('change'));
  d.getElementById('choose-character').click();
  d.querySelector('#character-grid input[value="bloop"]').click();
  submit(w, 'character-form'); await settle();
  assert.equal(d.getElementById('avatar-preview-actions').hidden, true);
  assert.match(d.getElementById('profile-avatar').src, /version=character$/);
  assert.equal(d.getElementById('avatar-character-summary').textContent, 'Your character: Bloop');
  d.getElementById('save-avatar').click(); await settle();
  assert.equal(calls.filter(call => call.endpoint === 'settings/avatar').length, 0);
});

test('saving an uploaded photo clears the saved character and its selection badge', async t => {
  const { w, d } = await load(t, { settings: { avatarCharacter: 'pip', avatarUrl: '/api/settings/avatar?version=old' }, request: async (endpoint, body, value) => ({ data: { settings: { ...value, avatarCharacter: null, avatarUrl: '/api/settings/avatar?version=uploaded' } } }) });
  const field = d.getElementById('avatar-file');
  Object.defineProperty(field, 'files', { configurable: true, value: [new w.File(['image bytes'], 'photo.png', { type: 'image/png' })] });
  field.dispatchEvent(new w.Event('change'));
  d.getElementById('save-avatar').click(); await settle();
  assert.equal(d.getElementById('avatar-character-summary').hidden, true);
  assert.match(d.getElementById('profile-avatar').src, /version=uploaded$/);
  d.getElementById('choose-character').click();
  assert.equal(d.querySelectorAll('.character-current-badge').length, 0);
});

test('removing a saved character restores initials and clears the hero character label', async t => {
  const { d, calls } = await load(t, { settings: { avatarCharacter: 'pip', avatarUrl: '/api/settings/avatar?version=old' }, request: async (endpoint, body, value) => ({ data: { settings: { ...value, avatarCharacter: null, avatarUrl: null } } }) });
  d.getElementById('remove-avatar').click(); await settle();
  assert.equal(calls.at(-1).endpoint, 'settings/avatar/remove');
  assert.equal(d.getElementById('profile-avatar').hidden, true);
  assert.equal(d.getElementById('avatar-initials').hidden, false);
  assert.equal(d.getElementById('avatar-character-summary').hidden, true);
});

test('missing character catalog leaves custom photo controls available', async t => {
  const { d } = await load(t, { catalog: [] });
  assert.equal(d.getElementById('choose-character').disabled, true);
  assert.match(d.getElementById('choose-character').title, /couldn't load/);
  assert.equal(d.getElementById('change-avatar').disabled, false);
});
