// Asking before pictures upload (A4 of ROUGHBOOK-APPLE-PLAN.md, decision 25): a project's
// `pictures` is on, off or not asked (null). Nothing goes up before a yes: unasked, the pictures
// are taken and kept here, waiting in the outbox, and they go once someone says yes. The question
// is asked once, where a person can answer it (init, run, adopt); never in an agent's shell, an
// unattended or editor run, or MCP's finish_run, which say one line instead. The privacy sheet is
// shown once per install, at login or the first init.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Detection } from '../agents/types.js';
import { picturePath, StudioApi } from '../api/client.js';
import { Outbox, sha256 } from '../api/outbox.js';
import type { ProjectTree } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { PRIVACY_SHEET, showPrivacySheetOnce } from '../config/privacySheet.js';
import { readSettings } from '../config/settings.js';
import { pictureRefusal } from '../pictures/allowed.js';
import { ensurePicturesAnswer, PICTURES_WAIT_LINE } from '../pictures/answer.js';
import { shareIterationPictures } from '../pictures/share.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
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

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;
const LINK = { orgId: ORG, project: 'site' };

const write = (repo: string, file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

const webp = (shows: string) =>
  Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.from(shows)]);

/** The project with an adopted home page whose hero has a baseline and a studio iteration. */
function tree(pictures: boolean | null | undefined): ProjectTree {
  const iteration = (id: string, origin: 'app' | 'local' | 'sketch') => ({
    id,
    number: Number(id.slice(-2)),
    name: id,
    status: 'draft',
    parent: null,
    direction: '',
    generation: { mode: origin === 'sketch' ? 'sketch' : 'local' },
    origin
  });
  return {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
    ...(pictures === undefined ? {} : { pictures }),
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
            iterations: [
              iteration('iteration-00', 'app'),
              iteration('iteration-01', 'local'),
              iteration('iteration-02', 'sketch')
            ]
          }
        ]
      }
    ]
  };
}

/**
 * A fake backend holding one project's pictures answer: GET reads it, PUT …/pictures sets it from
 * a strict `{ on }`, and each picture PUT is taken only while the answer is a yes.
 */
function backend(initial: boolean | null | undefined, more: Record<string, () => unknown> = {}) {
  const state = { pictures: initial, online: true };
  const fake = fakeFetch(request => {
    if (!state.online) return 'offline';
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/api/studio/')) return 'offline';
    const route = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (route === `GET ${PROJECT}`) return ok(tree(state.pictures));
    if (route === `PUT ${PROJECT}/pictures`) {
      const body = request.body as { on: unknown };
      if (Object.keys(body).join() !== 'on' || typeof body.on !== 'boolean') {
        return refused('VALIDATION_ERROR', 400);
      }
      state.pictures = body.on;
      return ok({ pictures: body.on });
    }
    if (request.method === 'PUT' && url.pathname.includes('/pictures/')) {
      if (state.pictures !== true) return refused('PICTURES_OFF', 409);
      return ok({ kind: 'thumbnail', width: 640, height: 400, updatedAt: '2026-10-28T00:00:00Z' });
    }
    if (more[route]) return ok(more[route]());
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  return { state, api, fetch: fake.fetch, requests: fake.requests };
}

const picturePuts = (requests: RecordedRequest[]) =>
  requests.filter(request => request.method === 'PUT' && request.url.includes('/pictures/'));
const answers = (requests: RecordedRequest[]) =>
  requests.filter(request => request.method === 'PUT' && request.url.endsWith('/site/pictures'));

describe('the pictures answer, on, off or not asked', () => {
  it('holds back an unasked project’s pictures, and only those it would take', () => {
    const at = (iteration: string) => ({ page: 'home', component: 'hero', iteration });
    assert.equal(pictureRefusal(tree(null), at('iteration-01')), 'PICTURES_UNASKED');
    assert.equal(pictureRefusal(tree(null), at('iteration-00')), 'PICTURES_UNASKED');
    assert.equal(pictureRefusal(tree(null), { page: 'home' }), 'PICTURES_UNASKED');
    // A web sketch's, or a page nobody adopted, is never taken, asked or not.
    assert.equal(pictureRefusal(tree(null), at('iteration-02')), 'NOT_A_STUDIO_ITERATION');
    assert.equal(pictureRefusal(tree(null), { page: 'about' }), 'PAGE_NOT_IN_APP');
    assert.equal(pictureRefusal(tree(true), at('iteration-01')), null);
    assert.equal(pictureRefusal(tree(false), at('iteration-01')), 'PICTURES_OFF');
    // Absent, from a backend older than the question, still means on.
    assert.equal(pictureRefusal(tree(undefined), at('iteration-01')), null);
  });

  it('keeps an unasked picture waiting in the outbox, sends it after a yes, and lets it go after a no', async () => {
    const repo = await tempDir();
    const { state, api, requests } = backend(null);
    const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
    const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
    const file = 'rough/.screenshots/home/hero/iteration-01/pictures/thumbnail.webp';
    const upload = (bytes: Buffer) => ({
      file,
      type: 'image/webp' as const,
      hash: sha256(bytes),
      picture: { ...LINK, ...target, kind: 'thumbnail' as const }
    });
    const route = picturePath(ORG, 'site', target, 'thumbnail');
    const bytes = webp('kept');
    write(repo, file, bytes);

    assert.deepEqual(await outbox.upload(api, route, upload(bytes)), {
      status: 'skipped',
      code: 'PICTURES_UNASKED'
    });
    assert.deepEqual(picturePuts(requests), [], 'nothing leaves before a yes');
    const [waiting] = await outbox.pending();
    assert.equal(waiting!.path, route);
    assert.equal(waiting!.attempts, 0, 'held, not failing');
    assert.deepEqual(await outbox.dropped(), []);
    // Flushing again while unasked still sends nothing and keeps it.
    const flushed = await outbox.flush(api);
    assert.equal(flushed.left, 1);
    assert.deepEqual(picturePuts(requests), []);

    // A yes: the next flush sends it, as the send-again path does.
    state.pictures = true;
    assert.equal((await outbox.flush(api)).left, 0);
    assert.equal(picturePuts(requests).length, 1);
    assert.deepEqual(picturePuts(requests)[0]!.bytes, bytes);

    // Asked again elsewhere and answered no: a waiting picture goes quietly, lost to nobody.
    const second = webp('second');
    write(repo, file, second);
    state.pictures = null;
    await outbox.upload(api, route, upload(second));
    state.pictures = false;
    await outbox.flush(api);
    assert.deepEqual(await outbox.pending(), []);
    assert.deepEqual(await outbox.dropped(), []);
    assert.equal(picturePuts(requests).length, 1);
  });

  it('takes and keeps an unasked iteration’s pictures here, without sending any', async () => {
    const repo = await tempDir();
    const { api, requests } = backend(null);
    const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
    const taken: string[] = [];
    const report = await shareIterationPictures(
      {
        repoRoot: repo,
        api,
        outbox,
        link: LINK,
        environment: {
          viewports: [{ name: 'desktop', width: 1440, height: 900, mobile: false }],
          overlays: []
        },
        shoot: async ({ size }) => {
          taken.push(String(size.width));
          return webp(`hero ${size.width}`);
        }
      },
      { page: 'home', component: 'hero', iteration: 'iteration-01' },
      'http://localhost:3000/rough-preview/home/hero/iteration-01',
      'hash-1'
    );
    assert.equal(report.skipped, 'PICTURES_UNASKED');
    assert.equal(taken.length, 3, 'taken, so they are ready to go after a yes');
    assert.ok(
      fs.existsSync(
        path.join(repo, 'rough/.screenshots/home/hero/iteration-01/pictures/thumbnail.webp')
      )
    );
    assert.equal((await outbox.pending()).length, 3);
    assert.deepEqual(picturePuts(requests), []);
  });
});

describe('ensurePicturesAnswer', () => {
  it('asks once where someone can answer, and saves the answer as one boolean', async () => {
    for (const [answer, on] of [
      ['y', true],
      ['n', false],
      ['NO', false]
    ] as const) {
      const { api, requests, state } = backend(null);
      const io = recordingIo([answer]);
      assert.equal(await ensurePicturesAnswer(io, api, LINK), on);
      assert.equal(io.questions.length, 1);
      assert.match(io.questions[0]!, /\[y\/n, Enter for not now\] $/);
      assert.deepEqual(
        answers(requests).map(request => request.body),
        [{ on }]
      );
      assert.equal(state.pictures, on);
      // Answered: not asked again.
      assert.equal(await ensurePicturesAnswer(io, api, LINK), on);
      assert.equal(io.questions.length, 1);
    }
  });

  it('takes only an explicit n for a no: Enter or anything else is not now, and deletes nothing', async () => {
    for (const answer of ['', '   ', 'nope', 'x']) {
      const { api, requests, state } = backend(null);
      const io = recordingIo([answer, 'y']);
      assert.equal(await ensurePicturesAnswer(io, api, LINK), null, JSON.stringify(answer));
      assert.deepEqual(answers(requests), [], 'no answer reaches the backend');
      assert.equal(state.pictures, null);
      assert.ok(io.lines.includes(PICTURES_WAIT_LINE));
      // Still unanswered, so it is asked again next time.
      assert.equal(await ensurePicturesAnswer(io, api, LINK), true);
      assert.equal(io.questions.length, 2);
    }
  });

  it('says a no deletes stored pictures before asking, and again once it has', async () => {
    const { api } = backend(null);
    const asked: number[] = [];
    const io = recordingIo();
    const answering = {
      ...io,
      ask: async (question: string) => {
        asked.push(io.lines.length);
        io.questions.push(question);
        return 'n';
      }
    };
    await ensurePicturesAnswer(answering, api, LINK);
    const warning = io.lines.findIndex(line => /a no deletes them for good/.test(line));
    assert.ok(warning >= 0 && warning < asked[0]!, 'said before the question');
    assert.ok(
      io.lines.slice(asked[0]).some(line => /already on Roughbook are deleted/.test(line)),
      'said in the answer'
    );
  });

  it('never takes silence for a yes, and says one line where nobody can answer', async () => {
    const nobody = backend(null);
    const io = recordingIo();
    assert.equal(await ensurePicturesAnswer(io, nobody.api, LINK), null);
    assert.equal(io.questions.length, 1);
    assert.deepEqual(answers(nobody.requests), []);
    assert.ok(io.lines.includes(PICTURES_WAIT_LINE));

    // An unattended or editor run is not asked at all.
    const unattended = backend(null);
    const quiet = recordingIo(['y']);
    assert.equal(await ensurePicturesAnswer(quiet, unattended.api, LINK, { ask: false }), null);
    assert.deepEqual(quiet.questions, []);
    assert.ok(quiet.lines.includes(PICTURES_WAIT_LINE));
    assert.deepEqual(answers(unattended.requests), []);
  });

  it('asks nothing when the project answered, or cannot be read', async () => {
    for (const pictures of [true, false, undefined]) {
      const { api, requests } = backend(pictures);
      const io = recordingIo(['y']);
      assert.equal(await ensurePicturesAnswer(io, api, LINK), pictures ?? true);
      assert.deepEqual(io.questions, []);
      assert.deepEqual(io.lines, []);
      assert.deepEqual(answers(requests), []);
    }
    const offline = backend(null);
    offline.state.online = false;
    const io = recordingIo(['y']);
    assert.equal(await ensurePicturesAnswer(io, offline.api, LINK), null);
    assert.deepEqual(io.questions, []);
  });

  it('sends what waited once the answer is yes', async () => {
    const repo = await tempDir();
    const { api, requests } = backend(null);
    const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
    const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
    const file = 'rough/.screenshots/home/hero/iteration-01/pictures/thumbnail.webp';
    const bytes = webp('waiting');
    write(repo, file, bytes);
    await outbox.upload(api, picturePath(ORG, 'site', target, 'thumbnail'), {
      file,
      type: 'image/webp',
      hash: sha256(bytes),
      picture: { ...LINK, ...target, kind: 'thumbnail' }
    });
    assert.deepEqual(picturePuts(requests), []);
    assert.equal(await ensurePicturesAnswer(recordingIo(['yes']), api, LINK, { outbox }), true);
    assert.equal(picturePuts(requests).length, 1);
    assert.deepEqual(await outbox.pending(), []);
  });

  it('is not called where an agent finishes a run (done, MCP finish_run)', () => {
    const source = (file: string) =>
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', ...file.split('/')),
        'utf8'
      );
    for (const file of ['commands/done.ts', 'mcp/tools.ts', 'mcp/server.ts', 'server/studio.ts']) {
      assert.ok(!source(file).includes('ensurePicturesAnswer'), file);
    }
  });
});

/** A linked repo and a signed-in studio, for the commands. */
async function linkedRepo(): Promise<{ repo: string; configDir: string }> {
  const repo = path.join(await tempDir('roughbook-answer-'), 'app');
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

describe('roughbook pictures and roughbook status', () => {
  it('says the answer, sets it, and sends what waited after a yes', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(null, {
      'GET /me': () => ({ user: { id: 'u1', email: 'dana@example.test', name: null } }),
      'GET /projects': () => [
        { id: ORG, name: 'Acme', role: 'editor', projects: [{ slug: 'site', name: 'Site' }] }
      ]
    });
    const io = recordingIo();
    const run = (argv: string[]) =>
      main(argv, { cwd: repo, env: { ROUGHBOOK_CONFIG_DIR: configDir }, io, fetch: fake.fetch });

    assert.equal(await run(['pictures']), 0, io.errors.join('\n'));
    assert.match(io.lines.at(-1)!, /Not answered yet/);
    assert.equal(await run(['status']), 0, io.errors.join('\n'));
    assert.ok(
      io.lines.some(line => /^Pictures:\s+not answered/.test(line)),
      io.lines.join('\n')
    );

    // One waits from before the answer.
    const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
    const file = 'rough/.screenshots/home/hero/iteration-01/pictures/thumbnail.webp';
    const bytes = webp('before the answer');
    write(repo, file, bytes);
    const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
    await outbox.upload(fake.api, picturePath(ORG, 'site', target, 'thumbnail'), {
      file,
      type: 'image/webp',
      hash: sha256(bytes),
      picture: { ...LINK, ...target, kind: 'thumbnail' }
    });

    assert.equal(await run(['pictures', 'on']), 0, io.errors.join('\n'));
    assert.deepEqual(
      answers(fake.requests).map(request => request.body),
      [{ on: true }]
    );
    assert.equal(picturePuts(fake.requests).length, 1);
    assert.equal(await run(['status']), 0);
    assert.ok(
      io.lines.some(line => /^Pictures:\s+uploaded/.test(line)),
      io.lines.join('\n')
    );

    assert.equal(await run(['pictures', 'off']), 0, io.errors.join('\n'));
    assert.deepEqual(
      answers(fake.requests).map(request => request.body),
      [{ on: true }, { on: false }]
    );
    assert.match(io.lines.join('\n'), /stay on this machine/);
    assert.equal(await run(['pictures', 'maybe']), 1);
    assert.match(io.errors.at(-1)!, /roughbook pictures on, roughbook pictures off/);
  });

  it('says why a viewer cannot answer', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = fakeFetch(request =>
      request.method === 'PUT' ? refused('FORBIDDEN', 403) : ok(tree(null))
    );
    const io = recordingIo();
    const code = await main(['pictures', 'on'], {
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: fake.fetch
    });
    assert.equal(code, 1);
    assert.match(io.errors.join('\n'), /owner or an editor/);
  });
});

describe('asking in init and run', () => {
  const nextRepo = async () => {
    const repo = await tempDir('roughbook-client-');
    fs.writeFileSync(path.join(repo, 'package.json'), '{ "dependencies": { "next": "^16.3.8" } }');
    fs.mkdirSync(path.join(repo, 'src', 'app'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), '/node_modules\n');
    return repo;
  };
  const initBackend = () =>
    backend(null, {
      'GET /projects': () => [
        { id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }
      ],
      [`POST /orgs/${ORG}/links`]: () => ({
        linkId: 'link-1',
        org: { id: ORG, name: 'Acme' },
        project: { slug: 'site', name: 'Site' }
      })
    });

  it('init asks once, after linking, and shows the privacy sheet the first time only', async () => {
    const configDir = await tempDir('roughbook-config-');
    await saveCredentials(configDir, {
      server: SERVER,
      installId: 'install-1',
      token: 'rbi_token',
      signedInAs: 'dana@example.test',
      savedAt: new Date(0).toISOString()
    });
    const fake = initBackend();
    // The project, the commit question, the changes, then pictures.
    const io = recordingIo(['1', '', '', 'y']);
    const repo = await nextRepo();
    const run = (argv: string[]) =>
      main(argv, {
        cwd: repo,
        env: { ROUGHBOOK_CONFIG_DIR: configDir },
        io,
        fetch: fake.fetch,
        sleep: async () => {},
        openUrl: async () => true
      });
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    const asked = io.questions.filter(question => /pictures/i.test(question));
    assert.equal(asked.length, 1, io.questions.join('\n'));
    assert.deepEqual(
      answers(fake.requests).map(request => request.body),
      [{ on: true }]
    );
    assert.ok(io.lines.includes(PRIVACY_SHEET[0]!), 'the sheet, at the first init');
    assert.equal((await readSettings(configDir)).privacySheetShown, true);

    const before = io.lines.length;
    assert.equal(await run(['init', '--yes']), 0, io.errors.join('\n'));
    assert.equal(io.questions.filter(question => /pictures/i.test(question)).length, 1);
    assert.ok(!io.lines.slice(before).includes(PRIVACY_SHEET[0]!), 'once per install');
  });

  it('init with nobody to answer leaves pictures unasked and says so', async () => {
    const configDir = await tempDir('roughbook-config-');
    await saveCredentials(configDir, {
      server: SERVER,
      installId: 'install-1',
      token: 'rbi_token',
      signedInAs: 'dana@example.test',
      savedAt: new Date(0).toISOString()
    });
    const fake = initBackend();
    const io = recordingIo();
    const repo = await nextRepo();
    assert.equal(
      await main(['init', '--project', 'site', '--yes'], {
        cwd: repo,
        env: { ROUGHBOOK_CONFIG_DIR: configDir },
        io,
        fetch: fake.fetch,
        sleep: async () => {},
        openUrl: async () => true
      }),
      0,
      io.errors.join('\n')
    );
    assert.ok(!io.questions.some(question => /pictures/i.test(question)));
    assert.deepEqual(answers(fake.requests), []);
    assert.ok(io.lines.includes(PICTURES_WAIT_LINE));
    assert.equal(fake.state.pictures, null);
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

  it('run asks in a terminal run, and only says the line when unattended', async () => {
    const { repo, configDir } = await linkedRepo();
    let next = 1;
    const fake = backend(null, {
      [`POST ${PROJECT}/runs`]: () => {
        const iteration = `iteration-${String(++next).padStart(2, '0')}`;
        return [
          {
            runId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`,
            iteration,
            parent: null,
            targetFolder: `rough/home/hero/${iteration}`,
            prompt: `<task>\nGenerate ${iteration}.\n</task>\n`,
            checks: [{ kind: 'entry-file', file: 'index.tsx' }]
          }
        ];
      }
    });
    const options = (io: ReturnType<typeof recordingIo>): MainOptions => ({
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'test-key' },
      io,
      fetch: fake.fetch,
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
    });

    // Unattended: never asked.
    const unattended = recordingIo(['y']);
    await main(['run', 'home/hero', '--direction', 'Quiet', '--headless'], options(unattended));
    assert.deepEqual(
      unattended.questions.filter(question => /pictures/i.test(question)),
      []
    );
    assert.ok(unattended.lines.includes(PICTURES_WAIT_LINE));
    assert.equal(fake.state.pictures, null);

    // In a terminal: asked once.
    const io = recordingIo(['n']);
    assert.equal(
      await main(['run', 'home/hero', '--direction', 'Loud'], options(io)),
      0,
      io.errors.join('\n')
    );
    assert.equal(io.questions.filter(question => /pictures/i.test(question)).length, 1);
    assert.equal(fake.state.pictures, false);
    assert.deepEqual(
      answers(fake.requests).map(request => request.body),
      [{ on: false }]
    );
  });
});

describe('the privacy sheet', () => {
  it('is shown once per install, kept beside the analytics answer, and sends nothing', async () => {
    const configDir = await tempDir('roughbook-config-');
    const io = recordingIo();
    assert.equal(await showPrivacySheetOnce(io, configDir), true);
    assert.equal(await showPrivacySheetOnce(io, configDir), false);
    assert.deepEqual(io.lines.slice(0, PRIVACY_SHEET.length), [...PRIVACY_SHEET]);
    assert.equal(io.lines.length, PRIVACY_SHEET.length);
    const settings = await readSettings(configDir);
    assert.equal(settings.privacySheetShown, true);
    assert.equal(settings.analyticsConsent, null);
    const text = PRIVACY_SHEET.join(' ');
    for (const kept of ['brief', 'context', 'iteration', 'reviews', 'pictures']) {
      assert.match(text, new RegExp(kept, 'i'));
    }
    assert.match(text, /not kept/i);
    assert.match(text, /code/);
    assert.match(text, /paths/);
    assert.match(text, /stays with the project until it is deleted/);
    assert.match(text, /delete your own/);
    assert.match(text, /never shown to client reviewers/);
    assert.match(text, /no model is trained on them/);
    assert.match(text, /stand-in/);
  });
});

describe('the local UI’s answer', () => {
  it('shows the answer in /api/state and sets it with POST /api/pictures/answer', async () => {
    const { repo, configDir } = await linkedRepo();
    const fake = backend(null);
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise(resolve => probe.close(resolve));
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'src/app'
    };
    const context: CommandContext & { repoRoot: string } = {
      io: recordingIo(),
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      repoRoot: repo,
      configDir,
      home: configDir,
      fetch: fake.fetch,
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
      api: fake.api,
      link,
      devUrl: 'http://localhost:3100',
      port,
      pty: { ok: false, reason: 'not in tests' }
    });
    const token = 'local-token-for-the-answer';
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
      await call('GET', '/api/project');
      assert.equal((await call('GET', '/api/state')).json.data.pictures, null);
      assert.equal((await call('POST', '/api/pictures/answer', { on: 'yes' })).status, 400);
      assert.equal((await call('POST', '/api/pictures/answer', {})).status, 400);
      assert.deepEqual(answers(fake.requests), []);
      const answered = await call('POST', '/api/pictures/answer', { on: true });
      assert.equal(answered.status, 200, JSON.stringify(answered.json));
      assert.deepEqual(answered.json.data, { pictures: true });
      assert.deepEqual(
        answers(fake.requests).map(request => request.body),
        [{ on: true }]
      );
      assert.equal((await call('GET', '/api/state')).json.data.pictures, true);
    } finally {
      studio.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
