// What doctor does outside the repo's files: the browser, the repo's commands in their declared
// shell, a served process, the PATH and this machine's addresses. Replaced whole in tests (see
// types.ts). The repo's commands go through the per-repo queue: one at a time (decision 36).
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { hostLookup } from '../agents/index.js';
import { runCapture, runToEnd, serveUntil } from '../launch/processes.js';
import { findProgramOnPath } from '../launch/which.js';
import { queued } from '../runs/queue.js';
import { findBrowser, probePreview, takeScreenshot } from '../screenshot/browser.js';
import type { DoctorTools } from './types.js';

/** This machine's IPv4 addresses on the network, loopback left out. */
export function networkAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (item): item is os.NetworkInterfaceInfo =>
        Boolean(item) && item!.family === 'IPv4' && !item!.internal
    )
    .map(item => item.address);
}

/** A response's statuses that carry no body, which a Response refuses one for. */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * A GET of `url` that names `host` as its Host, which fetch never sends: how anyone on the
 * network can ask a dev server for a page by this machine's own name.
 */
function fetchAs(url: string, host: string, signal?: AbortSignal | null): Promise<Response> {
  const client = new URL(url).protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      { method: 'GET', headers: { host }, signal: signal ?? undefined, rejectUnauthorized: false },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 500;
          resolve(
            new Response(NO_BODY.has(status) ? null : Buffer.concat(chunks), {
              status: status >= 200 && status <= 599 ? status : 500
            })
          );
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

export function realTools(env: NodeJS.ProcessEnv, repoRoot = ''): DoctorTools {
  const browser = findBrowser(env);
  const lookup = hostLookup(env);
  return {
    // A Host header is sent as given, which fetch would leave out: doctor's loopback check asks
    // the network address by this machine's name, as anyone on the network can.
    fetch: (input, init) => {
      const host = new Headers(init?.headers).get('host');
      return host ? fetchAs(String(input), host, init?.signal) : fetch(input, init);
    },
    probe: async ({ url, overlays, timeoutMs, expect }) =>
      browser
        ? probePreview({ browser, url, overlays, timeoutMs, expect })
        : { shows: false, ready: false, error: null, visibleOverlays: 0, exceptions: [], text: '' },
    screenshot: async ({ url, file, size, overlays, variant }) =>
      browser ? takeScreenshot({ browser, url, file, size, overlays, variant }) : false,
    exec: (command, cwd, timeoutMs, shell) =>
      queued(repoRoot || cwd, () => runToEnd(command, cwd, timeoutMs, shell)),
    snapshot: (command, cwd, timeoutMs, shell, variables) =>
      queued(repoRoot || cwd, () => runCapture(command, cwd, timeoutMs, shell, variables)),
    serve: (command, cwd, url, timeoutMs, shell, options) =>
      queued(repoRoot || cwd, () => serveUntil(command, cwd, url, timeoutMs, shell, options)),
    which: program => findProgramOnPath(program, lookup),
    addresses: networkAddresses,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    browser
  };
}
