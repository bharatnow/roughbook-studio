import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROJECT } from './canvas-fixture.ts';
import { HOST_VERBS, currentPick, verbHostActions } from './verbs-host.ts';

const target = { project: 'site', page: 'home', component: 'hero', iteration: 'iteration-02' };

function host(answer: unknown = { ok: true, message: 'Done.' }, fail = false) {
  const sent: [string, unknown][] = [];
  let refreshed = 0;
  const actions = verbHostActions({
    post: async <T>(path: string, body?: unknown) => {
      sent.push([path, body]);
      if (fail) throw new Error('The studio is not running.');
      return answer as T;
    },
    project: () => PROJECT,
    refresh: async () => {
      refreshed += 1;
    },
    place: () => ({ agent: 'codex' })
  });
  return { actions, sent, refreshed: () => refreshed };
}

describe("the studio host's verbs", () => {
  it('serves the verbs the local server runs', () => {
    assert.deepEqual([...HOST_VERBS], ['more', 'different', 'polish', 'not-this', 'pick-this']);
    assert.equal(host().actions.verbs, HOST_VERBS);
  });

  it('posts a verb with its fields, the project, where it runs, and reads the project again', async () => {
    const { actions, sent, refreshed } = host();
    assert.deepEqual(await actions.runVerb('different', target, { howFar: 'wild' }), {
      ok: true,
      message: 'Done.'
    });
    assert.deepEqual(sent, [
      [
        '/api/iterations/home/hero/iteration-02/verbs/different',
        { howFar: 'wild', project: 'site', agent: 'codex' }
      ]
    ]);
    assert.equal(refreshed(), 1);
  });

  it('sends the pick before Pick this one, for its undo', async () => {
    assert.equal(currentPick(PROJECT, 'home', 'hero'), 'iteration-01');
    assert.equal(currentPick(PROJECT, 'home', 'features'), null);
    const { actions, sent } = host();
    await actions.runVerb('pick-this', target);
    assert.equal((sent[0]![1] as { previous?: string }).previous, 'iteration-01');
  });

  it('answers a failure in words, and refuses a verb it does not run', async () => {
    assert.deepEqual(await host(undefined, true).actions.runVerb('more', target), {
      ok: false,
      message: 'The studio is not running.',
      undo: null
    });
    const { actions, sent } = host();
    assert.equal((await actions.runVerb('wrong', target)).ok, false);
    assert.equal(sent.length, 0);
  });

  it('takes a verb back through the undo route', async () => {
    const { actions, sent, refreshed } = host({ ok: true, message: 'Took back Not this.' });
    const undo = { kind: 'unreject' as const, label: 'Not this', target };
    assert.deepEqual(await actions.undoVerb(undo), { ok: true, message: 'Took back Not this.' });
    assert.deepEqual(sent, [['/api/verbs/undo', undo]]);
    assert.equal(refreshed(), 1);
  });
});
