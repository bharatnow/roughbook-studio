import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finishedBy, runFinishedSince, runWord } from './runs.ts';
import type { RunView } from './types.ts';

const RUN: RunView = {
  runId: 'r1',
  page: 'home',
  component: 'hero',
  iteration: 'iteration-03',
  parent: null,
  kind: 'generate',
  agent: 'claude-code',
  mode: 'interactive',
  promptFile: 'rough/home/hero/prompts/r1.md',
  startedAt: '2026-10-15T09:00:00.000Z',
  status: 'started',
  finishedAt: null,
  outcome: null,
  failure: null,
  warnings: [],
  outOfScope: [],
  reported: null,
  terminal: null,
  headless: null
};

describe('how a run is said', () => {
  it('says an open run is working while its agent runs, and waiting for Done after', () => {
    const terminal = {
      id: 't1',
      runId: 'r1',
      title: 'iteration-03',
      status: 'running' as const,
      exitCode: null,
      stopped: false,
      startedAt: RUN.startedAt
    };
    assert.equal(runWord({ ...RUN, terminal }), 'Working');
    assert.equal(
      runWord({ ...RUN, headless: { status: 'running', lines: [], error: null } }),
      'Working'
    );
    assert.equal(
      runWord({ ...RUN, terminal: { ...terminal, status: 'exited', exitCode: 0 } }),
      'Waiting'
    );
    assert.equal(runWord(RUN), 'Waiting');
  });

  it('says how a finished run ended in one word', () => {
    const done = { ...RUN, status: 'finished' as const, finishedAt: '2026-10-15T09:20:00.000Z' };
    assert.equal(runWord({ ...done, outcome: 'completed' }), 'Completed');
    assert.equal(runWord({ ...done, outcome: 'completed_with_warnings' }), 'Completed');
    assert.equal(runWord({ ...done, outcome: 'failed' }), 'Failed');
    assert.equal(runWord({ ...done, outcome: 'cancelled' }), 'Cancelled');
    assert.equal(runWord({ ...done, outcome: null }), 'Finished');
  });

  it('says who finished it in one word, with the sentence for its tooltip', () => {
    assert.deepEqual(finishedBy({ ...RUN, finishedBy: 'agent' }), {
      word: 'Agent',
      sentence: 'The agent finished it through the Roughbook MCP tools.'
    });
    assert.equal(finishedBy({ ...RUN, finishedBy: 'done' })?.word, 'Command');
    assert.equal(finishedBy({ ...RUN, finishedBy: 'local-ui' })?.word, 'Studio');
    assert.equal(finishedBy({ ...RUN, finishedBy: 'headless' })?.word, 'Unattended');
    assert.equal(finishedBy(RUN), null);
  });
});

describe('a run finishing', () => {
  it('is heard once, between two reads of the runs', () => {
    const open = { runId: 'r1', status: 'started' as const };
    const done = { runId: 'r1', status: 'finished' as const };
    assert.equal(runFinishedSince([], [done]), false);
    assert.equal(runFinishedSince([open], [open]), false);
    assert.equal(runFinishedSince([open], [done]), true);
    assert.equal(runFinishedSince([done], [done]), false);
  });
});
