// Registering `roughbook mcp` with an editor or agent, at its user level so every repo has it.
// The four editors keep their MCP servers in a JSON file the studio merges its entry into: Cursor
// in ~/.cursor/mcp.json, VS Code in its user folder's mcp.json (under "servers", with a type),
// Antigravity in ~/.gemini/config/mcp_config.json (and its older ~/.gemini/antigravity/ copy when
// there is one), Windsurf in ~/.codeium/windsurf/mcp_config.json. Claude Code and Codex are told
// with their own `mcp add`. Checked against each tool's docs in October 2026.
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatJson, writeJsonAtomic } from '../fs/json.js';
import type { RunAgent } from '../runs/types.js';

/** The name the server is registered under. */
export const SERVER_NAME = 'roughbook';

/** How an editor starts the studio's MCP server. */
export type ServerCommand = { command: string; args: string[] };

type JsonObject = Record<string, unknown>;

export type Where = { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv };

type ConfigTarget = {
  id: RunAgent;
  name: string;
  kind: 'file';
  /** The file it reads, and any older one it may still read, written only when it exists. */
  files(where: Where): { file: string; onlyIfThere: boolean }[];
  key: 'mcpServers' | 'servers';
  entry(server: ServerCommand): JsonObject;
};

type CliTarget = {
  id: RunAgent;
  name: string;
  kind: 'cli';
  /** Arguments that take any earlier entry away, so adding never meets one. */
  remove: string[];
  add(server: ServerCommand): string[];
};

export type McpTarget = ConfigTarget | CliTarget;

function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

const plain = (server: ServerCommand): JsonObject => ({
  command: server.command,
  args: server.args
});

export const MCP_TARGETS: McpTarget[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli',
    remove: ['mcp', 'remove', '--scope', 'user', SERVER_NAME],
    add: server => [
      'mcp',
      'add',
      '--scope',
      'user',
      SERVER_NAME,
      '--',
      server.command,
      ...server.args
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    kind: 'cli',
    remove: ['mcp', 'remove', SERVER_NAME],
    add: server => ['mcp', 'add', SERVER_NAME, '--', server.command, ...server.args]
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'file',
    files: ({ platform, home }) => [
      { file: pathFor(platform).join(home, '.cursor', 'mcp.json'), onlyIfThere: false }
    ],
    key: 'mcpServers',
    entry: plain
  },
  {
    id: 'vscode',
    name: 'VS Code',
    kind: 'file',
    files: ({ platform, home, env }) => {
      const p = pathFor(platform);
      const userData =
        platform === 'win32'
          ? p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'Code')
          : platform === 'darwin'
            ? p.join(home, 'Library', 'Application Support', 'Code')
            : p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'Code');
      return [{ file: p.join(userData, 'User', 'mcp.json'), onlyIfThere: false }];
    },
    key: 'servers',
    entry: server => ({ type: 'stdio', ...plain(server) })
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    kind: 'file',
    files: ({ platform, home }) => {
      const p = pathFor(platform);
      return [
        { file: p.join(home, '.gemini', 'config', 'mcp_config.json'), onlyIfThere: false },
        { file: p.join(home, '.gemini', 'antigravity', 'mcp_config.json'), onlyIfThere: true }
      ];
    },
    key: 'mcpServers',
    entry: plain
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'file',
    files: ({ platform, home }) => [
      {
        file: pathFor(platform).join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        onlyIfThere: false
      }
    ],
    key: 'mcpServers',
    entry: plain
  }
];

export function mcpTarget(id: string): McpTarget | null {
  return MCP_TARGETS.find(target => target.id === id) ?? null;
}

/** Where this copy of the studio runs from: its cli script, and tsx's loader when it is source. */
export function thisStudio(): { cli: string; tsx: string | null } {
  const source = import.meta.url.endsWith('.ts');
  const cli = fileURLToPath(new URL(source ? '../cli.ts' : '../cli.js', import.meta.url));
  let tsx: string | null = null;
  if (source) {
    try {
      tsx = import.meta.resolve('tsx');
    } catch {
      tsx = null;
    }
  }
  return { cli, tsx };
}

/**
 * How an editor starts this studio's server: this Node with this install's script, which needs
 * no shell or PATH on any OS; or npx, when this copy is npx's own temporary one.
 */
export function serverCommand(options: {
  platform: NodeJS.Platform;
  node: string;
  cli: string;
  tsx: string | null;
  devUrl?: string;
}): ServerCommand {
  const extra = options.devUrl ? ['--dev-url', options.devUrl] : [];
  if (/[\\/]_npx[\\/]/.test(options.cli)) {
    // npx is a .cmd script on Windows, which only a shell can start.
    const npx = ['npx', '-y', SERVER_NAME, 'mcp', ...extra];
    return options.platform === 'win32'
      ? { command: 'cmd', args: ['/c', ...npx] }
      : { command: npx[0]!, args: npx.slice(1) };
  }
  if (options.cli.endsWith('.ts') && options.tsx) {
    return { command: options.node, args: ['--import', options.tsx, options.cli, 'mcp', ...extra] };
  }
  return { command: options.node, args: [options.cli, 'mcp', ...extra] };
}

/** The entry as it would sit in the target's file, for showing or pasting. */
export function snippet(target: ConfigTarget, server: ServerCommand): string {
  return formatJson({ [target.key]: { [SERVER_NAME]: target.entry(server) } });
}

export type FileChange = {
  file: string;
  status: 'added' | 'updated' | 'unchanged' | 'unreadable' | 'skipped';
};

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Puts the entry in one file, keeping everything else in it. A file that is not plain JSON, such
 * as one with comments, is left alone and reported, for the designer to paste into.
 */
export async function mergeEntry(
  file: string,
  key: ConfigTarget['key'],
  entry: JsonObject,
  onlyIfThere: boolean
): Promise<FileChange['status']> {
  const text = await readText(file);
  if (text === null && onlyIfThere) return 'skipped';
  let config: unknown = {};
  if (text?.trim()) {
    try {
      config = JSON.parse(text);
    } catch {
      return 'unreadable';
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'unreadable';
  const servers = (config as JsonObject)[key] ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return 'unreadable';
  const existing = (servers as JsonObject)[SERVER_NAME];
  if (isDeepStrictEqual(existing, entry)) return 'unchanged';
  await writeJsonAtomic(file, {
    ...(config as JsonObject),
    [key]: { ...(servers as JsonObject), [SERVER_NAME]: entry }
  });
  return existing === undefined ? 'added' : 'updated';
}

/** Whether the target's file already names the studio's server; null when it cannot say. */
export async function hasEntry(target: McpTarget, where: Where): Promise<boolean | null> {
  if (target.kind !== 'file') return null;
  for (const { file } of target.files(where)) {
    try {
      const text = await readText(file);
      const config = text?.trim() ? (JSON.parse(text) as JsonObject) : null;
      const servers = config?.[target.key] as JsonObject | undefined;
      if (servers && typeof servers === 'object' && SERVER_NAME in servers) return true;
    } catch {
      return null;
    }
  }
  return false;
}
