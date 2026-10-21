import { FAMILIES, type Family } from '../environment/types.js';
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
  /** The folder the recipe's preview setup lives in, or null when the repo has none. */
  appDir: string | null;
  /**
   * The stack's short tokens as detection found them, such as `next-16` and `react-19`, and the
   * family of checks that goes with them (ROUGHBOOK-FRAMEWORKS-PLAN.md, decisions 15 and 23).
   * The same tokens go to the server; nothing else about the repo does. Optional: links made
   * before detection have neither.
   */
  stack?: string[];
  family?: Family;
  /**
   * Agent skills installed where this repo's runs happen, such as design-taste-frontend. Every
   * local prompt names them, below the brief, the Design System and the methods. Optional.
   */
  skills?: string[];
};

const SKILL = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** A stack token: letters, digits, dots and dashes, as the server's validator takes it. */
export const STACK_TOKEN = /^[a-z0-9][a-z0-9.-]{0,31}$/;
export const MAX_STACK_TOKENS = 12;

/** The tokens among `stack` the server accepts, at most twelve, each once. */
export function cleanStack(stack: unknown): string[] {
  if (!Array.isArray(stack)) return [];
  return [
    ...new Set(
      stack.filter((token): token is string => typeof token === 'string' && STACK_TOKEN.test(token))
    )
  ].slice(0, MAX_STACK_TOKENS);
}

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
  const stack = cleanStack(link.stack);
  const family = FAMILIES.includes(link.family as Family) ? link.family : undefined;
  const { skills: _given, stack: _stack, family: _family, ...rest } = link;
  return {
    ...rest,
    ...(stack.length ? { stack } : {}),
    ...(family ? { family } : {}),
    ...(skills.length ? { skills } : {})
  };
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
