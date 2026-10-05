import { ADAPTERS, adapterFor } from '../agents/index.js';
import type { Detection, TerminalAdapter } from '../agents/types.js';
import { readSettings } from '../config/settings.js';
import { currentOs } from '../launch/platform.js';
import { ITERATION, SLUG } from '../repo/preview.js';
import type { RunAgent } from '../runs/types.js';
import { STUDIO_VERSION } from '../version.js';
import { openApi, type CommandContext } from './context.js';

function badTarget(what: string, example: string): Error {
  return new Error(`Name the ${what}, such as ${example}.`);
}

/** `<page>/<component>`. */
export function parseComponent(text: string | undefined): { page: string; component: string } {
  const [page, component, ...rest] = (text ?? '').split('/');
  if (!page || !component || rest.length || !SLUG.test(page) || !SLUG.test(component)) {
    throw badTarget('component as <page>/<component>', 'homepage/hero');
  }
  return { page, component };
}

/** `<page>/<component>/<iteration>`. */
export function parseIteration(text: string | undefined): {
  page: string;
  component: string;
  iteration: string;
} {
  const parts = (text ?? '').split('/');
  const iteration = parts.pop() ?? '';
  if (!ITERATION.test(iteration)) {
    throw badTarget('iteration as <page>/<component>/iteration-NN', 'homepage/hero/iteration-02');
  }
  try {
    return { ...parseComponent(parts.join('/')), iteration };
  } catch {
    throw badTarget('iteration as <page>/<component>/iteration-NN', 'homepage/hero/iteration-02');
  }
}

function isAgent(id: string): id is RunAgent {
  return ADAPTERS.some(adapter => adapter.id === id);
}

/**
 * The agent to use: the one named, else this install's default, else the first one found. Refused
 * when it is not installed, with the adapter's own advice.
 */
export async function chooseAgent(
  context: CommandContext,
  named: string | undefined
): Promise<{ adapter: TerminalAdapter; detection: Detection }> {
  const wanted = named ?? (await readSettings(context.configDir)).defaultAgent ?? undefined;
  if (wanted !== undefined) {
    if (!isAgent(wanted)) {
      throw new Error(
        `Unknown agent ${wanted}. Choose one of: ${ADAPTERS.map(item => item.id).join(', ')}.`
      );
    }
    const adapter = adapterFor(wanted);
    const detection = await context.detect(adapter);
    if (!detection.found) throw new Error(adapter.notFound);
    return { adapter, detection };
  }
  for (const adapter of ADAPTERS) {
    const detection = await context.detect(adapter);
    if (detection.found) return { adapter, detection };
  }
  throw new Error(
    `No coding agent was found. ${ADAPTERS.map(adapter => adapter.notFound).join(' ')}`
  );
}

/** Tells the backend this studio's version and agents; quietly does nothing when it cannot. */
export async function sendHeartbeat(
  context: CommandContext,
  detections: Detection[]
): Promise<void> {
  try {
    const { api } = await openApi(context);
    if (!api.signedIn) return;
    await api.heartbeat({
      studioVersion: STUDIO_VERSION,
      os: currentOs(context.platform),
      agents: detections
        .filter(item => item.found)
        .map(item => ({
          id: item.id,
          version:
            item.version && /^[0-9A-Za-z.+-]{1,40}$/.test(item.version) ? item.version : null,
          signedIn: item.signedIn,
          headless: item.headless.ready
        }))
    });
  } catch {
    // The heartbeat is a courtesy; the command's own work matters.
  }
}
