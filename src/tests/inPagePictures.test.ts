// The pictures of an iteration in its page (ROUGHBOOK-BROWNFIELD-PLAN.md, B5, decision 43): an
// adopted component's iteration, where its recipe has the in-page view, is pictured at its page
// with the swap, full length at desktop and phone, and uploaded as page-desktop and page-phone
// beside its pictures alone, through the outbox and under the project's pictures setting. They are
// retaken when the app's page or component changes, as a baseline's are.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { Outbox } from '../api/outbox.js';
import type { ProjectTree } from '../api/types.js';
import { writeMap } from '../map/file.js';
import type { RepoMap } from '../map/types.js';
import { inPageTarget, picturesAfterShots, type PictureShot } from '../pictures/share.js';
import { recipeFor } from '../recipes/index.js';
import { fakeFetch, ok, tempDir, type RecordedRequest } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const DEV = 'http://localhost:3000';
const LINK = {
  version: 1 as const,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};
const environment = recipeFor('next')!.environment(LINK);

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

const MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [
    {
      slug: 'home',
      name: 'Home',
      address: '/',
      example: null,
      signIn: 'no',
      files: ['app/page.tsx'],
      sections: ['hero'],
      byAgent: false
    }
  ],
  components: [
    {
      slug: 'hero',
      name: 'Hero',
      kind: 'section',
      files: ['components/home/hero.tsx'],
      export: 'default',
      fixture: null,
      alone: 'unknown',
      why: null,
      byAgent: false
    }
  ],
  missed: [],
  unplaced: []
};

const origin = (id: string) => (id === 'iteration-00' ? 'app' : 'local');

function tree(pictures: boolean): ProjectTree {
  return {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'components', publicDir: 'public', devUrl: DEV },
    pictures,
    pages: [
      {
        slug: 'home',
        name: 'Home',
        inApp: true,
        components: [
          {
            slug: 'hero',
            name: 'Hero',
            inApp: true,
            selectedIteration: null,
            iterations: ['iteration-00', 'iteration-01'].map(id => ({
              id,
              number: Number(id.slice(-2)),
              name: id,
              status: 'draft',
              parent: null,
              direction: '',
              generation: { mode: 'local' },
              origin: origin(id)
            }))
          }
        ]
      }
    ]
  } as ProjectTree;
}

async function setup(pictures = true) {
  const repo = await tempDir('roughbook-in-page-');
  writeMap(repo, MAP);
  write(repo, 'app/page.tsx', 'export default function Home() {}\n');
  write(repo, 'components/home/hero.tsx', 'export default function Hero() {}\n');
  write(repo, 'rough/home/hero/iteration-00/index.tsx', 'export { default } from "x";\n');
  write(repo, 'rough/home/hero/iteration-01/index.tsx', 'export default function Fork() {}\n');
  const fake = fakeFetch((request: RecordedRequest) =>
    request.method === 'GET'
      ? ok(tree(pictures))
      : ok({ kind: 'thumbnail', width: 640, height: 400, updatedAt: '2026-10-26T00:00:00Z' })
  );
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
  const shots: { url: string; width: number; full: boolean }[] = [];
  const takePicture: PictureShot = async input => {
    shots.push({ url: input.url, width: input.size.width, full: input.full });
    return Buffer.concat([
      Buffer.from('RIFF\0\0\0\0WEBPVP8 '),
      Buffer.from(`${input.url} ${input.size.width} ${shots.length}`)
    ]);
  };
  const run = (iteration: string) =>
    picturesAfterShots(
      { takePicture, env: {} },
      { repoRoot: repo, api, outbox, link: { orgId: ORG, project: 'site' }, environment },
      { page: 'home', component: 'hero', iteration },
      `${DEV}/rough-preview/home/hero/${iteration}`,
      { files: { desktop: 'x.png' }, warning: null }
    );
  const puts = () =>
    fake.requests
      .filter(request => request.method === 'PUT')
      .map(request => new URL(request.url).pathname.split('/pictures/')[1]);
  return { repo, shots, run, puts };
}

describe('an iteration’s pictures in its page', () => {
  it('are taken at its page with the swap, full length at desktop and phone, and go up as page-desktop and page-phone', async () => {
    const { shots, run, puts } = await setup();
    const line = await run('iteration-01');
    const inPage = shots.filter(shot => shot.url.includes('roughbook-swap'));
    assert.deepEqual(inPage, [
      { url: `${DEV}/?roughbook-swap=home/hero/iteration-01`, width: 1440, full: true },
      { url: `${DEV}/?roughbook-swap=home/hero/iteration-01`, width: 390, full: true }
    ]);
    assert.deepEqual(puts(), ['thumbnail', 'desktop', 'phone', 'page-desktop', 'page-phone']);
    assert.match(line ?? '', /home\/hero\/iteration-01 in its page: pictures 2 uploaded\./);
  });

  it('are taken again when the app’s page or component changes, and only then', async () => {
    const { repo, shots, run, puts } = await setup();
    await run('iteration-01');
    const before = shots.length;
    await run('iteration-01');
    assert.equal(shots.length, before, 'nothing changed: nothing taken');
    write(repo, 'app/page.tsx', 'export default function Home() { return 1; }\n');
    await run('iteration-01');
    const again = shots.slice(before);
    assert.equal(again.length, 2);
    assert.ok(again.every(shot => shot.url.includes('roughbook-swap')));
    assert.deepEqual(puts().slice(5), ['page-desktop', 'page-phone']);
  });

  it('are none for a baseline, whose page is the page itself, and none while pictures are off', async () => {
    const { shots, run, puts } = await setup();
    await run('iteration-00');
    assert.ok(!shots.some(shot => shot.url.includes('roughbook-swap')));
    assert.deepEqual(puts(), ['thumbnail', 'desktop', 'phone']);
    const off = await setup(false);
    await off.run('iteration-01');
    assert.deepEqual(off.puts(), []);
    assert.deepEqual(off.shots, []);
  });

  it('are none on a stack with no in-page view, or for a component nobody adopted', async () => {
    const { repo } = await setup();
    const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
    assert.ok(inPageTarget(repo, environment, target, DEV));
    const vite = recipeFor('vite')!.environment(LINK);
    assert.equal(inPageTarget(repo, vite, target, DEV), null);
    fs.rmSync(path.join(repo, 'rough/home/hero/iteration-00'), { recursive: true });
    assert.equal(inPageTarget(repo, environment, target, DEV), null);
  });
});
