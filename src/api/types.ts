// What the backend's /studio routes answer. Kept by hand beside the backend's validators; the
// route tests on both sides pin the shapes.
import type { Family } from '../environment/types.js';

export type OrgRole = 'owner' | 'editor' | 'viewer';

export type DeviceLogin = {
  deviceCode: string;
  /** ABCD-EFGH, typed by the designer at /link. */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type IssuedInstall = { token: string; installId: string };

export type Me = {
  user: { id: string; email: string; name: string | null };
  /** The web's address, for links to where the brief is edited. */
  webUrl?: string;
  /** The API's own address (the backend's API_URL), which the studio keeps as its server. */
  apiUrl?: string;
  /** This install's analytics answer, null until asked. */
  analyticsConsent?: boolean | null;
};

export type OrgProjects = {
  id: string;
  name: string;
  role: OrgRole;
  projects: { slug: string; name: string }[];
};

export type LinkResult = {
  linkId: string;
  org: { id: string; name: string };
  project: { slug: string; name: string };
};

/**
 * `POST /orgs/:orgId/links`: which project, and what detection found about the stack (decision 15
 * of the frameworks plan): the framework token the link column keeps, the stack tokens, the family
 * and the preview mode. Never a path or a command.
 */
export type LinkBody = {
  project: string;
  framework: string | null;
  roughCommitted: boolean;
  stack?: string[];
  family?: string;
  mode?: string;
};

/** `GET /orgs/:orgId/projects/:project/setup-prompt`: the setup run's prompt, with its stand-ins. */
export type SetupPrompt = {
  prompt: string;
  placeholders: { contract: string; guess: string; recipeNotes: string; ruleFiles: string };
};

/** `GET /orgs/:orgId/projects/:project/map-prompt`: the map run's prompt, with its stand-ins. */
export type MapPrompt = {
  prompt: string;
  placeholders: { discovered: string; fixtureFile: string; guess: string; doctor: string };
};

/**
 * `POST /orgs/:orgId/links/:linkId/doctor`: how doctor went on this repo, for ratings and
 * analytics by stack: the outcome, the mode, the family, the stack tokens and the ids of the checks
 * that failed. Never a path, a URL or anything from the repo's files.
 */
export type DoctorResultBody = {
  outcome: 'pass' | 'fail' | 'unverified';
  mode: string;
  family: string;
  stack: string[];
  failed: string[];
  /** The recipe the setup came from, or null for one the designer's agent built (the verified tier). */
  recipe: string | null;
  /** The setup run this doctor ended, if one was open: its kind and how long it took. */
  setup?: { kind: 'setup' | 'fix'; seconds: number };
};

/**
 * Where an iteration was made: a web sketch, a studio, or the app itself (`app`, iteration 0, the
 * baseline of an adopted component: B2 of ROUGHBOOK-BROWNFIELD-PLAN.md).
 */
export type IterationOrigin = 'sketch' | 'local' | 'app';

/** An iteration as the server records it: metadata only, never its code. */
export type IterationRecord = {
  id: string;
  number: number;
  name: string;
  status: string;
  parent: string | null;
  direction: string;
  generation: { mode: string };
  /** Absent from a backend older than B2. */
  origin?: IterationOrigin;
};

export type ComponentRecord = {
  slug: string;
  name: string;
  selectedIteration: number | null;
  iterations: IterationRecord[];
  /** Adopted from the app's own code (decision 6 of the brownfield plan). */
  inApp?: boolean;
};

export type PageRecord = {
  slug: string;
  name: string;
  components: ComponentRecord[];
  /** Adopted from the app's own pages. */
  inApp?: boolean;
};

/** `GET /orgs/:orgId/projects/:project`: the project with its brief; the parts the studio reads. */
export type ProjectTree = {
  slug: string;
  name: string;
  delivery: { componentsDir: string; publicDir: string; devUrl: string };
  pages: PageRecord[];
  /**
   * Whether the studio uploads its pictures (decisions 21, 23 and 28 of the brownfield plan): on
   * unless the project's setting turned it off; absent from a backend older than B2.
   */
  pictures?: boolean;
};

/**
 * `POST /orgs/:orgId/projects/:project/adopt`: the pages and components adopted from the map, by
 * name, slug and kind only (decision 7 of the brownfield plan): no path, file, fixture or code.
 */
export type AdoptBody = {
  pages: {
    slug: string;
    name: string;
    components: { slug: string; name: string; kind: 'section' | 'shared' | 'atom' }[];
  }[];
};

/** What adoption made: each page and component, whether it is new, and its baseline's key. */
export type Adopted = {
  pages: {
    slug: string;
    created: boolean;
    components: { slug: string; created: boolean; baseline: string }[];
  }[];
};

/**
 * The pictures the studio uploads: three of an iteration alone or of an adopted page (decision
 * 21), and two of an adopted component's iteration in its page, with the swap (decision 43).
 */
export type PictureKind = 'thumbnail' | 'desktop' | 'phone' | 'page-desktop' | 'page-phone';

/** The pictures of an iteration alone, or of an adopted page. */
export const PICTURE_KINDS: readonly PictureKind[] = ['thumbnail', 'desktop', 'phone'];

/** The pictures of an iteration in its page (B5), where its recipe has the in-page view. */
export const PAGE_PICTURE_KINDS: readonly PictureKind[] = ['page-desktop', 'page-phone'];

/** `PUT …/pictures/:kind`: what the backend kept, after re-encoding it. */
export type StoredPicture = { kind: PictureKind; width: number; height: number; updatedAt: string };

export type AssetScope = 'project' | 'library';

/** A web sketch the component has, to pull: what it is, never its code. */
export type PullableSketch = {
  id: string;
  number: number;
  name: string;
  direction: string;
  status: string;
  parent: string | null;
  created: string | null;
};

/** One file of a sketch, relative to its folder. Images are base64. */
export type SketchFile = { path: string; encoding: 'utf8' | 'base64'; content: string };

/** `POST …/sketches/:iteration/pull`: the new local iteration, and the sketch's files. */
export type PulledSketch = { iteration: string; parent: string; files: SketchFile[] };

/** One iteration's ratings as this user sees them: their own, the average and how many rated. */
export type RatingSummary = { mine: number | null; average: number | null; count: number };

/** `POST /orgs/:orgId/projects/:project/promotions`. */
export type Promotion = {
  promotionId: string;
  /** With stand-ins for the component file and public folder, which the studio fills in. */
  prompt: string;
  placeholders: {
    targetFile: string;
    targetDir: string;
    publicDir: string;
    /**
     * Where the prompt says what the repo's stack decides (F7 of the frameworks plan): sent only
     * when the request named the repo's family.
     */
    environment?: string;
    read?: string;
    keepCopy?: string;
    except?: string;
    assetIntro?: string;
    assetBase?: string;
    rules?: string;
    usage?: string;
    /**
     * For an `in-place` or `merge` promote (B4): where the "original ← copy" pairs go, one per
     * line, and the iteration's `.base/` folder.
     */
    promoteFiles?: string;
    base?: string;
    /**
     * For a page composition's promote (B6): where the page's files go, one repository path per
     * line, and the "new file ← iteration folder" pairs of its new sections.
     */
    pageFiles?: string;
    newSections?: string;
  };
  copyMarkdown: string | null;
  componentName: string;
  defaults: { componentsDir: string; publicDir: string };
  assets: { scope: AssetScope; file: string; publicUrl: string }[];
  missingAssets: { scope: AssetScope; file: string }[];
};

/**
 * `POST …/promotions` for a page's composition (B6 of the brownfield plan): the backend reads the
 * composition's sections from its record; `current` is the page's own section slugs, in order,
 * from the map. Slugs only, as adoption sends: no path, no code.
 */
export type PagePromoteBody = {
  page: string;
  composition: string;
  current: string[];
  how: 'in-place' | 'merge';
  family?: Family;
  assets: { scope: AssetScope; file: string }[];
};

/** `POST …/pages/:page/components`: the new section's slug (decision 47). */
export type NewSection = { slug: string; name?: string };

/** `POST …/pages/:page/compositions`, as the web's builder sends it: sections in order. */
export type CompositionBody = {
  sections: { component: string; iteration: string }[];
  name?: string;
  parent?: string;
};

/** What the backend numbered: `{ id: "composition-NN", number }`. */
export type CreatedComposition = { id: string; number: number };

/** `POST /heartbeat`: the studio's version, OS and the agents it found. Never a path. */
export type Heartbeat = {
  studioVersion: string;
  os: string;
  agents: { id: string; version: string | null; signedIn: boolean | null; headless: boolean }[];
};
