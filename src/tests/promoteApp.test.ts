// Updating the app (ROUGHBOOK-BROWNFIELD-PLAN.md, B4, decisions 10, 18 and 35 to 39): a promote of
// a fork from the app writes back into the component's own files and each child's, in place or as
// a merge when the app changed since the fork (line endings set aside); its targets are
// snapshotted, so revert puts them back; on a branch the change is committed only on the
// designer's yes, only the promote's files, never pushed; the finish names files outside its
// scope, runs the build and checks, reports codes alone, and refreshes the baseline.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { Promotion, ProjectTree } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { finishPromotionHere, refreshedBaselines } from '../commands/finishPromotion.js';
import { branchArgument } from '../commands/promote.js';
import { defaultEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, RepoMap } from '../map/types.js';
import type { PictureShot } from '../pictures/share.js';
import { recipeFor } from '../recipes/index.js';
import { approveCommands } from '../repo/approvals.js';
import { lineDiff, unifiedText } from '../repo/diff.js';
import type { RepoLink } from '../repo/link.js';
import { headCommit, inLineEndingsOf, planAppSlot, readBase, writeAppSlot } from '../runs/base.js';
import { preparePromotion } from '../runs/promote.js';
import {
  commitPromotion,
  declinePromotionCommit,
  describePromotion,
  finishPromotion,
  promotionDiff,
  putBackPromoted,
  readPromotion,
  type CommandRunner
} from '../runs/promotion.js';
import type { Shots } from '../screenshot/iteration.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import {
  fakeFetch,
  notFound,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROMOTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: null
};
const FOLDER = 'rough/pricing/pricing-section/iteration-01';
const SECTION = 'components/pricing/pricing-section.tsx';
const CARD = 'components/pricing/plan-card.tsx';
const BRANCH = 'roughbook/pricing-pricing-section-iteration-01';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

function component(slug: string, files: string[], extra: Partial<MapComponent> = {}): MapComponent {
  return {
    slug,
    name: slug,
    kind: 'section',
    files,
    export: 'default',
    fixture: null,
    alone: 'yes',
    why: null,
    byAgent: false,
    ...extra
  };
}

const SECTION_SOURCE = `import { plans } from "@/lib/plans";
import { PlanCard } from "./plan-card";

export function PricingSection() {
  return (
    <section>
      {plans.map((plan) => (
        <PlanCard key={plan.name} plan={plan} />
      ))}
    </section>
  );
}
`;
const CARD_SOURCE = `export function PlanCard({ plan }: { plan: { name: string; price: string } }) {
  return <div className="card"><h3>{plan.name}</h3><p>{plan.price}</p></div>;
}
`;

const TREE: ProjectTree = {
  slug: 'site',
  name: 'Site',
  delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
  pictures: true,
  pages: [
    {
      slug: 'pricing',
      name: 'Pricing',
      inApp: true,
      components: [
        {
          slug: 'pricing-section',
          name: 'PricingSection',
          inApp: true,
          selectedIteration: 1,
          iterations: [
            {
              id: 'iteration-00',
              number: 0,
              name: 'In the app',
              status: 'draft',
              parent: null,
              direction: '',
              generation: { mode: 'local' },
              origin: 'app'
            }
          ]
        },
        {
          slug: 'logo-wall',
          name: 'Logo wall',
          inApp: false,
          selectedIteration: 1,
          iterations: []
        }
      ]
    }
  ]
} as unknown as ProjectTree;

/** The backend's promote prompt for the app's own files, with B4's stand-ins. */
function promotion(how: string): Promotion {
  return {
    promotionId: PROMOTION,
    prompt: `<task>\nPromote (${how}) into:\n{{roughbook:promote-files}}\nBase: {{roughbook:base}}\nMain file: {{roughbook:target-file}}\n</task>\n`,
    placeholders: {
      targetFile: '{{roughbook:target-file}}',
      targetDir: '{{roughbook:target-dir}}',
      publicDir: '{{roughbook:public-dir}}'
    },
    copyMarkdown: null,
    componentName: 'PricingSection',
    defaults: { componentsDir: 'components', publicDir: 'public' },
    assets: [],
    missingAssets: []
  };
}

/**
 * A Next.js app in git with its pricing section adopted and forked, the fork committed with its
 * `.base/`: the agent's copy tightens the section and rewrites all of its plan card, which it
 * copied in without a word. A fake backend answers the promote and its finish.
 */
async function forked(options: { git?: boolean } = {}) {
  const repo = path.join(await tempDir('roughbook-promote-app-'), 'app');
  fs.mkdirSync(repo, { recursive: true });
  write(repo, 'package.json', '{}');
  write(
    repo,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx', paths: { '@/*': ['./*'] } } })
  );
  write(repo, SECTION, SECTION_SOURCE);
  write(repo, CARD, CARD_SOURCE);
  write(repo, 'lib/plans.ts', 'export const plans = [{ name: "Free", price: "$0" }];\n');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  write(repo, '.gitignore', '/rough/.roughbook/\n/rough/.screenshots/\n');
  const section = component('pricing-section', [SECTION], {
    name: 'PricingSection',
    export: 'PricingSection'
  });
  const map: RepoMap = {
    version: 1,
    by: ['next'],
    pages: [
      {
        slug: 'pricing',
        name: 'Pricing',
        address: '/pricing',
        example: null,
        signIn: 'no',
        files: ['app/pricing/page.tsx'],
        sections: ['pricing-section', 'plan-card'],
        byAgent: false
      }
    ],
    components: [
      section,
      component('plan-card', [CARD], { name: 'PlanCard', export: 'PlanCard', kind: 'atom' })
    ],
    missed: [],
    unplaced: []
  };
  writeMap(repo, map);
  const recipe = recipeFor('next')!;
  const baseline = 'rough/pricing/pricing-section/iteration-00';
  for (const [file, text] of Object.entries(
    recipe.pointer!(section, { iterationDir: baseline, fixture: null })!
  )) {
    write(repo, `${baseline}/${file}`, text);
  }
  if (options.git !== false) {
    git(repo, 'init', '--quiet', '--initial-branch=main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'start');
  }
  const slot = planAppSlot(repo, recipe, recipe.environment(LINK), {
    page: 'pricing',
    component: 'pricing-section',
    iteration: 'iteration-01'
  });
  writeAppSlot(repo, FOLDER, slot, { parent: 'iteration-00', commit: await headCommit(repo) });
  // The agent's fork.
  const copy = `${FOLDER}/pricing-section.tsx`;
  write(
    repo,
    copy,
    read(repo, copy)
      .replace('<section>', '<section className="tight">')
      .replace(/"[./]+components\/pricing\/plan-card"/, '"./plan-card"')
  );
  write(
    repo,
    `${FOLDER}/plan-card.tsx`,
    'export function PlanCard({ plan }: { plan: { name: string; price: string } }) {\n  return <article className="card compact">{plan.name} {plan.price}</article>;\n}\n'
  );
  if (options.git !== false) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'fork');
  }

  let how = 'in-place';
  const fake = fakeFetch((request: RecordedRequest) => {
    const url = new URL(request.url).pathname.replace('/v1/api/studio', '');
    if (request.method === 'POST' && url.endsWith('/promotions')) {
      how = (request.body as { how: string }).how;
      return ok(promotion(how), 201);
    }
    if (url.endsWith(`/promotions/${PROMOTION}/finish`)) return ok({ recorded: true });
    if (request.method === 'GET' && url.endsWith('/projects/site')) return ok(TREE);
    if (request.method === 'PUT' && url.includes('/pictures/')) {
      return ok({ kind: url.split('/').at(-1), width: 640, height: 400, updatedAt: '' });
    }
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: 'http://localhost:4000',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  const promote = (
    extra: { branch?: string | true; targetFile?: string; component?: string } = {}
  ) =>
    preparePromotion(repo, api, LINK, TREE, {
      page: 'pricing',
      component: 'pricing-section',
      iteration: 'iteration-01',
      ...extra
    });
  return {
    repo,
    api,
    fetch: fake.fetch,
    requests: fake.requests,
    outbox: outboxFor(repo),
    promote
  };
}

/** What the agent writes back: each target from its copy, as the prompt pairs them. */
function writeBack(repo: string) {
  write(repo, SECTION, read(repo, `${FOLDER}/pricing-section.tsx`));
  write(repo, CARD, read(repo, `${FOLDER}/plan-card.tsx`));
}

/** The environment with nothing to run, unless the test gives its build and checks. */
function environment(extra: Partial<RepoEnvironment> = {}): RepoEnvironment {
  return {
    ...defaultEnvironment(LINK),
    build: { command: null, output: [] },
    checks: [],
    ...extra
  };
}

describe('the start of a promote from the app', () => {
  it('targets the original files and each child, found again by name, and fills the stand-ins', async () => {
    const { repo, requests, promote } = await forked();
    // The fork's finish never recorded the plan card: the promote looks again (decision 39).
    assert.deepEqual(readBase(repo, FOLDER)!.children, []);
    const prepared = await promote();
    assert.equal(prepared.how, 'in-place');
    assert.deepEqual(
      prepared.targets.map(target => [target.path, target.copy, target.child, target.drifted]),
      [
        [SECTION, 'pricing-section.tsx', false, false],
        [CARD, 'plan-card.tsx', true, false]
      ]
    );
    assert.deepEqual(
      readBase(repo, FOLDER)!.children.map(child => child.path),
      [CARD]
    );
    const prompt = read(repo, prepared.promptFile);
    assert.match(
      prompt,
      new RegExp(
        `into:\\n${SECTION} ← ${FOLDER}/pricing-section\\.tsx\\n${CARD} ← ${FOLDER}/plan-card\\.tsx\\nBase: ${FOLDER}/\\.base/\\nMain file: ${SECTION}\\n`
      )
    );
    assert.ok(!prompt.includes('{{roughbook:'));
    assert.match(prompt, new RegExp(`<finishing>\\nRoughbook promotion: ${PROMOTION}\\n`));
    // The server hears how, never where.
    const asked = requests.find(request => request.url.endsWith('/promotions'))!;
    assert.deepEqual(asked.body, {
      page: 'pricing',
      component: 'pricing-section',
      iteration: 'iteration-01',
      assets: [],
      family: 'react-like',
      how: 'in-place'
    });
    const record = (await readPromotion(repo, PROMOTION))!;
    assert.equal(record.status, 'started');
    assert.equal(record.branch, null);
    // --to still makes it a new file.
    const elsewhere = await forked();
    const fresh = await elsewhere.promote({ targetFile: 'components/pricing/new-section.tsx' });
    assert.equal(fresh.how, 'new');
    assert.deepEqual(
      fresh.targets.map(target => target.path),
      ['components/pricing/new-section.tsx']
    );
  });

  it('is a merge when an original changed since the fork, with line endings set aside', async () => {
    const { repo, promote } = await forked();
    // A checkout that turns the line endings over is no change (decision 39).
    write(repo, SECTION, SECTION_SOURCE.replace(/\n/g, '\r\n'));
    write(repo, CARD, CARD_SOURCE.replace(/\n/g, '\r\n'));
    assert.equal((await promote()).how, 'in-place');

    const later = await forked();
    // A teammate's hotfix on the plan card, after the fork.
    write(later.repo, CARD, CARD_SOURCE.replace('<h3>', '<h3 className="name">'));
    const prepared = await later.promote();
    assert.equal(prepared.how, 'merge');
    assert.deepEqual(
      prepared.targets.filter(target => target.drifted).map(target => target.path),
      [CARD]
    );
    const asked = later.requests.find(request => request.url.endsWith('/promotions'))!;
    assert.equal((asked.body as { how: string }).how, 'merge');
  });

  it('is refused in words when an original is gone from the app', async () => {
    const { repo, promote, requests } = await forked();
    fs.rmSync(path.join(repo, ...CARD.split('/')));
    // The plan card is found again first, then missed.
    await assert.rejects(promote(), /plan-card\.tsx is no longer in the app/);
    assert.ok(!requests.some(request => request.url.endsWith('/promotions')));
  });
});

describe('a new component of a page the map has', () => {
  it('goes beside the page’s own sections, named like them, unless --to names a file', async () => {
    const NEW = 'rough/pricing/logo-wall/iteration-01/index.tsx';
    const STUB = 'export default () => null;\n';
    const { repo, requests, promote } = await forked();
    write(repo, NEW, STUB);
    const prepared = await promote({ component: 'logo-wall' });
    assert.equal(prepared.how, 'new');
    // Decision 56: the pricing section's folder and kebab-case, not the components folder.
    assert.equal(prepared.targetFile, 'components/pricing/logo-wall.tsx');
    assert.equal(
      (requests.find(request => request.url.endsWith('/promotions'))!.body as { how: string }).how,
      'new'
    );

    const named = await forked();
    write(named.repo, NEW, STUB);
    const elsewhere = await named.promote({ component: 'logo-wall', targetFile: 'ui/Logos.tsx' });
    assert.equal(elsewhere.targetFile, 'ui/Logos.tsx');

    // A file already there stops the start, naming it, before anything is asked.
    const taken = await forked();
    write(taken.repo, NEW, STUB);
    write(taken.repo, 'components/pricing/logo-wall.tsx', STUB);
    await assert.rejects(
      taken.promote({ component: 'logo-wall' }),
      /^Error: components\/pricing\/logo-wall\.tsx already exists\. Choose another file with --to;/
    );
    assert.equal(taken.requests.length, 0);
  });
});

describe('the snapshot and revert', () => {
  it('puts the targets back after an in-place promote, and keeps the app file’s line endings', async () => {
    const { repo, api, outbox, promote } = await forked();
    await promote();
    writeBack(repo);
    // The agent wrote Windows line endings into a file the app keeps with Unix ones.
    write(repo, CARD, read(repo, CARD).replace(/\n/g, '\r\n'));
    const finished = await finishPromotion(repo, api, outbox, environment(), PROMOTION);
    assert.equal(finished.result!.outcome, 'done');
    assert.deepEqual(finished.result!.lineEndings, [CARD]);
    assert.ok(!read(repo, CARD).includes('\r\n'));
    assert.deepEqual(
      finished.result!.changed.map(item => [item.path, item.status, item.inScope]),
      [
        [CARD, 'changed', true],
        [SECTION, 'changed', true]
      ]
    );
    // The diff, against the snapshot.
    const diffs = await promotionDiff(repo, finished);
    const section = diffs.find(diff => diff.path === SECTION)!;
    assert.match(
      unifiedText(section.path, section.hunks!),
      /- {4}<section>\n\+ {4}<section className="tight">/
    );

    assert.equal(await putBackPromoted(repo, finished, SECTION), 'restored');
    assert.equal(await putBackPromoted(repo, finished, CARD), 'restored');
    assert.equal(read(repo, SECTION), SECTION_SOURCE);
    assert.equal(read(repo, CARD), CARD_SOURCE);
    assert.deepEqual((await readPromotion(repo, PROMOTION))!.putBack, [CARD, SECTION]);
  });
});

describe('a promote on a branch', () => {
  it('starts the branch at the current commit, and commits only its files on a yes, never pushing', async () => {
    const { repo, api, outbox, promote } = await forked();
    const start = git(repo, 'rev-parse', 'HEAD');
    const prepared = await promote({ branch: true });
    assert.deepEqual(prepared.branch, { name: BRANCH, from: 'main', commit: start });
    assert.equal(git(repo, 'symbolic-ref', '--short', 'HEAD'), BRANCH);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), start);

    writeBack(repo);
    // And an unrelated change of the designer's, which the commit leaves alone.
    write(repo, 'README.md', 'notes\n');
    const finished = await finishPromotion(repo, api, outbox, environment(), PROMOTION);
    assert.equal(finished.commit!.state, 'pending');
    assert.deepEqual(finished.commit!.files, [CARD, SECTION]);
    const committed = await commitPromotion(repo, PROMOTION);
    assert.equal(committed.commit!.state, 'committed');
    assert.equal(git(repo, 'rev-list', '--count', `${start}..${BRANCH}`), '1');
    assert.deepEqual(
      git(repo, 'show', '--name-only', '--format=%s', BRANCH).split('\n').filter(Boolean),
      ['Promote pricing/pricing-section/iteration-01 from Roughbook', CARD, SECTION]
    );
    // The branch it started from is as it was; nothing has a remote to go to.
    assert.equal(git(repo, 'rev-parse', 'main'), start);
    assert.equal(git(repo, 'remote'), '');
    assert.match(git(repo, 'status', '--porcelain'), /\?\? README\.md/);
    // Revert still puts the files back once HEAD has moved past them.
    assert.equal(await putBackPromoted(repo, committed, SECTION), 'restored');
    assert.equal(read(repo, SECTION), SECTION_SOURCE);
  });

  it('leaves the change uncommitted on a no', async () => {
    const { repo, api, outbox, promote } = await forked();
    const start = git(repo, 'rev-parse', 'HEAD');
    await promote({ branch: 'design/tighter-pricing' });
    writeBack(repo);
    await finishPromotion(repo, api, outbox, environment(), PROMOTION);
    const declined = await declinePromotionCommit(repo, PROMOTION);
    assert.equal(declined.commit!.state, 'declined');
    assert.equal(git(repo, 'symbolic-ref', '--short', 'HEAD'), 'design/tighter-pricing');
    assert.equal(git(repo, 'rev-parse', 'HEAD'), start);
    assert.match(git(repo, 'status', '--porcelain'), /M components\/pricing\/plan-card\.tsx/);
  });

  it('is refused when the repo is not git or a target has uncommitted changes', async () => {
    const plain = await forked({ git: false });
    await assert.rejects(plain.promote({ branch: true }), /not a git repository/);
    assert.ok(!plain.requests.some(request => request.url.endsWith('/promotions')));

    const dirty = await forked();
    write(dirty.repo, CARD, `${CARD_SOURCE}// wip\n`);
    await assert.rejects(dirty.promote({ branch: true }), /plan-card\.tsx has uncommitted changes/);
    assert.equal(git(dirty.repo, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.ok(!dirty.requests.some(request => request.url.endsWith('/promotions')));
    // A name git does not take, or one already taken.
    git(dirty.repo, 'checkout', '--', CARD);
    await assert.rejects(dirty.promote({ branch: 'bad..name' }), /not a name git takes/);
    await assert.rejects(dirty.promote({ branch: 'main' }), /A branch main already exists/);
  });

  it('reads --branch with and without a name', () => {
    assert.deepEqual(branchArgument(['pricing/pricing-section', '--branch']), {
      branch: true,
      rest: ['pricing/pricing-section']
    });
    assert.deepEqual(branchArgument(['pricing/pricing-section', '--branch', 'design/x']), {
      branch: 'design/x',
      rest: ['pricing/pricing-section']
    });
    assert.deepEqual(branchArgument(['--branch', 'pricing/pricing-section']), {
      branch: true,
      rest: ['pricing/pricing-section']
    });
    assert.deepEqual(branchArgument(['--branch=design/x', 'a/b', '--to', 'x.tsx']), {
      branch: 'design/x',
      rest: ['a/b', '--to', 'x.tsx']
    });
    assert.deepEqual(branchArgument(['a/b']), { rest: ['a/b'] });
  });
});

describe('the finish', () => {
  it('names a file outside the targets and offers it back', async () => {
    const { repo, api, outbox, promote } = await forked();
    await promote();
    writeBack(repo);
    write(repo, 'lib/plans.ts', 'export const plans = [];\n');
    const finished = await finishPromotion(repo, api, outbox, environment(), PROMOTION);
    assert.equal(finished.result!.outcome, 'out-of-scope');
    assert.deepEqual(finished.result!.outOfScope, ['lib/plans.ts']);
    assert.ok(
      describePromotion(finished).includes(
        '    roughbook revert pricing/pricing-section/iteration-01 lib/plans.ts'
      )
    );
    assert.equal(await putBackPromoted(repo, finished, 'lib/plans.ts'), 'restored');
  });

  it('runs the build and the checks, and says how they went with the failing lines', async () => {
    const { repo, api, outbox, promote, requests } = await forked();
    await promote();
    writeBack(repo);
    const env = environment({
      build: { command: 'npm run build', output: ['.next'] },
      checks: ['npx tsc --noEmit', 'npm test', 'npm run lint']
    });
    // The lint is not approved on this machine, so it is skipped.
    await approveCommands(repo, [
      { command: 'npm run build', shell: env.shell },
      { command: 'npx tsc --noEmit', shell: env.shell },
      { command: 'npm test', shell: env.shell }
    ]);
    const ran: string[] = [];
    const run: CommandRunner = async (command, cwd, timeoutMs) => {
      ran.push(`${command} ${cwd === repo} ${timeoutMs}`);
      if (command === 'npm test') {
        return { code: 1, output: `${'ok\n'.repeat(30)}✖ plan card shows its price\nfail 1\n` };
      }
      return { code: 0, output: 'done\n' };
    };
    const finished = await finishPromotion(repo, api, outbox, env, PROMOTION, { run });
    assert.deepEqual(ran, [
      'npm run build true 600000',
      'npx tsc --noEmit true 600000',
      'npm test true 600000'
    ]);
    const result = finished.result!;
    assert.equal(result.buildResult, 'passed');
    assert.equal(result.checksResult, 'failed');
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(
      result.checks.map(check => [check.command, check.result]),
      [
        ['npx tsc --noEmit', 'passed'],
        ['npm test', 'failed'],
        ['npm run lint', 'skipped']
      ]
    );
    assert.equal(result.checks[1]!.tail.length, 20);
    assert.deepEqual(result.checks[1]!.tail.slice(-2), ['✖ plan card shows its price', 'fail 1']);
    const words = describePromotion(finished).join('\n');
    assert.match(words, /Check \(npm test\): failed, exit 1/);
    assert.match(words, /Check \(npm run lint\): skipped, not approved on this machine/);
    assert.match(words, /Last lines of npm test:\n(?: {4}.*\n)*? {4}fail 1/);

    // The finish carries the fields of promotion.finished alone: no path, no code.
    const finish = requests.find(request => request.url.endsWith('/finish'))!;
    assert.match(
      finish.url,
      new RegExp(`/orgs/${ORG}/projects/site/promotions/${PROMOTION}/finish$`)
    );
    // `how` the backend has from the start; it refuses any field but these.
    assert.deepEqual(finish.body, {
      outcome: 'failed',
      build: 'passed',
      checks: 'failed',
      branch: false
    });
    const sent = JSON.stringify(requests.map(request => request.body));
    for (const secret of ['components/', '.base', 'plan-card', 'PlanCard', 'rough/', 'npm ']) {
      assert.ok(!sent.includes(secret), `${secret} reached the server: ${sent}`);
    }
  });

  it('writes nothing for a merge that conflicts, and says where from the agent’s report', async () => {
    const { repo, api, outbox, promote, requests } = await forked();
    write(repo, CARD, CARD_SOURCE.replace('<p>{plan.price}</p>', '<p>{plan.price} a month</p>'));
    git(repo, 'commit', '--quiet', '-am', 'hotfix');
    const prepared = await promote();
    assert.equal(prepared.how, 'merge');
    // The agent wrote the section anyway before it gave up.
    writeBack(repo);
    const finished = await finishPromotion(repo, api, outbox, environment(), PROMOTION, {
      conflicts: [
        'components/pricing/plan-card.tsx, line 2: the app added "a month" where the iteration rewrote the card'
      ]
    });
    assert.equal(finished.result!.outcome, 'conflict');
    assert.deepEqual(finished.result!.putBackOnConflict, [CARD, SECTION]);
    assert.equal(read(repo, SECTION), SECTION_SOURCE);
    assert.match(read(repo, CARD), /a month/);
    assert.equal(finished.result!.buildResult, 'skipped');
    assert.match(
      describePromotion(finished).join('\n'),
      /Conflict: components\/pricing\/plan-card\.tsx, line 2/
    );
    const finish = requests.find(request => request.url.endsWith('/finish'))!;
    assert.deepEqual(finish.body, {
      outcome: 'conflict',
      build: 'skipped',
      checks: 'skipped',
      branch: false
    });
    // A merge that wrote nothing is a conflict too, its places in the agent's report.
    const quiet = await forked();
    write(quiet.repo, CARD, `${CARD_SOURCE}// hotfix\n`);
    await quiet.promote();
    const nothing = await finishPromotion(
      quiet.repo,
      quiet.api,
      quiet.outbox,
      environment(),
      PROMOTION
    );
    assert.equal(nothing.result!.outcome, 'conflict');
    assert.deepEqual(nothing.result!.conflicts, []);
  });

  it('refreshes the baseline and the page that shows it', async () => {
    const { repo, api, outbox, promote } = await forked();
    write(
      repo,
      'rough/pricing/plan-card/iteration-00/index.tsx',
      'export { PlanCard as default } from "@/components/pricing/plan-card";\n'
    );
    await promote();
    writeBack(repo);
    const shots: string[] = [];
    const pictured: string[] = [];
    const takePicture: PictureShot = async ({ url, size }) => {
      pictured.push(`${new URL(url).pathname} ${size.width}`);
      return Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.from(url)]);
    };
    const context = {
      repoRoot: repo,
      env: {},
      takePicture,
      screenshot: async (
        _repo: string,
        _url: string,
        target: { page: string; component: string; iteration: string },
        ...rest: unknown[]
      ): Promise<Shots> => {
        shots.push(
          `${target.page}/${target.component}/${target.iteration} force=${(rest[5] as { force?: boolean })?.force}`
        );
        return { files: { desktop: `rough/.screenshots/${target.component}.png` }, warning: null };
      }
    } as unknown as CommandContext;
    assert.deepEqual(
      refreshedBaselines(repo, (await readPromotion(repo, PROMOTION))!).targets.map(
        target => target.component
      ),
      ['pricing-section', 'plan-card']
    );
    const { record, refreshed } = await finishPromotionHere(context, api, outbox, LINK, PROMOTION, {
      devUrl: 'http://localhost:3000',
      refresh: true,
      environment: environment()
    });
    assert.equal(record.result!.outcome, 'done');
    assert.deepEqual(shots, [
      'pricing/pricing-section/iteration-00 force=true',
      'pricing/plan-card/iteration-00 force=true'
    ]);
    // The baseline's pictures, then the adopted page's, at its address on the app.
    assert.ok(
      pictured.some(item => item.startsWith('/rough-preview/pricing/pricing-section/iteration-00')),
      pictured.join('\n')
    );
    assert.ok(
      pictured.some(item => item.startsWith('/pricing ')),
      pictured.join('\n')
    );
    assert.ok(
      refreshed.some(line =>
        /pricing\/pricing-section\/iteration-00: screenshots taken again/.test(line)
      )
    );
  });
});

describe('the diff', () => {
  it('shows the lines a change takes out and puts in, with context', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
    const after = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n';
    const hunks = lineDiff(before, after);
    assert.equal(hunks.length, 2);
    assert.equal(
      unifiedText('x.txt', hunks),
      '--- x.txt\n+++ x.txt\n@@ -1,5 +1,5 @@\n a\n-b\n+B\n c\n d\n e\n@@ -8,3 +8,4 @@\n h\n i\n j\n+k'
    );
    assert.deepEqual(lineDiff('a\r\nb\r\n', 'a\nb\n'), []);
    assert.equal(inLineEndingsOf('x\ny\n', 'a\r\nb\r\n'), 'x\r\ny\r\n');
    assert.equal(inLineEndingsOf('x\r\ny\r\n', 'a\nb\n'), 'x\ny\n');
    assert.equal(inLineEndingsOf('x', 'a\r\n'), 'x');
  });
});

describe("the local UI's promote panel", () => {
  it('knows the drift and the branch before, then finishes, shows the diff and commits on Yes', async () => {
    const { repo, api, fetch: backend, requests } = await forked();
    const token = 'local-token-for-the-promote-tests';
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise(resolve => probe.close(resolve));
    const configDir = path.join(repo, '..', 'config');
    const context: CommandContext & { repoRoot: string } = {
      io: recordingIo(),
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      repoRoot: repo,
      configDir,
      home: configDir,
      fetch: backend,
      sleep: async () => {},
      openUrl: async () => true,
      platform: 'win32',
      detect: async adapter => notFound(adapter),
      launchTerminal: async () => {},
      launchEditor: async () => {},
      copyText: async () => true,
      runHeadless: async () => ({
        ok: true,
        exitCode: 0,
        cancelled: false,
        error: null,
        usage: null
      }),
      screenshot: async () => ({ files: {}, warning: null }),
      askPreview: async () => null,
      runCommand: async () => ({ ok: false, stdout: '', stderr: 'not run', code: null }),
      waitForStop: async () => {},
      stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
    };
    const studio = new LocalStudio({
      context,
      api,
      link: LINK,
      devUrl: 'http://localhost:3100',
      port,
      pty: { ok: false, reason: 'not in tests' }
    });
    const server = createLocalServer({
      studio,
      port,
      token,
      uiDir: null,
      devUrl: 'http://localhost:3100',
      project: 'site'
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const call = async (method: 'GET' | 'POST', pathname: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          origin: `http://127.0.0.1:${port}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: response.status, json: (await response.json()) as any };
    };
    try {
      const at = '/api/promote/pricing/pricing-section/iteration-01';
      const plan = (await call('GET', at)).json.data;
      assert.equal(plan.defaultFile, SECTION);
      // A new section of the page: its file beside the page's own sections (decision 56).
      const fresh = (await call('GET', '/api/promote/pricing/logo-wall/iteration-01')).json.data;
      assert.equal(fresh.defaultFile, 'components/pricing/logo-wall.tsx');
      assert.deepEqual(plan.drift, { state: 'in-place' });
      assert.deepEqual(plan.branchChoice, { defaultName: BRANCH, unavailable: null });
      assert.equal(plan.finish, null);

      // The panel's field holds the original's path: that is in place, not a new file.
      const started = await call('POST', '/api/promote', {
        page: 'pricing',
        component: 'pricing-section',
        iteration: 'iteration-01',
        targetFile: SECTION,
        branch: BRANCH
      });
      assert.equal(started.status, 200, JSON.stringify(started.json));
      assert.equal(started.json.data.ok, true);
      assert.equal(git(repo, 'symbolic-ref', '--short', 'HEAD'), BRANCH);
      assert.equal(
        (requests.find(request => request.url.endsWith('/promotions'))!.body as { how: string })
          .how,
        'in-place'
      );
      assert.equal((await call('GET', at)).json.data.open, true);

      writeBack(repo);
      write(repo, 'lib/plans.ts', 'export const plans = [];\n');
      const finish = (await call('POST', `${at}/finish`, {})).json.data;
      assert.equal(finish.outcome, 'out-of-scope');
      assert.deepEqual(
        finish.files.map((file: { path: string; status: string }) => [file.path, file.status]),
        [
          [CARD, 'modified'],
          [SECTION, 'modified'],
          ['lib/plans.ts', 'modified']
        ]
      );
      assert.match(
        finish.files[1].patch,
        /^--- components\/pricing\/pricing-section\.tsx\n\+\+\+ .*\n@@ /
      );
      assert.deepEqual(finish.outOfScope, [{ path: 'lib/plans.ts' }]);
      assert.equal(finish.branch, BRANCH);
      assert.equal(finish.commit, null);
      assert.deepEqual(
        finish.checks.map((check: { name: string; result: string }) => [check.name, check.result]),
        [['Build', 'skipped']]
      );

      assert.equal((await call('POST', `${at}/revert`, { path: 'lib/plans.ts' })).status, 200);
      const committed = (await call('POST', `${at}/commit`, { commit: true })).json.data;
      assert.equal(committed.ok, true, committed.message);
      assert.match(committed.commit, /^[0-9a-f]{40}$/);
      assert.deepEqual(git(repo, 'show', '--name-only', '--format=', BRANCH).split('\n'), [
        CARD,
        SECTION
      ]);
      const after = (await call('GET', at)).json.data.finish;
      assert.deepEqual(after.outOfScope, [{ path: 'lib/plans.ts', reverted: true }]);
      assert.equal(after.commit.commit, committed.commit);
    } finally {
      studio.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
