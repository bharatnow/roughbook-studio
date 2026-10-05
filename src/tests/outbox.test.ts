import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { Outbox } from '../api/outbox.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

describe('the outbox', () => {
  const setup = async (
    respond: (request: RecordedRequest) => ReturnType<typeof ok> | 'offline'
  ) => {
    const dir = await tempDir();
    const fake = fakeFetch(respond);
    const api = new StudioApi({
      server: 'http://localhost:4000',
      token: 'rbi_token',
      userAgent: 'roughbook-studio/test',
      fetch: fake.fetch
    });
    return { outbox: new Outbox(path.join(dir, 'outbox.json')), api, requests: fake.requests };
  };

  it("sends at once when it can, with the entry's id as the idempotency key", async () => {
    const { outbox, api, requests } = await setup(() => ok({ saved: true }));
    const result = await outbox.send(api, '/reviews', { rating: 4 });
    assert.deepEqual(result, { status: 'sent', data: { saved: true } });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.headers['idempotency-key']!, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await outbox.pending(), []);
  });

  it('keeps what it cannot send, in order, and sends it once the backend is back', async () => {
    let online = false;
    const { outbox, api, requests } = await setup(request =>
      online ? ok({ path: new URL(request.url).pathname }) : 'offline'
    );
    assert.deepEqual(await outbox.send(api, '/reviews', { rating: 2 }), { status: 'queued' });
    assert.deepEqual(await outbox.send(api, '/runs/a/finish', { outcome: 'done' }), {
      status: 'queued'
    });
    // While the first is stuck, the second is not tried, so the order holds.
    const waiting = await outbox.pending();
    assert.deepEqual(
      waiting.map(entry => [entry.path, entry.attempts, entry.lastError]),
      [
        ['/reviews', 2, 'OFFLINE'],
        ['/runs/a/finish', 0, null]
      ]
    );

    online = true;
    const third = await outbox.send(api, '/reviews', { rating: 5 });
    assert.equal(third.status, 'sent');
    assert.deepEqual(
      requests
        .filter(request => request.method === 'POST')
        .slice(-3)
        .map(request => request.body),
      [{ rating: 2 }, { outcome: 'done' }, { rating: 5 }]
    );
    assert.deepEqual(await outbox.pending(), []);
    // A retried entry keeps its idempotency key.
    const keys = requests.map(request => request.headers['idempotency-key']);
    assert.equal(keys[0], keys[2]);
  });

  it('drops what the backend refuses for good and says so, and keeps going', async () => {
    const { outbox, api } = await setup(request =>
      (request.body as { rating: number }).rating === 9 ? refused('INVALID_RATING', 400) : ok(null)
    );
    await assert.rejects(
      outbox.send(api, '/reviews', { rating: 9 }),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RATING'
    );
    assert.equal((await outbox.send(api, '/reviews', { rating: 3 })).status, 'sent');
    const dropped = await outbox.dropped();
    assert.deepEqual(
      dropped.map(entry => [entry.path, entry.code, entry.status]),
      [['/reviews', 'INVALID_RATING', 400]]
    );
  });

  it('keeps a server failure for later, like being offline', async () => {
    const { outbox, api } = await setup(() => refused('Internal server error', 500));
    assert.deepEqual(await outbox.send(api, '/reviews', { rating: 1 }), { status: 'queued' });
    assert.equal((await outbox.pending())[0]!.lastError, 'Internal server error');
  });

  it('loses nothing when several send at once', async () => {
    const { outbox, api } = await setup(() => 'offline');
    await Promise.all(
      Array.from({ length: 8 }, (_, rating) => outbox.send(api, '/reviews', { rating }))
    );
    const ratings = (await outbox.pending()).map(entry => entry.body.rating).sort();
    assert.deepEqual(ratings, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
