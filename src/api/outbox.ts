import { randomUUID } from 'node:crypto';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { statePath } from '../repo/root.js';
import { withLock } from '../fs/lock.js';
import type { RequestBody, StudioApi } from './client.js';
import { ApiError, OfflineError } from './errors.js';

/** A review or a run's result waiting to reach the backend. */
export type OutboxEntry = {
  id: string;
  path: string;
  body: RequestBody;
  queuedAt: string;
  attempts: number;
  /** The last error code, while it keeps failing. */
  lastError: string | null;
};

/** An entry the backend refused for good (a 4xx), kept so the local UI can say what was lost. */
export type DroppedEntry = {
  id: string;
  path: string;
  code: string;
  status: number;
  droppedAt: string;
};

type OutboxFile = { entries: OutboxEntry[]; dropped: DroppedEntry[] };

export type FlushResult = {
  /** What the backend answered, for each entry sent in this flush. */
  sent: Map<string, unknown>;
  dropped: DroppedEntry[];
  /** Entries still waiting, because the backend could not be reached or failed. */
  left: number;
};

const KEEP_DROPPED = 50;

/**
 * Reviews and run results go out in the order they were made, even offline: each is written here
 * first and sent when the backend can be reached, with its id as the idempotency key, so one sent
 * twice is applied once.
 */
export class Outbox {
  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async pending(): Promise<OutboxEntry[]> {
    return (await this.read()).entries;
  }

  async dropped(): Promise<DroppedEntry[]> {
    return (await this.read()).dropped;
  }

  /**
   * Queues a POST behind anything already waiting and tries to send the lot. Resolves with the
   * backend's answer when it went out now, or `queued` when it will go later; rejects with the
   * ApiError when the backend refused it.
   */
  async send(
    api: StudioApi,
    path: string,
    body: RequestBody
  ): Promise<{ status: 'sent'; data: unknown } | { status: 'queued' }> {
    const id = randomUUID();
    await withLock(this.file, async () => {
      const state = await this.read();
      state.entries.push({
        id,
        path,
        body,
        queuedAt: this.now().toISOString(),
        attempts: 0,
        lastError: null
      });
      await writeJsonAtomic(this.file, state);
    });
    const result = await this.flush(api);
    if (result.sent.has(id)) return { status: 'sent', data: result.sent.get(id) };
    const refused = result.dropped.find(entry => entry.id === id);
    if (refused) throw new ApiError(refused.code, refused.status);
    return { status: 'queued' };
  }

  /** Sends what is waiting, oldest first, and stops at the first one that cannot go yet. */
  async flush(api: StudioApi): Promise<FlushResult> {
    return withLock(this.file, async () => {
      const state = await this.read();
      const sent = new Map<string, unknown>();
      const dropped: DroppedEntry[] = [];
      const left: OutboxEntry[] = [];
      let blocked = false;
      for (const entry of state.entries) {
        if (blocked) {
          left.push(entry);
          continue;
        }
        try {
          sent.set(
            entry.id,
            await api.request('POST', entry.path, entry.body, { idempotencyKey: entry.id })
          );
        } catch (error) {
          if (error instanceof ApiError && !error.retryable) {
            dropped.push({
              id: entry.id,
              path: entry.path,
              code: error.code,
              status: error.status,
              droppedAt: this.now().toISOString()
            });
            continue;
          }
          if (!(error instanceof ApiError) && !(error instanceof OfflineError)) throw error;
          blocked = true;
          left.push({
            ...entry,
            attempts: entry.attempts + 1,
            lastError: error instanceof ApiError ? error.code : 'OFFLINE'
          });
        }
      }
      await writeJsonAtomic(this.file, {
        entries: left,
        dropped: [...state.dropped, ...dropped].slice(-KEEP_DROPPED)
      });
      return { sent, dropped, left: left.length };
    });
  }

  private async read(): Promise<OutboxFile> {
    const state = await readJson<OutboxFile>(this.file);
    return { entries: state?.entries ?? [], dropped: state?.dropped ?? [] };
  }
}

/** The repo's outbox, in `rough/.roughbook/`. */
export function outboxFor(repoRoot: string): Outbox {
  return new Outbox(statePath(repoRoot, 'outbox.json'));
}
