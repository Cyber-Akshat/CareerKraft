(() => {
    "use strict";

    const uploadView = document.getElementById("uploadView");
    const analysingView = document.getElementById("analysingView");
    const uploadZone = document.getElementById("uploadZone");
    const cvFileInput = document.getElementById("cvFileInput");
    const browseButton = document.getElementById("browseButton");
    const selectedFileCard = document.getElementById("selectedFileCard");
    const selectedFileName = document.getElementById("selectedFileName");
    const selectedFileSize = document.getElementById("selectedFileSize");
    const removeFileButton = document.getElementById("removeFileButton");
    const uploadError = document.getElementById("uploadError");
    const scanCvButton = document.getElementById("scanCvButton");
    const analysisPercentage = document.getElementById("analysisPercentage");
    const analysisProgressFill = document.getElementById("analysisProgressFill");
    const analysisSteps = ["reading", "structure", "skills", "career", "feedback"]
        .map(step => document.querySelector(`[data-step="${step}"]`));

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
    const RESULT_STORAGE_KEY = "careerkraft-cv-scan-result";

    let selectedFile = null;
    let progressTimer = null;
    let redirectTimer = null;
    let currentProgress = 20;
    let isScanning = false;

    /* --------------------------------
       HELPERS AND FILE VALIDATION
    -------------------------------- */

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getFileExtension(fileName) {
        const lastDot = fileName.lastIndexOf(".");
        return lastDot === -1 ? "" : fileName.slice(lastDot).toLowerCase();
    }

    function showError(message) {
        uploadError.textContent = message;
        uploadError.classList.remove("hidden");
    }

    function clearError() {
        uploadError.textContent = "";
        uploadError.classList.add("hidden");
    }

    function getFileTypeLabel(file) {
        return getFileExtension(file.name).slice(1).toUpperCase() || "FILE";
    }

    function validateFile(file) {
        if (!file) return { valid: false, message: "Please choose a CV file." };
        if (!ALLOWED_EXTENSIONS.includes(getFileExtension(file.name))) {
            return { valid: false, message: "Only PDF, DOCX and TXT CVs are supported." };
        }
        if (file.size > MAX_FILE_SIZE) {
            return { valid: false, message: "Your CV must be 10 MB or smaller." };
        }
        if (file.size === 0) return { valid: false, message: "This file appears to be empty." };
        return { valid: true };
    }

    /* --------------------------------
       FILE SELECTION AND BROWSE
    -------------------------------- */

    function clearSelectedFile() {
        if (isScanning) return;
        selectedFile = null;
        cvFileInput.value = "";
        selectedFileName.textContent = "";
        selectedFileSize.textContent = "";
        selectedFileCard.classList.add("hidden");
        scanCvButton.disabled = true;
        clearError();
    }

    function setSelectedFile(file) {
        if (isScanning) return;
        clearError();
        const validation = validateFile(file);
        if (!validation.valid) {
            clearSelectedFile();
            showError(validation.message);
            return;
        }

        selectedFile = file;
        selectedFileName.textContent = file.name;
        selectedFileSize.textContent = formatFileSize(file.size);
        const icon = selectedFileCard.querySelector(".file-icon");
        if (icon) icon.textContent = getFileTypeLabel(file);
        selectedFileCard.classList.remove("hidden");
        scanCvButton.disabled = false;
    }

    browseButton.addEventListener("click", event => {
        event.stopPropagation();
        if (!isScanning) cvFileInput.click();
    });

    uploadZone.addEventListener("click", event => {
        // The hidden input's synthetic click also bubbles through the zone.
        if (isScanning || event.target === cvFileInput || browseButton.contains(event.target)) return;
        cvFileInput.click();
    });

    uploadZone.addEventListener("keydown", event => {
        // Let the browse button handle its own native keyboard activation.
        if (event.target !== uploadZone || isScanning) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            cvFileInput.click();
        }
    });

    cvFileInput.addEventListener("change", () => {
        const file = cvFileInput.files?.[0];
        // Keep the File object separately so choosing the same file fires change again.
        cvFileInput.value = "";
        if (file) setSelectedFile(file);
    });

    removeFileButton.addEventListener("click", clearSelectedFile);

    /* --------------------------------
       DRAG AND DROP
    -------------------------------- */

    ["dragenter", "dragover"].forEach(eventName => {
        uploadZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            if (!isScanning) uploadZone.classList.add("dragging");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        uploadZone.addEventListener(eventName, event => {
            event.preventDefault();
            event.stopPropagation();
            if (eventName === "dragleave" && event.relatedTarget instanceof Node &&
                uploadZone.contains(event.relatedTarget)) return;
            uploadZone.classList.remove("dragging");
        });
    });

    uploadZone.addEventListener("drop", event => {
        const file = event.dataTransfer?.files?.[0];
        if (file) setSelectedFile(file);
    });

    /* --------------------------------
       VIEW SWITCHING
    -------------------------------- */

    function showUploadView() {
        analysingView.classList.remove("active-view");
        uploadView.classList.add("active-view");
    }

    function showAnalysingView() {
        uploadView.classList.remove("active-view");
        analysingView.classList.add("active-view");
        uploadZone.classList.remove("dragging");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* --------------------------------
       ESTIMATED ANALYSIS PROGRESS
    -------------------------------- */

    function setStepState(index, state) {
        const step = analysisSteps[index];
        if (!step) return;
        step.classList.remove("active", "completed");
        if (state) step.classList.add(state);
        const indicator = step.querySelector(".step-indicator");
        if (indicator) indicator.textContent = state === "completed" ? "✓" : String(index + 1);
    }

    function updateProgress(progress) {
        currentProgress = progress;
        analysisPercentage.textContent = `${progress}%`;
        analysisProgressFill.style.width = `${progress}%`;
    }

    function stopProgress() {
        clearInterval(progressTimer);
        progressTimer = null;
    }

    function resetAnalysisProgress() {
        stopProgress();
        updateProgress(20);
        analysisSteps.forEach((step, index) => setStepState(index, ""));
        setStepState(0, "completed");
        setStepState(1, "active");
    }

    function startFakeProgress() {
        stopProgress();
        // The API returns one final response, so intermediate progress is estimated.
        progressTimer = setInterval(() => {
            const increment = currentProgress < 45 ? 4 : currentProgress < 70 ? 3 : 2;
            updateProgress(Math.min(currentProgress + increment, 92));
            if (currentProgress >= 35) {
                setStepState(0, "completed");
                setStepState(1, "completed");
                setStepState(2, "active");
            }
            if (currentProgress >= 55) {
                setStepState(2, "completed");
                setStepState(3, "active");
            }
            if (currentProgress >= 75) {
                setStepState(3, "completed");
                setStepState(4, "active");
            }
            if (currentProgress >= 92) stopProgress();
        }, 650);
    }

    function finishProgress() {
        stopProgress();
        analysisSteps.forEach((step, index) => setStepState(index, "completed"));
        updateProgress(100);
    }

    /* --------------------------------
       API REQUEST
    -------------------------------- */

    async function scanCv(file) {
        const formData = new FormData();
        formData.append("cv", file);
        const response = await fetch("/api/cv/scan", {
            method: "POST",
            body: formData,
            credentials: "same-origin"
        });

        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error("CareerKraft received an invalid response from the server.");
        }
        if (!response.ok) {
            throw new Error(typeof result?.error === "string" && result.error.trim()
                ? result.error : "CareerKraft couldn't analyse this CV.");
        }
        if (result?.success !== true || !Number.isSafeInteger(result.scanId) || result.scanId <= 0 ||
            !result.analysis || typeof result.analysis !== "object" || Array.isArray(result.analysis)) {
            throw new Error("CareerKraft received an invalid response from the server.");
        }
        return result;
    }

    /* --------------------------------
       SCAN BUTTON
    -------------------------------- */

    scanCvButton.addEventListener("click", async () => {
        if (isScanning) return;
        if (!selectedFile) {
            showError("Please upload your CV first.");
            return;
        }
        const validation = validateFile(selectedFile);
        if (!validation.valid) {
            showError(validation.message);
            return;
        }

        clearError();
        isScanning = true;
        scanCvButton.disabled = true;
        resetAnalysisProgress();
        showAnalysingView();
        startFakeProgress();

        try {
            const result = await scanCv(selectedFile);
            sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
            finishProgress();
            redirectTimer = setTimeout(() => {
                window.location.href = "/cv-results.html";
            }, 650);
        } catch (error) {
            stopProgress();
            isScanning = false;
            console.error("CV scan failed.");
            showUploadView();
            scanCvButton.disabled = !selectedFile;
            showError(error.message || "CareerKraft couldn't analyse your CV right now.");
        }
    });

    window.addEventListener("pagehide", () => {
        stopProgress();
        clearTimeout(redirectTimer);
    });

    window.addEventListener("pageshow", event => {
        if (!event.persisted) return;
        if (isScanning && currentProgress < 100) {
            // A pending request may continue when returning from the back/forward cache.
            startFakeProgress();
            return;
        }
        stopProgress();
        clearTimeout(redirectTimer);
        redirectTimer = null;
        isScanning = false;
        showUploadView();
        scanCvButton.disabled = !selectedFile;
    });

    /* --------------------------------
       INITIAL STATE
    -------------------------------- */

    clearSelectedFile();
})();
