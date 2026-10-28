// The studio's command palette (ROUGHBOOK-QUIET-UI-PLAN.md, U5): the selection's actions, the
// canvas's own, every page, component and iteration by name, the runs and terminals, and the
// studio's settings, with no JSX so the tests can walk them. What each command does is said as
// data (`CommandRun`), and the canvas carries it out.
import {
  dimCompleteOnly,
  HOW_FAR,
  VERB_LABELS,
  matchCommands,
  type HowFar,
  type PaletteCommand,
  type VerbId
} from '@roughbook/ui/commands';
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
import { TOOLBAR_ITEMS, documentItems } from './toolbar.ts';
import { endedLabel, type AgentView, type TerminalInfo } from './types.ts';

export { matchCommands };

export type CommandRun =
  /** One of the canvas's actions, on the selection (`key`), or on the canvas. */
  | { kind: 'action'; action: StudioActionId; key: string | null; session?: string }
  /** A plain verb on the card `key` with its fields, as Something different at a How far. */
  | { kind: 'verb'; verb: VerbId; key: string; fields: Record<string, string> }
  /** The Complete features switch, to `on`. */
  | { kind: 'complete-features'; on: boolean }
  /** Select an item on the canvas and put the keyboard on it. */
  | { kind: 'select'; key: string }
  | { kind: 'href'; href: string; external?: boolean }
  | { kind: 'pull'; page: string; component: string; sketch: string }
  | { kind: 'default-agent'; agent: string }
  /** Show a terminal session in the dock. */
  | { kind: 'session'; id: string }
  /** Open the bar's status: the dev server, the outbox, the version. */
  | { kind: 'status' }
  /** Put `text` on the clipboard, and say `done` beside the bar. */
  | { kind: 'copy'; text: string; done: string }
  /** The toolbar's Generate: the canvas's prompt, with the keyboard in it. */
  | { kind: 'generate' };

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
  /** The Complete features switch; unknown, as from an older studio server, reads as on. */
  complete?: boolean;
};

/** Something different's How far, in words, as the web says them. */
export const HOW_FAR_WORDS: Record<HowFar, string> = {
  conservative: 'A little different',
  balanced: 'Quite different',
  high: 'Very different',
  wild: 'Wildly different'
};

/** The switch as the palette's context says it, on the context or its selection state. */
function completeOf(context: CommandContext): boolean | undefined {
  return context.complete ?? context.state.complete;
}

/** Recent shows this many before a query; the rest wait for one. */
const RECENT_SHOWN = 6;

function actionCommand(
  prefix: string,
  group: string,
  action: StudioAction,
  key: string | null,
  complete?: boolean
): StudioCommand {
  const command: StudioCommand = {
    id: `${prefix}:${action.id}`,
    label: action.label,
    group,
    ...(action.keys ? { hint: action.keys } : {}),
    ...(action.keywords ? { keywords: action.keywords } : {}),
    ...(action.disabled ? { disabled: action.disabled } : {}),
    run: action.href
      ? { kind: 'href', href: action.href, ...(action.external ? { external: true } : {}) }
      : {
          kind: 'action',
          action: action.id,
          key,
          ...(action.session ? { session: action.session } : {})
        }
  };
  // A complete-only command stays, found by its words, dimmed with the switch named.
  return action.completeOnly ? dimCompleteOnly(command, complete) : command;
}

function selectionCommands(selection: string, context: CommandContext): StudioCommand[] {
  const entry = canvasEntry(context.canvas.input, selection);
  if (!entry) return [];
  const group =
    entry.kind === 'card'
      ? entry.card.name
      : entry.kind === 'frame'
        ? entry.frame.name
        : entry.kind === 'composition'
          ? entry.composition.name
          : entry.section.name;
  const complete = completeOf(context);
  const state = { ...context.state, complete };
  const commands: StudioCommand[] = [];
  for (const action of selectionActions(context.canvas, selection, state)) {
    commands.push(actionCommand('selection', group, action, selection, complete));
  }
  // Something different's How far, one command a strength, found by a query.
  const different = commands.find(command => command.id === 'selection:different');
  if (different) {
    for (const howFar of HOW_FAR) {
      commands.push({
        id: `selection:different:${howFar}`,
        label: HOW_FAR_WORDS[howFar],
        group,
        keywords: ['something different', 'how far', howFar],
        quiet: true,
        ...(different.disabled ? { disabled: different.disabled } : {}),
        run: { kind: 'verb', verb: 'different', key: selection, fields: { howFar } }
      });
    }
  }
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
    toAdopt: canvas.inApp?.toAdopt ?? 0,
    pages: canvas.input.sections.length
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

/** The switch's command: turns it the other way. */
function completeCommand(complete: boolean): StudioCommand {
  return {
    id: 'complete-features',
    label: complete ? 'Turn off Complete features' : 'Turn on Complete features',
    group: 'Studio',
    keywords: ['complete', 'features', 'advanced', 'settings'],
    run: { kind: 'complete-features', on: !complete }
  };
}

/** What the palette knows off the canvas: the switch, and where the project is on the web. */
export type StudioFacts = { complete?: boolean; project?: string; webUrl?: string | null };

/** The toolbar's buttons and its document menu, as commands too (A8 step 3). */
function toolbarCommands(facts: StudioFacts): StudioCommand[] {
  const items = [
    ...TOOLBAR_ITEMS.filter(item => item.id !== 'status'),
    ...(facts.project
      ? documentItems({
          project: facts.project,
          webUrl: facts.webUrl ?? null,
          complete: facts.complete !== false
        })
      : [])
  ];
  return items.map(item => ({ id: item.id, label: item.label, group: 'Studio', run: item.run }));
}

function studioGroup(context: CommandContext | null, studio: StudioFacts = {}): StudioCommand[] {
  const commands: StudioCommand[] = [
    {
      id: 'status',
      label: 'Studio status',
      group: 'Studio',
      keywords: ['dev server', 'outbox', 'version'],
      run: { kind: 'status' }
    }
  ];
  const complete = context ? completeOf(context) : studio.complete;
  // Off the canvas only when the studio says how it is set.
  if (context || complete !== undefined) commands.push(completeCommand(complete !== false));
  commands.push(
    ...toolbarCommands(
      context ? { complete, project: context.state.project, webUrl: context.state.webUrl } : studio
    )
  );
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

/** The verbs Compare's palette runs at once on a candidate; Not this asks why, on the stage. */
const COMPARE_VERBS = ['more', 'different', 'polish', 'pick-this'] as const;

/**
 * Compare's palette (A7): each candidate's verbs that run at once, under its name, then the
 * studio's own. `served` is what the host runs; a candidate's pick stays, saying why.
 */
export function compareCommands(
  at: { page: string; component: string },
  candidates: readonly { id: string; name: string; selected: boolean }[],
  served: readonly VerbId[],
  studio: StudioFacts
): StudioCommand[] {
  const commands: StudioCommand[] = [];
  for (const candidate of candidates) {
    const key = `iteration:${at.page}/${at.component}/${candidate.id}`;
    for (const verb of COMPARE_VERBS) {
      if (!served.includes(verb)) continue;
      const disabled =
        verb === 'pick-this' && candidate.selected ? 'It is the pick already.' : undefined;
      commands.push({
        id: `compare:${candidate.id}:${verb}`,
        label: VERB_LABELS[verb],
        group: candidate.name,
        hint: candidate.id,
        ...(disabled ? { disabled } : {}),
        run: { kind: 'verb', verb, key, fields: {} }
      });
    }
  }
  return [...commands, ...studioGroup(null, studio)];
}

/**
 * The palette's commands: the selection's first, then the canvas's and the project's items, the
 * runs, the terminals, and the studio's own. Off the canvas (`null`), the studio's alone, with the
 * Complete features switch when `studio` says how it is set.
 */
export function studioCommands(
  selection: string | null,
  context: CommandContext | null,
  studio: StudioFacts = {}
): StudioCommand[] {
  if (!context) return studioGroup(null, studio);
  return [
    ...(selection ? selectionCommands(selection, context) : []),
    ...projectCommands(selection, context),
    ...terminalCommands(context),
    ...studioGroup(context)
  ];
}
