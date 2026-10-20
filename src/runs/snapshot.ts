// Enforcement that does not depend on the agent (decision 20 of the split plan): before a run the
// studio records every file in the repo by hash, and after it lists what changed outside the
// run's own folder, the same way whichever agent or editor made the change. Files that had
// uncommitted changes are copied aside first, so a change can be reverted without losing them;
// committed ones are restored from git.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultEnvironment, readEnvironment } from '../environment/read.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { ROUGH_DIR, STATE_DIR, statePath } from '../repo/root.js';
import { assertRunId, listRuns } from './store.js';

/** Never recorded: the studio's own state and screenshots. */
const SKIPPED = [`${ROUGH_DIR}/${STATE_DIR}/`, `${ROUGH_DIR}/.screenshots/`];

/**
 * Whether a file is in a folder the environment ignores: a bare name (`node_modules`) at any
 * depth, a path (`packages/web/dist`) at that place only.
 */
function ignored(file: string, ignore: string[]): boolean {
  const folders = file.split('/').slice(0, -1);
  return ignore.some(entry => {
    const dir = entry.replace(/\/+$/, '');
    return dir.includes('/') ? file.startsWith(`${dir}/`) : folders.includes(dir);
  });
}
/** Larger files are compared by size and modification time instead of read. */
const HASH_LIMIT = 20 * 1024 * 1024;
/** Uncommitted files larger than this, or past the total, are not copied aside. */
const BACKUP_FILE_LIMIT = 5 * 1024 * 1024;
const BACKUP_TOTAL_LIMIT = 50 * 1024 * 1024;

export type Snapshot = {
  createdAt: string;
  /** Whether the repo is a git repository, so committed files can be restored from it. */
  git: boolean;
  /** Repo-relative path → content hash. */
  files: Record<string, string>;
  /** Files with uncommitted changes whose copies are kept beside the snapshot. */
  backedUp: string[];
  /** Files with uncommitted changes too large to keep: changes to them cannot be reverted. */
  notBackedUp: string[];
};

export type Changes = { added: string[]; changed: string[]; removed: string[] };

function git(repoRoot: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      {
        cwd: repoRoot,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'buffer'
      },
      (error, stdout) => resolve(error ? null : stdout.toString('utf8'))
    );
  });
}

function gitBuffer(repoRoot: string, args: string[]): Promise<Buffer | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      {
        cwd: repoRoot,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'buffer'
      },
      (error, stdout) => resolve(error ? null : stdout)
    );
  });
}

function skipped(file: string): boolean {
  return SKIPPED.some(prefix => file.startsWith(prefix));
}

function walk(repoRoot: string, ignore: string[], dir = ''): string[] {
  const absolute = path.join(repoRoot, ...dir.split('/').filter(Boolean));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return ignored(`${relative}/x`, ignore) ? [] : walk(repoRoot, ignore, relative);
    }
    return entry.isFile() ? [relative] : [];
  });
}

/**
 * The repo's files, repo-relative with forward slashes: what git tracks plus what it would add
 * (so .gitignore is respected), or every file outside git; less the folders the environment
 * ignores either way (dependencies, build output), which no repo should commit.
 */
export async function listRepoFiles(
  repoRoot: string,
  ignore: string[] = defaultEnvironment().ignore
): Promise<{ files: string[]; git: boolean }> {
  const listed = await git(repoRoot, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard'
  ]);
  const files =
    listed === null
      ? walk(repoRoot, ignore)
      : [...new Set(listed.split('\0').filter(Boolean))].filter(file =>
          fs.existsSync(path.join(repoRoot, ...file.split('/')))
        );
  return {
    files: files.filter(file => !skipped(file) && !ignored(file, ignore)).sort(),
    git: listed !== null
  };
}

async function hashFile(file: string): Promise<string | null> {
  try {
    const info = await stat(file);
    if (info.size > HASH_LIMIT) return `size:${info.size}:${info.mtimeMs}`;
    return createHash('sha1')
      .update(await readFile(file))
      .digest('hex');
  } catch {
    return null;
  }
}

/** Runs `work` over `items`, a few at a time. */
async function eachLimited<T>(
  items: T[],
  work: (item: T) => Promise<void>,
  limit = 32
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    })
  );
}

/** Every file's hash, now. */
export async function hashRepo(
  repoRoot: string,
  ignore?: string[]
): Promise<{ files: Record<string, string>; git: boolean }> {
  const listing = await listRepoFiles(repoRoot, ignore);
  const files: Record<string, string> = {};
  await eachLimited(listing.files, async file => {
    const hash = await hashFile(path.join(repoRoot, ...file.split('/')));
    if (hash) files[file] = hash;
  });
  return { files, git: listing.git };
}

/** Files git sees as changed, added or untracked: their content exists nowhere else. */
async function uncommitted(repoRoot: string): Promise<string[]> {
  const status = await git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status === null) return [];
  // Porcelain paths start at the top of the git repo, which may be above the app.
  const prefix = ((await git(repoRoot, ['rev-parse', '--show-prefix'])) ?? '').trim();
  const entries = status.split('\0').filter(Boolean);
  const files: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file.startsWith(prefix)) files.push(file.slice(prefix.length));
    // A rename or copy is followed by its old path.
    if (code.includes('R') || code.includes('C')) i++;
  }
  return files.filter(file => !skipped(file));
}

function snapshotDir(repoRoot: string, runId: string): string {
  return statePath(repoRoot, 'snapshots', assertRunId(runId));
}

/** Records the repo before a run; one snapshot can serve several runs started together. */
export async function takeSnapshot(
  repoRoot: string,
  runIds: string[],
  ignore?: string[]
): Promise<Snapshot> {
  const { files, git: isGit } = await hashRepo(repoRoot, ignore);
  const dirty = isGit ? (await uncommitted(repoRoot)).filter(file => file in files) : [];
  const backedUp: string[] = [];
  const notBackedUp: string[] = [];
  let total = 0;
  const copies: string[] = [];
  for (const file of dirty) {
    const size = (await stat(path.join(repoRoot, ...file.split('/')))).size;
    if (size > BACKUP_FILE_LIMIT || total + size > BACKUP_TOTAL_LIMIT) {
      notBackedUp.push(file);
      continue;
    }
    total += size;
    copies.push(file);
    backedUp.push(file);
  }
  const snapshot: Snapshot = {
    createdAt: new Date().toISOString(),
    git: isGit,
    files,
    backedUp,
    notBackedUp
  };
  for (const runId of runIds) {
    const dir = snapshotDir(repoRoot, runId);
    for (const file of copies) {
      const target = path.join(dir, 'files', ...file.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(repoRoot, ...file.split('/')), target);
    }
    await writeJsonAtomic(path.join(dir, 'snapshot.json'), snapshot);
  }
  return snapshot;
}

/**
 * Files the studio itself wrote while runs were going, such as a pulled sketch: recorded in those
 * runs' snapshots as they are now, so their Done does not count them as the agent's. Only what
 * Done will list is recorded: a file the same write hid from git, such as the preview route once
 * init ignores it, leaves the snapshot instead of reading as removed.
 */
export async function recordOwnWrites(
  repoRoot: string,
  runIds: string[],
  files: string[],
  ignore?: string[]
): Promise<void> {
  if (!runIds.length || !files.length) return;
  const listed = new Set((await listRepoFiles(repoRoot, ignore)).files);
  const hashes: Record<string, string> = {};
  for (const file of files.filter(item => listed.has(item))) {
    const hash = await hashFile(path.join(repoRoot, ...file.split('/')));
    if (hash) hashes[file] = hash;
  }
  for (const runId of runIds) {
    const snapshot = await readSnapshot(repoRoot, runId);
    if (!snapshot) continue;
    const kept = Object.fromEntries(
      Object.entries(snapshot.files).filter(([file]) => listed.has(file) || !files.includes(file))
    );
    await writeJsonAtomic(path.join(snapshotDir(repoRoot, runId), 'snapshot.json'), {
      ...snapshot,
      files: { ...kept, ...hashes }
    });
  }
}

/** recordOwnWrites for every run still open in the repo: init's prep, a pull, a promotion. */
export async function recordOwnWritesForOpenRuns(repoRoot: string, files: string[]): Promise<void> {
  const open = (await listRuns(repoRoot)).filter(run => run.status === 'started');
  if (!open.length) return;
  const environment = await readEnvironment(repoRoot);
  await recordOwnWrites(
    repoRoot,
    open.map(run => run.runId),
    files,
    environment.ignore
  );
}

export async function readSnapshot(repoRoot: string, runId: string): Promise<Snapshot | null> {
  return readJson<Snapshot>(path.join(snapshotDir(repoRoot, runId), 'snapshot.json'));
}

export async function removeSnapshot(repoRoot: string, runId: string): Promise<void> {
  await rm(snapshotDir(repoRoot, runId), { recursive: true, force: true });
}

export function compareFiles(
  before: Record<string, string>,
  after: Record<string, string>
): Changes {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [file, hash] of Object.entries(after)) {
    if (!(file in before)) added.push(file);
    else if (before[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(before)) if (!(file in after)) removed.push(file);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

export function allChanged(changes: Changes): string[] {
  return [...changes.added, ...changes.changed, ...changes.removed].sort();
}

export type Revert = 'restored' | 'removed' | 'unchanged' | 'cannot';

/**
 * Puts one file back as the snapshot found it: a file the run created is removed, one with
 * uncommitted changes comes back from its copy, and a committed one from git.
 */
export async function revertFile(repoRoot: string, runId: string, file: string): Promise<Revert> {
  const snapshot = await readSnapshot(repoRoot, runId);
  if (!snapshot) return 'cannot';
  if (file.split('/').includes('..') || path.isAbsolute(file)) return 'cannot';
  const target = path.join(repoRoot, ...file.split('/'));
  const expected = snapshot.files[file];
  if (expected === undefined) {
    if (!fs.existsSync(target)) return 'unchanged';
    await rm(target, { force: true });
    return 'removed';
  }
  if ((await hashFile(target)) === expected) return 'unchanged';
  const candidates: (Buffer | null)[] = [];
  if (snapshot.backedUp.includes(file)) {
    candidates.push(
      await readFile(path.join(snapshotDir(repoRoot, runId), 'files', ...file.split('/')))
    );
  } else if (snapshot.git && !snapshot.notBackedUp.includes(file)) {
    // The committed file as a checkout would write it, line-ending filters and all, or as stored:
    // whichever the snapshot saw. ./ makes the path relative to the app, not the git repo.
    candidates.push(await gitBuffer(repoRoot, ['cat-file', '--filters', `HEAD:./${file}`]));
    candidates.push(await gitBuffer(repoRoot, ['cat-file', 'blob', `HEAD:./${file}`]));
  }
  const content = candidates.find(
    candidate => candidate && createHash('sha1').update(candidate).digest('hex') === expected
  );
  if (!content) return 'cannot';
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return 'restored';
}
