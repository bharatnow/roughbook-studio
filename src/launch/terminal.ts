// Opens a terminal in the repo running an agent with its one-line instruction: a terminal
// session the designer watches and steers. Windows uses Windows Terminal (one tab per session)
// or a console window; macOS opens Terminal, or iTerm when ROUGHBOOK_TERMINAL=iterm; Linux tries
// $TERMINAL, then x-terminal-emulator, GNOME Terminal, Konsole and xterm. Where none can be
// opened, the plan says so and gives the command to paste. Planning is pure; launching is the
// only side effect. Ported and extended from roughbook runner/terminal.ts (v2-local), which was
// Windows only.
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diskProbe, type Probe } from './platform.js';
import { findOnPath } from './which.js';

/** One terminal session: a title, and the program and arguments it runs in the repo. */
export type Session = { title: string; command: string; args: string[] };

export type Launch = { command: string; args: string[]; cwd: string; verbatim?: boolean };

export type TerminalPlan =
  | { kind: 'spawn'; terminal: string; launches: Launch[] }
  /** macOS: each session is a small script the terminal app opens. */
  | { kind: 'scripts'; terminal: string; app: string; scripts: string[] }
  | { kind: 'manual'; reason: string };

/** What may appear in a title or argument. Prompt paths are slugs and ids, so nothing real is refused. */
const SAFE_TEXT = /^[A-Za-z0-9 ./_:,()=@+-]+$/;
/** What may appear in a path handed to a terminal: no quotes, no shell or cmd metacharacters. */
const SAFE_PATH = /^[^"'`$%^&|<>;\r\n]+$/;
export const MAX_SESSIONS = 6;

/** A title from free text: only characters a launch can pass through safely. */
export function sessionTitle(text: string): string {
  return (
    text
      .replace(/[^A-Za-z0-9 ./_:,()-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Roughbook'
  );
}

/** The same session as a command to paste, for when no terminal can be opened. */
export function manualCommand(
  platform: NodeJS.Platform,
  repoRoot: string,
  session: Session
): string {
  if (platform === 'win32') {
    return `cd /d "${repoRoot}" && ${[session.command, ...session.args].map(part => `"${part}"`).join(' ')}`;
  }
  return `cd '${repoRoot}' && ${[session.command, ...session.args].map(part => `'${part}'`).join(' ')}`;
}

function problem(repoRoot: string, sessions: Session[]): string | null {
  if (!sessions.length) return 'Nothing to run.';
  if (sessions.length > MAX_SESSIONS) return `At most ${MAX_SESSIONS} sessions at once.`;
  if (!SAFE_PATH.test(repoRoot)) {
    return "The repo's path has characters that cannot be passed to a terminal safely.";
  }
  for (const session of sessions) {
    if (!SAFE_PATH.test(session.command)) {
      return "The agent's path has characters that cannot be passed to a terminal safely.";
    }
    if (!SAFE_TEXT.test(session.title) || !session.args.every(arg => SAFE_PATH.test(arg))) {
      return 'A session has characters that cannot be passed to a terminal safely.';
    }
  }
  return null;
}

/** Windows Terminal, when installed. Its launcher is an app alias, found by lstat. */
export function findWindowsTerminal(
  env: NodeJS.ProcessEnv,
  probe: Probe = diskProbe
): string | null {
  const candidates = [
    env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : '',
    ...(env.PATH ?? env.Path ?? '')
      .split(';')
      .filter(Boolean)
      .map(dir => path.win32.join(dir, 'wt.exe'))
  ].filter(Boolean);
  return candidates.find(candidate => probe.exists(candidate)) ?? null;
}

/** How each Linux terminal is told the folder and the program; most take xterm's -e. */
function linuxArgs(terminal: string, repoRoot: string, session: Session): string[] {
  const program = [session.command, ...session.args];
  switch (path.posix.basename(terminal)) {
    case 'gnome-terminal':
      return ['--title', session.title, '--working-directory', repoRoot, '--', ...program];
    case 'konsole':
      return ['--workdir', repoRoot, '-e', ...program];
    case 'kitty':
      return ['--title', session.title, '--directory', repoRoot, ...program];
    case 'alacritty':
      return ['--title', session.title, '--working-directory', repoRoot, '-e', ...program];
    case 'wezterm':
      return ['start', '--cwd', repoRoot, '--', ...program];
    default:
      return ['-T', session.title, '-e', ...program];
  }
}

const LINUX_TERMINALS = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];

/** A POSIX shell script that runs one session; every part was checked by SAFE_PATH. */
export function sessionScript(repoRoot: string, session: Session): string {
  const quoted = [session.command, ...session.args].map(part => `'${part}'`).join(' ');
  return `#!/bin/sh\n# ${session.title}\ncd '${repoRoot}' || exit 1\nexec ${quoted}\n`;
}

export function planTerminal({
  platform,
  env,
  repoRoot,
  sessions,
  probe = diskProbe
}: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  sessions: Session[];
  probe?: Probe;
}): TerminalPlan {
  const refused = problem(repoRoot, sessions);
  if (refused) return { kind: 'manual', reason: refused };

  if (platform === 'win32') {
    const wt = findWindowsTerminal(env, probe);
    if (wt) {
      // One new window, one tab per session. ";" separates Windows Terminal's own subcommands.
      const args = ['-w', 'new'];
      sessions.forEach((session, index) => {
        if (index > 0) args.push(';');
        args.push(
          'new-tab',
          '--title',
          session.title,
          '-d',
          repoRoot,
          session.command,
          ...session.args
        );
      });
      return {
        kind: 'spawn',
        terminal: 'Windows Terminal',
        launches: [{ command: wt, args, cwd: repoRoot }]
      };
    }
    // One console window per session. `start` takes the title as its first quoted argument.
    return {
      kind: 'spawn',
      terminal: 'a console window',
      launches: sessions.map(session => ({
        command: 'cmd.exe',
        args: [
          `/d /s /c "start "${session.title}" /D "${repoRoot}" ${[session.command, ...session.args]
            .map(part => `"${part}"`)
            .join(' ')}"`
        ],
        cwd: repoRoot,
        verbatim: true
      }))
    };
  }

  if (platform === 'darwin') {
    const iterm = env.ROUGHBOOK_TERMINAL?.toLowerCase() === 'iterm';
    return {
      kind: 'scripts',
      terminal: iterm ? 'iTerm' : 'Terminal',
      app: iterm ? 'iTerm' : 'Terminal',
      scripts: sessions.map(session => sessionScript(repoRoot, session))
    };
  }

  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    const lookup = { env, platform, home: '', node: '', probe };
    const chosen = env.TERMINAL?.trim();
    const terminal =
      (chosen &&
        (path.posix.isAbsolute(chosen)
          ? probe.exists(chosen)
            ? chosen
            : null
          : findOnPath(chosen, lookup))) ||
      LINUX_TERMINALS.map(name => findOnPath(name, lookup)).find(Boolean) ||
      null;
    if (!terminal) {
      return {
        kind: 'manual',
        reason: 'No terminal was found. Set TERMINAL, or run the command below yourself.'
      };
    }
    return {
      kind: 'spawn',
      terminal: path.posix.basename(terminal),
      launches: sessions.map(session => ({
        command: terminal,
        args: linuxArgs(terminal, repoRoot, session),
        cwd: repoRoot
      }))
    };
  }

  return { kind: 'manual', reason: 'Opening a terminal is not supported on this system.' };
}

/** Resolves once the process has started; rejects if it could not. */
function start(launch: Launch): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      windowsVerbatimArguments: launch.verbatim ?? false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Starts the plan; the terminals belong to the designer from here. */
export async function launchTerminal(plan: TerminalPlan): Promise<void> {
  if (plan.kind === 'spawn') {
    for (const launch of plan.launches) await start(launch);
  } else if (plan.kind === 'scripts') {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'roughbook-launch-'));
    for (const [index, script] of plan.scripts.entries()) {
      const file = path.join(dir, `session-${index + 1}.command`);
      await writeFile(file, script);
      await chmod(file, 0o755);
      await start({ command: 'open', args: ['-a', plan.app, file], cwd: dir });
    }
  }
}
