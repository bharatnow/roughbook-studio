// OpenAI's Codex CLI. `codex exec` flags checked against OpenAI's CLI reference (2026-10-05):
// --json, --sandbox workspace-write, --cd, --model, --skip-git-repo-check, and "-" for a prompt
// on standard input. The sandbox confines writes to the working directory, so a headless run
// works in the run's folder and is told where the repo root is. Unattended runs use the
// designer's own API key (CODEX_API_KEY or OPENAI_API_KEY), never a ChatGPT login. No Codex CLI
// was installed where this was written: check the event names against the first real run.
import path from 'node:path';
import { diskProbe } from '../launch/platform.js';
import { findNpmScript, findOnPath, fromEnv } from '../launch/which.js';
import { count, record, runCommand } from './command.js';
import type { ParsedLine, TerminalAdapter } from './types.js';

const NOT_FOUND =
  'Codex was not found. Install it (npm install -g @openai/codex), or set ROUGHBOOK_CODEX_BIN to the full path of codex.';

function apiKey(env: NodeJS.ProcessEnv): string | null {
  return env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null;
}

export function parseCodexLine(line: string): ParsedLine {
  let parsed: Record<string, unknown>;
  try {
    parsed = record(JSON.parse(line.trim()));
  } catch {
    return {};
  }
  const item = record(parsed.item);
  switch (parsed.type) {
    case 'thread.started':
      return typeof parsed.thread_id === 'string'
        ? { event: { kind: 'session', id: parsed.thread_id } }
        : {};
    case 'item.started':
      if (item.type === 'command_execution') return { event: { kind: 'tool', name: 'Shell' } };
      if (item.type === 'file_change') return { event: { kind: 'tool', name: 'Write' } };
      return {};
    case 'item.completed': {
      if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
        return { event: { kind: 'message', text: item.text } };
      }
      if (item.type === 'file_change') {
        const first = record(Array.isArray(item.changes) ? item.changes[0] : null).path;
        return {
          event: { kind: 'file', name: typeof first === 'string' ? path.basename(first) : 'files' }
        };
      }
      return {};
    }
    case 'turn.completed': {
      const usage = record(parsed.usage);
      const input = count(usage.input_tokens);
      const cached = count(usage.cached_input_tokens);
      return {
        event: { kind: 'result', ok: true, text: null },
        usage: {
          // Codex does not say which model ran; the run fills it in.
          model: '',
          // As the backend counts them: input without the cached part.
          inputTokens: input === null ? null : Math.max(0, input - (cached ?? 0)),
          outputTokens: count(usage.output_tokens),
          cacheReadTokens: cached,
          cacheWriteTokens: null
        }
      };
    }
    case 'turn.failed':
    case 'error': {
      const message = record(parsed.error).message ?? parsed.message;
      return {
        event: {
          kind: 'result',
          ok: false,
          text: typeof message === 'string' ? message.slice(0, 300) : null
        }
      };
    }
    default:
      return {};
  }
}

export const codex: TerminalAdapter = {
  id: 'codex',
  name: 'Codex',
  kind: 'terminal',
  capabilities: { interactive: true, headless: true, permissions: true, usage: true },
  notFound: NOT_FOUND,

  find(lookup) {
    const p = lookup.platform === 'win32' ? path.win32 : path.posix;
    const probe = lookup.probe ?? diskProbe;
    const explicit = fromEnv('ROUGHBOOK_CODEX_BIN', lookup);
    if (explicit) return explicit;
    const onPath = findOnPath('codex', lookup);
    if (onPath) return { command: onPath, prefixArgs: [], source: 'PATH' };
    const npm = findNpmScript('codex', '@openai/codex', 'bin/codex.js', lookup);
    if (npm) return npm;
    const native = p.join(
      lookup.home,
      '.local',
      'bin',
      lookup.platform === 'win32' ? 'codex.exe' : 'codex'
    );
    return probe.exists(native)
      ? { command: native, prefixArgs: [], source: 'native install' }
      : null;
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
        signIn: null,
        headless: { ready: false, reason: NOT_FOUND }
      };
    }
    const version = await runCommand(executable, ['--version']);
    const status = await runCommand(executable, ['login', 'status']);
    const said = (status.stdout || status.stderr).trim().split('\n')[0]?.slice(0, 80) || null;
    return {
      ...base,
      found: version.ok,
      executable,
      version: (version.stdout || version.stderr).trim().split(/\s+/).pop() || null,
      signIn: status.ok ? said : 'not signed in',
      headless: !version.ok
        ? { ready: false, reason: 'Codex could not be run.' }
        : apiKey(lookup.env)
          ? { ready: true }
          : {
              ready: false,
              reason:
                'Unattended runs use your own OpenAI API key: set CODEX_API_KEY or OPENAI_API_KEY. A ChatGPT login works for terminal sessions.'
            }
    };
  },

  interactiveArgs(run) {
    return [...(run.model ? ['--model', run.model] : []), run.instruction];
  },

  headless(run, executable, env) {
    const key = apiKey(env);
    if (!key) {
      return {
        refused:
          'Unattended runs use your own OpenAI API key: set CODEX_API_KEY or OPENAI_API_KEY, or run it in a terminal session.'
      };
    }
    const folder = path.join(run.repoRoot, ...run.targetFolder.split('/'));
    return {
      command: executable.command,
      args: [
        ...executable.prefixArgs,
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '--cd',
        folder,
        '--skip-git-repo-check',
        ...(run.model ? ['--model', run.model] : []),
        '-'
      ],
      cwd: folder,
      stdin: [
        `Your working directory is ${run.targetFolder}, the one folder you may write to.`,
        `The repository root is ${run.repoRoot}. Every path in your instructions is relative to it: read from there, write only in your working directory.`,
        '',
        run.instruction,
        ''
      ].join('\n'),
      env: { CODEX_API_KEY: key }
    };
  },

  parseLine: parseCodexLine
};
