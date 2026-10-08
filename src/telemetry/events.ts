import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { JsonValue, StudioApi } from '../api/client.js';
import { ApiError, OfflineError } from '../api/errors.js';
import { readSettings, saveSettings } from '../config/settings.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { EVENT_CATALOG, fitsCatalog, type StudioEventType } from './catalog.js';

// Usage analytics from this studio: only with the install's yes, asked at `roughbook login`, and
// never with ROUGHBOOK_TELEMETRY=off. The backend records what the studio asks it to do; these
// are the few events only the studio sees. They wait in the user config folder, never in the
// repo, until the backend takes them, a batch at a time, and are sent again when it could not be
// reached.

/** The most events kept waiting; older ones go first. */
const KEEP = 500;
const BATCH = 50;
/** The backend refuses events from a month ago. */
const MAX_AGE_MS = 29 * 86_400_000;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export type QueuedEvent = {
  id: string;
  type: StudioEventType;
  version: number;
  occurredAt: string;
  props: Record<string, JsonValue>;
};

type Where = { configDir: string; env: NodeJS.ProcessEnv };

/**
 * ROUGHBOOK_TELEMETRY=off (or 0, false, no): nothing is kept here, and every request tells the
 * backend not to record this studio's actions either.
 */
export function telemetryDisabled(env: NodeJS.ProcessEnv): boolean {
  return /^(off|0|false|no)$/i.test(env.ROUGHBOOK_TELEMETRY?.trim() ?? '');
}

export function eventsFile(configDir: string): string {
  return path.join(configDir, 'events.json');
}

/** Whether events are kept: the answer saved at login, unless switched off on this machine. */
export async function telemetryOn(where: Where): Promise<boolean> {
  if (telemetryDisabled(where.env)) return false;
  return (await readSettings(where.configDir)).analyticsConsent === true;
}

/** The code an error is reported by, or null for the studio's own refusals, which are sentences. */
export function errorCode(error: unknown): string | null {
  if (error instanceof ApiError) return CODE.test(error.code) ? error.code : 'API_ERROR';
  if (error instanceof OfflineError) return 'OFFLINE';
  if (error instanceof Error && error.constructor === Error) return null;
  return 'UNEXPECTED';
}

/** Keeps an event for the backend, when the designer agreed. One outside the catalog is dropped. */
export async function recordEvent(
  where: Where,
  type: StudioEventType,
  props: Record<string, JsonValue>,
  now = new Date()
): Promise<boolean> {
  if (!(await telemetryOn(where)) || !fitsCatalog(type, props)) return false;
  const file = eventsFile(where.configDir);
  await withLock(file, async () => {
    const waiting = (await readJson<QueuedEvent[]>(file)) ?? [];
    waiting.push({
      id: randomUUID(),
      type,
      version: EVENT_CATALOG.version,
      occurredAt: now.toISOString(),
      props
    });
    await writeJsonAtomic(file, waiting.slice(-KEEP));
  });
  return true;
}

/**
 * Sends what waits, oldest first. Offline, signed out or a server failure keeps the rest for
 * later; a refused batch is dropped (it would be refused again); a "no consent" answer, or
 * analytics turned off since, drops them all.
 */
export async function flushEvents(
  where: Where,
  api: StudioApi,
  now = new Date()
): Promise<{ sent: number; left: number }> {
  const file = eventsFile(where.configDir);
  return withLock(file, async () => {
    let waiting = ((await readJson<QueuedEvent[]>(file)) ?? []).filter(
      event => now.getTime() - Date.parse(event.occurredAt) < MAX_AGE_MS
    );
    if (!(await telemetryOn(where))) waiting = [];
    let sent = 0;
    while (waiting.length && api.signedIn) {
      const batch = waiting.slice(0, BATCH);
      try {
        await api.request('POST', '/events', { events: batch });
        sent += batch.length;
        waiting = waiting.slice(batch.length);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ANALYTICS_NOT_CONSENTED') {
          waiting = [];
          break;
        }
        if (error instanceof ApiError && !error.retryable && error.status !== 401) {
          waiting = waiting.slice(batch.length);
          continue;
        }
        if (error instanceof ApiError || error instanceof OfflineError) break;
        throw error;
      }
    }
    await writeJsonAtomic(file, waiting);
    return { sent, left: waiting.length };
  });
}

/** The designer's answer, on the backend and here. A no also drops what was waiting. */
export async function saveConsent(where: Where, api: StudioApi, consent: boolean) {
  await api.request('PUT', '/telemetry', { consent });
  await saveSettings(where.configDir, { analyticsConsent: consent });
  if (!consent) {
    const file = eventsFile(where.configDir);
    await withLock(file, () => writeJsonAtomic(file, []));
  }
}
