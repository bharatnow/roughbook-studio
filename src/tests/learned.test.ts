// The studio's memory panels (A10 step 3 of ROUGHBOOK-APPLE-PLAN.md): the local UI reads what
// Roughbook learned about the designer and the linked project's brand through `/studio`, and
// forgets a sentence there. Only the sentence's scope and id go; nothing from the repo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { PRIVACY_SHEET } from '../config/privacySheet.js';
import { forgetLearned, loadLearned, type LearnedSource } from '../server/learned.js';
import { BadRequest } from '../server/studio.js';
import { fakeFetch, ok, refused, type RecordedRequest } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

const YOU = {
  id: ID,
  scope: 'you',
  project: null,
  text: 'Leans toward quiet type and generous space.',
  sources: [{ kind: 'select', code: 'type:quiet', iterationId: null, createdAt: '2026-10-28' }],
  createdAt: '2026-10-28T10:00:00.000Z'
};
const BRAND = { ...YOU, id: 'brand-1', scope: 'brand', project: 'site', text: 'Warm photos.' };

function source(respond: (request: RecordedRequest) => ReturnType<typeof ok>) {
  const backend = fakeFetch(respond);
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  const value: LearnedSource = { api, link: { orgId: ORG, project: 'site' } };
  return { source: value, requests: backend.requests };
}

const pathOf = (request: RecordedRequest) => new URL(request.url).pathname;

describe('learned sentences', () => {
  it('reads you and the linked project’s brand from /studio', async () => {
    const { source: from, requests } = source(request =>
      ok({ sentences: pathOf(request).includes('/projects/') ? [BRAND] : [YOU] })
    );
    const learned = await loadLearned(from);
    assert.deepEqual(learned, { project: 'site', you: [YOU], brand: [BRAND] });
    assert.deepEqual(requests.map(request => [request.method, pathOf(request)]).sort(), [
      ['GET', `/v1/api/studio/orgs/${ORG}/me/learned`],
      ['GET', `/v1/api/studio/orgs/${ORG}/projects/site/learned`]
    ]);
  });

  it('reads a missing list as empty', async () => {
    const { source: from } = source(() => ok({}));
    assert.deepEqual(await loadLearned(from), { project: 'site', you: [], brand: [] });
  });

  it('forgets a sentence of yours or of the brand, sending only its id', async () => {
    const { source: from, requests } = source(() => ok({ forgotten: true }));
    assert.deepEqual(await forgetLearned(from, 'you', ID), { forgotten: true });
    assert.deepEqual(await forgetLearned(from, 'brand', 'brand-1'), { forgotten: true });
    assert.deepEqual(
      requests.map(request => [request.method, pathOf(request), request.body]),
      [
        ['DELETE', `/v1/api/studio/orgs/${ORG}/me/learned/${ID}`, null],
        ['DELETE', `/v1/api/studio/orgs/${ORG}/projects/site/learned/brand-1`, null]
      ]
    );
  });

  it('refuses another scope or an id that is not one, before asking the backend', async () => {
    const { source: from, requests } = source(() => ok({ forgotten: true }));
    await assert.rejects(forgetLearned(from, 'studio', ID), BadRequest);
    await assert.rejects(forgetLearned(from, 'you', '../projects/x'), BadRequest);
    await assert.rejects(forgetLearned(from, 'you', ''), BadRequest);
    assert.equal(requests.length, 0);
  });

  it('passes the backend’s refusal on in words', async () => {
    const { source: from } = source(() =>
      refused('FORBIDDEN', 403, 'Viewers cannot forget what was learned.')
    );
    await assert.rejects(forgetLearned(from, 'brand', 'brand-1'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      return true;
    });
  });
});

describe('the privacy words', () => {
  it('say learned sentences are context only, never training, and can be forgotten', () => {
    const line = PRIVACY_SHEET.find(item => /learned/i.test(item));
    assert.ok(line, 'a line on learned sentences');
    assert.match(line, /context/i);
    assert.match(line, /no model is trained/i);
    assert.match(line, /forget/i);
    // The local UI reads each line after the heading as "Label: sentence".
    assert.match(line.trim(), /^[A-Z][^:]+: /);
  });
});
