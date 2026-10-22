const roadmapSupportedIds = new Set([
  'software-developer', 'cyber-security-analyst', 'data-analyst', 'ai-engineer',
  'ux-ui-designer', 'digital-marketing', 'product-manager', 'financial-analyst',
  'accountant', 'mechanical-engineer', 'civil-engineer', 'biomedical-scientist',
  'psychologist', 'teacher', 'solicitor', 'content-producer', 'entrepreneur'
]);

const careers = [
  // Technology
  ['software-developer', 'Software Developer', 'Technology'],
  ['cyber-security-analyst', 'Cyber Security Analyst', 'Technology'],
  ['data-analyst', 'Data Analyst', 'Technology & Data'],
  ['ai-engineer', 'AI Engineer', 'Technology & AI'],
  ['ux-ui-designer', 'UX/UI Designer', 'Design & Technology'],
  ['product-manager', 'Product Manager', 'Business & Technology'],
  ['web-developer', 'Web Developer', 'Technology'],
  ['mobile-app-developer', 'Mobile App Developer', 'Technology'],
  ['cloud-engineer', 'Cloud Engineer', 'Technology'],
  ['devops-engineer', 'DevOps Engineer', 'Technology'],
  ['network-engineer', 'Network Engineer', 'Technology'],
  ['systems-engineer', 'Systems Engineer', 'Technology'],
  ['database-administrator', 'Database Administrator', 'Technology'],
  ['it-support-specialist', 'IT Support Specialist', 'Technology'],
  ['solutions-architect', 'Solutions Architect', 'Technology'],
  ['game-developer', 'Game Developer', 'Technology & Gaming'],
  ['qa-engineer', 'Software Test Engineer', 'Technology'],

  // Cyber security
  ['penetration-tester', 'Penetration Tester', 'Cyber Security'],
  ['digital-forensics-investigator', 'Digital Forensics Investigator', 'Cyber Security'],
  ['security-engineer', 'Security Engineer', 'Cyber Security'],
  ['soc-analyst', 'Security Operations Centre Analyst', 'Cyber Security'],
  ['incident-response-analyst', 'Incident Response Analyst', 'Cyber Security'],
  ['security-consultant', 'Cyber Security Consultant', 'Cyber Security'],

  // Data & AI
  ['data-scientist', 'Data Scientist', 'Data & AI'],
  ['data-engineer', 'Data Engineer', 'Data & AI'],
  ['machine-learning-engineer', 'Machine Learning Engineer', 'Data & AI'],
  ['business-intelligence-analyst', 'Business Intelligence Analyst', 'Data'],
  ['statistician', 'Statistician', 'Data & Mathematics'],
  ['operations-research-analyst', 'Operational Research Analyst', 'Data'],

  // Business & management
  ['entrepreneur', 'Entrepreneur', 'Business'],
  ['business-analyst', 'Business Analyst', 'Business'],
  ['management-consultant', 'Management Consultant', 'Business'],
  ['project-manager', 'Project Manager', 'Business'],
  ['operations-manager', 'Operations Manager', 'Business'],
  ['sales-manager', 'Sales Manager', 'Business'],
  ['human-resources-manager', 'Human Resources Manager', 'Business'],
  ['recruitment-consultant', 'Recruitment Consultant', 'Business'],
  ['supply-chain-manager', 'Supply Chain Manager', 'Business'],
  ['procurement-specialist', 'Procurement Specialist', 'Business'],

  // Marketing & media
  ['digital-marketing', 'Digital Marketing Specialist', 'Marketing'],
  ['marketing-manager', 'Marketing Manager', 'Marketing'],
  ['social-media-manager', 'Social Media Manager', 'Marketing'],
  ['seo-specialist', 'SEO Specialist', 'Marketing'],
  ['brand-manager', 'Brand Manager', 'Marketing'],
  ['market-research-analyst', 'Market Research Analyst', 'Marketing'],
  ['content-producer', 'Content Producer', 'Media & Creative'],
  ['journalist', 'Journalist', 'Media'],
  ['video-editor', 'Video Editor', 'Media & Creative'],
  ['film-producer', 'Film Producer', 'Media & Creative'],
  ['photographer', 'Photographer', 'Creative'],
  ['graphic-designer', 'Graphic Designer', 'Design'],
  ['animator', 'Animator', 'Creative'],
  ['copywriter', 'Copywriter', 'Media & Marketing'],

  // Finance
  ['financial-analyst', 'Financial Analyst', 'Finance'],
  ['accountant', 'Accountant', 'Finance'],
  ['investment-banker', 'Investment Banker', 'Finance'],
  ['actuary', 'Actuary', 'Finance & Mathematics'],
  ['financial-adviser', 'Financial Adviser', 'Finance'],
  ['auditor', 'Auditor', 'Finance'],
  ['tax-adviser', 'Tax Adviser', 'Finance'],
  ['insurance-underwriter', 'Insurance Underwriter', 'Finance'],
  ['economist', 'Economist', 'Economics & Finance'],

  // Engineering
  ['mechanical-engineer', 'Mechanical Engineer', 'Engineering'],
  ['civil-engineer', 'Civil Engineer', 'Engineering'],
  ['electrical-engineer', 'Electrical Engineer', 'Engineering'],
  ['electronics-engineer', 'Electronics Engineer', 'Engineering'],
  ['aerospace-engineer', 'Aerospace Engineer', 'Engineering'],
  ['automotive-engineer', 'Automotive Engineer', 'Engineering'],
  ['chemical-engineer', 'Chemical Engineer', 'Engineering'],
  ['robotics-engineer', 'Robotics Engineer', 'Engineering'],
  ['structural-engineer', 'Structural Engineer', 'Engineering'],
  ['environmental-engineer', 'Environmental Engineer', 'Engineering'],
  ['renewable-energy-engineer', 'Renewable Energy Engineer', 'Engineering'],

  // Science
  ['biomedical-scientist', 'Biomedical Scientist', 'Science & Healthcare'],
  ['research-scientist', 'Research Scientist', 'Science'],
  ['chemist', 'Chemist', 'Science'],
  ['physicist', 'Physicist', 'Science'],
  ['microbiologist', 'Microbiologist', 'Science'],
  ['forensic-scientist', 'Forensic Scientist', 'Science'],
  ['environmental-scientist', 'Environmental Scientist', 'Science'],
  ['marine-biologist', 'Marine Biologist', 'Science'],
  ['food-scientist', 'Food Scientist', 'Science'],

  // Healthcare
  ['doctor', 'Doctor', 'Healthcare'],
  ['nurse', 'Nurse', 'Healthcare'],
  ['paramedic', 'Paramedic', 'Healthcare'],
  ['pharmacist', 'Pharmacist', 'Healthcare'],
  ['physiotherapist', 'Physiotherapist', 'Healthcare'],
  ['occupational-therapist', 'Occupational Therapist', 'Healthcare'],
  ['radiographer', 'Radiographer', 'Healthcare'],
  ['dietitian', 'Dietitian', 'Healthcare'],
  ['dentist', 'Dentist', 'Healthcare'],
  ['optometrist', 'Optometrist', 'Healthcare'],
  ['speech-language-therapist', 'Speech and Language Therapist', 'Healthcare'],

  // Psychology & people
  ['psychologist', 'Psychologist', 'Psychology'],
  ['clinical-psychologist', 'Clinical Psychologist', 'Psychology'],
  ['forensic-psychologist', 'Forensic Psychologist', 'Psychology'],
  ['educational-psychologist', 'Educational Psychologist', 'Psychology'],
  ['counsellor', 'Counsellor', 'Psychology & Wellbeing'],

  // Law
  ['solicitor', 'Solicitor', 'Law'],
  ['barrister', 'Barrister', 'Law'],
  ['paralegal', 'Paralegal', 'Law'],
  ['legal-executive', 'Chartered Legal Executive', 'Law'],
  ['corporate-lawyer', 'Corporate Lawyer', 'Law'],
  ['criminal-lawyer', 'Criminal Lawyer', 'Law'],

  // Education
  ['teacher', 'Teacher', 'Education'],
  ['primary-school-teacher', 'Primary School Teacher', 'Education'],
  ['secondary-school-teacher', 'Secondary School Teacher', 'Education'],
  ['university-lecturer', 'University Lecturer', 'Education'],
  ['teaching-assistant', 'Teaching Assistant', 'Education'],
  ['careers-adviser', 'Careers Adviser', 'Education & Careers'],

  // Architecture & design
  ['architect', 'Architect', 'Architecture'],
  ['interior-designer', 'Interior Designer', 'Design'],
  ['product-designer', 'Product Designer', 'Design'],
  ['industrial-designer', 'Industrial Designer', 'Design'],
  ['fashion-designer', 'Fashion Designer', 'Creative'],
  ['landscape-architect', 'Landscape Architect', 'Architecture'],

  // Construction & property
  ['quantity-surveyor', 'Quantity Surveyor', 'Construction'],
  ['building-surveyor', 'Building Surveyor', 'Construction'],
  ['construction-manager', 'Construction Manager', 'Construction'],
  ['estate-agent', 'Estate Agent', 'Property'],
  ['property-manager', 'Property Manager', 'Property'],

  // Public services
  ['police-officer', 'Police Officer', 'Public Services'],
  ['detective', 'Detective', 'Public Services'],
  ['firefighter', 'Firefighter', 'Public Services'],
  ['probation-officer', 'Probation Officer', 'Public Services'],
  ['civil-servant', 'Civil Servant', 'Government'],
  ['intelligence-analyst', 'Intelligence Analyst', 'Government & Security'],

  // Environment & animals
  ['environmental-consultant', 'Environmental Consultant', 'Environment'],
  ['conservation-officer', 'Conservation Officer', 'Environment'],
  ['ecologist', 'Ecologist', 'Environment'],
  ['veterinary-surgeon', 'Veterinary Surgeon', 'Animals & Healthcare'],
  ['veterinary-nurse', 'Veterinary Nurse', 'Animals & Healthcare'],

  // Hospitality & events
  ['chef', 'Chef', 'Hospitality'],
  ['hotel-manager', 'Hotel Manager', 'Hospitality'],
  ['event-manager', 'Event Manager', 'Events'],
  ['travel-consultant', 'Travel Consultant', 'Travel'],

  // Skilled & technical careers
  ['electrician', 'Electrician', 'Skilled Trades'],
  ['plumber', 'Plumber', 'Skilled Trades'],
  ['carpenter', 'Carpenter', 'Skilled Trades'],
  ['automotive-technician', 'Automotive Technician', 'Skilled Trades'],
  ['aircraft-technician', 'Aircraft Technician', 'Engineering & Aviation'],

  // Aviation & transport
  ['airline-pilot', 'Airline Pilot', 'Aviation'],
  ['air-traffic-controller', 'Air Traffic Controller', 'Aviation'],
  ['logistics-manager', 'Logistics Manager', 'Transport & Logistics']
];

const careerCatalog = careers.map(([id, title, category]) => ({
  id, title, category, roadmapSupported: roadmapSupportedIds.has(id)
}));

module.exports = careerCatalog;
