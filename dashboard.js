const dashboardStorage = {
  getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { window.localStorage.setItem(key, value); } catch {} }
};
async function dashboardCall(method, ...args) {
  try {
    const result = await window.careerAuth?.[method]?.(...args);
    if (result && typeof result === 'object') return result;
  } catch {}
  return { data: null, error: { message: "We couldn't reach CareerKraft. Check your connection and try again." } };
}
/* =========================================
   CAREERKRAFT DASHBOARD
========================================= */


const $ =
  selector =>
    document.querySelector(selector);


/* =========================================
   ELEMENTS
========================================= */

const dashboardStatus =
  $("#dashboard-status");
const skillsTotal = document.getElementById("skills-total");
const skillsEmpty = document.getElementById("skills-empty");
const skillsList = document.getElementById("skills-list");
const skillsCardFooter = document.getElementById("skills-card-footer");
const skillsVerificationTotal = document.getElementById("skills-verification-total");
const viewAllSkillsButton = document.getElementById("view-all-skills-button");
let pendingServerLevelProgression = null;
let pendingServerLevelKey = null;

const dashboardName =
  $("#dashboard-name");

const dashboardAvatar =
  $("#dashboard-avatar");

const careerTitle =
  $("#dashboard-career-title");

const progressPercent =
  $("#roadmap-progress-percent");

const progressRing =
  $("#roadmap-progress-ring");

const completedStepCount =
  $("#completed-step-count");

const totalStepCount =
  $("#total-step-count");

const phaseCount =
  $("#phase-count");

const totalTime =
  $("#roadmap-total-time");

const completedStat =
  $("#dashboard-completed");

const evidenceStepCount =
  $("#evidence-step-count");

const nextStepType =
  $("#next-step-type");

const nextStepTitle =
  $("#next-step-title");

const nextStepDescription =
  $("#next-step-description");

const nextStepTime =
  $("#next-step-time");

const nextStepEvidence =
  $("#next-step-evidence");

const startNextStepButton =
  $("#start-next-step-button");

const roadmapPhases =
  $("#roadmap-phases");

const counterCompleted =
  $("#roadmap-counter-completed");

const counterTotal =
  $("#roadmap-counter-total");

const viewCareerButton =
  $("#view-career-button");

const exploreCareerButton =
  $("#career-explore-button");

const themeToggle =
  $("#dashboard-theme-toggle");

const logoutButton =
  $("#dashboard-logout-button");


let currentRoadmap = null;
let currentDashboardUser = null;
let currentRoadmapJourney = null;
let loadedSkillLevels = null;


/* =========================================
   STATUS
========================================= */

function setStatus(
  message,
  error = false
) {

  if (!dashboardStatus) {
    return;
  }


  document.getElementById("dashboard-retry")?.remove();
  dashboardStatus.textContent =
    message;


  dashboardStatus.hidden =
    !message;


  dashboardStatus.classList.toggle(
    "is-error",
    error
  );

}


function showDashboardRecovery(label, action) {
  document.getElementById('dashboard-retry')?.remove();
  const button = document.createElement('button');
  button.id = 'dashboard-retry';
  button.type = 'button';
  button.className = 'secondary-button page-retry-button';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Trying again...';
    try { await action(); } finally { if (button.isConnected) { button.disabled = false; button.textContent = label; } }
  });
  dashboardStatus?.after(button);
}

/* =========================================
   THEME
========================================= */

function applyTheme(theme) {

  const value =
    theme === "dark"
      ? "dark"
      : "light";


  document.documentElement
    .dataset.theme =
      value;


  dashboardStorage.setItem(
    "careerkraft-theme",
    value
  );


  if (themeToggle) {

    const next =
      value === "dark"
        ? "light"
        : "dark";


    themeToggle.setAttribute(
      "aria-label",
      `Switch to ${next} mode`
    );


    themeToggle.setAttribute(
      "title",
      `Switch to ${next} mode`
    );

    themeToggle.setAttribute(
      "aria-pressed",
      String(value === "light")
    );

  }

}


themeToggle?.addEventListener(
  "click",
  () => {

    const next =
      document.documentElement
        .dataset.theme === "dark"
        ? "light"
        : "dark";


    applyTheme(next);

  }
);


/* =========================================
   USER
========================================= */

async function loadUser() {

  const auth =
    window.careerAuth;


  if (!auth) {

    showRoadmapUnavailable(
      "CareerKraft could not connect to your account.",
      "Account unavailable"
    );

    showDashboardRecovery("Try again", initialiseDashboard);
    return false;
  }

  const {
    data,
    error
  } =
    await dashboardCall('getSession');


  if (error) {
    showRoadmapUnavailable(error.message || "We couldn't check your sign-in.", "Account unavailable");
    showDashboardRecovery("Try again", initialiseDashboard);
    return false;
  }
  if (!data?.session?.user) {

    window.location.assign(
      "auth.html"
    );

    return false;

  }


  const user =
    data.session.user;
  currentDashboardUser = user;


  const name =
    user.display_name ||
    user.name ||
    user.email?.split("@")[0] ||
    "there";


  if (dashboardName) {

    dashboardName.textContent =
      name;

  }


  if (dashboardAvatar) {

    dashboardAvatar.textContent =
      String(name)
        .trim()
        .charAt(0)
        .toUpperCase() || "C";

    if (typeof user.avatar_url === "string" && /^\/api\/settings\/avatar(?:\?|$)/.test(user.avatar_url)) {
      const photo = document.createElement("img");
      photo.src = user.avatar_url;
      photo.alt = "";
      photo.addEventListener("error", () => photo.remove(), { once: true });
      dashboardAvatar.append(photo);
    }

  }


  return true;

}


/* =========================================
   ROADMAP
========================================= */

function showRoadmapUnavailable(message, title = "Choose a career", noCareer = false) {
  if (careerTitle && !currentRoadmap) careerTitle.textContent = title;
  if (nextStepTitle) nextStepTitle.textContent = "Your roadmap is not ready yet";
  if (nextStepDescription) nextStepDescription.textContent = message;
  if (nextStepTime) nextStepTime.textContent = '\u2014';
  for (const node of [progressPercent, completedStepCount, totalStepCount, phaseCount, totalTime, completedStat, evidenceStepCount, counterCompleted, counterTotal]) {
    if (node) node.textContent = '\u2014';
  }
  if (nextStepType) nextStepType.textContent = noCareer ? 'Get started' : 'Unavailable';
  const levelBadge = document.getElementById('roadmap-current-level-badge');
  if (levelBadge) levelBadge.textContent = noCareer ? 'Choose your career first' : 'Pathway unavailable';
  const levelMessageTitle = document.getElementById('roadmap-level-message-title');
  const levelMessageText = document.getElementById('roadmap-level-message-text');
  if (levelMessageTitle) levelMessageTitle.textContent = noCareer ? 'Start your career journey' : 'Your pathway could not be loaded';
  if (levelMessageText) levelMessageText.textContent = message;
  const levels = document.getElementById('roadmap-levels');
  if (levels) levels.hidden = true;
  if (nextStepEvidence) nextStepEvidence.hidden = true;
  if (startNextStepButton) startNextStepButton.disabled = true;
  if (roadmapPhases) {
    roadmapPhases.replaceChildren();
    const notice = document.createElement("p");
    notice.className = "roadmap-loading";
    notice.textContent = message;
    roadmapPhases.append(notice);
  }
  setStatus(message, !noCareer);
  showDashboardRecovery(noCareer ? 'Find my career matches' : 'Try again', noCareer
    ? () => window.location.assign('onboarding.html?view=matches') : loadRoadmap);
}

async function loadRoadmap() {
  roadmapPhases?.setAttribute('aria-busy', 'true');
  if (startNextStepButton) startNextStepButton.disabled = true;
  try {
    let { data, error } = await dashboardCall('request', "roadmap");
    if (error) throw new Error(error.message || "We couldn't load your roadmap.");
    const selectedCareer = data?.selectedCareer;
    if (selectedCareer) {
      currentRoadmap = { career: selectedCareer };
      if (careerTitle) careerTitle.textContent = selectedCareer.title;
    }
    if (!data?.roadmap && selectedCareer) {
      setStatus("Preparing your career roadmap...");
      const builder = showLumiaRoadmapBuilder();
      let created;
      try {
        created = await dashboardCall('request', "roadmap", {});
      } finally {
        builder.close();
      }
      if (created.error) throw new Error(created.error.message || "We couldn't create your roadmap.");
      ({ data, error } = await dashboardCall('request', "roadmap"));
      if (error) throw new Error(error.message || "We couldn't load your roadmap.");
    }
    if (!data?.roadmap) {
      showRoadmapUnavailable(selectedCareer
        ? "We couldn't load your roadmap. Please refresh to try again."
        : "Choose a career from your matches to see your personalised roadmap.", "Choose a career", !selectedCareer);
      return;
    }
    currentRoadmap = data.roadmap;
    currentRoadmapJourney = data.journey || null;
    renderRoadmap(currentRoadmap);
    renderRoadmapJourney(data.journey, currentRoadmap);
    if (window.location.hash === '#skills' && loadedSkillLevels) renderLevelSkillCharts(loadedSkillLevels);
    pendingServerLevelProgression = data.pendingLevelProgression || null;
    pendingServerLevelKey = pendingServerLevelProgression ? `careerkraft-unlock-seen:${currentRoadmap.id}:${pendingServerLevelProgression.level}:${pendingServerLevelProgression.replayId || 'default'}` : null;
  } catch (error) {
    showRoadmapUnavailable(error.message || "We couldn't load your roadmap. Please try again.");
  } finally { roadmapPhases?.setAttribute('aria-busy', 'false'); }
}


/* =========================================
   MAIN RENDER
========================================= */

function renderRoadmapJourney(journey, roadmap = currentRoadmap || {}) {
  const levels = document.getElementById('roadmap-levels');
  if (levels) levels.hidden = false;
  const names = ['beginner', 'intermediate', 'advanced'];
  const current = journey?.currentLevel || roadmap.currentLevel || 'beginner';
  const title = current.charAt(0).toUpperCase() + current.slice(1);
  const badge = document.getElementById('roadmap-current-level-badge');
  if (!badge) return;
  badge.textContent = journey?.pathwayCompleted ? 'Pathway completed \u2713' : `${title} \u00b7 You are here`;
  for (const [index, level] of names.entries()) {
    const stats = journey?.levels?.find(item => item.id === level);
    const completed = stats?.status === 'completed';
    const active = stats ? stats.status === 'current' : level === current && !completed;
    const state = completed ? 'completed' : active ? 'current' : 'locked';
    const item = document.getElementById(`roadmap-level-${level}`);
    item.classList.remove('locked', 'current', 'completed');
    item.classList.add(state);
    if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    document.getElementById(`roadmap-level-${level}-icon`).textContent = completed ? '\u2713' : active ? String(index + 1) : '\uD83D\uDD12';
    document.getElementById(`roadmap-level-${level}-status`).textContent = completed ? 'Completed' : active ? 'You are here' : 'Locked';
    const percent = stats?.percent ?? (active ? roadmap.progress : 0);
    document.getElementById(`roadmap-level-${level}-progress`).style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    document.getElementById(`roadmap-level-${level}-progress-text`).textContent = state === 'locked' && !stats?.totalSteps
      ? `Unlocks after ${index === 1 ? 'Beginner' : 'Intermediate'}`
      : `${stats?.completedSteps ?? roadmap.completedSteps ?? 0} / ${stats?.totalSteps ?? roadmap.totalSteps ?? 0} complete`;
  }
  const finished = journey?.pathwayCompleted;
  const levelFinished = journey?.levels?.find(item => item.id === current)?.status === 'completed';
  document.getElementById('roadmap-level-message-title').textContent = finished ? 'Career pathway completed' : levelFinished ? 'Level complete — your next chapter awaits' : `${title} pathway active`;
  document.getElementById('roadmap-level-message-text').textContent = finished
    ? 'You completed Beginner, Intermediate and Advanced. Your verified skills and completed activities are now part of your CareerKraft profile.'
    : levelFinished ? 'Your completed work is saved. Lumia will prepare your next level when generation is available.'
    : current === 'beginner' ? 'Complete your Beginner activities and Lumia will build your personalised Intermediate pathway.'
    : current === 'intermediate' ? 'Lumia created this level using your progress and verified skills. Complete it to unlock Advanced.'
    : 'This is your final CareerKraft level. Complete the advanced challenges and portfolio work to finish your pathway.';
}

function renderRoadmap(
  roadmap
) {

  setStatus("");


  if (careerTitle) {

    careerTitle.textContent =
      roadmap.career.title;

  }


  renderProgress(
    roadmap
  );


  renderStats(
    roadmap
  );


  renderNextStep(
    roadmap.nextStep
  );


  renderPhases(
    roadmap.phases
  );

}


/* =========================================
   PROGRESS
========================================= */

function renderProgress(
  roadmap
) {

  const progress =
    Number(
      roadmap.progress || 0
    );


  if (progressPercent) {

    progressPercent.textContent =
      `${progress}%`;

  }


  if (completedStepCount) {

    completedStepCount.textContent =
      roadmap.completedSteps;

  }


  if (totalStepCount) {

    totalStepCount.textContent =
      roadmap.totalSteps;

  }


  if (counterCompleted) {

    counterCompleted.textContent =
      roadmap.completedSteps;

  }


  if (counterTotal) {

    counterTotal.textContent =
      roadmap.totalSteps;

  }


  /*
    SVG circle circumference:
    2 × π × 52 ≈ 326.73
  */

  if (progressRing) {

    const circumference =
      326.73;


    const offset =
      circumference -
      (
        progress / 100
      ) *
      circumference;


    progressRing.style
      .strokeDashoffset =
        offset;

  }

}


/* =========================================
   STATS
========================================= */

function renderStats(
  roadmap
) {

  const phases =
    Array.isArray(
      roadmap.phases
    )
      ? roadmap.phases
      : [];


  const steps =
    phases.flatMap(
      phase =>
        Array.isArray(
          phase.steps
        )
          ? phase.steps
          : []
    );


  if (phaseCount) {

    phaseCount.textContent =
      phases.length;

  }


  if (completedStat) {

    completedStat.textContent =
      roadmap.completedSteps;

  }


  const totalMinutes =
    steps.reduce(
      (sum, step) =>
        sum +
        Number(
          step.estimatedMinutes || 0
        ),
      0
    );


  if (totalTime) {

    totalTime.textContent =
      formatMinutes(
        totalMinutes
      );

  }


  const evidenceCount =
    steps.filter(
      step =>
        step.evidenceRequired
    ).length;


  if (evidenceStepCount) {

    evidenceStepCount.textContent =
      evidenceCount;

  }

}


/* =========================================
   NEXT STEP
========================================= */

function renderNextStep(
  step
) {

  if (!step) {

    if (nextStepTitle) {

      nextStepTitle.textContent =
        "Roadmap complete";

    }


    if (nextStepDescription) {

      nextStepDescription.textContent =
        "You've completed every step in this roadmap.";

    }


    if (nextStepTime) {

      nextStepTime.textContent =
        "Done";

    }


    if (nextStepType) {

      nextStepType.textContent =
        "Complete";

    }


    if (nextStepEvidence) {

      nextStepEvidence.hidden =
        true;

    }


    if (startNextStepButton) {

      startNextStepButton.disabled =
        true;


      startNextStepButton.textContent =
        "Roadmap complete ✓";

    }


    return;

  }


  if (nextStepTitle) {

    nextStepTitle.textContent =
      step.title;

  }


  if (nextStepDescription) {

    nextStepDescription.textContent =
      step.description;

  }


  if (nextStepTime) {

    nextStepTime.textContent =
      formatMinutes(
        step.estimatedMinutes
      );

  }


  if (nextStepType) {

    nextStepType.textContent =
      formatActivityType(
        step.activityType
      );

  }


  if (nextStepEvidence) {

    nextStepEvidence.hidden =
      !step.evidenceRequired;

  }


  if (startNextStepButton) {

    startNextStepButton.disabled =
      false;
    startNextStepButton.textContent = ["submitted", "review_required"].includes(step.evidenceStatus)
      ? "Review pending \u00b7 View evidence"
      : "Start this step \u2192";


    startNextStepButton.dataset
      .stepId =
        step.id;

  }

}


/* =========================================
   PHASES
========================================= */

function renderPhases(
  phases
) {

  if (!roadmapPhases) {
    return;
  }


  if (
    !Array.isArray(phases) ||
    phases.length === 0
  ) {

    roadmapPhases.innerHTML = `

      <div class="roadmap-loading">

        <p>
          No roadmap phases are available.
        </p>

      </div>

    `;

    return;

  }


  let currentStepFound = false;

  roadmapPhases.innerHTML =
    phases
      .map(phase => {
        const steps = Array.isArray(phase.steps) ? phase.steps : [];
        const renderedPhase = renderPhase(phase, currentStepFound);

        if (!currentStepFound && steps.some(step => step.status !== "completed")) {
          currentStepFound = true;
        }

        return renderedPhase;
      })
      .join("");

}


/* =========================================
   SINGLE PHASE
========================================= */

function renderPhase(
  phase,
  hasCurrentStep
) {

  const steps =
    Array.isArray(
      phase.steps
    )
      ? phase.steps
      : [];


  const completed =
    steps.filter(
      step =>
        step.status ===
        "completed"
    ).length;


  const phaseNumber =
    String(
      phase.phaseNumber
    ).padStart(
      2,
      "0"
    );


  return `

    <article class="roadmap-phase">

      <header class="roadmap-phase-header">

        <span class="phase-number">

          ${escapeHTML(
            phaseNumber
          )}

        </span>


        <div>

          <small>
            PHASE ${escapeHTML(
              phase.phaseNumber
            )}
          </small>

          <h3>

            ${escapeHTML(
              phase.title
            )}

          </h3>

        </div>


        <span class="phase-progress">

          ${completed}
          /
          ${steps.length}

          complete

        </span>

      </header>


      <div class="roadmap-step-list">

        ${steps
          .map((step, index) => {
            const isCurrentStep =
              !hasCurrentStep &&
              steps
                .slice(0, index)
                .every(previousStep => previousStep.status === "completed") &&
              step.status !== "completed";

            hasCurrentStep ||= isCurrentStep;

            return renderStep(step, isCurrentStep, index + 1);
          })
          .join("")}

      </div>

    </article>

  `;

}


/* =========================================
   SINGLE STEP
========================================= */

function renderStep(
  step,
  isCurrentStep = false,
  position = 1
) {

  const status =
    validStatus(
      step.status
    );


  const statusSymbol = status === "completed" ? "&#10003;" : String(position).padStart(2, "0");

  const reviewPending = status !== "completed" && ["submitted", "review_required"].includes(step.evidenceStatus);
  const stageLabel =
    status === "completed"
      ? "COMPLETE"
      : reviewPending
        ? "Review pending"
      : isCurrentStep
        ? "YOUR NEXT STEP"
        : "UP NEXT";


  return `

    <button
      class="roadmap-step ${escapeHTML(status)}${reviewPending ? " review-pending" : ""}${isCurrentStep ? " is-current" : ""}"
      type="button"
      data-step-id="${escapeHTML(
        step.id
      )}"
      aria-expanded="${isCurrentStep}"
    >

      <span class="step-platform">
        <span class="step-status" aria-hidden="true">${statusSymbol}</span>
        <span class="step-stage">${stageLabel}</span>
        <span class="step-copy">
          <strong>${escapeHTML(step.title)}</strong>
          <span class="step-meta">
            <span>${escapeHTML(formatMinutes(step.estimatedMinutes))}</span>
            <span>${escapeHTML(formatActivityType(step.activityType))}</span>
            ${step.evidenceRequired ? '<span class="evidence-chip">Evidence</span>' : ""}
          </span>
        </span>
        <span class="step-chevron" aria-hidden="true">&#8964;</span>
        <span class="step-details"${isCurrentStep ? "" : " hidden"}>
          ${escapeHTML(step.description || "Explore this step to find out what you will work on.")}
        </span>
      </span>

    </button>

  `;

}


/* =========================================
   START NEXT STEP
========================================= */

roadmapPhases
  ?.addEventListener(
    "click",
    event => {
      const selectedStep = event.target.closest(".roadmap-step");

      if (!selectedStep || !roadmapPhases.contains(selectedStep)) {
        return;
      }

      roadmapPhases.querySelectorAll(".roadmap-step").forEach(step => {
        const isExpanded = step === selectedStep && step.getAttribute("aria-expanded") !== "true";
        step.setAttribute("aria-expanded", String(isExpanded));
        step.classList.toggle("is-expanded", isExpanded);
        const details = step.querySelector(".step-details");
        if (details) details.hidden = !isExpanded;
      });
    }
  );


startNextStepButton?.addEventListener("click", async () => {
  const step = currentRoadmap?.nextStep;
  if (!step) return;

  startNextStepButton.disabled = true;
  startNextStepButton.textContent = "Starting...";

  const { data, error } = await dashboardCall('request',
    `roadmap/steps/${step.id}/start`, {}
  );
  if (error) {
    startNextStepButton.disabled = false;
    startNextStepButton.textContent = "Start this step \u2192";
    setStatus(error.message || "We couldn't start this step.", true);
    return;
  }

  window.location.assign(
    `activity.html?step=${encodeURIComponent(step.id)}`
  );
});

/* =========================================
   OPEN CAREER
========================================= */

function openCareer() {

  const id =
    currentRoadmap
      ?.career
      ?.id;


  if (!id) {
    window.location.assign("onboarding.html?view=matches");
    return;
  }


  window.location.assign(
    `career.html?career=${encodeURIComponent(
      id
    )}`
  );

}


viewCareerButton
  ?.addEventListener(
    "click",
    openCareer
  );


exploreCareerButton
  ?.addEventListener(
    "click",
    openCareer
  );


/* =========================================
   LOG OUT
========================================= */

logoutButton
  ?.addEventListener(
    "click",
    async () => {

      logoutButton.disabled =
        true;
      const logoutLabel = logoutButton.textContent;
      logoutButton.textContent = 'Logging out...';


      const {
        error
      } =
        await dashboardCall('signOut');


      if (error) {
        logoutButton.textContent = logoutLabel;

        logoutButton.disabled =
          false;


        setStatus(
          error.message ||
          "We couldn't log you out.",
          true
        );


        return;

      }


      window.location.replace(
        "auth.html"
      );

    }
  );


/* =========================================
   FORMATTERS
========================================= */

function formatMinutes(
  minutes
) {

  const value =
    Number(minutes || 0);


  if (value <= 0) {

    return "Flexible";

  }


  if (value < 60) {

    return `${value} min`;

  }


  const hours =
    Math.floor(
      value / 60
    );


  const remainder =
    value % 60;


  if (remainder === 0) {

    return `${hours} hr`;

  }


  return `${hours} hr ${remainder} min`;

}


function formatActivityType(
  value
) {

  if (
    typeof value !== "string" ||
    !value
  ) {

    return "Activity";

  }


  return value
    .replaceAll(
      "_",
      " "
    )
    .replace(
      /\b\w/g,
      letter =>
        letter.toUpperCase()
    );

}


function validStatus(
  status
) {

  if (
    status === "completed" ||
    status === "in_progress"
  ) {

    return status;

  }


  return "not_started";

}


/* =========================================
   ESCAPE HTML
========================================= */

function escapeHTML(value) {

  return String(
    value ?? ""
  )

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


/* =========================================
   INITIALISE
========================================= */

/* =========================================
   LOAD VERIFIED SKILLS
========================================= */
const originalSkillsEmpty = skillsEmpty?.innerHTML || '';
let skillsLoadRun = 0;
async function loadSkills() {
  const run = ++skillsLoadRun;
  if (skillsTotal) skillsTotal.textContent = '\u2014';
  if (skillsCardFooter) skillsCardFooter.hidden = true;
  if (skillsList) { skillsList.hidden = true; skillsList.setAttribute('aria-busy', 'true'); }
  if (skillsEmpty) { skillsEmpty.hidden = false; skillsEmpty.textContent = 'Loading verified skills...'; }
  try {
    const { data, error } = await dashboardCall('request', "skills");
    if (run !== skillsLoadRun) return;
    if (error || !Array.isArray(data?.skills)) throw new Error(error?.message || "We couldn't load your verified skills.");
    if (skillsEmpty) skillsEmpty.innerHTML = originalSkillsEmpty;
    const skills = Array.isArray(data?.skills) ? data.skills : [];
    loadedSkillLevels = data?.levels || [];
    const summary = data?.summary || { totalSkills: 0, totalVerifications: 0 };
    skillsTotal.textContent = summary.totalSkills;
    skillsVerificationTotal.textContent = `${summary.totalVerifications} ${summary.totalVerifications === 1 ? "activity verification" : "activity verifications"}`;
    skillsEmpty.hidden = skills.length !== 0;
    skillsList.hidden = skills.length === 0;
    skillsCardFooter.hidden = skills.length === 0;
    skillsList.replaceChildren();
    if (window.location.hash === '#skills') {
      skillsEmpty.hidden = true;
      skillsList.hidden = false;
      renderLevelSkillCharts(data?.levels || []);
      return;
    }
    for (const skill of window.location.hash === '#skills' ? skills : skills.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "skill-item";
      const index = skillsList.children.length;
      item.dataset.badgeColor = String(index % 4);
      const label = `Verified through ${skill.verifiedCount} ${skill.verifiedCount === 1 ? "activity" : "activities"}`;
      item.setAttribute("aria-label", `${skill.name}. ${label}`);
      item.title = `${skill.name} · ${label}`;
      const art = index % 4 === 3
        ? '<path class="sticker-beam" d="M78 137 L62 207 Q120 224 178 207 L162 137 Z"/><path class="sticker-dome" d="M78 119 Q78 45 120 45 Q162 45 162 119 Z"/><path class="sticker-saucer" d="M28 127 Q120 77 212 127 Q185 163 120 163 Q55 163 28 127 Z"/><circle class="sticker-light" cx="74" cy="132" r="7"/><circle class="sticker-light" cx="120" cy="140" r="7"/><circle class="sticker-light" cx="166" cy="132" r="7"/>'
        : '<circle class="sticker-planet" cx="120" cy="120" r="94"/><path class="sticker-contour" d="M62 75 Q94 37 146 49 M48 109 Q86 68 164 69 M49 149 Q103 106 189 107 M72 181 Q124 151 191 143"/><ellipse class="sticker-orbit" cx="120" cy="120" rx="108" ry="30" transform="rotate(-30 120 120)"/><path class="sticker-cloud" d="M153 43 Q155 25 170 32 Q185 20 190 38 Q209 41 199 53 L164 63 Z M34 171 Q34 156 48 158 Q55 144 68 156 Q83 157 79 171 L48 184 Z"/>';
      item.innerHTML = `<svg class="skill-badge sticker-badge" viewBox="0 0 240 240" aria-hidden="true">
        ${art}
        <path class="sticker-star" d="M194 54 L198 63 L209 64 L201 71 L204 82 L194 76 L185 82 L187 71 L179 64 L190 63 Z"/>
        <path class="sticker-star small-star" d="M35 92 L39 100 L48 101 L41 107 L43 116 L35 111 L27 116 L29 107 L22 101 L31 100 Z"/>
        <foreignObject x="58" y="82" width="124" height="93"><div xmlns="http://www.w3.org/1999/xhtml" class="sticker-skill-name"></div></foreignObject>
      </svg>
      <div class="skill-item-copy sticker-copy"><strong></strong><span></span></div>`;
      item.querySelector('.sticker-skill-name').textContent = skill.name;
      item.querySelector('.sticker-skill-name').style.fontSize = String(skill.name).length > 30 ? '13px' : String(skill.name).length > 20 ? '16px' : '20px';
      item.querySelector("strong").textContent = skill.name;
      item.querySelector(".skill-item-copy span").textContent = label;
      bindSkillTrigger(item, skill);
      skillsList.appendChild(item);
    }
  } catch (error) {
    if (run !== skillsLoadRun || !skillsEmpty) return;
    skillsEmpty.replaceChildren();
    const message = document.createElement('p');
    message.textContent = error.message || "We couldn't load your verified skills.";
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'secondary-button page-retry-button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => { void loadSkills(); });
    skillsEmpty.append(message, retry);
    skillsEmpty.hidden = false;
  } finally {
    if (run === skillsLoadRun) skillsList?.setAttribute('aria-busy', 'false');
  }
}

/* =========================================
   SKILL DETAIL DRAWER
========================================= */

const skillDetailBackdrop = document.getElementById('skill-detail-backdrop');
const skillDetailDrawer = document.getElementById('skill-detail-drawer');
const skillDetailClose = document.getElementById('skill-detail-close');
const skillDetailLoading = document.getElementById('skill-detail-loading');
const skillDetailContent = document.getElementById('skill-detail-content');
const skillDetailError = document.getElementById('skill-detail-error');
const skillDetailErrorMessage = document.getElementById('skill-detail-error-message');
const skillDetailRetry = document.getElementById('skill-detail-retry');
const skillDetailName = document.getElementById('skill-detail-name');
const skillDetailSummary = document.getElementById('skill-detail-summary');
const skillDetailVerificationCount = document.getElementById('skill-detail-verification-count');
const skillDetailHighestLevel = document.getElementById('skill-detail-highest-level');
const skillHistoryCount = document.getElementById('skill-history-count');
const skillVerificationHistory = document.getElementById('skill-verification-history');
const skillHistoryEmpty = document.getElementById('skill-history-empty');
const skillFirstVerified = document.getElementById('skill-first-verified');
const skillLastVerified = document.getElementById('skill-last-verified');
const skillLumiaTitle = document.getElementById('skill-lumia-title');
const skillLumiaMessage = document.getElementById('skill-lumia-message');
const skillVerificationTemplate = document.getElementById('skill-verification-template');
const skillLevels = ['beginner', 'intermediate', 'advanced'];
let skillDetailRequest = 0;
let currentDetailSkillId = null;
let skillDetailOpener = null;
let skillDepthAnimation = null;
let skillDepthRun = 0;

function skillCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function formatSkillLevel(value) {
  const level = String(value || '').toLowerCase();
  return skillLevels.includes(level) ? level.charAt(0).toUpperCase() + level.slice(1) : 'Not recorded';
}

function skillDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  const date = new Date(Number.isFinite(number) ? number : value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

function formatSkillDate(value) {
  return skillDate(value)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) || '\u2014';
}

function setSkillDate(element, value) {
  if (!element) return;
  const date = skillDate(value);
  element.textContent = formatSkillDate(value);
  if (date) element.setAttribute('datetime', date.toISOString());
  else element.removeAttribute('datetime');
}

function pluralise(amount, singular, plural) {
  return amount === 1 ? singular : plural || (singular === 'activity' ? 'activities' : `${singular}s`);
}

function skillEvidenceDepth(evidenceDepth) {
  const counts = Object.fromEntries(skillLevels.map(level => [level, skillCount(evidenceDepth?.counts?.[level])]));
  return { counts, highestLevel: [...skillLevels].reverse().find(level => counts[level] > 0) || null };
}

function cancelSkillDepthAnimation() {
  skillDepthRun += 1;
  if (skillDepthAnimation !== null) cancelAnimationFrame(skillDepthAnimation);
  skillDepthAnimation = null;
}

function renderEvidenceDepth(evidenceDepth) {
  cancelSkillDepthAnimation();
  const run = skillDepthRun;
  const { counts, highestLevel } = skillEvidenceDepth(evidenceDepth);
  const maxCount = Math.max(1, ...Object.values(counts));
  const bars = [];
  for (const level of skillLevels) {
    const count = counts[level];
    const card = document.getElementById(`skill-depth-${level}`);
    const label = document.getElementById(`skill-depth-${level}-count`);
    const bar = document.getElementById(`skill-depth-${level}-bar`);
    if (label) label.textContent = `${count} ${pluralise(count, 'demonstration')}`;
    card?.classList.toggle('has-evidence', count > 0);
    card?.classList.toggle('is-highest', count > 0 && level === highestLevel);
    if (bar) {
      bar.style.width = '0%';
      bars.push([bar, count > 0 ? Math.max(24, Math.round(count / maxCount * 100)) : 0]);
    }
  }
  skillDepthAnimation = requestAnimationFrame(() => {
    if (run !== skillDepthRun) return;
    for (const [bar, percentage] of bars) bar.style.width = `${percentage}%`;
    skillDepthAnimation = null;
  });
}

function skillEvidenceFileURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.username || url.password || url.search || url.hash ||
        !/^\/api\/evidence\/[1-9]\d*\/file$/.test(url.pathname)) return null;
    return url.pathname;
  } catch { return null; }
}

function renderSkillHistory(verifications) {
  if (!skillVerificationHistory || !skillVerificationTemplate) return;
  skillVerificationHistory.replaceChildren();
  const items = Array.isArray(verifications) ? verifications.filter(item => item && typeof item === 'object') : [];
  if (skillHistoryCount) skillHistoryCount.textContent = `${items.length} ${pluralise(items.length, 'activity')}`;
  if (skillHistoryEmpty) skillHistoryEmpty.hidden = items.length > 0;
  for (const verification of items) {
    const activity = verification.activity || {};
    const career = verification.career || {};
    const evidence = verification.evidence || {};
    const fragment = skillVerificationTemplate.content.cloneNode(true);
    const text = (selector, value) => { fragment.querySelector(selector).textContent = String(value || ''); };
    text('[data-verification-activity-title]', activity.title || verification.activity_title || 'CareerKraft activity');
    text('[data-verification-career]', career.title || verification.career_title || 'CareerKraft pathway');
    text('[data-verification-level]', formatSkillLevel(activity.level || verification.level));
    text('[data-verification-activity-type]', activity.type || verification.activity_type || 'Activity');
    setSkillDate(fragment.querySelector('[data-verification-date]'), verification.verifiedAt || evidence.reviewedAt);

    const fileName = typeof evidence.fileName === 'string' ? evidence.fileName.trim() : '';
    const fileURL = skillEvidenceFileURL(evidence.fileUrl);
    if (fileURL && fileName) {
      const link = fragment.querySelector('[data-verification-file-link]');
      link.textContent = fileName;
      link.href = fileURL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.hidden = false;
    }
    const writtenText = typeof evidence.textContent === 'string' ? evidence.textContent.trim() : '';
    if (writtenText) {
      fragment.querySelector('[data-verification-written-work]').hidden = false;
      text('[data-verification-written-text]', writtenText);
    }
    if ((!fileURL || !fileName) && !writtenText) {
      fragment.querySelector('[data-verification-evidence-unavailable]').hidden = false;
    }
    const feedback = evidence.feedback ?? verification.feedback;
    if (typeof feedback === 'string' && feedback.trim()) {
      fragment.querySelector('[data-verification-review]').hidden = false;
      text('[data-verification-feedback]', feedback.trim());
    }
    skillVerificationHistory.append(fragment);
  }
}

function renderSkillInsight(skill) {
  if (!skillLumiaTitle || !skillLumiaMessage) return;
  const { highestLevel } = skillEvidenceDepth(skill?.evidenceDepth);
  const insight = highestLevel === 'advanced'
    ? ['Advanced evidence is building', "You've demonstrated this skill in Advanced CareerKraft activities. Keep building varied evidence across different tasks and projects."]
    : highestLevel === 'intermediate'
      ? ["You're building stronger evidence", "You've now demonstrated this skill in Intermediate activities. Advanced challenges can add another layer of evidence."]
      : highestLevel === 'beginner'
        ? ['A foundation is forming', "You've started demonstrating this skill through Beginner activities. Future roadmap levels can provide stronger and more varied evidence."]
        : ['Build your evidence history', 'Recorded activity verifications will show where and how you have demonstrated this skill.'];
  skillLumiaTitle.textContent = insight[0];
  skillLumiaMessage.textContent = insight[1];
}

function openSkillDrawer(trigger) {
  if (!skillDetailDrawer) return false;
  const opener = trigger || document.activeElement;
  if (opener?.isConnected && opener !== document.body && opener !== document.documentElement && !skillDetailDrawer.contains(opener)) {
    skillDetailOpener?.setAttribute('aria-expanded', 'false');
    skillDetailOpener = opener;
  }
  skillDetailDrawer.setAttribute('aria-hidden', 'false');
  if (!skillDetailDrawer.open) {
    if (typeof skillDetailDrawer.showModal === 'function') skillDetailDrawer.showModal();
    else {
      skillDetailDrawer.setAttribute('open', '');
      skillDetailDrawer.setAttribute('role', 'dialog');
      skillDetailDrawer.setAttribute('aria-modal', 'true');
      if (skillDetailBackdrop) { skillDetailBackdrop.hidden = false; skillDetailBackdrop.classList.add('is-visible'); }
    }
  }
  skillDetailDrawer.classList.add('is-open');
  skillDetailOpener?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('skill-detail-open');
  skillDetailDrawer.scrollTop = 0;
  skillDetailClose?.focus({ preventScroll: true });
  return true;
}

function finishSkillDrawerClose() {
  skillDetailRequest += 1;
  currentDetailSkillId = null;
  cancelSkillDepthAnimation();
  skillDetailDrawer?.classList.remove('is-open');
  skillDetailDrawer?.setAttribute('aria-hidden', 'true');
  skillDetailDrawer?.removeAttribute('aria-busy');
  document.body.classList.remove('skill-detail-open');
  if (skillDetailBackdrop) { skillDetailBackdrop.classList.remove('is-visible'); skillDetailBackdrop.hidden = true; }
  const opener = skillDetailOpener;
  skillDetailOpener = null;
  opener?.setAttribute('aria-expanded', 'false');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

function closeSkillDrawer() {
  if (skillDetailDrawer?.open && typeof skillDetailDrawer.close === 'function') skillDetailDrawer.close();
  else skillDetailDrawer?.removeAttribute('open');
  finishSkillDrawerClose();
}

function resetSkillDetail() {
  if (skillDetailLoading) skillDetailLoading.hidden = false;
  if (skillDetailContent) skillDetailContent.hidden = true;
  if (skillDetailError) skillDetailError.hidden = true;
  if (skillDetailName) skillDetailName.textContent = 'Loading skill...';
  if (skillDetailSummary) skillDetailSummary.textContent = 'Loading your recorded verification history.';
  if (skillDetailVerificationCount) skillDetailVerificationCount.textContent = '\u2014';
  if (skillDetailHighestLevel) skillDetailHighestLevel.textContent = '\u2014';
  setSkillDate(skillFirstVerified, null);
  setSkillDate(skillLastVerified, null);
  renderSkillHistory([]);
  if (skillHistoryEmpty) skillHistoryEmpty.hidden = true;
  renderEvidenceDepth(null);
  renderSkillInsight(null);
  skillDetailDrawer?.setAttribute('aria-busy', 'true');
}

async function openSkillDetail(skillId, trigger) {
  const id = Number(skillId);
  if (!Number.isSafeInteger(id) || id <= 0 || !skillDetailDrawer) return;
  const request = ++skillDetailRequest;
  currentDetailSkillId = id;
  resetSkillDetail();
  if (!openSkillDrawer(trigger)) return;
  if (skillDetailRetry) skillDetailRetry.disabled = true;
  try {
    const { data, error } = await dashboardCall('request', `skills/${id}`);
    if (request !== skillDetailRequest || !skillDetailDrawer.open) return;
    if (error || !data?.skill || typeof data.skill !== 'object' || Array.isArray(data.skill)) {
      throw new Error(error?.message || "CareerKraft couldn't load this skill right now.");
    }
    const skill = data.skill;
    if (skillDetailName) skillDetailName.textContent = String(skill.name || 'Skill');
    if (skillDetailSummary) skillDetailSummary.textContent = 'Demonstrated through your completed and verified CareerKraft activities.';
    if (skillDetailVerificationCount) skillDetailVerificationCount.textContent = String(skillCount(skill.verifiedCount));
    const { highestLevel } = skillEvidenceDepth(skill.evidenceDepth);
    if (skillDetailHighestLevel) skillDetailHighestLevel.textContent = highestLevel ? formatSkillLevel(highestLevel) : '\u2014';
    renderEvidenceDepth(skill.evidenceDepth);
    renderSkillHistory(skill.verifications);
    setSkillDate(skillFirstVerified, skill.firstVerifiedAt);
    setSkillDate(skillLastVerified, skill.lastVerifiedAt);
    renderSkillInsight(skill);
    if (skillDetailContent) skillDetailContent.hidden = false;
  } catch (error) {
    if (request !== skillDetailRequest || !skillDetailDrawer.open) return;
    if (skillDetailName) skillDetailName.textContent = "Couldn't load skill";
    if (skillDetailErrorMessage) skillDetailErrorMessage.textContent = error?.message || "CareerKraft couldn't load this skill right now.";
    if (skillDetailError) skillDetailError.hidden = false;
  } finally {
    if (request === skillDetailRequest && skillDetailDrawer.open) {
      if (skillDetailLoading) skillDetailLoading.hidden = true;
      if (skillDetailRetry) skillDetailRetry.disabled = false;
      skillDetailDrawer.setAttribute('aria-busy', 'false');
    }
  }
}

function bindSkillTrigger(element, skill) {
  const id = Number(skill?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  element.dataset.skillId = String(id);
  element.setAttribute('aria-label', `View ${String(skill.name || 'skill')} skill details`);
  element.setAttribute('aria-controls', 'skill-detail-drawer');
  element.setAttribute('aria-haspopup', 'dialog');
  element.setAttribute('aria-expanded', 'false');
  if (element.tagName !== 'BUTTON') {
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        void openSkillDetail(id, element);
      }
    });
  }
  element.addEventListener('click', () => { void openSkillDetail(id, element); });
}

skillDetailClose?.addEventListener('click', event => { event.preventDefault(); closeSkillDrawer(); });
skillDetailBackdrop?.addEventListener('click', closeSkillDrawer);
skillDetailDrawer?.addEventListener('cancel', event => { event.preventDefault(); closeSkillDrawer(); });
skillDetailDrawer?.addEventListener('close', () => { if (!skillDetailDrawer.open) finishSkillDrawerClose(); });
skillDetailDrawer?.addEventListener('click', event => {
  if (event.target !== skillDetailDrawer) return;
  const rect = skillDetailDrawer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) closeSkillDrawer();
});
skillDetailRetry?.addEventListener('click', () => { if (currentDetailSkillId) void openSkillDetail(currentDetailSkillId); });
document.addEventListener('keydown', event => {
  if (!skillDetailDrawer?.open) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSkillDrawer(); return; }
  // Keep Tab inside the drawer, including browsers that otherwise focus their toolbar.
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const controls = [...skillDetailDrawer.querySelectorAll('button:not(:disabled), a[href], summary')]
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !skillDetailDrawer.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
});

function showLumiaRoadmapBuilder() {
  const overlay = document.createElement('div');
  overlay.className = 'lumia-builder-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Lumia is building your roadmap');
  overlay.tabIndex = -1;
  overlay.innerHTML = '<div class="lumia-builder-panel"><div class="builder-bubbles" aria-hidden="true"><span></span><span></span><span></span><b>✦</b></div><small>LUMIA AI</small><h2>Building your next chapter</h2><p role="status">Turning your career choice into a clear journey.</p><div class="builder-track" aria-hidden="true"><span></span></div><p class="builder-caption">Foundations · Practice · Projects · Progression</p></div>';
  const previousFocus = document.activeElement;
  document.body.append(overlay);
  document.body.classList.add('lumia-building');
  overlay.focus();
  overlay.addEventListener('keydown', event => { if (event.key === 'Tab') event.preventDefault(); });
  const sound = document.createElement('audio');
  sound.src = 'assets/freesound_community-advertising-futuristic-36121.mp3';
  sound.volume = 0.35;
  sound.loop = true;
  sound.play()?.catch(() => {});
  const stop = () => sound.pause();
  window.addEventListener('pagehide', stop, { once: true });
  return { close() {
    stop();
    window.removeEventListener('pagehide', stop);
    overlay.remove();
    document.body.classList.remove('lumia-building');
    previousFocus?.focus();
  } };
}

let dashboardLoadPending = false;
let dashboardDataLoaded = false;
async function initialiseDashboard() {
  if (dashboardLoadPending) return;
  dashboardLoadPending = true;
  let tutorialReady = false;
  document.querySelector('main')?.setAttribute('aria-busy', 'true');
  updateDashboardView();
  try {
    applyTheme(dashboardStorage.getItem('careerkraft-theme'));
    if (!await loadUser()) return;
    // CV scanning needs the shared account shell, not a new roadmap generation.
    if (['#cv-scanner', '#cv-results'].includes(window.location.hash)) {
      updateDashboardView();
      return;
    }
    await Promise.all([loadRoadmap(), loadSkills()]);
    dashboardDataLoaded = true;
    updateDashboardView();
    await checkPendingLevelTransition();
    tutorialReady = !dashboardStatus?.classList.contains('is-error');
  } finally {
    dashboardLoadPending = false;
    document.querySelector('main')?.setAttribute('aria-busy', 'false');
    if (tutorialReady && currentDashboardUser) window.dispatchEvent(new CustomEvent('careerkraft:dashboard-ready', {
      detail: { user: currentDashboardUser, hasRoadmap: Boolean(currentRoadmap?.phases?.length) }
    }));
  }
}


function renderLevelSkillCharts(levels, journey = currentRoadmapJourney) {
  if (!skillsList) return;
  skillsList.replaceChildren();
  const levelData = Array.isArray(levels) ? levels : [];
  const levelIds = ['beginner', 'intermediate', 'advanced'];
  const svgNS = 'http://www.w3.org/2000/svg';
  const make = (tag, attributes) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  for (const [levelIndex, id] of levelIds.entries()) {
    const level = levelData.find(item => item?.id === id);
    const allSkills = (Array.isArray(level?.skills) ? level.skills : [])
      .filter(skill => skill && typeof skill === 'object' && skillCount(skill.verifiedCount) > 0)
      .slice()
      .sort((first, second) => skillCount(second.verifiedCount) - skillCount(first.verifiedCount));
    const skills = allSkills.slice(0, 6);
    const title = formatSkillLevel(id);
    const previousTitle = levelIndex > 0 ? formatSkillLevel(levelIds[levelIndex - 1]) : '';
    const currentLevelIndex = levelIds.indexOf(journey?.currentLevel || currentRoadmap?.currentLevel);
    const status = Array.isArray(journey?.levels) ? journey.levels.find(item => item?.id === id)?.status : null;
    const pathwayCompleted = journey?.pathwayCompleted || currentRoadmap?.status === 'completed';
    const locked = !skills.length && levelIndex > 0 && !pathwayCompleted &&
      (status === 'locked' || (!status && currentLevelIndex >= 0 && levelIndex > currentLevelIndex));
    const card = document.createElement('article');
    card.className = 'level-skill-chart';
    card.dataset.level = id;
    card.classList.toggle('is-locked', locked);
    card.classList.toggle('is-empty', !skills.length && !locked);
    const header = document.createElement('header');
    header.className = 'level-skill-header';
    const headingGroup = document.createElement('div');
    headingGroup.className = 'level-skill-heading';
    const number = document.createElement('span');
    number.className = 'level-skill-number';
    number.textContent = `LEVEL 0${levelIndex + 1}`;
    const heading = document.createElement('h3');
    heading.textContent = title;
    headingGroup.append(number, heading);
    header.append(headingGroup);
    if (!skills.length) {
      const state = document.createElement('span');
      state.className = 'level-skill-state';
      state.textContent = locked ? 'Locked' : 'Ready to build';
      header.append(state);
    }
    card.append(header);
    if (locked) {
      const unlock = document.createElement('p');
      unlock.className = 'level-skill-unlock';
      unlock.textContent = `Complete ${previousTitle} to unlock`;
      card.append(unlock);
    } else {
      const summary = document.createElement('div');
      summary.className = 'level-skill-summary';
      const verifications = allSkills.reduce((total, skill) => total + skillCount(skill.verifiedCount), 0);
      for (const [count, label] of [
        [allSkills.length, pluralise(allSkills.length, 'skill discovered', 'skills discovered')],
        [verifications, pluralise(verifications, 'total verification')],
        [skills.length, pluralise(skills.length, 'core strength')]
      ]) {
        const stat = document.createElement('span');
        const value = document.createElement('strong');
        value.textContent = String(count);
        stat.append(value, document.createTextNode(label));
        summary.append(stat);
      }
      card.append(summary);
    }
    if (!skills.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'level-skill-placeholder';
      const icon = document.createElement('span');
      icon.className = 'level-skill-lock-icon';
      icon.setAttribute('aria-hidden', 'true');
      if (locked) {
        const lock = make('svg', { viewBox: '0 0 32 32', focusable: 'false' });
        lock.append(make('rect', { x: 7, y: 14, width: 18, height: 14, rx: 4 }));
        lock.append(make('path', { d: 'M10 14V9a6 6 0 0 1 12 0v5M16 20v3' }));
        icon.append(lock);
      } else {
        icon.textContent = '\u2726';
      }
      const emptyTitle = document.createElement('h4');
      emptyTitle.textContent = locked
        ? id === 'intermediate' ? 'Build stronger evidence' : 'Build independent evidence'
        : 'Ready for your first evidence';
      const description = document.createElement('p');
      description.textContent = id === 'beginner'
        ? 'Your first activities lay the foundations for your verified skills.'
        : id === 'intermediate'
          ? 'Apply your skills to more challenging activities.'
          : 'Demonstrate your skills through independent, professional-style work.';
      const note = document.createElement('p');
      note.className = 'level-skill-placeholder-note';
      note.textContent = locked
        ? `Complete ${previousTitle} to start building ${title} skills.`
        : `Skills appear here when your ${title} evidence is approved.`;
      placeholder.append(icon, emptyTitle, description, note);
      card.append(placeholder);
      skillsList.append(card);
      continue;
    }
    const svg = make('svg', { viewBox: '0 0 400 360', role: 'img', 'aria-label': `${heading.textContent} skill verification chart` });
    const point = (index, radius) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      return [200 + Math.cos(angle) * radius, 180 + Math.sin(angle) * radius];
    };
    for (const radius of [28, 56, 84, 112]) {
      svg.append(make('polygon', { points: Array.from({ length: 6 }, (_, i) => point(i, radius).join(',')).join(' '), class: 'skill-radar-grid' }));
    }
    for (let i = 0; i < 6; i++) {
      const [x, y] = point(i, 112);
      svg.append(make('line', { x1: 200, y1: 180, x2: x, y2: y, class: 'skill-radar-axis' }));
      if (!skills[i]) continue;
      const [lx, ly] = point(i, 146);
      const text = make('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'skill-radar-label' });
      const words = String(skills[i].name).split(/\s+/);
      const lines = [''];
      for (const word of words) {
        if ((lines.at(-1) + ' ' + word).trim().length > 18 && lines.at(-1)) lines.push('');
        lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim();
      }
      lines.forEach((line, index) => {
        const span = make('tspan', { x: lx, dy: index ? 13 : -(lines.length - 1) * 6 });
        span.textContent = line;
        text.append(span);
      });
      const skillId = Number(skills[i].id);
      if (Number.isSafeInteger(skillId) && skillId > 0) {
        text.dataset.skillId = String(skillId);
        text.addEventListener('click', () => {
          const trigger = card.querySelector(`button[data-skill-id="${skillId}"]`);
          void openSkillDetail(skillId, trigger);
        });
      }
      svg.append(text);
    }
    const max = Math.max(1, ...skills.map(skill => Number(skill.verifiedCount) || 0));
    svg.append(make('polygon', { points: Array.from({ length: 6 }, (_, i) => point(i, 112 * (Number(skills[i]?.verifiedCount) || 0) / max).join(',')).join(' '), class: 'skill-radar-value' }));
    card.append(svg);
    const caption = document.createElement('p');
    caption.className = 'skill-radar-caption';
    caption.textContent = `Outer ring: ${max} ${pluralise(max, 'verification')}`;
    card.append(caption);
    const listHeading = document.createElement('h4');
    listHeading.className = 'level-skill-top-heading';
    listHeading.textContent = 'Top verified skills';
    card.append(listHeading);
    const makeSkillList = values => {
      const list = document.createElement('ul');
      list.className = 'skill-radar-counts';
      for (const skill of values) {
        const row = document.createElement('li');
        row.className = 'skill-radar-interactive';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'skill-detail-trigger';
        const name = document.createElement('span');
        name.className = 'skill-trigger-name';
        name.textContent = String(skill.name || 'Skill');
        const count = document.createElement('span');
        count.className = 'skill-trigger-count';
        count.textContent = String(skillCount(skill.verifiedCount));
        button.append(name, count);
        bindSkillTrigger(button, skill);
        button.setAttribute('aria-label', `View ${name.textContent} skill details, ${count.textContent} ${pluralise(skillCount(skill.verifiedCount), 'verification')} in ${title}`);
        row.append(button);
        list.append(row);
      }
      return list;
    };
    card.append(makeSkillList(skills));
    if (allSkills.length > skills.length) {
      const remaining = allSkills.length - skills.length;
      const more = document.createElement('div');
      more.className = 'skill-radar-more';
      more.id = `skill-radar-more-${id}`;
      more.hidden = true;
      const list = makeSkillList(allSkills.slice(6));
      list.setAttribute('aria-label', `More ${title} verified skills`);
      more.append(list);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'skill-radar-toggle';
      toggle.setAttribute('aria-controls', more.id);
      toggle.setAttribute('aria-expanded', 'false');
      const collapsedLabel = `+ ${remaining} more ${pluralise(remaining, 'skill')}`;
      toggle.textContent = collapsedLabel;
      toggle.addEventListener('click', () => {
        const expand = more.hidden;
        if (!expand && more.contains(document.activeElement)) toggle.focus();
        more.hidden = !expand;
        toggle.setAttribute('aria-expanded', String(expand));
        toggle.textContent = expand ? 'Show fewer skills' : collapsedLabel;
      });
      card.append(more, toggle);
    }
    skillsList.append(card);
  }
}

function updateDashboardView() {
  const view = ({ '#skills': 'skills', '#cv-scanner': 'cv-scanner', '#cv-results': 'cv-results' })[window.location.hash] || 'home';
  const skillsView = view === 'skills';
  const cvView = view === 'cv-scanner' || view === 'cv-results';
  const titles = { home: 'Your career dashboard', skills: 'Your verified skills', 'cv-scanner': 'CV Scanner', 'cv-results': 'CV Results' };
  document.title = `${titles[view]} | CareerKraft`;
  document.body.classList.toggle('dashboard-skills-view', skillsView);
  document.body.classList.toggle('dashboard-cv-view-active', cvView);
  document.body.dataset.dashboardView = view;
  const primary = document.querySelector('.dashboard-primary');
  if (primary) {
    const panels = { skills: 'verified-skills-card', 'cv-scanner': 'cv-scanner-view', 'cv-results': 'cv-results-view' };
    const viewPanels = Object.values(panels);
    for (const child of primary.children) child.hidden = view === 'home' ? viewPanels.includes(child.id) : child.id !== panels[view];
  }
  const planner = document.querySelector('.dashboard-right');
  if (planner) planner.hidden = view !== 'home';
  const nav = document.getElementById('skills-nav-link');
  const cvNav = document.getElementById('cv-scanner-nav-link');
  const home = document.querySelector('.dashboard-nav-item[href="dashboard.html"]');
  for (const [item, active] of [[nav, skillsView], [cvNav, cvView], [home, view === 'home']]) {
    item?.classList.toggle('active', active);
    if (active) item?.setAttribute('aria-current', 'page');
    else item?.removeAttribute('aria-current');
  }
  const title = document.querySelector('.toolbar-title');
  if (title) title.textContent = ({ home: 'My dashboard', skills: 'My verified skills', 'cv-scanner': 'CV Scanner', 'cv-results': 'CV results' })[view];
  if (viewAllSkillsButton) viewAllSkillsButton.hidden = skillsView;
  window.dispatchEvent(new CustomEvent('careerkraft:dashboard-view', { detail: { view } }));
}
window.addEventListener('hashchange', async () => {
  updateDashboardView();
  if (!['#cv-scanner', '#cv-results'].includes(window.location.hash) && !dashboardDataLoaded) await initialiseDashboard();
  else if (window.location.hash === '#skills') await loadSkills();
});
viewAllSkillsButton?.addEventListener('click', () => { window.location.hash = 'skills'; });
initialiseDashboard();
// The calendar is a date reference; roadmap activities remain in the roadmap.
const calendarMonth = document.querySelector("#calendar-month");
const calendarDays = document.querySelector("#dashboard-calendar");
const calendarToday = new Date();
let calendarDate = new Date(calendarToday.getFullYear(), calendarToday.getMonth(), 1);
function renderCalendar() {
  if (!calendarMonth || !calendarDays) return;
  calendarMonth.textContent = calendarDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const start = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((start + count) / 7) * 7;
  calendarDays.innerHTML = Array.from({ length: cells }, (_, index) => {
    const date = new Date(year, month, index - start + 1);
    const today = date.toDateString() === calendarToday.toDateString();
    return `<span class="calendar-day${date.getMonth() !== month ? " outside" : ""}${today ? " today" : ""}"${today ? ' aria-current="date"' : ""} aria-label="${escapeHTML(date.toLocaleDateString(undefined, { dateStyle: "full" }))}">${date.getDate()}</span>`;
  }).join("");
}
document.querySelector("#calendar-prev")?.addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  renderCalendar();
});
document.querySelector("#calendar-next")?.addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  renderCalendar();
});
renderCalendar();

// Play the level-up cue only when the gold completion stage becomes visible.
const levelTransitionOverlay = document.getElementById('level-transition-overlay');
const levelCompleteStage = document.getElementById('level-complete-stage');
const levelCompleteSound = document.getElementById('level-complete-sound');
let goldCompletionVisible = false;
function syncLevelCompletionSound() {
  if (!levelTransitionOverlay || !levelCompleteStage || !levelCompleteSound) return;
  const visible = !levelTransitionOverlay.hidden && levelTransitionOverlay.classList.contains('is-open') &&
    !levelCompleteStage.hidden && !levelCompleteStage.classList.contains('hidden');
  if (visible && !goldCompletionVisible) {
    levelCompleteSound.currentTime = 0;
    levelCompleteSound.volume = 0.55;
    levelCompleteSound.play()?.catch(() => {
      if (!goldCompletionVisible || document.getElementById('level-sound-enable')) return;
      const button = document.createElement('button');
      button.id = 'level-sound-enable';
      button.className = 'level-ready-button level-sound-enable';
      button.type = 'button';
      button.textContent = 'Play level-up sound';
      button.addEventListener('click', () => {
        levelCompleteSound.currentTime = 0;
        levelCompleteSound.play()?.then(() => button.remove()).catch(() => {});
      });
      levelCompleteStage.append(button);
    });
  } else if (!visible && goldCompletionVisible) {
    levelCompleteSound.pause();
    levelCompleteSound.currentTime = 0;
    document.getElementById('level-sound-enable')?.remove();
  }
  goldCompletionVisible = visible;
}
if (levelTransitionOverlay && levelCompleteStage) {
  const levelSoundObserver = new MutationObserver(syncLevelCompletionSound);
  for (const element of [levelTransitionOverlay, levelCompleteStage]) {
    levelSoundObserver.observe(element, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  window.addEventListener('pagehide', () => {
    levelSoundObserver.disconnect();
    levelCompleteSound?.pause();
  });
}

/* =========================================
   ROADMAP LEVEL TRANSITION
========================================= */
const levelGeneratingStage = document.getElementById('level-generating-stage');
const levelReadyStage = document.getElementById('level-ready-stage');
const levelCompleteTitle = document.getElementById('level-complete-title');
const levelCompleteMessage = document.getElementById('level-complete-message');
const levelGeneratingTitle = document.getElementById('level-generating-title');
const levelGeneratingMessage = document.getElementById('level-generating-message');
const levelGenerationProgressFill = document.getElementById('level-generation-progress-fill');
const levelReadyTitle = document.getElementById('level-ready-title');
const levelReadyMessage = document.getElementById('level-ready-message');
const levelReadyStepCount = document.getElementById('level-ready-step-count');
const levelReadyButton = document.getElementById('level-ready-button');
let levelTransitionFocus;
let levelTransitionOverflow;
let levelTransitionRunning = false;
let levelTransitionCancelled = false;
function levelDelay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function formatRoadmapLevel(level) { return typeof level === 'string' ? level.charAt(0).toUpperCase() + level.slice(1) : ''; }
function hideLevelTransitionStages() {
  for (const stage of [levelCompleteStage, levelGeneratingStage, levelReadyStage]) {
    if (stage) { stage.classList.add('hidden'); stage.hidden = true; }
  }
  document.getElementById('level-pathway-close-button')?.remove();
}
function revealLevelTransitionStage(stage) {
  hideLevelTransitionStages();
  if (stage) { stage.hidden = false; stage.classList.remove('hidden'); }
  syncLevelCompletionSound();
}
function openLevelTransition() {
  if (!levelTransitionOverlay) return;
  levelTransitionFocus = document.activeElement;
  levelTransitionOverflow = document.body.style.overflow;
  levelTransitionCancelled = false;
  levelTransitionOverlay.hidden = false;
  levelTransitionOverlay.classList.add('is-open');
  levelTransitionOverlay.setAttribute('aria-hidden', 'false');
  levelTransitionOverlay.setAttribute('role', 'dialog');
  levelTransitionOverlay.setAttribute('aria-modal', 'true');
  levelTransitionOverlay.setAttribute('aria-label', 'Career pathway progression');
  levelTransitionOverlay.tabIndex = -1;
  document.body.style.overflow = 'hidden';
  levelTransitionOverlay.focus();
}
function closeLevelTransition() {
  if (!levelTransitionOverlay) return;
  levelTransitionCancelled = true;
  levelTransitionOverlay.classList.remove('is-open');
  levelTransitionOverlay.hidden = true;
  levelTransitionOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = levelTransitionOverflow || '';
  syncLevelCompletionSound();
  levelTransitionFocus?.focus();
}
async function showLevelCompleteStage(progression) {
  const previous = formatRoadmapLevel(progression.previousLevel);
  if (levelCompleteTitle) levelCompleteTitle.textContent = `${previous} complete`;
  if (levelCompleteMessage) levelCompleteMessage.textContent = `You completed every activity in your ${previous} pathway.`;
  revealLevelTransitionStage(levelCompleteStage);
  await levelDelay(1800);
  // If autoplay was blocked, keep the celebration visible until the user can enable sound.
  const soundButton = document.getElementById('level-sound-enable');
  if (soundButton && !levelTransitionCancelled) {
    await new Promise(resolve => {
      soundButton.addEventListener('click', resolve, { once: true });
      levelTransitionOverlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') resolve();
      }, { once: true });
    });
    if (!levelTransitionCancelled) await levelDelay(1800);
  }
}
async function showLevelGeneratingStage(progression) {
  const next = formatRoadmapLevel(progression.level);
  if (levelGeneratingTitle) levelGeneratingTitle.textContent = `Preparing your ${next} pathway`;
  revealLevelTransitionStage(levelGeneratingStage);
  if (levelGenerationProgressFill) levelGenerationProgressFill.style.width = '8%';
  const messages = [
    ['Looking at the skills you developed...',18],
    ['Reviewing your completed activities...',36],
    ['Looking at your verified skills...',54],
    ["Considering Lumia's previous feedback...",70],
    ['Designing your next challenges...',86],
    [`Preparing your ${next} pathway...`,96]
  ];
  for (const [text, progress] of messages) {
    if (levelTransitionCancelled) return;
    if (levelGeneratingMessage) levelGeneratingMessage.textContent = text;
    if (levelGenerationProgressFill) levelGenerationProgressFill.style.width = `${progress}%`;
    await levelDelay(550);
  }
  if (levelGenerationProgressFill) levelGenerationProgressFill.style.width = '100%';
  await levelDelay(500);
}
function showLevelReadyStage(progression) {
  const next = formatRoadmapLevel(progression.level);
  if (levelReadyTitle) levelReadyTitle.textContent = `${next} unlocked`;
  if (levelReadyMessage) levelReadyMessage.textContent = `Lumia has prepared your personalised ${next} pathway using the progress and skills you have already demonstrated.`;
  if (levelReadyStepCount) levelReadyStepCount.textContent = Number.isInteger(progression.stepsCreated) ? progression.stepsCreated : '?';
  if (levelReadyButton) levelReadyButton.textContent = `Start ${next} \u2192`;
  revealLevelTransitionStage(levelReadyStage);
  levelReadyButton?.focus();
}
async function showPathwayComplete() {
  openLevelTransition();
  if (levelCompleteTitle) levelCompleteTitle.textContent = 'Advanced complete';
  if (levelCompleteMessage) levelCompleteMessage.textContent = 'You completed your full Beginner, Intermediate and Advanced CareerKraft pathway.';
  revealLevelTransitionStage(levelCompleteStage);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'level-ready-button';
  closeButton.id = 'level-pathway-close-button';
  closeButton.textContent = 'Return to my dashboard';
  closeButton.addEventListener('click', closeLevelTransition);
  levelCompleteStage?.append(closeButton);
  closeButton.focus();
}
async function showRoadmapLevelTransition(progression) {
  if (!progression || !levelTransitionOverlay || levelTransitionRunning) return;
  if (!progression.pathwayCompleted && !progression.advanced) return;
  if (!progression.pathwayCompleted && !['intermediate', 'advanced'].includes(progression.level)) return;
  levelTransitionRunning = true;
  try {
    if (progression.pathwayCompleted) { await showPathwayComplete(); return; }
    // The backend has already generated the next level; this reveals the saved pathway.
    hideLevelTransitionStages();
    openLevelTransition();
    await showLevelCompleteStage(progression);
    if (levelTransitionCancelled) return;
    if (progression.generated) await showLevelGeneratingStage(progression);
    if (!levelTransitionCancelled) showLevelReadyStage(progression);
  } finally { levelTransitionRunning = false; }
}
levelReadyButton?.addEventListener('click', async () => {
  closeLevelTransition();
  await loadRoadmap();
});
levelTransitionOverlay?.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeLevelTransition(); return; }
  if (event.key === 'Tab') {
    const button = !levelReadyStage?.hidden ? levelReadyButton : document.getElementById('level-sound-enable') || document.getElementById('level-pathway-close-button');
    event.preventDefault();
    (button || levelTransitionOverlay).focus();
  }
});
async function checkPendingLevelTransition() {
  try {
    const stored = sessionStorage.getItem('careerkraft-level-progression');
    if (stored) {
      sessionStorage.removeItem('careerkraft-level-progression');
      if (pendingServerLevelKey) dashboardStorage.setItem(pendingServerLevelKey, 'true');
      await showRoadmapLevelTransition(JSON.parse(stored));
    } else if (pendingServerLevelProgression && pendingServerLevelKey && !dashboardStorage.getItem(pendingServerLevelKey)) {
      dashboardStorage.setItem(pendingServerLevelKey, 'true');
      await showRoadmapLevelTransition(pendingServerLevelProgression);
    }
  } catch (error) {
    closeLevelTransition();

  }
}
