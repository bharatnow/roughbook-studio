// A recipe is everything Roughbook knows about one stack: the environment a repo on it has, the
// preview setup `init` writes, the paragraph agents read, and the few steps that depend on the
// stack (the placeholder a new slot shows, what a pulled sketch needs, where a promoted component
// goes). The rest of the studio sees only this and the environment (ROUGHBOOK-FRAMEWORKS-PLAN.md,
// decision 12). Modelled on the coding agents' adapters in src/agents.
import type { EnvironmentOs, RepoEnvironment, Shell } from '../environment/types.js';
import type { RepoLink } from '../repo/link.js';
import type { PrepChange } from '../repo/plan.js';
import type { CraftWords } from './craft.js';

/**
 * A command a scaffold runs, as one line in the shell it declares (decision 30), with its Windows
 * variant where it differs: in the folder the app is made in, or in the app once it exists.
 */
export type ScaffoldCommand = {
  kind: 'run';
  /** What it does, in a few words, shown before it runs. */
  summary: string;
  line: string;
  windows?: string;
  shell: Shell;
  shellWindows?: Shell;
  in: 'parent' | 'app';
};

/** Files a scaffold writes into the new app, by their paths in it. */
export type ScaffoldFiles = { kind: 'write'; summary: string; files: Record<string, string> };

export type ScaffoldStep = ScaffoldCommand | ScaffoldFiles;

/**
 * `roughbook new` (decision 35): how an app of this stack starts from an empty folder, with the
 * stack's own scaffold where it has one, before `init` links and prepares it.
 */
export type Scaffold = {
  /** The scaffold as people know it: create-vite, composer create-project, flutter create. */
  tool: string;
  /** The programs the steps run, which must be on the PATH before the first one starts. */
  needs: string[];
  /** The steps that make the app `name` (a folder name) in the folder `new` runs in, in order. */
  steps(name: string): ScaffoldStep[];
};

/** Lines a recipe appends to a file the app already has, and takes out again on uninstall. */
export type RecipeSnippet = { file: string; text: string };

/** What a recipe's preview setup adds to `init`'s plan. */
export type PreviewPlan = {
  changes: PrepChange[];
  /** What the studio could not do safely, for the designer to do by hand. */
  manual: string[];
  /** Folders the app's build and type check must leave out, besides rough/. */
  ignoredFromBuild: string[];
  /** Entries for .gitignore, written as "/path/" or "/file". */
  gitWanted: string[];
};

export type Recipe = {
  id: string;
  name: string;
  /** Bumped when the preview setup changes, so `setup --upgrade` knows a repo is behind. */
  version: number;
  /** What the setup run's prompt gets when this recipe fits: how the preview is usually set up here. */
  setupNotes: string;
  /** The folder the preview setup lives in, repo-relative, or null when the repo has none. */
  appDir(repo: string): string | null;
  /**
   * The environment of a repo this recipe set up, or of one linked before environments existed, for
   * one operating system (this machine's when not given): commands may differ on Windows.
   */
  environment(link: RepoLink | null, os?: EnvironmentOs): RepoEnvironment;
  /** The preview setup for a repo, planned without writing anything. */
  planPreview(repo: string, link: RepoLink): PreviewPlan;
  /** Every file the preview setup writes outside rough/, repo-relative, for doctor and uninstall. */
  setupFiles(repo: string, link: RepoLink): string[];
  /**
   * The lines the preview setup appends to the app's own files (a route file's require, a build
   * file's test dependencies), which uninstall takes out by their exact text. None for most.
   */
  snippets?(repo: string, link: RepoLink): RecipeSnippet[];
  /** The stack's own rules in rough/AGENTS.md, after the rules every stack shares. */
  agentRules(environment: RepoEnvironment): string;
  /** rough/tsconfig.json, or null when the repo has no TypeScript settings to extend. */
  roughTsconfig(repo: string): string | null;
  /**
   * What a new slot shows until its agent has written it; `key` is the slot's, for a stack whose
   * files name their own package or type (`rough.home.hero.iteration_01`).
   */
  placeholder(entry: string, key?: string): string;
  /**
   * A forked iteration's file as it must read at its new key, for a stack whose files name their
   * own package or type by the key; the text unchanged where nothing names it.
   */
  retarget?(file: string, text: string, from: string, to: string): string;
  /** Files the studio itself regenerates after iterations change, repo-relative. */
  generatedFiles: string[];
  /** Folders or files allowed to import from rough/, such as a preview route, repo-relative. */
  importAllowed(link: RepoLink): string[];
  /** Brings the preview setup up to date with the iterations in rough/, after they change. */
  syncPreview(repo: string): void;
  /** What a pulled sketch's file needs to render here; the text unchanged when nothing. */
  pullTransform(file: string, text: string): string;
  /** Where a promoted component goes when nothing says. */
  promoteDefault(
    componentsDir: string,
    componentName: string,
    isFolder: (relative: string) => boolean
  ): string;
  /** The extensions a promoted component's file may have, with their dots. */
  promoteExtensions: string[];
  /**
   * What the promote prompt says of this stack (F7 of the frameworks plan): what to read first to
   * follow the repo, the stack's own rules as "- …" lines, and how the agent says the component
   * is used once it is written.
   */
  promoteWords: { read: string; rules: string[]; usage: string };
  /**
   * What a local prompt's rules ask of this stack's craft: the floor's paragraph in its own terms
   * (controls, states, targets, colors, motion, media), and the primitives it names, if any.
   */
  craft: CraftWords;
  /**
   * The iterations `roughbook doctor` writes to check the preview: one that renders `marker` (and
   * `fixtureNote`, from its fixture file, when the stack's preview takes one) and one that fails
   * to render. Files by name, as an iteration folder holds them.
   */
  doctorSamples(input: {
    marker: string;
    fixtureNote: string;
    /** The key the sample is written at, `<page>/<component>/<iteration>`. */
    key: string;
  }): {
    good: Record<string, string>;
    broken: Record<string, string>;
  };
  /**
   * `init --scratch`: a minimal app of this stack written without the network, kept for the
   * fallback recipe; `roughbook new` runs the scaffold below instead.
   */
  scratch?: { write(dir: string): void; written(dir: string): string };
  /** `roughbook new`: the stack's scaffold, or null when the studio cannot start one. */
  scaffold: Scaffold | null;
};
