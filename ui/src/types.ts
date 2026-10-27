// What the local server answers (src/server/studio.ts). The project tree is the backend's, so it
// carries more than is listed here; only what the UI reads is named.

export type AgentView = {
  id: string;
  name: string;
  /** A terminal agent runs in a terminal or unattended; an editor's agent is the designer's. */
  kind: 'terminal' | 'editor';
  found: boolean;
  version: string | null;
  signedIn: boolean | null;
  signIn: string | null;
  headless: { ready: true } | { ready: false; reason: string };
};

/** One variant the frame and the screenshots cover, as the server resolved its word. */
export type VariantView = {
  id: string;
  label: string;
  scheme: 'light' | 'dark' | null;
  dir: 'ltr' | 'rtl' | null;
  lang: string | null;
  text: 'large' | null;
};

/** The repo's environment as the frame needs it: read again by the server whenever the file changes. */
export type EnvironmentView = {
  mode: 'live' | 'snapshot' | 'standalone';
  /** The preview's path template, with `{key}` where `<page>/<component>/<iteration>` goes. */
  preview: string;
  viewports: { name: string; width: number; height: number; mobile: boolean }[];
  variants: VariantView[];
  /** The stack's own words for page and component. */
  terms: { page: string; component: string };
  /** Who shows a change: the app's own hot reload, or the studio reloading the frame. */
  reload: 'app' | 'studio';
  start: { command: string | null; url: string; approved: boolean };
  timeouts: { preview: number };
  /** The repo's snapshot command, when it has one, and whether it is approved here. */
  snapshot?: { approved: boolean } | null;
  /** The repo's device command, when it has one, and whether it is approved here. */
  device?: { approved: boolean } | null;
};

/** One iteration's snapshot images as the server last knew them. */
export type SnapshotView = {
  status: 'none' | 'rendering' | 'ready' | 'failed';
  message: string | null;
  at: string | null;
};

/** What the app the previews come from is doing, as the server last saw it. */
export type AppView = {
  status: 'unknown' | 'starting' | 'up' | 'down';
  /** The terminal session the studio started it in, when it did. */
  terminal: string | null;
  since: string | null;
  /** The last line the app printed while starting. */
  lastLine: string | null;
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
  environment: EnvironmentView;
  /** Why rough/environment.md cannot be read now, or null. */
  environmentProblem: string | null;
  app: AppView;
  /** What a card's <img> puts in a screenshot's address, since it cannot send the token. */
  shotKey?: string;
};

/** What changed in rough/ since the page last asked, numbered by the server. */
export type Changes = { seq: number; keys: string[] };

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
  /** When it was made, where the backend says. */
  created?: string | null;
  /**
   * Where it was made: a web sketch, a studio (this repo's or another designer's), or the app
   * itself (`app`: an adopted component's baseline, iteration 0).
   */
  origin?: 'sketch' | 'local' | 'app';
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
  /** Adopted from the app's own code (B2 of the brownfield plan). */
  inApp?: boolean;
};

export type Page = { slug: string; name: string; components: Component[]; inApp?: boolean };

/** What is known of a page's sign-in or a component's rendering alone. */
export type Known = 'yes' | 'no' | 'unknown';

/**
 * rough/map.md as the canvas shows it: the app's pages and components, with doctor's pictures by
 * viewport name, before and after they are adopted.
 */
export type MapView = {
  pages: {
    slug: string;
    name: string;
    address: string | null;
    signIn: Known;
    sections: string[];
    shots: string[];
  }[];
  components: {
    slug: string;
    name: string;
    kind: 'section' | 'shared' | 'atom';
    alone: Known;
    why: string | null;
    shots: string[];
    /** When its pictures were last taken: a card asks for them again after. */
    shotsAt?: string | null;
  }[];
  problem: string | null;
};

/** A page's composition kept in rough/ (B6 of the brownfield plan), as the server lists it. */
export type CompositionView = {
  page: string;
  /** `composition-NN`, as the backend numbered it. */
  id: string;
  number: number;
  /** As the designer named it; empty for none. */
  name: string;
  parent: string | null;
  sections: { component: string; iteration: string }[];
  savedAt: string | null;
  /** The composed preview's path on the app, where the recipe composes; null otherwise. */
  address: string | null;
  /** The pictures taken of it here. */
  pictures: ('thumbnail' | 'desktop' | 'phone')[];
};

export type ProjectView = {
  tree: {
    slug: string;
    name: string;
    delivery: { componentsDir: string; publicDir: string };
    pages: Page[];
  };
  local: {
    iterations: string[];
    /** Each iteration's screenshots by name: the viewport, with the variant after the first. */
    screenshots: Record<string, string[]>;
    /** When each iteration's screenshots were last taken, where the studio recorded it. */
    screenshotsAt?: Record<string, string>;
    /** The app's map, when the repo has one. */
    map?: MapView | null;
    /**
     * Where the frame shows an iteration in its page, by `<page>/<component>/<iteration>`, and an
     * adopted page's own view with its markers, by page slug: addresses on the app (B5). Null
     * where the recipe has no in-page view or it is not set up.
     */
    inPage?: Record<string, string> | null;
    /** What the in-page view covers on this stack, shown beside In its page (decision 44). */
    inPageNote?: string | null;
    /** The pages' compositions in rough/ (B6). */
    compositions?: CompositionView[];
    /**
     * Where a page's composition is previewed, `{page}` for its slug, the sections after it as
     * `<component>:<iteration>,…`; null where the recipe does not compose (decision 54).
     */
    composeTemplate?: string | null;
  };
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
  mine?: string[];
  /** Files of outOfScope put back since, from here or with roughbook revert. */
  putBack?: string[];
  finishedBy?: 'agent' | 'done' | 'local-ui' | 'headless';
  reported: 'sent' | 'queued' | null;
  terminal: TerminalInfo | null;
  headless: { status: 'running' | 'finished'; lines: string[]; error: string | null } | null;
};

export type Launched =
  | { kind: 'builtin'; terminals: TerminalInfo[] }
  | { kind: 'external'; terminal: string }
  | { kind: 'manual'; reason: string; commands: string[] }
  | { kind: 'headless' }
  | {
      kind: 'editor';
      editor: string;
      opened: 'editor' | 'default-app' | null;
      copied: boolean;
      instructions: string[];
      mcp: { ready: boolean; install: string } | null;
    };
