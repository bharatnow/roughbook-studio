// A local run as the backend hands it over, and as the studio keeps it.
import type { Family } from '../environment/types.js';

/** What an iteration's output must pass, as the backend sends it (its utils/compile/checks.ts). */
import type { ImageryStance, LookScreen, MediaStance } from './lookScreen.js';
import type { NativeFamily } from './nativeFloor.js';

export type Check =
  | { kind: 'entry-file'; file: string }
  /** `native`: the source's string literals escape quotes with a backslash (a native family). */
  | { kind: 'approved-headline'; version: number; headline: string; native?: true }
  | { kind: 'changed-from-parent'; parent: string }
  /** The craft floor: placeholder copy, transition: all, img alt, icon button names, focus. Warnings. */
  | { kind: 'craft-floor' }
  /** The model tells to look for, and the fonts the Design System chose (detector.ts). */
  | { kind: 'detector'; tells: string[]; fonts: string[] }
  /** The native floor, for the native toolkits' families: placeholder copy, unnamed icon buttons. Warnings. */
  | { kind: 'native-floor'; family: NativeFamily }
  /**
   * A first-screen run's look-screen check (lookScreen.ts, E8 of the engine plan): a labelled
   * field in a form that submits, a header, no dead control, the assigned structure, and only the
   * content sheet's things and pictures. Every finding fails the check until the agent fixes it.
   */
  | { kind: 'look-screen'; screen: LookScreen }
  /**
   * A section's or a page's run uses no medium its resolved stances avoid (ROUGHBOOK-MEDIA-PLAN.md,
   * V5), by the look-screen check's media scan and words (lookScreen.ts mediaAvoidFindings): an
   * avoided medium the scan is sure of fails the check until the agent fixes it; Product UI, a
   * less certain reading, and Illustration under the type picture style are warnings.
   */
  | { kind: 'media-avoided'; media: MediaStance[]; pictureStyle: ImageryStance | null }
  /**
   * The house rules (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T1; the backend's houseChecks.ts, copied into
   * src/rules/vendor/): a floor a scan can see (a reduced-motion path, an opaque version of a
   * translucent surface) fails the check until the agent fixes it and is never lifted; a default
   * it can see is a warning. `lifted`: the default ids the designer's own words lifted, whose
   * findings from every check are dropped.
   */
  | { kind: 'house'; lifted: string[] };

/** `pull`: a web sketch ported into the repo's stack by the agent (F7 of the frameworks plan). */
export type RunKind = 'generate' | 'fork' | 'refine' | 'pull';
export type RunAgent =
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'antigravity-cli'
  | 'cursor-cli'
  | 'cursor'
  | 'vscode'
  | 'antigravity'
  | 'windsurf'
  | 'other';
export type RunMode = 'interactive' | 'headless' | 'editor';
export type RunOutcome = 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled';
export type FinishedBy = 'agent' | 'done' | 'local-ui' | 'headless';

/** What `POST /runs` asks for: new directions, a fork, a refinement, or a sketch's port. */
export type StartRunRequest = {
  page: string;
  component: string;
  agent: RunAgent;
  mode: RunMode;
  /** Skills installed where the run happens, from rough/roughbook.json. */
  skills?: string[];
  /** This studio can take the iteration's screenshots, so its prompt says when to look. */
  screenshots?: boolean;
  /** The repo's family of checks and its entry file, from its environment (decision 23). */
  family?: Family;
  entry?: string;
  /**
   * The studio copies the project's asset files into the iteration's assets/ folder, so the prompt
   * points there instead of at the studio's address (decision 29). Sent only when true.
   */
  assetsCopy?: boolean;
  /** The repo's stack tokens, kept on the iteration so ratings compare by stack (F7). */
  stack?: string[];
} & (
  | {
      kind: 'generate';
      directions: { direction: string; hypothesis?: string }[];
      /** The designer's words for this batch, kept with each iteration and in its prompt (I3). */
      instructions?: string;
    }
  | {
      kind: 'fork';
      parent: string;
      /** What the fork changes, and what it keeps as the parent has it (B3). */
      intent?: ForkIntent;
      /** A clean start: an empty folder, with what the parent was and what reviews said. */
      radical?: boolean;
      instructions?: string;
    }
  /** The sketch's files are a read-only reference beside the component; the agent rebuilds it. */
  | { kind: 'pull'; sketch: string }
  | {
      kind: 'refine';
      parent: string;
      preset: string;
      intent: string;
      observationIds?: string[];
      preserve?: string;
      instructions?: string;
    }
);

/** What a fork is asked to change, and what it keeps as the parent has it. */
export type ForkIntent = { remain: string[]; change: string };

/** One run as the backend answers `POST /runs`. */
export type StartedRun = {
  runId: string;
  iteration: string;
  parent: string | null;
  targetFolder: string;
  /**
   * With stand-ins where the studio's own address belongs (placeholders.assetOrigin) and where
   * the prompt names the entry file (placeholders.entry) and what its family asks of it
   * (placeholders.entryNote), or what its rules ask of the stack's craft (placeholders.craft and
   * placeholders.primitives), which the repo's environment decides.
   */
  prompt: string;
  placeholders?: {
    assetOrigin: string;
    entry?: string;
    entryNote?: string;
    termPage?: string;
    termComponent?: string;
    environment?: string;
    preview?: string;
    craft?: string;
    primitives?: string;
    /** For a fork or refine of the app's own component: its files, and its kept base (B3). */
    appFiles?: string;
    base?: string;
  };
  checks: Check[];
};

/** A warning or failure, with the code the backend records and the sentence the designer reads. */
export type Finding = { code: string; message: string };

/** `rough/.roughbook/runs/<run>.json`: everything the studio knows about one run. */
export type RunRecord = {
  runId: string;
  orgId: string;
  project: string;
  page: string;
  component: string;
  iteration: string;
  parent: string | null;
  kind: RunKind;
  agent: RunAgent;
  mode: RunMode;
  /** Repo-relative, forward slashes. */
  targetFolder: string;
  promptFile: string;
  checks: Check[];
  startedAt: string;
  status: 'started' | 'finished';
  finishedAt: string | null;
  outcome: RunOutcome | null;
  failure: Finding | null;
  warnings: Finding[];
  /** Files changed outside the run's folder, repo-relative. */
  outOfScope: string[];
  /** Files changed outside it that the designer said were their own work, so not counted. */
  mine?: string[];
  /** Files of `outOfScope` put back since, with roughbook revert or the local UI's Put it back. */
  putBack?: string[];
  /** Who finished it: the agent through MCP, roughbook done, the local UI, or the agent exiting. */
  finishedBy?: FinishedBy;
  /** Whether the result reached the backend, or waits in the outbox. */
  reported: 'sent' | 'queued' | null;
  /**
   * For a fork or refine of the app's own component: the app's other files the agent copied in to
   * change them, by repository path, kept in the iteration's .base/ for B4 (decision 32).
   */
  children?: string[];
};
