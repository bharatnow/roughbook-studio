// `roughbook run --site` (ROUGHBOOK-WHOLE-SITE-PLAN.md, X5): the plan's undrawn sections drawn
// here, stage by stage, each with the direction the backend's preview hands back. A section,
// direction or fork beside --site is refused; nothing to draw says the refusal and exits 0.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Detection } from '../agents/types.js';
import type { DrawSection, SiteDrawView } from '../api/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { siteRefusal, siteStages, siteTarget, stageLine } from '../commands/run.js';
import { saveCredentials } from '../config/credentials.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;

const section = (page: string, component: string, stage: 1 | 2 | 3): DrawSection => ({
  page,
  component,
  name: component,
  stage,
  direction: `${page}/${component}: answer the question, on a light ground.`
});

/** A Fernside-shaped order: header and footer, the home opening, then the rest in plan order. */
const ORDER: DrawSection[] = [
  section('shared', 'header', 1),
  section('shared', 'footer', 1),
  section('homepage', 'hero', 2),
  section('homepage', 'proof', 3),
  section('about', 'story', 3)
];

const view = (order: DrawSection[], more: Partial<SiteDrawView> = {}): SiteDrawView => ({
  plan: { version: 2, approved: true },
  refusal: null,
  estimate: { sections: order.length, perSection: 120, upToCredits: 120 * order.length },
  order,
  draw: null,
  ...more
});

describe('roughbook run --site', () => {
  it('parses --site and --page, and refuses a section or a direction beside it', () => {
    assert.equal(siteTarget({}, ['home/hero']), null);
    assert.deepEqual(siteTarget({ site: true }, []), { page: null });
    assert.deepEqual(siteTarget({ site: true, page: 'about' }, []), { page: 'about' });
    assert.throws(() => siteTarget({ site: true }, ['home/hero']), /takes no <page>\/<component>/);
    assert.throws(() => siteTarget({ site: true, direction: ['Loud'] }, []), /no --direction/);
    assert.throws(() => siteTarget({ site: true, fork: 'iteration-01' }, []), /no --direction/);
    assert.throws(() => siteTarget({ site: true, page: 'Not a slug' }, []), /page's slug/);
    assert.throws(() => siteTarget({ page: 'about' }, []), /--page is for a site run/);
  });

  it('groups the order by stage, keeps the plan order, and leaves empty stages out', () => {
    const stages = siteStages(ORDER);
    assert.deepEqual(
      stages.map(stage => [stage.stage, stage.sections.map(item => item.component)]),
      [
        [1, ['header', 'footer']],
        [2, ['hero']],
        [3, ['proof', 'story']]
      ]
    );
    assert.deepEqual(stages.map(stageLine), [
      'Shared parts: 2 sections',
      'The opening: 1 section',
      'The rest: 2 sections'
    ]);
    // The opening already picked: its stage is gone, not printed empty.
    assert.deepEqual(
      siteStages(ORDER.filter(item => item.stage !== 2)).map(stage => stage.label),
      ['Shared parts', 'The rest']
    );
  });

  it('says the refusal when there is nothing to draw, and refuses a draw running on the web', () => {
    assert.deepEqual(siteRefusal(view([], { refusal: 'Nothing left to draw.' })), {
      words: 'Nothing left to draw.',
      exit: 0
    });
    assert.deepEqual(siteRefusal(view([], { refusal: 'Create the pages first.' })), {
      words: 'Create the pages first.',
      exit: 0
    });
    assert.equal(siteRefusal(view(ORDER)), null);
    const drawing = view(ORDER, {
      draw: {
        id: 'd1',
        status: 'drawing',
        stage: 1,
        page: null,
        startedAt: '2026-11-20T00:00:00Z',
        finishedAt: null,
        sections: []
      }
    });
    assert.equal(siteRefusal(drawing)?.exit, 1);
  });

  it('exits 0 with the refusal and starts nothing when the preview has nothing to draw', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(() => view([], { refusal: 'Nothing left to draw.' }));
    const io = recordingIo();
    assert.equal(await main(['run', '--site'], options(repo, configDir, fake.fetch, io)), 0);
    assert.ok(io.lines.includes('Nothing left to draw.'), io.lines.join('\n'));
    assert.deepEqual(
      fake.requests.map(request => `${request.method} ${new URL(request.url).pathname}`),
      [`GET /v1/api/studio${PROJECT}/site/draw`]
    );
  });

  it('asks for one page with ?page=, and refuses --site beside a section', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(() => view([], { refusal: 'Nothing left to draw.' }));
    const io = recordingIo();
    await main(['run', '--site', '--page', 'about'], options(repo, configDir, fake.fetch, io));
    assert.equal(new URL(fake.requests[0]!.url).searchParams.get('page'), 'about');

    const refusedIo = recordingIo();
    assert.notEqual(
      await main(['run', 'home/hero', '--site'], options(repo, configDir, fake.fetch, refusedIo)),
      0
    );
    assert.match(refusedIo.errors.join('\n'), /takes no <page>\/<component>/);
    assert.equal(fake.requests.length, 1);
  });

  it('runs each stage unattended in turn, one generate run per section with its direction', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(() => view(ORDER));
    const io = recordingIo();
    const code = await main(['run', '--site'], options(repo, configDir, fake.fetch, io));
    assert.ok([0, 1].includes(code), io.errors.join('\n'));
    const starts = fake.requests.filter(
      request => request.method === 'POST' && /\/runs$/.test(request.url)
    );
    assert.deepEqual(
      starts.map(request => {
        const body = request.body as {
          page: string;
          component: string;
          kind: string;
          mode: string;
          directions: { direction: string }[];
        };
        return [body.page, body.component, body.kind, body.mode, body.directions[0]!.direction];
      }),
      ORDER.map(item => [item.page, item.component, 'generate', 'headless', item.direction])
    );
    const stageLines = io.lines.filter(line => /^(Shared parts|The opening|The rest):/.test(line));
    assert.deepEqual(stageLines, [
      'Shared parts: 2 sections',
      'The opening: 1 section',
      'The rest: 2 sections'
    ]);
    // The opening's run starts only after the Shared parts' runs ended.
    const lineOf = (text: string) => io.lines.findIndex(line => line.startsWith(text));
    assert.ok(lineOf('The opening:') > lineOf('shared/footer/'));
    assert.ok(lineOf('The rest:') > lineOf('homepage/hero/'));
  });

  it('opens one stage at a time when the agent cannot run unattended', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(() => view(ORDER));
    const io = recordingIo();
    let opened = 0;
    const code = await main(['run', '--site'], {
      ...options(repo, configDir, fake.fetch, io),
      detect: async adapter =>
        adapter.id === 'claude-code'
          ? {
              ...claude(),
              headless: { ready: false, reason: 'Not signed in for unattended runs.' }
            }
          : notFound(adapter),
      launchTerminal: async () => {
        opened++;
      }
    });
    assert.equal(code, 0, io.errors.join('\n'));
    assert.equal(opened, 1);
    const starts = fake.requests.filter(
      request => request.method === 'POST' && /\/runs$/.test(request.url)
    );
    assert.deepEqual(
      starts.map(request => (request.body as { component: string }).component),
      ['header', 'footer']
    );
    assert.ok(io.lines.includes('When the agent has finished, run roughbook done.'));
    assert.ok(
      io.lines.includes(
        'Pick what you like, then run roughbook run --site again for the next stage.'
      )
    );
  });
});

const claude = (): Detection => ({
  id: 'claude-code',
  name: 'Claude Code',
  kind: 'terminal',
  found: true,
  executable: { command: 'C:/tools/claude.exe', prefixArgs: [], source: 'PATH' },
  version: '2.1.286',
  signedIn: true,
  signIn: 'claude.ai',
  headless: { ready: true },
  capabilities: { interactive: true, headless: true, permissions: true, usage: true }
});

function options(
  repo: string,
  configDir: string,
  fetch: typeof globalThis.fetch,
  io: ReturnType<typeof recordingIo>
): MainOptions {
  return {
    cwd: repo,
    env: { ROUGHBOOK_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'test-key' },
    io,
    fetch,
    platform: 'win32',
    detect: async adapter => (adapter.id === 'claude-code' ? claude() : notFound(adapter)),
    launchTerminal: async () => {},
    runHeadless: async () => ({
      ok: false,
      exitCode: 1,
      cancelled: true,
      error: null,
      usage: null
    }),
    screenshot: async () => ({ files: {}, warning: null })
  };
}

/** The studio's routes as this test needs them: the draw preview, runs, and the project. */
function backend(preview: () => SiteDrawView) {
  const numbers = new Map<string, number>();
  return fakeFetch(request => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/api/studio/')) return 'offline';
    const route = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (route === `GET ${PROJECT}/site/draw`) return ok(preview());
    if (route === `GET ${PROJECT}`) {
      return ok({
        slug: 'site',
        name: 'Site',
        pictures: false,
        delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
        pages: []
      });
    }
    if (route === `POST ${PROJECT}/runs`) {
      const body = request.body as { page: string; component: string };
      const key = `${body.page}/${body.component}`;
      const number = (numbers.get(key) ?? 0) + 1;
      numbers.set(key, number);
      const iteration = `iteration-${String(number).padStart(2, '0')}`;
      return ok([
        {
          runId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(numbers.size * 10 + number).padStart(12, '0')}`,
          iteration,
          parent: null,
          targetFolder: `rough/${key}/${iteration}`,
          prompt: `<task>\nGenerate ${iteration}.\n</task>\n`,
          checks: [{ kind: 'entry-file', file: 'index.tsx' }]
        }
      ]);
    }
    return refused('NOT_FOUND', 404);
  });
}

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

async function linkedRepo(): Promise<{ repo: string; configDir: string }> {
  const repo = path.join(await tempDir('roughbook-site-'), 'app');
  const link: RepoLink = {
    version: 1,
    orgId: ORG,
    project: 'site',
    roughCommitted: true,
    appDir: 'src/app'
  };
  write(repo, 'package.json', '{}');
  write(repo, 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  write(repo, 'rough/roughbook.json', renderRepoLink(link));
  write(repo, '.gitignore', '/rough/.roughbook/\n/rough/.screenshots/\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
      cwd: repo,
      stdio: 'ignore'
    });
  git('init', '--quiet');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'start');
  const configDir = await tempDir('roughbook-config-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  return { repo, configDir };
}
