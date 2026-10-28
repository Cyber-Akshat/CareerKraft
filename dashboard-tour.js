// A first-visit walkthrough of the live dashboard, with account-scoped progress.
(() => {
  'use strict';
  let context = null;
  let pending = false;
  let active = null;
  let frame = null;
  const seenUsers = new Set();
  const saveRequests = new Set();
  const launch = () => document.getElementById('dashboard-tour-launch');
  const storageKey = id => `careerkraft-dashboard-tour:${id}`;
  const locallySeen = id => {
    try { return window.localStorage.getItem(storageKey(id)) === 'seen'; } catch { return false; }
  };
  function saveSeen(user, status) {
    if (saveRequests.has(user.id)) return;
    saveRequests.add(user.id);
    try {
      Promise.resolve(window.careerAuth?.request('settings/dashboard-tour', { status })).catch(() => {});
    } catch {}
  }
  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function blocked() {
    if (document.body.classList.contains('dashboard-cv-view-active')) return true;
    if (document.readyState === 'loading' || document.querySelector('main[aria-busy="true"]')) return true;
    if (visible(document.querySelector('.cookie-banner:not([hidden])'))) return true;
    return [...document.querySelectorAll('dialog[open]:not(#dashboard-tour), #level-transition-overlay:not([hidden]), .lumia-builder-overlay')].some(visible) || document.body.classList.contains('lumia-building');
  }
  function stepsForDashboard() {
    const next = document.getElementById('start-next-step-button');
    const canStart = context.hasRoadmap && next && !next.disabled;
    return [
      { selector: window.innerWidth < 600 ? '.career-dashboard-hero h1, .career-dashboard-hero' : '.career-dashboard-hero', title: 'Welcome to your dashboard', copy: 'This is your starting point for CareerKraft. Find your career overview here and return whenever you want to see how your journey is going.' },
      { selector: '#roadmap .section-heading-row, #roadmap h2, #roadmap', title: 'Follow your personal roadmap', copy: context.hasRoadmap ? 'Work through Beginner, Intermediate and Advanced at your own pace. Open each stage to explore its activities and see what comes next.' : 'Once you have chosen a career, your personalised activities appear here. Work through each stage at your own pace.' },
      canStart
        ? { selector: '#start-next-step-button', title: 'Start your next activity', copy: 'Open your next available activity here. Follow its instructions, complete the task and submit evidence when it is requested.' }
        : { selector: '#career-explore-button', title: 'Explore your chosen career', copy: 'Explore the career you are working towards, or choose a career from your matches if you are still getting started.' },
      { selector: '#skills-nav-link', title: 'See the skills you earn', copy: 'Open Skills to see the skills verified from your submitted work. Your skills profile grows as you complete your roadmap.' },
      { selector: '#lumia-launcher', title: 'Meet Lumia, your career companion', copy: 'Ask Lumia about your roadmap, an activity or your next step. Open the chat here whenever you would like some guidance.' },
      { selector: '.profile-avatar[href="settings.html"]', title: 'Make this space your own', copy: 'Open Account settings to update your profile and choose accessibility options, including reading fonts, text size, contrast and cursor size. You can replay this guide with the Dashboard tour button.' }
    ].map(step => ({ ...step, target: step.selector.split(',').map(selector => document.querySelector(selector.trim())).find(visible) })).filter(step => step.target);
  }
  const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
  function position() {
    if (!active) return;
    const { dialog, card, steps, index } = active;
    const target = steps[index].target;
    if (!visible(target)) { move(1); return; }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rect = target.getBoundingClientRect();
    const left = clamp(rect.left - 8, 8, width - 24);
    const top = clamp(rect.top - 8, 8, height - 24);
    const right = clamp(rect.right + 8, left + 8, width - 8);
    const bottom = clamp(rect.bottom + 8, top + 8, height - 8);
    const svg = dialog.querySelector('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    dialog.querySelector('#dashboard-tour-mask').setAttribute('d', `M0 0H${width}V${height}H0Z M${left} ${top}H${right}V${bottom}H${left}Z`);
    const spotlight = dialog.querySelector('#dashboard-tour-spotlight');
    for (const [name, value] of Object.entries({ x: left, y: top, width: right - left, height: bottom - top })) spotlight.setAttribute(name, value);

    const box = card.getBoundingClientRect();
    const cardWidth = box.width;
    const cardHeight = box.height;
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const candidates = [
      [right + 48, centerY - cardHeight / 2],
      [left - cardWidth - 48, centerY - cardHeight / 2],
      [centerX - cardWidth / 2, bottom + 48],
      [centerX - cardWidth / 2, top - cardHeight - 48]
    ].map(([x, y]) => {
      const point = { x: clamp(x, 16, width - cardWidth - 16), y: clamp(y, 16, height - cardHeight - 16) };
      point.overlap = Math.max(0, Math.min(point.x + cardWidth, right) - Math.max(point.x, left)) * Math.max(0, Math.min(point.y + cardHeight, bottom) - Math.max(point.y, top));
      point.score = point.overlap * 100 + Math.abs(point.x - x) + Math.abs(point.y - y);
      return point;
    }).sort((first, second) => first.score - second.score);
    const point = candidates[0];
    card.style.left = `${point.x}px`;
    card.style.top = `${point.y}px`;
    const arrow = dialog.querySelector('#dashboard-tour-arrow');
    arrow.hidden = point.overlap > 0;
    arrow.style.display = point.overlap > 0 ? 'none' : '';
    let startX, startY, endX, endY;
    if (point.y >= bottom) {
      [startX, startY, endX, endY] = [point.x + cardWidth / 2, point.y - 8, centerX, bottom + 8];
    } else if (point.y + cardHeight <= top) {
      [startX, startY, endX, endY] = [point.x + cardWidth / 2, point.y + cardHeight + 8, centerX, top - 8];
    } else if (point.x >= right) {
      [startX, startY, endX, endY] = [point.x - 8, point.y + cardHeight / 2, right + 8, centerY];
    } else {
      [startX, startY, endX, endY] = [point.x + cardWidth + 8, point.y + cardHeight / 2, left - 8, centerY];
    }
    const vertical = Math.abs(endY - startY) > Math.abs(endX - startX);
    const curveX = (startX + endX) / 2 + (vertical ? 24 : 0);
    const curveY = (startY + endY) / 2 + (vertical ? 0 : 24);
    arrow.setAttribute('d', `M${startX} ${startY} Q${curveX} ${curveY} ${endX} ${endY}`);
  }
  function schedulePosition() {
    if (frame !== null) return;
    const schedule = window.requestAnimationFrame || (callback => window.setTimeout(callback, 0));
    frame = schedule(() => { frame = null; position(); });
  }
  function showStep() {
    if (!active) return;
    const { dialog, steps, index } = active;
    const step = steps[index];
    dialog.querySelector('#dashboard-tour-title').textContent = step.title;
    dialog.querySelector('#dashboard-tour-copy').textContent = step.copy;
    dialog.querySelector('#dashboard-tour-progress').textContent = `Step ${index + 1} of ${steps.length}`;
    dialog.querySelector('#dashboard-tour-back').disabled = index === 0;
    dialog.querySelector('#dashboard-tour-next').textContent = index === steps.length - 1 ? 'Finish tour' : 'Next';
    step.target.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' });
    // Leave room for the explanation below small mobile targets instead of
    // centring the target underneath the callout.
    if (window.innerWidth < 600 && getComputedStyle(step.target).position !== 'fixed' && !step.target.closest('.lumia-widget')) {
      const rect = step.target.getBoundingClientRect();
      const cardHeight = active.card.getBoundingClientRect().height;
      const available = window.innerHeight - cardHeight - 64;
      if (rect.height <= available) window.scrollTo({
        left: window.scrollX, top: window.scrollY + rect.top - Math.max(16, (available - rect.height) / 2), behavior: 'instant'
      });
    }
    active.observer?.disconnect();
    active.observer?.observe(step.target);
    active.observer?.observe(active.card);
    position();
    schedulePosition();
    dialog.querySelector('#dashboard-tour-next').focus({ preventScroll: true });
  }
  function move(direction) {
    if (!active) return;
    let next = active.index + direction;
    while (next >= 0 && next < active.steps.length && !visible(active.steps[next].target)) next += direction;
    if (next >= active.steps.length) { dismiss('completed'); return; }
    if (next < 0) return;
    active.index = next;
    showStep();
  }
  function closeTour() {
    if (!active) return;
    const previous = active;
    active = null;
    previous.observer?.disconnect();
    document.body.classList.remove('dashboard-tour-open');
    if (previous.dialog.open) previous.dialog.close();
    previous.dialog.remove();
    const focus = previous.focus !== document.body && visible(previous.focus) ? previous.focus : launch();
    focus?.focus({ preventScroll: true });
    window.scrollTo({ left: previous.scrollX, top: previous.scrollY, behavior: 'instant' });
  }
  function dismiss(status) {
    if (!active) return;
    pending = false;
    const user = active.user;
    seenUsers.add(user.id);
    try { window.localStorage.setItem(storageKey(user.id), 'seen'); } catch {}
    saveSeen(user, status);
    closeTour();
  }
  function start() {
    const steps = stepsForDashboard();
    if (!steps.length) { pending = false; return; }
    const dialog = document.createElement('dialog');
    dialog.id = 'dashboard-tour';
    dialog.className = 'dashboard-tour';
    dialog.setAttribute('aria-labelledby', 'dashboard-tour-title');
    dialog.setAttribute('aria-describedby', 'dashboard-tour-copy');
    dialog.innerHTML = `
      <svg class="dashboard-tour-canvas" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <defs><marker id="dashboard-tour-arrowhead" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M2 2L10 6L2 10" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
        <path id="dashboard-tour-mask" fill-rule="evenodd"/>
        <rect id="dashboard-tour-spotlight" rx="8"/>
        <path id="dashboard-tour-arrow" marker-end="url(#dashboard-tour-arrowhead)"/>
      </svg>
      <section class="dashboard-tour-card">
        <div class="dashboard-tour-heading"><span class="dashboard-tour-eyebrow">A little look around</span><button id="dashboard-tour-close" class="dashboard-tour-close" type="button" aria-label="Skip dashboard tour">&times;</button></div>
        <div class="dashboard-tour-description" tabindex="0" role="region" aria-label="Tour explanation" aria-live="polite" aria-atomic="true"><p id="dashboard-tour-progress" class="dashboard-tour-progress"></p><h2 id="dashboard-tour-title"></h2><p id="dashboard-tour-copy"></p></div>
        <div class="dashboard-tour-actions"><button id="dashboard-tour-skip" type="button">Skip tour</button><div class="dashboard-tour-navigation"><button id="dashboard-tour-back" type="button">Back</button><button id="dashboard-tour-next" type="button">Next</button></div></div>
      </section>`;
    document.body.append(dialog);
    if (typeof dialog.showModal !== 'function') { dialog.remove(); pending = false; return; }
    active = { dialog, card: dialog.querySelector('.dashboard-tour-card'), steps, index: 0, user: context.user, focus: document.activeElement, scrollX: window.scrollX, scrollY: window.scrollY };
    if (typeof ResizeObserver === 'function') active.observer = new ResizeObserver(schedulePosition);
    pending = false;
    document.body.classList.add('dashboard-tour-open');
    dialog.querySelector('#dashboard-tour-next').addEventListener('click', () => move(1));
    dialog.querySelector('#dashboard-tour-back').addEventListener('click', () => move(-1));
    for (const id of ['dashboard-tour-skip', 'dashboard-tour-close']) dialog.querySelector(`#${id}`).addEventListener('click', () => dismiss('skipped'));
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss('skipped'); });
    dialog.addEventListener('close', () => { if (active?.dialog === dialog) dismiss('skipped'); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.showModal();
    showStep();
  }
  function maybeStart() {
    if (!pending || !context || active || blocked()) return;
    if (pending === 'automatic' && document.body.classList.contains('dashboard-skills-view')) return;
    start();
  }
  function ready() {
    launch()?.addEventListener('click', () => { if (context && !active) { pending = 'manual'; maybeStart(); } });
    new MutationObserver(maybeStart).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'open', 'aria-busy'] });
    maybeStart();
  }
  window.addEventListener('careerkraft:dashboard-ready', event => {
    const user = event.detail?.user;
    if (!Number.isSafeInteger(user?.id) || user.id < 1) return;
    if (context?.user.id !== user.id) { closeTour(); pending = false; }
    context = { user, hasRoadmap: event.detail.hasRoadmap === true };
    if (launch()) launch().disabled = false;
    if (user.dashboardTourSeen === true) seenUsers.add(user.id);
    const local = locallySeen(user.id);
    if (local && user.dashboardTourSeen === false) saveSeen(user, 'skipped');
    if (!active && user.dashboardTourSeen === false && !seenUsers.has(user.id) && !local) pending = 'automatic';
    maybeStart();
  });
  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); dismiss('skipped'); }
  });
  window.addEventListener('scroll', schedulePosition, { passive: true });
  window.visualViewport?.addEventListener('resize', schedulePosition, { passive: true });
  window.addEventListener('careerkraft:accessibility-change', schedulePosition);
  window.addEventListener('hashchange', maybeStart);
  window.addEventListener('pagehide', () => { pending = false; closeTour(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
