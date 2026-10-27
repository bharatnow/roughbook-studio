// A page's compositions in rough/ (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decision 51): each in
// `rough/<page>/compositions/composition-NN/`, its name, parent and sections in
// `composition.json`, and the page's files as they were when it was saved in `.base/` beside it,
// under their repository paths, with `.base/base.json` naming them, their hashes and the commit
// (decision 31's format). Both are committed with rough/; a composition never changes once saved.
// The checks, the run snapshot, the watcher and the pictures leave `.base/` out, as they do an
// iteration's (`isBasePath`), and nothing of it reaches the server.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../fs/json.js';
import { BASELINE } from '../map/adopt.js';
import type { MapPage } from '../map/types.js';
import { ITERATION, SLUG, iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { BASE_DIR, BASE_FILE, sha256, type BaseFile } from '../runs/base.js';
import {
  COMPOSITION_ID,
  MAX_SECTIONS,
  type Composition,
  type CompositionSection
} from './composition.js';

/** A page's compositions' folder, beside its components' folders. */
export const COMPOSITIONS_DIR = 'compositions';

/** The composition's own file, inside its folder. */
export const COMPOSITION_FILE = 'composition.json';

/** A composition's folder, relative to the repo, with forward slashes. */
export function compositionDir(page: string, id: string): string {
  return `${ROUGH_DIR}/${page}/${COMPOSITIONS_DIR}/${id}`;
}

/** `.base/base.json` of a composition: the page's files as they were when it was saved. */
export type PageBaseRecord = {
  version: 1;
  /** The map's page, by slug. */
  page: string;
  /** The commit the files came from, or null outside git or before the first commit. */
  commit: string | null;
  /** The page's own files, as the map lists them. */
  files: BaseFile[];
};

/** A composition kept in rough/, by page and id. */
export type KeptComposition = {
  page: string;
  id: string;
  number: number;
  composition: Composition;
};

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

function readBytes(repoRoot: string, file: string): Buffer | null {
  if (file.split('/').includes('..') || path.isAbsolute(file)) return null;
  try {
    return fs.readFileSync(toDisk(repoRoot, file));
  } catch {
    return null;
  }
}

function folders(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** A composition.json as it was written, or null when it is not one. */
function asComposition(value: unknown): Composition | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Composition>;
  if (typeof item.name !== 'string' || !Array.isArray(item.sections)) return null;
  if (
    item.parent !== null &&
    (typeof item.parent !== 'string' || !COMPOSITION_ID.test(item.parent))
  ) {
    return null;
  }
  const sections: CompositionSection[] = [];
  for (const section of item.sections as unknown[]) {
    const { component, iteration } = (section ?? {}) as Partial<CompositionSection>;
    if (typeof component !== 'string' || !SLUG.test(component)) return null;
    if (typeof iteration !== 'string' || !ITERATION.test(iteration)) return null;
    sections.push({ component, iteration });
  }
  if (sections.length > MAX_SECTIONS) return null;
  return { name: item.name, parent: item.parent ?? null, sections };
}

/** One composition of a page, or null when it is not in this repo or cannot be read. */
export function readComposition(
  repoRoot: string,
  page: string,
  id: string
): KeptComposition | null {
  if (!SLUG.test(page) || !COMPOSITION_ID.test(id)) return null;
  const bytes = readBytes(repoRoot, `${compositionDir(page, id)}/${COMPOSITION_FILE}`);
  if (!bytes) return null;
  let composition: Composition | null;
  try {
    composition = asComposition(JSON.parse(bytes.toString('utf8')));
  } catch {
    return null;
  }
  return composition
    ? { page, id, number: Number(id.slice('composition-'.length)), composition }
    : null;
}

/** The compositions kept in rough/, of one page or of all, by page then number. */
export function listCompositions(repoRoot: string, page?: string): KeptComposition[] {
  const pages = page
    ? [page]
    : folders(toDisk(repoRoot, ROUGH_DIR)).filter(name => SLUG.test(name));
  const found: KeptComposition[] = [];
  for (const slug of pages) {
    for (const id of folders(toDisk(repoRoot, `${ROUGH_DIR}/${slug}/${COMPOSITIONS_DIR}`))) {
      const kept = readComposition(repoRoot, slug, id);
      if (kept) found.push(kept);
    }
  }
  return found.sort((a, b) => a.page.localeCompare(b.page) || a.number - b.number);
}

/** A composition's `.base/base.json`, or null when it has none or it cannot be read. */
export function readPageBase(repoRoot: string, page: string, id: string): PageBaseRecord | null {
  const bytes = readBytes(repoRoot, `${compositionDir(page, id)}/${BASE_FILE}`);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as PageBaseRecord;
    return parsed && parsed.version === 1 && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The page's sections this repo has no folder for: each section must be an iteration here, with
 * the environment's entry, to be previewed and promoted. Problems in words, or an empty list.
 */
export function missingSections(
  repoRoot: string,
  entry: string,
  page: string,
  sections: CompositionSection[]
): string[] {
  return sections.flatMap(section => {
    const folder = iterationDir(page, section.component, section.iteration);
    if (fs.existsSync(path.join(toDisk(repoRoot, folder), entry))) return [];
    return [
      section.iteration === BASELINE
        ? `${folder} is not in this repo, so ${section.component} cannot show on its baseline: adopt it first (roughbook adopt ${page}/${section.component}).`
        : `${folder} is not in this repo, or has no ${entry}.`
    ];
  });
}

/**
 * Writes a newly numbered composition: its composition.json, then the page's files in `.base/`,
 * byte for byte, and `.base/base.json`. Refuses a folder already there, since a composition never
 * changes once saved, and a page file that is gone.
 */
/** Why the page's files cannot be kept with a composition (one is gone), or null. */
export function pageFilesProblem(repoRoot: string, page: MapPage): string | null {
  const gone = page.files.find(file => !readBytes(repoRoot, file));
  return gone
    ? `${gone} is not in the repo, so the ${page.name} page cannot be kept with its composition. Run roughbook map, then try again.`
    : null;
}

export async function writeComposition(
  repoRoot: string,
  page: MapPage,
  id: string,
  composition: Composition,
  commit: string | null
): Promise<PageBaseRecord> {
  if (!COMPOSITION_ID.test(id)) throw new Error(`${id} is not a composition's id.`);
  const relative = compositionDir(page.slug, id);
  if (fs.existsSync(toDisk(repoRoot, relative))) {
    throw new Error(
      `${relative} is already in this repo, and a composition never changes once saved.`
    );
  }
  const problem = pageFilesProblem(repoRoot, page);
  if (problem) throw new Error(problem);
  const originals = new Map<string, Buffer>();
  for (const file of page.files) originals.set(file, readBytes(repoRoot, file)!);
  const dir = toDisk(repoRoot, relative);
  fs.mkdirSync(dir, { recursive: true });
  const files: BaseFile[] = [];
  for (const [file, bytes] of originals) {
    const target = path.join(dir, BASE_DIR, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    files.push({ path: file, sha256: sha256(bytes), copy: null });
  }
  const record: PageBaseRecord = { version: 1, page: page.slug, commit, files };
  await writeJsonAtomic(toDisk(repoRoot, `${relative}/${BASE_FILE}`), record);
  // Last and whole: a folder lists as a composition once its composition.json is there.
  await writeJsonAtomic(path.join(dir, COMPOSITION_FILE), composition);
  return record;
}
