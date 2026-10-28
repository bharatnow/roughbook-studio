// `roughbook map`'s work, without its words (B1 of the brownfield plan): every discoverer that fits
// the repo's stack, run over its files, their results merged with what the map already says, the
// fixtures the app's stories give written inside rough/, and rough/map.md written. The map runs no
// command of its own (decision 4): the discoverers only read. A refresh (B7, decision 62) reads
// again only the files that changed since, from what the discoverers kept in the studio's state,
// and what hangs on a renamed or gone component follows it (src/map/follow.ts).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { RECIPES, recipeOf } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { buildMap, type Renamed } from './build.js';
import { MAP_FILE, readMap, writeMap } from './file.js';
import { followBaselines, followForks, workOn } from './follow.js';
import { codeShape } from './rename.js';
import type {
  Discovered,
  DiscoverInput,
  DiscoverMemo,
  MapComponent,
  MemoImport,
  RepoMap
} from './types.js';
import { listFiles, readText } from './walk.js';

/**
 * The discoverers that fit a repo: its recipe's, every other recipe's its stack tokens name (a
 * server app whose views are a bundler's pages gets both), and the recipe its family names (a
 * native project that detection gives a family but no recipe), in the launch order.
 */
export function discoverersFor(environment: RepoEnvironment): Recipe[] {
  const own = recipeOf(environment);
  const named = new Set([
    ...environment.stack.map(token => token.split('-')[0]!),
    environment.family
  ]);
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
  /** Each component's code shape, by slug, to know it again when it moves (B7, decision 63). */
  shapes?: Record<string, string[]>;
};

function stateFile(repo: string): string {
  return statePath(repo, 'map.json');
}

/** The discoverers' memos, by recipe: each file's stamp, and the import graph (B7, decision 62). */
function memoFile(repo: string): string {
  return statePath(repo, 'map-memo.json');
}

type KeptMemo = {
  stamps: Record<string, string>;
  /** Each import as `[path, original, external]`, kept short: the graph of a large app is large. */
  imports: Record<string, [string, string | null, 0 | 1][]>;
  decorators?: boolean;
};

type MemoState = { version: 1; recipes: Record<string, KeptMemo> };

async function readMemos(repo: string): Promise<Map<string, DiscoverMemo>> {
  const kept = await readJson<MemoState>(memoFile(repo)).catch(() => null);
  const memos = new Map<string, DiscoverMemo>();
  if (kept?.version !== 1 || !kept.recipes) return memos;
  for (const [id, memo] of Object.entries(kept.recipes)) {
    memos.set(id, {
      stamps: new Map(Object.entries(memo.stamps ?? {})),
      imports: new Map(
        Object.entries(memo.imports ?? {}).map(([file, imports]) => [
          file,
          imports.map(([to, original, external]): MemoImport => ({
            path: to,
            original,
            external: external === 1
          }))
        ])
      ),
      ...(memo.decorators ? { decorators: true } : {})
    });
  }
  return memos;
}

async function writeMemos(repo: string, memos: Map<string, DiscoverMemo>): Promise<void> {
  const recipes: Record<string, KeptMemo> = {};
  for (const [id, memo] of memos) {
    if (!memo.stamps.size && !memo.imports.size) continue;
    recipes[id] = {
      stamps: Object.fromEntries(memo.stamps),
      imports: Object.fromEntries(
        [...memo.imports].map(([file, imports]) => [
          file,
          imports.map(item => [item.path, item.original, item.external ? 1 : 0] as const)
        ])
      ) as KeptMemo['imports'],
      ...(memo.decorators ? { decorators: true } : {})
    };
  }
  await writeJsonAtomic(memoFile(repo), { version: 1, recipes } satisfies MemoState);
}

/** The files whose stamp differs between two readings, or that only one has. */
function differing(before: Map<string, string>, now: Map<string, string>): string[] {
  const files = [...now]
    .filter(([file, stamp]) => before.get(file) !== stamp)
    .map(([file]) => file);
  for (const file of before.keys()) if (!now.has(file)) files.push(file);
  return files;
}

export type MapResult = {
  map: RepoMap;
  /** The map before, or null for a new one. */
  previous: RepoMap | null;
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
  /** Renamed components, their slugs kept (decision 63). */
  renamed: Renamed[];
  /** Components gone from the app now, and those back again (decision 64). */
  went: MapComponent[];
  returned: MapComponent[];
  /** Baselines whose entry was not the studio's, so they were not pointed again: `<page>/<slug>`. */
  left: string[];
};

/**
 * Maps the repo: runs the discoverers, merges with the map already there (keeping what the map
 * run or the designer wrote), writes the fixtures the stories give and rough/map.md, and points
 * what hangs on a renamed, gone or returned component where it is now. With no discoverer for the
 * stack and no map yet, writes nothing and returns null: the map run reads it. Unless `full`, the
 * discoverers read again only what changed since the last map (B7).
 */
export async function mapRepo(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null,
  options: {
    now?: () => number;
    /** Write nothing for an app with no UI the discoverers can see and no map yet (`init`). */
    whenFound?: boolean;
    /** Read every file again, as `roughbook map` and `init` do, rather than what changed. */
    full?: boolean;
    /** Today, `2026-10-27`, for a component that goes now. */
    today?: string;
  } = {}
): Promise<MapResult | null> {
  // The watcher's refresh, `roughbook map` and a promote's finish may map at once.
  return withLock(statePath(repo, 'map'), () => mapLocked(repo, environment, link, options));
}

async function mapLocked(
  repo: string,
  environment: RepoEnvironment,
  link: RepoLink | null,
  options: Parameters<typeof mapRepo>[3] = {}
): Promise<MapResult | null> {
  const now = options.now ?? (() => performance.now());
  const recipes = discoverersFor(environment);
  const previous = readMap(repo);
  const none = { renamed: [], went: [], returned: [], left: [] };
  if (!recipes.length && !previous) return null;
  // A stack no discoverer reads: the map is all the map run's, kept as it wrote it.
  if (!recipes.length && previous) {
    return {
      map: previous.map,
      previous: previous.map,
      by: [],
      changed: false,
      written: true,
      fixtures: [],
      ms: 0,
      ...none
    };
  }
  const input = inputFor(repo, environment, link);
  const memos = options.full || !previous ? new Map<string, DiscoverMemo>() : await readMemos(repo);
  const changedFiles = new Set<string>();
  let everything = Boolean(options.full) || !previous;
  const startedAt = now();
  const found: Discovered[] = [];
  for (const recipe of recipes) {
    const memo = memos.get(recipe.id) ?? { stamps: new Map(), imports: new Map() };
    memos.set(recipe.id, memo);
    if (!memo.stamps.size) everything = true;
    const before = new Map(memo.stamps);
    found.push(await recipe.discover!({ ...input, memo }));
    for (const file of differing(before, memo.stamps)) changedFiles.add(file);
  }
  const ms = Math.round(now() - startedAt);
  const exists = (file: string) => fs.existsSync(path.join(repo, ...file.split('/')));
  const state = previous ? await readJson<MapState>(stateFile(repo)).catch(() => null) : null;
  const shapes = state?.shapes ?? {};
  const shapeOf = (component: { files: string[]; name: string }) => {
    const text = component.files[0] ? readText(repo, component.files[0]) : null;
    return text === null ? null : codeShape(text, component.name);
  };
  const work = workOn(repo);
  const built = buildMap(found, previous?.map ?? null, {
    fixture: environment.fixture,
    exists,
    lastFound: state?.found,
    shapes,
    shapeOf,
    hasWork: slug => work.has(slug),
    ...(options.today ? { today: options.today } : {})
  });
  if (options.whenFound && !previous && !built.map.pages.length && !built.map.components.length) {
    return {
      map: built.map,
      previous: null,
      by: recipes,
      changed: false,
      written: false,
      fixtures: [],
      ms,
      ...none
    };
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
  const followed = followBaselines(repo, recipeOf(environment), environment.entry, built);
  const forks = followForks(repo, built.renamed);
  // A run still open did not write these, so its Done does not count them.
  const own = [...fixtures, ...followed.written, ...forks];
  if (changed || own.length) {
    await recordOwnWritesForOpenRuns(repo, [
      ...(changed ? [`${ROUGH_DIR}/${MAP_FILE}`] : []),
      ...own
    ]);
  }
  // Each component's shape: read again where its file changed or it moved, else as it was.
  const renamedSlugs = new Set(built.renamed.map(item => item.now.slug));
  const nextShapes: Record<string, string[]> = {};
  // Set aside by the name in the code, which the map's own name may not be.
  const codeNames = new Map(
    found.flatMap(result => result.components.map(item => [item.key, item.name] as const))
  );
  for (const component of built.map.components) {
    const kept = shapes[component.slug];
    const stale =
      everything ||
      !kept ||
      renamedSlugs.has(component.slug) ||
      component.files.some(file => changedFiles.has(file));
    const name = codeNames.get(`${component.files[0] ?? ''}#${component.export}`);
    const shape =
      component.gone || !stale || !name ? kept : shapeOf({ files: component.files, name });
    if (shape) nextShapes[component.slug] = shape;
  }
  await writeJsonAtomic(stateFile(repo), {
    fingerprint: sourcesFingerprint(repo, environment, link),
    writtenAt: new Date().toISOString(),
    found: built.found,
    shapes: nextShapes
  } satisfies MapState);
  await writeMemos(repo, memos);
  return {
    map: built.map,
    previous: previous?.map ?? null,
    by: recipes,
    changed,
    written: true,
    fixtures,
    ms,
    renamed: built.renamed,
    went: built.went,
    returned: built.returned,
    left: followed.left
  };
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

/** What a map run found renamed, gone and back, a line each, for the terminal (B7). */
export function describeChanges(
  result: Pick<MapResult, 'renamed' | 'went' | 'returned' | 'left'>
): string[] {
  const where = (component: MapComponent) =>
    `${component.files[0] ?? 'no file'}${component.export === 'default' ? '' : ` (${component.export})`}`;
  const lines: string[] = [];
  for (const { before, now } of result.renamed) {
    lines.push(
      `  ~ ${now.name} (${now.slug}) is now ${where(now)}, was ${where(before)}; its work follows it.`
    );
  }
  for (const component of result.went) {
    lines.push(
      `  - ${component.name} (${component.slug}) is gone from the app; its iterations stay, and its baseline says it is gone.`
    );
  }
  for (const component of result.returned) {
    lines.push(`  + ${component.name} (${component.slug}) is back in the app.`);
  }
  for (const key of result.left) {
    lines.push(
      `  ! ${ROUGH_DIR}/${key}/iteration-00 was left as it is: its entry is not the studio's pointer.`
    );
  }
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
