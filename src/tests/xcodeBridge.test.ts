// Xcode's MCP bridge (A13 step 2 of the Apple plan): `roughbook mcp install --xcode`, and the
// offer `init` and `setup` make a SwiftUI or Xcode repo. This machine has no Xcode: darwin is
// faked, and `xcrun --find mcpbridge` answers through the injected runCommand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AgentAdapter, Detection } from '../agents/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { takesXcodeBridge } from '../commands/mcp.js';
import { saveCredentials } from '../config/credentials.js';
import type { Executable } from '../launch/which.js';
import { RECIPES } from '../recipes/index.js';
import { XCODE_BRIDGE_MISSING, XCODE_BRIDGE_NEEDS, findXcodeBridge } from '../launch/xcode.js';
import type { RepoLink } from '../repo/link.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const AGENT_BIN = '/usr/local/bin/claude';
const BRIDGE_PATH =
  '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/mcpbridge';
const BRIDGE_ENTRY = { command: 'xcrun', args: ['mcpbridge'] };

const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(root, ...file.split('/')), text);
};
const readJsonFile = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

function found(adapter: AgentAdapter): Detection {
  return {
    ...notFound(adapter),
    found: true,
    executable: { command: AGENT_BIN, prefixArgs: [], source: 'PATH' },
    version: '2.1.286'
  };
}

type Options = {
  platform?: NodeJS.Platform;
  /** What `xcrun --find mcpbridge` prints, or null when it fails. */
  bridge?: string | null;
  answers?: (string | null)[];
  routes?: Record<string, () => ReturnType<typeof ok>>;
};

/** A signed-in studio over `repo` with Claude Code and Cursor found, Codex not. */
async function studio(repo: string, options: Options = {}) {
  const configDir = await tempDir('roughbook-config-');
  const home = await tempDir('roughbook-home-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  const routes = options.routes ?? {};
  const fake = fakeFetch(request => {
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route() : refused('NOT_FOUND', 404);
  });
  const io = recordingIo(options.answers ?? []);
  const commands: string[][] = [];
  const bridge = options.bridge === undefined ? BRIDGE_PATH : options.bridge;
  const overrides: Partial<MainOptions> = {
    fetch: fake.fetch,
    platform: options.platform ?? 'darwin',
    home,
    detect: async adapter =>
      ['claude-code', 'cursor'].includes(adapter.id) ? found(adapter) : notFound(adapter),
    runCommand: async (executable: Executable, args: string[]) => {
      commands.push([executable.command, ...args]);
      if (executable.command === 'xcrun') {
        return bridge === null
          ? { ok: false, stdout: '', stderr: 'xcrun: error: unable to find utility', code: 72 }
          : { ok: true, stdout: `${bridge}\n`, stderr: '', code: 0 };
      }
      return { ok: true, stdout: '', stderr: '', code: 0 };
    },
    launchTerminal: async () => {},
    launchEditor: async () => {},
    copyText: async () => true
  };
  const run = (argv: string[]) =>
    main(argv, { cwd: repo, env: { ROUGHBOOK_CONFIG_DIR: configDir }, io, ...overrides });
  const cursorFile = path.posix.join(home, '.cursor', 'mcp.json');
  return { io, run, commands, home, cursorFile };
}

const xcodeAdds = (commands: string[][]) =>
  commands.filter(command => command.includes('xcode') && command.includes('add'));

describe('which repos take Xcode MCP bridge', () => {
  it('is the recipe that says so, by its id or as the family an Xcode project has', () => {
    assert.deepEqual(
      RECIPES.filter(recipe => recipe.xcodeBridge).map(recipe => recipe.id),
      ['swiftui']
    );
    // A Swift package names the recipe; an Xcode project has only the family.
    assert.equal(takesXcodeBridge({ recipe: 'swiftui', family: 'swiftui' }), true);
    assert.equal(takesXcodeBridge({ recipe: null, family: 'swiftui' }), true);
    assert.equal(takesXcodeBridge({ recipe: 'next', family: 'react-like' }), false);
    assert.equal(takesXcodeBridge({ recipe: null, family: 'markup-css' }), false);
    assert.equal(takesXcodeBridge({ family: 'compose' }), false);
    assert.equal(takesXcodeBridge({}), false);
  });
});

describe('finding Xcode MCP bridge', () => {
  it('asks xcrun on a Mac only, and takes the first line it prints', async () => {
    const asked: string[][] = [];
    const run = async (executable: Executable, args: string[]) => {
      asked.push([executable.command, ...args]);
      return { ok: true, stdout: `${BRIDGE_PATH}\n`, stderr: '', code: 0 };
    };
    assert.equal(await findXcodeBridge('darwin', run), BRIDGE_PATH);
    assert.deepEqual(asked, [['xcrun', '--find', 'mcpbridge']]);
    for (const platform of ['win32', 'linux'] as const) {
      assert.equal(await findXcodeBridge(platform, run), null);
    }
    assert.equal(asked.length, 1, 'xcrun is never run off macOS');
    const failing = async () => ({ ok: false, stdout: '', stderr: 'no', code: 72 });
    assert.equal(await findXcodeBridge('darwin', failing), null);
    const silent = async () => ({ ok: true, stdout: '  \n', stderr: '', code: 0 });
    assert.equal(await findXcodeBridge('darwin', silent), null);
  });
});

describe('roughbook mcp install --xcode', () => {
  it("adds xcode beside roughbook for Claude Code, Codex and Cursor, in each one's own form, once", async () => {
    const repo = await tempDir('roughbook-xcode-');
    const { io, run, commands, home, cursorFile } = await studio(repo);
    write(home, '.cursor/mcp.json', '{ "mcpServers": { "other": { "command": "x" } } }');
    const code = await run([
      'mcp',
      'install',
      'claude-code',
      'codex',
      'cursor',
      'vscode',
      '--xcode'
    ]);
    // Codex is not here, so its lines are to paste: 1, as without --xcode.
    assert.equal(code, 1, io.lines.join('\n'));
    assert.deepEqual(
      commands.filter(command => command.includes('xcode') || command[0] === 'xcrun'),
      [
        ['xcrun', '--find', 'mcpbridge'],
        [AGENT_BIN, 'mcp', 'remove', '--scope', 'user', 'xcode'],
        [AGENT_BIN, 'mcp', 'add', '--scope', 'user', 'xcode', '--', 'xcrun', 'mcpbridge']
      ]
    );
    assert.ok(io.lines.includes('Claude Code: added xcode with claude mcp add.'));
    assert.ok(io.lines.includes('  codex mcp add xcode -- xcrun mcpbridge'), io.lines.join('\n'));
    const cursor = readJsonFile(cursorFile);
    assert.deepEqual(Object.keys(cursor.mcpServers), ['other', 'roughbook', 'xcode']);
    assert.deepEqual(cursor.mcpServers.xcode, BRIDGE_ENTRY);
    assert.ok(io.lines.includes(`Cursor: xcode added to ${cursorFile}`));
    // VS Code gets roughbook only, and says why.
    const vscodeFile = path.posix.join(
      home,
      'Library',
      'Application Support',
      'Code',
      'User',
      'mcp.json'
    );
    assert.deepEqual(Object.keys(readJsonFile(vscodeFile).servers), ['roughbook']);
    assert.ok(
      io.lines.includes("VS Code: Xcode's bridge is added only for Claude Code, Codex and Cursor.")
    );
    assert.ok(
      io.lines.includes(`The xcode server hands the agent Xcode's tools. ${XCODE_BRIDGE_NEEDS}`)
    );
    assert.match(XCODE_BRIDGE_NEEDS, /Xcode must be running with the project open/);
    assert.match(XCODE_BRIDGE_NEEDS, /Settings > Intelligence/);

    // Again: Cursor's file is as it was, and Claude Code's entry replaced, never doubled.
    io.lines.length = 0;
    const before = fs.readFileSync(cursorFile, 'utf8');
    assert.equal(await run(['mcp', 'install', 'cursor', '--xcode']), 0);
    assert.equal(fs.readFileSync(cursorFile, 'utf8'), before);
    assert.ok(io.lines.includes(`Cursor: xcode already in ${cursorFile}`));
  });

  it('shows the lines to paste with --print, and writes nothing', async () => {
    const repo = await tempDir('roughbook-xcode-');
    const { io, run, commands, cursorFile } = await studio(repo);
    assert.equal(await run(['mcp', 'install', 'claude-code', 'cursor', '--xcode', '--print']), 0);
    assert.ok(!fs.existsSync(cursorFile));
    assert.deepEqual(xcodeAdds(commands), []);
    const lines = io.lines.map(line => line.trim());
    assert.ok(lines.includes('claude mcp add --scope user xcode -- xcrun mcpbridge'));
    assert.ok(lines.includes('"xcode": {'), lines.join('\n'));
  });

  it('off a Mac, or where xcrun cannot find it, adds roughbook alone and says so in one line', async () => {
    for (const options of [{ platform: 'win32' as const }, { bridge: null }]) {
      const repo = await tempDir('roughbook-xcode-');
      const { io, run, commands, cursorFile } = await studio(repo, options);
      assert.equal(await run(['mcp', 'install', 'claude-code', 'cursor', '--xcode']), 0);
      assert.deepEqual(xcodeAdds(commands), []);
      assert.deepEqual(Object.keys(readJsonFile(cursorFile).mcpServers), ['roughbook']);
      assert.equal(io.lines.filter(line => /xcode/i.test(line)).length, 1, io.lines.join('\n'));
      assert.ok(io.lines.includes(XCODE_BRIDGE_MISSING));
      assert.equal(
        XCODE_BRIDGE_MISSING,
        "Xcode's MCP bridge needs Xcode 26.3 or later on a Mac, so it was not added."
      );
      if (options.platform === 'win32') {
        assert.ok(!commands.some(command => command[0] === 'xcrun'), 'xcrun is not asked');
      }
    }
  });

  it('without --xcode, adds nothing for Xcode and never asks xcrun', async () => {
    const repo = await tempDir('roughbook-xcode-');
    const { run, commands, cursorFile } = await studio(repo);
    assert.equal(await run(['mcp', 'install', 'claude-code', 'cursor']), 0);
    assert.ok(!commands.some(command => command[0] === 'xcrun'));
    assert.deepEqual(Object.keys(readJsonFile(cursorFile).mcpServers), ['roughbook']);
  });
});

const linkRoute = () =>
  ok(
    { linkId: 'link-1', org: { id: ORG, name: 'Acme' }, project: { slug: 'site', name: 'Site' } },
    201
  );
const projectsRoute = () =>
  ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }]);
const SETUP_PROMPT = {
  prompt: '<task>\nSet this repo up for Roughbook previews.\n</task>\n',
  placeholders: {
    contract: '{{roughbook:contract}}',
    guess: '{{roughbook:guess}}',
    recipeNotes: '{{roughbook:recipe-notes}}',
    ruleFiles: '{{roughbook:rule-files}}'
  }
};
const INIT_ROUTES = {
  'GET /projects': projectsRoute,
  [`POST /orgs/${ORG}/links`]: linkRoute,
  [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT)
};

/** An Xcode app project: no Package.swift, so no recipe, and the setup run fits it. */
async function xcodeRepo(): Promise<string> {
  const repo = path.join(await tempDir('roughbook-xcode-'), 'app');
  write(repo, 'Glow.xcodeproj/project.pbxproj', '// !$*UTF8*$!\n{}\n');
  write(repo, 'Glow/GlowApp.swift', 'import SwiftUI\n\n@main\nstruct GlowApp: App {}\n');
  return repo;
}

const bridgeQuestion = (questions: string[]) =>
  questions.filter(question => question.startsWith("Add Xcode's MCP bridge"));

describe("init and setup offer Xcode's bridge", () => {
  it('init asks a SwiftUI repo on a Mac, and a yes adds it to the agents found', async () => {
    const repo = await xcodeRepo();
    // The project, commit rough/, apply, yes to the bridge, no to the setup run.
    const { io, run, commands, cursorFile } = await studio(repo, {
      routes: INIT_ROUTES,
      answers: ['1', '', '', 'y', 'n']
    });
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    const [question] = bridgeQuestion(io.questions);
    assert.ok(question, io.questions.join('\n'));
    assert.match(question, /to Claude Code, Cursor,/);
    assert.match(question, /Xcode must be running with the project open/);
    assert.match(question, /\[y\/N\] $/);
    assert.deepEqual(xcodeAdds(commands), [
      [AGENT_BIN, 'mcp', 'add', '--scope', 'user', 'xcode', '--', 'xcrun', 'mcpbridge']
    ]);
    assert.deepEqual(readJsonFile(cursorFile).mcpServers, { xcode: BRIDGE_ENTRY });
  });

  it('init adds nothing on a no, with nobody to answer, under --yes, or off a Mac', async () => {
    const cases: Options[] = [
      { answers: ['1', '', '', 'n', 'n'] },
      { answers: ['1', '', ''] },
      { platform: 'win32', answers: ['1', '', '', 'n'] },
      { bridge: null, answers: ['1', '', '', 'n'] }
    ];
    for (const options of cases) {
      const repo = await xcodeRepo();
      const { io, run, commands, cursorFile } = await studio(repo, {
        routes: INIT_ROUTES,
        ...options
      });
      assert.equal(await run(['init']), 0, io.errors.join('\n'));
      assert.deepEqual(xcodeAdds(commands), []);
      assert.ok(!fs.existsSync(cursorFile));
      const asked = bridgeQuestion(io.questions).length;
      assert.equal(asked, options.platform || options.bridge === null ? 0 : 1);
    }
    const repo = await xcodeRepo();
    const { io, run, commands } = await studio(repo, { routes: INIT_ROUTES });
    assert.equal(await run(['init', '--project', 'site', '--yes', '--no-setup']), 0);
    assert.deepEqual(bridgeQuestion(io.questions), []);
    assert.deepEqual(xcodeAdds(commands), []);
  });

  it('init does not ask a repo that is not SwiftUI', async () => {
    const repo = path.join(await tempDir('roughbook-xcode-'), 'app');
    write(repo, 'Gemfile', 'source "https://rubygems.org"\ngem "rails", "~> 8.0"\n');
    const { io, run, commands } = await studio(repo, {
      routes: INIT_ROUTES,
      answers: ['1', '', '', 'n']
    });
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    assert.deepEqual(bridgeQuestion(io.questions), []);
    assert.ok(!commands.some(command => command[0] === 'xcrun'));
  });

  it('setup asks a linked SwiftUI repo before the setup run, and a yes adds it', async () => {
    const repo = await xcodeRepo();
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: null,
      stack: ['swift'],
      family: 'swiftui'
    };
    write(repo, 'rough/roughbook.json', JSON.stringify(link));
    const { io, run, commands, cursorFile } = await studio(repo, {
      routes: INIT_ROUTES,
      answers: ['y']
    });
    assert.equal(await run(['setup']), 0, io.errors.join('\n'));
    assert.equal(bridgeQuestion(io.questions).length, 1);
    assert.equal(xcodeAdds(commands).length, 1);
    assert.deepEqual(readJsonFile(cursorFile).mcpServers, { xcode: BRIDGE_ENTRY });
    assert.ok(io.lines.some(line => line.startsWith('Setup run: ')));

    // No, and nothing is added; the setup run still starts.
    const other = await studio(repo, { routes: INIT_ROUTES, answers: ['n'] });
    assert.equal(await other.run(['setup']), 0, other.io.errors.join('\n'));
    assert.deepEqual(xcodeAdds(other.commands), []);
    assert.ok(
      other.io.lines.includes(
        "Xcode's bridge was not added. roughbook mcp install --xcode adds it later."
      )
    );
  });
});
