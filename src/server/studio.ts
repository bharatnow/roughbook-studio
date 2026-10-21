// What the local UI asks for, done with the same parts as the CLI: runs, Done, revert, review
// decisions through the outbox, promote, and the agents' sessions. The HTTP layer (app.ts) only
// checks who is asking and turns these into JSON.
import fs from 'node:fs';
import path from 'node:path';
import { ALL_AGENTS, hostLookup } from '../agents/index.js';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { AgentAdapter, AgentEvent, Detection, TerminalAdapter } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import type { AssetScope, ProjectTree, RatingSummary } from '../api/types.js';
import { describeError } from '../api/errors.js';
import { outboxFor, type Outbox } from '../api/outbox.js';
import { finishWithScreenshots } from '../commands/done.js';
import type { CommandContext } from '../commands/context.js';
import { promoteSession } from '../commands/promote.js';
import {
  chooseAgent,
  openInEditor,
  sendHeartbeat,
  type EditorLaunched
} from '../commands/shared.js';
import { localOrigin, readSettings, saveSettings } from '../config/settings.js';
import { ENVIRONMENT_FILE, defaultEnvironment, readEnvironmentSync } from '../environment/read.js';
import { resolveVariants, screenshotSet, type ResolvedVariant } from '../environment/variants.js';
import { currentOs } from '../launch/platform.js';
import { resolveCommandLine } from '../launch/processes.js';
import type { PtySupport } from '../launch/pty.js';
import { findProgramOnPath } from '../launch/which.js';
import { manualCommand, planTerminal, type Session } from '../launch/terminal.js';
import type { RepoLink } from '../repo/link.js';
import type { RepoEnvironment, Terms, Viewport } from '../environment/types.js';
import { recipeOf } from '../recipes/index.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { ITERATION, SLUG, listIterations } from '../repo/iterations.js';
import { roughPath } from '../repo/root.js';
import { assessRun, putBack, startRuns } from '../runs/lifecycle.js';
import { queued } from '../runs/queue.js';
import { watchRepo } from '../runs/watch.js';
import { findComponent, preparePromotion } from '../runs/promote.js';
import { pullAdvice, pullSketch } from '../runs/pull.js';
import { sendDecision, type Decision, type ReviewTarget } from '../runs/reviews.js';
import { assertTarget, iterationExists } from '../runs/slots.js';
import { listRuns, readRun } from '../runs/store.js';
import type { RunAgent, RunRecord, StartRunRequest } from '../runs/types.js';
import { SHOTS_MANIFEST, screenshotPath, type ShotOptions } from '../screenshot/iteration.js';
import {
  createStandaloneHandler,
  withToken,
  type StandaloneHandler
} from '../standalone/server.js';
import { EVENT_CATALOG } from '../telemetry/catalog.js';
import { errorCode, flushEvents, recordEvent } from '../telemetry/events.js';
import { STUDIO_VERSION } from '../version.js';
import { ChangeFeed, changedKey } from './changes.js';
import { ProjectCache } from './projectCache.js';
import { newToken } from './security.js';
import { Terminals, type TerminalInfo } from './terminals.js';

export type LocalStudioOptions = {
  context: CommandContext & { repoRoot: string };
  api: StudioApi;
  link: RepoLink;
  devUrl: string;
  port: number;
  pty: PtySupport;
};

/** The repo's environment as the page needs it for the frame: no path, no command line but the start's. */
export type EnvironmentView = {
  mode: RepoEnvironment['mode'];
  /** The preview's path template, with `{key}`. */
  preview: string;
  viewports: Viewport[];
  variants: ResolvedVariant[];
  terms: Terms;
  reload: RepoEnvironment['reload'];
  /** The start command (null when the designer starts the app), its address, and whether it is approved here. */
  start: { command: string | null; url: string; approved: boolean };
  timeouts: { preview: number };
};

/** What the app the previews come from is doing, as the studio last saw it. */
export type AppView = {
  status: 'unknown' | 'starting' | 'up' | 'down';
  /** The terminal session the studio started it in, when it did. */
  terminal: string | null;
  since: string | null;
  /** The last line the app printed while starting, for the frame's progress. */
  lastLine: string | null;
};

/** How long after the last write to an iteration its screenshots are taken again. */
const RESHOT_AFTER_MS = 5000;
/** How long the app is given to answer when asked whether it is up. */
const APP_ASK_MS = 3000;

/** An agent as the local UI lists it: no paths. */
export type AgentView = Pick<
  Detection,
  'id' | 'name' | 'kind' | 'found' | 'version' | 'signedIn' | 'signIn' | 'headless' | 'capabilities'
>;

/** How a run's sessions were started. */
export type Launched =
  | { kind: 'builtin'; terminals: TerminalInfo[] }
  | { kind: 'external'; terminal: string }
  | { kind: 'manual'; reason: string; commands: string[] }
  | { kind: 'headless' }
  | EditorLaunched;

/** An unattended run while it goes, and what it said. */
type HeadlessJob = {
  controller: AbortController;
  lines: string[];
  status: 'running' | 'finished';
  error: string | null;
};

export type RunView = RunRecord & {
  terminal: TerminalInfo | null;
  headless: { status: HeadlessJob['status']; lines: string[]; error: string | null } | null;
};

/** What Deliver shows after a promotion: @roughbook/ui's PromoteResult, and the session. */
export type PromoteResult = {
  ok: boolean;
  launched: boolean;
  message: string;
  commands: string[];
  assets: { to: string }[];
  missingAssets: { url: string }[];
  terminal: TerminalInfo | null;
};

/** What `POST /api/runs` takes from the local UI. */
export type RunBody = {
  page: string;
  component: string;
  agent?: string;
  model?: string;
  /** Ignored for an editor, whose runs are always the designer's in the editor. */
  mode: 'interactive' | 'headless' | 'editor';
  /** Where an interactive session opens: here, or the designer's own terminal. */
  terminal?: 'builtin' | 'external';
  cols?: number;
  rows?: number;
} & (
  | { kind: 'generate'; directions: { direction: string; hypothesis?: string }[] }
  | { kind: 'fork'; parent: string }
  | {
      kind: 'refine';
      parent: string;
      preset: string;
      intent: string;
      observationIds?: string[];
      preserve?: string;
    }
);

const KEEP_LINES = 300;
const ASSET_CACHE_MS = 5 * 60_000;
const ASSET_CACHE_BYTES = 64 * 1024 * 1024;

const ASSET_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  glb: 'model/gltf-binary',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  svg: 'image/svg+xml',
  webm: 'video/webm',
  webp: 'image/webp'
};

/** The content type an asset file is served with, from its name. */
export function assetType(file: string): string {
  return ASSET_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
const DETECTION_FRESH_MS = 60_000;

/** The agents `studio.started` names by id; any other is `other`. */
const STARTED_AGENT_IDS: string[] = (() => {
  const agents = EVENT_CATALOG.events['studio.started']?.props.agents;
  return agents?.kind === 'list' &&
    agents.of.kind === 'record' &&
    agents.of.props.id?.kind === 'enum'
    ? agents.of.props.id.values
    : [];
})();

function describeEvent(event: AgentEvent): string | null {
  switch (event.kind) {
    case 'file':
      return `Wrote ${event.name}`;
    case 'tool':
      return `Used ${event.name}`;
    case 'message':
      return event.text;
    case 'result':
      return event.ok ? 'Finished.' : `Failed${event.text ? `: ${event.text}` : '.'}`;
    default:
      return null;
  }
}

/** A request the local UI made wrong: answered 400 with this sentence. */
export class BadRequest extends Error {}

function text(value: unknown, what: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequest(`${what} is missing or too long.`);
  }
  return value.trim();
}

function optionalText(value: unknown, what: string, max = 20_000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new BadRequest(`${what} is too long.`);
  return value;
}

function lines(value: unknown, what: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string')) {
    throw new BadRequest(`${what} must be a list of short lines.`);
  }
  return value.map(item => (item as string).trim()).filter(Boolean);
}

function record<T>(value: unknown, what: string, valid: (item: unknown) => item is T) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequest(`${what} is not readable.`);
  }
  const entries = Object.entries(value).filter(([, item]) => valid(item));
  return Object.fromEntries(entries) as Record<string, T>;
}

/** A rating from the local UI: 1 to 5, null or empty for none, undefined when not given. */
function rating(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new BadRequest('A rating is a whole number from 1 to 5.');
  }
  return value;
}

const STATUSES = ['draft', 'exploring', 'promising', 'archived'] as const;
const REVIEW_DECISIONS = ['explore', 'refine', 'select', 'reject'] as const;

/** A decision as the local UI sends it, checked before it reaches the outbox. */
export function parseDecision(body: Record<string, unknown>): Decision {
  switch (body.kind as Decision['kind']) {
    case 'select':
      return {
        kind: 'select',
        reason: optionalText(body.reason, 'The reason'),
        rating: rating(body.rating)
      };
    case 'reject':
      return {
        kind: 'reject',
        reason: text(body.reason, 'The reason', 500),
        why: optionalText(body.why, 'Why'),
        rating: rating(body.rating)
      };
    case 'rate': {
      const given = rating(body.rating);
      if (given === undefined) throw new BadRequest('The rating is missing.');
      return { kind: 'rate', rating: given };
    }
    case 'review': {
      const decision = body.decision;
      if (
        decision !== undefined &&
        decision !== '' &&
        !REVIEW_DECISIONS.includes(decision as never)
      ) {
        throw new BadRequest('A review decides explore, refine, select or reject.');
      }
      return {
        kind: 'review',
        ...(decision ? { decision: decision as (typeof REVIEW_DECISIONS)[number] } : {}),
        reason: optionalText(body.reason, 'The reason'),
        observations: lines(body.observations, 'Observations'),
        fields: record(
          body.fields,
          'The answers',
          (item): item is string => typeof item === 'string'
        ),
        checklist: record(
          body.checklist,
          'The checklist',
          (item): item is boolean => typeof item === 'boolean'
        )
      };
    }
    case 'notes': {
      const notes = {
        likes: lines(body.likes, 'Likes'),
        dislikes: lines(body.dislikes, 'Dislikes'),
        designerNotes:
          body.designerNotes === undefined
            ? undefined
            : typeof body.designerNotes === 'string' && body.designerNotes.length <= 20_000
              ? body.designerNotes
              : (() => {
                  throw new BadRequest('The notes are too long.');
                })()
      };
      if (Object.values(notes).every(item => item === undefined)) {
        throw new BadRequest('There is nothing to save.');
      }
      return { kind: 'notes', ...notes };
    }
    case 'status':
      if (!STATUSES.includes(body.status as never)) {
        throw new BadRequest('The status is draft, exploring, promising or archived.');
      }
      return { kind: 'status', status: body.status as (typeof STATUSES)[number] };
    default:
      throw new BadRequest('Not a decision this studio knows.');
  }
}

export class LocalStudio {
  readonly terminals: Terminals | null;
  readonly outbox: Outbox;
  /** What changed in rough/ while the UI is open, numbered for the page (reload on change). */
  readonly changes = new ChangeFeed();
  private readonly jobs = new Map<string, HeadlessJob>();
  private environmentRead: {
    stamp: string;
    value: RepoEnvironment;
    problem: string | null;
  } | null = null;
  private app: AppView = { status: 'unknown', terminal: null, since: null, lastLine: null };
  private readonly reshots = new Map<string, NodeJS.Timeout>();
  private detections: { at: number; list: Promise<Detection[]> } | null = null;
  private readonly assets = new Map<string, { bytes: Buffer; at: number }>();
  private readonly cache = new ProjectCache<ProjectTree, Record<string, RatingSummary>>();
  /**
   * The standalone previews' own token: in their addresses, which the iteration's code can read,
   * so never the UI's, and good for nothing but previews.
   */
  private readonly previewToken = newToken();
  /** The standalone server, on this port under the name localhost (see standalone/server.ts). */
  readonly standalone: StandaloneHandler;

  constructor(private readonly options: LocalStudioOptions) {
    this.terminals = options.pty.ok ? new Terminals(options.pty.pty) : null;
    this.outbox = outboxFor(options.context.repoRoot);
    this.standalone = createStandaloneHandler({
      repoRoot: options.context.repoRoot,
      environment: () => this.environment,
      token: this.previewToken,
      hosts: [this.siteHost],
      frameAncestors: [`http://127.0.0.1:${options.port}`]
    });
  }

  get repoRoot(): string {
    return this.options.context.repoRoot;
  }

  /** Whether the studio's own server shows the previews (the environment's mode, as it is now). */
  get standaloneMode(): boolean {
    return this.environment.mode === 'standalone';
  }

  /**
   * The standalone previews' Host: this port under its other name, an origin apart from the UI's
   * page at 127.0.0.1, so an iteration's code never reaches the page or its token.
   */
  get siteHost(): string {
    return `localhost:${this.options.port}`;
  }

  /** Where iterations render: the app's dev server, or this server's site in standalone mode. */
  get devUrl(): string {
    return this.standaloneMode ? `http://${this.siteHost}` : this.options.devUrl;
  }

  /** The environment as the frame and the screenshots ask previews: with the token in standalone mode. */
  previewEnvironment(): RepoEnvironment {
    return withToken(this.environment, this.previewToken);
  }

  /**
   * The repo's environment as it is now: rough/environment.md is read again whenever it changed,
   * rather than once at start, so a setup run or an edit shows without restarting the studio. A
   * file that cannot be read keeps the last good environment, and `environmentProblem` says why.
   */
  get environment(): RepoEnvironment {
    let stamp = 'none';
    try {
      const stat = fs.statSync(roughPath(this.repoRoot, ENVIRONMENT_FILE));
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // No file: the recipe's environment.
    }
    if (this.environmentRead?.stamp === stamp) return this.environmentRead.value;
    try {
      const value = readEnvironmentSync(this.repoRoot, this.options.link);
      this.environmentRead = { stamp, value, problem: null };
    } catch (error) {
      this.environmentRead = {
        stamp,
        value: this.environmentRead?.value ?? defaultEnvironment(this.options.link),
        problem: error instanceof Error ? error.message : String(error)
      };
    }
    return this.environmentRead.value;
  }

  /** Why rough/environment.md cannot be read now, or null. */
  get environmentProblem(): string | null {
    void this.environment;
    return this.environmentRead?.problem ?? null;
  }

  /** The environment as the page's frame needs it. */
  async environmentView(): Promise<EnvironmentView> {
    const environment = this.previewEnvironment();
    const approvals = await readApprovals(this.repoRoot);
    const command = environment.start.command;
    return {
      mode: environment.mode,
      preview: environment.preview,
      viewports: environment.viewports,
      variants: resolveVariants(environment.variants),
      terms: environment.terms,
      reload: environment.reload,
      start: {
        command,
        url: environment.start.url,
        approved: command ? isApproved(approvals, command, environment.shell) : false
      },
      timeouts: { preview: environment.timeouts.preview }
    };
  }

  /** The app's state, with the last line of its session while it starts. */
  appView(): AppView {
    // In standalone mode the studio's own server is the app, up while the studio is.
    if (this.standaloneMode) return { status: 'up', terminal: null, since: null, lastLine: null };
    const terminal = this.app.terminal ? this.terminals?.get(this.app.terminal) : null;
    if (this.app.status === 'starting' && terminal?.status === 'exited') {
      this.app = { ...this.app, status: 'down' };
    }
    return {
      ...this.app,
      lastLine:
        this.app.terminal && terminal?.status === 'running'
          ? (this.terminals?.lastLine(this.app.terminal) ?? null)
          : null
    };
  }

  /** Asks the app once whether it answers at its address, and keeps the answer for the page. */
  async checkApp(): Promise<AppView> {
    if (this.standaloneMode) return this.appView();
    const answer = await this.options.context.askPreview(`${this.options.devUrl}/`, APP_ASK_MS);
    if (answer) {
      this.app = {
        ...this.app,
        status: 'up',
        since: this.app.status === 'up' ? this.app.since : new Date().toISOString()
      };
    } else {
      const terminal = this.app.terminal ? this.terminals?.get(this.app.terminal) : null;
      this.app = { ...this.app, status: terminal?.status === 'running' ? 'starting' : 'down' };
    }
    return this.appView();
  }

  /**
   * Starts the app with the environment's start command, approved on this machine, in the
   * built-in terminal, through the repo's queue; nothing when something already answers at its
   * address or it is already starting.
   */
  async startApp(): Promise<{
    started: boolean;
    reason: string | null;
    terminal: TerminalInfo | null;
  }> {
    const environment = this.environment;
    if (this.standaloneMode) {
      throw new BadRequest(
        `In standalone mode the studio's own server shows the previews, at ${this.devUrl}; there is no app to start.`
      );
    }
    const command = environment.start.command;
    if (!command) throw new BadRequest('The environment names no command that starts the app.');
    if (!this.terminals) {
      throw new BadRequest(
        `The built-in terminal is not available here; start the app yourself: ${command}`
      );
    }
    if (!isApproved(await readApprovals(this.repoRoot), command, environment.shell)) {
      throw new BadRequest(
        `The start command is not approved on this machine (${command}). Run roughbook doctor in a terminal and approve it, or roughbook doctor --yes once you have read it.`
      );
    }
    const running = this.app.terminal ? this.terminals.get(this.app.terminal) : null;
    if (this.app.status === 'starting' && running?.status === 'running') {
      return { started: false, reason: 'The app is already starting.', terminal: running };
    }
    if ((await this.checkApp()).status === 'up') {
      return {
        started: false,
        reason: `The app already answers at ${this.options.devUrl}.`,
        terminal: null
      };
    }
    const resolved = resolveCommandLine(
      command,
      undefined,
      undefined,
      undefined,
      environment.shell
    );
    if (!resolved) throw new BadRequest('The start command is empty.');
    // The pseudo-terminal starts a program by its path, as the agents' sessions do, so the shell
    // or program named is found on the PATH first; one not there is left as named, to fail aloud.
    const program =
      findProgramOnPath(resolved.command, hostLookup(this.options.context.env)) ?? resolved.command;
    const terminal = await queued(this.repoRoot, async () =>
      this.terminals!.start({
        title: `App: ${command}`.slice(0, 60),
        command: program,
        args: resolved.args,
        cwd: this.repoRoot,
        env: this.options.context.env,
        runId: null
      })
    );
    this.app = {
      status: 'starting',
      terminal: terminal.id,
      since: new Date().toISOString(),
      lastLine: null
    };
    return { started: true, reason: null, terminal };
  }

  /**
   * Watches the iteration folders while the UI is open: each change is numbered for the page,
   * which reloads the frame where the stack has no hot reload, and the changed iteration's
   * screenshots are taken again once its files have been still for a moment, unless an agent is
   * still writing it. Returns a function that stops watching.
   */
  watch(): () => void {
    const stop = watchRepo(
      this.repoRoot,
      file => {
        const key = changedKey(file);
        if (!key) return;
        this.changes.note(key);
        this.scheduleReshot(key);
      },
      this.environment.ignore
    );
    return () => {
      stop();
      for (const timer of this.reshots.values()) clearTimeout(timer);
      this.reshots.clear();
    };
  }

  private scheduleReshot(key: string): void {
    const waiting = this.reshots.get(key);
    if (waiting) clearTimeout(waiting);
    const timer = setTimeout(() => {
      this.reshots.delete(key);
      void this.reshoot(key);
    }, RESHOT_AFTER_MS);
    timer.unref();
    this.reshots.set(key, timer);
  }

  private async reshoot(key: string): Promise<void> {
    try {
      if (this.appView().status !== 'up') return;
      const [page, component, iteration] = key.split('/') as [string, string, string];
      if (!iterationExists(this.repoRoot, page, component, iteration)) return;
      const open = (await listRuns(this.repoRoot)).some(
        run => run.status === 'started' && `${run.page}/${run.component}/${run.iteration}` === key
      );
      if (open) return;
      await this.screenshots({ page, component, iteration });
    } catch {
      // The next change tries again; the designer can also ask for them on the stage.
    }
  }

  /** Every agent, found or not; asked again after a minute, or when `fresh`. */
  agents(fresh = false): Promise<Detection[]> {
    if (fresh || !this.detections || Date.now() - this.detections.at > DETECTION_FRESH_MS) {
      const list = Promise.all(ALL_AGENTS.map(adapter => this.options.context.detect(adapter)));
      this.detections = { at: Date.now(), list };
      list.catch(() => (this.detections = null));
    }
    return this.detections.list;
  }

  private async detection(adapter: AgentAdapter): Promise<Detection> {
    const found = (await this.agents()).find(item => item.id === adapter.id);
    return found ?? this.options.context.detect(adapter);
  }

  /** The command context, with agents found once rather than on every request. */
  private get context(): CommandContext & { repoRoot: string } {
    return { ...this.options.context, detect: adapter => this.detection(adapter) };
  }

  async state() {
    const { link, port, pty, api } = this.options;
    const devUrl = this.devUrl;
    const [settings, agents, pending, dropped] = await Promise.all([
      readSettings(this.options.context.configDir),
      this.agents(),
      this.outbox.pending(),
      this.outbox.dropped()
    ]);
    let webUrl: string | null = null;
    try {
      webUrl = (await api.me()).webUrl ?? null;
    } catch {
      // Offline: the UI works without the link to the web.
    }
    return {
      version: STUDIO_VERSION,
      project: { orgId: link.orgId, slug: link.project },
      devUrl,
      port,
      webUrl,
      terminal: pty.ok ? { builtin: true } : { builtin: false, reason: pty.reason },
      agents: agents.map((item): AgentView => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        found: item.found,
        version: item.version,
        signedIn: item.signedIn,
        signIn: item.signIn,
        headless: item.headless,
        capabilities: item.capabilities
      })),
      defaultAgent: settings.defaultAgent,
      outbox: { pending: pending.length, dropped },
      environment: await this.environmentView(),
      environmentProblem: this.environmentProblem,
      app: this.appView()
    };
  }

  async setDefaultAgent(agent: unknown): Promise<void> {
    if (agent !== null && !ALL_AGENTS.some(item => item.id === agent)) {
      throw new BadRequest('Choose one of the agents this studio supports.');
    }
    await saveSettings(this.options.context.configDir, {
      defaultAgent: agent as RunAgent | null
    });
  }

  /**
   * The project from the backend, as last read unless it is due again (see projectCache.ts), and
   * which of its iterations are in this repo. `fresh` when the designer came back to the page.
   */
  async project(fresh = false) {
    const { api, link } = this.options;
    const local = this.local();
    const tree = await this.cache.project(() => api.project(link.orgId, link.project), fresh);
    return { tree, local };
  }

  /** The page did something, or the outbox was sent: the project is read again when next asked. */
  projectChanged(): void {
    this.cache.invalidate();
  }

  /** The iterations in this repo and their screenshots, read from disk on every ask. */
  private local() {
    const environment = this.environment;
    const iterations = listIterations(this.repoRoot, environment.entry);
    const screenshots: Record<string, string[]> = {};
    const screenshotsAt: Record<string, string> = {};
    const names = screenshotSet(environment.viewports, environment.variants).map(shot => shot.name);
    for (const key of iterations) {
      const [page, component, iteration] = key.split('/') as [string, string, string];
      const sizes = names.filter(size =>
        fs.existsSync(this.disk(screenshotPath(page, component, iteration, size)))
      );
      if (!sizes.length) continue;
      screenshots[key] = sizes;
      try {
        const manifest = path.join(
          this.disk(screenshotPath(page, component, iteration, sizes[0]!)),
          '..',
          SHOTS_MANIFEST
        );
        screenshotsAt[key] = fs.statSync(manifest).mtime.toISOString();
      } catch {
        // Taken before manifests: the page shows them as they are.
      }
    }
    // An iteration pulled or started from the CLI is new on the backend too.
    this.cache.notice('iterations', JSON.stringify(iterations));
    return { iterations, screenshots, screenshotsAt };
  }

  async runs(): Promise<RunView[]> {
    const terminals = this.terminals?.list() ?? [];
    const runs = await listRuns(this.repoRoot);
    // A run started or finished anywhere, here, by the CLI or by an agent through MCP, changes the
    // project on the backend.
    this.cache.notice('runs', JSON.stringify(runs.map(run => [run.runId, run.status])));
    return runs.map(run => {
      const job = this.jobs.get(run.runId);
      return {
        ...run,
        terminal: terminals.filter(item => item.runId === run.runId).at(-1) ?? null,
        headless: job ? { status: job.status, lines: job.lines, error: job.error } : null
      };
    });
  }

  async startRuns(body: RunBody): Promise<{ runs: RunRecord[]; launched: Launched }> {
    const context = this.context;
    const { api, link } = this.options;
    const kind = this.runKind(body);
    const { adapter, detection } = await chooseAgent(context, body.agent);
    if (body.mode === 'headless' && !detection.headless.ready) {
      throw new BadRequest(detection.headless.reason);
    }
    // Decisions waiting in the outbox reach the server first, so this prompt remembers them.
    await this.outbox.flush(api);
    const request = {
      page: body.page,
      component: body.component,
      agent: adapter.id,
      mode: adapter.kind === 'editor' ? 'editor' : body.mode,
      ...kind
    } as StartRunRequest;
    // Iterations load the project's asset files from this server.
    const runs = await startRuns(this.repoRoot, api, link, request, {
      assetOrigin: localOrigin({ localPort: this.options.port })
    });
    const model = typeof body.model === 'string' && body.model ? body.model : null;

    if (adapter.kind === 'editor') {
      const launched = await openInEditor(
        context,
        adapter,
        detection,
        this.repoRoot,
        runs.map(run => run.promptFile)
      );
      return { runs, launched };
    }
    const executable = detection.executable!;
    if (body.mode === 'headless') {
      for (const run of runs) this.runHeadless(adapter, detection, run, model);
      return { runs, launched: { kind: 'headless' } };
    }
    const sessions = terminalSessions(adapter, executable, this.repoRoot, runs, model);
    const launched = await this.open(
      sessions,
      runs.map(run => run.runId),
      body
    );
    return { runs, launched };
  }

  /** Opens sessions in the built-in terminal, or the designer's own, or says what to paste. */
  private async open(
    sessions: Session[],
    runIds: (string | null)[],
    where: { terminal?: 'builtin' | 'external'; cols?: number; rows?: number }
  ): Promise<Launched> {
    const context = this.options.context;
    if (this.terminals && where.terminal !== 'external') {
      const terminals = sessions.map((session, index) =>
        this.terminals!.start({
          title: session.title,
          command: session.command,
          args: session.args,
          cwd: this.repoRoot,
          env: context.env,
          runId: runIds[index] ?? null,
          cols: where.cols,
          rows: where.rows
        })
      );
      return { kind: 'builtin', terminals };
    }
    const plan = planTerminal({
      platform: context.platform,
      env: context.env,
      repoRoot: this.repoRoot,
      sessions
    });
    if (plan.kind !== 'manual') {
      try {
        await context.launchTerminal(plan);
        return { kind: 'external', terminal: plan.terminal };
      } catch (error) {
        return {
          kind: 'manual',
          reason: `${plan.terminal} could not be opened: ${describeError(error)}`,
          commands: sessions.map(session => manualCommand(context.platform, this.repoRoot, session))
        };
      }
    }
    return {
      kind: 'manual',
      reason: plan.reason,
      commands: sessions.map(session => manualCommand(context.platform, this.repoRoot, session))
    };
  }

  private runHeadless(
    adapter: TerminalAdapter,
    detection: Detection,
    run: RunRecord,
    model: string | null
  ): void {
    const context = this.context;
    const job: HeadlessJob = {
      controller: new AbortController(),
      lines: [],
      status: 'running',
      error: null
    };
    this.jobs.set(run.runId, job);
    const say = (line: string) => {
      job.lines.push(line);
      if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
    };
    void (async () => {
      const invocation = adapter.headless(
        runTarget(this.repoRoot, run, model),
        detection.executable!,
        context.env
      );
      let outcome: 'failed' | 'cancelled' | undefined = 'failed';
      let usage = null;
      if ('refused' in invocation) {
        job.error = invocation.refused;
      } else {
        const result = await context.runHeadless(adapter, invocation, {
          env: context.env,
          model,
          signal: job.controller.signal,
          onEvent: event => {
            const line = describeEvent(event);
            if (line) say(line);
          }
        });
        outcome = result.ok ? undefined : result.cancelled ? 'cancelled' : 'failed';
        usage = result.usage;
        job.error = result.error;
      }
      await finishWithScreenshots(
        context,
        this.options.api,
        this.outbox,
        this.options.link,
        run.runId,
        {
          outcome,
          usage,
          devUrl: this.devUrl,
          environment: this.previewEnvironment(),
          screenshots: true,
          by: 'headless'
        }
      );
    })()
      .catch(error => {
        job.error = describeError(error);
      })
      .finally(() => {
        job.status = 'finished';
      });
  }

  /** Stops what is running for a run: its unattended agent, or its terminal session. */
  stopRun(runId: string): boolean {
    const job = this.jobs.get(runId);
    if (job?.status === 'running') {
      job.controller.abort();
      return true;
    }
    const session = this.terminals
      ?.list()
      .filter(item => item.runId === runId && item.status === 'running')
      .at(-1);
    return session ? this.terminals!.stop(session.id) : false;
  }

  async done(runId: string, outcome: unknown, mine?: unknown) {
    if (outcome !== undefined && outcome !== 'failed' && outcome !== 'cancelled') {
      throw new BadRequest('A run is marked failed or cancelled, or finished as it is.');
    }
    if (mine !== undefined && (!Array.isArray(mine) || !mine.every(i => typeof i === 'string'))) {
      throw new BadRequest('mine is a list of the files or folders that were your own work.');
    }
    const run = await this.requireRun(runId);
    if (this.jobs.get(run.runId)?.status === 'running') {
      throw new BadRequest('This run is still going unattended. Stop it first.');
    }
    return finishWithScreenshots(
      this.context,
      this.options.api,
      this.outbox,
      this.options.link,
      run.runId,
      {
        outcome,
        mine: mine as string[] | undefined,
        devUrl: this.devUrl,
        environment: this.previewEnvironment(),
        screenshots: true,
        by: 'local-ui'
      }
    );
  }

  /** What Done would find now, for the designer to see first; for a finished run, its record. */
  async checks(runId: string) {
    const run = await this.requireRun(runId);
    if (run.status === 'finished') {
      return {
        failure: run.failure,
        warnings: run.warnings,
        outOfScope: run.outOfScope,
        mine: run.mine ?? []
      };
    }
    return assessRun(this.repoRoot, this.options.link, run);
  }

  /** Puts back one file a finished run changed outside its folder. */
  async revert(runId: string, file: unknown) {
    const run = await this.requireRun(runId);
    const name = text(file, 'The file').replace(/\\/g, '/');
    if (run.status !== 'finished')
      throw new BadRequest('Finish the run before putting files back.');
    // Only what the run was flagged for: anything else is the designer's own work.
    if (!run.outOfScope.includes(name)) {
      throw new BadRequest(`${name} is not among the files this run changed outside its folder.`);
    }
    return { file: name, result: await putBack(this.repoRoot, run, name) };
  }

  async prompt(runId: string) {
    const run = await this.requireRun(runId);
    return {
      promptFile: run.promptFile,
      prompt: fs.readFileSync(this.disk(run.promptFile), 'utf8')
    };
  }

  async reviews(target: ReviewTarget) {
    this.assertIteration(target);
    const { api, link } = this.options;
    return api.reviews(link.orgId, link.project, target.page, target.component, target.iteration);
  }

  async decide(target: ReviewTarget, decision: Decision) {
    this.assertIteration(target);
    const { api, link } = this.options;
    const result = await sendDecision(api, this.outbox, link, target, decision);
    return { status: result.status };
  }

  /** The component's rated iterations, from the backend: this user's rating and the team's. */
  async ratings(page: string, component: string) {
    if (!SLUG.test(page) || !SLUG.test(component)) throw new BadRequest('Not a component.');
    const { api, link } = this.options;
    return this.cache.ratings(`${page}/${component}`, () =>
      api.ratings(link.orgId, link.project, page, component)
    );
  }

  /** The component's web sketches that can be pulled, from the backend. */
  async sketches(page: string, component: string) {
    if (!SLUG.test(page) || !SLUG.test(component)) throw new BadRequest('Not a component.');
    const { api, link } = this.options;
    return api.sketches(link.orgId, link.project, page, component);
  }

  /** Pulls a web sketch into rough/ as a new local iteration, and says what the app still needs. */
  async pull(target: ReviewTarget) {
    this.assertIteration(target);
    const { api, link } = this.options;
    const pulled = await pullSketch(
      this.repoRoot,
      api,
      link,
      { page: target.page, component: target.component, sketch: target.iteration },
      { assetOrigin: localOrigin({ localPort: this.options.port }) }
    );
    return { ...pulled, advice: pullAdvice(pulled) };
  }

  async promote(body: {
    page: string;
    component: string;
    iteration: string;
    targetFile?: string;
    agent?: string;
    terminal?: 'builtin' | 'external';
    cols?: number;
    rows?: number;
  }): Promise<PromoteResult> {
    this.assertIteration(body);
    const { api, link } = this.options;
    const tree = await api.project(link.orgId, link.project);
    const record = findComponent(tree, body.page, body.component);
    const prepared = await preparePromotion(this.repoRoot, api, link, tree, {
      page: body.page,
      component: body.component,
      iteration: body.iteration,
      targetFile: body.targetFile?.trim() || undefined
    });
    const assets = prepared.copied.map(to => ({ to }));
    const missingAssets = prepared.missing.map(item => ({ url: `${item.scope}/${item.file}` }));
    const instruction = `Follow the instructions in ${prepared.promptFile}`;

    let session: Session;
    try {
      const { adapter, detection } = await chooseAgent(this.context, body.agent);
      if (adapter.kind === 'editor') {
        const opened = await openInEditor(this.context, adapter, detection, this.repoRoot, [
          prepared.promptFile
        ]);
        const where = adapter.id === 'other' ? 'your editor' : adapter.name;
        return {
          ok: true,
          launched: opened.opened !== null,
          message: `Wrote ${prepared.promptFile}${opened.opened === 'editor' ? ` and opened it in ${where}` : opened.opened === 'default-app' ? ' and opened it with your default app' : ''}. ${opened.copied ? 'The instruction is on the clipboard' : 'Paste this instruction'} for a new chat with ${where === 'your editor' ? 'your agent' : `${where}'s agent`}: ${instruction} Review the diff when it is done; nothing is committed.`,
          commands: [],
          assets,
          missingAssets,
          terminal: null
        };
      }
      session = promoteSession(
        adapter,
        detection,
        this.repoRoot,
        { page: body.page, component: body.component, componentName: record.name },
        prepared,
        null
      );
    } catch (error) {
      return {
        ok: true,
        launched: false,
        message: `${describeError(error)} Give your agent this instruction in the repo: ${instruction}`,
        commands: [],
        assets,
        missingAssets,
        terminal: null
      };
    }
    const launched = await this.open([session], [null], body);
    const where =
      launched.kind === 'builtin'
        ? 'the built-in terminal'
        : launched.kind === 'external'
          ? launched.terminal
          : null;
    return {
      ok: true,
      launched: where !== null,
      message: where
        ? `Wrote ${prepared.promptFile} and opened the agent in ${where} to write ${prepared.targetFile}. Review the diff when it is done; nothing is committed.`
        : `Wrote ${prepared.promptFile}. ${launched.kind === 'manual' ? launched.reason : ''}`.trim(),
      commands: launched.kind === 'manual' ? launched.commands : [],
      assets,
      missingAssets,
      terminal: launched.kind === 'builtin' ? (launched.terminals[0] ?? null) : null
    };
  }

  /**
   * A project or library asset file's bytes, for iterations in the repo's dev server: prompts
   * name this server as their origin. Kept for a few minutes, so a page of images is one fetch
   * each.
   */
  async asset(scope: AssetScope, file: string): Promise<Buffer> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) throw new BadRequest('Not an asset file.');
    const key = `${scope}/${file}`;
    const cached = this.assets.get(key);
    if (cached && Date.now() - cached.at < ASSET_CACHE_MS) return cached.bytes;
    const { api, link } = this.options;
    const bytes = await api.file(link.orgId, link.project, scope, file);
    this.assets.set(key, { bytes, at: Date.now() });
    let total = 0;
    for (const [name, entry] of [...this.assets.entries()].reverse()) {
      total += entry.bytes.length;
      if (total > ASSET_CACHE_BYTES) this.assets.delete(name);
    }
    return bytes;
  }

  /** A screenshot's file, when the iteration has one at that size. */
  screenshotFile(target: ReviewTarget, size: string): string | null {
    this.assertIteration(target);
    const environment = this.environment;
    const names = screenshotSet(environment.viewports, environment.variants).map(shot => shot.name);
    if (!names.includes(size)) return null;
    const file = this.disk(screenshotPath(target.page, target.component, target.iteration, size));
    return fs.existsSync(file) ? file : null;
  }

  /**
   * Takes an iteration's screenshots, as `roughbook screenshot` does: at every viewport and
   * variant, again only when its files changed unless `force`, one job at a time per repo.
   */
  async screenshots(target: ReviewTarget, options: ShotOptions = {}) {
    this.assertIteration(target);
    if (!iterationExists(this.repoRoot, target.page, target.component, target.iteration)) {
      throw new BadRequest(
        `${target.page}/${target.component}/${target.iteration} is not in this repo.`
      );
    }
    const environment = this.previewEnvironment();
    recipeOf(environment)?.syncPreview(this.repoRoot);
    return queued(this.repoRoot, () =>
      this.context.screenshot(
        this.repoRoot,
        this.devUrl,
        target,
        this.context.env,
        undefined,
        undefined,
        undefined,
        environment,
        options
      )
    );
  }

  /** Sends what waits in the outbox; quiet when the server cannot be reached. */
  async flushOutbox(): Promise<void> {
    try {
      const { sent } = await this.outbox.flush(this.options.api);
      if (sent.size) this.projectChanged();
    } catch {
      // Tried again on the next tick.
    }
  }

  /** Keeps rough/preview-registry.ts in step with the iteration folders. */
  keepRegistry(): void {
    try {
      recipeOf(this.environment)?.syncPreview(this.repoRoot);
    } catch {
      // A folder being written mid-scan; the next tick catches up.
    }
  }

  async heartbeat(): Promise<void> {
    await sendHeartbeat(this.context, await this.agents());
  }

  /**
   * `studio.started`, with the agents found by id and version, when the designer agreed; then
   * whatever events wait. Analytics never stop the studio.
   */
  async reportStarted(): Promise<void> {
    try {
      const known = new Set(STARTED_AGENT_IDS);
      // "Your own editor" is always there; it says nothing about this machine.
      const found = (await this.agents()).filter(item => item.found && item.id !== 'other');
      // One entry per agent, however many adapters found it.
      const agents = found
        .filter((item, index) => found.findIndex(other => other.id === item.id) === index)
        .map(item => ({
          id: known.has(item.id) ? item.id : 'other',
          version:
            item.version && /^[0-9A-Za-z._:/+-]{1,100}$/.test(item.version) ? item.version : null
        }));
      await recordEvent(this.context, 'studio.started', {
        studioVersion: STUDIO_VERSION,
        os: currentOs(this.context.platform),
        agents
      });
      await this.flushEvents();
    } catch {
      // Nothing to tell the designer: analytics are optional.
    }
  }

  /** Sends the events waiting in the user config folder. */
  async flushEvents(): Promise<void> {
    try {
      await flushEvents(this.context, this.options.api);
    } catch {
      // They wait for the next try.
    }
  }

  /** A request of the local UI that failed: `error.reported` by its code, kept for the next send. */
  async reportError(error: unknown): Promise<void> {
    const code = errorCode(error);
    if (!code) return;
    try {
      await recordEvent(this.context, 'error.reported', { code, area: 'local-ui' });
    } catch {
      // As above.
    }
  }

  close(): void {
    for (const job of this.jobs.values()) job.controller.abort();
    for (const timer of this.reshots.values()) clearTimeout(timer);
    this.reshots.clear();
    this.terminals?.stopAll();
  }

  private runKind(body: RunBody): Pick<StartRunRequest, 'kind'> & Record<string, unknown> {
    if (!SLUG.test(String(body.page)) || !SLUG.test(String(body.component))) {
      throw new BadRequest('Name the page and component.');
    }
    if (body.mode !== 'interactive' && body.mode !== 'headless' && body.mode !== 'editor') {
      throw new BadRequest('A run is interactive, headless or in an editor.');
    }
    switch (body.kind) {
      case 'generate': {
        const directions = Array.isArray(body.directions) ? body.directions : [];
        if (!directions.length || directions.length > 8) {
          throw new BadRequest('Give one to eight directions.');
        }
        return {
          kind: 'generate',
          directions: directions.map(item => ({
            direction: text(item?.direction, 'A direction', 500),
            ...(typeof item?.hypothesis === 'string' && item.hypothesis.trim()
              ? { hypothesis: text(item.hypothesis, 'The hypothesis', 1000) }
              : {})
          }))
        };
      }
      case 'fork':
        if (!ITERATION.test(String(body.parent)))
          throw new BadRequest('Name the iteration to fork.');
        return { kind: 'fork', parent: body.parent };
      case 'refine': {
        if (!ITERATION.test(String(body.parent))) {
          throw new BadRequest('Name the iteration to refine.');
        }
        const observationIds = Array.isArray(body.observationIds)
          ? body.observationIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
          : [];
        return {
          kind: 'refine',
          parent: body.parent,
          preset: text(body.preset, 'The refinement', 40),
          intent: typeof body.intent === 'string' ? body.intent.trim().slice(0, 4000) : '',
          ...(observationIds.length ? { observationIds } : {}),
          ...(typeof body.preserve === 'string' && body.preserve.trim()
            ? { preserve: body.preserve.trim().slice(0, 2000) }
            : {})
        };
      }
      default:
        throw new BadRequest('A run makes new directions, a fork, or a refinement.');
    }
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    let run: RunRecord | null = null;
    try {
      run = await readRun(this.repoRoot, runId);
    } catch {
      run = null;
    }
    if (!run) throw new BadRequest(`There is no run ${runId} in this repo.`);
    return run;
  }

  private assertIteration(target: { page: string; component: string; iteration: string }): void {
    try {
      assertTarget(target.page, target.component, target.iteration);
    } catch (error) {
      throw new BadRequest((error as Error).message);
    }
  }

  private disk(relative: string): string {
    return path.join(this.repoRoot, ...relative.split('/'));
  }
}
