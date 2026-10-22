// Curated free articles and documentation supplement unusable AI links.
// Match the module's actual topic; unrelated modules receive no generic links.
const resources = [];

function addResource(title, provider, url, resourceType, description, studyFocus, keywords) {
  resources.push({ title, provider, url, resourceType, description, studyFocus, keywords });
}

addResource(
  'User research: understanding your users', 'GOV.UK Service Manual',
  'https://www.gov.uk/service-manual/user-research/how-user-research-improves-service-design', 'guide',
  'An introduction to learning about users and designing services around their needs.',
  'Study how user needs, inclusive research and evidence guide design decisions.',
  ['ux', 'ui', 'user experience', 'user interface', 'user research', 'ux research', 'user needs', 'usability']
);
addResource(
  'Designing good services', 'GOV.UK Service Manual',
  'https://www.gov.uk/service-manual/design/introduction-designing-government-services', 'guide',
  'Learn the characteristics of services that are easy for people to understand and use.',
  'Compare your design with the guidance on user needs, familiar conventions and clear tasks.',
  ['ux', 'ui', 'user experience', 'user interface', 'service design', 'interface design', 'interaction design', 'usability']
);
addResource(
  'Planning user research', 'GOV.UK Service Manual',
  'https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service', 'guide',
  'A practical guide to selecting research questions, participants and methods.',
  'Focus on turning assumptions into research questions and selecting suitable activities.',
  ['user research', 'ux research', 'research plan', 'research questions', 'personas', 'user interviews']
);
addResource(
  'Moderated usability testing', 'GOV.UK Service Manual',
  'https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing', 'guide',
  'Learn how to observe participants completing tasks and identify usability issues.',
  'Study how to write neutral test tasks, observe participants and record useful findings.',
  ['usability testing', 'usability test', 'user testing', 'test a prototype', 'testing prototypes', 'moderated testing']
);
addResource(
  'Designing for web accessibility', 'W3C Web Accessibility Initiative',
  'https://www.w3.org/WAI/tips/designing/', 'guide',
  'Accessible design guidance covering contrast, navigation, labels and feedback.',
  'Use the contrast, navigation and form-label guidance to review your interface.',
  ['accessibility', 'accessible design', 'accessible interface', 'contrast', 'visual hierarchy', 'ui design', 'interface design']
);
addResource(
  'Accessible page structure', 'W3C Web Accessibility Initiative',
  'https://www.w3.org/WAI/tutorials/page-structure/', 'guide',
  'Learn how page regions, headings and meaningful structure improve navigation.',
  'Focus on clear headings, logical content structure and identifying page regions.',
  ['page structure', 'page layout', 'semantic html', 'headings', 'accessibility', 'accessible website']
);
addResource(
  'Advertising a job', 'Acas',
  'https://www.acas.org.uk/recruitment/how-to-advertise-a-job', 'guide',
  'Practical guidance on clear job adverts, recruitment information and inclusive wording.',
  'Study what to include in a job advert and how to avoid discriminatory language.',
  ['job posting', 'job postings', 'job advert', 'job advertisement', 'job ad', 'advertising a job', 'recruitment']
);
addResource(
  'Job description templates', 'Acas',
  'https://www.acas.org.uk/job-description-templates', 'guide',
  'Free templates and examples for describing a job role and its responsibilities.',
  'Compare the example responsibilities and requirements with your own job posting.',
  ['job posting', 'job postings', 'job advert', 'job advertisement', 'job ad', 'job description', 'person specification', 'recruitment']
);
addResource(
  'What an employment contract is', 'Acas',
  'https://www.acas.org.uk/employment-contracts-and-the-law', 'guide',
  'An introduction to employment contracts, agreed terms and workplace responsibilities.',
  'Focus on the meaning of a contract and how terms are agreed between employers and workers.',
  ['employment law', 'employment contract', 'employment contracts', 'contract terms', 'employment rights', 'human resources', 'hr']
);
addResource(
  'Employment contracts and written terms', 'Acas',
  'https://www.acas.org.uk/employment-contracts', 'guide',
  'Free guidance on employment contracts, written statements and changes to terms.',
  'Read the contract and written-statement guides relevant to the scenario in this module.',
  ['employment law', 'employment contract', 'employment contracts', 'written statement', 'terms of employment', 'human resources', 'hr']
);
addResource(
  'Introducing new employees through induction', 'Acas',
  'https://www.acas.org.uk/inductions', 'guide',
  'A practical explanation of inductions and helping new workers settle into a role.',
  'Focus on preparation, welcoming a new employee and planning useful induction information.',
  ['induction', 'inductions', 'employee onboarding', 'onboarding', 'human resources', 'hr', 'hr functions', 'hr roles']
);
addResource(
  'Protected characteristics at work', 'Acas',
  'https://www.acas.org.uk/protected-characteristics', 'guide',
  'An overview of workplace equality and the protected characteristics in UK discrimination law.',
  'Explore how equality applies to recruitment and workplace decisions in the module scenario.',
  ['employment law', 'discrimination', 'equality', 'protected characteristics', 'inclusive recruitment', 'hr functions']
);
addResource(
  'Using the Fetch API', 'MDN Web Docs',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch', 'documentation',
  'Learn how JavaScript sends HTTP requests, handles responses and reads returned data.',
  'Focus on fetch(), checking response status, parsing JSON and handling errors.',
  ['fetch', 'fetch api', 'api', 'apis', 'rest api', 'http requests', 'http request', 'javascript requests']
);
addResource(
  'Design foundations for web developers', 'MDN Web Docs',
  'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Design_for_developers', 'guide',
  'Free lessons introducing design principles for usable web interfaces.',
  'Study the sections on visual design, user experience and accessibility for your interface.',
  ['web design', 'website design', 'web interface', 'ui design', 'design for developers', 'user interface']
);
addResource(
  'The Python tutorial', 'Python Documentation',
  'https://docs.python.org/3/tutorial/', 'documentation',
  'The official introduction to Python syntax, control flow, functions and data structures.',
  'Use the relevant tutorial chapter to practise the Python concepts required by this task.',
  ['python', 'python programming', 'python basics', 'python functions']
);
addResource(
  'What kind of data does pandas handle?', 'pandas Documentation',
  'https://pandas.pydata.org/docs/getting_started/intro_tutorials/01_table_oriented.html', 'documentation',
  'An introduction to pandas DataFrames and working with tabular data in Python.',
  'Study creating a DataFrame, selecting columns and summarising tabular data.',
  ['pandas', 'dataframe', 'dataframes', 'data frame', 'tabular data', 'table oriented']
);
addResource(
  'Reading and writing tabular data with pandas', 'pandas Documentation',
  'https://pandas.pydata.org/docs/getting_started/intro_tutorials/02_read_write.html', 'documentation',
  'Learn how pandas reads and writes CSV and other common table formats.',
  'Focus on read_csv(), inspecting a table and saving your results.',
  ['pandas', 'dataframe', 'dataframes', 'data frame', 'tabular data', 'csv', 'read csv', 'reading data']
);

function normalizedText(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function containsKeyword(text, keyword) {
  const escaped = normalizedText(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function chooseLearningResources({ step = {}, content = {} } = {}) {
  const segments = [
    { text: normalizedText(step.title), weight: 12 },
    { text: normalizedText(step.description), weight: 7 },
    { text: normalizedText(content.learningObjectives?.join(' ')), weight: 3 },
    { text: normalizedText(content.keyConcepts?.map(concept => concept?.title || '').join(' ')), weight: 2 },
    { text: normalizedText([content.task?.title, content.task?.instructions].filter(Boolean).join(' ')), weight: 2 }
  ];
  return resources.map((resource, index) => ({
    resource, index,
    // A topic match counts once per segment so overlapping aliases cannot inflate it.
    score: segments.reduce((total, segment) => total +
      (resource.keywords.some(keyword => containsKeyword(segment.text, keyword)) ? segment.weight : 0), 0)
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .map(({ resource: { keywords, ...resource } }) => resource);
}

module.exports = { chooseLearningResources };
