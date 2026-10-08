// What the local UI asks for, done with the same parts as the CLI: runs, Done, revert, review
// decisions through the outbox, promote, and the agents' sessions. The HTTP layer (app.ts) only
// checks who is asking and turns these into JSON.
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS } from '../agents/index.js';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { AgentEvent, Detection, TerminalAdapter } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import type { AssetScope } from '../api/types.js';
import { describeError } from '../api/errors.js';
import { outboxFor, type Outbox } from '../api/outbox.js';
import { finishWithScreenshots } from '../commands/done.js';
import type { CommandContext } from '../commands/context.js';
import { promoteSession } from '../commands/promote.js';
import { chooseAgent, sendHeartbeat } from '../commands/shared.js';
import { localOrigin, readSettings, saveSettings } from '../config/settings.js';
import { currentOs } from '../launch/platform.js';
import type { PtySupport } from '../launch/pty.js';
import { manualCommand, planTerminal, type Session } from '../launch/terminal.js';
import type { RepoLink } from '../repo/link.js';
import { ITERATION, SLUG, listIterations, writePreviewRegistry } from '../repo/preview.js';
import { startRuns } from '../runs/lifecycle.js';
import { findComponent, preparePromotion } from '../runs/promote.js';
import { pullAdvice, pullSketch } from '../runs/pull.js';
import { sendDecision, type Decision, type ReviewTarget } from '../runs/reviews.js';
import { assertTarget } from '../runs/slots.js';
import { revertFile } from '../runs/snapshot.js';
import { listRuns, readRun } from '../runs/store.js';
import type { RunAgent, RunRecord, StartRunRequest } from '../runs/types.js';
import { SIZES } from '../screenshot/browser.js';
import { screenshotPath } from '../screenshot/iteration.js';
import { EVENT_CATALOG } from '../telemetry/catalog.js';
import { errorCode, flushEvents, recordEvent } from '../telemetry/events.js';
import { STUDIO_VERSION } from '../version.js';
import { Terminals, type TerminalInfo } from './terminals.js';

export type LocalStudioOptions = {
  context: CommandContext & { repoRoot: string };
  api: StudioApi;
  link: RepoLink;
  devUrl: string;
  port: number;
  pty: PtySupport;
};

/** An agent as the local UI lists it: no paths. */
export type AgentView = Pick<
  Detection,
  'id' | 'name' | 'found' | 'version' | 'signedIn' | 'signIn' | 'headless' | 'capabilities'
>;

/** How a run's sessions were started. */
export type Launched =
  | { kind: 'builtin'; terminals: TerminalInfo[] }
  | { kind: 'external'; terminal: string }
  | { kind: 'manual'; reason: string; commands: string[] }
  | { kind: 'headless' };

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
  mode: 'interactive' | 'headless';
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
  private readonly jobs = new Map<string, HeadlessJob>();
  private detections: { at: number; list: Promise<Detection[]> } | null = null;
  private readonly assets = new Map<string, { bytes: Buffer; at: number }>();

  constructor(private readonly options: LocalStudioOptions) {
    this.terminals = options.pty.ok ? new Terminals(options.pty.pty) : null;
    this.outbox = outboxFor(options.context.repoRoot);
  }

  get repoRoot(): string {
    return this.options.context.repoRoot;
  }

  /** Every agent, found or not; asked again after a minute, or when `fresh`. */
  agents(fresh = false): Promise<Detection[]> {
    if (fresh || !this.detections || Date.now() - this.detections.at > DETECTION_FRESH_MS) {
      const list = Promise.all(ADAPTERS.map(adapter => this.options.context.detect(adapter)));
      this.detections = { at: Date.now(), list };
      list.catch(() => (this.detections = null));
    }
    return this.detections.list;
  }

  private async detection(adapter: TerminalAdapter): Promise<Detection> {
    const found = (await this.agents()).find(item => item.id === adapter.id);
    return found ?? this.options.context.detect(adapter);
  }

  /** The command context, with agents found once rather than on every request. */
  private get context(): CommandContext & { repoRoot: string } {
    return { ...this.options.context, detect: adapter => this.detection(adapter) };
  }

  async state() {
    const { link, devUrl, port, pty, api } = this.options;
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
        found: item.found,
        version: item.version,
        signedIn: item.signedIn,
        signIn: item.signIn,
        headless: item.headless,
        capabilities: item.capabilities
      })),
      defaultAgent: settings.defaultAgent,
      outbox: { pending: pending.length, dropped }
    };
  }

  async setDefaultAgent(agent: unknown): Promise<void> {
    if (agent !== null && !ADAPTERS.some(item => item.id === agent)) {
      throw new BadRequest('Choose one of the agents this studio supports.');
    }
    await saveSettings(this.options.context.configDir, {
      defaultAgent: agent as RunAgent | null
    });
  }

  /** The project from the backend, and which of its iterations are in this repo. */
  async project() {
    const { api, link } = this.options;
    const tree = await api.project(link.orgId, link.project);
    const iterations = listIterations(this.repoRoot);
    const screenshots: Record<string, string[]> = {};
    for (const key of iterations) {
      const [page, component, iteration] = key.split('/') as [string, string, string];
      const sizes = (Object.keys(SIZES) as (keyof typeof SIZES)[]).filter(size =>
        fs.existsSync(this.disk(screenshotPath(page, component, iteration, size)))
      );
      if (sizes.length) screenshots[key] = sizes;
    }
    return { tree, local: { iterations, screenshots } };
  }

  async runs(): Promise<RunView[]> {
    const terminals = this.terminals?.list() ?? [];
    return (await listRuns(this.repoRoot)).map(run => {
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
    const executable = detection.executable!;
    if (body.mode === 'headless' && !detection.headless.ready) {
      throw new BadRequest(detection.headless.reason);
    }
    // Decisions waiting in the outbox reach the server first, so this prompt remembers them.
    await this.outbox.flush(api);
    const request = {
      page: body.page,
      component: body.component,
      agent: adapter.id,
      mode: body.mode,
      ...kind
    } as StartRunRequest;
    // Iterations load the project's asset files from this server.
    const runs = await startRuns(this.repoRoot, api, link, request, {
      assetOrigin: localOrigin({ localPort: this.options.port })
    });
    const model = typeof body.model === 'string' && body.model ? body.model : null;

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
          devUrl: this.options.devUrl,
          screenshots: true
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

  async done(runId: string, outcome: unknown) {
    if (outcome !== undefined && outcome !== 'failed' && outcome !== 'cancelled') {
      throw new BadRequest('A run is marked failed or cancelled, or finished as it is.');
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
      { outcome, devUrl: this.options.devUrl, screenshots: true }
    );
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
    return { file: name, result: await revertFile(this.repoRoot, run.runId, name) };
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
    return api.ratings(link.orgId, link.project, page, component);
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
    if (!(size in SIZES)) return null;
    const file = this.disk(
      screenshotPath(target.page, target.component, target.iteration, size as keyof typeof SIZES)
    );
    return fs.existsSync(file) ? file : null;
  }

  /** Sends what waits in the outbox; quiet when the server cannot be reached. */
  async flushOutbox(): Promise<void> {
    try {
      await this.outbox.flush(this.options.api);
    } catch {
      // Tried again on the next tick.
    }
  }

  /** Keeps rough/preview-registry.ts in step with the iteration folders. */
  keepRegistry(): void {
    try {
      writePreviewRegistry(this.repoRoot);
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
      const found = (await this.agents()).filter(item => item.found);
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
    this.terminals?.stopAll();
  }

  private runKind(body: RunBody): Pick<StartRunRequest, 'kind'> & Record<string, unknown> {
    if (!SLUG.test(String(body.page)) || !SLUG.test(String(body.component))) {
      throw new BadRequest('Name the page and component.');
    }
    if (body.mode !== 'interactive' && body.mode !== 'headless') {
      throw new BadRequest('A run is interactive or headless.');
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
