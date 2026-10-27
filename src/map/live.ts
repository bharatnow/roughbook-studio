// The map kept with the app while `roughbook start` runs (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md,
// decision 62): the app's source files are watched, and after a short quiet spell the map is
// refreshed from what changed, what hangs on a renamed or gone component follows it, and the
// adopted pages' changes are sent (src/map/sync.ts). One refresh runs at a time; a change while it
// runs refreshes again after it.
import type { StudioApi } from '../api/client.js';
import type { RepoEnvironment } from '../environment/types.js';
import { recipeOf } from '../recipes/index.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { watchApp, type WatchFunction } from '../runs/watch.js';
import type { StudioOs } from '../launch/platform.js';
import { MAP_FILE, hasMapFile, readMap } from './file.js';
import { countMap, describeChanges, mapRepo, type MapResult } from './run.js';
import { describeSync, syncAdoption, type SyncOutcome } from './sync.js';

/** How long the app's files are still before the map is refreshed. */
export const QUIET_MS = 300;

export type MapSyncOptions = {
  repoRoot: string;
  environment: RepoEnvironment;
  link: RepoLink;
  api: StudioApi;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Why the studio must not write generated files any more (a stale start), or null. */
  stale?: () => string | null;
  /** After a sync adopted sections: their `<page>/<component>` and the pages, for their pictures. */
  onAdopted?: (baselines: string[], pages: string[]) => void;
  /** After the map changed, for whoever shows it. */
  onMapChanged?: (result: MapResult) => void;
  quietMs?: number;
  os?: StudioOs;
  watch?: WatchFunction;
};

export type Refreshed = { result: MapResult; sync: SyncOutcome | null; ms: number };

/**
 * The adopted pages' changes sent after the map was written outside start's watch (`roughbook
 * map`, start's first refresh, a composition's fresh map, a page promote's finish), or the ones a
 * sync could not send yet: lines for the terminal, none when nothing was sent.
 */
export async function syncAfterMap(
  repoRoot: string,
  environment: RepoEnvironment,
  link: RepoLink,
  api: StudioApi,
  result: Pick<MapResult, 'previous' | 'map'> | null
): Promise<{ lines: string[]; sync: SyncOutcome | null }> {
  try {
    const map = result?.map ?? readMap(repoRoot)?.map;
    if (!map) return { lines: [], sync: null };
    const sync = await syncAdoption(
      repoRoot,
      api,
      link,
      recipeOf(environment),
      { previous: result?.previous ?? null, map },
      environment.entry
    );
    return { lines: sync ? describeSync(sync, map) : [], sync };
  } catch (error) {
    return {
      lines: [
        `The adopted pages were not synced: ${error instanceof Error ? error.message : String(error)}`
      ],
      sync: null
    };
  }
}

export class MapSync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly options: MapSyncOptions) {}

  /** Watches the app's files; returns a function that stops watching. */
  watch(): () => void {
    const stop = watchApp(this.options.repoRoot, () => this.notice(), this.options.environment, {
      ...(this.options.os ? { os: this.options.os } : {}),
      ...(this.options.watch ? { watch: this.options.watch } : {})
    });
    return () => {
      this.stopped = true;
      stop();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }

  /** A file changed: refresh once the app's files have been still for a moment. */
  notice(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.options.quietMs ?? QUIET_MS);
    this.timer.unref();
  }

  /** Waits for the refresh under way, and the one after it, if any. */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Refreshes the map now, after the one under way; null when nothing ran or it failed. */
  async refresh(): Promise<Refreshed | null> {
    if (this.running) {
      this.again = true;
      await this.settled();
      return null;
    }
    let outcome: Refreshed | null = null;
    const work = (async () => {
      do {
        this.again = false;
        outcome = await this.once();
      } while (this.again && !this.stopped);
    })();
    this.running = work;
    try {
      await work;
    } finally {
      this.running = null;
    }
    return outcome;
  }

  private async once(): Promise<Refreshed | null> {
    const { repoRoot, environment, link, api, out, err } = this.options;
    // A repo with no map has nothing to follow: `roughbook map` writes it first.
    if (this.options.stale?.() || !hasMapFile(repoRoot)) return null;
    const started = performance.now();
    let result: MapResult | null;
    try {
      result = await mapRepo(repoRoot, environment, link);
    } catch (error) {
      err(`The map was not refreshed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (!result) return null;
    const ms = Math.round(performance.now() - started);
    if (!result.changed) return { result, sync: null, ms };
    out(`${ROUGH_DIR}/${MAP_FILE} refreshed: ${countMap(result.map)}.`);
    for (const line of describeChanges(result)) out(line);
    this.options.onMapChanged?.(result);
    let sync: SyncOutcome | null = null;
    try {
      sync = await syncAdoption(
        repoRoot,
        api,
        link,
        recipeOf(environment),
        result,
        environment.entry
      );
    } catch (error) {
      err(
        `The adopted pages were not synced: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (sync) {
      for (const line of describeSync(sync, result.map)) (sync.failed ? err : out)(line);
      if (sync.baselines.written.length) {
        this.options.onAdopted?.(
          sync.baselines.written,
          sync.entries.map(entry => entry.slug)
        );
      }
    }
    return { result, sync, ms };
  }
}
