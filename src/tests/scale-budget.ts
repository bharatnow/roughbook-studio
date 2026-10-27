// B7's budgets on the scale app (decisions 60, 62 and 65 of ROUGHBOOK-BROWNFIELD-PLAN.md): a full
// `roughbook map`, recorded; one changed file refreshing the map, under a second; and the local
// canvas's input built with its first kept pictures served, under three seconds. Measured on
// this machine, with no network and no browser: the backend is a stand-in, and the pictures are
// ones an earlier session kept (their source unchanged), as a designer reopening the studio has.
//
//   npm run scale-budget [-- --dir <a scale app> | --seed <n>] [--components <n>] [--pages <n>]
//
// Without --dir it writes the app with conformance/scale/generate.mjs into the temporary folder,
// and removes it after. It prints each measure against its budget and exits 1 when one is over.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { StudioApi } from '../api/client.js';
import type { CommandContext } from '../commands/context.js';
import { readEnvironment } from '../environment/read.js';
import { mapRepo } from '../map/run.js';
import { recordMapPictures } from '../pictures/mapPictures.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { mapScreenshotPath } from '../screenshot/iteration.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

/** The budgets, in milliseconds: the map run's is recorded, not held. */
export const BUDGETS = { refresh: 1000, canvas: 3000 };
/** How many cards the first screen of the canvas shows, near enough (src/pictures/queue.ts). */
const FIRST = 12;

type Generator = {
  writeApp(dir: string, options: Record<string, unknown>): { pages: unknown[] };
};

const ORG = '11111111-1111-4111-8111-111111111111';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'scale',
  roughCommitted: true,
  appDir: 'app',
  stack: ['next-16', 'react-19'],
  family: 'react-like'
} as RepoLink;

/** A 1x1 PNG: what the canvas is served is bytes, whatever they show. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

type Measure = { name: string; ms: number; budget: number | null; note: string };

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    seed: { type: 'string', default: '1' },
    components: { type: 'string', default: '1000' },
    pages: { type: 'string', default: '100' }
  }
});

const measures: Measure[] = [];
const ms = (since: number) => Math.round(performance.now() - since);

let repo = values.dir ? path.resolve(values.dir) : '';
const made = !repo;
if (made) {
  const generator = (await import(
    pathToFileURL(path.join(root, 'conformance', 'scale', 'generate.mjs')).href
  )) as Generator;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-scale-budget-'));
  generator.writeApp(repo, {
    seed: Number(values.seed),
    components: Number(values.components),
    pages: Number(values.pages)
  });
}
fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
fs.writeFileSync(path.join(repo, 'rough', 'roughbook.json'), renderRepoLink(LINK));
if (!fs.existsSync(path.join(repo, '.git'))) {
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
}

try {
  // 1. The full map, as `roughbook map` builds it.
  const environment = await readEnvironment(repo, LINK);
  fs.rmSync(path.join(repo, 'rough', 'map.md'), { force: true });
  fs.rmSync(path.join(repo, 'rough', '.roughbook', 'map.json'), { force: true });
  let started = performance.now();
  const full = await mapRepo(repo, environment, LINK);
  const map = full!.map;
  measures.push({
    name: 'full map',
    ms: ms(started),
    budget: null,
    note: `${map.components.length} components, ${map.pages.length} pages (discoverers ${full!.ms} ms)`
  });

  // 2. One changed file: the map refreshed. The sync session's incremental refresh runs inside
  // mapRepo when it knows what changed; until then this measures the whole map again.
  const section = map.components.find(item => item.kind === 'section')!;
  const file = path.join(repo, ...section.files[0]!.split('/'));
  fs.appendFileSync(file, '\n// changed for the budget\n');
  started = performance.now();
  await mapRepo(repo, environment, LINK);
  measures.push({
    name: 'one changed file',
    ms: ms(started),
    budget: BUDGETS.refresh,
    note: section.files[0]!
  });

  // 3. The canvas: kept pictures for the first screen's cards, as an earlier session left them.
  const firstCards = map.pages
    .flatMap(page => page.sections)
    .filter((slug, index, all) => all.indexOf(slug) === index)
    .map(slug => map.components.find(item => item.slug === slug)!)
    .filter(item => item && item.kind !== 'atom')
    .slice(0, FIRST * 2);
  for (const component of firstCards) {
    for (const viewport of environment.viewports) {
      const shot = path.join(
        repo,
        ...mapScreenshotPath('component', component.slug, viewport.name).split('/')
      );
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      fs.writeFileSync(shot, PNG);
    }
    await recordMapPictures(repo, component, environment);
  }
  const canvas = await measureCanvas(repo);
  measures.push({
    name: 'canvas and first pictures',
    ms: canvas.ms,
    budget: BUDGETS.canvas,
    note: canvas.note
  });
} finally {
  if (made) fs.rmSync(repo, { recursive: true, force: true });
}

let over = false;
for (const measure of measures) {
  const verdict =
    measure.budget === null ? 'recorded' : measure.ms <= measure.budget ? 'within' : 'OVER';
  over ||= verdict === 'OVER';
  process.stdout.write(
    `${measure.name.padEnd(26)} ${String(measure.ms).padStart(6)} ms  ${verdict}${
      measure.budget === null ? '' : ` (budget ${measure.budget} ms)`
    }  ${measure.note}\n`
  );
}
process.exit(over ? 1 : 0);

/**
 * From the local server answering to the canvas's first screen of kept pictures served: the
 * project view read, the canvas's input built as the local UI builds it, the cards on screen
 * named to the picture queue, and each of their pictures fetched as a card's <img> does.
 */
async function measureCanvas(repo: string): Promise<{ ms: number; note: string }> {
  const { studioCanvasInput } = (await import(
    pathToFileURL(path.join(root, 'ui', 'src', 'canvas-input.ts')).href
  )) as {
    studioCanvasInput: (
      tree: unknown,
      runs: unknown[],
      local: unknown,
      options: { shotKey?: string }
    ) => {
      input: { sections: { frames: { cards: { thumbnail: string | null }[] }[] }[] };
      cards: Record<string, unknown>;
    };
  };
  const backend = fakeFetch(request => {
    const route = `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`;
    if (route === `GET /orgs/${ORG}/projects/scale`) {
      return ok({
        slug: 'scale',
        name: 'Scale',
        delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
        pictures: true,
        pages: []
      });
    }
    return refused('NOT_FOUND', 404);
  });
  const port = await freePort();
  const token = 'scale-budget-token';
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-scale-config-'));
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
    screenshot: async () => ({ files: {}, warning: null }),
    // The app is not running: the queue keeps what it has and waits.
    askPreview: async () => null,
    runCommand: async () => ({ ok: false, stdout: '', stderr: 'not run', code: null }),
    waitForStop: async () => {},
    stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
  };
  const studio = new LocalStudio({
    context,
    api: new StudioApi({
      server: 'http://localhost:4000',
      token: 'rbi_token',
      userAgent: 'scale-budget',
      fetch: backend.fetch
    }),
    link: LINK,
    devUrl: 'http://localhost:3999',
    port,
    pty: { ok: false, reason: 'not measured' }
  });
  const server = createLocalServer({
    studio,
    port,
    token,
    uiDir: null,
    devUrl: 'http://localhost:3999',
    project: 'scale'
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  const call = async <T>(method: 'GET' | 'POST', pathname: string, body?: unknown) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        origin: base,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return ((await response.json()) as { data: T }).data;
  };
  try {
    const started = performance.now();
    const [state, project] = await Promise.all([
      call<{ shotKey: string }>('GET', '/api/state'),
      call<{ tree: unknown; local: unknown }>('GET', '/api/project')
    ]);
    const built = performance.now();
    const canvas = studioCanvasInput(project.tree, [], project.local, { shotKey: state.shotKey });
    const buildMs = ms(built);
    const shown = Object.keys(canvas.cards).slice(0, FIRST);
    await call('POST', '/api/pictures/shown', { cards: shown });
    const pictures = canvas.input.sections
      .flatMap(section => section.frames)
      .flatMap(frame => frame.cards)
      .map(card => card.thumbnail)
      .filter((url): url is string => url !== null)
      .slice(0, FIRST);
    const bytes = await Promise.all(
      pictures.map(async url => (await fetch(`${base}${url}`)).arrayBuffer())
    );
    const total = ms(started);
    const frames = canvas.input.sections.reduce((sum, section) => sum + section.frames.length, 0);
    return {
      ms: total,
      note: `${frames} cards (input built in ${buildMs} ms), ${bytes.filter(item => item.byteLength).length} of ${FIRST} pictures served`
    };
  } finally {
    studio.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
