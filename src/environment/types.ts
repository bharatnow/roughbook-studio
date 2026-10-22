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

/**
 * The shell a command line runs in (decision 30). `none` means the studio splits the line into
 * arguments itself and starts the program by name, as it did before shells were declared; the
 * others are started by name with the line as their one command argument. Never the machine's
 * default shell, whatever it is.
 */
export type Shell = 'none' | 'sh' | 'bash' | 'zsh' | 'powershell' | 'pwsh' | 'cmd';

export const SHELLS: readonly Shell[] = ['none', 'sh', 'bash', 'zsh', 'powershell', 'pwsh', 'cmd'];

/** The operating systems commands are declared for: the default, and Windows where it differs. */
export type EnvironmentOs = 'windows' | 'macos' | 'linux' | 'other';

/** One size the frame shows and the screenshots are taken at. The name names the file. */
export type Viewport = { name: string; width: number; height: number; mobile: boolean };

/** Where the app runs: as a process on this machine, or in a container that answers at `url`. */
export type Runtime = { kind: 'local' } | { kind: 'container'; url: string };

/**
 * Where iterations live: in rough/ alone, or mirrored in the source tree at `path` for a stack
 * that compiles nothing outside it (decision 25). rough/ stays the record either way.
 */
export type Placement = { kind: 'rough' } | { kind: 'in-tree'; path: string };

/** Where approved copy lands: in the iteration's source, or in a localized file (decision 34). */
export type CopyPlacement = { kind: 'inline' } | { kind: 'localized'; file: string };

/** The stack's own words for Roughbook's page and component, for prompts and the UI. */
export type Terms = { page: string; component: string };

/**
 * A file the preview setup adds or changes outside rough/, with its template in rough/setup/
 * (decision 28). A whole file is copied into place; a snippet is appended to a file the app
 * already has, and removed from it again.
 */
export type SetupFile = { path: string; kind: 'file' | 'snippet' };

export type RepoEnvironment = {
  /** The version of the contract the header was written for. */
  contract: 1;
  /** The recipe that set the repo up, or null when the designer's agent did without one. */
  recipe: string | null;
  /** The recipe's version the setup was written from, so `setup --upgrade` can tell it is behind. */
  recipeVersion: number | null;
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
  placement: Placement;
  /** The file that wraps every iteration in the app's providers, repo-relative, or null. */
  wrapper: string | null;
  runtime: Runtime;
  /** The shell every command below runs in, already chosen for this operating system. */
  shell: Shell;
  /** The command that starts the app for previews (null when the designer starts it), and where it answers. */
  start: { command: string | null; url: string };
  /** The path of one iteration's preview, with `{key}` where `<page>/<component>/<iteration>` goes. */
  preview: string;
  /**
   * The command that renders keys to images (rough/CONTRACT.md, the snapshot contract): the preview
   * itself in snapshot mode, and the images for final review where a live preview goes through a
   * stack's web target. Null when the repo has none.
   */
  snapshot: string | null;
  /**
   * The command that opens one iteration on a simulator, an emulator or a device, with `{key}`
   * where the key goes, for interaction the images cannot give. Null when the repo has none.
   */
  device: string | null;
  viewports: Viewport[];
  /** Colour schemes, locales and text sizes the frame and screenshots cover (decision 33); words only here. */
  variants: string[];
  /**
   * Who shows a change to an iteration's files in the frame: the app itself, through its own hot
   * reload, or the studio, by reloading the frame when the files change (the contract, point 4).
   */
  reload: 'app' | 'studio';
  /**
   * Standalone mode: the site's stylesheets as its pages link them, each a path on the site
   * (served from the public folder) or a full address, loaded before the iteration.
   */
  stylesheets: string[];
  /**
   * Standalone mode: the folder served at the site's root, repo-relative (`.` for the repo
   * itself), so the stylesheets and an iteration's links to the site's files resolve as on the
   * site; null when there is none.
   */
  public: string | null;
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
  /** The commands an agent runs on its iteration: a type check, a linter, tests. */
  checks: string[];
  /** How long each may take, in seconds (decision 36). */
  timeouts: { start: number; preview: number; build: number };
  /**
   * Where promoted components go (null: the project's delivery default), and the extensions a
   * promoted component's file may have (decision 31).
   */
  promote: { dir: string | null; extensions: string[] };
  /**
   * Where promoted assets go (null: the project's delivery default), and whether previews need an
   * iteration's assets copied into its folder (decision 29).
   */
  assets: { dir: string | null; copy: boolean };
  copy: CopyPlacement;
  terms: Terms;
  /** The component workshop previews go through, if any. */
  workshop: string | null;
  setupFiles: SetupFile[];
  /** Development dependencies the setup added, with the designer's approval (decision 19). */
  devDependencies: string[];
};
