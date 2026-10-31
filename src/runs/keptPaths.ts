// What a stand-in stood for (localPaths.ts), for the words the backend gives back. The record holds
// stand-ins numbered afresh for each request, so this machine keeps each request's paths in
// rough/.roughbook, which is never committed, by the id the backend gave it: a message's request or
// each of its runs. A failure here costs only the path on screen, so it never stops a run or a
// message, and the words show their stand-ins. Nothing here is ever sent.
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { statePath } from '../repo/root.js';
import type { LocalPaths } from './localPaths.js';

/** Each request's or run's stand-ins, and the paths they hold. */
export type KeptPaths = Record<string, Record<string, string>>;

const keptFile = (repoRoot: string) => statePath(repoRoot, 'local-paths.json');

async function change(repoRoot: string, edit: (kept: KeptPaths) => KeptPaths): Promise<void> {
  const file = keptFile(repoRoot);
  await withLock(file, async () => {
    await writeJsonAtomic(file, edit((await readJson<KeptPaths>(file)) ?? {}));
  }).catch(() => undefined);
}

/** Keeps `paths` under each id; words with no path keep nothing. */
export async function keepLocalPaths(
  repoRoot: string,
  ids: string[],
  paths: LocalPaths
): Promise<void> {
  if (!paths.size || !ids.length) return;
  const named = Object.fromEntries(paths);
  await change(repoRoot, kept => ({
    ...kept,
    ...Object.fromEntries(ids.map(id => [id, named]))
  }));
}

/** Everything this machine still holds; an unreadable file holds nothing. */
export async function readKeptPaths(repoRoot: string): Promise<KeptPaths> {
  return (await readJson<KeptPaths>(keptFile(repoRoot)).catch(() => null)) ?? {};
}

/** The paths kept under any of `ids`. */
export function keptPathsOf(kept: KeptPaths, ids: string[]): LocalPaths {
  return new Map(ids.flatMap(id => Object.entries(kept[id] ?? {})));
}

/** Forgets what a deleted line held. */
export async function forgetLocalPaths(repoRoot: string, id: string): Promise<void> {
  await change(repoRoot, kept => {
    const { [id]: _gone, ...rest } = kept;
    return rest;
  });
}
