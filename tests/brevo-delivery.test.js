const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');

const recipient = 'new-member@example.com';
const senderEmail = 'mail-owner@example.net';
const sender = 'CareerKraft <' + senderEmail + '>';
const apiKey = 'fake-brevo-api-key-for-tests';
const password = 'registration-password';
const accepted = () => new Response(JSON.stringify({ messageId: 'brevo-test-message-id' }), { status: 201 });
const tokenFrom = mail => new URL(mail.textContent.match(/https?:\/\/[^\s]+/)[0]).searchParams;

async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Background email delivery did not settle.');
}

async function setup(t, delivery = accepted, overrides = {}) {
  const environment = { NODE_ENV: 'development', MAIL_MODE: 'brevo', BREVO: apiKey, BREVO_API_KEY: '', MAIL_FROM: sender, ...overrides };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const mails = [], calls = [], infoLogs = [], errorLogs = [];
  t.mock.method(console, 'info', (...args) => infoLogs.push(args));
  t.mock.method(console, 'error', (...args) => errorLogs.push(args));
  const { app, db } = createApp({
    database: ':memory:', base: 'http://localhost:3000',
    fetchBrevo: async (url, options) => {
      calls.push({ url, options });
      const mail = JSON.parse(options.body);
      mails.push(mail);
      return delivery(mail, options);
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  async function request(endpoint, body, cookie = '') {
    const response = await fetch('http://127.0.0.1:' + server.address().port + endpoint, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  return {
    db, mails, calls, infoLogs, errorLogs, request,
    register: () => request('/api/register', { email: ' New-Member@Example.com ', name: 'New Member', password, terms: true })
  };
}

function assertPrivateLogs(context) {
  const logged = JSON.stringify([...context.infoLogs, ...context.errorLogs]);
  const secrets = [recipient, senderEmail, sender, apiKey, 'private-provider-error-text'];
  for (const mail of context.mails) {
    secrets.push(mail.textContent, ...mail.to.map(value => value.email), ...tokenFrom(mail).values());
  }
  for (const secret of secrets) assert.equal(logged.includes(secret), false, 'Logs must omit addresses, API keys, tokens, bodies and provider error text.');
}

test('Brevo verification and email changes use the configured sender and single-use links', async t => {
  const context = await setup(t);
  const registered = await context.register();
  assert.equal(registered.status, 202);
  await waitFor(() => context.mails.length === 1);
  const { url, options } = context.calls[0];
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['api-key'], apiKey);
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  const mail = context.mails[0];
  assert.deepEqual(mail.sender, { name: 'CareerKraft', email: senderEmail });
  assert.deepEqual(mail.to, [{ email: recipient }]);
  assert.equal(mail.subject, 'Verify your CareerKraft email');
  assert.equal(mail.textContent.includes('This link expires in 60 minutes'), true);
  const value = tokenFrom(mail).get('token');
  const saved = context.db.prepare('SELECT hash, purpose FROM tokens').get();
  assert.equal(saved.purpose, 'verify');
  assert.equal(saved.hash, createHash('sha256').update(value).digest('hex'));
  const verified = await context.request('/api/verify', { token: value });
  assert.equal(verified.status, 200);
  assert.equal(context.db.prepare('SELECT verified FROM users').get().verified, 1);
  assert.equal((await context.request('/api/verify', { token: value })).status, 400);
  const newEmail = 'changed-member@example.org';
  const change = await context.request('/api/settings/email', { email: newEmail, currentPassword: password }, verified.cookie);
  assert.equal(change.status, 200);
  assert.equal(context.mails.length, 2);
  assert.deepEqual(context.mails[1].to, [{ email: newEmail }]);
  assert.equal(context.mails[1].subject, 'Confirm your new CareerKraft email');
  assert.equal(context.db.prepare('SELECT email FROM users').get().email, recipient);
  const confirmed = await context.request('/api/settings/email/confirm', { token: tokenFrom(context.mails[1]).get('emailToken') }, verified.cookie);
  assert.equal(confirmed.status, 200);
  assert.equal(context.db.prepare('SELECT email FROM users').get().email, newEmail);
  assert.deepEqual(context.infoLogs, []);
  assert.deepEqual(context.errorLogs, []);
  assertPrivateLogs(context);
});

test('BREVO_API_KEY takes precedence and Brevo resend/reset preserve token replacement', async t => {
  const context = await setup(t, accepted, { BREVO_API_KEY: apiKey, BREVO: 'unused-legacy-api-key' });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.mails.length === 1);
  assert.equal(context.calls[0].options.headers['api-key'], apiKey);
  const oldToken = tokenFrom(context.mails[0]).get('token');
  assert.equal((await context.request('/api/resend', { email: recipient })).status, 200);
  await waitFor(() => context.mails.length === 2);
  assert.equal((await context.request('/api/verify', { token: oldToken })).status, 400);
  assert.equal((await context.request('/api/verify', { token: tokenFrom(context.mails[1]).get('token') })).status, 200);
  assert.equal((await context.request('/api/forgot-password', { email: recipient })).status, 200);
  await waitFor(() => context.mails.length === 3);
  assert.equal(context.mails[2].subject, 'Reset your CareerKraft password');
  const resetToken = tokenFrom(context.mails[2]).get('token');
  assert.equal((await context.request('/api/reset-password', { token: resetToken, password: 'a different new test passphrase' })).status, 200);
  assert.equal((await context.request('/api/reset-password', { token: resetToken, password })).status, 400);
  assertPrivateLogs(context);
});

for (const scenario of [
  { name: 'authentication rejection', delivery: mail => new Response(JSON.stringify({ message: 'private-provider-error-text ' + apiKey + mail.textContent }), { status: 401 }) },
  { name: 'rate limit', delivery: () => new Response('{}', { status: 429 }) },
  { name: 'missing message ID', delivery: () => new Response('{}', { status: 201 }) },
  { name: 'network failure', delivery: mail => { throw new Error('private-provider-error-text ' + apiKey + mail.textContent); } },
  { name: 'timeout', delivery: () => { throw new DOMException('private-provider-error-text ' + apiKey, 'TimeoutError'); } }
]) {
  test('Brevo ' + scenario.name + ' keeps registration neutral and removes unusable tokens', async t => {
    const context = await setup(t, scenario.delivery);
    const result = await context.register();
    assert.equal(result.status, 202);
    assert.equal(result.body.success, true);
    assert.equal(result.body.user, undefined);
    assert.equal(result.body.code, undefined);
    await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
    const failures = context.errorLogs.filter(entry => entry[0] === 'Brevo email failed.');
    assert.equal(failures.length, 1);
    assert.deepEqual(Object.keys(failures[0][1]).sort(), ['code', 'status']);
    assert.deepEqual(context.infoLogs, []);
    assertPrivateLogs(context);
  });
}

test('missing Brevo configuration never sends and cleans up its verification token', async t => {
  const context = await setup(t, accepted, { BREVO: '', BREVO_API_KEY: '' });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
  assert.equal(context.calls.length, 0);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  assertPrivateLogs(context);
});
