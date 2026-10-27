import fs from 'node:fs';
import path from 'node:path';
import { defaultEnvironment } from '../environment/read.js';
import { currentOs, hostPlatform, type StudioOs } from '../launch/platform.js';
import { ROUGH_DIR, STATE_DIR } from '../repo/root.js';
import { isBasePath } from './base.js';

/** Folders whose churn means nothing to any repo: the studio's own state and screenshots. */
const IGNORED = [`${ROUGH_DIR}/${STATE_DIR}/`, `${ROUGH_DIR}/.screenshots/`];

/**
 * A watcher's file name as a repo-relative path with forward slashes, or null to ignore it: the
 * studio's state, the folders the environment ignores (dependencies, git itself, build output),
 * and the iterations' kept bases.
 */
export function watchedPath(
  filename: string | Buffer | null,
  ignore: string[] = defaultEnvironment().ignore
): string | null {
  if (!filename) return null;
  const file = String(filename).replace(/\\/g, '/');
  const folders = [...IGNORED, ...ignore.map(dir => `${dir.replace(/\/+$/, '')}/`)];
  if (folders.some(prefix => file.startsWith(prefix) || `${file}/` === prefix)) return null;
  // An iteration's kept base is the app as it was at a fork: nothing to reload or retake (B3).
  if (isBasePath(file)) return null;
  return file;
}

/** `fs.watch` as the watcher calls it; a test passes one that records what is watched. */
export type WatchFunction = (
  target: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | Buffer | null) => void
) => fs.FSWatcher;

/**
 * Calls `onChange` with each file written under rough/ while the UI is open: the iterations and
 * rough/environment.md are all the studio reacts to. Nothing else in the repo is watched, not
 * the app, its dependencies or its build output, whose watches the app's own dev server needs
 * (on Linux they are a per-user limit, 8192 on kernels before 5.11). Returns a function that
 * stops watching.
 */
export function watchRepo(
  repoRoot: string,
  onChange: (file: string) => void,
  ignore: string[] = defaultEnvironment().ignore,
  options: { os?: StudioOs; watch?: WatchFunction } = {}
): () => void {
  const watch: WatchFunction =
    options.watch ?? ((target, settings, listener) => fs.watch(target, settings, listener));
  const rough = path.join(repoRoot, ROUGH_DIR);
  const os = options.os ?? currentOs(hostPlatform());
  if (os !== 'macos' && os !== 'windows') {
    return watchFolders(rough, ROUGH_DIR, file => watchedPath(file, ignore), onChange, watch);
  }
  // macOS and Windows watch a tree natively, in one watch.
  let watcher: fs.FSWatcher;
  try {
    watcher = watch(rough, { recursive: true }, (_event, filename) => {
      const file = filename ? watchedPath(`${ROUGH_DIR}/${String(filename)}`, ignore) : null;
      if (file) onChange(file);
    });
  } catch {
    // Some file systems cannot be watched; the snapshot still catches every write.
    return () => {};
  }
  watcher.on('error', () => watcher.close());
  return () => watcher.close();
}

/**
 * A file of the app the map's sync reacts to (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md, decision 62),
 * repo-relative with forward slashes, or null: anything in rough/, in a folder the environment
 * ignores (dependencies, git itself, build output) or hidden, or of a kind that is no source.
 */
export function appPath(
  filename: string | Buffer | null,
  ignore: string[],
  sources: string[]
): string | null {
  if (!filename) return null;
  const file = String(filename).replace(/\\/g, '/');
  const parts = file.split('/');
  if (parts[0] === ROUGH_DIR || parts.some(part => part.startsWith('.') && part.length > 1)) {
    return null;
  }
  const folders = ['node_modules/', ...ignore.map(dir => `${dir.replace(/^\.?\/+|\/+$/g, '')}/`)];
  if (folders.some(prefix => file.startsWith(prefix) || `${file}/` === prefix)) return null;
  const name = parts.at(-1)!;
  return sources.some(ext => name.endsWith(ext)) ||
    /^(tsconfig|jsconfig|package)[^/]*\.json$/.test(name)
    ? file
    : null;
}

/**
 * Calls `onChange` with each source file of the app that changes while `roughbook start` runs, for
 * the map's sync: the repo in one watch on macOS and Windows, which watch a tree natively, and on
 * Linux one per folder that is not ignored, as rough/ is watched, so the app's dependencies and
 * build output cost no watch. Returns a function that stops watching.
 */
export function watchApp(
  repoRoot: string,
  onChange: (file: string) => void,
  environment: { ignore: string[]; sources: string[] },
  options: { os?: StudioOs; watch?: WatchFunction } = {}
): () => void {
  const watch: WatchFunction =
    options.watch ?? ((target, settings, listener) => fs.watch(target, settings, listener));
  const os = options.os ?? currentOs(hostPlatform());
  const pick = (file: string) => appPath(file, environment.ignore, environment.sources);
  if (os !== 'macos' && os !== 'windows') {
    // A folder is followed unless it is skipped: any file path under it would be.
    const folder = (file: string) =>
      appPath(
        `${file}/x${environment.sources[0] ?? '.ts'}`,
        environment.ignore,
        environment.sources
      );
    return watchFolders(
      repoRoot,
      '',
      file => pick(file) ?? (folder(file) ? file : null),
      onChange,
      watch,
      pick
    );
  }
  let watcher: fs.FSWatcher;
  try {
    watcher = watch(repoRoot, { recursive: true }, (_event, filename) => {
      const file = filename ? pick(String(filename)) : null;
      if (file) onChange(file);
    });
  } catch {
    // Some file systems cannot be watched; `roughbook map` and the next start still map.
    return () => {};
  }
  watcher.on('error', () => watcher.close());
  return () => watcher.close();
}

/**
 * One watch per folder under `root` (`prefix` its repo path), never inside one `keep` refuses,
 * each new folder watched as it appears; `report` says which files are told, `keep` by default.
 * Node's recursive watch on Linux walks the whole tree as it starts and opens a watch per file
 * and per folder.
 */
function watchFolders(
  root: string,
  prefix: string,
  keep: (file: string) => string | null,
  onChange: (file: string) => void,
  watch: WatchFunction,
  report: (file: string) => string | null = keep
): () => void {
  const watchers = new Map<string, fs.FSWatcher>();
  let stopped = false;
  const relative = (target: string): string =>
    [prefix, ...path.relative(root, target).split(path.sep)].filter(Boolean).join('/');
  const repoPath = (target: string): string | null => keep(relative(target));
  const forget = (dir: string) => {
    for (const [watched, watcher] of watchers) {
      if (watched === dir || watched.startsWith(`${dir}${path.sep}`)) {
        watcher.close();
        watchers.delete(watched);
      }
    }
  };
  // `fresh`: a folder that appeared while watching, whose files may predate its watch.
  const add = (dir: string, fresh: boolean) => {
    if (stopped || watchers.has(dir)) return;
    let watcher: fs.FSWatcher;
    try {
      watcher = watch(dir, { recursive: false }, (_event, name) => {
        if (!name) return;
        const target = path.join(dir, String(name));
        const file = repoPath(target);
        if (!file) return;
        if (report(file)) onChange(file);
        try {
          if (fs.lstatSync(target).isDirectory()) add(target, true);
        } catch {
          forget(target);
        }
      });
    } catch {
      return;
    }
    watcher.on('error', () => forget(dir));
    watchers.set(dir, watcher);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      const file = repoPath(target);
      if (!file) continue;
      if (entry.isDirectory()) add(target, fresh);
      else if (fresh && report(file)) onChange(file);
    }
  };
  add(root, false);
  return () => {
    stopped = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
