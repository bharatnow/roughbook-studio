// What the map's sync tells the server (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 55, 58 and
// 59), for the adopted pages only: each page's sections in the app's order, the sections new to a
// page adopted whole (adopted by themselves, with their baselines), and the slugs of its adopted
// components gone from the app. It goes through `POST …/adopt`, by name, slug and kind as any
// adoption does (decision 7). A page nothing of which is adopted sends nothing (decision 6). What
// could not be sent is kept in the studio's state and sent with the next sync.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { AdoptBody, Adopted } from '../api/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import type { Recipe } from '../recipes/types.js';
import { statePath } from '../repo/root.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { ADOPT_BATCH, BASELINE, ORDER_MAX, writeBaselines, type Baselines } from './adopt.js';
import { workOn } from './follow.js';
import { iterationDir } from '../repo/iterations.js';
import type { MapPage, RepoMap } from './types.js';

export type SyncPage = AdoptBody['pages'][number];

/** `<page>/<component>` of each baseline in rough/. */
export function baselineKeys(repoRoot: string): Set<string> {
  const keys = new Set<string>();
  for (const [slug, pages] of workOn(repoRoot)) {
    for (const page of pages) {
      const folder = path.join(repoRoot, ...iterationDir(page, slug, BASELINE).split('/'));
      if (fs.existsSync(folder)) keys.add(`${page}/${slug}`);
    }
  }
  return keys;
}

/** A page's sections in the app's order, as adoption sends them: no atom, none gone, once each. */
export function appOrder(map: RepoMap, page: MapPage): string[] {
  const bySlug = new Map(map.components.map(component => [component.slug, component]));
  return [...new Set(page.sections)]
    .filter(slug => {
      const component = bySlug.get(slug);
      return component && component.kind !== 'atom' && !component.gone;
    })
    .slice(0, ORDER_MAX);
}

/**
 * What the sync sends for a map that changed from `before` to `after`, given the baselines in
 * rough/: an entry for each page with an adopted component whose order changed, that gained a
 * section while it was adopted whole, or whose adopted components went from the app or came back.
 * A page in `pending` (a sync that could not be sent) is sent as it is now, with all its gone.
 */
export function syncEntries(
  before: RepoMap,
  after: RepoMap,
  baselines: Set<string>,
  pending: Set<string> = new Set()
): SyncPage[] {
  const goneIn = (map: RepoMap, slug: string) =>
    Boolean(map.components.find(component => component.slug === slug)?.gone);
  const entries: SyncPage[] = [];
  for (const page of after.pages) {
    const adopted = new Set(
      after.components
        .map(component => component.slug)
        .filter(slug => baselines.has(`${page.slug}/${slug}`))
    );
    if (!adopted.size) continue;
    const earlier = before.pages.find(item => item.slug === page.slug);
    const order = appOrder(after, page);
    const orderBefore = earlier ? appOrder(before, earlier) : [];
    const again = pending.has(page.slug);
    // Adopted whole: every section it had is adopted, so a new one joins it (decision 59).
    const whole = orderBefore.length > 0 && orderBefore.every(slug => adopted.has(slug));
    const fresh = whole ? order.filter(slug => !adopted.has(slug)) : [];
    const gone = [...adopted].filter(
      slug => goneIn(after, slug) && (again || !goneIn(before, slug))
    );
    // Adopting a component clears its gone mark: one back in the app is adopted again.
    const back = [...adopted].filter(slug => !goneIn(after, slug) && goneIn(before, slug));
    const same = order.join() === orderBefore.join();
    if (!again && same && !fresh.length && !gone.length && !back.length) continue;
    const components = [...fresh, ...back].map(slug => {
      const component = after.components.find(item => item.slug === slug)!;
      return { slug, name: component.name, kind: component.kind };
    });
    entries.push({
      slug: page.slug,
      name: page.name,
      components,
      sections: order,
      ...(gone.length ? { gone: gone.slice(0, ORDER_MAX) } : {})
    });
  }
  return entries;
}

/**
 * The requests the entries are sent in, at most `ADOPT_BATCH` components each; a page with more is
 * split, each part with its order and its gone slugs.
 */
export function syncBodies(entries: SyncPage[], max = ADOPT_BATCH): AdoptBody[] {
  const bodies: AdoptBody[] = [];
  let current: AdoptBody = { pages: [] };
  let count = 0;
  for (const entry of entries) {
    let rest = entry.components;
    do {
      if (count >= max && current.pages.length) {
        bodies.push(current);
        current = { pages: [] };
        count = 0;
      }
      const room = rest.slice(0, max - count);
      current.pages.push({ ...entry, components: room });
      count += room.length;
      rest = rest.slice(room.length);
    } while (rest.length);
  }
  if (current.pages.length) bodies.push(current);
  return bodies;
}

/**
 * `pending`: pages a sync could not send. `synced`: the map as the server last heard it, which
 * the next sync compares with, so a failed one is sent whole later (its new sections too) and a
 * map written with nothing sent (`roughbook map` offline) is caught up.
 */
type SyncState = { pending: string[]; synced?: RepoMap };

function syncFile(repoRoot: string): string {
  return statePath(repoRoot, 'map-sync.json');
}

export type SyncOutcome = {
  /** The page entries sent, or that could not be. */
  entries: SyncPage[];
  /** What the server made of them; null when they could not be sent. */
  adopted: Adopted | null;
  /** The new sections' baselines, written once adopted. */
  baselines: Baselines;
  /** Why the sync could not be sent; it is sent again with the next. */
  failed: string | null;
};

/**
 * Sends what the map's change means for the adopted pages, and writes the baselines of the sections
 * the server adopted. Null when there is nothing to send.
 */
export async function syncAdoption(
  repoRoot: string,
  api: StudioApi,
  link: { orgId: string; project: string },
  recipe: Recipe | null,
  change: { previous: RepoMap | null; map: RepoMap },
  entryFile: string
): Promise<SyncOutcome | null> {
  const kept = await readJson<SyncState>(syncFile(repoRoot)).catch(() => null);
  const before = kept?.synced ?? change.previous;
  const synced = async () => {
    if (JSON.stringify(kept?.synced) === JSON.stringify(change.map) && !kept?.pending.length) {
      return;
    }
    await writeJsonAtomic(syncFile(repoRoot), {
      pending: [],
      synced: change.map
    } satisfies SyncState);
  };
  // The first map: nothing was adopted from it yet, and what is, adoption sends itself.
  if (!before) {
    await synced();
    return null;
  }
  const pending = new Set(kept?.pending ?? []);
  const entries = syncEntries(before, change.map, baselineKeys(repoRoot), pending);
  if (!entries.length) {
    await synced();
    return null;
  }
  const none: Baselines = { written: [], present: [], unpointed: [] };
  const adopted: Adopted = { pages: [] };
  try {
    for (const body of syncBodies(entries)) {
      const answer = await api.adopt(link.orgId, link.project, body);
      for (const page of answer.pages) {
        const known = adopted.pages.find(item => item.slug === page.slug);
        if (known) known.components.push(...page.components);
        else adopted.pages.push({ ...page, components: [...page.components] });
      }
    }
  } catch (error) {
    // The map the server last heard stays the one to compare with.
    await writeJsonAtomic(syncFile(repoRoot), {
      pending: [...new Set([...pending, ...entries.map(entry => entry.slug)])],
      synced: before
    } satisfies SyncState);
    return {
      entries,
      adopted: null,
      baselines: none,
      failed: error instanceof Error ? error.message : String(error)
    };
  }
  await synced();
  const baselines = writeBaselines(repoRoot, change.map, recipe, adopted);
  if (baselines.written.length) {
    await recordOwnWritesForOpenRuns(
      repoRoot,
      baselines.written.map(key => {
        const [page, component] = key.split('/') as [string, string];
        return `${iterationDir(page, component, BASELINE)}/${entryFile}`;
      })
    );
  }
  return { entries, adopted, baselines, failed: null };
}

/** The sync in a line per page, for the terminal. */
export function describeSync(outcome: SyncOutcome, map: RepoMap): string[] {
  const name = (slug: string) => map.components.find(item => item.slug === slug)?.name ?? slug;
  if (outcome.failed) {
    return [
      `The adopted pages' changes were not sent (${outcome.failed}); they are sent with the next change.`
    ];
  }
  return outcome.entries.map(entry => {
    const pageName = map.pages.find(page => page.slug === entry.slug)?.name ?? entry.slug;
    const parts = ['its order sent'];
    const fresh = entry.components.filter(item =>
      outcome.baselines.written.includes(`${entry.slug}/${item.slug}`)
    );
    if (fresh.length) parts.push(`adopted ${fresh.map(item => item.name).join(', ')}`);
    if (entry.gone?.length) {
      parts.push(`marked ${entry.gone.map(name).join(', ')} gone from the app`);
    }
    return `  ${pageName}: ${parts.join('; ')}.`;
  });
}
