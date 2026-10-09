// Editor agents: Cursor, VS Code with Copilot, Antigravity and Windsurf. The designer drives the
// editor's own agent; the studio opens the repo and the run's prompt in a window of the editor
// and puts the one-line instruction on the clipboard. All four are builds of VS Code, so one
// adapter covers them: each ships a command-line launcher (`cursor`, `code`, `antigravity`,
// `windsurf`) that opens folders and files in the running editor and prints its version. On
// Windows that launcher is a .cmd script, which cannot be started without a shell, so the studio
// runs what the script runs: the editor's exe, as Node, with its cli.js. Checked against VS Code
// 1.141 and Cursor 3.24 on Windows, whose scripts sit at bin\code.cmd and
// resources\app\bin\cursor.cmd. "Your own editor" opens the prompt with the OS's default app.
import path from 'node:path';
import { diskProbe } from '../launch/platform.js';
import {
  findInstalled,
  findOnPath,
  fromEnv,
  pathDirs,
  windowsDataDirs,
  type Executable,
  type Lookup
} from '../launch/which.js';
import type { RunAgent } from '../runs/types.js';
import { runCommand } from './command.js';
import type { Capabilities, EditorAdapter } from './types.js';

const CAPABILITIES: Capabilities = {
  interactive: true,
  headless: false,
  permissions: false,
  usage: false
};

type EditorSpec = {
  id: RunAgent;
  name: string;
  /** The launcher's name, as on PATH. */
  cli: string;
  /** The install folder under %LOCALAPPDATA%\Programs or %ProgramFiles% on Windows. */
  windowsFolder: string;
  /** The app bundle on macOS. */
  macApp: string;
  /** Where Linux packages put it, under /usr/share. */
  linuxShare: string;
  /** ROUGHBOOK_<X>_BIN, naming the launcher anywhere else. */
  envVariable: string;
};

/** The two paths a Windows launcher script runs: "%~dp0<exe>" "%~dp0<cli.js>". */
const LAUNCHER_SCRIPT = /"%~dp0([^"]+?\.exe)"\s+"%~dp0([^"]+?cli\.js)"/i;

/** What a Windows launcher script runs, as an executable that needs no shell; null if unreadable. */
export function fromLauncherScript(file: string, lookup: Lookup): Executable | null {
  const probe = lookup.probe ?? diskProbe;
  const text = probe.read?.(file) ?? null;
  const match = text ? LAUNCHER_SCRIPT.exec(text) : null;
  if (!match) return null;
  const dir = path.win32.dirname(file);
  const exe = path.win32.join(dir, match[1]!);
  const cli = path.win32.join(dir, match[2]!);
  if (!probe.exists(exe) || !probe.exists(cli)) return null;
  return { command: exe, prefixArgs: [cli], env: { ELECTRON_RUN_AS_NODE: '1' }, source: file };
}

function findOnWindows(spec: EditorSpec, lookup: Lookup): Executable | null {
  const p = path.win32;
  const probe = lookup.probe ?? diskProbe;
  const roots = [
    p.join(windowsDataDirs(lookup).local, 'Programs', spec.windowsFolder),
    ...(lookup.env.ProgramFiles ? [p.join(lookup.env.ProgramFiles, spec.windowsFolder)] : [])
  ];
  const scripts = [
    ...pathDirs(lookup.env, 'win32').map(dir => ({
      file: p.join(dir, `${spec.cli}.cmd`),
      source: 'PATH'
    })),
    ...roots.flatMap(root => [
      { file: p.join(root, 'bin', `${spec.cli}.cmd`), source: root },
      { file: p.join(root, 'resources', 'app', 'bin', `${spec.cli}.cmd`), source: root }
    ])
  ];
  for (const { file, source } of scripts) {
    if (!probe.exists(file)) continue;
    const found = fromLauncherScript(file, lookup);
    if (found) return { ...found, source };
  }
  return null;
}

function findOnMac(spec: EditorSpec, lookup: Lookup): Executable | null {
  const p = path.posix;
  const probe = lookup.probe ?? diskProbe;
  for (const base of ['/Applications', p.join(lookup.home, 'Applications')]) {
    const file = p.join(base, spec.macApp, 'Contents', 'Resources', 'app', 'bin', spec.cli);
    if (probe.exists(file)) return { command: file, prefixArgs: [], source: spec.macApp };
  }
  return null;
}

function findOnLinux(spec: EditorSpec, lookup: Lookup): Executable | null {
  const probe = lookup.probe ?? diskProbe;
  const installed = findInstalled(spec.cli, lookup);
  if (installed) return installed;
  for (const file of [`/usr/share/${spec.linuxShare}/bin/${spec.cli}`, `/snap/bin/${spec.cli}`]) {
    if (probe.exists(file))
      return { command: file, prefixArgs: [], source: path.posix.dirname(file) };
  }
  return null;
}

function headlessReason(name: string): string {
  return `${name} runs with you in it, never unattended. Unattended runs use Claude Code or Codex.`;
}

/** One VS Code build: where its launcher is, and how it opens the repo and the prompts. */
export function vscodeBuild(spec: EditorSpec): EditorAdapter {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'editor',
    capabilities: CAPABILITIES,
    notFound: `${spec.name} was not found. Install it, or set ${spec.envVariable} to the full path of its ${spec.cli} launcher.`,

    find(lookup) {
      const explicit = lookup.env[spec.envVariable]?.trim();
      if (explicit && lookup.platform === 'win32' && /\.cmd$/i.test(explicit)) {
        const script = fromLauncherScript(explicit, lookup);
        if (script) return { ...script, source: spec.envVariable };
      }
      const named = fromEnv(spec.envVariable, lookup);
      if (named) return named;
      if (lookup.platform === 'win32') return findOnWindows(spec, lookup);
      const onPath = findOnPath(spec.cli, lookup);
      if (onPath) return { command: onPath, prefixArgs: [], source: 'PATH' };
      return lookup.platform === 'darwin' ? findOnMac(spec, lookup) : findOnLinux(spec, lookup);
    },

    async detect(lookup) {
      const base = {
        id: this.id,
        name: this.name,
        kind: this.kind,
        capabilities: this.capabilities,
        signedIn: null,
        signIn: null,
        headless: { ready: false, reason: headlessReason(this.name) }
      } as const;
      const executable = this.find(lookup);
      if (!executable) return { ...base, found: false, executable: null, version: null };
      // The launcher prints its version and exits; it opens no window.
      const answer = await runCommand(executable, ['--version']);
      const version = answer.ok ? answer.stdout.trim().split(/\r?\n/)[0]?.trim() || null : null;
      return { ...base, found: true, executable, version };
    },

    openArgs(repoRoot, files) {
      return [repoRoot, ...files];
    }
  };
}

export const cursor = vscodeBuild({
  id: 'cursor',
  name: 'Cursor',
  cli: 'cursor',
  windowsFolder: 'cursor',
  macApp: 'Cursor.app',
  linuxShare: 'cursor',
  envVariable: 'ROUGHBOOK_CURSOR_BIN'
});

export const vscode = vscodeBuild({
  id: 'vscode',
  name: 'VS Code',
  cli: 'code',
  windowsFolder: 'Microsoft VS Code',
  macApp: 'Visual Studio Code.app',
  linuxShare: 'code',
  envVariable: 'ROUGHBOOK_VSCODE_BIN'
});

export const antigravity = vscodeBuild({
  id: 'antigravity',
  name: 'Antigravity',
  cli: 'antigravity',
  windowsFolder: 'Antigravity',
  macApp: 'Antigravity.app',
  linuxShare: 'antigravity',
  envVariable: 'ROUGHBOOK_ANTIGRAVITY_BIN'
});

export const windsurf = vscodeBuild({
  id: 'windsurf',
  name: 'Windsurf',
  cli: 'windsurf',
  windowsFolder: 'Windsurf',
  macApp: 'Windsurf.app',
  linuxShare: 'windsurf',
  envVariable: 'ROUGHBOOK_WINDSURF_BIN'
});

/** Any other editor or tool: the prompt opens in the OS's default app, the instruction is copied. */
export const ownEditor: EditorAdapter = {
  id: 'other',
  name: 'Your own editor',
  kind: 'editor',
  capabilities: CAPABILITIES,
  // Never said: the OS's default app is always there to try.
  notFound: 'Open the prompt in your editor yourself.',
  find: () => null,
  async detect() {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      capabilities: this.capabilities,
      found: true,
      executable: null,
      version: null,
      signedIn: null,
      signIn: null,
      headless: { ready: false, reason: headlessReason('Your own editor') }
    };
  },
  openArgs: () => []
};
