import path from 'node:path';
import { previewUrl } from '../repo/preview.js';
import { ROUGH_DIR } from '../repo/root.js';
import { SIZES, findBrowser, takeScreenshot } from './browser.js';

export type Shots = {
  /** Repo-relative paths of the screenshots written, by width. */
  files: Partial<Record<keyof typeof SIZES, string>>;
  /** Why some or all were not taken. */
  warning: string | null;
};

/** Where an iteration's screenshots go: rough/.screenshots/, never committed. */
export function screenshotPath(
  page: string,
  component: string,
  iteration: string,
  size: keyof typeof SIZES
) {
  return `${ROUGH_DIR}/.screenshots/${page}/${component}/${iteration}/${size}.png`;
}

/** What the preview route answered, after redirects; null when nothing answered at all. */
export type PreviewAnswer = { status: number; url: string } | null;

/** Asks the preview route once before any screenshot, giving the dev server time to compile. */
export async function checkPreview(url: string, timeoutMs = 150_000): Promise<PreviewAnswer> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel();
    return { status: response.status, url: response.url || url };
  } catch {
    return null;
  }
}

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

/** Desktop and phone screenshots of one iteration, through the repo's dev server. */
export async function screenshotIteration(
  repoRoot: string,
  devUrl: string,
  target: { page: string; component: string; iteration: string },
  env: NodeJS.ProcessEnv,
  take: typeof takeScreenshot = takeScreenshot,
  browser: string | null = findBrowser(env),
  check: typeof checkPreview = checkPreview
): Promise<Shots> {
  if (!browser) {
    return {
      files: {},
      warning:
        'No Chrome, Chromium or Edge was found for screenshots. Set ROUGHBOOK_BROWSER to one.'
    };
  }
  const url = previewUrl(devUrl, target.page, target.component, target.iteration);
  const problem = previewProblem(url, devUrl, await check(url));
  if (problem) return { files: {}, warning: problem };
  const files: Shots['files'] = {};
  for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
    const relative = screenshotPath(target.page, target.component, target.iteration, size);
    const ok = await take({
      browser,
      url,
      file: path.join(repoRoot, ...relative.split('/')),
      size: SIZES[size]
    });
    if (ok) files[size] = relative;
  }
  return {
    files,
    warning:
      Object.keys(files).length === 2
        ? null
        : `The screenshot failed. Is the app's dev server running at ${devUrl}?`
  };
}
