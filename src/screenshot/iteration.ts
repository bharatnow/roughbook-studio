import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { previewUrl, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { screenshotSet, withVariant } from '../environment/variants.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { baselineSources } from '../map/adopt.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { BASE_DIR } from '../runs/base.js';
import { describeResult, renderSnapshots, type SnapshotExec } from '../snapshot/render.js';
import { findBrowser, takeScreenshot } from './browser.js';

export type Shots = {
  /** Repo-relative paths of the screenshots, by name: the viewport, with the variant after the first. */
  files: Record<string, string>;
  /** Why some or all were not taken. */
  warning: string | null;
  /** Nothing was taken: the iteration's files are as they were when the screenshots were last taken. */
  skipped?: true;
};

/** Where an iteration's screenshots go: rough/.screenshots/, never committed. */
export function screenshotPath(page: string, component: string, iteration: string, size: string) {
  return `${ROUGH_DIR}/.screenshots/${page}/${component}/${iteration}/${size}.png`;
}

/**
 * Where doctor's pictures of the map's pages and components go, at each viewport: kept here for the
 * canvas's "In the app" cards before anything is adopted, never uploaded.
 */
export function mapScreenshotPath(kind: 'page' | 'component', slug: string, viewport: string) {
  return `${ROUGH_DIR}/.screenshots/.map/${kind}-${slug}-${viewport}.png`;
}

/** Beside an iteration's screenshots: what they were taken of, so unchanged files are not taken again. */
export const SHOTS_MANIFEST = 'shots.json';

type Manifest = { hash: string; files: Record<string, string> };

type Target = { page: string; component: string; iteration: string };

function manifestFile(repoRoot: string, target: Target): string {
  return path.join(
    repoRoot,
    ROUGH_DIR,
    '.screenshots',
    target.page,
    target.component,
    target.iteration,
    SHOTS_MANIFEST
  );
}

/** What the preview route answered, after redirects; null when nothing answered at all. */
export type PreviewAnswer = { status: number; url: string } | null;

/**
 * Asks a preview once and reads nothing of it: the warming request a dev server that compiles on
 * first request needs, and the look before any screenshot. Null when nothing answered in time.
 */
export async function askPreview(
  url: string,
  timeoutMs = 150_000,
  fetchImpl: typeof fetch = fetch
): Promise<PreviewAnswer> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return { status: response.status, url: response.url || url };
  } catch {
    return null;
  }
}

/** Asks the preview route once before any screenshot, giving the dev server time to compile. */
export const checkPreview = askPreview;

/**
 * Why the preview cannot be photographed, or null when it can. A browser photographs whatever
 * answers, so a login, a redirect, a missing route or an error would otherwise become a blank
 * or wrong screenshot with no warning.
 */
export function previewProblem(url: string, devUrl: string, answer: PreviewAnswer): string | null {
  const again = 'then take them with roughbook screenshot';
  if (!answer) {
    return `Nothing answered at ${devUrl}, so no screenshots were taken. Start the app's dev server (or name it with --dev-url), ${again}.`;
  }
  const asked = new URL(url).pathname;
  if (answer.status === 401 || answer.status === 403) {
    return `The app asks for a login at ${asked} (HTTP ${answer.status}), so no screenshots were taken. Let the preview route through in development, such as by turning the app's access gate off there, ${again}.`;
  }
  const landed = new URL(answer.url).pathname;
  if (landed !== asked) {
    return `The app sent the preview to ${landed}, perhaps a sign-in page, so no screenshots were taken. Let ${asked} through in development, ${again}.`;
  }
  if (answer.status === 404) {
    return `${asked} answered 404, so no screenshots were taken. Check that ${devUrl} is this repo's dev server and that roughbook init added its preview route, ${again}.`;
  }
  if (answer.status >= 400) {
    return `The preview answered HTTP ${answer.status}, so no screenshots were taken; the iteration may not render. Open ${url} to see why, ${again}.`;
  }
  return null;
}

/**
 * A hash of everything the screenshots depend on: each file of the iteration's folder, and the
 * viewports, variants and overlays they are taken with; for a baseline, the app's own files it
 * points at too (`sources`, repo-relative). Null when the folder is not there.
 */
export function iterationHash(
  repoRoot: string,
  target: Target,
  environment: Pick<RepoEnvironment, 'viewports' | 'variants' | 'overlays'>,
  sources: string[] = baselineSources(repoRoot, target)
): string | null {
  const dir = path.join(
    repoRoot,
    ...iterationDir(target.page, target.component, target.iteration).split('/')
  );
  if (!fs.existsSync(dir)) return null;
  const hash = createHash('sha256');
  const walk = (folder: string, prefix: string) => {
    const entries = fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      // A fork's kept base is the app as it was, which its pictures do not show (B3).
      if (entry.isDirectory() && relative === BASE_DIR) continue;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), `${relative}/`);
      else if (entry.isFile()) {
        hash.update(`${relative}\0`);
        hash.update(fs.readFileSync(path.join(folder, entry.name)));
        hash.update('\0');
      }
    }
  };
  walk(dir, '');
  for (const source of sources) {
    hash.update(`${source}\0`);
    try {
      hash.update(fs.readFileSync(path.join(repoRoot, ...source.split('/'))));
    } catch {
      hash.update('gone');
    }
    hash.update('\0');
  }
  hash.update(
    JSON.stringify({
      viewports: environment.viewports,
      variants: environment.variants,
      overlays: environment.overlays
    })
  );
  return hash.digest('hex');
}

export type ShotOptions = {
  /** Take them again even when nothing changed. */
  force?: boolean;
  /** What a warming request already found at the preview, so it is not asked again. */
  answer?: PreviewAnswer;
  /** Snapshot mode: how the snapshot command is run, replaced in tests. */
  snapshotExec?: SnapshotExec;
};

/**
 * A screenshot at each of the environment's viewports, in each of its variants, through the
 * repo's dev server; taken once, and again only when the iteration's files changed
 * (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed"), unless `force` says so.
 */
export async function screenshotIteration(
  repoRoot: string,
  devUrl: string,
  target: Target,
  env: NodeJS.ProcessEnv,
  take: typeof takeScreenshot = takeScreenshot,
  browser: string | null = findBrowser(env),
  check: typeof askPreview = askPreview,
  environment?: RepoEnvironment,
  options: ShotOptions = {}
): Promise<Shots> {
  const repo = environment ?? (await readEnvironment(repoRoot));
  // Snapshot mode: the repo's own tool renders the images, no browser involved.
  if (repo.mode === 'snapshot') {
    const key = `${target.page}/${target.component}/${target.iteration}`;
    // Only once approved on this machine, whoever asks: done, roughbook screenshot, an agent's
    // finish_run (decision 18). A commit that changed the command has it asked again.
    if (repo.snapshot && !isApproved(await readApprovals(repoRoot), repo.snapshot, repo.shell)) {
      return {
        files: {},
        warning: `The snapshot command is not approved on this machine (${repo.snapshot}), so no images were rendered. Run roughbook doctor in a terminal and approve it.`
      };
    }
    const run = await renderSnapshots(repoRoot, repo, [key], {
      force: options.force,
      exec: options.snapshotExec
    });
    const result = run.results[key]!;
    return {
      files: result.files,
      warning: describeResult(key, result),
      ...(run.unchanged.includes(key) ? { skipped: true as const } : {})
    };
  }
  if (!browser) {
    return {
      files: {},
      warning:
        'No Chrome, Chromium or Edge was found for screenshots. Set ROUGHBOOK_BROWSER to one.'
    };
  }
  const hash = iterationHash(repoRoot, target, repo);
  const manifest = hash ? await readJson<Manifest>(manifestFile(repoRoot, target)) : null;
  if (!options.force && manifest && manifest.hash === hash) {
    const present = Object.values(manifest.files).every(file =>
      fs.existsSync(path.join(repoRoot, ...file.split('/')))
    );
    if (present) return { files: manifest.files, warning: null, skipped: true };
  }
  const url = previewUrl(devUrl, target.page, target.component, target.iteration, repo);
  const answer = options.answer === undefined ? await check(url) : options.answer;
  const problem = previewProblem(url, devUrl, answer);
  if (problem) return { files: {}, warning: problem };
  const files: Shots['files'] = {};
  const set = screenshotSet(repo.viewports, repo.variants);
  for (const shot of set) {
    const viewport = repo.viewports.find(item => item.name === shot.viewport)!;
    const relative = screenshotPath(target.page, target.component, target.iteration, shot.name);
    const ok = await take({
      browser,
      url: withVariant(url, shot.variant),
      file: path.join(repoRoot, ...relative.split('/')),
      size: viewport,
      overlays: repo.overlays,
      variant: shot.variant
    });
    if (ok) files[shot.name] = relative;
  }
  const all = Object.keys(files).length === set.length;
  if (all && hash) {
    await writeJsonAtomic(manifestFile(repoRoot, target), { hash, files } satisfies Manifest);
  }
  return {
    files,
    warning: all ? null : `The screenshot failed. Is the app's dev server running at ${devUrl}?`
  };
}
