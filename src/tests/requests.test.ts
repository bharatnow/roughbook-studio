// The local history routes (C6 of the composer audit): a page of the record, with the paths this
// machine still holds put back in its words, and the deletion of one's own line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi, type RequestLine, type RequestsPage } from '../api/client.js';
import { ApiError, OfflineError } from '../api/errors.js';
import { statePath } from '../repo/root.js';
import { keepLocalPaths, readKeptPaths } from '../runs/keptPaths.js';
import { deleteRequest, readRequests, type RequestsSource } from '../server/requests.js';
import { BadRequest } from '../server/studio.js';
import { fakeFetch, ok, refused, tempDir } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const LINE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const PATH = 'C:\\client-app\\src\\hero.tsx';
const STAND_IN = '[local path 1]';
const BASE = `/v1/api/studio/orgs/${ORG}/projects/site/requests`;

const line = (fields: Partial<RequestLine> = {}): RequestLine => ({
  id: LINE_ID,
  words: `like ${STAND_IN}`,
  reply: null,
  runIds: [],
  source: 'studio',
  ...fields
});

async function setup(respond: Parameters<typeof fakeFetch>[0]) {
  const repoRoot = await tempDir('roughbook-requests-');
  const backend = fakeFetch(respond);
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  const source: RequestsSource = { api, link: { orgId: ORG, project: 'site' }, repoRoot };
  return { source, repoRoot, requests: backend.requests };
}

const page = (...lines: RequestLine[]) => ok({ requests: lines, next: 'older' } as RequestsPage);
const stands = new Map([[STAND_IN, PATH]]);

describe('the record, read locally', () => {
  it('asks for a page, and passes the next cursor on', async () => {
    const { source, requests } = await setup(() => page());
    assert.deepEqual(await readRequests(source, null), { requests: [], next: 'older' });
    await readRequests(source, 'abc_-1');
    assert.equal(requests[0]!.method, 'GET');
    assert.equal(new URL(requests[0]!.url).pathname, BASE);
    assert.equal(new URL(requests[0]!.url).search, '?limit=30');
    assert.equal(new URL(requests[1]!.url).search, '?limit=30&cursor=abc_-1');
  });

  it('puts back the paths of a message, in its words and its reply', async () => {
    const { source, repoRoot } = await setup(() =>
      page(line({ reply: `Read ${STAND_IN}`, runIds: [] }))
    );
    await keepLocalPaths(repoRoot, [LINE_ID], stands);
    const { requests } = await readRequests(source, null);
    assert.equal(requests[0]!.words, `like ${PATH}`);
    assert.equal(requests[0]!.reply, `Read ${PATH}`);
    assert.equal(requests[0]!.source, 'studio');
  });

  it('puts back the paths of a run by its id', async () => {
    const { source, repoRoot } = await setup(() => page(line({ runIds: [RUN_ID] })));
    await keepLocalPaths(repoRoot, [RUN_ID], stands);
    assert.equal((await readRequests(source, null)).requests[0]!.words, `like ${PATH}`);
  });

  it('leaves a stand-in this machine no longer holds, and another line’s alone', async () => {
    const { source, repoRoot } = await setup(() => page(line()));
    await keepLocalPaths(repoRoot, [RUN_ID], stands);
    assert.equal((await readRequests(source, null)).requests[0]!.words, `like ${STAND_IN}`);
  });

  it('reads an unreadable store as holding nothing', async () => {
    const { source, repoRoot } = await setup(() => page(line()));
    const file = statePath(repoRoot, 'local-paths.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not json');
    assert.equal((await readRequests(source, null)).requests[0]!.words, `like ${STAND_IN}`);
  });

  it('refuses a cursor that is not one, sending nothing', async () => {
    const { source, requests } = await setup(() => page());
    for (const cursor of [PATH, 'a/b', '', 'x'.repeat(201)]) {
      await assert.rejects(readRequests(source, cursor), BadRequest);
    }
    assert.equal(requests.length, 0);
  });

  it('passes on being offline or refused', async () => {
    const offline = await setup(() => 'offline');
    await assert.rejects(readRequests(offline.source, null), OfflineError);
    const reviewer = await setup(() => refused('ORG_ROLE_REQUIRED', 403));
    await assert.rejects(
      readRequests(reviewer.source, null),
      (error: unknown) => error instanceof ApiError && error.status === 403
    );
  });
});

describe('deleting one’s own line', () => {
  it('deletes it by id with no body, and forgets its paths here', async () => {
    const { source, repoRoot, requests } = await setup(() => ok({ deleted: true }));
    await keepLocalPaths(repoRoot, [LINE_ID, RUN_ID], stands);
    assert.deepEqual(await deleteRequest(source, LINE_ID), { deleted: true });
    assert.equal(requests[0]!.method, 'DELETE');
    assert.equal(new URL(requests[0]!.url).pathname, `${BASE}/${LINE_ID}`);
    assert.equal(requests[0]!.body, null);
    assert.deepEqual(Object.keys(await readKeptPaths(repoRoot)), [RUN_ID]);
  });

  it('keeps the paths when the backend refuses', async () => {
    const { source, repoRoot } = await setup(() => refused('REQUEST_NOT_YOURS', 403));
    await keepLocalPaths(repoRoot, [LINE_ID], stands);
    await assert.rejects(deleteRequest(source, LINE_ID), ApiError);
    assert.deepEqual(Object.keys(await readKeptPaths(repoRoot)), [LINE_ID]);
  });

  it('refuses what is not a line’s id, sending nothing', async () => {
    const { source, requests } = await setup(() => ok({ deleted: true }));
    await assert.rejects(deleteRequest(source, PATH), BadRequest);
    assert.equal(requests.length, 0);
  });
});
