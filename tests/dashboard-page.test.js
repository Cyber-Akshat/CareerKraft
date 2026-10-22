const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require.resolve('../dashboard.html'), 'utf8');
const script = fs.readFileSync(require.resolve('../dashboard.js'), 'utf8');
const career = { id: 'teacher', title: 'Teacher' };
const roadmap = { career, progress: 0, completedSteps: 0, totalSteps: 1,
  nextStep: { id: 1, title: 'Explore teaching', description: 'Learn about teaching.', estimatedMinutes: 20 },
  phases: [{ phaseNumber: 1, title: 'Foundations', steps: [{ id: 1, title: 'Explore teaching', status: 'not_started' }] }] };
const settle = () => new Promise(resolve => setImmediate(resolve));
function load(t, request, skillsRequest = async () => ({ data: { skills: [], summary: { totalSkills: 0, totalVerifications: 0 } } }), options = {}) {
  const dom = new JSDOM(html, { url: options.url || 'http://localhost/dashboard.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  if (options.onReady) dom.window.addEventListener('careerkraft:dashboard-ready', options.onReady);
  dom.window.careerAuth = { getSession: options.getSession || (async () => ({ data: { session: { user: { name: 'Alex' } } } })), request: (endpoint, body) => endpoint === 'skills' ? skillsRequest() : request(endpoint, body) };
  dom.window.eval(script);
  return dom.window.document;
}
test('dashboard announces tour readiness only after the authenticated roadmap has settled', async t => {
  let finishRoadmap;
  const events = [];
  const user = { id: 71, name: 'New member', dashboardTourSeen: false };
  const d = load(t, () => new Promise(resolve => { finishRoadmap = resolve; }), undefined, {
    getSession: async () => ({ data: { session: { user } } }),
    onReady(event) { events.push({ user: event.detail.user, hasRoadmap: event.detail.hasRoadmap, busy: event.target.document.querySelector('main').getAttribute('aria-busy') }); }
  });
  await settle();
  assert.equal(events.length, 0, 'No tutorial runs over the loading dashboard');
  finishRoadmap({ data: { roadmap } });
  await settle();
  assert.equal(events.length, 1);
  assert.equal(events[0].user.id, 71);
  assert.equal(events[0].user.dashboardTourSeen, false);
  assert.equal(events[0].hasRoadmap, true);
  assert.equal(events[0].busy, 'false');
  assert.equal(d.querySelector('#start-next-step-button').disabled, false);
});

test('an unavailable dashboard does not announce a first-visit tutorial', async t => {
  const events = [];
  load(t, async () => ({ error: { message: 'Roadmap unavailable.' } }), undefined, {
    getSession: async () => ({ data: { session: { user: { id: 72, dashboardTourSeen: false } } } }),
    onReady(event) { events.push(event.detail); }
  });
  await settle();
  assert.equal(events.length, 0);
});

test('dashboard creates a missing roadmap for the saved career and renders it', async t => {
  const calls = [];
  const d = load(t, async (endpoint, body) => {
    calls.push({ endpoint, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    return { data: body ? { success: true } : calls.length === 1 ? { roadmap: null, selectedCareer: career } : { roadmap } };
  });
  await settle();
  assert.deepEqual(calls, [{ endpoint: 'roadmap', body: undefined }, { endpoint: 'roadmap', body: {} }, { endpoint: 'roadmap', body: undefined }]);
  assert.equal(d.querySelector('#dashboard-career-title').textContent, 'Teacher');
  assert.equal(d.querySelector('#next-step-title').textContent, 'Explore teaching');
  assert.equal(d.querySelectorAll('.roadmap-step').length, 1);
  assert.equal(d.querySelector('#dashboard-status').hidden, true);
});
test('dashboard loads an existing roadmap without recreating it', async t => {
  let calls = 0;
  const d = load(t, async () => { calls++; return { data: { roadmap } }; });
  await settle();
  assert.equal(calls, 1);
  assert.equal(d.querySelector('#dashboard-career-title').textContent, 'Teacher');
});

test('an unavailable account stops loading and retry restores its roadmap and journey', async t => {
  let attempts = 0;
  const d = load(t, async () => ({ data: { roadmap } }), undefined, {
    getSession: async () => ++attempts === 1 ? { error: { message: 'Account temporarily unavailable.' } }
      : { data: { session: { user: { name: 'Alex' } } } }
  });
  await settle();
  assert.doesNotMatch(d.querySelector('#dashboard-career-title').textContent, /Loading/);
  assert.doesNotMatch(d.querySelector('#roadmap-current-level-badge').textContent, /Loading/);
  assert.equal(d.querySelector('#roadmap-levels').hidden, true);
  assert.equal(d.querySelector('main').getAttribute('aria-busy'), 'false');
  d.querySelector('#dashboard-retry').click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(d.querySelector('#dashboard-career-title').textContent, 'Teacher');
  assert.equal(d.querySelector('#roadmap-levels').hidden, false);
});

test('verified skill totals load while the roadmap request is still pending', async t => {
  let finishRoadmap;
  const d = load(t, () => new Promise(resolve => { finishRoadmap = resolve; }),
    async () => ({ data: { skills: [], summary: { totalSkills: 0, totalVerifications: 0 } } }));
  await settle();
  assert.equal(d.querySelector('#skills-total').textContent, '0');
  assert.equal(d.querySelector('#start-next-step-button').disabled, true);
  assert.equal(d.querySelector('main').getAttribute('aria-busy'), 'true');
  finishRoadmap({ data: { roadmap } });
  await settle();
  assert.equal(d.querySelector('#start-next-step-button').disabled, false);
  assert.equal(d.querySelector('main').getAttribute('aria-busy'), 'false');
});

test('the skills page refreshes level locks when its slower journey request arrives', async t => {
  let finishRoadmap;
  const d = load(t, () => new Promise(resolve => { finishRoadmap = resolve; }),
    async () => ({ data: { skills: [], levels: [], summary: { totalSkills: 0, totalVerifications: 0 } } }),
    { url: 'http://localhost/dashboard.html#skills' });
  await settle();
  assert.equal(d.title, 'Your verified skills | CareerKraft');
  finishRoadmap({ data: { roadmap, journey: { currentLevel: 'beginner', levels: [
    { id: 'beginner', status: 'current' }, { id: 'intermediate', status: 'locked' }, { id: 'advanced', status: 'locked' }
  ] } } });
  await settle();
  assert.equal(d.querySelector('.level-skill-chart[data-level="intermediate"]').classList.contains('is-locked'), true);
  assert.equal(d.querySelector('.level-skill-chart[data-level="advanced"]').classList.contains('is-locked'), true);
});
test('roadmap stages reveal details and only one stage is expanded at a time', async t => {
  const multiStepRoadmap = {
    ...roadmap,
    totalSteps: 2,
    phases: [{
      phaseNumber: 1,
      title: 'Foundations',
      steps: [
        { id: 1, title: 'Explore teaching', description: 'Discover the role.', status: 'not_started', estimatedMinutes: 20, activityType: 'learning' },
        { id: 2, title: 'Plan a lesson', description: 'Create a sample lesson.', status: 'not_started', estimatedMinutes: 30, activityType: 'activity' }
      ]
    }]
  };
  const d = load(t, async () => ({ data: { roadmap: multiStepRoadmap } }));
  await settle();

  const [firstStep, secondStep] = d.querySelectorAll('.roadmap-step');
  assert.equal(firstStep.getAttribute('aria-expanded'), 'true');
  assert.equal(firstStep.querySelector('.step-details').hidden, false);
  assert.equal(secondStep.getAttribute('aria-expanded'), 'false');

  secondStep.click();
  assert.equal(firstStep.getAttribute('aria-expanded'), 'false');
  assert.equal(firstStep.querySelector('.step-details').hidden, true);
  assert.equal(secondStep.getAttribute('aria-expanded'), 'true');
  assert.equal(secondStep.querySelector('.step-details').textContent.trim(), 'Create a sample lesson.');
});
test('dashboard keeps the selected career visible when creation fails', async t => {
  const d = load(t, async (endpoint, body) => body
    ? { error: { message: 'Roadmap unavailable.' } }
    : { data: { roadmap: null, selectedCareer: career } });
  await settle();
  assert.equal(d.querySelector('#dashboard-career-title').textContent, 'Teacher');
  assert.equal(d.querySelector('#start-next-step-button').disabled, true);
  assert.match(d.querySelector('#roadmap-phases').textContent, /Roadmap unavailable/);
  assert.doesNotMatch(d.querySelector('#roadmap-phases').textContent, /Loading/);
});
test('dashboard explains a missing choice and network failure without loading forever', async t => {
  for (const request of [async () => ({ data: { roadmap: null } }), async () => { throw new Error('Offline'); }]) {
    const d = load(t, request);
    await settle();
    assert.doesNotMatch(d.querySelector('#dashboard-career-title').textContent, /Loading/);
    assert.doesNotMatch(d.querySelector('#roadmap-phases').textContent, /Loading/);
    assert.equal(d.querySelector('#start-next-step-button').disabled, true);
  }
});

test('Start this step calls the progress API before opening the activity', async t => {
  let started = false;
  const calls = [];
  const d = load(t, async (endpoint, body) => {
    calls.push({ endpoint, body });
    if (endpoint === 'roadmap/steps/1/start') {
      assert.equal(JSON.stringify(body), '{}');
      started = true;
      return { data: { success: true, stepId: 1, status: 'in_progress' }, error: null };
    }
    return { data: { roadmap: { ...roadmap, phases: [{ ...roadmap.phases[0], steps: [{ ...roadmap.phases[0].steps[0], status: started ? 'in_progress' : 'not_started' }] }] } }, error: null };
  });
  await settle();
  const button = d.querySelector('#start-next-step-button');
  button.click();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Starting...');
  await settle();
  assert.equal(button.disabled, true);
  assert.deepEqual(calls.map(call => call.endpoint), ['roadmap', 'roadmap/steps/1/start']);
  assert.match(script, /activity\.html\?step=\$\{encodeURIComponent\(step\.id\)\}/);
});

test('failed start restores the button and leaves progress unchanged', async t => {
  const d = load(t, async endpoint => endpoint === 'roadmap'
    ? { data: { roadmap } }
    : { error: { message: 'Unable to start this activity.' } });
  await settle();
  const button = d.querySelector('#start-next-step-button');
  button.click();
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Start this step \u2192');
  assert.match(d.querySelector('#dashboard-status').textContent, /Unable to start/);
  assert.equal(d.querySelector('.roadmap-step.in_progress'), null);
});

test('thrown start failures restore a usable button and show an actionable error', async t => {
  const d = load(t, async endpoint => {
    if (endpoint === 'roadmap') return { data: { roadmap } };
    throw new Error('Network disconnected');
  });
  await settle();
  d.querySelector('#start-next-step-button').click();
  await settle();
  assert.equal(d.querySelector('#start-next-step-button').disabled, false);
  assert.match(d.querySelector('#dashboard-status').textContent, /connection.*try again/i);
});

test('skills failure shows unknown totals and retry restores actual account data', async t => {
  let attempts = 0;
  const d = load(t, async () => ({ data: { roadmap } }), async () => ++attempts === 1
    ? { error: { message: 'Skills temporarily unavailable.' } }
    : { data: { skills: [{ id: 8, name: 'Planning', verifiedCount: 2 }], summary: { totalSkills: 1, totalVerifications: 2 } } });
  await settle();
  assert.equal(d.querySelector('#skills-total').textContent, '\u2014');
  assert.match(d.querySelector('#skills-empty').textContent, /temporarily unavailable/);
  d.querySelector('#skills-empty button').click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(d.querySelector('#skills-total').textContent, '1');
  assert.equal(d.querySelector('#skills-empty').hidden, true);
  assert.match(d.querySelector('#skills-list').textContent, /Planning/);
});

test('roadmap request failures provide a working retry without claiming completion', async t => {
  let attempts = 0;
  const d = load(t, async () => ++attempts === 1 ? { error: { message: 'Roadmap offline.' } } : { data: { roadmap } });
  await settle();
  assert.equal(d.querySelector('#roadmap-progress-percent').textContent, '\u2014');
  assert.equal(d.querySelector('#start-next-step-button').disabled, true);
  d.querySelector('#dashboard-retry').click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(d.querySelector('#start-next-step-button').disabled, false);
  assert.equal(d.querySelector('#dashboard-status').hidden, true);
});

test('dashboard labels submitted evidence as review pending without counting it as completed', async t => {
  const pending = { ...roadmap, nextStep: { ...roadmap.nextStep, evidenceStatus: 'submitted' }, phases: [{ ...roadmap.phases[0], steps: [{ ...roadmap.phases[0].steps[0], status: 'in_progress', evidenceStatus: 'submitted' }] }] };
  const d = load(t, async () => ({ data: { roadmap: pending } }));
  await settle();
  assert.equal(d.querySelector('.roadmap-step .step-stage').textContent, 'Review pending');
  assert.match(d.querySelector('#start-next-step-button').textContent, /Review pending/);
  assert.equal(d.querySelector('#roadmap-progress-percent').textContent, '0%');
});

test('verified skills preview loads totals, caps six skills and safely renders names', async t => {
  let calls = 0;
  const skills = Array.from({ length: 7 }, (_, i) => ({ name: i === 0 ? '<img src=x onerror=alert(1)>' : `Skill ${i}`, verifiedCount: i + 1 }));
  const d = load(t, async () => ({ data: { roadmap } }), async () => { calls++; return { data: { skills, summary: { totalSkills: 7, totalVerifications: 28 } } }; });
  await settle();
  assert.equal(calls, 1);
  assert.equal(d.querySelector('#skills-total').textContent, '7');
  assert.equal(d.querySelector('#skills-verification-total').textContent, '28 activity verifications');
  assert.equal(d.querySelector('#skills-empty').hidden, true);
  assert.equal(d.querySelector('#skills-list').hidden, false);
  assert.equal(d.querySelectorAll('.skill-item').length, 6);
  assert.equal(d.querySelector('.skill-item strong').textContent, skills[0].name);
  assert.equal(d.querySelector('#skills-list img'), null);
  assert.equal(d.querySelector('.skill-item-copy span').textContent, 'Verified through 1 activity');
});

test('empty skills and failed skills requests preserve the working roadmap', async t => {
  for (const result of [{ data: { skills: [], summary: { totalSkills: 0, totalVerifications: 0 } } }, { error: { message: 'Unavailable' } }]) {
    const d = load(t, async () => ({ data: { roadmap } }), async () => result);
    await settle();
    assert.equal(d.querySelector('#skills-empty').hidden, false);
    assert.equal(d.querySelector('#skills-list').hidden, true);
    assert.equal(d.querySelector('#skills-card-footer').hidden, true);
    assert.equal(d.querySelector('#dashboard-career-title').textContent, 'Teacher');
  }
});

test('journey API updates current level, completion, locks and pathway messaging', async t => {
  for (const finished of [false, true]) {
    const journey = { currentLevel: finished ? 'advanced' : 'intermediate', pathwayCompleted: finished, levels: [
      {id:'beginner',title:'Beginner',status:'completed',completedSteps:7,totalSteps:7,percent:100},
      {id:'intermediate',title:'Intermediate',status:finished?'completed':'current',completedSteps:finished?7:2,totalSteps:7,percent:finished?100:29},
      {id:'advanced',title:'Advanced',status:finished?'completed':'locked',completedSteps:finished?7:0,totalSteps:finished?7:0,percent:finished?100:0}
    ] };
    const d = load(t, async () => ({data:{roadmap,journey}}));
    await settle();
    assert.ok(d.querySelector('#roadmap-level-beginner').classList.contains('completed'));
    if (!finished) {
      assert.ok(d.querySelector('#roadmap-level-intermediate').classList.contains('current'));
      assert.equal(d.querySelector('#roadmap-level-intermediate-progress-text').textContent,'2 / 7 complete');
      assert.equal(d.querySelector('#roadmap-level-intermediate-progress').style.width,'29%');
      assert.ok(d.querySelector('#roadmap-level-advanced').classList.contains('locked'));
      assert.equal(d.querySelector('#roadmap-level-advanced-progress-text').textContent,'Unlocks after Intermediate');
    } else {
      assert.equal(d.querySelector('#roadmap-current-level-badge').textContent,'Pathway completed \u2713');
      assert.equal(d.querySelectorAll('.roadmap-level-item.current').length,0);
      assert.equal(d.querySelector('#roadmap-level-message-title').textContent,'Career pathway completed');
    }
  }
});


test('stored level transition reveals ready state once and closes on entering the new level', async t => {
  const dom = new JSDOM(html, { url: 'http://localhost/dashboard.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.setTimeout = callback => { queueMicrotask(callback); return 1; };
  w.sessionStorage.setItem('careerkraft-level-progression', JSON.stringify({ advanced: true, generated: true, previousLevel: 'beginner', level: 'intermediate', stepsCreated: 7 }));
  let roadmapRequests = 0;
  w.careerAuth = { getSession: async () => ({ data: { session: { user: { name: 'Alex' } } } }), request: async endpoint => {
    if (endpoint === 'roadmap') { roadmapRequests++; return { data: { roadmap } }; }
    return { data: { skills: [], summary: { totalSkills: 0, totalVerifications: 0 } } };
  } };
  w.eval(script);
  await settle();
  const d = w.document;
  assert.equal(w.sessionStorage.getItem('careerkraft-level-progression'), null);
  assert.equal(d.querySelector('#level-transition-overlay').hidden, false);
  assert.equal(d.querySelector('#level-complete-stage').hidden, true);
  assert.equal(d.querySelector('#level-generating-stage').hidden, true);
  assert.equal(d.querySelector('#level-ready-stage').hidden, false);
  assert.equal(d.querySelector('#level-ready-title').textContent, 'Intermediate unlocked');
  assert.equal(d.querySelector('#level-generation-progress-fill').style.width, '100%');
  d.querySelector('#level-ready-button').click();
  await settle();
  assert.equal(d.querySelector('#level-transition-overlay').hidden, true);
  assert.equal(roadmapRequests, 2);
  assert.equal(d.body.style.overflow, '');
});
