import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhoto,
  mediaScan,
  pictureUses,
  type MediaUse,
  type ScannedMedium
} from '../runs/mediaScan.js';
import type { SvgBox } from '../runs/svgBoxes.js';

// The media scan (ROUGHBOOK-MEDIA-PLAN.md, V0): fake files for each medium, and the cases that
// must never be a finding: an icon, a texture, a hover transition, a way-in animation of the
// results, the 300 ms entrance of a drawing and a loading spinner.
// The same cases as the backend's src/tests/rules/mediaScan.test.ts, for the studio's copy of
// the scan (src/runs/mediaScan.ts), which the look-screen check reads (V2).

const media = (found: MediaUse[]) => found.map(use => use.medium);
const use = (found: MediaUse[], medium: ScannedMedium) =>
  found.find(item => item.medium === medium);

const box = (over: Partial<SvgBox>): SvgBox => ({
  index: 0,
  width: 320,
  height: 320,
  viewBox: '0 0 200 200',
  texts: 0,
  shapes: 12,
  lines: 0,
  inControl: false,
  hidden: false,
  ...over
});

/** A first screen with a field, a header and nothing that is a medium. */
const PLAIN_TSX = `import { useState, type FormEvent } from "react";
import { MapPin } from "lucide-react";
import "./hero.css";

export default function Hero() {
  const [area, setArea] = useState("");
  function onSubmit(e: FormEvent) {
    e.preventDefault();
  }
  return (
    <section className="hero">
      <header className="hero-head">
        <span className="hero-mark">Dishpatch</span>
        <MapPin aria-hidden="true" size={16} />
      </header>
      <form onSubmit={onSubmit}>
        <label htmlFor="where">Where are you?</label>
        <input id="where" value={area} onChange={e => setArea(e.target.value)} />
        <button type="submit">See who delivers</button>
      </form>
    </section>
  );
}
`;

const PLAIN_CSS = `.hero {
  display: grid;
  gap: 1rem;
}
.hero button {
  transition: transform 150ms ease-out, background-color 200ms ease;
}
.hero button:hover {
  transform: translateY(-1px);
}
`;

test('a plain first screen uses no medium', () => {
  assert.deepEqual(mediaScan({ 'index.tsx': PLAIN_TSX, 'hero.css': PLAIN_CSS }), []);
  assert.deepEqual(mediaScan({}), []);
});

test("the look's own look.css and look.ts are never read", () => {
  const found = mediaScan({
    'look.css': '.x { animation: float 4s infinite; }',
    'look.ts': 'export const words = { headline: "<video src=\\"a.mp4\\">" };'
  });
  assert.deepEqual(found, []);
});

test('an icon svg in a button is not a drawing, from the files or the render', () => {
  const tsx = `export function Close({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label="Close">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M10 10L30 30M30 10L10 30" />
        <circle cx="20" cy="20" r="18" />
      </svg>
    </button>
  );
}
export function Pin() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z" /><circle cx="12" cy="9" r="2" /></svg>
  );
}
`;
  assert.deepEqual(mediaScan({ 'index.tsx': tsx }), []);
  const boxes = {
    wide: [
      box({ index: 0, width: 40, height: 40, inControl: true }),
      box({ index: 1, width: 20, height: 20 })
    ],
    narrow: [box({ index: 0, width: 64, height: 64, inControl: true })]
  };
  assert.deepEqual(mediaScan({ 'index.tsx': tsx }, boxes), []);
});

test('a large drawing inside a link card is a drawing, from the files and the render', () => {
  const tsx = `export function Card() {
  return (
    <a href="/kitchens/sora" className="card">
      <svg viewBox="0 0 320 240" role="img" aria-label="Sora's kitchen">
        <circle cx="160" cy="120" r="90" />
        <ellipse cx="200" cy="90" rx="20" ry="14" />
        <path d="M100 140C100 100 220 100 220 140Z" />
        <rect x="40" y="200" width="240" height="20" />
      </svg>
      <span>Sora</span>
    </a>
  );
}
`;
  const fromFiles = mediaScan({ 'card.tsx': tsx });
  assert.deepEqual(media(fromFiles), ['Illustration']);
  assert.equal(use(fromFiles, 'Illustration')?.confidence, 'low');
  const sized = tsx.replace('viewBox="0 0 320 240"', 'width="320" height="240"');
  assert.deepEqual(media(mediaScan({ 'card.tsx': sized })), ['Illustration']);

  const measured = mediaScan(
    { 'card.tsx': tsx },
    { wide: [box({ width: 320, height: 240, viewBox: '0 0 320 240', shapes: 4, inControl: true })] }
  );
  assert.deepEqual(media(measured), ['Illustration']);
  assert.equal(use(measured, 'Illustration')?.confidence, 'high');
  assert.deepEqual(
    mediaScan({ 'a.tsx': '' }, { wide: [box({ width: 96, height: 96, inControl: true })] }),
    [],
    'a 96 px svg in a control is still its icon'
  );
});

test('an icon drawn on an icon grid is an icon at any rendered size', () => {
  const boxes = {
    wide: [
      box({ index: 0, width: 64, height: 64, viewBox: '0 0 24 24', shapes: 3 }),
      box({ index: 1, width: 56, height: 56, viewBox: '0 0 24 24', shapes: 0, lines: 3 })
    ]
  };
  assert.deepEqual(mediaScan({ 'a.tsx': '' }, boxes), []);
});

test('a paper texture and a defs-only svg are not drawings', () => {
  const tsx = `export function Paper() {
  return (
    <>
      <svg className="paper" aria-hidden="true" focusable="false">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <svg width="0" height="0" aria-hidden="true">
        <defs><clipPath id="c"><circle cx="5" cy="5" r="5" /></clipPath></defs>
      </svg>
    </>
  );
}
`;
  assert.deepEqual(mediaScan({ 'paper.tsx': tsx }), []);
  const boxes = {
    wide: [
      box({ index: 0, width: 1280, height: 900, viewBox: null, shapes: 1 }),
      box({ index: 1, width: 0, height: 0, viewBox: null, shapes: 1 })
    ]
  };
  assert.deepEqual(mediaScan({ 'paper.tsx': tsx }, boxes), []);
});

/** An ink drawing of a dish, seen from above: shapes, no words and no connecting lines. */
const DISH_TSX = `export function Dish({ label }: { label: string }) {
  return (
    <svg className="dish" viewBox="0 0 200 200" role="img" aria-label={label}>
      <circle cx="100" cy="100" r="94" />
      <circle cx="100" cy="100" r="79" />
      <path d="M60 104C60 70 140 70 140 104Z" />
      <ellipse cx="120" cy="80" rx="12" ry="9" />
      <path d="M70 120q8 -6 16 0t16 0" />
    </svg>
  );
}
`;

test('a drawn illustration is Illustration, never an SVG diagram', () => {
  const fromFiles = mediaScan({ 'dishes.tsx': DISH_TSX });
  assert.deepEqual(media(fromFiles), ['Illustration']);
  assert.equal(
    use(fromFiles, 'Illustration')?.confidence,
    'low',
    'the files alone are a low reading'
  );
  assert.deepEqual(use(fromFiles, 'Illustration')?.evidence[0], {
    file: 'dishes.tsx',
    line: 3,
    text: '<svg className="dish" viewBox="0 0 200 200" role="img" aria-label={label}>'
  });

  const measured = mediaScan(
    { 'dishes.tsx': DISH_TSX },
    { wide: [box({ shapes: 5 })], narrow: [box({ width: 240, height: 240, shapes: 5 })] }
  );
  assert.deepEqual(media(measured), ['Illustration']);
  const illustration = use(measured, 'Illustration');
  assert.equal(illustration?.confidence, 'high');
  assert.equal(illustration?.evidence[0]?.file, 'rendered 1280px');
  assert.equal(illustration?.evidence[0].line, 1);
  assert.ok(illustration?.evidence.some(item => item.file === 'dishes.tsx' && item.line === 3));
});

test('a drawing composed of parts elsewhere in its file is still read', () => {
  const tsx = `function Bowl() {
  return (
    <>
      <circle cx={100} cy={100} r={94} />
      <circle cx={100} cy={100} r={70} />
    </>
  );
}
export function Dish() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <Bowl />
    </svg>
  );
}
`;
  assert.deepEqual(media(mediaScan({ 'dishes.tsx': tsx })), ['Illustration']);
});

test('a labelled diagram is an SVG diagram', () => {
  const tsx = `export function Flow() {
  return (
    <svg viewBox="0 0 600 200" role="img" aria-label="How an order gets to you">
      <rect x="10" y="60" width="120" height="60" rx="8" />
      <text x="70" y="95">Kitchen</text>
      <line x1="130" y1="90" x2="240" y2="90" />
      <rect x="240" y="60" width="120" height="60" rx="8" />
      <text x="300" y="95">Courier</text>
      <line x1="360" y1="90" x2="470" y2="90" />
      <rect x="470" y="60" width="120" height="60" rx="8" />
      <text x="530" y="95">Your door</text>
    </svg>
  );
}
`;
  const fromFiles = mediaScan({ 'flow.tsx': tsx });
  assert.deepEqual(media(fromFiles), ['SVG diagrams']);
  assert.equal(use(fromFiles, 'SVG diagrams')?.confidence, 'low');
  const measured = mediaScan(
    { 'flow.tsx': tsx },
    {
      wide: [
        box({ width: 600, height: 200, viewBox: '0 0 600 200', texts: 3, shapes: 3, lines: 2 })
      ]
    }
  );
  assert.deepEqual(media(measured), ['SVG diagrams']);
  assert.equal(use(measured, 'SVG diagrams')?.confidence, 'high');
});

test('connectors without words are a diagram; a long route line is one too, but unsure', () => {
  const nodes = mediaScan({ 'a.tsx': '' }, { wide: [box({ texts: 0, shapes: 4, lines: 3 })] });
  assert.deepEqual(media(nodes), ['SVG diagrams']);
  assert.equal(use(nodes, 'SVG diagrams')?.confidence, 'high');

  const route = `export function Route() {
  return (
    <svg className="routeline" viewBox="0 0 1000 16" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 8C80 2 160 14 250 8S420 2 500 8" />
    </svg>
  );
}
`;
  const fromFiles = mediaScan({ 'route.tsx': route });
  assert.deepEqual(media(fromFiles), ['SVG diagrams']);
  assert.equal(use(fromFiles, 'SVG diagrams')?.confidence, 'low');
  const measured = mediaScan(
    { 'route.tsx': route },
    { wide: [box({ width: 900, height: 16, viewBox: '0 0 1000 16', shapes: 1 })] }
  );
  assert.deepEqual(media(measured), ['SVG diagrams']);
  assert.equal(
    use(measured, 'SVG diagrams')?.confidence,
    'low',
    'an unclear drawing is told, never blocking'
  );
  const ornament = mediaScan(
    { 'route.tsx': route },
    { wide: [box({ width: 80, height: 6, viewBox: '0 0 1000 16', shapes: 1 })] }
  );
  assert.deepEqual(ornament, [], 'a short rule is an ornament');
});

test('the render decides: a drawing the files cannot see is found, an icon the files miss is not', () => {
  assert.deepEqual(media(mediaScan(PLAIN_TSX_FILES, { wide: [box({ index: 2 })] })), [
    'Illustration'
  ]);
  assert.deepEqual(
    mediaScan({ 'dishes.tsx': DISH_TSX }, { wide: [box({ width: 40, height: 40 })] }),
    []
  );
  assert.deepEqual(mediaScan({ 'dishes.tsx': DISH_TSX }, { wide: [] }), [], 'no svg was rendered');
});

const PLAIN_TSX_FILES = { 'index.tsx': PLAIN_TSX, 'hero.css': PLAIN_CSS };

test('a hover transition is not Motion graphics', () => {
  const css = `.card {
  transition: transform 600ms ease, box-shadow 600ms ease;
}
.card:hover {
  transform: translateY(-4px) scale(1.02);
}
.card:hover .arrow {
  animation: nudge 800ms ease-in-out infinite;
}
@keyframes nudge {
  50% { transform: translateX(4px); }
}
`;
  assert.deepEqual(mediaScan({ 'index.tsx': PLAIN_TSX, 'hero.css': css }), []);
});

test('a way-in animation of the results is not Motion graphics', () => {
  const tsx = `import { useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./hero.css";

export default function Hero() {
  const [results, setResults] = useState<string[]>([]);
  const list = useRef<HTMLUListElement>(null);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResults(["Mama Ama's", "Sora"]);
    list.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900 });
  }
  return (
    <section>
      <form onSubmit={onSubmit}>
        <label htmlFor="q">Where are you?</label>
        <input id="q" />
        <button type="submit">Search</button>
      </form>
      {results.length > 0 && (
        <ul ref={list} className="results">
          <AnimatePresence initial={false}>
            {results.map((name, i) => (
              <motion.li
                key={name}
                className="result"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
              >
                {name}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
`;
  const css = `.result {
  animation: rise 700ms ease-out both;
}
.results.is-shown .result {
  animation: rise 700ms ease-out both;
}
@keyframes rise {
  from { transform: translateY(12px); }
}
`;
  assert.deepEqual(mediaScan({ 'index.tsx': tsx, 'hero.css': css }), []);
});

test("the plan's way-in case: a list's rows entering once is not Motion graphics; looping is", () => {
  const tsx = `import { useState, type FormEvent } from "react";
import "./hero.css";

export default function Hero({ kitchens }: { kitchens: string[] }) {
  const [shown, setShown] = useState(kitchens);
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShown([...kitchens].reverse());
  }
  return (
    <section>
      <form onSubmit={onSubmit}>
        <label htmlFor="q">Where are you?</label>
        <input id="q" />
        <button type="submit">Search</button>
      </form>
      <ul className="results">
        {shown.map((name, i) => (
          <li key={name} className="result" style={{ animationDelay: \`\${i * 60}ms\` }}>
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
`;
  const css = (animation: string) =>
    `.result {\n  animation: ${animation};\n}\n@keyframes rise {\n  from { transform: translateY(8px); }\n}\n`;
  assert.deepEqual(
    mediaScan({ 'index.tsx': tsx, 'hero.css': css('rise 450ms ease-out both') }),
    []
  );
  assert.deepEqual(
    mediaScan({ 'index.tsx': tsx, 'hero.css': css('rise 600ms ease-out both') }),
    []
  );
  assert.deepEqual(
    media(mediaScan({ 'index.tsx': tsx, 'hero.css': css('rise 2s ease-in-out infinite') })),
    ['Motion graphics'],
    'a loop on the rows still runs at rest'
  );
  assert.deepEqual(
    media(mediaScan({ 'index.tsx': tsx, 'hero.css': css('rise 900ms ease-out both') })),
    ['Motion graphics'],
    'longer than 600 ms is more than an entrance'
  );
  const outside = tsx.replace('<ul className="results">', '<ul className="results result">');
  assert.deepEqual(
    media(mediaScan({ 'index.tsx': outside, 'hero.css': css('rise 450ms ease-out both') })),
    ['Motion graphics'],
    'a class also used outside the rows is shown on load'
  );
});

test('a 300 ms entrance of a drawing on load is not Motion graphics', () => {
  const css = `.dish {
  animation: draw-in 300ms ease-out both;
}
@keyframes draw-in {
  from { transform: scale(0.96); opacity: 0.6; }
}
@media (prefers-reduced-motion: reduce) {
  .dish { animation: none; }
}
`;
  const tsx = `import { useEffect, useRef } from "react";
export function Dish() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    ref.current?.animate([{ transform: "scale(0.96)" }, { transform: "none" }], { duration: 300 });
  }, []);
  return <svg ref={ref} className="dish" viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" /><path d="M10 10h50" /></svg>;
}
`;
  assert.deepEqual(media(mediaScan({ 'dishes.tsx': tsx, 'hero.css': css })), ['Illustration']);
});

test('a loading spinner, even one that loops, is not Motion graphics', () => {
  const tsx = `import { useState } from "react";
import { LoaderCircle, LocateFixed } from "lucide-react";
import clsx from "clsx";
export function Locate() {
  const [locating, setLocating] = useState(false);
  return (
    <button type="button" onClick={() => setLocating(true)} aria-label="Use my location">
      {locating ? <LoaderCircle className="gp-spin" aria-hidden="true" /> : <LocateFixed aria-hidden="true" />}
      <LocateFixed className={clsx(locating && "kl-pulse")} aria-hidden="true" />
    </button>
  );
}
`;
  const css = `.gp-spin {
  animation: gp-spin calc(var(--look-motion, 1) * 900ms) linear infinite;
}
.kl-pulse {
  animation: kl-pulse 900ms ease-in-out infinite alternate;
}
@keyframes gp-spin { to { transform: rotate(360deg); } }
@keyframes kl-pulse { to { opacity: 0.35; } }
`;
  assert.deepEqual(mediaScan({ 'locate.tsx': tsx, 'hero.css': css }), []);
});

test('an infinite CSS animation at rest is Motion graphics', () => {
  const css = `.hero-steam {
  animation: steam 6s ease-in-out infinite;
}
@keyframes steam {
  50% { transform: translateY(-6px); }
}
`;
  const found = mediaScan({ 'index.tsx': PLAIN_TSX, 'hero.css': css });
  assert.deepEqual(media(found), ['Motion graphics']);
  assert.equal(use(found, 'Motion graphics')?.confidence, 'high');
  assert.deepEqual(use(found, 'Motion graphics')?.evidence, [
    { file: 'hero.css', line: 2, text: 'animation: steam 6s ease-in-out infinite;' }
  ]);
});

test('other motion at rest: an iteration count, a long entrance, a repeat, a Web Animations call, SMIL', () => {
  const count = mediaScan({
    'a.css': '.wave { animation-name: wave; animation-duration: 2s; animation-iteration-count: 3; }'
  });
  assert.deepEqual(media(count), ['Motion graphics']);

  const long = mediaScan({
    'index.tsx': PLAIN_TSX,
    'a.css': '.hero-mark {\n  animation: arrive 1.2s ease-out both;\n}'
  });
  assert.deepEqual(media(long), ['Motion graphics']);

  const repeat = `import { motion } from "motion/react";
export function Count() {
  return (
    <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}>
      14 min
    </motion.span>
  );
}
`;
  assert.deepEqual(media(mediaScan({ 'count.tsx': repeat })), ['Motion graphics']);

  const web = `import { useEffect, useRef } from "react";
export function Ticker() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], { duration: 12000 });
  }, []);
  return <p ref={ref}>Jollof, pho, tacos</p>;
}
`;
  const found = mediaScan({ 'ticker.tsx': web });
  assert.deepEqual(media(found), ['Motion graphics']);
  assert.equal(use(found, 'Motion graphics')?.confidence, 'high');
  assert.equal(use(found, 'Motion graphics')?.evidence[0]?.line, 5);

  const smil = `export function Route() {
  return (
    <svg viewBox="0 0 400 100"><text x="10" y="20">Kitchen</text><path d="M0 50H400"><animate attributeName="stroke-dashoffset" from="400" to="0" dur="3s" repeatCount="indefinite" /></path><line x1="0" y1="0" x2="1" y2="1" /></svg>
  );
}
`;
  assert.deepEqual(media(mediaScan({ 'route.tsx': smil })), ['Motion graphics', 'SVG diagrams']);

  const tailwind =
    'export const Dot = () => <span className="h-2 w-2 rounded-full animate-ping" />;';
  assert.deepEqual(media(mediaScan({ 'dot.tsx': tailwind })), ['Motion graphics']);
  const spinner = 'export const Busy = () => <span className="h-4 w-4 animate-spin" />;';
  assert.deepEqual(mediaScan({ 'busy.tsx': spinner }), []);
});

test('a three.js import and model-viewer are 3D, as are CSS 3D transforms', () => {
  const three = `import * as THREE from "three";
import { useEffect } from "react";
export function Scene() {
  useEffect(() => {
    const scene = new THREE.Scene();
  }, []);
  return <div />;
}
`;
  const found = mediaScan({ 'scene.tsx': three });
  assert.deepEqual(media(found), ['3D']);
  assert.equal(use(found, '3D')?.confidence, 'high');
  assert.deepEqual(use(found, '3D')?.evidence[0], {
    file: 'scene.tsx',
    line: 1,
    text: 'import * as THREE from "three";'
  });

  const viewer = `import "@google/model-viewer";
export const Bowl = () => <model-viewer src="/bowl.glb" camera-controls />;
`;
  const seen = use(mediaScan({ 'bowl.tsx': viewer }), '3D');
  assert.deepEqual(
    seen?.evidence.map(item => item.line),
    [1, 2]
  );

  const css =
    '.card { transform-style: preserve-3d; transform: perspective(800px) rotateY(12deg); }';
  assert.deepEqual(media(mediaScan({ 'a.css': css })), ['3D']);
  assert.deepEqual(
    mediaScan({ 'a.css': '.card { transform: translate3d(0, 0, 0) rotate(4deg); }' }),
    []
  );
  assert.deepEqual(media(mediaScan({ 'a.css': '.card { transform: rotateX(-8deg); }' })), ['3D']);
});

test('a turn of 0 about X or Y is not 3D', () => {
  assert.deepEqual(
    mediaScan({ 'a.css': '.card { transform: rotateX(0deg) rotateY(0); }' }),
    [],
    'CSS functions of 0'
  );
  const motion = `import { motion } from "motion/react";
export const Card = () => (
  <motion.div animate={{ rotateX: 0, rotateY: "0deg" }} whileHover={{ rotateY: 0 }} />
);
`;
  assert.deepEqual(mediaScan({ 'card.tsx': motion }), [], 'Motion props of 0');
  const turned = motion.replace('whileHover={{ rotateY: 0 }}', 'whileHover={{ rotateY: 12 }}');
  assert.deepEqual(media(mediaScan({ 'card.tsx': turned })), ['3D']);
  assert.deepEqual(
    media(mediaScan({ 'card.tsx': motion.replace('rotateX: 0,', 'rotateX: 0.5,') })),
    ['3D']
  );
});

test('a video tag and a video source are Video', () => {
  const tsx = `export function Kitchen() {
  return (
    <video autoPlay muted loop playsInline poster="/api/files/abc">
      <source src="/media/kitchen.webm" type="video/webm" />
    </video>
  );
}
`;
  const found = use(mediaScan({ 'kitchen.tsx': tsx }), 'Video');
  assert.equal(found?.confidence, 'high');
  assert.deepEqual(
    found?.evidence.map(item => item.line),
    [3, 4]
  );
  assert.deepEqual(
    media(mediaScan({ 'a.ts': 'export const clip = "https://cdn.example.com/clip.mp4";' })),
    ['Video']
  );
});

test('a photo address is Photography, read as PICTURE_NOT_ALLOWED reads it', () => {
  const tsx = `export function Hero() {
  return (
    <figure>
      <img src="https://images.unsplash.com/photo-123?w=1200" alt="A bowl of pho" />
    </figure>
  );
}
`;
  const found = mediaScan({
    'hero.tsx': tsx,
    'hero.css': '.bg { background: url("/media/table.jpg") center / cover; }'
  });
  assert.deepEqual(media(found), ['Photography']);
  assert.equal(use(found, 'Photography')?.confidence, 'high');
  assert.deepEqual(
    use(found, 'Photography')?.evidence.map(item => [item.file, item.line]),
    [
      ['hero.tsx', 4],
      ['hero.css', 1]
    ]
  );
  const drawn = mediaScan({
    'a.css':
      '.x { background: url("data:image/svg+xml;utf8,<svg></svg>"); } .y { background: url(#grain); }',
    'b.tsx': 'export const Logo = () => <img src="/logo.svg" alt="" />;'
  });
  assert.deepEqual(drawn, [], 'an SVG picture and a fragment are drawing, never photos');
  assert.deepEqual(
    [
      ...new Set(
        pictureUses([['a.tsx', '<img src="/api/files/x" />']])
          .filter(isPhoto)
          .map(item => item.src)
      )
    ],
    ['/api/files/x']
  );
});

test('an app window or a sidebar-and-panel layout is Product UI, always low', () => {
  const tsx = `export function Screen() {
  return (
    <div className="pp-app-window">
      <div className="pp-titlebar"><span /><span /><span /></div>
      <aside className="pp-sidebar">Projects</aside>
      <main className="pp-panel">Report</main>
    </div>
  );
}
`;
  const found = mediaScan({ 'screen.tsx': tsx });
  assert.deepEqual(media(found), ['Product UI']);
  const product = use(found, 'Product UI');
  assert.equal(product?.confidence, 'low');
  assert.deepEqual(
    product?.evidence.map(item => item.line),
    [3, 4, 5]
  );
  const lights =
    '.dots span:nth-child(1) { background: #ff5f57; } .dots span:nth-child(2) { background: #febc2e; }';
  assert.deepEqual(media(mediaScan({ 'a.css': lights })), ['Product UI']);
  assert.deepEqual(
    mediaScan({ 'a.tsx': 'export const A = () => <aside className="tips">Tip</aside>;' }),
    []
  );
});

/** A coverwell-like first screen: the hero's h1 and form, and beside it the rota as HTML. */
const ROTA_TSX = `import { useState, type FormEvent } from "react";
import "./hero.css";

const DAYS = ["Tue", "Wed", "Thu"];

export default function Hero() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [day, setDay] = useState("Tue");
  return (
    <main className="cw-hero">
      <h1>Rotas in eighteen minutes</h1>
      <form onSubmit={(e: FormEvent) => e.preventDefault()}>
        <input type="email" aria-label="Work email" />
        <button type="submit" data-look="action">Start a trial</button>
      </form>
      <section className="cw-rota">
        <div className="cw-bar"><h2>Rota, week 47</h2><span>Draft</span></div>
        <div role="tablist">
          {DAYS.map(d => (
            <button key={d} role="tab" aria-pressed={day === d} onClick={() => setDay(d)}>{d}</button>
          ))}
        </div>
        <table className="cw-grid">
          <thead><tr><th scope="col">Staff</th><th scope="col">Tue</th><th scope="col">Wed</th></tr></thead>
          <tbody>{STAFF.map(s => (<tr key={s.name}><th scope="row">{s.name}</th>{s.days.map((d, i) => <td key={i}>{d}</td>)}</tr>))}</tbody>
        </table>
      </section>
    </main>
  );
}
`;

/** Product UI's readings and the lines they cite, or [] when there is none. */
const productLines = (files: Record<string, string>) => {
  const product = use(mediaScan(files), 'Product UI');
  return product ? product.evidence.map(item => `${item.file}:${item.line}`) : [];
};

test("the product's screen written as HTML, a titled table of its records, is Product UI, low", () => {
  const found = mediaScan({ 'index.tsx': ROTA_TSX, 'hero.css': PLAIN_CSS });
  assert.deepEqual(media(found), ['Product UI']);
  const product = use(found, 'Product UI');
  assert.equal(product?.confidence, 'low');
  assert.deepEqual(product?.evidence, [
    { file: 'index.tsx', line: 23, text: '<table className="cw-grid">' }
  ]);
  // In its own component file, as an ARIA table titled by an h3, with a live status of its own,
  // and a tag written straight after a word, which is a tag and not a type.
  const aria = `export function Screen() {
  const [week] = useState<Week | null>(null);
  return (
    <div className="x-card">
      <h3>Tips<span className="x-when">, Friday dinner</span></h3>
      <p role="status">Signed off</p>
      <div role="table" aria-label="Tips">
        <div role="row"><span role="columnheader">Name</span><span role="columnheader">Hours</span></div>
        {TIPS.map(t => (<div role="row" key={t.name}><span role="cell">{t.name}</span><span role="cell">{t.hours}</span></div>))}
      </div>
    </div>
  );
}
`;
  assert.deepEqual(productLines({ 'parts/screen.tsx': aria }), ['parts/screen.tsx:7']);
  // A screen in a fragment of its own, beside others in the same file.
  const fragments = `export const Tips = () => (
  <>
    <h3>Tips, Friday</h3><button onClick={next}>Saturday</button>
    <table><thead><tr><th>Name</th><th>Tips</th></tr></thead><tbody>{TIPS.map(t => <tr key={t.name}><td>{t.name}</td><td>{t.tips}</td></tr>)}</tbody></table>
  </>
);
export const Sites = () => (
  <>
    <h3>Sites</h3><button aria-pressed={all}>All sites</button>
    <table><thead><tr><th>Site</th><th>Staff</th></tr></thead><tbody>{SITES.map(s => <tr key={s.name}><td>{s.name}</td><td>{s.staff}</td></tr>)}</tbody></table>
  </>
);
`;
  assert.deepEqual(productLines({ 'parts/screens.tsx': fragments }), [
    'parts/screens.tsx:4',
    'parts/screens.tsx:10'
  ]);
});

test('a frame and a titled table are one Product UI entry, the frame cited first', () => {
  const frame =
    'export const Shot = () => <div className="browser-bar"><span>app.coverwell.com</span></div>;\n';
  const found = mediaScan({ 'index.tsx': ROTA_TSX, 'shot.tsx': frame });
  assert.deepEqual(media(found), ['Product UI']);
  assert.equal(use(found, 'Product UI')?.confidence, 'low');
  assert.deepEqual(productLines({ 'index.tsx': ROTA_TSX, 'shot.tsx': frame }), [
    'shot.tsx:1',
    'index.tsx:23'
  ]);
});

/** A rota screen, titled, with a control of its own, that reads; each case changes one part. */
const screenOf = (part: Partial<Record<'title' | 'control' | 'heads' | 'rows', string>> = {}) => {
  const {
    title = '<h2>Rota, week 47</h2>',
    control = '<button aria-pressed={all}>All staff</button>',
    heads = '<th scope="col">Staff</th><th scope="col">Tue</th>',
    rows = '{STAFF.map(s => (<tr key={s.name}><td>{s.name}</td><td>{s.tue}</td></tr>))}'
  } = part;
  return `<section className="x-screen">${title}${control}<table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></section>`;
};

/** A first screen: the hero's h1 and form in <main>, and `body` beside them. */
const heroWith = (body: string, before = '') => `${before}export default function Hero() {
  return (
    <main>
      <h1>Rotas in eighteen minutes</h1>
      <form onSubmit={go}><input type="email" /></form>
      ${body}
    </main>
  );
}
`;

test('a titled table is a screen only at rest, away from the way in, in a box of its own', () => {
  assert.deepEqual(productLines({ 'index.tsx': heroWith(screenOf()) }), ['index.tsx:6']);
  const cases: Record<string, string> = {
    // Inside a form: a booking step's slots are the way in.
    'in the form': heroWith(`<form onSubmit={book}>${screenOf()}</form>`),
    // Shown only once the form is sent: the way in's result.
    'on a state': heroWith(`{results && (${screenOf()})}`),
    // One card of a list the way in fills.
    'a row of a list': heroWith(
      `<ul>{KITCHENS.map(k => (<li key={k.id}>${screenOf({ title: '<h3>{k.name}</h3>' })}</li>))}</ul>`
    ),
    // Set straight into the hero, so its box is the one with the h1.
    'in the hero': heroWith(screenOf().replace(/^<section[^>]*>|<\/section>$/g, '')),
    // A section's own box, with its step headings.
    'a section with steps': heroWith(
      screenOf({ title: '<h2>How it works</h2><h3>Build</h3><h3>Publish</h3>' })
    ),
    // Titled by the page's own h1.
    'an h1': heroWith(screenOf({ title: '<h1>Rota</h1>' })),
    // Its box holds part of the way in.
    'the way in in its box': heroWith(
      screenOf({ control: '<button aria-pressed={all}>All</button><input type="search" />' })
    ),
    // Titled by a paragraph, so the box found is the hero's.
    'no heading': heroWith(screenOf({ title: '<p className="x-title">Rota</p>' })),
    // Rows written out, not drawn from data.
    'written rows': heroWith(screenOf({ rows: '<tr><td>Sam</td><td>Lunch</td></tr>' })),
    // Written inside a comment.
    'a comment': heroWith(`{/* ${screenOf()} */}`)
  };
  for (const [name, tsx] of Object.entries(cases)) {
    assert.deepEqual(mediaScan({ 'index.tsx': tsx }), [], name);
  }
});

test('a printed table, with no control or status of its own, is not a working screen', () => {
  const cases: Record<string, string> = {
    // The coverwell sections the owner did not count: a rota table, printed.
    'a printed rota': heroWith(screenOf({ control: '' })),
    // A comparison with other ways to work.
    'a comparison': heroWith(
      screenOf({
        title: '<h2>How we compare</h2>',
        control: '',
        heads: '<th>Feature</th><th>Coverwell</th><th>Spreadsheet</th>',
        rows: '{ROWS.map(r => (<tr key={r.name}><th scope="row">{r.name}</th><td>{r.ours}</td><td>{r.theirs}</td></tr>))}'
      })
    ),
    // An openfloor-like timetable: its Book buttons are in its rows, so they are the way in.
    'a timetable': heroWith(
      screenOf({
        title: "<h2>This week's timetable</h2>",
        control: '',
        heads: '<th>Day</th><th>Class</th><th>Studio</th>',
        rows: '{WEEK.map(c => (<tr key={c.id}><td>{c.day}</td><td>{c.name}</td><td><button onClick={() => book(c)}>Book</button></td></tr>))}'
      })
    )
  };
  for (const [name, tsx] of Object.entries(cases)) {
    assert.deepEqual(mediaScan({ 'index.tsx': tsx }), [], name);
  }
});

test('a price list is not the product, however its headers are written', () => {
  // A monthly and yearly toggle beside it, so only the headers keep it out.
  const control = '<button aria-pressed={yearly}>Yearly</button>';
  const heads = [
    '<th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Staff</th>',
    '<th scope="col"><span>Plan</span></th><th scope="col">Staff</th>',
    '<th>Plan name</th><th>Per month</th>',
    '<th>Option</th><th>Monthly</th>',
    '<th>Sites</th><th>Cost</th>'
  ];
  for (const head of heads) {
    const tsx = heroWith(screenOf({ title: '<h2>Plans</h2>', control, heads: head }));
    assert.deepEqual(mediaScan({ 'index.tsx': tsx }), [], head);
  }
  // A column that only mentions a cost is the product's own record.
  const labour = heroWith(screenOf({ control, heads: '<th>Staff</th><th>Labour cost</th>' }));
  assert.deepEqual(productLines({ 'index.tsx': labour }), ['index.tsx:6']);
});

test('a screen in a file of its own is read where it is drawn', () => {
  const part = (screen: string, exported = 'export function RotaScreen') =>
    `${exported}() {\n  return (\n    ${screen}\n  );\n}\n`;
  const named = 'import { RotaScreen } from "./parts/rota";\n';
  const at = (index: string, rota = part(screenOf())) =>
    productLines({ 'index.tsx': index, 'parts/rota.tsx': rota });
  assert.deepEqual(at(heroWith('<div className="x-side"><RotaScreen /></div>', named)), [
    'parts/rota.tsx:3'
  ]);
  // Drawn on a state, as a list's row, or inside the form.
  assert.deepEqual(at(heroWith('{rows && <RotaScreen rows={rows} />}', named)), []);
  assert.deepEqual(at(heroWith('{DAYS.map(d => <RotaScreen key={d} day={d} />)}', named)), []);
  assert.deepEqual(at(heroWith('<form onSubmit={book}><RotaScreen /></form>', named)), []);
  // The default export, under the name the page imports it by.
  const found = part(screenOf(), 'export default function RotaScreen');
  const alias = 'import Found from "./parts/rota";\n';
  assert.deepEqual(at(heroWith('{done && <Found />}', alias), found), []);
  assert.deepEqual(at(heroWith('<Found />', alias), found), ['parts/rota.tsx:3']);
  // A bare table in its own file, titled and worked where it is drawn.
  const week = part(
    screenOf().replace(/^<section[^>]*>.*?(?=<table>)|<\/section>$/g, ''),
    'export function Week'
  );
  const titled = heroWith(
    '<section><h2>Rota</h2><button onClick={next}>Next week</button><Week /></section>',
    'import { Week } from "./parts/week";\n'
  );
  assert.deepEqual(productLines({ 'index.tsx': titled, 'parts/week.tsx': week }), [
    'parts/week.tsx:3'
  ]);
});

test('a long file of comparisons is scanned in good time', () => {
  const big = 'if (a<b) { a++; }\n'.repeat(32_000);
  const started = Date.now();
  assert.deepEqual(mediaScan({ 'big.ts': `${big}const t = <div role="table">;\n` }), []);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

test('a class list, a timeline and table selectors in a stylesheet are not Product UI', () => {
  // An openfloor-like class list: an aria-hidden header over rows of buttons, beside the search.
  const classes = `export default function Hero() {
  return (
    <main>
      <h1>Drop in tonight</h1>
      <form role="search" onSubmit={go}><input name="area" /></form>
      <section>
        <h2>Tonight near you</h2>
        <div className="of-cols" aria-hidden="true"><span>Studio</span><span>Class</span><span>Price</span></div>
        <ul className="of-list">{shown.map(c => (<li key={c.id}><button aria-pressed={c.id === pick}>{c.studio} {c.name} {c.price}</button></li>))}</ul>
      </section>
    </main>
  );
}
`;
  // A timeline of lanes on a time axis, drawn with divs.
  const timeline = `export function Week() {
  return (
    <section>
      <h2>Monday, lane by lane</h2>
      <div className="axis">{HOURS.map(h => <span key={h}>{h}</span>)}</div>
      {LANES.map(lane => (<div key={lane.name} className="lane" style={{ left: lane.from, width: lane.span }}>{lane.name}</div>))}
    </section>
  );
}
`;
  const sheet = '.x-screen table { width: 100%; }\n.x-screen th { text-align: left; }\n';
  assert.deepEqual(mediaScan({ 'index.tsx': classes }), []);
  assert.deepEqual(mediaScan({ 'week.tsx': timeline }), []);
  assert.deepEqual(mediaScan({ 'hero.css': sheet, 'index.tsx': PLAIN_TSX }), []);
});

test('comments are not media', () => {
  const tsx = `// No <video> here, and no three.js: import * as THREE from "three";
/* A photo would go here: https://images.unsplash.com/photo-1 */
// <img src="/media/x.jpg" alt="" />
export const A = () => (
  <>
    {/* <img src="https://images.pexels.com/photos/2.jpeg" alt="" /> */}
    <input accept="image/*" />
  </>
);
`;
  assert.deepEqual(
    mediaScan({
      'a.tsx': tsx,
      'a.css':
        '/* .x { animation: spin 1s infinite } */\n/* .hero { background: url(photo.jpg); } */',
      'b.html': '<!-- <img src="/media/table.jpg"> -->\n<p>Menu</p>'
    }),
    []
  );
});

test('every medium at once, one entry each, sorted by name', () => {
  const files = {
    'scene.tsx': 'import * as THREE from "three";\nexport const V = () => <video src="/a.mp4" />;',
    'hero.tsx':
      DISH_TSX.replace('export function Dish', 'export function Hero') +
      '\nexport const P = () => <img src="https://images.pexels.com/photos/1.jpeg" alt="" />;\nexport const W = () => <div className="titlebar" />;',
    'flow.tsx':
      '<svg viewBox="0 0 400 100"><rect /><text>Kitchen</text><rect /><text>Door</text></svg>',
    'a.css': '.steam { animation: steam 4s infinite; }',
    'rota.tsx': ROTA_TSX
  };
  const found = mediaScan(files);
  assert.equal(use(found, 'Product UI')?.confidence, 'low');
  assert.deepEqual(media(found), [
    '3D',
    'Illustration',
    'Motion graphics',
    'Photography',
    'Product UI',
    'SVG diagrams',
    'Video'
  ]);
  for (const item of found) {
    assert.ok(item.evidence.length > 0, `${item.medium} has evidence`);
    assert.ok(
      item.evidence.every(line => line.line >= 1),
      `${item.medium}'s lines are 1-based`
    );
  }
});
