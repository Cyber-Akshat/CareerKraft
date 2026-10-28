const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const analysis = {
  overallScore: 78, scores: { structure: 85, clarity: 80, evidence: 65, relevance: 82 },
  strengths: ['Clear education'], priorityImprovements: ['Explain the project goal'],
  verifiedSkillsMissingFromCv: ['Research'], bulletRewrites: [], careerAlignmentSummary: 'A relevant project.'
};

async function load(t, hash = '') {
  const dom = new JSDOM(html, {
    url: `http://localhost:3000/dashboard.html${hash}`, runScripts: 'outside-only',
    virtualConsole: new VirtualConsole()
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const d = w.document;
  const requests = [];
  const timers = new Map();
  const intervals = new Map();
  let nextTimer = 0;
  w.localStorage.setItem('careerkraft-theme', 'dark');
  w.matchMedia = () => ({ matches: true });
  w.scrollTo = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = callback => { intervals.set(++nextTimer, callback); return nextTimer; };
  w.clearInterval = id => intervals.delete(id);
  w.careerAuth = {
    getSession: async () => ({ data: { session: { user: { id: 71, name: 'Alex', theme: 'dark' } } } }),
    request: async endpoint => {
      requests.push(endpoint);
      if (endpoint === 'skills') return { data: { skills: [], levels: [], summary: { totalSkills: 0, totalVerifications: 0 } } };
      return { data: { roadmap: {
        career: { id: 'teacher', title: 'Teacher' }, progress: 0, completedSteps: 0, totalSteps: 0,
        nextStep: null, phases: []
      } } };
    }
  };
  for (const file of ['dashboard.js', 'cv-scanner.js', 'cv-results.js']) {
    w.eval(readFileSync(path.join(root, file), 'utf8'));
  }
  await settle();
  await settle();
  const route = async hash => {
    w.location.hash = hash;
    w.dispatchEvent(new w.HashChangeEvent('hashchange'));
    await settle();
    // JSDOM schedules fragment-navigation events with zero-delay window timers.
    for (let pass = 0; pass < 5; pass++) {
      const queued = [...timers.entries()].filter(([, timer]) => timer.delay === 0);
      if (!queued.length) break;
      for (const [id, timer] of queued) { timers.delete(id); timer.callback(); }
      await settle();
    }
    await settle();
  };
  return { w, d, requests, timers, intervals, route };
}

test('CV routes share the dashboard shell, account and theme without generating a roadmap', async t => {
  const { w, d, requests, route } = await load(t, '#cv-scanner');
  const sidebar = d.querySelector('.dashboard-sidebar');
  const avatar = d.getElementById('dashboard-avatar');
  assert.equal(d.querySelectorAll('.dashboard-sidebar').length, 1);
  assert.equal(d.getElementById('cv-scanner-view').hidden, false);
  assert.equal(d.getElementById('cv-results-view').hidden, true);
  assert.equal(d.querySelector('.dashboard-right').hidden, true);
  assert.equal(d.getElementById('cv-scanner-nav-link').getAttribute('aria-current'), 'page');
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.equal(d.title, 'CV Scanner | CareerKraft');
  assert.equal(requests.includes('roadmap'), false);
  assert.equal(d.querySelectorAll('#analysingView .level-lumia-ring').length, 3);
  assert.ok(d.querySelector('#analysingView .level-lumia-core'));
  await route('#skills');
  assert.equal(d.getElementById('cv-scanner-view').hidden, true);
  assert.equal(d.getElementById('verified-skills-card').hidden, false);
  assert.ok(requests.includes('roadmap'));
  assert.equal(d.querySelector('.dashboard-sidebar'), sidebar);
  assert.equal(d.getElementById('dashboard-avatar'), avatar);
  await route('');
  assert.equal(w.location.pathname, '/dashboard.html');
  assert.equal(d.querySelector('.career-dashboard-hero').hidden, false);
  assert.equal(d.getElementById('cv-scanner-view').hidden, true);
  assert.equal(d.getElementById('cv-results-view').hidden, true);
  assert.equal(d.querySelector('.dashboard-right').hidden, false);
});

test('loading dashboard home does not let the results script redirect without a cached scan', async t => {
  const { w, d, route } = await load(t);
  assert.equal(w.location.hash, '');
  assert.equal(d.title, 'Your career dashboard | CareerKraft');
  assert.equal(d.querySelector('.career-dashboard-hero').hidden, false);
  await route('#cv-results');
  assert.equal(w.location.hash, '#cv-scanner');
  assert.equal(d.getElementById('cv-scanner-view').hidden, false);
});

test('an embedded scan renders results and resets for another CV without leaving the dashboard', async t => {
  const { w, d, timers, route } = await load(t, '#cv-scanner');
  const calls = [];
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ success: true, scanId: 4, targetCareer: 'Teacher', analysis }) };
  };
  const input = d.getElementById('cvFileInput');
  Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['My CV project'], 'cv.txt')] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  d.getElementById('scanCvButton').click();
  assert.ok(d.getElementById('analysingView').classList.contains('active-view'));
  await settle();
  const timer = [...timers.entries()].find(([, timer]) => timer.delay === 650);
  assert.ok(timer);
  timers.delete(timer[0]);
  timer[1].callback();
  await route('#cv-results');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/cv/scan');
  assert.equal(w.location.pathname, '/dashboard.html');
  assert.equal(d.getElementById('cv-results-view').hidden, false);
  assert.equal(d.getElementById('cv-scanner-view').hidden, true);
  assert.equal(d.getElementById('overallScore').textContent, '78');
  assert.equal(d.getElementById('targetCareer').textContent, 'Teacher');
  assert.equal(d.querySelectorAll('#missingSkillsList .skill-chip').length, 1);
  d.getElementById('scanAnotherButton').click();
  await route('#cv-scanner');
  assert.equal(w.sessionStorage.getItem('careerkraft-cv-scan-result'), null);
  assert.equal(d.getElementById('selectedFileCard').classList.contains('hidden'), true);
  assert.equal(d.getElementById('scanCvButton').disabled, true);
});
