(() => {
    "use strict";

    const RESULT_STORAGE_KEY = "careerkraft-cv-scan-result";
    const CIRCUMFERENCE = 326.73;
    const dashboardMode = Boolean(document.getElementById("cv-results-view"));
    const scanAnotherButton = document.getElementById("scanAnotherButton");
    const improveCvButton = document.getElementById("improveCvButton");
    const overallScore = document.getElementById("overallScore");
    const scoreTitle = document.getElementById("scoreTitle");
    const careerAlignmentSummary = document.getElementById("careerAlignmentSummary");
    const targetCareer = document.getElementById("targetCareer");
    const scoreRingProgress = document.getElementById("scoreRingProgress");
    const strengthsList = document.getElementById("strengthsList");
    const improvementsList = document.getElementById("improvementsList");
    const missingSkillsList = document.getElementById("missingSkillsList");
    const missingSkillsEmpty = document.getElementById("missingSkillsEmpty");
    const bulletRewritesList = document.getElementById("bulletRewritesList");
    const bulletRewritesEmpty = document.getElementById("bulletRewritesEmpty");
    const categories = ["structure", "clarity", "evidence", "relevance"].map(name => ({
        name,
        score: document.getElementById(`${name}Score`),
        bar: document.getElementById(`${name}Bar`)
    }));
    const animationFrames = new Set();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

    /* --------------------------------
       HELPERS AND SCORE ANIMATION
    -------------------------------- */

    const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const text = value => typeof value === "string" ? value.trim() : "";
    const textItems = (items, maximum) => Array.isArray(items)
        ? items.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean).slice(0, maximum)
        : [];

    function clampScore(value) {
        const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
        return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
    }

    function getScoreTitle(score) {
        if (score >= 90) return "Your CV is in excellent shape";
        if (score >= 80) return "Your CV has a strong foundation";
        if (score >= 70) return "Your CV is heading in the right direction";
        if (score >= 60) return "Your CV has good potential";
        if (score >= 45) return "Your CV needs some focused improvements";
        return "Your CV has plenty of room to grow";
    }

    function nextFrame(callback) {
        const id = requestAnimationFrame(timestamp => {
            animationFrames.delete(id);
            callback(timestamp);
        });
        animationFrames.add(id);
    }

    function stopAnimations() {
        animationFrames.forEach(id => cancelAnimationFrame(id));
        animationFrames.clear();
    }

    function animateNumber(element, target, duration = 700) {
        if (reducedMotion) {
            element.textContent = String(target);
            return;
        }
        element.textContent = "0";
        const startTime = performance.now();
        function update(currentTime) {
            const progress = Math.max(0, Math.min((currentTime - startTime) / duration, 1));
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(target * eased));
            if (progress < 1) nextFrame(update);
        }
        nextFrame(update);
    }

    function animateScoreRing(score) {
        const offset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;
        scoreRingProgress.style.strokeDashoffset = String(CIRCUMFERENCE);
        if (reducedMotion) {
            scoreRingProgress.style.transition = "none";
            scoreRingProgress.style.strokeDashoffset = String(offset);
        } else {
            nextFrame(() => nextFrame(() => {
                scoreRingProgress.style.strokeDashoffset = String(offset);
            }));
        }
    }

    function animateBar(element, score) {
        element.style.width = "0%";
        if (reducedMotion) {
            element.style.transition = "none";
            element.style.width = `${score}%`;
        } else {
            nextFrame(() => nextFrame(() => { element.style.width = `${score}%`; }));
        }
    }

    /* --------------------------------
       FEEDBACK AND VERIFIED SKILLS
    -------------------------------- */

    function createListItem(value, index) {
        const item = document.createElement("div");
        item.className = "result-list-item";
        const number = document.createElement("div");
        number.className = "result-list-number";
        number.textContent = String(index + 1);
        const content = document.createElement("div");
        content.textContent = value;
        item.append(number, content);
        return item;
    }

    function renderTextList(container, items) {
        container.replaceChildren();
        textItems(items, 3).forEach((item, index) => container.appendChild(createListItem(item, index)));
    }

    function renderMissingSkills(skills) {
        missingSkillsList.replaceChildren();
        const items = textItems(skills, 5);
        missingSkillsList.classList.toggle("hidden", items.length === 0);
        missingSkillsEmpty.classList.toggle("hidden", items.length > 0);
        items.forEach(skill => {
            const chip = document.createElement("div");
            chip.className = "skill-chip";
            chip.textContent = skill;
            missingSkillsList.appendChild(chip);
        });
    }

    /* --------------------------------
       BULLET REWRITES
    -------------------------------- */

    function rewriteColumn(label, value, improved = false) {
        const column = document.createElement("div");
        column.className = "rewrite-column";
        const heading = document.createElement("span");
        heading.className = improved ? "rewrite-label improved" : "rewrite-label";
        heading.textContent = label;
        const content = document.createElement("p");
        content.className = "rewrite-text";
        content.textContent = value;
        column.append(heading, content);
        return column;
    }

    function renderBulletRewrites(rewrites) {
        bulletRewritesList.replaceChildren();
        const items = Array.isArray(rewrites) ? rewrites.filter(record).map(item => ({
            original: text(item.original), improved: text(item.improved), reason: text(item.reason)
        })).filter(item => item.original && item.improved).slice(0, 3) : [];
        bulletRewritesList.classList.toggle("hidden", items.length === 0);
        bulletRewritesEmpty.classList.toggle("hidden", items.length > 0);

        items.forEach(rewrite => {
            const card = document.createElement("div");
            card.className = "rewrite-card";
            const grid = document.createElement("div");
            grid.className = "rewrite-grid";
            grid.append(rewriteColumn("Before", rewrite.original),
                rewriteColumn("Lumia suggestion", rewrite.improved, true));
            card.appendChild(grid);
            if (rewrite.reason) {
                const reason = document.createElement("div");
                reason.className = "rewrite-reason";
                reason.textContent = `Why this is stronger: ${rewrite.reason}`;
                card.appendChild(reason);
            }
            bulletRewritesList.appendChild(card);
        });
    }

    /* --------------------------------
       LOAD THE SAVED API RESPONSE
    -------------------------------- */

    function forgetResult() {
        try { sessionStorage.removeItem(RESULT_STORAGE_KEY); }
        catch { /* Storage can be unavailable; navigation should still work. */ }
    }

    function goToScanner(replace = false) {
        if (dashboardMode) {
            if (replace) window.location.replace("#cv-scanner");
            else window.location.hash = "cv-scanner";
        } else if (replace) window.location.replace("/cv-scanner.html");
        else window.location.href = "/cv-scanner.html";
    }

    function loadCvResult() {
        stopAnimations();
        let result;
        try {
            const rawResult = sessionStorage.getItem(RESULT_STORAGE_KEY);
            if (!rawResult) {
                goToScanner(true);
                return;
            }
            result = JSON.parse(rawResult);
            const analysis = result?.analysis;
            if (!record(result) || result.success !== true || !Number.isSafeInteger(result.scanId) ||
                result.scanId <= 0 || !record(analysis) || !Object.hasOwn(analysis, "overallScore") ||
                !record(analysis.scores) || !categories.every(category => Object.hasOwn(analysis.scores, category.name))) {
                throw new Error("Invalid CV scan result.");
            }
        } catch {
            console.error("Invalid CV scan result.");
            forgetResult();
            goToScanner(true);
            return;
        }

        const analysis = result.analysis;
        const overall = clampScore(analysis.overallScore);
        scoreTitle.textContent = getScoreTitle(overall);
        careerAlignmentSummary.textContent = text(analysis.careerAlignmentSummary) ||
            "Lumia has reviewed the structure, clarity, evidence and career relevance of your CV.";
        targetCareer.textContent = text(result.targetCareer) || "No target career selected";

        animateNumber(overallScore, overall, 900);
        animateScoreRing(overall);
        categories.forEach(category => {
            const score = clampScore(analysis.scores[category.name]);
            animateNumber(category.score, score);
            animateBar(category.bar, score);
        });
        renderTextList(strengthsList, analysis.strengths);
        renderTextList(improvementsList, analysis.priorityImprovements);
        renderMissingSkills(analysis.verifiedSkillsMissingFromCv);
        renderBulletRewrites(analysis.bulletRewrites);
    }

    /* --------------------------------
       ACTIONS AND HISTORY RESTORATION
    -------------------------------- */

    scanAnotherButton.addEventListener("click", () => {
        stopAnimations();
        forgetResult();
        if (dashboardMode) window.dispatchEvent(new CustomEvent("careerkraft:cv-reset"));
        goToScanner();
    });

    improveCvButton.addEventListener("click", () => {
        alert("CareerKraft CV Builder is coming next.");
    });

    window.addEventListener("pagehide", stopAnimations);
    window.addEventListener("pageshow", event => {
        if (event.persisted && (!dashboardMode || window.location.hash === "#cv-results")) loadCvResult();
    });

    if (dashboardMode) {
        window.addEventListener("careerkraft:dashboard-view", event => {
            if (event.detail?.view === "cv-results") loadCvResult();
            else stopAnimations();
        });
    }
    if (!dashboardMode || window.location.hash === "#cv-results") loadCvResult();
})();
