// Where iterations live in a repo, whatever its stack: rough/<page>/<component>/iteration-NN/,
// each with the environment's entry file.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from './root.js';

export const ITERATION = /^iteration-\d{2,}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An iteration's folder, relative to the repo, with forward slashes. */
export function iterationDir(page: string, component: string, iteration: string): string {
  return `${ROUGH_DIR}/${page}/${component}/${iteration}`;
}

function subdirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/** Every iteration under rough/<page>/<component>/iteration-NN/ with the entry file, as keys. */
export function listIterations(repo: string, entry: string): string[] {
  const root = path.join(repo, ROUGH_DIR);
  const keys: string[] = [];
  for (const page of subdirs(root).filter(name => SLUG.test(name))) {
    for (const component of subdirs(path.join(root, page)).filter(name => SLUG.test(name))) {
      for (const iteration of subdirs(path.join(root, page, component)).filter(name =>
        ITERATION.test(name)
      )) {
        if (fs.existsSync(path.join(root, page, component, iteration, entry))) {
          keys.push(`${page}/${component}/${iteration}`);
        }
      }
    }
  }
  return keys;
}

/** The keys among `keys` whose iteration holds the environment's fixture file. */
export function listFixtures(repo: string, keys: string[], fixture: string | null): string[] {
  if (!fixture) return [];
  return keys.filter(key => fs.existsSync(path.join(repo, ROUGH_DIR, ...key.split('/'), fixture)));
}
