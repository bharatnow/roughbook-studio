import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROJECT, RUNS, TERMINAL } from './canvas-fixture.ts';
import {
  canvasActions,
  selectionActions,
  type CanvasMode,
  type SelectionState
} from './canvas-actions.ts';
import { studioCanvasInput } from './canvas-input.ts';

const canvas = studioCanvasInput(PROJECT.tree, RUNS, PROJECT.local);
const STATE: SelectionState = {
  project: 'site',
  webUrl: 'https://roughbook.example',
  compare: [],
  unfolded: []
};

const ids = (key: string, state: SelectionState = STATE, toolbar?: boolean) =>
  selectionActions(canvas, key, state)
    .filter(action => toolbar === undefined || action.toolbar === toolbar)
    .map(action => action.id);

describe("the studio canvas's actions", () => {
  it("offers a local iteration's Open, Fork, Refine and Pick, and Promote on the selected one", () => {
    assert.deepEqual(ids('iteration:home/hero/iteration-01', STATE, true), [
      'open',
      'fork',
      'refine',
      'pick',
      'promote'
    ]);
    assert.deepEqual(ids('iteration:home/hero/iteration-02', STATE, true), [
      'open',
      'fork',
      'refine',
      'pick'
    ]);
    const open = selectionActions(canvas, 'iteration:home/hero/iteration-01', STATE)[0]!;
    assert.deepEqual(open, {
      id: 'open',
      label: 'Open',
      toolbar: true,
      href: '/home/hero/iteration-01',
      keys: 'Enter'
    });
    // It is on the web too, as a card with its review.
    assert.deepEqual(
      selectionActions(canvas, 'iteration:home/hero/iteration-02', STATE).find(
        action => action.id === 'web'
      ),
      {
        id: 'web',
        label: 'Open on the web',
        toolbar: false,
        href: 'https://roughbook.example/projects/site/home/hero/iteration-02',
        external: true
      }
    );
  });

  it("offers a making card's Done, Stop, Copy prompt and Terminal; It failed and Cancel it when the agent has stopped", () => {
    assert.deepEqual(ids('iteration:home/hero/iteration-03', STATE, true), [
      'open',
      'done',
      'stop',
      'copy-prompt',
      'terminal'
    ]);
    // The new direction's agent has no session here and is not running: it waits for Done.
    assert.deepEqual(ids('iteration:home/hero/iteration-08'), [
      'done',
      'copy-prompt',
      'failed',
      'cancel'
    ]);
    assert.equal(
      selectionActions(canvas, 'iteration:home/hero/iteration-08', STATE).find(
        action => action.id === 'failed'
      )?.toolbar,
      false,
      'in the palette only'
    );
    assert.equal(
      selectionActions(canvas, 'iteration:home/hero/iteration-03', STATE).find(
        action => action.id === 'terminal'
      )?.session,
      TERMINAL.id
    );
  });

  it('offers to pull a web sketch, and to see it on the web', () => {
    assert.deepEqual(ids('iteration:home/hero/iteration-40'), ['pull', 'web']);
    assert.deepEqual(ids('iteration:home/hero/iteration-40', { ...STATE, webUrl: null }), ['pull']);
    // One the web is still making cannot be pulled yet.
    assert.deepEqual(ids('iteration:home/hero/iteration-42'), ['web']);
  });

  it("offers a component's Brief and Promote, Compare once two are picked, and its rejected ones", () => {
    assert.deepEqual(ids('component:home/hero', STATE, true), ['brief', 'promote', 'fold']);
    const fold = selectionActions(canvas, 'component:home/hero', STATE).find(
      action => action.id === 'fold'
    );
    assert.equal(fold?.label, 'Show 1 rejected');
    assert.equal(
      selectionActions(canvas, 'component:home/hero', {
        ...STATE,
        unfolded: ['component:home/hero']
      }).find(action => action.id === 'fold')?.label,
      'Hide 1 rejected'
    );
    const picked = {
      ...STATE,
      compare: ['iteration:home/hero/iteration-01', 'iteration:home/hero/iteration-02']
    };
    const compare = selectionActions(canvas, 'component:home/hero', picked).find(
      action => action.id === 'compare'
    );
    assert.deepEqual(compare, {
      id: 'compare',
      label: 'Compare 2',
      toolbar: true,
      href: '/home/hero/iterations/compare?ids=iteration-01,iteration-02'
    });
    // From a picked card too; a pick shows it is picked.
    const card = selectionActions(canvas, 'iteration:home/hero/iteration-02', picked);
    assert.ok(card.some(action => action.id === 'compare'));
    assert.equal(card.find(action => action.id === 'pick')?.label, 'Unpick');
    // A component with nothing selected here has nothing to promote.
    assert.deepEqual(ids('component:home/features', STATE, true), ['brief']);
  });

  it('offers a page only what the web has for it', () => {
    assert.deepEqual(ids('page:home'), ['web']);
    assert.deepEqual(ids('page:home', { ...STATE, webUrl: null }), []);
    assert.deepEqual(ids('component:home/nothing'), []);
  });

  it("offers the canvas's own controls: zoom and fit on the canvas, the view's switch, the terminals", () => {
    const wide = (selection: string | null, mode: CanvasMode, sessions: number) =>
      canvasActions(selection, { mode, sessions }).map(action => [action.id, action.label]);
    assert.deepEqual(wide(null, 'canvas', 0), [
      ['prompt', 'Write a prompt'],
      ['zoom-in', 'Zoom in'],
      ['zoom-out', 'Zoom out'],
      ['zoom-reset', 'Zoom to 100%'],
      ['fit-all', 'Fit everything'],
      ['list', 'List view']
    ]);
    assert.deepEqual(wide('component:home/hero', 'canvas', 2).slice(-3), [
      ['fit-selection', 'Fit the selection'],
      ['list', 'List view'],
      ['dock', 'Terminals']
    ]);
    assert.deepEqual(wide('component:home/hero', 'list', 0), [
      ['prompt', 'Write a prompt'],
      ['list', 'Canvas view']
    ]);
    // A narrow window always shows the list.
    assert.deepEqual(wide(null, 'phone', 1), [
      ['prompt', 'Write a prompt'],
      ['dock', 'Terminals']
    ]);
  });
});
