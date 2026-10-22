const onboardingStorage = {
  getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { window.localStorage.setItem(key, value); } catch {} }
};
async function onboardingCall(method, ...args) {
  try {
    const result = await window.careerAuth?.[method]?.(...args);
    if (result && typeof result === 'object') return result;
  } catch {}
  return { data: null, error: { message: "We couldn't reach CareerKraft. Check your connection and try again." } };
}
let currentUser = null;



/* =========================================
   ELEMENTS
========================================= */

const screens =
  Array.from(
    document.querySelectorAll(
      ".onboarding-screen"
    )
  );


const progressLabel =
  document.querySelector(
    "#progress-label"
  );


const progressBar =
  document.querySelector(
    "#progress-bar-fill"
  );


const analysisRows =
  Array.from(
    document.querySelectorAll(
      ".analysis-status-row"
    )
  );


const themeToggle =
  document.querySelector(
    "#onboarding-theme-toggle"
  );


const logoutButton =
  document.querySelector(
    "#logout-button"
  );


const careerResults =
  document.querySelector(
    "#career-results"
  );


const analyseButton =
  document.querySelector(
    "#analyse-button"
  );


const retakeButton =
  document.querySelector(
    "#retake-button"
  );


const selections =
  new Map();


let currentScreen = 0;



/* =========================================
   CAREER DATABASE
========================================= */

const careers = [

  {
    id: "software-developer",
    title: "Software Developer",
    category: "Technology",

    description:
      "Build websites, apps and digital products by solving problems with code.",

    interests: [
      "technology",
      "creative"
    ],

    subjects: [
      "computing",
      "mathematics"
    ],

    strengths: [
      "problem-solving",
      "creativity",
      "attention-to-detail"
    ],

    workStyle: [
      "building",
      "research"
    ]
  },


  {
    id: "cyber-security-analyst",
    title: "Cyber Security Analyst",
    category: "Technology",

    description:
      "Protect organisations from cyber threats, investigate suspicious activity and improve digital security.",

    interests: [
      "technology",
      "science"
    ],

    subjects: [
      "computing",
      "mathematics"
    ],

    strengths: [
      "problem-solving",
      "analysis",
      "attention-to-detail"
    ],

    workStyle: [
      "research",
      "data"
    ]
  },


  {
    id: "data-analyst",
    title: "Data Analyst",
    category: "Data",

    description:
      "Explore information, uncover patterns and turn data into useful decisions.",

    interests: [
      "technology",
      "business"
    ],

    subjects: [
      "mathematics",
      "computing",
      "economics"
    ],

    strengths: [
      "analysis",
      "problem-solving",
      "attention-to-detail"
    ],

    workStyle: [
      "data",
      "research"
    ]
  },


  {
    id: "ai-engineer",
    title: "AI & Machine Learning Engineer",
    category: "Technology",

    description:
      "Build intelligent systems that can learn from data and solve complex problems.",

    interests: [
      "technology",
      "science"
    ],

    subjects: [
      "computing",
      "mathematics",
      "science"
    ],

    strengths: [
      "problem-solving",
      "analysis",
      "creativity"
    ],

    workStyle: [
      "building",
      "data",
      "research"
    ]
  },


  {
    id: "ux-ui-designer",
    title: "UX/UI Designer",
    category: "Creative Technology",

    description:
      "Design digital experiences that are useful, intuitive and visually engaging.",

    interests: [
      "creative",
      "technology"
    ],

    subjects: [
      "design",
      "art",
      "computing"
    ],

    strengths: [
      "creativity",
      "communication",
      "problem-solving"
    ],

    workStyle: [
      "creative",
      "building",
      "people"
    ]
  },


  {
    id: "digital-marketing",
    title: "Digital Marketing Specialist",
    category: "Marketing",

    description:
      "Create campaigns, understand audiences and help organisations grow online.",

    interests: [
      "business",
      "media",
      "creative"
    ],

    subjects: [
      "business",
      "english",
      "psychology"
    ],

    strengths: [
      "creativity",
      "communication",
      "analysis"
    ],

    workStyle: [
      "creative",
      "people",
      "data"
    ]
  },


  {
    id: "product-manager",
    title: "Product Manager",
    category: "Business & Technology",

    description:
      "Guide the development of products by connecting users, technology and business goals.",

    interests: [
      "technology",
      "business"
    ],

    subjects: [
      "business",
      "computing",
      "economics"
    ],

    strengths: [
      "leadership",
      "communication",
      "problem-solving"
    ],

    workStyle: [
      "leadership",
      "people",
      "building"
    ]
  },


  {
    id: "financial-analyst",
    title: "Financial Analyst",
    category: "Finance",

    description:
      "Study financial information and help businesses make better financial decisions.",

    interests: [
      "finance",
      "business"
    ],

    subjects: [
      "mathematics",
      "economics",
      "business"
    ],

    strengths: [
      "analysis",
      "attention-to-detail",
      "problem-solving"
    ],

    workStyle: [
      "data",
      "research"
    ]
  },


  {
    id: "accountant",
    title: "Accountant",
    category: "Finance",

    description:
      "Manage financial records, analyse spending and help organisations understand their finances.",

    interests: [
      "finance",
      "business"
    ],

    subjects: [
      "mathematics",
      "business",
      "economics"
    ],

    strengths: [
      "attention-to-detail",
      "analysis",
      "problem-solving"
    ],

    workStyle: [
      "data"
    ]
  },


  {
    id: "mechanical-engineer",
    title: "Mechanical Engineer",
    category: "Engineering",

    description:
      "Design, develop and improve machines, products and mechanical systems.",

    interests: [
      "engineering",
      "technology"
    ],

    subjects: [
      "engineering",
      "mathematics",
      "science"
    ],

    strengths: [
      "problem-solving",
      "analysis",
      "creativity"
    ],

    workStyle: [
      "building",
      "research"
    ]
  },


  {
    id: "civil-engineer",
    title: "Civil Engineer",
    category: "Engineering",

    description:
      "Design and improve infrastructure such as roads, bridges and buildings.",

    interests: [
      "engineering",
      "science"
    ],

    subjects: [
      "engineering",
      "mathematics",
      "geography"
    ],

    strengths: [
      "problem-solving",
      "analysis",
      "attention-to-detail"
    ],

    workStyle: [
      "building",
      "leadership"
    ]
  },


  {
    id: "biomedical-scientist",
    title: "Biomedical Scientist",
    category: "Science & Healthcare",

    description:
      "Use laboratory science to investigate disease and support medical diagnosis.",

    interests: [
      "science",
      "helping-people"
    ],

    subjects: [
      "science",
      "mathematics"
    ],

    strengths: [
      "analysis",
      "attention-to-detail",
      "problem-solving"
    ],

    workStyle: [
      "research",
      "data"
    ]
  },


  {
    id: "psychologist",
    title: "Psychologist",
    category: "Psychology",

    description:
      "Understand human behaviour and help people improve their wellbeing and lives.",

    interests: [
      "helping-people",
      "science"
    ],

    subjects: [
      "psychology",
      "science",
      "english"
    ],

    strengths: [
      "communication",
      "analysis",
      "attention-to-detail"
    ],

    workStyle: [
      "people",
      "research"
    ]
  },


  {
    id: "teacher",
    title: "Teacher",
    category: "Education",

    description:
      "Help people learn, develop confidence and understand new ideas.",

    interests: [
      "helping-people"
    ],

    subjects: [
      "english",
      "science",
      "mathematics",
      "history"
    ],

    strengths: [
      "communication",
      "leadership",
      "creativity"
    ],

    workStyle: [
      "people",
      "leadership"
    ]
  },


  {
    id: "solicitor",
    title: "Solicitor",
    category: "Law",

    description:
      "Advise people and organisations, research legal issues and solve complex disputes.",

    interests: [
      "helping-people",
      "business"
    ],

    subjects: [
      "english",
      "history"
    ],

    strengths: [
      "communication",
      "analysis",
      "attention-to-detail"
    ],

    workStyle: [
      "research",
      "people"
    ]
  },


  {
    id: "content-producer",
    title: "Content & Media Producer",
    category: "Media",

    description:
      "Create digital stories, videos and media designed to inform or entertain audiences.",

    interests: [
      "media",
      "creative"
    ],

    subjects: [
      "english",
      "art",
      "design"
    ],

    strengths: [
      "creativity",
      "communication"
    ],

    workStyle: [
      "creative",
      "people"
    ]
  },


  {
    id: "entrepreneur",
    title: "Entrepreneur",
    category: "Business",

    description:
      "Turn ideas into businesses, solve customer problems and build new products or services.",

    interests: [
      "business",
      "creative",
      "finance"
    ],

    subjects: [
      "business",
      "economics"
    ],

    strengths: [
      "leadership",
      "creativity",
      "communication",
      "problem-solving"
    ],

    workStyle: [
      "leadership",
      "building",
      "people"
    ]
  }

];



/* =========================================
   LABELS
========================================= */

const labels = {

  technology:
    "Technology",

  business:
    "Business",

  science:
    "Science",

  creative:
    "Creativity",

  engineering:
    "Engineering",

  "helping-people":
    "Helping people",

  finance:
    "Finance",

  media:
    "Media",

  computing:
    "Computing",

  mathematics:
    "Mathematics",

  english:
    "English",

  design:
    "Design",

  geography:
    "Geography",

  history:
    "History",

  art:
    "Art",

  economics:
    "Economics",

  psychology:
    "Psychology",

  "problem-solving":
    "Problem solving",

  communication:
    "Communication",

  creativity:
    "Creativity",

  analysis:
    "Analytical thinking",

  leadership:
    "Leadership",

  "attention-to-detail":
    "Attention to detail",

  building:
    "Building things",

  people:
    "Working with people",

  research:
    "Research",

  data:
    "Working with data"

};



/* =========================================
   SESSION
========================================= */

function setOnboardingMessage(text, retry = false) {
  const message = document.getElementById('onboarding-session-message');
  if (!message) return;
  message.textContent = text;
  message.hidden = !text;
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'onboarding-retry';
    button.className = 'secondary-button page-retry-button'; button.textContent = 'Try again';
    button.addEventListener('click', async () => {
      button.disabled = true;
      await initialiseOnboarding();
      if (button.isConnected) button.disabled = false;
    });
    message.append(document.createElement('br'), button);
  }
}
async function checkUserSession() {
  const { data, error } = await onboardingCall('getSession');
  if (error) { setOnboardingMessage(error.message || "We couldn't check your sign-in.", true); return false; }
  if (!data?.session?.user) { window.location.replace('auth.html'); return false; }
  currentUser = data.session.user;
  setOnboardingMessage('');
  return true;
}

/* =========================================
   CREATE / UPDATE PROFILE
========================================= */

async function ensureProfile() {
  const displayName = currentUser.display_name || currentUser.name || '';
  const { error } = await onboardingCall('request', 'profile', { display_name: displayName });
  if (error) { setOnboardingMessage(error.message || "We couldn't save your profile.", true); return false; }
  return true;
}

/* =========================================
   THEME
========================================= */

function updateThemeToggle(theme) {

  if (!themeToggle) return;


  const nextLabel =
    theme === "light"
      ? "Switch to dark mode"
      : "Switch to light mode";


  themeToggle.setAttribute(
    "aria-label",
    nextLabel
  );


  themeToggle.setAttribute(
    "title",
    nextLabel
  );


  themeToggle.setAttribute(
    "aria-pressed",
    String(theme === "light")
  );

}


if (themeToggle) {

  updateThemeToggle(
    document.documentElement
      .dataset.theme
  );


  themeToggle.addEventListener(
    "click",
    () => {

      const nextTheme =
        document.documentElement
          .dataset.theme === "light"
          ? "dark"
          : "light";


      document.documentElement
        .dataset.theme =
        nextTheme;


      onboardingStorage.setItem(
        "careerkraft-theme",
        nextTheme
      );


      updateThemeToggle(
        nextTheme
      );

    }
  );

}



/* =========================================
   SCREEN LABELS
========================================= */

const screenLabels = [

  "Getting started",

  "Step 1 of 4 - Interests",

  "Step 2 of 4 - Subjects",

  "Step 3 of 4 - Strengths",

  "Step 4 of 4 - Work style",

  "Building your profile",

  "Your career matches"

];



/* =========================================
   SHOW SCREEN
========================================= */

function showScreen(screenNumber) {

  const nextScreen =
    screens.find(
      (screen) =>
        Number(
          screen.dataset.screen
        ) === screenNumber
    );


  if (!nextScreen) {



    return;

  }


  currentScreen =
    screenNumber;
  document.title = screenNumber === 6 ? 'Your career matches | CareerKraft'
    : screenNumber === 5 ? 'Finding your career matches | CareerKraft'
    : 'Build your career profile | CareerKraft';


  screens.forEach(
    (screen) => {

      screen.classList.toggle(
        "active",
        screen === nextScreen
      );

    }
  );

  nextScreen.querySelectorAll(
    ".welcome-copy h1, .question-header h2, .results-heading h2, .career-result-card h3"
  ).forEach(animateSwoosh);


  if (progressLabel) {

    progressLabel.textContent =
      screenLabels[screenNumber] || "";

  }

  if (progressBar) {

    progressBar.style.width =
      `${(screenNumber / 6) * 100}%`;

  }


  window.scrollTo({

    top: 0,

    behavior: "smooth"

  });


  const heading =
    nextScreen.querySelector(
      "h1, h2"
    );


  if (heading) {

    heading.setAttribute(
      "tabindex",
      "-1"
    );


    heading.focus({

      preventScroll: true

    });

  }

}

function animateSwoosh(heading) {
  let highlight = heading.firstElementChild;
  if (!highlight?.classList.contains("onboarding-swoosh")) {
    highlight = document.createElement("span");
    highlight.className = "onboarding-swoosh";
    while (heading.firstChild) highlight.appendChild(heading.firstChild);
    heading.appendChild(highlight);
  }
  highlight.classList.remove("is-visible");
  void highlight.offsetWidth;
  highlight.classList.add("is-visible");
}



/* =========================================
   QUESTION SELECTIONS
========================================= */

document
  .querySelectorAll(
    ".selection-hint"
  )
  .forEach(
    (hint) => {

      hint.dataset.defaultText =
        hint.textContent.trim();

    }
  );


function getQuestionChoices(grid) {

  const question =
    grid.dataset.question;


  if (!question) {

    throw new Error(
      "Question is missing data-question."
    );

  }


  if (
    !selections.has(question)
  ) {

    selections.set(
      question,
      new Set()
    );

  }


  return selections.get(
    question
  );

}



function updateSelectionHint(
  grid,
  isError = false
) {

  const hint =
    grid.parentElement
      .querySelector(
        ".selection-hint"
      );


  if (!hint) return;


  hint.classList.toggle(
    "error",
    isError
  );


  hint.setAttribute(
    "aria-live",
    "polite"
  );

}



document
  .querySelectorAll(
    ".choice-grid[data-question]"
  )
  .forEach(
    (grid) => {

      const choices =
        getQuestionChoices(grid);


      grid
        .querySelectorAll(
          ".choice-card[data-value]"
        )
        .forEach(
          (card) => {

            const value =
              card.dataset.value;


            card.setAttribute(
              "aria-pressed",
              String(
                choices.has(value)
              )
            );


            card.addEventListener(
              "click",
              () => {

                const maximum =
                  Number(
                    grid.dataset.max ||
                    Infinity
                  );


                if (
                  choices.has(value)
                ) {

                  choices.delete(
                    value
                  );


                  card.classList.remove(
                    "selected"
                  );

                }

                else {

                  if (
                    choices.size >=
                    maximum
                  ) {

                    const hint =
                      grid.parentElement
                        .querySelector(
                          ".selection-hint"
                        );


                    if (hint) {

                      hint.textContent =
                        `Choose no more than ${maximum} options.`;

                    }


                    updateSelectionHint(
                      grid,
                      true
                    );


                    return;

                  }


                  choices.add(
                    value
                  );


                  card.classList.add(
                    "selected"
                  );

                }


                card.setAttribute(
                  "aria-pressed",
                  String(
                    choices.has(value)
                  )
                );


                const hint =
                  grid.parentElement
                    .querySelector(
                      ".selection-hint"
                    );


                if (hint) {

                  hint.textContent =
                    hint.dataset.defaultText;

                }


                updateSelectionHint(
                  grid
                );

              }
            );

          }
        );

    }
  );



/* =========================================
   VALIDATION
========================================= */

function canContinue(screen) {

  const grid =
    screen.querySelector(
      ".choice-grid[data-question]"
    );


  if (!grid) return true;


  const count =
    getQuestionChoices(
      grid
    ).size;


  const minimum =
    Number(
      grid.dataset.min || 0
    );


  const maximum =
    Number(
      grid.dataset.max ||
      Infinity
    );


  const hint =
    grid.parentElement
      .querySelector(
        ".selection-hint"
      );


  if (
    count < minimum ||
    count > maximum
  ) {

    if (hint) {

      hint.textContent =
        count < minimum
          ?
          `Choose at least ${minimum} option${minimum === 1 ? "" : "s"} to continue.`
          :
          `Choose no more than ${maximum} options to continue.`;

    }


    updateSelectionHint(
      grid,
      true
    );


    return false;

  }


  if (hint) {

    hint.textContent =
      hint.dataset.defaultText;

  }


  updateSelectionHint(
    grid
  );


  return true;

}



/* =========================================
   ANSWERS OBJECT
========================================= */

function getAnswers() {

  return {

    interests:
      Array.from(
        selections.get(
          "interests"
        ) || []
      ),

    subjects:
      Array.from(
        selections.get(
          "subjects"
        ) || []
      ),

    strengths:
      Array.from(
        selections.get(
          "strengths"
        ) || []
      ),

    workStyle:
      Array.from(
        selections.get(
          "workStyle"
        ) || []
      )

  };

}



/* =========================================
   MATCHING ALGORITHM
========================================= */

function categoryScore(
  selected,
  ideal
) {

  if (
    selected.length === 0 ||
    ideal.length === 0
  ) {

    return 0;

  }


  const matches =
    selected.filter(
      (item) =>
        ideal.includes(item)
    ).length;


  if (matches === 0) {

    return 0;

  }


  /*
    F1-style scoring.

    It rewards matching traits while
    preventing someone selecting every
    option from automatically scoring 100%.
  */

  const precision =
    matches /
    selected.length;


  const recall =
    matches /
    ideal.length;


  return (
    2 *
    precision *
    recall
  ) /
  (
    precision +
    recall
  );

}



function calculateCareerMatches() {

  const answers =
    getAnswers();


  return careers
    .map(
      (career) => {

        const interestScore =
          categoryScore(
            answers.interests,
            career.interests
          ) * 30;


        const subjectScore =
          categoryScore(
            answers.subjects,
            career.subjects
          ) * 20;


        const strengthScore =
          categoryScore(
            answers.strengths,
            career.strengths
          ) * 30;


        const workScore =
          categoryScore(
            answers.workStyle,
            career.workStyle
          ) * 20;


        const total =
          Math.round(
            interestScore +
            subjectScore +
            strengthScore +
            workScore
          );


        const reasons = [];


        const categories = [

          [
            answers.interests,
            career.interests
          ],

          [
            answers.strengths,
            career.strengths
          ],

          [
            answers.subjects,
            career.subjects
          ],

          [
            answers.workStyle,
            career.workStyle
          ]

        ];


        categories.forEach(
          ([selected, ideal]) => {

            selected.forEach(
              (item) => {

                if (
                  ideal.includes(item) &&
                  !reasons.includes(
                    labels[item]
                  )
                ) {

                  reasons.push(
                    labels[item]
                  );

                }

              }
            );

          }
        );


        return {

          ...career,

          score:
            total,

          reasons:
            reasons.slice(
              0,
              3
            )

        };

      }
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(
      0,
      3
    );

}



/* =========================================
   RENDER RESULTS
========================================= */

function escapeCareerText(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function renderCareerResults(matches) {
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'career-results-empty';
    empty.setAttribute('role', 'status');
    empty.textContent = "We couldn't find career matches for these answers. Change your answers below and try again.";
    careerResults.replaceChildren(empty);
    return;
  }
  careerResults.innerHTML = matches.map((career, index) => {
    const reasons = Array.isArray(career.reasons) ? career.reasons : [];
    const explanation = String(career.description || reasons.find(reason => !reason.startsWith('Strength:')) || 'Explore how this career connects to your interests.').trim();
    const firstSentence = explanation.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || explanation;
    const preview = firstSentence.length > 220 ? firstSentence.slice(0, 217).trimEnd() + '?' : firstSentence;
    const strengths = reasons.filter(reason => reason !== explanation && reason !== reasons[0]).map(reason => reason.replace(/^Strength:\s*/i, '')).filter(reason => reason.length <= 90);
    return `<article class="career-result-card ${index === 0 ? 'top-match' : ''}">
      <div class="match-card-top"><span class="match-rank">${index === 0 ? 'TOP MATCH' : '#' + (index + 1) + ' MATCH'}</span><div class="match-score"><span>${career.score}</span><small>/ 100 fit</small></div></div>
      <div class="match-content">
        <span class="match-category">${escapeCareerText(career.category)}</span>
        <h3>${escapeCareerText(career.title)}</h3>
        <div class="match-explanation"><span class="match-section-label">Why this fits you</span><p>${escapeCareerText(preview)}</p>
          ${preview !== explanation ? '<details class="match-more"><summary>Read more</summary><p>' + escapeCareerText(explanation) + '</p></details>' : ''}
        </div>
        ${strengths.length ? '<div class="match-strengths"><span class="match-section-label">Your strengths</span><div class="match-reasons">' + strengths.map(reason => '<span>' + escapeCareerText(reason) + '</span>').join('') + '</div></div>' : ''}
      </div>
      <button type="button" class="career-select-button" data-career-id="${escapeCareerText(career.id)}">Explore this career</button>
    </article>`;
  }).join('');
  setupCareerButtons(matches);
}


/* =========================================
   SAVE ASSESSMENT
========================================= */

async function saveAssessment(
  matches
) {

  const answers =
    getAnswers();


  const matchData =
    matches.map(
      (career) => ({

        id:
          career.id,

        title:
          career.title,

        category:
          career.category,

        description:
          career.description,

        score:
          career.score,

        reasons:
          career.reasons

      })
    );


  const { data, error } = await onboardingCall('request', "assessments", {
    interests: answers.interests,
    subjects: answers.subjects,
    strengths: answers.strengths,
    work_style: answers.workStyle,
    matches: matchData
  });


  if (error) throw new Error(error.message || "We couldn't save your answers. Please try again.");
  return data;

}



/* =========================================
   SELECT CAREER
========================================= */

function setupCareerButtons(
  matches
) {

  document
    .querySelectorAll(
      ".career-select-button"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          async () => {

            const careerId =
              button.dataset
                .careerId;


            const career =
              matches.find(
                (item) =>
                  item.id ===
                  careerId
              );


            if (!career) {

              return;

            }

            window.location.assign(
              `career.html?career=${encodeURIComponent(career.id)}`
            );

          }
        );

      }
    );

}



/* =========================================
   ANALYSIS
========================================= */

function delay(ms) {

  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );

}



const lumiaQuizSound = document.getElementById('lumia-quiz-sound');
let finishQuizSound;
function playLumiaQuizSound() {
  if (!lumiaQuizSound) return Promise.resolve();
  return new Promise(resolve => {
    finishQuizSound = resolve;
    const finish = () => { resolve(); finishQuizSound = null; };
    lumiaQuizSound.onended = finish;
    lumiaQuizSound.onerror = finish;
    lumiaQuizSound.currentTime = 0;
    lumiaQuizSound.volume = 0.4;
    const playback = lumiaQuizSound.play();
    if (playback) playback.catch(finish);
    else finish();
  });
}
window.addEventListener('pagehide', () => {
  lumiaQuizSound?.pause();
  finishQuizSound?.();
});
async function startAnalysis() {
  setOnboardingMessage('');
  const fallbackMatches = calculateCareerMatches();
  analysisRows.forEach(row => row.classList.remove('active'));
  analysisRows[0]?.classList.add('active');
  showScreen(5);
  const soundFinished = playLumiaQuizSound();
  const analysisPromise = saveAssessment(fallbackMatches).catch(error => ({ saveError: error }));
  await delay(650);
  analysisRows[1]?.classList.add('active');
  await delay(650);
  analysisRows[2]?.classList.add('active');
  await delay(750);
  const result = await analysisPromise;
  await soundFinished;
  lumiaQuizSound?.pause();
  if (!result || result.saveError) {
    showScreen(4);
    setOnboardingMessage(result?.saveError?.message || "We couldn't save your answers. Your choices are still here; try finding your careers again.");
    return;
  }
  const matches = Array.isArray(result.matches) ? result.matches : fallbackMatches;
  renderCareerResults(matches);


  showScreen(6);
}


/* =========================================
   NEXT BUTTONS
========================================= */

document
  .querySelectorAll(
    "[data-next]"
  )
  .forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          const screen =
            button.closest(
              ".onboarding-screen"
            );


          if (
            !screen ||
            !canContinue(
              screen
            )
          ) {

            return;

          }


          showScreen(
            Number(
              screen.dataset.screen
            ) + 1
          );

        }
      );

    }
  );



/* =========================================
   BACK BUTTONS
========================================= */

document
  .querySelectorAll(
    "[data-back]"
  )
  .forEach(
    (button) => {

      button.addEventListener(
        "click",
        () => {

          showScreen(
            Math.max(
              0,
              currentScreen - 1
            )
          );

        }
      );

    }
  );



/* =========================================
   FIND CAREERS
========================================= */

analyseButton?.addEventListener(
  "click",
  async () => {

    const screen =
      document.querySelector(
        '[data-screen="4"]'
      );


    if (
      !canContinue(
        screen
      )
    ) {

      return;

    }


    analyseButton.disabled =
      true;


    const label = analyseButton.textContent;
    analyseButton.textContent = 'Finding your matches...';
    try { await startAnalysis(); }
    catch { showScreen(4); setOnboardingMessage("We couldn't save your answers. Your choices are still here; please try again."); }
    finally { analyseButton.disabled = false; analyseButton.textContent = label; }

  }
);



/* =========================================
   RETAKE
========================================= */

retakeButton?.addEventListener(
  "click",
  () => {

    showScreen(1);

  }
);



/* =========================================
   LOG OUT
========================================= */

logoutButton?.addEventListener(
  "click",
  async () => {

    logoutButton.disabled =
      true;
    const logoutLabel = logoutButton.textContent;
    logoutButton.textContent = 'Logging out...';


    const {
      error
    } =
      await onboardingCall('signOut');


    if (error) {




      logoutButton.textContent = logoutLabel;
      logoutButton.disabled = false;
      setOnboardingMessage(error.message || "We couldn't log you out. Please try again.");
      return;

    }


    window.location.replace(
      "auth.html"
    );

  }
);



/* =========================================
   START CAREERKRAFT
========================================= */

async function initialiseOnboarding() {
  setOnboardingMessage('Loading your account...');
  if (!await checkUserSession() || !await ensureProfile()) return;
  const { data, error } = await onboardingCall('request', 'assessment');
  if (error) { setOnboardingMessage(error.message || "We couldn't load your saved matches.", true); return; }
  setOnboardingMessage('');
  if (data?.selectedCareer && new URLSearchParams(window.location.search).get('view') !== 'matches') {
    window.location.replace('dashboard.html'); return;
  }
  const savedMatches = Array.isArray(data?.matches) ? data.matches : [];
  if (savedMatches.length) {
    renderCareerResults(savedMatches.map(match => ({ ...match,
      description: match.description || careers.find(career => career.id === match.id)?.description || 'Explore this suggested career.',
      reasons: Array.isArray(match.reasons) ? match.reasons : []
    })));
    showScreen(6); return;
  }
  showScreen(0);
}

initialiseOnboarding();
