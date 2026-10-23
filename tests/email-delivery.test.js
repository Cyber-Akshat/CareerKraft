const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrevoMailer } = require('../email-delivery');

const apiKey = 'fake-private-brevo-api-key';
const from = 'CareerKraft <sender@example.com>';
const mail = { to: 'member@example.net', subject: 'Verify your CareerKraft email', text: 'Private verification link: https://example.com/verify?token=private-token' };

function assertFailureLog(logs, code, status = null) {
  assert.deepEqual(logs, [['Brevo email failed.', { code, status }]]);
  const serialized = JSON.stringify(logs);
  for (const secret of [apiKey, from, mail.to, mail.text, 'provider-private-detail']) {
    assert.equal(serialized.includes(secret), false);
  }
}

test('Brevo sends a text transactional email over HTTPS and accepts a 201 message ID', async () => {
  const requests = [];
  const send = createBrevoMailer({ apiKey, from, fetchImpl: async (...args) => {
    requests.push(args);
    return { status: 201, json: async () => ({ messageId: 'test-message-id' }) };
  } });
  assert.deepEqual(await send(mail), { messageId: 'test-message-id' });
  assert.equal(requests.length, 1);
  const [url, request] = requests[0];
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' });
  assert.equal(request.redirect, 'error');
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request.body), {
    sender: { email: 'sender@example.com', name: 'CareerKraft' },
    to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text
  });
});

test('Brevo accepts a bare sender email and quoted sender names', async () => {
  for (const [sender, name] of [
    ['sender@example.com', 'CareerKraft'],
    ['"CareerKraft Team" <sender@example.com>', 'CareerKraft Team'],
    ["'CareerKraft Team' <sender@example.com>", 'CareerKraft Team']
  ]) {
    const send = createBrevoMailer({ apiKey, from: sender, fetchImpl: async (_, request) => {
      assert.deepEqual(JSON.parse(request.body).sender, { email: 'sender@example.com', name });
      return { status: 201, json: async () => ({ messageId: 'test-message-id' }) };
    } });
    await send(mail);
  }
});

test('Brevo validates configuration lazily and never requests delivery with invalid configuration', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  const fetchImpl = async () => { requests += 1; };
  for (const invalid of [
    { apiKey: '' }, { apiKey: null }, { apiKey: 'key\r\nInjected: value' },
    { from: '' }, { from: 'sender@example.com, other@example.com' },
    { from: 'CareerKraft <sender@example.com>\r\nBcc: other@example.com' },
    { from: 'sender@example.com\n' }, { from: '"" <sender@example.com>' }, { fetchImpl: null }
  ]) {
    logs.length = 0;
    let send;
    assert.doesNotThrow(() => { send = createBrevoMailer({ apiKey, from, fetchImpl, ...invalid }); });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'CONFIGURATION');
  }
  assert.equal(requests, 0);
});

test('Brevo refuses multiple recipients and injected message headers', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  const send = createBrevoMailer({ apiKey, from, fetchImpl: async () => { requests += 1; } });
  for (const invalid of [
    { to: 'member@example.net,other@example.net' }, { to: 'member@example.net\n' },
    { subject: 'Verify\r\nBcc: secret@example.com' }, { text: '' }
  ]) {
    logs.length = 0;
    await assert.rejects(send({ ...mail, ...invalid }), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'INVALID_MESSAGE');
  }
  assert.equal(requests, 0);
});

test('Brevo logs only a safe status on failed HTTP responses without reading their bodies', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const status of [200, 202, 301, 400, 401, 429, 500]) {
    logs.length = 0;
    let cancelled = false;
    const send = createBrevoMailer({ apiKey, from, fetchImpl: async () => ({
      status, body: { async cancel() { cancelled = true; } },
      json() { assert.fail('Failure response bodies must not be parsed.'); }
    }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assert.equal(cancelled, true);
    assertFailureLog(logs, 'HTTP_ERROR', status);
  }
});

test('Brevo fails safely for malformed success responses and absent message IDs', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const json of [
    async () => { throw new Error('provider-private-detail'); },
    async () => null, async () => ({}), async () => ({ messageId: 42 }),
    async () => ({ messageId: '  ' })
  ]) {
    logs.length = 0;
    const send = createBrevoMailer({ apiKey, from, fetchImpl: async () => ({ status: 201, json }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'INVALID_RESPONSE', 201);
  }
});

test('Brevo never exposes network and timeout error details', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const [name, code] of [['Error', 'NETWORK_ERROR'], ['TimeoutError', 'TIMEOUT'], ['AbortError', 'TIMEOUT']]) {
    logs.length = 0;
    const send = createBrevoMailer({ apiKey, from, fetchImpl: async () => {
      throw Object.assign(new Error(`provider-private-detail: ${apiKey} ${mail.text}`), { name });
    } });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, code);
  }
});
