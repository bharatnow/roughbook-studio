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

/** Desktop and phone screenshots of one iteration, through the repo's dev server. */
export async function screenshotIteration(
  repoRoot: string,
  devUrl: string,
  target: { page: string; component: string; iteration: string },
  env: NodeJS.ProcessEnv,
  take: typeof takeScreenshot = takeScreenshot,
  browser: string | null = findBrowser(env)
): Promise<Shots> {
  if (!browser) {
    return {
      files: {},
      warning:
        'No Chrome, Chromium or Edge was found for screenshots. Set ROUGHBOOK_BROWSER to one.'
    };
  }
  const url = previewUrl(devUrl, target.page, target.component, target.iteration);
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
