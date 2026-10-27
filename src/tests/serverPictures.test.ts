// Pictures as they are needed, on the local server (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md):
// the canvas names the cards on screen, by id alone; their pictures are taken first, one at a
// time, then the rest; a map component's pictures are kept while its source is unchanged; and an
// adoption queues its baselines rather than taking them before it answers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import type { AdoptBody } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { readEnvironment } from '../environment/read.js';
import type { MapComponent, RepoMap } from '../map/types.js';
import { readMap, writeMap } from '../map/file.js';
import {
  clearMapPictures,
  MAP_PICTURES_PAGE,
  mapPicturesKept,
  recordMapPictures,
  takeMapPictures,
  type MapPictureInput
} from '../pictures/mapPictures.js';
import { recipeFor } from '../recipes/index.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { mapScreenshotPath } from '../screenshot/iteration.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';
import { homeApp, LINK } from './homeApp.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;
const TOKEN = 'local-token-for-the-picture-tests';

function component(slug: string): MapComponent {
  return {
    slug,
    name: slug,
    kind: 'section',
    files: [`components/${slug}.tsx`],
    export: 'default',
    fixture: null,
    alone: 'yes',
    why: null,
    byAgent: false
  };
}

const PARTS = ['hero', 'faq', 'team', 'press', 'logos'].map(component);
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
      sections: PARTS.map(item => item.slug),
      byAgent: false
    }
  ],
  components: PARTS,
  missed: [],
  unplaced: []
};

const VIEWPORTS = { viewports: [{ name: 'desktop', width: 1280, height: 800, mobile: false }] };

function write(repo: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
}

describe("a map component's pictures", () => {
  it('are kept while its files are unchanged, and taken again after', async () => {
    const repo = await tempDir();
    write(repo, 'components/faq.tsx', 'export default function Faq() { return null; }\n');
    const faq = component('faq');
    const shown = { ...VIEWPORTS, overlays: [] } as unknown as MapPictureInput['environment'];
    assert.equal(await mapPicturesKept(repo, faq, shown), false);
    write(repo, mapScreenshotPath('component', 'faq', 'desktop'), 'png');
    await recordMapPictures(repo, faq, shown);
    assert.equal(await mapPicturesKept(repo, faq, shown), true);
    // Taking is skipped while they are kept: no pointer, no browser.
    const kept = await takeMapPictures({
      repoRoot: repo,
      environment: shown,
      recipe: null,
      component: faq,
      devUrl: 'http://localhost:3100',
      browser: 'chrome',
      take: async () => {
        throw new Error('not taken');
      }
    });
    assert.equal(kept, 'kept');
    write(repo, 'components/faq.tsx', 'export default function Faq() { return <dl />; }\n');
    assert.equal(await mapPicturesKept(repo, faq, shown), false);
    // A viewport added since is not kept either.
    write(repo, 'components/faq.tsx', 'export default function Faq() { return null; }\n');
    const wider = {
      ...shown,
      viewports: [...VIEWPORTS.viewports, { name: 'phone', width: 390, height: 844, mobile: true }]
    } as MapPictureInput['environment'];
    assert.equal(await mapPicturesKept(repo, faq, wider), false);
  });

  it('are taken through a pointer under the studio’s own page, which goes when the queue is done', async () => {
    const repo = await homeApp();
    const environment = await readEnvironment(repo, LINK);
    const features = readMap(repo)!.map.components.find(item => item.slug === 'features')!;
    const asked: string[] = [];
    const input: MapPictureInput = {
      repoRoot: repo,
      environment,
      recipe: recipeFor('next'),
      component: features,
      devUrl: 'http://localhost:3100',
      browser: 'chrome',
      take: async ({ url, file }) => {
        asked.push(url);
        fs.writeFileSync(file, 'png');
        return true;
      },
      check: async url => ({ status: 200, url })
    };
    assert.equal(await takeMapPictures(input), 'taken');
    assert.equal(asked.length, environment.viewports.length);
    assert.ok(asked.every(url => url.includes(`${MAP_PICTURES_PAGE}/features/iteration-01`)));
    assert.ok(fs.existsSync(path.join(repo, 'rough', MAP_PICTURES_PAGE, 'features')));
    assert.equal(await takeMapPictures(input), 'kept');
    assert.equal(asked.length, environment.viewports.length);
    clearMapPictures(repo, environment);
    assert.ok(!fs.existsSync(path.join(repo, 'rough', MAP_PICTURES_PAGE)));
    // One the map says does not render alone is not tried.
    write(repo, 'components/features.tsx', 'export function Features() { return <ol />; }\n');
    assert.equal(
      await takeMapPictures({ ...input, component: { ...features, alone: 'no' } }),
      'skipped'
    );
  });
});

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

describe("the local server's picture queue", () => {
  let root: string;
  let repo: string;
  let port: number;
  let studio: LocalStudio;
  let server: http.Server;
  let backend: ReturnType<typeof fakeFetch>;
  /** What was taken, in order: `map:<slug>` or an iteration key. */
  const taken: string[] = [];
  let release: (() => void) | null = null;

  const call = async (method: 'GET' | 'POST', pathname: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: `http://127.0.0.1:${port}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, json: (await response.json()) as any };
  };

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-server-pictures-'));
    repo = path.join(root, 'app');
    write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0" } }\n');
    for (const item of PARTS) write(repo, item.files[0]!, 'export default function X() {}\n');
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'app'
    };
    write(repo, 'rough/roughbook.json', renderRepoLink(link));
    writeMap(repo, MAP);
    const environment = await readEnvironment(repo, link);
    // The hero is adopted: its baseline is here.
    write(repo, `rough/home/hero/iteration-00/${environment.entry}`, 'export default 1;\n');
    execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });

    backend = fakeFetch(request => {
      const route = `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`;
      if (route === `POST ${PROJECT}/adopt`) {
        const body = request.body as AdoptBody;
        return ok({
          pages: body.pages.map(page => ({
            slug: page.slug,
            created: false,
            components: page.components.map(item => ({
              slug: item.slug,
              created: true,
              baseline: 'iteration-00'
            }))
          }))
        });
      }
      return refused('NOT_FOUND', 404);
    });
    const configDir = path.join(root, 'config');
    port = await freePort();
    const context: CommandContext & { repoRoot: string } = {
      io: recordingIo(),
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      repoRoot: repo,
      configDir,
      home: configDir,
      fetch: backend.fetch,
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
      screenshot: async (_repo, _url, target) => {
        taken.push(`${target.page}/${target.component}/${target.iteration}`);
        return { files: { desktop: 'x.png' }, warning: null };
      },
      // The app answers.
      askPreview: async url => ({ status: 200, url }),
      runCommand: async () => ({ ok: false, stdout: '', stderr: 'not run', code: null }),
      waitForStop: async () => {},
      stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
    };
    studio = new LocalStudio({
      context,
      api: new StudioApi({
        server: 'http://localhost:4000',
        token: 'rbi_token',
        userAgent: 'test',
        fetch: backend.fetch
      }),
      link,
      devUrl: 'http://localhost:3100',
      port,
      pty: { ok: false, reason: 'not in tests' },
      mapPictures: async input => {
        // The first one waits for the test, so what is shown next can overtake the rest.
        if (release === null && !taken.length) {
          await new Promise<void>(resolve => (release = resolve));
        }
        taken.push(`map:${input.component.slug}`);
        return input.component.slug === 'team' ? 'kept' : 'taken';
      }
    });
    server = createLocalServer({
      studio,
      port,
      token: TOKEN,
      uiDir: null,
      devUrl: 'http://localhost:3100',
      project: 'site'
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  });

  after(async () => {
    studio?.close();
    server?.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('takes the cards on screen first, then the rest, one at a time', async () => {
    const shown = await call('POST', '/api/pictures/shown', {
      cards: ['iteration:home/press/iteration-00']
    });
    assert.equal(shown.status, 200);
    assert.equal(shown.json.data.taking, 'map:press');
    // Scrolled: these come before the rest, in the order shown.
    await call('POST', '/api/pictures/shown', {
      cards: ['iteration:home/team/iteration-00', 'iteration:home/hero/iteration-00']
    });
    release!();
    await studio.pictures.idle();
    assert.deepEqual(taken, [
      'map:press',
      'map:team',
      'home/hero/iteration-00',
      'map:faq',
      'map:logos'
    ]);
    // Each card whose pictures changed is in the change feed; the kept one is not.
    const changes = studio.changes.since(0).keys;
    assert.ok(changes.includes('map:press#images'));
    assert.ok(changes.includes('home/hero/iteration-00#images'));
    assert.ok(!changes.includes('map:team#images'));
    assert.deepEqual((await call('GET', '/api/pictures')).json.data, {
      taking: null,
      shown: 0,
      rest: 0,
      paused: false
    });
  });

  it('names cards by id alone', async () => {
    for (const card of ['iteration:../../etc/iteration-00', 'iteration:home/hero', 'map:hero']) {
      const answer = await call('POST', '/api/pictures/shown', { cards: [card] });
      assert.equal(answer.status, 400, card);
    }
    const many = await call('POST', '/api/pictures/shown', {
      cards: Array.from({ length: 201 }, () => 'iteration:home/hero/iteration-00')
    });
    assert.equal(many.status, 400);
  });

  it('answers an adoption before its baselines are pictured, which the queue then takes', async () => {
    taken.length = 0;
    const adopted = await call('POST', '/api/adopt', { page: 'home', component: 'faq' });
    assert.equal(adopted.status, 200);
    assert.deepEqual(adopted.json.data.written, ['home/faq']);
    await studio.pictures.idle();
    assert.deepEqual(taken, ['home/faq/iteration-00']);
  });
});
