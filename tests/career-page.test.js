const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'career.html'), 'utf8');
const careerDataScript = fs.readFileSync(path.join(root, 'career-data.js'), 'utf8');
const script = fs.readFileSync(path.join(root, 'career.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function load(auth, url = 'http://localhost:3000/career.html?career=software-developer') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.careerAuth = auth;
  dom.window.matchMedia = () => ({ matches: false });
  if (dom.window.HTMLDialogElement) {
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    dom.window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new dom.window.Event('close'));
    };
  }
  dom.window.eval(careerDataScript);
  dom.window.eval(script);
  return dom;
}

test('career page loads the selected saved match and saves a choice', async t => {
  const requests = [];
  const dom = load({
    getSession: async () => ({ data: { session: { user: { email: 'tester@example.com' } } }, error: null }),
    request: async (endpoint, body) => {
      requests.push({ endpoint, body });
      if (endpoint === 'assessment') return {
        data: {
          assessment: { interests: ['technology'], subjects: ['computing'], strengths: ['analysis'], work_style: ['building'] },
          matches: [{ id: 'software-developer', title: 'Software Developer', category: 'Technology', description: 'Build websites, apps and digital products by solving problems with code.', score: 88, reasons: ['Technology', 'Problem solving'] }],
          selectedCareer: null
        },
        error: null
      };
      return { data: {}, error: null };
    }
  });
  t.after(() => dom.window.close());
  await settle();
  assert.equal(dom.window.document.title, 'Software Developer | CareerKraft');
  assert.equal(dom.window.document.querySelector('#career-intro').textContent, 'Build websites, apps and digital products by solving problems with code.');
  assert.equal(dom.window.document.querySelector('#career-match-score').textContent, '88%');
  assert.match(dom.window.document.querySelector('#career-match-reason').textContent, /technology, problem solving/);
  assert.equal(dom.window.document.querySelectorAll('#career-process .process-step').length, 4);
  assert.equal(dom.window.document.querySelector('#career-salary').textContent, '£30,000–£75,000 (UK guidance)');
  assert.equal(dom.window.document.querySelector('#career-hours').textContent, '37–40 hours/week');
  assert.equal(dom.window.document.querySelector('#career-work-environment').textContent, 'Office · Home · Remote · Client site');
  assert.equal(dom.window.document.querySelector('#career-progression-summary').textContent, 'Junior Developer → Software Developer → Senior Developer');
  assert.equal(dom.window.document.querySelectorAll('#day-timeline .timeline-item').length, 7);
  assert.equal(dom.window.document.querySelectorAll('#career-routes .route-card').length, 4);
  assert.equal(dom.window.document.querySelectorAll('#career-progression .progression-step').length, 5);
  assert.equal(dom.window.document.querySelectorAll('#career-skills li').length, 7);
  assert.equal(dom.window.document.querySelector('#career-apprenticeships').hidden, false);
  assert.equal(dom.window.document.querySelector('.apprenticeship-spotlight h3').textContent, 'Software Developer Level 4');
  assert.equal(dom.window.document.querySelector('.apprenticeship-spotlight a').href, 'https://skillsengland.education.gov.uk/apprenticeship-standards/st0116-v1-1');
  assert.match(dom.window.document.querySelector('#career-challenge-task').textContent, /tiny webpage/);
  assert.equal(dom.window.document.querySelectorAll('#career-sources [data-source]').length, 3);
  assert.equal(dom.window.document.querySelector('#career-sources [data-source="apprenticeship-search"]').dataset.url, 'https://www.gov.uk/apply-apprenticeship');
  assert.equal(dom.window.document.body.classList.contains('career-loading'), false);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
  dom.window.document.querySelector('#career-theme-toggle').click();
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(dom.window.document.querySelectorAll('#career-theme-toggle svg').length, 2);
  dom.window.document.querySelector('#choose-career-button').click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), {
    endpoint: 'profile/career',
    body: { career_id: 'software-developer' }
  });
  assert.equal(dom.window.document.querySelector('#choose-career-button').textContent, 'Career saved ✓');
  assert.match(dom.window.document.querySelector('.career-status').textContent, /saved as your selected career/);
  assert.match(script, /window\.location\.assign\("dashboard\.html"\)/);
  dom.window.document.querySelector('#start-challenge-button').click();
  const dialog = dom.window.document.querySelector('.challenge-dialog');
  assert.match(dialog.textContent, /tiny webpage/);
  dialog.querySelector('button').click();
  assert.equal(dom.window.document.querySelector('.challenge-dialog'), null);
});

test('every quiz career has a distinct complete exploration profile', async t => {
  const dom = load({
    getSession: async () => ({ data: { session: { user: { email: 'tester@example.com' } } }, error: null }),
    request: async () => ({
      data: {
        assessment: {},
        matches: [{
          id: 'psychologist',
          title: 'Psychologist',
          category: 'Psychology',
          description: 'Understand human behaviour and help people improve their wellbeing and lives.',
          score: 88,
          reasons: ['Helping people', 'Research']
        }],
        selectedCareer: null
      },
      error: null
    })
  }, 'http://localhost:3000/career.html?career=psychologist');
  t.after(() => dom.window.close());
  await settle();
  const profiles = dom.window.careerData;
  const expectedIds = [
    'software-developer', 'cyber-security-analyst', 'data-analyst', 'ai-engineer',
    'ux-ui-designer', 'digital-marketing', 'product-manager', 'financial-analyst',
    'accountant', 'mechanical-engineer', 'civil-engineer', 'biomedical-scientist',
    'psychologist', 'teacher', 'solicitor', 'content-producer', 'entrepreneur'
  ];
  assert.deepEqual(Object.keys(profiles).sort(), expectedIds.sort());
  for (const [id, profile] of Object.entries(profiles)) {
    assert.ok(profile.scenario, `${id} scenario`);
    assert.ok(profile.whatTheyDo?.length >= 4, `${id} job steps`);
    assert.ok(profile.timeline?.length >= 4, `${id} timeline`);
    assert.ok(profile.facts?.salary && profile.facts.hours && profile.facts.environment, `${id} facts`);
    assert.ok(profile.skills?.length >= 4, `${id} skills`);
    assert.ok(profile.enjoy?.length >= 3 && profile.caution?.length >= 3, `${id} fit guidance`);
    assert.ok(profile.routes?.length >= 3, `${id} routes`);
    assert.ok(Array.isArray(profile.apprenticeships), `${id} apprenticeships`);
    assert.ok(profile.progression?.length >= 3, `${id} progression`);
    assert.ok(profile.challenge?.task && profile.challenge.description, `${id} challenge`);
    assert.ok(profile.sources?.length >= 2, `${id} sources`);
    assert.equal(profile.title, undefined, `${id} must use match title`);
    assert.equal(profile.category, undefined, `${id} must use match category`);
    assert.equal(profile.intro, undefined, `${id} must not duplicate catalogue description`);
  }
  assert.equal(dom.window.document.title, 'Psychologist | CareerKraft');
  assert.equal(dom.window.document.querySelector('#career-intro').textContent, 'Understand human behaviour and help people improve their wellbeing and lives.');
  assert.equal(dom.window.document.querySelector('#career-scenario').textContent.includes('student feels overwhelmed by exams'), true);
  assert.equal(dom.window.document.querySelectorAll('#career-process .process-step').length, 4);
  assert.equal(dom.window.document.querySelectorAll('#day-timeline .timeline-item').length, 5);
  assert.match(dom.window.document.querySelector('#career-challenge-task').textContent, /open, non-judgemental questions/);
  assert.equal(dom.window.document.querySelector('#career-apprenticeships').hidden, false);
});

test('career page reports when a match is missing', async t => {
  const dom = load({
    getSession: async () => ({ data: { session: { user: { email: 'tester@example.com' } } }, error: null }),
    request: async () => ({ data: { assessment: null, matches: [], selectedCareer: null }, error: null })
  }, 'http://localhost:3000/career.html?career=unknown-career');
  t.after(() => dom.window.close());
  await settle();
  assert.match(dom.window.document.querySelector('.career-status').textContent, /Complete the career quiz first/);
});

test('career profiles without skill or apprenticeship data keep those empty sections hidden', async t => {
  const dom = load({
    getSession: async () => ({ data: { session: { user: { name: 'Alex' } } } }),
    request: async () => ({ data: { matches: [{ id: 'new-career', title: 'New career', category: 'Design', reasons: [] }] } })
  }, 'http://localhost:3000/career.html?career=new-career');
  t.after(() => dom.window.close());
  await settle();
  assert.equal(dom.window.document.querySelector('#career-title').textContent, 'New career');
  assert.equal(dom.window.document.querySelector('.career-skills-panel').hidden, true);
  assert.equal(dom.window.document.querySelector('#career-apprenticeships').hidden, true);
  assert.equal(dom.window.document.querySelector('#start-challenge-button').closest('section').hidden, false);
});

test('a thrown session check displays a retry that loads the saved career', async t => {
  let attempts = 0;
  const dom = load({
    getSession: async () => {
      if (++attempts === 1) throw new Error('Disconnected');
      return { data: { session: { user: { name: 'Alex' } } } };
    },
    request: async () => ({ data: { matches: [{ id: 'software-developer', title: 'Software Developer', category: 'Technology', score: 88, reasons: [] }] } })
  });
  t.after(() => dom.window.close());
  await settle();
  assert.match(dom.window.document.querySelector('.career-status').textContent, /connection/);
  assert.equal(dom.window.document.querySelector('#choose-career-button').disabled, true);
  dom.window.document.querySelector('#career-retry').click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(dom.window.document.querySelector('#career-title').textContent, 'Software Developer');
  assert.equal(dom.window.document.querySelector('#choose-career-button').disabled, false);
});

test('career page shows My dashboard for users with a saved career', async t => {
  const dom = load({
    getSession: async () => ({ data: { session: { user: { name: 'Alex' } } } }),
    request: async () => ({ data: {
      matches: [{ id: 'software-developer', title: 'Software Developer', category: 'Technology', score: 88, reasons: [] }],
      selectedCareer: { id: 'software-developer', title: 'Software Developer' }
    } })
  });
  t.after(() => dom.window.close());
  await settle();
  const button = dom.window.document.querySelector('#back-to-matches');
  assert.equal(button.textContent, '\u2190 My dashboard');
  assert.equal(button.dataset.destination, 'dashboard.html');
});
