import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runContent, runDoing } from './content-states.ts';
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

const ENDED = { ...RUN, status: 'finished' as const, finishedAt: '2026-10-15T09:10:00.000Z' };

describe("an iteration's content, from its run", () => {
  it('says an open run is being made, with no stage the studio does not know', () => {
    assert.deepEqual(runContent({ pending: true, run: RUN }), { kind: 'generating', stage: null });
    // A refinement over files that exist is being made too.
    assert.deepEqual(runContent({ pending: false, run: RUN }), { kind: 'generating', stage: null });
  });

  it("says a failed run's iteration was not made, in its failure's words", () => {
    const failed = {
      ...ENDED,
      outcome: 'failed' as const,
      failure: { code: 'no-files', message: 'The agent wrote no files. ' }
    };
    assert.deepEqual(runContent({ pending: true, run: failed }), {
      kind: 'generation-failed',
      message: 'The agent wrote no files.'
    });
    // Without a failure, the unattended agent's error; without either, no words of its own.
    const headless = { status: 'finished' as const, lines: [], error: 'Exited with code 1' };
    assert.deepEqual(runContent({ pending: true, run: { ...failed, failure: null, headless } }), {
      kind: 'generation-failed',
      message: 'Exited with code 1'
    });
    assert.deepEqual(runContent({ pending: true, run: { ...failed, failure: null } }), {
      kind: 'generation-failed',
      message: null
    });
  });

  it('says a cancelled run was stopped', () => {
    assert.deepEqual(runContent({ pending: true, run: { ...ENDED, outcome: 'cancelled' } }), {
      kind: 'generation-failed',
      message: null,
      stopped: true
    });
  });

  it('says nothing of a made iteration, a run that completed, or no run', () => {
    assert.equal(runContent({ pending: false, run: { ...ENDED, outcome: 'failed' } }), undefined);
    assert.equal(
      runContent({ pending: false, run: { ...ENDED, outcome: 'completed' } }),
      undefined
    );
    assert.equal(runContent({ pending: true, run: { ...ENDED, outcome: 'completed' } }), undefined);
    assert.equal(runContent({ pending: true, run: null }), undefined);
  });
});

describe('what the run card says while its agent works', () => {
  it('says the agent is making it while its terminal or the unattended agent runs', () => {
    const terminal = {
      id: 't1',
      runId: 'r1',
      title: 'iteration-03',
      status: 'running' as const,
      exitCode: null,
      stopped: false,
      startedAt: RUN.startedAt
    };
    assert.equal(runDoing({ ...RUN, terminal }), 'Your agent is making it');
    assert.equal(
      runDoing({ ...RUN, headless: { status: 'running', lines: ['Reading'], error: null } }),
      'Your agent is making it'
    );
  });

  it('says nothing once the agent stopped, or the run finished', () => {
    assert.equal(runDoing(RUN), null);
    assert.equal(
      runDoing({ ...ENDED, headless: { status: 'running', lines: [], error: null } }),
      null
    );
  });
});
