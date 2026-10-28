// The studio's activity indicator (A8 step 5 of ROUGHBOOK-APPLE-PLAN.md): Terminals records when
// each session last printed and any bell since the last keystroke, and activityOf reads the open
// runs and their sessions as idle, working, waiting (silence, decision 37) or attention (a bell).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PtyModule } from '../launch/pty.js';
import { QUIET_MS, activityOf, type ActivityRun } from './activity.js';
import { Terminals } from './terminals.js';

type Spawned = { emit(data: string): void; exit(code: number): void; written: string[] };

/** A pseudo-terminal that runs nothing, as in server.test.ts: it says what it is told. */
function fakePty(): { module: PtyModule; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const module: PtyModule = {
    spawn() {
      const onData: ((data: string) => void)[] = [];
      const onExit: ((event: { exitCode: number }) => void)[] = [];
      const record: Spawned = {
        written: [],
        emit: data => onData.forEach(listener => listener(data)),
        exit: exitCode => onExit.forEach(listener => listener({ exitCode }))
      };
      spawned.push(record);
      return {
        pid: spawned.length,
        onData: listener => (onData.push(listener), { dispose() {} }),
        onExit: listener => (onExit.push(listener), { dispose() {} }),
        write: data => void record.written.push(data),
        resize: () => {},
        kill: () => record.exit(1)
      };
    }
  };
  return { module, spawned };
}

/** A clock the test moves by hand. */
function clock(start = Date.parse('2026-10-28T10:00:00Z')) {
  let now = start;
  return {
    now: () => new Date(now),
    ms: () => now,
    tick: (ms: number) => void (now += ms)
  };
}

function setup() {
  const pty = fakePty();
  const time = clock();
  const terminals = new Terminals(pty.module, time.now);
  const start = (runId: string | null) =>
    terminals.start({ title: 't', command: 'agent', args: [], cwd: '.', env: {}, runId });
  return { pty, time, terminals, start };
}

const open = (runId: string, over: Partial<ActivityRun> = {}): ActivityRun => ({
  runId,
  status: 'started',
  mode: 'interactive',
  headless: null,
  ...over
});

describe('Terminals: when each session last printed, and its bells', () => {
  it('starts with no output and no bell, and records the time of each print', () => {
    const { pty, time, terminals, start } = setup();
    const info = start('run-1');
    let [activity] = terminals.activity();
    assert.equal(activity!.lastOutputAt, null);
    assert.equal(activity!.bell, false);
    assert.equal(activity!.runId, 'run-1');
    time.tick(5_000);
    pty.spawned[0]!.emit('thinking…');
    [activity] = terminals.activity();
    assert.equal(activity!.lastOutputAt, time.ms());
    assert.equal(activity!.id, info.id);
  });

  it('hears a plain bell, OSC 9 and OSC 777, until the next keystroke', () => {
    for (const ring of [
      'Done?\u0007',
      '\u001b]9;Claude needs your permission\u0007',
      '\u001b]777;notify;Claude;Waiting for input\u001b\\'
    ]) {
      const { pty, terminals, start } = setup();
      const info = start('run-1');
      pty.spawned[0]!.emit(ring);
      assert.equal(terminals.activity()[0]!.bell, true, JSON.stringify(ring));
      terminals.receive(info.id, JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
      assert.equal(terminals.activity()[0]!.bell, true, 'a resize is not a keystroke');
      terminals.receive(info.id, JSON.stringify({ type: 'input', data: 'y' }));
      assert.equal(terminals.activity()[0]!.bell, false, JSON.stringify(ring));
    }
  });

  it('does not take a title, a progress report or a split sequence for a bell', () => {
    const { pty, terminals, start } = setup();
    start('run-1');
    const session = pty.spawned[0]!;
    session.emit('\u001b]0;✳ Claude Code\u0007');
    session.emit('\u001b]2;title\u001b\\');
    session.emit('\u001b]9;4;1;50\u0007');
    session.emit('\u001b]0;half a ti');
    session.emit('tle\u0007 and on');
    assert.equal(terminals.activity()[0]!.bell, false);
    // A notification split across two prints is still heard.
    session.emit('\u001b]9;Need');
    assert.equal(terminals.activity()[0]!.bell, false);
    session.emit('s you\u0007');
    assert.equal(terminals.activity()[0]!.bell, true);
  });
});

describe('activityOf', () => {
  it('is idle with no open run, and ignores sessions of no run or of a finished run', () => {
    const { pty, time, terminals, start } = setup();
    assert.deepEqual(activityOf([], [], { now: time.ms() }), {
      state: 'idle',
      where: null,
      runId: null
    });
    start(null);
    start('run-old');
    pty.spawned[0]!.emit('dev server ready');
    pty.spawned[1]!.emit('\u0007');
    const runs = [open('run-old', { status: 'finished' })];
    assert.equal(activityOf(runs, terminals.activity(), { now: time.ms() }).state, 'idle');
  });

  it('works while a session prints, waits after a silence, and asks after a bell', () => {
    const { pty, time, terminals, start } = setup();
    start('run-1');
    const session = pty.spawned[0]!;
    const read = () => activityOf([open('run-1')], terminals.activity(), { now: time.ms() });

    assert.deepEqual(read(), { state: 'working', where: 'builtin', runId: 'run-1' });
    time.tick(QUIET_MS - 1);
    assert.equal(read().state, 'working', 'a fresh session has not been silent long');
    time.tick(1);
    assert.equal(read().state, 'waiting', 'silent since it started');
    session.emit('…');
    assert.equal(read().state, 'working');
    time.tick(QUIET_MS);
    assert.equal(read().state, 'waiting');
    session.emit('\u0007');
    assert.equal(read().state, 'attention');
    time.tick(QUIET_MS * 10);
    assert.equal(read().state, 'attention');
  });

  it('says attention over waiting over working, across several runs', () => {
    const { pty, time, terminals, start } = setup();
    start('run-1');
    start('run-2');
    start('run-3');
    time.tick(QUIET_MS);
    pty.spawned[0]!.emit('busy');
    const runs = [open('run-1'), open('run-2'), open('run-3')];
    let activity = activityOf(runs, terminals.activity(), { now: time.ms() });
    assert.deepEqual([activity.state, activity.runId], ['waiting', 'run-2']);
    pty.spawned[2]!.emit('\u001b]9;Waiting\u0007');
    activity = activityOf(runs, terminals.activity(), { now: time.ms() });
    assert.deepEqual([activity.state, activity.runId], ['attention', 'run-3']);
  });

  it('reads an exited session as idle, and a headless job as working', () => {
    const { pty, time, terminals, start } = setup();
    start('run-1');
    pty.spawned[0]!.exit(0);
    assert.equal(
      activityOf([open('run-1')], terminals.activity(), { now: time.ms() }).state,
      'idle'
    );
    const headless = open('run-2', { mode: 'headless', headless: { status: 'running' } });
    assert.deepEqual(activityOf([headless], [], { now: time.ms() }), {
      state: 'working',
      where: 'headless',
      runId: 'run-2'
    });
    const done = open('run-2', { mode: 'headless', headless: { status: 'finished' } });
    assert.equal(activityOf([done], [], { now: time.ms() }).state, 'idle');
  });

  it('says where a run it cannot hear is: the designer’s own terminal or editor', () => {
    const { time } = setup();
    assert.deepEqual(activityOf([open('run-1')], [], { now: time.ms() }), {
      state: 'idle',
      where: 'terminal',
      runId: 'run-1'
    });
    assert.deepEqual(activityOf([open('run-2', { mode: 'editor' })], [], { now: time.ms() }), {
      state: 'idle',
      where: 'editor',
      runId: 'run-2'
    });
  });

  it('prefers a run it can hear over one it cannot', () => {
    const { time, terminals, start } = setup();
    start('run-2');
    const runs = [open('run-1', { mode: 'editor' }), open('run-2')];
    assert.deepEqual(activityOf(runs, terminals.activity(), { now: time.ms() }), {
      state: 'working',
      where: 'builtin',
      runId: 'run-2'
    });
  });
});
