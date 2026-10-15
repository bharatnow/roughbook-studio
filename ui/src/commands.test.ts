import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutCanvas } from '@roughbook/ui/canvas';
import { PROJECT, RUNS, TERMINAL } from './canvas-fixture.ts';
import {
  canvasActions,
  selectionActions,
  type CanvasMode,
  type SelectionState
} from './canvas-actions.ts';
import { studioCanvasInput } from './canvas-input.ts';
import { matchCommands, studioCommands, type CommandContext } from './commands.ts';
import type { AgentView } from './types.ts';

const canvas = studioCanvasInput(PROJECT.tree, RUNS, PROJECT.local);
const STATE: SelectionState = {
  project: 'site',
  webUrl: 'https://roughbook.example',
  compare: [],
  unfolded: []
};

function agent(id: string, name: string, found = true): AgentView {
  return {
    id,
    name,
    kind: 'terminal',
    found,
    version: null,
    signedIn: true,
    signIn: null,
    headless: { ready: true }
  };
}

const CONTEXT: CommandContext = {
  name: 'Site',
  canvas,
  state: STATE,
  mode: 'canvas',
  sessions: [TERMINAL, { ...TERMINAL, id: 'promote-1', runId: null, title: 'Promote Hero' }],
  agents: [
    agent('claude-code', 'Claude Code'),
    agent('codex', 'Codex'),
    agent('aider', 'Aider', false)
  ],
  defaultAgent: 'claude-code'
};

const groups = (commands: { group: string }[]) => [...new Set(commands.map(item => item.group))];

describe("the studio's palette", () => {
  it("lists the selection's commands first, then the project's, the terminals and the studio's", () => {
    const commands = studioCommands('iteration:home/hero/iteration-01', CONTEXT);
    assert.deepEqual(groups(commands), [
      'Direction 01',
      'Site',
      'Pages and components',
      'Recent',
      'Runs',
      'Terminals',
      'Studio'
    ]);
    assert.deepEqual(
      commands.filter(item => item.group === 'Direction 01').map(item => item.label),
      ['Open', 'Fork', 'Refine', 'Pick', 'Promote', 'Open on the web']
    );
    // Off the canvas, as on the stage: the studio's alone.
    assert.deepEqual(groups(studioCommands(null, null)), ['Studio']);
  });

  it('has a command for every action the canvas offers, for every item and view', () => {
    const items = layoutCanvas(canvas.input).items.map(item => item.key);
    for (const mode of ['canvas', 'list', 'phone'] as CanvasMode[]) {
      for (const compare of [
        [],
        ['iteration:home/hero/iteration-01', 'iteration:home/hero/iteration-02']
      ]) {
        const state = { ...STATE, compare };
        for (const key of [null, ...items]) {
          const context = { ...CONTEXT, mode, state };
          const commands = studioCommands(key, context);
          const offered = [
            ...(key ? selectionActions(canvas, key, state) : []),
            ...canvasActions(key, { mode, sessions: CONTEXT.sessions.length })
          ];
          for (const action of offered) {
            assert.ok(
              commands.some(
                command =>
                  command.label === action.label &&
                  (command.run.kind === 'href'
                    ? command.run.href === action.href
                    : command.run.kind === 'action' && command.run.action === action.id)
              ),
              `${key ?? 'the canvas'} in ${mode}: ${action.label}`
            );
          }
        }
      }
    }
  });

  it("says each action's key, and runs a link as a link", () => {
    const commands = studioCommands('iteration:home/hero/iteration-01', CONTEXT);
    const open = commands.find(item => item.label === 'Open')!;
    assert.deepEqual(open.run, { kind: 'href', href: '/home/hero/iteration-01' });
    assert.equal(open.hint, 'Enter');
    const web = commands.find(item => item.label === 'Open on the web')!;
    assert.deepEqual(web.run, {
      kind: 'href',
      href: 'https://roughbook.example/projects/site/home/hero/iteration-01',
      external: true
    });
    assert.equal(commands.find(item => item.label === 'Fit everything')!.hint, 'Shift 1');
  });

  it("offers a making card's terminal and its run's Done, and every session", () => {
    const commands = studioCommands('iteration:home/hero/iteration-03', CONTEXT);
    assert.deepEqual(commands.find(item => item.label === 'Terminal')!.run, {
      kind: 'action',
      action: 'terminal',
      key: 'iteration:home/hero/iteration-03',
      session: TERMINAL.id
    });
    assert.ok(commands.some(item => item.label === 'Done'));
    const sessions = commands.filter(item => item.group === 'Terminals');
    assert.deepEqual(
      sessions.map(item => [item.label, item.run]),
      [
        ['home/hero/iteration-03', { kind: 'session', id: TERMINAL.id }],
        ['Promote Hero', { kind: 'session', id: 'promote-1' }]
      ]
    );
  });

  it('offers a pulled sketch again from its component, and each open run by its card', () => {
    const commands = studioCommands('component:home/hero', CONTEXT);
    assert.deepEqual(commands.find(item => item.label === 'Pull iteration-41 again')!.run, {
      kind: 'pull',
      page: 'home',
      component: 'hero',
      sketch: 'iteration-41'
    });
    const runs = commands.filter(item => item.group === 'Runs');
    assert.deepEqual(
      runs.map(item => [item.label, item.run]),
      [
        ['iteration-08 · Waiting', { kind: 'select', key: 'iteration:home/hero/iteration-08' }],
        ['iteration-03 · Working', { kind: 'select', key: 'iteration:home/hero/iteration-03' }]
      ]
    );
  });

  it('finds pages, components and iterations by name, the long lists only to a query', () => {
    const commands = studioCommands(null, CONTEXT);
    const items = commands.filter(item => item.group === 'Pages and components');
    assert.deepEqual(
      items.map(item => [item.label, item.quiet]),
      [
        ['Home', true],
        ['Hero', true],
        ['Features', true],
        ['About', true],
        ['Team', true]
      ]
    );
    assert.deepEqual(items[1]!.run, { kind: 'select', key: 'component:home/hero' });
    assert.equal(items[1]!.hint, 'Home');
    const recent = commands.filter(item => item.group === 'Recent');
    assert.equal(recent[0]!.label, 'iteration-08', 'newest first');
    assert.deepEqual(
      recent.map(item => Boolean(item.quiet)),
      recent.map((_item, index) => index >= 6)
    );
    assert.equal(matchCommands(commands, 'feat')[0]!.label, 'Features');
    assert.equal(matchCommands(commands, 'direction 40')[0]!.label, 'Direction 40');
  });

  it('makes another agent the default, and shows the status', () => {
    const studio = studioCommands(null, CONTEXT).filter(item => item.group === 'Studio');
    assert.deepEqual(
      studio.map(item => [item.label, item.run]),
      [
        ['Studio status', { kind: 'status' }],
        ['Make Codex the default agent', { kind: 'default-agent', agent: 'codex' }],
        [
          'Open the project on the web',
          { kind: 'href', href: 'https://roughbook.example/projects/site', external: true }
        ]
      ]
    );
  });
});
