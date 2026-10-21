// What doctor does outside the repo's files: the browser, the repo's commands in their declared
// shell, a served process, the PATH and this machine's addresses. Replaced whole in tests (see
// types.ts). The repo's commands go through the per-repo queue: one at a time (decision 36).
import os from 'node:os';
import { hostLookup } from '../agents/index.js';
import { runToEnd, serveUntil } from '../launch/processes.js';
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

export function realTools(env: NodeJS.ProcessEnv, repoRoot = ''): DoctorTools {
  const browser = findBrowser(env);
  const lookup = hostLookup(env);
  return {
    fetch: (input, init) => fetch(input, init),
    probe: async ({ url, overlays, timeoutMs, expect }) =>
      browser
        ? probePreview({ browser, url, overlays, timeoutMs, expect })
        : { shows: false, ready: false, error: null, visibleOverlays: 0, exceptions: [], text: '' },
    screenshot: async ({ url, file, size, overlays }) =>
      browser ? takeScreenshot({ browser, url, file, size, overlays }) : false,
    exec: (command, cwd, timeoutMs, shell) =>
      queued(repoRoot || cwd, () => runToEnd(command, cwd, timeoutMs, shell)),
    serve: (command, cwd, url, timeoutMs, shell) =>
      queued(repoRoot || cwd, () => serveUntil(command, cwd, url, timeoutMs, shell)),
    which: program => findProgramOnPath(program, lookup),
    addresses: networkAddresses,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    browser
  };
}
