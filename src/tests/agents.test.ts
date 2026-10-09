import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { claudeCode, headlessSettings, parseClaudeLine } from '../agents/claude.js';
import { codex, parseCodexLine } from '../agents/codex.js';
import { runHeadless } from '../agents/process.js';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { TerminalAdapter } from '../agents/types.js';
import type { Probe } from '../launch/platform.js';
import { manualCommand, planTerminal, sessionScript, type Session } from '../launch/terminal.js';
import type { Lookup } from '../launch/which.js';
import { browserArgs, findBrowser } from '../screenshot/browser.js';
import { checkPreview, previewProblem, screenshotIteration } from '../screenshot/iteration.js';
import type { RunRecord } from '../runs/types.js';

const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** A file system made of the paths given; folders are inferred from them. */
function probe(files: string[]): Probe {
  const all = new Set(files);
  return {
    exists: file => all.has(file),
    dirs: dir => {
      const sep = dir.includes('\\') ? '\\' : '/';
      const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
      const names = new Set<string>();
      for (const file of all) {
        if (file.startsWith(prefix)) {
          const rest = file.slice(prefix.length).split(sep);
          if (rest.length > 1) names.add(rest[0]!);
        }
      }
      return [...names];
    }
  };
}

function lookup(platform: NodeJS.Platform, files: string[], env: NodeJS.ProcessEnv = {}): Lookup {
  return {
    env,
    platform,
    home: platform === 'win32' ? 'C:\\Users\\a' : platform === 'darwin' ? '/Users/a' : '/home/a',
    node: platform === 'win32' ? 'C:\\node\\node.exe' : '/usr/bin/node',
    probe: probe(files)
  };
}

const RUN = {
  runId: RUN_ID,
  component: 'hero',
  iteration: 'iteration-03',
  targetFolder: 'rough/home/hero/iteration-03',
  promptFile: `rough/home/hero/prompts/${RUN_ID}.md`
} as RunRecord;

describe('finding agents', () => {
  it("finds Claude Code on PATH, as an npm script, natively, or in the desktop app's own folder", () => {
    const appData = 'C:\\Users\\a\\AppData\\Roaming';
    const desktop = `${appData}\\Claude\\claude-code\\2.1.286\\635c1867224a\\claude.exe`;
    const older = `${appData}\\Claude\\claude-code\\2.1.9\\claude.exe`;
    assert.deepEqual(claudeCode.find(lookup('win32', [desktop, older], { APPDATA: appData })), {
      command: desktop,
      prefixArgs: [],
      source: 'Claude desktop app'
    });
    assert.equal(
      claudeCode.find(
        lookup('win32', ['C:\\bin\\claude.exe', desktop], { APPDATA: appData, PATH: 'C:\\bin' })
      )?.command,
      'C:\\bin\\claude.exe'
    );
    const npmDir = 'C:\\Users\\a\\AppData\\Roaming\\npm';
    assert.deepEqual(
      claudeCode.find(
        lookup(
          'win32',
          [`${npmDir}\\claude.cmd`, `${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
          {
            PATH: npmDir
          }
        )
      ),
      {
        command: 'C:\\node\\node.exe',
        prefixArgs: [`${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
        source: 'npm'
      }
    );
    assert.equal(
      claudeCode.find(lookup('linux', ['/home/a/.local/bin/claude']))?.source,
      'native install'
    );
    assert.equal(
      claudeCode.find(lookup('linux', ['/opt/c'], { ROUGHBOOK_CLAUDE_BIN: '/opt/c' }))?.source,
      'ROUGHBOOK_CLAUDE_BIN'
    );
    assert.equal(claudeCode.find(lookup('darwin', [])), null);
  });

  it("finds the packaged Windows desktop app's copy, which a terminal sees only in the package folder", () => {
    const packaged =
      'C:\\Users\\a\\AppData\\Local\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude-code\\2.1.293\\83cb0bd7fed4\\claude.exe';
    const roaming =
      'C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2.1.289\\e1f0154146bb\\claude.exe';
    // No APPDATA or LOCALAPPDATA: Windows' defaults under the home folder are used.
    assert.deepEqual(claudeCode.find(lookup('win32', [packaged])), {
      command: packaged,
      prefixArgs: [],
      source: 'Claude desktop app'
    });
    // The newest version wins, whichever folder it is in.
    assert.equal(claudeCode.find(lookup('win32', [roaming, packaged]))?.command, packaged);
    assert.equal(
      claudeCode.find(lookup('win32', [roaming.replace('2.1.289', '2.1.300'), packaged]))?.command,
      roaming.replace('2.1.289', '2.1.300')
    );
  });

  it('finds installs that PATH misses: WinGet, npm, Homebrew, the old local install, Linux desktop', () => {
    const winget = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe';
    assert.deepEqual(claudeCode.find(lookup('win32', [winget])), {
      command: winget,
      prefixArgs: [],
      source: 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links'
    });
    const npmDir = 'C:\\Users\\a\\AppData\\Roaming\\npm';
    const cli = `${npmDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    assert.deepEqual(claudeCode.find(lookup('win32', [`${npmDir}\\claude.cmd`, cli]))?.prefixArgs, [
      cli
    ]);
    assert.equal(
      claudeCode.find(lookup('darwin', ['/opt/homebrew/bin/claude']))?.command,
      '/opt/homebrew/bin/claude'
    );
    const local = '/home/a/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js';
    assert.deepEqual(claudeCode.find(lookup('linux', [local])), {
      command: '/usr/bin/node',
      prefixArgs: [local],
      source: 'local install'
    });
    assert.equal(
      claudeCode.find(lookup('linux', ['/home/a/.config/Claude/claude-code/1.0.0/claude']))?.source,
      'Claude desktop app'
    );
    // PATH still comes first.
    assert.equal(
      claudeCode.find(lookup('darwin', ['/opt/homebrew/bin/claude', '/x/claude'], { PATH: '/x' }))
        ?.command,
      '/x/claude'
    );
  });

  it('finds Codex the same ways', () => {
    assert.equal(
      codex.find(lookup('linux', ['/usr/bin/codex'], { PATH: '/usr/bin' }))?.command,
      '/usr/bin/codex'
    );
    const npmDir = 'C:\\npm';
    assert.deepEqual(
      codex.find(
        lookup(
          'win32',
          [`${npmDir}\\codex.cmd`, `${npmDir}\\node_modules\\@openai\\codex\\bin\\codex.js`],
          { PATH: npmDir }
        )
      )?.prefixArgs,
      [`${npmDir}\\node_modules\\@openai\\codex\\bin\\codex.js`]
    );
    assert.equal(
      codex.find(lookup('darwin', ['/opt/homebrew/bin/codex']))?.command,
      '/opt/homebrew/bin/codex'
    );
    assert.equal(
      codex.find(lookup('linux', ['/home/a/.local/bin/codex']))?.source,
      'native install'
    );
    assert.equal(codex.find(lookup('linux', [])), null);
  });

  it('reports a missing agent without running anything', async () => {
    const found = await claudeCode.detect(lookup('linux', []));
    assert.deepEqual([found.found, found.headless.ready], [false, false]);
  });
});

describe('starting agents', () => {
  const executable = { command: '/usr/bin/claude', prefixArgs: [], source: 'PATH' };
  const target = runTarget('/repo', RUN, null);

  it('runs Claude Code headless on an API key only, confined to the run folder', () => {
    assert.ok('refused' in claudeCode.headless(target, executable, {}));
    const run = claudeCode.headless({ ...target, model: 'sonnet' }, executable, {
      ANTHROPIC_API_KEY: 'sk-ant-test'
    });
    assert.ok(!('refused' in run));
    assert.deepEqual(run.args.slice(0, 2), ['--bare', '-p']);
    const at = (flag: string) => run.args[run.args.indexOf(flag) + 1];
    assert.equal(at('--permission-mode'), 'dontAsk');
    assert.equal(at('--session-id'), RUN_ID);
    assert.equal(at('--model'), 'sonnet');
    assert.deepEqual(
      JSON.parse(at('--settings')!),
      headlessSettings('rough/home/hero/iteration-03')
    );
    assert.deepEqual(headlessSettings('rough/home/hero/iteration-03').permissions.allow, [
      'Edit(./rough/home/hero/iteration-03/**)'
    ]);
    assert.equal(
      run.args.at(-1),
      `Follow the instructions in rough/home/hero/prompts/${RUN_ID}.md`
    );
    assert.equal(run.cwd, '/repo');
    // The key comes from the designer's own environment; nothing is added.
    assert.deepEqual(run.env, {});
  });

  it('runs Codex headless in the run folder, on an API key only', () => {
    const exe = { command: '/usr/bin/codex', prefixArgs: [], source: 'PATH' };
    assert.ok('refused' in codex.headless(target, exe, {}));
    const run = codex.headless(target, exe, { OPENAI_API_KEY: 'sk-test' });
    assert.ok(!('refused' in run));
    const folder = path.join('/repo', 'rough', 'home', 'hero', 'iteration-03');
    assert.deepEqual(run.args, [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--cd',
      folder,
      '--skip-git-repo-check',
      '-'
    ]);
    assert.equal(run.cwd, folder);
    assert.deepEqual(run.env, { CODEX_API_KEY: 'sk-test' });
    assert.match(run.stdin!, /Follow the instructions in rough\/home\/hero\/prompts\//);
  });

  it('opens one terminal session per run, with its one-line instruction', () => {
    const sessions = terminalSessions(
      claudeCode,
      { command: 'C:\\node.exe', prefixArgs: ['C:\\cli.js'], source: 'npm' },
      '/repo',
      [RUN],
      null
    );
    assert.deepEqual(sessions, [
      {
        title: 'hero iteration-03',
        command: 'C:\\node.exe',
        args: [
          'C:\\cli.js',
          '--name',
          'hero iteration-03',
          `Follow the instructions in rough/home/hero/prompts/${RUN_ID}.md`
        ]
      }
    ]);
    assert.deepEqual(codex.interactiveArgs({ ...target, model: 'gpt-x' }), [
      '--model',
      'gpt-x',
      target.instruction
    ]);
  });
});

describe('reading agent output', () => {
  it("reads Claude Code's stream: the session, messages, tools, and the result with its tokens", () => {
    assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1"}'), {
      event: { kind: 'session', id: 's1' }
    });
    assert.deepEqual(
      parseClaudeLine(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]}}'
      ),
      { event: { kind: 'tool', name: 'Write' } }
    );
    const result = parseClaudeLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done.',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40
        },
        modelUsage: { 'claude-sonnet-5-5': {} }
      })
    );
    assert.deepEqual(result, {
      event: { kind: 'result', ok: true, text: 'Done.' },
      usage: {
        model: 'claude-sonnet-5-5',
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40
      }
    });
    assert.deepEqual(parseClaudeLine('not json'), {});
  });

  it("reads Codex's events, counting input without its cached part", () => {
    assert.deepEqual(parseCodexLine('{"type":"thread.started","thread_id":"t1"}'), {
      event: { kind: 'session', id: 't1' }
    });
    assert.deepEqual(
      parseCodexLine(
        '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":5}}'
      ).usage,
      { model: '', inputTokens: 40, outputTokens: 5, cacheReadTokens: 60, cacheWriteTokens: null }
    );
    assert.deepEqual(parseCodexLine('{"type":"turn.failed","error":{"message":"quota"}}').event, {
      kind: 'result',
      ok: false,
      text: 'quota'
    });
  });

  it('runs a headless agent without a shell, collects its tokens, and can stop it', async () => {
    const fake: TerminalAdapter = { ...claudeCode, name: 'Fake' };
    const script = [
      'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"s"}));',
      'console.log(JSON.stringify({type:"result",subtype:"success",result:"ok",usage:{input_tokens:3,output_tokens:4}}));'
    ].join('');
    const events: string[] = [];
    const done = await runHeadless(
      fake,
      { command: process.execPath, args: ['-e', script], cwd: os.tmpdir(), stdin: null, env: {} },
      { env: process.env, model: 'chosen-model', onEvent: event => events.push(event.kind) }
    );
    assert.deepEqual([done.ok, done.exitCode, events], [true, 0, ['session', 'result']]);
    assert.deepEqual(done.usage, {
      model: 'chosen-model',
      inputTokens: 3,
      outputTokens: 4,
      cacheReadTokens: null,
      cacheWriteTokens: null
    });

    const failed = await runHeadless(
      fake,
      {
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        cwd: os.tmpdir(),
        stdin: null,
        env: {}
      },
      { env: process.env, model: null }
    );
    assert.deepEqual(
      [failed.ok, failed.exitCode, failed.error],
      [false, 3, 'Fake exited with code 3.']
    );

    const controller = new AbortController();
    const running = runHeadless(
      fake,
      {
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        cwd: os.tmpdir(),
        stdin: null,
        env: {}
      },
      { env: process.env, model: null, signal: controller.signal }
    );
    setTimeout(() => controller.abort(), 200);
    const stopped = await running;
    assert.deepEqual([stopped.ok, stopped.cancelled], [false, true]);
  });
});

describe('terminals on every OS', () => {
  const session: Session = {
    title: 'hero iteration-03',
    command: '/usr/bin/claude',
    args: ['--name', 'hero iteration-03', 'Follow the instructions in rough/home/hero/prompts/x.md']
  };
  const winSession: Session = { ...session, command: 'C:\\bin\\claude.exe' };

  it('Windows: a Windows Terminal tab per session, or a console window each', () => {
    const wt = 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
    const tabs = planTerminal({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' },
      repoRoot: 'C:\\repo',
      sessions: [winSession, winSession],
      probe: probe([wt])
    });
    assert.equal(tabs.kind, 'spawn');
    assert.deepEqual(tabs.kind === 'spawn' && tabs.launches[0]!.args, [
      '-w',
      'new',
      'new-tab',
      '--title',
      'hero iteration-03',
      '-d',
      'C:\\repo',
      ...[winSession.command, ...winSession.args],
      ';',
      'new-tab',
      '--title',
      'hero iteration-03',
      '-d',
      'C:\\repo',
      ...[winSession.command, ...winSession.args]
    ]);
    const consoles = planTerminal({
      platform: 'win32',
      env: {},
      repoRoot: 'C:\\repo',
      sessions: [winSession],
      probe: probe([])
    });
    assert.ok(consoles.kind === 'spawn' && consoles.launches[0]!.verbatim);
    assert.equal(
      consoles.kind === 'spawn' && consoles.launches[0]!.args[0],
      '/d /s /c "start "hero iteration-03" /D "C:\\repo" "C:\\bin\\claude.exe" "--name" "hero iteration-03" "Follow the instructions in rough/home/hero/prompts/x.md""'
    );
  });

  it('macOS: a script Terminal (or iTerm) opens', () => {
    const plan = planTerminal({
      platform: 'darwin',
      env: {},
      repoRoot: '/Users/a/repo',
      sessions: [session]
    });
    assert.ok(plan.kind === 'scripts' && plan.app === 'Terminal');
    assert.equal(
      sessionScript('/Users/a/repo', session),
      "#!/bin/sh\n# hero iteration-03\ncd '/Users/a/repo' || exit 1\nexec '/usr/bin/claude' '--name' 'hero iteration-03' 'Follow the instructions in rough/home/hero/prompts/x.md'\n"
    );
    const iterm = planTerminal({
      platform: 'darwin',
      env: { ROUGHBOOK_TERMINAL: 'iterm' },
      repoRoot: '/r',
      sessions: [session]
    });
    assert.ok(iterm.kind === 'scripts' && iterm.app === 'iTerm');
  });

  it('Linux: $TERMINAL first, then the usual terminals, each told the folder its own way', () => {
    const env = { PATH: '/usr/bin' };
    const gnome = planTerminal({
      platform: 'linux',
      env,
      repoRoot: '/repo',
      sessions: [session],
      probe: probe(['/usr/bin/gnome-terminal'])
    });
    assert.deepEqual(gnome.kind === 'spawn' && gnome.launches[0]!.args, [
      '--title',
      'hero iteration-03',
      '--working-directory',
      '/repo',
      '--',
      session.command,
      ...session.args
    ]);
    const xterm = planTerminal({
      platform: 'linux',
      env,
      repoRoot: '/repo',
      sessions: [session],
      probe: probe(['/usr/bin/xterm', '/usr/bin/konsole'])
    });
    assert.equal(
      xterm.kind === 'spawn' && path.posix.basename(xterm.launches[0]!.command),
      'konsole'
    );
    const kitty = planTerminal({
      platform: 'linux',
      env: { ...env, TERMINAL: 'kitty' },
      repoRoot: '/repo',
      sessions: [session],
      probe: probe(['/usr/bin/kitty', '/usr/bin/xterm'])
    });
    assert.deepEqual(kitty.kind === 'spawn' && kitty.launches[0]!.args.slice(0, 4), [
      '--title',
      'hero iteration-03',
      '--directory',
      '/repo'
    ]);
    assert.equal(
      planTerminal({
        platform: 'linux',
        env,
        repoRoot: '/repo',
        sessions: [session],
        probe: probe([])
      }).kind,
      'manual'
    );
  });

  it('refuses anything a terminal could misread, and gives the command to paste', () => {
    const quoted = planTerminal({
      platform: 'linux',
      env: {},
      repoRoot: "/repo's",
      sessions: [session],
      probe: probe([])
    });
    assert.equal(quoted.kind, 'manual');
    const injected = planTerminal({
      platform: 'win32',
      env: {},
      repoRoot: 'C:\\repo',
      sessions: [{ ...winSession, args: ['x" & calc & "'] }],
      probe: probe([])
    });
    assert.equal(injected.kind, 'manual');
    assert.equal(
      manualCommand('linux', '/repo', session),
      `cd '/repo' && '/usr/bin/claude' '--name' 'hero iteration-03' 'Follow the instructions in rough/home/hero/prompts/x.md'`
    );
    assert.match(
      manualCommand('win32', 'C:\\repo', winSession),
      /^cd \/d "C:\\repo" && "C:\\bin\\claude\.exe"/
    );
  });
});

describe('screenshots', () => {
  it('finds Edge, Chrome or Chromium on each OS, or the one named', () => {
    const has = (file: string) => (candidate: string) => candidate === file;
    assert.equal(
      findBrowser(
        { ProgramFiles: 'C:\\PF' },
        has('C:\\PF\\Google\\Chrome\\Application\\chrome.exe'),
        'win32'
      ),
      'C:\\PF\\Google\\Chrome\\Application\\chrome.exe'
    );
    assert.equal(findBrowser({}, has('/snap/bin/chromium'), 'linux'), '/snap/bin/chromium');
    assert.equal(
      findBrowser({}, has('/Applications/Chromium.app/Contents/MacOS/Chromium'), 'darwin'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
    assert.equal(
      findBrowser({ ROUGHBOOK_BROWSER: '/x' }, () => false, 'linux'),
      null
    );
    assert.ok(browserArgs('/p').includes('--remote-debugging-pipe'));
  });

  it('takes desktop and phone screenshots through the preview route, into rough/.screenshots/', async () => {
    const taken: string[] = [];
    const shots = await screenshotIteration(
      '/repo',
      'http://localhost:3001',
      { page: 'home', component: 'hero', iteration: 'iteration-03' },
      {},
      async ({ url, size }) => {
        taken.push(`${url} ${size.width}`);
        return true;
      },
      '/usr/bin/chromium',
      async url => ({ status: 200, url })
    );
    assert.deepEqual(taken, [
      'http://localhost:3001/rough-preview/home/hero/iteration-03 1440',
      'http://localhost:3001/rough-preview/home/hero/iteration-03 390'
    ]);
    assert.deepEqual(shots, {
      files: {
        desktop: 'rough/.screenshots/home/hero/iteration-03/desktop.png',
        mobile: 'rough/.screenshots/home/hero/iteration-03/mobile.png'
      },
      warning: null
    });
    const none = await screenshotIteration(
      '/repo',
      'http://x',
      { page: 'a', component: 'b', iteration: 'iteration-01' },
      {},
      async () => true,
      null
    );
    assert.match(none.warning!, /ROUGHBOOK_BROWSER/);
  });

  it('asks the preview first, and photographs nothing behind a login, a redirect, a 404 or an error', async () => {
    const dev = 'http://localhost:3000';
    const url = `${dev}/rough-preview/home/hero/iteration-03`;
    assert.equal(previewProblem(url, dev, { status: 200, url }), null);
    assert.match(previewProblem(url, dev, null)!, /Nothing answered at http:\/\/localhost:3000/);
    assert.match(previewProblem(url, dev, { status: 401, url })!, /asks for a login .*HTTP 401/);
    assert.match(previewProblem(url, dev, { status: 403, url })!, /asks for a login .*HTTP 403/);
    assert.match(
      previewProblem(url, dev, { status: 200, url: `${dev}/sign-in?next=%2Frough-preview` })!,
      /sent the preview to \/sign-in/
    );
    assert.match(previewProblem(url, dev, { status: 404, url })!, /answered 404/);
    assert.match(previewProblem(url, dev, { status: 500, url })!, /HTTP 500.*may not render/);

    let took = 0;
    const gated = await screenshotIteration(
      '/repo',
      dev,
      { page: 'home', component: 'hero', iteration: 'iteration-03' },
      {},
      async () => {
        took += 1;
        return true;
      },
      '/usr/bin/chromium',
      async asked => ({ status: 401, url: asked })
    );
    assert.equal(took, 0);
    assert.deepEqual(gated.files, {});
    assert.match(gated.warning!, /asks for a login.*roughbook screenshot/);
  });

  it("reads the preview's real answer: a gate's 401, where a redirect lands, and nothing at all", async () => {
    const app = http.createServer((request, response) => {
      if (request.url === '/rough-preview/home/hero/iteration-01') {
        response.writeHead(401, { 'www-authenticate': 'Basic realm="Private preview"' }).end();
      } else if (request.url === '/rough-preview/home/hero/iteration-02') {
        response.writeHead(307, { location: '/sign-in' }).end();
      } else {
        response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Sign in</p>');
      }
    });
    await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
    const { port } = app.address() as AddressInfo;
    try {
      const base = `http://127.0.0.1:${port}/rough-preview/home/hero`;
      assert.deepEqual(await checkPreview(`${base}/iteration-01`), {
        status: 401,
        url: `${base}/iteration-01`
      });
      assert.deepEqual(await checkPreview(`${base}/iteration-02`), {
        status: 200,
        url: `http://127.0.0.1:${port}/sign-in`
      });
    } finally {
      await new Promise(resolve => app.close(resolve));
    }
    assert.equal(
      await checkPreview(`http://127.0.0.1:${port}/rough-preview/x/y/iteration-01`),
      null
    );
  });
});
