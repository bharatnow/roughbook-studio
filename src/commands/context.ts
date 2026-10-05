import { StudioApi } from '../api/client.js';
import { readCredentials, type Credentials } from '../config/credentials.js';
import { resolveServer } from '../config/server.js';
import type { Io } from '../io.js';
import { currentOs } from '../launch/platform.js';
import { STUDIO_VERSION } from '../version.js';

/** What every command is given. `repoRoot` is found once, by cli.ts, and passed down. */
export type CommandContext = {
  io: Io;
  /** The folder the command was run from. Only `init` uses it, to prepare that repo. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The linked repo containing `cwd`, or null outside one. */
  repoRoot: string | null;
  /** Where the install token is kept. */
  configDir: string;
  /** Replaced in tests, so nothing reaches the network, waits or opens a browser. */
  fetch?: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  openUrl: (url: string) => Promise<boolean>;
};

export type Command = {
  name: string;
  summary: string;
  usage: string;
  /** Refused outside a linked repo. */
  needsRepo: boolean;
  run(args: string[], context: CommandContext): Promise<number>;
};

/** `roughbook-studio/0.1.0 (windows)`: the version and OS, nothing about the machine or repo. */
export function userAgent(): string {
  return `roughbook-studio/${STUDIO_VERSION} (${currentOs()})`;
}

/** A client for the saved sign-in, or a signed-out one for the server to sign in to. */
export async function openApi(
  context: CommandContext,
  serverFlag?: string
): Promise<{ api: StudioApi; credentials: Credentials | null }> {
  const credentials = await readCredentials(context.configDir);
  const server = resolveServer(serverFlag, context.env, credentials?.server);
  const token = credentials && credentials.server === server ? credentials.token : null;
  return {
    api: new StudioApi({ server, token, userAgent: userAgent(), fetch: context.fetch }),
    credentials: token ? credentials : null
  };
}

/** The signed-in client, or an error telling the designer to sign in. */
export async function requireApi(context: CommandContext): Promise<StudioApi> {
  const { api } = await openApi(context);
  if (!api.signedIn) throw new Error('Not signed in. Run roughbook login first.');
  return api;
}
