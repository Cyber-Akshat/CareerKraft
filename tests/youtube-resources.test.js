const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLearningResources, createLearningResourceVerifier } = require('../module-content');

const videoId = 'M7lc1UVf-VE';
const canonical = `https://www.youtube.com/watch?v=${videoId}`;
const metadataURL = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
const metadata = { type: 'video', provider_name: 'YouTube', title: 'Free learning video' };
const resource = url => ({
  title: 'Study the example', provider: 'YouTube', url,
  resourceType: 'video', description: 'A free explanation of the module topic.',
  studyFocus: 'Follow the worked example and note the reasoning.'
});
const jsonResponse = value => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' }
});
const playerHTML = state => `<html><head><title>A useful video - YouTube</title></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: state })};</script></body></html>`;

function mockVerifier({ metadataResponse = () => jsonResponse(metadata), watchResponse } = {}) {
  const calls = [];
  const verify = createLearningResourceVerifier({
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.method, 'GET');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers?.Authorization, undefined);
      if (url === metadataURL) return metadataResponse();
      assert.equal(url, canonical);
      return watchResponse ? watchResponse() : new Response(playerHTML({ status: 'OK' }));
    }
  });
  return { verify, calls };
}

test('YouTube watch, shorts, embed and live links become the same canonical video URL', () => {
  for (const url of [
    `https://youtube.com/watch?v=${videoId}&t=18&list=ignored`,
    `https://www.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/embed/${videoId}?feature=oembed`,
    `https://youtube.com/live/${videoId}/`
  ]) {
    const result = validateLearningResources([resource(url)]);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, canonical);
  }
});

test('YouTube filtering rejects invented IDs and non-video pages, and deduplicates alternate links', () => {
  const invalid = [
    'https://www.youtube.com/watch?v=too-short',
    'https://www.youtube.com/watch?v=1234567890!',
    'https://www.youtube.com/watch?v=M7lc1UVf-VEextra',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/results?search_query=lesson',
    'https://www.youtube.com/@LearningChannel',
    'https://www.youtube.com/playlist?list=example',
    `https://www.youtube.com/embed/${videoId}/extra`,
    `http://www.youtube.com/watch?v=${videoId}`,
    `https://student:secret@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:444/watch?v=${videoId}`
  ];
  assert.deepEqual(validateLearningResources(invalid.map(resource)), []);
  const result = validateLearningResources([
    resource(canonical), resource(`https://youtube.com/shorts/${videoId}`),
    resource(`https://www.youtube.com/embed/${videoId}`)
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, canonical);
});

test('unavailable or malformed YouTube metadata never passes through to the watch-page check', async t => {
  const cases = [
    ['not found', () => new Response('Not found', { status: 404 })],
    ['private', () => new Response('Unauthorized', { status: 401 })],
    ['invalid JSON', () => new Response('not JSON')],
    ['null JSON', () => jsonResponse(null)],
    ['wrong type', () => jsonResponse({ ...metadata, type: 'link' })],
    ['wrong provider', () => jsonResponse({ ...metadata, provider_name: 'Other' })],
    ['missing title', () => jsonResponse({ ...metadata, title: '' })],
    ['blank title', () => jsonResponse({ ...metadata, title: '  ' })]
  ];
  for (const [label, metadataResponse] of cases) {
    await t.test(label, async () => {
      const { verify, calls } = mockVerifier({ metadataResponse });
      assert.deepEqual(await verify([resource(canonical)]), []);
      assert.deepEqual(calls, [metadataURL]);
    });
  }
});

test('HTTP 200 YouTube pages require an explicit playable status', async t => {
  for (const status of ['ERROR', 'LOGIN_REQUIRED', 'UNPLAYABLE', 'AGE_CHECK_REQUIRED']) {
    await t.test(status, async () => {
      const { verify } = mockVerifier({ watchResponse: () => new Response(playerHTML({
        status, reason: 'This video is unavailable.'
      })) });
      assert.deepEqual(await verify([resource(canonical)]), []);
    });
  }
  for (const [label, html] of [
    ['generic title without player', '<title>Helpful video - YouTube</title>'],
    ['truncated player status', '<title>YouTube</title><script>{"playabilityStatus":{"status":"OK"'],
    ['malformed player status', '<script>{"playabilityStatus":{"status":"OK",}}</script>']
  ]) {
    await t.test(label, async () => {
      const { verify } = mockVerifier({ watchResponse: () => new Response(html) });
      assert.deepEqual(await verify([resource(canonical)]), []);
    });
  }
});

test('playable video status is read beyond the title and handles nested JSON and escaped text', async () => {
  const state = {
    status: 'OK',
    reason: 'A quoted "example" includes braces { } and a backslash \\.',
    context: { details: { note: 'Nested { text } should not end the JSON object.' } },
    messages: ['Keep learning']
  };
  const { verify, calls } = mockVerifier({ watchResponse: () => new Response(playerHTML(state)) });
  const result = await verify([resource(`https://youtube.com/shorts/${videoId}`)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, canonical);
  assert.deepEqual(calls, [metadataURL, canonical]);
  // A subsequent visit uses the cached video result without another request.
  assert.deepEqual(await verify([resource(canonical)]), result);
  assert.deepEqual(calls, [metadataURL, canonical]);
});

test('YouTube consent redirects are rejected rather than counted as usable video pages', async t => {
  await t.test('metadata redirect', async () => {
    const { verify, calls } = mockVerifier({ metadataResponse: () => new Response('', {
      status: 302, headers: { Location: 'https://consent.youtube.com/' }
    }) });
    assert.deepEqual(await verify([resource(canonical)]), []);
    assert.deepEqual(calls, [metadataURL]);
  });
  await t.test('watch redirect', async () => {
    const { verify, calls } = mockVerifier({ watchResponse: () => new Response('', {
      status: 302, headers: { Location: 'https://consent.youtube.com/' }
    }) });
    assert.deepEqual(await verify([resource(canonical)]), []);
    assert.deepEqual(calls, [metadataURL, canonical]);
  });
});
