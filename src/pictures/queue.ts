// Pictures taken as they are needed (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md): the local
// canvas says which cards are on screen, and their pictures are taken first, in that order, then
// the rest, one at a time. A card whose source is unchanged since its last pictures keeps them,
// so asking for it again costs a hash. An adoption larger than a screen hands its baselines to the
// same queue, through a file `roughbook adopt` writes and `start`'s server reads.
import fs from 'node:fs';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { statePath } from '../repo/root.js';

/**
 * What one take came to: taken now, kept (its source unchanged), not for pictures (gone, or a run
 * is still writing it), failed, or `wait`: nothing can be taken now (the app is down), so the
 * queue stops until it is asked again.
 */
export type TakeResult = 'taken' | 'kept' | 'skipped' | 'failed' | 'wait';

/** How long a failed key waits before the canvas's showing it again tries it again. */
export const RETRY_AFTER_MS = 60_000;

/** How long the queue waits, once nothing could be taken (the app down), before trying again. */
export const WAIT_RETRY_MS = 5_000;

/** How many cards the canvas shows at once, near enough: an adoption past it is queued. */
export const SCREENFUL = 12;

/**
 * The order alone, with no taking: the shown keys first, in the order last shown, then the rest
 * in the order they came. A key is in it once.
 */
export class PictureOrder {
  private shown: string[] = [];
  private rest: string[] = [];
  private readonly failedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The cards on screen now, replacing the last screen's: those not taken yet move to the rest. */
  show(keys: string[]): void {
    const now = this.now();
    const fresh = [...new Set(keys)].filter(key => {
      const failed = this.failedAt.get(key);
      return failed === undefined || now - failed >= RETRY_AFTER_MS;
    });
    const wanted = new Set(fresh);
    this.rest = [...this.shown.filter(key => !wanted.has(key)), ...this.rest].filter(
      key => !wanted.has(key)
    );
    this.shown = fresh;
    this.dedupeRest();
  }

  /** Keys to take after the shown ones, at the back unless already waiting. */
  add(keys: string[]): void {
    const waiting = new Set([...this.shown, ...this.rest]);
    for (const key of keys) {
      if (waiting.has(key) || this.failedAt.has(key)) continue;
      waiting.add(key);
      this.rest.push(key);
    }
  }

  /** The next key to take, taken off the queue; null when nothing waits. */
  next(): string | null {
    return this.shown.shift() ?? this.rest.shift() ?? null;
  }

  /** Puts a key back at the front, as it was: it could not be taken yet. */
  putBack(key: string): void {
    this.shown.unshift(key);
  }

  /** A key that failed is not tried again until it is shown after RETRY_AFTER_MS. */
  failed(key: string): void {
    this.failedAt.set(key, this.now());
  }

  /** It came out, or was kept: a later failure is forgotten. */
  done(key: string): void {
    this.failedAt.delete(key);
  }

  /** Forgets a key: it is gone from the app or the repo. */
  drop(key: string): void {
    this.shown = this.shown.filter(item => item !== key);
    this.rest = this.rest.filter(item => item !== key);
  }

  get waiting(): { shown: number; rest: number } {
    return { shown: this.shown.length, rest: this.rest.length };
  }

  private dedupeRest(): void {
    this.rest = [...new Set(this.rest)];
  }
}

/** What the queue is doing, for the local UI. */
export type QueueView = { taking: string | null; shown: number; rest: number; paused: boolean };

/**
 * The order with a worker: takes one key at a time with `take` until nothing waits, or until a
 * take says `wait`, when it pauses until the next show or add, or WAIT_RETRY_MS. `onTaken` hears each key whose
 * pictures changed, and `onIdle` when nothing is left to take.
 */
export class PictureQueue {
  readonly order: PictureOrder;
  private taking: string | null = null;
  private running: Promise<void> | null = null;
  private paused = false;
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly take: (key: string) => Promise<TakeResult>,
    private readonly hooks: {
      onTaken?: (key: string) => void;
      onIdle?: () => void;
      now?: () => number;
      /** How long a pause lasts before the queue tries again by itself. */
      retryMs?: number;
    } = {}
  ) {
    this.order = new PictureOrder(hooks.now);
  }

  show(keys: string[]): void {
    this.order.show(keys);
    this.paused = false;
    this.kick();
  }

  add(keys: string[]): void {
    // The one being taken now is not taken twice.
    this.order.add(keys.filter(key => key !== this.taking));
    this.paused = false;
    this.kick();
  }

  view(): QueueView {
    return { taking: this.taking, ...this.order.waiting, paused: this.paused };
  }

  /** Resolves once nothing is being taken (for tests and for close). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private kick(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.running || this.stopped) return;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.stopped || this.paused) return;
      const key = this.order.next();
      if (!key) {
        this.hooks.onIdle?.();
        return;
      }
      this.taking = key;
      let result: TakeResult;
      try {
        result = await this.take(key);
      } catch {
        result = 'failed';
      }
      this.taking = null;
      if (result === 'wait') {
        this.order.putBack(key);
        this.paused = true;
        // The app may come up with nothing asked of the queue: it tries again by itself.
        this.retry = setTimeout(() => {
          this.retry = null;
          this.paused = false;
          this.kick();
        }, this.hooks.retryMs ?? WAIT_RETRY_MS);
        this.retry.unref();
        return;
      }
      if (result === 'failed') this.order.failed(key);
      else this.order.done(key);
      if (result === 'taken') this.hooks.onTaken?.(key);
      // Let the server answer between pictures.
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}

/** Where `roughbook adopt` leaves the baselines it did not picture, for `start`'s queue. */
function waitingFile(repoRoot: string): string {
  return statePath(repoRoot, 'pictures-waiting.json');
}

type Waiting = { keys: string[] };

/** Adds iteration keys (`<page>/<component>/<iteration>`) for the next `start` to picture. */
export async function leaveForStart(repoRoot: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const file = waitingFile(repoRoot);
  await withLock(file, async () => {
    const kept = (await readJson<Waiting>(file))?.keys ?? [];
    await writeJsonAtomic(file, { keys: [...new Set([...kept, ...keys])] } satisfies Waiting);
  });
}

/** Takes the keys `roughbook adopt` left, emptying the file; none when there is no file. */
export async function takeLeftForStart(repoRoot: string): Promise<string[]> {
  const file = waitingFile(repoRoot);
  if (!fs.existsSync(file)) return [];
  return withLock(file, async () => {
    const kept = (await readJson<Waiting>(file))?.keys ?? [];
    if (kept.length) await writeJsonAtomic(file, { keys: [] } satisfies Waiting);
    return kept;
  });
}
