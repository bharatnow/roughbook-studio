// In-tree placement (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 25): a stack that compiles nothing
// outside its own source tree sees the iterations through a mirror of rough/ at the path the
// environment's `placement` names, inside a debug-only source set, target or folder the setup run
// made, which the production build leaves out. rough/ stays the record; the studio copies each
// iteration folder into the mirror as it is and takes out what rough/ no longer has. The mirror is
// excluded everywhere else: the environment's ignore list (snapshots and the watcher), .gitignore,
// and the production build, which doctor's gate proves.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import { recipeOf } from '../recipes/index.js';
import { ITERATION, SLUG, listIterations } from './iterations.js';
import { ROUGH_DIR } from './root.js';

/** At the mirror's root: the studio's mark, so it never empties a folder it did not make. */
export const MIRROR_MARK = '.roughbook-mirror';

const MARK_TEXT = `Written by Roughbook: a mirror of the iterations in ${ROUGH_DIR}/, for a build that compiles
nothing outside its own source tree. Do not edit it; edit ${ROUGH_DIR}/. It is never committed.
`;

/** An iteration's kept base (src/runs/base.ts), named here so the mirror needs nothing of runs/. */
const KEPT_BASE = '.base';

export type MirrorResult = { mirror: string; written: number; removed: number };

/** A folder's files, less an iteration's kept base, which a build must never compile (B3). */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory() && relative === KEPT_BASE) return [];
    if (entry.isDirectory()) return filesUnder(path.join(dir, entry.name), `${relative}/`);
    return entry.isFile() ? [relative] : [];
  });
}

function folders(dir: string, valid: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && valid.test(entry.name))
    .map(entry => entry.name);
}

/**
 * Brings the mirror to rough/'s iterations: every iteration folder copied in at
 * `<mirror>/<page>/<component>/<iteration>/`, files written only where they differ (so a build's
 * up-to-date checks hold), and every iteration, component or page folder rough/ no longer has
 * taken out. Files at the mirror's own root, such as a registry a recipe writes there, are left.
 * Null when the environment places iterations in rough/ alone.
 */
export function syncMirror(repoRoot: string, environment: RepoEnvironment): MirrorResult | null {
  if (environment.placement.kind !== 'in-tree') return null;
  const relative = environment.placement.path;
  const mirror = path.join(repoRoot, ...relative.split('/'));
  const mark = path.join(mirror, MIRROR_MARK);
  if (fs.existsSync(mirror) && !fs.existsSync(mark) && fs.readdirSync(mirror).length) {
    throw new Error(
      `${relative}/ already holds files the studio did not write, so it cannot be the mirror of ${ROUGH_DIR}/. Name an empty folder in placement (rough/environment.md).`
    );
  }
  fs.mkdirSync(mirror, { recursive: true });
  if (!fs.existsSync(mark)) fs.writeFileSync(mark, MARK_TEXT);
  let written = 0;
  let removed = 0;
  const keys = new Set(listIterations(repoRoot, environment.entry));
  for (const key of keys) {
    const source = path.join(repoRoot, ROUGH_DIR, ...key.split('/'));
    const target = path.join(mirror, ...key.split('/'));
    const wanted = new Set(filesUnder(source));
    for (const file of wanted) {
      const from = path.join(source, ...file.split('/'));
      const to = path.join(target, ...file.split('/'));
      const bytes = fs.readFileSync(from);
      if (fs.existsSync(to) && fs.readFileSync(to).equals(bytes)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes);
      written += 1;
    }
    for (const file of filesUnder(target)) {
      if (wanted.has(file)) continue;
      fs.rmSync(path.join(target, ...file.split('/')), { force: true });
      removed += 1;
    }
  }
  for (const page of folders(mirror, SLUG)) {
    for (const component of folders(path.join(mirror, page), SLUG)) {
      for (const iteration of folders(path.join(mirror, page, component), ITERATION)) {
        if (keys.has(`${page}/${component}/${iteration}`)) continue;
        fs.rmSync(path.join(mirror, page, component, iteration), { recursive: true, force: true });
        removed += 1;
      }
      if (!fs.readdirSync(path.join(mirror, page, component)).length) {
        fs.rmSync(path.join(mirror, page, component), { recursive: true, force: true });
      }
    }
    if (!fs.readdirSync(path.join(mirror, page)).length) {
      fs.rmSync(path.join(mirror, page), { recursive: true, force: true });
    }
  }
  return { mirror: relative, written, removed };
}

/**
 * Brings everything that shows the iterations up to date after they change: the in-tree mirror,
 * then the recipe's own preview setup (a registry of iterations), which may list the mirror's.
 */
export function syncIterations(repoRoot: string, environment: RepoEnvironment): void {
  syncMirror(repoRoot, environment);
  recipeOf(environment)?.syncPreview(repoRoot);
}

/**
 * The key as a dotted module path, for a stack whose files name their own package: hyphens become
 * underscores, and a part that starts with a digit gets one before it. `home/hero/iteration-01`
 * is `home.hero.iteration_01`.
 */
export function moduleOf(key: string): string {
  return key
    .split('/')
    .map(part => part.replace(/-/g, '_').replace(/^(\d)/, '_$1'))
    .join('.');
}
