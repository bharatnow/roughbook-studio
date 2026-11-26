// A fact change in a client's repo (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5, the studio): the places a
// change reaches are found here, from the picked iterations' own files in rough/, with the
// backend's index and finder copied into vendor/; and a swap is a new iteration folder, the pick's
// copy with the words spliced in, which the designer sees in their diff. Nothing read from the
// repo is sent anywhere: the backend gives the context (pages, picks, the site map, the plan and
// the script) and the edits, and gets back only ids and iteration names.
//
// The vendor files are loaded only after the repo's TypeScript is (their tables are built from its
// enums when they are first evaluated), so findLocal and spliceLocal are async.
import fs from 'node:fs';
import path from 'node:path';
import type { Family, PreviewMode } from '../environment/types.js';
import { recipeFor } from '../recipes/index.js';
import { ITERATION, SLUG, iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { loadTypeScript } from './typescript.js';
import type { FactEdit } from './vendor/factChangeApply.js';
import type { FoundPlace } from './vendor/factFind.js';
import type { FactIndexInput } from './vendor/factIndex.js';
import { SHARED_PAGE_SLUG } from './vendor-shims.js';
import type { SitePlan, SiteRecord, SiteScript, SketchFile } from './vendor-shims.js';

export { loadTypeScript } from './typescript.js';
export type { FactEdit, FoundPlace, SitePlan, SiteRecord, SiteScript, SketchFile };

// --- the context -------------------------------------------------------------------------------------

/** A picked section, as the backend's `GET …/facts/context` names it: no files. */
export type FactContextSection = {
  component: string;
  name: string;
  /** The picked iteration, `iteration-NN`. */
  iteration: string;
  /** Kept (X8): changed only for the fact itself, and shown as kept. */
  kept: boolean;
};

export type FactContextPage = {
  slug: string;
  name: string;
  kind: 'page' | 'shared';
  sections: FactContextSection[];
};

/** The backend's `GET …/facts/context` answer: the index's input without files. */
export type FactContext = {
  pages: FactContextPage[];
  siteMap: Pick<SiteRecord, 'nav' | 'links'>;
  plan: SitePlan | null;
  script: SiteScript | null;
};

// --- the section's files -----------------------------------------------------------------------------

/** What the index reads: code and data. `.jsx` and `.js` are read as TSX (see `asIndexed`). */
const READ_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js', '.json']);
/** The fork's kept base (src/runs/base.ts): the app's originals, never the iteration's words. */
const KEPT_BASE = '.base';

function iterationOnDisk(repoRoot: string, page: string, component: string, iteration: string) {
  return path.join(repoRoot, ...iterationDir(page, component, iteration).split('/'));
}

const isIteration = (page: string, component: string, iteration: string) =>
  SLUG.test(page) && SLUG.test(component) && ITERATION.test(iteration);

/** Every file under `dir`, relative with forward slashes, sorted; `skipBase` leaves `.base/` out. */
function filesUnder(dir: string, skipBase: boolean, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (skipBase && relative === KEPT_BASE) return [];
        return filesUnder(path.join(dir, entry.name), skipBase, `${relative}/`);
      }
      return [relative];
    })
    .sort();
}

/**
 * The text files of one iteration the index reads (.tsx .ts .jsx .js .json), with paths relative
 * to the iteration's folder. The kept base (`.base/`) and assets are left out. None when the
 * folder is not in this repo, or the names are not an iteration's.
 */
export function readSectionFiles(
  repoRoot: string,
  page: string,
  component: string,
  iteration: string
): SketchFile[] {
  if (!isIteration(page, component, iteration)) return [];
  const dir = iterationOnDisk(repoRoot, page, component, iteration);
  return filesUnder(dir, true)
    .filter(file => READ_EXTENSIONS.has(path.posix.extname(file).toLowerCase()))
    .map(file => ({
      path: file,
      content: fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8'),
      encoding: 'utf8' as const
    }));
}

/**
 * The index reads .tsx, .ts and .json only, so a .jsx or .js file goes in under a .tsx name (JSX
 * and plain JavaScript parse as TSX), and its places come back under its own name.
 */
const ALIAS = '.tsx';
const needsAlias = (file: string) => /\.(jsx|js)$/i.test(file);
const asIndexed = (file: string) => (needsAlias(file) ? `${file}${ALIAS}` : file);
const fromIndexed = (file: string) =>
  file.endsWith(ALIAS) && needsAlias(file.slice(0, -ALIAS.length))
    ? file.slice(0, -ALIAS.length)
    : file;

// --- the rules, once TypeScript is loaded --------------------------------------------------------------

type Vendor = {
  buildFactIndex: typeof import('./vendor/factIndex.js').buildFactIndex;
  findPlaces: typeof import('./vendor/factFind.js').findPlaces;
  keptSections: typeof import('./vendor/factFind.js').keptSections;
  spliceFiles: typeof import('./vendor/factSplice.js').spliceFiles;
};

let vendor: Promise<Vendor> | null = null;

async function rules(
  repoRoot: string
): Promise<{ ok: true; rules: Vendor } | { ok: false; why: string }> {
  const loaded = loadTypeScript(repoRoot);
  if (!loaded.ok) return loaded;
  vendor ??= Promise.all([
    import('./vendor/factIndex.js'),
    import('./vendor/factFind.js'),
    import('./vendor/factSplice.js')
  ]).then(([index, find, splice]) => ({
    buildFactIndex: index.buildFactIndex,
    findPlaces: find.findPlaces,
    keptSections: find.keptSections,
    spliceFiles: splice.spliceFiles
  }));
  return { ok: true, rules: await vendor };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// --- finding -----------------------------------------------------------------------------------------

export type FindLocalResult =
  | {
      ok: true;
      /** Every place the edits reach, in the index's order, kept sections marked. */
      places: FoundPlace[];
      /** The pages with a place, in the site's order, for the sheet's groups. */
      pages: { slug: string; name: string }[];
      /** Picked iterations not in this repo (`<page>/<component>/<iteration>`): none of their places are found. */
      missing: string[];
    }
  | { ok: false; why: string };

/**
 * The places the edits reach in this repo's picked iterations, as the backend's FactSwapService
 * finds them on the web: buildFactIndex over every picked section's files, then findPlaces with
 * the kept sections marked. A section whose pick is not in rough/ is listed in `missing`.
 */
export async function findLocal(
  repoRoot: string,
  context: FactContext,
  edits: FactEdit[]
): Promise<FindLocalResult> {
  const loaded = await rules(repoRoot);
  if (!loaded.ok) return loaded;
  const { buildFactIndex, findPlaces, keptSections } = loaded.rules;
  const missing: string[] = [];
  const input: FactIndexInput = {
    pages: context.pages.map(page => ({
      slug: page.slug,
      name: page.name,
      kind: page.kind,
      sections: page.sections.map(section => {
        const dir = iterationOnDisk(repoRoot, page.slug, section.component, section.iteration);
        if (!isIteration(page.slug, section.component, section.iteration) || !fs.existsSync(dir)) {
          missing.push(`${page.slug}/${section.component}/${section.iteration}`);
        }
        const files = readSectionFiles(repoRoot, page.slug, section.component, section.iteration);
        return {
          component: section.component,
          name: section.name,
          iteration: section.iteration,
          kept: section.kept,
          files: files.map(file => ({ ...file, path: asIndexed(file.path) }))
        };
      })
    })),
    siteMap: context.siteMap,
    plan: context.plan,
    script: context.script
  };
  let found: FoundPlace[];
  try {
    found = findPlaces(buildFactIndex(input), edits, { kept: keptSections(input) });
  } catch (error) {
    return { ok: false, why: `Fact changes could not read your sections: ${message(error)}` };
  }
  const places = found.map(place => {
    const file = fromIndexed(place.file);
    if (file === place.file) return place;
    const placeId = `${place.page}/${place.section}/${file}:${place.start}`;
    return { ...place, file, placeId, id: `${placeId}|${place.edit}` };
  });
  const names = new Map(context.pages.map(page => [page.slug, page.name]));
  const order = [
    ...new Set([...context.pages.map(page => page.slug), ...places.map(place => place.page)])
  ];
  const pages = order
    .filter(slug => places.some(place => place.page === slug))
    .map(slug => ({
      slug,
      name: names.get(slug) ?? (slug === SHARED_PAGE_SLUG ? 'Shared' : slug)
    }));
  return { ok: true, places, pages, missing };
}

// --- swapping ----------------------------------------------------------------------------------------

/** What a splice needs of a found place. */
export type LocalSplicePlace = Pick<
  FoundPlace,
  'id' | 'page' | 'section' | 'iteration' | 'file' | 'start' | 'end' | 'old' | 'new'
> & { nav?: boolean };

export type SpliceLocalResult =
  | {
      ok: true;
      /** The files the splice changed, repo-relative in the new iteration's folder. */
      files: string[];
      /** Place ids that could not be spliced, for the redraw fallback. */
      leftOver: string[];
    }
  | { ok: false; why: string; leftOver: string[] };

/**
 * A swap as a new iteration: `fromIteration`'s whole folder copied to `toIteration` as a fork
 * copies it (every file, assets and `.base/` included), with the places' new words spliced into
 * its files and each spliced file checked to still parse (spliceFiles' own check). Only the
 * places of this page and section with a file are taken; nav and link labels are the site map's.
 * A place that could not be spliced comes back in `leftOver`; when none could, nothing is
 * written. Writes only inside rough/, and never over an iteration that is there.
 */
export async function spliceLocal(
  repoRoot: string,
  page: string,
  component: string,
  fromIteration: string,
  toIteration: string,
  places: LocalSplicePlace[]
): Promise<SpliceLocalResult> {
  const mine = places.filter(
    place => place.page === page && place.section === component && place.file !== '' && !place.nav
  );
  const all = mine.map(place => place.id);
  const refuse = (why: string): SpliceLocalResult => ({ ok: false, why, leftOver: all });
  if (!isIteration(page, component, fromIteration) || !isIteration(page, component, toIteration)) {
    return refuse(`${page}/${component}/${fromIteration} to ${toIteration} is not an iteration.`);
  }
  const fromRelative = iterationDir(page, component, fromIteration);
  const toRelative = iterationDir(page, component, toIteration);
  if (fromIteration === toIteration) return refuse(`${toRelative} is the iteration it copies.`);
  const from = iterationOnDisk(repoRoot, page, component, fromIteration);
  const to = iterationOnDisk(repoRoot, page, component, toIteration);
  const rough = path.resolve(repoRoot, ROUGH_DIR);
  const inside = path.relative(rough, path.resolve(to));
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    return refuse(`${toRelative} is not inside ${ROUGH_DIR}/.`);
  }
  if (filesUnder(to, false).length) {
    return refuse(`${toRelative} already exists. An existing iteration is never written over.`);
  }
  const copied = filesUnder(from, false);
  if (!copied.length)
    return refuse(`${fromRelative} is not in this repo, so it cannot be changed here.`);

  const stale = mine.filter(place => place.iteration !== fromIteration).map(place => place.id);
  const current = mine.filter(place => place.iteration === fromIteration);
  if (!current.length) return refuse(`None of these places is in ${fromRelative}.`);

  const loaded = await rules(repoRoot);
  if (!loaded.ok) return refuse(loaded.why);
  const sources = readSectionFiles(repoRoot, page, component, fromIteration).map(file => ({
    path: asIndexed(file.path),
    content: file.content
  }));
  let result: ReturnType<Vendor['spliceFiles']>;
  try {
    result = loaded.rules.spliceFiles(
      sources,
      current.map(place => ({ ...place, file: asIndexed(place.file) }))
    );
  } catch (error) {
    return refuse(`The places could not be changed in ${fromRelative}: ${message(error)}`);
  }
  const before = new Map(sources.map(file => [file.path, file.content]));
  const changed = new Map(
    result.files
      .filter(file => before.get(file.path) !== file.content)
      .map(file => [fromIndexed(file.path), file.content])
  );
  const failed = result.failed.map(item => item.placeId);
  const leftOver = [...stale, ...failed.filter(id => !stale.includes(id))];
  if (!changed.size) {
    const why = result.failed[0]?.why ?? 'Nothing in its files says the old words.';
    return refuse(`None of the places could be changed in ${fromRelative}. ${why}`);
  }

  // Written whole or not at all: a folder left half-copied is taken out again.
  try {
    for (const file of copied) {
      const target = path.join(to, ...file.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const text = changed.get(file);
      if (text !== undefined) fs.writeFileSync(target, text);
      else fs.writeFileSync(target, fs.readFileSync(path.join(from, ...file.split('/'))));
    }
  } catch (error) {
    fs.rmSync(to, { recursive: true, force: true });
    return refuse(`${toRelative} could not be written: ${message(error)}`);
  }
  return {
    ok: true,
    files: [...changed.keys()].sort().map(file => `${toRelative}/${file}`),
    leftOver
  };
}

// --- which stacks ------------------------------------------------------------------------------------

/** The stacks fact changes work in: React-like sections the index can read. */
export const FACT_STACKS = ['next', 'vite', 'expo', 'standalone'] as const;
export type FactStack = (typeof FACT_STACKS)[number];

/** What factStackWhy reads of the repo's environment (rough/environment.md). */
export type FactStackEnvironment = { recipe: string | null; mode: PreviewMode; family: Family };

/** The repo's stack among FACT_STACKS, or null when fact changes aren't there for it yet. */
export function factStackOf(environment: FactStackEnvironment): FactStack | null {
  if (environment.family !== 'react-like') return null;
  if (environment.mode === 'standalone') return 'standalone';
  return FACT_STACKS.find(stack => stack === environment.recipe) ?? null;
}

/** Null when fact changes work in this repo's stack; otherwise one sentence saying they don't yet. */
export function factStackWhy(environment: FactStackEnvironment): string | null {
  if (factStackOf(environment)) return null;
  const name =
    environment.mode === 'standalone'
      ? 'standalone HTML sections'
      : (recipeFor(environment.recipe)?.name ?? 'this stack');
  return `Fact changes aren't there yet for ${name}: they work in Next.js, Vite with React, Expo and standalone React sections. Change the words in the section, or draw it again.`;
}
