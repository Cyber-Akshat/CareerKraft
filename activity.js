const activityStorage = {
  getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { window.localStorage.setItem(key, value); } catch {} }
};
async function activityCall(method, ...args) {
  try {
    const result = await window.careerAuth?.[method]?.(...args);
    if (result && typeof result === 'object') return result;
  } catch {}
  return { data: null, error: { message: "We couldn't reach CareerKraft. Check your connection and try again." } };
}
/* =========================================
   CAREERKRAFT ACTIVITY PAGE
========================================= */

const $ =
  selector =>
    document.querySelector(selector);


/* =========================================
   ELEMENTS
========================================= */

const pageStatus =
  $("#activity-status");

const careerLabel =
  $("#activity-career");

const phaseLabel =
  $("#activity-phase");

const stepNumberLabel =
  $("#activity-step-number");

const activityTitle =
  $("#activity-title");

const activityDescription =
  $("#activity-description");

const activityType =
  $("#activity-type");

const activityTime =
  $("#activity-time");

const evidenceBadge =
  $("#activity-evidence-badge");

const statusPanel =
  $(".activity-progress-panel");

const statusLabel =
  $("#activity-status-label");

const statusText =
  $("#activity-status-text");

const learningOne =
  $("#activity-learning-one");

const learningTwo =
  $("#activity-learning-two");

const learningThree =
  $("#activity-learning-three");

const taskIntro =
  $("#activity-task-intro");

const taskTitle =
  $("#activity-task-title");

const taskText =
  $("#activity-task-text");

const evidenceBox =
  $("#activity-evidence-box");

const submitEvidenceButton =
  $("#submit-evidence-button");

const evidenceTextInput = $("#evidence-text-input");
const evidenceFileInput = $("#evidence-file-input");
const evidenceDropzone = $("#evidence-dropzone");
const evidenceFileSelection = $("#evidence-file-selection");
const evidenceFileRemove = $("#evidence-file-remove");
const evidenceSubmitStatus = $("#evidence-submit-status");
const evidencePolicy = window.careerEvidencePolicy;
const evidenceFileSizeLimit = 10 * 1024 * 1024;
let selectedEvidenceFile = null;
let evidenceSubmitting = false;

const detailType =
  $("#activity-detail-type");

const detailTime =
  $("#activity-detail-time");

const detailPhase =
  $("#activity-detail-phase");

const detailEvidence =
  $("#activity-detail-evidence");

const actionMessage =
  $("#activity-action-message");

const completeButton =
  $("#activity-complete-button");

const backButton =
  $("#activity-back-button");

const dashboardButton =
  $("#activity-save-button");

const themeToggle =
  $("#activity-theme-toggle");

const avatar =
  $("#activity-avatar");


let currentStep = null;

/* =========================================
   SAVE ROADMAP LEVEL PROGRESSION
========================================= */
function saveLevelProgression(progression) {
  if (!progression || (!progression.advanced && !progression.pathwayCompleted)) return;
  try {
    sessionStorage.setItem('careerkraft-level-progression', JSON.stringify(progression));
  } catch (error) {
    // Storage availability must not interrupt a successful activity completion.

  }
}
if (completeButton) completeButton.disabled = true;


/* =========================================
   STEP ID FROM URL
========================================= */

const params =
  new URLSearchParams(
    window.location.search
  );


const stepId =
  Number(
    params.get("step")
  );


/* =========================================
   STATUS MESSAGE
========================================= */

function setStatus(
  message,
  isError = false
) {

  if (!pageStatus) {
    return;
  }


  pageStatus.textContent =
    message;


  pageStatus.hidden =
    !message;


  pageStatus.classList.toggle(
    "is-error",
    isError
  );

}


/* =========================================
   THEME
========================================= */

function applyTheme(theme) {

  const value =
    theme !== "dark"
      ? "light"
      : "dark";


  document.documentElement
    .dataset.theme =
      value;


  activityStorage.setItem(
    "careerkraft-theme",
    value
  );


  if (themeToggle) {

    themeToggle.setAttribute("aria-label", `Switch to ${value === "dark" ? "light" : "dark"} mode`);
    themeToggle.setAttribute("aria-pressed", String(value === "dark"));
    themeToggle.setAttribute("title", `Switch to ${value === "dark" ? "light" : "dark"} mode`);

  }

}


themeToggle
  ?.addEventListener(
    "click",
    () => {

      const current =
        document.documentElement
          .dataset.theme;


      applyTheme(
        current === "dark"
          ? "light"
          : "dark"
      );

    }
  );


/* =========================================
   LOAD USER
========================================= */

async function loadUser() {

  const auth =
    window.careerAuth;


  if (!auth) {

    showActivityLoadFailure('CareerKraft could not connect to your account.');

    return false;

  }


  const {
    data,
    error
  } =
    await activityCall('getSession');


  if (error) { showActivityLoadFailure(error.message || "We couldn't check your sign-in."); return false; }
  if (!data?.session?.user) {

    window.location.replace(
      "auth.html"
    );

    return false;

  }


  const user =
    data.session.user;


  const name =
    user.display_name ||
    user.name ||
    user.email ||
    "CareerKraft";


  if (avatar) {

    avatar.textContent =
      String(name)
        .trim()
        .charAt(0)
        .toUpperCase() || "C";

  }


  return true;

}


/* =========================================
   LOAD STEP
========================================= */

let activityLoadPending = false;
function showActivityLoadFailure(message, invalid = false) {
  setStatus(message, true);
  document.title = 'Activity unavailable | CareerKraft';
  if (careerLabel) careerLabel.textContent = 'Your roadmap';
  if (phaseLabel) phaseLabel.textContent = 'Activity unavailable';
  if (stepNumberLabel) stepNumberLabel.textContent = '\u2014';
  const content = document.querySelector('.activity-content-grid');
  if (content) content.hidden = true;
  if (activityTitle) activityTitle.textContent = invalid ? 'Activity link unavailable' : 'Activity unavailable';
  if (activityDescription) activityDescription.textContent = message;
  if (statusLabel) statusLabel.textContent = 'Unavailable';
  if (statusText) statusText.textContent = 'Load this activity again to continue.';
  if (evidenceBadge) evidenceBadge.hidden = true;
  for (const node of [activityType, activityTime, detailType, detailTime, detailPhase, detailEvidence]) {
    if (node) node.textContent = '—';
  }
  if (completeButton) completeButton.disabled = true;
  if (submitEvidenceButton) submitEvidenceButton.disabled = true;
  document.getElementById('activity-retry')?.remove();
  const retry = document.createElement('button');
  retry.id = 'activity-retry'; retry.type = 'button';
  retry.className = 'secondary-button page-retry-button';
  retry.textContent = invalid ? 'Return to my dashboard' : 'Try again';
  retry.addEventListener('click', () => invalid ? returnToDashboard() : void initialiseActivity());
  pageStatus?.after(retry);
}
async function loadStep() {
  if (!Number.isInteger(stepId) || stepId <= 0) { showActivityLoadFailure('This activity link is invalid.', true); return; }
  document.getElementById('activity-retry')?.remove();
  setStatus('Loading your activity...');
  const { data, error } = await activityCall('request', 'roadmap/steps/' + stepId);
  if (error || !data?.step) { showActivityLoadFailure(error?.message || 'This roadmap activity could not be found.'); return; }
  currentStep = data.step;
  if (currentStep.status === 'not_started') {
    if (!await startStep(currentStep.id)) { showActivityLoadFailure(pageStatus?.textContent || "We couldn't start this activity."); return; }
    const refreshed = await activityCall('request', 'roadmap/steps/' + stepId);
    if (refreshed.error || !refreshed.data?.step) { showActivityLoadFailure(refreshed.error?.message || "We couldn't reload this activity. Please try again."); return; }
    currentStep = refreshed.data.step;
  }
  setStatus('');
  renderStep(currentStep);
  await loadModuleContent();
}

/* =========================================
   START STEP
========================================= */
/* =========================================
   MODULE PLAYER ELEMENTS AND RENDERING
========================================= */
const moduleLoading = $('#module-loading');
const moduleLoadingMessage = $('#module-loading-message');
const moduleContent = $('#module-content');
const moduleError = $('#module-error');
const moduleErrorMessage = $('#module-error-message');
const moduleRetryButton = $('#module-retry-button');
const moduleIntroduction = $('#module-introduction');
const moduleLearningObjectives = $('#module-learning-objectives');
const moduleKeyConcepts = $('#module-key-concepts');
const moduleExampleTitle = $('#module-example-title');
const moduleExampleScenario = $('#module-example-scenario');
const moduleExampleWalkthrough = $('#module-example-walkthrough');
const moduleTaskTitle = $('#module-task-title');
const moduleTaskInstructions = $('#module-task-instructions');
const moduleVerificationCriteria = $('#module-verification-criteria');
const moduleTargetSkills = $('#module-target-skills');
const moduleReflectionQuestion = $('#module-reflection-question');
const moduleEvidenceGuidance = $('#module-evidence-guidance');
const moduleEvidenceInstructions = $('#module-evidence-instructions');
const moduleResources = $('#module-resources');
const moduleResourcesSection = $('#module-resources-section');
let moduleReady = false;
let moduleLoadingRun = 0;
let moduleLoadingTimer;
let moduleRequestPending = false;
const moduleGenerationSound = $('#module-generation-sound');
const moduleSoundButton = $('#module-sound-button');
function stopModuleGenerationSound() {
  moduleGenerationSound?.pause();
  if (moduleGenerationSound) moduleGenerationSound.currentTime = 0;
  if (moduleSoundButton) moduleSoundButton.hidden = true;
}
function playModuleGenerationSound() {
  if (!moduleGenerationSound || !moduleRequestPending) return;
  moduleGenerationSound.volume = 0.25;
  moduleGenerationSound.play()?.then(() => {
    if (!moduleRequestPending) stopModuleGenerationSound();
    else if (moduleSoundButton) moduleSoundButton.hidden = true;
  }).catch(() => {
    if (moduleRequestPending && moduleSoundButton) moduleSoundButton.hidden = false;
  });
}
moduleSoundButton?.addEventListener('click', playModuleGenerationSound);
function clearElement(element) { element?.replaceChildren(); }
function setModuleVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle('hidden', !visible);
}
function renderModuleList(element, values, tag = 'li', className = '') {
  if (!element) return;
  clearElement(element);
  for (const value of Array.isArray(values) ? values : []) {
    const item = document.createElement(tag);
    if (tag === 'li') window.careerModuleFormatting.renderLearningText(item, String(value));
    else item.textContent = String(value);
    if (className) item.className = className;
    element.append(item);
  }
}
function renderModuleObjectives(objectives) { renderModuleList(moduleLearningObjectives, objectives); }
function renderModuleCriteria(criteria) { renderModuleList(moduleVerificationCriteria, criteria); }
function renderModuleSkills(skills) { renderModuleList(moduleTargetSkills, skills, 'span', 'module-skill-chip'); }
function renderModuleConcepts(concepts) {
  if (!moduleKeyConcepts) return;
  clearElement(moduleKeyConcepts);
  for (const concept of Array.isArray(concepts) ? concepts : []) {
    const card = document.createElement('article');
    card.className = 'module-concept-card';
    const title = document.createElement('h3');
    title.textContent = concept?.title || 'Key concept';
    const explanation = document.createElement('div');
    window.careerModuleFormatting.renderLearningText(explanation, concept?.explanation || '');
    card.append(title, explanation);
    moduleKeyConcepts.append(card);
  }
}
function renderModuleResources(resources) {
  if (!moduleResources) return;
  clearElement(moduleResources);
  for (const resource of Array.isArray(resources) ? resources : []) {
    let url;
    try { url = new URL(resource.url); if (url.protocol !== 'https:') continue; } catch { continue; }
    const card = document.createElement('article');
    card.className = 'module-resource-card';
    const main = document.createElement('div');
    main.className = 'module-resource-main';
    const heading = document.createElement('div');
    heading.className = 'module-resource-heading';
    const icon = document.createElement('div');
    icon.className = 'module-resource-icon';
    icon.setAttribute('aria-hidden', 'true');
    const icons = {
      video: '<path d="m9 7 8 5-8 5z"/>',
      documentation: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 20"/>',
      interactive: '<path d="m7 3 12 9-6 1-3 6z"/>',
      guide: '<path d="M12 6v14M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2z"/>'
    };
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[resource.resourceType] || icons.guide}</svg>`;
    const headingCopy = document.createElement('div');
    headingCopy.className = 'module-resource-heading-copy';
    const topline = document.createElement('div');
    topline.className = 'module-resource-topline';
    const provider = document.createElement('span');
    provider.className = 'module-resource-provider';
    provider.textContent = resource.provider;
    const type = document.createElement('span');
    type.className = 'module-resource-type';
    type.textContent = resource.resourceType;
    topline.append(provider, type);
    const title = document.createElement('h3');
    title.textContent = resource.title;
    headingCopy.append(topline, title);
    heading.append(icon, headingCopy);
    const description = document.createElement('p');
    description.className = 'module-resource-description';
    description.textContent = resource.description;
    const focus = document.createElement('div');
    focus.className = 'module-resource-focus';
    const focusLabel = document.createElement('strong');
    focusLabel.textContent = 'Focus on';
    const focusText = document.createElement('p');
    focusText.textContent = resource.studyFocus;
    focus.append(focusLabel, focusText);
    main.append(heading, description, focus);
    const action = document.createElement('div');
    action.className = 'module-resource-action';
    const link = document.createElement('a');
    link.className = 'module-resource-link';
    link.href = url.toString();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open resource \u2197';
    link.setAttribute('aria-label', `Open ${resource.title} (opens in a new tab)`);
    action.append(link);
    card.append(main, action);
    moduleResources.append(card);
  }
  if (!moduleResources.children.length) {
    const notice = document.createElement('div');
    notice.className = 'module-resources-empty';
    const title = document.createElement('p');
    title.textContent = 'No recommended resources available for this module right now.';
    const message = document.createElement('p');
    message.textContent = 'You can still continue with the learning content below.';
    notice.append(title, message);
    moduleResources.append(notice);
  }
  setModuleVisible(moduleResourcesSection, true);
}
function renderModuleContent(content) {
  if (!content) return;
  const renderText = window.careerModuleFormatting.renderLearningText;
  renderText(moduleIntroduction, content.introduction || '');
  renderModuleObjectives(content.learningObjectives);
  renderModuleConcepts(content.keyConcepts);
  renderModuleResources(content.resources);
  moduleExampleTitle.textContent = content.example?.title || 'Example';
  renderText(moduleExampleScenario, content.example?.scenario || '');
  renderText(moduleExampleWalkthrough, content.example?.walkthrough || '');
  moduleTaskTitle.textContent = content.task?.title || 'Your activity';
  renderText(moduleTaskInstructions, content.task?.instructions || currentStep?.description || '');
  renderModuleCriteria(content.verificationCriteria);
  renderModuleSkills(content.targetSkills || content.skills);
  renderText(moduleReflectionQuestion, content.reflectionQuestion || 'What did you learn from completing this activity?');
  const instructions = content.evidenceInstructions || content.evidence?.instructions || '';
  setModuleVisible(moduleEvidenceGuidance, Boolean(currentStep?.evidenceRequired && instructions));
  renderText(moduleEvidenceInstructions, instructions);
  $('.evidence-header p').textContent = instructions;
  setModuleVisible(moduleLoading, false);
  setModuleVisible(moduleError, false);
  setModuleVisible(moduleContent, true);
  phaseLabel.textContent = formatActivityType(currentStep.level || 'beginner') + ' \u00b7 Phase ' + currentStep.phaseNumber;
}
function animateModuleLoading(runId) {
  const messages = ['Understanding this activity...', 'Preparing the key concepts...', 'Building a realistic example...', 'Designing your practical task...', "Defining the skills you'll develop...", 'Preparing your module...'];
  let index = 0;
  moduleLoadingMessage.textContent = messages[index++];
  clearInterval(moduleLoadingTimer);
  moduleLoadingTimer = setInterval(() => {
    if (runId !== moduleLoadingRun || index >= messages.length) { clearInterval(moduleLoadingTimer); return; }
    moduleLoadingMessage.textContent = messages[index++];
  }, 650);
}
async function loadModuleContent() {
  if (!currentStep?.id || moduleRequestPending) return;
  moduleRequestPending = true;
  moduleReady = false;
  const runId = ++moduleLoadingRun;
  completeButton.disabled = true;
  submitEvidenceButton.disabled = true;
  moduleRetryButton.disabled = true;
  moduleRetryButton.textContent = 'Preparing...';
  // The old outline guidance is replaced by the numbered module player.
  $('#module-content-status').hidden = true;
  $('#module-content-retry').hidden = true;
  $('#activity-learning-content').hidden = true;
  $('.activity-task-box').hidden = true;
  taskIntro.hidden = true;
  setModuleVisible(moduleContent, false);
  setModuleVisible(moduleError, false);
  setModuleVisible(moduleLoading, true);
  $('#module-learning')?.setAttribute('aria-busy', 'true');
  animateModuleLoading(runId);
  playModuleGenerationSound();
  try {
    const { data, error } = await activityCall('request', 'roadmap/steps/' + currentStep.id + '/content', {});
    if (runId !== moduleLoadingRun) return;
    if (error || !data?.content) throw new Error(error?.message || 'CareerKraft received an empty module. Please try again.');
    renderModuleContent(data.content);
    moduleReady = true;
    completeButton.disabled = currentStep.status !== 'in_progress' || currentStep.evidenceRequired;
    submitEvidenceButton.disabled = currentStep.status === 'completed';
    lockEvidenceInputs(currentStep.status === 'completed');
  } catch (error) {
    setModuleVisible(moduleLoading, false);
    setModuleVisible(moduleContent, false);
    setModuleVisible(moduleError, true);
    moduleErrorMessage.textContent = error.message || "Lumia couldn't prepare this module right now.";
  } finally {
    moduleLoadingRun++;
    clearInterval(moduleLoadingTimer);
    moduleRequestPending = false;
    stopModuleGenerationSound();
    moduleRetryButton.disabled = false;
    moduleRetryButton.textContent = 'Try again';
    $('#module-learning')?.setAttribute('aria-busy', 'false');
  }
}
moduleRetryButton?.addEventListener('click', loadModuleContent);
window.addEventListener('pagehide', () => { moduleLoadingRun++; clearInterval(moduleLoadingTimer); stopModuleGenerationSound(); });

async function startStep(id) {

  const {
    error
  } =
    await activityCall('request',
      `roadmap/steps/${id}/start`,
      {}
    );


  if (error) {

    setStatus(
      error.message ||
      "We couldn't start this activity.",
      true
    );

    return false;

  }


  return true;

}


/* =========================================
   RENDER STEP
========================================= */

function renderStep(step) {
  const content = document.querySelector('.activity-content-grid');
  if (content) content.hidden = false;

  setStatus("");


  document.title =
    `${step.title} | CareerKraft`;


  /* Career */

  careerLabel.textContent =
    step.career.title;


  /* Phase */

  phaseLabel.textContent =
    `Phase ${step.phaseNumber}`;


  stepNumberLabel.textContent =
    `Module ${step.levelStepNumber || step.stepNumber}`;


  /* Main information */

  activityTitle.textContent =
    step.title;


  activityDescription.textContent =
    step.description;


  const formattedType =
    formatActivityType(
      step.activityType
    );


  const formattedTime =
    formatMinutes(
      step.estimatedMinutes
    );


  activityType.textContent =
    formattedType;


  activityTime.textContent =
    formattedTime;


  evidenceBadge.hidden =
    !step.evidenceRequired;
  evidenceBadge.textContent = 'Evidence required';


  /* Sidebar */

  detailType.textContent =
    formattedType;


  detailTime.textContent =
    formattedTime;


  detailPhase.textContent =
    step.phaseTitle;


  detailEvidence.textContent =
    step.evidenceRequired
      ? "Required"
      : "Not required";


  /* Activity content */

  renderActivityContent(
    step
  );


  completeButton.disabled = step.status !== "in_progress" || step.evidenceRequired;
  completeButton.textContent = "Mark activity complete \u2192";

  /* Progress */

  renderStatus(
    step
  );


  /* Evidence */

  evidenceBox.hidden =
    !step.evidenceRequired;


  /*
    Evidence-required activities cannot
    be completed directly.
  */

  if (
    step.evidenceRequired &&
    step.status !== "completed"
  ) {

    completeButton.disabled =
      true;


    completeButton.textContent =
      "Submit evidence first";

  }

}


/* =========================================
   ACTIVITY CONTENT
========================================= */

function renderActivityContent(step) {

  const type =
    step.activityType;


  if (type === "learning") {

    taskIntro.textContent =
      "Work through the ideas below before completing this step.";


    learningOne.textContent =
      `Understand the main idea behind "${step.title}".`;


    learningTwo.textContent =
      "Think about where this idea appears in real organisations, products or everyday situations.";


    learningThree.textContent =
      "Explain the idea back in your own words and think about how it connects to this career.";


    taskTitle.textContent =
      "Check your understanding";


    taskText.textContent =
      `After exploring "${step.title}", write down three things you learned and one question you still have.`;


    return;

  }


  if (type === "challenge") {

    taskIntro.textContent =
      "This challenge lets you try a small piece of the real work.";


    learningOne.textContent =
      "Read the situation carefully and identify what the task is asking you to solve.";


    learningTwo.textContent =
      "Think through your approach before jumping straight to an answer.";


    learningThree.textContent =
      "Review your work and make sure you can explain why you made your decisions.";


    taskTitle.textContent =
      step.title;


    taskText.textContent =
      step.description;


    return;

  }


  if (type === "project") {

    taskIntro.textContent =
      "This project is designed to give you something practical you can show as evidence of your skills.";


    learningOne.textContent =
      "Define what you want your project to achieve before you begin.";


    learningTwo.textContent =
      "Build a first version, test it and improve anything that does not work well.";


    learningThree.textContent =
      "Document what you created, the decisions you made and what you learned.";


    taskTitle.textContent =
      "Build your project";


    taskText.textContent =
      step.description;


    return;

  }


  if (type === "research") {

    taskIntro.textContent =
      "Research this part of your career journey using reliable and current information.";


    learningOne.textContent =
      "Start with official or trusted career and education sources.";


    learningTwo.textContent =
      "Compare more than one route rather than assuming there is only one way into the career.";


    learningThree.textContent =
      "Record which routes look most suitable for you and why.";


    taskTitle.textContent =
      "Research your options";


    taskText.textContent =
      step.description;


    return;

  }


  /* Fallback */

  taskIntro.textContent =
    "Work through this activity and focus on what you can learn from it.";


  learningOne.textContent =
    step.description;


  learningTwo.textContent =
    "Think about how this connects to the career you are exploring.";


  learningThree.textContent =
    "Record anything useful you learned from completing the activity.";


  taskTitle.textContent =
    "Try it yourself";


  taskText.textContent =
    step.description;

}


/* =========================================
   STATUS RENDERING
========================================= */

function renderStatus(step) {

  statusPanel.classList.remove(
    "in-progress",
    "completed"
  );


  if (
    step.status ===
    "completed"
  ) {

    statusPanel.classList.add(
      "completed"
    );


    statusLabel.textContent =
      "Completed";


    statusText.textContent =
      "Nice work — this activity is complete.";


    actionMessage.textContent =
      "This step has been completed.";


    completeButton.disabled =
      true;


    completeButton.textContent =
      "Completed ✓";


    return;

  }


  if (
    step.status ===
    "in_progress"
  ) {

    statusPanel.classList.add(
      "in-progress"
    );


    statusLabel.textContent =
      "In progress";


    statusText.textContent =
      "You've started this activity.";


    actionMessage.textContent =
      step.evidenceRequired
        ? "Complete the task and submit your evidence."
        : "Complete the activity when you're ready.";


    return;

  }


  statusLabel.textContent =
    "Not started";


  statusText.textContent =
    "Ready when you are.";

}


/* =========================================
   COMPLETE ACTIVITY
========================================= */

completeButton
  ?.addEventListener(
    "click",
    async () => {

      if (!currentStep || !moduleReady || currentStep.status !== "in_progress" || completeButton.disabled) {
        return;
      }


      if (
        currentStep.evidenceRequired
      ) {

        setStatus(
          "This activity needs evidence before it can be completed."
        );

        return;

      }


      completeButton.disabled =
        true;


      completeButton.textContent =
        "Completing...";


      const {
        data,
        error
      } =
        await activityCall('request',
          `roadmap/steps/${currentStep.id}/complete`,
          {}
        );


      if (error) {

        completeButton.disabled =
          false;


        completeButton.textContent =
          "Mark activity complete →";


        setStatus(
          error.message ||
          "We couldn't complete this activity.",
          true
        );


        return;

      }


      saveLevelProgression(data?.levelProgression);
      celebrateCompletion();
      currentStep.status =
        "completed";


      renderStatus(
        currentStep
      );


      setStatus(
        "Activity completed. Your roadmap progress has been updated."
      );


      /*
        Give the student a moment to see
        the success state, then return.
      */

      setTimeout(
        () => {

          window.location.assign(
            "dashboard.html"
          );

        },
        900
      );

    }
  );


/* =========================================
   EVIDENCE
========================================= */

/* =========================================
   EVIDENCE UPLOAD AND STATUS
========================================= */
function showEvidenceStatus(message, type = "") {
  if (!evidenceSubmitStatus) return;
  evidenceSubmitStatus.textContent = message;
  evidenceSubmitStatus.hidden = !message;
  evidenceSubmitStatus.classList.remove("success", "error");
  if (type) evidenceSubmitStatus.classList.add(type);
}
function renderEvidenceFile() {
  evidenceFileSelection.hidden = !selectedEvidenceFile;
  evidenceDropzone.classList.toggle("has-file", Boolean(selectedEvidenceFile));
  $("#evidence-file-name").textContent = selectedEvidenceFile?.name || "";
  const size = selectedEvidenceFile?.size || 0;
  $("#evidence-file-size").textContent = size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
  evidenceTextInput.placeholder = selectedEvidenceFile
    ? "Anything you'd like Lumia to know about your work..."
    : "Write your response here, or add anything you'd like Lumia to know about your uploaded work...";
}
function setEvidenceFile(file) {
  if (evidenceSubmitting || currentStep?.status === "completed") return;
  let error = "";
  if (file && !evidencePolicy.isAllowedEvidenceFilename(file.name)) {
    error = "Unsupported file extension. Choose a supported document, code, spreadsheet, notebook, image, audio or video file.";
  } else if (file && file.size > evidenceFileSizeLimit) {
    error = "Your file must be 10 MB or smaller.";
  } else if (file && file.size === 0) {
    error = "This file is empty. Please choose a file containing your work.";
  } else {
    selectedEvidenceFile = file || null;
  }
  // Keep valid work selected if a replacement is unsupported or too large.
  if (error || !selectedEvidenceFile) evidenceFileInput.value = "";
  renderEvidenceFile();
  showEvidenceStatus(error, error ? "error" : "");
}
function lockEvidenceInputs(locked) {
  evidenceFileInput.disabled = locked;
  evidenceTextInput.disabled = locked;
  evidenceFileRemove.disabled = locked;
  evidenceDropzone.classList.toggle("is-disabled", locked);
  evidenceBox.setAttribute("aria-busy", String(evidenceSubmitting));
}
evidenceFileInput?.addEventListener("change", () => setEvidenceFile(evidenceFileInput.files?.[0]));
evidenceFileRemove?.addEventListener("click", () => {
  setEvidenceFile(null);
  evidenceFileInput.focus();
});
evidenceDropzone?.addEventListener("dragover", event => {
  event.preventDefault();
  if (!evidenceSubmitting && currentStep?.status !== "completed") evidenceDropzone.classList.add("is-dragging");
});
evidenceDropzone?.addEventListener("dragleave", event => {
  if (!evidenceDropzone.contains(event.relatedTarget)) evidenceDropzone.classList.remove("is-dragging");
});
evidenceDropzone?.addEventListener("drop", event => {
  event.preventDefault();
  evidenceDropzone.classList.remove("is-dragging");
  if (evidenceSubmitting || currentStep?.status === "completed") return;
  const files = event.dataTransfer?.files;
  if (files?.length !== 1) {
    showEvidenceStatus("Please upload one file at a time.", "error");
    return;
  }
  setEvidenceFile(files[0]);
});
evidenceTextInput?.addEventListener("input", () => {
  showEvidenceStatus("");
});

/* =========================================
   SUBMIT EVIDENCE
========================================= */
const lumiaOverlay = $("#lumia-overlay");
function celebrateCompletion() {
  const sound = $("#activity-completion-sound");
  if (sound) {
    sound.currentTime = 0;
    sound.volume = 0.55;
    sound.play()?.catch(() => {});
  }
  if (document.documentElement.dataset.reducedMotion === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelector(".completion-confetti")?.remove();
  const layer = document.createElement("div");
  layer.className = "completion-confetti";
  layer.setAttribute("aria-hidden", "true");
  const colors = ["#b28aff", "#77dfbc", "#ffce71", "#ff91bb", "#87d5ff"];
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("span");
    piece.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--drift:${Math.random() * 280 - 140}px;--spin:${Math.random() * 1080 - 540}deg;animation-delay:${Math.random() * .7}s;animation-duration:${2.5 + Math.random() * 1.5}s;border-radius:${i % 3 === 0 ? "50%" : "2px"}`;
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}
window.addEventListener("pagehide", () => $("#activity-completion-sound")?.pause());
window.addEventListener("pagehide", () => $("#activity-review-followup-sound")?.pause());
const lumiaProcessingSound = $("#lumia-processing-sound");
let lumiaSoundFinished = Promise.resolve();
let resolveLumiaSound;
function stopLumiaSound() {
  resolveLumiaSound?.();
  resolveLumiaSound = null;
  if (!lumiaProcessingSound) return;
  lumiaProcessingSound.pause();
  lumiaProcessingSound.currentTime = 0;
}
window.addEventListener("pagehide", stopLumiaSound);
let lumiaTimer;
let lumiaPreviousFocus;
function closeLumia() {
  stopLumiaSound();
  clearInterval(lumiaTimer);
  if (!lumiaOverlay) return;
  lumiaOverlay.hidden = true;
  document.body.classList.remove("lumia-open");
  lumiaPreviousFocus?.focus();
}
function startLumia() {
  if (!lumiaOverlay) return;
  if (lumiaProcessingSound) {
    lumiaSoundFinished = new Promise(resolve => { resolveLumiaSound = resolve; });
    const finishSound = () => {
      resolveLumiaSound?.();
      resolveLumiaSound = null;
    };
    lumiaProcessingSound.onended = finishSound;
    lumiaProcessingSound.onerror = finishSound;
    lumiaProcessingSound.currentTime = 0;
    lumiaProcessingSound.volume = 0.4;
    const playback = lumiaProcessingSound.play();
    if (playback) playback.catch(finishSound);
    else finishSound();
  }
  lumiaPreviousFocus = document.activeElement;
  lumiaOverlay.hidden = false;
  lumiaOverlay.dataset.state = "processing";
  document.body.classList.add("lumia-open");
  $("#lumia-processing").hidden = false;
  $("#lumia-result").hidden = true;
  $("#lumia-orb-symbol").textContent = "✦";
  $("#lumia-processing-message").textContent = "Understanding your work...";
  $("#lumia-progress-bar").style.width = "8%";
  lumiaOverlay.focus();
  let stage = 0;
  const messages = ["Connecting your evidence to the activity...", "Looking for detail and demonstrated skills...", "Weighing the evidence carefully...", "Still reviewing — your work deserves a careful look."];
  clearInterval(lumiaTimer);
  lumiaTimer = setInterval(() => {
    $("#lumia-processing-message").textContent = messages[Math.min(stage, messages.length - 1)];
    $("#lumia-progress-bar").style.width = `${Math.min(88, 28 + stage * 20)}%`;
    stage++;
  }, 1800);
}
function finishLumia(evidence = {}, errorMessage = "") {
  stopLumiaSound();
  clearInterval(lumiaTimer);
  if (!lumiaOverlay) return;
  const approved = evidence.status === "approved";
  const changes = evidence.status === "needs_changes";
  lumiaOverlay.dataset.state = errorMessage ? "error" : approved ? "approved" : changes ? "changes" : "pending";
  $("#lumia-processing").hidden = true;
  $("#lumia-result").hidden = false;
  $("#lumia-orb-symbol").textContent = approved ? "✓" : changes || errorMessage ? "↺" : "✦";
  $("#lumia-result-badge").textContent = errorMessage ? "SUBMISSION INTERRUPTED" : approved ? "REVIEW COMPLETE" : changes ? "A LITTLE MORE WORK" : "HUMAN REVIEW PENDING";
  $("#lumia-result-title").textContent = errorMessage ? "We couldn't submit your evidence" : approved ? "Your work shines" : changes ? "Let's strengthen your evidence" : "Saved for a closer look";
  $("#lumia-result-feedback").textContent = errorMessage || evidence.feedback || "Your evidence has been saved and is waiting for review.";
  const list = $("#lumia-skill-list");
  list.replaceChildren();
  const skills = Array.isArray(evidence.skillsDetected) ? evidence.skillsDetected.filter(skill =>
    typeof skill === "string" || (skill && typeof skill.name === "string")).slice(0, 12) : [];
  for (const skill of skills) {
    const chip = document.createElement("span");
    const skillName = typeof skill === "string" ? skill : skill.name;
    chip.textContent = `✓ ${skillName}`;
    list.append(chip);
  }
  $("#lumia-skills").hidden = skills.length === 0;
  $("#lumia-close-button").textContent = changes ? "Improve my evidence" : "Close";
  $("#lumia-close-button").focus();
  if (approved && !errorMessage) celebrateCompletion();
  else if (!errorMessage) {
    const sound = $("#activity-review-followup-sound");
    if (sound) {
      sound.currentTime = 0;
      sound.volume = 0.55;
      sound.play()?.catch(() => {});
    }
  }
}
$("#lumia-close-button")?.addEventListener("click", closeLumia);
$("#lumia-continue-button")?.addEventListener("click", returnToDashboard);
lumiaOverlay?.addEventListener("keydown", event => {
  if (event.key === "Escape" && lumiaOverlay.dataset.state !== "processing") closeLumia();
  if (event.key !== "Tab") return;
  const buttons = lumiaOverlay.dataset.state === "processing" ? [] : [...lumiaOverlay.querySelectorAll("button")];
  if (!buttons.length) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
});
async function submitEvidence() {
  if (!currentStep?.id || !moduleReady || submitEvidenceButton.disabled || evidenceSubmitting) return;
  if (!currentStep.evidenceRequired) {
    showEvidenceStatus("This activity does not require evidence.", "error");
    return;
  }
  const text = evidenceTextInput.value.trim();
  if (!selectedEvidenceFile && !text) {
    showEvidenceStatus("Upload your work or provide a written response.", "error");
    evidenceFileInput.focus();
    return;
  }
  if (text.length > 3000) {
    showEvidenceStatus("Your response must be 3,000 characters or fewer.", "error");
    evidenceTextInput.focus();
    return;
  }
  if (selectedEvidenceFile && selectedEvidenceFile.size > evidenceFileSizeLimit) {
    showEvidenceStatus("Your file must be 10 MB or smaller.", "error");
    evidenceFileInput.focus();
    return;
  }
  const payload = new FormData();
  if (selectedEvidenceFile) payload.append("evidenceFile", selectedEvidenceFile);
  if (text) payload.append("textContent", text);
  evidenceSubmitting = true;
  lockEvidenceInputs(true);
  submitEvidenceButton.disabled = true;
  submitEvidenceButton.textContent = "Lumia is reviewing...";
  showEvidenceStatus(selectedEvidenceFile ? "Uploading and reviewing your work..." : "Reviewing your response...");
  startLumia();
  let response;
  try {
    // The shared client passes FormData directly to fetch with same-origin
    // credentials, letting the browser supply the multipart boundary.
    response = await activityCall('request', `roadmap/steps/${currentStep.id}/evidence`, payload);
  } catch {
    response = { error: { message: "We couldn't reach CareerKraft. Please try again." } };
  }
  let { data, error } = response;
  if (!error && !['approved', 'needs_changes', 'submitted', 'review_required'].includes(data?.evidence?.status)) {
    error = { message: "We couldn't confirm your submission. Your work is still here; please try again." };
  }
  // Reveal the result only after the review and the full sound have finished.
  await lumiaSoundFinished;
  evidenceSubmitting = false;
  if (error) {
    lockEvidenceInputs(false);
    submitEvidenceButton.disabled = false;
    submitEvidenceButton.textContent = "Submit to Lumia \u2726";
    showEvidenceStatus(error.message || "We couldn't submit your evidence.", "error");
    finishLumia({}, error.message || "We couldn't submit your evidence.");
    return;
  }
  saveLevelProgression(data?.levelProgression);
  const approved = data?.evidence?.status === "approved";
  const needsChanges = data?.evidence?.status === "needs_changes";
  showEvidenceStatus(data?.evidence?.feedback || (approved
    ? "Evidence approved. This activity is complete."
    : needsChanges ? "Please update your evidence." : "Evidence submitted successfully. It is now waiting for review."), needsChanges ? "error" : "success");
  submitEvidenceButton.disabled = false;
  submitEvidenceButton.textContent = "Update evidence \u2192";
  actionMessage.textContent = "Evidence submitted \u2014 waiting for review.";
  setStatus("Your evidence has been submitted.");
  if (approved) {
    currentStep.status = "completed";
    renderStatus(currentStep);
    submitEvidenceButton.disabled = true;
    submitEvidenceButton.textContent = "Evidence approved";
    setStatus("Evidence approved. Your roadmap progress has been updated.");
  } else if (needsChanges) {
    actionMessage.textContent = "Changes requested — update your evidence using the feedback above.";
  }
  lockEvidenceInputs(approved);
  finishLumia(data?.evidence);
}
submitEvidenceButton?.addEventListener("click", submitEvidence);


/* =========================================
   NAVIGATION
========================================= */

function returnToDashboard() {

  window.location.assign(
    "dashboard.html"
  );

}


backButton
  ?.addEventListener(
    "click",
    returnToDashboard
  );


dashboardButton
  ?.addEventListener(
    "click",
    returnToDashboard
  );


/* =========================================
   FORMATTERS
========================================= */

function formatMinutes(minutes) {

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


  if (!remainder) {

    return `${hours} hr`;

  }


  return `${hours} hr ${remainder} min`;

}


function formatActivityType(value) {

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
      character =>
        character.toUpperCase()
    );

}


/* =========================================
   INITIALISE
========================================= */

async function initialiseActivity() {
  if (activityLoadPending) return;
  activityLoadPending = true;
  document.querySelector('main')?.setAttribute('aria-busy', 'true');
  try {
    evidenceFileInput.accept = evidencePolicy.SUPPORTED_EVIDENCE_ACCEPT;
    applyTheme(activityStorage.getItem('careerkraft-theme'));
    if (!await loadUser()) return;
    await loadStep();
  } catch { showActivityLoadFailure("We couldn't load this activity. Please try again."); }
  finally { activityLoadPending = false; document.querySelector('main')?.setAttribute('aria-busy', 'false'); }
}

initialiseActivity();
