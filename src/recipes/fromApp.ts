// A fork or refine whose parent is the app's own component (B3 of ROUGHBOOK-BROWNFIELD-PLAN.md,
// decisions 9 and 32): the component's own files, the ones the map lists, are copied into the new
// iteration and laid out as the recipe's entry needs, so the copy renders exactly as the baseline's
// pointer does before anything changes. Everything else the copy uses stays the app's: its
// relative imports are rewritten to point back at the real files. The recipes' `fromApp` hooks are
// built from the helpers here.
import path from 'node:path';
import type { MapComponent } from '../map/types.js';

/** What a recipe's `fromApp` makes: the iteration's files, and where each of the app's files went. */
export type AppCopy = {
  /** The new iteration's files, by their paths in its folder: the copies, the entry, the fixture. */
  files: Record<string, string>;
  /** Each of the component's files, by repository path, and its copy's path in the folder. */
  copies: Record<string, string>;
};

/** What a recipe's `fromApp` is given beside the component. */
export type AppCopyInput = {
  /** The new iteration's folder, repo-relative. */
  iterationDir: string;
  /** The baseline's fixture file's text, carried over; null when it has none. */
  fixture: string | null;
  /** A file of the app as it is now, repo-relative; null when it cannot be read. */
  read(file: string): string | null;
};

/** The extensions of the modules whose relative imports are rewritten. */
export const MODULE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts|vue)$/;

/** Extensions a module specifier may leave out, in the order bundlers try them. */
const RESOLVED = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.json'];

/**
 * Where each of the component's files goes in the iteration: by its own name, then with its folder's
 * name before it, then numbered, never on one of the `reserved` names (the entry, the fixture).
 * `keep` names a file that goes to a name of its own choosing.
 */
export function layOut(
  files: string[],
  reserved: string[],
  keep: Record<string, string> = {}
): Record<string, string> {
  const taken = new Set([...reserved, ...Object.values(keep)].map(name => name.toLowerCase()));
  const placed: Record<string, string> = { ...keep };
  for (const file of files) {
    if (placed[file]) continue;
    const base = path.posix.basename(file);
    const folder = path.posix.basename(path.posix.dirname(file));
    const tries = [base, ...(folder && folder !== '.' ? [`${folder}-${base}`] : [])];
    let name = tries.find(item => !taken.has(item.toLowerCase()));
    for (let n = 2; !name; n++) {
      if (!taken.has(`${n}-${base}`.toLowerCase())) name = `${n}-${base}`;
    }
    taken.add(name.toLowerCase());
    placed[file] = name;
  }
  return placed;
}

const SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+|\bnew\s+URL\s*\(\s*)(["'`])(\.{1,2}\/[^"'`]*)\2/gm;

/**
 * The copied file a resolved specifier names, trying the extensions it may leave out, and a
 * TypeScript file named by its JavaScript extension (`./plan-card.js` for `plan-card.ts`).
 */
function copiedTarget(target: string, copies: Record<string, string>): string | null {
  const typed = /\.(m?)js(x?)$/.exec(target);
  for (const candidate of [
    target,
    ...(typed ? [target.replace(/\.(m?)js(x?)$/, `.$1ts$2`)] : []),
    ...RESOLVED.map(ext => `${target}${ext}`),
    ...RESOLVED.map(ext => `${target}/index${ext}`)
  ]) {
    if (copies[candidate]) return candidate;
  }
  return null;
}

/** A relative specifier from `fromDir` to `to`, both repo-relative, with `./` where it needs one. */
function relativeSpec(fromDir: string, to: string): string {
  const relative = path.posix.relative(fromDir, to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * A copied module's text with each relative import pointed where it must now go: at the copy of a
 * file that was copied too, or back at the app's real file. `file` is the original's repository
 * path, `copies` every copied file's repository path and its path in the iteration folder.
 * Specifiers that are not relative (packages, the app's aliases such as `@/`) are left as written.
 */
export function rewriteImports(
  text: string,
  file: string,
  copies: Record<string, string>,
  iterationDir: string
): string {
  const fromDir = path.posix.dirname(file);
  const copyDir = path.posix.dirname(
    path.posix.join(iterationDir, copies[file] ?? path.posix.basename(file))
  );
  return text.replace(SPECIFIER, (whole, lead: string, quote: string, spec: string) => {
    const [bare, query = ''] = spec.split(/(?=[?#])/, 2) as [string, string?];
    const target = path.posix.normalize(path.posix.join(fromDir, bare));
    const copied = copiedTarget(target, copies);
    let next: string;
    if (copied) {
      // As written: with the extension when the import had one, without when it had none.
      const at = path.posix.join(iterationDir, copies[copied]!);
      const named = copied === target ? at : at.replace(/\.[^./]+$/, '');
      next = relativeSpec(copyDir, named);
    } else {
      next = relativeSpec(copyDir, target);
      // A folder's own import (`./parts/`) keeps its slash.
      if (bare.endsWith('/') && !next.endsWith('/')) next = `${next}/`;
    }
    return `${lead}${quote}${next}${query}${quote}`;
  });
}

/** The component's files as the app has them now, or null when one cannot be read. */
export function readAll(component: MapComponent, input: AppCopyInput): Map<string, string> | null {
  const texts = new Map<string, string>();
  for (const file of component.files) {
    const text = input.read(file);
    if (text === null) return null;
    texts.set(file, text);
  }
  return texts.size ? texts : null;
}

/** Every copy's text, with relative imports rewritten in the modules among them. */
export function copiedFiles(
  texts: Map<string, string>,
  copies: Record<string, string>,
  iterationDir: string,
  rewrite = true
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [file, text] of texts) {
    files[copies[file]!] =
      rewrite && MODULE_FILE.test(file) ? rewriteImports(text, file, copies, iterationDir) : text;
  }
  return files;
}

/** A module specifier for a copy in the iteration's own folder, without a module's extension. */
export function localSpec(copy: string): string {
  return `./${copy.replace(/\.(tsx|ts|jsx|js|mjs|mts)$/, '')}`;
}

/**
 * The files a module at `file` imports by relative path, repository-relative, each resolved as a
 * bundler would, with the extensions a specifier may leave out and a folder's index; `isFile`
 * says what is on disk. Packages and aliases are left out.
 */
export function importedFiles(
  text: string,
  file: string,
  isFile: (file: string) => boolean
): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(SPECIFIER)) {
    const [bare = ''] = match[3]!.split(/[?#]/, 1);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), bare));
    const hit = [
      target,
      ...RESOLVED.map(ext => `${target}${ext}`),
      ...RESOLVED.map(ext => `${target}/index${ext}`)
    ].find(isFile);
    if (hit) found.add(hit);
  }
  return [...found];
}
