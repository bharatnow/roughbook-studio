// Cursor's CLI, `agent` (its earlier name, `cursor-agent`, is still linked). Flags checked against
// Cursor's CLI reference (2026-10-11): `-p` prints and exits, `--output-format stream-json` gives
// one JSON event per line in Claude Code's shape, `--force` applies changes (without it they are
// only proposed), `--trust` takes the workspace without asking, `--sandbox enabled` runs its
// shell commands in Cursor's sandbox, `--workspace` names the folder, `--model` the model. It
// reports no token counts, so a run's usage is not measured. Unattended runs use the designer's
// own API key (CURSOR_API_KEY), never the browser login. The installer puts it in ~/.local/bin on
// macOS and Linux and in %LOCALAPPDATA%\cursor-agent on Windows. No Cursor CLI was installed
// where this was written: check the event names against the first real run.
import path from 'node:path';
import {
  findInDirs,
  findInstalled,
  findOnPath,
  fromEnv,
  windowsDataDirs
} from '../launch/which.js';
import { record, runCommand } from './command.js';
import type { ParsedLine, TerminalAdapter } from './types.js';

const NOT_FOUND =
  'Cursor CLI was not found. Install it (curl https://cursor.com/install -fsS | bash, or on Windows irm https://cursor.com/install?win32=true | iex), or set ROUGHBOOK_CURSOR_CLI_BIN to the full path of agent.';

function apiKey(env: NodeJS.ProcessEnv): string | null {
  return env.CURSOR_API_KEY?.trim() || null;
}

/** The write tools' names in a tool_call event, each keyed by its kind. */
const WRITE_TOOLS = ['writeToolCall', 'editToolCall', 'deleteToolCall'];

export function parseCursorLine(line: string): ParsedLine {
  let parsed: Record<string, unknown>;
  try {
    parsed = record(JSON.parse(line.trim()));
  } catch {
    return {};
  }
  switch (parsed.type) {
    case 'system':
      return parsed.subtype === 'init' && typeof parsed.session_id === 'string'
        ? { event: { kind: 'session', id: parsed.session_id } }
        : {};
    case 'assistant': {
      const content = record(parsed.message).content;
      for (const block of Array.isArray(content) ? content.map(record) : []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          return { event: { kind: 'message', text: block.text } };
        }
      }
      return {};
    }
    case 'tool_call': {
      const call = record(parsed.tool_call);
      const write = WRITE_TOOLS.find(name => name in call);
      if (write) {
        if (parsed.subtype !== 'completed') return {};
        const file = record(record(call[write]).args).path;
        return {
          event: { kind: 'file', name: typeof file === 'string' ? path.basename(file) : 'files' }
        };
      }
      if (parsed.subtype !== 'started') return {};
      const named = record(call.function).name;
      const kind = Object.keys(call)[0] ?? '';
      const name =
        typeof named === 'string'
          ? named
          : kind.replace(/ToolCall$/, '').replace(/^./, c => c.toUpperCase());
      return name ? { event: { kind: 'tool', name } } : {};
    }
    case 'result': {
      const text =
        typeof parsed.result === 'string' && parsed.result.trim() ? parsed.result.trim() : null;
      return {
        event: {
          kind: 'result',
          ok: parsed.subtype === 'success' && parsed.is_error !== true,
          text
        }
      };
    }
    default:
      return {};
  }
}

export const cursorCli: TerminalAdapter = {
  id: 'cursor-cli',
  name: 'Cursor CLI',
  kind: 'terminal',
  capabilities: { interactive: true, headless: true, permissions: false, usage: false },
  notFound: NOT_FOUND,

  find(lookup) {
    const explicit = fromEnv('ROUGHBOOK_CURSOR_CLI_BIN', lookup);
    if (explicit) return explicit;
    for (const name of ['agent', 'cursor-agent']) {
      const onPath = findOnPath(name, lookup);
      if (onPath) return { command: onPath, prefixArgs: [], source: 'PATH' };
    }
    if (lookup.platform === 'win32') {
      const dir = path.win32.join(windowsDataDirs(lookup).local, 'cursor-agent');
      const file = findInDirs('agent', [dir], lookup) ?? findInDirs('cursor-agent', [dir], lookup);
      return file ? { command: file, prefixArgs: [], source: dir } : null;
    }
    return findInstalled('agent', lookup) ?? findInstalled('cursor-agent', lookup);
  },

  async detect(lookup) {
    const base = {
      id: this.id,
      name: this.name,
      kind: this.kind,
      capabilities: this.capabilities
    } as const;
    const executable = this.find(lookup);
    if (!executable) {
      return {
        ...base,
        found: false,
        executable: null,
        version: null,
        signedIn: null,
        signIn: null,
        headless: { ready: false, reason: NOT_FOUND }
      };
    }
    const version = await runCommand(executable, ['--version']);
    const status = await runCommand(executable, ['status', '--format', 'json']);
    let signedIn: boolean | null = null;
    let signIn: string | null = null;
    try {
      const parsed = record(JSON.parse(status.stdout));
      const flag = [parsed.authenticated, parsed.loggedIn, parsed.isAuthenticated].find(
        value => typeof value === 'boolean'
      );
      if (typeof flag === 'boolean') signedIn = flag;
      else if (typeof parsed.email === 'string' || typeof parsed.user === 'string') signedIn = true;
      if (signedIn === true) {
        const who = parsed.email ?? record(parsed.user).email ?? parsed.user;
        signIn = typeof who === 'string' ? who : 'signed in';
      } else if (signedIn === false) signIn = 'not signed in';
    } catch {
      const said = (status.stdout || status.stderr).toLowerCase();
      if (/not (logged|signed) in|unauthenticated/.test(said)) {
        signedIn = false;
        signIn = 'not signed in';
      } else if (/logged in|signed in|authenticated/.test(said)) {
        signedIn = true;
        signIn = 'signed in';
      }
    }
    return {
      ...base,
      found: version.ok,
      executable,
      version: (version.stdout || version.stderr).trim().split(/\s+/).pop() || null,
      signedIn,
      signIn,
      headless: !version.ok
        ? { ready: false, reason: 'Cursor CLI could not be run.' }
        : apiKey(lookup.env)
          ? { ready: true }
          : {
              ready: false,
              reason:
                'Unattended runs use your own Cursor API key: set CURSOR_API_KEY. The browser login works for terminal sessions.'
            }
    };
  },

  interactiveArgs(run) {
    return [...(run.model ? ['--model', run.model] : []), run.instruction];
  },

  headless(run, executable, env) {
    if (!apiKey(env)) {
      return {
        refused:
          'Unattended runs use your own Cursor API key: set CURSOR_API_KEY, or run it in a terminal session.'
      };
    }
    return {
      command: executable.command,
      args: [
        ...executable.prefixArgs,
        '-p',
        '--output-format',
        'stream-json',
        '--force',
        '--trust',
        '--sandbox',
        'enabled',
        '--workspace',
        run.repoRoot,
        ...(run.model ? ['--model', run.model] : []),
        run.instruction
      ],
      cwd: run.repoRoot,
      stdin: null,
      env: {}
    };
  },

  parseLine: parseCursorLine
};
