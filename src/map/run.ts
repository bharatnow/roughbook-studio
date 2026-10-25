// `roughbook map`'s work, without its words (B1 of the brownfield plan): every discoverer that fits
// the repo's stack, run over its files, their results merged with what the map already says, the
// fixtures the app's stories give written inside rough/, and rough/map.md written. The map runs no
// command of its own (decision 4): the discoverers only read.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { RECIPES, recipeOf } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { buildMap } from './build.js';
import { MAP_FILE, readMap, writeMap } from './file.js';
import type { Discovered, DiscoverInput, RepoMap } from './types.js';
import { listFiles } from './walk.js';

/**
 * The discoverers that fit a repo: its recipe's, and every other recipe's its stack tokens name
 * (a server app whose views are a bundler's pages gets both), in the launch order.
 */
export function discoverersFor(environment: RepoEnvironment): Recipe[] {
  const own = recipeOf(environment);
  const named = new Set(environment.stack.map(token => token.split('-')[0]!));
  return RECIPES.filter(recipe => recipe.discover && (recipe === own || named.has(recipe.id)));
}

function inputFor(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null
): DiscoverInput {
  const recipe = recipeOf(environment);
  return {
    repo,
    ignore: environment.ignore,
    own: [
      ...environment.setupFiles.map(file => file.path),
      ...(recipe && link ? recipe.setupFiles(repo, link) : [])
    ]
  };
}

/**
 * What the app's sources look like now: each file the environment's sources cover, with its size
 * and time, hashed. `start` maps again when it differs from the one the map was written with.
 */
export function sourcesFingerprint(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null
): string {
  const input = inputFor(repo, environment, link);
  const hash = createHash('sha256');
  for (const file of listFiles(input)) {
    if (!environment.sources.some(ext => file.endsWith(ext))) continue;
    try {
      const stat = fs.statSync(path.join(repo, ...file.split('/')));
      hash.update(`${file}\u0000${stat.size}\u0000${stat.mtimeMs}\n`);
    } catch {
      // Gone while it was read: the next look sees it.
    }
  }
  return hash.digest('hex');
}

type MapState = {
  fingerprint: string;
  writtenAt: string;
  /** The sections the discoverers found for each page, by slug, to tell an edit of them by. */
  found?: Record<string, string[]>;
};

function stateFile(repo: string): string {
  return statePath(repo, 'map.json');
}

export type MapResult = {
  map: RepoMap;
  /** The recipes whose discoverers ran. */
  by: Recipe[];
  /** Whether rough/map.md changed. */
  changed: boolean;
  /** Whether rough/map.md is there: not when `whenFound` found nothing. */
  written: boolean;
  /** Fixtures written from the app's stories, repo-relative. */
  fixtures: string[];
  /** How long the discoverers took, in milliseconds. */
  ms: number;
};

/**
 * Maps the repo: runs the discoverers, merges with the map already there (keeping what the map
 * run or the designer wrote), writes the fixtures the stories give and rough/map.md. With no
 * discoverer for the stack and no map yet, writes nothing and returns null: the map run reads it.
 */
export async function mapRepo(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null,
  options: {
    now?: () => number;
    /** Write nothing for an app with no UI the discoverers can see and no map yet (`init`). */
    whenFound?: boolean;
  } = {}
): Promise<MapResult | null> {
  const now = options.now ?? (() => performance.now());
  const recipes = discoverersFor(environment);
  const previous = readMap(repo);
  if (!recipes.length && !previous) return null;
  // A stack no discoverer reads: the map is all the map run's, kept as it wrote it.
  if (!recipes.length && previous) {
    return { map: previous.map, by: [], changed: false, written: true, fixtures: [], ms: 0 };
  }
  const input = inputFor(repo, environment, link);
  const startedAt = now();
  const found: Discovered[] = [];
  for (const recipe of recipes) found.push(await recipe.discover!(input));
  const ms = Math.round(now() - startedAt);
  const exists = (file: string) => fs.existsSync(path.join(repo, ...file.split('/')));
  const state = previous ? await readJson<MapState>(stateFile(repo)).catch(() => null) : null;
  const built = buildMap(found, previous?.map ?? null, {
    fixture: environment.fixture,
    exists,
    lastFound: state?.found
  });
  if (options.whenFound && !previous && !built.map.pages.length && !built.map.components.length) {
    return { map: built.map, by: recipes, changed: false, written: false, fixtures: [], ms };
  }
  const fixtures: string[] = [];
  for (const fixture of built.fixtures) {
    const target = path.join(repo, ...fixture.file.split('/'));
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixture.content);
    fixtures.push(fixture.file);
  }
  const changed = writeMap(repo, built.map, previous?.prose);
  // A run still open did not write these, so its Done does not count them.
  if (changed || fixtures.length) {
    await recordOwnWritesForOpenRuns(repo, [`${ROUGH_DIR}/${MAP_FILE}`, ...fixtures]);
  }
  await writeJsonAtomic(stateFile(repo), {
    fingerprint: sourcesFingerprint(repo, environment, link),
    writtenAt: new Date().toISOString(),
    found: built.found
  } satisfies MapState);
  return { map: built.map, by: recipes, changed, written: true, fixtures, ms };
}

/** Maps the repo again when its sources changed since the map was written; null when they did not. */
export async function refreshMap(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null
): Promise<MapResult | null> {
  if (!readMapSafely(repo)) return null;
  const state = await readJson<MapState>(stateFile(repo)).catch(() => null);
  if (state?.fingerprint === sourcesFingerprint(repo, environment, link)) return null;
  return mapRepo(repo, environment, link);
}

function readMapSafely(repo: string): boolean {
  try {
    return readMap(repo) !== null;
  } catch {
    return false;
  }
}

/** The map in a few lines for the terminal: its pages and their sections, then what was missed. */
export function describeMap(map: RepoMap, options: { pages?: number } = {}): string[] {
  const limit = options.pages ?? 25;
  const names = new Map(map.components.map(item => [item.slug, item.name]));
  const lines: string[] = [];
  for (const page of map.pages.slice(0, limit)) {
    const where = page.address ? ` (${page.address})` : '';
    const sections = page.sections.map(slug => names.get(slug) ?? slug);
    lines.push(
      `  ${page.name}${where}: ${sections.length ? sections.join(', ') : 'no sections found'}`
    );
  }
  if (map.pages.length > limit) lines.push(`  … and ${map.pages.length - limit} more pages.`);
  return lines;
}

/** The map's counts, in a sentence. */
export function countMap(map: RepoMap): string {
  const pages = map.pages.filter(page => page.address !== null).length;
  const cards = map.components.filter(item => item.kind !== 'atom').length;
  const atoms = map.components.length - cards;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `${plural(pages, 'page')}, ${plural(cards, 'section')} and shared part${cards === 1 ? '' : 's'}, ${plural(atoms, 'atom')}`;
}
