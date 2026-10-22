const careerStorage = {
  getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { window.localStorage.setItem(key, value); } catch {} }
};
async function careerCall(method, ...args) {
  try {
    const result = await window.careerAuth?.[method]?.(...args);
    if (result && typeof result === 'object') return result;
  } catch {}
  return { data: null, error: { message: "We couldn't reach CareerKraft. Check your connection and try again." } };
}
/* =========================================
   CAREERKRAFT CAREER EXPLORER
========================================= */


/* =========================================
   CAREER DATA
========================================= */

const careers = {

  "software-developer": {

    id: "software-developer",

    title: "Software Developer",

    category: "TECHNOLOGY",

    icon: "</>",

    intro:
      "Build websites, apps and digital systems by turning ideas and problems into working software.",

    matchReason:
      "This career can suit people who enjoy technology, solving problems, building things and figuring out why something isn't working.",


    /* =====================================
       WHAT DO THEY ACTUALLY DO?
    ===================================== */

    scenario:
      "“We need an app that lets customers track their deliveries.”",

    process: [

      {
        title: "Understand the problem",
        description:
          "Talk to people, understand what they need and work out what the software needs to do."
      },

      {
        title: "Plan the solution",
        description:
          "Break the problem into smaller pieces and decide how the software should work."
      },

      {
        title: "Build it",
        description:
          "Write code to turn the idea into an actual website, app or system."
      },

      {
        title: "Test and improve",
        description:
          "Find bugs, fix problems and keep improving the software after it has been built."
      }

    ],


    /* =====================================
       DAY IN THE LIFE
    ===================================== */

    timeline: [

      {
        time: "9:00",
        title: "Quick team catch-up",
        description:
          "Share what you're working on and discuss anything blocking progress."
      },

      {
        time: "9:30",
        title: "Build a feature",
        description:
          "Work on part of an app, website or internal system."
      },

      {
        time: "11:17",
        title: "Why is this not working?",
        description:
          "Everything looks correct. It is definitely not correct.",
        fun: true
      },

      {
        time: "11:41",
        title: "Found it.",
        description:
          "One tiny mistake caused the whole problem. You now feel unstoppable.",
        fun: true
      },

      {
        time: "13:30",
        title: "Review some code",
        description:
          "Check your own work or help review something another developer has built."
      },

      {
        time: "15:00",
        title: "Test and fix bugs",
        description:
          "Make sure the feature behaves properly before it reaches users."
      },

      {
        time: "16:30",
        title: "Plan what's next",
        description:
          "Update progress and prepare for the next part of the project."
      }

    ],


    /* =====================================
       QUICK FACTS
    ===================================== */

    salary:
      "£30k – £75k",

    hours:
      "37–40 hrs/week",

    progressionSummary:
      "Junior → Senior → Lead",

    workEnvironment:
      "Office / Remote / Hybrid",

    researchNote:
      "UK salary, working hours and entry-route information reviewed against the National Careers Service. Apprenticeship information reviewed against Skills England.",


    /* =====================================
       WOULD YOU ENJOY IT?
    ===================================== */

    enjoy: [

      "You like solving problems rather than being given every answer.",

      "You enjoy building things and seeing your ideas actually work.",

      "You don't mind experimenting until you find a solution.",

      "You're interested in technology and how digital products work.",

      "You like improving things instead of leaving them 'good enough'."

    ],


    caution: [

      "You become extremely frustrated when something does not work immediately.",

      "You strongly dislike spending time working through detailed problems.",

      "You want a career where the tools and knowledge rarely change.",

      "You dislike learning independently when you encounter something new."

    ],


    /* =====================================
       ENTRY ROUTES
    ===================================== */

    routes: [

      {
        title: "University",
        description:
          "Degrees such as computer science, software engineering, IT, maths or related subjects can lead into software development."
      },

      {
        title: "Apprenticeship",
        description:
          "You can learn on the job while working towards a recognised software development qualification."
      },

      {
        title: "College / T Level",
        description:
          "Digital or computing courses can build technical skills before progressing into employment, an apprenticeship or higher education."
      },

      {
        title: "Graduate training",
        description:
          "Some organisations recruit graduates and train them for software and technology roles."
      }

    ],


    /* =====================================
       MINI CHALLENGE
    ===================================== */

    challenge: {

      duration: 15,

      description:
        "Try a small piece of the job before deciding whether software development sounds right for you.",

      task:
        "Create a tiny webpage containing a heading, a button and one interactive feature. For example, pressing the button could change the text on the page."

    },


    /* =====================================
       CAREER PROGRESSION
    ===================================== */

    progression: [

      {
        stage: "START",
        title: "Junior Developer"
      },

      {
        stage: "BUILD EXPERIENCE",
        title: "Software Developer"
      },

      {
        stage: "ADVANCE",
        title: "Senior Developer"
      },

      {
        stage: "LEAD",
        title: "Lead Developer"
      },

      {
        stage: "SPECIALISE",
        title: "Architect / Specialist"
      }

    ],


    /* =====================================
       RESEARCH SOURCES
    ===================================== */

    sources: [

      {
        icon: "◫",
        title: "National Careers Service",
        description:
          "Check official UK salary, working hours, entry routes and career progression.",
        sourceType: "national-careers-service"
      },

      {
        icon: "⚡",
        title: "Skills England",
        description:
          "Explore recognised software developer apprenticeship routes and occupational standards.",
        sourceType: "skills-england"
      },

      {
        icon: "▶",
        title: "See the role in action",
        description:
          "Look for developer interviews and day-in-the-life videos to see how the job differs between employers.",
        sourceType: "career-videos"
      }

    ]

  }

};



/* =========================================
   GET CAREER FROM URL
========================================= */

const params =
  new URLSearchParams(
    window.location.search
  );


const careerId =
  params.get("id") ||
  "software-developer";


const career =
  careers[careerId];



/* =========================================
   ELEMENT HELPERS
========================================= */

function setText(id, value) {

  const element =
    document.getElementById(id);


  if (element) {

    element.textContent =
      value;

  }

}



document.body.classList.add("career-loading");



/* =========================================
   MAIN RENDER FUNCTION
========================================= */

function renderCareer(career) {


  /* =====================================
     HERO
  ===================================== */

  document.title =
    `${career.title} | CareerKraft`;


  setText(
    "career-category",
    career.category
  );


  setText(
    "career-title",
    career.title
  );


  setText(
    "career-card-title",
    career.title
  );


  setText(
    "career-icon",
    career.icon
  );


  setText(
    "career-intro",
    career.intro
  );


  setText(
    "career-match-reason",
    career.matchReason
  );



  /* =====================================
     SCENARIO
  ===================================== */

  setText(
    "career-scenario",
    career.scenario
  );



  /* =====================================
     PROCESS
  ===================================== */

  renderProcess(
    career.process
  );



  /* =====================================
     DAY IN LIFE
  ===================================== */

  renderTimeline(
    career.timeline
  );



  /* =====================================
     FACTS
  ===================================== */

  setText(
    "career-salary",
    career.salary
  );


  setText(
    "career-hours",
    career.hours
  );


  setText(
    "career-progression-summary",
    career.progressionSummary
  );


  setText(
    "career-work-environment",
    career.workEnvironment
  );


  setText(
    "career-research-note",
    career.researchNote
  );



  /* =====================================
     FIT
  ===================================== */

  renderList(
    "career-enjoy-list",
    career.enjoy
  );


  renderList(
    "career-caution-list",
    career.caution
  );



  /* =====================================
     ROUTES
  ===================================== */

  renderRoutes(
    career.routes
  );



  /* =====================================
     CHALLENGE
  ===================================== */

  setText(
    "career-challenge-description",
    career.challenge.description
  );


  setText(
    "career-challenge-task",
    career.challenge.task
  );


  const challengeMinutes =
    document.querySelector(
      ".challenge-visual span"
    );


  if (challengeMinutes) {

    challengeMinutes.textContent =
      career.challenge.duration;

  }



  /* =====================================
     PROGRESSION
  ===================================== */

  renderProgression(
    career.progression
  );



  /* =====================================
     SOURCES
  ===================================== */

  renderSources(
    career.sources
  );

}



/* =========================================
   PROCESS RENDERER
========================================= */

function renderProcess(process) {

  const container =
    document.getElementById(
      "career-process"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    process
      .map(
        (step, index) => `

          <article class="process-step">

            <span>
              ${String(index + 1)
                .padStart(2, "0")}
            </span>

            <strong>
              ${escapeHTML(step.title)}
            </strong>

            <p>
              ${escapeHTML(step.description)}
            </p>

          </article>

        `
      )
      .join("");

}



/* =========================================
   TIMELINE RENDERER
========================================= */

function renderTimeline(timeline) {

  const container =
    document.getElementById(
      "day-timeline"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    timeline
      .map(
        item => `

          <article
            class="
              timeline-item
              ${item.fun ? "fun" : ""}
            "
          >

            <time>
              ${escapeHTML(item.time)}
            </time>

            <div>

              <strong>
                ${escapeHTML(item.title)}
              </strong>

              <p>
                ${escapeHTML(item.description)}
              </p>

            </div>

          </article>

        `
      )
      .join("");

}



/* =========================================
   LIST RENDERER
========================================= */

function renderList(
  elementId,
  items
) {

  const element =
    document.getElementById(
      elementId
    );


  if (!element) {
    return;
  }


  element.innerHTML =
    items
      .map(
        item => `

          <li>
            ${escapeHTML(item)}
          </li>

        `
      )
      .join("");

}



/* =========================================
   ROUTES
========================================= */

function renderRoutes(routes) {

  const container =
    document.getElementById(
      "career-routes"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    routes
      .map(
        (route, index) => `

          <article class="route-card">

            <span>
              ${String(index + 1)
                .padStart(2, "0")}
            </span>

            <strong>
              ${escapeHTML(route.title)}
            </strong>

            <p>
              ${escapeHTML(route.description)}
            </p>

          </article>

        `
      )
      .join("");

}



/* =========================================
   PROGRESSION
========================================= */

function renderProgression(
  progression
) {

  const container =
    document.getElementById(
      "career-progression"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    progression
      .map(
        (step, index) => {

          const arrow =
            index <
            progression.length - 1

              ? `
                <span
                  class="progression-arrow"
                >
                  →
                </span>
              `

              : "";


          return `

            <div class="progression-step">

              <small>
                ${escapeHTML(step.stage)}
              </small>

              <strong>
                ${escapeHTML(step.title)}
              </strong>

            </div>

            ${arrow}

          `;

        }
      )
      .join("");

}



/* =========================================
   SOURCES
========================================= */

function renderSources(sources) {

  const container =
    document.getElementById(
      "career-sources"
    );


  if (!container) {
    return;
  }


  container.innerHTML =
    sources
      .map(
        source => `

          <button type="button" class="research-card" data-source="${escapeHTML(source.sourceType)}" data-url="${escapeHTML(source.url || "")}">

            <span class="research-icon">

              ${escapeHTML(
                source.icon
              )}

            </span>


            <div>

              <strong>
                ${escapeHTML(
                  source.title
                )}
              </strong>

              <p>
                ${escapeHTML(
                  source.description
                )}
              </p>

            </div>


            <span>
              ↗
            </span>

          </button>

        `
      )
      .join("");

}



/* =========================================
   INTERESTED BUTTON
========================================= */

/* =========================================
   MINI CHALLENGE
========================================= */

/* =========================================
   SOURCE BUTTONS
========================================= */

document
  .getElementById(
    "career-sources"
  )
  ?.addEventListener(
    "click",
    event => {

      const button =
        event.target.closest(
          "[data-source]"
        );


      if (!button) {
        return;
      }


      const url = button.dataset.url;
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");

  }
);



/* =========================================
   BASIC HTML ESCAPING
========================================= */

function escapeHTML(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}
const guides = {
  "software-developer": {
    intro: "Turn ideas into websites, apps and tools people can use. The work mixes creative thinking with careful problem-solving.",
    icon: "</>",
    scenario: "A small shop wants customers to order online and track deliveries. How would you make that easy and reliable?",
    steps: [
      ["Understand the problem", "Talk through what customers and the team need."],
      ["Plan the solution", "Break the idea into screens, data and small tasks."],
      ["Build a first version", "Write code and connect the parts together."],
      ["Test and improve", "Find bugs, get feedback and make it better."]
    ],
    challenge: "Sketch a simple study-planner screen, then add one button that marks a task as done.",
    enjoy: ["You like making ideas into useful things.", "You enjoy solving puzzles and improving details.", "You are curious about how apps and websites work."],
    caution: ["You may spend a long time tracking down tiny errors.", "Learning new tools is a regular part of the job.", "Some tasks involve focused screen time."]
  },
  "cyber-security-analyst": {
    intro: "Help protect computers, networks and information by spotting risks, investigating alerts and improving security.",
    icon: "⌁",
    scenario: "An employee reports a strange sign-in notification. How would you check whether the account is at risk?",
    steps: [
      ["Check the signal", "Review alerts and decide what looks unusual."],
      ["Investigate carefully", "Compare sign-in details, devices and activity."],
      ["Reduce the risk", "Help contain a threat and protect affected accounts."],
      ["Share what you found", "Document the incident and prevent a repeat."]
    ],
    challenge: "Create a short checklist of five clues that could help someone spot a suspicious email.",
    enjoy: ["You like investigating clues and patterns.", "You care about protecting people and information.", "You can stay methodical when something unexpected happens."],
    caution: ["Some investigations are time-sensitive.", "Security tools and threats keep changing.", "Careful documentation is part of the work."]
  },
  "data-analyst": {
    intro: "Make information easier to understand. Analysts explore data, find patterns and explain what those patterns could mean.",
    icon: "▥",
    scenario: "A café has fewer customers on certain days. What information would help explain why?",
    steps: [
      ["Clarify the question", "Agree what the team wants to learn."],
      ["Gather useful data", "Check that the information is relevant and reliable."],
      ["Look for patterns", "Use analysis to compare trends and possibilities."],
      ["Explain the insight", "Share clear findings that support a decision."]
    ],
    challenge: "Survey five people about how they travel to school and show the results in a simple chart.",
    enjoy: ["You like spotting patterns and asking why.", "You can explain information clearly.", "You enjoy combining detail with a bigger picture."],
    caution: ["Data can be messy or incomplete.", "Some work involves spreadsheets and careful checking.", "A pattern does not always explain its cause."]
  },
  "ai-engineer": {
    intro: "Build and test software that uses data to make predictions or assist with complex tasks.",
    icon: "AI",
    scenario: "A library wants to recommend books to readers. What information could make recommendations helpful and fair?",
    steps: [
      ["Define the task", "Decide what a useful prediction should achieve."],
      ["Prepare the data", "Check the examples are relevant and responsibly used."],
      ["Build and test", "Train a model and measure how well it performs."],
      ["Review the impact", "Look for errors, bias and ways to improve it."]
    ],
    challenge: "Design a fair set of rules for recommending books to a reader without using sensitive personal details.",
    enjoy: ["You are curious about maths, code and new technology.", "You like testing ideas and measuring results.", "You think about how tools affect real people."],
    caution: ["The field changes quickly and needs ongoing study.", "Models can make mistakes or reflect biased data.", "A lot of work is experimentation, not instant results."]
  },
  "ux-ui-designer": {
    intro: "Make digital products easier and more enjoyable to use by understanding people and shaping clear interfaces.",
    icon: "✳",
    scenario: "A school app is confusing to new students. How could you find out what is getting in their way?",
    steps: [
      ["Listen to users", "Learn what people are trying to do and where they struggle."],
      ["Map the experience", "Organise the steps and information they need."],
      ["Prototype an idea", "Create a simple screen or clickable model."],
      ["Test and refine", "Watch people use it and improve the design."]
    ],
    challenge: "Redesign a confusing sign-up form on paper so a new user can finish it in three clear steps.",
    enjoy: ["You enjoy creativity with a practical purpose.", "You are interested in how people think and behave.", "You welcome feedback and iteration."],
    caution: ["Design choices often need evidence and explanation.", "Feedback can mean reworking something you like.", "You will balance user needs with technical limits."]
  },
  "digital-marketing": {
    intro: "Help organisations reach the right people online through useful content, campaigns and measurement.",
    icon: "↗",
    scenario: "A community event has few sign-ups. Which audience might care, and what message would reach them?",
    steps: [
      ["Understand the audience", "Learn who the campaign is for and what they need."],
      ["Choose a clear message", "Decide what to say and where it belongs."],
      ["Create and publish", "Make content that fits the channel and audience."],
      ["Measure and adjust", "Review engagement and improve the next campaign."]
    ],
    challenge: "Write two different headlines inviting students to a club, then ask which one is clearer.",
    enjoy: ["You like communication and creative ideas.", "You are interested in what makes people pay attention.", "You enjoy learning from results and trying again."],
    caution: ["Campaign results can be unpredictable.", "Deadlines and changing priorities are common.", "Some tasks involve data, planning and revisions."]
  },
  "product-manager": {
    intro: "Help a team decide what to build and why, balancing user needs, business goals and technical realities.",
    icon: "◈",
    scenario: "A team can only improve one part of a school app this month. How would you decide what matters most?",
    steps: [
      ["Understand the need", "Gather feedback and clarify the problem."],
      ["Set a direction", "Choose an outcome and agree what success means."],
      ["Coordinate the team", "Bring design, engineering and business together."],
      ["Learn from launch", "Review results and decide what to do next."]
    ],
    challenge: "Choose one improvement for a school timetable app and explain who it helps and how you would measure success.",
    enjoy: ["You like connecting people and ideas.", "You enjoy prioritising and making decisions.", "You can explain a goal to different kinds of teammates."],
    caution: ["You may balance competing requests.", "The role involves communication and coordination.", "You are accountable for choices without doing every task yourself."]
  },
  "financial-analyst": {
    intro: "Study financial information to help people and organisations understand performance and make informed plans.",
    icon: "£",
    scenario: "A youth club wants to run a new activity. How could you check whether its budget can support it?",
    steps: [
      ["Clarify the decision", "Find out what the organisation needs to decide."],
      ["Gather the figures", "Review costs, income and relevant assumptions."],
      ["Compare possibilities", "Explore scenarios and explain the trade-offs."],
      ["Present a recommendation", "Share the evidence and its limitations."]
    ],
    challenge: "Plan a small event budget with a fixed amount and show how changing one cost affects the total.",
    enjoy: ["You like numbers and careful reasoning.", "You are curious about how organisations make decisions.", "You can explain detailed information clearly."],
    caution: ["Accuracy and checking matter a lot.", "Some work follows regular reporting cycles.", "Financial data needs context, not just calculations."]
  },
  accountant: {
    intro: "Help people and organisations keep accurate financial records, understand obligations and make sound decisions.",
    icon: "＋",
    scenario: "A small group has receipts and expenses from an event. How could you organise them into a clear record?",
    steps: [
      ["Collect the records", "Bring together receipts and financial documents."],
      ["Check the details", "Make sure entries are complete and consistent."],
      ["Prepare a clear picture", "Summarise what came in and what went out."],
      ["Explain next steps", "Help the organisation understand what to do."]
    ],
    challenge: "Make a simple income-and-expenses table for a class fundraiser and check that the totals add up.",
    enjoy: ["You appreciate order and accuracy.", "You like helping people understand money.", "You enjoy solving practical, detail-focused problems."],
    caution: ["Deadlines can cluster around reporting periods.", "Rules and standards need regular attention.", "Small mistakes can require careful tracing."]
  },
  "mechanical-engineer": {
    intro: "Design, test and improve machines or mechanical systems, combining science, creativity and practical problem-solving.",
    icon: "⚙",
    scenario: "A delivery robot struggles to move over uneven ground. What could you change and how would you test it?",
    steps: [
      ["Understand the requirements", "Work out what the design must do safely."],
      ["Explore designs", "Compare materials, shapes and mechanisms."],
      ["Build and test", "Create a model and measure how it performs."],
      ["Improve the design", "Use test results to make the next version better."]
    ],
    challenge: "Design a paper bridge that spans a gap and holds a small object; test one change at a time.",
    enjoy: ["You like how things work and fit together.", "You enjoy practical experiments and iteration.", "You are interested in maths, science or design."],
    caution: ["Testing may reveal a design needs major changes.", "Safety and precision matter.", "Some projects take time to move from idea to finished product."]
  },
  "civil-engineer": {
    intro: "Help plan and deliver structures and infrastructure such as buildings, transport links and water systems.",
    icon: "⌂",
    scenario: "A neighbourhood needs a safer route across a busy road. What people, constraints and evidence should a team consider?",
    steps: [
      ["Understand the place", "Consider users, ground conditions and local needs."],
      ["Plan options", "Compare designs, materials, cost and impact."],
      ["Coordinate delivery", "Work with technical teams and project partners."],
      ["Check quality and safety", "Monitor work against plans and standards."]
    ],
    challenge: "Sketch a safe, accessible route between two points and label the people and constraints to consider.",
    enjoy: ["You want to make things that matter in the real world.", "You enjoy planning and solving practical problems.", "You are curious about buildings, places and infrastructure."],
    caution: ["Projects involve budgets, regulations and many stakeholders.", "Some roles include site visits and changing conditions.", "Safety and sustainability require careful thought."]
  },
  "biomedical-scientist": {
    intro: "Analyse samples and scientific evidence in laboratories to support diagnosis, treatment and health research.",
    icon: "◎",
    scenario: "A lab receives a sample that could help explain a patient's symptoms. Why do careful checks matter at every step?",
    steps: [
      ["Receive and identify", "Check sample details and follow safe procedures."],
      ["Run the analysis", "Use appropriate methods and equipment."],
      ["Review quality", "Check controls and investigate unusual results."],
      ["Report findings", "Communicate accurate results to the clinical team."]
    ],
    challenge: "Create a sample-tracking checklist that avoids mix-ups while protecting private information.",
    enjoy: ["You like science and evidence.", "You can focus on precise, repeatable tasks.", "You want your work to contribute to healthcare."],
    caution: ["Accuracy and strict procedures are essential.", "Some laboratory work can be repetitive.", "Clinical roles may have shift patterns depending on the workplace."]
  },
  psychologist: {
    intro: "Study how people think, feel and behave, and use evidence to support wellbeing in different settings.",
    icon: "♡",
    scenario: "A student feels overwhelmed by exams. What would you ask to understand their experience without jumping to conclusions?",
    steps: [
      ["Listen and understand", "Learn about the person's experience and goals."],
      ["Use appropriate evidence", "Choose a careful, ethical way to explore the question."],
      ["Plan support", "Agree practical next steps with the person."],
      ["Review progress", "Check whether the support is helping and adapt."]
    ],
    challenge: "Write three open, non-judgemental questions that could help someone talk about a stressful situation.",
    enjoy: ["You are interested in people and behaviour.", "You listen carefully and communicate with empathy.", "You value evidence and ethical practice."],
    caution: ["Professional routes can require extensive study and supervised training.", "Some conversations may be emotionally demanding.", "Confidentiality and boundaries are central."]
  },
  teacher: {
    intro: "Help learners understand ideas, build confidence and develop skills through lessons, feedback and encouragement.",
    icon: "✎",
    scenario: "A class is stuck on a difficult idea. How could you explain it in a new way and check what students understood?",
    steps: [
      ["Plan a learning goal", "Choose what learners should understand or practise."],
      ["Explain and demonstrate", "Present the idea in an accessible way."],
      ["Notice understanding", "Use questions and activities to see what is working."],
      ["Give feedback", "Help learners recognise progress and next steps."]
    ],
    challenge: "Teach a friend a small skill in five minutes, then ask them what made the explanation clear.",
    enjoy: ["You like helping others learn and grow.", "You can explain ideas in different ways.", "You enjoy energy, variety and working with people."],
    caution: ["Preparation and follow-up take time beyond lessons.", "Classrooms can be busy and unpredictable.", "Patience and clear boundaries are important."]
  },
  solicitor: {
    intro: "Advise clients on legal questions, research the relevant rules and help them decide how to move forward.",
    icon: "§",
    scenario: "A local group is unsure what permission it needs for an event. What facts and rules would you check before advising?",
    steps: [
      ["Understand the client", "Listen carefully and clarify the issue."],
      ["Research the law", "Find relevant rules and check reliable sources."],
      ["Explain the options", "Set out risks and possible next steps clearly."],
      ["Support the matter", "Prepare documents or work toward a resolution."]
    ],
    challenge: "Compare two short fictional event scenarios and list the questions you would research before advising.",
    enjoy: ["You enjoy reading, reasoning and clear writing.", "You like helping people understand complex choices.", "You can pay close attention to detail."],
    caution: ["Training routes can be demanding and competitive.", "Deadlines and client expectations can create pressure.", "Advice must be based on careful research and current rules."]
  },
  "content-producer": {
    intro: "Plan and create content such as video, audio or digital stories for a particular audience and purpose.",
    icon: "▶",
    scenario: "A museum wants teenagers to notice a new exhibit. What short story or format might make them curious?",
    steps: [
      ["Find the story", "Agree the purpose, audience and key message."],
      ["Plan the production", "Choose a format, outline and practical approach."],
      ["Create the content", "Record, write, design or edit the material."],
      ["Publish and learn", "Review feedback and improve future work."]
    ],
    challenge: "Create a 30-second storyboard that introduces a place or idea to someone your age.",
    enjoy: ["You like storytelling and making things.", "You enjoy collaborating and sharing ideas.", "You are curious about what captures an audience's attention."],
    caution: ["Projects can involve revisions and tight deadlines.", "Some work is freelance or project-based.", "Creative goals must fit practical budgets and permissions."]
  },
  entrepreneur: {
    intro: "Spot a problem worth solving and build a product, service or organisation around a useful idea.",
    icon: "✦",
    scenario: "Students want affordable snacks after school. How would you find out whether a small service could work?",
    steps: [
      ["Find a real need", "Talk to potential customers and learn what is missing."],
      ["Test a small idea", "Try a low-cost version before investing heavily."],
      ["Build the operation", "Work out delivery, costs and how people find you."],
      ["Learn and adapt", "Use feedback and results to decide what comes next."]
    ],
    challenge: "Ask three people about a small everyday frustration and sketch a simple service that could help.",
    enjoy: ["You like taking initiative and making ideas real.", "You are comfortable learning by trying.", "You enjoy a mix of creative and practical work."],
    caution: ["Income and workload can be uncertain.", "You may need to handle many different tasks.", "Ideas need testing; enthusiasm alone is not proof of demand."]
  }
};

const defaultGuide = {
  intro: "Explore what this role involves, the skills it uses and the different ways people can build experience.",
  icon: "✦",
  scenario: "A team has a challenge to solve. What information, people and practical constraints would help you decide what to do?",
  steps: [
    ["Understand the goal", "Clarify what needs to change and who it affects."],
    ["Gather useful information", "Ask questions and check the facts."],
    ["Try an approach", "Work with others to put a solution into practice."],
    ["Review the result", "Learn what worked and what could improve."]
  ],
  challenge: "Pick a problem you see in everyday life. Write who it affects, one possible solution and how you would test it.",
  enjoy: ["You like learning about this field.", "You enjoy solving real problems.", "You are open to building new skills over time."],
  caution: ["The day-to-day work can vary between employers.", "Most roles involve tasks that may be less visible than the exciting parts.", "Talk to people in the field and check current entry requirements."]
};

const $ = selector => document.querySelector(selector);
const careerParams = new URLSearchParams(window.location.search);
const requestedCareer = careerParams.get("career") || careerParams.get("id");
const careerThemeToggle = $("#career-theme-toggle");
const chooseButton = $("#choose-career-button");
const pageStatus = document.createElement("p");
pageStatus.className = "career-status";
pageStatus.setAttribute("role", "status");
pageStatus.setAttribute("aria-live", "polite");
pageStatus.hidden = true;
$(".career-nav")?.after(pageStatus);

function setStatus(message, error = false) {
  pageStatus.textContent = message;
  pageStatus.hidden = !message;
  pageStatus.classList.toggle("is-error", error);
  document.body.classList.remove("career-loading");
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value;
  careerStorage.setItem("careerkraft-theme", value);
  if (careerThemeToggle) {
    const next = value === "dark" ? "light" : "dark";
    careerThemeToggle.setAttribute("aria-label", `Switch to ${next} mode`);
    careerThemeToggle.setAttribute("title", `Switch to ${next} mode`);
    careerThemeToggle.setAttribute("aria-pressed", String(value === "light"));
  }
}

function addItems(list, values) {
  if (!list) return;
  list.replaceChildren(...values.map(value => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function showSteps(steps) {
  const container = $("#career-process");
  if (!container) return;
  container.replaceChildren(...steps.map(([title, description], index) => {
    const card = document.createElement("article");
    card.className = "process-step";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.textContent = description;
    card.append(number, heading, detail);
    return card;
  }));
}

function updateResearchLinks(title) {
  const links = $("#career-sources")?.querySelectorAll("a, [data-source]") || [];
  const destinations = {
    "national-careers-service": "https://nationalcareers.service.gov.uk/",
    "skills-england": "https://skillsengland.education.gov.uk/apprenticeship-standards/st0116-v1-1",
    "career-videos": `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} day in the life UK`)}`
  };
  links.forEach((link, index) => {
    const url = link.dataset.url || (link.dataset.source
      ? destinations[link.dataset.source] || destinations["national-careers-service"]
      : Object.values(destinations)[index] || destinations["national-careers-service"]);
    if (link.tagName === "A") {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.dataset.url = url;
    }
  });
}

function showTimeline(title) {
  const container = $("#day-timeline");
  if (!container) return;
  const entries = [
    ["9:00", "Plan the day", `Review priorities and work that supports ${title.toLowerCase()}.`],
    ["10:00", "Focused work", "Make progress on a task that needs care and attention."],
    ["11:30", "Ask and investigate", "Check details, get feedback or work through a problem."],
    ["14:00", "Work with others", "Share progress and coordinate the next steps."],
    ["15:30", "Review and learn", "Check what is complete and what still needs attention."]
  ];
  container.replaceChildren(...entries.map(([time, heading, description]) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    const clock = document.createElement("time");
    clock.textContent = time;
    const content = document.createElement("div");
    const titleElement = document.createElement("strong");
    titleElement.textContent = heading;
    const detail = document.createElement("p");
    detail.textContent = description;
    content.append(titleElement, detail);
    item.append(clock, content);
    return item;
  }));
}

function showGenericRoutes() {
  const container = $("#career-routes");
  if (!container) return;
  const routes = [
    ["Check the official route", "Entry requirements differ by role. Use the official profile and professional body to confirm what this career needs."],
    ["Explore work-based learning", "Apprenticeships or employer training may be available in some areas of this field."],
    ["Build relevant experience", "Projects, volunteering or introductory courses can help you test your interest and develop useful skills."]
  ];
  container.replaceChildren(...routes.map(([heading, description], index) => {
    const card = document.createElement("article");
    card.className = "route-card";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const titleElement = document.createElement("strong");
    titleElement.textContent = heading;
    const detail = document.createElement("p");
    detail.textContent = description;
    card.append(number, titleElement, detail);
    return card;
  }));
}

function showGenericProgression(title) {
  const container = $("#career-progression");
  if (!container) return;
  const steps = [
    ["GET STARTED", "Training / entry role"],
    ["BUILD EXPERIENCE", title],
    ["DEVELOP", `Experienced ${title.toLowerCase()}`],
    ["GROW", "Specialist / leadership"]
  ];
  container.replaceChildren(...steps.flatMap(([stage, label], index) => {
    const step = document.createElement("div");
    step.className = "progression-step";
    const stageLabel = document.createElement("small");
    stageLabel.textContent = stage;
    const role = document.createElement("strong");
    role.textContent = label;
    step.append(stageLabel, role);
    if (index === steps.length - 1) return [step];
    const arrow = document.createElement("span");
    arrow.className = "progression-arrow";
    arrow.textContent = "→";
    return [step, arrow];
  }));
}

function updateDashboardReturn(selectedCareer) {
  const link = document.querySelector("#return-dashboard-button");
  if (!link) return;
  const enabled = Boolean(selectedCareer?.id);
  link.hidden = !enabled;
  link.setAttribute("aria-disabled", String(!enabled));
  if (enabled) {
    link.href = "dashboard.html";
    link.removeAttribute("tabindex");
    link.removeAttribute("title");
  } else {
    link.removeAttribute("href");
    link.setAttribute("tabindex", "-1");
    link.title = "Choose a career to open your dashboard";
  }
}

function populateCareer(match, assessment, selectedCareer) {
  updateDashboardReturn(selectedCareer);
  const navigationButton = $("#back-to-matches");
  if (navigationButton) {
    navigationButton.textContent = selectedCareer?.id ? "\u2190 My dashboard" : "\u2190 My matches";
    navigationButton.dataset.destination = selectedCareer?.id ? "dashboard.html" : "onboarding.html?view=matches";
  }
  const careerInfo = window.careerData?.[match.id] || guides[match.id] || defaultGuide;
  const legacyGuide = guides[match.id] || defaultGuide;
  const reasons = Array.isArray(match.reasons) ? match.reasons : [];
  const title = match.title || "Career";
  const category = match.category || "CAREER";

  document.title = `${title} | CareerKraft`;
  $("#career-title").textContent = title;
  $("#career-card-title").textContent = title;
  $("#career-category").textContent = category.toUpperCase();
  $("#career-match-score").textContent = Number.isFinite(match.score) ? `${Math.round(match.score)}%` : 'Match';
  $("#career-intro").textContent = match.description || legacyGuide.intro;
  $("#career-icon").textContent = legacyGuide.icon || "✦";
  $("#career-scenario").textContent = `“${careerInfo.scenario || legacyGuide.scenario}”`;
  $("#career-match-reason").textContent = reasons.length
    ? `Your answers point to ${reasons.join(", ").toLowerCase()} as strengths that connect with this path.`
    : "This was one of your strongest matches based on your quiz answers.";

  showSteps(careerInfo.whatTheyDo || careerInfo.steps || legacyGuide.steps);
  addItems($("#career-enjoy-list"), careerInfo.enjoy || legacyGuide.enjoy || defaultGuide.enjoy);
  addItems($("#career-caution-list"), careerInfo.caution || legacyGuide.caution || defaultGuide.caution);
  if (Array.isArray(careerInfo.timeline)) renderTimeline(careerInfo.timeline);
  else showTimeline(title);
  if (Array.isArray(careerInfo.routes)) renderRoutes(careerInfo.routes);
  else showGenericRoutes();
  if (Array.isArray(careerInfo.progression)) renderProgression(careerInfo.progression);
  else showGenericProgression(title);

  const skillsPanel = $(".career-skills-panel");
  if (skillsPanel) {
    skillsPanel.hidden = !Array.isArray(careerInfo.skills) || careerInfo.skills.length === 0;
    addItems($("#career-skills"), careerInfo.skills || []);
  }

  const apprenticeships = careerInfo.apprenticeships ||
    (careerInfo.apprenticeship ? [careerInfo.apprenticeship] : []);
  const apprenticeshipPanel = $("#career-apprenticeships");
  if (apprenticeshipPanel) {
    apprenticeshipPanel.hidden = apprenticeships.length === 0;
    const list = apprenticeshipPanel.querySelector(".apprenticeship-list");
    list.replaceChildren(...apprenticeships.map(item => {
      const card = document.createElement("article");
      card.className = "apprenticeship-spotlight";
      const details = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = item.title;
      const description = document.createElement("p");
      description.textContent = item.description;
      details.append(heading, description);
      if (item.url) {
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View apprenticeship information ↗";
        details.append(link);
      }
      const facts = document.createElement("dl");
      for (const [label, value] of [
        ["Level", item.level],
        ["Typical duration", item.typicalDuration],
        ["Status", item.status]
      ]) {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        term.textContent = label;
        const definition = document.createElement("dd");
        definition.textContent = value;
        row.append(term, definition);
        facts.append(row);
      }
      card.append(details, facts);
      return card;
    }));
  }

  const facts = careerInfo.facts || {};
  $("#career-salary").textContent = facts.salary || "Check current information";
  $("#career-hours").textContent = facts.hours || "Varies by employer";
  $("#career-progression-summary").textContent = careerInfo.progression?.length
    ? careerInfo.progression.slice(0, 3).map(step => step.title).join(" → ")
    : "Experience & specialism";
  $("#career-work-environment").textContent = facts.environment || "Varies by employer";
  const reviewed = careerInfo.reviewedAt ? ` Exploration profile updated ${careerInfo.reviewedAt}.` : "";
  const workingPattern = facts.workingPattern ? ` Working patterns may include ${facts.workingPattern.toLowerCase()}.` : "";
  $("#career-research-note").textContent =
    `Pay, hours and routes can vary by employer and change over time. Check the official sources below for current information about ${title}.${workingPattern}${reviewed}`;

  const challenge = typeof careerInfo.challenge === "object"
    ? careerInfo.challenge
    : { task: careerInfo.challenge || legacyGuide.challenge || defaultGuide.challenge };
  const challengeTask = $("#career-challenge-task");
  if (challengeTask) {
    const task = document.createElement('strong');
    task.textContent = challenge.task;
    challengeTask.replaceChildren(task);
  }
  const challengeDescription = $("#career-challenge-description");
  if (challengeDescription) {
    challengeDescription.textContent = challenge.description ||
      `Try this short activity inspired by ${title}.`;
  }
  const challengeDuration = $(".challenge-visual span");
  if (challengeDuration && Number.isFinite(challenge.duration)) {
    challengeDuration.textContent = String(challenge.duration);
  }

  if (Array.isArray(careerInfo.sources)) renderSources(careerInfo.sources);
  updateResearchLinks(title);
  if (chooseButton) {
    chooseButton.disabled = selectedCareer?.id === match.id;
    chooseButton.textContent = chooseButton.disabled
      ? "This is your selected career ✓"
      : "I'm interested in this career →";
  }
}

let careerLoadPending = false;
function careerRecovery(message, empty = false) {
  setStatus(message, !empty);
  const button = document.createElement('button');
  button.id = 'career-retry'; button.type = 'button';
  button.className = 'secondary-button page-retry-button';
  button.textContent = empty ? 'View my career matches' : 'Try again';
  button.addEventListener('click', () => empty ? goBackToMatches() : void loadCareer());
  pageStatus.append(document.createElement('br'), button);
}
async function loadCareer() {
  if (careerLoadPending) return;
  careerLoadPending = true;
  if (chooseButton) chooseButton.disabled = true;
  for (const section of document.querySelectorAll('.career-page > section')) section.hidden = true;
  setStatus('Loading your career profile...');
  pageStatus.setAttribute('aria-busy', 'true');
  try {
  applyTheme(careerStorage.getItem("careerkraft-theme"));
  const auth = window.careerAuth;
  if (!auth) {
    careerRecovery("CareerKraft could not connect to your account. Try again when your connection is restored.");
    return;
  }

  const { data: sessionData, error: sessionError } = await careerCall('getSession');
  if (sessionError) { careerRecovery(sessionError.message || "We couldn't check your sign-in."); return; }
  if (!sessionData?.session?.user) {
    window.location.assign("auth.html");
    return;
  }

  const { data, error } = await careerCall('request', "assessment");
  if (error) {
    careerRecovery(error.message || "We couldn't load your career matches. Please try again.");
    return;
  }

  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const selectedCareer = data?.selectedCareer || null;
  const match = matches.find(item => item.id === requestedCareer) ||
    (!requestedCareer && matches.find(item => item.id === selectedCareer?.id)) ||
    (!requestedCareer && matches[0]);
  if (!match) {
    careerRecovery(requestedCareer && matches.length
      ? "This career isn't in your saved matches. Choose a career from your results."
      : 'Complete the career quiz first, then choose a match to explore.', true);
    return;
  }
  for (const section of document.querySelectorAll(".career-page > section")) section.hidden = false;
  populateCareer(match, data.assessment, selectedCareer);
  setStatus("");
  document.body.classList.remove("career-loading");

  if (chooseButton && !chooseButton.disabled) {
    chooseButton.onclick = async () => {
      chooseButton.disabled = true;
      chooseButton.textContent = "Saving...";
      setStatus("");
      const { error: saveError } = await careerCall('request', "profile/career", {
        career_id: match.id
      });
      if (saveError) {
        chooseButton.disabled = false;
        chooseButton.textContent = "I'm interested in this career →";
        setStatus(saveError.message || "We couldn't save your choice. Please try again.", true);
        return;
      }
      updateDashboardReturn(match);
      chooseButton.textContent = "Career saved ✓";
      setStatus(`${match.title} is now saved as your selected career.`);
      window.location.assign("dashboard.html");
    };
  }
  } catch { careerRecovery("We couldn't load this career profile. Please try again."); }
  finally { careerLoadPending = false; pageStatus.setAttribute('aria-busy', 'false'); }
}

careerThemeToggle?.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

$("#back-to-matches")?.addEventListener("click", () => {
  window.location.assign($("#back-to-matches").dataset.destination || "onboarding.html?view=matches");
});

function goBackToMatches() {
  window.location.assign("onboarding.html?view=matches");
}

[ $("#decision-back") ]
  .filter(Boolean)
  .forEach(button => button.addEventListener("click", goBackToMatches));

$("#start-challenge-button")?.addEventListener("click", () => {
  const task = $("#career-challenge-task")?.querySelector("strong")?.textContent || defaultGuide.challenge;
  if (document.querySelector(".challenge-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.className = "challenge-dialog";
  const heading = document.createElement("h2");
  heading.id = "career-challenge-dialog-title";
  heading.textContent = "Your mini challenge";
  dialog.setAttribute("aria-labelledby", heading.id);
  const description = document.createElement("p");
  description.textContent = task;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "primary-button";
  close.textContent = "Got it — let's try it";
  close.addEventListener("click", () => {
    if (typeof dialog.close === "function") dialog.close();
    dialog.remove();
  });
  dialog.append(heading, description, close);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
});

loadCareer();
