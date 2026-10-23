import fs from 'node:fs';
import path from 'node:path';
import { defaultEnvironment } from '../environment/read.js';
import { currentOs, hostPlatform, type StudioOs } from '../launch/platform.js';
import { ROUGH_DIR, STATE_DIR } from '../repo/root.js';

/** Folders whose churn means nothing to any repo: the studio's own state and screenshots. */
const IGNORED = [`${ROUGH_DIR}/${STATE_DIR}/`, `${ROUGH_DIR}/.screenshots/`];

/**
 * A watcher's file name as a repo-relative path with forward slashes, or null to ignore it: the
 * studio's state, and the folders the environment ignores (dependencies, git itself, build output).
 */
export function watchedPath(
  filename: string | Buffer | null,
  ignore: string[] = defaultEnvironment().ignore
): string | null {
  if (!filename) return null;
  const file = String(filename).replace(/\\/g, '/');
  const folders = [...IGNORED, ...ignore.map(dir => `${dir.replace(/\/+$/, '')}/`)];
  if (folders.some(prefix => file.startsWith(prefix) || `${file}/` === prefix)) return null;
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
  if (os !== 'macos' && os !== 'windows') return watchFolders(rough, ignore, onChange, watch);
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
 * One watch per folder under rough/, never inside an ignored one, each new folder watched as it
 * appears. Node's recursive watch on Linux walks the whole tree as it starts and opens a watch
 * per file and per folder.
 */
function watchFolders(
  rough: string,
  ignore: string[],
  onChange: (file: string) => void,
  watch: WatchFunction
): () => void {
  const watchers = new Map<string, fs.FSWatcher>();
  let stopped = false;
  const repoPath = (target: string): string | null =>
    watchedPath(
      [ROUGH_DIR, ...path.relative(rough, target).split(path.sep)].filter(Boolean).join('/'),
      ignore
    );
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
        onChange(file);
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
      else if (fresh) onChange(file);
    }
  };
  add(rough, false);
  return () => {
    stopped = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
