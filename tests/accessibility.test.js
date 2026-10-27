const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const storageKey = 'careerkraft-accessibility';
const defaults = { dyslexiaFont: false, fontSize: 'default', contrast: 'default', saturation: 'default', cursorSize: 'default' };
const selected = { dyslexiaFont: true, fontSize: 'large', contrast: 'high', saturation: 'grayscale', cursorSize: 'large' };
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

function page(t, { html = '<!doctype html><head></head><body><main>Readable text</main></body>', saved, prepare } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'http://localhost:3000/dashboard.html', runScripts: 'outside-only', virtualConsole });
  t.after(() => dom.window.close());
  const { window } = dom;
  if (saved !== undefined) window.localStorage.setItem(storageKey, saved);
  prepare?.(window);
  window.eval(readFileSync(path.join(root, 'accessibility.js'), 'utf8'));
  return { window, document: window.document, api: window.careerAccessibility, errors };
}

function assertApplied(document, preferences) {
  const dataset = document.documentElement.dataset;
  assert.equal(dataset.dyslexiaFont, String(preferences.dyslexiaFont));
  for (const field of ['fontSize', 'contrast', 'saturation', 'cursorSize']) assert.equal(dataset[field], preferences[field], field);
  const expectedScale = { small: 0.9, default: 1, large: 1.2 }[preferences.fontSize];
  assert.equal(Number(document.documentElement.style.getPropertyValue('--ck-text-scale')), expectedScale);
}

test('accessibility initializes safe defaults before the page content needs them', t => {
  const { api, document, window, errors } = page(t);
  assert.ok(api);
  assert.deepEqual(plain(api.defaults), defaults);
  assert.deepEqual(plain(api.read()), defaults);
  assertApplied(document, defaults);
  assert.equal(window.document.querySelector('main').textContent, 'Readable text');
  assert.deepEqual(errors, []);
});

test('normalization accepts each available choice and rejects malformed or unknown values', t => {
  const { api } = page(t);
  for (const invalid of [undefined, null, [], true, false, 'large', 42]) assert.deepEqual(plain(api.normalize(invalid)), defaults);
  assert.deepEqual(plain(api.normalize({
    dyslexiaFont: 'true', fontSize: 'huge', contrast: 'light', saturation: 'none', cursorSize: 'huge', injected: 'ignored'
  })), defaults);
  const fields = {
    dyslexiaFont: [false, true], fontSize: ['small', 'default', 'large'],
    contrast: ['default', 'high'], saturation: ['default', 'low', 'high', 'grayscale'], cursorSize: ['small', 'default', 'large']
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const value of values) assert.deepEqual(plain(api.normalize({ [field]: value })), { ...defaults, [field]: value });
  }
});

test('all preferences are remembered across pages, and default restores each option', t => {
  const first = page(t);
  first.api.apply(selected);
  assertApplied(first.document, selected);
  const saved = first.window.localStorage.getItem(storageKey);
  assert.deepEqual(JSON.parse(saved), selected);
  assert.deepEqual(plain(first.api.read()), selected);
  const second = page(t, { saved });
  assertApplied(second.document, selected);
  assert.deepEqual(plain(second.api.read()), selected);
  second.api.apply(defaults);
  assertApplied(second.document, defaults);
  assert.deepEqual(JSON.parse(second.window.localStorage.getItem(storageKey)), defaults);
});

test('invalid saved data falls back safely without applying arbitrary root values', t => {
  for (const saved of ['not json', 'null', '[]', 'true', JSON.stringify({ fontSize: 'huge', dyslexiaFont: 'yes', contrast: 'invert' })]) {
    const { api, document, errors } = page(t, { saved });
    assertApplied(document, defaults);
    assert.deepEqual(plain(api.read()), defaults);
    assert.deepEqual(errors, []);
  }
});

test('blocked storage and quota failures retain usable accessibility choices in memory', t => {
  for (const prepare of [
    window => Object.defineProperty(window, 'localStorage', { get() { throw new window.DOMException('Blocked', 'SecurityError'); } }),
    window => { window.Storage.prototype.setItem = () => { throw new window.DOMException('Full', 'QuotaExceededError'); }; }
  ]) {
    const { api, document, errors } = page(t, { saved: JSON.stringify(defaults), prepare });
    api.apply(selected);
    assertApplied(document, selected);
    assert.deepEqual(plain(api.read()), selected, 'A failed save must not restore the previous storage value');
    api.apply({ ...selected, fontSize: 'small', cursorSize: 'small' });
    assertApplied(document, { ...selected, fontSize: 'small', cursorSize: 'small' });
    assert.deepEqual(plain(api.read()), { ...selected, fontSize: 'small', cursorSize: 'small' });
    assert.deepEqual(errors, []);
  }
});

// JSDOM currently drops clamp() font sizes while parsing. The browser audit
// checks real computed clamp sizes alongside px/rem scaling.
test('text scaling covers fixed, rem and media font sizes without compounding inherited sizes', async t => {
  const { api, document, errors } = page(t, { html: `<!doctype html><head><style>
    html { font-size: 16px; }
    .pixel { font-size: 20px; width: 150px; }
    .rem { font-size: 1.5rem; }
    .relative { font-size: 1.25em; }
    .percent { font-size: 110%; }
    @media (min-width: 600px) { .fluid { font-size: 26px; } }
  </style></head><body><main><span style="font-size: 23px">Text</span></main></body>` });
  document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
  await settle();
  api.apply(selected);
  await settle();
  const rules = [...document.styleSheets[0].cssRules];
  assert.equal(rules[0].style.getPropertyValue('font-size'), '16px', 'The root stays unchanged so rem values scale once');
  for (const rule of [rules[1], rules[2], rules[5].cssRules[0]]) {
    assert.match(rule.style.getPropertyValue('font-size'), /var\(--ck-text-scale\s*,\s*1\)/);
  }
  assert.equal(rules[1].style.getPropertyValue('width'), '150px', 'Layout dimensions are independent of text scaling');
  assert.equal(rules[3].style.getPropertyValue('font-size'), '1.25em');
  assert.equal(rules[4].style.getPropertyValue('font-size'), '110%');
  assert.match(document.querySelector('span').style.fontSize, /--ck-text-scale/);
  api.apply({ ...selected, fontSize: 'small' });
  api.apply(selected);
  await settle();
  for (const rule of [rules[1], rules[2], rules[5].cssRules[0]]) {
    assert.equal((rule.style.getPropertyValue('font-size').match(/--ck-text-scale/g) || []).length, 1, 'Repeated changes must not multiply the same declaration again');
  }
  assert.deepEqual(errors, []);
});

test('text added later and newly loaded stylesheets receive the current text size', async t => {
  const { api, document, errors } = page(t);
  document.dispatchEvent(new document.defaultView.Event('DOMContentLoaded'));
  await settle();
  api.apply(selected);
  const lateStyle = document.createElement('style');
  lateStyle.textContent = '.new-text { font-size: 18px; } @media (max-width: 700px) { .new-text { font-size: 1.1rem; } }';
  document.head.append(lateStyle);
  const addedText = document.createElement('p');
  addedText.style.fontSize = '25px';
  addedText.textContent = 'Content loaded after sign-in';
  document.body.append(addedText);
  await settle();
  assert.match(lateStyle.sheet.cssRules[0].style.getPropertyValue('font-size'), /--ck-text-scale/);
  assert.match(lateStyle.sheet.cssRules[1].cssRules[0].style.getPropertyValue('font-size'), /--ck-text-scale/);
  assert.match(addedText.style.fontSize, /--ck-text-scale/);
  addedText.style.fontSize = '27px';
  await settle();
  assert.match(addedText.style.fontSize, /27px/);
  assert.equal((addedText.style.fontSize.match(/--ck-text-scale/g) || []).length, 1);
  assert.deepEqual(errors, []);
});

test('every page loads accessibility before styles and other application scripts', t => {
  // Trustpilot's verification payload must stay separate from application UI.
  const filenames = readdirSync(root).filter(filename => filename.endsWith('.html') &&
    filename !== 'dd8adc22-d472-4bce-94ad-d465f4689348.html');
  assert.equal(filenames.length, 13);
  for (const filename of filenames) {
    const dom = new JSDOM(readFileSync(path.join(root, filename), 'utf8'));
    t.after(() => dom.window.close());
    const document = dom.window.document;
    const accessibility = document.head.querySelector('script[src="/accessibility.js"]');
    assert.ok(accessibility, `${filename} initializes accessibility in its head`);
    assert.equal(document.querySelectorAll('script[src="/accessibility.js"]').length, 1, filename);
    assert.ok(!accessibility.hasAttribute('defer') && !accessibility.hasAttribute('async'), `${filename} applies saved settings before rendering`);
    assert.notEqual(accessibility.type, 'module');
    for (const element of document.querySelectorAll('link[rel="stylesheet"], style, script')) {
      if (element === accessibility) continue;
      assert.ok(accessibility.compareDocumentPosition(element) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, `${filename} loads accessibility before ${element.outerHTML.slice(0, 90)}`);
    }
  }
});
