const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('node:sqlite');
const { createApp } = require('../server');

const recipient = 'new-member@example.com';
const password = 'registration-password';
const publicKey = 'emailjs-public-test-key';
const privateKey = 'emailjs-private-test-key';
const accepted = () => new Response('OK', { status: 200 });
const tokenFrom = mail => new URL(mail.template_params.action_url).searchParams;

function actionLinkFrom(mail, page, tokenParameter = 'token') {
  const link = new URL(mail.template_params.action_url);
  assert.equal(link.origin, 'http://localhost:3000');
  assert.equal(link.pathname, '/' + page);
  assert.equal(link.href, mail.template_params.message.match(/https?:\/\/[^\s]+/)[0],
    'The button must open the same complete link as the email message.');
  assert.match(link.searchParams.get(tokenParameter), /^[a-f0-9]{64}$/);
  return link;
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Background email delivery did not settle.');
}

async function setup(t, delivery = accepted, overrides = {}) {
  const environment = {
    NODE_ENV: 'development', MAIL_MODE: 'emailjs', MAIL_FROM: '', BREVO: '', BREVO_API_KEY: '',
    EMAILJS_SERVICE_ID: 'service_test', EMAIL_SERVICE_ID: '',
    EMAILJS_TEMPLATE_ID: 'template_test', EMAILJS_PUBLIC_KEY: publicKey, EMAILJS_PRIVATE_KEY: privateKey,
    EMAILJS_RESET_TEMPLATE_ID: '', EMAILJS_TEMPLATE_ID1: '',
    PUBLIC_API_KEY: '', PRIVATE_API_KEY: '',
    ...overrides
  };
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
    fetchBrevo: () => assert.fail('EmailJS mode must use the selected delivery provider.'),
    fetchEmailJS: async (url, options) => {
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
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  return {
    db, mails, calls, infoLogs, errorLogs, request,
    register: (extra = {}) => request('/api/register', { email: ' New-Member@Example.com ', name: 'New Member', password, terms: true, ...extra })
  };
}

function assertPrivateLogs(context) {
  const logged = JSON.stringify([...context.infoLogs, ...context.errorLogs]);
  const secrets = [recipient, publicKey, privateKey, 'private-provider-error-text'];
  for (const mail of context.mails) {
    secrets.push(mail.template_params.message, mail.template_params.action_url,
      mail.template_params.to_email, ...tokenFrom(mail).values());
  }
  for (const secret of secrets) assert.equal(logged.includes(secret), false, 'Logs must omit keys, addresses, tokens, bodies and provider error text.');
}

test('EmailJS delivers hashed, single-use verification links and confirms email changes without MAIL_FROM', async t => {
  const context = await setup(t, accepted, { EMAILJS_RESET_TEMPLATE_ID: 'template_reset' });
  const registered = await context.register({ purpose: 'reset', template_id: 'template_reset' });
  assert.equal(registered.status, 202);
  assert.equal(registered.body.session, null);
  await waitFor(() => context.mails.length === 1);
  const { url, options } = context.calls[0];
  assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  const mail = context.mails[0];
  assert.equal(mail.service_id, 'service_test');
  assert.equal(mail.template_id, 'template_test');
  assert.equal(mail.user_id, publicKey);
  assert.equal(mail.accessToken, privateKey);
  assert.equal(mail.template_params.to_email, recipient);
  assert.equal(mail.template_params.subject, 'Verify your CareerKraft email');
  assert.equal(mail.template_params.message.includes('This link expires in 60 minutes'), true);
  const value = actionLinkFrom(mail, 'verify-email.html').searchParams.get('token');
  const saved = context.db.prepare('SELECT hash, purpose FROM tokens').get();
  assert.equal(saved.purpose, 'verify');
  assert.equal(saved.hash, createHash('sha256').update(value).digest('hex'));
  const verified = await context.request('/api/verify', { token: value });
  assert.equal(verified.status, 200);
  assert.equal((await context.request('/api/verify', { token: value })).status, 400);
  const newEmail = 'changed-member@example.org';
  const change = await context.request('/api/settings/email', {
    email: newEmail, currentPassword: password, purpose: 'reset', template_id: 'template_reset'
  }, verified.cookie);
  assert.equal(change.status, 200);
  assert.equal(context.mails.length, 2);
  assert.equal(context.mails[1].template_id, 'template_test');
  assert.equal(context.mails[1].template_params.to_email, newEmail);
  assert.equal(context.mails[1].template_params.subject, 'Confirm your new CareerKraft email');
  assert.equal(context.db.prepare('SELECT email FROM users').get().email, recipient);
  const emailToken = actionLinkFrom(context.mails[1], 'settings.html', 'emailToken').searchParams.get('emailToken');
  const confirmed = await context.request('/api/settings/email/confirm', { token: emailToken }, verified.cookie);
  assert.equal(confirmed.status, 200);
  assert.equal(context.db.prepare('SELECT email FROM users').get().email, newEmail);
  assert.equal((await context.request('/api/settings/email/confirm', { token: emailToken }, confirmed.cookie)).status, 400);
  assert.deepEqual(context.infoLogs, []);
  assert.deepEqual(context.errorLogs, []);
  assertPrivateLogs(context);
});

for (const scenario of [
  { name: 'canonical reset template', environment: { EMAILJS_RESET_TEMPLATE_ID: 'template_reset' }, template: 'template_reset' },
  { name: 'legacy reset template alias', environment: { EMAILJS_TEMPLATE_ID1: 'template_reset_legacy' }, template: 'template_reset_legacy' },
  { name: 'canonical reset template precedence', environment: { EMAILJS_RESET_TEMPLATE_ID: 'template_reset', EMAILJS_TEMPLATE_ID1: 'template_reset_legacy' }, template: 'template_reset' },
  { name: 'unset reset template fallback', environment: {}, template: 'template_test' }
]) {
  test('EmailJS ' + scenario.name + ' preserves single-use resend and password-reset links', async t => {
    const context = await setup(t, accepted, {
      EMAILJS_SERVICE_ID: '', EMAIL_SERVICE_ID: 'legacy_service_test', ...scenario.environment
    });
    assert.equal((await context.register()).status, 202);
    await waitFor(() => context.mails.length === 1);
    assert.equal(context.mails[0].service_id, 'legacy_service_test');
    assert.equal(context.mails[0].template_id, 'template_test');
    const oldToken = actionLinkFrom(context.mails[0], 'verify-email.html').searchParams.get('token');
    assert.equal((await context.request('/api/resend', { email: recipient, purpose: 'reset', template_id: 'template_user_selected' })).status, 200);
    await waitFor(() => context.mails.length === 2);
    assert.equal(context.mails[1].template_id, 'template_test');
    assert.equal((await context.request('/api/verify', { token: oldToken })).status, 400);
    const resentToken = actionLinkFrom(context.mails[1], 'verify-email.html').searchParams.get('token');
    assert.notEqual(resentToken, oldToken);
    const verified = await context.request('/api/verify', { token: resentToken });
    assert.equal(verified.status, 200);
    assert.equal((await context.request('/api/verify', { token: resentToken })).status, 400);
    assert.equal((await context.request('/api/forgot-password', { email: recipient, purpose: 'verify', template_id: 'template_user_selected' })).status, 200);
    await waitFor(() => context.mails.length === 3);
    assert.equal(context.mails[2].template_id, scenario.template);
    assert.equal(context.mails[2].template_params.subject, 'Reset your CareerKraft password');
    const resetToken = actionLinkFrom(context.mails[2], 'reset-password.html').searchParams.get('token');
    const saved = context.db.prepare('SELECT hash FROM tokens WHERE purpose=?').get('reset');
    assert.equal(saved.hash, createHash('sha256').update(resetToken).digest('hex'));
    assert.equal((await context.request('/api/reset-password', { token: resetToken, password: 'a different new test passphrase' })).status, 200);
    assert.equal((await context.request('/api/session', undefined, verified.cookie)).body.session, null);
    assert.equal((await context.request('/api/reset-password', { token: resetToken, password })).status, 400);
    assertPrivateLogs(context);
  });
}

test('an invalid reset template leaves verification working and removes the failed reset token', async t => {
  const context = await setup(t, accepted, { EMAILJS_RESET_TEMPLATE_ID: 'private-reset-template\nInjected' });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.mails.length === 1);
  assert.equal(context.mails[0].template_id, 'template_test');
  const verified = await context.request('/api/verify', {
    token: actionLinkFrom(context.mails[0], 'verify-email.html').searchParams.get('token')
  });
  assert.equal(verified.status, 200);
  assert.equal((await context.request('/api/forgot-password', { email: recipient })).status, 200);
  await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
  assert.equal(context.mails.length, 1, 'Invalid reset configuration must not send through the primary template.');
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens WHERE purpose=?').get('reset').count, 0);
  assert.deepEqual(context.errorLogs.find(entry => entry[0] === 'EmailJS email failed.'), [
    'EmailJS email failed.', { code: 'CONFIGURATION', status: null }
  ]);
  assert.notEqual((await context.request('/api/session', undefined, verified.cookie)).body.session, null);
  assertPrivateLogs(context);
  assert.equal(JSON.stringify(context.errorLogs).includes('private-reset-template'), false);
});

test('EmailJS supports the existing PUBLIC_API_KEY and PRIVATE_API_KEY environment aliases', async t => {
  const context = await setup(t, accepted, {
    EMAILJS_PUBLIC_KEY: '', EMAILJS_PRIVATE_KEY: '',
    PUBLIC_API_KEY: publicKey, PRIVATE_API_KEY: privateKey
  });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.mails.length === 1);
  assert.equal(context.mails[0].user_id, publicKey);
  assert.equal(context.mails[0].accessToken, privateKey);
  assert.deepEqual(context.errorLogs, []);
  assertPrivateLogs(context);
});

for (const scenario of [
  { name: 'authentication rejection', delivery: mail => new Response('private-provider-error-text ' + privateKey + mail.template_params.message, { status: 401 }) },
  { name: 'unexpected success body', delivery: () => new Response('private-provider-error-text', { status: 200 }) },
  { name: 'network failure', delivery: mail => { throw new Error('private-provider-error-text ' + privateKey + mail.template_params.message); } }
]) {
  test('EmailJS ' + scenario.name + ' keeps registration neutral and removes unusable tokens', async t => {
    const context = await setup(t, scenario.delivery);
    const result = await context.register();
    assert.equal(result.status, 202);
    assert.equal(result.body.success, true);
    assert.equal(result.body.user, undefined);
    assert.equal(result.body.code, undefined);
    await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
    const failures = context.errorLogs.filter(entry => entry[0] === 'EmailJS email failed.');
    assert.equal(failures.length, 1);
    assert.deepEqual(Object.keys(failures[0][1]).sort(), ['code', 'status']);
    assert.deepEqual(context.infoLogs, []);
    assertPrivateLogs(context);
  });
}

test('missing EmailJS template or public key never sends and cleans up its verification token', async t => {
  const context = await setup(t, accepted, { EMAILJS_TEMPLATE_ID: '', EMAILJS_PUBLIC_KEY: '' });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
  assert.equal(context.calls.length, 0);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  assertPrivateLogs(context);
});

test('EmailJS credentials do not switch the active provider without MAIL_MODE=emailjs', async t => {
  const context = await setup(t, accepted, { MAIL_MODE: '' });
  assert.equal((await context.register()).status, 202);
  await waitFor(() => context.errorLogs.some(entry => entry[0] === 'Authentication email delivery failed.'));
  assert.equal(context.calls.length, 0);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  assertPrivateLogs(context);
});
