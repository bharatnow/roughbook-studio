// The map's sync (ROUGHBOOK-BROWNFIELD-PLAN.md, B7): a refresh that reads only what changed and
// gives the map a full one would; renames keeping their slug and what hangs on it (a file moved,
// a component renamed in place, both, and a split, which is none); a removal kept gone with its
// work and its baseline a placeholder, and back again; what the sync tells the server for adopted
// pages only; the app's files the watcher reacts to; and a start that outlived an upgrade.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import type { AdoptBody, Adopted } from '../api/types.js';
import { readEnvironment } from '../environment/read.js';
import { BASELINE, writeBaselines } from '../map/adopt.js';
import { parseMap, readMap, renderMap, renderMapHeader } from '../map/file.js';
import { GONE_LINE, gonePointer, movedFiles } from '../map/follow.js';
import { MapSync } from '../map/live.js';
import { codeShape, likeness, matchRenames } from '../map/rename.js';
import { mapRepo } from '../map/run.js';
import { syncAdoption, syncBodies, syncEntries } from '../map/sync.js';
import type { DiscoverMemo, RepoMap } from '../map/types.js';
import { listFiles } from '../map/walk.js';
import { contextSections } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import { stampFiles } from '../recipes/modules/discover.js';
import { buildGraph } from '../recipes/modules/graph.js';
import { staleReason, studioBuild } from '../repo/stale.js';
import { readBase, sha256 } from '../runs/base.js';
import { planTargets } from '../runs/promotion.js';
import { appPath, watchApp } from '../runs/watch.js';
import { assertCarriesNoRepoContent, fakeFetch, ok, tempDir } from './helpers.js';
import { LINK, ORG, read, write } from './homeApp.js';
import { pageSource, sectionFile, sectionSource, syncApp } from './syncApp.js';

const SIZE = { pages: 4, components: 12, perPage: 3 };
const TODAY = '2026-10-27';
const NEXT = recipeFor('next')!;

/** A small generated app, mapped whole, with Home's sections adopted. */
async function adoptedApp() {
  const repo = path.join(await tempDir('roughbook-sync-'), 'app');
  syncApp(repo, SIZE);
  const environment = await readEnvironment(repo, LINK);
  await mapRepo(repo, environment, LINK, { full: true });
  const map = readMap(repo)!.map;
  const home = map.pages.find(page => page.slug === 'home')!;
  writeBaselines(repo, map, NEXT, {
    pages: [
      {
        slug: 'home',
        created: true,
        components: home.sections.map(slug => ({ slug, created: true, baseline: BASELINE }))
      }
    ]
  });
  const refresh = () => mapRepo(repo, environment, LINK, { today: TODAY });
  return { repo, environment, map, refresh };
}

const remove = (repo: string, file: string) => fs.rmSync(path.join(repo, ...file.split('/')));
const component = (map: RepoMap, slug: string) => map.components.find(item => item.slug === slug);
const entryOf = (repo: string, slug: string) =>
  read(repo, `rough/home/${slug}/${BASELINE}/index.tsx`);

describe('the rename measure', () => {
  const body = (name: string) =>
    `import { Card } from "./card";\nexport function ${name}() {\n  return (\n    <section className="faq">\n      <h2>Questions people ask</h2>\n      <p>Can I change plans later? Yes, any time.</p>\n      <p>Is there a free trial? Fourteen days.</p>\n      <Card title="Still stuck?" />\n    </section>\n  );\n}\n`;

  it('sets the imports and the own name aside, and counts what both have', () => {
    const before = codeShape(body('Faq'), 'Faq');
    assert.deepEqual(codeShape(body('Answers').replace('./card', '../ui/card'), 'Answers'), before);
    assert.equal(likeness(before, before), 1);
    assert.equal(likeness([], before), 0);
    assert.ok(!before.some(line => line.length !== 8), 'each line is kept as a short hash');
  });

  it('matches a move, a rename in place and both, and never a split', () => {
    const lost = [
      { id: 'faq', file: 'components/faq.tsx', export: 'Faq', shape: codeShape(body('Faq'), 'Faq') }
    ];
    const shaped = (file: string, name: string, text = body(name)) => ({
      id: `${file}#${name}`,
      file,
      export: name,
      shape: codeShape(text, name)
    });
    const moved = shaped('components/help/faq.tsx', 'Faq');
    const inPlace = shaped('components/faq.tsx', 'Answers');
    const both = shaped('components/help/answers.tsx', 'Answers');
    assert.deepEqual([...matchRenames(lost, [moved])], [['faq', moved.id]]);
    assert.deepEqual([...matchRenames(lost, [inPlace])], [['faq', inPlace.id]]);
    assert.deepEqual([...matchRenames(lost, [both])], [['faq', both.id]]);
    // Each half of a split has too little of the whole.
    const lines = body('Faq').split('\n');
    const first = shaped(
      'components/faq-top.tsx',
      'FaqTop',
      [...lines.slice(0, 6), '    </section>', '  );', '}'].join('\n').replace('Faq', 'FaqTop')
    );
    const second = shaped(
      'components/faq-bottom.tsx',
      'FaqBottom',
      [...lines.slice(0, 4), ...lines.slice(6)].join('\n').replace('Faq', 'FaqBottom')
    );
    assert.deepEqual([...matchRenames(lost, [first, second])], []);
    // One at most: the likest wins.
    assert.deepEqual([...matchRenames(lost, [both, moved])], [['faq', moved.id]]);
  });

  it('measures a component of a file of several by its own statement, never by the file', () => {
    const card = (last: string) => `import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card py-6", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid gap-1.5 px-6", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

${last}

export { Card, CardHeader, CardContent };
`;
    const footer = `function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-6 [.border-t]:pt-6", className)} {...props} />;
}`;
    const action = `function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-action" className={cn("col-start-2 row-span-2 self-start justify-self-end", className)} {...props} />
  );
}`;
    const file = 'components/ui/card.tsx';
    const lost = [
      {
        id: 'card-footer',
        file,
        export: 'CardFooter',
        shape: codeShape(card(footer), 'CardFooter')
      }
    ];
    const fresh = [
      {
        id: `${file}#CardAction`,
        file,
        export: 'CardAction',
        shape: codeShape(card(action), 'CardAction')
      }
    ];
    assert.deepEqual([...matchRenames(lost, fresh)], []);
    // Renamed in place, the same statement still is the same component.
    const renamed = [
      {
        id: `${file}#CardBottom`,
        file,
        export: 'CardBottom',
        shape: codeShape(card(footer.replace('CardFooter', 'CardBottom')), 'CardBottom')
      }
    ];
    assert.deepEqual([...matchRenames(lost, renamed)], [['card-footer', renamed[0]!.id]]);
  });

  it('moves a component file by its place in the list', () => {
    assert.deepEqual(
      [...movedFiles(['a/faq.tsx', 'a/faq.css.ts'], ['b/faq.tsx', 'b/faq.css.ts'])],
      [
        ['a/faq.tsx', 'b/faq.tsx'],
        ['a/faq.css.ts', 'b/faq.css.ts']
      ]
    );
    assert.deepEqual(
      [...movedFiles(['a/faq.tsx', 'a/x.ts'], ['b/faq.tsx'])],
      [['a/faq.tsx', 'b/faq.tsx']]
    );
  });
});

describe("the map's gone mark", () => {
  it('is written as the day and read back; a mark that is no day is refused', async () => {
    const { map } = await adoptedApp();
    const marked: RepoMap = {
      ...map,
      components: map.components.map(item =>
        item.slug === 'section0001' ? { ...item, gone: TODAY } : item
      )
    };
    assert.match(renderMapHeader(marked), /\n {4}gone: 2026-10-27\n/);
    const back = parseMap(renderMap(marked));
    assert.equal(component(back, 'section0001')!.gone, TODAY);
    assert.equal(component(back, 'section0002')!.gone, undefined);
    assert.throws(
      () => parseMap(renderMap(marked).replace('gone: 2026-10-27', 'gone: yesterday')),
      /gone is the day/
    );
  });
});

describe('the incremental refresh', () => {
  it("reads again only the changed file's imports, and gives the full graph", async () => {
    const repo = path.join(await tempDir('roughbook-sync-'), 'app');
    syncApp(repo, SIZE);
    const input = { repo, ignore: [], own: [] };
    const entries = listFiles(input).filter(file => file.startsWith('app/'));
    const memo: DiscoverMemo = { stamps: new Map(), imports: new Map() };
    const first = await buildGraph(repo, entries, {
      memo,
      stamps: stampFiles(repo, listFiles(input))
    });
    assert.equal(first.changed, null);
    write(repo, sectionFile(4), sectionSource(4, '\n      <p>One more line.</p>'));
    write(repo, 'app/page.tsx', pageSource([2, 1, 0]));
    const again = await buildGraph(repo, entries, {
      memo,
      stamps: stampFiles(repo, listFiles(input))
    });
    assert.deepEqual([...again.changed!].sort(), ['app/page.tsx', sectionFile(4)]);
    const whole = await buildGraph(repo, entries);
    assert.deepEqual(
      new Map([...again.inputs].sort(([a], [b]) => a.localeCompare(b))),
      new Map([...whole.inputs].sort(([a], [b]) => a.localeCompare(b)))
    );
  });

  it('reads again a file whose alias import resolved to nothing, once that file appears', async () => {
    const repo = path.join(await tempDir('roughbook-sync-'), 'app');
    syncApp(repo, SIZE);
    write(
      repo,
      'app/late/page.tsx',
      'import Late from "@/components/late";\nexport default function Page() { return <Late />; }\n'
    );
    const input = { repo, ignore: [], own: [] };
    const entries = listFiles(input).filter(file => file.startsWith('app/'));
    const memo: DiscoverMemo = { stamps: new Map(), imports: new Map() };
    await buildGraph(repo, entries, { memo, stamps: stampFiles(repo, listFiles(input)) });
    write(repo, 'components/late.tsx', 'export default function Late() { return <p>Late</p>; }\n');
    const again = await buildGraph(repo, entries, {
      memo,
      stamps: stampFiles(repo, listFiles(input))
    });
    assert.ok(again.inputs.has('components/late.tsx'), [...again.inputs.keys()].join(' '));
  });

  it('writes the map only when it changed, and the map a full one would', async () => {
    const { repo, environment, refresh } = await adoptedApp();
    write(repo, sectionFile(0), sectionSource(0, '\n      <p>Copy edited.</p>'));
    assert.equal((await refresh())!.changed, false);
    // Home's sections reordered, one added, and a new file the page imports.
    write(
      repo,
      'components/s0/logo-wall.tsx',
      'export function LogoWall() {\n  return <ul className="logos">Logos we earned</ul>;\n}\n'
    );
    write(
      repo,
      'app/page.tsx',
      pageSource([2, 0, 1])
        .replace('import', 'import { LogoWall } from "@/components/s0/logo-wall";\nimport')
        .replace('    </main>', '      <LogoWall />\n    </main>')
    );
    const result = (await refresh())!;
    assert.equal(result.changed, true);
    const home = result.map.pages.find(page => page.slug === 'home')!;
    assert.deepEqual(home.sections, ['section0002', 'section0000', 'section0001', 'logo-wall']);
    const incremental = renderMapHeader(result.map);
    await mapRepo(repo, environment, LINK, { full: true, today: TODAY });
    assert.equal(renderMapHeader(readMap(repo)!.map), incremental);
  });
});

describe('renames', () => {
  it('keeps the slug of a moved file, and points its baseline and its forks at the new path', async () => {
    const { repo, refresh } = await adoptedApp();
    const before = sectionFile(1);
    const after = 'components/moved/section-0001.tsx';
    // A fork of the baseline, with its kept base.
    const fork = `rough/home/section0001/iteration-01`;
    write(repo, `${fork}/index.tsx`, 'export { Section0001 as default } from "./section-0001";\n');
    write(repo, `${fork}/section-0001.tsx`, sectionSource(1, '\n      <p>Forked.</p>'));
    write(repo, `${fork}/.base/${before}`, sectionSource(1));
    write(
      repo,
      `${fork}/.base/base.json`,
      `${JSON.stringify({ version: 1, parent: BASELINE, component: 'section0001', commit: null, files: [{ path: before, sha256: sha256(sectionSource(1)), copy: 'section-0001.tsx' }], written: {}, children: [] }, null, 2)}\n`
    );
    write(repo, after, read(repo, before));
    remove(repo, before);
    write(
      repo,
      'app/page.tsx',
      pageSource([0, 1, 2]).replace(
        `@/${before.replace('.tsx', '')}`,
        '@/components/moved/section-0001'
      )
    );
    const result = (await refresh())!;
    assert.deepEqual(
      result.renamed.map(item => [item.now.slug, item.before.files[0], item.now.files[0]]),
      [['section0001', before, after]]
    );
    assert.deepEqual(component(result.map, 'section0001')!.files, [after]);
    assert.equal(result.map.components.filter(item => item.files[0] === after).length, 1);
    assert.match(
      entryOf(repo, 'section0001'),
      /from "\.\.\/\.\.\/\.\.\/\.\.\/components\/moved\/section-0001"/
    );
    const base = readBase(repo, fork)!;
    assert.deepEqual(
      base.files.map(file => file.path),
      [after]
    );
    assert.ok(fs.existsSync(path.join(repo, ...`${fork}/.base/${after}`.split('/'))));
    const environment = await readEnvironment(repo, LINK);
    const planned = planTargets(repo, fork, base, environment);
    assert.deepEqual([planned.how, planned.targets[0]!.path], ['in-place', after]);
    // The switch wraps the new file.
    const sections = contextSections(repo, 'index.tsx');
    assert.deepEqual(sections.find(item => item.component === 'section0001')!.source.files, [
      after
    ]);
  });

  it('points a baseline checked out with Windows line endings at the new path all the same', async () => {
    const { repo, refresh } = await adoptedApp();
    const before = sectionFile(1);
    const after = 'components/moved/section-0001.tsx';
    // As git with core.autocrlf checks rough/ out on Windows.
    const entry = `rough/home/section0001/${BASELINE}/index.tsx`;
    write(repo, entry, read(repo, entry).replace(/\n/g, '\r\n'));
    write(repo, after, read(repo, before));
    remove(repo, before);
    write(
      repo,
      'app/page.tsx',
      pageSource([0, 1, 2]).replace(
        `@/${before.replace('.tsx', '')}`,
        '@/components/moved/section-0001'
      )
    );
    const result = (await refresh())!;
    assert.deepEqual(
      result.renamed.map(item => item.now.slug),
      ['section0001']
    );
    assert.match(
      entryOf(repo, 'section0001'),
      /from "\.\.\/\.\.\/\.\.\/\.\.\/components\/moved\/section-0001"/
    );
  });

  it('keeps the slug of a component renamed in place, and of one moved and renamed', async () => {
    const { repo, refresh } = await adoptedApp();
    const renamed = sectionSource(2).replaceAll('Section0002', 'IntroBlock');
    write(repo, sectionFile(2), renamed);
    write(repo, 'app/page.tsx', pageSource([0, 1, 2]).replaceAll('Section0002', 'IntroBlock'));
    let result = (await refresh())!;
    assert.deepEqual(
      result.renamed.map(item => [item.now.slug, item.now.export]),
      [['section0002', 'IntroBlock']]
    );
    assert.match(entryOf(repo, 'section0002'), /export \{ IntroBlock as default \}/);
    assert.equal(component(result.map, 'section0002')!.name, 'Section0002', 'its name stays');

    const moved = 'components/intro/opening.tsx';
    write(repo, moved, renamed.replaceAll('IntroBlock', 'Opening'));
    remove(repo, sectionFile(2));
    write(
      repo,
      'app/page.tsx',
      pageSource([0, 1, 2])
        .replaceAll('Section0002', 'Opening')
        .replace(`@/${sectionFile(2).replace('.tsx', '')}`, '@/components/intro/opening')
    );
    result = (await refresh())!;
    assert.deepEqual(
      result.renamed.map(item => [item.now.slug, item.now.files[0], item.now.export]),
      [['section0002', moved, 'Opening']]
    );
    assert.deepEqual(result.map.pages.find(page => page.slug === 'home')!.sections, [
      'section0000',
      'section0001',
      'section0002'
    ]);
  });

  it('takes a split for a removal and two new sections', async () => {
    const { repo, refresh } = await adoptedApp();
    const lines = Array.from(
      { length: 8 },
      (_, at) => `      <p>Line ${at} of the long section, with words enough.</p>`
    );
    const whole = (name: string, body: string[]) =>
      `export function ${name}() {\n  return (\n    <section>\n${body.join('\n')}\n    </section>\n  );\n}\n`;
    write(repo, sectionFile(0), whole('Section0000', lines));
    write(repo, 'app/page.tsx', pageSource([0, 1, 2]));
    await refresh();
    write(repo, 'components/split/top.tsx', whole('SplitTop', lines.slice(0, 4)));
    write(repo, 'components/split/bottom.tsx', whole('SplitBottom', lines.slice(4)));
    remove(repo, sectionFile(0));
    write(
      repo,
      'app/page.tsx',
      pageSource([1, 2])
        .replace(
          'import',
          'import { SplitTop } from "@/components/split/top";\nimport { SplitBottom } from "@/components/split/bottom";\nimport'
        )
        .replace('<main>', '<main>\n      <SplitTop />\n      <SplitBottom />')
    );
    const result = (await refresh())!;
    assert.deepEqual(result.renamed, []);
    assert.deepEqual(
      result.went.map(item => item.slug),
      ['section0000']
    );
    assert.deepEqual(result.map.pages.find(page => page.slug === 'home')!.sections, [
      'split-top',
      'split-bottom',
      'section0001',
      'section0002'
    ]);
  });
});

describe('a component gone from the app', () => {
  it('is kept with its day and its work, its baseline a placeholder, and comes back', async () => {
    const { repo, refresh } = await adoptedApp();
    const pointer = entryOf(repo, 'section0001');
    write(
      repo,
      'rough/home/section0001/iteration-01/index.tsx',
      'export default function Fork() {\n  return <p>A fork of it</p>;\n}\n'
    );
    const file = read(repo, sectionFile(1));
    remove(repo, sectionFile(1));
    write(repo, 'app/page.tsx', pageSource([0, 2]));
    const result = (await refresh())!;
    assert.deepEqual(
      result.went.map(item => item.slug),
      ['section0001']
    );
    assert.equal(component(result.map, 'section0001')!.gone, TODAY);
    assert.deepEqual(result.map.pages.find(page => page.slug === 'home')!.sections, [
      'section0000',
      'section0002'
    ]);
    assert.equal(
      entryOf(repo, 'section0001'),
      gonePointer(NEXT, 'index.tsx', `home/section0001/${BASELINE}`)
    );
    assert.ok(entryOf(repo, 'section0001').includes(GONE_LINE));
    assert.ok(
      fs.existsSync(path.join(repo, 'rough', 'home', 'section0001', 'iteration-01', 'index.tsx'))
    );
    assert.ok(!contextSections(repo, 'index.tsx').some(item => item.component === 'section0001'));
    // A component gone with no work on it leaves the map.
    remove(repo, sectionFile(7));
    write(repo, 'app/p2/page.tsx', pageSource([6, 8]));
    const quiet = (await refresh())!;
    assert.equal(component(quiet.map, 'section0007'), undefined);
    assert.equal(component(quiet.map, 'section0001')!.gone, TODAY, 'the day stays');
    // Back: the mark goes, and the pointer returns.
    write(repo, sectionFile(1), file);
    write(repo, 'app/page.tsx', pageSource([0, 1, 2]));
    const back = (await refresh())!;
    assert.deepEqual(
      back.returned.map(item => item.slug),
      ['section0001']
    );
    assert.equal(component(back.map, 'section0001')!.gone, undefined);
    assert.equal(entryOf(repo, 'section0001'), pointer);
  });
});

describe('what the sync sends', () => {
  const routes = (repo: string) => {
    const fake = fakeFetch(request => {
      const body = request.body as { pages: { slug: string; components: { slug: string }[] }[] };
      return ok({
        pages: body.pages.map(page => ({
          slug: page.slug,
          created: false,
          components: page.components.map(item => ({
            slug: item.slug,
            created: true,
            baseline: BASELINE
          }))
        }))
      } satisfies Adopted);
    });
    const api = new StudioApi({
      server: 'http://localhost:4000',
      token: 'rbi_token',
      userAgent: 'test',
      fetch: fake.fetch
    });
    void repo;
    return { api, requests: fake.requests };
  };

  it("sends an adopted page's order, its new section and its gone, and nothing of other pages", async () => {
    const { repo, refresh } = await adoptedApp();
    const { api, requests } = routes(repo);
    remove(repo, sectionFile(1));
    write(
      repo,
      'components/s0/logo-wall.tsx',
      'export function LogoWall() {\n  return <ul className="logos">Logos we earned</ul>;\n}\n'
    );
    write(
      repo,
      'app/page.tsx',
      pageSource([2, 0])
        .replace('import', 'import { LogoWall } from "@/components/s0/logo-wall";\nimport')
        .replace('    </main>', '      <LogoWall />\n    </main>')
    );
    // A page nothing of which is adopted changes too.
    write(repo, 'app/p1/page.tsx', pageSource([5, 4, 3]));
    const result = (await refresh())!;
    const outcome = (await syncAdoption(
      repo,
      api,
      { orgId: ORG, project: 'site' },
      NEXT,
      result,
      'index.tsx'
    ))!;
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]!.url,
      `http://localhost:4000/v1/api/studio/orgs/${ORG}/projects/site/adopt`
    );
    assert.deepEqual(requests[0]!.body, {
      pages: [
        {
          slug: 'home',
          name: 'Home',
          components: [{ slug: 'logo-wall', name: 'Logo wall', kind: 'section' }],
          sections: ['section0002', 'section0000', 'logo-wall'],
          gone: ['section0001']
        }
      ]
    });
    assert.deepEqual(outcome.baselines.written, ['home/logo-wall']);
    assert.ok(fs.existsSync(path.join(repo, 'rough', 'home', 'logo-wall', BASELINE, 'index.tsx')));
    assertCarriesNoRepoContent(requests, { repo, root: path.dirname(repo), minimumLines: 10 });
    // Nothing changed since: nothing sent.
    assert.equal(
      await syncAdoption(
        repo,
        api,
        { orgId: ORG, project: 'site' },
        NEXT,
        { previous: result.map, map: result.map },
        'index.tsx'
      ),
      null
    );
  });

  it('adopts a new section on the next sync when the one that found it failed', async () => {
    const { repo, refresh } = await adoptedApp();
    write(
      repo,
      'components/s0/logo-wall.tsx',
      'export function LogoWall() {\n  return <ul className="logos">Logos we earned</ul>;\n}\n'
    );
    write(
      repo,
      'app/page.tsx',
      pageSource([0, 1, 2])
        .replace('import', 'import { LogoWall } from "@/components/s0/logo-wall";\nimport')
        .replace('    </main>', '      <LogoWall />\n    </main>')
    );
    const result = (await refresh())!;
    const offline = new StudioApi({
      server: 'http://localhost:4000',
      token: 't',
      userAgent: 'test',
      fetch: fakeFetch(() => 'offline').fetch
    });
    const link = { orgId: ORG, project: 'site' };
    assert.ok((await syncAdoption(repo, offline, link, NEXT, result, 'index.tsx'))!.failed);
    // The next sync, with nothing changed since the map's last write.
    const { api, requests } = routes(repo);
    const again = (await syncAdoption(
      repo,
      api,
      link,
      NEXT,
      { previous: result.map, map: result.map },
      'index.tsx'
    ))!;
    assert.deepEqual((requests[0]!.body as AdoptBody).pages[0]!.components, [
      { slug: 'logo-wall', name: 'Logo wall', kind: 'section' }
    ]);
    assert.deepEqual(again.baselines.written, ['home/logo-wall']);
    // Sent: nothing again.
    assert.equal(
      await syncAdoption(
        repo,
        api,
        link,
        NEXT,
        { previous: result.map, map: result.map },
        'index.tsx'
      ),
      null
    );
  });

  it('adopts a section back in the app again, to clear its mark, and sends a failed sync again', async () => {
    const { repo, map } = await adoptedApp();
    const gone: RepoMap = {
      ...map,
      pages: map.pages.map(page =>
        page.slug === 'home' ? { ...page, sections: ['section0000', 'section0002'] } : page
      ),
      components: map.components.map(item =>
        item.slug === 'section0001' ? { ...item, gone: TODAY } : item
      )
    };
    const keys = new Set(['home/section0000', 'home/section0001', 'home/section0002']);
    assert.deepEqual(syncEntries(gone, map, keys), [
      {
        slug: 'home',
        name: 'Home',
        components: [{ slug: 'section0001', name: 'Section0001', kind: 'section' }],
        sections: ['section0000', 'section0001', 'section0002']
      }
    ]);
    // Only part of a page adopted: its order and gone go, a new section does not join.
    const partly = new Set(['home/section0000']);
    const grown: RepoMap = {
      ...map,
      pages: map.pages.map(page =>
        page.slug === 'home' ? { ...page, sections: ['section0003', ...page.sections] } : page
      )
    };
    assert.deepEqual(syncEntries(map, grown, partly)[0]!.components, []);
    assert.deepEqual(syncEntries(map, map, keys), []);
    assert.equal(syncEntries(map, map, keys, new Set(['home'])).length, 1);
    // Offline: kept, and sent with the next.
    const offline = new StudioApi({
      server: 'http://localhost:4000',
      token: 't',
      userAgent: 'test',
      fetch: fakeFetch(() => 'offline').fetch
    });
    const failed = (await syncAdoption(
      repo,
      offline,
      { orgId: ORG, project: 'site' },
      NEXT,
      { previous: map, map: gone },
      'index.tsx'
    ))!;
    assert.ok(failed.failed);
    const { api, requests } = routes(repo);
    await syncAdoption(
      repo,
      api,
      { orgId: ORG, project: 'site' },
      NEXT,
      { previous: gone, map: gone },
      'index.tsx'
    );
    assert.deepEqual((requests[0]!.body as { pages: { gone?: string[] }[] }).pages[0]!.gone, [
      'section0001'
    ]);
  });

  it('splits a page past the batch, each part with its order and gone', () => {
    const entry = {
      slug: 'home',
      name: 'Home',
      components: [1, 2, 3].map(at => ({
        slug: `s${at}`,
        name: `S${at}`,
        kind: 'section' as const
      })),
      sections: ['s1', 's2', 's3'],
      gone: ['old']
    };
    const bodies = syncBodies([entry], 2);
    assert.deepEqual(
      bodies.map(body => body.pages.map(page => [page.components.length, page.gone])),
      [[[2, ['old']]], [[1, ['old']]]]
    );
  });
});

describe("start's sync", () => {
  it('refreshes from a change and syncs, and leaves a repo with no map alone', async () => {
    const { repo, environment } = await adoptedApp();
    const fake = fakeFetch(() => ok({ pages: [] }));
    const api = new StudioApi({
      server: 'http://localhost:4000',
      token: 't',
      userAgent: 'test',
      fetch: fake.fetch
    });
    const lines: string[] = [];
    const sync = new MapSync({
      repoRoot: repo,
      environment,
      link: LINK,
      api,
      out: line => lines.push(line),
      err: line => lines.push(line),
      quietMs: 10
    });
    write(repo, 'app/page.tsx', pageSource([1, 0, 2]));
    const done = await sync.refresh();
    assert.equal(done!.result.changed, true);
    assert.equal(fake.requests.length, 1);
    assert.ok(
      lines.some(line => line.startsWith('rough/map.md refreshed:')),
      lines.join('\n')
    );
    assert.ok(
      lines.some(line => line === '  Home: its order sent.'),
      lines.join('\n')
    );

    const bare = path.join(await tempDir('roughbook-sync-'), 'app');
    syncApp(bare, SIZE);
    const none = new MapSync({
      repoRoot: bare,
      environment,
      link: LINK,
      api,
      out: () => {},
      err: () => {}
    });
    assert.equal(await none.refresh(), null);
    assert.ok(!fs.existsSync(path.join(bare, 'rough', 'map.md')));
    // A stale start writes nothing.
    const stale = new MapSync({
      repoRoot: repo,
      environment,
      link: LINK,
      api,
      out: () => {},
      err: () => {},
      stale: () => 'the studio was updated'
    });
    write(repo, 'app/page.tsx', pageSource([2, 1, 0]));
    assert.equal(await stale.refresh(), null);
  });

  it('reacts to the source files of the app only', () => {
    const ignore = ['dist', '.next'];
    const sources = ['.tsx', '.ts'];
    assert.equal(appPath('components\\hero.tsx', ignore, sources), 'components/hero.tsx');
    assert.equal(appPath('tsconfig.json', ignore, sources), 'tsconfig.json');
    for (const file of [
      'rough/home/hero/iteration-01/index.tsx',
      'node_modules/x/index.ts',
      'dist/a.ts',
      '.next/server.ts',
      '.git/HEAD',
      'public/logo.png'
    ]) {
      assert.equal(appPath(file, ignore, sources), null, file);
    }
  });

  for (const os of ['linux', 'windows'] as const) {
    it(`watches the app's source files, never rough/ or its dependencies (${os})`, async () => {
      const repo = path.join(await tempDir('roughbook-sync-'), 'app');
      syncApp(repo, { pages: 2, components: 4, perPage: 2 });
      write(repo, 'node_modules/pkg/index.js', 'module.exports = 1;\n');
      const watched: string[] = [];
      const changes: string[] = [];
      const stop = watchApp(
        repo,
        file => changes.push(file),
        { ignore: ['node_modules'], sources: ['.tsx', '.ts'] },
        {
          os,
          watch: (dir, options, listener) => {
            watched.push(path.relative(repo, dir).split(path.sep).join('/') || '.');
            return fs.watch(dir, options, listener);
          }
        }
      );
      try {
        if (os === 'linux') {
          assert.deepEqual(watched.sort(), ['.', 'app', 'app/p1', 'components', 'components/s0']);
        } else assert.deepEqual(watched, ['.']);
        write(repo, 'components/new/logo-wall.tsx', 'export const LogoWall = 1;\n');
        write(repo, sectionFile(1), sectionSource(1, '\n      <p>Edited.</p>'));
        write(repo, 'node_modules/pkg/index.ts', 'export default 2;\n');
        write(repo, 'rough/home/x/iteration-01/index.tsx', 'export default 3;\n');
        for (let tries = 0; tries < 200 && changes.length < 2; tries++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual([...new Set(changes)].sort(), [
          'components/new/logo-wall.tsx',
          sectionFile(1)
        ]);
      } finally {
        stop();
      }
    });
  }

  it('knows a start that outlived an upgrade', async () => {
    const started = { build: '0.3.16:1', recipeVersion: 2 };
    assert.equal(staleReason(started, started, 2), null);
    assert.equal(
      staleReason(started, { ...started, build: '0.3.16:2' }, 2),
      'the studio was updated'
    );
    assert.match(staleReason(started, { ...started, recipeVersion: 3 }, 2)!, /version 3/);
    // This studio's own setup --upgrade is no reason.
    assert.equal(staleReason({ ...started, recipeVersion: 1 }, started, 2), null);
    const dir = await tempDir();
    write(dir, 'package.json', '{ "version": "0.3.16" }\n');
    write(dir, 'self.js', '\n');
    const files = { pkg: path.join(dir, 'package.json'), self: path.join(dir, 'self.js') };
    const first = studioBuild(files);
    fs.utimesSync(files.self, new Date(), new Date(Date.now() + 5000));
    assert.notEqual(studioBuild(files), first);
    assert.match(studioBuild()!, /^0\.3\.16:/);
  });
});
