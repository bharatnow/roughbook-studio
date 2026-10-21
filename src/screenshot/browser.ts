// Screenshots and probes of an iteration through the repo's own dev server, at every viewport and
// variant the environment names, so the local UI can still show it after the app's code moves on
// and the live preview no longer compiles. Uses a Chromium browser already on the machine,
// headless: nothing is downloaded. One browser is kept for the session and its tab reused
// (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed"): starting Chrome cost most of every screenshot before.
// Ported from roughbook runner/screenshot.ts (v2-local), which knew Windows and macOS; Linux and
// Chromium are added. Headless Chrome will not make a window narrower than about 500 pixels, so
// the viewport is set through the DevTools protocol over a pipe instead of --window-size, and
// Chrome is preferred to Edge, which fills saved passwords in even into a fresh profile.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { Probe } from '../doctor/types.js';
import { defaultEnvironment } from '../environment/read.js';
import type { ResolvedVariant } from '../environment/variants.js';

/**
 * Runs in the page before its own scripts: notes the preview's ready message (its `Ready` posts
 * to the parent, which is the page itself when nothing frames it), and hides the app's own
 * development overlays, whose badges would otherwise sit in the corner of every shot.
 */
export function pageSetup(overlays: string[]): string {
  const hidden = overlays.map(selector => `${selector} { display: none !important; }`).join(' ');
  return `addEventListener('message', function (event) {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.roughbook === 'ready') window.__roughbookReady = true;
  if (event.data.roughbook === 'error') window.__roughbookError = String(event.data.message || 'error');
});
addEventListener('DOMContentLoaded', function () {
  var style = document.createElement('style');
  style.textContent = ${JSON.stringify(hidden)};
  document.head.appendChild(style);
});`;
}

/** The page setup for a repo with no environment file: its recipe's overlays. */
export const PAGE_SETUP = pageSetup(defaultEnvironment().overlays);

/**
 * Resolves once the iteration has rendered and settled: the ready message has come (the page has
 * hydrated, which in a dev server compiling on first request can take seconds), and no finite
 * animation is still running, so text that fades in is in the shot. Each wait has a cap, so a page
 * without the route's ready message, or with an endless animation, is photographed anyway.
 */
export function settledScript(maxWaitMs: number): string {
  return `new Promise(function (resolve) {
  var start = Date.now();
  function moving() {
    return document.getAnimations().some(function (animation) {
      var end = animation.effect && animation.effect.getComputedTiming().endTime;
      return animation.playState === 'running' && typeof end === 'number' && isFinite(end);
    });
  }
  (function check() {
    var waited = Date.now() - start;
    var ready = window.__roughbookReady === true || window.__roughbookError !== undefined || waited > ${maxWaitMs};
    if (ready && (!moving() || waited > ${maxWaitMs + 6000})) resolve(true);
    else setTimeout(check, 100);
  })();
})`;
}

/** The settle script for a screenshot: a page that never says ready is photographed after 20 s. */
export const SETTLED = settledScript(20000);

/**
 * Browsers follow the OS's own reduced-motion setting (Windows' "Animation effects" off) and its
 * colour scheme, so the same iteration would be photographed differently on each machine: without
 * its entrance, or with a dark app body (a new app's default, in dark mode) as a black band below
 * a short iteration. Full motion, waited out by SETTLED, and the light scheme show every
 * iteration the same, wherever it is taken; a dark variant asks for the dark scheme instead.
 */
export const EMULATED_MEDIA = [
  { name: 'prefers-reduced-motion', value: 'no-preference' },
  { name: 'prefers-color-scheme', value: 'light' }
];

/** The media a page is photographed under in one variant: light unless the variant is dark. */
export function emulatedMedia(variant: ResolvedVariant | null | undefined) {
  return EMULATED_MEDIA.map(feature =>
    feature.name === 'prefers-color-scheme' && variant?.scheme === 'dark'
      ? { name: feature.name, value: 'dark' }
      : feature
  );
}

export type ScreenshotSize = { width: number; height: number; mobile: boolean };

/** Chrome or Chromium, then Edge, or the browser ROUGHBOOK_BROWSER names. */
export function findBrowser(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform
): string | null {
  const explicit = env.ROUGHBOOK_BROWSER?.trim();
  if (explicit) return exists(explicit) ? explicit : null;
  const win = (root: string | undefined, ...parts: string[]) =>
    root ? path.win32.join(root, ...parts) : undefined;
  const candidates =
    platform === 'win32'
      ? [
          win(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          win(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
          win(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          win(env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
          win(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          win(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ]
      : platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable',
            '/opt/microsoft/msedge/msedge'
          ];
  return candidates.find((file): file is string => Boolean(file) && exists(file!)) ?? null;
}

/** The browser's arguments: headless, a throwaway profile, and the DevTools protocol on a pipe. */
export function browserArgs(profile: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    'about:blank'
  ];
}

type Message = {
  id?: number;
  method?: string;
  sessionId?: string;
  result?: unknown;
  error?: unknown;
};

/** A DevTools protocol connection over the pipe: NUL-separated JSON in each direction. */
class Pipe {
  private next = 1;
  private buffer = '';
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly waiting: { method: string; sessionId?: string; resolve(): void }[] = [];
  private readonly listeners: {
    method: string;
    sessionId?: string;
    handler(params: unknown): void;
  }[] = [];
  /** Called with each call sent, for tests to see what the page was asked. */
  onSend: ((method: string, params: Record<string, unknown>) => void) | null = null;

  constructor(
    private readonly output: Writable,
    input: Readable
  ) {
    input.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let end: number;
      while ((end = this.buffer.indexOf('\0')) !== -1) {
        const text = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        this.receive(JSON.parse(text) as Message);
      }
    });
  }

  private receive(message: Message) {
    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) call?.reject(new Error(JSON.stringify(message.error)));
      else call?.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) {
      if (listener.method === message.method && listener.sessionId === message.sessionId) {
        listener.handler((message as { params?: unknown }).params);
      }
    }
    const index = this.waiting.findIndex(
      item => item.method === message.method && item.sessionId === message.sessionId
    );
    if (index !== -1) this.waiting.splice(index, 1)[0]!.resolve();
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.next++;
    this.onSend?.(method, params);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try {
        this.output.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  event(method: string, sessionId?: string): Promise<void> {
    return new Promise(resolve => this.waiting.push({ method, sessionId, resolve }));
  }

  /** Calls `handler` with each event of `method` from now on. */
  on(method: string, sessionId: string | undefined, handler: (params: unknown) => void): void {
    this.listeners.push({ method, sessionId, handler });
  }

  /** Forgets the listeners of one session, once its job is over. */
  forget(sessionId: string): void {
    for (let index = this.listeners.length - 1; index >= 0; index -= 1) {
      if (this.listeners[index]!.sessionId === sessionId) this.listeners.splice(index, 1);
    }
  }

  /** The browser is gone: every call still waiting fails now rather than never answering. */
  dispose(): void {
    for (const call of this.pending.values()) call.reject(new Error('the browser closed'));
    this.pending.clear();
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms).unref())
  ]);
}

/** One page of the browser, attached: its DevTools calls and events. */
export type PageSession = {
  send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  event(method: string): Promise<void>;
  on(method: string, handler: (params: unknown) => void): void;
};

/** What the browser process gives the studio: its exit code, the two pipe ends, and a way to end it. */
export type BrowserChild = {
  pid?: number;
  exitCode: number | null;
  stdio: unknown[];
  kill(): void;
  on(event: 'exit' | 'error', listener: () => void): unknown;
};

/** Starts the browser process; replaced in tests by one that only speaks the protocol. */
export type BrowserSpawn = (file: string, args: string[]) => BrowserChild;

const realSpawn: BrowserSpawn = (file, args) =>
  spawn(file, args, {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: true
  }) as unknown as BrowserChild;

type Page = {
  targetId: string;
  sessionId: string;
  session: PageSession;
  busy: boolean;
  /** The setup script registered for the current job, removed when the page is let go. */
  setup: string | null;
};

/** How long a kept browser stays open with nothing to do before it closes itself. */
const IDLE_MS = 3 * 60_000;

/**
 * One browser, kept for the session and its tab reused: started on the first screenshot or probe,
 * on a fresh profile, closed when told or after a while with nothing to do, and started anew
 * when next asked. Each job gets the tab with its own size, media, locale and setup script, and
 * gives it back blank; a job that failed or timed out closes its tab instead, so the next starts
 * clean. Never throws: a browser that could not start answers null.
 */
export class KeptBrowser {
  private child: BrowserChild | null = null;
  private pipe: Pipe | null = null;
  private profile: string | null = null;
  private starting: Promise<Pipe> | null = null;
  private readonly pages: Page[] = [];
  private idle: NodeJS.Timeout | null = null;
  /** Called with each call sent to the browser, for tests. */
  onSend: ((method: string, params: Record<string, unknown>) => void) | null = null;

  constructor(
    readonly executable: string,
    private readonly options: { spawn?: BrowserSpawn; idleMs?: number; settleMs?: number } = {}
  ) {}

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** How long a page is given after it settled, for what animates outside the Web Animations API. */
  get settleMs(): number {
    return this.options.settleMs ?? 700;
  }

  private async start(): Promise<Pipe> {
    if (this.pipe && this.running) return this.pipe;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const profile = mkdtempSync(path.join(os.tmpdir(), 'roughbook-shot-'));
      const child = (this.options.spawn ?? realSpawn)(this.executable, browserArgs(profile));
      const pipe = new Pipe(child.stdio[3] as Writable, child.stdio[4] as Readable);
      pipe.onSend = (method, params) => this.onSend?.(method, params);
      this.child = child;
      this.pipe = pipe;
      this.profile = profile;
      this.pages.length = 0;
      child.on('error', () => this.lost(child));
      child.on('exit', () => this.lost(child));
      return pipe;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /** The browser went away on its own: forget it, and remove what it left. */
  private lost(child: BrowserChild): void {
    if (this.child !== child) return;
    this.pipe?.dispose();
    this.pipe = null;
    this.child = null;
    this.pages.length = 0;
    this.removeProfile();
  }

  private removeProfile(): void {
    const profile = this.profile;
    this.profile = null;
    if (!profile) return;
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      // The browser may still hold its profile; it stays in the OS temp folder.
    }
  }

  private async open(pipe: Pipe): Promise<Page> {
    const { targetId } = await pipe.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank'
    });
    const { sessionId } = await pipe.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true
    });
    const session: PageSession = {
      send: (method, params = {}) => pipe.send(method, params, sessionId),
      event: method => pipe.event(method, sessionId),
      on: (method, handler) => pipe.on(method, sessionId, handler)
    };
    await session.send('Page.enable');
    const page: Page = { targetId, sessionId, session, busy: false, setup: null };
    this.pages.push(page);
    return page;
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.close(), this.options.idleMs ?? IDLE_MS);
    this.idle.unref();
  }

  /**
   * Runs `work` against a page at `size`, emulating `variant` (its scheme and locale), with the
   * setup script in place; null when the browser failed or `work` did not finish in time.
   */
  async withPage<T>(
    input: {
      size: ScreenshotSize;
      overlays: string[];
      variant?: ResolvedVariant | null;
      timeoutMs: number;
    },
    work: (page: PageSession) => Promise<T>
  ): Promise<T | null> {
    if (this.idle) clearTimeout(this.idle);
    let page: Page | null = null;
    let done = false;
    try {
      const pipe = await within(this.start(), input.timeoutMs);
      const free = this.pages.find(item => !item.busy);
      page = free ?? (await within(this.open(pipe), input.timeoutMs));
      page.busy = true;
      const prepared = page;
      const run = async () => {
        const { session } = prepared;
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: input.size.width,
          height: input.size.height,
          deviceScaleFactor: 1,
          mobile: input.size.mobile
        });
        await session.send('Emulation.setEmulatedMedia', {
          features: emulatedMedia(input.variant)
        });
        await session.send(
          'Emulation.setLocaleOverride',
          input.variant?.lang ? { locale: input.variant.lang } : {}
        );
        const { identifier } = await session.send<{ identifier: string }>(
          'Page.addScriptToEvaluateOnNewDocument',
          { source: pageSetup(input.overlays) }
        );
        prepared.setup = identifier;
        return work(session);
      };
      const value = await within(run(), input.timeoutMs);
      done = true;
      return value;
    } catch {
      return null;
    } finally {
      if (page) await this.release(page, done);
      this.touch();
    }
  }

  /** Gives a page back blank for the next job, or closes one a job left in an unknown state. */
  private async release(page: Page, clean: boolean): Promise<void> {
    if (!this.pipe || !this.running) return;
    const pipe = this.pipe;
    pipe.forget(page.sessionId);
    try {
      if (clean) {
        if (page.setup) {
          await page.session.send('Page.removeScriptToEvaluateOnNewDocument', {
            identifier: page.setup
          });
        }
        await within(page.session.send('Page.navigate', { url: 'about:blank' }), 5000);
        page.setup = null;
        page.busy = false;
        return;
      }
    } catch {
      // Closed below.
    }
    const index = this.pages.indexOf(page);
    if (index !== -1) this.pages.splice(index, 1);
    await pipe.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
  }

  /** Closes the browser and removes its profile; the next job starts a new one. */
  async close(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.starting) await this.starting.catch(() => undefined);
    const child = this.child;
    const pipe = this.pipe;
    if (!child || !pipe) return;
    this.child = null;
    this.pipe = null;
    this.pages.length = 0;
    try {
      await within(pipe.send('Browser.close'), 3000);
    } catch {
      // Ended below.
    }
    pipe.dispose();
    if (child.exitCode === null) child.kill();
    this.removeProfile();
  }
}

const kept = new Map<string, KeptBrowser>();

/** The browser kept for this process, by its executable: one for every screenshot and probe. */
export function keptBrowser(executable: string): KeptBrowser {
  let browser = kept.get(executable);
  if (!browser) {
    browser = new KeptBrowser(executable);
    kept.set(executable, browser);
  }
  return browser;
}

/** Closes every browser this process kept, when a command ends or the local UI stops. */
export async function closeKeptBrowsers(): Promise<void> {
  const open = [...kept.values()];
  kept.clear();
  await Promise.all(open.map(browser => browser.close()));
}

function browserFor(browser: string | KeptBrowser): KeptBrowser {
  return typeof browser === 'string' ? keptBrowser(browser) : browser;
}

/**
 * Opens `url` and waits for it to settle: fonts, then hydration (the ready or error message) and
 * any entrance animation, then a moment for what animates outside the Web Animations API
 * (Motion's transforms run on requestAnimationFrame).
 */
async function settle(
  page: PageSession,
  url: string,
  maxWaitMs = 20000,
  settleMs = 700
): Promise<void> {
  const loaded = page.event('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await loaded;
  await page.send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => true)',
    awaitPromise: true
  });
  await page.send('Runtime.evaluate', { expression: settledScript(maxWaitMs), awaitPromise: true });
  if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs));
}

/** Takes one screenshot at exactly `size`, in `variant`. Resolves true when the file was written; never throws. */
export async function takeScreenshot({
  browser,
  url,
  file,
  size,
  overlays = [],
  variant = null,
  timeoutMs = 60_000
}: {
  /** The browser's executable, or the kept browser itself. */
  browser: string | KeptBrowser;
  url: string;
  file: string;
  size: ScreenshotSize;
  /** Selectors of the app's development overlays, hidden before the shot. */
  overlays?: string[];
  /** The variant the page is photographed in: its scheme and locale emulated here. */
  variant?: ResolvedVariant | null;
  timeoutMs?: number;
}): Promise<boolean> {
  const kept = browserFor(browser);
  const taken = await kept.withPage({ size, overlays, variant, timeoutMs }, async page => {
    await settle(page, url, 20000, kept.settleMs);
    const { data } = await page.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png'
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data, 'base64'));
    return true;
  });
  return taken === true;
}

/**
 * What a preview did once it settled: whether it shows the text expected of it, whether it posted
 * the ready message or an error, and how many of the app's own development overlays were still
 * showing. For `roughbook doctor`.
 */
export async function probePreview({
  browser,
  url,
  overlays,
  timeoutMs = 60_000,
  expect
}: {
  browser: string | KeptBrowser;
  url: string;
  overlays: string[];
  timeoutMs?: number;
  /** Text the page must show once settled; what the server sent but the page hides does not count. */
  expect?: string;
}): Promise<Probe> {
  const expression = `(function () {
  var visible = 0;
  ${JSON.stringify(overlays)}.forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (element) {
      var style = getComputedStyle(element);
      if (style.display !== 'none' && style.visibility !== 'hidden') visible += 1;
    });
  });
  var expected = ${JSON.stringify(expect ?? null)};
  var text = document.body ? document.body.innerText : '';
  return JSON.stringify({
    shows: expected === null || text.indexOf(expected) !== -1,
    ready: window.__roughbookReady === true,
    error: window.__roughbookError === undefined ? null : String(window.__roughbookError),
    visibleOverlays: visible,
    text: text.slice(0, 200000)
  });
})()`;
  const kept = browserFor(browser);
  const found = await kept.withPage(
    { size: { width: 1440, height: 900, mobile: false }, overlays, timeoutMs },
    async page => {
      // Whatever the page throws says why it may never have hydrated.
      const exceptions: string[] = [];
      page.on('Runtime.exceptionThrown', params => {
        const details = (
          params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
        ).exceptionDetails;
        const text = details?.exception?.description ?? details?.text;
        if (text) exceptions.push(text.split('\n')[0]!.slice(0, 300));
      });
      await page.send('Runtime.enable');
      // A dev server compiling the page's client code on first request may take a while to
      // hydrate; the probe waits as long as the environment allows, less a margin for the rest.
      await settle(page, url, Math.max(20_000, timeoutMs - 10_000), kept.settleMs);
      const { result } = await page.send<{ result: { value?: string } }>('Runtime.evaluate', {
        expression,
        returnByValue: true
      });
      return { ...(JSON.parse(result.value ?? '{}') as Omit<Probe, 'exceptions'>), exceptions };
    }
  );
  return (
    found ?? {
      shows: false,
      ready: false,
      error: null,
      visibleOverlays: 0,
      exceptions: [],
      text: ''
    }
  );
}
