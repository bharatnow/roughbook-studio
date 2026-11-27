// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/motion.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Motion: CSS scroll-driven reveals, a GSAP pin-and-scrub, view transitions and kinetic type
// (reports/Expressive web audit.html, Part 2, "Cinematic scroll" and "Kinetic and variable type").
// Every recipe starts from a visible, complete state, so stills and thumbnails stay whole.
import type { Technique } from './types.js';

const REVEAL_CSS = `/* Native scroll choreography: compositor-only, no JavaScript, a complete page where unsupported. */
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .reveal-rise {
      animation: reveal-rise linear both;
      animation-timeline: view();
      animation-range: entry 0% cover 30%;
    }
    .reveal-scale {
      animation: reveal-scale linear both;
      animation-timeline: view();
      animation-range: entry 10% cover 45%;
    }
    .reveal-progress {
      transform-origin: 0 50%;
      animation: reveal-progress linear both;
      animation-timeline: scroll(root);
    }
  }
}

/* From a visible state: position and scale only, never opacity 0. */
@keyframes reveal-rise { from { translate: 0 calc(var(--look-motion) * 32px); } }
@keyframes reveal-scale { from { scale: 0.82; border-radius: calc(var(--look-radius) * 3 + 12px); } }
@keyframes reveal-progress { from { scale: 0 1; } }

/* At phone size the travel is shorter, so a reveal never pushes the action away. */
@media (max-width: 767px) {
  @keyframes reveal-rise { from { translate: 0 calc(var(--look-motion) * 16px); } }
  @keyframes reveal-scale { from { scale: 0.92; } }
}
`;

const REVEAL_TSX = `import './scroll-reveal.css';

/**
 * Three recipes: rise (content enters as it crosses the viewport), scale-in (a picture grows
 * from a card to full width) and progress (a bar fills as you read). Each motion shows a fact:
 * the dish arriving, the room filling. Not on utility pages, long forms or anything people scan.
 */
export default function ScrollReveal({ picture }: { picture?: string }) {
  return (
    <section className="overflow-x-clip px-4 py-16 md:px-10">
      <div
        aria-hidden="true"
        className="reveal-progress fixed inset-x-0 top-0 z-20 h-1 bg-(--look-brand)"
      />
      <h2 className="reveal-rise max-w-[18ch] font-[family-name:var(--look-heading)] text-4xl leading-none md:text-6xl">
        Every loaf is shaped by hand at four.
      </h2>
      <div className="reveal-scale mt-10 overflow-clip rounded-(--look-radius)">
        {picture ? (
          <img src={picture} alt="Loaves cooling on the rack" className="aspect-[16/9] w-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="aspect-[16/9] w-full"
            style={{ background: 'linear-gradient(120deg, var(--look-brand), var(--look-accent))' }}
          />
        )}
      </div>
      <p className="reveal-rise mt-6 max-w-[48ch] text-lg">
        By seven the first batch is on the counter, and by nine it is gone.
      </p>
    </section>
  );
}
`;

const PIN_TSX = `import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';

const STEPS = [
  { title: 'Grind', text: 'Beans are ground for each cup, never ahead.' },
  { title: 'Bloom', text: 'Thirty seconds of water first, so the coffee breathes.' },
  { title: 'Pour', text: 'Three slow pours, four minutes in all.' }
];

/**
 * A pinned story: the frame grows from a card to full width while the steps take turns, driven
 * by scroll. Every step is visible at rest and under reduced motion; the scrub only dims the
 * steps that are not current. Pins use svh, so iOS's address bar does not make them jump.
 */
export default function PinScrub() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          wide: '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
          narrow: '(max-width: 767px) and (prefers-reduced-motion: no-preference)'
        },
        context => {
          const wide = Boolean(context.conditions?.wide);
          const steps = gsap.utils.toArray<HTMLElement>('.pin-step', el);
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: el,
              start: 'top top',
              end: wide ? '+=150%' : '+=90%',
              pin: true,
              scrub: 1
            }
          });
          timeline.from('.pin-frame', { scale: wide ? 0.7 : 0.88, borderRadius: 32, ease: 'none' });
          steps.forEach((step, index) => {
            if (index === 0) return;
            timeline.fromTo(step, { opacity: 0.45 }, { opacity: 1, ease: 'none' }, '<0.15');
            timeline.to(steps[index - 1]!, { opacity: 0.45, ease: 'none' }, '<');
          });
        }
      );
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="grid min-h-[100svh] content-center gap-8 overflow-x-clip px-4 py-12 md:grid-cols-[1.3fr_1fr] md:px-10">
      <div
        className="pin-frame aspect-[4/3] w-full rounded-(--look-radius)"
        aria-hidden="true"
        style={{ background: 'linear-gradient(150deg, var(--look-brand), var(--look-accent))' }}
      />
      <ol className="grid gap-6">
        {STEPS.map(step => (
          <li key={step.title} className="pin-step">
            <h3 className="font-[family-name:var(--look-heading)] text-3xl">{step.title}</h3>
            <p className="mt-1 text-lg">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
`;

const VT_CSS = `/* Cross-document: between pages of a stitched site on one origin, the header and the hero
   picture morph instead of the page blinking. Two lines on every page. */
@view-transition { navigation: auto; }

.vt-header { view-transition-name: site-header; }

::view-transition-group(*) {
  animation-duration: calc(var(--look-motion) * 450ms);
  animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
`;

const VT_TSX = `import { useState } from 'react';
import { flushSync } from 'react-dom';
import './view-transitions.css';

type Dish = { id: string; name: string; price: string };

const DISHES: Dish[] = [
  { id: 'bream', name: 'Sea bream, fennel, orange', price: '24' },
  { id: 'pie', name: 'Mushroom and leek pie', price: '18' },
  { id: 'tart', name: 'Burnt honey tart', price: '9' }
];

/** Same-document: wraps a state change in a view transition where it exists and motion is on. */
function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || still) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

/**
 * A list whose chosen item grows into its detail. Each element that morphs has a unique
 * view-transition-name, the same before and after. Where view transitions are missing, the
 * state simply changes.
 */
export default function ViewTransitions() {
  const [open, setOpen] = useState<string | null>(null);
  const chosen = DISHES.find(dish => dish.id === open);

  return (
    <section className="px-4 py-10 md:px-10">
      <header className="vt-header flex min-h-14 items-center font-[family-name:var(--look-heading)] text-xl">
        Tonight
      </header>
      {chosen ? (
        <article
          className="mt-4 rounded-(--look-radius) bg-(--look-surface) p-6"
          style={{ viewTransitionName: 'dish-' + chosen.id }}
        >
          <h2 className="font-[family-name:var(--look-heading)] text-4xl">{chosen.name}</h2>
          <p className="mt-2 text-xl">{chosen.price}</p>
          <button
            type="button"
            className="mt-6 inline-flex min-h-11 items-center underline"
            onClick={() => withTransition(() => setOpen(null))}
          >
            Back to the menu
          </button>
        </article>
      ) : (
        <ul className="mt-4 grid gap-3">
          {DISHES.map(dish => (
            <li key={dish.id} style={{ viewTransitionName: 'dish-' + dish.id }}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-4 rounded-(--look-radius) bg-(--look-surface) px-4 text-left text-lg"
                onClick={() => withTransition(() => setOpen(dish.id))}
              >
                <span>{dish.name}</span>
                <span>{dish.price}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
`;

const TYPE_CSS = `/* Type at poster scale, with a clamp floor and ceiling, and guards against long words. */
.kinetic {
  font-family: var(--look-heading);
  font-weight: 700;
  font-size: clamp(2.75rem, 12vw, 9.5rem);
  line-height: 0.9;
  letter-spacing: -0.04em;
  text-wrap: balance;
  overflow-wrap: anywhere;
  hyphens: auto;
}
.kinetic .line { display: block; overflow: clip; padding-bottom: 0.06em; }
.kinetic .line > span { display: block; }

/* Lines rise from a mask once, under 600 ms, from a visible resting state: never from opacity 0. */
@media (prefers-reduced-motion: no-preference) {
  .kinetic .line > span {
    animation: kinetic-rise calc(var(--look-motion) * 550ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--i, 0) * var(--look-motion) * 60ms);
  }
}
@keyframes kinetic-rise { from { translate: 0 0.5em; opacity: 0.4; } }

/* Variable weight with scroll, only for a variable heading font served with a weight range. */
@property --wght { syntax: '<number>'; inherits: true; initial-value: 400; }
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: scroll()) {
    .kinetic.breathe {
      font-variation-settings: 'wght' var(--wght);
      animation: kinetic-wght linear both;
      animation-timeline: scroll(root);
      animation-range: 0 60vh;
    }
  }
}
@keyframes kinetic-wght { to { --wght: 800; } }
`;

const TYPE_TSX = `import clsx from 'clsx';
import type { CSSProperties } from 'react';
import './kinetic-type.css';

/**
 * A headline set as the picture. Pass the lines as they should break; screen readers get the
 * whole sentence once, from aria-label. In a look's own sketch, where words.headline must stay
 * whole in its data-look element, pass it as a single line.
 */
export function KineticHeadline({
  lines,
  breathe = false
}: {
  lines: string[];
  breathe?: boolean;
}) {
  return (
    <h1 className={clsx('kinetic', breathe && 'breathe')} aria-label={lines.join(' ')}>
      {lines.map((line, index) => (
        <span key={index} className="line" aria-hidden="true">
          <span style={{ '--i': index } as CSSProperties}>{line}</span>
        </span>
      ))}
    </h1>
  );
}

export default function KineticType() {
  return (
    <section className="px-4 py-12 md:px-10">
      <KineticHeadline lines={['Bread,', 'butter,', 'nothing else.']} />
      <a
        href="#order"
        className="mt-8 inline-flex min-h-12 items-center rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
      >
        Order for Saturday
      </a>
    </section>
  );
}
`;

export const MOTION_TECHNIQUES: Technique[] = [
  {
    id: 'scroll-reveal',
    name: 'CSS scroll reveal and scale-in',
    styles: ['cinematic-scroll'],
    summary:
      'Native scroll-driven rise, scale-in and reading progress with animation-timeline: no JavaScript, a whole page where unsupported.',
    keywords: [
      'scroll',
      'reveal',
      'rise',
      'scale',
      'scale-in',
      'progress',
      'parallax',
      'animation-timeline',
      'view',
      'enter',
      'cinematic',
      'storytelling'
    ],
    use: 'For storytelling sections, products with a reveal, portfolios, a dish-by-dish menu. One or two moments a page, each showing a fact. Start from a visible state; never hide text until the scroll arrives.',
    code: [
      { path: 'parts/scroll-reveal.tsx', content: REVEAL_TSX },
      { path: 'parts/scroll-reveal.css', content: REVEAL_CSS }
    ],
    needs: {
      packages: [],
      browsers:
        'animation-timeline in Chrome and Edge 115+, Safari 26; Firefox shows the still page.',
      assets: 'Optional: a project picture for the scale-in.'
    },
    cost: { bytes: '0 KB.', phone: 'Good: runs on the compositor; travel is halved below 768 px.' },
    floors: {
      reducedMotion: 'No animation at all: the page is the finished, still state.',
      phone: 'Shorter travel and a smaller scale step; overflow-x is clipped on the section.',
      fallback: 'Where animation-timeline is unsupported, the still page.'
    },
    checks: [
      { id: 'hidden-at-rest', what: 'Every word is readable before any scroll.' },
      { id: 'motion-under-reduced', what: 'No scroll animation under reduced motion.' },
      {
        id: 'overflow-390',
        what: 'Scaled and translated elements do not scroll sideways at 390 px.'
      },
      { id: 'dropped-frames', what: 'Scrolling the reveals on a throttled phone.' }
    ]
  },
  {
    id: 'scroll-pin-scrub',
    name: 'GSAP ScrollTrigger pin and scrub',
    styles: ['cinematic-scroll'],
    summary:
      'A pinned section whose frame scales and whose steps take turns as you scroll, with GSAP ScrollTrigger and matchMedia.',
    keywords: [
      'pin',
      'scrub',
      'gsap',
      'scrolltrigger',
      'timeline',
      'sticky',
      'story',
      'steps',
      'sequence',
      'scroll',
      'cinematic',
      'apple'
    ],
    use: 'For one story moment a page: how it is made, what happens in order. Keep it short (under 150% of a screen on desktop, 90% on phones). Use SplitText from gsap/SplitText for line reveals on headings, keeping lines visible at rest. Lenis is off by default; native scroll pins fine.',
    code: [{ path: 'parts/pin-scrub.tsx', content: PIN_TSX }],
    needs: {
      packages: ['gsap', 'gsap/ScrollTrigger'],
      browsers: 'Every current browser.',
      assets: 'Optional: the project picture the frame holds.'
    },
    cost: {
      bytes: 'About 45 KB gzipped for GSAP and ScrollTrigger.',
      phone: 'Good with a shorter pin and svh units; never scroll-jack.'
    },
    floors: {
      reducedMotion:
        'No pin and no scrub: matchMedia never adds the timeline, so the frame and every step sit still and whole.',
      phone:
        'A shorter pin (+=90%) and a smaller scale step; the section is min-h 100svh, never 100vh.',
      fallback: 'Without JavaScript, the same still section.'
    },
    checks: [
      { id: 'hidden-at-rest', what: 'Every step is readable before any scroll.' },
      { id: 'motion-under-reduced', what: 'No pin under reduced motion.' },
      { id: 'dropped-frames', what: 'Scrubbing on a throttled phone.' },
      { id: 'overflow-390', what: 'The pinned section fits at 390 px.' }
    ]
  },
  {
    id: 'view-transitions',
    name: 'View transitions',
    styles: ['cinematic-scroll'],
    summary:
      'Cross-document morphs between pages of a stitched site, and same-document morphs for a state change, with startViewTransition.',
    keywords: [
      'view transition',
      'transition',
      'page transition',
      'morph',
      'navigation',
      'shared element',
      'expand',
      'detail',
      'state change'
    ],
    use: 'Cross-document: the CSS on every page of a stitched site, with the same view-transition-name on the header and on the hero picture. Same-document: wrap a state change (a card opening into its detail) in withTransition. Names must be unique on the page.',
    code: [
      { path: 'parts/view-transitions.tsx', content: VT_TSX },
      { path: 'parts/view-transitions.css', content: VT_CSS }
    ],
    needs: {
      packages: [],
      browsers:
        'Chrome and Edge 126+, Safari 18.2+ for cross-document; same-document in every current engine but older Firefox.',
      assets: 'None.'
    },
    cost: { bytes: '0 KB.', phone: 'Good.' },
    floors: {
      reducedMotion: 'No transition animation: the state changes at once.',
      phone: 'The same; morphs are short and nothing scrolls.',
      fallback: 'Where view transitions are missing, the page or state changes without a morph.'
    },
    checks: [
      { id: 'motion-under-reduced', what: 'No morph under reduced motion.' },
      { id: 'focus-visible', what: 'Focus lands on the new content after a change.' }
    ]
  },
  {
    id: 'kinetic-type',
    name: 'Kinetic and variable type',
    styles: ['kinetic-type', 'editorial'],
    summary:
      'A poster-scale headline whose lines rise from a mask once, under 600 ms, from a visible state; optional weight that moves with scroll.',
    keywords: [
      'type',
      'typography',
      'headline',
      'kinetic',
      'variable',
      'line reveal',
      'split',
      'poster',
      'big type',
      'display',
      'weight',
      'letters'
    ],
    use: "When the type is the picture: fashion, food, events, studios. Set the break points by hand. The weight on scroll moves only with a variable heading font served with a weight range (a woff2 in the project's files); look.css loads 400 and 700 only, so leave breathe off otherwise.",
    code: [
      { path: 'parts/kinetic-type.tsx', content: TYPE_TSX },
      { path: 'parts/kinetic-type.css', content: TYPE_CSS }
    ],
    needs: {
      packages: ['clsx'],
      browsers: 'Every current browser; @property and scroll timelines where present.',
      assets: "Optional: a variable woff2 in the project's files for the weight axis."
    },
    cost: {
      bytes: '0 KB, or 30 to 120 KB for a variable font.',
      phone: 'Good: the clamp floor gives two or three lines at 390 px.'
    },
    floors: {
      reducedMotion: 'The headline is simply there: no rise and no weight change.',
      phone:
        'clamp() floor of 2.75 rem; overflow-wrap and hyphens guard long words. Step down a size if the action drops below the first screen.',
      fallback: 'Without @property or scroll timelines the headline keeps one weight.'
    },
    checks: [
      {
        id: 'hidden-at-rest',
        what: 'The headline is readable at rest (opacity at least 0.4 at the first frame).'
      },
      { id: 'overflow-390', what: 'No word runs past the edge at 390 px.' },
      { id: 'motion-under-reduced', what: 'No rise and no weight change under reduced motion.' }
    ]
  }
];
