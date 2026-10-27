// What the local UI asks for, done with the same parts as the CLI: runs, Done, revert, review
// decisions through the outbox, promote, and the agents' sessions. The HTTP layer (app.ts) only
// checks who is asking and turns these into JSON.
import fs from 'node:fs';
import path from 'node:path';
import { ALL_AGENTS, hostLookup } from '../agents/index.js';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { AgentAdapter, AgentEvent, Detection, TerminalAdapter } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import {
  PICTURE_KINDS,
  type AssetScope,
  type PictureKind,
  type ProjectTree,
  type RatingSummary
} from '../api/types.js';
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
import {
  ENVIRONMENT_FILE,
  defaultEnvironment,
  previewUrl,
  readEnvironmentSync
} from '../environment/read.js';
import { adoptAllQuestion, adoptHere, describeAdoption, requireMap } from '../commands/adopt.js';
import {
  ASK_PAST,
  BASELINE,
  chooseAdoption,
  countAdoption,
  type AdoptChoice
} from '../map/adopt.js';
import { readMap } from '../map/file.js';
import { contextAddress, contextSections } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import { LAZY_IMPORT_NOTICE, isLazyImportFault } from '../recipes/next/fault.js';
import type { ComponentKind, Known, RepoMap } from '../map/types.js';
import {
  pictureShot,
  picturesAfterShots,
  picturesDir,
  sharePagePictures
} from '../pictures/share.js';
import { clearMapPictures, MAP_PICTURES_PAGE, takeMapPictures } from '../pictures/mapPictures.js';
import {
  PictureQueue,
  takeLeftForStart,
  type QueueView,
  type TakeResult
} from '../pictures/queue.js';
import { findBrowser, takeScreenshot } from '../screenshot/browser.js';
import { resolveVariants, screenshotSet, type ResolvedVariant } from '../environment/variants.js';
import { currentOs } from '../launch/platform.js';
import { resolveCommandLine } from '../launch/processes.js';
import type { PtySupport } from '../launch/pty.js';
import { findProgramOnPath } from '../launch/which.js';
import { manualCommand, planTerminal, type Session } from '../launch/terminal.js';
import type { RepoLink } from '../repo/link.js';
import type { RepoEnvironment, Terms, Viewport } from '../environment/types.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { syncIterations } from '../repo/mirror.js';
import { ITERATION, SLUG, iterationDir, listIterations } from '../repo/iterations.js';
import { roughPath } from '../repo/root.js';
import { forkFields } from '../runs/forkIntent.js';
import { assessRun, putBack, startRuns } from '../runs/lifecycle.js';
import { queued } from '../runs/queue.js';
import { watchRepo } from '../runs/watch.js';
import {
  findComponent,
  mapHere,
  newComponentFile,
  preparePromotion,
  publicDirFor,
  type PreparedPromotion
} from '../runs/promote.js';
import { headCommit, inPlaceBase } from '../runs/base.js';
import {
  commitPromotion,
  declinePromotionCommit,
  defaultBranch,
  listPromotions,
  planTargets,
  promotionDiff,
  putBackPromoted,
  type PromotionRecord
} from '../runs/promotion.js';
import type { Revert } from '../runs/snapshot.js';
import { finishPromotionHere } from '../commands/finishPromotion.js';
import {
  COMPOSITION_ID,
  describePlan,
  sectionNames,
  type CompositionSection
} from '../compositions/composition.js';
import {
  defaultPageBranch,
  planPagePromote,
  preparePagePromotion,
  type PagePromotePlan
} from '../compositions/promote.js';
import {
  composedAddress,
  makeSection,
  saveComposition,
  shareComposition
} from '../compositions/save.js';
import {
  COMPOSITIONS_DIR,
  COMPOSITION_FILE,
  compositionDir,
  listCompositions
} from '../compositions/store.js';
import {
  driftView,
  finishView,
  type PromoteCommitView,
  type PromoteDriftView,
  type PromoteFinishView
} from './promoteView.js';
import {
  addPackages,
  portSketch,
  pullAdvice,
  pullPlanFor,
  pullSketch,
  sketchFiles,
  sketchReferenceDir
} from '../runs/pull.js';
import { sendDecision, type Decision, type ReviewTarget } from '../runs/reviews.js';
import { assertTarget, iterationExists } from '../runs/slots.js';
import { listRuns, readRun } from '../runs/store.js';
import type { RunAgent, RunRecord, StartRunRequest } from '../runs/types.js';
import {
  SHOTS_MANIFEST,
  mapScreenshotPath,
  screenshotPath,
  type ShotOptions
} from '../screenshot/iteration.js';
import { openOnDevice } from '../snapshot/device.js';
import {
  describeResult,
  renderSnapshots,
  type SnapshotExec,
  type SnapshotRun
} from '../snapshot/render.js';
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
  /** How the snapshot and device commands run; replaced in tests. */
  snapshotExec?: SnapshotExec;
  /** How a map component's pictures are taken; replaced in tests. */
  mapPictures?: typeof takeMapPictures;
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
  /**
   * The snapshot command, when the repo has one (the preview itself in snapshot mode, final review
   * beside a live one), and whether it is approved here; no command line.
   */
  snapshot: { approved: boolean } | null;
  /** The device command, when the repo has one, and whether it is approved here. */
  device: { approved: boolean } | null;
};

/** What the studio last knew of one iteration's snapshot images. */
export type SnapshotView = {
  status: 'none' | 'rendering' | 'ready' | 'failed';
  message: string | null;
  /** When the images were last rendered. */
  at: string | null;
};

/** What the app the previews come from is doing, as the studio last saw it. */
export type AppView = {
  status: 'unknown' | 'starting' | 'up' | 'down';
  /** The terminal session the studio started it in, when it did. */
  terminal: string | null;
  since: string | null;
  /** The last line the app printed while starting, for the frame's progress. */
  lastLine: string | null;
  /**
   * What the app's session printed that a restart mends, in the frame's notice: Turbopack's lost
   * lazy import (B7b, decision 68). Null otherwise, or when the studio did not start the app.
   */
  fault: string | null;
};

/**
 * The map as the canvas's "In the app" group shows it (B2 of the brownfield plan): names, kinds and
 * what is known, with doctor's pictures by viewport. No path: the page has no use for one.
 */
export type MapView = {
  pages: {
    slug: string;
    name: string;
    address: string | null;
    signIn: Known;
    sections: string[];
    /** Doctor's pictures of the page, by viewport name. */
    shots: string[];
  }[];
  components: {
    slug: string;
    name: string;
    kind: ComponentKind;
    alone: Known;
    why: string | null;
    shots: string[];
    /** When its pictures were last taken, so a card asks for them again after. */
    shotsAt: string | null;
    /** When the map found it gone from the app (B7, decision 64), or null. */
    gone: string | null;
  }[];
  /** Why rough/map.md cannot be read, or null. */
  problem: string | null;
};

/** A page's composition kept in rough/ (B6), as the canvas and its own view show it. */
export type CompositionView = {
  page: string;
  id: string;
  number: number;
  name: string;
  parent: string | null;
  sections: CompositionSection[];
  /** When its composition.json was written, for the canvas's order. */
  savedAt: string | null;
  /** The composed preview's path on the app, where the recipe composes; null otherwise. */
  address: string | null;
  /** The pictures taken of it here: thumbnail, desktop and phone. */
  pictures: PictureKind[];
};

/** What `POST /api/adopt` answers: what it made, or the question "Adopt all" asks first. */
export type AdoptAnswer =
  { ask: { question: string; count: number } } | { lines: string[]; written: string[] };

/** How long after the last write to an iteration its screenshots are taken again. */
const RESHOT_AFTER_MS = 5000;
/** The one timer under which snapshot mode's changed keys wait, to be rendered together. */
const PENDING = '#snapshots';
/** After a key in the change feed: its images changed, not its files. */
export const IMAGES = '#images';
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
  | {
      kind: 'fork';
      parent: string;
      intent?: { remain?: unknown; change?: unknown };
      radical?: boolean;
    }
  /** A web sketch ported into this repo's stack: a pull run (F7 of the frameworks plan). */
  | { kind: 'pull'; sketch: string }
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
  private app: AppView = {
    status: 'unknown',
    terminal: null,
    since: null,
    lastLine: null,
    fault: null
  };
  private readonly reshots = new Map<string, NodeJS.Timeout>();
  /** Snapshot images per key, as the last render left them; rendering while the command runs. */
  private readonly snapshotStates = new Map<string, SnapshotView>();
  /** The changed keys waiting to be rendered, in snapshot mode. */
  private readonly pendingSnapshots = new Set<string>();
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
  /**
   * Pictures as they are needed (decision 65 of the brownfield plan): the cards the canvas shows
   * first, then the rest, one at a time. Keys are `iteration:<page>/<component>/<iteration>` for
   * an iteration here and `map:<slug>` for a map component not adopted yet.
   */
  readonly pictures: PictureQueue;
  /** Whether everything else is queued behind the shown cards yet: once, at the canvas's first ask. */
  private restQueued = false;

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
    this.pictures = new PictureQueue(key => this.takePicture(key), {
      onTaken: key =>
        this.changes.note(
          key.startsWith('map:') ? `${key}${IMAGES}` : `${key.slice('iteration:'.length)}${IMAGES}`
        ),
      // The pointers the map's pictures were taken through go once nothing waits.
      onIdle: () => {
        try {
          clearMapPictures(this.repoRoot, this.previewEnvironment());
        } catch {
          // The next idle tries again; doctor clears its pages too.
        }
      }
    });
  }

  get repoRoot(): string {
    return this.options.context.repoRoot;
  }

  /** Whether the studio's own server shows the previews (the environment's mode, as it is now). */
  get standaloneMode(): boolean {
    return this.environment.mode === 'standalone';
  }

  /** Whether the repo's own snapshot command renders the previews, with no app to run. */
  get snapshotMode(): boolean {
    return this.environment.mode === 'snapshot';
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
      timeouts: { preview: environment.timeouts.preview },
      snapshot: environment.snapshot
        ? { approved: isApproved(approvals, environment.snapshot, environment.shell) }
        : null,
      device: environment.device
        ? { approved: isApproved(approvals, environment.device, environment.shell) }
        : null
    };
  }

  /** The app's state, with the last line of its session while it starts. */
  appView(): AppView {
    // In standalone mode the studio's own server is the app, up while the studio is; in snapshot
    // mode nothing runs between renders.
    if (this.standaloneMode || this.snapshotMode) {
      return { status: 'up', terminal: null, since: null, lastLine: null, fault: null };
    }
    const terminal = this.app.terminal ? this.terminals?.get(this.app.terminal) : null;
    if (this.app.status === 'starting' && terminal?.status === 'exited') {
      this.app = { ...this.app, status: 'down' };
    }
    return {
      ...this.app,
      lastLine:
        this.app.terminal && terminal?.status === 'running'
          ? (this.terminals?.lastLine(this.app.terminal) ?? null)
          : null,
      fault:
        this.app.terminal && this.terminals?.printed(this.app.terminal, isLazyImportFault)
          ? LAZY_IMPORT_NOTICE
          : null
    };
  }

  /** Asks the app once whether it answers at its address, and keeps the answer for the page. */
  async checkApp(): Promise<AppView> {
    if (this.standaloneMode || this.snapshotMode) return this.appView();
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
    if (this.snapshotMode) {
      throw new BadRequest(
        "In snapshot mode the repo's snapshot command renders the previews as images; there is no app to start."
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
      lastLine: null,
      fault: null
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
    // Snapshot mode renders every changed key in one run of the command, after the last write.
    if (this.snapshotMode) {
      if (key.endsWith(IMAGES)) return;
      this.pendingSnapshots.add(key);
      const pending = this.reshots.get(PENDING);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        this.reshots.delete(PENDING);
        void this.renderPending();
      }, RESHOT_AFTER_MS);
      timer.unref();
      this.reshots.set(PENDING, timer);
      return;
    }
    const waiting = this.reshots.get(key);
    if (waiting) clearTimeout(waiting);
    const timer = setTimeout(() => {
      this.reshots.delete(key);
      void this.reshoot(key);
    }, RESHOT_AFTER_MS);
    timer.unref();
    this.reshots.set(key, timer);
  }

  /** Renders the keys that changed while the UI was open, but none an agent is still writing. */
  private async renderPending(): Promise<void> {
    const keys = [...this.pendingSnapshots];
    this.pendingSnapshots.clear();
    try {
      const open = new Set(
        (await listRuns(this.repoRoot))
          .filter(run => run.status === 'started')
          .map(run => `${run.page}/${run.component}/${run.iteration}`)
      );
      const ready = keys.filter(key => {
        const [page, component, iteration] = key.split('/') as [string, string, string];
        return !open.has(key) && iterationExists(this.repoRoot, page, component, iteration);
      });
      if (ready.length) await this.render(ready, {});
    } catch {
      // The next change tries again; the designer can also ask for them on the stage.
    }
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
    const iterations = listIterations(this.repoRoot, environment.entry).filter(
      key => !key.startsWith(`${MAP_PICTURES_PAGE}/`)
    );
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
    const inPage = this.inPageView();
    return {
      iterations,
      screenshots,
      screenshotsAt,
      map: this.mapView(),
      // A page's compositions (B6), and where a composed preview is asked, where the recipe composes.
      compositions: this.compositionsView(),
      composeTemplate: composedAddress(environment, '{page}', []),
      inPage,
      // What the in-page view covers on this stack, beside In its page (decision 44).
      inPageNote: inPage ? (recipeFor(this.environment.recipe)?.contextPreview?.note ?? null) : null
    };
  }

  /**
   * Where the frame shows each adopted section's iterations in their page, and each adopted
   * page's own view with its markers (B5): addresses on the app, by iteration key and by page
   * slug. Null where the recipe has no in-page view, the preview is not live, or the switch is
   * not set up yet (doctor's map-context asks for setup --upgrade).
   */
  private inPageView(): Record<string, string> | null {
    const environment = this.environment;
    const hook = recipeFor(environment.recipe)?.contextPreview;
    if (!hook || environment.mode !== 'live') return null;
    let map: RepoMap | undefined;
    try {
      map = readMap(this.repoRoot)?.map;
    } catch {
      return null;
    }
    if (!map || hook.missing(this.repoRoot, this.options.link).length) return null;
    const view: Record<string, string> = {};
    for (const section of contextSections(this.repoRoot, environment.entry, map)) {
      const address = contextAddress(map, section);
      if (!address) continue;
      view[section.page] ??= hook.address(address, null);
      for (const iteration of section.iterations) {
        view[iteration.key] = hook.address(address, iteration.key);
      }
    }
    return view;
  }

  /** rough/map.md for the canvas, or null when the repo has none. */
  private mapView(): MapView | null {
    let read: ReturnType<typeof readMap>;
    try {
      read = readMap(this.repoRoot);
    } catch (error) {
      return { pages: [], components: [], problem: describeError(error) };
    }
    if (!read) return null;
    const viewports = this.environment.viewports.map(viewport => viewport.name);
    const shots = (kind: 'page' | 'component', slug: string) =>
      viewports.filter(size => fs.existsSync(this.disk(mapScreenshotPath(kind, slug, size))));
    const shotsAt = (slug: string) => {
      const first = viewports[0];
      try {
        return first
          ? fs.statSync(this.disk(mapScreenshotPath('component', slug, first))).mtime.toISOString()
          : null;
      } catch {
        return null;
      }
    };
    return {
      pages: read.map.pages.map(page => ({
        slug: page.slug,
        name: page.name,
        address: page.example ?? page.address,
        signIn: page.signIn,
        sections: page.sections,
        shots: shots('page', page.slug)
      })),
      components: read.map.components.map(component => ({
        slug: component.slug,
        name: component.name,
        kind: component.kind,
        alone: component.alone,
        why: component.why,
        shots: shots('component', component.slug),
        shotsAt: shotsAt(component.slug),
        gone: component.gone ?? null
      })),
      problem: null
    };
  }

  /** Doctor's picture of a map page or component at a viewport, when there is one. */
  mapShotFile(kind: 'page' | 'component', slug: string, size: string): string | null {
    if (!SLUG.test(slug) || !this.environment.viewports.some(item => item.name === size)) {
      return null;
    }
    const file = this.disk(mapScreenshotPath(kind, slug, size));
    return fs.existsSync(file) ? file : null;
  }

  /**
   * Adopts a page, one of its components, or everything (the canvas's Adopt and Adopt all), as
   * `roughbook adopt` does: "Adopt all" past 50 components answers with its question first, until
   * asked again with `yes`. The baselines' screenshots and the pictures follow, in the background.
   */
  async adopt(body: Record<string, unknown>): Promise<AdoptAnswer> {
    let choice: AdoptChoice;
    if (body.all === true) choice = { all: true };
    else if (typeof body.page === 'string' && SLUG.test(body.page)) {
      if (
        body.component !== undefined &&
        (typeof body.component !== 'string' || !SLUG.test(body.component))
      ) {
        throw new BadRequest('Name a component of the map.');
      }
      choice = {
        page: body.page,
        ...(body.component ? { component: body.component as string } : {})
      };
    } else throw new BadRequest('Name a page of the map, or adopt all.');
    let map;
    let adoption;
    try {
      map = requireMap(this.repoRoot);
      adoption = chooseAdoption(map, choice);
    } catch (error) {
      throw new BadRequest(describeError(error));
    }
    if ('all' in choice && countAdoption(adoption) > ASK_PAST && body.yes !== true) {
      return { ask: { question: adoptAllQuestion(adoption), count: countAdoption(adoption) } };
    }
    const { api, link } = this.options;
    const environment = this.environment;
    const outcome = await adoptHere(this.repoRoot, api, link, environment, map, adoption);
    this.projectChanged();
    this.queueAdopted(
      outcome.baselines.written,
      outcome.adopted.pages.map(page => page.slug)
    );
    return { lines: describeAdoption(outcome), written: outcome.baselines.written };
  }

  /**
   * After an adoption, here or by start's sync of the map (B7): the new baselines' screenshots and
   * pictures, in the picture queue behind the cards on screen (decision 65), then the adopted
   * pages' pictures. `baselines` are `<page>/<component>`, `pages` page slugs. Returns at once.
   */
  queueAdopted(baselines: string[], pages: string[]): void {
    this.pictures.add(baselines.map(key => `iteration:${key}/${BASELINE}`));
    void this.picturePages(pages);
  }

  /** The adopted pages' pictures, at their addresses on the app. */
  private async picturePages(pages: string[]): Promise<void> {
    try {
      const shoot = pictureShot(this.context);
      const map = readMap(this.repoRoot)?.map;
      if (!shoot || !map || this.environment.mode !== 'live') return;
      for (const slug of pages) {
        const page = map.pages.find(item => item.slug === slug);
        if (!page) continue;
        await sharePagePictures(
          {
            repoRoot: this.repoRoot,
            api: this.options.api,
            outbox: this.outbox,
            link: this.options.link,
            environment: this.environment,
            shoot
          },
          page,
          this.devUrl
        );
      }
    } catch {
      // The pictures wait for the next screenshots; the adoption itself is done.
    }
  }

  /** The compositions in rough/, newest of each page last, for the canvas and their own view. */
  private compositionsView(): CompositionView[] {
    const environment = this.environment;
    return listCompositions(this.repoRoot).map(kept => {
      let savedAt: string | null = null;
      try {
        savedAt = fs
          .statSync(this.disk(`${compositionDir(kept.page, kept.id)}/${COMPOSITION_FILE}`))
          .mtime.toISOString();
      } catch {
        // Gone since it was listed.
      }
      const pictures = picturesDir({ page: kept.page, composition: kept.id });
      return {
        page: kept.page,
        id: kept.id,
        number: kept.number,
        name: kept.composition.name,
        parent: kept.composition.parent,
        sections: kept.composition.sections,
        savedAt,
        address: composedAddress(environment, kept.page, kept.composition.sections),
        pictures: PICTURE_KINDS.filter(kind => fs.existsSync(this.disk(`${pictures}/${kind}.webp`)))
      };
    });
  }

  /**
   * The composition editor's Save (B6): numbered by the backend, written with the page's base, its
   * composed preview's pictures taken after, where the recipe composes and the app is running.
   */
  async saveComposition(body: Record<string, unknown>) {
    const page = typeof body.page === 'string' ? body.page : '';
    if (!SLUG.test(page)) throw new BadRequest('Name a page of the map.');
    const sections = Array.isArray(body.sections) ? body.sections : null;
    if (
      !sections ||
      !sections.every(
        (item): item is CompositionSection =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as CompositionSection).component === 'string' &&
          typeof (item as CompositionSection).iteration === 'string'
      )
    ) {
      throw new BadRequest('sections is a list of { component, iteration }, in order.');
    }
    const name = typeof body.name === 'string' ? body.name : undefined;
    const parent =
      typeof body.parent === 'string' && body.parent ? (body.parent as string) : undefined;
    const { api, link } = this.options;
    const saved = await saveComposition(this.repoRoot, api, link, this.environment, {
      page,
      sections,
      ...(name !== undefined ? { name } : {}),
      ...(parent ? { parent } : {})
    });
    this.projectChanged();
    void this.pictureComposition(page, saved.id);
    // A new section is named as it was made, which only the project knows.
    const { tree } = await this.project().catch(() => ({ tree: null }));
    return {
      id: saved.id,
      number: saved.number,
      lines: describePlan(saved.plan, sectionNames(readMap(this.repoRoot)?.map ?? null, tree, page))
    };
  }

  /** A composition's pictures, after it is saved: none where the app does not answer. */
  private async pictureComposition(page: string, id: string): Promise<void> {
    try {
      const shoot = pictureShot(this.context);
      if (!shoot || !this.options.api.signedIn) return;
      if (!(await this.context.askPreview(this.devUrl, APP_ASK_MS))) return;
      await shareComposition(
        {
          repoRoot: this.repoRoot,
          api: this.options.api,
          outbox: this.outbox,
          link: this.options.link,
          environment: this.previewEnvironment(),
          shoot
        },
        { page, id },
        this.devUrl
      );
      this.changes.note(`${page}/${COMPOSITIONS_DIR}/${id}${IMAGES}`);
    } catch {
      // Taken again with the composition command's --pictures, or at the next save.
    }
  }

  /** The composition editor's new section (decision 47): made on the backend, its folder here. */
  async makeSection(body: Record<string, unknown>) {
    const page = typeof body.page === 'string' ? body.page : '';
    if (!SLUG.test(page)) throw new BadRequest('Name a page of the map.');
    const name = typeof body.name === 'string' ? body.name : '';
    const { api, link } = this.options;
    const made = await makeSection(this.repoRoot, api, link, this.environment, { page, name });
    this.projectChanged();
    return { slug: made.slug, name: made.name };
  }

  /** One of a composition's pictures, for the canvas's card; null when it has none. */
  compositionPictureFile(page: string, id: string, kind: string): string | null {
    if (!SLUG.test(page) || !COMPOSITION_ID.test(id)) return null;
    if (!PICTURE_KINDS.includes(kind as PictureKind)) return null;
    const file = this.disk(`${picturesDir({ page, composition: id })}/${kind}.webp`);
    return fs.existsSync(file) ? file : null;
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
    const assetOrigin = localOrigin({ localPort: this.options.port });
    // A port writes the sketch's files beside the component first, as its reference.
    const runs =
      request.kind === 'pull'
        ? await portSketch(
            this.repoRoot,
            api,
            link,
            { page: request.page, component: request.component, sketch: request.sketch },
            {
              agent: request.agent,
              mode: request.mode,
              files: await sketchFiles(api, link, {
                page: request.page,
                component: request.component,
                sketch: request.sketch
              })
            },
            { assetOrigin }
          )
        : await startRuns(this.repoRoot, api, link, request, { assetOrigin });
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

  /**
   * Pulls a web sketch into rough/ (F7 of the frameworks plan): copied as a new local iteration
   * where its files render here as they are, saying what the app still needs. Anywhere else the
   * answer says it is ported, and why, and allocates nothing: the page starts the port as a pull
   * run (`POST /api/runs`, kind pull). Where only packages the app does not list stand between
   * the two, the answer names the command that adds them; `how: "add"` runs it, the designer
   * having approved it on the page, and copies the sketch.
   */
  async pull(target: ReviewTarget, body: Record<string, unknown> = {}) {
    this.assertIteration(target);
    const { api, link } = this.options;
    const sketch = { page: target.page, component: target.component, sketch: target.iteration };
    const files = await sketchFiles(api, link, sketch);
    let plan = await pullPlanFor(this.repoRoot, link, files);
    if (plan.how === 'port' && plan.add && body.how === 'add') {
      const added = await (this.context.addPackages ?? addPackages)(this.repoRoot, plan.add);
      if (!added.ok) {
        const tail = added.output.trim().split('\n').slice(-3).join(' ');
        throw new BadRequest(`${plan.add} did not finish${tail ? `: ${tail}` : '.'}`);
      }
      plan = await pullPlanFor(this.repoRoot, link, files);
    }
    if (plan.how === 'port' || body.how === 'port') {
      return {
        kind: 'port' as const,
        why: plan.why,
        packages: plan.missingPackages,
        add: plan.add,
        reference: sketchReferenceDir(sketch.page, sketch.component, sketch.sketch)
      };
    }
    const pulled = await pullSketch(this.repoRoot, api, link, sketch, {
      assetOrigin: localOrigin({ localPort: this.options.port })
    });
    return { kind: 'copied' as const, ...pulled, advice: pullAdvice(pulled) };
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
    /** A new branch for the change (decision 18), by its name. */
    branch?: string;
    /** A page's composition (B6), instead of an iteration. */
    composition?: string;
  }): Promise<PromoteResult> {
    const { api, link } = this.options;
    const branch = body.branch?.trim();
    if (body.composition !== undefined) {
      if (!SLUG.test(body.page) || !COMPOSITION_ID.test(body.composition)) {
        throw new BadRequest('Name a page and one of its compositions.');
      }
      const tree = await api.project(link.orgId, link.project);
      const prepared = await preparePagePromotion(this.repoRoot, api, link, tree, {
        page: body.page,
        composition: body.composition,
        ...(branch ? { branch } : {})
      });
      return this.handOffPromote(
        prepared,
        {
          page: body.page,
          component: `${COMPOSITIONS_DIR}/${body.composition}`,
          componentName: `${body.page} ${body.composition}`
        },
        body,
        "the page's files and its new sections"
      );
    }
    this.assertIteration(body);
    const tree = await api.project(link.orgId, link.project);
    const record = findComponent(tree, body.page, body.component);
    const prepared = await preparePromotion(this.repoRoot, api, link, tree, {
      page: body.page,
      component: body.component,
      iteration: body.iteration,
      targetFile: body.targetFile?.trim() || undefined,
      ...(branch ? { branch } : {})
    });
    return this.handOffPromote(
      prepared,
      { page: body.page, component: body.component, componentName: record.name },
      body,
      prepared.how === 'new' ? prepared.targetFile : "the app's own files"
    );
  }

  /** Hands a prepared promote to the agent: an editor, a terminal, or the instruction to paste. */
  private async handOffPromote(
    prepared: Pick<
      PreparedPromotion,
      'promptFile' | 'promotionId' | 'copied' | 'missing' | 'branch'
    >,
    target: { page: string; component: string; componentName: string },
    body: { agent?: string; terminal?: 'builtin' | 'external'; cols?: number; rows?: number },
    writes: string
  ): Promise<PromoteResult> {
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
          message: `Wrote ${prepared.promptFile}${opened.opened === 'editor' ? ` and opened it in ${where}` : opened.opened === 'default-app' ? ' and opened it with your default app' : ''}. ${opened.copied ? 'The instruction is on the clipboard' : 'Paste this instruction'} for a new chat with ${where === 'your editor' ? 'your agent' : `${where}'s agent`}: ${instruction} When it is done, Finish shows the diff and runs the app's checks.`,
          commands: [],
          assets,
          missingAssets,
          terminal: null
        };
      }
      session = promoteSession(adapter, detection, this.repoRoot, target, prepared, null);
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
        ? `Wrote ${prepared.promptFile} and opened the agent in ${where} to write ${writes}${prepared.branch ? ` on ${prepared.branch.name}` : ''}. When it is done, Finish shows the diff and runs the app's checks.`
        : `Wrote ${prepared.promptFile}. ${launched.kind === 'manual' ? launched.reason : ''}`.trim(),
      commands: launched.kind === 'manual' ? launched.commands : [],
      assets,
      missingAssets,
      terminal: launched.kind === 'builtin' ? (launched.terminals[0] ?? null) : null
    };
  }

  /** The latest promote of an iteration on this machine, open or finished, or null. */
  private async latestPromotion(target: {
    page: string;
    component: string;
    iteration: string;
  }): Promise<PromotionRecord | null> {
    return (
      (await listPromotions(this.repoRoot)).find(
        item =>
          item.page === target.page &&
          item.component === target.component &&
          item.iteration === target.iteration
      ) ?? null
    );
  }

  /**
   * What the promote panel knows before the promote (B4): where it goes, whether the app moved
   * since the fork, whether a branch can be made, and what the last finish found.
   */
  async promotePlan(target: { page: string; component: string; iteration: string }) {
    this.assertPromoteTarget(target);
    if (target.component === COMPOSITIONS_DIR) return this.pagePromotePlan(target);
    const relative = iterationDir(target.page, target.component, target.iteration);
    // A fork of a component gone from the app has no file to promote into: a new one (B7).
    const base = inPlaceBase(this.repoRoot, relative);
    let drift: PromoteDriftView | null = null;
    let defaultFile: string | null = null;
    let problem: string | null = null;
    if (base) {
      try {
        const planned = planTargets(this.repoRoot, relative, base, this.previewEnvironment());
        drift = driftView(planned.how, planned.targets);
        defaultFile = planned.targets[0]!.path;
      } catch (error) {
        problem = describeError(error);
      }
    } else {
      // A new file: beside its page's own sections when the map has the page (decision 56).
      try {
        const { api, link } = this.options;
        const tree = await this.cache.project(() => api.project(link.orgId, link.project));
        const record = findComponent(tree, target.page, target.component);
        defaultFile = newComponentFile(
          this.repoRoot,
          this.previewEnvironment(),
          tree,
          mapHere(this.repoRoot),
          { page: target.page, component: target.component, name: record.name }
        );
      } catch {
        // The panel's own default stands: the promote says what is wrong when it starts.
      }
    }
    const latest = await this.latestPromotion(target);
    return {
      defaultFile,
      drift,
      problem,
      branchChoice: {
        defaultName: defaultBranch(target.page, target.component, target.iteration),
        unavailable: (await headCommit(this.repoRoot))
          ? null
          : 'This repo is not a git repository with a commit, so the change cannot go on a branch of its own.'
      },
      open: latest?.status === 'started',
      finish:
        latest?.status === 'finished'
          ? finishView(latest, await promotionDiff(this.repoRoot, latest))
          : null
    };
  }

  /**
   * What a composition's Promote knows before it starts (B6): the page's files and the new
   * sections' files, whether the page moved since it was saved, the sections that keep the app's
   * own version, whether a branch can be made, and what the last finish found.
   */
  private async pagePromotePlan(target: { page: string; component: string; iteration: string }) {
    const environment = this.previewEnvironment();
    let planned: PagePromotePlan | null = null;
    let problem: string | null = null;
    try {
      const map = readMap(this.repoRoot)?.map;
      if (!map) throw new Error('There is no rough/map.md yet. Run roughbook map first.');
      const { api, link } = this.options;
      const tree = await this.cache.project(() => api.project(link.orgId, link.project));
      planned = planPagePromote(
        this.repoRoot,
        environment,
        map,
        tree,
        publicDirFor(this.repoRoot, link, tree, undefined, environment.assets.dir),
        { page: target.page, composition: target.iteration }
      );
    } catch (error) {
      problem = describeError(error);
    }
    const latest = await this.latestPromotion(target);
    return {
      defaultFile: null,
      drift: planned ? driftView(planned.how, planned.targets) : null,
      problem,
      branchChoice: {
        defaultName: defaultPageBranch(target.page, target.iteration),
        unavailable: (await headCommit(this.repoRoot))
          ? null
          : 'This repo is not a git repository with a commit, so the change cannot go on a branch of its own.'
      },
      open: latest?.status === 'started',
      finish:
        latest?.status === 'finished'
          ? finishView(latest, await promotionDiff(this.repoRoot, latest))
          : null,
      // What the promote writes: the page's files, then each new section's file.
      targets: (planned?.targets ?? []).map(item => ({
        path: item.path,
        section: item.section ?? null,
        drifted: item.drifted
      })),
      keepsApp: planned?.keepsApp ?? [],
      counts: planned?.plan.counts ?? null
    };
  }

  /** The local UI's Finish of an iteration's open promote: its checks, then the refreshed baseline. */
  async finishPromote(body: {
    page: string;
    component: string;
    iteration: string;
    conflicts?: unknown;
  }): Promise<PromoteFinishView> {
    this.assertPromoteTarget(body);
    const conflicts = body.conflicts;
    if (
      conflicts !== undefined &&
      (!Array.isArray(conflicts) || !conflicts.every(item => typeof item === 'string'))
    ) {
      throw new BadRequest('conflicts is a list of where the two changes conflict, in words.');
    }
    const latest = await this.latestPromotion(body);
    if (!latest) throw new BadRequest('This iteration has not been promoted from this repo.');
    const { record } = await finishPromotionHere(
      this.context,
      this.options.api,
      this.outbox,
      this.options.link,
      latest.promotionId,
      {
        conflicts: (conflicts as string[] | undefined) ?? [],
        devUrl: this.devUrl,
        environment: this.previewEnvironment(),
        refresh: true
      }
    );
    return finishView(record, await promotionDiff(this.repoRoot, record));
  }

  /** Puts back one file the iteration's last promote changed. */
  async revertPromoted(body: { page: string; component: string; iteration: string; path: string }) {
    this.assertPromoteTarget(body);
    const latest = await this.latestPromotion(body);
    if (!latest || latest.status !== 'finished') {
      throw new BadRequest('Finish the promote first; then a file it changed can be put back.');
    }
    let result: Revert;
    try {
      result = await putBackPromoted(this.repoRoot, latest, body.path.replace(/\\/g, '/'));
    } catch (error) {
      throw new BadRequest(describeError(error));
    }
    if (result === 'cannot') {
      throw new BadRequest(
        'The studio kept no copy of it, so it cannot be put back here. Restore it from git or your editor.'
      );
    }
    return { result };
  }

  /** The designer's Yes or No to committing the promote's files on its branch (decision 18). */
  async commitPromote(body: {
    page: string;
    component: string;
    iteration: string;
    commit: boolean;
  }): Promise<PromoteCommitView> {
    this.assertPromoteTarget(body);
    const latest = await this.latestPromotion(body);
    if (!latest?.branch || !latest.commit) {
      return {
        ok: false,
        message: 'This promote is not on a branch of its own; nothing is committed.'
      };
    }
    if (!body.commit) {
      await declinePromotionCommit(this.repoRoot, latest.promotionId);
      return {
        ok: true,
        message: `Left uncommitted on ${latest.branch.name}. Commit it yourself, or run roughbook done ${body.page}/${body.component}/${body.iteration} --commit.`,
        commit: null
      };
    }
    try {
      const committed = await commitPromotion(this.repoRoot, latest.promotionId);
      return {
        ok: true,
        message: `Committed the promote's files on ${latest.branch.name}. Nothing was pushed.`,
        commit: committed.commit?.sha ?? null
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
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

  /**
   * The cards the canvas shows now, by card key (`iteration:<page>/<component>/<iteration>`): their
   * pictures are taken first, in that order, then every other card's, and the baselines
   * `roughbook adopt` left. Ids only; at most 200.
   */
  async showCards(body: Record<string, unknown>): Promise<QueueView> {
    const cards = body.cards;
    if (!Array.isArray(cards) || cards.length > 200) {
      throw new BadRequest('Name the cards on screen, at most 200.');
    }
    const keys = cards.map(card => {
      const [page = '', component = '', iteration = '', ...rest] = (
        /^iteration:(.*)$/.exec(String(card))?.[1] ?? ''
      ).split('/');
      if (rest.length || !SLUG.test(page) || !SLUG.test(component) || !ITERATION.test(iteration)) {
        throw new BadRequest('A card is named iteration:<page>/<component>/<iteration>.');
      }
      return this.pictureKey(page, component, iteration);
    });
    this.pictures.show(keys.filter((key): key is string => key !== null));
    const left = await takeLeftForStart(this.repoRoot).catch(() => []);
    this.pictures.add(left.map(key => `iteration:${key}`));
    if (!this.restQueued) {
      this.restQueued = true;
      this.pictures.add(this.everyPictureKey());
    }
    return this.pictures.view();
  }

  /** What the picture queue is doing. */
  picturesView(): QueueView {
    return this.pictures.view();
  }

  /** A card's key in the queue: its iteration here, or its map component not adopted yet. */
  private pictureKey(page: string, component: string, iteration: string): string | null {
    if (iterationExists(this.repoRoot, page, component, iteration)) {
      return `iteration:${page}/${component}/${iteration}`;
    }
    return iteration === BASELINE ? `map:${component}` : null;
  }

  /** Every card's key: the iterations here, then the map's components not adopted yet. */
  private everyPictureKey(): string[] {
    const iterations = listIterations(this.repoRoot, this.environment.entry).filter(
      key => !key.startsWith(`${MAP_PICTURES_PAGE}/`)
    );
    let components: string[] = [];
    try {
      const adopted = new Set(iterations.map(key => key.split('/')[1]));
      components = (readMap(this.repoRoot)?.map.components ?? [])
        .filter(item => item.kind !== 'atom' && !adopted.has(item.slug))
        .map(item => `map:${item.slug}`);
    } catch {
      // A map that cannot be read has no cards.
    }
    return [...iterations.map(key => `iteration:${key}`), ...components];
  }

  /** Takes one card's pictures, unless the ones it has show its source as it is now. */
  private async takePicture(key: string): Promise<TakeResult> {
    if (this.snapshotMode) return 'skipped';
    if (this.appView().status !== 'up' && (await this.checkApp()).status !== 'up') return 'wait';
    if (key.startsWith('map:')) {
      const slug = key.slice('map:'.length);
      const component = readMap(this.repoRoot)?.map.components.find(item => item.slug === slug);
      if (!component) return 'skipped';
      const browser = findBrowser(this.context.env);
      if (!browser && !this.options.mapPictures) return 'failed';
      const environment = this.previewEnvironment();
      return queued(this.repoRoot, () =>
        (this.options.mapPictures ?? takeMapPictures)({
          repoRoot: this.repoRoot,
          environment,
          recipe: recipeFor(environment.recipe),
          component,
          devUrl: this.devUrl,
          browser: browser ?? '',
          take: takeScreenshot,
          check: this.options.context.askPreview
        })
      );
    }
    const [page = '', component = '', iteration = ''] = key.slice('iteration:'.length).split('/');
    if (!iterationExists(this.repoRoot, page, component, iteration)) return 'skipped';
    const open = (await listRuns(this.repoRoot)).some(
      run =>
        run.status === 'started' &&
        run.page === page &&
        run.component === component &&
        run.iteration === iteration
    );
    if (open) return 'skipped';
    const shots = await this.screenshots({ page, component, iteration });
    if (shots.skipped) return 'kept';
    return Object.keys(shots.files).length ? 'taken' : 'failed';
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
    // Snapshot mode: the repo's command renders the images, and the frame follows its state.
    if (environment.mode === 'snapshot') {
      const key = `${target.page}/${target.component}/${target.iteration}`;
      const run = await this.render([key], { force: options.force });
      const result = run.results[key]!;
      return {
        files: result.files,
        warning: describeResult(key, result),
        ...(run.unchanged.includes(key) ? { skipped: true as const } : {})
      };
    }
    syncIterations(this.repoRoot, environment);
    return queued(this.repoRoot, async () => {
      const shots = await this.context.screenshot(
        this.repoRoot,
        this.devUrl,
        target,
        this.context.env,
        undefined,
        undefined,
        undefined,
        environment,
        options
      );
      // Its pictures go up after its screenshots (decisions 21 and 23 of the brownfield plan).
      const pictures = await picturesAfterShots(
        this.context,
        {
          repoRoot: this.repoRoot,
          api: this.options.api,
          outbox: this.outbox,
          link: this.options.link,
          environment
        },
        target,
        previewUrl(this.devUrl, target.page, target.component, target.iteration, environment),
        shots
      ).catch(() => null);
      return pictures ? { ...shots, pictures } : shots;
    });
  }

  /**
   * Renders keys' images with the repo's snapshot command, through the repo's queue, keeping each
   * key's state for the frame: rendering while the command runs, then ready or failed with why.
   * Only the keys whose files changed are rendered unless `force`. In a live repo these are final
   * review's images, beside the page.
   */
  async render(keys: string[], options: { force?: boolean }): Promise<SnapshotRun> {
    // A key reaches the command line, so it is a key and nothing else.
    for (const key of keys) {
      const [page = '', component = '', iteration = '', ...rest] = key.split('/');
      if (rest.length) throw new BadRequest('Not an iteration.');
      this.assertIteration({ page, component, iteration });
    }
    const environment = this.environment;
    if (!environment.snapshot) {
      throw new BadRequest('rough/environment.md names no snapshot command.');
    }
    if (!isApproved(await readApprovals(this.repoRoot), environment.snapshot, environment.shell)) {
      throw new BadRequest(
        `The snapshot command is not approved on this machine (${environment.snapshot}). Run roughbook doctor in a terminal and approve it.`
      );
    }
    const since = new Date().toISOString();
    for (const key of keys) {
      const before = this.snapshotStates.get(key);
      this.snapshotStates.set(key, { status: 'rendering', message: null, at: before?.at ?? null });
    }
    try {
      const run = await queued(this.repoRoot, () =>
        renderSnapshots(this.repoRoot, environment, keys, {
          force: options.force,
          exec: this.options.snapshotExec
        })
      );
      for (const [key, result] of Object.entries(run.results)) {
        this.snapshotStates.set(key, {
          status: result.state === 'ready' ? 'ready' : 'failed',
          message: describeResult(key, result),
          at:
            run.asked.includes(key) && result.state === 'ready'
              ? since
              : (this.snapshotStates.get(key)?.at ?? null)
        });
      }
      // The frame fetches the images again: a change to them, though not to the iteration's files.
      for (const key of run.asked) this.changes.note(`${key}${IMAGES}`);
      return run;
    } catch (error) {
      for (const key of keys) {
        this.snapshotStates.set(key, { status: 'failed', message: describeError(error), at: null });
      }
      throw error;
    }
  }

  /** One key's snapshot images as the frame shows them: rendering, ready, failed or none yet. */
  snapshotState(target: ReviewTarget): SnapshotView {
    this.assertIteration(target);
    const key = `${target.page}/${target.component}/${target.iteration}`;
    const known = this.snapshotStates.get(key);
    if (known) return known;
    const environment = this.environment;
    const names = screenshotSet(environment.viewports, environment.variants).map(shot => shot.name);
    const there = names.every(size =>
      fs.existsSync(
        this.disk(screenshotPath(target.page, target.component, target.iteration, size))
      )
    );
    return { status: there ? 'ready' : 'none', message: null, at: null };
  }

  /** Opens one iteration on the simulator, emulator or device, with the environment's command. */
  async openDevice(target: ReviewTarget): Promise<{ ok: boolean; message: string }> {
    this.assertIteration(target);
    if (!iterationExists(this.repoRoot, target.page, target.component, target.iteration)) {
      throw new BadRequest(
        `${target.page}/${target.component}/${target.iteration} is not in this repo.`
      );
    }
    const key = `${target.page}/${target.component}/${target.iteration}`;
    return queued(this.repoRoot, () =>
      openOnDevice(this.repoRoot, this.environment, key, this.options.snapshotExec)
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
      syncIterations(this.repoRoot, this.environment);
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
    this.pictures.stop();
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
        try {
          const remain = body.intent?.remain;
          return {
            kind: 'fork',
            parent: body.parent,
            ...forkFields({
              change: typeof body.intent?.change === 'string' ? body.intent.change : null,
              remain: Array.isArray(remain)
                ? remain.filter((item): item is string => typeof item === 'string')
                : null,
              radical: body.radical === true
            })
          };
        } catch (error) {
          throw new BadRequest((error as Error).message);
        }
      case 'pull':
        if (!ITERATION.test(String(body.sketch)))
          throw new BadRequest('Name the web sketch to port.');
        return { kind: 'pull', sketch: body.sketch };
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
        throw new BadRequest(
          'A run makes new directions, a fork, a refinement, or the port of a web sketch.'
        );
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

  /** An iteration, or a page's composition by its folder's key, `<page>/compositions/<id>` (B6). */
  private assertPromoteTarget(target: { page: string; component: string; iteration: string }) {
    if (
      target.component === COMPOSITIONS_DIR &&
      SLUG.test(target.page) &&
      COMPOSITION_ID.test(target.iteration)
    ) {
      return;
    }
    this.assertIteration(target);
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
