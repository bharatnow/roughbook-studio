import fs from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_LOCAL_PORT, readSettings, saveSettings } from '../config/settings.js';
import { loadPty } from '../launch/pty.js';
import { requireRepoLink } from '../repo/link.js';
import { createLocalServer } from '../server/app.js';
import { newToken } from '../server/security.js';
import { LocalStudio } from '../server/studio.js';
import { requireApi, type Command } from './context.js';
import { devUrl } from './done.js';

const REGISTRY_EVERY_MS = 1500;
const OUTBOX_EVERY_MS = 30_000;

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

export const start: Command = {
  name: 'start',
  summary: 'Open the local UI: iterations, review, runs, Done and promote',
  usage: 'start [--port <port>] [--dev-url <url>] [--no-open]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        port: { type: 'string' },
        'dev-url': { type: 'string' },
        'no-open': { type: 'boolean', default: false }
      }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const api = await requireApi(context);
    const settings = await readSettings(context.configDir);
    const saved = settings.localPort ?? DEFAULT_LOCAL_PORT;
    const port = values.port ? parsePort(values.port) : saved;
    const dev = devUrl(values['dev-url'], context.env);
    const pty = loadPty(context.env);

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
    io.out(`Iterations render through ${dev}; start the app's dev server there.`);
    if (!pty.ok) io.out(`Runs open in your own terminal: ${pty.reason}`);
    io.out('Press Ctrl+C to stop.');
    if (!values['no-open'] && !(await context.openUrl(url))) {
      io.out('Open the address above in a browser.');
    }

    studio.keepRegistry();
    void studio.flushOutbox();
    void studio.heartbeat();
    void studio.reportStarted();
    const timers = [
      setInterval(() => studio.keepRegistry(), REGISTRY_EVERY_MS),
      setInterval(() => void studio.flushOutbox(), OUTBOX_EVERY_MS),
      setInterval(() => void studio.flushEvents(), OUTBOX_EVERY_MS)
    ];

    await context.waitForStop();
    for (const timer of timers) clearInterval(timer);
    studio.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    io.out('Stopped. Sessions in the built-in terminal were ended.');
    return 0;
  }
};
