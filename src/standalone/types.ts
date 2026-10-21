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

export type StandaloneRenderer = {
  id: string;
  render(input: RenderInput): Promise<Rendered>;
};
