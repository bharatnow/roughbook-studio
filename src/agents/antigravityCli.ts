// Google's Antigravity CLI, `agy`, which replaced Gemini CLI for personal accounts on
// 2026-06-18. Flags checked against `agy --help` of 1.3.3 (2026-10-11): `-p` runs one prompt and
// exits, `-i` runs one and stays, both with the prompt after the flags, `--output-format stream-json` gives one JSON event per line (`init`, `step_update`,
// `result`), `--model` the model. Headless, it writes files in the workspace on its own and
// soft-denies shell commands unless a permission rule allows them, so a run needs no skip flag
// and never runs commands. Unattended runs use the designer's own key, GEMINI_API_KEY, never the
// Google sign-in: agy takes the key only when ~/.gemini/antigravity-cli/settings.json says
// "modelProvider": "gemini", so a run is ready only with both. The installer puts it in
// ~/.local/bin on macOS and Linux and in %LOCALAPPDATA%\agy\bin on Windows. No agy was installed
// where this was written: check the event names against the first real run.
import path from 'node:path';
import { diskProbe } from '../launch/platform.js';
import {
  findInDirs,
  findInstalled,
  findOnPath,
  fromEnv,
  windowsDataDirs,
  type Lookup
} from '../launch/which.js';
import { count, record, runCommand } from './command.js';
import type { ParsedLine, TerminalAdapter } from './types.js';

const NOT_FOUND =
  'Antigravity CLI was not found. Install it (curl -fsSL https://antigravity.google/cli/install.sh | bash, or on Windows irm https://antigravity.google/cli/install.ps1 | iex), or set ROUGHBOOK_AGY_BIN to the full path of agy.';

const KEY_HOW =
  'Unattended runs use your own Gemini API key: set GEMINI_API_KEY and put "modelProvider": "gemini" in ~/.gemini/antigravity-cli/settings.json. The Google sign-in works for terminal sessions.';

function apiKey(env: NodeJS.ProcessEnv): string | null {
  return env.GEMINI_API_KEY?.trim() || null;
}

/** Whether agy's settings choose the Gemini API, the one mode in which it uses the key. */
export function usesApiKey(lookup: Lookup): boolean {
  const p = lookup.platform === 'win32' ? path.win32 : path.posix;
  const file = p.join(lookup.home, '.gemini', 'antigravity-cli', 'settings.json');
  const text = (lookup.probe ?? diskProbe).read?.(file);
  if (!text) return false;
  try {
    return record(JSON.parse(text)).modelProvider === 'gemini';
  } catch {
    return false;
  }
}

/** A tool that changes files, by its name. */
const WRITES = /write|edit|replace|create|delete|remove|move|rename/i;

function fileOf(parameters: Record<string, unknown>): string {
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'file']) {
    const value = parameters[key];
    if (typeof value === 'string' && value) return path.basename(value);
  }
  return 'files';
}

export function parseAgyLine(line: string): ParsedLine {
  let parsed: Record<string, unknown>;
  try {
    parsed = record(JSON.parse(line.trim()));
  } catch {
    return {};
  }
  switch (parsed.event) {
    case 'init':
      return typeof parsed.conversation_id === 'string'
        ? { event: { kind: 'session', id: parsed.conversation_id } }
        : {};
    case 'step_update': {
      const info = record(parsed.tool_info);
      const tool =
        typeof info.name === 'string'
          ? info.name
          : typeof parsed.tool_name === 'string'
            ? parsed.tool_name
            : null;
      if (parsed.step_type === 'tool' && tool) {
        if (parsed.state === 'DONE' && WRITES.test(tool) && !record(info.error).message) {
          return { event: { kind: 'file', name: fileOf(record(info.parameters)) } };
        }
        return parsed.state === 'ACTIVE' ? { event: { kind: 'tool', name: tool } } : {};
      }
      // Text comes as deltas; only the last of them, with the step done, is worth a line.
      if (
        parsed.step_type === 'agent_response' &&
        parsed.state === 'DONE' &&
        typeof parsed.text_delta === 'string' &&
        parsed.text_delta.trim()
      ) {
        return { event: { kind: 'message', text: parsed.text_delta } };
      }
      return {};
    }
    case 'result': {
      const usage = record(parsed.usage);
      const failure = record(parsed.error).message;
      const text =
        typeof parsed.response === 'string' && parsed.response.trim()
          ? parsed.response.trim()
          : typeof failure === 'string'
            ? failure.slice(0, 300)
            : null;
      return {
        event: { kind: 'result', ok: parsed.status === 'SUCCESS', text },
        usage: {
          // agy does not say which model ran in its result; the run fills it in.
          model: '',
          inputTokens: count(usage.input_tokens),
          outputTokens: count(usage.output_tokens),
          cacheReadTokens: count(usage.cache_read_tokens),
          cacheWriteTokens: null
        }
      };
    }
    default:
      return {};
  }
}

export const antigravityCli: TerminalAdapter = {
  id: 'antigravity-cli',
  name: 'Antigravity CLI',
  kind: 'terminal',
  capabilities: { interactive: true, headless: true, permissions: false, usage: true },
  notFound: NOT_FOUND,

  find(lookup) {
    const explicit = fromEnv('ROUGHBOOK_AGY_BIN', lookup);
    if (explicit) return explicit;
    const onPath = findOnPath('agy', lookup);
    if (onPath) return { command: onPath, prefixArgs: [], source: 'PATH' };
    if (lookup.platform === 'win32') {
      const dir = path.win32.join(windowsDataDirs(lookup).local, 'agy', 'bin');
      const file = findInDirs('agy', [dir], lookup);
      return file ? { command: file, prefixArgs: [], source: dir } : null;
    }
    return findInstalled('agy', lookup);
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
    // agy has no status command, and its Google session lives in the OS keyring; the one
    // sign-in the studio can see is the API-key mode.
    const keyed = Boolean(apiKey(lookup.env)) && usesApiKey(lookup);
    return {
      ...base,
      found: version.ok,
      executable,
      version: (version.stdout || version.stderr).trim().split(/\s+/).pop() || null,
      signedIn: keyed ? true : null,
      signIn: keyed ? 'Gemini API key' : null,
      headless: !version.ok
        ? { ready: false, reason: 'Antigravity CLI could not be run.' }
        : keyed
          ? { ready: true }
          : { ready: false, reason: KEY_HOW }
    };
  },

  interactiveArgs(run) {
    return [...(run.model ? ['--model', run.model] : []), '-i', run.instruction];
  },

  headless(run, executable, env) {
    // The provider setting is checked at detection, which every unattended run passes first.
    if (!apiKey(env)) return { refused: KEY_HOW };
    return {
      command: executable.command,
      args: [
        ...executable.prefixArgs,
        '--output-format',
        'stream-json',
        ...(run.model ? ['--model', run.model] : []),
        '-p',
        run.instruction
      ],
      cwd: run.repoRoot,
      stdin: null,
      env: {}
    };
  },

  parseLine: parseAgyLine
};
