// What doctor does outside the repo's files: the browser, the repo's commands, a served process
// and this machine's addresses. Replaced whole in tests (see types.ts).
import os from 'node:os';
import { runToEnd, serveUntil } from '../launch/processes.js';
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

export function realTools(env: NodeJS.ProcessEnv): DoctorTools {
  const browser = findBrowser(env);
  return {
    fetch: (input, init) => fetch(input, init),
    probe: async ({ url, overlays, timeoutMs, expect }) =>
      browser
        ? probePreview({ browser, url, overlays, timeoutMs, expect })
        : { shows: false, ready: false, error: null, visibleOverlays: 0, exceptions: [] },
    screenshot: async ({ url, file, size, overlays }) =>
      browser ? takeScreenshot({ browser, url, file, size, overlays }) : false,
    exec: runToEnd,
    serve: serveUntil,
    addresses: networkAddresses,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
    browser
  };
}
