// Shared browser client. Passwords and email credentials stay on the server.
window.careerAuth = {
  pendingRequests: new Map(),
  async request(endpoint, body) {
    const pending = window.careerAuth.pendingRequests;
    const operation = Symbol('request');
    const notifyLoading = () => {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' &&
          typeof window.Event === 'function') {
        document.dispatchEvent(new window.Event('career:loading-change'));
      }
    };
    pending.set(operation, body === undefined ? 'Loading…' : 'Working on your request…');
    notifyLoading();
    try {
      const isUpload = body instanceof FormData;
      const response = await fetch(`/api/${endpoint}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers: body === undefined || isUpload ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : isUpload ? body : JSON.stringify(body)
      });
      const data = await response.json();
      return response.ok ? { data, error: null } : { data: {}, error: { message: data.error || "Unable to complete this request.", code: data.code } };
    } catch {
      return { data: {}, error: { message: "Unable to connect. Please try again." } };
    } finally {
      pending.delete(operation);
      notifyLoading();
    }
  },
  signUp({ email, password, options }) { return this.request("register", { email, password, name: options.data.display_name, terms: true }); },
  signInWithPassword(body) { return this.request("login", body); },
  async getSession() {
    const result = await this.request("session");
    if (!result.error) {
      this.authenticatedUser = result.data?.session?.user || null;
      this.applyPreferences(this.authenticatedUser?.preferences);
    }
    return result;
  },
  getUser() { return this.getSession(); },
  async signOut() {
    const result = await this.request("logout", {});
    if (!result.error) this.authenticatedUser = null;
    return result;
  },
  applyPreferences(preferences) {
    if (!preferences || typeof document === "undefined") return;
    const root = document.documentElement;
    if (preferences.theme === "light" || preferences.theme === "dark") {
      root.dataset.theme = preferences.theme;
      try { localStorage.setItem("careerkraft-theme", preferences.theme); } catch {}
      document.querySelectorAll('[id$="-theme-toggle"]').forEach(button => {
        const label = `Switch to ${preferences.theme === "dark" ? "light" : "dark"} mode`;
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        button.setAttribute("aria-pressed", String(preferences.theme === "dark"));
      });
    }
    if (typeof preferences.reducedMotion === "boolean") {
      root.dataset.reducedMotion = String(preferences.reducedMotion);
      try { localStorage.setItem("careerkraft-reduced-motion", String(preferences.reducedMotion)); } catch {}
    }
    const accessibility = window.careerAccessibility;
    if (accessibility && Object.keys(accessibility.defaults).some(key => Object.hasOwn(preferences, key))) {
      accessibility.apply({ ...accessibility.read(), ...preferences });
    }
  },
  resend({ email }) { return this.request("resend", { email }); },
  resetPasswordForEmail(email) { return this.request("forgot-password", { email }); },
  settingsReturnUrl() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (!next) return null;
    try {
      const target = new URL(next, window.location.href);
      if (target.origin !== window.location.origin || target.pathname !== "/settings.html" || target.username || target.password) return null;
      const destination = new URL("settings.html", window.location.href);
      const emailToken = target.searchParams.get("emailToken");
      if (emailToken && /^[a-f0-9]{64}$/.test(emailToken)) destination.searchParams.set("emailToken", emailToken);
      return destination;
    } catch { return null; }
  },
  async signInWithOAuth() {
    const next = this.settingsReturnUrl();
    const finishLoading = window.careerLoading?.begin?.('Opening Google sign-in…');
    const navigationTimeout = finishLoading ? window.setTimeout(finishLoading, 30000) : null;
    try {
      window.location.assign(next ? `/api/google?next=${encodeURIComponent(next.pathname + next.search)}` : "/api/google");
    } catch (error) {
      if (navigationTimeout !== null) window.clearTimeout(navigationTimeout);
      finishLoading?.();
      throw error;
    }
    return { data: {}, error: null };
  }
};

// Account preferences also apply when returning to the rest of the app.
(() => {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.dataset.reducedMotion = localStorage.getItem("careerkraft-reduced-motion") || "false";
  } catch {}
  const style = document.createElement("style");
  style.textContent = `
    :root[data-reduced-motion="true"], :root[data-reduced-motion="true"] * { scroll-behavior: auto !important; }
    :root[data-reduced-motion="true"] *, :root[data-reduced-motion="true"] *::before, :root[data-reduced-motion="true"] *::after {
      animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important;
    }
    :root[data-reduced-motion="true"] :is(.cursor, .cursor-dot) { display: none !important; }
    :root[data-reduced-motion="true"] [data-reveal] { opacity: 1 !important; transform: none !important; }
  `;
  document.head.append(style);
  document.addEventListener("click", event => {
    if (!event.target.closest?.('[id$="-theme-toggle"], #theme-toggle') || !window.careerAuth.authenticatedUser) return;
    window.careerAuth.request("settings/preferences", {
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      reducedMotion: document.documentElement.dataset.reducedMotion === "true"
    });
  });
})();
