const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const client = readFileSync(path.join(root, 'site.js'), 'utf8');
const consentKey = 'careerkraft-cookie-consent';
const now = 1_792_584_000_000;
const lifetime = 180 * 24 * 60 * 60 * 1000;
const fixture = '<!doctype html><html><body><main><button id="existing-control">Existing control</button></main><footer class="site-footer"><nav aria-label="Footer navigation"><a href="/privacy.html">Privacy</a></nav></footer></body></html>';

function page(t, { html = fixture, filename = 'index.html', saved, prepare } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: `http://localhost:3000/${filename}`,
    runScripts: 'outside-only',
    virtualConsole
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.Date.now = () => now;
  if (saved !== undefined) window.localStorage.setItem(consentKey, saved);
  prepare?.(window);
  window.eval(client);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.deepEqual(errors, [], 'Shared script initializes without browser errors');
  return { window, document: window.document, errors };
}

function banner(document) {
  const element = document.querySelector('section.cookie-banner');
  assert.ok(element, 'The shared cookie notice is present');
  return element;
}

function visible(element) {
  return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.style.display !== 'none';
}

function choice(document, value) {
  const element = banner(document).querySelector(`button[data-cookie-choice="${value}"]`);
  assert.ok(element, `The ${value} option is available`);
  return element;
}

function preference(value, savedAt = now) {
  return JSON.stringify({ version: 1, choice: value, savedAt });
}

function storageChange(window, value, key = consentKey) {
  const oldValue = window.localStorage.getItem(key);
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  window.dispatchEvent(new window.StorageEvent('storage', {
    key, oldValue, newValue: value,
    storageArea: window.localStorage,
    url: 'http://localhost:3000/settings.html'
  }));
}

function accountPage(t, { prepare, ...options } = {}) {
  return page(t, {
    html: readFileSync(path.join(root, 'settings.html'), 'utf8'),
    filename: 'settings.html',
    ...options,
    prepare(window) {
      // settings.js normally unlocks the account after authentication. These
      // tests isolate shared cookie behavior from account requests and forms.
      window.document.getElementById('settings-content').disabled = false;
      prepare?.(window);
    }
  });
}

function accountChoice(document, value) {
  const button = document.querySelector(`#cookies button[data-account-cookie-choice="${value}"]`);
  assert.ok(button, `Account settings offer the ${value} cookie choice`);
  return button;
}

function assertAccountChoice(document, selected) {
  for (const value of ['accepted', 'rejected']) {
    assert.equal(accountChoice(document, value).getAttribute('aria-pressed'), String(value === selected));
  }
  const status = document.getElementById('account-cookie-status');
  assert.ok(status?.textContent.trim(), 'The current cookie preference has a visible status');
  assert.equal(status.getAttribute('role'), 'status', 'Preference updates are announced accessibly');
  if (selected === 'accepted') assert.match(status.textContent, /accept|allow/i);
  if (selected === 'rejected') assert.match(status.textContent, /reject|declin|off|refus/i);
}

test('the initial cookie notice explains optional choices accessibly without taking focus', t => {
  const { document } = page(t, {
    prepare(window) { window.document.querySelector('#existing-control').focus(); }
  });
  const notice = banner(document);
  assert.ok(visible(notice));
  assert.equal(notice.getAttribute('aria-labelledby'), 'cookie-banner-title');
  assert.equal(notice.getAttribute('aria-describedby'), 'cookie-banner-description');
  assert.ok(document.getElementById('cookie-banner-title')?.textContent.trim());
  const description = document.getElementById('cookie-banner-description')?.textContent || '';
  assert.match(description, /essential|necessary/i);
  assert.match(description, /sign(?:ed)?[ -]in|authentication|auth|secur/i);
  assert.match(description, /no analytics or advertising cookies|(?:do not|don't|does not|doesn't|not currently).*analytics.*advertis/i);
  assert.equal(choice(document, 'accepted').textContent.trim(), 'Accept optional');
  assert.equal(choice(document, 'rejected').textContent.trim(), 'Reject optional');
  assert.equal(document.activeElement.id, 'existing-control');
});

for (const value of ['accepted', 'rejected']) {
  test(`${value} optional cookies is saved and remembered on another page`, t => {
    const first = page(t, {
      prepare(window) {
        window.document.cookie = 'careerkraft-session=session-fixture; path=/';
        window.localStorage.setItem('careerkraft-theme', 'dark');
      }
    });
    choice(first.document, value).click();
    assert.ok(!visible(banner(first.document)), 'Choosing closes the notice');
    const saved = first.window.localStorage.getItem(consentKey);
    assert.deepEqual(JSON.parse(saved), { version: 1, choice: value, savedAt: now });
    assert.equal(first.window.document.cookie, 'careerkraft-session=session-fixture', 'Necessary authentication cookies are retained');
    assert.equal(first.window.localStorage.getItem('careerkraft-theme'), 'dark', 'Other browser preferences are retained');
    const second = page(t, { filename: 'dashboard.html', saved });
    assert.ok(!visible(banner(second.document)), 'A saved choice applies across pages');
    second.window.dispatchEvent(new second.window.Event('pageshow'));
    assert.ok(!visible(banner(second.document)), 'Restoring a page retains the choice');
  });
}

test('a saved choice can be changed from the footer with predictable keyboard focus', t => {
  const { window, document } = page(t, { saved: preference('accepted') });
  const opener = document.querySelector('footer nav button.cookie-settings-button');
  assert.ok(opener);
  assert.equal(opener.textContent.trim(), 'Cookie settings');
  assert.equal(opener.type, 'button');
  opener.focus();
  opener.click();
  assert.ok(visible(banner(document)));
  assert.equal(document.activeElement, banner(document).querySelector('button[data-cookie-choice]'));
  choice(document, 'rejected').click();
  assert.ok(!visible(banner(document)));
  assert.equal(JSON.parse(window.localStorage.getItem(consentKey)).choice, 'rejected');
  assert.equal(document.activeElement, opener, 'Saving returns focus to Cookie settings');
  opener.click();
  choice(document, 'accepted').click();
  assert.equal(JSON.parse(window.localStorage.getItem(consentKey)).choice, 'accepted');
  assert.equal(document.activeElement, opener);
});

test('a choice remains valid for 180 days and is requested again when it expires', t => {
  const almostExpired = page(t, { saved: preference('accepted', now - lifetime + 1) });
  assert.ok(!visible(banner(almostExpired.document)));
  const expired = page(t, { saved: preference('rejected', now - lifetime) });
  assert.ok(visible(banner(expired.document)));
  choice(expired.document, 'accepted').click();
  assert.deepEqual(JSON.parse(expired.window.localStorage.getItem(consentKey)), { version: 1, choice: 'accepted', savedAt: now });
});

test('malformed, unsupported or impossible saved preferences do not dismiss the notice', t => {
  const invalid = [
    'not json', 'null', '[]', 'true', '{}',
    JSON.stringify({ version: 2, choice: 'accepted', savedAt: now }),
    JSON.stringify({ version: 1, choice: 'unknown', savedAt: now }),
    JSON.stringify({ version: 1, choice: 'accepted' }),
    JSON.stringify({ version: 1, choice: 'rejected', savedAt: String(now) }),
    JSON.stringify({ version: 1, choice: 'accepted', savedAt: null }),
    preference('accepted', now + 1)
  ];
  for (const saved of invalid) {
    const { document } = page(t, { saved });
    assert.ok(visible(banner(document)), `Invalid saved preference is ignored: ${saved}`);
  }
});

test('unavailable browser storage still allows either choice for the current page', t => {
  for (const value of ['accepted', 'rejected']) {
    const { window, document, errors } = page(t, {
      prepare(window) {
        Object.defineProperty(window, 'localStorage', {
          get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); }
        });
      }
    });
    assert.ok(visible(banner(document)));
    choice(document, value).click();
    assert.ok(!visible(banner(document)));
    window.dispatchEvent(new window.Event('pageshow'));
    assert.ok(!visible(banner(document)), 'Restoring the current page retains its in-memory choice');
    document.querySelector('.cookie-settings-button').click();
    assert.ok(visible(banner(document)), 'Settings remain usable without browser storage');
    choice(document, value === 'accepted' ? 'rejected' : 'accepted').click();
    assert.ok(!visible(banner(document)));
    assert.deepEqual(errors, []);
  }
});

test('a storage write failure retains the current choice when the page is restored', t => {
  const { window, document, errors } = page(t, {
    saved: preference('accepted'),
    prepare(window) {
      window.Storage.prototype.setItem = () => { throw new window.DOMException('Quota exceeded', 'QuotaExceededError'); };
    }
  });
  document.querySelector('.cookie-settings-button').click();
  choice(document, 'rejected').click();
  assert.ok(!visible(banner(document)));
  window.dispatchEvent(new window.Event('pageshow'));
  assert.ok(!visible(banner(document)));
  assert.deepEqual(errors, []);
});

test('changes in another tab update the notice while open cookie settings stay usable', t => {
  const { window, document } = page(t, { saved: preference('accepted') });
  storageChange(window, null, 'unrelated-preference');
  assert.ok(!visible(banner(document)), 'Unrelated storage events do not change the notice');
  storageChange(window, null);
  assert.ok(visible(banner(document)), 'Removing the preference in another tab shows the notice');
  storageChange(window, preference('rejected'));
  assert.ok(!visible(banner(document)), 'A new choice in another tab dismisses the notice');
  const opener = document.querySelector('.cookie-settings-button');
  opener.focus();
  opener.click();
  const focusedOption = document.activeElement;
  storageChange(window, preference('accepted'));
  assert.ok(visible(banner(document)), 'Another tab does not interrupt explicitly opened settings');
  assert.equal(document.activeElement, focusedOption);
  choice(document, 'rejected').click();
  assert.equal(JSON.parse(window.localStorage.getItem(consentKey)).choice, 'rejected');
  assert.equal(document.activeElement, opener);
});

test('account cookie controls are available accessibly and remain subject to the account authentication lock', t => {
  const html = readFileSync(path.join(root, 'settings.html'), 'utf8');
  const raw = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => raw.window.close());
  const rawDocument = raw.window.document;
  for (const value of ['accepted', 'rejected']) {
    const button = accountChoice(rawDocument, value);
    assert.equal(button.type, 'button', 'Cookie choices do not submit account preferences');
    assert.ok(button.disabled, 'Choices are disabled before the shared script is ready');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.ok(button.closest('#settings-content'), 'Choices belong to the protected account settings');
  }

  const locked = page(t, { html, filename: 'settings.html' });
  assert.ok(locked.document.getElementById('settings-content').disabled, 'Cookie initialization does not unlock the account');
  assertAccountChoice(locked.document, null);
  for (const value of ['accepted', 'rejected']) {
    assert.ok(accountChoice(locked.document, value).matches(':disabled'), 'Unauthenticated account controls remain disabled');
  }

  const ready = accountPage(t);
  assertAccountChoice(ready.document, null);
  for (const value of ['accepted', 'rejected']) assert.ok(!accountChoice(ready.document, value).matches(':disabled'));
  assert.equal(ready.window.localStorage.getItem(consentKey), null, 'Opening settings does not silently choose cookies');
});

for (const value of ['accepted', 'rejected']) {
  test(`the account can save and later change ${value} optional cookies immediately`, t => {
    let requests = 0;
    let preferenceSubmissions = 0;
    const { window, document } = accountPage(t, {
      prepare(window) {
        window.fetch = () => { requests++; throw new Error('Cookie choices must not make account requests'); };
        window.document.cookie = 'careerkraft-session=session-fixture; path=/';
        window.localStorage.setItem('careerkraft-theme', 'dark');
        window.document.getElementById('preferences-form').addEventListener('submit', event => {
          event.preventDefault();
          preferenceSubmissions++;
        });
      }
    });
    const button = accountChoice(document, value);
    button.focus();
    button.click();
    assertAccountChoice(document, value);
    assert.deepEqual(JSON.parse(window.localStorage.getItem(consentKey)), { version: 1, choice: value, savedAt: now });
    assert.ok(!visible(banner(document)), 'Saving in the account dismisses the shared cookie notice');
    assert.equal(document.activeElement, button, 'The inline cookie choice retains keyboard focus');
    assert.equal(document.cookie, 'careerkraft-session=session-fixture');
    assert.equal(window.localStorage.getItem('careerkraft-theme'), 'dark');
    assert.equal(requests, 0);
    assert.equal(preferenceSubmissions, 0, 'There is no separate Save preferences step');

    const dashboard = page(t, { filename: 'dashboard.html', saved: window.localStorage.getItem(consentKey) });
    assert.ok(!visible(banner(dashboard.document)), 'The account choice is also remembered on the dashboard');

    const changed = value === 'accepted' ? 'rejected' : 'accepted';
    accountChoice(document, changed).focus();
    accountChoice(document, changed).click();
    assertAccountChoice(document, changed);
    assert.deepEqual(JSON.parse(window.localStorage.getItem(consentKey)), { version: 1, choice: changed, savedAt: now });
    assert.equal(document.activeElement, accountChoice(document, changed));
  });
}

test('account status reflects existing choices and choices made in the shared banner', t => {
  const { document } = accountPage(t, { saved: preference('accepted') });
  assertAccountChoice(document, 'accepted');
  const opener = document.querySelector('.cookie-settings-button');
  const initialStatus = document.getElementById('account-cookie-status').textContent;
  opener.click();
  assertAccountChoice(document, 'accepted');
  assert.equal(document.getElementById('account-cookie-status').textContent, initialStatus, 'Reopening settings does not change the saved preference');
  choice(document, 'rejected').click();
  assertAccountChoice(document, 'rejected');
  assert.ok(!visible(banner(document)));
  opener.click();
  choice(document, 'accepted').click();
  assertAccountChoice(document, 'accepted');
});

test('account choices stay synchronized with other tabs, including clearing all local storage', t => {
  const { window, document } = accountPage(t, { saved: preference('accepted') });
  const selected = accountChoice(document, 'accepted');
  selected.focus();
  storageChange(window, preference('rejected'));
  assertAccountChoice(document, 'rejected');
  assert.equal(document.activeElement, selected, 'Another tab does not move focus from account controls');
  storageChange(window, null, 'unrelated-preference');
  assertAccountChoice(document, 'rejected');
  storageChange(window, null);
  assertAccountChoice(document, null);
  assert.ok(visible(banner(document)));
  storageChange(window, preference('accepted'));
  assertAccountChoice(document, 'accepted');
  window.localStorage.clear();
  window.dispatchEvent(new window.StorageEvent('storage', { key: null, storageArea: window.localStorage }));
  assertAccountChoice(document, null);
  assert.ok(visible(banner(document)), 'Clearing browser storage requests a new choice');
  assert.equal(window.localStorage.getItem(consentKey), null, 'Clearing does not implicitly accept cookies');
});

test('account controls refresh on page restore without duplicate controls or save handlers', t => {
  let writes = 0;
  const { window, document } = accountPage(t, {
    saved: preference('accepted'),
    prepare(window) {
      const setItem = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = function(key, value) {
        if (key === consentKey) writes++;
        return setItem.call(this, key, value);
      };
    }
  });
  window.localStorage.setItem(consentKey, preference('rejected'));
  for (let restore = 0; restore < 3; restore++) window.dispatchEvent(new window.Event('pageshow'));
  assertAccountChoice(document, 'rejected');
  writes = 0;
  accountChoice(document, 'accepted').click();
  assert.equal(writes, 1, 'One click performs one shared consent save');
  assert.equal(document.querySelectorAll('[data-account-cookie-choice]').length, 2);
  assert.equal(document.querySelectorAll('.cookie-banner').length, 1);
  assert.equal(document.querySelectorAll('.cookie-settings-button').length, 1);
});

test('account choices remain usable when browser storage is unavailable and explain the persistence limit', t => {
  for (const failure of ['unavailable', 'write-failure']) {
    const { window, document, errors } = accountPage(t, {
      saved: failure === 'write-failure' ? preference('accepted') : undefined,
      prepare(window) {
        if (failure === 'unavailable') {
          Object.defineProperty(window, 'localStorage', {
            get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); }
          });
        } else {
          window.Storage.prototype.setItem = () => { throw new window.DOMException('Quota exceeded', 'QuotaExceededError'); };
        }
      }
    });
    for (const value of ['rejected', 'accepted']) {
      accountChoice(document, value).focus();
      accountChoice(document, value).click();
      assertAccountChoice(document, value);
      assert.ok(!visible(banner(document)));
      window.dispatchEvent(new window.Event('pageshow'));
      assertAccountChoice(document, value);
      const status = document.getElementById('account-cookie-status').textContent;
      assert.match(status, /this (?:page|visit|session)|cannot remember|can't remember|could not (?:save|remember)|couldn't (?:save|remember)/i);
      assert.doesNotMatch(status, /(?:saved|remembered) for 180 days/i, 'The account does not claim a failed save persisted');
      assert.equal(document.activeElement, accountChoice(document, value));
    }
    assert.deepEqual(errors, []);
  }
});

test('unsupported programmatic cookie choices cannot alter the saved or visible preference', t => {
  const { window, document } = accountPage(t, { saved: preference('rejected') });
  const before = window.localStorage.getItem(consentKey);
  for (const invalid of ['unknown', '', null, undefined, true, {}]) {
    assert.equal(window.careerCookies.setChoice(invalid), false);
    assert.equal(window.localStorage.getItem(consentKey), before);
    assertAccountChoice(document, 'rejected');
    assert.ok(!visible(banner(document)));
  }
});

test('every page receives one cookie notice and a working footer settings control from the shared script', t => {
  // Trustpilot's verification payload must stay separate from application UI.
  const filenames = readdirSync(root).filter(filename => filename.endsWith('.html') &&
    filename !== 'dd8adc22-d472-4bce-94ad-d465f4689348.html');
  assert.ok(filenames.includes('dashboard.html'));
  for (const filename of filenames) {
    const html = readFileSync(path.join(root, filename), 'utf8');
    const { window, document } = page(t, { html, filename });
    assert.ok(document.querySelector('script[src="/site.js"]'), `${filename} loads the shared behavior`);
    assert.ok(document.querySelector('link[rel="stylesheet"][href="/site.css"]'), `${filename} loads shared styling`);
    assert.equal(document.querySelectorAll('.cookie-banner').length, 1, `${filename} has one notice`);
    assert.ok(visible(banner(document)), filename);
    const settings = document.querySelector('footer nav button.cookie-settings-button');
    assert.ok(settings, `${filename} has cookie settings in its footer`);
    choice(document, 'rejected').click();
    assert.ok(!visible(banner(document)), `${filename} can reject optional cookies`);
    settings.click();
    assert.ok(visible(banner(document)), `${filename} can reopen settings`);
    choice(document, 'accepted').click();
    window.dispatchEvent(new window.Event('pageshow'));
    assert.equal(document.querySelectorAll('.cookie-banner').length, 1, `${filename} does not duplicate its notice on restore`);
    assert.equal(document.querySelectorAll('.cookie-settings-button').length, 1, `${filename} does not duplicate settings on restore`);
    assert.ok(!visible(banner(document)), filename);
  }
});
