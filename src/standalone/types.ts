// How the studio's standalone server shows one iteration (ROUGHBOOK-FRAMEWORKS-PLAN.md, "The
// preview contract", standalone mode): a renderer turns the iteration's folder into the markup
// the page holds and the files the page links, or says why it cannot. A renderer knows one kind
// of entry file, so they live with the stacks, in src/recipes/standalone/.
import type { RepoEnvironment } from '../environment/types.js';

/** A file the page links from its own folder on the site (`__roughbook/`). */
export type PageFile = { type: string; bytes: Buffer };

export type RenderInput = {
  repoRoot: string;
  environment: RepoEnvironment;
  /** `<page>/<component>/<iteration>`. */
  key: string;
  /** The iteration's folder on disk. */
  dir: string;
  /** Where the page's own files are served, as a path on the site ending with a slash. */
  filesPath: string;
};

export type Rendered =
  | {
      ok: true;
      /** The iteration's markup: a fragment for the page's body, or a whole document. */
      markup: string;
      /** Tags the page's head gets after the site's stylesheets: a bundle's script and styles. */
      head: string[];
      /** Who says ready: the page once it loaded, or the iteration's own script once it rendered. */
      readyOn: 'load' | 'script';
      /** The files the head names, by their path under `filesPath`. */
      files: Record<string, PageFile>;
    }
  | { ok: false; message: string };

/** One section of a page's composition, as a renderer gets it. */
export type ComposeSection = {
  component: string;
  /** The iteration's folder on disk. */
  dir: string;
  /** The iteration's folder on the site, ending with a slash: what its relative links meant. */
  sitePath: string;
  /** Its parsed fixture, or null when it has none. */
  fixture: unknown;
};

export type ComposeInput = {
  repoRoot: string;
  environment: RepoEnvironment;
  page: string;
  /** In the page's order. */
  sections: ComposeSection[];
  /** Where the composition's own files are served, as a path on the site ending with a slash. */
  filesPath: string;
  /** The same, as the composed page links them. */
  filesLink: string;
};

export type Composed =
  | {
      ok: true;
      /** What the page's root holds: every section in its marker, inside the wrapper if any. */
      markup: string;
      /** Tags the page's head gets after the site's stylesheets. */
      head: string[];
      /** Attributes for the page's body, with a space before each: a wrapper's own. */
      bodyAttributes: string;
      readyOn: 'load' | 'script';
      /** The files the head names, by their path under `filesPath`. */
      files: Record<string, PageFile>;
    }
  | { ok: false; message: string };

export type StandaloneRenderer = {
  id: string;
  render(input: RenderInput): Promise<Rendered>;
  /** A page's composition: every section in one document. */
  composePage(input: ComposeInput): Promise<Composed>;
};
