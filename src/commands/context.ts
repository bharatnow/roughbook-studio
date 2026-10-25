import type { Readable, Writable } from 'node:stream';
import type { runCommand } from '../agents/command.js';
import type { runHeadless } from '../agents/process.js';
import type { AgentAdapter, Detection } from '../agents/types.js';
import { StudioApi } from '../api/client.js';
import { readCredentials, saveCredentials, type Credentials } from '../config/credentials.js';
import { announcedServer, resolveServer } from '../config/server.js';
import type { DoctorTools } from '../doctor/types.js';
import type { Io } from '../io.js';
import { currentOs } from '../launch/platform.js';
import { telemetryDisabled } from '../telemetry/events.js';
import type { Launch } from '../launch/open.js';
import type { PtySupport } from '../launch/pty.js';
import type { TerminalPlan } from '../launch/terminal.js';
import type { PictureShot } from '../pictures/share.js';
import type { askPreview, screenshotIteration } from '../screenshot/iteration.js';
import type { ScaffoldTools } from './new.js';
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
  /** The designer's home folder, where editors keep their user-level settings. */
  home: string;
  /** Replaced in tests, so nothing reaches the network, waits or opens a browser. */
  fetch?: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  openUrl: (url: string) => Promise<boolean>;
  /** The OS, for terminal plans and the commands to paste. */
  platform: NodeJS.Platform;
  /** Finds one agent or editor and asks its version and sign-in. */
  detect: (adapter: AgentAdapter) => Promise<Detection>;
  /** Opens the terminals a plan names. */
  launchTerminal: (plan: TerminalPlan) => Promise<void>;
  /** Starts an editor, or the OS's opener, and leaves it running. */
  launchEditor: (launch: Launch) => Promise<void>;
  /** Puts text on the clipboard; false when no clipboard command worked. */
  copyText: (text: string) => Promise<boolean>;
  /** Runs a short command, such as an agent's own `mcp add`, and collects its output. */
  runCommand: typeof runCommand;
  runHeadless: typeof runHeadless;
  screenshot: typeof screenshotIteration;
  /** Takes the pictures the studio uploads (B2 of the brownfield plan); the browser's by default. */
  takePicture?: PictureShot;
  /** Asks the app's dev server once: the warming request, and whether the app answers at all. */
  askPreview: typeof askPreview;
  /** The built-in terminal's pseudo-terminal, found once per process; a fake in tests. */
  pty?: PtySupport;
  /** What roughbook doctor does outside the repo, replaced in tests. */
  doctorTools?: Partial<DoctorTools>;
  /**
   * Adds the packages a pulled sketch imports, with the command the designer approved, in the
   * repo; the app's own package manager by default, replaced in tests.
   */
  addPackages?: (repoRoot: string, command: string) => Promise<{ ok: boolean; output: string }>;
  /** What roughbook new runs and looks for on the PATH, replaced in tests. */
  scaffoldTools?: ScaffoldTools;
  /** Resolves when a long-running command should stop: Ctrl+C, or a test saying so. */
  waitForStop: () => Promise<void>;
  /** The raw streams `mcp` speaks the protocol on, and whether a person is typing into it. */
  stdio: { input: Readable; output: Writable; interactive: boolean };
};

export type Command = {
  name: string;
  summary: string;
  usage: string;
  /** Refused outside a linked repo. */
  needsRepo: boolean;
  run(args: string[], context: CommandContext): Promise<number>;
};

/** `roughbook-studio/0.3.11 (windows)`: the version and OS, nothing about the machine or repo. */
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
    api: new StudioApi({
      server,
      token,
      userAgent: userAgent(),
      fetch: context.fetch,
      telemetryOff: telemetryDisabled(context.env)
    }),
    credentials: token ? credentials : null
  };
}

/**
 * Where Roughbook answers now, when the backend gives another address than the one reached (its
 * API_URL, in /me) and this token works there too: moving the API is a change to API_URL, not a
 * studio release. Null keeps the server reached, as ROUGHBOOK_SERVER does, since a sign-in saved
 * at another server goes unused while it is set.
 */
export async function movedServer(
  context: CommandContext,
  api: StudioApi,
  apiUrl: string | undefined
): Promise<string | null> {
  const server = announcedServer(api.server, apiUrl);
  if (!server || context.env.ROUGHBOOK_SERVER) return null;
  try {
    await api.atServer(server).withTimeout(5000).me();
    return server;
  } catch {
    // Not answering there yet, or not to this token: the server reached still works.
    return null;
  }
}

/** Keeps the saved sign-in at the server Roughbook has moved to, if it has; returns the server. */
export async function followServer(
  context: CommandContext,
  api: StudioApi,
  credentials: Credentials,
  apiUrl: string | undefined
): Promise<string> {
  const server = await movedServer(context, api, apiUrl);
  if (!server) return api.server;
  await saveCredentials(context.configDir, {
    ...credentials,
    server,
    savedAt: new Date().toISOString()
  });
  return server;
}

/** The signed-in client, or an error telling the designer to sign in. */
export async function requireApi(context: CommandContext): Promise<StudioApi> {
  const { api } = await openApi(context);
  if (!api.signedIn) throw new Error('Not signed in. Run roughbook login first.');
  return api;
}
