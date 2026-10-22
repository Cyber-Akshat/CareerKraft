const authThemeToggle =
  document.querySelector("#auth-theme-toggle");

function updateThemeToggle(theme) {
  const nextLabel =
    theme === "light"
      ? "Switch to dark mode"
      : "Switch to light mode";

  authThemeToggle.setAttribute("aria-label", nextLabel);
  authThemeToggle.setAttribute("title", nextLabel);
  authThemeToggle.setAttribute(
    "aria-pressed",
    String(theme === "dark")
  );
}

updateThemeToggle(document.documentElement.dataset.theme);

authThemeToggle.addEventListener(
  "click",
  () => {
    const nextTheme =
      document.documentElement.dataset.theme === "light"
        ? "dark"
        : "light";

    document.documentElement.dataset.theme =
      nextTheme;
    try {
      localStorage.setItem("careerkraft-theme", nextTheme);
    } catch {
      // Theme switching also works when browser storage is unavailable.
    }
    updateThemeToggle(nextTheme);
  }
);
