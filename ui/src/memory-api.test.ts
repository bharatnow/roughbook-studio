import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { forgetPath, forgetSentence, loadLearned } from './memory-api.ts';

const SENTENCE = {
  id: 'sentence-1',
  orgId: 'org-1',
  scope: 'brand' as const,
  project: 'site',
  text: 'Leans toward warm photos.',
  sources: [],
  createdAt: '2026-10-28T10:00:00.000Z'
};

type Sent = { method: string; url: string };
const realFetch = globalThis.fetch;

function answer(status: number, body: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ method: init?.method ?? 'GET', url: String(input) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return sent;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the studio’s memory calls', () => {
  it('reads you and this brand from the local server', async () => {
    const sent = answer(200, { ok: true, data: { project: 'site', you: [], brand: [SENTENCE] } });
    assert.deepEqual(await loadLearned(), { project: 'site', you: [], brand: [SENTENCE] });
    assert.deepEqual(sent, [{ method: 'GET', url: '/api/learned' }]);
  });

  it('forgets by scope and id, sending nothing else', async () => {
    const sent = answer(200, { ok: true, data: { forgotten: true } });
    const result = await forgetSentence(SENTENCE);
    assert.equal(result.ok, true);
    assert.match(result.message, /forgotten/i);
    assert.deepEqual(sent, [{ method: 'POST', url: '/api/learned/brand/sentence-1/forget' }]);
  });

  it('answers a refusal in the server’s words', async () => {
    answer(403, { ok: false, error: 'FORBIDDEN', message: 'Viewers cannot forget it.' });
    assert.deepEqual(await forgetSentence(SENTENCE), {
      ok: false,
      message: 'Viewers cannot forget it.'
    });
  });

  it('puts the id in the address only as one segment', () => {
    assert.equal(
      forgetPath({ ...SENTENCE, scope: 'you', id: 'a/b' }),
      '/api/learned/you/a%2Fb/forget'
    );
  });
});
