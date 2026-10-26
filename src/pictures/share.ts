// The pictures the studio uploads (decisions 21, 23 and 28 of ROUGHBOOK-BROWNFIELD-PLAN.md): of
// every studio iteration and baseline after its screenshots, and of each adopted page at its
// address. Three of each, in the default variant: a thumbnail one screen tall at 1280 px, as a web
// sketch's is, and full-length pictures at the environment's desktop and phone viewports. They are
// taken here as WebP, kept beside the screenshots in rough/.screenshots/, and go up through the
// outbox, so an offline studio sends them later; each again only when it changed. None while the
// project's `pictures` setting is off, and never any other screenshot the studio takes.
import fs from 'node:fs';
import path from 'node:path';
import { picturePath, type StudioApi } from '../api/client.js';
import { describeError, OfflineError } from '../api/errors.js';
import { sha256, type Outbox } from '../api/outbox.js';
import {
  PAGE_PICTURE_KINDS,
  PICTURE_KINDS,
  type PictureKind,
  type ProjectTree
} from '../api/types.js';
import type { RepoEnvironment, Viewport } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { BASELINE } from '../map/adopt.js';
import { isDynamic, readMap } from '../map/file.js';
import type { MapPage, RepoMap } from '../map/types.js';
import { contextAddress, contextSections } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import { ROUGH_DIR } from '../repo/root.js';
import { findBrowser, takePicture, type ScreenshotSize } from '../screenshot/browser.js';
import { iterationHash, screenshotIteration, type Shots } from '../screenshot/iteration.js';
import { pictureRefusal } from './allowed.js';

/** Takes one picture; null when the page could not be photographed. Replaced in tests. */
export type PictureShot = (input: {
  url: string;
  size: ScreenshotSize;
  full: boolean;
  overlays: string[];
  /** At most how long to wait for the page to say ready: an app's own page never does. */
  waitMs?: number;
}) => Promise<Buffer | null>;

/** The thumbnail's viewport, as the backend's sketch thumbnails use: one screen at 1280 px. */
export const THUMBNAIL_SIZE: ScreenshotSize = { width: 1280, height: 800, mobile: false };
const DESKTOP: ScreenshotSize = { width: 1440, height: 900, mobile: false };
const PHONE: ScreenshotSize = { width: 390, height: 844, mobile: true };
/** How long an app's own page is given to settle before its picture: it never says ready. */
const PAGE_WAIT_MS = 5000;

/** What each picture is taken at: the thumbnail, then the environment's widest desktop and first phone viewport. */
export function pictureSizes(
  viewports: Viewport[]
): { kind: PictureKind; size: ScreenshotSize; full: boolean }[] {
  const size = (viewport: Viewport | undefined, fallback: ScreenshotSize) =>
    viewport
      ? { width: viewport.width, height: viewport.height, mobile: viewport.mobile }
      : fallback;
  const desktop = viewports.filter(item => !item.mobile).sort((a, b) => b.width - a.width)[0];
  const phone = viewports.find(item => item.mobile);
  return [
    { kind: 'thumbnail', size: THUMBNAIL_SIZE, full: false },
    { kind: 'desktop', size: size(desktop, DESKTOP), full: true },
    { kind: 'phone', size: size(phone, PHONE), full: true }
  ];
}

/** An iteration's pictures, a page composition's (B6), or an adopted page's when it names neither. */
export type PictureSubject = {
  page: string;
  component?: string;
  iteration?: string;
  composition?: string;
};

/** Where a subject's pictures are kept here, repo-relative: never committed, never sent by name. */
export function picturesDir(subject: PictureSubject): string {
  if (subject.component && subject.iteration) {
    return `${ROUGH_DIR}/.screenshots/${subject.page}/${subject.component}/${subject.iteration}/pictures`;
  }
  return subject.composition
    ? `${ROUGH_DIR}/.screenshots/.compositions/${subject.page}/${subject.composition}`
    : `${ROUGH_DIR}/.screenshots/.pages/${subject.page}`;
}

/** What an iteration in its page is pictured at: full length, at the desktop and phone viewports. */
export function inPageSizes(
  viewports: Viewport[]
): { kind: PictureKind; size: ScreenshotSize; full: boolean }[] {
  const [, desktop, phone] = pictureSizes(viewports);
  return [
    { kind: 'page-desktop', size: desktop!.size, full: true },
    { kind: 'page-phone', size: phone!.size, full: true }
  ];
}

const MANIFEST = 'pictures.json';
/** The in-page pictures' own manifest, beside the pictures alone: each is retaken on its own. */
const PAGE_MANIFEST = 'in-page.json';

type Manifest = { hash: string; files: Partial<Record<PictureKind, string>> };

export type PictureReport = {
  /** Kinds sent now, waiting in the outbox, and already on the backend as they are. */
  sent: PictureKind[];
  queued: PictureKind[];
  unchanged: PictureKind[];
  /** Why none were taken or sent: the project takes none of this subject, or it cannot be pictured. */
  skipped: string | null;
  /** What went wrong with some of them. */
  warning: string | null;
};

export type ShareInput = {
  repoRoot: string;
  api: StudioApi;
  outbox: Outbox;
  link: { orgId: string; project: string };
  environment: Pick<RepoEnvironment, 'viewports' | 'overlays'>;
  shoot: PictureShot;
  /** The project as just read, if it was; read here otherwise, and null when it cannot be. */
  tree?: ProjectTree | null;
  /** Take them again even when nothing changed. */
  force?: boolean;
};

function empty(skipped: string | null = null, warning: string | null = null): PictureReport {
  return { sent: [], queued: [], unchanged: [], skipped, warning };
}

/** The project; null offline, when the pictures are taken and queued, and the outbox checks it before sending. */
async function projectOf(input: ShareInput): Promise<ProjectTree | null | 'refused'> {
  if (input.tree !== undefined) return input.tree;
  try {
    return await input.api.project(input.link.orgId, input.link.project);
  } catch (error) {
    return error instanceof OfflineError ? null : 'refused';
  }
}

/**
 * Takes a subject's pictures at `url` when `hash` (what they show) changed since they were last
 * taken, then queues each one the backend does not have yet.
 */
async function share(
  input: ShareInput,
  subject: PictureSubject,
  url: string,
  hash: string,
  waitMs?: number,
  inPage = false
): Promise<PictureReport> {
  const { repoRoot } = input;
  const dir = picturesDir(subject);
  const disk = (file: string) => path.join(repoRoot, ...file.split('/'));
  const manifestFile = disk(`${dir}/${inPage ? PAGE_MANIFEST : MANIFEST}`);
  const kinds = inPage ? PAGE_PICTURE_KINDS : PICTURE_KINDS;
  const sizes = (inPage ? inPageSizes : pictureSizes)(input.environment.viewports as Viewport[]);
  const manifest = await readJson<Manifest>(manifestFile);
  let files: Manifest['files'] = {};
  const fresh =
    !input.force &&
    manifest?.hash === hash &&
    kinds.every(kind => manifest.files[kind] && fs.existsSync(disk(manifest.files[kind]!)));
  const missed: PictureKind[] = [];
  if (fresh) {
    files = manifest.files;
  } else {
    for (const { kind, size, full } of sizes) {
      const bytes = await input.shoot({
        url,
        size,
        full,
        overlays: input.environment.overlays,
        ...(waitMs ? { waitMs } : {})
      });
      if (!bytes) {
        missed.push(kind);
        continue;
      }
      const file = `${dir}/${kind}.webp`;
      fs.mkdirSync(path.dirname(disk(file)), { recursive: true });
      fs.writeFileSync(disk(file), bytes);
      files[kind] = file;
    }
    await writeJsonAtomic(manifestFile, {
      hash: missed.length ? '' : hash,
      files
    } satisfies Manifest);
  }
  const report = empty();
  const problems: string[] = missed.length ? [`no ${missed.join(' or ')} picture came out`] : [];
  for (const kind of kinds) {
    const file = files[kind];
    if (!file) continue;
    const bytes = fs.readFileSync(disk(file));
    try {
      const sent = await input.outbox.upload(
        input.api,
        picturePath(input.link.orgId, input.link.project, subject, kind),
        {
          file,
          type: 'image/webp',
          hash: sha256(bytes),
          picture: { ...input.link, ...subject, kind }
        }
      );
      if (sent.status === 'skipped') return { ...empty(sent.code), sent: report.sent };
      report[
        sent.status === 'sent' ? 'sent' : sent.status === 'queued' ? 'queued' : 'unchanged'
      ].push(kind);
    } catch (error) {
      problems.push(`the ${kind} picture was refused: ${describeError(error)}`);
    }
  }
  report.warning = problems.length ? `Pictures: ${problems.join('; ')}.` : null;
  return report;
}

/**
 * After an iteration's screenshots: its pictures, when the project takes them (a studio iteration
 * or a baseline, with pictures on). `url` is its preview, as the screenshots asked it; `hash` what
 * the screenshots were taken of (iterationHash).
 */
export async function shareIterationPictures(
  input: ShareInput,
  target: { page: string; component: string; iteration: string },
  url: string,
  hash: string | null
): Promise<PictureReport> {
  if (!hash) return empty('NOT_IN_REPO');
  const tree = await projectOf(input);
  if (tree === 'refused') return empty('PROJECT_UNREADABLE');
  const refusal = tree ? pictureRefusal(tree, target) : null;
  if (refusal) return empty(refusal);
  return share(input, target, url, hash);
}

/**
 * Where an adopted component's iteration is seen in its page (B5), on the app at `base`: the page
 * with the swap, as the frame's "In its page" asks it; and what those pictures show, the
 * iteration's files and the app's files of the page and the component, so they are retaken when
 * the app's source changes, as a baseline's are. Null for a baseline (it is the page itself), for a
 * recipe with no in-page view, and for a section no page at a fixed address shows.
 */
export function inPageTarget(
  repoRoot: string,
  environment: Pick<RepoEnvironment, 'recipe' | 'entry' | 'viewports' | 'variants' | 'overlays'>,
  target: { page: string; component: string; iteration: string },
  base: string
): { url: string; hash: string } | null {
  if (target.iteration === BASELINE) return null;
  const hook = recipeFor(environment.recipe)?.contextPreview;
  if (!hook) return null;
  let map: RepoMap | undefined;
  try {
    map = readMap(repoRoot)?.map;
  } catch {
    return null;
  }
  if (!map) return null;
  const section = contextSections(repoRoot, environment.entry, map).find(
    item => item.page === target.page && item.component === target.component
  );
  const key = `${target.page}/${target.component}/${target.iteration}`;
  if (!section?.iterations.some(item => item.key === key)) return null;
  const address = contextAddress(map, section);
  if (!address) return null;
  const page = map.pages.find(item => item.slug === target.page);
  const sources = [...(page?.files ?? []), ...section.source.files];
  const hash = iterationHash(repoRoot, target, environment, sources);
  if (!hash) return null;
  return {
    url: new URL(hook.address(address, key), base.endsWith('/') ? base : `${base}/`).toString(),
    hash: sha256(Buffer.from(`in-page\0${address}\0${hash}`))
  };
}

/** An adopted component's iteration in its page: its page-desktop and page-phone pictures (decision 43). */
export async function shareInPagePictures(
  input: ShareInput,
  target: { page: string; component: string; iteration: string },
  url: string,
  hash: string
): Promise<PictureReport> {
  const tree = await projectOf(input);
  if (tree === 'refused') return empty('PROJECT_UNREADABLE');
  const refusal = tree ? pictureRefusal(tree, target) : null;
  if (refusal) return empty(refusal);
  return share({ ...input, tree }, target, url, hash, PAGE_WAIT_MS, true);
}

/**
 * A page's composition made here (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md): its thumbnail, desktop and
 * phone pictures of the composed preview at `url`, as an iteration's are taken; `hash` is what
 * they show (compositionHash), so they are retaken only when a section's iteration changes.
 */
export async function shareCompositionPictures(
  input: ShareInput,
  target: { page: string; composition: string },
  url: string,
  hash: string
): Promise<PictureReport> {
  const tree = await projectOf(input);
  if (tree === 'refused') return empty('PROJECT_UNREADABLE');
  const refusal = tree ? pictureRefusal(tree, target) : null;
  if (refusal) return empty(refusal);
  return share({ ...input, tree }, target, url, hash);
}

/** The address an adopted page is pictured at, or why it is not (decision 13 and 14). */
export function pageAddress(page: MapPage): { address: string } | { why: string } {
  if (page.signIn === 'yes') {
    return { why: 'it is behind a sign-in, and the studio has no development sign-in for it' };
  }
  const address = page.example ?? page.address;
  if (!address) return { why: 'it has no address of its own' };
  if (isDynamic(address)) return { why: 'its address is dynamic and the map gives no example' };
  return { address };
}

/** What a page's pictures show: its files, as they are now, and the viewports. */
function pageHash(repoRoot: string, page: MapPage, environment: ShareInput['environment']) {
  const parts = [
    JSON.stringify({ address: page.example ?? page.address, viewports: environment.viewports })
  ];
  for (const file of page.files) {
    try {
      parts.push(file, sha256(fs.readFileSync(path.join(repoRoot, ...file.split('/')))));
    } catch {
      parts.push(file, 'gone');
    }
  }
  return sha256(Buffer.from(parts.join('\0')));
}

/** An adopted page's pictures at its address on `base`, the app as it runs. */
export async function sharePagePictures(
  input: ShareInput,
  page: MapPage,
  base: string
): Promise<PictureReport> {
  const tree = await projectOf(input);
  if (tree === 'refused') return empty('PROJECT_UNREADABLE');
  const refusal = tree ? pictureRefusal(tree, { page: page.slug }) : null;
  if (refusal) return empty(refusal);
  const where = pageAddress(page);
  if ('why' in where) return empty(`not pictured: ${where.why}`);
  const url = new URL(where.address, base.endsWith('/') ? base : `${base}/`).toString();
  return share(
    { ...input, tree },
    { page: page.slug },
    url,
    pageHash(input.repoRoot, page, input.environment),
    PAGE_WAIT_MS
  );
}

/** What picture taking needs of a command's context. */
export type PictureContext = {
  takePicture?: PictureShot;
  /** The screenshots' own function: pictures are taken as they are. */
  screenshot?: typeof screenshotIteration;
  env: NodeJS.ProcessEnv;
};

/**
 * How pictures are taken: the context's own, or this machine's browser; null with none, and null
 * when the context replaced its screenshots and not its pictures (a test's), since they go together.
 */
export function pictureShot(context: PictureContext): PictureShot | null {
  if (context.takePicture) return context.takePicture;
  if (context.screenshot && context.screenshot !== screenshotIteration) return null;
  const browser = findBrowser(context.env);
  return browser ? shot => takePicture({ browser, ...shot }) : null;
}

/**
 * After an iteration's screenshots, wherever they were taken (done, roughbook screenshot, the local
 * UI, adopt): its pictures, when the screenshots came out and the project takes them. A line for
 * the terminal, or null when there is nothing to say.
 */
export async function picturesAfterShots(
  context: PictureContext,
  input: Omit<ShareInput, 'shoot' | 'environment'> & { environment: RepoEnvironment },
  target: { page: string; component: string; iteration: string },
  url: string,
  shots: Shots
): Promise<string | null> {
  // Snapshot mode's images are the repo's own tool's: not pictured here yet.
  if (input.environment.mode === 'snapshot' || !Object.keys(shots.files).length) return null;
  if (!input.api.signedIn) return null;
  const shoot = pictureShot(context);
  if (!shoot) return null;
  const report = await shareIterationPictures(
    { ...input, shoot },
    target,
    url,
    iterationHash(input.repoRoot, target, input.environment)
  );
  const label = `${target.page}/${target.component}/${target.iteration}`;
  const lines = [describePictures(label, report), report.warning];
  // In its page too, with the swap, where the recipe has the in-page view (B5).
  const inPage = inPageTarget(input.repoRoot, input.environment, target, new URL(url).origin);
  if (inPage && report.skipped === null) {
    const shown = await shareInPagePictures({ ...input, shoot }, target, inPage.url, inPage.hash);
    lines.push(describePictures(`${label} in its page`, shown), shown.warning);
  }
  return lines.filter(Boolean).join(' ') || null;
}

/** One line for the terminal: what went up, or why not. Null when there is nothing to say. */
export function describePictures(label: string, report: PictureReport): string | null {
  if (report.skipped === 'PICTURES_OFF') return null;
  if (report.skipped?.startsWith('not pictured')) return `${label}: ${report.skipped}.`;
  if (report.skipped) return null;
  const parts = [
    report.sent.length ? `${report.sent.length} uploaded` : '',
    report.queued.length ? `${report.queued.length} waiting to upload` : ''
  ].filter(Boolean);
  return parts.length ? `${label}: pictures ${parts.join(', ')}.` : null;
}
