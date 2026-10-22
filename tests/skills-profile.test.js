const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(require.resolve('../dashboard.html'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const levelIds = ['beginner', 'intermediate', 'advanced'];
const makeLevels = skills => levelIds.map(id => ({ id, skills: skills[id] || [] }));
const makeSkill = (id, verifiedCount, name = `Skill ${id}`) => ({ id, name, verifiedCount });

function journey(currentLevel) {
  const currentIndex = levelIds.indexOf(currentLevel);
  return {
    currentLevel,
    pathwayCompleted: false,
    levels: levelIds.map((id, index) => ({
      id,
      status: index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'locked'
    }))
  };
}

function load(t) {
  const dom = new JSDOM(html, { url: 'http://localhost/dashboard.html#skills', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  t.after(() => window.close());
  window.console.error = () => {};
  window.HTMLMediaElement.prototype.play = () => undefined;
  window.HTMLMediaElement.prototype.pause = () => {};
  window.requestAnimationFrame = callback => { callback(0); return 1; };
  window.cancelAnimationFrame = () => {};
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('[autofocus]')?.focus();
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.careerAuth = {
    getSession: () => new Promise(() => {}),
    request: async endpoint => {
      calls.push(endpoint);
      return {
        data: {
          skill: {
            id: Number(endpoint.split('/').at(-1)),
            name: 'Expanded skill',
            verifiedCount: 1,
            evidenceDepth: { highestLevel: 'beginner', counts: { beginner: 1 } },
            verifications: []
          }
        }
      };
    }
  };
  window.eval(fs.readFileSync(require.resolve('../dashboard.js'), 'utf8'));
  const document = window.document;
  return {
    w: window, d: document, calls,
    list: document.getElementById('skills-list'),
    card: id => document.querySelector(`.level-skill-chart[data-level="${id}"]`),
    render: (levels, currentJourney) => window.renderLevelSkillCharts(levels, currentJourney)
  };
}

test('the radar and visible list show only the six strongest skills while summaries include every skill', t => {
  const ui = load(t);
  const skills = [makeSkill(9, 1), makeSkill(2, 8), makeSkill(8, 2), makeSkill(1, 9), makeSkill(7, 3), makeSkill(3, 7), makeSkill(6, 4), makeSkill(5, 5), makeSkill(4, 6)];
  ui.render(makeLevels({ beginner: skills }), journey('beginner'));
  const card = ui.card('beginner');
  const visibleList = card.querySelector('ul.skill-radar-counts');
  const buttons = [...visibleList.querySelectorAll('.skill-detail-trigger')];
  assert.deepEqual(buttons.map(button => button.dataset.skillId), ['1', '2', '3', '4', '5', '6']);
  assert.equal(card.querySelectorAll('.skill-radar-label').length, 6);
  assert.deepEqual([...card.querySelectorAll('.skill-radar-label')].map(label => label.dataset.skillId), ['1', '2', '3', '4', '5', '6']);
  assert.match(card.querySelector('.level-skill-top-heading').textContent, /Top verified skills/i);
  assert.deepEqual(card.querySelector('.level-skill-summary').textContent.match(/\d+/g).map(Number), [9, 45, 6]);
  for (const button of buttons) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.match(button.querySelector('.skill-trigger-name').textContent, /^Skill \d+$/);
    assert.ok(Number(button.querySelector('.skill-trigger-count').textContent) > 0);
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
  }
  assert.equal(card.querySelector('.skill-radar-more').hidden, true);
  assert.equal(card.querySelector('.skill-radar-more').querySelectorAll('.skill-detail-trigger').length, 3);
  assert.match(card.querySelector('.skill-radar-toggle').textContent, /\+\s*3 more skills/i);
});

test('expanding and collapsing additional skills preserves the radar, accessible state and toggle focus', t => {
  const ui = load(t);
  ui.render(makeLevels({ beginner: Array.from({ length: 8 }, (_, index) => makeSkill(index + 1, 8 - index)) }), journey('beginner'));
  const card = ui.card('beginner');
  const toggle = card.querySelector('.skill-radar-toggle');
  const extra = card.querySelector('.skill-radar-more');
  const chart = card.querySelector('svg');
  const chartBefore = chart.outerHTML;
  assert.ok(extra.id);
  assert.equal(toggle.getAttribute('aria-controls'), extra.id);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.focus();
  toggle.click();
  assert.equal(extra.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(toggle.textContent, /Show fewer skills/i);
  assert.equal(ui.d.activeElement, toggle);
  assert.equal(chart.outerHTML, chartBefore);
  assert.equal(card.querySelector('ul.skill-radar-counts').children.length, 6);
  toggle.click();
  assert.equal(extra.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.match(toggle.textContent, /\+\s*2 more skills/i);
  assert.equal(ui.d.activeElement, toggle);
  assert.equal(chart.outerHTML, chartBefore);
  assert.deepEqual(ui.calls, [], 'expanding a local list does not make an AI or detail request');
});

test('an expanded skill opens its real detail route and receives focus back after the drawer closes', async t => {
  const ui = load(t);
  ui.render(makeLevels({ beginner: Array.from({ length: 7 }, (_, index) => makeSkill(index + 1, 7 - index)) }), journey('beginner'));
  const card = ui.card('beginner');
  card.querySelector('.skill-radar-toggle').click();
  const button = card.querySelector('.skill-radar-more .skill-detail-trigger');
  button.focus();
  button.click();
  await settle();
  assert.deepEqual(ui.calls, ['skills/7']);
  assert.equal(ui.d.getElementById('skill-detail-drawer').open, true);
  assert.equal(ui.d.getElementById('skill-detail-name').textContent, 'Expanded skill');
  ui.w.closeSkillDrawer();
  assert.equal(ui.d.activeElement, button);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(card.querySelector('.skill-radar-more').hidden, false);
});

test('empty later cards distinguish a real roadmap lock from a level ready for its first evidence', t => {
  const ui = load(t);
  ui.render(makeLevels({}), journey('beginner'));
  assert.equal(ui.card('beginner').classList.contains('is-locked'), false);
  assert.equal(ui.card('beginner').classList.contains('is-empty'), true);
  for (const level of ['intermediate', 'advanced']) {
    const card = ui.card(level);
    assert.equal(card.classList.contains('is-locked'), true);
    assert.ok(card.querySelector('.level-skill-lock-icon svg'));
    assert.ok(card.querySelector('.level-skill-placeholder h4'));
    assert.match(card.querySelector('.level-skill-state').textContent, /Locked/i);
    assert.equal(card.querySelector('.level-skill-summary'), null, 'locked levels show their unlock requirement instead of zero-value stats');
  }
  assert.match(ui.card('intermediate').textContent, /Complete Beginner/i);
  assert.match(ui.card('advanced').textContent, /Complete Intermediate/i);

  ui.render(makeLevels({}), journey('intermediate'));
  assert.equal(ui.card('intermediate').classList.contains('is-locked'), false);
  assert.equal(ui.card('intermediate').classList.contains('is-empty'), true);
  assert.match(ui.card('intermediate').querySelector('.level-skill-placeholder').textContent, /first.*evidence|ready/i);
  assert.equal(ui.card('advanced').classList.contains('is-locked'), true);

  ui.render(makeLevels({}), { ...journey('advanced'), pathwayCompleted: true, levels: levelIds.map(id => ({ id, status: 'completed' })) });
  assert.equal(ui.list.querySelectorAll('.is-locked').length, 0);
  assert.equal(ui.list.querySelectorAll('.level-skill-chart.is-empty').length, 3);
});

test('missing journey data never invents locks and verified history remains visible across roadmap changes', t => {
  const ui = load(t);
  ui.render(makeLevels({}), null);
  assert.equal(ui.list.querySelectorAll('.is-locked').length, 0);
  assert.equal(ui.list.querySelectorAll('.level-skill-chart.is-empty').length, 3);

  ui.render(makeLevels({ intermediate: [makeSkill(31, 2, 'Investigation')] }), journey('beginner'));
  const card = ui.card('intermediate');
  assert.equal(card.classList.contains('is-locked'), false);
  assert.equal(card.classList.contains('is-empty'), false);
  assert.ok(card.querySelector('svg[role="img"]'));
  assert.equal(card.querySelector('.skill-detail-trigger').dataset.skillId, '31');
});

test('skill names stay inert text and rerendering removes old extras, toggles and counts', t => {
  const ui = load(t);
  const unsafeName = '<img src=x onerror="alert(1)"> ' + 'VeryLongSkillName'.repeat(25);
  ui.render(makeLevels({ beginner: [makeSkill(1, 20, unsafeName), ...Array.from({ length: 7 }, (_, index) => makeSkill(index + 2, 7 - index))] }), journey('beginner'));
  const oldCard = ui.card('beginner');
  assert.equal(oldCard.querySelector('.skill-trigger-name').textContent, unsafeName);
  assert.equal(oldCard.querySelector('img, script, [onerror], [onload]'), null);
  oldCard.querySelector('.skill-radar-toggle').click();
  assert.equal(oldCard.querySelector('.skill-radar-more').hidden, false);

  ui.render(makeLevels({ beginner: [makeSkill(40, 2, 'Planning'), makeSkill(41, 1, 'Research')] }), journey('beginner'));
  const card = ui.card('beginner');
  assert.equal(oldCard.isConnected, false);
  assert.equal(ui.list.querySelectorAll('.level-skill-chart').length, 3);
  assert.equal(card.querySelectorAll('.skill-detail-trigger').length, 2);
  assert.equal(card.querySelectorAll('.skill-radar-label').length, 2);
  assert.equal(card.querySelector('.skill-radar-toggle'), null);
  assert.equal(card.querySelector('.skill-radar-more'), null);
  assert.deepEqual(card.querySelector('.level-skill-summary').textContent.match(/\d+/g).map(Number), [2, 3, 2]);
  assert.equal(ui.list.querySelector('[data-skill-id="1"]'), null);
});
