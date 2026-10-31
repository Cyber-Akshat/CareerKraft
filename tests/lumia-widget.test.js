const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(require.resolve('../lumia-widget.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function backend() {
  return { conversations: new Map(), latestId: 0, nextConversation: 1, nextMessage: 1 };
}

async function load(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="focus-target">Focus</button></body></html>', {
    url: options.url || 'http://localhost/dashboard.html', runScripts: 'outside-only'
  });
  const { window } = dom;
  const state = options.state || backend();
  const calls = [];
  let lastResponse = null;
  const api = async (endpoint, body) => {
    calls.push({ endpoint, body: body && JSON.parse(JSON.stringify(body)) });
    if (endpoint === 'lumia/history') {
      if (options.history) {
        const response = await options.history();
        if (response) return response;
      }
      if (!state.latestId) {
        state.latestId = state.nextConversation++;
        state.conversations.set(state.latestId, []);
      }
      return { data: { conversation: { id: state.latestId }, messages: state.conversations.get(state.latestId), context: options.context || {} } };
    }
    if (endpoint === 'lumia/new-conversation') {
      if (options.newConversation) return options.newConversation(endpoint, body);
      state.latestId = state.nextConversation++;
      state.conversations.set(state.latestId, []);
      return { data: { conversation: { id: state.latestId } } };
    }
    lastResponse = options.request ? options.request(endpoint, body) : Promise.resolve({
      data: { answer: 'Focus on your current activity.', context: { career: { title: 'Teacher' }, currentLevel: 'beginner' } }
    });
    const result = await lastResponse;
    if (!result.error && typeof result.data?.answer === 'string') {
      const id = body.conversationId || state.latestId;
      const messages = state.conversations.get(id);
      const userMessage = { id: state.nextMessage++, role: 'user', content: body.message };
      const assistantMessage = { id: state.nextMessage++, role: 'assistant', content: result.data.answer };
      messages.push(userMessage, assistantMessage);
      return { ...result, data: { ...result.data, conversationId: id, assistantMessageId: assistantMessage.id } };
    }
    return result;
  };
  window.console.error = () => {};
  window.HTMLElement.prototype.scrollTo = function ({ top }) { this.scrollTop = top; };
  window.careerAuth = options.noAuth ? undefined : {
    getSession: options.getSession || (async () => ({ data: { session: { user: { id: options.userId || 1 } } } })),
    request: api
  };
  t.after(() => window.close());
  window.eval(script);
  await settle();
  await settle();
  const d = window.document;
  return {
    w: window, d, calls, state, lastResponse,
    el: id => d.getElementById(id),
    bubbles: () => [...d.querySelectorAll('.lumia-message-bubble')].map(node => node.textContent),
    chatCalls: () => calls.filter(call => call.endpoint === 'lumia/chat'),
    async send(text) {
      this.el('lumia-input').value = text;
      this.el('lumia-input').dispatchEvent(new window.Event('input', { bubbles: true }));
      this.el('lumia-send').click();
      await settle();
      await settle();
    }
  };
}

test('signed-in widget restores server history and shows four prompts', async t => {
  const ui = await load(t);
  assert.equal(ui.d.querySelectorAll('#lumia-widget').length, 1);
  assert.equal(ui.el('lumia-panel').hidden, true);
  assert.equal(ui.el('lumia-input').maxLength, 3000);
  assert.equal(ui.d.querySelectorAll('.lumia-suggestion').length, 4);
  assert.deepEqual(ui.calls.map(call => call.endpoint), ['lumia/history']);
});

test('a Lumia navigation link opens the signed-in companion without sending a message or starting a new chat', async t => {
  const ui = await load(t, { url: 'http://localhost/dashboard.html#lumia' });
  assert.equal(ui.el('lumia-panel').hidden, false);
  assert.equal(ui.el('lumia-launcher').getAttribute('aria-expanded'), 'true');
  assert.equal(ui.el('lumia-input').value, '');
  assert.deepEqual(ui.calls.map(call => call.endpoint), ['lumia/history']);
  assert.deepEqual(ui.bubbles(), []);
});

test('changing to the Lumia fragment opens the existing panel while other dashboard destinations do not', async t => {
  const ui = await load(t);
  ui.w.location.hash = '#skills';
  ui.w.dispatchEvent(new ui.w.HashChangeEvent('hashchange'));
  assert.equal(ui.el('lumia-panel').hidden, true);
  ui.w.location.hash = '#lumia';
  ui.w.dispatchEvent(new ui.w.HashChangeEvent('hashchange'));
  assert.equal(ui.el('lumia-panel').hidden, false);
  assert.equal(ui.d.querySelectorAll('#lumia-widget').length, 1);
  ui.el('lumia-close').click();
  ui.w.location.hash = '#roadmap';
  ui.w.dispatchEvent(new ui.w.HashChangeEvent('hashchange'));
  assert.equal(ui.el('lumia-panel').hidden, true);
  assert.deepEqual(ui.calls.map(call => call.endpoint), ['lumia/history']);
});

test('widget is absent when authentication is unavailable or signed out', async t => {
  for (const options of [
    { noAuth: true },
    { getSession: async () => ({ data: { session: null } }) },
    { getSession: async () => ({ error: { message: 'Expired' }, data: { session: { user: { id: 1 } } } }) },
    { getSession: async () => { throw new Error('Offline'); } }
  ]) {
    const ui = await load(t, { ...options, url: 'http://localhost/dashboard.html#lumia' });
    assert.equal(ui.el('lumia-widget'), null);
    assert.equal(ui.calls.length, 0);
  }
});

test('duplicate script inclusion creates a single widget', async t => {
  const ui = await load(t);
  ui.w.eval(script);
  assert.equal(ui.d.querySelectorAll('#lumia-widget').length, 1);
});

test('launcher and close toggle the panel accessibly', async t => {
  const ui = await load(t);
  ui.el('lumia-launcher').click();
  assert.equal(ui.el('lumia-panel').hidden, false);
  assert.equal(ui.el('lumia-launcher').getAttribute('aria-expanded'), 'true');
  ui.el('lumia-close').click();
  assert.equal(ui.el('lumia-panel').hidden, true);
  assert.equal(ui.el('lumia-launcher').getAttribute('aria-expanded'), 'false');
});

test('suggested prompts send page-aware context and render responses as text', async t => {
  const ui = await load(t, { url: 'http://localhost/activity.html?step=82' });
  const suggestion = ui.d.querySelector('.lumia-suggestion');
  suggestion.click();
  await settle();
  const call = ui.chatCalls()[0];
  assert.equal(call.body.message, suggestion.dataset.prompt);
  assert.deepEqual(call.body.pageContext, { path: '/activity.html', stepId: 82 });
  assert.equal(call.body.conversationId, 1);
  assert.equal(ui.bubbles().at(-1), 'Focus on your current activity.');
});

test('Enter sends trimmed text and Shift+Enter remains an editing action', async t => {
  const ui = await load(t);
  ui.el('lumia-input').value = '  Why is this next?  ';
  const newline = new ui.w.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
  ui.el('lumia-input').dispatchEvent(newline);
  assert.equal(newline.defaultPrevented, false);
  const enter = new ui.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  ui.el('lumia-input').dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  await settle();
  assert.equal(ui.chatCalls()[0].body.message, 'Why is this next?');
});

test('each new question continues the active conversation and refresh restores the full transcript', async t => {
  const state = backend();
  const first = await load(t, { state });
  await first.send('What next?');
  await first.send('Why?');
  assert.equal(first.chatCalls()[1].body.conversationId, first.chatCalls()[0].body.conversationId);
  const restored = await load(t, { state, url: 'http://localhost/career.html' });
  assert.deepEqual(restored.bubbles(), ['What next?', 'Focus on your current activity.', 'Why?', 'Focus on your current activity.']);
});

test('new chat creates a new server conversation without deleting previous messages', async t => {
  const state = backend();
  const ui = await load(t, { state });
  await ui.send('Keep this history');
  const firstId = state.latestId;
  ui.el('lumia-new-chat').click();
  await settle();
  assert.notEqual(state.latestId, firstId);
  assert.equal(state.conversations.get(firstId).length, 2);
  assert.equal(ui.d.querySelectorAll('.lumia-message').length, 0);
  assert.equal(ui.el('lumia-welcome').hidden, false);
});

test('assistant response displays unread marker when panel was closed and clears it on open', async t => {
  const ui = await load(t);
  await ui.send('Reply while closed');
  const unread = ui.el('lumia-launcher').querySelector('.lumia-unread');
  assert.equal(unread.hidden, false);
  ui.el('lumia-launcher').click();
  assert.equal(unread.hidden, true);
});

test('closing Lumia during a pending response shows unread when the answer arrives', async t => {
  let resolveResponse;
  const ui = await load(t, {
    request: () => new Promise(resolve => { resolveResponse = resolve; })
  });
  ui.el('lumia-launcher').click();
  ui.el('lumia-input').value = 'Help me plan this activity';
  ui.el('lumia-input').dispatchEvent(new ui.w.Event('input', { bubbles: true }));
  ui.el('lumia-send').click();
  ui.el('lumia-close').click();
  resolveResponse({ data: { answer: 'Start with the activity brief.' } });
  await settle();
  await settle();
  assert.equal(ui.el('lumia-launcher').querySelector('.lumia-unread').hidden, false);
});

test('another signed-in user cannot see the previous user transcript', async t => {
  const state = backend();
  const first = await load(t, { state, userId: 1 });
  await first.send('Private student message');
  const second = await load(t, { state: backend(), userId: 2 });
  assert.deepEqual(second.bubbles(), []);
});

test('assistant output is inserted as inert text', async t => {
  const attack = '<img src=x onerror="window.injected=1">';
  const ui = await load(t, { request: async () => ({ data: { answer: attack } }) });
  await ui.send('Test');
  assert.equal(ui.d.querySelector('#lumia-widget img'), null);
  assert.equal(ui.w.injected, undefined);
});

test('send button disables during generation and recovers on API errors', async t => {
  let resolveRequest;
  const request = () => new Promise(resolve => { resolveRequest = resolve; });
  const ui = await load(t, { request });
  ui.el('lumia-input').value = 'Please help';
  ui.el('lumia-input').dispatchEvent(new ui.w.Event('input', { bubbles: true }));
  ui.el('lumia-send').click();
  assert.equal(ui.el('lumia-send').disabled, true);
  resolveRequest({ error: { message: 'Unavailable' } });
  await settle();
  await settle();
  assert.equal(ui.el('lumia-send').disabled, false);
  assert.equal(ui.el('lumia-input').value, 'Please help');
  assert.match(ui.el('lumia-status').textContent, /Unavailable/);
  assert.equal(ui.d.querySelectorAll('.lumia-message').length, 0);
});

test('new conversation failures are surfaced in the widget', async t => {
  const ui = await load(t, { newConversation: async () => ({ error: { message: 'Try again.' } }) });
  ui.el('lumia-new-chat').click();
  await settle();
  assert.match(ui.el('lumia-status').textContent, /Try again/);
});

test('new chat prevents duplicate requests and recovers from thrown failures', async t => {
  let rejectRequest;
  let requests = 0;
  const ui = await load(t, { newConversation: () => {
    requests += 1;
    return new Promise((_, reject) => { rejectRequest = reject; });
  } });
  ui.el('lumia-new-chat').click();
  ui.el('lumia-new-chat').click();
  assert.equal(requests, 1);
  assert.equal(ui.el('lumia-new-chat').disabled, true);
  rejectRequest(new Error('Temporarily offline.'));
  await settle();
  assert.equal(ui.el('lumia-new-chat').disabled, false);
  assert.match(ui.el('lumia-status').textContent, /offline/);
});

test('history failures offer a working retry and keep sending disabled until restored', async t => {
  let attempts = 0;
  const ui = await load(t, { history: async () => ++attempts === 1 ? { error: { message: 'History unavailable.' } } : null });
  assert.equal(ui.el('lumia-history-retry').hidden, false);
  ui.el('lumia-input').value = 'A question';
  ui.el('lumia-input').dispatchEvent(new ui.w.Event('input', { bubbles: true }));
  assert.equal(ui.el('lumia-send').disabled, true);
  ui.el('lumia-history-retry').click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(ui.el('lumia-history-retry').hidden, true);
  assert.equal(ui.el('lumia-send').disabled, false);
});

test('history retry cannot race a pending new conversation and replace its state', async t => {
  let historyCalls = 0;
  let finishNew;
  const ui = await load(t, {
    history: async () => { historyCalls += 1; return { error: { message: 'History unavailable.' } }; },
    newConversation: () => new Promise(resolve => { finishNew = resolve; })
  });
  ui.el('lumia-new-chat').click();
  assert.equal(ui.el('lumia-history-retry').disabled, true);
  ui.el('lumia-history-retry').dispatchEvent(new ui.w.Event('click', { bubbles: true }));
  assert.equal(historyCalls, 1);
  finishNew({ data: { conversation: { id: 22 } } });
  await settle();
  assert.equal(ui.el('lumia-history-retry').hidden, true);
  assert.match(ui.el('lumia-status').textContent, /New conversation ready/);
});
