// The map of what an app already has (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): its pages, the sections
// each is made of in order, the parts every page shares, and the atoms below them. The studio's
// discoverers read what a stack declares; the map run, an agent session, fills what they cannot
// know; `roughbook doctor` proves the result. It lives in rough/map.md, committed with rough/, and
// nothing of it reaches the server until the designer adopts a page or a component (decision 6).

/** Where a component sits (decision 5): a page's section, a part every page shares, or an atom. */
export type ComponentKind = 'section' | 'shared' | 'atom';

export const COMPONENT_KINDS: readonly ComponentKind[] = ['section', 'shared', 'atom'];

/** What is known of a page's sign-in or a component's rendering alone; unknown until someone says. */
export type Known = 'yes' | 'no' | 'unknown';

export const KNOWN: readonly Known[] = ['yes', 'no', 'unknown'];

/** The page that holds the parts every page shares (decision 5). */
export const SHARED_PAGE = 'shared';

export type MapPage = {
  /** The studio's, stable across runs: from the address, `home` for the root. */
  slug: string;
  name: string;
  /**
   * Where the page answers, in the stack's own words for a dynamic segment (`/blog/[slug]`,
   * `/posts/{post}`); null for Shared, which has no address of its own.
   */
  address: string | null;
  /** The address with every dynamic segment filled, so the page can be asked (decision 14). */
  example: string | null;
  /** Whether the page needs a signed-in user (decision 13). */
  signIn: Known;
  /** The files that make the page, repo-relative: its route file, and the view it renders. */
  files: string[];
  /** Its components' slugs, in the order the page shows them. */
  sections: string[];
  /** Added by the map run rather than a discoverer, so a later `roughbook map` keeps it. */
  byAgent: boolean;
};

export type MapComponent = {
  slug: string;
  name: string;
  kind: ComponentKind;
  /** Its source files, repo-relative; the first is the one that defines it. */
  files: string[];
  /**
   * What the stack renders it by: `default` or an export's name for a module, a view's name for a
   * template (`view sections.hero`, `x-site-footer`), a pattern's or a part's for a theme.
   */
  export: string;
  /** Its fixture, a file inside rough/ in the iteration's fixture format; null for none. */
  fixture: string | null;
  /** Whether it renders alone, with its fixture (decision 15). */
  alone: Known;
  /** Why it does not render alone, when that is known. */
  why: string | null;
  byAgent: boolean;
  /**
   * The day it went from the app (`2026-10-27`), when its file or export is no longer found and
   * something in rough/ hangs on it (B7, decision 64); absent while the app has it.
   */
  gone?: string;
};

/** Something a discoverer saw and could not place, with the reason (decision 3: never silence). */
export type Missed = {
  what: string;
  why: string;
  /**
   * The file could not be read or parsed this time (a syntax error mid-edit): what it renders is
   * not known, so nothing it rendered before is taken as gone from the app.
   */
  unread?: boolean;
};

export type RepoMap = {
  /** The format's version. */
  version: 1;
  /** The discoverers that wrote it, by recipe id; `agent` once the map run has added to it. */
  by: string[];
  pages: MapPage[];
  components: MapComponent[];
  missed: Missed[];
  /** Component files nothing in the app renders, as far as the discoverers can tell. */
  unplaced: string[];
};

/** A component as a discoverer finds it: keyed by its file and export, named by its code. */
export type FoundComponent = {
  /** `<file>#<export>`: the same component however many pages render it. */
  key: string;
  name: string;
  /** Where it was found to sit; `atom` by its folder or name, whoever renders it. */
  kind: ComponentKind;
  files: string[];
  export: string;
  /** Inputs read from the app's own stories, when it has them: the fixture's contents. */
  fixture: Record<string, unknown> | null;
  /** Where those inputs came from, for the map's prose. */
  fixtureFrom: string | null;
};

/** A page as a discoverer finds it; `address` null for the parts every page shares. */
export type FoundPage = {
  address: string | null;
  name: string | null;
  files: string[];
  /** Component keys, in order. */
  sections: string[];
  signIn: Known;
  example: string | null;
};

/** What one discoverer found in a repo. */
export type Discovered = {
  /** The recipe whose discoverer this is. */
  by: string;
  pages: FoundPage[];
  components: FoundComponent[];
  missed: Missed[];
  unplaced: string[];
};

/** One import of a file as resolved: a repo file, or something outside it. */
export type MemoImport = { path: string; original: string | null; external: boolean };

/**
 * What a discoverer read last time, kept in the studio's state between map runs (B7, decision
 * 62): each file's size and time, and each file's imports as resolved. A refresh reads again only
 * the files whose stamp changed, and updates it in place.
 */
export type DiscoverMemo = {
  /** Every file the discoverer listed, by repo path: `<size>:<mtime>`. */
  stamps: Map<string, string>;
  /** The import graph's files, with their imports. */
  imports: Map<string, MemoImport[]>;
  /** Whether the app needed its legacy decorators allowed to be read. */
  decorators?: boolean;
};

/** A discoverer's inputs: the repo, and the folders the environment says no repo commits. */
export type DiscoverInput = {
  repo: string;
  ignore: string[];
  /** The preview setup's own folders and files, which are never the app's pages. */
  own: string[];
  /** The last run's reading, for a discoverer that can read only what changed; updated in place. */
  memo?: DiscoverMemo;
};
