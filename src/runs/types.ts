// A local run as the backend hands it over, and as the studio keeps it.

/** What an iteration's output must pass, as the backend sends it (its utils/compile/checks.ts). */
export type Check =
  | { kind: 'entry-file'; file: string }
  | { kind: 'approved-headline'; version: number; headline: string }
  | { kind: 'changed-from-parent'; parent: string };

export type RunKind = 'generate' | 'fork' | 'refine';
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

/** What `POST /runs` asks for: new directions, a fork, or a refinement. */
export type StartRunRequest = {
  page: string;
  component: string;
  agent: RunAgent;
  mode: RunMode;
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

/** One run as the backend answers `POST /runs`. */
export type StartedRun = {
  runId: string;
  iteration: string;
  parent: string | null;
  targetFolder: string;
  /** With a stand-in where the studio's own address belongs (placeholders.assetOrigin). */
  prompt: string;
  placeholders?: { assetOrigin: string };
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
};
