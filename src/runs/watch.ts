import fs from 'node:fs';
import { ROUGH_DIR, STATE_DIR } from '../repo/root.js';

/** Folders whose churn means nothing: dependencies, git itself, build output, the studio's state. */
const IGNORED = [
  'node_modules/',
  '.git/',
  '.next/',
  '.turbo/',
  `${ROUGH_DIR}/${STATE_DIR}/`,
  `${ROUGH_DIR}/.screenshots/`
];

/** A watcher's file name as a repo-relative path with forward slashes, or null to ignore it. */
export function watchedPath(filename: string | Buffer | null): string | null {
  if (!filename) return null;
  const file = String(filename).replace(/\\/g, '/');
  if (IGNORED.some(prefix => file.startsWith(prefix) || `${file}/` === prefix)) return null;
  return file;
}

/**
 * Calls `onChange` with each file written in the repo while a run is going, so a write outside
 * its folder can be flagged as it happens. The snapshot after the run is still the record; this
 * is only the early warning. Returns a function that stops watching.
 */
export function watchRepo(repoRoot: string, onChange: (file: string) => void): () => void {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(repoRoot, { recursive: true }, (_event, filename) => {
      const file = watchedPath(filename);
      if (file) onChange(file);
    });
  } catch {
    // Some file systems cannot be watched; the snapshot still catches every write.
    return () => {};
  }
  watcher.on('error', () => watcher.close());
  return () => watcher.close();
}
