// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/layout.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Layouts: the bento grid and the editorial spread (reports/Expressive web audit.html, Part 2).
import type { Technique } from './types.js';

const BENTO_CSS = `/* Bento: unequal tiles, one lead. Each tile adapts to its own width through a container query. */
.bento {
  display: grid;
  gap: calc(var(--look-space) * 12px);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(140px, auto);
}
.bento > * {
  container-type: inline-size;
  min-width: 0;
  border-radius: calc(var(--look-radius) + 6px);
  background: var(--look-surface);
  border: 1px solid var(--look-border);
  padding: calc(var(--look-space) * 1.25rem);
  overflow: clip;
}
/* At phone size the lead goes first and full width; small tiles pair up side by side. */
.bento .tile-lead, .bento .tile-wide { grid-column: span 2; }

@media (min-width: 768px) {
  .bento { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(170px, auto); }
  .bento .tile-lead { grid-row: span 2; }
}

.tile-figure {
  font-family: var(--look-heading);
  font-size: clamp(2rem, 18cqi, 4.5rem);
  line-height: 1;
  overflow-wrap: anywhere;
}
@container (max-width: 180px) {
  .tile-note { font-size: 0.9375rem; }
}
`;

const BENTO_TSX = `import clsx from 'clsx';
import './bento.css';

type Tile = { figure: string; note: string; size?: 'lead' | 'wide'; picture?: string };

/**
 * Every tile carries a project fact, a number or a picture: never an icon and a sentence.
 * Two things to say is not a bento; use a pair instead.
 */
const TILES: Tile[] = [
  { figure: '18 min', note: 'average wait on a Friday, down from 40', size: 'lead' },
  { figure: '62', note: 'covers inside, 24 on the terrace' },
  { figure: '7', note: 'dishes change every week' },
  { figure: 'Until 1 am', note: 'kitchen open Thursday to Saturday', size: 'wide' }
];

export default function Bento() {
  return (
    <section className="px-4 py-10 md:px-10">
      <div className="bento">
        {TILES.map(tile => (
          <article
            key={tile.figure}
            className={clsx(
              'flex flex-col justify-between gap-3',
              tile.size === 'lead' && 'tile-lead',
              tile.size === 'wide' && 'tile-wide'
            )}
          >
            {tile.picture ? (
              <img src={tile.picture} alt="" className="aspect-[4/3] w-full rounded-(--look-radius) object-cover" />
            ) : null}
            <p className="tile-figure">{tile.figure}</p>
            <p className="tile-note text-base text-(--look-muted)">{tile.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
`;

const SPREAD_CSS = `/* An editorial spread: the picture breaks the column, the copy sits low opposite, a margin note. */
.spread {
  display: grid;
  column-gap: calc(var(--look-space) * 2rem);
  grid-template-columns:
    [full-start] minmax(1rem, 1fr)
    [main-start] repeat(10, minmax(0, 6rem))
    [main-end] minmax(1rem, 1fr)
    [full-end];
  align-items: end;
}
.spread .photo { grid-column: full-start / 8; grid-row: 1 / span 2; aspect-ratio: 4 / 5; width: 100%; object-fit: cover; }
.spread .copy { grid-column: 8 / main-end; grid-row: 1; align-self: end; }
.spread .note {
  grid-column: 9 / full-end;
  grid-row: 2;
  align-self: start;
  font-size: 0.8125rem;
  color: var(--look-muted);
  translate: 0 -40%;
}

/* The phone version is designed, not derived: the picture bleeds left and the copy overlaps it. */
@media (max-width: 767px) {
  .spread { grid-template-columns: 1rem minmax(0, 1fr) 1rem; column-gap: 0; }
  .spread .photo { grid-column: 1 / 3; grid-row: 1; }
  .spread .copy {
    grid-column: 2;
    grid-row: 2;
    position: relative;
    margin: -3rem 0 0 2.5rem;
    padding: 1rem;
    background: var(--look-bg);
  }
  .spread .note { grid-column: 2; grid-row: 3; translate: none; margin: 1rem 0 0 2.5rem; font-size: 0.875rem; }
}
`;

const SPREAD_TSX = `import './spread.css';

/**
 * Reading order in the markup stays logical (picture, copy, note) whatever the grid does. Use
 * the project's own photograph; with none, a drawn plate in look colours keeps the shape.
 */
export default function EditorialSpread({ picture }: { picture?: string }) {
  return (
    <section className="spread py-12">
      {picture ? (
        <img className="photo" src={picture} alt="The dining room at noon, from the bar" />
      ) : (
        <div
          className="photo"
          aria-hidden="true"
          style={{ background: 'linear-gradient(200deg, var(--look-brand), color-mix(in oklch, var(--look-accent) 60%, var(--look-bg)))' }}
        />
      )}
      <div className="copy">
        <h2 className="font-[family-name:var(--look-heading)] text-4xl leading-[0.95] md:text-7xl">
          Lunch, slowly.
        </h2>
        <p className="mt-4 max-w-[34ch] text-lg">Three courses from the market, served from noon until the bread runs out.</p>
      </div>
      <p className="note">Photographed in March, before the terrace opened.</p>
    </section>
  );
}
`;

export const LAYOUT_TECHNIQUES: Technique[] = [
  {
    id: 'bento-grid',
    name: 'Bento grid',
    styles: ['bento'],
    summary:
      'A grid of unequal tiles with one lead, each tile a real fact, number or picture; pairs up at 390 px.',
    keywords: [
      'bento',
      'grid',
      'tiles',
      'features',
      'specs',
      'highlights',
      'cards',
      'why us',
      'amenities',
      'stats',
      'numbers'
    ],
    use: "For features, specs, services, menus and amenities. Four to six tiles; the lead holds the strongest fact or picture. Replace the sample tiles with the project's own facts and media. Never fill a tile with an icon and a sentence.",
    code: [
      { path: 'parts/bento.tsx', content: BENTO_TSX },
      { path: 'parts/bento.css', content: BENTO_CSS }
    ],
    needs: {
      packages: ['clsx'],
      browsers: 'Grid and container queries in every current browser.',
      assets: 'Optional project pictures per tile.'
    },
    cost: {
      bytes: '0 KB.',
      phone: 'Good: the lead goes first and full width, small tiles pair up.'
    },
    floors: {
      reducedMotion: 'Static, so nothing changes.',
      phone:
        'Two columns: the lead and wide tiles span both, small tiles sit side by side; figures size by container width.',
      fallback: 'Without container queries the figure keeps its clamp floor.'
    },
    checks: [
      { id: 'overflow-390', what: 'Figures and notes fit their tiles at 390 px.' },
      { id: 'contrast-behind', what: 'Notes over any tile picture.' }
    ]
  },
  {
    id: 'editorial-spread',
    name: 'Editorial spread',
    styles: ['editorial'],
    summary:
      'A magazine spread on named grid lines: the picture breaks the column, copy sits low opposite, a margin note.',
    keywords: [
      'editorial',
      'magazine',
      'spread',
      'asymmetric',
      'anti-grid',
      'poster',
      'photo',
      'story',
      'fashion',
      'hospitality',
      'portfolio',
      'collage'
    ],
    use: 'For fashion, food, hospitality, culture and portfolios with good photography. The asymmetry must be deliberate: move the column lines, not the elements one by one. Keep the markup in reading order.',
    code: [
      { path: 'parts/editorial-spread.tsx', content: SPREAD_TSX },
      { path: 'parts/spread.css', content: SPREAD_CSS }
    ],
    needs: {
      packages: [],
      browsers: 'Grid with named lines in every current browser.',
      assets: 'A project photograph, ideally portrait.'
    },
    cost: {
      bytes: '0 KB beyond the photograph.',
      phone: 'Good, with the phone version written in.'
    },
    floors: {
      reducedMotion: 'Static, so nothing changes.',
      phone:
        'The picture bleeds to the left edge, the copy overlaps it on the ground colour, the note follows.',
      fallback: 'A drawn plate in look colours when there is no photograph.'
    },
    checks: [
      { id: 'overflow-390', what: 'The bleed and the overlap stay inside the viewport at 390 px.' },
      { id: 'contrast-behind', what: 'The overlapping copy against the picture behind it.' }
    ]
  }
];
