import { describeError } from '../api/errors.js';
import { userConfigDir } from '../config/userDir.js';
import type { Io } from '../io.js';
import { openUrl } from '../launch/open.js';
import { findRepoRoot } from '../repo/root.js';
import { STUDIO_VERSION } from '../version.js';
import type { Command, CommandContext } from './context.js';
import { init } from './init.js';
import { login } from './login.js';
import { logout } from './logout.js';
import { status } from './status.js';

/** Every command, in the order `roughbook help` lists them. */
export const COMMANDS: Command[] = [login, init, status, logout];

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

export type MainOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  io: Io;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  openUrl?: (url: string) => Promise<boolean>;
};

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
    openUrl: options.openUrl ?? openUrl
  };
  if (command.needsRepo && !context.repoRoot) {
    io.err('This folder is not in a Roughbook repo. Run roughbook init in the repo first.');
    return 1;
  }
  try {
    return await command.run(args, context);
  } catch (error) {
    io.err(describeError(error));
    return 1;
  }
}
