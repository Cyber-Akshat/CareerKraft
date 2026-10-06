(() => {
  if (
    window.matchMedia("(max-width: 700px), (pointer: coarse)").matches
  ) {
    return;
  }

  const cursor = document.querySelector(".cursor") || document.createElement("div");
  const cursorDot = document.querySelector(".cursor-dot") || document.createElement("div");

  cursor.classList.add("cursor");
  cursorDot.classList.add("cursor-dot");
  cursor.setAttribute("aria-hidden", "true");
  cursorDot.setAttribute("aria-hidden", "true");

  if (!cursor.isConnected) document.body.append(cursor);
  if (!cursorDot.isConnected) document.body.append(cursorDot);

  window.addEventListener("pointermove", (event) => {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    cursorDot.style.left = `${event.clientX}px`;
    cursorDot.style.top = `${event.clientY}px`;
    cursor.classList.add("is-visible");
    cursorDot.classList.add("is-visible");
  }, { passive: true });

  const hoverTargets = "a, button, input, select, textarea, [role='button'], .feature-panel, .journey-item";

  document.addEventListener("pointerover", (event) => {
    if (event.target instanceof Element && event.target.closest(hoverTargets)) {
      cursor.classList.add("is-hovering");
    }
  });

  document.addEventListener("pointerout", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest(hoverTargets) &&
      (!(event.relatedTarget instanceof Element) ||
        !event.relatedTarget.closest(hoverTargets))
    ) {
      cursor.classList.remove("is-hovering");
    }
  });
})();
