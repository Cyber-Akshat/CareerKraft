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
    String(theme === "light")
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
    localStorage.setItem("careerkraft-theme", nextTheme);
    updateThemeToggle(nextTheme);
  }
);
