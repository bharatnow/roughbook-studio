// The built-in terminal's pseudo-terminal: node-pty, an optional dependency with binaries for
// Windows, macOS and glibc Linux (S1 step 5). It comes as @lydell/node-pty, node-pty's own files
// split into one package per platform with no install script, so npm has no script to run or
// warn about. Where it is missing, does not load, or would crash Node (musl Linux), the studio
// opens the designer's own terminal instead.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export type PtyProcess = {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
};

export type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    }
  ): PtyProcess;
};

export type PtySupport = { ok: true; pty: PtyModule } | { ok: false; reason: string };

const require = createRequire(import.meta.url);

/** The glibc version Node runs on, or null on musl and every other platform. */
function glibcVersion(): string | null {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report?.header?.glibcVersionRuntime ?? null;
}

/** Starts and ends one terminal in a separate Node, so a crash there cannot take this one down. */
function survivesProbe(modulePath: string): boolean {
  const script = `
const pty = require(${JSON.stringify(modulePath)});
const child = pty.spawn(process.execPath, ['-e', ''], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
child.onExit(({ exitCode }) => process.exit(exitCode === 0 ? 0 : 1));
setTimeout(() => process.exit(2), 8000);
`;
  const result = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore', timeout: 10_000 });
  return result.status === 0;
}

let cached: PtySupport | null = null;

/**
 * Whether the built-in terminal can run here, and the module when it can. Checked once per
 * process. `ROUGHBOOK_TERMINAL=external` turns it off.
 */
export function loadPty(env: NodeJS.ProcessEnv): PtySupport {
  if (env.ROUGHBOOK_TERMINAL === 'external') {
    return { ok: false, reason: 'ROUGHBOOK_TERMINAL=external chooses your own terminal.' };
  }
  if (cached) return cached;
  cached = probe();
  return cached;
}

function probe(): PtySupport {
  if (process.platform === 'linux' && !glibcVersion()) {
    return {
      ok: false,
      reason: 'The built-in terminal needs glibc; on musl Linux (Alpine) it would crash Node.'
    };
  }
  let modulePath: string;
  let pty: PtyModule;
  try {
    modulePath = require.resolve('@lydell/node-pty');
    pty = require(modulePath) as PtyModule;
  } catch {
    return {
      ok: false,
      reason: 'node-pty is not installed here, so runs open in your own terminal.'
    };
  }
  if (process.platform === 'linux' && !survivesProbe(modulePath)) {
    return { ok: false, reason: 'node-pty did not start a terminal here.' };
  }
  return { ok: true, pty };
}
