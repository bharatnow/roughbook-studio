// A page's composition promoted into the app (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decisions 12, 50,
// 51 and 53): the start sends slugs alone, the app's own order as `current`, finds drift against
// the composition's `.base/`, refuses a new section's file that would overwrite one, snapshots the
// page's files and the new sections', and fills in the paths; the finish is B4's, with an existing
// section's changed file out of scope; once done the map is refreshed and the new section adopted
// with its baseline, under the slug the backend gave it. On a branch, only the promote's files are
// committed, on the designer's yes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { AdoptBody, PagePromotion } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { finishPromotionHere, placeNewSections } from '../commands/finishPromotion.js';
import { preparePagePromotion } from '../compositions/promote.js';
import { writeComposition } from '../compositions/store.js';
import { readMap } from '../map/file.js';
import { commitPromotion, describePromotion, readPromotion } from '../runs/promotion.js';
import { readSnapshot } from '../runs/snapshot.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
  ok,
  recordingIo,
  refused,
  type RecordedRequest
} from './helpers.js';
import { HOME_SOURCE, LINK, ORG, SERVER, TREE, homeApp, read, studio, write } from './homeApp.js';

const PROMOTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROJECT = `/v1/api/studio/orgs/${ORG}/projects/site`;

/** The backend's page promote prompt, with B6's stand-ins. */
const PROMPT: PagePromotion = {
  promotionId: PROMOTION,
  prompt:
    '<target>\nThe page’s files:\n{{roughbook:page-files}}\n</target>\n<new-sections>\n{{roughbook:new-sections}}\n</new-sections>\n<merge>{{roughbook:base}}</merge>\n',
  placeholders: {
    targetFile: '{{roughbook:target-file}}',
    targetDir: '{{roughbook:target-dir}}',
    publicDir: '{{roughbook:public-dir}}',
    pageFiles: '{{roughbook:page-files}}',
    newSections: '{{roughbook:new-sections}}',
    base: '{{roughbook:base}}'
  },
  compositionName: 'Proof first',
  newSections: [
    {
      component: 'customer-logos',
      name: 'Customer logos',
      iteration: 'iteration-01',
      copyMarkdown: null
    }
  ],
  assets: [],
  missingAssets: []
};

const TREE_WITH_SECTION = {
  ...TREE,
  pages: [
    {
      slug: 'home',
      name: 'Home',
      inApp: true,
      components: [
        { slug: 'customer-logos', name: 'Customer logos', selectedIteration: null, iterations: [] }
      ]
    }
  ]
};

const COMPOSITION = {
  name: 'Proof first',
  parent: null,
  sections: [
    { component: 'hero', iteration: 'iteration-00' },
    { component: 'customer-logos', iteration: 'iteration-01' },
    { component: 'testimonials', iteration: 'iteration-00' },
    { component: 'features', iteration: 'iteration-02' }
  ]
};

/** What the agent writes: the page reordered with the new section, and the section's file. */
const ARRANGED = `import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Testimonials } from "@/components/testimonials";
import { Logos } from "@/components/CustomerLogos";

export default function Home() {
  return (
    <main className="home-page-layout">
      <Hero />
      <Logos />
      <Testimonials />
      <Features />
    </main>
  );
}
`;
const LOGOS = `export function Logos() {
  return <ul className="logo-wall">Logos we earned</ul>;
}
`;

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

/** Home with composition-01 saved, committed, and a fake backend for the promote. */
async function composed() {
  const repo = await homeApp();
  write(repo, 'rough/home/features/iteration-02/index.tsx', 'export default function F() {}\n');
  const map = readMap(repo)!.map;
  await writeComposition(
    repo,
    map.pages.find(item => item.slug === 'home')!,
    'composition-01',
    COMPOSITION,
    null
  );
  write(repo, '.gitignore', '/rough/.roughbook/\n/rough/.screenshots/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'start');
  const fake = fakeFetch((request: RecordedRequest) => {
    const url = new URL(request.url).pathname;
    if (request.method === 'POST' && url === `${PROJECT}/promotions`) return ok(PROMPT, 201);
    if (request.method === 'POST' && url.endsWith('/finish')) return ok({});
    if (request.method === 'GET' && url === PROJECT) return ok(TREE_WITH_SECTION);
    if (request.method === 'POST' && url === `${PROJECT}/adopt`) {
      const body = request.body as AdoptBody;
      return ok({
        pages: body.pages.map(page => ({
          slug: page.slug,
          created: false,
          components: page.components.map(c => ({
            slug: c.slug,
            created: false,
            baseline: 'iteration-00'
          }))
        }))
      });
    }
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'test',
    fetch: fake.fetch
  });
  const context = {
    repoRoot: repo,
    env: {},
    io: recordingIo(),
    askPreview: async () => null
  } as unknown as CommandContext;
  return { repo, api, requests: fake.requests, context };
}

describe("a page composition's promote", () => {
  it('sends slugs alone, and fills in the page’s files, the new section and the base', async () => {
    const { repo, api, requests } = await composed();
    const prepared = await preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01'
    });
    assert.equal(prepared.how, 'in-place');
    assert.deepEqual(requests.at(-1)!.body, {
      page: 'home',
      composition: 'composition-01',
      current: ['hero', 'features', 'testimonials'],
      how: 'in-place',
      family: 'react-like',
      assets: []
    });
    assert.deepEqual(
      prepared.targets.map(target => [target.path, target.section?.component ?? null]),
      [
        ['app/page.tsx', null],
        ['components/CustomerLogos.tsx', 'customer-logos']
      ]
    );
    // Features on another iteration than its baseline keeps the app's own version (decision 50).
    assert.deepEqual(prepared.keepsApp, [
      { component: 'features', iteration: 'iteration-02', name: 'features' }
    ]);
    const prompt = read(repo, prepared.promptFile);
    assert.equal(prepared.promptFile, `rough/home/compositions/prompts/promote-${PROMOTION}.md`);
    assert.match(prompt, /The page’s files:\napp\/page\.tsx\n<\/target>/);
    assert.match(
      prompt,
      /<new-sections>\ncomponents\/CustomerLogos\.tsx ← rough\/home\/customer-logos\/iteration-01\n<\/new-sections>/
    );
    assert.match(prompt, /<merge>rough\/home\/compositions\/composition-01\/\.base\/<\/merge>/);
    assert.match(prompt, new RegExp(`Roughbook promotion: ${PROMOTION}`));
    const record = (await readPromotion(repo, PROMOTION))!;
    assert.equal(record.subject, 'page');
    assert.equal(
      `${record.page}/${record.component}/${record.iteration}`,
      'home/compositions/composition-01'
    );
    // Snapshotted with copies, so revert puts the page back whatever the agent does.
    const snapshot = (await readSnapshot(repo, PROMOTION))!;
    assert.ok(snapshot.files['app/page.tsx']);
    assertCarriesNoRepoContent(requests, { repo, root: path.dirname(repo), minimumLines: 10 });
  });

  it('is a merge when the page changed since the composition was saved', async () => {
    const { repo, api } = await composed();
    write(repo, 'app/page.tsx', HOME_SOURCE.replace('home-page-layout', 'home-page-wide'));
    const prepared = await preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01'
    });
    assert.equal(prepared.how, 'merge');
    assert.equal(prepared.targets[0]!.drifted, true);
    // Line endings alone are no drift (decision 39).
    const again = await composed();
    write(again.repo, 'app/page.tsx', HOME_SOURCE.replace(/\n/g, '\r\n'));
    const same = await preparePagePromotion(again.repo, again.api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01'
    });
    assert.equal(same.how, 'in-place');
  });

  it('refuses, asking nothing, a new section’s file that exists or a composition not here', async () => {
    const { repo, api, requests } = await composed();
    write(repo, 'components/CustomerLogos.tsx', 'export const taken = 1;\n');
    await assert.rejects(
      preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
        page: 'home',
        composition: 'composition-01'
      }),
      /components\/CustomerLogos\.tsx, where Customer logos would be written, already exists/
    );
    await assert.rejects(
      preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
        page: 'home',
        composition: 'composition-04'
      }),
      /rough\/home\/compositions\/composition-04 is not in this repo/
    );
    assert.equal(requests.length, 0);
  });

  it('finishes as B4 does: an existing section’s file out of scope; done adopts the new one', async () => {
    const { repo, api, context } = await composed();
    await preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01'
    });
    write(repo, 'app/page.tsx', ARRANGED);
    write(repo, 'components/CustomerLogos.tsx', LOGOS);
    write(repo, 'components/hero.tsx', 'export function Hero() { return null; }\n');
    const outbox = outboxFor(repo);
    const { record } = await finishPromotionHere(context, api, outbox, LINK, PROMOTION, {
      devUrl: 'http://localhost:3000',
      refresh: true
    });
    assert.equal(record.result!.outcome, 'out-of-scope');
    assert.deepEqual(record.result!.outOfScope, ['components/hero.tsx']);
    assert.deepEqual(
      record.result!.changed.filter(item => item.inScope).map(item => [item.path, item.status]),
      [
        ['app/page.tsx', 'changed'],
        ['components/CustomerLogos.tsx', 'added']
      ]
    );
    assert.match(
      describePromotion(record).join('\n'),
      /home\/compositions\/composition-01: arranged in place, 2 files changed\.[\s\S]*roughbook revert home\/compositions\/composition-01 components\/hero\.tsx/
    );

    // Put back by its folder's key, as the finish says.
    const cli = await studio(repo, {});
    assert.equal(
      await cli.run(['revert', 'home/compositions/composition-01', 'components/hero.tsx']),
      0,
      cli.io.errors.join('\n')
    );
    assert.match(read(repo, 'components/hero.tsx'), /Hero of the app/);
    assert.equal(
      await cli.run(['promote', 'home', '--composition', 'composition-01', '--to', 'x.tsx']),
      1
    );
    assert.match(cli.io.errors.at(-1)!, /takes no --iteration or --to/);

    // Done this time: the map refreshed, the new section adopted under the backend's slug.
    const clean = await composed();
    await preparePagePromotion(clean.repo, clean.api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01'
    });
    write(clean.repo, 'app/page.tsx', ARRANGED);
    write(clean.repo, 'components/CustomerLogos.tsx', LOGOS);
    const done = await finishPromotionHere(
      clean.context,
      clean.api,
      outboxFor(clean.repo),
      LINK,
      PROMOTION,
      { devUrl: 'http://localhost:3000', refresh: true }
    );
    assert.equal(done.record.result!.outcome, 'done');
    const finish = clean.requests.find(request => request.url.endsWith('/finish'))!;
    assert.deepEqual(finish.body, {
      outcome: 'done',
      build: 'skipped',
      checks: 'skipped',
      branch: false
    });
    const adopt = clean.requests.find(request => request.url.endsWith('/adopt'))!;
    assert.deepEqual(adopt.body, {
      pages: [
        {
          slug: 'home',
          name: 'Home',
          components: [{ slug: 'customer-logos', name: 'Customer logos', kind: 'section' }]
        }
      ]
    });
    const map = readMap(clean.repo)!.map;
    assert.deepEqual(map.pages.find(item => item.slug === 'home')!.sections, [
      'hero',
      'customer-logos',
      'testimonials',
      'features'
    ]);
    assert.equal(
      map.components.find(item => item.slug === 'customer-logos')!.name,
      'Customer logos'
    );
    assert.match(
      read(clean.repo, 'rough/home/customer-logos/iteration-00/index.tsx'),
      /components\/CustomerLogos/
    );
    assert.ok(
      done.refreshed.some(line =>
        line.startsWith('Baselines written: rough/home/customer-logos/iteration-00')
      ),
      done.refreshed.join('\n')
    );
    assertCarriesNoRepoContent(clean.requests, {
      repo: clean.repo,
      root: path.dirname(clean.repo),
      minimumLines: 10
    });
  });

  it('keeps the new section’s slug as the file’s, when the agent named its export otherwise', () => {
    const map = readMapLike();
    const placed = placeNewSections(map, {
      page: 'home',
      targets: [
        {
          path: 'components/CustomerLogos.tsx',
          copy: null,
          child: false,
          drifted: false,
          section: {
            component: 'customer-logos',
            iteration: 'iteration-01',
            name: 'Customer logos'
          }
        }
      ]
    });
    assert.deepEqual(placed.found, ['customer-logos']);
    assert.deepEqual(placed.map.pages[0]!.sections, ['hero', 'customer-logos']);
    assert.equal(placed.map.components[1]!.slug, 'customer-logos');
  });

  it('commits only the promote’s files on its branch, on the designer’s yes', async () => {
    const { repo, api } = await composed();
    const prepared = await preparePagePromotion(repo, api, LINK, TREE_WITH_SECTION, {
      page: 'home',
      composition: 'composition-01',
      branch: true
    });
    assert.equal(prepared.branch!.name, 'roughbook/home-composition-01');
    write(repo, 'app/page.tsx', ARRANGED);
    write(repo, 'components/CustomerLogos.tsx', LOGOS);
    const context = {
      repoRoot: repo,
      env: {},
      io: recordingIo(),
      askPreview: async () => null
    } as unknown as CommandContext;
    await finishPromotionHere(context, api, outboxFor(repo), LINK, PROMOTION, {
      devUrl: 'http://localhost:3000',
      refresh: false
    });
    const committed = await commitPromotion(repo, PROMOTION);
    assert.equal(committed.commit!.state, 'committed');
    assert.deepEqual(git(repo, 'show', '--name-only', '--format=%s', 'HEAD').split('\n'), [
      "Promote the home page's composition-01 from Roughbook",
      '',
      'app/page.tsx',
      'components/CustomerLogos.tsx'
    ]);
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'roughbook/home-composition-01');
    assert.ok(fs.existsSync(path.join(repo, 'components/CustomerLogos.tsx')));
  });
});

function readMapLike() {
  return {
    version: 1 as const,
    by: ['next'],
    pages: [
      {
        slug: 'home',
        name: 'Home',
        address: '/',
        example: '/',
        signIn: 'no' as const,
        files: ['app/page.tsx'],
        sections: ['hero', 'logos'],
        byAgent: false
      }
    ],
    components: [
      {
        slug: 'hero',
        name: 'Hero',
        kind: 'section' as const,
        files: ['components/hero.tsx'],
        export: 'Hero',
        fixture: null,
        alone: 'yes' as const,
        why: null,
        byAgent: false
      },
      {
        slug: 'logos',
        name: 'Logos',
        kind: 'section' as const,
        files: ['components/CustomerLogos.tsx'],
        export: 'Logos',
        fixture: null,
        alone: 'unknown' as const,
        why: null,
        byAgent: false
      }
    ],
    missed: [],
    unplaced: []
  };
}
