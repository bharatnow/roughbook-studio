// Claude Code. Flags checked against `claude --help` in Claude Code 2.1.286 (2026-10-05), and
// the permission rules against its permissions docs: `--permission-mode` no longer takes
// "default", so a headless run uses "dontAsk", which refuses anything not allowed instead of
// asking, with one allow rule for the run's folder. `--bare` makes the CLI use only an Anthropic
// API key (ANTHROPIC_API_KEY), never a claude.ai login, which is the split plan's rule for
// unattended runs. The stream-json field names follow its docs; check them against the first
// real headless run.
import path from 'node:path';
import {
  compareVersions,
  findNpmScript,
  findOnPath,
  fromEnv,
  type Lookup
} from '../launch/which.js';
import { diskProbe } from '../launch/platform.js';
import { count, record, runCommand } from './command.js';
import type { ParsedLine, TerminalAdapter } from './types.js';

const NOT_FOUND =
  'Claude Code was not found. Install it, or set ROUGHBOOK_CLAUDE_BIN to the full path of claude.';

/** The copy the Claude desktop app keeps: <data>/Claude/claude-code/<version>/[<build>/]claude. */
function desktopCopy(lookup: Lookup): string | null {
  const windows = lookup.platform === 'win32';
  const p = windows ? path.win32 : path.posix;
  const probe = lookup.probe ?? diskProbe;
  const data = windows
    ? lookup.env.APPDATA
    : lookup.platform === 'darwin'
      ? p.join(lookup.home, 'Library', 'Application Support')
      : null;
  if (!data) return null;
  const root = p.join(data, 'Claude', 'claude-code');
  const executable = windows ? 'claude.exe' : 'claude';
  for (const version of probe.dirs(root).sort((a, b) => compareVersions(b, a))) {
    const direct = p.join(root, version, executable);
    if (probe.exists(direct)) return direct;
    for (const build of probe.dirs(p.join(root, version))) {
      const nested = p.join(root, version, build, executable);
      if (probe.exists(nested)) return nested;
    }
  }
  return null;
}

/** What a headless run may do: write its folder; never run commands, fetch, or read secrets. */
export function headlessSettings(targetFolder: string) {
  return {
    permissions: {
      allow: [`Edit(./${targetFolder}/**)`],
      deny: [
        'Bash',
        'PowerShell',
        'WebFetch',
        'WebSearch',
        'Read(./.env)',
        'Read(./.env.*)',
        'Read(./**/.env)',
        'Read(./**/.env.*)'
      ]
    }
  };
}

export function parseClaudeLine(line: string): ParsedLine {
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
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          return { event: { kind: 'tool', name: block.name } };
        }
      }
      return {};
    }
    case 'result': {
      const usage = record(parsed.usage);
      const models = Object.keys(record(parsed.modelUsage));
      const text =
        typeof parsed.result === 'string' && parsed.result.trim() ? parsed.result.trim() : null;
      return {
        event: {
          kind: 'result',
          ok: parsed.subtype === 'success' && parsed.is_error !== true,
          text
        },
        usage: {
          model: models[0] ?? '',
          inputTokens: count(usage.input_tokens),
          outputTokens: count(usage.output_tokens),
          cacheReadTokens: count(usage.cache_read_input_tokens),
          cacheWriteTokens: count(usage.cache_creation_input_tokens)
        }
      };
    }
    default:
      return {};
  }
}

export const claudeCode: TerminalAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  kind: 'terminal',
  capabilities: { interactive: true, headless: true, permissions: true, usage: true },
  notFound: NOT_FOUND,

  find(lookup) {
    const p = lookup.platform === 'win32' ? path.win32 : path.posix;
    const probe = lookup.probe ?? diskProbe;
    const explicit = fromEnv('ROUGHBOOK_CLAUDE_BIN', lookup);
    if (explicit) return explicit;
    const onPath = findOnPath('claude', lookup);
    if (onPath) return { command: onPath, prefixArgs: [], source: 'PATH' };
    const npm = findNpmScript('claude', '@anthropic-ai/claude-code', 'cli.js', lookup);
    if (npm) return npm;
    const native = p.join(
      lookup.home,
      '.local',
      'bin',
      lookup.platform === 'win32' ? 'claude.exe' : 'claude'
    );
    if (probe.exists(native)) return { command: native, prefixArgs: [], source: 'native install' };
    const desktop = desktopCopy(lookup);
    return desktop ? { command: desktop, prefixArgs: [], source: 'Claude desktop app' } : null;
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
    let signedIn: boolean | null = null;
    let signIn: string | null = null;
    const status = await runCommand(executable, ['auth', 'status', '--json']);
    try {
      const parsed = record(JSON.parse(status.stdout));
      if (typeof parsed.loggedIn === 'boolean') signedIn = parsed.loggedIn;
      if (parsed.loggedIn === true)
        signIn = typeof parsed.authMethod === 'string' ? parsed.authMethod : 'signed in';
      else if (parsed.loggedIn === false) signIn = 'not signed in';
    } catch {
      signIn = null;
    }
    const headless = lookup.env.ANTHROPIC_API_KEY?.trim()
      ? ({ ready: true } as const)
      : ({
          ready: false,
          reason:
            'Unattended runs use your own Anthropic API key: set ANTHROPIC_API_KEY. A claude.ai login works for terminal sessions.'
        } as const);
    return {
      ...base,
      found: version.ok,
      executable,
      version: (version.stdout || version.stderr).trim().split(/\s+/)[0] || null,
      signedIn,
      signIn,
      headless: version.ok ? headless : { ready: false, reason: 'Claude Code could not be run.' }
    };
  },

  interactiveArgs(run) {
    return [...(run.model ? ['--model', run.model] : []), '--name', run.title, run.instruction];
  },

  headless(run, executable, env) {
    if (!env.ANTHROPIC_API_KEY?.trim()) {
      return {
        refused:
          'Unattended runs use your own Anthropic API key: set ANTHROPIC_API_KEY, or run it in a terminal session.'
      };
    }
    return {
      command: executable.command,
      args: [
        ...executable.prefixArgs,
        '--bare',
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--session-id',
        run.sessionId,
        '--permission-mode',
        'dontAsk',
        '--settings',
        JSON.stringify(headlessSettings(run.targetFolder)),
        ...(run.model ? ['--model', run.model] : []),
        run.instruction
      ],
      cwd: run.repoRoot,
      stdin: null,
      env: {}
    };
  },

  parseLine: parseClaudeLine
};
