import { readJson, writeJsonAtomic } from '../fs/json.js';
import { LINK_FILE, roughPath, statePath } from './root.js';

/**
 * `rough/roughbook.json`: which project this repo works on. Committed with `rough/`, so a
 * teammate's clone knows its project; it holds ids and settings, never a path or a person.
 */
export type RepoLink = {
  version: 1;
  orgId: string;
  /** The project's slug. */
  project: string;
  roughCommitted: boolean;
  /** The App Router folder previews render through, or null when the repo has none. */
  appDir: string | null;
};

/** `rough/.roughbook/link.json`: this machine's link record on the server. Never committed. */
export type LocalLink = { linkId: string; installId: string; linkedAt: string };

export async function readRepoLink(repoRoot: string): Promise<RepoLink | null> {
  const link = await readJson<RepoLink>(roughPath(repoRoot, LINK_FILE));
  if (!link) return null;
  if (link.version !== 1 || !link.orgId || !link.project) {
    throw new Error(
      `rough/${LINK_FILE} is not one this studio can read. Run roughbook init again.`
    );
  }
  return link;
}

/** Ensures the linked repo's link file reads, for commands that need its project. */
export async function requireRepoLink(repoRoot: string): Promise<RepoLink> {
  const link = await readRepoLink(repoRoot);
  if (!link) throw new Error('This repo is not linked. Run roughbook init.');
  return link;
}

export function renderRepoLink(link: RepoLink): string {
  return `${JSON.stringify(link, null, 2)}\n`;
}

export async function readLocalLink(repoRoot: string): Promise<LocalLink | null> {
  return readJson<LocalLink>(statePath(repoRoot, 'link.json'));
}

export async function writeLocalLink(repoRoot: string, link: LocalLink): Promise<void> {
  await writeJsonAtomic(statePath(repoRoot, 'link.json'), link);
}
