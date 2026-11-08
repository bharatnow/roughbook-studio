import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import { lookScreenFindings, type LookScreen } from '../runs/lookScreen.js';
import type { Check, RunRecord } from '../runs/types.js';

// The same cases as the backend's src/tests/compile/lookScreen.test.ts and the structure cases of
// its src/tests/rules/skeletons.test.ts: the backend sends a first-screen run the look-screen
// check, and both sides find the same things with the same words (E8 of the engine plan).

const screen: LookScreen = {
  subline: 'Dinner from the kitchens down the road, carried by our own couriers.',
  points: ['300 local restaurants', 'Own couriers', 'Filters drawn like map lines, easy to follow'],
  account: true,
  action: 'a labelled field asking where the person is',
  catalogue: { name: 'restaurants', min: 4, kinds: ['time', 'price', 'rating'] },
  skeleton: null
};

/** The look's own files on the web, which the check never reads. */
const lookFiles: [string, string][] = [
  ['look.css', ':root { --look-bg: #ffffff; }'],
  ['look.ts', `export const words = ${JSON.stringify({ subline: screen.subline })};`]
];

const working = `import { useState } from 'react';
import { words } from './look';
const kitchens = [
  { name: 'Mama Lin', area: 'Ancoats', time: '20–30 min', fee: '£1.49', rating: 4.8 },
  { name: 'Bao Corner', area: 'Chorlton', time: '25–35 min', fee: 'Free', rating: 4.6 },
  { name: 'Casa Rosa', area: 'Didsbury', time: '15–25 min', fee: '£2.20', rating: 4.9 },
  { name: 'The Pickle Jar', area: 'Levenshulme', time: '30–40 min', fee: '£0.99', rating: 4.3 }
];
export default function Screen() {
  const [where, setWhere] = useState('');
  const [shown, setShown] = useState(false);
  return (
    <main>
      <header>
        <strong>Dishpatch</strong> <span>Manchester</span> <a href="#log-in">Log in</a>
      </header>
      <h1 data-look="headline">{words.headline}</h1>
      <p data-look="subline">{words.subline}</p>
      <form onSubmit={event => { event.preventDefault(); setShown(true); }}>
        <label htmlFor="where">Where are you?</label>
        <input id="where" value={where} onChange={event => setWhere(event.target.value)} />
        <button type="submit">Find kitchens</button>
      </form>
      <ul id="kitchens" hidden={!shown}>
        {kitchens.map(item => (
          <li key={item.name}>{item.name} · {item.area} · {item.time} · {item.fee} · {item.rating}</li>
        ))}
      </ul>
      <p>Median handover: 24 min. 4 kitchens in view.</p>
      <button onClick={() => setShown(false)}>Clear</button>
      <a id="log-in" href="#kitchens">See the kitchens</a>
    </main>
  );
}
`;

const poster = `import { words } from './look';
export default function Screen() {
  return (
    <section>
      <h1 data-look="headline">{words.headline}</h1>
      <p data-look="subline">{words.subline}</p>
      <p>Your street, Your town · Open today until 10pm</p>
      <ul>
        <li>300 local restaurants</li>
        <li>Filters drawn like map lines, easy to follow</li>
        <li>Dinner from the kitchens down the road, every night</li>
        <li>Our own couriers</li>
      </ul>
      <a href="#order">Order now</a>
      <button>Browse</button>
      <div><span>Thai</span><span>Pizza</span><span>Ramen</span><span>Tacos</span></div>
    </section>
  );
}
`;

const files = (source: string, more: [string, string][] = []) =>
  new Map<string, string>([['index.tsx', source], ...more, ...lookFiles]);

describe('the look-screen check', () => {
  it('passes a screen with a field that submits, a header, named kitchens and live controls', () => {
    assert.deepEqual(lookScreenFindings(files(working), screen), []);
  });

  it('names everything a poster lacks, each once, and each blocks the finish', () => {
    const findings = lookScreenFindings(files(poster), screen);
    assert.deepEqual(
      findings.map(item => item.code),
      [
        'PLACEHOLDER_ADDRESS',
        'LOOK_NOTE_RENDERED',
        'SUBLINE_REPEATED',
        'NO_WORKING_FIELD',
        'NO_HEADER',
        'DEAD_BUTTON',
        'DEAD_ANCHOR',
        'NO_CATALOGUE'
      ]
    );
    assert.ok(findings.every(item => item.blocks));
    const by = Object.fromEntries(findings.map(item => [item.code, item.message]));
    assert.match(by.PLACEHOLDER_ADDRESS!, /^index\.tsx writes "Your street"/);
    // A point of two words is an ordinary phrase; one of three or more is a note copied over.
    assert.match(
      by.LOOK_NOTE_RENDERED!,
      /"300 local restaurants", "Filters drawn like map lines, easy to follow"/
    );
    assert.doesNotMatch(by.LOOK_NOTE_RENDERED!, /Own couriers/);
    assert.match(
      by.NO_WORKING_FIELD!,
      /no input, no label, no form with an onSubmit\)\. It needs a labelled field asking where the person is\./
    );
    assert.match(by.NO_HEADER!, /no <header>/);
    assert.match(by.DEAD_BUTTON!, /^index\.tsx has 1 button with no handler/);
    assert.match(by.DEAD_ANCHOR!, /^index\.tsx links to #order, which no element/);
    assert.match(by.NO_CATALOGUE!, /^The screen needs restaurants by name, at least 4/);
    assert.match(by.NO_CATALOGUE!, /found 0 time ranges \(0 distinct\), 0 prices or fees/);
    assert.match(by.NO_CATALOGUE!, /only a category do not count/);
  });

  it('reads ids and handlers across files, and a header needs Log in', () => {
    const split = working
      .replace('<a id="log-in" href="#kitchens">See the kitchens</a>', '')
      .replace('<a href="#log-in">Log in</a>', '<a href="#log-in">Account</a>');
    const codes = lookScreenFindings(
      files(split, [['footer.tsx', '<footer id="log-in"><a href="#kitchens">Menu</a></footer>']]),
      screen
    ).map(item => item.code);
    assert.deepEqual(codes, ['NO_HEADER']);
    assert.deepEqual(
      lookScreenFindings(files(split), screen).map(item => item.code),
      ['NO_HEADER', 'DEAD_ANCHOR']
    );
  });

  it('wants the catalogue varied, and only what the contract can count', () => {
    const same = working.replace(/'\d\d–\d\d min'/g, "'20–30 min'").replace(/4\.\d/g, '4.8');
    const [finding] = lookScreenFindings(files(same), screen);
    assert.equal(finding?.code, 'NO_CATALOGUE');
    assert.match(finding!.message, /4 time ranges \(1 distinct\).*4 ratings \(1 distinct\)/);
    assert.deepEqual(lookScreenFindings(files(same), { ...screen, catalogue: null }), []);
  });

  it('asks for Log in only where people have accounts', () => {
    const noLogIn = working.replace('<a href="#log-in">Log in</a>', '<a href="#log-in">Menu</a>');
    assert.deepEqual(
      lookScreenFindings(files(noLogIn), screen).map(item => item.code),
      ['NO_HEADER']
    );
    assert.deepEqual(lookScreenFindings(files(noLogIn), { ...screen, account: false }), []);
  });

  it('never reads the look’s own files, and a subline said once is fine', () => {
    assert.deepEqual(lookScreenFindings(new Map(lookFiles), screen), []);
    const short = { ...screen, subline: 'Dinner, delivered.' };
    assert.deepEqual(lookScreenFindings(files(working), short), []);
    assert.deepEqual(
      lookScreenFindings(
        files(working.replace('Median handover', 'Dinner, delivered. Median handover')),
        short
      ).map(item => item.code),
      ['SUBLINE_REPEATED']
    );
  });

  describe('with the content sheet (E2)', () => {
    const rows = [
      { name: 'Mama Lin', values: ['Ancoats', '20–30 min', '£1.49', '4.8'] },
      { name: 'Bao Corner', values: ['Chorlton', '25–35 min', 'Free', '4.6'] },
      { name: 'Casa Rosa', values: ['Didsbury', '15–25 min', '£2.20', '4.9'] },
      { name: 'The Pickle Jar', values: ['Levenshulme', '30–40 min', '£0.99', '4.3'] },
      { name: 'Ancoats Social', values: ['Ancoats', '20–25 min', '£1.00', '4.4'] }
    ];
    const urls = ['/api/files/project/dishpatch/jollof%20rice.jpg'];
    /** The screen as the backend's lookScreen() makes it with the project's sheet. */
    const withSheet = (stance: 'type' | 'photos' | 'illustration' = 'type'): LookScreen => ({
      ...screen,
      content: {
        label: 'restaurants',
        names: rows.map(row => row.name),
        columns: ['area', 'delivery time', 'fee', 'rating'],
        known: ['Dishpatch', ...rows.flatMap(row => row.values)]
      },
      pictures: { stance, urls: stance === 'photos' ? urls : [] }
    });

    it('passes a sketch whose listed things are all on the sheet', () => {
      assert.deepEqual(lookScreenFindings(files(working), withSheet()), []);
    });

    it('refuses names that are not on the sheet, once, with the sheet’s names to use', () => {
      const invented = working
        .replace("'Mama Lin'", "'Golden Wok'")
        .replace("'Bao Corner'", '"Taco Town"');
      const findings = lookScreenFindings(files(invented), withSheet());
      assert.deepEqual(
        findings.map(item => item.code),
        ['INVENTED_NAME']
      );
      assert.ok(findings[0]!.blocks);
      assert.equal(
        findings[0]!.message,
        'The screen lists restaurants that are not on the project\'s content sheet: "Golden Wok", "Taco Town". Show only the sheet\'s restaurants, by their names there (Mama Lin, Bao Corner, Casa Rosa, The Pickle Jar, Ancoats Social), with their facts; never make one up.'
      );
    });

    it('refuses a whole list made up, known by the sheet’s columns or values', () => {
      const madeUp = `export const places = [
  { name: 'Golden Wok', area: 'Hulme', time: '10–20 min', deliveryFee: '£3.00' },
  { name: 'Taco Town', area: 'Ancoats', eta: 'soon' }
];`;
      const [finding] = lookScreenFindings(files(working, [['data.ts', madeUp]]), withSheet());
      assert.equal(finding?.code, 'INVENTED_NAME');
      assert.match(finding!.message, /"Golden Wok", "Taco Town"\./);
    });

    it('never mistakes headings, links, steps, the brand, the area or one thing for invented', () => {
      const ordinary = `export const nav = [
  { name: 'Home', href: '#home' },
  { name: 'Offers', href: '#offers' }
];
export const steps = [
  { title: 'Choose a kitchen', time: '1 min' },
  { title: 'Track your order', time: 'live' }
];
export const brand = { name: 'Dishpatch', city: 'Manchester' };
export const areas = [{ name: 'Ancoats', count: 2 }, { name: 'Chorlton', count: 1 }];
export const featured = { title: 'Tonight in Ancoats', area: 'Ancoats' };
export const kinds = [{ title: 'Pizza' }, { title: 'Ramen' }];
type Place = { name: string; area: string; time: string };
`;
      assert.deepEqual(
        lookScreenFindings(files(working, [['more.ts', ordinary]]), withSheet()),
        []
      );
      // A name the sheet's name holds, or one that holds it, is the same thing.
      const longer = working.replace("'Casa Rosa'", "'Casa Rosa, Didsbury'");
      assert.deepEqual(lookScreenFindings(files(longer), withSheet()), []);
      // One listed thing alone is never enough to tell.
      const one = "export const pick = [{ name: 'Golden Wok', area: 'Ancoats' }];";
      assert.deepEqual(
        lookScreenFindings(
          files(working.replace(/name: '[^']+'/g, "label: 'x'"), [['one.ts', one]]),
          withSheet()
        ).map(item => item.code),
        []
      );
    });

    it('with photos, allows only the chosen ones, and drawing and fonts are never pictures', () => {
      const photo = (src: string) =>
        working.replace(
          '<p>Median handover',
          `<img src="${src}" alt="" /><svg><rect fill="url(#grain)" /></svg><p style={{ backgroundImage: "url('data:image/png;base64,AAAA')" }}>Median handover`
        );
      const fonts: [string, string] = [
        'styles.css',
        "@import url('https://fonts.googleapis.com/css2?family=Inter');"
      ];
      const allowed = photo('/api/files/project/dishpatch/jollof%20rice.jpg');
      assert.deepEqual(lookScreenFindings(files(allowed, [fonts]), withSheet('photos')), []);
      // A host in front of the project's own path, or the path decoded, is the same file.
      assert.deepEqual(
        lookScreenFindings(
          files(photo('https://roughbook.app/api/files/project/dishpatch/jollof%20rice.jpg')),
          withSheet('photos')
        ),
        []
      );
      const stock = photo('https://images.unsplash.com/photo-1?w=800');
      const css: [string, string] = [
        'styles.css',
        '.hero { background: url(/img/plate.webp) center; }'
      ];
      const findings = lookScreenFindings(files(stock, [css]), withSheet('photos'));
      assert.deepEqual(
        findings.map(item => item.code),
        ['PICTURE_NOT_ALLOWED']
      );
      assert.equal(
        findings[0]!.message,
        'index.tsx, styles.css use pictures the project\'s imagery does not allow: "https://images.unsplash.com/photo-1?w=800", "/img/plate.webp". Use only the project\'s chosen photos, by these URLs: /api/files/project/dishpatch/jollof%20rice.jpg; draw nothing in place of a photo.'
      );
    });

    it('with type or illustration, refuses any photo or raster picture at all', () => {
      const own = working.replace(
        '<p>Median handover',
        '<img src="/api/files/project/dishpatch/jollof%20rice.jpg" alt="" /><p>Median handover'
      );
      const [typed] = lookScreenFindings(files(own), withSheet('type'));
      assert.equal(typed?.code, 'PICTURE_NOT_ALLOWED');
      assert.match(typed!.message, /^index\.tsx uses pictures/);
      assert.match(typed!.message, /This look has no pictures: take them off/);
      const data = "const photo = 'https://cdn.example.com/plates/rice.png';";
      const [drawn] = lookScreenFindings(
        files(working, [['data.ts', data]]),
        withSheet('illustration')
      );
      assert.equal(drawn?.code, 'PICTURE_NOT_ALLOWED');
      assert.match(
        drawn!.message,
        /illustrations in its own drawing language, drawn as inline SVG/
      );
      // Inline SVG, an SVG file and an SVG data URI are drawing.
      const svg = working.replace(
        '<p>Median handover',
        '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="" /><img src="mark.svg" alt="" /><svg><path d="M0 0" /></svg><p>Median handover'
      );
      assert.deepEqual(lookScreenFindings(files(svg), withSheet('illustration')), []);
      assert.deepEqual(lookScreenFindings(files(svg), withSheet('type')), []);
    });
  });

  describe('on a structure (E3)', () => {
    const bare: LookScreen = {
      subline: 'Dinner from the kitchens down the road.',
      points: [],
      account: false,
      action: 'a labelled field in a form whose submit does something',
      catalogue: null,
      skeleton: null
    };
    const one = (source: string) => new Map([['index.tsx', source]]);

    it('sends back a look built without its structure’s carrier', () => {
      const timeline = { ...bare, skeleton: 'timeline' as const };
      const without = lookScreenFindings(one('<main><header>Dishpatch</header></main>'), timeline);
      const missing = without.find(item => item.code === 'SKELETON_MISSING');
      assert.match(
        missing!.message,
        /^This look was assigned the Timeline structure and its files have no numbered <ol> of steps\./
      );
      const withIt = lookScreenFindings(
        one('<main><header>Dishpatch</header><ol><li>1</li></ol></main>'),
        timeline
      );
      assert.ok(!withIt.some(item => item.code === 'SKELETON_MISSING'));
    });

    it('asks nothing more of the structures the field and objects carry', () => {
      for (const id of ['search-first', 'single-object', 'hero'] as const) {
        const findings = lookScreenFindings(one('<main><header>Dishpatch</header></main>'), {
          ...bare,
          skeleton: id
        });
        assert.ok(!findings.some(item => item.code === 'SKELETON_MISSING'), id);
      }
    });
  });
});

describe('the look-screen check in a studio run', () => {
  const checks: Check[] = [
    { kind: 'entry-file', file: 'index.tsx' },
    { kind: 'craft-floor' },
    { kind: 'look-screen', screen: { ...screen, skeleton: 'list-first' } }
  ];
  const run = { targetFolder: 'rough/homepage/hero/iteration-03' } as RunRecord;

  it('fails on a blocking finding, with its words as the reason, and lists the rest', () => {
    const outcome = applyChecks(checks, {
      iterationId: 'iteration-03',
      files: new Map([['index.tsx', poster]])
    });
    assert.equal(outcome.failure?.code, 'PLACEHOLDER_ADDRESS');
    assert.match(outcome.failure!.message, /^index\.tsx writes "Your street"/);
    const codes = outcome.warnings.map(item => item.code);
    for (const code of ['NO_WORKING_FIELD', 'NO_HEADER', 'DEAD_BUTTON', 'NO_CATALOGUE'])
      assert.ok(codes.includes(code), code);
    // The run record keeps codes and sentences only.
    assert.ok([outcome.failure!, ...outcome.warnings].every(item => !('blocks' in item)));
  });

  it('passes a working first screen, and runs only when the backend sends it', () => {
    assert.deepEqual(
      applyChecks(checks, {
        iterationId: 'iteration-03',
        files: new Map([['index.tsx', working]])
      }),
      { failure: null, warnings: [] }
    );
    assert.equal(
      applyChecks(checks.slice(0, 2), {
        iterationId: 'iteration-03',
        files: new Map([['index.tsx', poster]])
      }).failure,
      null
    );
  });

  it('is described in a line, by the structure’s name', () => {
    const said = describeCheck(checks[2]!, run);
    assert.match(
      said,
      /^A working first screen: a labelled field asking where the person is, a header with the project's name and "Log in", built as List first, with at least 4 restaurants by name and their facts;/
    );
    const sheet = describeCheck(
      {
        kind: 'look-screen',
        screen: {
          ...screen,
          catalogue: null,
          account: false,
          content: { label: 'restaurants', names: ['Mama Lin'], columns: [], known: [] },
          pictures: { stance: 'type', urls: [] }
        }
      },
      run
    );
    assert.match(sheet, /with the sheet's restaurants and no invented ones, with no pictures;/);
    assert.doesNotMatch(sheet, /Log in|built as/);
    // A structure this studio does not know yet is named by its id.
    const later = describeCheck(
      { kind: 'look-screen', screen: { ...screen, skeleton: 'later' as 'hero' } },
      run
    );
    assert.match(later, /built as later/);
  });
});
