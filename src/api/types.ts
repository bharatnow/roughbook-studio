// What the backend's /studio routes answer. Kept by hand beside the backend's validators; the
// route tests on both sides pin the shapes.

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
};

/** An iteration as the server records it: metadata only, never its code. */
export type IterationRecord = {
  id: string;
  number: number;
  name: string;
  status: string;
  parent: string | null;
  direction: string;
  generation: { mode: string };
};

export type ComponentRecord = {
  slug: string;
  name: string;
  selectedIteration: number | null;
  iterations: IterationRecord[];
};

/** `GET /orgs/:orgId/projects/:project`: the project with its brief; the parts the studio reads. */
export type ProjectTree = {
  slug: string;
  name: string;
  delivery: { componentsDir: string; publicDir: string; devUrl: string };
  pages: { slug: string; name: string; components: ComponentRecord[] }[];
};

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
  placeholders: { targetFile: string; targetDir: string; publicDir: string };
  copyMarkdown: string | null;
  componentName: string;
  defaults: { componentsDir: string; publicDir: string };
  assets: { scope: AssetScope; file: string; publicUrl: string }[];
  missingAssets: { scope: AssetScope; file: string }[];
};

/** `POST /heartbeat`: the studio's version, OS and the agents it found. Never a path. */
export type Heartbeat = {
  studioVersion: string;
  os: string;
  agents: { id: string; version: string | null; signedIn: boolean | null; headless: boolean }[];
};
