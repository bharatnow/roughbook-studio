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
};
