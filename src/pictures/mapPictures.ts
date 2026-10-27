// The pictures of the map's components not adopted yet, for the canvas's "In the app" cards
// (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md): taken as doctor takes them, through a pointer to
// the real file with its fixture under the studio's own scratch page, and kept while what they
// show is unchanged: the component's files, its fixture, and the viewports and overlays. A
// manifest beside them says what they were taken of; doctor writes it too.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFiles } from '../doctor/checks.js';
import { DOCTOR_PAGE } from '../doctor/samples.js';
import { previewUrl } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import type { MapComponent } from '../map/types.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';
import type { takeScreenshot } from '../screenshot/browser.js';
import { askPreview, mapScreenshotPath, previewProblem } from '../screenshot/iteration.js';
import type { TakeResult } from './queue.js';

/**
 * Where the pointers go while their pictures are taken: a doctor page, so the watcher, the
 * canvas and doctor's own clean-up treat it as the studio's, never the designer's.
 */
export const MAP_PICTURES_PAGE = `${DOCTOR_PAGE}-pictures`;
const ITERATION = 'iteration-01';

type Manifest = { hash: string };

type Shown = Pick<RepoEnvironment, 'viewports' | 'overlays'>;

function manifestFile(repoRoot: string, slug: string): string {
  return path.join(repoRoot, ROUGH_DIR, '.screenshots', '.map', `component-${slug}.json`);
}

const disk = (repoRoot: string, file: string) => path.join(repoRoot, ...file.split('/'));

/** What a map component's pictures show: its files and fixture as they are now, and the viewports. */
export function mapPictureHash(
  repoRoot: string,
  component: Pick<MapComponent, 'files' | 'fixture'>,
  environment: Shown
): string {
  const hash = createHash('sha256');
  for (const file of [...component.files, ...(component.fixture ? [component.fixture] : [])]) {
    hash.update(`${file}\0`);
    try {
      hash.update(fs.readFileSync(disk(repoRoot, file)));
    } catch {
      hash.update('gone');
    }
    hash.update('\0');
  }
  hash.update(JSON.stringify({ viewports: environment.viewports, overlays: environment.overlays }));
  return hash.digest('hex');
}

/** Whether a component's pictures are there at every viewport and show it as it is now. */
export async function mapPicturesKept(
  repoRoot: string,
  component: Pick<MapComponent, 'slug' | 'files' | 'fixture'>,
  environment: Shown
): Promise<boolean> {
  const manifest = await readJson<Manifest>(manifestFile(repoRoot, component.slug)).catch(
    () => null
  );
  if (manifest?.hash !== mapPictureHash(repoRoot, component, environment)) return false;
  return environment.viewports.every(viewport =>
    fs.existsSync(disk(repoRoot, mapScreenshotPath('component', component.slug, viewport.name)))
  );
}

/** Says a component's pictures, just taken, show it as it is now (doctor calls it too). */
export async function recordMapPictures(
  repoRoot: string,
  component: Pick<MapComponent, 'slug' | 'files' | 'fixture'>,
  environment: Shown
): Promise<void> {
  await writeJsonAtomic(manifestFile(repoRoot, component.slug), {
    hash: mapPictureHash(repoRoot, component, environment)
  } satisfies Manifest);
}

export type MapPictureInput = {
  repoRoot: string;
  /** The environment as previews are asked through it. */
  environment: RepoEnvironment;
  recipe: Recipe | null;
  component: MapComponent;
  devUrl: string;
  browser: string;
  take: typeof takeScreenshot;
  check?: typeof askPreview;
};

/**
 * A map component's picture at each viewport, unless the ones it has are kept: through a pointer
 * to its file under MAP_PICTURES_PAGE, left there until clearMapPictures. Skipped for one the map
 * says does not render alone, or that the recipe cannot point at.
 */
export async function takeMapPictures(input: MapPictureInput): Promise<TakeResult> {
  const { repoRoot, environment, component } = input;
  if (await mapPicturesKept(repoRoot, component, environment)) return 'kept';
  const pointer = input.recipe?.pointer;
  if (!pointer || component.alone === 'no') return 'skipped';
  let fixture: string | null = null;
  if (component.fixture) {
    try {
      fixture = fs.readFileSync(disk(repoRoot, component.fixture), 'utf8');
    } catch {
      return 'failed';
    }
  }
  const folder = iterationDir(MAP_PICTURES_PAGE, component.slug, ITERATION);
  const files = pointer(component, { iterationDir: folder, fixture });
  if (!files) return 'skipped';
  writeFiles(repoRoot, folder, files);
  syncIterations(repoRoot, environment);
  const url = previewUrl(input.devUrl, MAP_PICTURES_PAGE, component.slug, ITERATION, environment);
  const answer = await (input.check ?? askPreview)(url);
  if (previewProblem(url, input.devUrl, answer)) return 'failed';
  for (const viewport of environment.viewports) {
    const file = disk(repoRoot, mapScreenshotPath('component', component.slug, viewport.name));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ok = await input.take({
      browser: input.browser,
      url,
      file,
      size: viewport,
      overlays: environment.overlays,
      variant: null
    });
    if (!ok) return 'failed';
  }
  await recordMapPictures(repoRoot, component, environment);
  return 'taken';
}

/** Takes the pointers away once the queue has nothing more to picture. */
export function clearMapPictures(repoRoot: string, environment: RepoEnvironment): void {
  const folder = path.join(repoRoot, ROUGH_DIR, MAP_PICTURES_PAGE);
  if (!fs.existsSync(folder)) return;
  fs.rmSync(folder, { recursive: true, force: true });
  syncIterations(repoRoot, environment);
}
