// Apply reading and display preferences before the page's styles are loaded.
(() => {
  'use strict';
  const storageKey = 'careerkraft-accessibility';
  const defaults = Object.freeze({ dyslexiaFont: false, fontSize: 'default', contrast: 'default', saturation: 'default', cursorSize: 'default' });
  const choices = {
    fontSize: ['small', 'default', 'large'], contrast: ['default', 'high'],
    saturation: ['default', 'low', 'high', 'grayscale'], cursorSize: ['small', 'default', 'large']
  };
  let current = { ...defaults };
  let memoryOnly = false;

  function normalize(value) {
    const preferences = { ...defaults };
    if (!value || typeof value !== 'object') return preferences;
    preferences.dyslexiaFont = value.dyslexiaFont === true;
    for (const [key, allowed] of Object.entries(choices)) {
      if (allowed.includes(value[key])) preferences[key] = value[key];
    }
    return preferences;
  }

  function read() {
    if (memoryOnly) return { ...current };
    try { return normalize(JSON.parse(window.localStorage.getItem(storageKey))); }
    catch { return { ...current }; }
  }

  function apply(value, { persist = true } = {}) {
    current = normalize(value);
    const root = document.documentElement;
    for (const [key, preference] of Object.entries(current)) root.dataset[key] = String(preference);
    root.style.setProperty('--ck-text-scale', String({ small: 0.9, default: 1, large: 1.2 }[current.fontSize]));
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(current));
        memoryOnly = false;
      } catch { memoryOnly = true; }
    }
    window.dispatchEvent(new CustomEvent('careerkraft:accessibility-change', { detail: { ...current } }));
    return { ...current };
  }

  window.careerAccessibility = Object.freeze({ defaults, normalize, read, apply });
  apply(read(), { persist: false });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    memoryOnly = false;
    apply(read(), { persist: false });
  });

  // Scale explicit text sizes in the existing styles, retaining their media
  // queries and hierarchy. Keeping the root size unchanged prevents rem sizes
  // from being multiplied twice and leaves fixed panels and pointer positions alone.
  const processedSheets = new WeakSet();
  function scaleStyle(style) {
    const size = style.getPropertyValue('font-size');
    if (!size || size.includes('--ck-text-scale') || !/\d(?:px|rem|vw|vh|vmin|vmax)\b/.test(size)) return;
    style.setProperty('font-size', `calc(${size} * var(--ck-text-scale, 1))`, style.getPropertyPriority('font-size'));
  }
  function scaleRules(rules) {
    for (const rule of rules) {
      if (rule.style && rule.selectorText) {
        let matchesRoot = false;
        try { matchesRoot = document.documentElement.matches(rule.selectorText); } catch {}
        if (!matchesRoot) scaleStyle(rule.style);
      }
      if (rule.cssRules) scaleRules(rule.cssRules);
    }
  }
  function scaleSheets() {
    for (const sheet of document.styleSheets) {
      if (processedSheets.has(sheet)) continue;
      try {
        scaleRules(sheet.cssRules);
        processedSheets.add(sheet);
      } catch { /* Cross-origin font stylesheets do not contain app text sizes. */ }
    }
  }
  function scaleInline(element) {
    if (element !== document.documentElement && element.style) scaleStyle(element.style);
    element.querySelectorAll?.('[style]').forEach(child => scaleStyle(child.style));
  }
  function prepareTextSizes() {
    scaleSheets();
    scaleInline(document.body);
    const observer = new MutationObserver(mutations => {
      let sheetsChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') scaleStyle(mutation.target.style);
        else {
          if (mutation.target.nodeName === 'STYLE') sheetsChanged = true;
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            scaleInline(node);
            if (node.matches('style, link[rel="stylesheet"]') || node.querySelector('style, link[rel="stylesheet"]')) sheetsChanged = true;
          }
        }
      }
      if (sheetsChanged) scaleSheets();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    document.addEventListener('load', event => {
      if (event.target.matches?.('link[rel="stylesheet"]')) scaleSheets();
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareTextSizes, { once: true });
  else prepareTextSizes();
})();
