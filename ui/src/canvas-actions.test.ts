import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardActionGroups } from '@roughbook/ui/commands';
import { PROJECT, RUNS, TERMINAL } from './canvas-fixture.ts';
import {
  STUDIO_VERBS,
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

/** What the toolbar draws: its actions that can run now. */
const toolbar = (key: string, state: SelectionState = STATE) =>
  selectionActions(canvas, key, state)
    .filter(action => action.toolbar && !action.disabled)
    .map(action => action.id);

const action = (key: string, id: string, state: SelectionState = STATE) =>
  selectionActions(canvas, key, state).find(item => item.id === id);

const card = (id: string) => `iteration:home/hero/${id}`;

describe("the studio canvas's actions", () => {
  // The lean budget (ROUGHBOOK-LEAN-PLAN.md, L7): it only goes down.
  it('keeps a selected card to seven controls, its menus among them', () => {
    for (const id of ['iteration-01', 'iteration-02', 'iteration-03']) {
      const list = selectionActions(canvas, card(id), STATE).filter(
        item => item.toolbar && !item.disabled
      );
      const { bar, decide } = cardActionGroups(list, ['done', 'stop', 'copy-prompt']);
      // Make new, Feedback and More, then what stays on view; Stop and the like are one control.
      const onView = bar.filter(item => !['done', 'stop', 'copy-prompt'].includes(item.id));
      assert.ok(
        onView.length + decide.length + 3 <= 7,
        `${id}: ${onView.map(item => item.id).join(', ')}`
      );
    }
  });

  it('serves every plain verb but What’s wrong?, which is for web sketches (decision 41)', () => {
    assert.deepEqual(
      [...STUDIO_VERBS],
      ['more', 'different', 'polish', 'not-this', 'pick-this', 'use']
    );
  });

  it("offers a local iteration's Open, the plain verbs, Fork and Refine, and Add to Compare", () => {
    assert.deepEqual(ids(card('iteration-01')), [
      'open',
      'more',
      'different',
      'polish',
      'not-this',
      'pick-this',
      'use',
      'fork',
      'refine',
      'pick',
      'web'
    ]);
    // The toolbar shows the verbs that can run, in words; Fork and Refine are the palette's.
    assert.deepEqual(toolbar(card('iteration-01')), [
      'open',
      'more',
      'different',
      'polish',
      'not-this',
      'use',
      'pick'
    ]);
    assert.deepEqual(toolbar(card('iteration-02')), [
      'open',
      'more',
      'different',
      'polish',
      'not-this',
      'pick-this',
      'pick'
    ]);
    assert.deepEqual(action(card('iteration-01'), 'open'), {
      id: 'open',
      label: 'Open',
      toolbar: true,
      href: '/home/hero/iteration-01',
      keys: 'Enter'
    });
    // It is on the web too, as a card with its review.
    assert.deepEqual(action(card('iteration-02'), 'web'), {
      id: 'web',
      label: 'Open on the web',
      toolbar: false,
      href: 'https://roughbook.example/projects/site/home/hero/iteration-02',
      external: true
    });
  });

  it('says the verbs in words, found by the words they replace', () => {
    const list = selectionActions(canvas, card('iteration-02'), STATE);
    assert.deepEqual(
      list
        .filter(item => (STUDIO_VERBS as readonly string[]).includes(item.id))
        .map(item => item.label),
      [
        'More like this',
        'Something different',
        'Polish',
        'Not this',
        'Pick this one',
        'Use in my code'
      ]
    );
    assert.ok(action(card('iteration-02'), 'not-this')?.keywords?.includes('reject'));
    assert.ok(action(card('iteration-02'), 'pick-this')?.keywords?.includes('select'));
    assert.ok(action(card('iteration-02'), 'use')?.keywords?.includes('promote'));
    // Decision 32: the canvas's Pick is Add to Compare, so Pick this one is the only pick.
    assert.equal(action(card('iteration-02'), 'pick')?.label, 'Add to Compare');
  });

  it('keeps a verb that cannot run now, saying why', () => {
    assert.equal(action(card('iteration-01'), 'pick-this')?.disabled, 'It is the pick already.');
    assert.equal(action(card('iteration-06'), 'not-this')?.disabled, 'It is set aside already.');
    assert.equal(
      action(card('iteration-02'), 'use')?.disabled,
      'Pick it first: Use in my code promotes the pick.'
    );
    assert.equal(action(card('iteration-01'), 'use')?.disabled, undefined);
    // An agent is still making it: nothing to start from yet, but it can be set aside or picked.
    for (const id of ['more', 'different', 'polish', 'use', 'fork', 'refine']) {
      assert.equal(action(card('iteration-03'), id)?.disabled, "It isn't made yet.", id);
    }
    assert.equal(action(card('iteration-03'), 'not-this')?.disabled, undefined);
  });

  it('shows only the verbs the host serves', () => {
    assert.deepEqual(
      ids(card('iteration-02'), { ...STATE, verbs: ['more', 'not-this'] }).slice(0, 3),
      ['open', 'more', 'not-this']
    );
  });

  it('makes Fork and Refine complete-only: dimmed with Complete features off, as they were on', () => {
    for (const id of ['fork', 'refine']) {
      assert.equal(action(card('iteration-02'), id)?.completeOnly, true, id);
      assert.equal(action(card('iteration-02'), id)?.toolbar, false, id);
      assert.equal(action(card('iteration-02'), id)?.disabled, undefined, id);
      assert.equal(
        action(card('iteration-02'), id, { ...STATE, complete: true })?.disabled,
        undefined
      );
      assert.equal(
        action(card('iteration-02'), id, { ...STATE, complete: false })?.disabled,
        'Turn on Complete features to use this.',
        id
      );
      // Not made yet says more than the switch.
      assert.equal(
        action(card('iteration-03'), id, { ...STATE, complete: false })?.disabled,
        "It isn't made yet."
      );
    }
    // The verbs are the default's.
    assert.deepEqual(
      toolbar(card('iteration-02'), { ...STATE, complete: false }),
      toolbar(card('iteration-02'))
    );
  });

  it("offers a making card's Done, Stop, Copy prompt and Terminal; It failed and Cancel it when the agent has stopped", () => {
    assert.deepEqual(toolbar(card('iteration-03')), [
      'open',
      'done',
      'stop',
      'copy-prompt',
      'terminal',
      'not-this',
      'pick-this'
    ]);
    // The new direction's agent has no session here and is not running: it waits for Done. The
    // project read has not caught up with it, so there is nothing to decide about yet.
    assert.deepEqual(ids(card('iteration-08')), ['done', 'copy-prompt', 'failed', 'cancel']);
    assert.equal(action(card('iteration-08'), 'failed')?.toolbar, false, 'in the palette only');
    assert.equal(action(card('iteration-03'), 'terminal')?.session, TERMINAL.id);
  });

  it('offers to pull a web sketch, and to see it on the web', () => {
    assert.deepEqual(ids(card('iteration-40')), ['pull', 'web']);
    assert.deepEqual(ids(card('iteration-40'), { ...STATE, webUrl: null }), ['pull']);
    // One the web is still making cannot be pulled yet.
    assert.deepEqual(ids(card('iteration-42')), ['web']);
  });

  it("offers a component's Brief and Promote, Compare once two are added, and its rejected ones", () => {
    assert.deepEqual(ids('component:home/hero', STATE, true), ['brief', 'promote', 'fold']);
    assert.equal(action('component:home/hero', 'fold')?.label, 'Show 1 rejected');
    assert.equal(
      action('component:home/hero', 'fold', { ...STATE, unfolded: ['component:home/hero'] })?.label,
      'Hide 1 rejected'
    );
    const picked = { ...STATE, compare: [card('iteration-01'), card('iteration-02')] };
    assert.deepEqual(action('component:home/hero', 'compare', picked), {
      id: 'compare',
      label: 'Compare 2',
      toolbar: true,
      href: '/home/hero/iterations/compare?ids=iteration-01,iteration-02'
    });
    // From an added card too, which says it can be taken out.
    assert.ok(action(card('iteration-02'), 'compare', picked));
    assert.equal(action(card('iteration-02'), 'pick', picked)?.label, 'Remove from Compare');
    // A component with nothing selected here has nothing to promote.
    assert.deepEqual(ids('component:home/features', STATE, true), ['brief']);
  });

  it('offers a page only what the web has for it', () => {
    assert.deepEqual(ids('page:home'), ['web']);
    assert.deepEqual(ids('page:home', { ...STATE, webUrl: null }), []);
    assert.deepEqual(ids('component:home/nothing'), []);
  });

  it("offers the canvas's own controls: the zoom cluster and Present pages on the canvas, the view's switch, the terminals", () => {
    const wide = (selection: string | null, mode: CanvasMode, sessions: number) =>
      canvasActions(selection, { mode, sessions }).map(item => [item.id, item.label]);
    const ZOOM = [
      ['zoom-in', 'Zoom in'],
      ['zoom-out', 'Zoom out'],
      ['zoom-reset', 'Zoom to 100%'],
      ['fit-all', 'Zoom to Fit'],
      ['fit-selection', 'Zoom to Selection'],
      ['present', 'Present pages']
    ];
    assert.deepEqual(wide(null, 'canvas', 0), [
      ['prompt', 'Write a prompt'],
      ...ZOOM,
      ['list', 'List view']
    ]);
    assert.deepEqual(wide('component:home/hero', 'canvas', 2), [
      ['prompt', 'Write a prompt'],
      ...ZOOM,
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

  it('dims Zoom to Selection with nothing selected, and Present pages with no pages, saying why', () => {
    const find = (selection: string | null, id: string, pages?: number) =>
      canvasActions(selection, { mode: 'canvas', sessions: 0, pages }).find(item => item.id === id);
    assert.equal(find(null, 'fit-selection')?.disabled, 'Select something first.');
    assert.equal(find('page:home', 'fit-selection')?.disabled, undefined);
    assert.equal(find('page:home', 'fit-selection')?.keys, 'Shift 2');
    assert.equal(find(null, 'fit-all')?.keys, 'Shift 1');
    assert.equal(find(null, 'present')?.disabled, undefined);
    assert.equal(find(null, 'present', 3)?.disabled, undefined);
    assert.equal(find(null, 'present', 0)?.disabled, 'There are no pages to present.');
    // Neither is the toolbar's: the cluster draws them.
    assert.ok(canvasActions(null, { mode: 'canvas', sessions: 0 }).every(item => !item.toolbar));
  });
});
