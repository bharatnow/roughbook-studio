// A `roughbook start` that outlived an upgrade (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md, decision 61):
// the studio was installed or built again while it ran, or a newer studio set the repo's preview
// up at a later recipe version. Its own code is then older than what is on disk, so it stops
// writing the generated files (the registries, the switch's files, the map) and says to restart.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** What the running studio was started as: its build's stamp, and the repo's recipe version. */
export type StartedAs = { build: string | null; recipeVersion: number | null };

/**
 * The studio's build as it is on disk now: its package's version and the time this very module
 * was written, which a build or an install rewrites. Null when it cannot be read.
 */
export function studioBuild(
  files: { pkg: string; self: string } = {
    pkg: fileURLToPath(new URL('../../package.json', import.meta.url)),
    self: fileURLToPath(import.meta.url)
  }
): string | null {
  try {
    const { version } = JSON.parse(fs.readFileSync(files.pkg, 'utf8')) as { version?: string };
    return `${version ?? ''}:${fs.statSync(files.self).mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Why a start begun as `started` is stale now, in a phrase, or null while it is not: the studio's
 * build changed, or the repo's recipe version is past both the one it started with and the one
 * this studio writes.
 */
export function staleReason(
  started: StartedAs,
  now: StartedAs,
  ownRecipeVersion: number | null
): string | null {
  if (started.build !== null && now.build !== null && now.build !== started.build) {
    return 'the studio was updated';
  }
  if (
    now.recipeVersion !== null &&
    now.recipeVersion > (started.recipeVersion ?? 0) &&
    now.recipeVersion > (ownRecipeVersion ?? 0)
  ) {
    return `a newer studio set the preview up at version ${now.recipeVersion}`;
  }
  return null;
}

/** What `start` says once, when it notices. */
export function staleWords(reason: string): string {
  return `Roughbook changed while this roughbook start ran: ${reason}. It no longer rewrites the preview's generated files or the map; stop it with Ctrl+C and run roughbook start again.`;
}
