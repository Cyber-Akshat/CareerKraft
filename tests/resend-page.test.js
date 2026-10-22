const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('expired link allows entering an email and displays resend errors, including rate limits', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'verify-email.html'), 'utf8'), { url: 'http://localhost:3000/verify-email.html?token=expired', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const requests = [];
  let failure = true;
  window.console.error = () => {};
  window.careerAuth = {
    request: async () => ({ error: { message: 'This verification link is invalid or has expired.' } }),
    getUser: async () => ({ data: { user: null } }),
    resend: async body => {
      requests.push(body);
      return failure ? { error: { message: 'Too many email requests. Try again later.' } } : { data: { message: 'If this account needs verification, a new link has been emailed.' } };
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'verify-email.js'), 'utf8'));
  await settle();
  const document = window.document;
  assert.equal(window.location.search, '');
  assert.equal(document.querySelector('#resend-email-address').hidden, false);
  document.querySelector('#resend-email').click();
  assert.equal(requests.length, 0);
  assert.match(document.querySelector('#verify-message').textContent, /Enter the email address/);
  document.querySelector('#resend-address').value = 'tester@example.com';
  document.querySelector('#resend-email').click();
  await settle();
  assert.equal(requests[0].email, 'tester@example.com');
  assert.equal(document.querySelector('#resend-email').disabled, false);
  assert.match(document.querySelector('#verify-message').textContent, /Too many email requests/);
  failure = false;
  document.querySelector('#resend-address').value = 'corrected@example.com';
  document.querySelector('#resend-email').click();
  await settle();
  assert.equal(requests[1].email, 'corrected@example.com');
  assert.match(document.querySelector('#verify-message').textContent, /If this account needs verification/);
  assert.equal(document.querySelector('#resend-email').disabled, true);
});
