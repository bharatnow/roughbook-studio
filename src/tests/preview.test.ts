// F4 of ROUGHBOOK-FRAMEWORKS-PLAN.md, the preview frame and speed: the variants, the warming
// request, the kept browser's reuse, incremental screenshots, the queue under two runs finishing
// at once, the change feed behind reload-on-change, and `roughbook start` starting the app.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { CommandContext } from '../commands/context.js';
import { finishWithScreenshots } from '../commands/done.js';
import { catchInterrupts, main } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { defaultEnvironment, readEnvironmentSync } from '../environment/read.js';
import {
  describeVariant,
  resolveVariants,
  screenshotName,
  withVariant
} from '../environment/variants.js';
import { hostPlatform } from '../launch/platform.js';
import {
  runCapture,
  runToEnd,
  serveUntil,
  stopStartedProcesses,
  trackProcess,
  type Stoppable
} from '../launch/processes.js';
import type { PtyModule } from '../launch/pty.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { saveRun } from '../runs/store.js';
import type { RunRecord } from '../runs/types.js';
import {
  KeptBrowser,
  takeScreenshot,
  type BrowserChild,
  type KeptBrowserOptions
} from '../screenshot/browser.js';
import { askPreview, screenshotIteration, screenshotPath } from '../screenshot/iteration.js';
import { ChangeFeed, changedKey } from '../server/changes.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const SERVER = 'http://localhost:4000';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};
const TARGET = { page: 'home', component: 'hero', iteration: 'iteration-01' };
/** Run ids as the backend makes them. */
const RUN_1 = 'eeeeeeee-eeee-4eee-8eee-000000000001';
const RUN_2 = 'eeeeeeee-eeee-4eee-8eee-000000000002';
const RUN_3 = 'eeeeeeee-eeee-4eee-8eee-000000000003';

function write(repo: string, file: string, content: string): void {
  const full = path.join(repo, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A linked repo with one iteration in it, as a run would have left it. */
async function repoWithIteration(): Promise<string> {
  const repo = await tempDir('roughbook-preview-');
  write(repo, 'package.json', '{"name":"app"}\n');
  write(repo, 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  write(repo, 'rough/roughbook.json', renderRepoLink(LINK));
  write(
    repo,
    'rough/home/hero/iteration-01/index.tsx',
    'export default function Hero() { return <h1>Quiet</h1>; }\n'
  );
  return repo;
}

function record(runId: string, iteration: string, startedAt: string): RunRecord {
  return {
    runId,
    orgId: ORG,
    project: 'site',
    page: 'home',
    component: 'hero',
    iteration,
    parent: null,
    kind: 'generate',
    agent: 'claude-code',
    mode: 'interactive',
    targetFolder: `rough/home/hero/${iteration}`,
    promptFile: `rough/home/hero/prompts/${runId}.md`,
    checks: [{ kind: 'entry-file', file: 'index.tsx' }],
    startedAt,
    status: 'started',
    finishedAt: null,
    outcome: null,
    failure: null,
    warnings: [],
    outOfScope: [],
    reported: null
  };
}

/** A command context that reaches nothing: a fake backend, recorded screenshots and warm requests. */
function contextFor(
  repo: string,
  options: {
    screenshot?: CommandContext['screenshot'];
    askPreview?: CommandContext['askPreview'];
  } = {}
): { context: CommandContext; api: StudioApi; warmed: string[]; shots: string[] } {
  const warmed: string[] = [];
  const shots: string[] = [];
  const backend = fakeFetch(request =>
    /\/finish$/.test(new URL(request.url).pathname) ? ok({ ok: true }) : refused('NOT_FOUND', 404)
  );
  const context: CommandContext = {
    io: recordingIo(),
    cwd: repo,
    env: {},
    repoRoot: repo,
    configDir: path.join(repo, '.config'),
    home: path.join(repo, '.home'),
    fetch: backend.fetch,
    sleep: async () => {},
    openUrl: async () => true,
    platform: 'linux',
    detect: async () => {
      throw new Error('not detected here');
    },
    launchTerminal: async () => {},
    launchEditor: async () => {},
    copyText: async () => true,
    runCommand: async () => ({ ok: false, stdout: '', stderr: '', code: null }),
    runHeadless: async () => ({
      ok: true,
      exitCode: 0,
      cancelled: false,
      error: null,
      usage: null
    }),
    screenshot:
      options.screenshot ??
      (async (_repo, devUrl, target) => {
        shots.push(`${devUrl} ${target.iteration}`);
        return { files: {}, warning: null };
      }),
    askPreview:
      options.askPreview ??
      (async url => {
        warmed.push(url);
        return { status: 200, url };
      }),
    waitForStop: async () => {},
    stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
  };
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'test',
    fetch: backend.fetch
  });
  return { context, api, warmed, shots };
}

describe('variants', () => {
  it('reads each variant word as a scheme, a locale with its direction, a text size, or a word of the setup’s own', () => {
    assert.deepEqual(describeVariant('light'), {
      id: 'light',
      label: 'Light',
      scheme: 'light',
      dir: null,
      lang: null,
      text: null
    });
    assert.equal(describeVariant('dark').scheme, 'dark');
    assert.equal(describeVariant('dark').label, 'Dark');
    assert.deepEqual(describeVariant('en'), {
      id: 'en',
      label: 'EN',
      scheme: null,
      dir: 'ltr',
      lang: 'en',
      text: null
    });
    assert.deepEqual(describeVariant('ar'), {
      id: 'ar',
      label: 'AR',
      scheme: null,
      dir: 'rtl',
      lang: 'ar',
      text: null
    });
    for (const rtl of ['he', 'fa', 'ur']) assert.equal(describeVariant(rtl).dir, 'rtl', rtl);
    assert.deepEqual(describeVariant('pt-br'), {
      id: 'pt-br',
      label: 'PT-BR',
      scheme: null,
      dir: 'ltr',
      lang: 'pt-BR',
      text: null
    });
    assert.equal(describeVariant('large-text').text, 'large');
    assert.equal(describeVariant('large-text').label, 'Large text');
    assert.deepEqual(describeVariant('compact'), {
      id: 'compact',
      label: 'Compact',
      scheme: null,
      dir: null,
      lang: null,
      text: null
    });
    assert.deepEqual(
      resolveVariants(['light', 'dark']).map(variant => variant.id),
      ['light', 'dark']
    );
  });

  it('adds the contract’s parameters to a preview’s address, none for the default', () => {
    const url = 'http://localhost:3000/rough-preview/home/hero/iteration-01';
    assert.equal(withVariant(url, describeVariant('light')), url);
    assert.equal(withVariant(url, null), url);
    assert.equal(withVariant(url, describeVariant('dark')), `${url}?roughbook-scheme=dark`);
    assert.equal(
      withVariant(url, describeVariant('ar')),
      `${url}?roughbook-dir=rtl&roughbook-lang=ar`
    );
    assert.equal(
      withVariant(
        'http://localhost:5173/rough-preview.html?key=a/b/iteration-01',
        describeVariant('dark')
      ),
      'http://localhost:5173/rough-preview.html?key=a/b/iteration-01&roughbook-scheme=dark'
    );
    assert.equal(withVariant(url, describeVariant('compact')), `${url}?roughbook-variant=compact`);
  });

  it('names a screenshot by its viewport alone for the first variant, and with the variant after', () => {
    const variants = resolveVariants(['light', 'dark', 'ar']);
    assert.equal(screenshotName('desktop', variants[0]!, variants), 'desktop');
    assert.equal(screenshotName('desktop', variants[1]!, variants), 'desktop-dark');
    assert.equal(screenshotName('mobile', variants[2]!, variants), 'mobile-ar');
    assert.equal(screenshotName('desktop', null, variants), 'desktop');
    assert.equal(
      screenshotPath('home', 'hero', 'iteration-01', 'desktop-dark'),
      'rough/.screenshots/home/hero/iteration-01/desktop-dark.png'
    );
  });
});

describe('the warming request', () => {
  it('asks the preview once and reads nothing of it, and says when nothing answered', async () => {
    const asked: { url: string; cancelled: boolean }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const entry = { url: String(input), cancelled: false };
      asked.push(entry);
      assert.ok(init?.signal, 'a timeout is set');
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<main>hello</main>'));
        },
        cancel() {
          entry.cancelled = true;
        }
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const url = 'http://localhost:3000/rough-preview/home/hero/iteration-01';
    assert.deepEqual(await askPreview(url, 5000, fetchImpl), { status: 200, url });
    assert.equal(asked.length, 1);
    assert.ok(asked[0]!.cancelled, 'the body is let go, not read');
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(await askPreview(url, 5000, down), null);
  });

  it('warms a finished run’s preview once, with screenshots off too', async () => {
    const repo = await repoWithIteration();
    await saveRun(repo, record(RUN_1, 'iteration-01', new Date(0).toISOString()));
    write(
      repo,
      'rough/home/hero/iteration-02/index.tsx',
      'export default function Hero() { return <h1>Loud</h1>; }\n'
    );
    await saveRun(repo, record(RUN_2, 'iteration-02', new Date(0).toISOString()));
    const { context, api, warmed, shots } = contextFor(repo);
    const outbox = outboxFor(repo);
    const first = await finishWithScreenshots(context, api, outbox, LINK, RUN_1, {
      devUrl: 'http://localhost:3000',
      screenshots: true,
      by: 'done'
    });
    assert.equal(first.run.status, 'finished');
    assert.deepEqual(warmed, ['http://localhost:3000/rough-preview/home/hero/iteration-01']);
    assert.deepEqual(shots, ['http://localhost:3000 iteration-01']);
    // Without screenshots the preview is still asked for once, so the dev server compiles it.
    const second = await finishWithScreenshots(context, api, outbox, LINK, RUN_2, {
      devUrl: 'http://localhost:3000',
      screenshots: false,
      by: 'done'
    });
    assert.equal(second.shots, null);
    assert.deepEqual(warmed, [
      'http://localhost:3000/rough-preview/home/hero/iteration-01',
      'http://localhost:3000/rough-preview/home/hero/iteration-02'
    ]);
    assert.deepEqual(shots, ['http://localhost:3000 iteration-01']);
    // A run that failed has nothing to warm.
    write(repo, 'rough/home/hero/iteration-03/index.tsx', 'export default 1;\n');
    await saveRun(repo, record(RUN_3, 'iteration-03', new Date(0).toISOString()));
    await finishWithScreenshots(context, api, outbox, LINK, RUN_3, {
      devUrl: 'http://localhost:3000',
      screenshots: true,
      outcome: 'failed',
      by: 'done'
    });
    assert.equal(warmed.length, 2);
  });
});

/**
 * A browser that is a DevTools protocol endpoint and nothing else: it answers every call over the
 * pipe, fires the load event after a navigation, and records what was asked of it. With
 * reloadOnce, the first page it settles reloads itself under the settle script, as a dev server's
 * loading screen does once it has compiled the page. It exits `exitMs` after Browser.close (with
 * null, never by itself), noting whether its profile was still there when it did; `stop` stands
 * in for ending its process tree.
 */
function fakeBrowser(options: { reloadOnce?: boolean; exitMs?: number | null } = {}) {
  let reloaded = false;
  const calls: string[] = [];
  let spawned = 0;
  let stops = 0;
  type Profile = { dir: string; thereAtExit?: boolean };
  const profiles: Profile[] = [];
  const spawn = (_file: string, args: string[]) => {
    spawned += 1;
    const flag = '--user-data-dir=';
    const profile: Profile = { dir: args.find(arg => arg.startsWith(flag))!.slice(flag.length) };
    profiles.push(profile);
    const input = new PassThrough();
    const output = new PassThrough();
    const reply = (message: object) => output.write(`${JSON.stringify(message)}\0`);
    let buffer = '';
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null as number | null,
      stdio: [null, null, null, input, output],
      kill() {
        exit(1);
      }
    });
    const exit = (code: number) => {
      if (child.exitCode !== null) return;
      profile.thereAtExit = fs.existsSync(profile.dir);
      child.exitCode = code;
      child.emit('exit', code, null);
    };
    input.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const { id, method, sessionId, params } = JSON.parse(buffer.slice(0, end)) as {
          id: number;
          method: string;
          sessionId?: string;
          params?: { expression?: string };
        };
        buffer = buffer.slice(end + 1);
        calls.push(method);
        switch (method) {
          case 'Target.createTarget':
            reply({ id, result: { targetId: `target-${calls.length}` } });
            break;
          case 'Target.attachToTarget':
            reply({ id, result: { sessionId: `session-${calls.length}` } });
            break;
          case 'Page.navigate':
            reply({ id, result: { frameId: 'frame' } });
            reply({ method: 'Page.loadEventFired', sessionId, params: {} });
            break;
          case 'Runtime.evaluate':
            if (
              options.reloadOnce &&
              !reloaded &&
              params?.expression?.includes('__roughbookReady')
            ) {
              reloaded = true;
              reply({ id, error: { code: -32000, message: 'Execution context was destroyed.' } });
              reply({ method: 'Page.loadEventFired', sessionId, params: {} });
              break;
            }
            reply({ id, result: { result: { value: true } } });
            break;
          case 'Page.captureScreenshot':
            reply({ id, result: { data: Buffer.from('png').toString('base64') } });
            break;
          case 'Browser.close':
            reply({ id, result: {} });
            if (options.exitMs !== null) setTimeout(() => exit(0), options.exitMs ?? 0);
            break;
          default:
            reply({ id, result: {} });
        }
      }
    });
    return child;
  };
  const stop = async (child: BrowserChild) => {
    stops += 1;
    child.kill();
  };
  return { spawn, stop, calls, profiles, spawned: () => spawned, stops: () => stops };
}

/** A folder of the test's own for a kept browser's profiles, with nothing else in it. */
async function profilesDir(): Promise<string> {
  const dir = path.join(await tempDir('roughbook-profiles-'), 'browsers');
  fs.mkdirSync(dir);
  return dir;
}

/** A kept browser on the fake, its profiles in a folder of the test's own. */
async function keptFake(fake: ReturnType<typeof fakeBrowser>, options: KeptBrowserOptions = {}) {
  const profiles = await profilesDir();
  const browser = new KeptBrowser('/fake/chrome', {
    spawn: fake.spawn,
    stop: fake.stop,
    profiles,
    settleMs: 0,
    ...options
  });
  return { browser, profiles };
}

/** One screenshot through `browser`, into a folder of the test's own. */
async function shotThrough(browser: KeptBrowser): Promise<boolean> {
  return takeScreenshot({
    browser,
    url: 'http://localhost:3000/rough-preview/home/hero/iteration-01',
    file: path.join(await tempDir('roughbook-browser-'), 'shot.png'),
    size: { width: 1440, height: 900, mobile: false },
    overlays: []
  });
}

/** A process that runs until killed, and one that has ended: their numbers, for profile records. */
async function processes() {
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const ended = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(resolve => ended.once('exit', resolve));
  return { live: live.pid!, ended: ended.pid!, stop: () => live.kill() };
}

/** A profile as a studio leaves it in its folder: a few files, and its record beside it. */
function leaveProfile(folder: string, name: string, record: object | null): string {
  const profile = path.join(folder, name);
  write(profile, 'Default/Preferences', '{}');
  if (record) fs.writeFileSync(`${profile}.json`, JSON.stringify(record));
  return profile;
}

const DAY_MS = 24 * 60 * 60_000;

/** Makes a profile and its record look two days old. */
function makeOld(profile: string): void {
  const when = new Date(Date.now() - 2 * DAY_MS);
  for (const file of [profile, `${profile}.json`]) {
    if (fs.existsSync(file)) fs.utimesSync(file, when, when);
  }
}

/**
 * Holds a profile's lock as its running browser would: Chrome keeps `lockfile` open on Windows,
 * and links `SingletonLock` to its host and process elsewhere. Returns what lets it go, once
 * the file is closed.
 */
async function holdLock(profile: string, pid: number): Promise<() => Promise<void>> {
  if (hostPlatform() !== 'win32') {
    fs.symlinkSync(`${os.hostname()}-${pid}`, path.join(profile, 'SingletonLock'));
    return async () => {};
  }
  const lock = path.join(profile, 'lockfile');
  const holder = spawn(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$f = [System.IO.File]::Open('${lock}', 'OpenOrCreate', 'ReadWrite', 'None'); 'held'; [Console]::In.ReadLine() | Out-Null; $f.Close()`
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
  );
  await new Promise(resolve => holder.stdout.once('data', resolve));
  return () =>
    new Promise(resolve => {
      holder.once('exit', () => resolve());
      holder.stdin.end('\n');
    });
}

describe('the kept browser', () => {
  it('starts once for the session, reuses its tab for each screenshot, and closes when told', async () => {
    const fake = fakeBrowser();
    const { browser } = await keptFake(fake);
    const dir = await tempDir('roughbook-browser-');
    const size = { name: 'desktop', width: 1440, height: 900, mobile: false };
    const shot = (file: string, variant: ReturnType<typeof describeVariant> | null) =>
      takeScreenshot({
        browser,
        url: 'http://localhost:3000/rough-preview/home/hero/iteration-01',
        file: path.join(dir, file),
        size,
        overlays: [],
        variant
      });
    assert.ok(await shot('one.png', null));
    assert.ok(await shot('two.png', describeVariant('dark')));
    assert.ok(await shot('three.png', describeVariant('ar')));
    assert.equal(fake.spawned(), 1, 'one browser for the three');
    assert.equal(fake.calls.filter(call => call === 'Target.createTarget').length, 1, 'one tab');
    assert.equal(fake.calls.filter(call => call === 'Page.captureScreenshot').length, 3);
    // Each job navigates to its page, and gives the tab back blank for the next.
    assert.equal(fake.calls.filter(call => call === 'Page.navigate').length, 6);
    assert.equal(fake.calls.filter(call => call === 'Browser.close').length, 0);
    assert.ok(fs.existsSync(path.join(dir, 'three.png')));
    assert.ok(browser.running);
    await browser.close();
    assert.equal(fake.calls.filter(call => call === 'Browser.close').length, 1);
    assert.ok(!browser.running);
    // Asked again after closing, it starts anew.
    assert.ok(await shot('four.png', null));
    assert.equal(fake.spawned(), 2);
    await browser.close();
  });

  it('answers no screenshot, and does not crash, when the browser dies as it starts', async () => {
    // Chromium with no usable sandbox (a container) exits at once, and its pipe breaks.
    const spawn = () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        stdio: [null, null, null, input, output],
        kill() {}
      });
      setImmediate(() => {
        output.destroy(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
        input.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
        child.exitCode = 1;
        child.emit('exit', 1, null);
      });
      return child;
    };
    const profiles = await profilesDir();
    const browser = new KeptBrowser('/fake/chromium', { spawn, profiles, settleMs: 0 });
    const dir = await tempDir('roughbook-browser-');
    const shot = await takeScreenshot({
      browser,
      url: 'http://localhost:3000/rough-preview/home/hero/iteration-01',
      file: path.join(dir, 'none.png'),
      size: { width: 1440, height: 900, mobile: false },
      overlays: []
    });
    assert.ok(!shot);
    assert.ok(!fs.existsSync(path.join(dir, 'none.png')));
    await browser.close();
    assert.deepEqual(fs.readdirSync(profiles), [], 'what it left is removed');
  });

  it('waits again for a page that reloads itself while it settles, as a loading screen does', async () => {
    const fake = fakeBrowser({ reloadOnce: true });
    const { browser } = await keptFake(fake);
    const dir = await tempDir('roughbook-browser-');
    assert.ok(
      await takeScreenshot({
        browser,
        url: 'http://localhost:3000/rough-preview/home/hero/iteration-01',
        file: path.join(dir, 'after-reload.png'),
        size: { width: 1440, height: 900, mobile: false },
        overlays: []
      })
    );
    // The fonts and the settle script once on the loading screen, and again on the page itself.
    assert.equal(fake.calls.filter(call => call === 'Runtime.evaluate').length, 4);
    assert.ok(fs.existsSync(path.join(dir, 'after-reload.png')));
    await browser.close();
  });

  it('emulates each variant on the page: the colour scheme and the locale', async () => {
    const fake = fakeBrowser();
    const { browser } = await keptFake(fake);
    const sent: { method: string; params: Record<string, unknown> }[] = [];
    browser.onSend = (method, params) => void sent.push({ method, params });
    const dir = await tempDir('roughbook-browser-');
    const size = { name: 'mobile', width: 390, height: 844, mobile: true };
    await takeScreenshot({
      browser,
      url: 'http://localhost:3000/x',
      file: path.join(dir, 'dark.png'),
      size,
      overlays: ['dev-overlay'],
      variant: describeVariant('dark')
    });
    const media = sent.find(item => item.method === 'Emulation.setEmulatedMedia')!;
    assert.ok(
      (media.params.features as { name: string; value: string }[]).some(
        feature => feature.name === 'prefers-color-scheme' && feature.value === 'dark'
      ),
      JSON.stringify(media.params)
    );
    const metrics = sent.find(item => item.method === 'Emulation.setDeviceMetricsOverride')!;
    assert.equal(metrics.params.width, 390);
    assert.equal(metrics.params.mobile, true);
    sent.length = 0;
    await takeScreenshot({
      browser,
      url: 'http://localhost:3000/x',
      file: path.join(dir, 'ar.png'),
      size,
      overlays: [],
      variant: describeVariant('ar')
    });
    const locale = sent.find(item => item.method === 'Emulation.setLocaleOverride')!;
    assert.equal(locale.params.locale, 'ar');
    const light = sent.find(item => item.method === 'Emulation.setEmulatedMedia')!;
    assert.ok(
      (light.params.features as { name: string; value: string }[]).some(
        feature => feature.name === 'prefers-color-scheme' && feature.value === 'light'
      ),
      'a variant with no scheme is photographed light, the same on every machine'
    );
    await browser.close();
  });
});

describe("the kept browser's profiles", () => {
  it('are removed only once the browser has exited, from a folder of the studio’s own', async () => {
    const fake = fakeBrowser({ exitMs: 150 });
    const { browser, profiles } = await keptFake(fake);
    assert.ok(await shotThrough(browser));
    const [profile] = fake.profiles;
    assert.equal(path.dirname(profile!.dir), profiles);
    assert.ok(fs.existsSync(`${profile!.dir}.json`), 'beside its record');
    await browser.close();
    assert.equal(profile!.thereAtExit, true, 'still there when the browser exited');
    assert.deepEqual(fs.readdirSync(profiles), [], 'the profile and its record removed after');
    assert.equal(fake.stops(), 0, 'a browser that exits by itself is not ended');
  });

  it('ends a browser that will not exit in time with everything it started, then removes its profile', async () => {
    const fake = fakeBrowser({ exitMs: null });
    const { browser, profiles } = await keptFake(fake, { exitMs: 100 });
    assert.ok(await shotThrough(browser));
    await browser.close();
    assert.equal(fake.stops(), 1);
    assert.equal(fake.profiles[0]!.thereAtExit, true);
    assert.deepEqual(fs.readdirSync(profiles), []);
  });

  it('lets every caller of close return once the profile is gone', async () => {
    const fake = fakeBrowser({ exitMs: 100 });
    const { browser, profiles } = await keptFake(fake);
    assert.ok(await shotThrough(browser));
    const first = browser.close();
    await browser.close();
    assert.deepEqual(fs.readdirSync(profiles), []);
    await first;
    assert.equal(fake.calls.filter(call => call === 'Browser.close').length, 1);
  });

  it('that could not be removed are removed on a later start', async () => {
    const { live, ended, stop } = await processes();
    try {
      const fake = fakeBrowser();
      const { browser, profiles } = await keptFake(fake);
      // Another studio's, whose browser's helpers held it past the end; this process's own
      // earlier one; a record whose profile went; a day-old one whose record names numbers in
      // use again; and a day-old one whose record was lost.
      leaveProfile(profiles, 'aaaaaaaaaaaa', { studio: ended, browser: ended });
      leaveProfile(profiles, 'bbbbbbbbbbbb', { studio: process.pid, browser: ended });
      fs.writeFileSync(
        path.join(profiles, 'cccccccccccc.json'),
        JSON.stringify({ studio: ended, browser: null })
      );
      makeOld(leaveProfile(profiles, 'dddddddddddd', { studio: live, browser: live }));
      makeOld(leaveProfile(profiles, 'eeeeeeeeeeee', null));
      assert.ok(await shotThrough(browser));
      await browser.close();
      assert.deepEqual(fs.readdirSync(profiles), []);
    } finally {
      stop();
    }
  });

  it('are never touched while another running studio may be using them', async () => {
    const { live, ended, stop } = await processes();
    let unlock = async () => {};
    try {
      const fake = fakeBrowser();
      const { browser, profiles } = await keptFake(fake);
      // In use; its browser not started yet; its studio still running, its browser gone; and
      // the record of a profile not made yet.
      leaveProfile(profiles, 'aaaaaaaaaaaa', { studio: live, browser: live });
      leaveProfile(profiles, 'bbbbbbbbbbbb', { studio: live, browser: null });
      leaveProfile(profiles, 'cccccccccccc', { studio: live, browser: ended });
      fs.writeFileSync(
        path.join(profiles, 'dddddddddddd.json'),
        JSON.stringify({ studio: live, browser: null })
      );
      // A folder whose record is not written yet.
      leaveProfile(profiles, 'eeeeeeeeeeee', null);
      // A browser that has run a day: its lock is held.
      const old = leaveProfile(profiles, 'ffffffffffff', { studio: live, browser: live });
      unlock = await holdLock(old, live);
      makeOld(old);
      const before = fs.readdirSync(profiles).sort();
      assert.ok(await shotThrough(browser));
      await browser.close();
      assert.deepEqual(fs.readdirSync(profiles).sort(), before);
      assert.ok(fs.existsSync(path.join(old, 'Default', 'Preferences')));
    } finally {
      await unlock();
      stop();
    }
  });
});

describe('an interrupted command', () => {
  /** The process as catchInterrupts sees it: signals the test sends, and the exits asked for. */
  function fakeHost(onExit: (code: number) => void = () => {}) {
    const exits: number[] = [];
    const host = Object.assign(new EventEmitter(), {
      exit(code: number) {
        exits.push(code);
        onExit(code);
      }
    });
    return { host, exits };
  }

  it('closes the kept browser and removes its profile before the process exits', async () => {
    const fake = fakeBrowser({ exitMs: 100 });
    const { browser, profiles } = await keptFake(fake);
    assert.ok(await shotThrough(browser));
    let left: string[] | null = null;
    let exited!: () => void;
    const exiting = new Promise<void>(resolve => (exited = resolve));
    const { host, exits } = fakeHost(() => {
      left = fs.readdirSync(profiles);
      exited();
    });
    const interrupts = catchInterrupts(host, () => browser.close());
    host.emit('SIGINT');
    await exiting;
    assert.deepEqual(exits, [130]);
    assert.deepEqual(left, [], 'the profile was gone before the exit');
    interrupts.release();
    assert.equal(host.listenerCount('SIGINT'), 0);
    assert.equal(host.listenerCount('SIGTERM'), 0);
  });

  it('exits at once on another signal while the browser closes', async () => {
    const { host, exits } = fakeHost();
    const interrupts = catchInterrupts(host, () => new Promise(() => {}));
    host.emit('SIGTERM');
    assert.deepEqual(exits, []);
    host.emit('SIGTERM');
    assert.deepEqual(exits, [143]);
    interrupts.release();
  });

  it('ends the wait of a command waiting for a stop, which then closes its browser itself', async () => {
    const { host, exits } = fakeHost();
    let closed = 0;
    const interrupts = catchInterrupts(host, async () => {
      closed += 1;
    });
    const waiting = interrupts.waitForStop();
    host.emit('SIGINT');
    await waiting;
    assert.equal(closed, 0);
    assert.deepEqual(exits, []);
    interrupts.release();
  });

  /** A started process as the studio keeps it in hand: a pid nothing signals, and its exit. */
  function fakeChild(pid: number) {
    return Object.assign(new EventEmitter(), { pid, exitCode: null as number | null, kill() {} });
  }

  /** Stands in for stopProcess, so no real pid is signalled: the process is noted, and exits. */
  function fakeStop(stopped: number[]) {
    return async (child: Stoppable) => {
      stopped.push(child.pid!);
      const fake = child as ReturnType<typeof fakeChild>;
      fake.exitCode = 1;
      fake.emit('exit');
    };
  }

  it('stops the processes the command started that still run, each once', async () => {
    const stopped: number[] = [];
    const stop = fakeStop(stopped);
    trackProcess(fakeChild(101), stop);
    const ended = trackProcess(fakeChild(102), stop);
    trackProcess(fakeChild(103), stop);
    ended.exitCode = 0;
    ended.emit('exit');
    await stopStartedProcesses();
    assert.deepEqual(stopped.sort(), [101, 103]);
    await stopStartedProcesses();
    assert.deepEqual(stopped.sort(), [101, 103], 'a stopped process is not stopped again');
  });

  // What main's own close does when interrupted (the processes stopped before the exit, nothing
  // started after) is in interrupt.test.ts, since it holds for the rest of the process.

  /** Ports nothing listens on now, each its own. */
  async function freePorts(count: number): Promise<number[]> {
    const servers = Array.from({ length: count }, () => http.createServer());
    await Promise.all(
      servers.map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)))
    );
    const ports = servers.map(server => (server.address() as AddressInfo).port);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    return ports;
  }

  /** A server of its own, as an app's start command runs one, answering at `port`. */
  const serverLine = (port: number) =>
    `node -e "require('node:http').createServer((q, s) => s.end('up')).listen(${port}, '127.0.0.1')"`;

  async function answers(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      return true;
    } catch {
      return false;
    }
  }

  it('stops a server serveUntil started, while its address is waited for and once it answers', async () => {
    const cwd = await tempDir('roughbook-serve-');
    const [side, never, own] = await freePorts(3);
    try {
      // Up at once at an address of its own, while the one waited for never answers.
      const waiting = serveUntil(serverLine(side!), cwd, `http://127.0.0.1:${never}/`, 60_000);
      let up = false;
      for (let tries = 0; !up && tries < 40; tries += 1) {
        up = await answers(`http://127.0.0.1:${side}/`);
        if (!up) await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(up, 'the server came up');
      await stopStartedProcesses();
      assert.equal(await answers(`http://127.0.0.1:${side}/`), false, 'stopped while it started');
      const stoppedAt = Date.now();
      assert.equal(await waiting, null);
      assert.ok(Date.now() - stoppedAt < 15_000, 'the wait ended with the server');

      const served = await serveUntil(serverLine(own!), cwd, `http://127.0.0.1:${own}/`, 20_000);
      assert.ok(served, 'served');
      await stopStartedProcesses();
      assert.equal(await answers(`http://127.0.0.1:${own}/`), false, 'stopped once it answered');
      const stopAt = Date.now();
      await served.stop();
      assert.ok(Date.now() - stopAt < 2000, 'a server already stopped is not waited for');
    } finally {
      await stopStartedProcesses();
    }
  });

  it('stops a command run to its end, such as a build or the snapshot command', async () => {
    const cwd = await tempDir('roughbook-run-');
    const line = `node -e "setTimeout(() => {}, 60000)"`;
    const started = Date.now();
    const build = runToEnd(line, cwd, 120_000);
    const snapshot = runCapture(line, cwd, 120_000);
    await stopStartedProcesses();
    assert.deepEqual(await build, { code: 1 });
    assert.equal((await snapshot).code, 1);
    assert.ok(Date.now() - started < 15_000, 'ended with the stop, not at the timeout');
  });
});

describe('incremental screenshots', () => {
  it('takes every viewport and variant once, and again only when the iteration’s files changed', async () => {
    const repo = await repoWithIteration();
    const taken: { url: string; file: string; variant: string | null }[] = [];
    const take: typeof takeScreenshot = async input => {
      taken.push({ url: input.url, file: input.file, variant: input.variant?.id ?? null });
      fs.mkdirSync(path.dirname(input.file), { recursive: true });
      fs.writeFileSync(input.file, 'png');
      return true;
    };
    const check = async (url: string) => ({ status: 200, url });
    const environment = {
      ...defaultEnvironment(LINK),
      viewports: [
        { name: 'desktop', width: 1440, height: 900, mobile: false },
        { name: 'mobile', width: 390, height: 844, mobile: true }
      ],
      variants: ['light', 'dark', 'ar']
    };
    const shoot = (options?: { force?: boolean }) =>
      screenshotIteration(
        repo,
        'http://localhost:3000',
        TARGET,
        {},
        take,
        '/fake/chrome',
        check,
        environment,
        options
      );
    const first = await shoot();
    assert.equal(first.warning, null);
    assert.ok(!first.skipped);
    assert.deepEqual(Object.keys(first.files).sort(), [
      'desktop',
      'desktop-ar',
      'desktop-dark',
      'mobile',
      'mobile-ar',
      'mobile-dark'
    ]);
    assert.equal(
      first.files['desktop-dark'],
      'rough/.screenshots/home/hero/iteration-01/desktop-dark.png'
    );
    assert.equal(taken.length, 6);
    const dark = taken.find(
      item => item.variant === 'dark' && item.file.endsWith('desktop-dark.png')
    )!;
    assert.equal(
      dark.url,
      'http://localhost:3000/rough-preview/home/hero/iteration-01?roughbook-scheme=dark'
    );
    assert.ok(taken.some(item => item.url.endsWith('?roughbook-dir=rtl&roughbook-lang=ar')));

    // Nothing changed: nothing is taken, and the files are listed as they are.
    const again = await shoot();
    assert.equal(again.skipped, true);
    assert.equal(taken.length, 6);
    assert.deepEqual(again.files, first.files);
    assert.equal(again.warning, null);

    // A change to the iteration takes them again; so does asking for it.
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function Hero() { return <h1>Quieter</h1>; }\n'
    );
    const changed = await shoot();
    assert.ok(!changed.skipped);
    assert.equal(taken.length, 12);
    const forced = await shoot({ force: true });
    assert.ok(!forced.skipped);
    assert.equal(taken.length, 18);
    // A screenshot removed by hand is taken again.
    fs.rmSync(
      path.join(repo, 'rough', '.screenshots', 'home', 'hero', 'iteration-01', 'mobile.png')
    );
    const missing = await shoot();
    assert.ok(!missing.skipped);
    assert.equal(taken.length, 24);
  });

  it('takes the answer of a warming request instead of asking again', async () => {
    const repo = await repoWithIteration();
    let checks = 0;
    const check = async (url: string) => {
      checks += 1;
      return { status: 200, url };
    };
    const take: typeof takeScreenshot = async input => {
      fs.mkdirSync(path.dirname(input.file), { recursive: true });
      fs.writeFileSync(input.file, 'png');
      return true;
    };
    const url = 'http://localhost:3000/rough-preview/home/hero/iteration-01';
    const shots = await screenshotIteration(
      repo,
      'http://localhost:3000',
      TARGET,
      {},
      take,
      '/fake/chrome',
      check,
      defaultEnvironment(LINK),
      { answer: { status: 200, url } }
    );
    assert.equal(checks, 0);
    assert.equal(Object.keys(shots.files).length, 2);
    // What the warming request found wrong is said the same way.
    const refusedShots = await screenshotIteration(
      repo,
      'http://localhost:3000',
      TARGET,
      {},
      take,
      '/fake/chrome',
      check,
      defaultEnvironment(LINK),
      { answer: { status: 404, url }, force: true }
    );
    assert.match(refusedShots.warning ?? '', /answered 404/);
    assert.equal(checks, 0);
  });
});

describe('the queue under two runs finishing at once', () => {
  it('takes one run’s screenshots after the other’s, through the repo’s queue', async () => {
    const repo = await repoWithIteration();
    write(
      repo,
      'rough/home/hero/iteration-02/index.tsx',
      'export default function Hero() { return <h1>Loud</h1>; }\n'
    );
    await saveRun(repo, record(RUN_1, 'iteration-01', new Date(0).toISOString()));
    await saveRun(repo, record(RUN_2, 'iteration-02', new Date(0).toISOString()));
    const order: string[] = [];
    const { context, api } = contextFor(repo, {
      screenshot: async (_repo, _devUrl, target) => {
        order.push(`${target.iteration} start`);
        await new Promise(resolve =>
          setTimeout(resolve, target.iteration === 'iteration-01' ? 60 : 5)
        );
        order.push(`${target.iteration} end`);
        return { files: { desktop: 'x' }, warning: null };
      }
    });
    const outbox = outboxFor(repo);
    const options = { devUrl: 'http://localhost:3000', screenshots: true, by: 'done' as const };
    const [first, second] = await Promise.all([
      finishWithScreenshots(context, api, outbox, LINK, RUN_1, options),
      finishWithScreenshots(context, api, outbox, LINK, RUN_2, options)
    ]);
    assert.equal(first.run.status, 'finished');
    assert.equal(second.run.status, 'finished');
    assert.ok(first.shots && second.shots, 'both got their screenshots');
    // Whichever finished first went first; the other waited for it to end rather than overlapping.
    assert.equal(order.length, 4);
    assert.equal(order[1], order[0]!.replace('start', 'end'), order.join(', '));
    assert.equal(order[3], order[2]!.replace('start', 'end'), order.join(', '));
    assert.notEqual(order[0], order[2]);
  });
});

describe('the change feed', () => {
  it('turns a written file into its iteration’s key, and ignores what is not an iteration', () => {
    assert.equal(changedKey('rough/home/hero/iteration-01/index.tsx'), 'home/hero/iteration-01');
    assert.equal(
      changedKey('rough/home/hero/iteration-01/parts/Card.tsx'),
      'home/hero/iteration-01'
    );
    assert.equal(changedKey('rough/home/hero/iteration-01'), 'home/hero/iteration-01');
    assert.equal(changedKey('rough/home/hero/prompts/run.md'), null);
    assert.equal(changedKey('rough/home/hero/meta.json'), null);
    assert.equal(changedKey('rough/.roughbook/runs/x.json'), null);
    assert.equal(changedKey('rough/.screenshots/home/hero/iteration-01/desktop.png'), null);
    assert.equal(changedKey('rough/preview-registry.ts'), null);
    assert.equal(changedKey('rough/doctor-check-ab12/sample/iteration-01/index.tsx'), null);
    assert.equal(changedKey('src/app/page.tsx'), null);
    assert.equal(changedKey('rough/Home/hero/iteration-01/index.tsx'), null);
  });

  it('numbers changes, answers what changed since a number, and waits for the next', async () => {
    const feed = new ChangeFeed();
    assert.deepEqual(feed.since(0), { seq: 0, keys: [] });
    feed.note('home/hero/iteration-01');
    feed.note('home/hero/iteration-02');
    feed.note('home/hero/iteration-01');
    assert.deepEqual(feed.since(0), {
      seq: 3,
      keys: ['home/hero/iteration-02', 'home/hero/iteration-01']
    });
    assert.deepEqual(feed.since(2), { seq: 3, keys: ['home/hero/iteration-01'] });
    assert.deepEqual(feed.since(3), { seq: 3, keys: [] });
    // Waiting answers at once when something is newer, and when told to stop waiting.
    assert.deepEqual(await feed.wait(2, 1000), { seq: 3, keys: ['home/hero/iteration-01'] });
    const waiting = feed.wait(3, 5000);
    feed.note('home/hero/iteration-03');
    assert.deepEqual(await waiting, { seq: 4, keys: ['home/hero/iteration-03'] });
    assert.deepEqual(await feed.wait(4, 10), { seq: 4, keys: [] });
  });
});

type Spawned = { file: string; args: string[]; cwd: string };

/** A pseudo-terminal that runs nothing and records what it was asked to run. */
function fakePty(): { module: PtyModule; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const module: PtyModule = {
    spawn(file, args, options) {
      spawned.push({ file, args, cwd: options.cwd });
      return {
        pid: spawned.length,
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
        write() {},
        resize() {},
        kill() {}
      };
    }
  };
  return { module, spawned };
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

describe('roughbook start', () => {
  async function studio(options: {
    answers?: string[];
    up?: boolean;
    environment?: string;
    approve?: boolean;
  }) {
    const repo = await repoWithIteration();
    if (options.environment) write(repo, 'rough/environment.md', options.environment);
    if (options.approve) {
      await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, LINK)));
    }
    const configDir = await tempDir('roughbook-config-');
    await saveCredentials(configDir, {
      server: SERVER,
      installId: 'install-1',
      token: 'rbi_token',
      signedInAs: 'dana@example.test',
      savedAt: new Date(0).toISOString()
    });
    const backend = fakeFetch(request =>
      /\/me$/.test(new URL(request.url).pathname)
        ? ok({ user: { id: 'u1', email: 'dana@example.test', name: null }, webUrl: null })
        : refused('NOT_FOUND', 404)
    );
    const asked: string[] = [];
    const pty = fakePty();
    const io = recordingIo(options.answers ?? []);
    const port = await freePort();
    const code = await main(['start', '--no-open', '--port', String(port)], {
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: backend.fetch,
      sleep: async () => {},
      openUrl: async () => true,
      detect: async adapter => notFound(adapter),
      askPreview: async url => {
        asked.push(url);
        return options.up ? { status: 200, url } : null;
      },
      pty: { ok: true, pty: pty.module },
      waitForStop: async () => {}
    });
    return { repo, code, io, asked, spawned: pty.spawned };
  }

  it('starts the app with the approved start command in the terminal dock when nothing answers at its address', async () => {
    const environment = `---
contract: 1
recipe: next
start: my-dev-server --port 3456 @ http://localhost:3456
---
`;
    const {
      code,
      io,
      asked,
      spawned,
      repo: used
    } = await studio({
      environment,
      answers: ['y']
    });
    assert.equal(code, 0, io.errors.join('\n'));
    assert.ok(asked.includes('http://localhost:3456/'), asked.join(', '));
    assert.equal(spawned.length, 1, io.lines.join('\n'));
    assert.equal(spawned[0]!.file, 'my-dev-server');
    assert.deepEqual(spawned[0]!.args, ['--port', '3456']);
    assert.equal(spawned[0]!.cwd, used);
    assert.ok(
      io.lines.some(line => /Starting the app/.test(line) && line.includes('my-dev-server')),
      io.lines.join('\n')
    );
    // The approval was asked for and kept, as doctor keeps it.
    assert.ok(io.questions.some(question => /Approve/.test(question)));
    const approved = readEnvironmentSync(used, LINK);
    assert.equal(approved.start.command, 'my-dev-server --port 3456');
  });

  it('runs the start command in the declared shell, and leaves a running app alone', async () => {
    const environment = `---
contract: 1
recipe: next
shell: bash
start: npm run dev -- --port 3457 @ http://localhost:3457
---
`;
    const running = await studio({ environment, up: true, answers: ['y'] });
    assert.equal(running.code, 0, running.io.errors.join('\n'));
    assert.equal(running.spawned.length, 0, 'something answers there already');
    assert.ok(running.io.lines.some(line => /answers at http:\/\/localhost:3457/.test(line)));

    const down = await studio({ environment, answers: ['y'] });
    assert.equal(down.spawned.length, 1);
    // By its path where the PATH has it (the pseudo-terminal needs one), by name otherwise.
    assert.match(down.spawned[0]!.file, /(^|[\\/])bash(\.exe)?$/i);
    assert.deepEqual(down.spawned[0]!.args, ['-c', 'npm run dev -- --port 3457']);
  });

  it('starts nothing without approval, and says how to start the app by hand', async () => {
    const environment = `---
contract: 1
recipe: next
start: my-dev-server @ http://localhost:3458
---
`;
    const { code, io, spawned } = await studio({ environment, answers: ['n'] });
    assert.equal(code, 0, io.errors.join('\n'));
    assert.equal(spawned.length, 0);
    assert.ok(io.lines.some(line => /my-dev-server/.test(line) && /start/i.test(line)));
    // Approved beforehand, no question is asked and the app starts.
    const approved = await studio({ environment, approve: true });
    assert.equal(approved.code, 0, approved.io.errors.join('\n'));
    assert.deepEqual(approved.io.questions, []);
    assert.equal(approved.spawned.length, 1);
    assert.equal(approved.spawned[0]!.file, 'my-dev-server');
    // With no environment file the recipe's own start command is offered, and runs through
    // Node.js and npm's script rather than a shell.
    const recipe = await studio({ answers: ['y'] });
    assert.equal(recipe.code, 0, recipe.io.errors.join('\n'));
    assert.equal(recipe.spawned.length, 1);
    assert.deepEqual(recipe.spawned[0]!.args.slice(-2), ['run', 'dev']);
  });
});
