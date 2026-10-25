import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { statePath } from '../repo/root.js';
import { withLock } from '../fs/lock.js';
import { pictureRefusal, type PictureTarget } from '../pictures/allowed.js';
import type { ImageBody, RequestBody, StudioApi } from './client.js';
import { ApiError, OfflineError } from './errors.js';
import type { ProjectTree } from './types.js';

/**
 * A picture waiting to go up (decisions 21, 23 and 28 of the brownfield plan): a PUT of its file's
 * bytes as they are when it is sent. The file's name stays here; only the bytes leave.
 */
export type Upload = {
  /** The picture, repo-relative, inside rough/.screenshots/. */
  file: string;
  type: ImageBody['type'];
  /** The file's sha256 when it was queued. */
  hash: string;
  /** What it pictures, so each send checks the project still takes it. */
  picture: PictureTarget;
};

/** A review, a run's result or a picture waiting to reach the backend. */
export type OutboxEntry = {
  id: string;
  path: string;
  body: RequestBody;
  queuedAt: string;
  attempts: number;
  /** The last error code, while it keeps failing. */
  lastError: string | null;
  /** A picture: sent as a PUT of its file rather than a POST of `body`. */
  upload?: Upload;
};

/** An entry the backend refused for good (a 4xx), kept so the local UI can say what was lost. */
export type DroppedEntry = {
  id: string;
  path: string;
  code: string;
  status: number;
  droppedAt: string;
};

type OutboxFile = {
  entries: OutboxEntry[];
  dropped: DroppedEntry[];
  /** The hash of the picture the backend last took at each path, so each is sent once. */
  uploaded: Record<string, string>;
};

export type FlushResult = {
  /** What the backend answered, for each entry sent in this flush. */
  sent: Map<string, unknown>;
  dropped: DroppedEntry[];
  /** Entries still waiting, because the backend could not be reached or failed. */
  left: number;
};

export type UploadResult =
  | { status: 'sent'; data: unknown }
  | { status: 'queued' }
  /** The backend already has this picture. */
  | { status: 'unchanged' }
  /** The project takes no such picture now: pictures are off, or it is not a studio iteration's. */
  | { status: 'skipped'; code: string };

const KEEP_DROPPED = 50;

/** Pictures the project does not take, or whose file is gone, are let go quietly: nothing was lost. */
const NOT_TAKEN = new Set([
  'PICTURES_OFF',
  'NOT_A_STUDIO_ITERATION',
  'PAGE_NOT_IN_APP',
  'PICTURE_GONE'
]);

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Reviews, run results and pictures go out in the order they were made, even offline: each is
 * written here first and sent when the backend can be reached, with its id as the idempotency
 * key, so one sent twice is applied once.
 */
export class Outbox {
  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
    /** The repo, which an upload's file is relative to. */
    private readonly root: string | null = null
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
      state.entries.push(this.entry(id, path, body));
      await writeJsonAtomic(this.file, state);
    });
    const result = await this.flush(api);
    if (result.sent.has(id)) return { status: 'sent', data: result.sent.get(id) };
    const refused = result.dropped.find(entry => entry.id === id);
    if (refused) throw new ApiError(refused.code, refused.status);
    return { status: 'queued' };
  }

  /**
   * Queues a picture's upload and tries to send what waits. A picture the backend already has is
   * not queued; one queued for the same path before is replaced, since only the newest matters.
   */
  async upload(api: StudioApi, path: string, upload: Upload): Promise<UploadResult> {
    const id = randomUUID();
    const queued = await withLock(this.file, async () => {
      const state = await this.read();
      if (state.uploaded[path] === upload.hash) return state.entries.length ? 'waiting' : false;
      state.entries = state.entries.filter(entry => !(entry.upload && entry.path === path));
      state.entries.push({ ...this.entry(id, path, {}), upload });
      await writeJsonAtomic(this.file, state);
      return true;
    });
    // What waits from an offline moment goes now, if it can.
    if (queued === 'waiting') await this.flush(api);
    if (queued !== true) return { status: 'unchanged' };
    const result = await this.flush(api);
    if (result.sent.has(id)) return { status: 'sent', data: result.sent.get(id) };
    const refused = result.dropped.find(entry => entry.id === id);
    if (refused) {
      if (NOT_TAKEN.has(refused.code)) return { status: 'skipped', code: refused.code };
      throw new ApiError(refused.code, refused.status);
    }
    return { status: 'queued' };
  }

  /** Sends what is waiting, oldest first, and stops at the first one that cannot go yet. */
  async flush(api: StudioApi): Promise<FlushResult> {
    return withLock(this.file, async () => {
      const state = await this.read();
      const sent = new Map<string, unknown>();
      const dropped: DroppedEntry[] = [];
      const left: OutboxEntry[] = [];
      // Each project is read once per flush, when a picture is waiting for it.
      const trees = new Map<string, Promise<ProjectTree>>();
      let blocked = false;
      for (const entry of state.entries) {
        if (blocked) {
          left.push(entry);
          continue;
        }
        try {
          if (entry.upload) {
            const outcome = await this.sendUpload(api, entry, entry.upload, state, trees);
            if (outcome.code) {
              dropped.push(this.droppedEntry(entry, outcome.code, 409));
              continue;
            }
            sent.set(entry.id, outcome.data);
          } else {
            sent.set(
              entry.id,
              await api.request('POST', entry.path, entry.body, { idempotencyKey: entry.id })
            );
          }
        } catch (error) {
          if (error instanceof ApiError && !error.retryable) {
            dropped.push(this.droppedEntry(entry, error.code, error.status));
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
      // A picture the project does not take is not a loss the local UI lists.
      const lost = dropped.filter(entry => !NOT_TAKEN.has(entry.code));
      await writeJsonAtomic(this.file, {
        entries: left,
        dropped: [...state.dropped, ...lost].slice(-KEEP_DROPPED),
        uploaded: state.uploaded
      } satisfies OutboxFile);
      return { sent, dropped, left: left.length };
    });
  }

  /**
   * One picture: checked against the project as it is now, then its file's bytes as they are now.
   * A `code` says the project does not take it, or the file is gone; neither sends anything.
   */
  private async sendUpload(
    api: StudioApi,
    entry: OutboxEntry,
    upload: Upload,
    state: OutboxFile,
    trees: Map<string, Promise<ProjectTree>>
  ): Promise<{ code: string | null; data?: unknown }> {
    const { orgId, project } = upload.picture;
    const key = `${orgId}/${project}`;
    if (!trees.has(key)) trees.set(key, api.project(orgId, project));
    const refusal = pictureRefusal(await trees.get(key)!, upload.picture);
    if (refusal === 'PICTURES_OFF') forgetUploads(state, orgId, project);
    if (refusal) return { code: refusal };
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(this.root ?? '', ...upload.file.split('/')));
    } catch {
      return { code: 'PICTURE_GONE' };
    }
    try {
      const data = await api.putPicture(
        entry.path,
        { bytes, type: upload.type },
        { idempotencyKey: entry.id }
      );
      state.uploaded[entry.path] = sha256(bytes);
      return { code: null, data };
    } catch (error) {
      // Turned off between the read and the upload: the backend deleted what it had.
      if (error instanceof ApiError && error.code === 'PICTURES_OFF') {
        forgetUploads(state, orgId, project);
        return { code: error.code };
      }
      throw error;
    }
  }

  private entry(id: string, path: string, body: RequestBody): OutboxEntry {
    return { id, path, body, queuedAt: this.now().toISOString(), attempts: 0, lastError: null };
  }

  private droppedEntry(entry: OutboxEntry, code: string, status: number): DroppedEntry {
    return { id: entry.id, path: entry.path, code, status, droppedAt: this.now().toISOString() };
  }

  private async read(): Promise<OutboxFile> {
    const state = await readJson<Partial<OutboxFile>>(this.file);
    return {
      entries: state?.entries ?? [],
      dropped: state?.dropped ?? [],
      uploaded: state?.uploaded ?? {}
    };
  }
}

/** The project's pictures are gone from the backend: each is sent again once they are on. */
function forgetUploads(state: OutboxFile, orgId: string, project: string) {
  const prefix = `/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(project)}/`;
  for (const key of Object.keys(state.uploaded)) {
    if (key.startsWith(prefix)) delete state.uploaded[key];
  }
}

/** The repo's outbox, in `rough/.roughbook/`. */
export function outboxFor(repoRoot: string): Outbox {
  return new Outbox(statePath(repoRoot, 'outbox.json'), undefined, repoRoot);
}
