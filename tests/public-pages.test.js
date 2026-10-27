const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { JSDOM } = require('jsdom');
const { createApp } = require('../server');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

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
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
});

test('Terms of Use and their linked assets are accessible from the homepage and signup page', async () => {
  const response = await fetch(`${base}/terms.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html\b/);
  const terms = new JSDOM(await response.text(), { url: response.url });
  try {
    const document = terms.window.document;
    assert.equal(document.querySelector('h1')?.textContent.trim(), 'Terms of Use');
    const sections = [...document.querySelectorAll('.terms-document > section')];
    assert.equal(sections.length, 23);
    sections.forEach((section, index) => {
      assert.ok(section.querySelector('h2')?.textContent.startsWith(`${index + 1}. `));
    });
    for (const link of document.querySelectorAll('.terms-contents a')) {
      assert.ok(document.getElementById(link.hash.slice(1)), `Contents target ${link.hash} exists`);
    }

    const stylesheet = await fetch(document.querySelector('link[rel="stylesheet"]').href);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type'), /^text\/css\b/);
    assert.match(await stylesheet.text(), /\.terms-document\b/);

    const logo = await fetch(document.querySelector('.terms-brand img').src);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /^image\/png\b/);
    assert.ok((await logo.arrayBuffer()).byteLength > 0);
  } finally {
    terms.window.close();
  }

  for (const pathname of ['/index.html', '/auth.html']) {
    const pageResponse = await fetch(base + pathname);
    assert.equal(pageResponse.status, 200, pathname);
    const page = new JSDOM(await pageResponse.text(), { url: pageResponse.url });
    try {
      const link = page.window.document.querySelector('a[href="terms.html"]');
      assert.ok(link, `${pathname} links to the terms`);
      const linkedResponse = await fetch(link.href);
      assert.equal(linkedResponse.status, 200, `Terms link on ${pathname} works`);
      assert.match(await linkedResponse.text(), /<h1>Terms of Use<\/h1>/);
    } finally {
      page.window.close();
    }
  }
});

test('serving public legal pages does not expose private application files', async () => {
  for (const pathname of ['/.env', '/server.js', '/data/accounts.sqlite', '/package.json']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 404, `${pathname} stays private`);
    await response.text();
  }
});

test('missing pages return a branded 404 with working recovery links and root-relative assets', async () => {
  for (const pathname of ['/missing-page', '/some/deep/missing/page.html', '/404.html']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 404, pathname);
    assert.match(response.headers.get('content-type'), /^text\/html\b/);
    const dom = new JSDOM(await response.text(), { url: response.url });
    try {
      const document = dom.window.document;
      assert.match(document.title, /not found.*CareerKraft/i);
      assert.ok(document.querySelector('h1'));
      const home = [...document.querySelectorAll('a[href]')].find(link => link.pathname === '/index.html' || link.pathname === '/');
      assert.ok(home, 'Missing page has a home link');
      for (const element of document.querySelectorAll('script[src],link[rel="stylesheet"],link[rel="icon"],img[src]')) {
        const url = element.src || element.href;
        assert.equal(new URL(url).origin, base, '404 assets are local');
        assert.equal((await fetch(url)).status, 200, `${pathname}: ${url}`);
      }
      assert.equal((await fetch(home.href)).status, 200);
    } finally { dom.window.close(); }
  }
  const head = await fetch(base + '/deep/not-found', { method: 'HEAD' });
  assert.equal(head.status, 404);
  assert.equal(await head.text(), '');
});

test('missing API endpoints keep the JSON error contract and private files remain inaccessible', async () => {
  for (const pathname of ['/api/not-a-real-endpoint', '/api']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^application\/json\b/);
    assert.deepEqual(await response.json(), { error: 'The requested resource was not found.', code: 'not_found' });
  }
  for (const pathname of ['/.env', '/.git/config', '/data/accounts.sqlite', '/server.js', '/package-lock.json']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 404, pathname);
    assert.match(await response.text(), /<title>Page not found \| CareerKraft<\/title>/i);
  }
});

test('every page has a unique useful title, mobile viewport, favicon, working local links and public assets', async () => {
  const root = path.join(__dirname, '..');
  const documents = new Map();
  const titles = new Set();
  const resources = new Set();
  // Trustpilot's verification payload is not a site page and must stay unmodified.
  const filenames = readdirSync(root).filter(filename => filename.endsWith('.html') &&
    filename !== 'dd8adc22-d472-4bce-94ad-d465f4689348.html');
  try {
    for (const filename of filenames) {
      documents.set('/' + filename, new JSDOM(readFileSync(path.join(root, filename), 'utf8'), { url: base + '/' + filename }));
    }
    for (const [pathname, dom] of documents) {
      const document = dom.window.document;
      const title = document.title.trim();
      assert.match(title, /.+ \| CareerKraft$/, pathname);
      assert.ok(!/^(?:title|untitled|placeholder)\b/i.test(title), pathname);
      assert.ok(!titles.has(title), `Duplicate page title: ${title}`);
      titles.add(title);
      assert.match(document.querySelector('meta[name="viewport"]')?.content || '', /width=device-width/, pathname);
      const icon = document.querySelector('link[rel="icon"]');
      assert.ok(icon, `${pathname} has a favicon`);
      resources.add(icon.href);
      assert.ok(document.querySelector('script[src="/site.js"]'), `${pathname} updates the copyright year`);
      for (const element of document.querySelectorAll('script[src],link[rel="stylesheet"],img[src],video[poster],source[src]')) {
        const raw = element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('poster');
        if (!raw || /^(?:data:|blob:|https?:\/\/)/i.test(raw)) continue;
        resources.add(new URL(raw, dom.window.location.href).href);
      }
      for (const link of document.querySelectorAll('a[href]')) {
        const raw = link.getAttribute('href');
        assert.ok(raw && raw !== '#', `${pathname} has a dead anchor: ${link.textContent.trim()}`);
        const url = new URL(link.href);
        if (url.origin !== base || !['http:', 'https:'].includes(url.protocol)) continue;
        const target = documents.get(url.pathname === '/' ? '/index.html' : url.pathname);
        if (target && url.hash) {
          const id = decodeURIComponent(url.hash.slice(1));
          assert.ok(target.window.document.getElementById(id) || target.window.document.querySelector(`[name="${id.replaceAll('"', '')}"]`), `${pathname} links to missing target ${url.pathname}${url.hash}`);
        }
        if (!url.pathname.startsWith('/api/')) resources.add(url.origin + url.pathname + url.search);
      }
    }
    for (const url of resources) {
      const response = await fetch(url, { method: 'HEAD' });
      assert.equal(response.status, new URL(url).pathname === '/404.html' ? 404 : 200, `Broken public resource: ${url}`);
    }
  } finally { for (const dom of documents.values()) dom.window.close(); }
});

test('shared footer enhancement uses the current year and protects new-tab links', t => {
  const dom = new JSDOM('<span data-current-year>2001</span><a href="https://example.org" target="_blank" rel="author">Visit</a>',
    { url: base, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(readFileSync(path.join(__dirname, '..', 'site.js'), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(dom.window.document.querySelector('[data-current-year]').textContent, String(new Date().getFullYear()));
  const link = dom.window.document.querySelector('a');
  assert.ok(link.relList.contains('noopener'));
  assert.ok(link.relList.contains('noreferrer'));
  assert.ok(link.relList.contains('author'));
  dom.window.document.querySelector('[data-current-year]').textContent = '2001';
  dom.window.dispatchEvent(new dom.window.Event('pageshow'));
  assert.equal(dom.window.document.querySelector('[data-current-year]').textContent, String(new Date().getFullYear()));
});
