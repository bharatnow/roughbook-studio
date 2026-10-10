import { parseArgs } from 'node:util';
import { adapterFor } from '../agents/index.js';
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
  print: boolean
): Promise<boolean> {
  const { io } = context;
  const cli = target.id === 'claude-code' ? 'claude' : target.id;
  const line = commandLine(cli, target.add(server));
  if (print) {
    io.out(`${target.name}: run`);
    io.out(`  ${line}`);
    return true;
  }
  const detection = await context.detect(adapterFor(target.id));
  if (detection.found && detection.executable) {
    await context.runCommand(detection.executable, target.remove, 30_000);
    const added = await context.runCommand(detection.executable, target.add(server), 30_000);
    if (added.ok) {
      io.out(`${target.name}: added ${SERVER_NAME} with ${cli} mcp add.`);
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
  print: boolean
): Promise<boolean> {
  const { io } = context;
  const where: Where = { platform: context.platform, home: context.home, env: context.env };
  const shown = snippet(target, server).trimEnd().split('\n');
  if (print) {
    io.out(`${target.name}: in ${target.files(where)[0]!.file}`);
    for (const line of shown) io.out(`  ${line}`);
    return true;
  }
  let ok = true;
  for (const { file, onlyIfThere } of target.files(where)) {
    const status = await mergeEntry(file, target.key, target.entry(server), onlyIfThere);
    if (status === 'skipped') continue;
    if (status === 'unreadable') {
      ok = false;
      io.out(`${target.name}: ${file} is not plain JSON, so it was left alone. Add this to it:`);
      for (const line of shown) io.out(`  ${line}`);
      continue;
    }
    const said = { added: 'added to', updated: 'updated in', unchanged: 'already in' }[status];
    io.out(`${target.name}: ${SERVER_NAME} ${said} ${file}`);
  }
  return ok;
}

/** `mcp install [<editor>...]`: the named ones, else every editor and agent found here. */
async function install(args: string[], context: CommandContext): Promise<number> {
  const { io } = context;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      print: { type: 'boolean', default: false },
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
    for (const target of MCP_TARGETS) {
      if ((await context.detect(adapterFor(target.id))).found) targets.push(target);
    }
    if (!targets.length) {
      throw new Error(
        `No editor or agent that takes MCP servers was found. Name one, such as roughbook mcp install cursor. Choose from: ${ids}.`
      );
    }
  }
  targets = [...new Set(targets)];

  const server = serverCommand({
    platform: context.platform,
    node: process.execPath,
    ...thisStudio(),
    devUrl: values['dev-url'] ? devUrl(values['dev-url'], context.env) : undefined
  });
  let ok = true;
  for (const target of targets) {
    const done =
      target.kind === 'cli'
        ? await addThroughCli(context, target, server, values.print)
        : await addToFiles(context, target, server, values.print);
    ok &&= done;
  }
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
  usage: 'mcp [install [<editor>...] [--print]] [--dev-url <url>]',
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
