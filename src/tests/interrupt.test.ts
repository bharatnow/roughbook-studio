// An interrupted studio starts nothing more: Ctrl+C or SIGTERM closes what a command started,
// while the command's own steps go on until the process exits, so a step after the interrupt must
// not start a server or a browser that would outlive the studio. In a file of its own, since the
// refusal holds for the rest of the process.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { catchInterrupts } from '../commands/index.js';
import {
  processesRefused,
  runCapture,
  runToEnd,
  runVisible,
  serveUntil,
  trackProcess,
  type Stoppable
} from '../launch/processes.js';
import { KeptBrowser, takeScreenshot } from '../screenshot/browser.js';
import { tempDir } from './helpers.js';

/** A started process as the studio keeps it in hand: a pid nothing signals, and its exit. */
function fakeChild(pid: number) {
  return Object.assign(new EventEmitter(), { pid, exitCode: null as number | null, kill() {} });
}

describe('an interrupted studio', () => {
  it('stops what it started before it exits, and starts no process or browser after', async () => {
    // A process the command started, stopped by a stand-in so no real pid is signalled.
    const stopped: number[] = [];
    trackProcess(fakeChild(201), async (child: Stoppable) => {
      stopped.push(child.pid!);
      const fake = child as ReturnType<typeof fakeChild>;
      fake.exitCode = 1;
      fake.emit('exit');
    });
    const exits: number[] = [];
    let atExit: number[] | null = null;
    let exited!: () => void;
    const exiting = new Promise<void>(resolve => (exited = resolve));
    const host = Object.assign(new EventEmitter(), {
      exit(code: number) {
        exits.push(code);
        atExit = [...stopped];
        exited();
      }
    });
    // As main has it: the kept browsers closed, the started processes stopped, nothing after.
    const interrupts = catchInterrupts(host);
    assert.equal(processesRefused(), false);
    host.emit('SIGTERM');
    await exiting;
    interrupts.release();
    assert.deepEqual(exits, [143]);
    assert.deepEqual(atExit, [201], 'stopped before the exit');
    assert.equal(processesRefused(), true);

    const cwd = await tempDir('roughbook-interrupt-');
    const mark = path.join(cwd, 'ran.txt');
    const line = `node -e "require('fs').writeFileSync('ran.txt', 'x')"`;
    assert.deepEqual(await runToEnd(line, cwd, 10_000), { code: null });
    const captured = await runCapture(line, cwd, 10_000);
    assert.equal(captured.code, null);
    assert.match(captured.output, /interrupted, so the command was not started/);
    assert.equal(await runVisible(line, cwd), 130);
    assert.equal(await serveUntil(line, cwd, 'http://127.0.0.1:9/', 10_000), null);
    assert.equal(fs.existsSync(mark), false, 'no command ran');

    let spawned = 0;
    const browser = new KeptBrowser('/fake/chrome', {
      spawn: () => {
        spawned += 1;
        throw new Error('not reached');
      },
      profiles: path.join(cwd, 'browsers')
    });
    const shot = await takeScreenshot({
      browser,
      url: 'http://localhost:3000/rough-preview/home/hero/iteration-01',
      file: path.join(cwd, 'shot.png'),
      size: { width: 1440, height: 900, mobile: false },
      overlays: []
    });
    assert.equal(shot, false);
    assert.equal(spawned, 0, 'no browser was started');
    assert.equal(fs.existsSync(path.join(cwd, 'browsers')), false, 'no profile was made');
  });
});
