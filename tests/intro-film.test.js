const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets', 'intro-film.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(t, { reducedMotion = false, fullscreen = false, webkitFullscreen = false, autoplayOutcome = 'resolve', intersectionObserver = true } = {}) {
  const dom = new JSDOM(`<!doctype html>
    <a href="#product-film" data-play-intro-film>Watch the film</a>
    <section id="product-film">
      <video id="intro-film-video" controls muted loop playsinline preload="auto" tabindex="0"></video>
      <button data-fullscreen-intro-film hidden>View full screen</button>
      <p id="intro-film-status" role="status" aria-live="polite"></p>
      <a data-film-fallback href="assets/CareerKraft-film-v2-brand.mp4">Open the video</a>
    </section>`, { url: 'http://localhost:3000/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const video = document.getElementById('intro-film-video');
  const state = { plays: 0, pauses: 0, fullscreen: 0, paused: true, scrolls: [], observers: [] };
  Object.defineProperty(video, 'paused', { get: () => state.paused });
  window.matchMedia = () => ({ matches: reducedMotion });
  document.getElementById('product-film').scrollIntoView = options => state.scrolls.push(options);
  video.play = () => {
    state.plays += 1;
    if (state.plays === 1) {
      if (autoplayOutcome === 'reject') return Promise.reject(new Error('Autoplay blocked'));
      if (autoplayOutcome === 'throw') throw new Error('Autoplay unavailable');
      if (autoplayOutcome === 'pending') return new Promise((resolve, reject) => { state.rejectAutoplay = reject; });
    }
    state.paused = false;
    video.dispatchEvent(new window.Event('playing'));
    return Promise.resolve();
  };
  video.pause = () => {
    state.pauses += 1;
    state.paused = true;
    video.dispatchEvent(new window.Event('pause'));
  };
  if (fullscreen) video.requestFullscreen = () => { state.fullscreen += 1; return Promise.resolve(); };
  if (webkitFullscreen) video.webkitEnterFullscreen = () => { state.fullscreen += 1; };
  window.IntersectionObserver = intersectionObserver ? class {
    constructor(callback, options) { this.callback = callback; this.options = options; state.observers.push(this); }
    observe(target) { this.target = target; }
  } : undefined;
  window.eval(script);
  return {
    window, document, video, state,
    play: () => document.querySelector('[data-play-intro-film]').click(),
    intersection: (visible, ratio = visible ? 1 : 0) => state.observers.forEach(observer => observer.callback([{ target: video, isIntersecting: visible, intersectionRatio: ratio }])),
    status: () => document.getElementById('intro-film-status').textContent
  };
}

test('the published player defers autoplay to scrolling and retains muted looping with accessible controls', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'));
  try {
    const video = dom.window.document.getElementById('intro-film-video');
    assert.equal(video.autoplay, false);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.loop, true);
    assert.equal(video.playsInline, true);
    assert.equal(video.preload, 'auto');
    assert.equal(video.controls, true);
  } finally {
    dom.window.close();
  }
});

test('the film waits for scrolling while its play shortcut remains available', t => {
  const page = setup(t);
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.pauses, 0);
  assert.equal(page.video.muted, true);
  assert.equal(page.video.controls, true);
  page.play();
  assert.equal(page.state.plays, 1);
  assert.equal(page.document.activeElement, page.video);
  assert.equal(page.state.scrolls[0].behavior, 'smooth');
  assert.match(page.status(), /Playing/);
});

test('blocked scroll autoplay offers manual playback without retrying while it stays visible', async t => {
  for (const autoplayOutcome of ['reject', 'throw']) {
    const page = setup(t, { autoplayOutcome });
    page.intersection(true);
    await settle();
    assert.match(page.status(), /Press play to start/);
    assert.equal(page.state.paused, true);
    page.intersection(true);
    page.intersection(true, 0.75);
    assert.equal(page.state.plays, 1);
    assert.equal(page.state.pauses, 0);
    page.play();
    assert.equal(page.state.plays, 2);
    assert.equal(page.state.paused, false);
  }
});

test('a user pause is not overwritten by a late autoplay rejection', async t => {
  const page = setup(t, { autoplayOutcome: 'pending' });
  page.intersection(true);
  page.video.pause();
  assert.match(page.status(), /Film paused/);
  page.state.rejectAutoplay(new Error('Autoplay interrupted by pause'));
  await settle();
  assert.match(page.status(), /Film paused/);
  assert.doesNotMatch(page.status(), /Press play to start|could not start/);
  assert.equal(page.state.plays, 1);
});

test('the play shortcut respects reduced motion', t => {
  const page = setup(t, { reducedMotion: true });
  page.play();
  assert.equal(page.state.scrolls[0].behavior, 'auto');
  assert.equal(page.state.plays, 1);
});

test('a rejected play request offers the permanent video link', async t => {
  const page = setup(t);
  page.video.play = () => Promise.reject(new Error('Playback unavailable'));
  page.play();
  await settle();
  assert.match(page.status(), /could not start/);
  const fallback = page.document.querySelector('[data-film-fallback]');
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.getAttribute('href'), 'assets/CareerKraft-film-v2-brand.mp4');
});

test('the film plays on entry, pauses on exit, and resumes on re-entry', t => {
  const page = setup(t);
  assert.equal(page.state.observers.length, 1);
  assert.equal(page.state.observers[0].target, page.video);
  page.intersection(false);
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.pauses, 0);
  page.intersection(true);
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.paused, false);
  assert.match(page.status(), /Playing/);
  page.intersection(false);
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
  page.intersection(false);
  assert.equal(page.state.pauses, 1);
  page.intersection(true);
  assert.equal(page.state.plays, 2);
  assert.equal(page.state.paused, false);
});

test('the film requires at least a quarter of its area to be visible', t => {
  const page = setup(t);
  page.intersection(true, 0.1);
  page.intersection(true, 0.249);
  page.intersection(false, 1);
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.pauses, 0);
  page.intersection(true, 0.25);
  assert.equal(page.state.plays, 1);
  page.intersection(true, 0.75);
  assert.equal(page.state.plays, 1);
  page.intersection(true, 0.24);
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
});

test('rapid scroll changes use the latest visibility entry in an observer batch', t => {
  const page = setup(t);
  const observer = page.state.observers[0];
  const entry = visible => ({ target: page.video, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 });
  observer.callback([entry(true), entry(false)]);
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.pauses, 0);
  observer.callback([entry(false), entry(true)]);
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.paused, false);
  observer.callback([entry(true), entry(false)]);
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
});

test('a user pause persists through repeated visible callbacks and resumes after leaving and returning', t => {
  const page = setup(t);
  page.intersection(true);
  page.video.pause();
  assert.equal(page.state.paused, true);
  assert.match(page.status(), /Film paused/);
  page.intersection(true);
  page.intersection(true, 0.5);
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
  page.intersection(false);
  page.intersection(true);
  assert.equal(page.state.plays, 2);
  assert.equal(page.state.paused, false);
});

test('leaving view cancels a pending autoplay request even without a pause event', async t => {
  const page = setup(t, { autoplayOutcome: 'pending' });
  page.intersection(true);
  page.video.pause = () => { page.state.pauses += 1; page.state.paused = true; };
  page.intersection(false);
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.pauses, 1);
  page.state.rejectAutoplay(new Error('Play interrupted by scrolling'));
  await settle();
  assert.doesNotMatch(page.status(), /Press play to start|could not start/);
});

test('leaving view cancels a pending play shortcut without reporting a playback error', async t => {
  const page = setup(t);
  page.intersection(true);
  let rejectPlayback;
  page.video.play = () => {
    page.state.plays += 1;
    return new Promise((resolve, reject) => { rejectPlayback = reject; });
  };
  page.play();
  page.video.pause = () => { page.state.pauses += 1; page.state.paused = true; };
  page.intersection(false);
  assert.equal(page.state.plays, 2);
  assert.equal(page.state.pauses, 1);
  rejectPlayback(new Error('Play interrupted by scrolling'));
  await settle();
  assert.doesNotMatch(page.status(), /could not start/);
});

test('unsupported IntersectionObserver leaves the film available for manual playback', t => {
  const page = setup(t, { intersectionObserver: false });
  assert.equal(page.state.observers.length, 0);
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.pauses, 0);
  page.play();
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.paused, false);
});

test('modified anchor clicks retain native link behavior instead of starting playback', t => {
  const page = setup(t);
  const anchor = page.document.querySelector('[data-play-intro-film]');
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    const click = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true });
    anchor.dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, modifier);
  }
  assert.equal(page.state.plays, 0);
  assert.equal(page.state.scrolls.length, 0);
});

test('pausing a pending play request does not report an interrupted play as an error', async t => {
  const page = setup(t);
  let rejectPlayback;
  page.video.play = () => new Promise((resolve, reject) => { rejectPlayback = reject; });
  page.play();
  page.video.pause();
  assert.equal(page.state.pauses, 1);
  assert.match(page.status(), /Film paused/);
  rejectPlayback(new Error('Play interrupted by pause'));
  await settle();
  assert.doesNotMatch(page.status(), /could not start/);
});

test('full-screen viewing requires a click and reports failure accessibly', async t => {
  const page = setup(t, { fullscreen: true });
  const button = page.document.querySelector('[data-fullscreen-intro-film]');
  assert.equal(button.hidden, false);
  assert.equal(page.state.fullscreen, 0);
  button.click();
  assert.equal(page.state.fullscreen, 1);
  page.video.requestFullscreen = () => Promise.reject(new Error('Not allowed'));
  button.click();
  await settle();
  assert.match(page.status(), /Full screen is unavailable/);
});

test('full-screen viewing supports the native iOS API and hides unsupported controls', t => {
  const supported = setup(t, { webkitFullscreen: true });
  supported.document.querySelector('[data-fullscreen-intro-film]').click();
  assert.equal(supported.state.fullscreen, 1);
  const unsupported = setup(t);
  assert.equal(unsupported.document.querySelector('[data-fullscreen-intro-film]').hidden, true);
});

test('a full-screen film keeps playing offscreen and pauses on fullscreen exit', t => {
  const page = setup(t, { fullscreen: true });
  page.intersection(true);
  Object.defineProperty(page.document, 'fullscreenElement', { configurable: true, value: page.video });
  page.intersection(false);
  assert.equal(page.state.pauses, 0);
  assert.equal(page.state.paused, false);
  Object.defineProperty(page.document, 'fullscreenElement', { configurable: true, value: null });
  page.document.dispatchEvent(new page.window.Event('fullscreenchange'));
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
});

test('the iOS fullscreen player keeps playing offscreen and pauses on exit', t => {
  const page = setup(t, { webkitFullscreen: true });
  page.intersection(true);
  page.video.webkitDisplayingFullscreen = true;
  page.intersection(false);
  assert.equal(page.state.pauses, 0);
  assert.equal(page.state.paused, false);
  page.video.webkitDisplayingFullscreen = false;
  page.video.dispatchEvent(new page.window.Event('webkitendfullscreen'));
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
});

test('leaving fullscreen while the film remains visible preserves playback', t => {
  const page = setup(t, { fullscreen: true });
  page.intersection(true);
  page.document.dispatchEvent(new page.window.Event('fullscreenchange'));
  assert.equal(page.state.pauses, 0);
  assert.equal(page.state.paused, false);
});

test('viewport changes during fullscreen do not resume a manually paused film', t => {
  const page = setup(t, { fullscreen: true });
  page.intersection(true);
  Object.defineProperty(page.document, 'fullscreenElement', { value: page.video });
  page.video.pause();
  page.intersection(false);
  page.intersection(true);
  assert.equal(page.state.plays, 1);
  assert.equal(page.state.pauses, 1);
  assert.equal(page.state.paused, true);
});

test('media errors are announced and the script tolerates pages without the film', t => {
  const page = setup(t);
  page.video.dispatchEvent(new page.window.Event('error'));
  assert.match(page.status(), /could not load/);
  page.document.getElementById('product-film').remove();
  assert.doesNotThrow(() => page.window.eval(script));
});
