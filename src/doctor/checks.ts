// What every doctor check shares, whatever the mode: the checks' names and order, a result, and
// writing doctor's own sample iterations into the repo.
import fs from 'node:fs';
import path from 'node:path';
import type { CheckId, CheckResult } from './types.js';

export const NAMES: Record<CheckId, string> = {
  prerequisites: 'The tools the commands need are here',
  environment: 'The environment reads and its commands are approved',
  app: 'The app answers',
  renders: 'An iteration renders and says so',
  fixture: 'The fixture reaches the iteration',
  'reports-broken': 'A failed iteration is reported',
  'reports-missing': 'A missing iteration is reported',
  screenshots: 'Screenshots come out clean',
  fresh: 'A change shows without a restart',
  gate: 'Nothing reaches production',
  loopback: 'The preview answers this machine only',
  'setup-files': 'The setup files are listed',
  speed: 'The speed budgets hold'
};

/** The same checks in snapshot mode, named for what they prove there. */
export const SNAPSHOT_NAMES: Record<CheckId, string> = {
  ...NAMES,
  app: 'The snapshot command runs',
  renders: 'An iteration renders to images',
  screenshots: 'The images come out at every viewport and variant',
  fresh: 'Only a changed iteration is rendered again',
  loopback: 'Nothing is served to the network'
};

export const ORDER: CheckId[] = [
  'prerequisites',
  'environment',
  'app',
  'renders',
  'fixture',
  'reports-broken',
  'reports-missing',
  'screenshots',
  'fresh',
  'gate',
  'loopback',
  'setup-files',
  'speed'
];

export function result(
  id: CheckId,
  status: CheckResult['status'],
  detail: string,
  fix: string | null = null,
  names: Record<CheckId, string> = NAMES
): CheckResult {
  return { id, name: names[id], status, detail, fix };
}

export function writeFiles(repoRoot: string, folder: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repoRoot, ...folder.split('/'), ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** Every file of a folder with `from` replaced by `to`, so the preview has something to notice. */
export function rewrite(repoRoot: string, folder: string, from: string, to: string): void {
  const dir = path.join(repoRoot, ...folder.split('/'));
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replaceAll(from, to));
  }
}
