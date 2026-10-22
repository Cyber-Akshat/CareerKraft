(() => {
  'use strict';

  const video = document.getElementById('intro-film-video');
  if (!video) return;

  const section = document.getElementById('product-film');
  const status = document.getElementById('intro-film-status');
  const fullscreenButton = document.querySelector('[data-fullscreen-intro-film]');
  let playRequest = 0;

  const announce = message => { if (status) status.textContent = message; };
  const reducedMotion = () => document.documentElement.dataset.reducedMotion === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('[data-play-intro-film]').forEach(control => {
    control.addEventListener('click', event => {
      if (event.defaultPrevented || (control.tagName === 'A' && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0))) return;
      event.preventDefault();
      const request = ++playRequest;
      section?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      video.focus({ preventScroll: true });
      announce('Loading the CareerKraft film…');
      try {
        // Call play within the click event so browsers recognise the user gesture.
        const playing = video.play();
        Promise.resolve(playing).catch(() => {
          if (request === playRequest) {
            announce('The film could not start. Try the player controls or open the video using the link below.');
          }
        });
      } catch {
        announce('The film could not start. Try the player controls or open the video using the link below.');
      }
    });
  });

  video.addEventListener('playing', () => announce('Playing the CareerKraft film.'));
  video.addEventListener('pause', () => {
    // Keep a user pause in place and ignore any play request it interrupted.
    playRequest += 1;
    if (!video.ended) announce('Film paused. Press play when you are ready to continue.');
  });
  video.addEventListener('ended', () => announce('Film finished. Use the player controls to watch it again.'));
  video.addEventListener('error', () => announce('The film could not load. Open the video using the link below.'));

  if (fullscreenButton) {
    const fullscreenAvailable = typeof video.requestFullscreen === 'function' || typeof video.webkitEnterFullscreen === 'function';
    fullscreenButton.hidden = !fullscreenAvailable;
    if (fullscreenAvailable) {
      fullscreenButton.addEventListener('click', () => {
        try {
          const request = video.requestFullscreen ? video.requestFullscreen() : video.webkitEnterFullscreen();
          Promise.resolve(request).catch(() => announce('Full screen is unavailable here. You can open the video using the link below.'));
        } catch {
          announce('Full screen is unavailable here. You can open the video using the link below.');
        }
      });
    }
  }

  // Muted playback can start automatically when the film enters the viewport.
  video.muted = true;
  if (typeof window.IntersectionObserver === 'function') {
    let inView = false;
    const isFullscreen = () => document.fullscreenElement === video || video.webkitDisplayingFullscreen;
    const pauseOffscreen = () => {
      if (inView || isFullscreen()) return;
      // Also cancel playback that is still waiting for media to load.
      playRequest += 1;
      video.pause();
    };
    const observer = new window.IntersectionObserver(entries => {
      const entry = entries[entries.length - 1];
      if (!entry || entry.target !== video) return;
      const visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      // A manual pause stays in place until the film leaves and re-enters view.
      if (visible === inView) return;
      inView = visible;
      if (isFullscreen()) return;
      if (!inView) {
        pauseOffscreen();
        return;
      }

      const request = ++playRequest;
      const autoplayUnavailable = () => {
        if (request === playRequest && !video.error) {
          announce('Press play to start the introduction.');
        }
      };
      try {
        Promise.resolve(video.play()).catch(autoplayUnavailable);
      } catch {
        autoplayUnavailable();
      }
    }, { threshold: 0.25 });
    observer.observe(video);
    document.addEventListener('fullscreenchange', pauseOffscreen);
    video.addEventListener('webkitendfullscreen', pauseOffscreen);
  }
})();
