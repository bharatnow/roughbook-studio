// The local rules route (I3 of the chat audit): a rule goes to the backend's studio route with its
// scope and slugs and nothing else, and a rule naming a path on this machine never leaves.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { parseRule, saveRule, type RulesSource } from '../server/rules.js';
import { BadRequest } from '../server/studio.js';
import { fakeFetch, ok, refused } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const SAVED = { saved: true, scope: 'project', count: 1 };

function source(respond: Parameters<typeof fakeFetch>[0] = () => ok(SAVED)) {
  const backend = fakeFetch(respond);
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  const value: RulesSource = { api, link: { orgId: ORG, project: 'site' } };
  return { source: value, requests: backend.requests };
}

describe('rules route', () => {
  it('sends a component rule with its slugs to the project', async () => {
    const { source: from, requests } = source();
    const reply = await saveRule(from, {
      text: '  Always sentence case  ',
      scope: 'component',
      page: 'home',
      component: 'hero'
    });
    assert.deepEqual(reply, SAVED);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.method, 'POST');
    assert.equal(
      new URL(requests[0]!.url).pathname,
      `/v1/api/studio/orgs/${ORG}/projects/site/rules`
    );
    assert.deepEqual(requests[0]!.body, {
      text: 'Always sentence case',
      scope: 'component',
      page: 'home',
      component: 'hero'
    });
  });

  it('sends a project rule without the selection, and drops whatever else the page sent', () => {
    assert.deepEqual(
      parseRule({
        text: 'No gradients',
        scope: 'project',
        page: 'home',
        component: 'hero',
        repoRoot: 'C:/client-app',
        files: ['src/app/page.tsx']
      }),
      { text: 'No gradients', scope: 'project' }
    );
  });

  it('refuses a rule that names a path on this machine, and sends nothing', async () => {
    const { source: from, requests } = source();
    for (const path of ['C:\\client-app\\src\\hero.tsx', '/home/dana/brand.css', '~/brand.css']) {
      await assert.rejects(
        saveRule(from, { text: `Follow ${path}`, scope: 'project' }),
        (error: unknown) => error instanceof BadRequest && /path/.test(error.message)
      );
    }
    assert.equal(requests.length, 0);
  });

  it('refuses a body the backend would refuse, in words', () => {
    const bad: Record<string, unknown>[] = [
      { scope: 'project' },
      { text: '   ', scope: 'project' },
      { text: 'x'.repeat(301), scope: 'project' },
      { text: 'calm' },
      { text: 'calm', scope: 'page' },
      { text: 'calm', scope: 'component' },
      { text: 'calm', scope: 'component', page: 'home' },
      { text: 'calm', scope: 'component', page: 'home', component: 3 }
    ];
    for (const body of bad) {
      assert.throws(() => parseRule(body), BadRequest, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(parseRule({ text: 'x'.repeat(300), scope: 'project' }).text.length, 300);
  });

  it("passes the backend's refusal on", async () => {
    const message = 'This project has 12 rules. Remove one in its settings first.';
    const { source: from } = source(() => refused('CONFLICT', 409, message));
    await assert.rejects(
      saveRule(from, { text: 'calm', scope: 'project' }),
      (error: unknown) => error instanceof ApiError && error.status === 409
    );
  });
});
