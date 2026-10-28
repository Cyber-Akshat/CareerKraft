const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'cv-results.html'), 'utf8');
const storageKey = 'careerkraft-cv-scan-result';
const result = () => ({
  success: true, scanId: 4, fileName: 'student-cv.txt', targetCareer: 'Cyber Security Analyst',
  analysis: {
    overallScore: 78, scores: { structure: 85, clarity: 80, evidence: 65, relevance: 82 },
    strengths: ['Clear education section', 'Relevant project'],
    priorityImprovements: ['Explain the project goal', 'Link verified evidence'],
    verifiedSkillsMissingFromCv: ['Research', 'Network Analysis'],
    bulletRewrites: [
      { original: 'I researched network traffic.', improved: 'Researched network traffic.', reason: 'Start with the action.' },
      { original: 'built a dashboard', improved: 'Built a dashboard.', reason: '' }
    ],
    careerAlignmentSummary: 'Your research project provides a starting point for this career.'
  }
});

function load(t, saved = result(), { storageError = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/cv-results.html', runScripts: 'outside-only', virtualConsole
  });
  const { window } = dom;
  const storage = window.sessionStorage;
  if (saved !== null) storage.setItem(storageKey, typeof saved === 'string' ? saved : JSON.stringify(saved));
  if (storageError) Object.defineProperty(window, 'sessionStorage', {
    configurable: true, get() { throw new window.DOMException('Storage unavailable', 'SecurityError'); }
  });
  let now = 0;
  let nextFrame = 0;
  const frames = new Map();
  const alerts = [];
  Object.defineProperty(window.performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.alert = message => alerts.push(message);
  assert.doesNotThrow(() => window.eval(readFileSync(path.join(root, 'cv-results.js'), 'utf8')));
  t.after(() => window.close());
  function flush() {
    for (let iteration = 0; iteration < 5 && frames.size; iteration++) {
      now += 1000;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(now));
    }
    assert.equal(frames.size, 0, 'Number and graphic animations complete');
  }
  return {
    window, document: window.document, storage, frames, alerts, flush,
    element: id => window.document.getElementById(id),
    navigations: () => errors.filter(error => /navigation/i.test(error.message)),
    restore() { window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true })); }
  };
}

test('CV results render the saved API response, category scores, graphics and rewrite details', t => {
  const value = result();
  const h = load(t, value);
  h.flush();
  assert.equal(h.element('overallScore').textContent, '78');
  assert.equal(h.element('scoreTitle').textContent, 'Your CV is heading in the right direction');
  assert.equal(h.element('targetCareer').textContent, value.targetCareer);
  assert.equal(h.element('careerAlignmentSummary').textContent, value.analysis.careerAlignmentSummary);
  for (const [category, score] of Object.entries(value.analysis.scores)) {
    assert.equal(h.element(`${category}Score`).textContent, String(score));
    assert.equal(h.element(`${category}Bar`).style.width, `${score}%`);
  }
  assert.ok(Math.abs(Number(h.element('scoreRingProgress').style.strokeDashoffset) - 326.73 * 0.22) < 0.001);
  assert.equal(h.element('strengthsList').children.length, 2);
  assert.equal(h.element('improvementsList').children.length, 2);
  assert.deepEqual([...h.element('missingSkillsList').children].map(item => item.textContent), ['Research', 'Network Analysis']);
  assert.ok(h.element('missingSkillsEmpty').classList.contains('hidden'));
  const rewrites = h.element('bulletRewritesList').children;
  assert.equal(rewrites.length, 2);
  assert.equal(rewrites[0].querySelector('.rewrite-label').textContent, 'Before');
  assert.equal(rewrites[0].querySelector('.rewrite-label.improved').textContent, 'Lumia suggestion');
  assert.deepEqual([...rewrites[0].querySelectorAll('.rewrite-text')].map(item => item.textContent),
    ['I researched network traffic.', 'Researched network traffic.']);
  assert.equal(rewrites[0].querySelector('.rewrite-reason').textContent, 'Why this is stronger: Start with the action.');
  assert.equal(rewrites[1].querySelector('.rewrite-reason'), null);
  assert.equal(h.navigations().length, 0);
});

test('CV results clamp numeric scores and select the appropriate score title', t => {
  for (const [score, title] of [
    [130, 'Your CV is in excellent shape'], [90, 'Your CV is in excellent shape'],
    [80, 'Your CV has a strong foundation'], [70, 'Your CV is heading in the right direction'],
    [60, 'Your CV has good potential'], [45, 'Your CV needs some focused improvements'],
    [44, 'Your CV has plenty of room to grow'], [-8, 'Your CV has plenty of room to grow']
  ]) {
    const value = result();
    value.analysis.overallScore = score;
    value.analysis.scores = { structure: 300, clarity: -10, evidence: '65.6', relevance: 'invalid' };
    const h = load(t, value);
    h.flush();
    assert.equal(h.element('scoreTitle').textContent, title);
    assert.equal(h.element('overallScore').textContent, String(Math.max(0, Math.min(100, score))));
    assert.deepEqual(['structure', 'clarity', 'evidence', 'relevance'].map(name => h.element(`${name}Score`).textContent),
      ['100', '0', '66', '0']);
  }
});

test('non-numeric cached score objects, arrays and booleans cannot throw or coerce into a score', t => {
  for (const score of [{ toString: null }, { valueOf: null }, { toString: null, valueOf: null }, [90], [], true, false]) {
    const value = result();
    value.analysis.overallScore = score;
    value.analysis.scores = { structure: score, clarity: 85, evidence: score, relevance: '82' };
    const h = load(t, value);
    h.flush();
    assert.equal(h.element('overallScore').textContent, '0');
    assert.deepEqual(['structure', 'clarity', 'evidence', 'relevance'].map(name => h.element(`${name}Score`).textContent),
      ['0', '85', '0', '82']);
    assert.equal(h.element('structureBar').style.width, '0%');
    assert.equal(h.element('evidenceBar').style.width, '0%');
    assert.equal(Number(h.element('scoreRingProgress').style.strokeDashoffset), 326.73);
    assert.equal(h.navigations().length, 0);
  }
});

test('CV feedback and profile content are inserted as text rather than executable HTML', t => {
  const hostile = '<img src=x onerror="window.cvInjected=true"><script>window.cvInjected=true</script>';
  const value = result();
  value.targetCareer = hostile;
  value.analysis.careerAlignmentSummary = hostile;
  value.analysis.strengths = [hostile];
  value.analysis.priorityImprovements = [hostile];
  value.analysis.verifiedSkillsMissingFromCv = [hostile];
  value.analysis.bulletRewrites = [{ original: hostile, improved: hostile, reason: hostile }];
  const h = load(t, value);
  h.flush();
  for (const id of ['targetCareer', 'careerAlignmentSummary', 'strengthsList', 'improvementsList', 'missingSkillsList', 'bulletRewritesList']) {
    assert.ok(h.element(id).textContent.includes(hostile), id);
    assert.equal(h.element(id).querySelector('img,script'), null, id);
  }
  assert.equal(h.window.cvInjected, undefined);
});

test('CV lists filter invalid items before numbering, respect limits and show empty states after filtering', t => {
  const value = result();
  value.analysis.strengths = [null, ' First ', 42, '', 'Second', 'Third', 'Fourth'];
  value.analysis.priorityImprovements = [' ', false, 'One', 'Two', 'Three', 'Four'];
  value.analysis.verifiedSkillsMissingFromCv = [null, ' ', 42];
  value.analysis.bulletRewrites = [null, 42, [], {}, { original: '', improved: 'Incomplete' }];
  const h = load(t, value);
  h.flush();
  for (const id of ['strengthsList', 'improvementsList']) {
    assert.equal(h.element(id).children.length, 3);
    assert.deepEqual([...h.element(id).querySelectorAll('.result-list-number')].map(item => item.textContent), ['1', '2', '3']);
  }
  assert.ok(h.element('strengthsList').children[0].textContent.endsWith('First'));
  for (const [list, empty] of [['missingSkillsList', 'missingSkillsEmpty'], ['bulletRewritesList', 'bulletRewritesEmpty']]) {
    assert.equal(h.element(list).children.length, 0);
    assert.ok(h.element(list).classList.contains('hidden'));
    assert.equal(h.element(empty).classList.contains('hidden'), false);
  }
});

test('missing, invalid and inaccessible CV cache redirects without fabricating a result', t => {
  for (const saved of [null, '{not JSON}', 'null', '[]', {}, { analysis: null }, { analysis: [] }, { analysis: 'invalid' }]) {
    const h = load(t, saved);
    assert.equal(h.navigations().length, 1);
    assert.equal(h.frames.size, 0);
    assert.equal(h.element('strengthsList').children.length, 0);
  }
  const blocked = load(t, result(), { storageError: true });
  assert.equal(blocked.navigations().length, 1);
  assert.equal(blocked.frames.size, 0);
});

test('CV results use readable fallbacks and keep the builder action as an explicit placeholder', t => {
  const value = result();
  value.targetCareer = null;
  value.analysis.careerAlignmentSummary = '';
  const h = load(t, value);
  h.flush();
  assert.equal(h.element('targetCareer').textContent, 'No target career selected');
  assert.equal(h.element('careerAlignmentSummary').textContent,
    'Lumia has reviewed the structure, clarity, evidence and career relevance of your CV.');
  h.element('improveCvButton').click();
  assert.deepEqual(h.alerts, ['CareerKraft CV Builder is coming next.']);
  assert.equal(h.navigations().length, 0);
  assert.ok(h.storage.getItem(storageKey));
  h.element('scanAnotherButton').click();
  assert.equal(h.storage.getItem(storageKey), null);
  assert.equal(h.navigations().length, 1);
});

test('restoring CV results from browser history refreshes the cache without duplicate cards', t => {
  const h = load(t);
  h.flush();
  const updated = result();
  updated.scanId = 5;
  updated.targetCareer = 'Software Developer';
  updated.analysis.overallScore = 94;
  updated.analysis.strengths = ['Updated feedback'];
  updated.analysis.verifiedSkillsMissingFromCv = [];
  updated.analysis.bulletRewrites = [];
  h.storage.setItem(storageKey, JSON.stringify(updated));
  h.restore();
  h.flush();
  assert.equal(h.element('overallScore').textContent, '94');
  assert.equal(h.element('targetCareer').textContent, 'Software Developer');
  assert.equal(h.element('strengthsList').children.length, 1);
  assert.ok(h.element('strengthsList').textContent.includes('Updated feedback'));
  assert.equal(h.element('bulletRewritesList').children.length, 0);
  assert.equal(h.element('missingSkillsEmpty').classList.contains('hidden'), false);
  h.storage.removeItem(storageKey);
  h.restore();
  assert.equal(h.navigations().length, 1);
});
