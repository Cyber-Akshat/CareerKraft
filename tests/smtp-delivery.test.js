const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const nodemailer = require('nodemailer');
const { createApp } = require('../server');

const recipient = 'new-member@example.com';
const smtpUser = 'mail-owner@example.net';
const smtpPassword = 'fake-smtp-password-for-tests';
const sender = 'CareerKraft <mail-owner@example.net>';

async function setup(t, delivery) {
  const environment = {
    NODE_ENV: 'development',
    MAIL_MODE: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
    SMTP_PORT: '587',
    SMTP_USER: smtpUser,
    SMTP_PASSWORD: smtpPassword,
    MAIL_FROM: sender
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const mails = [];
  const infoLogs = [];
  const errorLogs = [];
  t.mock.method(console, 'info', (...args) => infoLogs.push(args));
  t.mock.method(console, 'error', (...args) => errorLogs.push(args));
  const createTransport = t.mock.method(nodemailer, 'createTransport', () => ({
    async sendMail(mail) {
      mails.push(mail);
      return delivery(mail);
    }
  }));
  const { app, db } = createApp({ database: ':memory:', base: 'http://localhost:3000' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    db, mails, infoLogs, errorLogs, createTransport,
    async register() {
      const response = await fetch(`${origin}/api/register`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ' New-Member@Example.com ', name: 'New Member', password: 'registration-password', terms: true })
      });
      return { status: response.status, body: await response.json() };
    }
  };
}

function assertPrivateLogs(context, extraSecrets = []) {
  const serialized = JSON.stringify([...context.infoLogs, ...context.errorLogs]);
  const verificationToken = new URL(context.mails[0].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  for (const secret of [recipient, smtpUser, smtpPassword, sender, verificationToken, context.mails[0].text, ...extraSecrets]) {
    assert.equal(serialized.includes(secret), false, 'SMTP logs must omit addresses, credentials, message bodies, tokens and provider error text');
  }
}

test('SMTP verification sends to an unrelated registered address without success console logs', async t => {
  const context = await setup(t, mail => ({
    messageId: 'smtp-test-message-id', accepted: [mail.to], rejected: []
  }));
  const result = await context.register();

  assert.equal(result.status, 202);
  assert.equal(context.createTransport.mock.callCount(), 1);
  assert.equal(context.createTransport.mock.calls[0].arguments[0].auth.user, smtpUser);
  assert.equal(context.mails.length, 1);
  assert.equal(context.mails[0].to, recipient);
  assert.notEqual(context.mails[0].to, smtpUser);
  assert.equal(context.mails[0].from, sender);
  const verificationToken = new URL(context.mails[0].text.match(/http:\/\/[^\s]+/)[0]).searchParams.get('token');
  const saved = context.db.prepare('SELECT hash, purpose FROM tokens').get();
  assert.equal(saved.purpose, 'verify');
  assert.equal(saved.hash, createHash('sha256').update(verificationToken).digest('hex'));
  assert.notEqual(saved.hash, verificationToken);
  assert.deepEqual(context.infoLogs, []);
  assert.equal(context.errorLogs.length, 0);
  assertPrivateLogs(context);
});

for (const scenario of [
  { name: 'rejected recipient', accepted: [], rejected: [recipient] },
  { name: 'acceptance for a different recipient', accepted: ['different-recipient@example.org'], rejected: [] }
]) {
  test(`SMTP ${scenario.name} keeps delivery failures generic and removes the unusable verification token`, async t => {
    const context = await setup(t, () => ({ messageId: 'undelivered-test-message', ...scenario }));
    const result = await context.register();

    assert.equal(result.status, 202);
    assert.equal(result.body.success, true);
    assert.equal(result.body.code, undefined);
    assert.equal(result.body.user, undefined);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
    assert.equal(context.infoLogs.length, 0);
    assert.equal(context.errorLogs.filter(entry => entry[0] === 'SMTP email failed.').length, 1);
    assert.equal(context.errorLogs[0][0], 'SMTP email failed.');
    assert.equal(context.errorLogs[0][1].code, 'EENVELOPE');
    assert.deepEqual(Object.keys(context.errorLogs[0][1]).sort(), ['code', 'command', 'responseCode']);
    assertPrivateLogs(context, ['different-recipient@example.org']);
  });
}

test('SMTP authentication failure logs safe diagnostic fields and removes the verification token', async t => {
  const providerMessage = 'private-provider-error-text';
  const context = await setup(t, mail => {
    const error = new Error(`${providerMessage}: ${smtpUser} ${smtpPassword} ${mail.text}`);
    error.code = 'EAUTH';
    error.responseCode = 535;
    error.command = `AUTH PLAIN ${smtpPassword}`;
    error.response = `535 ${providerMessage} ${recipient}`;
    throw error;
  });
  const result = await context.register();

  assert.equal(result.status, 202);
  assert.equal(result.body.success, true);
    assert.equal(result.body.code, undefined);
    assert.equal(result.body.user, undefined);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM tokens').get().count, 0);
  assert.equal(context.infoLogs.length, 0);
  assert.deepEqual(context.errorLogs.filter(entry => entry[0] === 'SMTP email failed.'), [[
    'SMTP email failed.', { code: 'EAUTH', responseCode: 535, command: 'AUTH' }
  ]]);
  assertPrivateLogs(context, [providerMessage]);
});
