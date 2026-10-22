const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

test('browser API client preserves multipart bodies and lets the browser set their boundary', async () => {
  const calls = [];
  const context = vm.createContext({ window: {}, FormData,
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true, json: async () => ({ success: true }) }; }
  });
  vm.runInContext(readFileSync(require.resolve('../auth-api'), 'utf8'), context);
  const body = new FormData();
  body.append('evidenceFile', new Blob(['My completed work.'], { type: 'text/plain' }), 'work.txt');
  await context.window.careerAuth.request('roadmap/steps/1/evidence', body);
  assert.equal(calls[0].body, body);
  assert.equal(Object.hasOwn(calls[0].headers, 'Content-Type'), false);
  assert.equal(calls[0].credentials, 'same-origin');
  const written = new FormData();
  written.append('textContent', 'My written response.');
  await context.window.careerAuth.request('roadmap/steps/1/evidence', written);
  assert.equal(calls[1].body, written);
  assert.equal(Object.hasOwn(calls[1].headers, 'Content-Type'), false);
  await context.window.careerAuth.request('roadmap/steps/1/evidence', { submissionType: 'text', textContent: 'My written response.' });
  assert.equal(calls[2].headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(calls[2].body).submissionType, 'text');
  await context.window.careerAuth.request('session');
  assert.equal(calls[3].method, 'GET');
  assert.equal(calls[3].body, undefined);
});
