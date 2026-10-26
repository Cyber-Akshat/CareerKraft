'use strict';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const FAILURE_MESSAGE = 'Email delivery failed.';
const emailJSQueues = new Map();

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    /^[^\s<>(),;:"\\\[\]@]+@[^\s<>(),;:"\\\[\]@]+\.[^\s<>(),;:"\\\[\]@]+$/.test(value);
}

function parseSender(from) {
  if (typeof from !== 'string' || /[\u0000-\u001f\u007f]/.test(from)) return null;
  const value = from.trim();
  if (validEmail(value)) return { email: value, name: 'CareerKraft' };
  const match = /^([^<>]+)<([^<>]+)>$/.exec(value);
  if (!match) return null;
  let name = match[1].trim();
  const email = match[2].trim();
  if ((name.startsWith('"') && name.endsWith('"')) ||
      (name.startsWith("'") && name.endsWith("'"))) name = name.slice(1, -1).trim();
  if (!name || /["<>]/.test(name) || !validEmail(email)) return null;
  return { email, name };
}

function fail(code, status = null) {
  console.error('Brevo email failed.', { code, status });
  throw new Error(FAILURE_MESSAGE);
}

function createBrevoMailer({ apiKey, from, fetchImpl = globalThis.fetch } = {}) {
  return async function send(mail) {
    const sender = parseSender(from);
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\u0000-\u001f\u007f]/.test(apiKey) ||
        !sender || typeof fetchImpl !== 'function') fail('CONFIGURATION');
    if (!mail || !validEmail(mail.to) || typeof mail.subject !== 'string' ||
        !mail.subject.trim() || /[\r\n]/.test(mail.subject) || typeof mail.text !== 'string' ||
        !mail.text.trim()) fail('INVALID_MESSAGE');

    let response;
    try {
      response = await fetchImpl(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': apiKey.trim(),
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ sender, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error'
      });
    } catch (error) {
      fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    }

    const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
      ? response.status : null;
    if (status !== 201) {
      // Release failed responses without reading provider details into logs.
      try { await response?.body?.cancel(); } catch {}
      fail('HTTP_ERROR', status);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      fail('INVALID_RESPONSE', status);
    }
    if (typeof result?.messageId !== 'string' || !result.messageId.trim()) fail('INVALID_RESPONSE', status);
    return result;
  };
}

function failEmailJS(code, status = null) {
  console.error('EmailJS email failed.', { code, status });
  throw new Error(FAILURE_MESSAGE);
}

function validCredential(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= 1000 && !/[\s\u0000-\u001f\u007f]/.test(value.trim());
}

function createEmailJSMailer({ serviceId, templateId, publicKey, privateKey,
  fetchImpl = globalThis.fetch, now = Date.now,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  return async function send(mail) {
    const hasPrivateKey = privateKey !== undefined && privateKey !== null &&
      !(typeof privateKey === 'string' && !privateKey.trim());
    if (!validCredential(serviceId) || !validCredential(templateId) || !validCredential(publicKey) ||
        (hasPrivateKey && !validCredential(privateKey)) || typeof fetchImpl !== 'function' ||
        typeof now !== 'function' || typeof sleep !== 'function') failEmailJS('CONFIGURATION');
    if (!mail || !validEmail(mail.to) || typeof mail.subject !== 'string' ||
        !mail.subject.trim() || /[\r\n]/.test(mail.subject) ||
        typeof mail.text !== 'string' || !mail.text.trim()) failEmailJS('INVALID_MESSAGE');

    const body = JSON.stringify({
      service_id: serviceId.trim(), template_id: templateId.trim(), user_id: publicKey.trim(),
      ...(hasPrivateKey ? { accessToken: privateKey.trim() } : {}),
      template_params: {
        to_email: mail.to, subject: mail.subject, message: mail.text, from_name: 'CareerKraft'
      }
    });
    // EmailJS permits one request per second. Share the queue between mailers
    // using the same account, including concurrent authentication email jobs.
    const account = publicKey.trim();
    let queue = emailJSQueues.get(account);
    if (!queue) {
      queue = { tail: Promise.resolve(), lastStarted: null };
      emailJSQueues.set(account, queue);
    }
    const pending = queue.tail.then(async () => {
      if (queue.lastStarted !== null) {
        const remaining = 1000 - (now() - queue.lastStarted);
        if (remaining > 0) await sleep(remaining);
      }
      queue.lastStarted = now();
      let response;
      try {
        response = await fetchImpl(EMAILJS_ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
          signal: AbortSignal.timeout(15000), redirect: 'error'
        });
      } catch (error) {
        failEmailJS(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
      }
      const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
        ? response.status : null;
      if (status !== 200) {
        try { await response?.body?.cancel(); } catch {}
        failEmailJS('HTTP_ERROR', status);
      }
      let acknowledgement;
      try { acknowledgement = await response.text(); }
      catch { failEmailJS('INVALID_RESPONSE', status); }
      if (typeof acknowledgement !== 'string' || acknowledgement.trim() !== 'OK') {
        failEmailJS('INVALID_RESPONSE', status);
      }
    });
    // A rejected delivery must not prevent later queued messages from sending.
    queue.tail = pending.catch(() => {});
    return pending;
  };
}

module.exports = { createBrevoMailer, createEmailJSMailer };
