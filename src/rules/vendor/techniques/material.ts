// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/material.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Materials: glass, clay, tactile, hard shadow and dark depth (reports/Expressive web audit.html,
// Part 2). Shadows and highlights mix black or white into transparent; every colour of the
// material itself comes from the look.
import type { Technique } from './types.js';

const GLASS_CSS = `/* Frosted glass, for floating chrome over a picture, a video loop or a mesh ground. */
.glass {
  background: color-mix(in oklch, var(--look-surface) 58%, transparent);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  backdrop-filter: blur(16px) saturate(1.5);
  border: 1px solid color-mix(in oklch, var(--look-surface) 45%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in oklch, white 40%, transparent),
    0 8px 32px color-mix(in oklch, black 16%, transparent);
  color: var(--look-text);
}

/* No blur: an opaque pane, never a see-through one with nothing behind it. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--look-surface); }
}

/* One pane at phone size, with a lighter blur: each pane repaints what is behind it on scroll. */
@media (max-width: 767px) {
  .glass {
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    backdrop-filter: blur(12px) saturate(1.4);
  }
}

/* Reduce Transparency and Increase Contrast each get a designed, solid version, last, so no
   size rule turns the blur back on. */
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .glass {
    background: var(--look-surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    border-color: var(--look-border);
  }
}
`;

const GLASS_TSX = `import './glass.css';

/**
 * A glass header floating over the opener. The glass needs something rich behind it: the
 * project's photo, a video loop or a mesh ground. Over a flat colour it is invisible, so use a
 * plain header there instead.
 */
export default function GlassHeader() {
  return (
    <div
      className="relative isolate"
      style={{
        background:
          'linear-gradient(160deg, var(--look-brand), color-mix(in oklch, var(--look-accent) 70%, var(--look-bg)))'
      }}
    >
      <header className="glass sticky top-3 z-10 mx-3 flex min-h-14 items-center justify-between gap-3 rounded-[calc(var(--look-radius)*2+8px)] px-4">
        <a
          href="#top"
          className="font-[family-name:var(--look-heading)] text-lg focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Name
        </a>
        <nav aria-label="Main" className="flex items-center gap-1 text-base">
          <a href="#menu" className="hidden min-h-11 items-center px-3 md:inline-flex">
            Menu
          </a>
          <a
            href="#book"
            className="inline-flex min-h-11 items-center rounded-(--look-radius) bg-(--look-brand) px-4 text-(--look-on-brand)"
          >
            Book
          </a>
        </nav>
      </header>
      <div className="h-[min(70svh,640px)]" aria-hidden="true" />
    </div>
  );
}
`;

const LIQUID_TSX = `import { useEffect, useState } from 'react';
import './glass.css';
import './liquid.css';

/**
 * Liquid refraction on top of frosted glass, for Chromium only. Elsewhere the frosted rule
 * stays as it is, so the pane never looks broken. A garnish, not a default.
 */
export default function LiquidPill() {
  const [liquid, setLiquid] = useState(false);

  useEffect(() => {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } })
      .userAgentData?.brands;
    const chromium = Boolean(brands?.some(item => /Chromium/.test(item.brand)));
    const solid = window.matchMedia(
      '(prefers-reduced-transparency: reduce), (prefers-contrast: more)'
    ).matches;
    setLiquid(chromium && !solid);
  }, []);

  return (
    <div
      className="relative isolate grid min-h-[50svh] place-items-center overflow-clip p-4"
      style={{
        background:
          'linear-gradient(120deg, var(--look-brand), var(--look-accent) 55%, var(--look-bg))'
      }}
    >
      <svg width="0" height="0" aria-hidden="true" className="absolute">
        <filter id="liquid-lens" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="2" result="noise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="40"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      <a
        href="#book"
        className={
          'glass inline-flex min-h-12 items-center rounded-full px-6 text-lg' +
          (liquid ? ' liquid' : '')
        }
      >
        Book a table
      </a>
    </div>
  );
}
`;

const LIQUID_CSS = `/* Chromium reads an SVG filter inside backdrop-filter; the class is set only there. */
.glass.liquid {
  -webkit-backdrop-filter: url(#liquid-lens) blur(2px) saturate(1.8);
  backdrop-filter: url(#liquid-lens) blur(2px) saturate(1.8);
}

/* At phone size the bend is barely visible and costs a repaint: keep it frosted. */
@media (max-width: 767px) {
  .glass.liquid {
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    backdrop-filter: blur(12px) saturate(1.4);
  }
}

/* If the setting changes after load, the pane still turns solid. */
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .glass.liquid {
    background: var(--look-surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
`;

const CLAY_CSS = `/* Clay: a soft drop shadow, a shade and a light, on a big radius. */
.clay {
  border-radius: calc(var(--look-radius) * 2 + 18px);
  background: color-mix(in oklch, var(--look-accent) 30%, var(--look-surface));
  color: var(--look-text);
  box-shadow:
    18px 24px 40px color-mix(in oklch, black 14%, transparent),
    inset -8px -10px 16px color-mix(in oklch, black 12%, transparent),
    inset 8px 10px 16px color-mix(in oklch, white 55%, transparent);
}

.clay-press {
  border-radius: 999px;
  background: color-mix(in oklch, var(--look-brand) 85%, white);
  color: var(--look-on-brand);
  box-shadow:
    6px 10px 18px color-mix(in oklch, black 16%, transparent),
    inset -4px -6px 10px color-mix(in oklch, black 16%, transparent),
    inset 4px 6px 10px color-mix(in oklch, white 45%, transparent);
}
.clay-press:active {
  scale: 0.96 0.92;
  box-shadow:
    2px 4px 8px color-mix(in oklch, black 16%, transparent),
    inset -2px -3px 6px color-mix(in oklch, black 16%, transparent),
    inset 6px 8px 14px color-mix(in oklch, black 10%, transparent);
}
.clay-press:focus-visible { outline: 3px solid var(--look-text); outline-offset: 3px; }

@media (prefers-reduced-motion: no-preference) {
  .clay-press {
    transition:
      scale calc(var(--look-motion) * 180ms) cubic-bezier(0.3, 1.6, 0.5, 1),
      box-shadow calc(var(--look-motion) * 180ms) ease-out;
  }
}

/* Smaller shadows at phone size, so cards do not bleed into each other or past the edge. */
@media (max-width: 767px) {
  .clay {
    box-shadow:
      8px 12px 24px color-mix(in oklch, black 14%, transparent),
      inset -5px -6px 10px color-mix(in oklch, black 12%, transparent),
      inset 5px 6px 10px color-mix(in oklch, white 55%, transparent);
  }
}

@media (prefers-contrast: more) {
  .clay, .clay-press { box-shadow: none; border: 2px solid var(--look-text); }
}
`;

const CLAY_TSX = `import './clay.css';

const ITEMS = [
  { value: '12', label: 'lessons a month' },
  { value: '4.9', label: 'from 2,310 parents' }
];

/** Two clay cards and a squashy primary action. For playful looks only. */
export default function ClaySurface() {
  return (
    <section className="grid gap-[calc(var(--look-space)*1.25rem)] px-4 py-10 sm:grid-cols-2 md:px-10">
      {ITEMS.map(item => (
        <div key={item.label} className="clay p-[calc(var(--look-space)*1.5rem)]">
          <p className="font-[family-name:var(--look-heading)] text-5xl">{item.value}</p>
          <p className="mt-1 text-base">{item.label}</p>
        </div>
      ))}
      <a
        href="#start"
        className="clay-press inline-flex min-h-12 items-center justify-self-start px-7 text-lg sm:col-span-2"
      >
        Start free
      </a>
    </section>
  );
}
`;

const KEY_CSS = `/* A key cap: a lit top, an edge it travels into, and a shadow that tells where the light is. */
.key {
  --cap-top: color-mix(in oklch, var(--look-brand) 86%, white);
  --cap-bottom: var(--look-brand);
  --cap-edge: color-mix(in oklch, var(--look-brand) 68%, black);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0 1.25rem;
  border-radius: var(--look-radius);
  background: linear-gradient(180deg, var(--cap-top), var(--cap-bottom));
  color: var(--look-on-brand);
  box-shadow:
    inset 0 1px 0 color-mix(in oklch, white 45%, transparent),
    0 4px 0 var(--cap-edge),
    0 6px 14px color-mix(in oklch, black 22%, transparent);
}
.key:active {
  translate: 0 3px;
  box-shadow:
    inset 0 1px 0 color-mix(in oklch, white 45%, transparent),
    0 1px 0 var(--cap-edge),
    0 2px 6px color-mix(in oklch, black 22%, transparent);
}
.key:focus-visible { outline: 2px solid var(--look-text); outline-offset: 4px; }

/* A switch with a real throw. */
.throw {
  position: relative;
  width: 56px;
  height: 32px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--look-text) 14%, var(--look-surface));
  box-shadow: inset 0 2px 4px color-mix(in oklch, black 20%, transparent);
}
.throw[aria-checked='true'] { background: var(--look-brand); }
.throw::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: linear-gradient(180deg, white, color-mix(in oklch, var(--look-surface) 80%, black));
  box-shadow: 0 2px 4px color-mix(in oklch, black 30%, transparent);
}
.throw[aria-checked='true']::after { translate: 24px 0; }
.throw:focus-visible { outline: 2px solid var(--look-text); outline-offset: 3px; }

@media (prefers-reduced-motion: no-preference) {
  .key {
    transition:
      translate calc(var(--look-motion) * 80ms) ease-out,
      box-shadow calc(var(--look-motion) * 80ms) ease-out;
  }
  .throw::after { transition: translate calc(var(--look-motion) * 220ms) cubic-bezier(0.3, 1.4, 0.5, 1); }
}

@media (prefers-contrast: more) {
  .key { background: var(--look-brand); box-shadow: 0 0 0 2px var(--look-text); }
}
`;

const KEY_TSX = `import { useState } from 'react';
import './tactile.css';

/** One tactile object on a clean page: the primary action as a key cap, and a switch. */
export default function TactilePress() {
  const [on, setOn] = useState(true);
  return (
    <section className="flex flex-wrap items-center gap-6 px-4 py-10 md:px-10">
      <a href="#book" className="key text-lg">
        Book a fitting
      </a>
      <label className="inline-flex min-h-11 items-center gap-3 text-base">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className="throw"
          onClick={() => setOn(value => !value)}
        />
        Text me when it is ready
      </label>
    </section>
  );
}
`;

const BRUT_CSS = `/* Hard shadow: a heavy rule, a flat colour, and a box that moves into its shadow. */
.brut {
  border: 3px solid var(--look-text);
  background: var(--look-accent);
  color: var(--look-text);
  border-radius: min(var(--look-radius), 6px);
  box-shadow: 6px 6px 0 var(--look-text);
}
a.brut, button.brut { display: inline-flex; align-items: center; min-height: 48px; padding: 0 1.25rem; }
.brut:focus-visible { outline: 3px solid var(--look-brand); outline-offset: 5px; }

.brut-sticker {
  display: inline-block;
  rotate: -3deg;
  border: 2px solid var(--look-text);
  background: var(--look-surface);
  padding: 0.25rem 0.6rem;
}

@media (hover: hover) {
  .brut:hover { translate: -2px -2px; box-shadow: 8px 8px 0 var(--look-text); }
}
.brut:active { translate: 6px 6px; box-shadow: 0 0 0 var(--look-text); }

@media (prefers-reduced-motion: no-preference) {
  .brut {
    transition:
      translate calc(var(--look-motion) * 120ms) ease-out,
      box-shadow calc(var(--look-motion) * 120ms) ease-out;
  }
}

/* Smaller offsets at phone size: the shadow must not run past the gutter. */
@media (max-width: 767px) {
  .brut { box-shadow: 4px 4px 0 var(--look-text); }
  .brut:active { translate: 4px 4px; }
}

@media (forced-colors: active) {
  .brut { border-color: CanvasText; }
}
`;

const BRUT_TSX = `import './hard-shadow.css';

/** A hard-shadow card and action, with one tilted sticker. */
export default function HardShadow() {
  return (
    <section className="px-4 py-10 md:px-10">
      <div className="brut max-w-xl p-[calc(var(--look-space)*1.5rem)]">
        <span className="brut-sticker text-sm">Made by two people</span>
        <h2 className="mt-4 font-[family-name:var(--look-heading)] text-4xl leading-none md:text-6xl">
          Sell your zine this weekend.
        </h2>
        <p className="mt-3 text-lg">A shop page, a checkout and a mailing list in one link.</p>
      </div>
      <a href="#start" className="brut mt-8 text-lg">
        Open my shop
      </a>
    </section>
  );
}
`;

const DEPTH_CSS = `/* Dark depth: lifted surfaces are lighter, not shadowed; hairlines and one glow do the rest. */
.depth {
  --raise-1: color-mix(in oklch, var(--look-surface), var(--look-text) 4%);
  --raise-2: color-mix(in oklch, var(--look-surface), var(--look-text) 8%);
  --hairline: color-mix(in oklch, var(--look-text) 10%, transparent);
  background: var(--look-bg);
  color: var(--look-text);
}
.depth-panel {
  background: var(--raise-1);
  border: 1px solid var(--hairline);
  border-radius: calc(var(--look-radius) + 8px);
  box-shadow:
    inset 0 1px 0 color-mix(in oklch, var(--look-text) 7%, transparent),
    0 0 0 1px color-mix(in oklch, black 40%, transparent),
    0 30px 60px -20px color-mix(in oklch, black 60%, transparent);
}
.depth-panel.lift { background: var(--raise-2); }

/* One glow, behind the one thing that matters. Never on every card. */
.depth-glow {
  box-shadow:
    0 0 0 1px color-mix(in oklch, var(--look-accent) 40%, transparent),
    0 0 80px -10px color-mix(in oklch, var(--look-accent) 55%, transparent);
}

@media (max-width: 767px) {
  .depth-panel { box-shadow: inset 0 1px 0 color-mix(in oklch, var(--look-text) 7%, transparent), 0 16px 32px -16px color-mix(in oklch, black 60%, transparent); }
  .depth-glow { box-shadow: 0 0 0 1px color-mix(in oklch, var(--look-accent) 40%, transparent), 0 0 40px -10px color-mix(in oklch, var(--look-accent) 55%, transparent); }
}

@media (prefers-contrast: more) {
  .depth-panel { border-color: var(--look-text); box-shadow: none; }
  .depth-glow { box-shadow: 0 0 0 2px var(--look-accent); }
}
`;

const DEPTH_TSX = `import './dark-depth.css';

/** A dark look with depth: two lifted panels, hairlines, and one glow on the main action. */
export default function DarkDepth() {
  return (
    <section className="depth px-4 py-12 md:px-10">
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div className="depth-panel lift p-[calc(var(--look-space)*1.5rem)]">
          <h2 className="font-[family-name:var(--look-heading)] text-3xl md:text-5xl">
            Builds in 41 seconds.
          </h2>
          <p className="mt-3 max-w-prose text-(--look-text)">Median across 12,000 builds last week.</p>
        </div>
        <div className="depth-panel p-[calc(var(--look-space)*1.5rem)]">
          <p className="text-(--look-text)">Cache hits</p>
          <p className="mt-1 font-[family-name:var(--look-heading)] text-5xl">93%</p>
        </div>
      </div>
      <a
        href="#start"
        className="depth-glow mt-8 inline-flex min-h-12 items-center rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
      >
        Start building
      </a>
    </section>
  );
}
`;

export const MATERIAL_TECHNIQUES: Technique[] = [
  {
    id: 'frosted-glass',
    name: 'Frosted glass',
    styles: ['glass'],
    summary:
      'A translucent, blurred pane for floating chrome (header, booking bar, pill) over a picture or a rich ground.',
    keywords: [
      'glass',
      'frosted',
      'blur',
      'translucent',
      'header',
      'nav',
      'bar',
      'pill',
      'chrome',
      'sticky',
      'ios',
      'overlay'
    ],
    use: 'Use it only on the control layer that floats over content: a sticky header, a booking bar over the hero photo, a price pill on a product shot. Never on body text, forms or cards on a plain ground: glass over a flat colour is invisible. Tune the fill (55 to 70% surface) until text passes contrast against the busiest part of what is behind it.',
    code: [
      { path: 'parts/glass-header.tsx', content: GLASS_TSX },
      { path: 'parts/glass.css', content: GLASS_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'backdrop-filter in every current browser (with -webkit- for Safari).',
      assets: 'Something rich behind it: a project photo, a video loop or a mesh ground.'
    },
    cost: {
      bytes: '0 KB beyond the CSS.',
      phone:
        'Fine in small areas. Each pane repaints what is behind it on every scroll frame; one pane at 390 px, never stacked panes.'
    },
    floors: {
      reducedMotion: 'Nothing moves, so nothing changes.',
      phone:
        'One pane, blur lowered to 12 px, controls at least 44 px tall, the secondary links folded away.',
      fallback:
        'Opaque surface under prefers-reduced-transparency, prefers-contrast: more, and where backdrop-filter is unsupported.'
    },
    checks: [
      {
        id: 'contrast-behind',
        what: 'Text on the pane against the rendered pixels behind it, at its busiest scroll position.'
      },
      {
        id: 'opaque-fallback',
        what: 'The pane is opaque under reduced transparency and increased contrast.'
      },
      { id: 'dropped-frames', what: 'Scrolling under the pane on a throttled phone.' },
      { id: 'overflow-390', what: 'The header fits at 390 px with its action reachable.' }
    ]
  },
  {
    id: 'liquid-refraction',
    name: 'Liquid refraction',
    styles: ['glass'],
    summary:
      'An SVG displacement filter inside backdrop-filter that bends what is behind a glass pane, Chromium only, over frosted glass.',
    keywords: [
      'liquid',
      'refraction',
      'lens',
      'ios 26',
      'bend',
      'distort',
      'displacement',
      'glass'
    ],
    use: 'A garnish on frosted glass for a maker who asks for "iOS 26": one pill or one control, over a picture with strong edges so the bend shows. Build frosted-glass first; this adds only the filter and a class set in an effect.',
    code: [
      { path: 'parts/liquid-pill.tsx', content: LIQUID_TSX },
      { path: 'parts/glass.css', content: GLASS_CSS },
      { path: 'parts/liquid.css', content: LIQUID_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'Chromium only for the bend; frosted glass everywhere else.',
      assets: 'A picture or ground with visible edges behind the pane.'
    },
    cost: {
      bytes: '0 KB.',
      phone: 'Barely visible at phone size and costs a full filter pass; turned off below 768 px.'
    },
    floors: {
      reducedMotion: 'Static, so nothing changes.',
      phone: 'Frosted glass only below 768 px.',
      fallback:
        'Frosted glass outside Chromium; an opaque surface under reduced transparency or increased contrast (the class is never set).'
    },
    checks: [
      { id: 'contrast-behind', what: 'The label on the pane against the bent pixels behind it.' },
      { id: 'opaque-fallback', what: 'No bend and an opaque pane under reduced transparency.' },
      { id: 'dropped-frames', what: 'Scrolling with the filtered pane on screen.' }
    ]
  },
  {
    id: 'clay-surface',
    name: 'Clay surface',
    styles: ['claymorphism'],
    summary:
      'Soft, puffy cards and a squashy button: a drop shadow plus a light and a shade inside, on big radii.',
    keywords: [
      'clay',
      'claymorphism',
      'soft',
      'puffy',
      'playful',
      'toy',
      'kids',
      'squishy',
      'friendly',
      'inflated'
    ],
    use: "Only when the look's personality is playful (kids, games, consumer fintech, wellness). Tint the clay from the accent toward the surface; keep text in --look-text and check it, because pastel on pastel fails contrast.",
    code: [
      { path: 'parts/clay-surface.tsx', content: CLAY_TSX },
      { path: 'parts/clay.css', content: CLAY_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'Every current browser.',
      assets: 'None; toy renders are optional project media.'
    },
    cost: { bytes: '0 KB.', phone: 'Cheap. Shadows are smaller below 768 px.' },
    floors: {
      reducedMotion: 'The press still changes state, with no transition.',
      phone: 'Cards stack in one column; shadows shrink so they stay inside the gutter.',
      fallback: 'A plain 2 px border and no shadow under prefers-contrast: more.'
    },
    checks: [
      { id: 'contrast-behind', what: 'Text on the tinted clay.' },
      { id: 'focus-visible', what: 'The clay button shows a focus ring.' },
      { id: 'overflow-390', what: 'Shadows do not push past the edge at 390 px.' }
    ]
  },
  {
    id: 'tactile-press',
    name: 'Tactile press',
    styles: ['neo-skeuomorphism'],
    summary:
      'A key-cap primary action that travels into its edge when pressed, and a switch with a real throw.',
    keywords: [
      'tactile',
      'press',
      'key',
      'button',
      'skeuomorphic',
      'physical',
      'switch',
      'toggle',
      'hardware',
      'primary action'
    ],
    use: 'One tactile object on an otherwise clean page: the primary action, a switch, a dial. The cap takes the brand colour; the edge is the brand mixed toward black. Never a whole page of it, and never grey on grey.',
    code: [
      { path: 'parts/tactile-press.tsx', content: KEY_TSX },
      { path: 'parts/tactile.css', content: KEY_CSS }
    ],
    needs: { packages: [], browsers: 'Every current browser.', assets: 'None.' },
    cost: { bytes: '0 KB.', phone: 'Cheap; the press reads well on touch.' },
    floors: {
      reducedMotion: 'The press and the throw change state instantly, with no transition.',
      phone: 'At least 48 px tall; the label wraps beside the switch.',
      fallback: 'A flat brand fill with a 2 px ring under prefers-contrast: more.'
    },
    checks: [
      { id: 'focus-visible', what: 'The key and the switch show a focus ring.' },
      { id: 'contrast-behind', what: 'The label on the cap gradient, at its lightest point.' },
      { id: 'motion-under-reduced', what: 'No transition runs under reduced motion.' }
    ]
  },
  {
    id: 'hard-shadow',
    name: 'Neubrutalist hard shadow',
    styles: ['neubrutalism'],
    summary:
      'Thick rules, a hard offset shadow with no blur, flat colour, and a box that moves into its shadow.',
    keywords: [
      'brutalist',
      'neubrutalism',
      'brutal',
      'hard shadow',
      'offset',
      'outline',
      'border',
      'sticker',
      'raw',
      'indie',
      'handmade'
    ],
    use: 'For creator tools, indie products, events and youth brands. Rule and shadow are --look-text; the fill is the accent or the surface. One tilted sticker at most; loud blocks overwhelm at 390 px.',
    code: [
      { path: 'parts/hard-shadow.tsx', content: BRUT_TSX },
      { path: 'parts/hard-shadow.css', content: BRUT_CSS }
    ],
    needs: { packages: [], browsers: 'Every current browser.', assets: 'None.' },
    cost: { bytes: '0 KB.', phone: 'Cheap; contrast is usually excellent.' },
    floors: {
      reducedMotion: 'Hover and press change position instantly, with no transition.',
      phone: 'Shadow offset 4 px so it stays inside the gutter.',
      fallback: 'Borders follow the system colour in forced colours.'
    },
    checks: [
      { id: 'overflow-390', what: 'Offsets do not push past the edge at 390 px.' },
      { id: 'focus-visible', what: 'A focus ring distinct from the hard shadow.' }
    ]
  },
  {
    id: 'dark-depth',
    name: 'Dark depth',
    styles: ['dark-spatial'],
    summary:
      'Dark surfaces lifted by lightening, hairline borders from colour-mix, and one accent glow.',
    keywords: [
      'dark',
      'depth',
      'glow',
      'hairline',
      'lifted',
      'raised',
      'spatial',
      'linear',
      'night',
      'premium',
      'elevation'
    ],
    use: 'For a look that is genuinely dark (tech, nightlife, music, film). Lift by mixing the text colour into the surface; one glow behind the one thing that matters. Muted grey text on near-black fails contrast, so check it.',
    code: [
      { path: 'parts/dark-depth.tsx', content: DEPTH_TSX },
      { path: 'parts/dark-depth.css', content: DEPTH_CSS }
    ],
    needs: { packages: [], browsers: 'color-mix() in every current browser.', assets: 'None.' },
    cost: { bytes: '0 KB.', phone: 'Cheap; large blurred shadows are halved below 768 px.' },
    floors: {
      reducedMotion: 'Static, so nothing changes.',
      phone: 'Panels stack; the glow shrinks to stay inside the gutter.',
      fallback: 'Solid borders and no shadows under prefers-contrast: more.'
    },
    checks: [
      { id: 'contrast-behind', what: 'Muted and body text on the lifted panels.' },
      { id: 'overflow-390', what: 'The glow does not cause sideways scroll at 390 px.' }
    ]
  }
];
