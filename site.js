// Small enhancements shared by every page.
(() => {
  const consentKey = 'careerkraft-cookie-consent';
  const consentLifetime = 180 * 24 * 60 * 60 * 1000;
  const validConsent = record => record?.version === 1 &&
    ['accepted', 'rejected'].includes(record.choice) &&
    Number.isFinite(record.savedAt) && record.savedAt <= Date.now() &&
    Date.now() - record.savedAt < consentLifetime;
  const readConsent = () => {
    try {
      const record = JSON.parse(window.localStorage.getItem(consentKey));
      return validConsent(record) ? record : null;
    } catch { return null; }
  };

  let consent = readConsent();
  let memoryOnlyChoice = false;
  let settingsOpen = false;
  let banner;
  let settingsButton;
  let accountCookieStatus;
  let accountCookieButtons = [];

  const updateConsent = () => {
    if (!memoryOnlyChoice) consent = readConsent();
    if (consent && !validConsent(consent)) {
      consent = null;
      memoryOnlyChoice = false;
    }
    if (banner) banner.hidden = Boolean(consent) && !settingsOpen;
    const choice = consent?.choice || null;
    accountCookieButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.accountCookieChoice === choice));
    });
    if (accountCookieStatus) {
      accountCookieStatus.textContent = !choice
        ? "You haven't chosen whether to allow optional cookies in this browser yet."
        : memoryOnlyChoice
          ? `Optional cookies are ${choice} for this visit. This browser could not remember your choice for future visits.`
          : `Optional cookies are ${choice}. Your choice is saved for this browser.`;
    }
  };

  const setChoice = choice => {
    if (!['accepted', 'rejected'].includes(choice)) return false;
    consent = { version: 1, choice, savedAt: Date.now() };
    try {
      window.localStorage.setItem(consentKey, JSON.stringify(consent));
      memoryOnlyChoice = false;
    } catch { memoryOnlyChoice = true; }
    settingsOpen = false;
    updateConsent();
    return true;
  };
  window.careerCookies = Object.freeze({
    getChoice() { updateConsent(); return consent?.choice || null; },
    setChoice
  });

  const createAccountCookieControls = () => {
    if (accountCookieStatus) return;
    accountCookieStatus = document.getElementById('account-cookie-status');
    if (!accountCookieStatus) return;
    accountCookieButtons = [...document.querySelectorAll('[data-account-cookie-choice]')];
    accountCookieButtons.forEach(button => {
      button.disabled = false;
      button.addEventListener('click', () => setChoice(button.dataset.accountCookieChoice));
    });
  };

  const createCookieControls = () => {
    if (banner || !document.body) return;
    banner = document.createElement('section');
    banner.className = 'cookie-banner';
    banner.hidden = true;
    banner.setAttribute('aria-labelledby', 'cookie-banner-title');
    banner.setAttribute('aria-describedby', 'cookie-banner-description');
    banner.innerHTML = `
      <div class="cookie-banner-copy">
        <h2 id="cookie-banner-title">Your cookie choices</h2>
        <p id="cookie-banner-description">Essential cookies keep you signed in and secure. You can accept or reject optional cookies. We don't currently use analytics or advertising cookies. <a href="/privacy.html#cookies">Read our cookie policy</a>.</p>
      </div>
      <div class="cookie-banner-actions">
        <button class="cookie-banner-button" type="button" data-cookie-choice="rejected">Reject optional</button>
        <button class="cookie-banner-button" type="button" data-cookie-choice="accepted">Accept optional</button>
      </div>`;

    banner.querySelectorAll('[data-cookie-choice]').forEach(button => {
      button.addEventListener('click', () => {
        const restoreFocus = settingsOpen;
        setChoice(button.dataset.cookieChoice);
        if (restoreFocus) settingsButton?.focus();
      });
    });
    document.body.append(banner);

    const footerNavigation = document.querySelector('footer nav[aria-label="Footer navigation"], footer nav');
    if (footerNavigation) {
      settingsButton = document.createElement('button');
      settingsButton.type = 'button';
      settingsButton.className = 'cookie-settings-button';
      settingsButton.textContent = 'Cookie settings';
      settingsButton.addEventListener('click', () => {
        settingsOpen = true;
        banner.hidden = false;
        banner.querySelector('[data-cookie-choice]').focus({ preventScroll: true });
      });
      footerNavigation.append(settingsButton);
    }
  };

  const updatePage = () => {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('[data-current-year]').forEach(element => {
      element.textContent = year;
    });
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
      link.relList.add('noopener', 'noreferrer');
    });
    createCookieControls();
    createAccountCookieControls();
    updateConsent();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updatePage, { once: true });
  } else updatePage();
  // Update dates when a tab is restored from the browser's back/forward cache.
  window.addEventListener('pageshow', updatePage);
  window.addEventListener('storage', event => {
    if (event.key === consentKey || event.key === null) {
      memoryOnlyChoice = false;
      updateConsent();
    }
  });
})();
