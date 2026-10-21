import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasProjectMarker } from '../recipes/detect.js';

/** The studio's folder in the client's repo. */
export const ROUGH_DIR = 'rough';
/** Inside `rough/`: which organization and project the repo works on. Committed with `rough/`. */
export const LINK_FILE = 'roughbook.json';
/** Inside `rough/`: runs, snapshots and the outbox. Never committed. */
export const STATE_DIR = '.roughbook';

/** Whether `dir` is the home folder or one of its ancestors: never a repo the studio works in. */
export function isHomeOrAbove(dir: string, home: string = os.homedir()): boolean {
  const inside = path.relative(path.resolve(dir), home);
  return inside === '' || (!inside.startsWith('..') && !path.isAbsolute(inside));
}

/**
 * Walks up from `start` to the first folder `found` accepts. Never past the top of a git repo,
 * and never into the home folder or above it, so a stray file there cannot capture every folder
 * beneath it.
 */
export function searchUp(
  start: string,
  found: (dir: string) => boolean,
  home: string = os.homedir()
): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (isHomeOrAbove(dir, home)) return null;
    if (found(dir)) return dir;
    if (existsSync(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The repo the studio works in: the nearest folder, from `start` upwards, that has
 * `rough/roughbook.json`. Null outside one.
 */
export function findRepoRoot(start: string, home?: string): string | null {
  return searchUp(start, dir => existsSync(path.join(dir, ROUGH_DIR, LINK_FILE)), home);
}

export function roughPath(repoRoot: string, ...parts: string[]): string {
  return path.join(repoRoot, ROUGH_DIR, ...parts);
}

export function statePath(repoRoot: string, ...parts: string[]): string {
  return path.join(repoRoot, ROUGH_DIR, STATE_DIR, ...parts);
}

/**
 * Whether a folder looks like an app the studio can work in: a git repository, or a project
 * manifest the detection table knows (a package.json, a composer.json, a Gemfile, a pubspec, …).
 * Any stack, with or without a package.json (F3 of the frameworks plan).
 */
export function looksLikeApp(dir: string): boolean {
  return existsSync(path.join(dir, '.git')) || hasProjectMarker(dir);
}

/**
 * The app `init` run from `start` means: the nearest folder upwards that looks like an app, within
 * the same git repo. `start` itself when there is none, for checkRepo to refuse.
 */
export function appRoot(start: string, home?: string): string {
  return searchUp(start, looksLikeApp, home) ?? path.resolve(start);
}
