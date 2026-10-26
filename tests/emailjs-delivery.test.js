const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmailJSMailer: createProvider } = require('../email-delivery');

let fakeClock = 1000000000;
const createEmailJSMailer = options => createProvider({
  now: () => fakeClock,
  sleep: async milliseconds => { fakeClock += milliseconds; },
  ...options
});

const configuration = {
  serviceId: 'service_test', templateId: 'template_test',
  publicKey: 'public-test-key', privateKey: 'private-test-key'
};
const mail = {
  to: 'member@example.net', subject: 'Verify your CareerKraft email',
  text: 'Private verification link: https://example.com/verify?token=private-test-token'
};
const accepted = () => new Response('OK', { status: 200 });

function assertFailureLog(logs, code, status = null) {
  assert.deepEqual(logs, [['EmailJS email failed.', { code, status }]]);
  const logged = JSON.stringify(logs);
  for (const secret of [...Object.values(configuration), mail.to, mail.text, 'provider-private-detail']) {
    assert.equal(logged.includes(secret), false, 'Logs must omit keys, addresses, message bodies and provider error details.');
  }
}

test('EmailJS sends the generic template from the backend and checks its plaintext acknowledgement', async t => {
  const requests = [];
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  const send = createEmailJSMailer({ ...configuration, fetchImpl: async (...args) => {
    requests.push(args);
    return new Response('  OK\n', { status: 200 });
  } });
  await send(mail);
  assert.equal(requests.length, 1);
  const [url, request] = requests[0];
  assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.redirect, 'error');
  assert.ok(request.signal instanceof AbortSignal);
  assert.deepEqual(timeouts, [15000]);
  assert.deepEqual(JSON.parse(request.body), {
    service_id: configuration.serviceId, template_id: configuration.templateId,
    user_id: configuration.publicKey, accessToken: configuration.privateKey,
    template_params: { to_email: mail.to, subject: mail.subject, message: mail.text, from_name: 'CareerKraft' }
  });
});

test('EmailJS omits an absent optional private key', async () => {
  for (const privateKey of [undefined, null, '', '  ']) {
    const send = createEmailJSMailer({ ...configuration, privateKey, fetchImpl: async (_, request) => {
      assert.equal(Object.hasOwn(JSON.parse(request.body), 'accessToken'), false);
      return accepted();
    } });
    await send(mail);
  }
});

test('EmailJS rejects missing or injected configuration without sending', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  for (const invalid of [
    { serviceId: '' }, { serviceId: undefined }, { templateId: null }, { publicKey: '  ' },
    { serviceId: 42 }, { templateId: 'template\nInjected' },
    { publicKey: 'key\r\nInjected' }, { privateKey: 'private\nInjected' }, { fetchImpl: null }
  ]) {
    logs.length = 0;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => { requests += 1; }, ...invalid });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'CONFIGURATION');
  }
  assert.equal(requests, 0);
});

test('EmailJS rejects invalid recipients, multiple recipients and injected subjects without sending', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => { requests += 1; } });
  for (const invalid of [
    { to: '' }, { to: 'invalid-address' }, { to: ['member@example.net'] },
    { to: 'member@example.net,other@example.net' }, { to: 'member@example.net\n' },
    { to: 'Member <member@example.net>' }, { subject: 'Verify\r\nBcc: secret@example.com' },
    { subject: '' }, { text: null }, { text: '  ' }
  ]) {
    logs.length = 0;
    await assert.rejects(send({ ...mail, ...invalid }), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'INVALID_MESSAGE');
  }
  assert.equal(requests, 0);
});

test('EmailJS treats rejected HTTP responses safely without parsing private provider bodies', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const status of [201, 202, 302, 400, 401, 429, 500]) {
    logs.length = 0;
    let cancelled = false;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => ({
      status, body: { async cancel() { cancelled = true; } },
      text() { assert.fail('Failed HTTP response bodies must not be read.'); }
    }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assert.equal(cancelled, true);
    assertFailureLog(logs, 'HTTP_ERROR', status);
  }
});

test('EmailJS requires OK instead of trusting a successful status alone', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const text of [
    async () => '', async () => 'provider-private-detail', async () => '{"success":true}',
    async () => { throw new Error('provider-private-detail'); }
  ]) {
    logs.length = 0;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => ({ status: 200, text }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'INVALID_RESPONSE', 200);
  }
});

test('EmailJS keeps network errors and timeout details out of logs and returned errors', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const [name, code] of [['Error', 'NETWORK_ERROR'], ['TimeoutError', 'TIMEOUT'], ['AbortError', 'TIMEOUT']]) {
    logs.length = 0;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => {
      throw Object.assign(new Error(`provider-private-detail ${configuration.privateKey} ${mail.text}`), { name });
    } });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, code);
  }
});

test('EmailJS serializes concurrent requests across factories and spaces starts by one second', async () => {
  delete require.cache[require.resolve('../email-delivery')];
  const { createEmailJSMailer: freshProvider } = require('../email-delivery');
  let clock = 10000, inFlight = 0, maximumInFlight = 0;
  const starts = [], sleeps = [], releases = [];
  const options = {
    ...configuration,
    now: () => clock,
    sleep: async milliseconds => { sleeps.push(milliseconds); clock += milliseconds; },
    fetchImpl: async () => {
      starts.push(clock);
      maximumInFlight = Math.max(maximumInFlight, ++inFlight);
      await new Promise(resolve => releases.push(resolve));
      inFlight -= 1;
      return accepted();
    }
  };
  const firstMailer = freshProvider(options), secondMailer = freshProvider(options);
  const pending = [firstMailer(mail), secondMailer(mail), firstMailer(mail)];
  await new Promise(setImmediate);
  assert.deepEqual(starts, [10000]);
  releases[0]();
  await new Promise(setImmediate);
  assert.deepEqual(starts, [10000, 11000]);
  releases[1]();
  await new Promise(setImmediate);
  assert.deepEqual(starts, [10000, 11000, 12000]);
  releases[2]();
  await Promise.all(pending);
  assert.equal(maximumInFlight, 1);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('EmailJS delivery failure does not block the next queued message', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => {
    requests += 1;
    if (requests === 1) throw new Error('provider-private-detail');
    return accepted();
  } });
  const failure = assert.rejects(send(mail), { message: 'Email delivery failed.' });
  const success = send(mail);
  await Promise.all([failure, success]);
  assert.equal(requests, 2);
  assertFailureLog(logs, 'NETWORK_ERROR');
});
