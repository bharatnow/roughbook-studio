import { spawn } from 'node:child_process';

export type ClipboardCommand = { command: string; args: string[] };

/**
 * The commands that put text on each OS's clipboard from standard input, tried in order: `clip` on
 * Windows, `pbcopy` on macOS, and on Linux `wl-copy` under Wayland, then `xclip` and `xsel`.
 */
export function clipboardCommands(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): ClipboardCommand[] {
  if (platform === 'win32') return [{ command: 'clip', args: [] }];
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }];
  return [
    ...(env.WAYLAND_DISPLAY ? [{ command: 'wl-copy', args: [] }] : []),
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] }
  ];
}

/** Writes `text` to one command's standard input; true when it exited cleanly. Never throws. */
export function pipeTo(
  command: ClipboardCommand,
  text: string,
  timeoutMs = 5000
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    timer.unref();
    try {
      const child = spawn(command.command, command.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true
      });
      child.once('error', () => done(false));
      child.once('close', code => done(code === 0));
      child.stdin.on('error', () => done(false));
      child.stdin.end(text);
    } catch {
      done(false);
    }
  });
}

/** Puts `text` on the clipboard with the first command that works; false when none did. */
export async function copyText(
  text: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  run: typeof pipeTo = pipeTo
): Promise<boolean> {
  for (const command of clipboardCommands(platform, env)) {
    if (await run(command, text)) return true;
  }
  return false;
}
