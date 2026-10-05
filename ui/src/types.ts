// What the local server answers (src/server/studio.ts). The project tree is the backend's, so it
// carries more than is listed here; only what the UI reads is named.

export type AgentView = {
  id: string;
  name: string;
  found: boolean;
  version: string | null;
  signedIn: boolean | null;
  signIn: string | null;
  headless: { ready: true } | { ready: false; reason: string };
};

export type StudioState = {
  version: string;
  project: { orgId: string; slug: string };
  devUrl: string;
  port: number;
  webUrl: string | null;
  terminal: { builtin: true } | { builtin: false; reason: string };
  agents: AgentView[];
  defaultAgent: string | null;
  outbox: { pending: number; dropped: { path: string; code: string; droppedAt: string }[] };
};

export type Feedback = {
  likes: string[];
  dislikes: string[];
  selectionReason: string;
  rejectionReason: string;
  designerNotes: string;
};

export type Iteration = {
  id: string;
  number: number;
  name: string;
  status: string;
  parent: string | null;
  direction: string;
  hypothesis: string;
  tags: string[];
  methods: string[];
  metaMissing: boolean;
  generation: { mode: string };
  refinement: { preset: string } | null;
  feedback: Feedback;
};

export type CopyVersion = {
  number: number;
  approved: boolean;
  headline: string;
  supporting: string[];
  primaryAction: string;
};

export type Component = {
  slug: string;
  name: string;
  status: string;
  brief: string;
  userQuestion: string;
  messages: { primary: string; supporting: string[] };
  selectedIteration: number | null;
  iterations: Iteration[];
  copy: { versions: CopyVersion[]; approved: number | null };
  promotions: { iteration: string; file?: string | null; at: string }[];
};

export type Page = { slug: string; name: string; components: Component[] };

export type ProjectView = {
  tree: {
    slug: string;
    name: string;
    delivery: { componentsDir: string; publicDir: string };
    pages: Page[];
  };
  local: { iterations: string[]; screenshots: Record<string, string[]> };
};

export type Finding = { code: string; message: string };

export type TerminalInfo = {
  id: string;
  runId: string | null;
  title: string;
  status: 'running' | 'exited';
  exitCode: number | null;
  stopped: boolean;
  startedAt: string;
};

/** How a session ended, in words: Windows reports a stopped program with a large code. */
export function endedLabel(session: Pick<TerminalInfo, 'status' | 'exitCode' | 'stopped'>): string {
  if (session.status === 'running') return 'running';
  if (session.stopped) return 'stopped';
  return session.exitCode === 0 ? 'finished' : `exited with ${session.exitCode ?? '?'}`;
}

export type RunView = {
  runId: string;
  page: string;
  component: string;
  iteration: string;
  parent: string | null;
  kind: 'generate' | 'fork' | 'refine';
  agent: string;
  mode: string;
  promptFile: string;
  startedAt: string;
  status: 'started' | 'finished';
  finishedAt: string | null;
  outcome: 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | null;
  failure: Finding | null;
  warnings: Finding[];
  outOfScope: string[];
  reported: 'sent' | 'queued' | null;
  terminal: TerminalInfo | null;
  headless: { status: 'running' | 'finished'; lines: string[]; error: string | null } | null;
};

export type Launched =
  | { kind: 'builtin'; terminals: TerminalInfo[] }
  | { kind: 'external'; terminal: string }
  | { kind: 'manual'; reason: string; commands: string[] }
  | { kind: 'headless' };
