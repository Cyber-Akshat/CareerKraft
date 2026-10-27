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

test('EmailJS uses the reset template only for its explicit internal reset purpose', async () => {
  const requests = [];
  const send = createEmailJSMailer({ ...configuration, resetTemplateId: 'template_reset', fetchImpl: async (_, request) => {
    requests.push(JSON.parse(request.body));
    return accepted();
  } });
  for (const [message, expectedTemplate] of [
    [{ ...mail, purpose: 'reset' }, 'template_reset'],
    [{ ...mail, purpose: 'verify', subject: 'Reset your CareerKraft password' }, configuration.templateId],
    [{ ...mail, subject: 'Reset your CareerKraft password', text: 'Reset your password now.' }, configuration.templateId],
    [{ ...mail, purpose: 'RESET', actionUrl: 'https://example.com/reset-password.html?token=test' }, configuration.templateId],
    [{ ...mail, purpose: 'email-change', template_id: 'template_reset', templateId: 'template_reset' }, configuration.templateId]
  ]) {
    await send(message);
    const payload = requests.at(-1);
    assert.equal(payload.template_id, expectedTemplate);
    assert.equal(Object.hasOwn(payload, 'purpose'), false);
    assert.equal(Object.hasOwn(payload.template_params, 'purpose'), false);
  }
  assert.equal(requests.length, 5);
});

test('EmailJS keeps the primary template for resets when the optional reset template is absent', async () => {
  let requests = 0;
  const send = createEmailJSMailer({ ...configuration, resetTemplateId: undefined, fetchImpl: async (_, request) => {
    requests += 1;
    assert.equal(JSON.parse(request.body).template_id, configuration.templateId);
    return accepted();
  } });
  await send({ ...mail, purpose: 'reset' });
  assert.equal(requests, 1);
});

test('EmailJS validates only the selected template and never falls back from an invalid reset template', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const resetTemplateId of [null, '', '  ', 42, 'private-reset-template\nInjected']) {
    const requests = [];
    const send = createEmailJSMailer({ ...configuration, resetTemplateId, fetchImpl: async (_, request) => {
      requests.push(JSON.parse(request.body));
      return accepted();
    } });
    logs.length = 0;
    await send({ ...mail, purpose: 'verify' });
    await assert.rejects(send({ ...mail, purpose: 'reset' }), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'CONFIGURATION');
    assert.equal(JSON.stringify(logs).includes('private-reset-template'), false);
    await send({ ...mail, purpose: 'verify' });
    assert.deepEqual(requests.map(request => request.template_id), [configuration.templateId, configuration.templateId]);
  }
  logs.length = 0;
  const requests = [];
  const send = createEmailJSMailer({ ...configuration, templateId: null, resetTemplateId: 'template_reset', fetchImpl: async (_, request) => {
    requests.push(JSON.parse(request.body));
    return accepted();
  } });
  await send({ ...mail, purpose: 'reset' });
  await assert.rejects(send({ ...mail, purpose: 'verify' }), { message: 'Email delivery failed.' });
  assertFailureLog(logs, 'CONFIGURATION');
  assert.deepEqual(requests.map(request => request.template_id), ['template_reset']);
});

test('EmailJS supplies the complete tokenized action URL for a template button', async () => {
  for (const actionUrl of [
    'https://careerkraft.example/verify-email.html?token=private-test-token&source=email',
    'http://localhost:3000/reset-password.html?token=private-test-token'
  ]) {
    const requests = [];
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async (_, request) => {
      requests.push(JSON.parse(request.body));
      return accepted();
    } });
    await send({ ...mail, actionUrl });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].template_params, {
      to_email: mail.to, subject: mail.subject, message: mail.text, from_name: 'CareerKraft',
      action_url: actionUrl
    });
  }
});

test('EmailJS rejects unsafe button URLs before sending or exposing the URL in logs', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let requests = 0;
  const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => { requests += 1; } });
  for (const actionUrl of [
    null, '', ' ', 42, {}, '/verify-email.html?token=private-test-token',
    'javascript:alert(1)', 'data:text/html,private-test-token', '//example.com/verify',
    'https://', 'https://member:private-test-token@example.com/verify',
    'https://example.com/verify?token=private-test-token\n',
    'https://example.com/verify?token=private-test-token\u0000',
    'https://example.com/verify?token=private-test-token\u0085',
    'https://example.com/verify?token=private-test-token with-space',
    'https://example.com/verify?token=private-test-token" onclick="alert(1)',
    "https://example.com/verify?token=private-test-token'",
    'https://example.com/verify?token=<private-test-token>',
    'https://example.com/verify?token=`private-test-token`',
    'https://example.com\\@other.example/verify?token=private-test-token',
    'https://example.com/verify?token=' + 'a'.repeat(8192)
  ]) {
    logs.length = 0;
    await assert.rejects(send({ ...mail, actionUrl }), { message: 'Email delivery failed.' });
    assertFailureLog(logs, 'INVALID_MESSAGE');
    if (typeof actionUrl === 'string' && actionUrl.trim()) {
      assert.equal(JSON.stringify(logs).includes(actionUrl), false);
    }
  }
  assert.equal(requests, 0);
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

test('EmailJS cancels rejected HTTP responses without a stream reader and never uses an unbounded text read', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const status of [201, 202, 302, 400, 401, 429, 500]) {
    logs.length = 0;
    let cancelled = false;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => ({
      status, body: { async cancel() { cancelled = true; } },
      text() { assert.fail('Failed HTTP response bodies must not use an unbounded text read.'); }
    }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assert.equal(cancelled, true);
    assertFailureLog(logs, status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', status);
  }
});

test('EmailJS logs fixed actionable failure codes while keeping provider details private', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const cases = [
    ['API calls are disabled for non-browser applications', 'NON_BROWSER_API_DISABLED', 403],
    ['The Public Key is invalid', 'PUBLIC_KEY_REJECTED', 400],
    ['The user ID is invalid', 'PUBLIC_KEY_REJECTED', 400],
    ['Invalid private key', 'PRIVATE_KEY_REJECTED', 403],
    ['The accessToken is incorrect', 'PRIVATE_KEY_REJECTED', 403],
    ['The template ID not found', 'TEMPLATE_NOT_FOUND', 400],
    ['The service ID is invalid', 'SERVICE_NOT_FOUND', 400],
    ['The recipients address is empty', 'RECIPIENT_INVALID', 422],
    ['Recipient email address is corrupted', 'RECIPIENT_INVALID', 422],
    ['Gmail_API: Request had insufficient authentication scopes.', 'GMAIL_AUTHORIZATION', 412],
    ['Gmail_API: invalid_grant', 'GMAIL_AUTHORIZATION', 412],
    ['The monthly email quota has been exceeded', 'QUOTA_EXCEEDED', 429],
    ['Too many requests', 'RATE_LIMITED', 400],
    ['The origin is not allowed', 'ORIGIN_REJECTED', 403],
    ['reCAPTCHA verification failed', 'CAPTCHA_REQUIRED', 400],
    ['Unrecognized provider-private-detail', 'HTTP_ERROR', 500]
  ];
  for (const [details, code, status] of cases) {
    logs.length = 0;
    const privateDetails = `${details}\r\nprovider-private-detail ${Object.values(configuration).join(' ')} ${mail.to} ${mail.text}`;
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => new Response(privateDetails, { status }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assertFailureLog(logs, code, status);
  }
});

test('EmailJS bounds diagnostic reads to 4096 bytes and cancels oversized provider responses', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const details = 'API calls are disabled for non-browser applications';
  const sendAtLimit = createEmailJSMailer({ ...configuration, fetchImpl: async () => new Response(details.padEnd(4096), { status: 403 }) });
  await assert.rejects(sendAtLimit(mail), { message: 'Email delivery failed.' });
  assertFailureLog(logs, 'NON_BROWSER_API_DISABLED', 403);

  for (const chunks of [
    [details.padEnd(4097)],
    [details.padEnd(2048), `provider-private-detail ${mail.text}`.padEnd(2049)],
    [details.padEnd(100000)]
  ]) {
    logs.length = 0;
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      },
      cancel() { cancelled = true; }
    });
    const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => ({ status: 403, body }) });
    await assert.rejects(send(mail), { message: 'Email delivery failed.' });
    assert.equal(cancelled, true);
    assertFailureLog(logs, 'HTTP_ERROR', 403);
  }
});

test('EmailJS falls back safely when a diagnostic stream fails after a recognizable error', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let reads = 0, cancelled = false, released = false;
  const send = createEmailJSMailer({ ...configuration, fetchImpl: async () => ({
    status: 403,
    body: { getReader() { return {
      async read() {
        if (++reads === 1) return { done: false, value: new TextEncoder().encode('The Public Key is invalid') };
        throw new Error(`provider-private-detail ${configuration.privateKey} ${mail.text}`);
      },
      async cancel() { cancelled = true; },
      releaseLock() { released = true; }
    }; } },
    text() { assert.fail('Diagnostic failures must not fall back to unbounded reads.'); }
  }) });
  await assert.rejects(send(mail), { message: 'Email delivery failed.' });
  assert.equal(cancelled, true);
  assert.equal(released, true);
  assertFailureLog(logs, 'HTTP_ERROR', 403);
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
