// The studio's command palette (ROUGHBOOK-QUIET-UI-PLAN.md, U5): the selection's actions, the
// canvas's own, every page, component and iteration by name, the runs and terminals, and the
// studio's settings, with no JSX so the tests can walk them. What each command does is said as
// data (`CommandRun`), and the canvas carries it out.
import { matchCommands, type PaletteCommand } from '@roughbook/ui/commands';
import { newestFirst } from '@roughbook/ui/canvas';
import {
  canvasActions,
  canvasEntry,
  selectionActions,
  type CanvasMode,
  type SelectionState,
  type StudioAction,
  type StudioActionId
} from './canvas-actions.ts';
import type { StudioCanvas } from './canvas-input.ts';
import { runWord } from './runs.ts';
import { endedLabel, type AgentView, type TerminalInfo } from './types.ts';

export { matchCommands };

export type CommandRun =
  /** One of the canvas's actions, on the selection (`key`), or on the canvas. */
  | { kind: 'action'; action: StudioActionId; key: string | null; session?: string }
  /** Select an item on the canvas and put the keyboard on it. */
  | { kind: 'select'; key: string }
  | { kind: 'href'; href: string; external?: boolean }
  | { kind: 'pull'; page: string; component: string; sketch: string }
  | { kind: 'default-agent'; agent: string }
  /** Show a terminal session in the dock. */
  | { kind: 'session'; id: string }
  /** Open the bar's status: the dev server, the outbox, the version. */
  | { kind: 'status' };

export type StudioCommand = PaletteCommand & { run: CommandRun };

/** What the canvas knows when the palette opens. */
export type CommandContext = {
  /** The project's name, the heading of the canvas's commands. */
  name: string;
  canvas: StudioCanvas;
  state: SelectionState;
  mode: CanvasMode;
  sessions: TerminalInfo[];
  agents: AgentView[];
  defaultAgent: string | null;
};

/** Recent shows this many before a query; the rest wait for one. */
const RECENT_SHOWN = 6;

function actionCommand(
  prefix: string,
  group: string,
  action: StudioAction,
  key: string | null
): StudioCommand {
  return {
    id: `${prefix}:${action.id}`,
    label: action.label,
    group,
    ...(action.keys ? { hint: action.keys } : {}),
    run: action.href
      ? { kind: 'href', href: action.href, ...(action.external ? { external: true } : {}) }
      : {
          kind: 'action',
          action: action.id,
          key,
          ...(action.session ? { session: action.session } : {})
        }
  };
}

function selectionCommands(selection: string, context: CommandContext): StudioCommand[] {
  const entry = canvasEntry(context.canvas.input, selection);
  if (!entry) return [];
  const group =
    entry.kind === 'card'
      ? entry.card.name
      : entry.kind === 'frame'
        ? entry.frame.name
        : entry.section.name;
  const commands = selectionActions(context.canvas, selection, context.state).map(action =>
    actionCommand('selection', group, action, selection)
  );
  if (entry.kind === 'frame') {
    const page = entry.section.id;
    const component = entry.frame.id;
    for (const { sketch } of context.canvas.pulled[`${page}/${component}`] ?? []) {
      if (commands.some(command => command.id === `pull:${sketch}`)) continue;
      commands.push({
        id: `pull:${sketch}`,
        label: `Pull ${sketch} again`,
        group,
        run: { kind: 'pull', page, component, sketch }
      });
    }
  }
  return commands;
}

function projectCommands(selection: string | null, context: CommandContext): StudioCommand[] {
  const { canvas, name } = context;
  const commands = canvasActions(selection, {
    mode: context.mode,
    sessions: context.sessions.length,
    map: Boolean(canvas.inApp?.pages.length),
    toAdopt: canvas.inApp?.toAdopt ?? 0
  }).map(action => actionCommand('canvas', name, action, selection));

  for (const section of canvas.input.sections) {
    commands.push({
      id: `item:page:${section.id}`,
      label: section.name,
      group: 'Pages and components',
      quiet: true,
      run: { kind: 'select', key: `page:${section.id}` }
    });
    for (const frame of section.frames) {
      commands.push({
        id: `item:component:${section.id}/${frame.id}`,
        label: frame.name,
        group: 'Pages and components',
        hint: section.name,
        quiet: true,
        run: { kind: 'select', key: `component:${section.id}/${frame.id}` }
      });
    }
  }

  const cards = canvas.input.sections
    .flatMap(section =>
      section.frames.flatMap(frame =>
        frame.cards.map(card => ({ card, where: `${section.id}/${frame.id}`, frame }))
      )
    )
    .sort((a, b) => newestFirst(a.card, b.card));
  cards.forEach(({ card, where, frame }, index) => {
    commands.push({
      id: `recent:${where}/${card.id}`,
      label: card.name,
      group: 'Recent',
      hint: `${frame.name} · ${card.id}`,
      keywords: [card.status.word],
      ...(index >= RECENT_SHOWN ? { quiet: true } : {}),
      run: { kind: 'select', key: `iteration:${where}/${card.id}` }
    });
  });

  // The open runs, newest first, as the local server lists them.
  const open = Object.entries(canvas.cards).flatMap(([key, facts]) =>
    facts.run ? [{ key, run: facts.run }] : []
  );
  open.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  for (const { key, run } of open) {
    commands.push({
      id: `run:${run.runId}`,
      label: `${run.iteration} · ${runWord(run)}`,
      group: 'Runs',
      hint: `${run.page}/${run.component}`,
      run: { kind: 'select', key }
    });
  }
  return commands;
}

function terminalCommands(context: CommandContext): StudioCommand[] {
  return context.sessions.map(session => ({
    id: `session:${session.id}`,
    label: session.title,
    group: 'Terminals',
    hint: endedLabel(session),
    run: { kind: 'session', id: session.id }
  }));
}

function studioGroup(context: CommandContext | null): StudioCommand[] {
  const commands: StudioCommand[] = [
    {
      id: 'status',
      label: 'Studio status',
      group: 'Studio',
      keywords: ['dev server', 'outbox', 'version'],
      run: { kind: 'status' }
    }
  ];
  if (!context) return commands;
  for (const agent of context.agents) {
    if (!agent.found || agent.id === context.defaultAgent) continue;
    commands.push({
      id: `agent:${agent.id}`,
      label: `Make ${agent.name} the default agent`,
      group: 'Studio',
      run: { kind: 'default-agent', agent: agent.id }
    });
  }
  if (context.state.webUrl) {
    commands.push({
      id: 'web-project',
      label: 'Open the project on the web',
      group: 'Studio',
      keywords: ['brief'],
      run: {
        kind: 'href',
        href: `${context.state.webUrl}/projects/${context.state.project}`,
        external: true
      }
    });
  }
  return commands;
}

/**
 * The palette's commands: the selection's first, then the canvas's and the project's items, the
 * runs, the terminals, and the studio's own. Off the canvas (`null`), the studio's alone.
 */
export function studioCommands(
  selection: string | null,
  context: CommandContext | null
): StudioCommand[] {
  if (!context) return studioGroup(null);
  return [
    ...(selection ? selectionCommands(selection, context) : []),
    ...projectCommands(selection, context),
    ...terminalCommands(context),
    ...studioGroup(context)
  ];
}
