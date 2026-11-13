import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyChecks } from '../runs/checks.js';
import {
  BLOCKING_MEDIA,
  MEDIUM_AVOIDED,
  MEDIUM_AVOIDED_UNSURE,
  MEDIUM_MISSING,
  MISSING_UNREAD,
  criticMediaNotes,
  lookScreenFindings,
  type LookScreen,
  type LookScreenMedia,
  type MediaStance
} from '../runs/lookScreen.js';
import type { SvgBoxes } from '../runs/svgBoxes.js';
import type { Check } from '../runs/types.js';

/** The look's own files on the web, which the check never reads. */
const LOOK_CSS = 'look.css';
const LOOK_WORDS = 'look.ts';

// ROUGHBOOK-MEDIA-PLAN.md, V2 and V3: a look's sketch uses no medium its project avoids, by the
// media scan, and a look given a medium to lead with is told (softly) when its files show none.
// The same cases as the backend's src/tests/compile/lookScreenMedia.test.ts, word for word.

const screen: LookScreen = {
  subline: 'Dinner from the kitchens down the road, carried by our own couriers.',
  points: [],
  account: false,
  action: 'a labelled field asking where the person is',
  catalogue: null,
  skeleton: null
};

const working = `import { useState } from 'react';
import { words } from './look';
export default function Screen() {
  const [where, setWhere] = useState('');
  return (
    <main>
      <header><strong>Dishpatch</strong></header>
      <h1 data-look="headline">{words.headline}</h1>
      <p data-look="subline">{words.subline}</p>
      <form onSubmit={event => event.preventDefault()}>
        <label htmlFor="where">Where are you?</label>
        <input id="where" value={where} onChange={event => setWhere(event.target.value)} />
        <button type="submit">Find kitchens</button>
      </form>
    </main>
  );
}
`;

const files = (...more: [string, string][]) =>
  new Map<string, string>([
    ['index.tsx', working],
    ...more,
    [LOOK_CSS, ':root { --look-bg: #ffffff; }'],
    [LOOK_WORDS, `export const words = ${JSON.stringify({ subline: screen.subline })};`]
  ]);

type Medium = (typeof BLOCKING_MEDIA)[number] | 'Product UI';

const stances = (stance: MediaStance['stance'], ...labels: string[]): MediaStance[] =>
  labels.map(label => ({ label, stance }));

/** One file that shows each medium, and the words its place is named with. */
const SHOWS: Record<Medium, { file: [string, string]; place: string }> = {
  '3D': {
    file: ['hero.css', '.card {\n  transform: perspective(800px) rotateY(12deg);\n}\n'],
    place: 'a CSS 3D transform in hero.css, line 2'
  },
  Video: {
    file: [
      'art.tsx',
      'export function Art() {\n  return <video src="/clip.mp4" muted playsInline />;\n}\n'
    ],
    place: 'a <video> element in art.tsx, line 2'
  },
  'Motion graphics': {
    file: ['hero.css', '.drift {\n  animation: drift 6s linear infinite;\n}\n'],
    place: 'an animation that loops in hero.css, line 2'
  },
  Photography: {
    file: [
      'art.tsx',
      'export function Art() {\n  return <img src="https://images.unsplash.com/photo-1.jpg" alt="A kitchen" />;\n}\n'
    ],
    place: 'a photo in art.tsx, line 2'
  },
  Illustration: {
    file: [
      'art.tsx',
      `export function Art() {
  return (
    <svg viewBox="0 0 400 300" aria-hidden="true">
      <path d="M10 10 C 80 40, 120 40, 200 10" />
      <circle cx="120" cy="140" r="60" />
      <path d="M40 260 Q 200 180 360 260" />
    </svg>
  );
}
`
    ],
    place: 'a drawing (an inline <svg>) in art.tsx, line 3'
  },
  'SVG diagrams': {
    file: [
      'map.tsx',
      `export function Map() {
  return (
    <svg viewBox="0 0 600 400" role="img" aria-label="Classes across the city">
      <path d="M0 200 L600 180" />
      <circle cx="140" cy="120" r="8" />
      <text x="150" y="118">Ancoats</text>
      <circle cx="420" cy="260" r="8" />
      <text x="430" y="258">Chorlton</text>
    </svg>
  );
}
`
    ],
    place:
      'a labelled drawing (an inline <svg> with text, connectors or a route) in map.tsx, line 3'
  },
  'Product UI': {
    file: [
      'shot.tsx',
      'export function Shot() {\n  return <div className="browser-bar"><span>app.coverwell.com</span></div>;\n}\n'
    ],
    place: 'a drawn app window or device frame in shot.tsx, line 2'
  }
};

/** The product's screen written as HTML: a titled table of its records with its own status. */
const ROTA_SCREEN: { file: [string, string]; place: string } = {
  file: [
    'rota.tsx',
    `export function Rota() {
  return (
    <section className="cw-rota">
      <h2>Rota, week 47</h2><p role="status">Draft</p>
      <table>
        <thead><tr><th scope="col">Staff</th><th scope="col">Tue</th></tr></thead>
        <tbody>{STAFF.map(s => (<tr key={s.name}><th scope="row">{s.name}</th><td>{s.tue}</td></tr>))}</tbody>
      </table>
    </section>
  );
}
`
  ],
  place: "the product's screen written as HTML (a titled table of its records) in rota.tsx, line 5"
};

const codes = (found: { code: string }[]) => found.map(item => item.code);

/** The render's measure of the one drawing in SHOWS.Illustration, at both widths. */
const DRAWING_BOXES: SvgBoxes = {
  wide: [
    {
      index: 0,
      width: 400,
      height: 300,
      viewBox: '0 0 400 300',
      texts: 0,
      shapes: 3,
      lines: 0,
      inControl: false,
      hidden: true
    }
  ]
};

/**
 * A drawing of shapes alone is sure only once the render has measured it (V2): read from the files
 * it is a warning, and the measured reading blocks.
 */
const MEASURED_ONLY: readonly string[] = ['Illustration'];

describe('the avoid check for looks (V2)', () => {
  for (const medium of BLOCKING_MEDIA) {
    const { file, place } = SHOWS[medium];

    it(`sends ${medium} back once when the project avoids it, naming where it is`, () => {
      const options = MEASURED_ONLY.includes(medium) ? { boxes: DRAWING_BOXES } : {};
      const found = lookScreenFindings(files(file), screen, {
        media: stances('avoid', medium),
        ...options
      });
      assert.deepEqual(codes(found), [MEDIUM_AVOIDED]);
      assert.equal(found[0]!.blocks, true);
      assert.match(found[0]!.message, new RegExp(`^The project avoids ${medium}, and the screen`));
      assert.ok(found[0]!.message.includes(place), found[0]!.message);
    });

    it(`finds nothing when ${medium} is avoided and absent`, () => {
      assert.deepEqual(
        lookScreenFindings(files(), screen, { media: stances('avoid', medium) }),
        []
      );
    });

    it(`finds nothing when ${medium} is used and only allowed or preferred`, () => {
      for (const stance of ['allowed', 'preferred'] as const) {
        assert.deepEqual(
          lookScreenFindings(files(file), screen, { media: stances(stance, medium) }),
          []
        );
      }
    });
  }

  it('tells the critic of Product UI, which never blocks (decision 4)', () => {
    const { file, place } = SHOWS['Product UI'];
    const found = lookScreenFindings(files(file), screen, {
      media: stances('avoid', 'Product UI')
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED_UNSURE]);
    assert.equal(found[0]!.blocks, undefined);
    assert.ok(found[0]!.message.includes(place), found[0]!.message);
    assert.match(found[0]!.message, /outcome the customer gets/);
    assert.deepEqual(criticMediaNotes(found), [found[0]!.message]);
    assert.deepEqual(
      lookScreenFindings(files(), screen, { media: stances('avoid', 'Product UI') }),
      []
    );
  });

  it("tells the critic of the product's screen written as HTML, never blocking", () => {
    const found = lookScreenFindings(files(ROTA_SCREEN.file), screen, {
      media: stances('avoid', 'Product UI')
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED_UNSURE]);
    assert.equal(found[0]!.blocks, undefined);
    assert.ok(found[0]!.message.includes(ROTA_SCREEN.place), found[0]!.message);
  });

  it('keeps an illustration under SVG diagrams avoided (decision 7)', () => {
    const found = lookScreenFindings(files(SHOWS.Illustration.file), screen, {
      media: stances('avoid', 'SVG diagrams')
    });
    assert.deepEqual(found, []);
  });

  it('sends a labelled map back under SVG diagrams avoided (decision 7, as the owner confirmed)', () => {
    const found = lookScreenFindings(files(SHOWS['SVG diagrams'].file), screen, {
      media: stances('avoid', 'SVG diagrams')
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED]);
    assert.equal(found[0]!.blocks, true);
    assert.match(
      found[0]!.message,
      /Say the places and facts as text instead; a drawing without labels may stay\./
    );
  });

  it('offers no avoided medium as the way out', () => {
    const found = lookScreenFindings(files(SHOWS['SVG diagrams'].file), screen, {
      media: stances('avoid', 'SVG diagrams', 'Illustration')
    });
    assert.doesNotMatch(found[0]!.message, /a drawing without labels may stay/);
    const drawn = lookScreenFindings(files(SHOWS.Illustration.file), screen, {
      media: stances('avoid', 'Illustration', 'SVG diagrams'),
      boxes: DRAWING_BOXES
    });
    assert.deepEqual(codes(drawn), [MEDIUM_AVOIDED]);
    assert.doesNotMatch(drawn[0]!.message, /make it a diagram/);
  });

  it('tells the critic of an unclear drawing, never blocking (decision 7)', () => {
    const small = `export function Mark() {
  return (
    <svg viewBox="0 0 80 60"><path d="M0 0 L80 60" /><circle cx="40" cy="30" r="9" /><path d="M0 60 L80 0" /></svg>
  );
}
`;
    const found = lookScreenFindings(files(['mark.tsx', small]), screen, {
      media: stances('avoid', 'Illustration', 'SVG diagrams')
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED_UNSURE]);
    assert.equal(found[0]!.blocks, undefined);
  });

  it('leaves an icon alone', () => {
    const icon = `export function Icon() {
  return <svg viewBox="0 0 24 24"><path d="M4 12h16" /><path d="M12 4v16" /></svg>;
}
`;
    assert.deepEqual(
      lookScreenFindings(files(['icon.tsx', icon]), screen, {
        media: stances('avoid', 'Illustration', 'SVG diagrams')
      }),
      []
    );
  });

  it('reads a drawing of shapes from the files as unsure, and blocks it once the render measured it', () => {
    const media = stances('avoid', 'Illustration');
    const before = lookScreenFindings(files(SHOWS.Illustration.file), screen, { media });
    assert.deepEqual(codes(before), [MEDIUM_AVOIDED_UNSURE]);
    assert.equal(before[0]!.blocks, undefined);
    assert.match(
      before[0]!.message,
      /The scan cannot be sure of this one, so it does not hold the screen back\. Take the drawing off/
    );
    assert.doesNotMatch(before[0]!.message, /critic/);
    const after = lookScreenFindings(files(SHOWS.Illustration.file), screen, {
      media,
      boxes: DRAWING_BOXES
    });
    assert.deepEqual(codes(after), [MEDIUM_AVOIDED]);
    assert.equal(after[0]!.blocks, true);
    assert.ok(after[0]!.message.includes(SHOWS.Illustration.place), after[0]!.message);
  });

  it('never blocks a drawing of shapes under the type picture style, which allows moving shapes (decision 2)', () => {
    const typeOnly = {
      ...screen,
      pictures: { stance: 'type' as const, urls: [] },
      media: stances('avoid', 'Photography', 'Illustration')
    };
    const found = lookScreenFindings(files(SHOWS.Illustration.file), typeOnly, {
      boxes: DRAWING_BOXES
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED_UNSURE]);
    assert.equal(found[0]!.blocks, undefined);
    // A photos project avoids Illustration through its style too, and was told so: it blocks.
    const photos = { ...typeOnly, pictures: { stance: 'photos' as const, urls: [] } };
    assert.deepEqual(
      codes(lookScreenFindings(files(SHOWS.Illustration.file), photos, { boxes: DRAWING_BOXES })),
      [MEDIUM_AVOIDED]
    );
  });

  it('keeps a wordmark in the header unsure, never blocking', () => {
    const header = `export function Top() {
  return (
    <header><a href="/"><svg viewBox="0 0 120 32"><path d="M0 0h9" /><path d="M9 0h9" /><text x="20" y="20">Openfloor</text></svg></a></header>
  );
}
`;
    const found = lookScreenFindings(files(['top.tsx', header]), screen, {
      media: stances('avoid', 'SVG diagrams')
    });
    assert.ok(!found.some(item => item.blocks), JSON.stringify(found));
  });

  it("tells the sketch to keep still in the rules' own words when it avoids Motion graphics", () => {
    const found = lookScreenFindings(files(SHOWS['Motion graphics'].file), screen, {
      media: stances('avoid', 'Motion graphics')
    });
    assert.ok(
      found[0]!.message.endsWith(
        'Let nothing on the first screen move on load or at rest: no entrance, no loop and no decorative animation. Motion may only show what changed when the way in is used, on transform and opacity, for at most 150 ms over a short distance.'
      ),
      found[0]!.message
    );
    assert.doesNotMatch(found[0]!.message, /300 ms/);
  });

  it('names a refused photo once, as PICTURE_NOT_ALLOWED', () => {
    const found = lookScreenFindings(
      files(SHOWS.Photography.file),
      { ...screen, pictures: { stance: 'type', urls: [] } },
      { media: stances('avoid', 'Photography') }
    );
    assert.deepEqual(codes(found), ['PICTURE_NOT_ALLOWED']);
  });

  it('reads the stances from the check itself, the options winning', () => {
    const carried = { ...screen, media: stances('avoid', '3D') };
    assert.deepEqual(codes(lookScreenFindings(files(SHOWS['3D'].file), carried)), [MEDIUM_AVOIDED]);
    assert.deepEqual(
      lookScreenFindings(files(SHOWS['3D'].file), carried, { media: stances('allowed', '3D') }),
      []
    );
    assert.deepEqual(
      lookScreenFindings(files(SHOWS['3D'].file), screen),
      [],
      'no stances, no check'
    );
  });

  it('matches a stance by its label in any case', () => {
    const found = lookScreenFindings(files(SHOWS.Video.file), screen, {
      media: stances('avoid', ' video ')
    });
    assert.deepEqual(codes(found), [MEDIUM_AVOIDED]);
  });

  it('fails a studio run on it, as the web sends a sketch back', () => {
    const carried: LookScreen & LookScreenMedia = { ...screen, media: stances('avoid', '3D') };
    const checks: Check[] = [
      { kind: 'entry-file', file: 'index.tsx' },
      { kind: 'look-screen', screen: carried }
    ];
    const outcome = applyChecks(checks, {
      iterationId: 'iteration-01',
      files: files(SHOWS['3D'].file)
    });
    assert.equal(outcome.failure?.code, MEDIUM_AVOIDED);
    assert.ok(outcome.failure!.message.includes(SHOWS['3D'].place));
  });

  it('lists a soft finding as a warning, never the failure', () => {
    const carried: LookScreen & LookScreenMedia = {
      ...screen,
      media: stances('avoid', 'Product UI')
    };
    const checks: Check[] = [
      { kind: 'entry-file', file: 'index.tsx' },
      { kind: 'look-screen', screen: carried }
    ];
    const outcome = applyChecks(checks, {
      iterationId: 'iteration-01',
      files: files(SHOWS['Product UI'].file)
    });
    assert.equal(outcome.failure, null);
    assert.deepEqual(codes(outcome.warnings), [MEDIUM_AVOIDED_UNSURE]);
  });
});

describe("the look's own medium (V3)", () => {
  it('tells the critic when the files show none of it, never blocking', () => {
    const found = lookScreenFindings(files(), screen, { medium: 'SVG diagrams' });
    assert.deepEqual(codes(found), [MEDIUM_MISSING]);
    assert.equal(found[0]!.blocks, undefined);
    assert.equal(
      found[0]!.message,
      'This look was given SVG diagrams to lead with, and the scan finds none in its files. Let SVG diagrams carry the look where its structure has room.'
    );
    assert.deepEqual(criticMediaNotes(found), [found[0]!.message]);
  });

  it('says nothing when the files show it', () => {
    assert.deepEqual(
      lookScreenFindings(files(SHOWS['SVG diagrams'].file), screen, { medium: 'SVG diagrams' }),
      []
    );
    assert.deepEqual(
      lookScreenFindings(files(SHOWS['Motion graphics'].file), screen, {
        medium: 'motion graphics'
      }),
      []
    );
  });

  it('counts an illustration as missing for a look given SVG diagrams', () => {
    const found = lookScreenFindings(files(SHOWS.Illustration.file), screen, {
      medium: 'SVG diagrams'
    });
    assert.deepEqual(codes(found), [MEDIUM_MISSING]);
  });

  it('says nothing for a medium the scan does not read, or one the project avoids', () => {
    assert.deepEqual(lookScreenFindings(files(), screen, { medium: 'Generated imagery' }), []);
    assert.deepEqual(lookScreenFindings(files(), screen, { medium: null }), []);
    assert.deepEqual(
      lookScreenFindings(files(), screen, {
        medium: 'Illustration',
        media: stances('avoid', 'Illustration')
      }),
      []
    );
  });

  it('reads the medium from the check itself', () => {
    const found = lookScreenFindings(files(), { ...screen, medium: 'Illustration' });
    assert.deepEqual(codes(found), [MEDIUM_MISSING]);
  });

  it('never says Product UI is missing, as the scan cannot see it shown as plain HTML', () => {
    assert.ok(MISSING_UNREAD.includes('Product UI'));
    assert.deepEqual(lookScreenFindings(files(), screen, { medium: 'Product UI' }), []);
    assert.deepEqual(
      lookScreenFindings(files(ROTA_SCREEN.file), screen, {
        medium: 'Product UI',
        media: stances('preferred', 'Product UI')
      }),
      []
    );
  });
});
