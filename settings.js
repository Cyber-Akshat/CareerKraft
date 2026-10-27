(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const auth = window.careerAuth;
  const accessibility = window.careerAccessibility;
  const accessibilityControls = {
    dyslexiaFont: "dyslexia-font", fontSize: "font-size", contrast: "contrast",
    saturation: "saturation", cursorSize: "cursor-size"
  };
  const content = byId("settings-content");
  let settings = null;
  let selectedAvatar = null;
  let avatarPreviewUrl = null;
  let selectedCharacterId = null;
  let savingCharacter = false;
  let deleting = false;
  const characters = Array.isArray(window.careerAvatarCharacters)
    ? window.careerAvatarCharacters.filter(character => character && /^[a-z][a-z0-9-]*$/.test(character.id) && typeof character.name === "string" && typeof character.description === "string" && safeImageUrl(character.imageUrl))
    : [];
  const query = new URL(window.location.href);
  const emailToken = query.searchParams.get("emailToken");
  const googleResult = query.searchParams.get("google");
  const googleError = query.searchParams.get("error") || query.searchParams.get("google_error");
  ["emailToken", "google", "error", "google_error"].forEach(key => query.searchParams.delete(key));
  if (window.location.href !== query.href) window.history.replaceState(null, "", query.pathname + query.search + query.hash);

  function message(element, text = "", error = false) {
    element.textContent = text;
    element.classList.toggle("is-error", error);
    if (element === byId("page-status")) element.hidden = !text;
  }

  function pageMessage(text, error = false) { message(byId("page-status"), text, error); }
  function formMessage(form, text, error = false) { message(form.querySelector(".form-status"), text, error); }

  async function request(endpoint, body) {
    const result = await auth.request(endpoint, body);
    if (result.error) {
      if (result.error.code === "reauth_required" && settings) {
        settings.securityVerified = false;
        renderSecurity();
      }
      const error = new Error(result.error.message || "We couldn't save that change. Please try again.");
      error.code = result.error.code;
      throw error;
    }
    return result.data || {};
  }

  function applyResult(data) {
    if (data.settings) settings = { ...settings, ...data.settings };
    renderAccount();
  }

  function safeImageUrl(value) {
    if (!value || typeof value !== "string") return "";
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function renderAvatar() {
    const image = byId("profile-avatar");
    const url = avatarPreviewUrl || safeImageUrl(settings?.avatarUrl);
    const character = characters.find(choice => choice.id === settings?.avatarCharacter);
    image.hidden = !url;
    image.alt = selectedAvatar ? "Profile photo preview" : character ? `${character.name}, your profile character` : "Your profile picture";
    byId("avatar-initials").hidden = !!url;
    if (url) image.src = url;
    else image.removeAttribute("src");
    byId("remove-avatar").disabled = !settings?.avatarUrl || !!selectedAvatar;
    byId("avatar-preview-actions").hidden = !selectedAvatar;
    byId("choose-character").disabled = !characters.length;
    byId("choose-character").title = characters.length ? "" : "Character choices couldn't load. Refresh the page to try again.";
    byId("avatar-character-summary").hidden = !character || !!selectedAvatar;
    byId("avatar-character-summary").textContent = character ? `Your character: ${character.name}` : "";
  }

  byId("profile-avatar").addEventListener("error", () => {
    byId("profile-avatar").hidden = true;
    byId("avatar-initials").hidden = false;
  });

  function renderSecurity() {
    if (!settings) return;
    const hasPassword = !!settings.hasPassword;
    const verified = hasPassword || !!settings.securityVerified;
    document.querySelectorAll("[data-password-required]").forEach(group => {
      group.hidden = !hasPassword;
      group.querySelectorAll("input").forEach(input => { input.required = hasPassword; });
    });
    document.querySelectorAll("[data-sensitive]").forEach(button => { button.disabled = !verified; });
    byId("google-identity").hidden = hasPassword;
    byId("identity-title").textContent = verified ? "Identity confirmed" : "Confirm it's you";
    byId("identity-copy").textContent = verified
      ? "Your Google identity was recently confirmed. You can now make sensitive account changes."
      : "Confirm with Google before changing your email, setting a password or deleting your account.";
    byId("verify-google").hidden = verified;
    byId("verify-google").disabled = !settings.googleConfigured || !settings.googleLinked;
    byId("password-summary").textContent = hasPassword ? "A password is set for your account." : "You sign in with Google. Add a password to sign in with email too.";
    byId("password-edit-button").textContent = hasPassword ? "Change" : "Set password";
    byId("save-password").textContent = hasPassword ? "Update password" : "Set password";
    byId("google-badge").hidden = !settings.googleLinked;
    byId("google-connect").hidden = !!settings.googleLinked;
    byId("google-connect").disabled = !settings.googleConfigured;
    byId("google-unlink-edit").hidden = !settings.googleLinked;
    byId("google-unlink-edit").disabled = !hasPassword;
    byId("google-summary").textContent = settings.googleLinked
      ? (hasPassword ? "Sign in with Google or your email and password." : "Google is your sign-in method. Set a password before disconnecting.")
      : settings.googleConfigured ? "Connect Google for an easier way to sign in." : "Google sign-in isn't configured on this server yet.";
    if (settings.googleLinked && !hasPassword && !settings.googleConfigured) {
      byId("identity-copy").textContent = "Google sign-in isn't configured on this server. Contact the administrator to restore Google before making sensitive account changes.";
    }
    byId("delete-identity-hint").hidden = verified;
    updateDeleteButton();
  }

  function renderAccount() {
    if (!settings) return;
    const name = settings.displayName || "Your profile";
    byId("profile-name").textContent = name;
    byId("profile-email").textContent = settings.email || "";
    byId("display-name-value").textContent = settings.displayName || "Add your name";
    byId("email-value").textContent = settings.email || "";
    byId("avatar-initials").textContent = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
    const joined = new Date(settings.createdAt);
    byId("member-since").textContent = Number.isNaN(joined.getTime()) ? "Your CareerKraft journey" : joined.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    renderAvatar();
    renderSecurity();
  }

  function readStoredPreference(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function currentPreferences() {
    return {
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      reducedMotion: document.documentElement.dataset.reducedMotion === "true" || readStoredPreference("careerkraft-reduced-motion", "false") === "true",
      ...accessibility.read()
    };
  }

  function applyPreferences(preferences) {
    if (typeof auth.applyPreferences === "function") auth.applyPreferences(preferences);
    accessibility.apply(preferences);
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.reducedMotion = String(preferences.reducedMotion);
    try {
      localStorage.setItem("careerkraft-theme", preferences.theme);
      localStorage.setItem("careerkraft-reduced-motion", String(preferences.reducedMotion));
    } catch {}
  }

  function populatePreferences() {
    const saved = currentPreferences();
    const hasSavedPreferences = ["light", "dark"].includes(settings.theme);
    const preferences = {
      theme: hasSavedPreferences ? settings.theme : saved.theme,
      reducedMotion: hasSavedPreferences && typeof settings.reducedMotion === "boolean" ? settings.reducedMotion : saved.reducedMotion,
      ...accessibility.normalize(hasSavedPreferences ? settings : saved)
    };
    byId("preferences-form").querySelector(`input[name="theme"][value="${preferences.theme}"]`).checked = true;
    byId("reduced-motion").checked = preferences.reducedMotion;
    populateAccessibility(preferences);
    applyPreferences(preferences);
  }

  function populateAccessibility(preferences) {
    Object.entries(accessibilityControls).forEach(([key, id]) => {
      const control = byId(id);
      if (control.type === "checkbox") control.checked = preferences[key];
      else control.value = preferences[key];
    });
  }

  function accessibilityPreferences() {
    return accessibility.normalize(Object.fromEntries(Object.entries(accessibilityControls).map(([key, id]) => {
      const control = byId(id);
      return [key, control.type === "checkbox" ? control.checked : control.value];
    })));
  }

  function previewAccessibility() {
    accessibility.apply(accessibilityPreferences());
    formMessage(byId("preferences-form"), "Preview updated in this browser. Save preferences to keep these settings on your account.");
  }

  Object.values(accessibilityControls).forEach(id => byId(id).addEventListener("change", previewAccessibility));
  byId("reset-accessibility").addEventListener("click", () => {
    populateAccessibility(accessibility.defaults);
    previewAccessibility();
  });

  async function pending(scope, status, action, label) {
    const controls = [...scope.querySelectorAll("button, input, select")];
    if (scope.matches("button")) controls.push(scope);
    const previous = controls.map(control => [control, control.disabled]);
    const button = scope.matches("button") ? scope : scope.querySelector('button[type="submit"]');
    const previousText = button?.textContent;
    controls.forEach(control => { control.disabled = true; });
    scope.setAttribute("aria-busy", "true");
    if (label && button) button.textContent = label;
    message(status, "");
    try { await action(); }
    catch (error) { message(status, error.message || "Something went wrong. Please try again.", true); }
    finally {
      previous.forEach(([control, disabled]) => { control.disabled = disabled; });
      scope.removeAttribute("aria-busy");
      if (label && button) button.textContent = previousText;
      if (settings) { renderAvatar(); renderSecurity(); }
    }
  }

  function closeEditor(form) {
    form.hidden = true;
    form.reset();
    formMessage(form, "");
    const button = document.querySelector(`[data-editor="${form.id}"]`);
    button.setAttribute("aria-expanded", "false");
    button.focus();
  }

  document.querySelectorAll(".edit-button").forEach(button => button.addEventListener("click", () => {
    const editor = byId(button.dataset.editor);
    if (!editor.hidden) { closeEditor(editor); return; }
    if (editor.id === "name-editor") byId("display-name").value = settings.displayName || "";
    if (editor.id === "email-editor") byId("new-email").value = settings.email || "";
    editor.hidden = false;
    button.setAttribute("aria-expanded", "true");
    editor.querySelector("input:not([disabled])")?.focus();
  }));
  document.querySelectorAll(".cancel-editor").forEach(button => button.addEventListener("click", () => closeEditor(button.closest("form"))));

  byId("name-editor").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const displayName = byId("display-name").value.trim();
    if (!displayName) { formMessage(form, "Enter a display name.", true); return; }
    pending(form, form.querySelector(".form-status"), async () => {
      applyResult(await request("settings/profile", { displayName }));
      closeEditor(form);
      pageMessage("Your display name has been updated.");
    }, "Saving…");
  });

  byId("email-editor").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { email: byId("new-email").value.trim(), currentPassword: byId("email-password").value };
    pending(form, form.querySelector(".form-status"), async () => {
      const result = await request("settings/email", body);
      applyResult(result);
      byId("email-password").value = "";
      formMessage(form, result.message || `A verification email has been sent to ${result.pendingEmail || body.email}. Confirm the link to finish changing your address.`);
    }, "Sending…");
  });

  byId("password-editor").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const newPassword = byId("new-password").value;
    if (newPassword.length < 15 || newPassword.length > 128) { formMessage(form, "Use a password with 15–128 characters.", true); return; }
    if (byId("new-password").value !== byId("confirm-password").value) { formMessage(form, "Your new passwords don't match.", true); byId("confirm-password").focus(); return; }
    const body = { currentPassword: byId("current-password").value, newPassword };
    pending(form, form.querySelector(".form-status"), async () => {
      applyResult(await request("settings/password", body));
      closeEditor(form);
      pageMessage("Your password has been updated. Other sessions have been signed out.");
    }, "Saving…");
  });

  function openGoogle(url) {
    const finishLoading = window.careerLoading?.begin?.("Opening Google…");
    try {
      window.location.assign(url);
      if (finishLoading) window.setTimeout(finishLoading, 30000);
    } catch (error) {
      finishLoading?.();
      throw error;
    }
  }

  byId("google-link-editor").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const currentPassword = byId("link-password").value;
    pending(form, form.querySelector(".form-status"), async () => {
      const result = await request("settings/google/link", { currentPassword });
      applyResult(result);
      byId("link-password").value = "";
      if (result.url !== "/api/google?intent=link") throw new Error("We couldn't start your Google connection. Please try again.");
      openGoogle(result.url);
    }, "Connecting…");
  });
  byId("verify-google").addEventListener("click", () => openGoogle("/api/google?intent=reauth"));
  byId("google-unlink-editor").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const currentPassword = byId("unlink-password").value;
    pending(form, form.querySelector(".form-status"), async () => {
      applyResult(await request("settings/google/unlink", { currentPassword }));
      closeEditor(form);
      byId("google-connect").focus();
      pageMessage("Google has been disconnected. Use your email and password to sign in.");
    }, "Disconnecting…");
  });

  function clearAvatarPreview() {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = null;
    selectedAvatar = null;
    byId("avatar-file").value = "";
    renderAvatar();
  }

  const characterDialog = byId("character-dialog");

  function updateCharacterPreview() {
    const character = characters.find(choice => choice.id === selectedCharacterId);
    byId("character-preview").hidden = !character;
    byId("save-character").disabled = !character || savingCharacter;
    if (!character) return;
    byId("character-preview-image").src = safeImageUrl(character.imageUrl);
    byId("character-preview-image").alt = character.name;
    byId("character-preview-name").textContent = character.name;
    byId("character-preview-description").textContent = character.description;
  }

  function renderCharacterOptions() {
    const grid = byId("character-grid");
    grid.replaceChildren();
    for (const character of characters) {
      const option = document.createElement("label");
      option.className = "character-option";
      const radio = document.createElement("input");
      radio.className = "sr-only";
      radio.type = "radio";
      radio.name = "avatarCharacter";
      radio.value = character.id;
      radio.checked = character.id === selectedCharacterId;
      radio.setAttribute("aria-labelledby", `character-name-${character.id}`);
      radio.setAttribute("aria-describedby", `character-description-${character.id}`);
      const card = document.createElement("span");
      card.className = "character-card";
      const selectedMark = document.createElement("span");
      selectedMark.className = "character-selection-mark";
      selectedMark.setAttribute("aria-hidden", "true");
      selectedMark.textContent = "✓";
      const image = document.createElement("img");
      image.src = safeImageUrl(character.imageUrl);
      image.alt = "";
      image.width = 128;
      image.height = 128;
      const name = document.createElement("span");
      name.id = `character-name-${character.id}`;
      name.className = "character-card-name";
      name.textContent = character.name;
      const description = document.createElement("span");
      description.id = `character-description-${character.id}`;
      description.className = "character-card-description";
      description.textContent = character.description;
      card.append(selectedMark, image, name, description);
      if (character.id === settings.avatarCharacter) {
        const current = document.createElement("span");
        current.className = "character-current-badge";
        current.textContent = "Current avatar";
        card.appendChild(current);
        radio.setAttribute("aria-describedby", `${description.id} character-current-${character.id}`);
        current.id = `character-current-${character.id}`;
      }
      radio.addEventListener("change", () => {
        if (savingCharacter || !radio.checked) return;
        selectedCharacterId = character.id;
        updateCharacterPreview();
        message(byId("character-status"), "");
      });
      option.append(radio, card);
      grid.appendChild(option);
    }
    updateCharacterPreview();
  }

  byId("choose-character").addEventListener("click", () => {
    if (!settings || !characters.length) return;
    selectedCharacterId = characters.some(character => character.id === settings.avatarCharacter) ? settings.avatarCharacter : characters[0].id;
    message(byId("character-status"), "");
    renderCharacterOptions();
    characterDialog.showModal();
    byId("character-grid").querySelector("input:checked")?.focus();
  });
  byId("cancel-character").addEventListener("click", () => { if (!savingCharacter) characterDialog.close(); });
  characterDialog.addEventListener("cancel", event => { if (savingCharacter) event.preventDefault(); });
  characterDialog.addEventListener("close", () => {
    selectedCharacterId = null;
    updateCharacterPreview();
    byId("choose-character").focus();
  });
  byId("character-form").addEventListener("submit", async event => {
    event.preventDefault();
    const character = characters.find(choice => choice.id === selectedCharacterId);
    if (!character || savingCharacter) return;
    savingCharacter = true;
    await pending(event.currentTarget, byId("character-status"), async () => {
      const result = await request("settings/avatar/character", { characterId: character.id });
      applyResult(result);
      clearAvatarPreview();
      message(byId("avatar-status"), `${character.name} is now your profile character.`);
      characterDialog.close();
    }, "Saving…");
    savingCharacter = false;
    updateCharacterPreview();
  });

  ["choose-avatar", "change-avatar"].forEach(id => byId(id).addEventListener("click", () => byId("avatar-file").click()));
  byId("avatar-file").addEventListener("change", () => {
    const file = byId("avatar-file").files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) {
      byId("avatar-file").value = "";
      message(byId("avatar-status"), "Choose a JPG, PNG or WebP image up to 2 MB.", true);
      return;
    }
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    selectedAvatar = file;
    avatarPreviewUrl = URL.createObjectURL(file);
    renderAvatar();
    message(byId("avatar-status"), "Preview ready. Save your photo to update your profile.");
  });
  byId("cancel-avatar").addEventListener("click", () => { clearAvatarPreview(); message(byId("avatar-status"), ""); byId("change-avatar").focus(); });
  byId("save-avatar").addEventListener("click", () => {
    if (!selectedAvatar) return;
    const body = new FormData();
    body.append("avatar", selectedAvatar);
    pending(document.querySelector(".profile-hero"), byId("avatar-status"), async () => {
      applyResult(await request("settings/avatar", body));
      clearAvatarPreview();
      message(byId("avatar-status"), "Your profile photo has been updated.");
    });
  });
  byId("remove-avatar").addEventListener("click", () => pending(document.querySelector(".profile-hero"), byId("avatar-status"), async () => {
    applyResult(await request("settings/avatar/remove", {}));
    message(byId("avatar-status"), "Your profile picture has been removed.");
  }));

  byId("preferences-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.getAttribute("aria-busy") === "true") return;
    const preferences = {
      theme: form.querySelector('input[name="theme"]:checked').value,
      reducedMotion: byId("reduced-motion").checked,
      ...accessibilityPreferences()
    };
    pending(form, form.querySelector(".form-status"), async () => {
      let result;
      try { result = await request("settings/preferences", preferences); }
      catch (error) {
        throw new Error(`${error.message} Your accessibility preview is still active in this browser. Save preferences to keep these settings on your account.`);
      }
      applyResult(result);
      applyPreferences(preferences);
      formMessage(form, "Your preferences have been saved.");
    }, "Saving…");
  });

  byId("revoke-sessions").addEventListener("click", event => pending(event.currentTarget, byId("sessions-status"), async () => {
    await request("settings/sessions/revoke", {});
    message(byId("sessions-status"), "Other sessions have been signed out. You're still signed in here.");
  }, "Signing out…"));

  byId("export-data").addEventListener("click", event => pending(event.currentTarget, byId("export-status"), async () => {
    const data = await request("settings/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `careerkraft-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(byId("export-status"), "Your data download has started.");
  }, "Preparing…"));

  byId("sign-out").addEventListener("click", event => pending(event.currentTarget, byId("signout-status"), async () => {
    const result = await auth.signOut();
    if (result.error) throw new Error(result.error.message);
    window.location.assign("auth.html");
  }, "Signing out…"));

  function updateDeleteButton() {
    byId("confirm-delete").disabled = deleting || !settings || byId("delete-confirmation").value !== "DELETE" || (settings.hasPassword ? !byId("delete-password").value : !settings.securityVerified);
  }

  const dialog = byId("delete-dialog");
  byId("open-delete").addEventListener("click", () => {
    byId("delete-form").reset();
    message(byId("delete-status"), "");
    renderSecurity();
    dialog.showModal();
    byId("delete-confirmation").focus();
  });
  byId("cancel-delete").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (deleting) event.preventDefault(); });
  dialog.addEventListener("close", () => { byId("delete-form").reset(); byId("open-delete").focus(); });
  ["delete-confirmation", "delete-password"].forEach(id => byId(id).addEventListener("input", updateDeleteButton));
  byId("delete-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (byId("confirm-delete").disabled) return;
    const body = { currentPassword: byId("delete-password").value, confirmation: byId("delete-confirmation").value };
    deleting = true;
    await pending(event.currentTarget, byId("delete-status"), async () => {
      await request("settings/delete", body);
      window.location.assign("auth.html?account=deleted");
    }, "Deleting…");
    deleting = false;
    updateDeleteButton();
  });

  const googleErrors = {
    google_not_configured: "Google sign-in isn't configured on this server yet.",
    google_unconfigured: "Google sign-in isn't configured on this server yet.",
    google_not_linked: "Connect a Google account before confirming your identity with Google.",
    google_wrong_account: "Choose the Google account already linked to your CareerKraft account.",
    reauth_required: "Confirm your identity again before connecting Google.",
    google_verification_required: "Confirm your current password again before connecting Google.",
    google_cancelled: "Google connection was cancelled. Your account hasn't changed.",
    google_denied: "Google connection was cancelled. Your account hasn't changed.",
    google_already_linked: "Your account already has a different Google account connected. Disconnect it before connecting another.",
    google_account_in_use: "That Google account is already connected to another CareerKraft account.",
    google_email_mismatch: "Choose the Google account that matches your CareerKraft email address.",
    google_identity_mismatch: "Choose the Google account already linked to your CareerKraft account.",
    google_state: "Your Google request expired. Please try connecting again.",
    google_failed: "We couldn't connect to Google. Please try again."
  };

  async function loadSettings() {
    content.disabled = true;
    content.setAttribute("aria-busy", "true");
    byId("retry-load").hidden = true;
    pageMessage("Loading your account…");
    try {
      if (!auth) throw new Error("The account service couldn't load. Refresh the page and try again.");
      const session = await auth.getSession();
      if (session.error) throw new Error(session.error.message || "We couldn't load your session. Please try again.");
      if (!session.data?.session?.user) {
        const next = emailToken ? `settings.html?emailToken=${encodeURIComponent(emailToken)}` : "settings.html";
        window.location.replace(`auth.html?next=${encodeURIComponent(next)}`);
        return;
      }
      const data = await request("settings");
      if (!data.settings) throw new Error("We couldn't load your account settings. Please try again.");
      settings = data.settings;
      renderAccount();
      populatePreferences();
      byId("completed-stat").textContent = String(data.stats?.completedActivities ?? 0);
      byId("skills-stat").textContent = String(data.stats?.verifiedSkills ?? 0);
      content.disabled = false;
      content.setAttribute("aria-busy", "false");
      pageMessage("");
      if (emailToken) {
        try {
          applyResult(await request("settings/email/confirm", { token: emailToken }));
          pageMessage("Your new email address has been confirmed.");
        } catch (error) { pageMessage(error.message, true); }
      } else if (googleError) pageMessage(googleErrors[googleError] || "Your Google request couldn't be completed. Please try again.", true);
      else if (googleResult === "linked") pageMessage("Google is now connected to your account.");
      else if (googleResult === "verified") pageMessage("Your identity has been confirmed with Google.");
    } catch (error) {
      pageMessage(error.message || "We couldn't load your account. Please try again.", true);
      byId("retry-load").hidden = false;
      content.setAttribute("aria-busy", "false");
    }
  }

  byId("retry-load").addEventListener("click", loadSettings);
  window.addEventListener("pagehide", () => { if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl); });
  loadSettings();
})();
