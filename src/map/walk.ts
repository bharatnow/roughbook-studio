// The repo's files as a discoverer reads them: every file under a folder, repo-relative with
// forward slashes, leaving out what no repo commits (the environment's ignore list), rough/, and
// the preview setup's own files. Reading only.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../repo/root.js';
import type { DiscoverInput } from './types.js';

/** Folders a discoverer never reads, whatever the environment says. */
const ALWAYS_SKIPPED = ['.git', 'node_modules', ROUGH_DIR];

function skipped(relative: string, input: DiscoverInput): boolean {
  const covers = (entry: string) => {
    const clean = entry.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return Boolean(clean) && (relative === clean || relative.startsWith(`${clean}/`));
  };
  const name = relative.split('/').at(-1)!;
  return (
    ALWAYS_SKIPPED.includes(name) ||
    input.ignore.some(entry => covers(entry) || (!entry.includes('/') && entry === name)) ||
    input.own.some(covers)
  );
}

/** Every file under `folder` (repo-relative, `''` for the repo), sorted, as repo-relative paths. */
export function listFiles(input: DiscoverInput, folder = ''): string[] {
  const files: string[] = [];
  const visit = (relative: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(input.repo, ...relative.split('/').filter(Boolean)), {
        withFileTypes: true
      });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (skipped(child, input)) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  if (!folder || isFolder(input.repo, folder)) visit(folder.replace(/\/+$/, ''));
  return files.sort();
}

export function isFolder(repo: string, relative: string): boolean {
  try {
    return fs.statSync(path.join(repo, ...relative.split('/'))).isDirectory();
  } catch {
    return false;
  }
}

/** A repo file's text, or null when it cannot be read. */
export function readText(repo: string, relative: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, ...relative.split('/')), 'utf8');
  } catch {
    return null;
  }
}
