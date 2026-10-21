import fs from 'node:fs';
import path from 'node:path';

/** Files larger than this are skipped: a sentinel in a bundle is found long before. */
const READ_LIMIT = 64 * 1024 * 1024;

/**
 * Where the sentinel appears under the build's output folders, repo-relative with forward
 * slashes: proof that something from rough/ reached the production build (decision 11).
 */
export function findSentinel(repo: string, output: string[], sentinel: string): string[] {
  const found: string[] = [];
  const needle = Buffer.from(sentinel);
  const walk = (dir: string, relative: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        try {
          if (fs.statSync(full).size > READ_LIMIT) continue;
          if (fs.readFileSync(full).includes(needle)) found.push(rel);
        } catch {
          // Unreadable: not part of the build we can check.
        }
      }
    }
  };
  for (const folder of output) {
    // `.` is the repo itself, as a site published from its root lists it.
    const clean =
      folder === '.' || folder === './' ? '' : folder.replace(/^\.\//, '').replace(/\/+$/, '');
    walk(path.join(repo, ...clean.split('/')), clean);
  }
  return found.sort();
}
