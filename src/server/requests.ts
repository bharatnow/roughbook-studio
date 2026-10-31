// The composer's history in the local UI (C6 of the composer audit): `GET /api/requests` reads a page
// of the project's record, and `POST /api/requests/:id/delete` deletes one's own line. Only the
// page's cursor and a line's id go to the backend. The words come back with stand-ins for this
// machine's paths: those it still holds are put back here, for this page alone, and nothing the
// page sends can carry one back out.
import type { RequestLine, RequestsPage, StudioApi } from '../api/client.js';
import { forgetLocalPaths, keptPathsOf, readKeptPaths, type KeptPaths } from '../runs/keptPaths.js';
import { restoreLocalPaths } from '../runs/localPaths.js';
import { BadRequest } from './studio.js';

/** Lines to a page; the backend takes at most 100. */
const PAGE = 30;
/** What the backend's cursors look like, so no other text can reach its address. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the routes need: the client, the linked project and the repo that keeps the paths. */
export type RequestsSource = {
  api: StudioApi;
  link: { orgId: string; project: string };
  repoRoot: string;
};

/** The line as this machine shows it: a stand-in it no longer holds stays as it came. */
function restoredLine(line: RequestLine, kept: KeptPaths): RequestLine {
  const paths = keptPathsOf(kept, [line.id, ...line.runIds]);
  if (!paths.size) return line;
  return {
    ...line,
    words: restoreLocalPaths(line.words, paths),
    reply: line.reply === null ? null : restoreLocalPaths(line.reply, paths)
  };
}

/** A page of the record, from where the last ended; the backend's refusals pass on as ApiErrors. */
export async function readRequests(
  source: RequestsSource,
  cursor: string | null
): Promise<RequestsPage> {
  if (cursor !== null && !CURSOR.test(cursor)) {
    throw new BadRequest('That place in the history cannot be read.');
  }
  const { api, link, repoRoot } = source;
  const page = await api.requests(link.orgId, link.project, {
    limit: PAGE,
    ...(cursor === null ? {} : { cursor })
  });
  const kept = await readKeptPaths(repoRoot);
  return { ...page, requests: page.requests.map(line => restoredLine(line, kept)) };
}

/** Deletes one's own line, and what this machine kept for it. */
export async function deleteRequest(
  source: RequestsSource,
  id: string
): Promise<{ deleted: true }> {
  if (!LINE_ID.test(id)) throw new BadRequest('That line cannot be read.');
  const { api, link, repoRoot } = source;
  const deleted = await api.deleteRequest(link.orgId, link.project, id);
  await forgetLocalPaths(repoRoot, id);
  return deleted;
}
