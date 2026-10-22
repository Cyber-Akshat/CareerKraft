const {test}=require('node:test');const assert=require('node:assert/strict');const {validateLearningResources,createLearningResourceVerifier}=require('../module-content');
const resource={title:'Using Fetch',provider:'MDN Web Docs',url:'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',resourceType:'documentation',description:'Make HTTP requests.',studyFocus:'Requests, responses and JSON.'};
test('resource validation rejects untrusted hosts, unsafe schemes, credentials and invalid types',()=>{
 const bad=['http://developer.mozilla.org/path','https://developer.mozilla.org.evil.test/path','https://evil.test/path','javascript:alert(1)','https://user:password@developer.mozilla.org/path','https://developer.mozilla.org:8080/path'];
 const result=validateLearningResources([null,...bad.map(url=>({...resource,url})),{...resource,resourceType:'unknown'},resource,resource]);assert.deepEqual(result,[resource]);assert.deepEqual(validateLearningResources(null),[]);
 const many=Array.from({length:6},(_,i)=>({...resource,url:resource.url+'?n='+i}));assert.equal(validateLearningResources(many).length,4);
});

const htmlResponse = (title = 'Using Fetch', status = 200) => new Response(
  `<html><head><title>${title}</title></head><body>Learning content</body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

test('live resource checks use GET without credentials and reject HTTP failures', async () => {
  const requests = [];
  const verify = createLearningResourceVerifier({ fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const status = Number(new URL(url).searchParams.get('status') || 200);
    return htmlResponse('Using Fetch', status);
  } });
  assert.deepEqual(await verify([resource]), [resource]);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.equal(requests[0].options.headers.Authorization, undefined);
  for (const status of [404, 410, 403, 500]) {
    assert.deepEqual(await verify([{ ...resource, url: `${resource.url}?status=${status}` }]), []);
  }
  assert.equal(requests.length, 5);
});

test('live checks follow trusted redirects and deduplicate the final URL', async () => {
  const requests = [];
  const target = 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch';
  const verify = createLearningResourceVerifier({ fetchImpl: async url => {
    requests.push(url);
    if (url === resource.url) return new Response(null, { status: 301, headers: { Location: '/en-US/docs/Web/API/Fetch_API/Using_Fetch' } });
    return htmlResponse();
  } });
  const result = await verify([resource, { ...resource, url: target }]);
  assert.deepEqual(result, [{ ...resource, url: target }]);
  assert.ok(requests.includes(target));
  assert.ok(requests.every(url => new URL(url).hostname === 'developer.mozilla.org'));
});

test('live checks never request unsafe redirect destinations and stop redirect loops', async () => {
  for (const location of [
    'https://untrusted.example/lesson',
    'https://www.coursera.org/learn/example',
    'https://www.open.edu/courses/example',
    'http://developer.mozilla.org/lesson',
    'https://developer.mozilla.org:8443/lesson',
    'https://user:password@developer.mozilla.org/lesson',
    'https://developer.mozilla.org.evil.example/lesson'
  ]) {
    const requests = [];
    const verify = createLearningResourceVerifier({ fetchImpl: async url => {
      requests.push(url);
      return new Response(null, { status: 302, headers: { Location: location } });
    } });
    assert.deepEqual(await verify([resource]), []);
    assert.deepEqual(requests, [resource.url]);
  }
  let loopCalls = 0;
  const loopVerifier = createLearningResourceVerifier({ fetchImpl: async () => {
    loopCalls++;
    return new Response(null, { status: 302, headers: { Location: resource.url } });
  } });
  assert.deepEqual(await loopVerifier([resource]), []);
  assert.equal(loopCalls, 1);
  let chainCalls = 0;
  const chainVerifier = createLearningResourceVerifier({ fetchImpl: async () => {
    chainCalls++;
    return new Response(null, { status: 302, headers: { Location: `https://developer.mozilla.org/redirect-${chainCalls}` } });
  } });
  assert.deepEqual(await chainVerifier([resource]), []);
  assert.equal(chainCalls, 5);
});

test('live checks reject soft 404 titles but retain learning pages discussing HTTP 404', async () => {
  for (const title of ['404 Not Found | MDN', 'Page not found', 'Access denied']) {
    const verify = createLearningResourceVerifier({ fetchImpl: async () => htmlResponse(title) });
    assert.deepEqual(await verify([resource]), []);
  }
  const verify = createLearningResourceVerifier({ fetchImpl: async () => new Response(
    '<html><head><title>Handling HTTP errors</title></head><body>Learn how to handle 404 Not Found responses.</body></html>',
    { headers: { 'Content-Type': 'text/html' } }
  ) });
  assert.deepEqual(await verify([resource]), [resource]);
});

test('network errors and request timeouts omit resources without failing the module', async () => {
  const failedVerifier = createLearningResourceVerifier({ fetchImpl: async () => { throw new Error('Network unavailable'); } });
  assert.deepEqual(await failedVerifier([resource]), []);
  let aborted = false;
  const timeoutVerifier = createLearningResourceVerifier({ timeoutMs: 15, fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('Mock request did not abort')), 200);
    signal.addEventListener('abort', () => {
      aborted = true;
      clearTimeout(guard);
      reject(signal.reason);
    }, { once: true });
  }) });
  assert.deepEqual(await timeoutVerifier([resource]), []);
  assert.equal(aborted, true);
});

test('resource checks share in-flight work and refresh successful and failed caches after expiry', async () => {
  let now = 100;
  let requests = 0;
  let finishRequest;
  const verify = createLearningResourceVerifier({ now: () => now, cacheTtlMs: 60000,
    fetchImpl: async () => {
      requests++;
      return new Promise(resolve => { finishRequest = resolve; });
    }
  });
  const first = verify([resource]);
  const simultaneous = verify([resource]);
  assert.equal(requests, 1);
  finishRequest(htmlResponse());
  assert.deepEqual(await first, [resource]);
  assert.deepEqual(await simultaneous, [resource]);
  now += 59999;
  assert.deepEqual(await verify([resource]), [resource]);
  assert.equal(requests, 1);
  now++;
  const refreshed = verify([resource]);
  assert.equal(requests, 2);
  finishRequest(htmlResponse('Missing', 404));
  assert.deepEqual(await refreshed, []);
  now += 29999;
  assert.deepEqual(await verify([resource]), []);
  assert.equal(requests, 2);
  now++;
  const recovered = verify([resource]);
  assert.equal(requests, 3);
  finishRequest(htmlResponse());
  assert.deepEqual(await recovered, [resource]);
});

test('resources exclude paid platforms and free-trial content even on trusted hosts', () => {
  const blocked = ['https://www.coursera.org/learn/example', 'https://www.edx.org/learn/example', 'https://www.udemy.com/course/example', 'https://www.linkedin.com/learning/example', 'https://skillbuilder.aws/learn/course/example', 'https://aws.amazon.com/training/', 'https://www.open.edu/courses/example', 'https://www.youtube.com/premium'];
  assert.deepEqual(validateLearningResources(blocked.map(url => ({...resource, url}))), []);
  assert.deepEqual(validateLearningResources([{...resource, description:'Start a free trial for the full course.'}]), []);
  assert.equal(validateLearningResources([{...resource, provider:'OpenLearn',url:'https://www.open.edu/openlearn/science-maths-technology/free-course'}]).length, 1);
  assert.equal(validateLearningResources([resource]).length, 1);
});
