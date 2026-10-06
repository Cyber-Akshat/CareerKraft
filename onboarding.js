/* =========================================
   SUPABASE
========================================= */

const SUPABASE_URL =
  "https://vrvhccnvrwvocoimjpkg.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_YmDYvdVDX1eXOqBx-Iickw_bZc5zj_V";


const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );


let currentUser = null;

/* =========================================
   LOG OUT
========================================= */

const logoutButton =
  document.querySelector("#logout-button");


logoutButton?.addEventListener(
  "click",
  async () => {

    logoutButton.disabled =
      true;


    const {
      error
    } =
      await supabaseClient.auth.signOut();


    if (error) {

      console.error(
        "Logout error:",
        error
      );

      logoutButton.disabled =
        false;

      return;

    }


    window.location.replace(
      "auth.html"
    );

  }
);


/* =========================================
   CHECK LOGIN
========================================= */

async function checkUserSession() {

  const {
    data,
    error
  } =
    await supabaseClient.auth.getSession();


  if (error) {

    console.error(
      "Session error:",
      error
    );

    window.location.replace(
      "auth.html"
    );

    return;

  }


  if (!data.session) {

    window.location.replace(
      "auth.html"
    );

    return;

  }


  currentUser =
    data.session.user;


  console.log(
    "CareerKraft user:",
    currentUser
  );

}
const screens = Array.from(
  document.querySelectorAll(".onboarding-screen")
);
const progressLabel = document.querySelector("#progress-label");
const progressBar = document.querySelector("#progress-bar-fill");
const analysisRows = Array.from(
  document.querySelectorAll(".analysis-status-row")
);
const selections = new Map();
const themeToggle = document.querySelector("#onboarding-theme-toggle");

let currentScreen = 0;
let analysisTimer;

function updateThemeToggle(theme) {
  const nextLabel =
    theme === "light"
      ? "Switch to dark mode"
      : "Switch to light mode";

  themeToggle.setAttribute("aria-label", nextLabel);
  themeToggle.setAttribute("title", nextLabel);
  themeToggle.setAttribute(
    "aria-pressed",
    String(theme === "light")
  );
}

updateThemeToggle(document.documentElement.dataset.theme);

themeToggle.addEventListener("click", () => {
  const nextTheme =
    document.documentElement.dataset.theme === "light"
      ? "dark"
      : "light";

  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("careerkraft-theme", nextTheme);
  updateThemeToggle(nextTheme);
});

const screenLabels = [
  "Getting started",
  "Step 1 of 4 - Interests",
  "Step 2 of 4 - Subjects",
  "Step 3 of 4 - Strengths",
  "Step 4 of 4 - Work style",
  "Building your profile",
  "Your career matches"
];

function showScreen(screenNumber) {
  const nextScreen = screens.find(
    (screen) => Number(screen.dataset.screen) === screenNumber
  );

  if (!nextScreen) {
    throw new Error(`Onboarding screen ${screenNumber} is missing.`);
  }

  currentScreen = screenNumber;
  screens.forEach((screen) => {
    screen.classList.toggle("active", screen === nextScreen);
  });

  progressLabel.textContent = screenLabels[screenNumber];
  progressBar.style.width = `${(screenNumber / 6) * 100}%`;
  window.scrollTo({ top: 0, behavior: "smooth" });

  const heading = nextScreen.querySelector("h1, h2");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

function getQuestionChoices(grid) {
  const question = grid.dataset.question;
  if (!question) {
    throw new Error("Onboarding question is missing its data-question name.");
  }

  if (!selections.has(question)) {
    selections.set(question, new Set());
  }

  return selections.get(question);
}

function updateSelectionHint(grid, isError = false) {
  const hint = grid.parentElement.querySelector(".selection-hint");
  if (!hint) return;

  if (hint.dataset.defaultText === undefined) {
    hint.dataset.defaultText = hint.textContent.trim();
  }

  hint.classList.toggle("error", isError);
  hint.setAttribute("aria-live", "polite");
}

document.querySelectorAll(".choice-grid[data-question]").forEach((grid) => {
  const choices = getQuestionChoices(grid);

  grid.querySelectorAll(".choice-card[data-value]").forEach((card) => {
    const value = card.dataset.value;
    card.setAttribute("aria-pressed", String(choices.has(value)));

    card.addEventListener("click", () => {
      const max = Number(grid.dataset.max || Infinity);
      if (choices.has(value)) {
        choices.delete(value);
        card.classList.remove("selected");
      } else {
        if (choices.size >= max) {
          updateSelectionHint(grid, true);
          return;
        }
        choices.add(value);
        card.classList.add("selected");
      }

      card.setAttribute("aria-pressed", String(choices.has(value)));
      updateSelectionHint(grid);
    });
  });
});

function canContinue(screen) {
  const grid = screen.querySelector(".choice-grid[data-question]");
  if (!grid) return true;

  const count = getQuestionChoices(grid).size;
  const minimum = Number(grid.dataset.min || 0);
  const maximum = Number(grid.dataset.max || Infinity);
  const hint = grid.parentElement.querySelector(".selection-hint");

  if (count < minimum || count > maximum) {
    if (hint) {
      hint.textContent =
        count < minimum
          ? `Choose at least ${minimum} option${minimum === 1 ? "" : "s"} to continue.`
          : `Choose no more than ${maximum} options to continue.`;
    }
    updateSelectionHint(grid, true);
    return false;
  }

  if (hint) {
    hint.textContent = hint.dataset.defaultText || hint.textContent;
  }
  updateSelectionHint(grid);
  return true;
}

function startAnalysis() {
  analysisRows.forEach((row, index) => {
    row.classList.toggle("active", index === 0);
  });
  showScreen(5);

  window.clearTimeout(analysisTimer);
  analysisTimer = window.setTimeout(() => {
    analysisRows.forEach((row) => row.classList.add("active"));
    analysisTimer = window.setTimeout(() => showScreen(6), 900);
  }, 850);
}

document.querySelectorAll("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    const screen = button.closest(".onboarding-screen");
    if (!screen || !canContinue(screen)) return;
    showScreen(Number(screen.dataset.screen) + 1);
  });
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    showScreen(Math.max(0, currentScreen - 1));
  });
});

document.querySelector("#analyse-button").addEventListener("click", () => {
  const screen = document.querySelector('[data-screen="4"]');
  if (canContinue(screen)) startAnalysis();
});

document.querySelector("#retake-button").addEventListener("click", () => {
  window.clearTimeout(analysisTimer);
  showScreen(1);
});

async function initialiseOnboarding() {

  await checkUserSession();

  if (!currentUser) {
    return;
  }

  showScreen(0);

}


initialiseOnboarding();