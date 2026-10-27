const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('theme toggle works when browser storage is blocked and announces the active theme', t => {
  const dom = new JSDOM('<html data-theme="light"><button id="auth-theme-toggle"></button></html>',
    { url: 'http://localhost/auth.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  dom.window.eval(fs.readFileSync(path.join(root, 'auth-theme.js'), 'utf8'));
  const button = dom.window.document.querySelector('button');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Switch to light mode');
  button.click();
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Switch to dark mode');
});

test('auth page loads without Supabase, switches forms, validates and submits through its API', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'auth.html'), 'utf8'), { url: 'http://localhost:3000/auth.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const requests = [];
  window.console.error = () => {};
  window.fetch = async (url, options) => {
    requests.push({ url, ...options });
    if (url === '/api/session') return { ok: true, json: async () => ({ session: null }) };
    return { ok: false, json: async () => ({ error: url === '/api/register' ? 'Too many requests. Try again later.' : 'Unable to sign in with these details.', code: 'invalid_credentials' }) };
  };
  const scripts = [...window.document.querySelectorAll('script[src]')].filter(node => !node.src.startsWith('https://'));
  for (const node of scripts) assert.equal(fs.existsSync(path.join(root, node.getAttribute('src'))), true, node.src);
  for (const file of ['auth-api.js', 'auth.js', 'auth-theme.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await settle();
  const document = window.document;
  assert.equal(window.supabase, undefined);
  assert.equal(document.querySelector('#register-form').classList.contains('hidden'), true);
  document.querySelector('#register-tab').click();
  assert.equal(document.querySelector('#register-form').classList.contains('hidden'), false);
  assert.equal(document.querySelector('#login-form').classList.contains('hidden'), true);
  const submit = selector => document.querySelector(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  submit('#register-form');
  assert.match(document.querySelector('#register-message').textContent, /enter your name/);
  document.querySelector('#register-name').value = 'Tester';
  document.querySelector('#register-email').value = 'tester@example.com';
  document.querySelector('#register-password').value = 'harbour-maple-orbit-31';
  document.querySelector('#confirm-password').value = 'harbour-maple-orbit-31';
  document.querySelector('#register-terms').checked = true;
  document.querySelector('[data-target="register-password"]').click();
  assert.equal(document.querySelector('#register-password').type, 'text');
  submit('#register-form');
  await settle();
  assert.equal(JSON.parse(requests.find(r => r.url === '/api/register').body).name, 'Tester');
  assert.equal(document.querySelector('#register-button').disabled, false);
  assert.match(document.querySelector('#register-message').textContent, /Too many requests/);
  document.querySelector('#auth-switch-button').click();
  assert.equal(document.querySelector('#login-form').classList.contains('hidden'), false);
  document.querySelector('#login-email').value = 'tester@example.com';
  document.querySelector('#login-password').value = 'wrong-password';
  submit('#login-form');
  await settle();
  assert.ok(requests.some(r => r.url === '/api/login'));
  assert.equal(document.querySelector('#login-button').disabled, false);
  assert.match(document.querySelector('#login-message').textContent, /Unable to sign in with these details/);
  document.querySelector('#forgot-password').click();
  await settle();
  assert.ok(requests.some(r => r.url === '/api/forgot-password'));
  document.querySelector('#auth-theme-toggle').click();
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('every auth page loads the shared client before its page script, and local scripts exist', () => {
  for (const [page, script] of [['auth.html', 'auth.js'], ['verify-email.html', 'verify-email.js'], ['onboarding.html', 'onboarding.js'], ['reset-password.html', 'reset-password.js']]) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, page), 'utf8'));
    const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(node => node.getAttribute('src'));
    assert.ok(scripts.indexOf('auth-api.js') < scripts.findIndex(value => value.replace('./', '') === script), page);
    for (const file of scripts.filter(file => !file.startsWith('https://'))) assert.ok(fs.existsSync(path.join(root, file)), `${page}: ${file}`);
    dom.window.close();
  }
});

test('introduction and signed-in pages share the saved theme and light default', () => {
  for (const page of ['index.html', 'auth.html', 'onboarding.html', 'career.html', 'dashboard.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const darkDom = new JSDOM(html, { url: `http://localhost:3000/${page}`, runScripts: 'outside-only' });
    darkDom.window.localStorage.setItem('careerkraft-theme', 'dark');
    const themeScript = [...darkDom.window.document.querySelectorAll('script:not([src])')]
      .find(node => node.textContent.includes('careerkraft-theme'));
    assert.ok(themeScript, `${page} should initialize its theme before rendering`);
    darkDom.window.eval(themeScript.textContent);
    assert.equal(darkDom.window.document.documentElement.dataset.theme, 'dark', `${page} restores dark mode`);
    darkDom.window.close();

    const lightDom = new JSDOM(html, { url: `http://localhost:3000/${page}`, runScripts: 'outside-only' });
    const lightThemeScript = [...lightDom.window.document.querySelectorAll('script:not([src])')]
      .find(node => node.textContent.includes('careerkraft-theme'));
    assert.ok(lightThemeScript, `${page} should initialize its theme before rendering`);
    lightDom.window.eval(lightThemeScript.textContent);
    assert.equal(lightDom.window.document.documentElement.dataset.theme, 'light', `${page} defaults to light mode`);
    lightDom.window.close();
  }
});

test('sign-in destination uses the authenticated user saved career', async t => {
  const script = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
  for (const selectedCareer of [null, { id: 'teacher', title: 'Teacher' }]) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'auth.html'), 'utf8'), { url: 'http://localhost:3000/auth.html', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.careerAuth = {
      getSession: async () => ({ data: { session: null } }),
      request: async endpoint => {
        assert.equal(endpoint, 'assessment');
        return { data: { selectedCareer }, error: null };
      }
    };
    dom.window.eval(script);
    await settle();
    const destination = await dom.window.resolvePostAuthUrl();
    assert.equal(new URL(destination).pathname, selectedCareer ? '/dashboard.html' : '/onboarding.html');
  }
});

async function authPage(t, options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'auth.html'), 'utf8'), { url: options.url || 'http://localhost:3000/auth.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom;
  const calls = [], logs = [], verification = [];
  w.console.error = (...args) => logs.push(args);
  w.console.log = (...args) => logs.push(args);
  w.careerAuth = {
    getSession: async () => ({ data: { session: null } }),
    signUp: async body => { calls.push({ endpoint: 'register', body }); return options.signUp ? options.signUp(body) : { data: { success: true, session: null, message: 'If this address can be used, an email with the next steps will arrive shortly.' } }; },
    signInWithPassword: async body => { calls.push({ endpoint: 'login', body }); return options.login ? options.login(body) : { error: { message: 'Unable to sign in with these details.', code: 'invalid_credentials' } }; },
    resetPasswordForEmail: async email => { calls.push({ endpoint: 'forgot-password', email }); return options.forgot ? options.forgot(email) : { data: { success: true, message: 'If this address is eligible, an email with the next steps will arrive shortly.' } }; },
    signInWithOAuth: options.oauth || (async () => ({ data: {}, error: null }))
  };
  w.eval(fs.readFileSync(path.join(root, 'auth.js'), 'utf8'));
  w.openVerification = email => verification.push(email);
  await settle();
  const d = w.document;
  const register = password => {
    d.getElementById('register-tab').click();
    d.getElementById('register-name').value = 'Tester';
    d.getElementById('register-email').value = 'tester@example.com';
    d.getElementById('register-password').value = password;
    d.getElementById('confirm-password').value = password;
    d.getElementById('register-terms').checked = true;
    d.getElementById('register-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  };
  return { w, d, calls, logs, verification, register };
}

test('registration validates both password length boundaries without trimming Unicode or spaces', async t => {
  const { d, calls, register } = await authPage(t, { signUp: async () => ({ error: { message: 'Choose a unique passphrase.' } }) });
  for (const password of ['short-password', 'x'.repeat(129)]) {
    register(password); await settle();
    assert.equal(calls.length, 0);
    assert.match(d.getElementById('register-message').textContent, /15–128/);
  }
  const password = '  星空と川のあいだを歩く 😀  ';
  register(password); await settle();
  assert.equal(calls[0].body.password, password);
  assert.equal(d.getElementById('register-password').minLength, 15);
  assert.equal(d.getElementById('register-password').maxLength, 128);
  assert.equal(d.getElementById('confirm-password').minLength, 15);
});

test('accepted registration uses neutral verification instructions and never logs account data', async t => {
  const { d, calls, logs, verification, register } = await authPage(t);
  register('harbour-maple-orbit-31'); await settle();
  assert.equal(calls[0].endpoint, 'register');
  assert.deepEqual(verification, ['tester@example.com']);
  assert.equal(d.getElementById('register-message').textContent, 'If this address can be used, an email with the next steps will arrive shortly.');
  assert.doesNotMatch(d.getElementById('register-message').textContent, /created|already|sent/i);
  assert.deepEqual(logs, []);
});

test('legacy short login passwords still reach the API and invalid credentials stay generic', async t => {
  const { w, d, calls, verification, logs } = await authPage(t);
  d.getElementById('login-email').value = 'tester@example.com';
  d.getElementById('login-password').value = 'old';
  d.getElementById('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(calls[0].body.password, 'old');
  assert.equal(d.getElementById('login-message').textContent, 'Unable to sign in with these details.');
  assert.deepEqual(verification, []);
  assert.deepEqual(logs, []);
  assert.equal(d.getElementById('login-password').hasAttribute('minlength'), false);
});

test('an explicit missing-account sign-in response opens registration with the submitted email and cleared passwords', async t => {
  let finishLogin;
  const { w, d, calls, verification, logs } = await authPage(t, { login: () => new Promise(resolve => { finishLogin = resolve; }) });
  const loginButton = d.getElementById('login-button');
  const originalText = loginButton.querySelector('span').textContent;
  d.getElementById('login-email').value = '  Missing.Person@EXAMPLE.COM  ';
  d.getElementById('login-password').value = 'submitted-login-password';
  d.getElementById('register-email').value = 'previous@example.com';
  d.getElementById('register-password').value = 'previous-registration-password';
  d.getElementById('confirm-password').value = 'previous-registration-password';
  d.getElementById('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(loginButton.disabled, true);
  assert.equal(loginButton.querySelector('span').textContent, 'Signing in...');
  finishLogin({ error: { message: 'An account with this email address does not exist.', code: 'account_not_found' } });
  await settle();
  assert.equal(d.getElementById('register-form').classList.contains('hidden'), false);
  assert.equal(d.getElementById('login-form').classList.contains('hidden'), true);
  assert.equal(d.title, 'Create an account | CareerKraft');
  assert.equal(d.getElementById('register-email').value, 'missing.person@example.com');
  assert.match(d.getElementById('register-message').textContent, /does not exist.*Create your account/);
  assert.equal(d.getElementById('register-message').classList.contains('error'), true);
  assert.equal(d.activeElement.id, 'register-name');
  for (const id of ['login-password', 'register-password', 'confirm-password']) assert.equal(d.getElementById(id).value, '');
  assert.equal(loginButton.disabled, false);
  assert.equal(loginButton.querySelector('span').textContent, originalText);
  assert.equal(calls.length, 1, 'Switching forms makes no extra account lookup or registration request');
  assert.equal(calls[0].endpoint, 'login');
  assert.equal(calls[0].body.email, 'missing.person@example.com');
  assert.equal(calls[0].body.password, 'submitted-login-password');
  assert.deepEqual(verification, []);
  assert.deepEqual(logs, []);
});

test('incorrect credentials, connection failures and rate limits keep sign-in open without guessing account existence', async t => {
  for (const error of [
    { message: 'Unable to sign in with these details.', code: 'invalid_credentials' },
    { message: 'Unable to connect. Please try again.' },
    { message: 'Too many requests. Try again later.' },
    { message: 'An account with this email address does not exist.' }
  ]) {
    const { w, d, calls } = await authPage(t, { login: async () => ({ error }) });
    const originalText = d.getElementById('login-button').querySelector('span').textContent;
    d.getElementById('login-email').value = 'tester@example.com';
    d.getElementById('login-password').value = 'incorrect-password';
    d.getElementById('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(d.getElementById('register-form').classList.contains('hidden'), true);
    assert.equal(d.getElementById('login-form').classList.contains('hidden'), false);
    assert.equal(d.getElementById('login-message').textContent, error.message);
    assert.equal(d.getElementById('register-message').textContent, '');
    assert.equal(d.getElementById('register-email').value, '');
    assert.equal(d.getElementById('login-button').disabled, false);
    assert.equal(d.getElementById('login-button').querySelector('span').textContent, originalText);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, 'login');
  }
});

test('forgot-password displays a missing-account error without switching forms and restores its request control', async t => {
  let finishReset;
  const { d, calls, logs } = await authPage(t, { forgot: () => new Promise(resolve => { finishReset = resolve; }) });
  const button = d.getElementById('forgot-password');
  const originalText = button.textContent;
  d.getElementById('login-email').value = 'missing@example.com';
  button.click();
  await settle();
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  finishReset({ error: { message: 'An account with this email address does not exist.', code: 'account_not_found' } });
  await settle();
  assert.equal(d.getElementById('login-message').textContent, 'An account with this email address does not exist.');
  assert.equal(d.getElementById('login-message').classList.contains('error'), true);
  assert.equal(d.getElementById('login-form').classList.contains('hidden'), false);
  assert.equal(d.getElementById('register-form').classList.contains('hidden'), true);
  assert.equal(button.hasAttribute('aria-disabled'), false);
  assert.equal(button.hasAttribute('aria-busy'), false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, originalText);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, 'forgot-password');
  assert.equal(calls[0].email, 'missing@example.com');
  assert.deepEqual(logs, []);
});

test('forgot-password shows neutral eligibility text and preserves server rate-limit feedback', async t => {
  let limited = false;
  const { d, logs } = await authPage(t, { forgot: async () => limited
    ? { error: { message: 'Too many email requests. Try again later.' } }
    : { data: { success: true, message: 'If this address is eligible, an email with the next steps will arrive shortly.' } } });
  d.getElementById('login-email').value = 'tester@example.com';
  d.getElementById('forgot-password').click(); await settle();
  assert.equal(d.getElementById('login-message').textContent, 'If this address is eligible, an email with the next steps will arrive shortly.');
  assert.equal(d.getElementById('forgot-password').hasAttribute('aria-disabled'), false);
  limited = true; d.getElementById('forgot-password').click(); await settle();
  assert.match(d.getElementById('login-message').textContent, /Too many email requests/);
  assert.deepEqual(logs, []);
});

test('Google collision callbacks reveal no account-existence details', async t => {
  for (const code of ['google_failed', 'google_existing_account']) {
    const { d } = await authPage(t, { url: `http://localhost:3000/auth.html?error=${code}` });
    assert.equal(d.getElementById('login-message').textContent,
      'Google sign-in failed. If you registered with a password, sign in with it, then connect Google in Account settings.');
    assert.doesNotMatch(d.getElementById('login-message').textContent, /already|existing|uses this email/);
  }
});

test('signup entry opens registration with its own useful title', async t => {
  const { d } = await authPage(t, { url: 'http://localhost:3000/auth.html?mode=signup' });
  assert.equal(d.title, 'Create an account | CareerKraft');
  assert.equal(d.getElementById('register-form').classList.contains('hidden'), false);
  d.getElementById('login-tab').click();
  assert.equal(d.title, 'Sign in | CareerKraft');
});

test('failed Google startup restores its control and displays a retry message', async t => {
  const { d, logs } = await authPage(t, { oauth: async () => { throw new Error('Preview connection failure'); } });
  const button = d.getElementById('google-login');
  const original = button.textContent;
  button.click(); await settle();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, original);
  assert.match(d.getElementById('login-message').textContent, /Google sign in failed/);
  assert.deepEqual(logs, []);
});

test('password reset enforces15–128 characters, preserves exact credentials and clears them on success', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'reset-password.html'), 'utf8'), { url: 'http://localhost:3000/reset-password.html?token=private-token', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom, d = w.document, calls = [];
  let fail = true;
  w.careerAuth = { request: async (endpoint, body) => { calls.push({ endpoint, body }); return fail ? { error: { message: 'Too many requests. Try again later.' } } : { data: { success: true } }; } };
  w.eval(fs.readFileSync(path.join(root, 'reset-password.js'), 'utf8'));
  const submitPassword = password => { d.getElementById('new-password').value = password; d.getElementById('repeat-password').value = password; d.getElementById('reset-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
  assert.equal(w.location.search, '');
  for (const password of ['short-password', 'x'.repeat(129)]) {
    submitPassword(password); await settle();
    assert.equal(calls.length, 0);
    assert.match(d.getElementById('reset-message').textContent, /15–128/);
  }
  const password = '  星空と川のあいだを歩く 😀  ';
  submitPassword(password); await settle();
  assert.equal(calls[0].body.password, password);
  assert.equal(calls[0].body.token, 'private-token');
  assert.match(d.getElementById('reset-message').textContent, /Too many requests/);
  assert.equal(d.querySelector('#reset-form button').disabled, false);
  fail = false; submitPassword(password); await settle();
  assert.equal(d.getElementById('reset-form').hidden, true);
  assert.equal(d.getElementById('new-password').value, '');
  assert.equal(d.getElementById('repeat-password').value, '');
});
