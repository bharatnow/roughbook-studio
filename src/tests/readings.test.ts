// The local readings route (A6 of ROUGHBOOK-APPLE-PLAN.md): the page's words go to the backend's
// readings call for the selected component, and only the words, the readings kept and the one to
// replace go with them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { BadRequest } from '../server/studio.js';
import { parseReadings, planReadings, type ReadingsSource } from '../server/readings.js';
import { fakeFetch, ok, refused } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const REPLY = {
  readings: [
    { label: 'Hushed', hypothesis: 'Quiet type lets the offer lead.', plan: { density: 'airy' } },
    { label: 'Ledger', hypothesis: 'A ruled grid reads as trust.', plan: { density: 'dense' } },
    { label: 'Tide', hypothesis: 'Slow motion reads as calm.', plan: {} }
  ],
  question: { key: 'audience', stepId: 'who', question: 'Who is it for?', why: 'Tone follows it.' }
};

function source(respond = () => ok(REPLY)) {
  const backend = fakeFetch(respond);
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  const value: ReadingsSource = { api, link: { orgId: ORG, project: 'site' } };
  return { source: value, requests: backend.requests };
}

describe('readings route', () => {
  it('sends the typed words to the component and answers the readings and question', async () => {
    const { source: from, requests } = source();
    const reply = await planReadings(from, { page: 'home', component: 'hero', text: '  calm  ' });
    assert.deepEqual(reply, REPLY);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request!.method, 'POST');
    assert.equal(
      new URL(request!.url).pathname,
      `/v1/api/studio/orgs/${ORG}/projects/site/pages/home/components/hero/readings`
    );
    assert.deepEqual(request!.body, { text: 'calm' });
  });

  it('carries Swap: the readings kept without their plans, and the one to replace', async () => {
    const { source: from, requests } = source();
    await planReadings(from, {
      page: 'home',
      component: 'hero',
      text: 'calm',
      replace: 1,
      keep: REPLY.readings
    });
    assert.deepEqual(requests[0]!.body, {
      text: 'calm',
      replace: 1,
      keep: REPLY.readings.map(({ label, hypothesis }) => ({ label, hypothesis }))
    });
  });

  it('drops whatever else the page sent', () => {
    const parsed = parseReadings({
      page: 'home',
      component: 'hero',
      text: 'calm',
      repoRoot: 'C:/client-app',
      files: ['src/app/page.tsx'],
      keep: [{ label: 'Hushed', hypothesis: 'Quiet', plan: { x: 1 }, source: 'code' }]
    });
    assert.deepEqual(parsed, {
      page: 'home',
      component: 'hero',
      body: { text: 'calm', keep: [{ label: 'Hushed', hypothesis: 'Quiet' }] }
    });
  });

  it('refuses a body the backend would refuse, in words', () => {
    const bad: Record<string, unknown>[] = [
      { component: 'hero', text: 'calm' },
      { page: 'home', text: 'calm' },
      { page: 'home', component: 'hero', text: '   ' },
      { page: 'home', component: 'hero', text: 'x'.repeat(2001) },
      { page: 'home', component: 'hero', text: 'calm', replace: 3, keep: REPLY.readings },
      { page: 'home', component: 'hero', text: 'calm', replace: 1.5, keep: REPLY.readings },
      { page: 'home', component: 'hero', text: 'calm', keep: 'Hushed' },
      { page: 'home', component: 'hero', text: 'calm', keep: [{ label: '', hypothesis: 'x' }] },
      {
        page: 'home',
        component: 'hero',
        text: 'calm',
        keep: [...REPLY.readings, REPLY.readings[0]]
      },
      // Without Swap, three kept leaves nothing to draft; with it, the one replaced must be shown.
      { page: 'home', component: 'hero', text: 'calm', keep: REPLY.readings },
      {
        page: 'home',
        component: 'hero',
        text: 'calm',
        replace: 2,
        keep: REPLY.readings.slice(0, 2)
      }
    ];
    for (const body of bad) {
      assert.throws(() => parseReadings(body), BadRequest, JSON.stringify(body).slice(0, 80));
    }
  });

  it("passes the backend's refusal on", async () => {
    const { source: from } = source(() => refused('FORBIDDEN', 403, 'Viewers cannot plan.'));
    await assert.rejects(
      planReadings(from, { page: 'home', component: 'hero', text: 'calm' }),
      (error: unknown) => error instanceof ApiError && error.status === 403
    );
  });

  it('sends nothing when the body is refused', async () => {
    const { source: from, requests } = source();
    await assert.rejects(planReadings(from, { page: 'home', component: 'hero' }), BadRequest);
    assert.equal(requests.length, 0);
  });
});
