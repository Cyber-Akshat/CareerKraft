const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('verification page removes the link token, shows Email verified and opens onboarding', async () => {
  const element = () => ({ textContent: '', className: '', hidden: false, classList: { add() {}, remove() {} }, addEventListener() {} });
  const nodes = new Map();
  const get = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const steps = [0, 1, 2].map(() => ({ ...element(), querySelector: key => get(`step-${key}`) }));
  const descriptions = [element(), element()];
  const connectors = [element(), element()];
  const replaced = [];
  const redirects = [];
  const requests = [];
  const timers = [];
  const user = { email: 'tester@example.com', email_confirmed_at: true };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../verify-email.js'), 'utf8'), {
    URL, URLSearchParams, console, setTimeout: callback => timers.push(callback),
    window: {
      careerAuth: { request: async (endpoint, body) => { requests.push({ endpoint, body }); return { error: null }; }, getUser: async () => ({ data: { user } }) },
      location: { search: '?token=test-link', hash: '', href: 'http://localhost:3000/verify-email.html?token=test-link', pathname: '/verify-email.html', replace: value => redirects.push(value) },
      history: { replaceState: (state, title, value) => replaced.push(value) },
      setTimeout: callback => timers.push(callback), addEventListener() {}
    },
    document: { title: '', body: element(), querySelector: get, querySelectorAll: key => key === '.verification-step' ? steps : key === '.step-connector' ? connectors : descriptions }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].endpoint, 'verify');
  assert.equal(requests[0].body.token, 'test-link');
  assert.equal(replaced[0], '/verify-email.html');
  assert.equal(get('.verify-status h1').textContent, 'Email verified');
  assert.equal(get('#resend-email').hidden, true);
  assert.equal(get('.verify-secondary-button').href, 'http://localhost:3000/onboarding.html');
  timers.forEach(callback => callback());
  assert.deepEqual(redirects, ['http://localhost:3000/onboarding.html']);
});

test('verification instructions stay neutral for unconfirmed registration and old delivery parameters', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../verify-email.html'), 'utf8'), { url: 'http://localhost:3000/verify-email.html?email=tester@example.com&delivery=failed', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom;
  const logs = [];
  w.console.error = (...args) => logs.push(args);
  w.careerAuth = { getUser: async () => ({ data: { user: null } }) };
  w.eval(fs.readFileSync(path.join(__dirname, '../verify-email.js'), 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(w.document.querySelector('.verify-description').textContent, /If this address can be used/);
  assert.match(w.document.querySelector('.verification-step strong').textContent, /Request received/);
  assert.doesNotMatch(w.document.querySelector('.verify-content').textContent, /Account created|account is ready|account is saved|We've sent a verification/i);
  assert.equal(w.document.querySelector('#verify-message').textContent, '');
  assert.equal(w.document.querySelector('#verification-email').textContent, 'tester@example.com');
  assert.deepEqual(logs, []);
});

test('resend verification displays neutral eligibility instructions without logging account responses', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../verify-email.html'), 'utf8'), { url: 'http://localhost:3000/verify-email.html?email=tester@example.com', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom, calls = [], logs = [];
  w.console.error = (...args) => logs.push(args);
  w.careerAuth = {
    getUser: async () => ({ data: { user: null } }),
    resend: async body => { calls.push(body); return { data: { success: true, message: 'If this address is eligible, an email with the next steps will arrive shortly.' } }; }
  };
  w.eval(fs.readFileSync(path.join(__dirname, '../verify-email.js'), 'utf8'));
  w.document.querySelector('#resend-email').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].email, 'tester@example.com');
  assert.equal(w.document.querySelector('#verify-message').textContent, 'If this address is eligible, an email with the next steps will arrive shortly.');
  assert.deepEqual(logs, []);
});

test('invalid callback links scrub tokens before displaying a generic error', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../verify-email.html'), 'utf8'), { url: 'http://localhost:3000/verify-email.html?token=private-token&error=private-provider-error', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window: w } = dom;
  const calls = [];
  w.careerAuth = { request: async (...args) => { calls.push(args); }, getUser: async (...args) => { calls.push(args); } };
  w.eval(fs.readFileSync(path.join(__dirname, '../verify-email.js'), 'utf8'));
  assert.equal(w.location.search, '');
  assert.equal(calls.length, 0);
  assert.match(w.document.querySelector('#verify-message').textContent, /invalid or has expired/);
  assert.doesNotMatch(w.document.querySelector('#verify-message').textContent, /private-/);
});
