const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { renderLearningText } = require('../module-formatting');

function render(t, value) {
  const dom = new JSDOM('<div id="content"></div>');
  t.after(() => dom.window.close());
  const element = dom.window.document.getElementById('content');
  renderLearningText(element, value);
  return element;
}

test('compressed numbered instructions become semantic steps with nested file bullets', t => {
  const element = render(t, '1. **Find a partner** – Ask someone to help. 2. **Read the brief** – Review the files.\n- `brief.txt` has the requirements.\n- `data.csv` has the data.\n3. **Explain your approach** – Share your reasoning.');
  const steps = element.querySelectorAll(':scope > ol > li');
  assert.equal(steps.length, 3);
  assert.equal(steps[0].querySelector('strong').textContent, 'Find a partner');
  assert.equal(steps[1].querySelectorAll('ul > li').length, 2);
  assert.equal(steps[1].querySelector('code').textContent, 'brief.txt');
  assert.equal(steps[2].querySelector('strong').textContent, 'Explain your approach');
  assert.doesNotMatch(element.textContent, /\*\*|`/);
});

test('HTML, markdown links and hostile code remain inert text', t => {
  const element = render(t, '**Read** <img src=x onerror="alert(1)">\n[Open resource](javascript:alert(1))\n`<script>alert(1)</script>`');
  assert.equal(element.querySelectorAll('img,script,a').length, 0);
  assert.equal(element.querySelector('strong').textContent, 'Read');
  assert.equal(element.querySelector('code').textContent, '<script>alert(1)</script>');
  assert.match(element.textContent, /<img src=x/);
  assert.match(element.textContent, /javascript:alert/);
});

test('decimals, API versions, time ranges and quoted numbered questions are not list boundaries', t => {
  const value = 'Use version 3.5 of API v1.2 for 12-15 minutes. See https://example.org/v1.2. Ask "1. What happened? 2. Why?" and record the answers.';
  const element = render(t, value);
  assert.equal(element.querySelectorAll('ol,ul').length, 0);
  assert.equal(element.textContent, value);
});

test('numbers inside inline code and quoted instructions stay within the original step', t => {
  const element = render(t, '1. **Read** – Print `1. First 2. Second`, and ask “1. Why? 2. When?” 2. **Compare** – Explain the difference.');
  assert.equal(element.querySelectorAll(':scope > ol > li').length, 2);
  assert.equal(element.querySelector('code').textContent, '1. First 2. Second');
  assert.match(element.querySelector('li').textContent, /“1\. Why\? 2\. When\?”/);
});

test('fenced code preserves indentation and list-like text exactly', t => {
  const code = '  const version = 3.5;\n  // 1. First 2. Second\n  console.log("<strong>hello</strong>");';
  const element = render(t, `Read this example.\n\n\`\`\`javascript\n${code}\n\`\`\`\n\nThen explain your result.`);
  assert.equal(element.querySelector('pre code').textContent, code);
  assert.equal(element.querySelectorAll('ol').length, 0);
  assert.equal(element.querySelectorAll(':scope > p').length, 2);
  assert.equal(element.querySelectorAll('strong').length, 0);
});

test('unstructured prose keeps paragraphs and deliberate line breaks without rewriting', t => {
  const element = render(t, 'First explanation.\nA related thought.\n\nA separate explanation.');
  assert.equal(element.querySelectorAll(':scope > p').length, 2);
  assert.equal(element.querySelectorAll('br').length, 1);
  assert.equal(element.querySelector('p').textContent, 'First explanation.A related thought.');
});

test('explicit nested lists keep their hierarchy and existing numbering', t => {
  const element = render(t, '4. Inspect the files\n   - Read the log\n   - Note the time\n5. Explain the result\n\nReview your reasoning.');
  assert.equal(element.querySelector('ol').start, 4);
  assert.equal(element.querySelectorAll(':scope > ol > li').length, 2);
  assert.equal(element.querySelectorAll('ol > li > ul > li').length, 2);
  assert.equal(element.lastElementChild.tagName, 'P');
});

test('renderer replaces previous content and exports the browser API', t => {
  const fs = require('node:fs');
  const dom = new JSDOM('<div id="content">Old content</div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(require.resolve('../module-formatting'), 'utf8'));
  const element = dom.window.document.getElementById('content');
  dom.window.careerModuleFormatting.renderLearningText(element, '**New content**');
  assert.equal(element.textContent, 'New content');
  assert.equal(element.classList.contains('learning-rich-text'), true);
  assert.equal(element.querySelectorAll('strong').length, 1);
  dom.window.careerModuleFormatting.renderLearningText(element, null);
  assert.equal(element.childNodes.length, 0);
});
