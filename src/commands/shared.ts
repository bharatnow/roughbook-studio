import path from 'node:path';
import { ADAPTERS, ALL_AGENTS, adapterFor } from '../agents/index.js';
import type { AgentAdapter, Detection, EditorAdapter } from '../agents/types.js';
import { readSettings } from '../config/settings.js';
import { openerFor } from '../launch/open.js';
import { hasEntry, mcpTarget } from '../mcp/install.js';
import { currentOs } from '../launch/platform.js';
import { ITERATION, SLUG } from '../repo/iterations.js';
import { handoffLine } from '../runs/slots.js';
import type { RunAgent } from '../runs/types.js';
import { STUDIO_VERSION } from '../version.js';
import { followServer, openApi, type CommandContext } from './context.js';

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
  return ALL_AGENTS.some(adapter => adapter.id === id);
}

/**
 * The agent to use: the one named, else this install's default, else the first one found,
 * terminal agents before editors; "your own editor" only when asked for. Refused when it is not
 * installed, with the adapter's own advice.
 */
export async function chooseAgent(
  context: CommandContext,
  named: string | undefined
): Promise<{ adapter: AgentAdapter; detection: Detection }> {
  const wanted = named ?? (await readSettings(context.configDir)).defaultAgent ?? undefined;
  if (wanted !== undefined) {
    if (!isAgent(wanted)) {
      throw new Error(
        `Unknown agent ${wanted}. Choose one of: ${ALL_AGENTS.map(item => item.id).join(', ')}.`
      );
    }
    const adapter = adapterFor(wanted);
    const detection = await context.detect(adapter);
    if (!detection.found) throw new Error(adapter.notFound);
    return { adapter, detection };
  }
  for (const adapter of ALL_AGENTS.filter(item => item.id !== 'other')) {
    const detection = await context.detect(adapter);
    if (detection.found) return { adapter, detection };
  }
  throw new Error(
    `No coding agent or editor was found. ${ADAPTERS.map(adapter => adapter.notFound).join(' ')} Or pass --agent other to open the prompt in your own editor.`
  );
}

/** What an editor run's launch did, for the CLI and the local UI to say. */
export type EditorLaunched = {
  kind: 'editor';
  editor: string;
  /** Where the prompt opened: in the editor, in the OS's default app, or nowhere. */
  opened: 'editor' | 'default-app' | null;
  /** Whether the first instruction is on the clipboard. */
  copied: boolean;
  /** One per prompt, each for a fresh chat with the editor's agent. */
  instructions: string[];
  /**
   * Whether the editor has the studio's MCP server, so its agent finishes the run itself, with the
   * command that adds it; null when that cannot be told.
   */
  mcp: { ready: boolean; install: string } | null;
};

/**
 * Opens the repo and the prompts in the editor, else the first prompt in the OS's default app,
 * and puts the first instruction on the clipboard for the editor's agent chat.
 */
export async function openInEditor(
  context: CommandContext,
  adapter: EditorAdapter,
  detection: Detection,
  repoRoot: string,
  promptFiles: string[],
  options: { finish?: boolean } = {}
): Promise<EditorLaunched> {
  const files = promptFiles.map(file => path.join(repoRoot, ...file.split('/')));
  // An iteration run ends through the MCP tools; a setup run or a promotion does not.
  const instructions = promptFiles.map(file => handoffLine(file, options.finish ?? true));
  let opened: EditorLaunched['opened'] = null;
  const executable = detection.executable;
  if (executable) {
    try {
      await context.launchEditor({
        command: executable.command,
        args: [...executable.prefixArgs, ...adapter.openArgs(repoRoot, files)],
        ...(executable.env ? { env: executable.env } : {})
      });
      opened = 'editor';
    } catch {
      // The default app below.
    }
  }
  const opener = opened ? null : openerFor(files[0]!, context.platform);
  if (opener) {
    try {
      await context.launchEditor(opener);
      opened = 'default-app';
    } catch {
      // Said by the caller: the file is named for the designer to open.
    }
  }
  const copied = await context.copyText(instructions[0]!);
  const target = mcpTarget(adapter.id);
  const ready = target
    ? await hasEntry(target, { platform: context.platform, home: context.home, env: context.env })
    : null;
  const mcp = ready === null ? null : { ready, install: `roughbook mcp install ${adapter.id}` };
  return { kind: 'editor', editor: adapter.name, opened, copied, instructions, mcp };
}

/** What the CLI says after an editor launch. */
export function sayEditorLaunch(
  io: CommandContext['io'],
  launched: EditorLaunched,
  promptFiles: string[]
): void {
  const where = launched.editor === 'Your own editor' ? 'your editor' : launched.editor;
  if (launched.opened === 'editor') {
    io.out(
      `Opened the repo and ${promptFiles.length === 1 ? 'the prompt' : 'the prompts'} in ${where}.`
    );
  } else if (launched.opened === 'default-app') {
    io.out(`Opened ${promptFiles[0]} with your default app.`);
  } else {
    io.out(`Open ${promptFiles[0]} in ${where}.`);
  }
  const [first, ...rest] = launched.instructions;
  io.out(
    launched.copied
      ? `On the clipboard, to paste into a new chat with ${where === 'your editor' ? 'your agent' : `${where}'s agent`}:`
      : `Paste this into a new chat with ${where === 'your editor' ? 'your agent' : `${where}'s agent`}:`
  );
  io.out(`  ${first}`);
  if (rest.length) {
    io.out('Then each of these, one chat per iteration:');
    for (const instruction of rest) io.out(`  ${instruction}`);
  }
  if (launched.mcp?.ready === false) {
    io.out(
      `Run ${launched.mcp.install} once, so ${where}'s agent can check and finish runs itself.`
    );
  }
}

/** Tells the backend this studio's version and agents; quietly does nothing when it cannot. */
export async function sendHeartbeat(
  context: CommandContext,
  detections: Detection[]
): Promise<void> {
  try {
    const { api, credentials } = await openApi(context);
    if (!api.signedIn || !credentials) return;
    await api.heartbeat({
      studioVersion: STUDIO_VERSION,
      os: currentOs(context.platform),
      agents: detections
        // "Your own editor" is always there; it says nothing about this machine.
        .filter(item => item.found && item.id !== 'other')
        .map(item => ({
          id: item.id,
          version:
            item.version && /^[0-9A-Za-z.+-]{1,40}$/.test(item.version) ? item.version : null,
          signedIn: item.signedIn,
          headless: item.headless.ready
        }))
    });
    // Signed-in studios follow the API to its new address while the old one still answers.
    await followServer(context, api, credentials, (await api.me()).apiUrl);
  } catch {
    // The heartbeat is a courtesy; the command's own work matters.
  }
}
