// An adapter is everything vendor-specific about one coding agent: where it is, whether it is
// signed in, how a terminal session and a headless run are started and confined, and how its
// output reads. The rest of the studio sees only this. Grown from roughbook runner/agents
// (v2-local), which ran Claude Code and Codex headless only.
import type { Executable, Lookup } from '../launch/which.js';
import type { RunAgent } from '../runs/types.js';

export type AgentKind = 'terminal' | 'editor';

export type Capabilities = {
  interactive: boolean;
  headless: boolean;
  /** Can be confined to the run's folder by its own permissions, beyond the studio's snapshot. */
  permissions: boolean;
  /** Reports token counts in its machine-readable output. */
  usage: boolean;
};

/** What the studio found for one agent on this machine. */
export type Detection = {
  id: RunAgent;
  name: string;
  kind: AgentKind;
  found: boolean;
  executable: Executable | null;
  version: string | null;
  /** How it is signed in, in the agent's own words, when it says. */
  signIn: string | null;
  /**
   * Whether it may run unattended here: only on the designer's own API key, never on a
   * subscription login, until each vendor says otherwise (the split plan's rule).
   */
  headless: { ready: true } | { ready: false; reason: string };
  capabilities: Capabilities;
};

/** One run as an adapter needs it: repo-relative paths, the instruction, and the model if chosen. */
export type RunTarget = {
  repoRoot: string;
  /** rough/<page>/<component>/iteration-NN */
  targetFolder: string;
  promptFile: string;
  /** "Follow the instructions in <prompt file>" */
  instruction: string;
  /** A session id for agents that take one, so the run can be resumed. */
  sessionId: string;
  model: string | null;
  title: string;
};

/** A headless run: no shell, every argument separate, the environment it adds. */
export type HeadlessInvocation = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string | null;
  env: Record<string, string>;
};

export type AgentEvent =
  | { kind: 'session'; id: string }
  | { kind: 'message'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'file'; name: string }
  | { kind: 'result'; ok: boolean; text: string | null };

export type UsageReport = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export type ParsedLine = { event?: AgentEvent; usage?: UsageReport };

export type TerminalAdapter = {
  id: RunAgent;
  name: string;
  kind: 'terminal';
  capabilities: Capabilities;
  notFound: string;
  find(lookup: Lookup): Executable | null;
  /** Version and sign-in, by running the agent briefly. */
  detect(lookup: Lookup): Promise<Detection>;
  /** Arguments for a session in a terminal, after the executable's own prefix. */
  interactiveArgs(run: RunTarget): string[];
  /** The unattended run, or why it cannot be one. */
  headless(
    run: RunTarget,
    executable: Executable,
    env: NodeJS.ProcessEnv
  ): HeadlessInvocation | { refused: string };
  /** One line of the headless output. Never throws. */
  parseLine(line: string): ParsedLine;
};
