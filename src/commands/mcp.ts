import { parseArgs } from 'node:util';
import { adapterFor } from '../agents/index.js';
import { askYesNo } from '../io.js';
import { recipeFor } from '../recipes/index.js';
import {
  MCP_TARGETS,
  SERVER_NAME,
  mcpTarget,
  mergeEntry,
  serverCommand,
  snippet,
  thisStudio,
  type McpTarget,
  type ServerCommand,
  type Where
} from '../mcp/install.js';
import { stableBinaryPath, standaloneBinary } from '../launch/runtime.js';
import {
  XCODE_BRIDGE,
  XCODE_BRIDGE_MISSING,
  XCODE_BRIDGE_NEEDS,
  XCODE_SERVER_NAME,
  findXcodeBridge
} from '../launch/xcode.js';
import { McpServer, serveStdio } from '../mcp/server.js';
import { INSTRUCTIONS, studioTools } from '../mcp/tools.js';
import { STUDIO_VERSION } from '../version.js';
import type { Command, CommandContext } from './context.js';
import { devUrl } from './done.js';

/** One argument as a person would type it: quoted when it has spaces. */
function shellWord(word: string): string {
  return /[\s"]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word;
}

function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellWord).join(' ');
}

/** The agent's own `mcp add`, run with the agent the studio found; the line to paste otherwise. */
async function addThroughCli(
  context: CommandContext,
  target: Extract<McpTarget, { kind: 'cli' }>,
  server: ServerCommand,
  print: boolean,
  name = SERVER_NAME
): Promise<boolean> {
  const { io } = context;
  const cli = target.id === 'claude-code' ? 'claude' : target.id;
  const line = commandLine(cli, target.add(server, name));
  if (print) {
    io.out(`${target.name}: run`);
    io.out(`  ${line}`);
    return true;
  }
  const detection = await context.detect(adapterFor(target.id));
  if (detection.found && detection.executable) {
    await context.runCommand(detection.executable, target.remove(name), 30_000);
    const added = await context.runCommand(detection.executable, target.add(server, name), 30_000);
    if (added.ok) {
      io.out(`${target.name}: added ${name} with ${cli} mcp add.`);
      return true;
    }
    const why = added.stderr.trim().split(/\r?\n/)[0] || `it exited with ${added.code}`;
    io.out(`${target.name}: ${cli} mcp add did not work (${why}). Run it yourself:`);
  } else {
    io.out(`${target.name} was not found here. Once it is installed, run:`);
  }
  io.out(`  ${line}`);
  return false;
}

/** Merges the entry into each file the editor reads, or shows it for pasting. */
async function addToFiles(
  context: CommandContext,
  target: Extract<McpTarget, { kind: 'file' }>,
  server: ServerCommand,
  print: boolean,
  name = SERVER_NAME
): Promise<boolean> {
  const { io } = context;
  const where: Where = { platform: context.platform, home: context.home, env: context.env };
  const shown = snippet(target, server, name).trimEnd().split('\n');
  if (print) {
    io.out(`${target.name}: in ${target.files(where)[0]!.file}`);
    for (const line of shown) io.out(`  ${line}`);
    return true;
  }
  let ok = true;
  for (const { file, onlyIfThere } of target.files(where)) {
    const status = await mergeEntry(file, target.key, target.entry(server), onlyIfThere, name);
    if (status === 'skipped') continue;
    if (status === 'unreadable') {
      ok = false;
      io.out(`${target.name}: ${file} is not plain JSON, so it was left alone. Add this to it:`);
      for (const line of shown) io.out(`  ${line}`);
      continue;
    }
    const said = { added: 'added to', updated: 'updated in', unchanged: 'already in' }[status];
    io.out(`${target.name}: ${name} ${said} ${file}`);
  }
  return ok;
}

/** One target's entry, by its agent's own command or in its file. */
function addTo(
  context: CommandContext,
  target: McpTarget,
  server: ServerCommand,
  print: boolean,
  name = SERVER_NAME
): Promise<boolean> {
  return target.kind === 'cli'
    ? addThroughCli(context, target, server, print, name)
    : addToFiles(context, target, server, print, name);
}

/** Every editor and agent found here, once each: a CLI counts for the file its editor reads. */
async function foundTargets(context: CommandContext): Promise<McpTarget[]> {
  const found: McpTarget[] = [];
  for (const target of MCP_TARGETS) {
    for (const id of target.agents) {
      if ((await context.detect(adapterFor(id))).found) {
        found.push(target);
        break;
      }
    }
  }
  return found;
}

/** The agents Xcode's bridge is added for (A13 of the Apple plan). */
const XCODE_TARGETS: readonly string[] = ['claude-code', 'codex', 'cursor'];

/**
 * Adds Xcode's MCP bridge beside the studio's server, for each target that takes it, when
 * `xcrun --find mcpbridge` resolves on a Mac; one line saying why not otherwise. `bridge` is the
 * answer already found, when the caller asked first.
 */
async function addXcodeBridge(
  context: CommandContext,
  targets: McpTarget[],
  print: boolean,
  bridge?: string | null
): Promise<boolean> {
  const { io } = context;
  const found =
    bridge === undefined ? await findXcodeBridge(context.platform, context.runCommand) : bridge;
  if (!found) {
    io.out(XCODE_BRIDGE_MISSING);
    return true;
  }
  let ok = true;
  for (const target of targets) {
    if (!XCODE_TARGETS.includes(target.id)) {
      io.out(`${target.name}: Xcode's bridge is added only for Claude Code, Codex and Cursor.`);
      continue;
    }
    ok = (await addTo(context, target, XCODE_BRIDGE, print, XCODE_SERVER_NAME)) && ok;
  }
  io.out(`The ${XCODE_SERVER_NAME} server hands the agent Xcode's tools. ${XCODE_BRIDGE_NEEDS}`);
  return ok;
}

/**
 * Whether a repo's stack takes Xcode's bridge: its recipe says so, or the recipe its family is
 * named for does, as for an app project the setup run fits without a recipe.
 */
export function takesXcodeBridge(stack: {
  recipe?: string | null;
  family?: string | null;
}): boolean {
  return Boolean(recipeFor(stack.recipe)?.xcodeBridge || recipeFor(stack.family)?.xcodeBridge);
}

/**
 * What `init` and `setup` offer a repo whose recipe takes Xcode's bridge, on a Mac whose Xcode
 * has it: asked, never done silently; no, or nobody to answer, adds nothing.
 */
export async function offerXcodeBridge(
  context: CommandContext,
  stack: { recipe?: string | null; family?: string | null }
): Promise<void> {
  if (!takesXcodeBridge(stack)) return;
  const bridge = await findXcodeBridge(context.platform, context.runCommand);
  if (!bridge) return;
  const targets = (await foundTargets(context)).filter(target => XCODE_TARGETS.includes(target.id));
  if (!targets.length) return;
  const { io } = context;
  const names = targets.map(target => target.name).join(', ');
  const yes = await askYesNo(
    io,
    `Add Xcode's MCP bridge (xcrun mcpbridge) to ${names}, so the agent can use Xcode's tools? ${XCODE_BRIDGE_NEEDS}`,
    false
  );
  if (!yes) {
    io.out("Xcode's bridge was not added. roughbook mcp install --xcode adds it later.");
    return;
  }
  await addXcodeBridge(context, targets, false, bridge);
}

/** `mcp install [<editor>...]`: the named ones, else every editor and agent found here. */
async function install(args: string[], context: CommandContext): Promise<number> {
  const { io } = context;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      print: { type: 'boolean', default: false },
      xcode: { type: 'boolean', default: false },
      'dev-url': { type: 'string' }
    }
  });
  const ids = MCP_TARGETS.map(target => target.id).join(', ');
  let targets: McpTarget[] = [];
  if (positionals.length) {
    for (const id of positionals) {
      const target = mcpTarget(id);
      if (!target) throw new Error(`Unknown editor ${id}. Choose one of: ${ids}.`);
      targets.push(target);
    }
  } else {
    targets = await foundTargets(context);
    if (!targets.length) {
      throw new Error(
        `No editor or agent that takes MCP servers was found. Name one, such as roughbook mcp install cursor. Choose from: ${ids}.`
      );
    }
  }
  targets = [...new Set(targets)];

  const binary = standaloneBinary();
  const server = serverCommand({
    platform: context.platform,
    // The binary by a path that outlives an upgrade, for the editors that keep it.
    node: binary ? stableBinaryPath(context.env) : process.execPath,
    ...thisStudio(),
    binary,
    devUrl: values['dev-url'] ? devUrl(values['dev-url'], context.env) : undefined,
    // The folder as resolved here, since an editor starts the server in a folder of its own.
    configDir: context.env.ROUGHBOOK_CONFIG_DIR ? context.configDir : undefined
  });
  let ok = true;
  for (const target of targets) {
    ok = (await addTo(context, target, server, values.print)) && ok;
  }
  if (values.xcode) ok = (await addXcodeBridge(context, targets, values.print)) && ok;
  if (!values.print) {
    io.out('');
    io.out(
      `Restart ${targets.length === 1 ? targets[0]!.name : 'each one'}, or reload its window, so its agent has the ${SERVER_NAME} tools. After roughbook run, the agent can check and finish the run itself.`
    );
  }
  return ok ? 0 : 1;
}

export const mcp: Command = {
  name: 'mcp',
  summary: "Serve runs to an editor's agent over MCP; install adds it to your editors",
  usage: 'mcp [install [<editor>...] [--xcode] [--print]] [--dev-url <url>]',
  needsRepo: false,
  async run(args, context) {
    if (args[0] === 'install') return install(args.slice(1), context);
    const { values } = parseArgs({ args, options: { 'dev-url': { type: 'string' } } });
    const url = devUrl(values['dev-url'], context.env);
    if (context.stdio.interactive) {
      context.io.err(
        'roughbook mcp is the server an editor starts for its agent, so it waits for one here. To add it to your editors, run roughbook mcp install.'
      );
      return 0;
    }
    const tools = studioTools(context, { devUrl: url });
    const serving = serveStdio(
      send =>
        new McpServer({
          info: { name: SERVER_NAME, title: 'Roughbook', version: STUDIO_VERSION },
          instructions: INSTRUCTIONS,
          tools,
          send
        }),
      context.stdio.input,
      context.stdio.output
    );
    await Promise.race([serving, context.waitForStop()]);
    return 0;
  }
};
