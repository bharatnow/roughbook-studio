// What hangs on a component follows it when the map finds it moved, renamed, gone or back (B7 of
// ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 63 and 64). Its baseline is a pointer to the real file,
// so it is pointed at the new one, or, while the file is gone, it becomes a placeholder saying so,
// and the previews keep working. A fork's kept base names the app's files by their repository
// paths, which a promote writes back to, so a moved file's entry and its kept copy move with it.
// The in-page switch's files are the recipe's, written again from the map by its sync.
import fs from 'node:fs';
import path from 'node:path';
import type { Recipe } from '../recipes/types.js';
import { ITERATION, SLUG } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { BASE_DIR, BASE_FILE, readBase, type BaseRecord } from '../runs/base.js';
import { PLACEHOLDER_LINE } from '../runs/placeholder.js';
import { BASELINE } from './adopt.js';
import type { Renamed } from './build.js';
import type { MapComponent } from './types.js';

/** What a gone component's baseline says, in place of the recipe's "not yet generated". */
export const GONE_LINE =
  'Gone from the app: the component this baseline showed is no longer in it. Its iterations are kept in rough/.';

/** The baseline's entry of a component gone from the app: the recipe's placeholder, saying so. */
export function gonePointer(recipe: Recipe, entry: string, key: string): string {
  return recipe.placeholder(entry, key).replace(PLACEHOLDER_LINE, GONE_LINE);
}

/** The pages in rough/ that have work on a component, by its slug: `rough/<page>/<slug>/`. */
export function workOn(repoRoot: string): Map<string, string[]> {
  const pages = new Map<string, string[]>();
  const rough = path.join(repoRoot, ROUGH_DIR);
  for (const page of folders(rough).filter(name => SLUG.test(name))) {
    for (const slug of folders(path.join(rough, page)).filter(name => SLUG.test(name))) {
      pages.set(slug, [...(pages.get(slug) ?? []), page]);
    }
  }
  return pages;
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

function readFile(repoRoot: string, relative: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, ...relative.split('/')), 'utf8');
  } catch {
    return null;
  }
}

function writeFile(repoRoot: string, relative: string, text: string): void {
  const file = path.join(repoRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export type Followed = {
  /** The files written, repo-relative. */
  written: string[];
  /** Baselines left as they were: their entry is neither the studio's pointer nor its placeholder. */
  left: string[];
};

/**
 * Points each baseline of a renamed or returned component at its file now, and each of a gone
 * one at the placeholder. Only an entry the studio wrote is rewritten: the pointer to where the
 * component was, or the gone placeholder; anything else is left, and listed.
 */
export function followBaselines(
  repoRoot: string,
  recipe: Recipe | null,
  entry: string,
  changes: { renamed: Renamed[]; went: MapComponent[]; returned: MapComponent[] }
): Followed {
  const result: Followed = { written: [], left: [] };
  if (!recipe?.pointer) return result;
  const pages = workOn(repoRoot);
  // With the folder's own fixture, as the baseline was written: a pointer can take its keys.
  const fixture = recipe.environment(null).fixture;
  const pointerOf = (component: MapComponent, folder: string) =>
    recipe.pointer!(component, {
      iterationDir: folder,
      fixture: fixture ? readFile(repoRoot, `${folder}/${fixture}`) : null
    })?.[entry] ?? null;
  const rewrite = (component: MapComponent, before: MapComponent | null, gone: boolean) => {
    for (const page of pages.get(component.slug) ?? []) {
      const folder = `${ROUGH_DIR}/${page}/${component.slug}/${BASELINE}`;
      const file = `${folder}/${entry}`;
      const current = readFile(repoRoot, file);
      if (current === null) continue;
      const placeholder = gonePointer(recipe, entry, `${page}/${component.slug}/${BASELINE}`);
      const next = gone ? placeholder : pointerOf(component, folder);
      // Line endings aside: git may check rough/ out with Windows ones (core.autocrlf).
      const unix = (text: string) => text.replace(/\r\n/g, '\n');
      const same = (text: string | null) => text !== null && unix(text) === unix(current);
      if (next === null || same(next)) continue;
      const ours = same(placeholder) || (before !== null && same(pointerOf(before, folder)));
      if (!ours) {
        result.left.push(`${page}/${component.slug}`);
        continue;
      }
      writeFile(repoRoot, file, next);
      result.written.push(file);
    }
  };
  for (const { before, now } of changes.renamed) rewrite(now, before, false);
  for (const component of changes.returned) {
    if (!changes.renamed.some(item => item.now.slug === component.slug)) {
      rewrite(component, component, false);
    }
  }
  for (const component of changes.went) rewrite(component, component, true);
  return result;
}

/** Where each of a renamed component's files went: the first to the first, the rest by place. */
export function movedFiles(before: string[], now: string[]): Map<string, string> {
  const moves = new Map<string, string>();
  before.forEach((file, index) => {
    const to = index === 0 ? now[0] : before.length === now.length ? now[index] : undefined;
    if (to && to !== file) moves.set(file, to);
  });
  return moves;
}

/**
 * Moves the entries of each fork's kept base that name a renamed component's old files to the new
 * ones, and their copies in `.base/` with them, so a promote writes back to where the component is
 * now (decision 63). The files' hashes stay: they are the app's files as they were at the fork.
 */
export function followForks(repoRoot: string, renamed: Renamed[]): string[] {
  const written: string[] = [];
  const pages = workOn(repoRoot);
  for (const { before, now } of renamed) {
    const moves = movedFiles(before.files, now.files);
    if (!moves.size) continue;
    for (const page of pages.get(now.slug) ?? []) {
      const dir = path.join(repoRoot, ROUGH_DIR, page, now.slug);
      for (const iteration of folders(dir).filter(name => ITERATION.test(name))) {
        const relative = `${ROUGH_DIR}/${page}/${now.slug}/${iteration}`;
        const record = readBase(repoRoot, relative);
        if (!record || !record.files.some(file => moves.has(file.path))) continue;
        const moved: BaseRecord = {
          ...record,
          files: record.files.map(file => {
            const to = moves.get(file.path);
            if (!to) return file;
            const from = path.join(repoRoot, ...`${relative}/${BASE_DIR}/${file.path}`.split('/'));
            const target = path.join(repoRoot, ...`${relative}/${BASE_DIR}/${to}`.split('/'));
            if (fs.existsSync(from) && !fs.existsSync(target)) {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.renameSync(from, target);
              written.push(`${relative}/${BASE_DIR}/${to}`);
            }
            return { ...file, path: to };
          })
        };
        writeFile(repoRoot, `${relative}/${BASE_FILE}`, `${JSON.stringify(moved, null, 2)}\n`);
        written.push(`${relative}/${BASE_FILE}`);
      }
    }
  }
  return written;
}
