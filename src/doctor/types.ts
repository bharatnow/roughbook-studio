// What `roughbook doctor` proves about a repo: the preview contract's checks, each with what it
// found and what to fix (ROUGHBOOK-FRAMEWORKS-PLAN.md, "roughbook doctor"). Its result is the same
// on the designer's machine, in a team's CI and over a recipe's fixture in Roughbook's own.
import type { Family, Gate, PreviewMode, Viewport } from '../environment/types.js';
import type { Served } from '../launch/processes.js';

export type CheckId =
  | 'environment'
  | 'app'
  | 'renders'
  | 'fixture'
  | 'reports-broken'
  | 'reports-missing'
  | 'screenshots'
  | 'fresh'
  | 'gate'
  | 'loopback'
  | 'setup-files'
  | 'speed';

/** `skip`: not checked, and the report says why (another phase's check, or `--skip-build`). */
export type CheckStatus = 'pass' | 'fail' | 'skip';

export type CheckResult = {
  id: CheckId;
  name: string;
  status: CheckStatus;
  /** What was found, in a sentence. */
  detail: string;
  /** What to do about a failure, or null. */
  fix: string | null;
};

/** `unverified`: every check passed or was skipped, but the gate was not proven. */
export type DoctorOutcome = 'pass' | 'fail' | 'unverified';

export type DoctorReport = {
  studio: string;
  environment: {
    contract: 1;
    recipe: string | null;
    stack: string[];
    family: Family;
    mode: PreviewMode;
    gate: Gate;
  };
  outcome: DoctorOutcome;
  checks: CheckResult[];
};

/** What the browser found at a preview, once it settled. */
export type Probe = {
  /**
   * The page shows the text it was asked about (`expect`) once settled: in what the browser
   * renders, not in the data the server sent along. An app whose layout shows its own view
   * instead of the route sends the iteration and shows nothing of it. True when nothing was asked.
   */
  shows: boolean;
  /** The page posted the ready message. */
  ready: boolean;
  /** The page posted the error message, with its text. */
  error: string | null;
  /** How many of the app's development overlays were showing. */
  visibleOverlays: number;
  /** Uncaught errors the page threw, in the browser's words: why hydration may not have happened. */
  exceptions: string[];
};

/** A process the runtime gate started, answering at its address until stopped. */
export type { Served };

/** Everything doctor does outside the repo's files, replaced in tests. */
export type DoctorTools = {
  fetch: typeof fetch;
  probe(input: {
    url: string;
    overlays: string[];
    timeoutMs: number;
    /** Text the page must show once settled. */
    expect?: string;
  }): Promise<Probe>;
  screenshot(input: {
    url: string;
    file: string;
    size: Viewport;
    overlays: string[];
  }): Promise<boolean>;
  /** Runs a command to its end in `cwd`; the exit code, or null when it timed out. */
  exec(command: string, cwd: string, timeoutMs: number): Promise<{ code: number | null }>;
  /** Starts a command in `cwd` and waits until `url` answers; null when it did not in time. */
  serve(command: string, cwd: string, url: string, timeoutMs: number): Promise<Served | null>;
  /** This machine's addresses on the network, IPv4, not loopback. */
  addresses(): string[];
  /** Waiting and the clock, so a test need not wait for real. */
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Which browser takes the screenshots and probes; null when none was found. */
  browser: string | null;
};

export type DoctorOptions = {
  /** The app's dev server. */
  devUrl: string;
  /** Leave the production build out, and record the repo as unverified. */
  skipBuild?: boolean;
  tools?: Partial<DoctorTools>;
};
