import fs from 'node:fs';
import path from 'node:path';
import { searchUp } from './root.js';

/** Checked in this order, since a Next.js or Astro app may also list Vite. */
const FRAMEWORKS: [dependency: string, name: string][] = [
  ['next', 'next'],
  ['astro', 'astro'],
  ['nuxt', 'nuxt'],
  ['@sveltejs/kit', 'sveltekit'],
  ['@remix-run/react', 'remix'],
  ['react-router', 'react-router'],
  ['vite', 'vite']
];

/**
 * The app's framework and major version from package.json, such as `next-16`: what the link
 * records, so ratings can be compared by setup. Null when none is recognized.
 */
export function detectFramework(repo: string): string | null {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const found = FRAMEWORKS.find(([dependency]) => typeof deps[dependency] === 'string');
  if (!found) return null;
  const major = /(\d+)/.exec(deps[found[0]]!)?.[1];
  return major ? `${found[1]}-${major}` : found[1];
}

/**
 * The app `init` run from `start` means: the nearest folder upwards with a package.json, within
 * the same git repo. `start` itself when there is none, for checkRepo to refuse.
 */
export function appRoot(start: string, home?: string): string {
  return (
    searchUp(start, dir => fs.existsSync(path.join(dir, 'package.json')), home) ??
    path.resolve(start)
  );
}
