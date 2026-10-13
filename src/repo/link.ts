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
  /**
   * Agent skills installed where this repo's runs happen, such as design-taste-frontend. Every
   * local prompt names them, below the brief, the Design System and the methods. Optional.
   */
  skills?: string[];
};

const SKILL = /^[a-z0-9][a-z0-9-]{0,59}$/;

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
  // Skill names only, at most ten: never a path or anything else from this machine.
  const skills = Array.isArray(link.skills)
    ? link.skills
        .filter((skill): skill is string => typeof skill === 'string' && SKILL.test(skill))
        .slice(0, 10)
    : [];
  const { skills: _given, ...rest } = link;
  return skills.length ? { ...rest, skills } : rest;
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
