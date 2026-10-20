// A repo's environment: what the studio needs to know about the app it works in, as the header
// of rough/environment.md says it (ROUGHBOOK-FRAMEWORKS-PLAN.md). The core reads only this; what
// is specific to one stack lives in a recipe, or in the file's prose, which only agents read.

/** Which family of checks applies to an iteration's files (decision 23 of the frameworks plan). */
export type Family = 'markup-css' | 'react-like' | 'flutter' | 'swiftui' | 'compose' | 'unknown';

export const FAMILIES: readonly Family[] = [
  'markup-css',
  'react-like',
  'flutter',
  'swiftui',
  'compose',
  'unknown'
];

/** How an iteration is shown: on the app's own dev server, as rendered images, or by the studio. */
export type PreviewMode = 'live' | 'snapshot' | 'standalone';

export const PREVIEW_MODES: readonly PreviewMode[] = ['live', 'snapshot', 'standalone'];

/**
 * How the preview is kept out of production (decision 11): nothing from it in the production
 * build's output, the preview URL answering 404 with the app in production mode, or both.
 */
export type Gate = 'build' | 'runtime' | 'both';

export const GATES: readonly Gate[] = ['build', 'runtime', 'both'];

/** One size the frame shows and the screenshots are taken at. The name names the file. */
export type Viewport = { name: string; width: number; height: number; mobile: boolean };

export type RepoEnvironment = {
  /** The version of the contract the header was written for. */
  contract: 1;
  /** The recipe that set the repo up, or null when the designer's agent did without one. */
  recipe: string | null;
  /** Short tokens, such as `next-16`: the only thing about the stack the server ever sees. */
  stack: string[];
  family: Family;
  mode: PreviewMode;
  /** The file every iteration must have, as a file name. */
  entry: string;
  /** The extensions of the files the checks read inside an iteration, with their dots. */
  sources: string[];
  /** The extensions of the files whose imports are read, with their dots. */
  code: string[];
  /** Where the app answers for previews when nothing names it. */
  start: { url: string };
  /** The path of one iteration's preview, with `{key}` where `<page>/<component>/<iteration>` goes. */
  preview: string;
  viewports: Viewport[];
  /** Folders a repo snapshot and the watcher skip, repo-relative; what no repo commits. */
  ignore: string[];
  /** Selectors of the app's own development overlays, hidden in screenshots. */
  overlays: string[];
  /**
   * The file an iteration may hold for its preview fixture, which the preview passes in
   * (decision 26), or null when the stack's preview takes none.
   */
  fixture: string | null;
  /** The production build: its command (null when the stack has none) and where its output goes. */
  build: { command: string | null; output: string[] };
  gate: Gate;
  /**
   * How to run the app in production mode for the runtime gate: the command, and the address it
   * answers on. Null when the gate is the build alone.
   */
  production: { command: string; url: string } | null;
  /** How long each may take, in seconds (decision 36). */
  timeouts: { start: number; preview: number; build: number };
};
