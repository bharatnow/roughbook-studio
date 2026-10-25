// A fork or refine of the app's own component (B3 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 9, 31
// and 32): the slot starts from a copy of the component's real files, laid out by the recipe's
// `fromApp`, never from the baseline's pointer; and the files as they were at that moment are kept
// in the iteration's `.base/`, under their repository paths, with `.base/base.json` naming them,
// their hashes and the commit they came from. `.base/` is committed with rough/ so a teammate's
// clone can promote and merge (B4); the checks, the run snapshot, the watcher, the pictures and
// revert leave it out, and nothing of it reaches the server.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import { BASELINE } from '../map/adopt.js';
import { readMap } from '../map/file.js';
import type { MapComponent } from '../map/types.js';
import { importedFiles, type AppCopy } from '../recipes/fromApp.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';

/** The kept base's folder, inside the iteration's. */
export const BASE_DIR = '.base';

/** The record of what `.base/` holds, inside it. */
export const BASE_FILE = `${BASE_DIR}/base.json`;

/** The stand-ins the backend writes in a fork's or refine's prompt for an `app` parent (B3's contract). */
export const APP_FILES_PLACEHOLDER = '{{roughbook:app-files}}';
export const BASE_PLACEHOLDER = '{{roughbook:base}}';

/** One of the app's files kept in `.base/`: its repository path, its hash, and its copy's path in the iteration. */
export type BaseFile = { path: string; sha256: string; copy: string | null };

/** `.base/base.json`. */
export type BaseRecord = {
  version: 1;
  /** The baseline the iteration started from. */
  parent: string;
  /** The map's component, by slug. */
  component: string;
  /** The commit the files came from, or null outside git or before the first commit. */
  commit: string | null;
  /** The component's own files, as the map lists them. */
  files: BaseFile[];
  /**
   * The iteration's top-level files as the studio wrote them at the fork, with their hashes: what
   * `changed-from-parent` measures the iteration against.
   */
  written: Record<string, string>;
  /** Child components the agent copied in to change them (decision 32), which B4 promotes too. */
  children: BaseFile[];
  /** A radical fork: it started empty, from the placeholder, with no copy of the files. */
  radical?: true;
};

/** What the slot of a fork from the app is made of, planned before anything is written. */
export type AppSlot = {
  component: MapComponent;
  copy: AppCopy;
  /** The originals' bytes, by repository path, as they were read for the copy. */
  originals: Map<string, Buffer>;
};

/** Whether a repo-relative path is inside an iteration's kept base, anywhere under rough/. */
export function isBasePath(file: string): boolean {
  const parts = file.replace(/\\/g, '/').split('/');
  return parts[0] === ROUGH_DIR && parts.slice(1).includes(BASE_DIR);
}

/** Whether a run starts from the app's own component: a fork or refine of a baseline. */
export function fromTheApp(run: { parent: string | null }): boolean {
  return run.parent === BASELINE;
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

/**
 * The slot of a fork or refine from the app, planned from the map's component and the recipe's
 * `fromApp`, with the baseline's fixture carried over. Throws, in words for the designer, when the
 * component cannot be copied here; nothing is written either way.
 */
export function planAppSlot(
  repoRoot: string,
  recipe: Recipe | null,
  environment: Pick<RepoEnvironment, 'fixture'>,
  target: { page: string; component: string; iteration: string },
  options: { radical?: boolean } = {}
): AppSlot {
  const what = `${target.page}/${target.component}`;
  const map = readMap(repoRoot)?.map;
  const component = map?.components.find(item => item.slug === target.component);
  if (!component) {
    throw new Error(
      `${ROUGH_DIR}/map.md has no component ${target.component}, so ${what}/${BASELINE} cannot be copied. Run roughbook map, then try again.`
    );
  }
  // A radical fork copies nothing: the base alone keeps what the app was at the fork.
  if (options.radical) {
    const originals = new Map<string, Buffer>();
    for (const file of component.files) {
      const bytes = readBytes(repoRoot, file);
      if (bytes) originals.set(file, bytes);
    }
    if (!originals.size) {
      throw new Error(
        `${component.files.join(', ') || 'Its files'} not in the repo, so the app's ${what} cannot be kept. Run roughbook map, then try again.`
      );
    }
    return {
      component,
      copy: {
        files: {},
        copies: Object.fromEntries([...originals.keys()].map(file => [file, '']))
      },
      originals
    };
  }
  if (!recipe?.fromApp) {
    throw new Error(
      `${recipe ? `The ${recipe.name} recipe` : 'A setup with no recipe'} cannot copy the app's own component into an iteration yet, so ${what}/${BASELINE} cannot be forked or refined here.`
    );
  }
  const baseline = iterationDir(target.page, target.component, BASELINE);
  const fixtureBytes = environment.fixture
    ? readBytes(repoRoot, `${baseline}/${environment.fixture}`)
    : null;
  const originals = new Map<string, Buffer>();
  const copy = recipe.fromApp(component, {
    iterationDir: iterationDir(target.page, target.component, target.iteration),
    fixture: fixtureBytes ? fixtureBytes.toString('utf8') : null,
    read: file => {
      const bytes = readBytes(repoRoot, file);
      if (bytes) originals.set(file, bytes);
      return bytes ? bytes.toString('utf8') : null;
    }
  });
  if (!copy) {
    const gone = component.files.filter(file => !readBytes(repoRoot, file));
    throw new Error(
      gone.length
        ? `${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} not in the repo, so ${what} cannot be copied. Run roughbook map, then try again.`
        : `${component.name} (${component.export}) cannot be copied into an iteration on this stack, so ${what}/${BASELINE} cannot be forked or refined here.`
    );
  }
  for (const file of Object.keys(copy.copies)) {
    if (!originals.has(file)) {
      const bytes = readBytes(repoRoot, file);
      if (bytes) originals.set(file, bytes);
    }
  }
  return { component, copy, originals };
}

/** The commit HEAD names, or null outside git or before the first commit. */
export function headCommit(repoRoot: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      { cwd: repoRoot, windowsHide: true, timeout: 30_000 },
      (error, stdout) => {
        const commit = String(stdout ?? '').trim();
        resolve(error || !/^[0-9a-f]{7,64}$/.test(commit) ? null : commit);
      }
    );
  });
}

/**
 * Writes a fork's slot from the app into `relative`: the copy as the recipe laid it out, then the
 * originals in `.base/` under their repository paths, byte for byte, and `.base/base.json`.
 */
export function writeAppSlot(
  repoRoot: string,
  relative: string,
  slot: AppSlot,
  base: { parent: string; commit: string | null; empty?: { file: string; content: string } }
): BaseRecord {
  const dir = toDisk(repoRoot, relative);
  const written: Record<string, string> = {};
  // A radical fork starts from the placeholder, as a new direction does.
  const start = base.empty ? { [base.empty.file]: base.empty.content } : slot.copy.files;
  for (const [file, text] of Object.entries(start)) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    if (!file.includes('/')) written[file] = sha256(text);
  }
  const files: BaseFile[] = [];
  for (const [file, copy] of Object.entries(slot.copy.copies)) {
    const bytes = slot.originals.get(file);
    if (!bytes) continue;
    const target = path.join(dir, BASE_DIR, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    files.push({ path: file, sha256: sha256(bytes), copy: base.empty ? null : copy });
  }
  const record: BaseRecord = {
    version: 1,
    parent: base.parent,
    component: slot.component.slug,
    commit: base.commit,
    files,
    written: Object.fromEntries(Object.entries(written).sort(([a], [b]) => a.localeCompare(b))),
    children: [],
    ...(base.empty ? { radical: true as const } : {})
  };
  writeBase(repoRoot, relative, record);
  return record;
}

function writeBase(repoRoot: string, relative: string, record: BaseRecord): void {
  const file = toDisk(repoRoot, `${relative}/${BASE_FILE}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** An iteration's `.base/base.json`, or null when it has none or it cannot be read. */
export function readBase(repoRoot: string, relative: string): BaseRecord | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(toDisk(repoRoot, `${relative}/${BASE_FILE}`), 'utf8')
    ) as BaseRecord;
    return parsed && parsed.version === 1 && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A prompt with the paths the server never sees where the backend left its stand-ins: the
 * component's files by repository path, one per line, and the iteration's `.base/` folder.
 */
export function fillAppStandIns(
  prompt: string,
  record: BaseRecord,
  relative: string,
  placeholders: { appFiles?: string; base?: string } = {}
): string {
  const files = record.files.map(file => file.path).join('\n');
  return prompt
    .replaceAll(placeholders.appFiles ?? APP_FILES_PLACEHOLDER, () => files)
    .replaceAll(placeholders.base ?? BASE_PLACEHOLDER, () => `${relative}/${BASE_DIR}/`);
}

/** Every file in a folder, relative to it with forward slashes, less the kept base. */
function filesOf(dir: string, prefix = ''): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      return relative === BASE_DIR ? [] : filesOf(path.join(dir, entry.name), `${relative}/`);
    }
    return entry.isFile() ? [relative] : [];
  });
}

/** The app's files the originals import by relative path, resolved on disk. */
function importedByOriginals(repoRoot: string, record: BaseRecord, relative: string): string[] {
  const found = new Set<string>();
  const isFile = (file: string) =>
    Boolean(fs.statSync(toDisk(repoRoot, file), { throwIfNoEntry: false })?.isFile());
  for (const file of record.files) {
    const bytes = readBytes(repoRoot, `${relative}/${BASE_DIR}/${file.path}`);
    if (!bytes) continue;
    for (const hit of importedFiles(bytes.toString('utf8'), file.path, isFile)) found.add(hit);
  }
  return [...found];
}

/**
 * Whether `copy` reads as a changed copy of the app's `file` rather than a new file that shares
 * its name: a third or more of the original's lines are in it, however it was changed.
 */
function looksCopied(repoRoot: string, file: string, copy: string): boolean {
  const lines = (relative: string) =>
    new Set(
      (readBytes(repoRoot, relative)?.toString('utf8') ?? '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 2)
    );
  const original = lines(file);
  if (!original.size) return false;
  const copied = lines(copy);
  return [...original].filter(line => copied.has(line)).length * 3 >= original.size;
}

/**
 * Records the child components the agent copied into a fork from the app (decision 32): those it
 * reported, by repository path, and those found without a word: a new file in the iteration named
 * as one of the map's other components' files, or as a file the component imports, that keeps a
 * third or more of the original's lines (a new file of the same name is not a copy). Each is kept in
 * `.base/` as the fork's commit has it (or as it is now, outside git), and listed in
 * `.base/base.json` for B4. Returns the children recorded this time.
 */
export async function recordChildren(
  repoRoot: string,
  run: { page: string; component: string; iteration: string },
  reported: string[] = []
): Promise<BaseFile[]> {
  const relative = iterationDir(run.page, run.component, run.iteration);
  const record = readBase(repoRoot, relative);
  if (!record) return [];
  const own = new Set([
    ...Object.keys(record.written),
    ...record.files.map(file => file.copy),
    ...record.children.map(file => file.copy)
  ]);
  const known = new Set([
    ...record.files.map(file => file.path),
    ...record.children.map(file => file.path)
  ]);
  const fresh = filesOf(toDisk(repoRoot, relative)).filter(file => !own.has(file));
  const byName = new Map<string, string>();
  const name = (file: string) => path.posix.basename(file).toLowerCase();
  for (const file of fresh) byName.set(name(file), file);

  const others = (readMap(repoRoot)?.map.components ?? [])
    .filter(item => item.slug !== record.component)
    .flatMap(item => item.files);
  const candidates = new Map<string, string | null>();
  for (const file of [...others, ...importedByOriginals(repoRoot, record, relative)]) {
    const copy = byName.get(name(file));
    if (copy && !candidates.has(file) && looksCopied(repoRoot, file, `${relative}/${copy}`)) {
      candidates.set(file, copy);
    }
  }
  for (const raw of reported) {
    const file = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!file || file.startsWith(`${ROUGH_DIR}/`) || !readBytes(repoRoot, file)) continue;
    if (!candidates.has(file)) candidates.set(file, byName.get(name(file)) ?? null);
  }

  const added: BaseFile[] = [];
  for (const [file, copy] of candidates) {
    if (known.has(file)) continue;
    const bytes =
      (record.commit ? await committed(repoRoot, record.commit, file) : null) ??
      readBytes(repoRoot, file);
    if (!bytes) continue;
    const target = toDisk(repoRoot, `${relative}/${BASE_DIR}/${file}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    added.push({ path: file, sha256: sha256(bytes), copy });
    known.add(file);
  }
  if (added.length) {
    writeBase(repoRoot, relative, {
      ...record,
      children: [...record.children, ...added].sort((a, b) => a.path.localeCompare(b.path))
    });
  }
  return added;
}

/** A file as `commit` has it, as a checkout writes it, or null when git has no such file there. */
function committed(repoRoot: string, commit: string, file: string): Promise<Buffer | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      ['cat-file', '--filters', `${commit}:./${file}`],
      { cwd: repoRoot, windowsHide: true, timeout: 30_000, encoding: 'buffer' },
      (error, stdout) => resolve(error ? null : stdout)
    );
  });
}
