import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, main } from '../commands/index.js';
import { recordingIo, tempDir } from './helpers.js';

const version = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

describe('the command line', () => {
  it('shows help, the version, and refuses a command it does not know', async () => {
    const cwd = await tempDir();
    const help = recordingIo();
    assert.equal(await main([], { cwd, env: {}, io: help }), 0);
    assert.match(help.lines[0]!, /^Roughbook studio /);
    for (const command of COMMANDS) {
      assert.ok(help.lines.some(line => line.includes(command.usage)));
    }

    const shown = recordingIo();
    assert.equal(await main(['--version'], { cwd, env: {}, io: shown }), 0);
    assert.deepEqual(shown.lines, [version]);

    const unknown = recordingIo();
    assert.equal(await main(['frobnicate'], { cwd, env: {}, io: unknown }), 2);
    assert.match(unknown.errors[0]!, /Unknown command: frobnicate/);
  });

  it('runs as a program from cli.ts, through tsx as in development', () => {
    const cli = fileURLToPath(new URL('../cli.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, '--version'], {
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), version);
  });
});
