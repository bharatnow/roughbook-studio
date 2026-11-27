// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/surface.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Surfaces and media: a grain and mesh ground made from the look's colours, and an ambient video
// loop with a poster (reports/Expressive web audit.html, Part 2, "Grain, noise and mesh
// gradients" and "AI-generated imagery and video").
import type { Technique } from './types.js';

const MESH_CSS = `/* A mesh ground from the look's own colours (never a default purple), with film grain. */
.mesh-ground {
  position: relative;
  isolation: isolate;
  overflow: clip;
  background: var(--look-bg);
}
.mesh-ground::before {
  content: '';
  position: absolute;
  inset: -15%;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(60% 80% at 15% 20%, color-mix(in oklch, var(--look-brand) 70%, var(--look-bg)) 0, transparent 60%),
    radial-gradient(50% 70% at 85% 30%, color-mix(in oklch, var(--look-accent) 65%, var(--look-bg)) 0, transparent 60%),
    radial-gradient(70% 60% at 50% 105%, color-mix(in oklch, var(--look-brand), var(--look-accent)) 0, transparent 62%);
}
/* Grain makes it read as a material and hides banding. */
.mesh-ground::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.18;
  mix-blend-mode: soft-light;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* A slow drift that moves the mesh layer by transform, so it does not repaint. */
@media (prefers-reduced-motion: no-preference) {
  .mesh-ground.drift::before {
    animation: mesh-drift calc(var(--look-motion) * 28s) ease-in-out infinite alternate;
  }
}
@keyframes mesh-drift {
  to { translate: 4% -3%; rotate: 6deg; }
}

/* Increase Contrast: the plain ground, no grain. */
@media (prefers-contrast: more) {
  .mesh-ground::before, .mesh-ground::after { display: none; }
}
`;

const MESH_TSX = `import './mesh-ground.css';

/**
 * Atmosphere without a photograph. Put the type on the calmest part of the mesh; move the
 * gradient centres so the brightest patch sits away from the words.
 */
export default function MeshGround({ drift = true }: { drift?: boolean }) {
  return (
    <section className={'mesh-ground px-4 py-24 md:px-10 md:py-36' + (drift ? ' drift' : '')}>
      <h1 className="max-w-[14ch] font-[family-name:var(--look-heading)] text-5xl leading-[0.95] md:text-8xl">
        Skin care that starts with sleep.
      </h1>
      <p className="mt-5 max-w-[40ch] text-lg">Three products, used at night, made in small batches in Leeds.</p>
      <a
        href="#shop"
        className="mt-8 inline-flex min-h-12 items-center rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
      >
        Shop the routine
      </a>
    </section>
  );
}
`;

const VIDEO_TSX = `import { Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Replace these with the project's own clip and its poster still (uploaded or made in the
 * Generate drawer). Use the slot only when the clip exists. Keep phone loops under 1.5 MB,
 * 720p, 5 to 10 seconds.
 */
const CLIP = {
  poster: '/api/files/project/PROJECT_ID/hero-poster.avif',
  webm: '/api/files/project/PROJECT_ID/hero-720.webm',
  mp4: '/api/files/project/PROJECT_ID/hero-720.mp4'
};

export function AmbientLoop({
  poster,
  webm,
  mp4,
  children
}: {
  poster: string;
  webm?: string;
  mp4: string;
  children: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (reduced || paused) {
      el.pause();
      setPlaying(false);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        el.pause();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, paused]);

  return (
    <div className="relative isolate overflow-clip">
      <video
        ref={video}
        className="absolute inset-0 -z-20 size-full object-cover"
        muted
        playsInline
        loop
        preload="metadata"
        poster={poster}
        aria-hidden="true"
      >
        {webm ? <source src={webm} type="video/webm" /> : null}
        <source src={mp4} type="video/mp4" />
      </video>
      {/* A scrim from the look's ground keeps the type readable over every frame. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(to top, color-mix(in oklch, var(--look-bg) 85%, transparent), transparent 70%)' }}
      />
      {children}
      {reduced ? null : (
        <button
          type="button"
          className="absolute right-3 bottom-3 inline-flex size-11 items-center justify-center rounded-full bg-(--look-surface) text-(--look-text)"
          aria-label={playing ? 'Pause the background video' : 'Play the background video'}
          onClick={() => {
            if (playing) {
              setPaused(true);
              return;
            }
            setPaused(false);
            video.current?.play().then(() => setPlaying(true)).catch(() => {});
          }}
        >
          {playing ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        </button>
      )}
    </div>
  );
}

export default function AmbientVideo() {
  return (
    <AmbientLoop poster={CLIP.poster} webm={CLIP.webm} mp4={CLIP.mp4}>
      <div className="flex min-h-[min(80svh,760px)] flex-col justify-end px-4 pt-24 pb-16 md:px-10">
        <h1 className="max-w-[14ch] font-[family-name:var(--look-heading)] text-5xl leading-[0.95] md:text-8xl">
          Swim before the town wakes.
        </h1>
        <a
          href="#book"
          className="mt-8 inline-flex min-h-12 items-center self-start rounded-(--look-radius) bg-(--look-brand) px-6 text-lg text-(--look-on-brand)"
        >
          Book a dawn swim
        </a>
      </div>
    </AmbientLoop>
  );
}
`;

export const SURFACE_TECHNIQUES: Technique[] = [
  {
    id: 'mesh-grain-ground',
    name: 'Grain and OKLCH mesh ground',
    styles: ['grain-mesh', 'glass'],
    summary:
      "Stacked radial gradients mixed in OKLCH from the look's brand, accent and ground, with an SVG film grain and an optional slow drift.",
    keywords: [
      'mesh',
      'gradient',
      'grain',
      'noise',
      'texture',
      'ground',
      'background',
      'aurora',
      'atmosphere',
      'film',
      'oklch',
      'backdrop'
    ],
    use: 'Behind a hero that needs atmosphere and has no photograph, and as the rich ground frosted glass needs. Colours come only from the look through color-mix; move the gradient centres to suit the composition, and keep the brightest patch away from the words.',
    code: [
      { path: 'parts/mesh-ground.tsx', content: MESH_TSX },
      { path: 'parts/mesh-ground.css', content: MESH_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'color-mix() in OKLCH and mix-blend-mode in every current browser.',
      assets: 'None: the grain is an inline SVG data URI.'
    },
    cost: {
      bytes: 'Under 1 KB.',
      phone: 'Static is free; the drift moves one layer by transform.'
    },
    floors: {
      reducedMotion: 'No drift: the mesh is still.',
      phone:
        'The mesh layer is clipped by the section, so the oversized layer never scrolls sideways.',
      fallback: 'The plain ground under prefers-contrast: more.'
    },
    checks: [
      {
        id: 'contrast-behind',
        what: 'The headline and copy against the rendered mesh behind them.'
      },
      { id: 'motion-under-reduced', what: 'No drift under reduced motion.' },
      { id: 'overflow-390', what: 'The oversized mesh layer does not cause sideways scroll.' }
    ]
  },
  {
    id: 'ambient-video',
    name: 'Ambient video loop with a poster',
    styles: ['ai-media'],
    summary:
      "A muted, inline, looping clip from the project's files behind the type, with its poster as the resting frame, a scrim and a pause button.",
    keywords: [
      'video',
      'loop',
      'ambient',
      'clip',
      'background video',
      'poster',
      'motion media',
      'hero',
      'film',
      'footage',
      'mood'
    ],
    use: "When the project has a clip (uploaded, or generated in the Generate drawer) and its Visual Direction prefers video. Never a generated person, place or dish presented as real. The scrim comes from the look's ground.",
    code: [{ path: 'parts/ambient-video.tsx', content: VIDEO_TSX }],
    needs: {
      packages: ['lucide-react', 'motion/react'],
      browsers: 'Every current browser; webm first, mp4 as the fallback source.',
      assets: "A clip (720p mp4, optionally webm) and its poster still, in the project's files."
    },
    cost: {
      bytes: '0.5 to 3 MB; keep phone loops under 1.5 MB.',
      phone: 'Use the poster and 720p; preload metadata only, play only on screen.'
    },
    floors: {
      reducedMotion: 'Never plays: the poster is the picture, and the pause button is not shown.',
      phone: 'The poster paints first; the clip plays only while on screen.',
      fallback: 'The poster still when the clip cannot play.'
    },
    checks: [
      {
        id: 'bytes-before-interaction',
        what: 'The clip and poster before the first interaction at 390 px.'
      },
      { id: 'contrast-behind', what: 'Type over the poster and over sampled frames of the clip.' },
      { id: 'motion-under-reduced', what: 'The clip does not play under reduced motion.' },
      { id: 'pause-control', what: 'The loop can be paused.' }
    ]
  }
];
