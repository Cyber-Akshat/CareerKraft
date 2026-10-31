(() => {
    "use strict";
    const documentRoot = document.getElementById("cvDocument");
    if (!documentRoot) return;

    const BUILD_KEY = "careerkraft-cv-build";
    const FINAL_KEY = "careerkraft-final-cv";
    const MAX_TEXT = 20000;
    const fields = ["name", "headline", "contact", "profile", "education", "experience", "projects", "skills", "certifications"];
    const arrays = new Set(["contact", "education", "experience", "projects", "skills", "certifications"]);
    const statuses = new Set(["pending", "accepted", "edited", "rejected"]);
    const elements = Object.fromEntries([
        "suggestionProgressText", "suggestionProgressFill", "acceptedCount", "editedCount", "rejectedCount",
        "suggestionCounter", "previousSuggestionButton", "nextSuggestionButton", "suggestionType", "suggestionSection",
        "originalText", "suggestedText", "suggestionReason", "evidenceCard", "evidenceChips", "acceptButton", "editButton",
        "rejectButton", "editArea", "editSuggestionInput", "cancelEditButton", "saveEditButton", "suggestionActions",
        "decisionState", "finishButton", "backToResultsButton"
    ].map(id => [id, document.getElementById(id)]));
    const cvElements = Object.fromEntries(fields.map(field => [field,
        document.getElementById(`cv${field[0].toUpperCase()}${field.slice(1)}`)]));
    if (Object.values(elements).some(element => !element) || Object.values(cvElements).some(element => !element)) return;
    const sections = Object.fromEntries(fields.map(field => [field,
        ["name", "headline", "contact"].includes(field) ? documentRoot.querySelector(".cv-header") : cvElements[field].closest(".cv-section")]));
    const progressTrack = elements.suggestionProgressFill.closest('[role="progressbar"]');
    const suggestionPanel = document.querySelector(".suggestion-panel");
    const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const clean = value => typeof value === "string" ? value.trim() : "";
    const positiveId = value => Number.isSafeInteger(value) && value > 0;
    const validString = (value, max) => typeof value === "string" && value.length <= max;
    const fieldFor = section => fields.find(field => field === clean(section).toLowerCase());
    const copy = value => JSON.parse(JSON.stringify(value));
    const normalise = value => clean(value)
        .replace(/^(?:[•*]|[-–—](?!\s*[+\-−]?\s*\d)|\d+[.)])\s+/u, "")
        .replace(/\s+/g, " ").toLowerCase();

    let buildData = null;
    let currentIndex = 0;
    let busy = false;
    let editing = false;
    let active = true;
    let generation = 0;
    let scrollTimer = null;
    let saveController = null;

    function show(element, visible) {
        element.hidden = !visible;
        element.classList.toggle("hidden", !visible);
    }

    function readableError(error, fallback) {
        return error instanceof Error && error.message ? error.message : fallback;
    }

    function validateBuild(value) {
        if (!record(value) || !positiveId(value.buildId) || !record(value.structuredCv) ||
            !Array.isArray(value.suggestions) || value.suggestions.length > 20) throw new Error("Invalid CV build.");
        const requested = new URLSearchParams(window.location.search).getAll("build");
        if (requested.length > 1 || (requested.length === 1 &&
            (!/^[1-9]\d*$/.test(requested[0]) || Number(requested[0]) !== value.buildId))) throw new Error("Invalid CV build link.");
        const cv = {};
        for (const field of fields) {
            const item = value.structuredCv[field];
            if (arrays.has(field)) {
                if (!Array.isArray(item) || item.length > 50 || !item.every(text => validString(text, MAX_TEXT))) throw new Error("Invalid CV section.");
                cv[field] = item.slice();
            } else {
                if (!validString(item, field === "profile" ? MAX_TEXT : 255)) throw new Error("Invalid CV field.");
                cv[field] = item;
            }
        }
        const ids = new Set();
        const suggestions = value.suggestions.map((item, index) => {
            if (!record(item) || !validString(item.sectionName, 100) || !clean(item.sectionName) ||
                !validString(item.suggestionType, 100) || !validString(item.suggestedText, 2000) || !clean(item.suggestedText) ||
                !validString(item.reason, 1000) || !Array.isArray(item.evidence) || item.evidence.length > 10 ||
                !item.evidence.every(proof => validString(proof, 2000)) ||
                (item.originalText != null && !validString(item.originalText, 2000))) throw new Error("Invalid CV suggestion.");
            const status = item.status === undefined ? "pending" : item.status;
            if (!statuses.has(status) || (item.finalText != null && !validString(item.finalText, 2000)) ||
                (["accepted", "edited"].includes(status) && !clean(item.finalText))) throw new Error("Invalid CV decision.");
            // Old cached builds may lack IDs. They can still be read, but cannot
            // send a decision for an invented or undefined database record.
            if (positiveId(item.id)) {
                if (ids.has(item.id)) throw new Error("Duplicate CV suggestion.");
                ids.add(item.id);
            }
            return { ...item, originalText: item.originalText || "", status,
                finalText: item.finalText ?? null, sortOrder: item.sortOrder ?? index + 1 };
        });
        return { ...value, structuredCv: cv, suggestions };
    }

    function renderCv() {
        const cv = buildData.structuredCv;
        for (const field of fields) {
            const container = cvElements[field];
            if (!arrays.has(field) && field !== "profile") {
                container.textContent = cv[field];
                container.hidden = !clean(cv[field]);
                continue;
            }
            container.replaceChildren();
            const values = arrays.has(field) ? cv[field] : [cv[field]];
            for (const text of values.filter(value => clean(value))) {
                const node = document.createElement(field === "contact" ? "span" : "p");
                node.textContent = text;
                container.appendChild(node);
            }
            if (field === "contact") container.hidden = !container.children.length;
            else sections[field].hidden = !container.children.length;
        }
        sections.name.hidden = !["name", "headline", "contact"].some(field => arrays.has(field)
            ? cv[field].some(value => clean(value)) : clean(cv[field]));
    }

    function renderHighlights(item) {
        const uniqueSections = new Set(Object.values(sections));
        for (const section of uniqueSections) section.classList.remove("lumia-highlight", "change-accepted", "change-edited");
        for (const suggestion of buildData.suggestions) {
            const section = sections[fieldFor(suggestion.sectionName)];
            if (!section) continue;
            if (suggestion.status === "edited") {
                section.classList.remove("change-accepted");
                section.classList.add("change-edited");
            } else if (suggestion.status === "accepted" && !section.classList.contains("change-edited")) section.classList.add("change-accepted");
        }
        const section = item && sections[fieldFor(item.sectionName)];
        if (section && item.status === "pending") {
            section.hidden = false;
            section.classList.remove("change-accepted", "change-edited");
            section.classList.add("lumia-highlight");
        }
        return section;
    }

    function updateProgress() {
        const suggestions = buildData.suggestions;
        const counts = { accepted: 0, edited: 0, rejected: 0 };
        for (const item of suggestions) if (Object.hasOwn(counts, item.status)) counts[item.status]++;
        for (const status of Object.keys(counts)) elements[`${status}Count`].textContent = String(counts[status]);
        const reviewed = counts.accepted + counts.edited + counts.rejected;
        const percentage = suggestions.length ? Math.round(reviewed / suggestions.length * 100) : 100;
        elements.suggestionProgressText.textContent = suggestions.length ? `${reviewed} of ${suggestions.length} reviewed` : "No suggestions to review";
        elements.suggestionProgressFill.style.width = `${percentage}%`;
        progressTrack?.setAttribute("aria-valuenow", String(percentage));
    }

    function updateControls() {
        const total = buildData?.suggestions.length || 0;
        const item = buildData?.suggestions[currentIndex];
        const pending = item?.status === "pending";
        elements.previousSuggestionButton.disabled = busy || editing || currentIndex <= 0 || !total;
        elements.nextSuggestionButton.disabled = busy || editing || currentIndex >= total - 1 || !total;
        for (const name of ["acceptButton", "editButton", "rejectButton"]) elements[name].disabled = busy || editing || !pending;
        elements.saveEditButton.disabled = busy || !editing || !pending;
        elements.cancelEditButton.disabled = busy;
        elements.editSuggestionInput.disabled = busy;
        elements.finishButton.disabled = busy || editing || !buildData;
        elements.backToResultsButton.setAttribute("aria-disabled", String(busy));
        elements.suggestionActions.setAttribute("aria-busy", String(busy));
        elements.editArea.setAttribute("aria-busy", String(busy));
    }

    function renderSuggestion({ scroll = false } = {}) {
        editing = false;
        show(elements.editArea, false);
        show(elements.decisionState, false);
        elements.decisionState.classList.remove("accepted", "edited", "rejected");
        const item = buildData.suggestions[currentIndex];
        elements.suggestionCounter.textContent = item ? `${currentIndex + 1} / ${buildData.suggestions.length}` : "0 / 0";
        elements.suggestionSection.textContent = item?.sectionName || "";
        elements.suggestionType.textContent = item ? item.suggestionType.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()) : "Review complete";
        elements.originalText.textContent = item ? item.originalText || "This is a new addition." : "";
        elements.suggestedText.textContent = item ? (["accepted", "edited"].includes(item.status) ? item.finalText : item.suggestedText) : "No changes have been suggested for this CV.";
        elements.suggestionReason.textContent = item?.reason || "";
        elements.evidenceChips.replaceChildren();
        for (const proof of item?.evidence || []) {
            if (!clean(proof)) continue;
            const chip = document.createElement("span");
            chip.className = "evidence-chip";
            chip.textContent = proof;
            elements.evidenceChips.appendChild(chip);
        }
        show(elements.evidenceCard, elements.evidenceChips.children.length > 0);
        show(elements.suggestionActions, item?.status === "pending");
        if (item && item.status !== "pending") {
            elements.decisionState.textContent = ({ accepted: "✓ Suggestion accepted", edited: "✎ Your edited version will be used", rejected: "× Suggestion rejected" })[item.status];
            elements.decisionState.classList.add(item.status);
            show(elements.decisionState, true);
        }
        const section = renderHighlights(item);
        updateControls();
        clearTimeout(scrollTimer);
        if (scroll && section && item.status === "pending") {
            const version = generation;
            scrollTimer = setTimeout(() => {
                if (!active || version !== generation) return;
                const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
                section.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
            }, 100);
        }
        if (suggestionPanel) suggestionPanel.scrollTop = 0;
    }

    function changedCv(suggestion, finalText) {
        const field = fieldFor(suggestion.sectionName);
        if (!field) throw new Error("This suggestion couldn't be matched to a CV section. Please review it again.");
        if (!clean(finalText) || finalText.length > (["name", "headline"].includes(field) ? 255 : 2000)) throw new Error("Please enter a shorter, non-empty version of this suggestion.");
        const cv = copy(buildData.structuredCv);
        const original = suggestion.originalText;
        if (!original) {
            if (arrays.has(field)) {
                if (cv[field].some(text => normalise(text) === normalise(finalText))) throw new Error("This text is already in your CV.");
                if (cv[field].length >= 50) throw new Error("This section already has too many entries.");
                cv[field].push(finalText);
            } else {
                if (clean(cv[field])) throw new Error("This section has changed. Please review the suggestion again.");
                cv[field] = finalText;
            }
        } else if (arrays.has(field)) {
            const matches = cv[field].flatMap((text, index) => normalise(text) === normalise(original) ? [index] : []);
            if (matches.length !== 1) throw new Error("The original text couldn't be matched uniquely. Please review the suggestion again.");
            cv[field][matches[0]] = finalText;
        } else {
            if (normalise(cv[field]) !== normalise(original)) throw new Error("The original text has changed. Please review the suggestion again.");
            cv[field] = finalText;
        }
        return cv;
    }

    function moveToNextPending() {
        const count = buildData.suggestions.length;
        for (let offset = 1; offset < count; offset++) {
            const index = (currentIndex + offset) % count;
            if (buildData.suggestions[index].status === "pending") { currentIndex = index; break; }
        }
        renderCv();
        updateProgress();
        renderSuggestion({ scroll: true });
    }

    async function decide(status) {
        const suggestion = buildData?.suggestions[currentIndex];
        if (!active || busy || !suggestion || suggestion.status !== "pending" || (editing && status !== "edited")) return;
        const finalText = status === "rejected" ? suggestion.originalText : status === "edited" ? elements.editSuggestionInput.value.trim() : suggestion.suggestedText;
        if (status === "edited" && !finalText) { alert("Your edited version cannot be empty."); return; }
        let proposedCv;
        try {
            if (!positiveId(suggestion.id)) throw new Error("Please return to your results and prepare the CV improvements again before saving this review.");
            proposedCv = status === "rejected" ? copy(buildData.structuredCv) : changedCv(suggestion, finalText);
        } catch (error) { alert(readableError(error, "Could not prepare this decision.")); return; }

        busy = true;
        updateControls();
        const version = generation;
        const originalBuild = buildData;
        const index = currentIndex;
        const controller = new AbortController();
        saveController = controller;
        const deadline = setTimeout(() => controller.abort(), 30000);
        const stale = () => !active || generation !== version || buildData !== originalBuild;
        try {
            const response = await fetch(`/api/cv/build/${buildData.buildId}/suggestions/${suggestion.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
                body: JSON.stringify({ status, finalText }), signal: controller.signal
            });
            if (stale()) return;
            let result;
            try { result = await response.json(); }
            catch { throw new Error("CareerKraft received an invalid response while saving your review."); }
            if (stale()) return;
            if (!response.ok) throw new Error(clean(result?.error) || "Could not save this decision. Please try again.");
            if (!record(result) || result.success !== true) throw new Error("CareerKraft could not confirm that your review was saved.");
            const consistentDecision = item => record(item) && item.id === suggestion.id && item.status === status && item.finalText === finalText;
            if ((Object.hasOwn(result, "buildId") && result.buildId !== buildData.buildId) ||
                (Object.hasOwn(result, "suggestion") && !consistentDecision(result.suggestion))) {
                throw new Error("CareerKraft received an inconsistent response while saving your review.");
            }
            let updated = { ...buildData, structuredCv: proposedCv, suggestions: buildData.suggestions.map((item, position) =>
                position === index ? { ...item, status, finalText } : item) };
            const hasCv = Object.hasOwn(result, "structuredCv");
            const hasSuggestions = Object.hasOwn(result, "suggestions");
            if (hasCv !== hasSuggestions) throw new Error("CareerKraft received an incomplete CV review response.");
            if (hasCv) {
                // Other confirmed decisions may have changed this build since
                // it was cached. Keep the server's complete current snapshot.
                updated = validateBuild({ ...buildData, structuredCv: result.structuredCv, suggestions: result.suggestions });
                if (!updated.suggestions.every(item => positiveId(item.id)) ||
                    !consistentDecision(updated.suggestions.find(item => item.id === suggestion.id))) {
                    throw new Error("CareerKraft could not confirm the saved suggestion in your current CV.");
                }
            }
            if (Object.hasOwn(result, "buildStatus")) {
                if (!["reviewing", "reviewed"].includes(result.buildStatus)) throw new Error("Invalid CV review status.");
                updated.buildStatus = result.buildStatus;
            }
            // Persist the current CV, rather than replaying decisions on reload.
            // A server-confirmed decision remains confirmed if local storage fails.
            let stored = true;
            try { sessionStorage.setItem(BUILD_KEY, JSON.stringify(updated)); }
            catch { stored = false; }
            buildData = updated;
            currentIndex = buildData.suggestions.findIndex(item => item.id === suggestion.id);
            busy = false;
            moveToNextPending();
            if (!stored) alert("Your decision was saved. Keep this page open to continue; this browser couldn't retain your progress for a reload.");
        } catch (error) {
            if (!stale()) {
                console.error("CV review decision could not be saved.");
                alert(controller.signal.aborted ? "Saving your decision took too long. Please try again." : readableError(error, "Could not save this decision."));
            }
        } finally {
            clearTimeout(deadline);
            if (saveController === controller) saveController = null;
            if (active && generation === version) { busy = false; updateControls(); }
        }
    }

    elements.acceptButton.addEventListener("click", () => { void decide("accepted"); });
    elements.rejectButton.addEventListener("click", () => { void decide("rejected"); });
    elements.saveEditButton.addEventListener("click", () => { if (editing) void decide("edited"); });
    elements.editButton.addEventListener("click", () => {
        const item = buildData?.suggestions[currentIndex];
        if (!active || busy || editing || item?.status !== "pending") return;
        clearTimeout(scrollTimer);
        editing = true;
        elements.editSuggestionInput.value = item.suggestedText;
        elements.editSuggestionInput.maxLength = ["name", "headline"].includes(fieldFor(item.sectionName)) ? 255 : 2000;
        show(elements.suggestionActions, false);
        show(elements.editArea, true);
        updateControls();
        elements.editSuggestionInput.focus();
    });
    elements.cancelEditButton.addEventListener("click", () => {
        if (!active || busy || !editing) return;
        renderSuggestion();
        elements.editButton.focus();
    });
    for (const [name, offset] of [["previousSuggestionButton", -1], ["nextSuggestionButton", 1]]) {
        elements[name].addEventListener("click", () => {
            if (!active || busy || editing || !buildData) return;
            const next = currentIndex + offset;
            if (next < 0 || next >= buildData.suggestions.length) return;
            currentIndex = next;
            renderCv();
            renderSuggestion({ scroll: true });
        });
    }
    elements.backToResultsButton.addEventListener("click", event => {
        if (busy) event.preventDefault();
    });
    elements.finishButton.addEventListener("click", () => {
        if (!active || busy || editing || !buildData) return;
        const pending = buildData.suggestions.filter(item => item.status === "pending").length;
        if (pending && !confirm(`You still have ${pending} suggestion(s) to review. Finish anyway?`)) return;
        try {
            sessionStorage.setItem(FINAL_KEY, JSON.stringify({ buildId: buildData.buildId, structuredCv: buildData.structuredCv }));
        } catch { alert("CareerKraft couldn't keep your final CV in this browser. Please try again before leaving this page."); return; }
        window.location.href = `/cv-preview.html?build=${buildData.buildId}`;
    });

    function loadBuild() {
        generation++;
        busy = false;
        editing = false;
        try {
            const raw = sessionStorage.getItem(BUILD_KEY);
            if (!raw || raw.length > 512 * 1024) throw new Error("Missing CV build.");
            buildData = validateBuild(JSON.parse(raw));
        } catch {
            buildData = null;
            updateControls();
            window.location.replace("/cv-scanner.html");
            return;
        }
        currentIndex = Math.max(0, buildData.suggestions.findIndex(item => item.status === "pending"));
        renderCv();
        updateProgress();
        renderSuggestion({ scroll: true });
    }
    window.addEventListener("pagehide", () => {
        active = false;
        generation++;
        clearTimeout(scrollTimer);
        saveController?.abort();
    });
    window.addEventListener("pageshow", event => {
        if (!event.persisted) return;
        active = true;
        loadBuild();
    });
    loadBuild();
})();
