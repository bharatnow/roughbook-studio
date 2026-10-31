// The local understand route (I1 of the chat audit): the page's words go to the backend's studio
// route with the mode and the selection's slugs, a typed path leaves as a stand-in and comes back
// in the answer, and nothing else goes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StudioApi, type UnderstandReply } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { readKeptPaths } from '../runs/keptPaths.js';
import { BadRequest } from '../server/studio.js';
import { parseUnderstand, understandMessage, type UnderstandSource } from '../server/understand.js';
import { fakeFetch, ok, refused, tempDir } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PATH = 'C:\\client-app\\src\\hero.tsx';
const REPLY: UnderstandReply = {
  read: true,
  intent: 'make',
  target: { page: 'home', component: 'hero', iteration: null },
  targetName: 'Hero',
  directions: ['Calm'],
  instructions: '',
  assumptions: [],
  confidence: 'high',
  question: null,
  reply: null,
  rule: null,
  ruleScope: null,
  requestId: null,
  credits: 1,
  upToCredits: 0
};

function source(respond: Parameters<typeof fakeFetch>[0] = () => ok(REPLY)) {
  const backend = fakeFetch(respond);
  const api = new StudioApi({
    server: 'https://api.example.test',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  const value: UnderstandSource = { api, link: { orgId: ORG, project: 'site' } };
  return { source: value, requests: backend.requests };
}

describe('understand route', () => {
  it('sends the words, the mode and the selection to the project', async () => {
    const { source: from, requests } = source();
    const reply = await understandMessage(from, {
      words: '  calm  ',
      mode: 'new',
      page: 'home',
      component: 'hero',
      iteration: null
    });
    assert.deepEqual(reply, REPLY);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request!.method, 'POST');
    assert.equal(
      new URL(request!.url).pathname,
      `/v1/api/studio/orgs/${ORG}/projects/site/understand`
    );
    assert.deepEqual(request!.body, {
      words: 'calm',
      mode: 'new',
      page: 'home',
      component: 'hero'
    });
  });

  it('sends a message with nothing selected', () => {
    assert.deepEqual(
      parseUnderstand({ words: 'hello', mode: 'new', page: null, component: null }).body,
      { words: 'hello', mode: 'new' }
    );
  });

  it('sends a path as its stand-in and puts it back in every line of the answer', async () => {
    const standIn = '[local path 1]';
    const { source: from, requests } = source(() =>
      ok({
        ...REPLY,
        directions: [`Follow ${standIn}`],
        instructions: `See ${standIn}`,
        assumptions: [`You meant ${standIn}`],
        question: { text: `Is it ${standIn}?`, options: [standIn, 'No'] },
        reply: `Read ${standIn}`,
        rule: `Never use ${standIn}`
      })
    );
    const reply = await understandMessage(from, { words: `like ${PATH} please`, mode: 'refine' });
    assert.equal(JSON.stringify(requests[0]!.body).includes('client-app'), false);
    assert.deepEqual(requests[0]!.body, { words: `like ${standIn} please`, mode: 'refine' });
    assert.deepEqual(reply.directions, [`Follow ${PATH}`]);
    assert.equal(reply.instructions, `See ${PATH}`);
    assert.deepEqual(reply.assumptions, [`You meant ${PATH}`]);
    assert.deepEqual(reply.question, { text: `Is it ${PATH}?`, options: [PATH, 'No'] });
    assert.equal(reply.reply, `Read ${PATH}`);
    assert.equal(reply.rule, `Never use ${PATH}`);
  });

  it('keeps the paths of a message that left a line, for the history', async () => {
    const line = '22222222-2222-4222-8222-222222222222';
    const repoRoot = await tempDir('roughbook-understand-');
    const kept = source(() => ok({ ...REPLY, requestId: line }));
    await understandMessage({ ...kept.source, repoRoot }, { words: `like ${PATH}`, mode: 'new' });
    assert.deepEqual(await readKeptPaths(repoRoot), { [line]: { '[local path 1]': PATH } });

    const drawn = await tempDir('roughbook-understand-');
    const none = source();
    await understandMessage(
      { ...none.source, repoRoot: drawn },
      { words: `like ${PATH}`, mode: 'new' }
    );
    assert.deepEqual(await readKeptPaths(drawn), {});
  });

  it('reads an older backend that says nothing of a rule as no rule', async () => {
    const { rule: _rule, ...older } = REPLY;
    const { source: from } = source(() => ok(older));
    assert.equal((await understandMessage(from, { words: 'calm', mode: 'new' })).rule, null);
  });

  it('drops whatever else the page sent', () => {
    const { body } = parseUnderstand({
      words: 'calm',
      mode: 'fork',
      repoRoot: 'C:/client-app',
      files: ['src/app/page.tsx']
    });
    assert.deepEqual(body, { words: 'calm', mode: 'fork' });
  });

  it('refuses a body the backend would refuse, in words', () => {
    const bad: Record<string, unknown>[] = [
      { mode: 'new' },
      { words: '   ', mode: 'new' },
      { words: 'x'.repeat(4001), mode: 'new' },
      { words: 'calm' },
      { words: 'calm', mode: 'draw' },
      { words: 'calm', mode: 'new', page: 3 },
      { words: 'calm', mode: 'new', component: ' ' },
      { words: 'calm', mode: 'new', iteration: 'x'.repeat(201) }
    ];
    for (const body of bad) {
      assert.throws(() => parseUnderstand(body), BadRequest, JSON.stringify(body).slice(0, 80));
    }
  });

  it("passes the backend's refusal on", async () => {
    const { source: from } = source(() => refused('PAYMENT_REQUIRED', 402, 'No credits left.'));
    await assert.rejects(
      understandMessage(from, { words: 'calm', mode: 'new' }),
      (error: unknown) => error instanceof ApiError && error.status === 402
    );
  });

  it('sends nothing when the body is refused', async () => {
    const { source: from, requests } = source();
    await assert.rejects(understandMessage(from, { mode: 'new' }), BadRequest);
    assert.equal(requests.length, 0);
  });
});
