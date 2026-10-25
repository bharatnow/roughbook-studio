import fs from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_LOCAL_PORT, readSettings, saveSettings } from '../config/settings.js';
import { loadPty } from '../launch/pty.js';
import { requireRepoLink } from '../repo/link.js';
import { closeKeptBrowsers } from '../screenshot/browser.js';
import { createLocalServer } from '../server/app.js';
import { newToken } from '../server/security.js';
import { LocalStudio } from '../server/studio.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { devUrl } from './done.js';
import { readEnvironment } from '../environment/read.js';
import { MAP_FILE } from '../map/file.js';
import { countMap, refreshMap } from '../map/run.js';
import { ROUGH_DIR } from '../repo/root.js';
import { approveEnvironment } from './setup.js';

const REGISTRY_EVERY_MS = 1500;
const OUTBOX_EVERY_MS = 30_000;
/** How often the app is asked whether it answers: often while it starts, rarely once it does. */
const APP_STARTING_EVERY_MS = 2000;
const APP_UP_EVERY_MS = 15_000;

/** The built UI: beside the compiled commands in the package, or in dist/ when run from source. */
export function findUiDir(): string | null {
  const candidates = [
    new URL('../ui/', import.meta.url),
    new URL('../../dist/ui/', import.meta.url)
  ];
  for (const candidate of candidates) {
    const dir = fileURLToPath(candidate);
    if (fs.existsSync(`${dir}index.html`)) return dir;
  }
  return null;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is in use. Is roughbook start already running here? Choose another with --port.`
          )
        );
      } else {
        reject(error);
      }
    });
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function parsePort(text: string): number {
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('The port is a number from 1024 to 65535.');
  }
  return port;
}

/**
 * Starts the app for previews with the environment's approved start command, in the studio's
 * terminals, unless something already answers at its address (ROUGHBOOK-FRAMEWORKS-PLAN.md,
 * "The preview frame"). With no start command, no built-in terminal, or no approval, it says what
 * to run by hand instead.
 */
async function startApp(
  context: CommandContext,
  studio: LocalStudio,
  repoRoot: string,
  dev: string
): Promise<void> {
  const { io } = context;
  const environment = studio.environment;
  if (studio.standaloneMode) {
    io.out(
      `Iterations render through the studio's own server at ${studio.devUrl} (standalone mode); nothing of the app needs to run.`
    );
    return;
  }
  if (studio.snapshotMode) {
    io.out(
      "Iterations render as images through the repo's snapshot command (snapshot mode), when they change; nothing of the app needs to run."
    );
    return;
  }
  const command = environment.start.command;
  const where = `Iterations render through ${dev}`;
  if (!command || environment.start.url !== dev) {
    io.out(`${where}; start the app's dev server there.`);
    return;
  }
  if ((await studio.checkApp()).status === 'up') {
    io.out(`The app answers at ${dev}; iterations render through it.`);
    return;
  }
  if (!studio.terminals) {
    io.out(`${where}. Start the app there: ${command}`);
    return;
  }
  const approved = await approveEnvironment(
    context,
    repoRoot,
    environment,
    false,
    'Run roughbook doctor in a terminal and approve them, or roughbook doctor --yes once you have read them.'
  );
  if (!approved) {
    io.out(`${where}. Start the app there yourself: ${command}`);
    return;
  }
  const result = await studio.startApp();
  io.out(
    result.started
      ? `Starting the app: ${command} (in the studio's terminals; ${where.toLowerCase()}).`
      : `${result.reason ?? 'The app was not started.'} ${where}.`
  );
}

export const start: Command = {
  name: 'start',
  summary: 'Open the local UI: iterations, review, runs, Done and promote',
  usage: 'start [--port <port>] [--dev-url <url>] [--no-open] [--no-app]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        port: { type: 'string' },
        'dev-url': { type: 'string' },
        'no-open': { type: 'boolean', default: false },
        'no-app': { type: 'boolean', default: false }
      }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    const api = await requireApi(context);
    // The map again, when the app's sources changed since it was written (B1 of the brownfield plan).
    try {
      const refreshed = await refreshMap(repoRoot, environment, link);
      if (refreshed?.changed)
        io.out(`${ROUGH_DIR}/${MAP_FILE} refreshed: ${countMap(refreshed.map)}.`);
    } catch (error) {
      io.err(
        `The map was not refreshed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const settings = await readSettings(context.configDir);
    const saved = settings.localPort ?? DEFAULT_LOCAL_PORT;
    const port = values.port ? parsePort(values.port) : saved;
    const dev = devUrl(values['dev-url'], context.env, environment.start.url);
    const pty = context.pty ?? loadPty(context.env);

    const studio = new LocalStudio({
      context: { ...context, repoRoot },
      api,
      link,
      devUrl: dev,
      port,
      pty
    });
    const token = newToken();
    const server = createLocalServer({
      studio,
      port,
      token,
      uiDir: findUiDir(),
      devUrl: dev,
      project: link.project
    });
    await listen(server, port);
    if (port !== saved) {
      // Iterations load their asset files from this address, so new prompts name it from now on.
      await saveSettings(context.configDir, { localPort: port });
      io.out(`New prompts name port ${port} for asset files; iterations made before use ${saved}.`);
    }

    const url = `http://127.0.0.1:${port}/#token=${token}`;
    io.out(`Roughbook is open for ${link.project} at ${url}`);
    if (values['no-app'] && !studio.standaloneMode && !studio.snapshotMode)
      io.out(`Iterations render through ${dev}; start the app's dev server there.`);
    else await startApp(context, studio, repoRoot, dev);
    if (!pty.ok) io.out(`Runs open in your own terminal: ${pty.reason}`);
    io.out('Press Ctrl+C to stop.');
    if (!values['no-open'] && !(await context.openUrl(url))) {
      io.out('Open the address above in a browser.');
    }

    studio.keepRegistry();
    // Started now and awaited at the end, so nothing writes to the state folder after Stopped.
    const started = Promise.allSettled([
      studio.flushOutbox(),
      studio.heartbeat(),
      studio.reportStarted()
    ]);
    // Iteration folders are watched while the UI is open: the frame reloads on a change where the
    // stack has no hot reload, and the changed iteration's screenshots are taken again.
    const stopWatching = studio.watch();
    let appTimer: NodeJS.Timeout | null = null;
    let stopping = false;
    let appCheck: Promise<unknown> = Promise.resolve();
    const keepApp = () => {
      appCheck = studio.checkApp().then(app => {
        if (stopping) return;
        appTimer = setTimeout(
          keepApp,
          app.status === 'up' ? APP_UP_EVERY_MS : APP_STARTING_EVERY_MS
        );
      });
    };
    keepApp();
    const timers = [
      setInterval(() => studio.keepRegistry(), REGISTRY_EVERY_MS),
      setInterval(() => void studio.flushOutbox(), OUTBOX_EVERY_MS),
      setInterval(() => void studio.flushEvents(), OUTBOX_EVERY_MS)
    ];

    await context.waitForStop();
    stopping = true;
    for (const timer of timers) clearInterval(timer);
    if (appTimer) clearTimeout(appTimer);
    stopWatching();
    await Promise.allSettled([started, appCheck]);
    studio.close();
    await closeKeptBrowsers();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    io.out('Stopped. Sessions in the built-in terminal were ended.');
    return 0;
  }
};
