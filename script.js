(() => {
  "use strict";

  const root = document.documentElement;
  const themeToggle = document.querySelector("#theme-toggle");
  const applyTheme = (theme) => {
    const isDark = theme === "dark";
    root.dataset.theme = isDark ? "dark" : "light";

    try {
      window.localStorage.setItem("careerkraft-theme", root.dataset.theme);
    } catch {
      // Theme switching remains available when browser storage is blocked.
    }

    if (themeToggle) {
      const label = `Switch to ${isDark ? "light" : "dark"} mode`;
      themeToggle.setAttribute("aria-pressed", String(isDark));
      themeToggle.setAttribute("aria-label", label);
      themeToggle.setAttribute("title", label);
    }
  };

  let storedTheme = "light";
  try {
    storedTheme = window.localStorage.getItem("careerkraft-theme") || "light";
  } catch {
    // The default theme also works in private or restricted browsing contexts.
  }
  applyTheme(storedTheme);
  themeToggle?.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });

  const navbar = document.querySelector("#navbar");
  if (navbar) {
    const updateNavbar = () => {
      navbar.classList.toggle("is-scrolled", window.scrollY > 20);
    };
    updateNavbar();
    window.addEventListener("scroll", updateNavbar, { passive: true });
  }

  const menuToggle = document.querySelector("#menu-toggle");
  const navigation = document.querySelector("#intro-navigation");
  if (menuToggle && navigation) {
    const setMenuOpen = (isOpen) => {
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
      navigation.classList.toggle("is-open", isOpen);
    };

    menuToggle.setAttribute("aria-controls", navigation.id);
    setMenuOpen(false);
    menuToggle.addEventListener("click", () => {
      setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
    });
    navigation.addEventListener("click", (event) => {
      if (event.target.closest("a")) setMenuOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        setMenuOpen(false);
        menuToggle.focus();
      }
    });
  }

  const previewTabs = Array.from(document.querySelectorAll("[data-preview-tab]"));
  const previewPanels = Array.from(document.querySelectorAll("[data-preview-panel]"));
  const selectPreview = (tab, moveFocus = false) => {
    const panelId = tab.getAttribute("aria-controls");
    if (!previewPanels.some((panel) => panel.id === panelId)) return;

    previewTabs.forEach((item) => {
      const isSelected = item === tab;
      item.setAttribute("aria-selected", String(isSelected));
      item.tabIndex = isSelected ? 0 : -1;
    });
    previewPanels.forEach((panel) => {
      panel.hidden = panel.id !== panelId;
    });
    if (moveFocus) tab.focus();
  };

  previewTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectPreview(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % previewTabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + previewTabs.length) % previewTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = previewTabs.length - 1;
      else return;

      event.preventDefault();
      selectPreview(previewTabs[nextIndex], true);
    });
  });
  if (previewTabs.length) {
    selectPreview(previewTabs.find((tab) => tab.getAttribute("aria-selected") === "true") || previewTabs[0]);
  }

  const prefersReducedMotion = root.dataset.reducedMotion === "true" || (typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  if (typeof window.IntersectionObserver === "function" && !prefersReducedMotion) {
    const observer = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    root.classList.add("intro-enhanced");
    document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
  }

  const earlyAccessForm = document.querySelector("#early-access-form");
  const emailInput = document.querySelector("#early-access-email");
  const formStatus = document.querySelector("#early-access-status");
  const submitButton = earlyAccessForm?.querySelector('button[type="submit"]');

  if (earlyAccessForm && emailInput && submitButton && formStatus) {
    let isSubmitting = false;
    earlyAccessForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (isSubmitting || !earlyAccessForm.reportValidity()) return;

      const email = emailInput.value.trim().toLowerCase();
      if (!email) return;

      const originalButtonContent = submitButton.innerHTML;
      isSubmitting = true;
      submitButton.disabled = true;
      earlyAccessForm.setAttribute("aria-busy", "true");
      submitButton.textContent = "Joining…";
      formStatus.textContent = "";
      formStatus.removeAttribute("data-state");

      try {
        if (typeof window.careerAuth?.request !== "function") {
          throw new Error("Unable to connect. Please refresh the page and try again.");
        }

        const { error } = await window.careerAuth.request("early-access", { email });
        if (error?.code === "duplicate_email") {
          formStatus.textContent = "You are already on the list.";
          formStatus.dataset.state = "success";
        } else if (error) {
          formStatus.textContent = error.message || "Unable to join right now. Please try again.";
          formStatus.dataset.state = "error";
        } else {
          formStatus.textContent = "You are on the list. Thank you for helping shape CareerKraft.";
          formStatus.dataset.state = "success";
          emailInput.value = "";
        }
      } catch {
        formStatus.textContent = "Unable to connect. Please try again in a moment.";
        formStatus.dataset.state = "error";
      } finally {
        isSubmitting = false;
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonContent;
        earlyAccessForm.removeAttribute("aria-busy");
      }
    });
  }

})();
