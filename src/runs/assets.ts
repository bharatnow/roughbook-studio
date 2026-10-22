// Assets delivered the way the stack needs them (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 29). A
// live web preview loads the project's asset files from the studio's own address, as before; a
// snapshot tool has no network and a native app bundles what it shows, so on a stack whose
// environment says `assetsCopy: yes` the studio copies every asset file a run's prompt names into
// the iteration's own assets/ folder before the agent starts, where the iteration uses it by name.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { AssetScope } from '../api/types.js';
import type { RepoLink } from '../repo/link.js';

/** Inside an iteration: where its copied asset files go; a library's under library/. */
export const ASSETS_FOLDER = 'assets';

export type NamedAsset = { scope: AssetScope; file: string };

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PART = '[^/\\s)"\'`<>\\]]+';
const PROJECT_URL = new RegExp(`/api/files/project/(${PART})/(${PART})`, 'g');
const LIBRARY_URL = new RegExp(`/api/files/library/(${PART})`, 'g');

function decoded(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/**
 * The asset files a prompt names by their Roughbook addresses (`/api/files/project/<slug>/<file>`
 * and `/api/files/library/<file>`), each once: only this project's, and only plain file names.
 */
export function namedAssets(prompt: string, project: string): NamedAsset[] {
  const found = new Map<string, NamedAsset>();
  for (const match of prompt.matchAll(PROJECT_URL)) {
    const slug = decoded(match[1]!);
    const file = decoded(match[2]!.replace(/[.,;:]+$/, ''));
    if (slug === project && file && FILE_NAME.test(file)) {
      found.set(`project/${file}`, { scope: 'project', file });
    }
  }
  for (const match of prompt.matchAll(LIBRARY_URL)) {
    const file = decoded(match[1]!.replace(/[.,;:]+$/, ''));
    if (file && FILE_NAME.test(file)) found.set(`library/${file}`, { scope: 'library', file });
  }
  return [...found.values()];
}

/** Where one copied asset goes, relative to the iteration's folder. */
export function assetTarget(asset: NamedAsset): string {
  return asset.scope === 'library'
    ? `${ASSETS_FOLDER}/library/${asset.file}`
    : `${ASSETS_FOLDER}/${asset.file}`;
}

/**
 * Copies the asset files a prompt names into the iteration's folder (repo-relative), fetched from
 * Roughbook with the designer's sign-in. A file that cannot be fetched is listed, not fatal: the
 * agent sees it missing, as it would on the web.
 */
export async function copyAssets(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  folder: string,
  prompt: string
): Promise<{ copied: string[]; missing: NamedAsset[] }> {
  const copied: string[] = [];
  const missing: NamedAsset[] = [];
  for (const asset of namedAssets(prompt, link.project)) {
    const relative = assetTarget(asset);
    const file = path.join(repoRoot, ...folder.split('/'), ...relative.split('/'));
    try {
      const bytes = await api.file(link.orgId, link.project, asset.scope, asset.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      copied.push(`${folder}/${relative}`);
    } catch {
      missing.push(asset);
    }
  }
  return { copied, missing };
}
