import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Decision } from '../runs/reviews.js';
import type { RunBody, RunView } from './studio.js';
import {
  STUDIO_SERVED_VERBS,
  launchWords,
  undoRunPlan,
  verbRoutes,
  verbRun,
  type VerbStudio
} from './verbs.js';

const target = { page: 'home', component: 'hero', iteration: 'iteration-02' };

function run(over: Partial<RunView> = {}): RunView {
  return {
    runId: 'run-1',
    orgId: 'org',
    project: 'site',
    page: 'home',
    component: 'hero',
    iteration: 'iteration-07',
    parent: 'iteration-02',
    kind: 'fork',
    agent: 'claude-code',
    mode: 'interactive',
    targetFolder: 'rough/home/hero/iteration-07',
    promptFile: 'rough/prompts/run-1.md',
    checks: [],
    startedAt: '2026-10-28T10:00:00.000Z',
    status: 'started',
    finishedAt: null,
    outcome: null,
    failure: null,
    warnings: [],
    outOfScope: [],
    reported: null,
    terminal: null,
    headless: null,
    ...over
  } as RunView;
}

describe('the plain verbs, run here', () => {
  it('serves every verb but What’s wrong?, which the web keeps (decision 41)', () => {
    assert.deepEqual(
      [...STUDIO_SERVED_VERBS],
      ['more', 'different', 'polish', 'not-this', 'pick-this']
    );
  });

  it('starts More like this as a fork, its words optional', () => {
    assert.deepEqual(verbRun('more', target, {}), {
      kind: 'run',
      body: {
        page: 'home',
        component: 'hero',
        mode: 'interactive',
        kind: 'fork',
        parent: 'iteration-02'
      }
    });
    assert.deepEqual(verbRun('more', target, { words: '  warmer photo ' }), {
      kind: 'run',
      body: {
        page: 'home',
        component: 'hero',
        mode: 'interactive',
        kind: 'fork',
        parent: 'iteration-02',
        intent: { remain: [], change: 'warmer photo' }
      }
    });
  });

  it('starts Something different as a clean start, or a nearer fork for a nearer How far', () => {
    const body = (fields: Record<string, string>) => {
      const answer = verbRun('different', target, fields);
      return answer.kind === 'run' ? answer.body : null;
    };
    assert.equal((body({}) as { radical?: boolean }).radical, true);
    assert.equal((body({ howFar: 'wild' }) as { radical?: boolean }).radical, true);
    assert.match(
      (body({ howFar: 'wild' }) as { intent?: { change: string } }).intent!.change,
      /wildly different/
    );
    const near = body({ howFar: 'conservative' }) as {
      radical?: boolean;
      intent?: { change: string };
    };
    assert.equal(near.radical, undefined);
    assert.match(near.intent!.change, /a little different/);
    assert.match(
      (body({ howFar: 'balanced' }) as { intent?: { change: string } }).intent!.change,
      /quite different/
    );
  });

  it('starts Polish as a refinement with the polish preset and its focus', () => {
    const answer = verbRun('polish', target, {});
    assert.equal(answer.kind, 'run');
    const body = (answer as { body: RunBody & { preset: string; intent: string } }).body;
    assert.equal(body.kind, 'refine');
    assert.equal(body.preset, 'polish');
    assert.ok(body.intent.length > 0);
  });

  it('takes the agent and where it runs from the page, and runs interactively by default', () => {
    const answer = verbRun('more', target, {
      agent: 'codex',
      mode: 'headless',
      terminal: 'external'
    });
    assert.deepEqual(
      answer.kind === 'run' && [answer.body.agent, answer.body.mode, answer.body.terminal],
      ['codex', 'headless', 'external']
    );
    const odd = verbRun('more', target, { mode: 'sideways' });
    assert.equal(odd.kind === 'run' && odd.body.mode, 'interactive');
  });

  it('decides Not this and Pick this one at once', () => {
    assert.deepEqual(verbRun('not-this', target, { reasonPreset: 'Too generic' }), {
      kind: 'decide',
      decision: { kind: 'reject', reason: 'Too generic' }
    });
    assert.deepEqual(
      verbRun('not-this', target, { reasonPreset: 'Custom', reasonCustom: ' Off-brand photo ' }),
      { kind: 'decide', decision: { kind: 'reject', reason: 'Off-brand photo' } }
    );
    assert.equal(verbRun('not-this', target, {}).kind, 'refused');
    assert.equal(verbRun('not-this', target, { reasonPreset: 'Custom' }).kind, 'refused');
    assert.deepEqual(verbRun('pick-this', target, { reason: ' Clearest ' }), {
      kind: 'decide',
      decision: { kind: 'select', reason: 'Clearest' }
    });
  });

  it('refuses What’s wrong?, Use in my code and anything else here', () => {
    for (const verb of ['wrong', 'use', 'fork', '']) {
      assert.equal(verbRun(verb, target, {}).kind, 'refused', verb);
    }
  });

  it('cancels a run whose agent has not started, and stops one that has (decision 33)', () => {
    assert.equal(undoRunPlan(undefined), 'archive');
    assert.equal(undoRunPlan(run()), 'cancel');
    assert.equal(
      undoRunPlan(run({ terminal: { status: 'running' } as RunView['terminal'] })),
      'stop'
    );
    assert.equal(
      undoRunPlan(run({ headless: { status: 'running', lines: [], error: null } })),
      'stop'
    );
    assert.equal(undoRunPlan(run({ status: 'finished' })), 'archive');
  });

  it('says where a run started', () => {
    assert.equal(
      launchWords({ kind: 'builtin', terminals: [] }),
      'Its agent is at work in the terminal below.'
    );
    assert.equal(
      launchWords({ kind: 'external', terminal: 'Windows Terminal' }),
      'Its agent is at work in Windows Terminal.'
    );
    assert.equal(launchWords({ kind: 'headless' }), 'Its agent is at work unattended.');
    assert.equal(
      launchWords({ kind: 'manual', reason: 'No terminal app.', commands: ['claude "…"'] }),
      'No terminal app. Run this in a terminal: claude "…"'
    );
  });
});

/** A studio that keeps what the verbs asked of it. */
function fakeStudio(runs: RunView[] = []) {
  const calls: unknown[][] = [];
  const studio: VerbStudio = {
    async startRuns(body) {
      calls.push(['startRuns', body]);
      return {
        runs: [{ ...run(), iteration: 'iteration-09' }],
        launched: { kind: 'builtin', terminals: [] }
      };
    },
    async runs() {
      return runs;
    },
    stopRun(runId) {
      calls.push(['stopRun', runId]);
      return true;
    },
    async done(runId, outcome) {
      calls.push(['done', runId, outcome]);
      return null as never;
    },
    async decide(goal, decision: Decision) {
      calls.push(['decide', goal, decision]);
      return { status: 'sent' as const };
    }
  };
  return { studio, calls };
}

function handler(studio: VerbStudio, path: string) {
  const found = verbRoutes(studio).find(item => item.path === path);
  assert.ok(found, path);
  return found.handle;
}

describe('the verbs’ local routes', () => {
  const VERB = '/api/iterations/:page/:component/:iteration/verbs/:verb';
  const UNDO = '/api/verbs/undo';
  const params = { ...target, verb: 'more' };

  it('has a route for a verb and one for its undo', () => {
    assert.deepEqual(
      verbRoutes(fakeStudio().studio).map(item => [item.method, item.path]),
      [
        ['POST', VERB],
        ['POST', UNDO]
      ]
    );
  });

  it('starts a run and offers it back', async () => {
    const { studio, calls } = fakeStudio();
    const result = await handler(studio, VERB)(params, {});
    assert.equal(calls[0]![0], 'startRuns');
    assert.deepEqual(result, {
      ok: true,
      message:
        'Making one more like iteration-02 as iteration-09. Its agent is at work in the terminal below.',
      made: ['iteration-09'],
      undo: {
        kind: 'discard',
        label: 'More like this',
        target: { project: '', ...target, iteration: 'iteration-09' }
      }
    });
  });

  it('sets aside and picks, each with its undo', async () => {
    const { studio, calls } = fakeStudio();
    const rejected = await handler(studio, VERB)(
      { ...params, verb: 'not-this' },
      {
        reasonPreset: 'Too dense'
      }
    );
    assert.deepEqual(calls.at(-1), ['decide', target, { kind: 'reject', reason: 'Too dense' }]);
    assert.deepEqual(rejected, {
      ok: true,
      message: 'Set iteration-02 aside: Too dense.',
      undo: { kind: 'unreject', label: 'Not this', target: { project: '', ...target } }
    });
    // Undo of a pick picks again what was picked before, or clears the pick.
    const picked = await handler(studio, VERB)(
      { ...params, verb: 'pick-this' },
      {
        previous: 'iteration-01'
      }
    );
    assert.deepEqual(calls.at(-1), ['decide', target, { kind: 'select', reason: '' }]);
    assert.deepEqual((picked as { undo: unknown }).undo, {
      kind: 'unselect',
      label: 'Pick this one',
      target: { project: '', ...target, iteration: 'iteration-01' }
    });
    const first = await handler(studio, VERB)({ ...params, verb: 'pick-this' }, {});
    assert.deepEqual((first as { undo: { target: unknown } }).undo.target, {
      project: '',
      ...target
    });
    // The pick already: nothing is sent, since sending would clear it.
    const count = calls.length;
    const again = await handler(studio, VERB)(
      { ...params, verb: 'pick-this' },
      {
        previous: 'iteration-02'
      }
    );
    assert.deepEqual(again, { ok: true, message: 'iteration-02 is the pick already.', undo: null });
    assert.equal(calls.length, count);
  });

  it('answers a refusal in words, sending nothing', async () => {
    const { studio, calls } = fakeStudio();
    const answer = await handler(studio, VERB)({ ...params, verb: 'wrong' }, {});
    assert.equal((answer as { ok: boolean }).ok, false);
    assert.equal(calls.length, 0);
  });

  it('takes a verb back: unreject, unselect, and a run cancelled or stopped, then archived', async () => {
    const making = run({ iteration: 'iteration-09' });
    const { studio, calls } = fakeStudio([making]);
    const undo = handler(studio, UNDO);
    const at = { project: 'site', ...target };
    assert.deepEqual(await undo({}, { kind: 'unreject', label: 'Not this', target: at }), {
      ok: true,
      message: 'Took back Not this.'
    });
    assert.deepEqual(calls.at(-1), ['decide', target, { kind: 'unreject' }]);
    await undo({}, { kind: 'unselect', label: 'Pick this one', target: at });
    assert.deepEqual(calls.at(-1), ['decide', target, { kind: 'select', reason: '' }]);

    calls.length = 0;
    const nine = { ...at, iteration: 'iteration-09' };
    await undo({}, { kind: 'discard', label: 'More like this', target: nine });
    assert.deepEqual(calls, [
      ['done', 'run-1', 'cancelled'],
      ['decide', { ...target, iteration: 'iteration-09' }, { kind: 'discard' }]
    ]);

    const working = fakeStudio([
      { ...making, terminal: { status: 'running' } as RunView['terminal'] }
    ]);
    await handler(working.studio, UNDO)({}, { kind: 'discard', label: 'Polish', target: nine });
    assert.deepEqual(working.calls, [
      ['stopRun', 'run-1'],
      ['decide', { ...target, iteration: 'iteration-09' }, { kind: 'discard' }]
    ]);
  });

  it('refuses an undo it cannot read', async () => {
    const { studio } = fakeStudio();
    const answer = await handler(studio, UNDO)({}, { kind: 'delete-review', label: 'x', target });
    assert.equal((answer as { ok: boolean }).ok, false);
    const bad = await handler(studio, UNDO)(
      {},
      { kind: 'unreject', label: 'x', target: { page: '..' } }
    );
    assert.equal((bad as { ok: boolean }).ok, false);
  });
});
