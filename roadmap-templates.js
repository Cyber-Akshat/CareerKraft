/* =========================================
   CAREERKRAFT ROADMAP TEMPLATES

   Each roadmap uses:

   phase
   phaseTitle
   title
   description
   minutes
   type
   evidence
========================================= */


const roadmapTemplates = {


  /* =========================================
     1. SOFTWARE DEVELOPER
  ========================================= */

  'software-developer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand how software is built',
      description:
        'Learn how developers turn a problem into a working website, app or digital system.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn programming fundamentals',
      description:
        'Explore variables, conditions, loops, functions and how programs use logic.',
      minutes: 45,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn Git and version control',
      description:
        'Understand how developers track changes, manage code and collaborate safely.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Build a small interactive webpage',
      description:
        'Create a webpage containing useful content and at least one interactive feature.',
      minutes: 60,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Debug a broken program',
      description:
        'Find a problem in a small piece of code, explain what caused it and fix it.',
      minutes: 30,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create your first portfolio project',
      description:
        'Build a small project that solves a real problem and can be shown to other people.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore software development pathways',
      description:
        'Compare apprenticeships, university courses, training routes and entry-level opportunities.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     2. CYBER SECURITY ANALYST
  ========================================= */

  'cyber-security-analyst': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand what cyber security protects',
      description:
        'Learn about systems, networks, accounts and information that organisations need to protect.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn networking fundamentals',
      description:
        'Understand IP addresses, DNS, ports and how devices communicate.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn basic Linux',
      description:
        'Practise navigating files and using common commands.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Analyse a suspicious email',
      description:
        'Look for signs that an email may be malicious and explain your reasoning.',
      minutes: 25,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Investigate a mock security alert',
      description:
        'Review evidence and decide whether an alert should be escalated.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a beginner security project',
      description:
        'Create a small project showing practical security knowledge.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore cyber security pathways',
      description:
        'Compare apprenticeships, university courses and entry-level routes into cyber security.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     3. DATA ANALYST
  ========================================= */

  'data-analyst': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand how analysts use data',
      description:
        'Learn how organisations use data to answer questions and make decisions.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn spreadsheet fundamentals',
      description:
        'Practise organising information, using formulas and working with tables.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn data visualisation basics',
      description:
        'Understand when to use charts and how to communicate information clearly.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Analyse a small dataset',
      description:
        'Explore a dataset, find useful patterns and write down what you discovered.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Create a simple data dashboard',
      description:
        'Present a few useful findings using charts, numbers and clear explanations.',
      minutes: 60,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a mini data project',
      description:
        'Choose a question, analyse relevant information and present your conclusion.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore data analyst pathways',
      description:
        'Compare education, apprenticeship and entry-level routes into data roles.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     4. AI & MACHINE LEARNING ENGINEER
  ========================================= */

  'ai-engineer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand how machine learning works',
      description:
        'Learn the basic idea of training systems using examples and data.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Strengthen Python fundamentals',
      description:
        'Practise variables, functions, lists, conditions and working with data in Python.',
      minutes: 45,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about data quality and bias',
      description:
        'Explore why the quality and fairness of training data matter when building AI systems.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Experiment with a simple machine learning model',
      description:
        'Use a beginner-friendly dataset to see how a model can make predictions.',
      minutes: 60,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Evaluate an AI system',
      description:
        'Identify where an AI system could make mistakes and how those mistakes could affect users.',
      minutes: 35,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Build a beginner AI project',
      description:
        'Create a small AI or machine learning project and explain what the model does.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore AI and machine learning pathways',
      description:
        'Research the study, apprenticeship and technical routes that can lead into AI careers.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     5. UX/UI DESIGNER
  ========================================= */

  'ux-ui-designer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand UX and UI',
      description:
        'Learn the difference between user experience, interface design and visual design.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn basic design principles',
      description:
        'Explore hierarchy, spacing, typography, consistency and accessibility.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about user research',
      description:
        'Understand how designers discover what users need before designing a solution.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Redesign an everyday app screen',
      description:
        'Choose a screen you use regularly and redesign it to make one task easier.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Create a clickable prototype',
      description:
        'Design a short user journey and connect the screens into a simple prototype.',
      minutes: 60,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a UX case study',
      description:
        'Show the problem, your design decisions and how your solution improved the experience.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore UX/UI pathways',
      description:
        'Compare design courses, apprenticeships and portfolio-based routes into the industry.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     6. DIGITAL MARKETING
  ========================================= */

  'digital-marketing': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand digital marketing',
      description:
        'Learn how organisations attract, communicate with and retain audiences online.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn audience and customer basics',
      description:
        'Understand target audiences, customer needs and why different messages work for different people.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn marketing analytics basics',
      description:
        'Explore impressions, engagement, clicks, conversions and other common performance measures.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Plan a mini social campaign',
      description:
        'Choose a product or cause and plan three pieces of content for a specific audience.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Evaluate a marketing campaign',
      description:
        'Review a real campaign and explain its audience, message and call to action.',
      minutes: 30,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a small marketing portfolio project',
      description:
        'Build a simple campaign including content ideas, objectives and how success would be measured.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore digital marketing pathways',
      description:
        'Research apprenticeships, courses and entry-level marketing opportunities.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     7. PRODUCT MANAGER
  ========================================= */

  'product-manager': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand what product managers do',
      description:
        'Learn how product managers connect user needs, business goals and technical teams.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn how products solve problems',
      description:
        'Explore how teams identify problems worth solving before deciding what to build.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn prioritisation basics',
      description:
        'Understand how product teams decide which ideas and features should be worked on first.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Improve an existing product',
      description:
        'Choose an app or service and identify one user problem you would improve.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Write a simple product brief',
      description:
        'Describe the problem, target user, proposed feature and how you would measure success.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a mini product case study',
      description:
        'Take one product idea from problem discovery through to a proposed solution.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore product management pathways',
      description:
        'Research how people enter product roles through technology, business, design and apprenticeships.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     8. FINANCIAL ANALYST
  ========================================= */

  'financial-analyst': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand financial analysis',
      description:
        'Learn how analysts use financial information to understand organisations and support decisions.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn financial statement basics',
      description:
        'Explore revenue, costs, profit, assets, liabilities and cash flow.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn spreadsheet analysis',
      description:
        'Practise organising and comparing financial information in a spreadsheet.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Compare two businesses',
      description:
        'Use a small set of financial figures to compare performance and explain your conclusion.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Build a simple financial forecast',
      description:
        'Estimate future income and costs using a small example business.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a financial analysis project',
      description:
        'Create a short report containing calculations, charts and recommendations.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore financial analyst pathways',
      description:
        'Research university, apprenticeship and professional training routes into finance.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     9. ACCOUNTANT
  ========================================= */

  'accountant': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand what accountants do',
      description:
        'Learn how accountants record, check, explain and report financial information.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn bookkeeping basics',
      description:
        'Understand income, expenses, invoices and how transactions are recorded.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn profit and loss basics',
      description:
        'Practise calculating revenue, expenses and profit using simple examples.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Organise a set of business transactions',
      description:
        'Categorise a small set of transactions and identify any information that looks incorrect.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Create a simple monthly report',
      description:
        'Summarise the income, expenses and result for a fictional small business.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a mini accounting project',
      description:
        'Create basic financial records and explain what they show about a fictional business.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore accounting pathways',
      description:
        'Compare apprenticeships, degrees and professional accounting qualifications.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     10. MECHANICAL ENGINEER
  ========================================= */

  'mechanical-engineer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand mechanical engineering',
      description:
        'Learn how engineers design, test and improve machines and mechanical systems.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Explore forces and motion',
      description:
        'Review how forces, movement and energy affect mechanical designs.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn engineering design basics',
      description:
        'Understand requirements, constraints, sketches, prototypes and testing.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Design a simple mechanical solution',
      description:
        'Sketch a device that solves a small everyday mechanical problem.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Test and improve your design',
      description:
        'Identify weaknesses in your first idea and explain how you would improve it.',
      minutes: 35,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create an engineering design project',
      description:
        'Develop a concept from requirements through sketches, calculations or a simple prototype.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore mechanical engineering pathways',
      description:
        'Compare engineering degrees, apprenticeships and technician routes.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     11. CIVIL ENGINEER
  ========================================= */

  'civil-engineer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand civil engineering',
      description:
        'Learn how civil engineers help design and maintain infrastructure such as roads, bridges and buildings.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about structures and loads',
      description:
        'Explore how structures support weight and why materials behave differently.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about engineering constraints',
      description:
        'Understand how safety, cost, environment and location influence engineering decisions.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Design a simple bridge concept',
      description:
        'Sketch a bridge for a fictional location and explain the main design choices.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Evaluate an infrastructure problem',
      description:
        'Review a fictional site and identify important risks, constraints and possible solutions.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a civil engineering project',
      description:
        'Create a proposal for a small piece of infrastructure and explain how it meets the requirements.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore civil engineering pathways',
      description:
        'Research degrees, apprenticeships and engineering technician routes.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     12. BIOMEDICAL SCIENTIST
  ========================================= */

  'biomedical-scientist': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand biomedical science',
      description:
        'Learn how laboratory science can support the investigation and understanding of disease.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Review cells and microorganisms',
      description:
        'Strengthen your understanding of cells, bacteria, viruses and biological processes.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about laboratory accuracy',
      description:
        'Explore why careful measurement, controls, records and contamination prevention matter.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Interpret a mock laboratory result',
      description:
        'Review fictional laboratory information and identify what additional checks may be needed.',
      minutes: 35,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Plan a safe laboratory investigation',
      description:
        'Design a simple school-level investigation including variables, controls and safety considerations.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a biomedical investigation report',
      description:
        'Write up a scientific investigation including method, results, analysis and limitations.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore biomedical science pathways',
      description:
        'Research relevant degrees, laboratory training and professional career routes.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     13. PSYCHOLOGIST
  ========================================= */

  'psychologist': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand psychology as a career',
      description:
        'Explore how psychologists study behaviour, thinking and wellbeing using evidence and research.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn basic research methods',
      description:
        'Understand experiments, surveys, observations, variables and the importance of reliable evidence.',
      minutes: 40,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn about ethics in psychology',
      description:
        'Explore consent, confidentiality, wellbeing and responsible psychological research.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Evaluate a psychology study',
      description:
        'Review a simple fictional study and identify strengths, weaknesses and ethical considerations.',
      minutes: 35,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Design a small research question',
      description:
        'Create an appropriate question and explain how you could investigate it responsibly.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Complete a psychology research project',
      description:
        'Produce a short evidence-based report exploring a psychological topic.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore psychology pathways',
      description:
        'Research psychology degree routes and different professional specialisms.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     14. TEACHER
  ========================================= */

  'teacher': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand what teaching involves',
      description:
        'Explore lesson preparation, explanation, assessment, safeguarding and supporting different learners.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn how people learn differently',
      description:
        'Explore why explanations, examples, questioning and practice all matter.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn lesson planning basics',
      description:
        'Understand learning objectives, activities, checks for understanding and lesson structure.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Explain a difficult idea simply',
      description:
        'Choose something you understand well and create a clear explanation for a beginner.',
      minutes: 30,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Plan a mini lesson',
      description:
        'Create a short lesson containing an objective, explanation, activity and knowledge check.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a teaching resource',
      description:
        'Produce a useful worksheet, presentation or activity for a specific group of learners.',
      minutes: 75,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore teaching pathways',
      description:
        'Research teacher training routes and the qualifications needed for the area you are interested in.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     15. SOLICITOR
  ========================================= */

  'solicitor': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand what solicitors do',
      description:
        'Explore how solicitors research issues, advise clients, prepare documents and work with legal rules.',
      minutes: 25,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn legal reasoning basics',
      description:
        'Practise separating facts, questions, evidence and possible arguments.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn professional communication',
      description:
        'Explore why legal writing needs to be clear, accurate and carefully structured.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Analyse a fictional legal scenario',
      description:
        'Identify the important facts, unanswered questions and information you would need before giving advice.',
      minutes: 40,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Write a structured argument',
      description:
        'Present both sides of a fictional issue and explain which argument you find stronger.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Create a legal research project',
      description:
        'Research a legal topic using reliable sources and produce a clear written summary.',
      minutes: 90,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore solicitor pathways',
      description:
        'Research university, solicitor apprenticeship and professional qualification routes.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     16. CONTENT PRODUCER
  ========================================= */

  'content-producer': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand content production',
      description:
        'Learn how ideas are researched, planned, created, edited and adapted for different audiences.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn storytelling fundamentals',
      description:
        'Explore hooks, structure, pacing, emotion and how to keep an audience interested.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn platform and audience basics',
      description:
        'Understand why the same idea may need to be presented differently across platforms and audiences.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Create a short content concept',
      description:
        'Choose an audience and create an idea including a hook, structure and intended outcome.',
      minutes: 35,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Produce a short piece of content',
      description:
        'Create a short video, article, graphic or multimedia piece based on your concept.',
      minutes: 60,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Build a small content portfolio',
      description:
        'Create several pieces that demonstrate different styles, audiences or formats.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore content production pathways',
      description:
        'Research creative apprenticeships, media courses, freelance routes and entry-level roles.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ],



  /* =========================================
     17. ENTREPRENEUR
  ========================================= */

  'entrepreneur': [

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Understand entrepreneurship',
      description:
        'Learn how entrepreneurs identify problems, test ideas and build products or services around real needs.',
      minutes: 20,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn customer discovery',
      description:
        'Understand why talking to potential users is important before building a solution.',
      minutes: 30,
      type: 'learning',
      evidence: true
    },

    {
      phase: 1,
      phaseTitle: 'Understand the foundations',
      title: 'Learn basic business numbers',
      description:
        'Explore costs, pricing, revenue, profit and why cash matters when running a business.',
      minutes: 35,
      type: 'learning',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Find a problem worth solving',
      description:
        'Speak to several people and identify an everyday problem they genuinely experience.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 2,
      phaseTitle: 'Try the career',
      title: 'Design a simple solution',
      description:
        'Create a low-cost version of a product or service that could solve the problem.',
      minutes: 45,
      type: 'challenge',
      evidence: true
    },

    {
      phase: 3,
      phaseTitle: 'Build proof',
      title: 'Run a mini business experiment',
      description:
        'Test your idea with potential users, collect feedback and record what you learned.',
      minutes: 120,
      type: 'project',
      evidence: true
    },

    {
      phase: 4,
      phaseTitle: 'Prepare for opportunities',
      title: 'Explore entrepreneurship pathways',
      description:
        'Research enterprise programmes, startup communities, business courses and ways to continue testing your idea.',
      minutes: 30,
      type: 'research',
      evidence: true
    }

  ]

};


/* =========================================
   EXPORT
========================================= */

module.exports =
  roadmapTemplates;