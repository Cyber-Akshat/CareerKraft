(() => {
    "use strict";
    if (!document.body.classList.contains("cv-preview-app")) return;

    const FINAL_KEY = "careerkraft-final-cv";
    const BUILD_KEY = "careerkraft-cv-build";
    const WORKFLOW_KEYS = ["careerkraft-cv-scan-result", BUILD_KEY, FINAL_KEY];
    const fields = ["name", "headline", "contact", "profile", "education", "experience", "projects", "skills", "certifications"];
    const listFields = new Set(["contact", "education", "experience", "projects", "skills", "certifications"]);
    const cvElements = Object.fromEntries(fields.map(field => [field,
        document.getElementById(`cv${field[0].toUpperCase()}${field.slice(1)}`)]));
    const sections = Object.fromEntries([...listFields, "profile"].filter(field => field !== "contact")
        .map(field => [field, document.getElementById(`${field}Section`)]));
    const ids = ["cvDocument", "acceptedTotal", "editedTotal", "rejectedTotal", "targetCareer", "backToBuilderButton",
        "downloadButton", "printButton", "scanAnotherButton", "practiceButton", "previewEyebrow",
        "completionLabel", "completionHeading", "completionDescription"];
    const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    if ([...Object.values(ui), ...Object.values(cvElements), ...Object.values(sections)].some(element => !element)) return;
    const header = ui.cvDocument.querySelector(".cv-header");
    const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const positiveId = value => Number.isSafeInteger(value) && value > 0;
    const clean = value => typeof value === "string" ? value.trim() : "";
    let finalCvData = null;
    let active = true;

    function readJson(key, storage = sessionStorage) {
        const raw = storage.getItem(key);
        if (!raw || raw.length > 512 * 1024) throw new Error("Missing or invalid CV data.");
        return JSON.parse(raw);
    }

    function normaliseCv(value) {
        if (!record(value) || !fields.every(field => Object.hasOwn(value, field))) throw new Error("Invalid final CV.");
        let leaves = 0;
        const text = (item, max = 20000) => {
            if (typeof item === "number" && Number.isFinite(item)) item = String(item);
            if (typeof item !== "string" || item.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item)) {
                throw new Error("Invalid CV text.");
            }
            if (item.trim() && ++leaves > 1000) throw new Error("Too many CV entries.");
            return item;
        };
        const entry = item => {
            if (item === null) return null;
            if (typeof item === "string" || typeof item === "number") return text(item);
            if (!record(item) || Object.keys(item).length > 20) throw new Error("Invalid CV entry.");
            return Object.fromEntries(Object.entries(item).map(([key, part]) => {
                if (part === null) return [key, null];
                if (Array.isArray(part)) {
                    if (part.length > 50) throw new Error("Too many CV bullet points.");
                    return [key, part.map(item => item === null ? null : text(item))];
                }
                return [key, text(part)];
            }));
        };
        const cv = {};
        for (const field of fields) {
            if (listFields.has(field)) {
                if (!Array.isArray(value[field]) || value[field].length > 50) throw new Error("Invalid CV section.");
                cv[field] = value[field].map(entry);
            } else {
                if (typeof value[field] !== "string") throw new Error("Invalid CV field.");
                cv[field] = text(value[field], field === "profile" ? 20000 : 255);
            }
        }
        if (!leaves) throw new Error("The final CV has no content.");
        return cv;
    }

    function validateFinal(value) {
        if (!record(value) || !positiveId(value.buildId)) throw new Error("Invalid final CV.");
        const requested = new URLSearchParams(window.location.search).getAll("build");
        if (requested.length > 1 || (requested.length === 1 &&
            (!/^[1-9]\d*$/.test(requested[0]) || Number(requested[0]) !== value.buildId))) throw new Error("Invalid CV preview link.");
        return { buildId: value.buildId, structuredCv: normaliseCv(value.structuredCv) };
    }

    function readMatchingBuild(snapshot) {
        try {
            const value = readJson(BUILD_KEY);
            if (!record(value) || value.buildId !== snapshot.buildId || !Array.isArray(value.suggestions) || value.suggestions.length > 20) return null;
            const ids = new Set();
            const suggestions = value.suggestions.map(item => {
                if (!record(item)) throw new Error("Invalid suggestion history.");
                const status = item.status === undefined ? "pending" : item.status;
                if (!["accepted", "edited", "rejected", "pending"].includes(status)) throw new Error("Invalid suggestion status.");
                if (positiveId(item.id)) {
                    if (ids.has(item.id)) throw new Error("Duplicate suggestion history.");
                    ids.add(item.id);
                }
                return { status };
            });
            const cv = normaliseCv(value.structuredCv);
            // A student may return to the builder and change the same build.
            // Its newer review counts do not describe an older final snapshot.
            if (JSON.stringify(cv) !== JSON.stringify(snapshot.structuredCv)) return null;
            return { targetCareer: clean(value.targetCareer), suggestions };
        } catch { return null; }
    }

    function textParts(item) {
        if (typeof item === "string") return clean(item) ? [item] : [];
        if (!record(item)) return [];
        return Object.values(item).flatMap(value => Array.isArray(value) ? value.filter(part => clean(part)) : clean(value) ? [value] : []);
    }

    function renderArray(container, values, contact = false) {
        container.replaceChildren();
        for (const item of values) {
            if (!textParts(item).length) continue;
            if (contact) {
                const span = document.createElement("span");
                span.textContent = textParts(item).join(" • ");
                container.appendChild(span);
            } else if (typeof item === "string") {
                const paragraph = document.createElement("p");
                paragraph.textContent = item;
                container.appendChild(paragraph);
            } else {
                const wrapper = document.createElement("div");
                wrapper.className = "cv-entry";
                for (const part of Object.values(item)) {
                    if (Array.isArray(part)) {
                        const list = document.createElement("ul");
                        for (const line of part.filter(value => clean(value))) {
                            const bullet = document.createElement("li");
                            bullet.textContent = line;
                            list.appendChild(bullet);
                        }
                        if (list.children.length) wrapper.appendChild(list);
                    } else if (clean(part)) {
                        const paragraph = document.createElement("p");
                        paragraph.textContent = part;
                        wrapper.appendChild(paragraph);
                    }
                }
                if (wrapper.children.length) container.appendChild(wrapper);
            }
        }
    }

    function renderCv(cv) {
        ui.cvDocument.hidden = false;
        for (const field of ["name", "headline"]) {
            cvElements[field].textContent = cv[field];
            cvElements[field].hidden = !clean(cv[field]);
        }
        renderArray(cvElements.contact, cv.contact, true);
        cvElements.contact.hidden = !cvElements.contact.children.length;
        header.hidden = !clean(cv.name) && !clean(cv.headline) && cvElements.contact.hidden;
        cvElements.profile.replaceChildren();
        if (clean(cv.profile)) {
            const paragraph = document.createElement("p");
            paragraph.textContent = cv.profile;
            cvElements.profile.appendChild(paragraph);
        }
        for (const field of Object.keys(sections)) {
            if (field !== "profile") renderArray(cvElements[field], cv[field]);
            sections[field].hidden = !cvElements[field].children.length;
        }
    }

    function renderSummary(build) {
        const counts = { accepted: 0, edited: 0, rejected: 0, pending: 0 };
        for (const item of build?.suggestions || []) counts[item.status]++;
        for (const status of ["accepted", "edited", "rejected"]) ui[`${status}Total`].textContent = build ? String(counts[status]) : "—";
        ui.targetCareer.textContent = build ? build.targetCareer || "Not selected" : "Not available";
        ui.previewEyebrow.textContent = build && !counts.pending ? "CV Builder complete" : "CV Builder preview";
        ui.completionHeading.textContent = "Your CV is ready for a final check.";
        if (!build) {
            ui.completionLabel.textContent = "Your CV preview";
            ui.completionDescription.textContent = "Your saved CV is shown here. The improvement summary is unavailable.";
        } else if (counts.pending) {
            ui.completionLabel.textContent = "Review in progress";
            ui.completionHeading.textContent = "Your current CV preview";
            ui.completionDescription.textContent = `${counts.pending} suggestion${counts.pending === 1 ? " remains" : "s remain"} to review. Only accepted or edited changes are included.`;
        } else {
            ui.completionLabel.textContent = build.suggestions.length ? "Review complete" : "CV preview ready";
            ui.completionDescription.textContent = build.suggestions.length
                ? "Every Lumia improvement shown here was accepted or edited by you."
                : "Your saved CV is ready for a final check.";
        }
    }

    function resetView() {
        finalCvData = null;
        for (const container of Object.values(cvElements)) container.replaceChildren();
        for (const section of Object.values(sections)) section.hidden = true;
        header.hidden = true;
        ui.cvDocument.hidden = true;
        ui.downloadButton.disabled = true;
        ui.printButton.disabled = true;
        ui.backToBuilderButton.disabled = true;
        renderSummary(null);
    }

    function loadPage({ redirect = true } = {}) {
        let snapshot;
        try { snapshot = validateFinal(readJson(FINAL_KEY)); }
        catch {
            resetView();
            console.error("Final CV preview data is unavailable.");
            if (redirect) window.location.replace("/cv-scanner.html");
            return false;
        }
        finalCvData = snapshot;
        renderCv(snapshot.structuredCv);
        renderSummary(readMatchingBuild(snapshot));
        ui.downloadButton.disabled = false;
        ui.downloadButton.title = "Choose Save as PDF in the print dialog";
        ui.printButton.disabled = false;
        ui.backToBuilderButton.disabled = false;
        return true;
    }

    function openPrintDialog() {
        if (!active || !loadPage()) return;
        try { window.print(); }
        catch { alert("CareerKraft couldn't open the print dialog. Please try again."); }
    }
    ui.downloadButton.addEventListener("click", openPrintDialog);
    ui.printButton.addEventListener("click", openPrintDialog);
    ui.backToBuilderButton.addEventListener("click", () => {
        if (active && loadPage()) window.location.href = `/cv-builder.html?build=${finalCvData.buildId}`;
    });
    ui.practiceButton.addEventListener("click", () => {
        if (active && loadPage()) window.location.href = "/dashboard.html#lumia";
    });
    ui.scanAnotherButton.addEventListener("click", () => {
        if (!active) return;
        let storage;
        let saved = [];
        const removed = [];
        try {
            storage = sessionStorage;
            saved = WORKFLOW_KEYS.map(key => [key, storage.getItem(key)]);
            for (const [key, value] of saved) {
                storage.removeItem(key);
                removed.push([key, value]);
            }
        } catch {
            for (const [key, value] of removed) {
                if (value !== null) { try { storage.setItem(key, value); } catch { /* Keep the current preview available. */ } }
            }
            alert("CareerKraft couldn't reset your CV session. Please try again.");
            return;
        }
        active = false;
        resetView();
        window.location.href = "/cv-scanner.html";
    });
    window.addEventListener("beforeprint", () => { loadPage({ redirect: false }); });
    window.addEventListener("pagehide", () => { active = false; });
    window.addEventListener("pageshow", event => {
        if (!event.persisted) return;
        active = true;
        loadPage();
    });
    loadPage();
})();
