// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/interaction.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Interaction: a pointer spotlight, small feedback recipes, and Rive and dotLottie animations
// (reports/Expressive web audit.html, Part 2, "Micro-interactions and cursor effects"). Hover
// effects are gated by (hover: hover); nothing replaces focus, pressed or disabled states.
import type { Technique } from './types.js';

const SPOT_CSS = `/* A highlight that follows the pointer across cards, written as CSS variables only. */
.spot {
  position: relative;
  background: var(--look-surface);
  border: 1px solid var(--look-border);
  border-radius: calc(var(--look-radius) + 6px);
}

@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .spot {
    background:
      radial-gradient(240px circle at var(--x, 50%) var(--y, -200px),
        color-mix(in oklch, var(--look-accent) 18%, transparent), transparent 70%),
      var(--look-surface);
  }
  /* The border lights up near the pointer too. */
  .spot::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    pointer-events: none;
    background: radial-gradient(180px circle at var(--x, 50%) var(--y, -200px), var(--look-accent), transparent 70%);
    -webkit-mask: linear-gradient(black 0 0) content-box, linear-gradient(black 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(black 0 0) content-box exclude, linear-gradient(black 0 0);
  }
}
`;

const SPOT_TSX = `import type { PointerEvent } from 'react';
import './spotlight.css';

function follow(event: PointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  const box = card.getBoundingClientRect();
  card.style.setProperty('--x', event.clientX - box.left + 'px');
  card.style.setProperty('--y', event.clientY - box.top + 'px');
}

const PLANS = [
  { name: 'Solo', price: '9', note: 'One studio, every feature' },
  { name: 'Team', price: '29', note: 'Five seats, shared projects' },
  { name: 'Agency', price: '79', note: 'Unlimited clients, your branding' }
];

/** Cards that answer the cursor. On touch and under reduced motion they are plain cards. */
export default function PointerSpotlight() {
  return (
    <section className="grid gap-4 px-4 py-10 md:grid-cols-3 md:px-10">
      {PLANS.map(plan => (
        <a key={plan.name} href={'#' + plan.name.toLowerCase()} className="spot block p-6" onPointerMove={follow}>
          <h3 className="font-[family-name:var(--look-heading)] text-2xl">{plan.name}</h3>
          <p className="mt-2 text-4xl">{plan.price}</p>
          <p className="mt-2 text-base text-(--look-muted)">{plan.note}</p>
        </a>
      ))}
    </section>
  );
}
`;

const MICRO_CSS = `/* Small feedback: a press that squashes, an arrow that slides, a tick that lands. */
.press:active { scale: 0.97; }
.slide-arrow svg { flex: none; }
.tick { display: inline-block; }

@media (prefers-reduced-motion: no-preference) {
  .press { transition: scale calc(var(--look-motion) * 120ms) ease-out; }
  .slide-arrow svg { transition: translate calc(var(--look-motion) * 200ms) ease-out; }
  .tick[data-on='true'] { animation: tick-land calc(var(--look-motion) * 260ms) cubic-bezier(0.3, 1.5, 0.5, 1); }
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .slide-arrow:hover svg { translate: 4px 0; }
}
@keyframes tick-land { from { scale: 0.4; } }
`;

const MICRO_TSX = `import { ArrowRight, Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './micro.css';

/** A number that counts up once when it comes into view. It renders its real value first. */
function CountOnce({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now: number) => {
        const done = Math.min(1, (now - start) / 900);
        setShown(Math.round(value * (1 - Math.pow(1 - done, 3))));
        if (done < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span ref={ref} aria-label={String(value)} className="tabular-nums">
      {shown}
    </span>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="press inline-flex min-h-11 items-center gap-2 rounded-(--look-radius) border border-(--look-border) px-4"
      onClick={() => {
        navigator.clipboard?.writeText(code).catch(() => {});
        setCopied(true);
      }}
    >
      <span className="font-mono">{code}</span>
      <span className="tick" data-on={copied}>
        {copied ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
      </span>
      <span aria-live="polite" className="sr-only">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

export default function MicroFeedback() {
  return (
    <section className="grid gap-6 px-4 py-10 md:px-10">
      <p className="font-[family-name:var(--look-heading)] text-5xl">
        <CountOnce value={1240} /> orders this month
      </p>
      <CopyCode code="SPRING10" />
      <a href="#menu" className="slide-arrow inline-flex min-h-11 items-center gap-2 underline">
        See the full menu <ArrowRight aria-hidden="true" size={18} />
      </a>
      <a
        href="#book"
        className="press inline-flex min-h-12 items-center justify-self-start rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
      >
        Book a table
      </a>
    </section>
  );
}
`;

const RIVE_TSX = `import { useRive, useStateMachineInput } from '@rive-app/react-canvas';
import { useReducedMotion } from 'motion/react';
import { useEffect } from 'react';

/**
 * A Rive file from the project's files, with a state machine that reacts to hover and press.
 * The sandbox serves the runtime's WASM from its own origin: never point it at a CDN. Replace
 * the path with the project's real .riv file, and the input names with the file's own.
 */
const SRC = '/api/files/project/PROJECT_ID/mascot.riv';
const MACHINE = 'State Machine 1';

export function RiveMark({ src = SRC, label }: { src?: string; label: string }) {
  const reduced = useReducedMotion();
  const { rive, RiveComponent } = useRive({ src, stateMachines: MACHINE, autoplay: false });
  const hover = useStateMachineInput(rive, MACHINE, 'hover');

  useEffect(() => {
    if (!rive) return;
    if (reduced) rive.pause();
    else rive.play();
  }, [rive, reduced]);

  return (
    <figure className="w-full max-w-[min(100%,360px)]">
      <div className="aspect-square w-full" role="img" aria-label={label}>
        <RiveComponent
          onPointerEnter={() => {
            if (hover) hover.value = true;
          }}
          onPointerLeave={() => {
            if (hover) hover.value = false;
          }}
        />
      </div>
    </figure>
  );
}

export default function RiveAnimation() {
  return (
    <section className="grid items-center gap-6 px-4 py-10 md:grid-cols-2 md:px-10">
      <h2 className="font-[family-name:var(--look-heading)] text-4xl md:text-6xl">Meet Pip, who waters for you.</h2>
      <RiveMark label="Pip the watering can, waving" />
    </section>
  );
}
`;

const LOTTIE_TSX = `import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

type Player = { play(): void; pause(): void; setFrame(frame: number): void; totalFrames: number };

/**
 * A dotLottie illustration from the project's files that plays once when it comes into view,
 * and rests on its last frame. The sandbox serves the runtime's WASM from its own origin: never
 * point it at a CDN. Replace the path with the project's real .lottie file.
 */
const SRC = '/api/files/project/PROJECT_ID/route.lottie';

export function LottieOnce({ src = SRC, label }: { src?: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !player) return;
    if (reduced) {
      player.setFrame(Math.max(0, player.totalFrames - 1));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      player.play();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [player, reduced]);

  return (
    <div ref={host} role="img" aria-label={label} className="aspect-[4/3] w-full max-w-[520px]">
      <DotLottieReact
        src={src}
        autoplay={false}
        loop={false}
        dotLottieRefCallback={instance => setPlayer(instance as unknown as Player | null)}
      />
    </div>
  );
}

export default function LottieAnimation() {
  return (
    <section className="grid items-center gap-6 px-4 py-10 md:grid-cols-2 md:px-10">
      <h2 className="font-[family-name:var(--look-heading)] text-4xl md:text-6xl">From our door to yours in 25 minutes.</h2>
      <LottieOnce label="A route drawn from the shop to a front door" />
    </section>
  );
}
`;

export const INTERACTION_TECHNIQUES: Technique[] = [
  {
    id: 'pointer-spotlight',
    name: 'Pointer spotlight',
    styles: ['micro-interactions', 'dark-spatial'],
    summary:
      'A soft accent highlight and a lit border that follow the pointer across cards, by CSS variables; plain cards on touch.',
    keywords: [
      'spotlight',
      'pointer',
      'cursor',
      'hover',
      'mouse',
      'follow',
      'glow',
      'cards',
      'pricing',
      'linear',
      'border'
    ],
    use: 'On a set of cards a person compares (plans, services, projects). Tint from the accent at 15 to 25%. No custom cursors and no magnetic buttons; the design must not depend on hover.',
    code: [
      { path: 'parts/spotlight.tsx', content: SPOT_TSX },
      { path: 'parts/spotlight.css', content: SPOT_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'Every current browser; mask-composite with the -webkit- form for Safari.',
      assets: 'None.'
    },
    cost: { bytes: '0 KB.', phone: 'Nothing on touch: (hover: hover) gates it.' },
    floors: {
      reducedMotion: 'Off: plain cards that do not follow the pointer.',
      phone: 'Plain cards stacked in one column.',
      fallback: 'Without hover or mask support, plain cards with a border.'
    },
    checks: [
      { id: 'contrast-behind', what: 'Card text over the brightest point of the spotlight.' },
      { id: 'focus-visible', what: 'Cards that are links show a focus ring.' },
      { id: 'motion-under-reduced', what: 'No pointer following under reduced motion.' }
    ]
  },
  {
    id: 'micro-feedback',
    name: 'Micro-interactions',
    styles: ['micro-interactions'],
    summary:
      'A press that squashes, an arrow that slides on hover, a number that counts once, and a copied tick with a live message.',
    keywords: [
      'micro',
      'interaction',
      'feedback',
      'press',
      'squash',
      'arrow',
      'count',
      'counter',
      'number',
      'copied',
      'tick',
      'hover',
      'details',
      'craft'
    ],
    use: "In small doses wherever craft should show: the primary action, a code to copy, a figure worth noticing. Pick the ones that fit the look's motion level; durations multiply by --look-motion.",
    code: [
      { path: 'parts/micro.tsx', content: MICRO_TSX },
      { path: 'parts/micro.css', content: MICRO_CSS }
    ],
    needs: { packages: ['lucide-react'], browsers: 'Every current browser.', assets: 'None.' },
    cost: {
      bytes: '0 KB beyond the icons.',
      phone: 'Good: the press and tick work on touch; the arrow slide is hover only.'
    },
    floors: {
      reducedMotion:
        'States change with no transition; the number shows its value without counting.',
      phone: 'Controls at least 44 px; nothing depends on hover.',
      fallback: 'The real value renders first, so the count never shows a wrong number in a still.'
    },
    checks: [
      { id: 'hidden-at-rest', what: 'The counted number shows its real value at rest.' },
      { id: 'motion-under-reduced', what: 'No count and no transitions under reduced motion.' },
      { id: 'focus-visible', what: 'Every control shows a focus ring.' }
    ]
  },
  {
    id: 'rive-animation',
    name: 'Rive state-machine animation',
    styles: ['micro-interactions', 'ai-media'],
    summary:
      "A Rive file from the project's files with a state machine that answers hover and press, paused under reduced motion.",
    keywords: [
      'rive',
      'character',
      'mascot',
      'animation',
      'state machine',
      'interactive',
      'icon',
      'illustration',
      'reactive'
    ],
    use: 'For a character or an icon with states the brand owns (a mascot that waves, a toggle that reacts). Only when the project has a .riv file; a sketch never asks for what it cannot use. Input names come from the file.',
    code: [{ path: 'parts/rive-mark.tsx', content: RIVE_TSX }],
    needs: {
      packages: ['@rive-app/react-canvas', 'motion/react'],
      browsers: 'Every current browser (WebAssembly, served from the sandbox).',
      assets: "A .riv file in the project's files."
    },
    cost: { bytes: 'About 150 KB for the runtime plus the file.', phone: 'Good.' },
    floors: {
      reducedMotion: 'Paused on its first frame.',
      phone: 'The canvas is at most the column width and square.',
      fallback:
        'role="img" with a label carries the meaning; the words beside it never depend on it.'
    },
    checks: [
      { id: 'bytes-before-interaction', what: 'Runtime and file before the first interaction.' },
      { id: 'motion-under-reduced', what: 'Paused under reduced motion.' },
      { id: 'pause-control', what: 'A loop longer than five seconds can be paused.' }
    ]
  },
  {
    id: 'lottie-animation',
    name: 'dotLottie illustration',
    styles: ['micro-interactions', 'ai-media'],
    summary:
      "A dotLottie illustration from the project's files that plays once on view and rests on its last frame.",
    keywords: [
      'lottie',
      'dotlottie',
      'illustration',
      'animation',
      'line art',
      'route',
      'icon',
      'explainer',
      'vector'
    ],
    use: 'For a linear illustration that explains one thing (a route drawn, a parcel arriving). Only when the project has a .lottie or .json animation. Play once, not on a loop.',
    code: [{ path: 'parts/lottie-once.tsx', content: LOTTIE_TSX }],
    needs: {
      packages: ['@lottiefiles/dotlottie-react', 'motion/react'],
      browsers: 'Every current browser (WebAssembly, served from the sandbox).',
      assets: "A .lottie file in the project's files."
    },
    cost: { bytes: '60 to 250 KB for the runtime plus the file.', phone: 'Good.' },
    floors: {
      reducedMotion: 'Shown on its last frame, the finished picture, without playing.',
      phone: 'At most the column width.',
      fallback: 'role="img" with a label; the words beside it carry the fact.'
    },
    checks: [
      { id: 'bytes-before-interaction', what: 'Runtime and file before the first interaction.' },
      { id: 'motion-under-reduced', what: 'Not playing under reduced motion.' }
    ]
  }
];
