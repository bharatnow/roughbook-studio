import os from 'node:os';
import { runCommand } from '../agents/command.js';
import { hostLookup } from '../agents/index.js';
import { runHeadless } from '../agents/process.js';
import { OfflineError, describeError } from '../api/errors.js';
import { userConfigDir } from '../config/userDir.js';
import type { Io } from '../io.js';
import { copyText } from '../launch/clipboard.js';
import { launchDetached, openUrl } from '../launch/open.js';
import { hostPlatform } from '../launch/platform.js';
import { refuseNewProcesses, stopStartedProcesses } from '../launch/processes.js';
import { launchTerminal } from '../launch/terminal.js';
import { closeKeptBrowsers } from '../screenshot/browser.js';
import { askPreview, screenshotIteration } from '../screenshot/iteration.js';
import { findRepoRoot } from '../repo/root.js';
import { errorCode, flushEvents, recordEvent } from '../telemetry/events.js';
import { STUDIO_VERSION } from '../version.js';
import { openApi, type Command, type CommandContext } from './context.js';
import { adopt } from './adopt.js';
import { agents } from './agents.js';
import { composition, section } from './composition.js';
import { doctor } from './doctor.js';
import { done } from './done.js';
import { init } from './init.js';
import { login } from './login.js';
import { logout } from './logout.js';
import { map } from './map.js';
import { mcp } from './mcp.js';
import { create } from './new.js';
import { promote } from './promote.js';
import { pull } from './pull.js';
import { revert } from './revert.js';
import { review } from './review.js';
import { run } from './run.js';
import { screenshot } from './screenshot.js';
import { setup } from './setup.js';
import { start } from './start.js';
import { status } from './status.js';
import { telemetry } from './telemetry.js';
import { uninstall } from './uninstall.js';

/** Every command, in the order `roughbook help` lists them. */
export const COMMANDS: Command[] = [
  login,
  create,
  init,
  setup,
  map,
  adopt,
  start,
  run,
  done,
  doctor,
  uninstall,
  screenshot,
  review,
  revert,
  pull,
  section,
  composition,
  promote,
  agents,
  mcp,
  status,
  telemetry,
  logout
];

function printHelp(io: Io): void {
  io.out(`Roughbook studio ${STUDIO_VERSION}`);
  io.out('');
  io.out('Usage: roughbook <command> [options]');
  io.out('');
  const width = Math.max(0, ...COMMANDS.map(command => command.usage.length));
  for (const command of COMMANDS) io.out(`  ${command.usage.padEnd(width)}  ${command.summary}`);
  io.out(`  ${'help'.padEnd(width)}  Show this list`);
  io.out(`  ${'--version'.padEnd(width)}  Show the studio's version`);
}

/**
 * A command that failed becomes `error.reported`, by its code only, when the designer agreed;
 * it goes now if the server answers quickly, else with the next one. Never in the way.
 */
async function reportFailure(context: CommandContext, error: unknown): Promise<void> {
  try {
    const code = errorCode(error);
    if (!code || !(await recordEvent(context, 'error.reported', { code, area: 'cli' }))) return;
    if (error instanceof OfflineError) return;
    const { api } = await openApi(context);
    await flushEvents(context, api.withTimeout(3000));
  } catch {
    // Analytics never hide the error itself.
  }
}

export type MainOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  io: Io;
} & Partial<
  Pick<
    CommandContext,
    | 'fetch'
    | 'sleep'
    | 'openUrl'
    | 'platform'
    | 'detect'
    | 'launchTerminal'
    | 'launchEditor'
    | 'copyText'
    | 'home'
    | 'runCommand'
    | 'runHeadless'
    | 'screenshot'
    | 'takePicture'
    | 'askPreview'
    | 'pty'
    | 'waitForStop'
    | 'stdio'
    | 'doctorTools'
    | 'addPackages'
    | 'scaffoldTools'
  >
>;

/** What `catchInterrupts` needs of the process: its stop signals, and a way to exit. */
export type InterruptHost = {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): void;
};

/**
 * What a command leaves behind when it ends or is interrupted: the browser kept for its
 * screenshots, and the processes it started that still run (a server doctor started itself).
 * Interrupted, it starts nothing more either: the command's own steps go on until the studio
 * exits, and a server or browser one of them started then would outlive it.
 */
async function closeStarted(interrupted = false): Promise<void> {
  if (interrupted) refuseNewProcesses();
  await Promise.all([closeKeptBrowsers(), stopStartedProcesses()]);
}

/**
 * Ctrl+C and SIGTERM, in hand while a command runs. A command waiting for a stop (start, mcp)
 * has its wait ended, and stops itself. Any other is ended here, once the browser kept for its
 * screenshots has exited and its profile is gone, and the processes it started have been stopped:
 * dying at once would leave the profile in the OS temp folder, and a server started in a group of
 * its own running from the repo. Another signal while that closes ends the process at once.
 */
export function catchInterrupts(
  host: InterruptHost = process,
  close: () => Promise<void> = () => closeStarted(true)
): { waitForStop(): Promise<void>; release(): void } {
  let stopWaiting: (() => void) | null = null;
  let closing = false;
  const interrupted = (code: number) => {
    if (stopWaiting) {
      const stop = stopWaiting;
      stopWaiting = null;
      stop();
    } else if (closing) host.exit(code);
    else {
      closing = true;
      void close().finally(() => host.exit(code));
    }
  };
  const onInt = () => interrupted(130);
  const onTerm = () => interrupted(143);
  host.on('SIGINT', onInt);
  host.on('SIGTERM', onTerm);
  return {
    waitForStop: () =>
      new Promise(resolve => {
        stopWaiting = resolve;
      }),
    release: () => {
      host.off('SIGINT', onInt);
      host.off('SIGTERM', onTerm);
    }
  };
}

/** Runs one command line and returns the exit code: 0 done, 1 failed, 2 not understood. */
export async function main(argv: string[], options: MainOptions): Promise<number> {
  const { io } = options;
  const [name, ...args] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    printHelp(io);
    return 0;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    io.out(STUDIO_VERSION);
    return 0;
  }
  const command = COMMANDS.find(item => item.name === name);
  if (!command) {
    io.err(`Unknown command: ${name}. Run roughbook help for the list.`);
    return 2;
  }

  const interrupts = catchInterrupts();
  const context: CommandContext = {
    io,
    cwd: options.cwd,
    env: options.env,
    repoRoot: findRepoRoot(options.cwd),
    configDir: userConfigDir(options.env),
    home: options.home ?? os.homedir(),
    fetch: options.fetch,
    sleep: options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    openUrl: options.openUrl ?? openUrl,
    platform: options.platform ?? hostPlatform(),
    detect: options.detect ?? (adapter => adapter.detect(hostLookup(options.env))),
    launchTerminal: options.launchTerminal ?? launchTerminal,
    launchEditor: options.launchEditor ?? (launch => launchDetached(launch, options.env)),
    copyText:
      options.copyText ?? (text => copyText(text, options.platform ?? hostPlatform(), options.env)),
    runCommand: options.runCommand ?? runCommand,
    runHeadless: options.runHeadless ?? runHeadless,
    screenshot: options.screenshot ?? screenshotIteration,
    takePicture: options.takePicture,
    askPreview: options.askPreview ?? askPreview,
    pty: options.pty,
    doctorTools: options.doctorTools,
    addPackages: options.addPackages,
    scaffoldTools: options.scaffoldTools,
    waitForStop: options.waitForStop ?? interrupts.waitForStop,
    stdio: options.stdio ?? {
      input: process.stdin,
      output: process.stdout,
      interactive: Boolean(process.stdin.isTTY)
    }
  };
  if (command.needsRepo && !context.repoRoot) {
    interrupts.release();
    io.err('This folder is not in a Roughbook repo. Run roughbook init in the repo first.');
    return 1;
  }
  try {
    return await command.run(args, context);
  } catch (error) {
    io.err(describeError(error));
    await reportFailure(context, error);
    return 1;
  } finally {
    // The browser kept for screenshots, or a process still running, would otherwise keep the
    // process alive.
    await closeStarted();
    interrupts.release();
  }
}
