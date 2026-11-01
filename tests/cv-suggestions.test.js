const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REVIEWER_INSTRUCTIONS, validateCvSuggestions, safeCvRewrite, safeCvRewriteCandidates } = require('../cv-suggestions');

const original = 'I used Python and Flask to build a dashboard.';
const structuredCv = { name: 'Alex Morgan', headline: '', contact: [], profile: '', education: [],
  experience: [], projects: [original], skills: [], certifications: [] };
const context = { structuredCv, cvText: `Alex Morgan\nProjects\n${original}`,
  verifiedSkills: [{ name: 'Research', verifiedCount: 2 }, { name: 'Communication', verifiedCount: 0 }],
  sourceEntries: [{ id: 'project-1', field: 'projects', sectionName: 'Projects', index: 0, text: original }] };
const suggestion = () => ({ sourceId: 'project-1', sectionName: 'Projects', suggestionType: 'strengthen_project',
  originalText: original, suggestedText: 'Built a dashboard using Python and Flask.',
  reason: 'Lead with the action while retaining the original technical detail.', evidence: [original] });

test('reviewer has an active improvement brief and resolves immutable sources from the original structure', () => {
  assert.match(REVIEWER_INSTRUCTIONS, /between 5 and 10/);
  assert.match(REVIEWER_INSTRUCTIONS, /good and still have useful improvements/);
  assert.match(REVIEWER_INSTRUCTIONS, /Never invent jobs/);
  assert.match(REVIEWER_INSTRUCTIONS, /WHOLE original entry/);
  assert.match(REVIEWER_INSTRUCTIONS, /structuredCv\[field\]\[index\]/);
});

test('meaningful tools/action inversion and presentation edits preserve supported entry facts', () => {
  assert.equal(safeCvRewrite(original, 'Built a dashboard using Python and Flask.'), true);
  assert.equal(safeCvRewrite('I built a dashboard using Python.', 'Built the dashboard using Python.'), true);
  assert.equal(safeCvRewrite('I have experience in Python.', 'Experience in Python.'), true);
  assert.equal(safeCvRewrite('I built a dashboard.', 'I built a dashboard.'), false);
  const result = validateCvSuggestions([suggestion()], context);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggestedText, 'Built a dashboard using Python and Flask.');
  assert.equal(result.diagnostics.rawSuggestions, 1);
  assert.equal(result.diagnostics.acceptedSuggestions, 1);
  assert.ok(!Object.hasOwn(result.suggestions[0], 'sourceId'));
});

test('common provider property aliases survive normalization', () => {
  const result = validateCvSuggestions([{ sourceEntryId: 'project-1', section: 'Project', type: 'strengthen project',
    original, replacement: 'Built a dashboard using Python and Flask.', explanation: 'Start with the action.',
    supportingEvidence: ['Python'] }], context);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].sectionName, 'Projects');
  assert.deepEqual(result.suggestions[0].evidence, ['Python']);
});

test('populated provider aliases survive empty example fields without weakening factual validation', () => {
  const aliased = { sourceId: '', entryId: 'project-1', sectionName: '', section: 'Projects',
    suggestionType: '', type: 'strengthen_project', originalText: '', original,
    suggestedText: '', improvedText: 'Built a dashboard using Python and Flask.',
    reason: '', rationale: 'Lead with the supported action.', evidence: [], supporting_evidence: ['Python'] };
  const result = validateCvSuggestions([aliased], context);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].reason, aliased.rationale);
  assert.deepEqual(result.suggestions[0].evidence, ['Python']);
  const invented = validateCvSuggestions([{ ...aliased, improvedText: 'Built a dashboard using Python, Flask and SQL.' }], context);
  assert.equal(invented.suggestions.length, 0);
  assert.equal(invented.diagnostics.rejectedByReason.unsupported_rewrite, 1);
});

test('whitespace changes in quoted original entries resolve to the exact stored source', () => {
  const result = validateCvSuggestions([{ ...suggestion(), originalText: 'I used Python and\nFlask   to build a dashboard.' }], context);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].originalText, original);
  const partial = validateCvSuggestions([{ ...suggestion(), originalText: 'Python and Flask' }], context);
  assert.equal(partial.diagnostics.rejectedByReason.unknown_source, 1);
  const ambiguous = validateCvSuggestions([suggestion()], { ...context,
    structuredCv: { ...structuredCv, projects: [original, 'I used Python and\nFlask to build a dashboard.'] } });
  assert.equal(ambiguous.diagnostics.rejectedByReason.ambiguous_source, 1);
});

test('new facts, responsibility upgrades, tools from other projects and changed attribution are rejected', () => {
  for (const text of ['Built a secure dashboard using Python and Flask.',
    'Built a dashboard using Python, Flask and SQL.',
    'Built a dashboard using Python and Flask, increasing efficiency by 20%.',
    'Led a team to build a dashboard using Python and Flask.']) {
    assert.equal(safeCvRewrite(original, text), false, text);
  }
  assert.equal(safeCvRewrite('I assisted a developer who built a Python dashboard.', 'Built a Python dashboard.'), false);
  assert.equal(safeCvRewrite('Python replaced SQL.', 'SQL replaced Python.'), false);
  assert.equal(safeCvRewrite('I built a dashboard using Python.', 'Built a dashboard using Flask.'), false);
  assert.equal(safeCvRewrite('I am developing a Python dashboard.', 'Developed a Python dashboard.'), false);
  assert.equal(safeCvRewrite('I develop Python dashboards.', 'Developed Python dashboards.'), false);
});

test('negation, aspiration, qualification and responsibility scope cannot be dropped or reassigned', () => {
  for (const [source, changed] of [
    ['I have not used Python.', 'Used Python.'],
    ['Aspiring cybersecurity student.', 'Cybersecurity professional.'],
    ['I assisted with building the dashboard.', 'Built the dashboard.'],
    ['Only tested Python; built Flask.', 'Built Python; only tested Flask.'],
    ['Basic experience using Python.', 'Experience using Python.'],
    ['I plan to build a dashboard.', 'Built a dashboard.']
  ]) assert.equal(safeCvRewrite(source, changed), false, source);
  assert.equal(safeCvRewrite('I have not used Python.', 'Not used Python.'), true);
});

test('numeric signs, operators, currencies, units and tool punctuation remain factual', () => {
  for (const [source, changed] of [
    ['I measured -5% using Python.', 'Measured 5% using Python.'],
    ['- 10% change.', '10% change.'],
    ['- 10% change.', '+ 10% change.'],
    ['I tracked £50.', 'Tracked $50.'],
    ['I used .NET and C++.', 'Used NET and C.'],
    ['I checked x != y.', 'Checked x = y.'],
    ['I measured 20 ms.', 'Measured 20 s.'],
    ['I recorded 1,000 requests.', 'Recorded 1000 requests.']
  ]) assert.equal(safeCvRewrite(source, changed), false, source);
});

test('whole immutable entry and unambiguous section binding are required', () => {
  const partial = { ...suggestion(), originalText: 'Python', suggestedText: 'Python.' };
  const wrongId = { ...suggestion(), sourceId: 'project-999' };
  const wrongSection = { ...suggestion(), sectionName: 'Experience', suggestionType: 'strengthen_experience' };
  const result = validateCvSuggestions([partial, wrongId, wrongSection], context);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.diagnostics.rejectedByReason.unknown_source, 2);
  assert.equal(result.diagnostics.rejectedByReason.source_mismatch, 1);
  const duplicate = { ...context, structuredCv: { ...structuredCv, projects: [original, original] } };
  assert.equal(validateCvSuggestions([suggestion()], duplicate).diagnostics.rejectedByReason.ambiguous_source, 1);
});

test('only genuine positive canonical verified skills can be added as standalone skills', () => {
  const skill = { sectionName: 'Skills', suggestionType: 'add_verified_skill', originalText: '',
    suggestedText: 'research', reason: 'Show a verified skill.', evidence: ['Research'] };
  const result = validateCvSuggestions([skill], context);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggestedText, 'Research');
  const invalid = [
    { ...skill, suggestedText: 'Communication', evidence: ['Communication'] },
    { ...skill, suggestedText: 'Python', evidence: ['Python'] },
    { ...skill, suggestedText: 'Research in the dashboard project' },
    { ...skill, sectionName: 'Projects' },
    { ...skill, sourceId: 'project-1' }
  ];
  assert.equal(validateCvSuggestions(invalid, context).suggestions.length, 0);
});

test('unsupported evidence, duplicates and malformed outputs are diagnosed without retaining CV text', () => {
  const result = validateCvSuggestions([null, suggestion(), suggestion(),
    { ...suggestion(), evidence: ['A certification not in the CV'] }], context);
  assert.equal(result.suggestions.length, 1);
  assert.deepEqual(result.diagnostics.rejectedByReason, { invalid_schema: 1, duplicate: 1, invalid_evidence: 1 });
  assert.equal(result.diagnostics.rejectedSuggestions, 3);
  assert.ok(!JSON.stringify(result.diagnostics).includes('Python'));
});

test('all original lines and qualifiers in multi-line entries survive rewriting', () => {
  const source = 'Dashboard\nI built a dashboard using Python.\nNot deployed to production.';
  assert.equal(safeCvRewrite(source, 'Dashboard\nBuilt a dashboard using Python.\nNot deployed to production.'), true);
  assert.equal(safeCvRewrite(source, 'Dashboard\nBuilt a dashboard using Python.'), false);
  assert.equal(safeCvRewrite(source, 'Dashboard\nBuilt a dashboard using Python.\nDeployed to production.'), false);
});

test('multi-sentence profile can remove repeated first-person introductions while retaining qualifications', () => {
  const source = 'I am a software development student interested in cybersecurity. I have built web applications using Python and Flask.';
  const changed = 'A software development student interested in cybersecurity. Built web applications using Python and Flask.';
  const withoutArticle = 'Software development student interested in cybersecurity. Built web applications using Python and Flask.';
  assert.equal(safeCvRewrite(source, changed), true);
  assert.equal(safeCvRewrite(source, withoutArticle), true, 'a leading grammatical article may follow the removed first-person prefix');
  assert.equal(safeCvRewrite(source, 'Software development professional interested in cybersecurity. Built web applications using Python and Flask.'), false);
  assert.equal(safeCvRewrite(source, 'Built web applications using Python and Flask.'), false);
  const candidate = safeCvRewriteCandidates(source)[0];
  assert.equal(candidate, withoutArticle);
  assert.equal(safeCvRewrite(source, candidate), true);
});

test('helped-to-assisted grammar keeps the exact limited responsibility and supported objects', () => {
  const source = 'I helped a tutor prepare coding exercises for students.';
  const changed = 'Assisted a tutor in preparing coding exercises for students.';
  assert.equal(safeCvRewrite(source, changed), true);
  assert.equal(safeCvRewrite(source, 'Prepared coding exercises for students.'), false);
  assert.equal(safeCvRewrite(source, 'Assisted a tutor in preparing advanced coding exercises for students.'), false);
  assert.equal(safeCvRewrite(source, 'Led a tutor in preparing coding exercises for students.'), false);
  assert.equal(safeCvRewriteCandidates(source)[0], changed);
});

test('explicit course completion can use a completed action without inventing certification or dates', () => {
  const source = 'Introduction to Cybersecurity course completion, 2025';
  const changed = 'Completed Introduction to Cybersecurity course (2025).';
  assert.equal(safeCvRewrite(source, changed), true);
  assert.equal(safeCvRewrite(source, 'Certified in Introduction to Cybersecurity (2025).'), false);
  assert.equal(safeCvRewrite(source, 'Completed Introduction to Cybersecurity course (2026).'), false);
  assert.equal(safeCvRewrite('Introduction to Cybersecurity course completion, 2025 (planned)', changed), false);
  assert.equal(safeCvRewrite('No Introduction to Cybersecurity course completion, 2025', changed), false);
  assert.deepEqual(safeCvRewriteCandidates(source), [changed]);
});

test('wording candidates preserve complete multi-line entries and independently pass the guard', () => {
  const source = 'Dashboard project\nI used Python and Flask to build a dashboard.\nNot deployed to production.';
  const candidates = safeCvRewriteCandidates(source);
  assert.equal(candidates[0], 'Dashboard project\nBuilt a dashboard using Python and Flask.\nNot deployed to production.');
  assert.ok(candidates.length <= 3);
  assert.ok(candidates.every(candidate => safeCvRewrite(source, candidate)));
  assert.deepEqual(safeCvRewriteCandidates('Python, Flask'), []);
  assert.deepEqual(safeCvRewriteCandidates('- 10% change.'), []);
  assert.deepEqual(safeCvRewriteCandidates(null), []);
});

test('presentation edits retain past state and cannot turn a feature into a tool', () => {
  assert.equal(safeCvRewrite('I was a member of the coding club.', 'Member of the coding club.'), false);
  assert.equal(safeCvRewrite('I was a member of the coding club.', 'Was a member of the coding club.'), true);
  assert.equal(safeCvRewrite('I have been building a dashboard.', 'Built a dashboard.'), false);
  assert.equal(safeCvRewrite('I have been building a dashboard.', 'Have been building a dashboard.'), true);
  assert.equal(safeCvRewrite('I built a dashboard with a menu.', 'Built a dashboard using a menu.'), false);
});
