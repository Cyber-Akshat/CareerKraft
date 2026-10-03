gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;



/* =========================================
   SMOOTH SCROLL — LENIS
========================================= */

const lenis = new Lenis({
  smoothWheel: !prefersReducedMotion,
  smoothTouch: false
});

lenis.on(
  "scroll",
  ScrollTrigger.update
);


gsap.ticker.add((time) => {

  lenis.raf(time * 1000);

});


gsap.ticker.lagSmoothing(0);



/* =========================================
   LOADER
========================================= */

const loader =
  document.querySelector("#loader");


const loaderLine =
  document.querySelector(
    ".loader-line span"
  );


const loaderLogo =
  document.querySelector(
    ".loader-logo"
  );


const loaderText =
  document.querySelector(
    ".loader p"
  );


const loadingTimeline =
  gsap.timeline({
    defaults: {
      ease: "power3.out"
    }
  });


loadingTimeline

  .from(
    loaderLogo,
    {
      scale: 0.6,
      opacity: 0,
      duration: 0.8
    }
  )

  .from(
    loaderText,
    {
      y: 15,
      opacity: 0,
      duration: 0.5
    },
    "-=0.3"
  )

  .to(
    loaderLine,
    {
      scaleX: 1,
      duration: 1.2,
      ease: "power2.inOut"
    }
  )

  .to(
    loaderLogo,
    {
      scale: 1.08,
      duration: 0.25
    }
  )

  .to(
    loaderLogo,
    {
      scale: 1,
      duration: 0.25
    }
  )

  .to(
    loader,
    {
      yPercent: -100,
      duration: 1,
      ease: "power4.inOut",
      delay: 0.15
    }
  )

  .set(
    loader,
    {
      display: "none"
    }
  )

  .add(
    heroIntroAnimation
  );



/* =========================================
   HERO INTRO
========================================= */

function heroIntroAnimation() {

  const heroLines =
    document.querySelectorAll(
      ".hero-line"
    );


  const heroKicker =
    document.querySelector(
      ".hero-kicker"
    );


  const heroDescription =
    document.querySelector(
      ".hero-description"
    );


  const heroActions =
    document.querySelector(
      ".hero-actions"
    );


  const heroLogo =
    document.querySelector(
      ".hero-logo"
    );


  const scrollIndicator =
    document.querySelector(
      ".scroll-indicator"
    );


  const timeline =
    gsap.timeline();


  timeline

    .from(
      heroKicker,
      {
        y: 20,
        opacity: 0,
        duration: 0.6
      }
    )

    .from(
      heroLines,
      {
        y: 100,
        opacity: 0,
        stagger: 0.12,
        duration: 1.1,
        ease: "power4.out"
      },
      "-=0.15"
    )

    .from(
      heroDescription,
      {
        y: 30,
        opacity: 0,
        duration: 0.7
      },
      "-=0.5"
    )

    .from(
      heroActions,
      {
        y: 20,
        opacity: 0,
        duration: 0.6
      },
      "-=0.4"
    )

    .from(
      scrollIndicator,
      {
        opacity: 0,
        y: 20,
        duration: 0.6
      },
      "-=0.2"
    );


  if (heroLogo) {

    gsap.fromTo(
      heroLogo,
      {
        scale: 0.75,
        rotate: -8
      },
      {
        scale: 1,
        rotate: 0,
        duration: 2,
        ease: "power3.out"
      }
    );

  }

}



/* =========================================
   HERO PARALLAX
========================================= */

gsap.to(
  ".hero-content",
  {

    yPercent: 18,

    opacity: 0.15,

    ease: "none",

    scrollTrigger: {

      trigger: ".hero",

      start: "top top",

      end: "bottom top",

      scrub: true

    }

  }
);


gsap.to(
  ".hero-logo",
  {

    yPercent: -25,

    rotate: 12,

    scale: 1.15,

    ease: "none",

    scrollTrigger: {

      trigger: ".hero",

      start: "top top",

      end: "bottom top",

      scrub: true

    }

  }
);


gsap.to(
  ".hero-orb-one",
  {

    x: 160,

    y: 120,

    ease: "none",

    scrollTrigger: {

      trigger: ".hero",

      start: "top top",

      end: "bottom top",

      scrub: 1.2

    }

  }
);


gsap.to(
  ".hero-orb-two",
  {

    x: -130,

    y: -120,

    ease: "none",

    scrollTrigger: {

      trigger: ".hero",

      start: "top top",

      end: "bottom top",

      scrub: 1.2

    }

  }
);



/* =========================================
   NAVBAR SCROLL EFFECT
========================================= */

const navbar =
  document.querySelector(
    "#navbar"
  );


let previousScroll = 0;


window.addEventListener(
  "scroll",
  () => {

    const currentScroll =
      window.scrollY;


    if (
      currentScroll > 80
    ) {

      navbar.style.background =
        "rgba(8, 3, 14, 0.88)";


      navbar.style.borderColor =
        "rgba(205, 169, 255, 0.20)";

    }

    else {

      navbar.style.background =
        "rgba(8, 3, 14, 0.58)";


      navbar.style.borderColor =
        "rgba(205, 169, 255, 0.12)";

    }


    if (
      currentScroll >
      previousScroll &&
      currentScroll > 500
    ) {

      gsap.to(
        navbar,
        {
          y: -110,
          duration: 0.4,
          ease: "power3.out"
        }
      );

    }

    else {

      gsap.to(
        navbar,
        {
          y: 0,
          duration: 0.4,
          ease: "power3.out"
        }
      );

    }


    previousScroll =
      currentScroll;

  }
);



/* =========================================
   CUSTOM CURSOR
========================================= */

const cursor =
  document.querySelector(
    "#cursor"
  );


const cursorDot =
  document.querySelector(
    "#cursor-dot"
  );


if (
  window.innerWidth > 700 &&
  cursor &&
  cursorDot
) {

  window.addEventListener(
    "mousemove",
    (event) => {

      gsap.to(
        cursor,
        {
          x: event.clientX,
          y: event.clientY,
          duration: 0.3,
          ease: "power3.out"
        }
      );


      gsap.to(
        cursorDot,
        {
          x: event.clientX,
          y: event.clientY,
          duration: 0.05
        }
      );

    }
  );


  const interactiveElements =
    document.querySelectorAll(
      "a, button, input, .feature-panel, .journey-item"
    );


  interactiveElements.forEach(
    (element) => {

      element.addEventListener(
        "mouseenter",
        () => {

          gsap.to(
            cursor,
            {
              width: 58,
              height: 58,
              background:
                "rgba(156, 92, 255, 0.12)",
              duration: 0.25
            }
          );

        }
      );


      element.addEventListener(
        "mouseleave",
        () => {

          gsap.to(
            cursor,
            {
              width: 34,
              height: 34,
              background:
                "transparent",
              duration: 0.25
            }
          );

        }
      );

    }
  );

}



/* =========================================
   MAGNETIC BUTTONS
========================================= */

const magneticElements =
  document.querySelectorAll(
    ".magnetic"
  );


magneticElements.forEach(
  (element) => {

    element.addEventListener(
      "mousemove",
      (event) => {

        const rect =
          element
            .getBoundingClientRect();


        const x =
          event.clientX -
          rect.left -
          rect.width / 2;


        const y =
          event.clientY -
          rect.top -
          rect.height / 2;


        gsap.to(
          element,
          {
            x: x * 0.18,
            y: y * 0.18,
            duration: 0.3,
            ease: "power2.out"
          }
        );

      }
    );


    element.addEventListener(
      "mouseleave",
      () => {

        gsap.to(
          element,
          {
            x: 0,
            y: 0,
            duration: 0.5,
            ease: "elastic.out(1, 0.4)"
          }
        );

      }
    );

  }
);



/* =========================================
   GENERIC TEXT REVEALS
========================================= */

gsap.utils
  .toArray(
    "[data-reveal]"
  )
  .forEach(
    (element) => {

      gsap.from(
        element,
        {

          y: 45,

          opacity: 0,

          duration: 0.9,

          ease: "power3.out",

          scrollTrigger: {

            trigger: element,

            start:
              "top 88%",

            toggleActions:
              "play none none none"

          }

        }
      );

    }
  );



/* =========================================
   STATEMENT SECTION
========================================= */

gsap.from(
  ".statement-heading",
  {

    y: 64,

    opacity: 0,

    duration: 1.1,

    ease: "power4.out",

    scrollTrigger: {

      trigger:
        ".statement-section",

      start:
        "top 70%"

    }

  }
);


gsap.from(
  ".statement-heading span",
  {

    color:
      "#ffffff",

    duration: 1.3,

    scrollTrigger: {

      trigger:
        ".statement-heading",

      start:
        "top 70%",

      end:
        "bottom 45%",

      scrub: true

    }

  }
);



/* =========================================
   STAT COUNTERS
========================================= */

const counters =
  document.querySelectorAll(
    ".counter"
  );


counters.forEach(
  (counter) => {

    const finalValue =
      Number(
        counter.dataset.count
      );


    const counterObject = {
      value: 0
    };


    gsap.to(
      counterObject,
      {

        value:
          finalValue,

        duration:
          2,

        ease:
          "power2.out",

        scrollTrigger: {

          trigger:
            counter,

          start:
            "top 85%",

          once:
            true

        },


        onUpdate:
          () => {

            counter.textContent =
              Math.round(
                counterObject.value
              );

          }

      }
    );

  }
);



/* =========================================
   STAT SCENES
========================================= */

gsap.utils
  .toArray(
    ".stat-scene"
  )
  .forEach(
    (scene) => {

      const number =
        scene.querySelector(
          ".stat-number"
        );


      const copy =
        scene.querySelector(
          ".stat-copy"
        );


      gsap.from(
        number,
        {

          scale: 0.84,

          opacity: 0,

          x: -44,

          duration: 1,

          ease: "power3.out",

          scrollTrigger: {

            trigger: scene,

            start:
              "top 72%"

          }

        }
      );


      gsap.from(
        copy,
        {

          opacity: 0,

          x: 70,

          duration: 1,

          ease: "power3.out",

          scrollTrigger: {

            trigger: scene,

            start:
              "top 70%"

          }

        }
      );

    }
  );



/* =========================================
   QUESTION SECTION
========================================= */

gsap.from(
  ".question-small",
  {

    opacity: 0,

    y: 30,

    scrollTrigger: {

      trigger:
        ".question-section",

      start:
        "top 65%"

    }

  }
);


gsap.from(
  ".question-section h2",
  {

    opacity: 0,

    y: 60,

    duration: 1,

    ease: "power4.out",

    scrollTrigger: {

      trigger:
        ".question-section",

      start:
        "top 65%"

    }

  }
);


gsap.from(
  ".question-reveal",
  {

    opacity: 0,

    scale: 0.85,

    duration: 1,

    ease: "power3.out",

    scrollTrigger: {

      trigger:
        ".question-reveal",

      start:
        "top 80%"

    }

  }
);



/* =========================================
   CAREERKRAFT BRAND REVEAL
========================================= */

const brandTimeline =
  gsap.timeline({

    scrollTrigger: {

      trigger:
        ".brand-reveal-section",

      start:
        "top 65%"

    }

  });


brandTimeline

  .from(
    ".brand-reveal-logo",
    {

      scale: 0.4,

      rotate: -20,

      opacity: 0,

      duration: 1,

      ease: "back.out(1.6)"

    }
  )

  .from(
    ".brand-reveal-section .section-tag",
    {

      y: 20,

      opacity: 0,

      duration: 0.5

    },
    "-=0.4"
  )

  .from(
    ".brand-reveal-section h2",
    {

      y: 60,

      opacity: 0,

      duration: 0.9,

      ease: "power4.out"

    },
    "-=0.2"
  )

  .from(
    ".brand-reveal-description",
    {

      y: 25,

      opacity: 0,

      duration: 0.6

    },
    "-=0.4"
  )

  .from(
    ".brand-manifesto span",
    {

      opacity: 0,

      y: 30,

      stagger: 0.14,

      duration: 0.7

    },
    "-=0.2"
  );



/* =========================================
   MANIFESTO ACTIVE WORDS
========================================= */

const manifestoWords =
  document.querySelectorAll(
    ".brand-manifesto span"
  );


manifestoWords.forEach(
  (word, index) => {

    gsap.to(
      word,
      {

        color:
          "#c9a6ff",

        scale:
          1.08,

        duration:
          0.4,

        scrollTrigger: {

          trigger:
            ".brand-manifesto",

          start:
            `top ${80 - index * 4}%`,

          toggleActions:
            "play reverse play reverse"

        }

      }
    );

  }
);



/* =========================================
   JOURNEY PATH PROGRESS
========================================= */

gsap.to(
  "#journey-progress",
  {

    height:
      "100%",

    ease:
      "none",

    scrollTrigger: {

      trigger:
        ".journey-experience",

      start:
        "top 55%",

      end:
        "bottom 65%",

      scrub:
        true

    }

  }
);



/* =========================================
   JOURNEY ITEMS
========================================= */

const journeyItems =
  document.querySelectorAll(
    ".journey-item"
  );


journeyItems.forEach(
  (item) => {

    const marker =
      item.querySelector(
        ".journey-marker"
      );


    const content =
      item.querySelector(
        ".journey-content"
      );


    gsap.from(
      marker,
      {

        scale:
          0.5,

        opacity:
          0,

        duration:
          0.6,

        ease:
          "back.out(1.7)",

        scrollTrigger: {

          trigger:
            item,

          start:
            "top 72%"

        }

      }
    );


    gsap.from(
      content,
      {

        x:
          56,

        opacity:
          0,

        duration:
          0.9,

        ease:
          "power4.out",

        scrollTrigger: {

          trigger:
            item,

          start:
            "top 70%"

        }

      }
    );


    ScrollTrigger.create({

      trigger:
        item,

      start:
        "top 55%",

      end:
        "bottom 45%",


      onEnter:
        () => {

          gsap.to(
            marker,
            {

              background:
                "#7b39e8",

              scale:
                1.1,

              boxShadow:
                "0 0 35px rgba(156, 92, 255, 0.45)",

              duration:
                0.3

            }
          );

        },


      onLeave:
        () => {

          gsap.to(
            marker,
            {

              background:
                "#0b0513",

              scale:
                1,

              boxShadow:
                "0 0 30px rgba(156, 92, 255, 0.08)",

              duration:
                0.3

            }
          );

        },


      onEnterBack:
        () => {

          gsap.to(
            marker,
            {

              background:
                "#7b39e8",

              scale:
                1.1,

              boxShadow:
                "0 0 35px rgba(156, 92, 255, 0.45)",

              duration:
                0.3

            }
          );

        },


      onLeaveBack:
        () => {

          gsap.to(
            marker,
            {

              background:
                "#0b0513",

              scale:
                1,

              boxShadow:
                "0 0 30px rgba(156, 92, 255, 0.08)",

              duration:
                0.3

            }
          );

        }

    });

  }
);



/* =========================================
   CAREER MATCH CARDS
========================================= */

gsap.from(
  ".career-match-preview article",
  {

    x:
      80,

    opacity:
      0,

    stagger:
      0.12,

    duration:
      0.8,

    ease:
      "power3.out",

    scrollTrigger: {

      trigger:
        ".career-match-preview",

      start:
        "top 80%"

    }

  }
);



/* =========================================
   ROADMAP DEMO
========================================= */

gsap.from(
  ".roadmap-demo-step",
  {

    x:
      70,

    opacity:
      0,

    stagger:
      0.13,

    duration:
      0.7,

    ease:
      "power3.out",

    scrollTrigger: {

      trigger:
        ".roadmap-demo",

      start:
        "top 80%"

    }

  }
);



/* =========================================
   SKILLS
========================================= */

gsap.from(
  ".skill-cloud span",
  {

    scale:
      0.7,

    opacity:
      0,

    stagger:
      0.12,

    duration:
      0.6,

    ease:
      "back.out(1.5)",

    scrollTrigger: {

      trigger:
        ".skill-cloud",

      start:
        "top 82%"

    }

  }
);



/* =========================================
   EVIDENCE SCANNER
========================================= */

gsap.from(
  ".evidence-card",
  {

    scale:
      0.88,

    opacity:
      0,

    duration:
      1,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".evidence-card",

      start:
        "top 82%"

    }

  }
);


gsap.to(
  ".scanner-line",
  {

    top:
      "calc(100% - 70px)",

    duration:
      2,

    ease:
      "power1.inOut",

    repeat:
      -1,

    yoyo:
      true

  }
);


gsap.from(
  ".evidence-result",
  {

    y:
      20,

    opacity:
      0,

    delay:
      0.7,

    duration:
      0.7,

    scrollTrigger: {

      trigger:
        ".evidence-card",

      start:
        "top 75%"

    }

  }
);



/* =========================================
   DESTINATION CARDS
========================================= */

gsap.from(
  ".destination-grid div",
  {

    y:
      50,

    opacity:
      0,

    stagger:
      0.15,

    duration:
      0.8,

    ease:
      "power3.out",

    scrollTrigger: {

      trigger:
        ".destination-grid",

      start:
        "top 82%"

    }

  }
);



/* =========================================
   FEATURE PANELS
========================================= */

const featurePanels =
  gsap.utils.toArray(
    ".feature-panel"
  );


featurePanels.forEach(
  (panel, index) => {

    gsap.from(
      panel,
      {

        y:
          90,

        opacity:
          0,

        duration:
          1,

        delay:
          index * 0.05,

        ease:
          "power4.out",

        scrollTrigger: {

          trigger:
            panel,

          start:
            "top 85%"

        }

      }
    );

  }
);



/* =========================================
   FEATURE PANEL MOUSE EFFECT
========================================= */

featurePanels.forEach(
  (panel) => {

    panel.addEventListener(
      "mousemove",
      (event) => {

        const rect =
          panel.getBoundingClientRect();


        const x =
          event.clientX -
          rect.left;


        const y =
          event.clientY -
          rect.top;


        const rotateY =
          (
            x -
            rect.width / 2
          ) / 40;


        const rotateX =
          -(
            y -
            rect.height / 2
          ) / 40;


        gsap.to(
          panel,
          {

            rotateX:
              rotateX,

            rotateY:
              rotateY,

            transformPerspective:
              900,

            duration:
              0.35,

            ease:
              "power2.out"

          }
        );

      }
    );


    panel.addEventListener(
      "mouseleave",
      () => {

        gsap.to(
          panel,
          {

            rotateX:
              0,

            rotateY:
              0,

            duration:
              0.6,

            ease:
              "power3.out"

          }
        );

      }
    );

  }
);



/* =========================================
   LUMIA SECTION
========================================= */

gsap.to(
  ".lumia-background-text",
  {

    xPercent:
      -12,

    ease:
      "none",

    scrollTrigger: {

      trigger:
        ".lumia-section",

      start:
        "top bottom",

      end:
        "bottom top",

      scrub:
        1

    }

  }
);


gsap.from(
  ".lumia-intro",
  {

    x:
      -80,

    opacity:
      0,

    duration:
      1,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".lumia-section",

      start:
        "top 65%"

    }

  }
);


gsap.from(
  ".lumia-interface",
  {

    x:
      100,

    rotate:
      4,

    opacity:
      0,

    duration:
      1.1,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".lumia-section",

      start:
        "top 65%"

    }

  }
);



/* =========================================
   LUMIA CHAT ANIMATION
========================================= */

gsap.from(
  ".message",
  {

    y:
      25,

    opacity:
      0,

    stagger:
      0.35,

    duration:
      0.55,

    ease:
      "power3.out",

    scrollTrigger: {

      trigger:
        ".lumia-chat",

      start:
        "top 78%"

    }

  }
);



/* =========================================
   IMPACT FLOW
========================================= */

gsap.from(
  ".impact-stage",
  {

    y:
      60,

    opacity:
      0,

    stagger:
      0.12,

    duration:
      0.8,

    ease:
      "power3.out",

    scrollTrigger: {

      trigger:
        ".impact-flow",

      start:
        "top 80%"

    }

  }
);


gsap.from(
  ".impact-connector",
  {

    opacity:
      0,

    scale:
      0,

    stagger:
      0.12,

    duration:
      0.5,

    scrollTrigger: {

      trigger:
        ".impact-flow",

      start:
        "top 80%"

    }

  }
);



/* =========================================
   IMPACT OUTCOMES
========================================= */

gsap.from(
  ".impact-outcomes article",
  {

    y:
      80,

    opacity:
      0,

    stagger:
      0.18,

    duration:
      1,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".impact-outcomes",

      start:
        "top 82%"

    }

  }
);



/* =========================================
   FUTURE SECTION
========================================= */

gsap.from(
  ".future-section h2",
  {

    scale:
      0.8,

    opacity:
      0,

    duration:
      1.4,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".future-section",

      start:
        "top 65%"

    }

  }
);


gsap.from(
  ".future-logo",
  {

    scale:
      0,

    rotate:
      -20,

    opacity:
      0,

    duration:
      1,

    ease:
      "back.out(1.7)",

    scrollTrigger: {

      trigger:
        ".future-logo",

      start:
        "top 85%"

    }

  }
);



/* =========================================
   EARLY ACCESS
========================================= */

gsap.to(
  ".early-access-background",
  {

    xPercent:
      -8,

    ease:
      "none",

    scrollTrigger: {

      trigger:
        ".early-access-section",

      start:
        "top bottom",

      end:
        "bottom top",

      scrub:
        1

    }

  }
);


gsap.from(
  ".early-access-content",
  {

    y:
      80,

    opacity:
      0,

    duration:
      1.2,

    ease:
      "power4.out",

    scrollTrigger: {

      trigger:
        ".early-access-section",

      start:
        "top 70%"

    }

  }
);



/* =========================================
   EARLY ACCESS FORM
========================================= */

const earlyAccessForm =
  document.querySelector(
    "#early-access-form"
  );


if (earlyAccessForm) {

  earlyAccessForm.addEventListener(
    "submit",
    (event) => {

      event.preventDefault();


      const emailInput =
        document.querySelector(
          "#early-access-email"
        );


      const email =
        emailInput.value.trim();


      if (!email) {

        return;

      }


      const button =
        earlyAccessForm
          .querySelector(
            "button"
          );


      const originalText =
        button.textContent;


      button.textContent =
        "You're on the list ✓";


      button.style.background =
        "linear-gradient(135deg, #3bb98f, #279671)";


      emailInput.value =
        "";


      setTimeout(
        () => {

          button.textContent =
            originalText;


          button.style.background =
            "";

        },
        3500
      );

    }
  );

}



/* =========================================
   SCROLL-TRIGGERED HIGHLIGHTS
========================================= */

const sweepHighlights = gsap.utils.toArray(
  ".sweep-highlight, .journey-label, .feature-label"
);

sweepHighlights.forEach((highlight) => {
  if (prefersReducedMotion) {
    gsap.set(highlight, { backgroundSize: "100% 0.72em" });
    return;
  }

  gsap.fromTo(
    highlight,
    { backgroundSize: "0% 0.72em" },
    {
      backgroundSize: "100% 0.72em",
      duration: 0.85,
      ease: "power2.out",
      immediateRender: false,
      scrollTrigger: {
        trigger: highlight,
        start: "top 84%",
        once: true
      }
    }
  );
});


/* =========================================
   SMOOTH ANCHOR NAVIGATION
========================================= */

document
  .querySelectorAll(
    'a[href^="#"]'
  )
  .forEach(
    (link) => {

      link.addEventListener(
        "click",
        (event) => {

          const targetID =
            link.getAttribute(
              "href"
            );


          if (
            targetID === "#"
          ) {

            return;

          }


          const target =
            document.querySelector(
              targetID
            );


          if (target) {

            event.preventDefault();


            lenis.scrollTo(
              target,
              {
                offset: -80,
                duration: prefersReducedMotion ? 0 : 1.3
              }
            );

          }

        }
      );

    }
  );



/* =========================================
   REFRESH SCROLLTRIGGER
========================================= */

window.addEventListener(
  "load",
  () => {

    ScrollTrigger.refresh();

  }
);



/* =========================================
   CONSOLE
========================================= */

console.log(
  "%cCareerKraft",
  "font-size: 28px; font-weight: bold; color: #9c5cff;"
);


console.log(
  "Don't just choose your future. Build it."
);