import fs from 'node:fs';
import { defaultEnvironment } from '../environment/read.js';
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

/**
 * Calls `onChange` with each file written in the repo while a run is going, so a write outside
 * its folder can be flagged as it happens. The snapshot after the run is still the record; this
 * is only the early warning. Returns a function that stops watching.
 */
export function watchRepo(
  repoRoot: string,
  onChange: (file: string) => void,
  ignore: string[] = defaultEnvironment().ignore
): () => void {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(repoRoot, { recursive: true }, (_event, filename) => {
      const file = watchedPath(filename, ignore);
      if (file) onChange(file);
    });
  } catch {
    // Some file systems cannot be watched; the snapshot still catches every write.
    return () => {};
  }
  watcher.on('error', () => watcher.close());
  return () => watcher.close();
}
