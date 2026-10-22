// Running a repo's own commands (its build, its server in production mode) as the environment
// names them, in one line each, in the shell the environment declares (decision 30): with `none`
// the line is split into arguments here, npm and npx run through the Node.js that runs the studio
// and anything else by name; with a named shell that shell is started by name with the line as its
// one command. Never the machine's default shell. A process started here is stopped with
// everything it started.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Shell } from '../environment/types.js';

/** A command line as its arguments: split on spaces, with single and double quotes kept whole. */
export function parseCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let any = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      any = true;
    } else if (/\s/.test(char)) {
      if (current || any) args.push(current);
      current = '';
      any = false;
    } else current += char;
  }
  if (current || any) args.push(current);
  return args;
}

/**
 * Where npm's and npx's own scripts are, beside the Node.js running the studio: under its folder
 * on Windows, under ../lib on other systems. Null when not there (a Node.js installed another way).
 */
export function npmScript(
  name: 'npm' | 'npx',
  node: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync
): string | null {
  const dir = path.dirname(node);
  const candidates =
    platform === 'win32'
      ? [path.join(dir, 'node_modules', 'npm', 'bin', `${name}-cli.js`)]
      : [
          path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', `${name}-cli.js`),
          path.join(dir, 'node_modules', 'npm', 'bin', `${name}-cli.js`)
        ];
  return candidates.find(exists) ?? null;
}

/** The program a declared shell is started as, and the arguments that hand it one command line. */
export function shellInvocation(
  shell: Exclude<Shell, 'none'>,
  line: string
): {
  command: string;
  args: string[];
} {
  switch (shell) {
    case 'powershell':
    case 'pwsh':
      return { command: shell, args: ['-NoProfile', '-NonInteractive', '-Command', line] };
    case 'cmd':
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', line] };
    default:
      return { command: shell, args: ['-c', line] };
  }
}

/**
 * The program a command line starts, as doctor's prerequisites check looks for it on the PATH:
 * the line's first word when the studio starts it by name, or the declared shell, whose business
 * the line then is (a variable set before the program, a path the shell resolves).
 */
export function programOf(line: string, shell: Shell): string[] {
  if (shell !== 'none') return [shellInvocation(shell, line).command];
  const [program] = parseCommandLine(line);
  return program ? [program] : [];
}

/**
 * The program and arguments a command line starts: in a declared shell, that shell; otherwise npm
 * and npx through Node.js and their own scripts (no .cmd shim, so no shell), anything else by
 * name, for the PATH to find.
 */
export function resolveCommandLine(
  line: string,
  node: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = fs.existsSync,
  shell: Shell = 'none'
): { command: string; args: string[] } | null {
  if (!line.trim()) return null;
  if (shell !== 'none') return shellInvocation(shell, line.trim());
  const [program, ...args] = parseCommandLine(line);
  if (!program) return null;
  if (program === 'npm' || program === 'npx') {
    const script = npmScript(program, node, platform, exists);
    if (script) return { command: node, args: [script, ...args] };
  }
  return { command: program, args };
}

function start(command: string, args: string[], cwd: string): ChildProcess {
  return spawn(command, args, {
    cwd,
    windowsHide: true,
    // A group of its own, so the whole tree can be stopped at once outside Windows.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

/** Ends a process and everything it started, on every platform. */
export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const kill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      kill.once('exit', () => resolve());
      kill.once('error', () => resolve());
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
}

/** Runs a command line to its end in `cwd`: the exit code, or null when it did not finish in time. */
export function runToEnd(
  line: string,
  cwd: string,
  timeoutMs: number,
  shell: Shell = 'none'
): Promise<{ code: number | null }> {
  const resolved = resolveCommandLine(line, undefined, undefined, undefined, shell);
  if (!resolved) return Promise.resolve({ code: 1 });
  return new Promise(resolve => {
    const child = start(resolved.command, resolved.args, cwd);
    const timer = setTimeout(() => {
      void stopProcess(child).then(() => resolve({ code: null }));
    }, timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1 });
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ code: 1 });
    });
  });
}

/** How much of a command's output `runCapture` keeps: its end, where a tool says what failed. */
const CAPTURE_LIMIT = 256 * 1024;

/**
 * Runs a command line to its end in `cwd` with variables of its own added to the studio's
 * environment, keeping what it printed (both streams, the last 256 KB): the snapshot contract's
 * runner, whose command says per key what it rendered. The exit code is null when it timed out.
 */
export function runCapture(
  line: string,
  cwd: string,
  timeoutMs: number,
  shell: Shell = 'none',
  env: Record<string, string> = {}
): Promise<{ code: number | null; output: string }> {
  const resolved = resolveCommandLine(line, undefined, undefined, undefined, shell);
  if (!resolved) return Promise.resolve({ code: 1, output: 'The command is empty.' });
  return new Promise(resolve => {
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > CAPTURE_LIMIT) output = output.slice(-CAPTURE_LIMIT);
    };
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => {
      void stopProcess(child).then(() => resolve({ code: null, output }));
    }, timeoutMs);
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
    child.once('error', error => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}${error.message}` });
    });
  });
}

export type Served = { stop(): Promise<void> };

/** Starts a command line in `cwd` and waits until `url` answers anything; null when it did not in time. */
export async function serveUntil(
  line: string,
  cwd: string,
  url: string,
  timeoutMs: number,
  shell: Shell = 'none'
): Promise<Served | null> {
  const resolved = resolveCommandLine(line, undefined, undefined, undefined, shell);
  if (!resolved) return null;
  const child = start(resolved.command, resolved.args, cwd);
  child.on('error', () => {});
  const served: Served = { stop: () => stopProcess(child) };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      await response.body?.cancel();
      return served;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  await served.stop();
  return null;
}
