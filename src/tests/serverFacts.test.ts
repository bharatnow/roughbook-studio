// A late fact change in the studio (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5): the local routes read the
// words through the backend and find the places in rough/, change them as a spliced copy of each
// pick that the studio then picks, log the change in rough/.facts/changes.json, and undo it newest
// first. The backend is fakeFetch; src/facts is the real one, reading the repo's own TypeScript.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { FactContextReply } from '../api/types.js';
import type { RepoLink } from '../repo/link.js';
import { sendDecision } from '../runs/reviews.js';
import {
  changeFacts,
  changesFile,
  factsLib,
  readFactSheet,
  standingChanges,
  undoFacts,
  type FactsLib,
  type FactsSource,
  type LoggedChange
} from '../server/facts.js';
import { BadRequest } from '../server/studio.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/v1/api/studio/orgs/${ORG}/projects/site`;
const CHANGE = '33333333-3333-4333-8333-333333333333';

const HERO = `export default function Hero() {
  return (
    <section className="hero-only-in-this-repo">
      <h1>Fernside Physio, Northside clinic</h1>
      <p>Open Friday 08:00 to 19:00</p>
    </section>
  );
}
`;

const HOURS = {
  kind: 'set',
  subject: "Northside's Friday hours",
  old: 'Friday 08:00 to 19:00',
  new: 'Friday 08:00 to 18:00'
} as const;
const ADD = {
  kind: 'add',
  collection: 'clinics',
  name: 'Eastgate',
  facts: 'Opens in May'
} as const;
const SUMMARY = 'Northside closes at 18:00 on Fridays';

function context(pick = 'iteration-01'): FactContextReply {
  return {
    pages: [
      {
        slug: 'home',
        name: 'Home',
        kind: 'page',
        sections: [{ component: 'hero', name: 'Hero', iteration: pick, kept: false }]
      }
    ],
    siteMap: { nav: [], links: [] },
    plan: null,
    script: null
  } as FactContextReply;
}

/** A repo with one picked section, and the studio's TypeScript as the repo's own. */
async function repo(): Promise<string> {
  const root = await tempDir('roughbook-facts-');
  const dir = path.join(root, 'rough', 'home', 'hero', 'iteration-01');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.tsx'), HERO);
  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "client-app" }\n');
  const typescript = path.dirname(
    createRequire(import.meta.url).resolve('typescript/package.json')
  );
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(typescript, path.join(root, 'node_modules', 'typescript'), 'junction');
  return root;
}

type Backend = {
  read?: unknown;
  pick?: () => string;
  apply?: (request: RecordedRequest) => ReturnType<typeof ok>;
  copy?: () => ReturnType<typeof ok>;
};

/** The fake backend: it answers each fact route, numbers copies, and remembers the picks. */
function backend(options: Backend = {}) {
  let pick = 'iteration-01';
  let copies = 1;
  const fake = fakeFetch(request => {
    const route = new URL(request.url).pathname.replace(PROJECT, '');
    if (route === '/facts/read') {
      return ok(options.read ?? { summary: SUMMARY, edits: [HOURS], unsure: null });
    }
    if (route === '/facts/apply') {
      return options.apply?.(request) ?? ok({ changes: [{}], scriptVersion: 3, planVersion: 2 });
    }
    if (route === '/facts/context') return ok(context(options.pick?.() ?? pick));
    if (route.endsWith('/iterations/fact-copy')) {
      copies += 1;
      return (
        options.copy?.() ?? ok({ iteration: `iteration-${String(copies).padStart(2, '0')}` }, 201)
      );
    }
    const select = /\/iterations\/(iteration-\d+)\/select$/.exec(route);
    if (select) {
      pick = select[1]!;
      return ok({ selected: true });
    }
    if (route.endsWith('/discard')) return ok({ archived: true });
    return refused('NOT_FOUND', 404);
  });
  return { ...fake, picked: () => pick };
}

function source(root: string, fake: ReturnType<typeof backend>, lib?: Partial<FactsLib>) {
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  const link: RepoLink = {
    version: 1,
    orgId: ORG,
    project: 'site',
    roughCommitted: true,
    appDir: null
  };
  const outbox = outboxFor(root);
  const wrote: string[][] = [];
  const value: FactsSource = {
    api,
    link,
    repoRoot: root,
    lib: {
      ...factsLib(() => ({ recipe: 'next', mode: 'live', family: 'react-like' })),
      ...lib
    },
    // As LocalStudio.decide sends it: the select decision through the outbox.
    select: target => sendDecision(api, outbox, link, target, { kind: 'select' }),
    discard: target => sendDecision(api, outbox, link, target, { kind: 'discard' }),
    wrote: async files => {
      wrote.push(files);
    },
    newId: () => CHANGE,
    now: () => new Date('2026-11-26T10:00:00Z')
  };
  return { source: value, wrote };
}

const routes = (requests: RecordedRequest[]) =>
  requests.map(
    request => `${request.method} ${new URL(request.url).pathname.replace(PROJECT, '')}`
  );

async function log(root: string): Promise<LoggedChange[]> {
  return JSON.parse(fs.readFileSync(changesFile(root), 'utf8')) as LoggedChange[];
}

describe('POST /api/facts/read', () => {
  it('reads the words through the backend and finds the places in rough/', async () => {
    const root = await repo();
    const fake = backend();
    const { source: from } = source(root, fake);
    const sheet = await readFactSheet(from, { words: '  Northside closes at 18:00 on Fridays ' });
    assert.equal(sheet.refusal, null);
    assert.deepEqual(sheet.reading, { summary: SUMMARY, edits: [HOURS], unsure: null });
    assert.equal(sheet.places.length, 1);
    const [place] = sheet.places;
    assert.equal(place!.page, 'home');
    assert.equal(place!.pageName, 'Home');
    assert.equal(place!.section, 'hero');
    assert.match(place!.before, /19:00/);
    assert.match(place!.after, /18:00/);
    assert.equal(place!.sure, true);
    assert.match(place!.id, /\|0$/);
    assert.deepEqual(routes(fake.requests), ['POST /facts/read', 'GET /facts/context']);
    assert.deepEqual(fake.requests[0]!.body, { words: SUMMARY });
  });

  it('shows an add as a page to draw in the studio, and its sets still find their places', async () => {
    const root = await repo();
    const fake = backend({
      read: { summary: 'Eastgate opens', edits: [ADD, HOURS], unsure: null }
    });
    const { source: from } = source(root, fake);
    const sheet = await readFactSheet(from, { words: 'Eastgate opens; Northside 18:00 Fridays' });
    assert.deepEqual(sheet.adds, [
      {
        edit: 0,
        name: 'Eastgate',
        collection: 'clinics',
        page: { name: 'Eastgate', slug: 'eastgate', job: 'The facts get Eastgate.' },
        listings: [],
        nav: { added: false, why: "Draw Eastgate's page in the studio after the change." },
        limits: [],
        refusal: null
      }
    ]);
    // The place's id indexes the sets and renames alone: the set is the first of them.
    assert.match(sheet.places[0]!.id, /\|0$/);
  });

  it('says nothing was read, in the backend words, when there are no edits', async () => {
    const root = await repo();
    const fake = backend({ read: { summary: '', edits: [], unsure: 'Which clinic?' } });
    const sheet = await readFactSheet(source(root, fake).source, { words: 'it closes earlier' });
    assert.equal(sheet.refusal, 'Which clinic?');
    assert.deepEqual(routes(fake.requests), ['POST /facts/read']);
  });

  it('reads on a stack it does not serve, and says so', async () => {
    const root = await repo();
    const fake = backend();
    const { source: from } = source(root, fake, {
      stackWhy: () => "Fact changes aren't there yet for Flutter."
    });
    const sheet = await readFactSheet(from, { words: SUMMARY });
    assert.equal(sheet.refusal, "Fact changes aren't there yet for Flutter.");
    assert.equal(sheet.reading.summary, SUMMARY);
    assert.deepEqual(routes(fake.requests), ['POST /facts/read']);
  });

  it('says why when the repo has no TypeScript', async () => {
    const root = await repo();
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
    const sheet = await readFactSheet(source(root, backend()).source, { words: SUMMARY });
    assert.match(sheet.refusal ?? '', /TypeScript/);
  });

  it('refuses empty words, and passes a backend refusal on in words', async () => {
    const root = await repo();
    await assert.rejects(
      readFactSheet(source(root, backend()).source, { words: '  ' }),
      BadRequest
    );
    const fake = fakeFetch(() => refused('FORBIDDEN', 403, 'Only editors can change facts.'));
    const api = new StudioApi({
      server: 'https://api.example.test',
      token: 'rbi_token',
      userAgent: 'roughbook-studio/test',
      fetch: fake.fetch
    });
    const sheet = await readFactSheet(
      { ...source(root, backend()).source, api },
      { words: SUMMARY }
    );
    assert.match(sheet.refusal ?? '', /editors/);
  });
});

describe('POST /api/facts/change', () => {
  async function read(root: string, fake: ReturnType<typeof backend>) {
    const sheet = await readFactSheet(source(root, fake).source, { words: SUMMARY });
    return sheet.places.map(place => place.id);
  }

  it('applies the facts, splices a copy of the pick, picks it and logs the change', async () => {
    const root = await repo();
    const fake = backend();
    const places = await read(root, fake);
    const { source: from, wrote } = source(root, fake);
    fake.requests.length = 0;
    const done = await changeFacts(from, { summary: SUMMARY, edits: [HOURS], places });
    assert.deepEqual(done, {
      ok: true,
      message: 'Changed 1 place.',
      summary: SUMMARY,
      changeIds: [CHANGE]
    });
    assert.deepEqual(routes(fake.requests), [
      'GET /facts/context',
      'POST /facts/apply',
      'POST /pages/home/components/hero/iterations/fact-copy',
      'POST /pages/home/components/hero/iterations/iteration-02/select'
    ]);
    assert.deepEqual(fake.requests[1]!.body, { edits: [HOURS], summary: SUMMARY });
    assert.deepEqual(fake.requests[2]!.body, {
      parent: 'iteration-01',
      changeId: CHANGE,
      summary: SUMMARY
    });
    assert.equal(fake.picked(), 'iteration-02');

    const copy = path.join(root, 'rough', 'home', 'hero', 'iteration-02', 'index.tsx');
    assert.match(fs.readFileSync(copy, 'utf8'), /Open Friday 08:00 to 18:00/);
    // The pick itself is never written.
    assert.equal(
      fs.readFileSync(
        path.join(root, 'rough', 'home', 'hero', 'iteration-01', 'index.tsx'),
        'utf8'
      ),
      HERO
    );
    assert.deepEqual(wrote, [['rough/home/hero/iteration-02/index.tsx']]);
    assert.deepEqual(await log(root), [
      {
        id: CHANGE,
        summary: SUMMARY,
        at: '2026-11-26T10:00:00.000Z',
        edits: [HOURS],
        factsApplied: true,
        sections: [
          { page: 'home', component: 'hero', previous: 'iteration-01', next: 'iteration-02' }
        ]
      }
    ]);
    assert.deepEqual(await standingChanges({ repoRoot: root }), [
      { id: CHANGE, summary: SUMMARY, at: '2026-11-26T10:00:00.000Z', sections: 1 }
    ]);
  });

  it('stops in words when the backend refuses the facts, changing nothing', async () => {
    const root = await repo();
    const fake = backend({
      apply: () => refused('FACT_NOT_FOUND', 409, 'Nothing in the facts says that.')
    });
    const places = await read(root, fake);
    const done = await changeFacts(source(root, fake).source, {
      summary: SUMMARY,
      edits: [HOURS],
      places
    });
    assert.equal(done.ok, false);
    assert.match(done.message, /Nothing in the facts says that/);
    assert.equal(fs.existsSync(path.join(root, 'rough', 'home', 'hero', 'iteration-02')), false);
    assert.equal(fs.existsSync(changesFile(root)), false);
  });

  it('says a section whose splice fails did not take it, archives the copy and keeps the pick', async () => {
    const root = await repo();
    const fake = backend();
    const places = await read(root, fake);
    const { source: from } = source(root, fake, {
      spliceLocal: async () => ({ ok: false, why: 'The words no longer parse.', leftOver: [] })
    });
    fake.requests.length = 0;
    const done = await changeFacts(from, { summary: SUMMARY, edits: [HOURS], places });
    assert.equal(done.ok, true);
    assert.equal(
      done.message,
      'Hero on Home did not take the change and keeps iteration-01: The words no longer parse.'
    );
    assert.equal(fake.picked(), 'iteration-01');
    assert.ok(
      routes(fake.requests).includes(
        'POST /pages/home/components/hero/iterations/iteration-02/discard'
      )
    );
    assert.deepEqual((await log(root))[0]!.sections, []);
  });

  it('logs an add and tells the designer to draw its page here', async () => {
    const root = await repo();
    const fake = backend();
    const done = await changeFacts(source(root, fake).source, {
      summary: 'Eastgate opens',
      edits: [ADD],
      places: []
    });
    assert.deepEqual(done.message, "Draw Eastgate's page in the studio after the change.");
    assert.deepEqual(routes(fake.requests), ['POST /facts/apply']);
  });

  it('refuses a post the backend would refuse, in words', async () => {
    const root = await repo();
    const from = source(root, backend()).source;
    const bad: Record<string, unknown>[] = [
      {},
      { edits: [] },
      { edits: [{ kind: 'set', old: 'a' }] },
      { edits: Array.from({ length: 13 }, () => HOURS) },
      { edits: [HOURS], places: ['home/hero/index.tsx:1|1'] },
      { edits: [HOURS], places: ['no-edit-index'] }
    ];
    for (const body of bad) await assert.rejects(changeFacts(from, body), BadRequest);
  });
});

describe('POST /api/facts/undo', () => {
  it('picks the earlier iteration again, applies the edits reversed and marks the change undone', async () => {
    const root = await repo();
    const fake = backend();
    const places = (await readFactSheet(source(root, fake).source, { words: SUMMARY })).places.map(
      place => place.id
    );
    const { source: from } = source(root, fake);
    await changeFacts(from, { summary: SUMMARY, edits: [HOURS], places });
    fake.requests.length = 0;

    const done = await undoFacts(from, { changeIds: [CHANGE] });
    assert.deepEqual(done, {
      ok: true,
      message: 'Put back 1 section.',
      summary: SUMMARY,
      changeIds: []
    });
    assert.deepEqual(routes(fake.requests), [
      'GET /facts/context',
      'POST /pages/home/components/hero/iterations/iteration-01/select',
      'POST /facts/apply'
    ]);
    assert.deepEqual(fake.requests[2]!.body, {
      edits: [{ ...HOURS, old: HOURS.new, new: HOURS.old }],
      summary: `Undo: ${SUMMARY}`
    });
    assert.equal(fake.picked(), 'iteration-01');
    assert.equal((await log(root))[0]!.undoneAt, '2026-11-26T10:00:00.000Z');
    assert.deepEqual(await standingChanges({ repoRoot: root }), []);
    // Taken back once: a second undo has nothing to put back.
    assert.equal((await undoFacts(from, { changeIds: [CHANGE] })).ok, false);
  });

  it('leaves a section picked again since, says so, and still puts the facts back', async () => {
    const root = await repo();
    const fake = backend({ pick: () => 'iteration-05' });
    const { source: from } = source(root, fake);
    fs.mkdirSync(path.dirname(changesFile(root)), { recursive: true });
    const logged: LoggedChange[] = [
      {
        id: CHANGE,
        summary: SUMMARY,
        at: '2026-11-26T09:00:00.000Z',
        edits: [HOURS, ADD],
        factsApplied: true,
        sections: [
          { page: 'home', component: 'hero', previous: 'iteration-01', next: 'iteration-02' }
        ]
      }
    ];
    fs.writeFileSync(changesFile(root), JSON.stringify(logged));
    const done = await undoFacts(from, { changeIds: [CHANGE] });
    assert.equal(done.ok, true);
    assert.equal(
      done.message,
      'No section could be put back. Not put back: Hero on Home was picked again since. Eastgate stays in the facts: a new member is not undone.'
    );
    assert.deepEqual(routes(fake.requests), ['GET /facts/context', 'POST /facts/apply']);
  });

  it('takes several back newest first, and refuses ids that are not uuids', async () => {
    const root = await repo();
    const fake = backend();
    const { source: from } = source(root, fake);
    const older = '44444444-4444-4444-8444-444444444444';
    const rename = { kind: 'rename', old: 'Northside', new: 'North Quay' } as const;
    fs.mkdirSync(path.dirname(changesFile(root)), { recursive: true });
    fs.writeFileSync(
      changesFile(root),
      JSON.stringify([
        {
          id: older,
          summary: 'Renamed',
          at: 'a',
          edits: [rename],
          factsApplied: true,
          sections: []
        },
        { id: CHANGE, summary: SUMMARY, at: 'b', edits: [HOURS], factsApplied: true, sections: [] }
      ])
    );
    const done = await undoFacts(from, { changeIds: [older, CHANGE] });
    assert.equal(done.message, 'The facts are put back.');
    const applied = fake.requests.filter(request => request.url.endsWith('/facts/apply'));
    assert.deepEqual(
      applied.map(request => (request.body as { summary: string }).summary),
      [`Undo: ${SUMMARY}`, 'Undo: Renamed']
    );
    assert.deepEqual((applied[1]!.body as { edits: unknown[] }).edits, [
      { kind: 'rename', old: 'North Quay', new: 'Northside' }
    ]);
    await assert.rejects(undoFacts(from, { changeIds: ['nope'] }), BadRequest);
    await assert.rejects(undoFacts(from, {}), BadRequest);
  });
});
