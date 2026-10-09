import { hostLookup } from '../agents/index.js';
import { runHeadless } from '../agents/process.js';
import { OfflineError, describeError } from '../api/errors.js';
import { userConfigDir } from '../config/userDir.js';
import type { Io } from '../io.js';
import { copyText } from '../launch/clipboard.js';
import { launchDetached, openUrl } from '../launch/open.js';
import { hostPlatform } from '../launch/platform.js';
import { launchTerminal } from '../launch/terminal.js';
import { screenshotIteration } from '../screenshot/iteration.js';
import { findRepoRoot } from '../repo/root.js';
import { errorCode, flushEvents, recordEvent } from '../telemetry/events.js';
import { STUDIO_VERSION } from '../version.js';
import { openApi, type Command, type CommandContext } from './context.js';
import { agents } from './agents.js';
import { done } from './done.js';
import { init } from './init.js';
import { login } from './login.js';
import { logout } from './logout.js';
import { promote } from './promote.js';
import { pull } from './pull.js';
import { revert } from './revert.js';
import { review } from './review.js';
import { run } from './run.js';
import { screenshot } from './screenshot.js';
import { start } from './start.js';
import { status } from './status.js';
import { telemetry } from './telemetry.js';

/** Every command, in the order `roughbook help` lists them. */
export const COMMANDS: Command[] = [
  login,
  init,
  start,
  run,
  done,
  screenshot,
  review,
  revert,
  pull,
  promote,
  agents,
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
    | 'runHeadless'
    | 'screenshot'
    | 'waitForStop'
  >
>;

/** Until Ctrl+C, or the terminal closing. */
function untilSignalled(): Promise<void> {
  return new Promise(resolve => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
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

  const context: CommandContext = {
    io,
    cwd: options.cwd,
    env: options.env,
    repoRoot: findRepoRoot(options.cwd),
    configDir: userConfigDir(options.env),
    fetch: options.fetch,
    sleep: options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))),
    openUrl: options.openUrl ?? openUrl,
    platform: options.platform ?? hostPlatform(),
    detect: options.detect ?? (adapter => adapter.detect(hostLookup(options.env))),
    launchTerminal: options.launchTerminal ?? launchTerminal,
    launchEditor: options.launchEditor ?? (launch => launchDetached(launch, options.env)),
    copyText:
      options.copyText ?? (text => copyText(text, options.platform ?? hostPlatform(), options.env)),
    runHeadless: options.runHeadless ?? runHeadless,
    screenshot: options.screenshot ?? screenshotIteration,
    waitForStop: options.waitForStop ?? untilSignalled
  };
  if (command.needsRepo && !context.repoRoot) {
    io.err('This folder is not in a Roughbook repo. Run roughbook init in the repo first.');
    return 1;
  }
  try {
    return await command.run(args, context);
  } catch (error) {
    io.err(describeError(error));
    await reportFailure(context, error);
    return 1;
  }
}
