// The project's record as the local server gives it (C6 of the composer audit): the one place here
// that knows its shape, as src/lib/api/requests.ts is on the web. What cannot be read is left out, so
// a line never shows something made up. Pure, so the node tests walk it.
import type { TranscriptEntry, TranscriptPage, TranscriptRun } from '@roughbook/ui';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

/** The local server's read of the record. */
export function requestsAddress(cursor?: string | null): string {
  return cursor ? `/api/requests?cursor=${encodeURIComponent(cursor)}` : '/api/requests';
}

/** The local server's delete of one's own line. */
export function deleteAddress(id: string): string {
  return `/api/requests/${encodeURIComponent(id)}/delete`;
}

/** The sketch a run made. A deleted one has lost its id and name, so it is keyed by its run. */
function iterationsOf(run: string, value: unknown): TranscriptRun['iterations'] {
  if (!value) return [];
  const iteration = record(value);
  const id = string(iteration.id);
  return [
    {
      id: id ?? `gone-${run}`,
      name: string(iteration.name) ?? id ?? 'Deleted',
      exists: Boolean(id) && iteration.exists !== false
    }
  ];
}

function runFrom(value: unknown): TranscriptRun | null {
  const run = record(value);
  const id = string(run.id);
  if (!id) return null;
  return {
    id,
    status: string(run.status) ?? '',
    kind: string(run.kind) ?? '',
    phase: string(run.phase),
    iterations: iterationsOf(id, run.iteration)
  };
}

function entryFrom(value: unknown): TranscriptEntry | null {
  const item = record(value);
  const id = string(item.id);
  const createdAt = string(item.createdAt);
  if (!id || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const author = record(item.author);
  const authorId = string(author.id);
  const name = string(author.name);
  return {
    id,
    kind: item.kind === 'verb' || item.kind === 'message' ? item.kind : 'prompt',
    words: typeof item.words === 'string' ? item.words : '',
    reply: string(item.reply),
    verb: string(item.verb),
    page: string(item.page),
    component: string(item.component),
    iteration: string(item.iteration),
    source: item.source === 'studio' ? 'studio' : 'web',
    runIds: list(item.runIds).flatMap(run => (typeof run === 'string' ? [run] : [])),
    runs: list(item.runs).flatMap(run => runFrom(run) ?? []),
    undoneAt: string(item.undoneAt),
    author: authorId && name ? { id: authorId, name } : null,
    mine: item.mine === true,
    createdAt
  };
}

/** One page of the local server's answer, as the transcript draws it. */
export function requestsPage(data: unknown): TranscriptPage {
  const page = record(data);
  return {
    requests: list(page.requests).flatMap(item => entryFrom(item) ?? []),
    next: string(page.next)
  };
}
