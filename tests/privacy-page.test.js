const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createApp } = require('../server');

const root = path.join(__dirname, '..');
const sections = ['operator', 'applies', 'information', 'evidence', 'ai', 'purposes',
  'lawful-bases', 'providers', 'transfers', 'retention', 'cookies', 'children',
  'rights', 'deletion', 'security', 'complaints', 'changes'];
let server;
let db;
let base;

before(async () => {
  const application = createApp({ database: ':memory:', sendMail: async () => {} });
  db = application.db;
  server = application.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
});

function page(t, filename, options = {}) {
  const dom = new JSDOM(readFileSync(path.join(root, filename), 'utf8'), {
    url: base + '/' + filename, ...options
  });
  t.after(() => dom.window.close());
  return dom;
}

function privacyLinks(container) {
  return [...container.querySelectorAll('a[href]')].filter(link => link.pathname === '/privacy.html');
}

function assertPrivacyTargets(links, document, context) {
  assert.ok(links.length, `${context} links to the Privacy Policy`);
  for (const link of links) {
    assert.equal(link.origin, base, `${context} uses the local policy`);
    if (link.hash) assert.ok(document.getElementById(decodeURIComponent(link.hash.slice(1))), `${context}: ${link.hash} exists`);
  }
}

test('Privacy Policy GET and HEAD are publicly available with a useful title, mobile metadata and served assets', async t => {
  const response = await fetch(base + '/privacy.html', { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html\b/);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null, 'Reading the policy does not create a session');
  const dom = new JSDOM(await response.text(), { url: response.url });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.title, 'Privacy Policy | CareerKraft');
  assert.equal(document.querySelector('h1')?.textContent.trim(), 'Privacy Policy');
  assert.match(document.querySelector('meta[name="viewport"]')?.content || '', /width=device-width/);
  assert.ok(document.querySelector('meta[name="description"]')?.content.trim());
  assert.ok(document.querySelector('link[rel="icon"]'));
  assert.ok(document.querySelector('script[src="/site.js"]'));
  assert.ok(document.querySelector('link[rel="stylesheet"]'));
  for (const element of document.querySelectorAll('link[rel="stylesheet"],link[rel="icon"],script[src],img[src]')) {
    const url = new URL(element.href || element.src);
    if (url.origin !== base) continue;
    const asset = await fetch(url, { method: 'HEAD' });
    assert.equal(asset.status, 200, `Policy asset is served: ${url.pathname}`);
  }
  for (const filename of readdirSync(root).filter(name => name.endsWith('.html') && name !== 'privacy.html')) {
    assert.notEqual(page(t, filename).window.document.title, document.title, `${filename} keeps its own title`);
  }
  const head = await fetch(base + '/privacy.html', { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /^text\/html\b/);
  assert.equal(await head.text(), '');
});

test('the short privacy summary precedes all 17 readable sections and contents links resolve', t => {
  const document = page(t, 'privacy.html').window.document;
  const summary = document.getElementById('privacy-summary');
  assert.ok(summary?.querySelector('h2'), 'A headed plain-language summary is available');
  assert.ok(summary.querySelector('p'), 'The summary explains privacy before the detailed policy');
  for (const id of sections) {
    const section = document.getElementById(id);
    assert.ok(section, `Privacy section ${id} exists`);
    assert.equal(section.tagName, 'SECTION');
    assert.ok(section.querySelector('h2')?.textContent.trim(), `${id} has a heading`);
    assert.ok(section.querySelector('p,ul,table,dl,address'), `${id} has an explanation`);
    assert.ok(summary.compareDocumentPosition(section) & 4, `${id} follows the summary`);
    assert.ok(document.querySelector(`nav a[href="#${id}"]`), `${id} is reachable from the contents`);
  }
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    assert.ok(link.hash.length > 1, 'No empty placeholder anchors');
    assert.ok(document.getElementById(decodeURIComponent(link.hash.slice(1))), `${link.hash} resolves`);
  }
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'Policy fragment identifiers are unique');
});

test('privacy disclosures include the real session cookie names, an AI provider and privacy contact', t => {
  const document = page(t, 'privacy.html').window.document;
  const cookies = document.getElementById('cookies').textContent;
  assert.match(cookies, /\bck_session\b/);
  assert.match(cookies, /__Host-ck_session/);
  assert.match(document.getElementById('providers').textContent, /\bGroq\b/);
  assert.ok(document.querySelector('#operator a[href^="mailto:"]'), 'The operator has a usable privacy contact');
  const complaints = [...document.querySelectorAll('#complaints a[href]')];
  assert.ok(complaints.some(link => link.protocol === 'https:' && /(^|\.)ico\.org\.uk$/.test(link.hostname)), 'A complaint can be made to the ICO');
  const accountRetention = [...document.querySelectorAll('#retention dt')]
    .find(term => /\baccount\b/i.test(term.textContent))?.nextElementSibling;
  assert.ok(accountRetention, 'Retention distinguishes CareerKraft account records from provider records');
  assert.doesNotMatch(accountRetention.textContent, /\b30[-\s]*days?\b/i,
    'CareerKraft does not promise an unimplemented 30-day account deletion schedule');
});

test('every public HTML footer links directly to the Privacy Policy and Terms also link to it', t => {
  const policy = page(t, 'privacy.html').window.document;
  for (const filename of readdirSync(root).filter(name => name.endsWith('.html'))) {
    const document = page(t, filename).window.document;
    const footer = document.querySelector('footer nav[aria-label="Footer navigation"]')?.closest('footer');
    assert.ok(footer, `${filename} has a site footer`);
    assertPrivacyTargets(privacyLinks(footer), policy, filename);
    const stale = [...footer.querySelectorAll('a[href]')].filter(link => link.pathname === '/terms.html' && link.hash === '#privacy');
    assert.equal(stale.length, 0, `${filename} uses the standalone policy`);
  }
  const terms = page(t, 'terms.html').window.document;
  assertPrivacyTargets(privacyLinks(terms.getElementById('privacy')), policy, 'Terms privacy section');
});

test('policy theme scripts are covered by CSP and restore the saved theme without requiring storage', async t => {
  const response = await fetch(base + '/privacy.html');
  assert.equal(response.status, 200);
  const scriptPolicy = response.headers.get('content-security-policy')?.split(';').find(value => value.trim().startsWith('script-src '));
  assert.ok(scriptPolicy);
  assert.ok(!scriptPolicy.includes('unsafe-inline'));
  const dom = page(t, 'privacy.html', { runScripts: 'outside-only' });
  const scripts = [...dom.window.document.querySelectorAll('script:not([src])')].filter(script => script.textContent.trim());
  for (const script of scripts) {
    const hash = createHash('sha256').update(script.textContent).digest('base64');
    assert.ok(scriptPolicy.includes(`'sha256-${hash}'`), 'Policy inline script remains usable under CSP');
  }
  const themeScript = scripts.find(script => script.textContent.includes('careerkraft-theme'));
  assert.ok(themeScript, 'The policy shares the saved theme');
  dom.window.localStorage.setItem('careerkraft-theme', 'dark');
  dom.window.eval(themeScript.textContent);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  assert.doesNotThrow(() => dom.window.eval(themeScript.textContent));
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
});

test('registration links to privacy information separately from the Terms agreement', t => {
  const document = page(t, 'auth.html').window.document;
  const terms = document.getElementById('register-terms');
  assert.ok(terms);
  assert.equal(terms.checked, false);
  const label = terms.closest('label') || document.querySelector('label[for="register-terms"]');
  assert.ok(label);
  assert.ok([...label.querySelectorAll('a[href]')].some(link => link.pathname === '/terms.html'));
  assert.equal(privacyLinks(label).length, 0, 'Agreeing to Terms does not require accepting a bundled privacy consent');
  assertPrivacyTargets(privacyLinks(document.getElementById('register-form')),
    page(t, 'privacy.html').window.document, 'Registration form');
});

test('account, quiz and evidence collection show short linked privacy explanations', t => {
  const policy = page(t, 'privacy.html').window.document;
  for (const [filename, selector] of [
    ['auth.html', '#auth-privacy-notice'],
    ['auth.html', '#register-privacy-notice'],
    ['index.html', '#early-access-privacy'],
    ['activity.html', '#evidence-privacy-notice'],
    ['onboarding.html', '.privacy-notice'],
    ['settings.html', '.privacy-notice']
  ]) {
    const document = page(t, filename).window.document;
    const notice = document.querySelector(selector);
    assert.ok(notice, `${filename} includes ${selector}`);
    assert.ok(notice.textContent.trim().length > 30, `${filename} explains how the collected information is used`);
    assertPrivacyTargets(privacyLinks(notice), policy, `${filename} ${selector}`);
  }
  for (const [filename, selector, noticeId] of [
    ['auth.html', '#register-form', 'register-privacy-notice'],
    ['index.html', '#early-access-email', 'early-access-privacy'],
    ['activity.html', '#evidence-file-input', 'evidence-privacy-notice'],
    ['activity.html', '#evidence-text-input', 'evidence-privacy-notice']
  ]) {
    const document = page(t, filename).window.document;
    const describedBy = (document.querySelector(selector)?.getAttribute('aria-describedby') || '').split(/\s+/);
    assert.ok(describedBy.includes(noticeId), `${filename} ${selector} describes its privacy explanation`);
    assert.ok(document.getElementById(noticeId));
  }
});

test('the authenticated Lumia composer exposes its privacy notice before a message is sent', async t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: base + '/dashboard.html', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.careerAuth = {
    getSession: async () => ({ data: { session: { user: { id: 1 } } } }),
    request: async endpoint => {
      calls.push(endpoint);
      return { data: { conversation: { id: 1 }, messages: [], context: {} } };
    }
  };
  dom.window.eval(readFileSync(path.join(root, 'lumia-widget.js'), 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const document = dom.window.document;
  document.getElementById('lumia-launcher')?.click();
  assert.equal(document.getElementById('lumia-panel')?.hidden, false);
  const composer = document.querySelector('.lumia-composer');
  const notice = composer?.querySelector('#lumia-privacy-notice');
  assert.ok(notice, 'Lumia explains personalisation beside the message composer');
  assertPrivacyTargets(privacyLinks(notice), page(t, 'privacy.html').window.document, 'Lumia composer');
  assert.ok((document.getElementById('lumia-input').getAttribute('aria-describedby') || '').split(/\s+/).includes(notice.id));
  assert.deepEqual(calls, ['lumia/history'], 'Reading the notice does not submit a chat message');
});
