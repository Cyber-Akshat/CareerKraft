const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { JSDOM } = require('jsdom');
const { createApp } = require('../server');

const project = path.resolve(__dirname, '..');

test('signed-in journey pages load one shared Lumia widget after authentication and page logic', () => {
  for (const [page, logic] of [
    ['dashboard.html', 'dashboard.js'],
    ['activity.html', 'activity.js'],
    ['career.html', 'career.js']
  ]) {
    const dom = new JSDOM(fs.readFileSync(path.join(project, page), 'utf8'));
    try {
      const scripts = [...dom.window.document.querySelectorAll('script[src]')].map(script => script.getAttribute('src'));
      assert.ok(dom.window.document.querySelector('link[href="lumia-widget.css"]'), page);
      assert.equal(scripts.filter(source => source === 'lumia-widget.js').length, 1, page);
      assert.ok(scripts.indexOf('auth-api.js') < scripts.indexOf(logic), page);
      assert.ok(scripts.indexOf(logic) < scripts.indexOf('lumia-widget.js'), page);
    } finally {
      dom.window.close();
    }
  }
  for (const page of ['index.html', 'auth.html', 'onboarding.html', 'verify-email.html', 'reset-password.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(project, page), 'utf8'), /<script\b[^>]*\bsrc=["']lumia-widget\.js["']/i, page);
  }
});

test('the explicit static allowlist serves the shared widget without exposing private server files', async t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'careerkraft-lumia-static-'));
  const { app, db } = createApp({
    database: ':memory:',
    evidenceUploadDir: path.join(directory, 'uploads'),
    evidenceProcessingDir: path.join(directory, 'processing')
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('careerkraft-lumia-static-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const asset = await fetch(`${origin}/lumia-widget.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), fs.readFileSync(path.join(project, 'lumia-widget.js'), 'utf8'));
  const css = await fetch(`${origin}/lumia-widget.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.equal(await css.text(), fs.readFileSync(path.join(project, 'lumia-widget.css'), 'utf8'));
  for (const route of ['/server.js', '/package.json']) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 404, route);
  }
});
