import { existsSync } from 'node:fs';
import path from 'node:path';

/** The studio's folder in the client's repo. */
export const ROUGH_DIR = 'rough';
/** Inside `rough/`: which organization and project the repo works on. Committed with `rough/`. */
export const LINK_FILE = 'roughbook.json';
/** Inside `rough/`: runs, snapshots and the outbox. Never committed. */
export const STATE_DIR = '.roughbook';

/**
 * The repo the studio works in: the nearest folder, from `start` upwards, that has
 * `rough/roughbook.json`. Null outside one.
 */
export function findRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ROUGH_DIR, LINK_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function roughPath(repoRoot: string, ...parts: string[]): string {
  return path.join(repoRoot, ROUGH_DIR, ...parts);
}

export function statePath(repoRoot: string, ...parts: string[]): string {
  return path.join(repoRoot, ROUGH_DIR, STATE_DIR, ...parts);
}
