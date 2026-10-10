import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS, main } from '../commands/index.js';
import { writeJsonAtomic } from '../fs/json.js';
import { hostPlatform } from '../launch/platform.js';
import { serverCommand, thisStudio } from '../mcp/install.js';
import { saveRun } from '../runs/store.js';
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

  it('serves MCP on its own stdin and stdout, which carry protocol messages only', async () => {
    const repo = await tempDir();
    await writeJsonAtomic(path.join(repo, 'rough', 'roughbook.json'), {
      version: 1,
      orgId: '11111111-1111-4111-8111-111111111111',
      project: 'site',
      roughCommitted: true,
      appDir: null
    });
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await saveRun(repo, {
      runId,
      orgId: '11111111-1111-4111-8111-111111111111',
      project: 'site',
      page: 'home',
      component: 'hero',
      iteration: 'iteration-01',
      parent: null,
      kind: 'generate',
      agent: 'vscode',
      mode: 'editor',
      targetFolder: 'rough/home/hero/iteration-01',
      promptFile: `rough/home/hero/prompts/${runId}.md`,
      checks: [],
      startedAt: new Date(0).toISOString(),
      status: 'started',
      finishedAt: null,
      outcome: null,
      failure: null,
      warnings: [],
      outOfScope: [],
      reported: null
    });
    // Started as an editor starts it, from what mcp install writes, in the repo.
    const server = serverCommand({
      platform: hostPlatform(),
      node: process.execPath,
      ...thisStudio()
    });
    const messages = [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'list_runs', arguments: {} } }
    ];
    const result = spawnSync(server.command, server.args, {
      cwd: repo,
      env: { ...process.env, ROUGHBOOK_CONFIG_DIR: path.join(repo, 'config') },
      input: messages
        .map(message => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
        .join(''),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const answers = result.stdout
      .trimEnd()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.deepEqual(
      answers.map(answer => answer.id),
      [1, 2, 3]
    );
    assert.equal(answers[0].result.serverInfo.version, version);
    assert.deepEqual(
      answers[1].result.tools.map((tool: { name: string }) => tool.name),
      ['list_runs', 'get_prompt', 'get_checks', 'finish_run']
    );
    const listed = JSON.parse(answers[2].result.content[0].text);
    assert.deepEqual(
      listed.runs.map((run: { run: string; iteration: string }) => [run.run, run.iteration]),
      [[runId, 'home/hero/iteration-01']]
    );
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
