// The kept browser's profiles: one folder of the studio's own in the OS temp folder, and in it a
// profile for each browser started, beside a record of the studio that made it and the browser
// that uses it. A profile is removed once its browser has exited, but what holds it can outlive
// that (Chrome's crash handler, on Windows), and a studio that is killed never removes it at all;
// so each start also removes the profiles it can prove are stale, and never one in use.
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processRunning } from '../launch/processes.js';

/** What a profile's record says: the studio process that made it, and its browser once started. */
export type ProfileRecord = { studio: number; browser: number | null };

/** A profile this old whose browser's lock is free is stale, whatever its record says. */
const DAY_MS = 24 * 60 * 60_000;

/** Profiles this process's browsers are using, which its own sweep never takes. */
const inUse = new Set<string>();

const recordOf = (profile: string) => `${profile}.json`;

/**
 * The studio's own folder for profiles in the OS temp folder, one per user where that folder is
 * shared; null when it cannot be made, or is not a folder of this user's (a link, or another
 * user's), and profiles then go in the OS temp folder itself, unswept.
 */
export function profilesFolder(tmp: string = os.tmpdir()): string | null {
  const uid = process.getuid?.();
  const folder = path.join(
    tmp,
    uid === undefined ? 'roughbook-browsers' : `roughbook-browsers-${uid}`
  );
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stat = lstatSync(folder);
    return stat.isDirectory() && (uid === undefined || stat.uid === uid) ? folder : null;
  } catch {
    return null;
  }
}

/** Makes a profile for a browser this process starts: its record first, so no sweep takes it. */
export function makeProfile(folder: string | null): string {
  if (!folder) return mkdtempSync(path.join(os.tmpdir(), 'roughbook-shot-'));
  const profile = path.join(folder, randomBytes(6).toString('hex'));
  const record: ProfileRecord = { studio: process.pid, browser: null };
  writeFileSync(recordOf(profile), JSON.stringify(record), { flag: 'wx' });
  mkdirSync(profile);
  inUse.add(profile);
  return profile;
}

/** Notes the browser that uses a profile, so a later sweep can tell when it has gone. */
export function recordBrowser(profile: string, pid: number | undefined): void {
  if (!inUse.has(profile) || pid === undefined) return;
  const record: ProfileRecord = { studio: process.pid, browser: pid };
  try {
    writeFileSync(recordOf(profile), JSON.stringify(record));
  } catch {
    // The record still names this studio, which keeps the profile while it runs.
  }
}

/**
 * Removes a profile whose browser has exited, waiting a few seconds for what still holds its
 * files; false when it is still there, for a later sweep. fs.rmSync would give up at once on
 * Windows, whatever its maxRetries says; fs.promises.rm waits between its tries.
 */
export async function removeProfile(profile: string): Promise<boolean> {
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(recordOf(profile), { force: true });
    return true;
  } catch {
    return false;
  } finally {
    inUse.delete(profile);
  }
}

function readRecord(profile: string): ProfileRecord | null {
  try {
    const record = JSON.parse(readFileSync(recordOf(profile), 'utf8')) as Partial<ProfileRecord>;
    if (typeof record.studio !== 'number') return null;
    return { studio: record.studio, browser: record.browser ?? null };
  } catch {
    return null;
  }
}

function modified(profile: string): number {
  for (const file of [profile, recordOf(profile)]) {
    try {
      return statSync(file).mtimeMs;
    } catch {
      // Not there; the other may be.
    }
  }
  return Date.now();
}

/**
 * Whether a browser holds the profile's lock: on Windows Chrome keeps `lockfile` open and it alone
 * can delete it, elsewhere `SingletonLock` links to the host and process that hold it.
 */
function locked(profile: string): boolean {
  if (process.platform === 'win32') {
    const lock = path.join(profile, 'lockfile');
    if (!existsSync(lock)) return false;
    try {
      rmSync(lock);
      return false;
    } catch {
      return true;
    }
  }
  try {
    const holder = readlinkSync(path.join(profile, 'SingletonLock'));
    const dash = holder.lastIndexOf('-');
    return (
      holder.slice(0, dash) === os.hostname() && processRunning(Number(holder.slice(dash + 1)))
    );
  } catch {
    return false;
  }
}

/**
 * Whether a profile in the studio's folder is stale: every process its record names has ended
 * (for one this process made, its browser), or it is a day old and no browser holds its lock,
 * which also covers a record lost, or a process number reused. Never one in use here.
 */
function isStale(profile: string): boolean {
  if (inUse.has(profile)) return false;
  const record = readRecord(profile);
  if (record) {
    const owners =
      record.studio === process.pid ? [record.browser] : [record.studio, record.browser];
    if (owners.every(pid => pid === null || !processRunning(pid))) return true;
  }
  return Date.now() - modified(profile) > DAY_MS && !locked(profile);
}

/** Removes the stale profiles in the studio's folder, and their records; leaves everything else. */
export async function sweepProfiles(folder: string): Promise<void> {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  const profiles = new Set<string>();
  for (const name of names) {
    const profile = path.join(folder, name.endsWith('.json') ? name.slice(0, -5) : name);
    if (name.endsWith('.json')) profiles.add(profile);
    else {
      try {
        if (lstatSync(profile).isDirectory()) profiles.add(profile);
      } catch {
        // Gone already.
      }
    }
  }
  for (const profile of profiles) {
    if (isStale(profile)) await removeProfile(profile);
  }
}
