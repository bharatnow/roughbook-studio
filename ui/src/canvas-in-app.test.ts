// The canvas's "In the app" cards (ROUGHBOOK-BROWNFIELD-PLAN.md, B2): the map's pages and
// components show before they are adopted, from this machine alone, with doctor's pictures and an
// Adopt action; after adoption each component shows its baseline, iteration 0, marked as the app's.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutCanvas } from '@roughbook/ui/canvas';
import { PROJECT, RUNS, iteration } from './canvas-fixture.ts';
import { canvasActions, selectionActions, type SelectionState } from './canvas-actions.ts';
import { studioCanvasInput } from './canvas-input.ts';
import type { MapView, ProjectView } from './types.ts';

const MAP: MapView = {
  pages: [
    {
      slug: 'shared',
      name: 'Shared',
      address: null,
      signIn: 'no',
      sections: ['site-header'],
      shots: []
    },
    {
      slug: 'home',
      name: 'Home',
      address: '/',
      signIn: 'no',
      sections: ['hero', 'pricing', 'pricing'],
      shots: ['desktop']
    },
    {
      slug: 'contact',
      name: 'Contact',
      address: '/contact',
      signIn: 'no',
      sections: ['contact-form'],
      shots: []
    }
  ],
  components: [
    {
      slug: 'site-header',
      name: 'Site header',
      kind: 'shared',
      alone: 'yes',
      why: null,
      shots: ['desktop', 'mobile']
    },
    { slug: 'hero', name: 'Hero', kind: 'section', alone: 'yes', why: null, shots: [] },
    {
      slug: 'pricing',
      name: 'Pricing',
      kind: 'section',
      alone: 'yes',
      why: null,
      shots: ['desktop']
    },
    {
      slug: 'contact-form',
      name: 'Contact form',
      kind: 'section',
      alone: 'no',
      why: 'needs its form provider',
      shots: []
    },
    { slug: 'button', name: 'Button', kind: 'atom', alone: 'unknown', why: null, shots: [] }
  ],
  problem: null
};

const STATE: SelectionState = {
  project: 'site',
  webUrl: 'https://roughbook.example',
  compare: [],
  unfolded: []
};

function cardsOf(input: ReturnType<typeof studioCanvasInput>, page: string, component: string) {
  const frame = input.input.sections
    .find(section => section.id === page)
    ?.frames.find(item => item.id === component);
  assert.ok(frame, `${page}/${component} is a frame`);
  return frame.cards;
}

/** The project once the hero was adopted: its baseline is in rough/ and on the server. */
function adoptedHero(): ProjectView {
  const project = structuredClone(PROJECT);
  const home = project.tree.pages[0]!;
  home.inApp = true;
  const hero = home.components[0]!;
  hero.inApp = true;
  hero.iterations.unshift(
    iteration('iteration-00', {
      origin: 'app',
      name: 'Hero, in the app',
      generation: { mode: 'app' }
    })
  );
  project.local.iterations.push('home/hero/iteration-00');
  project.local.screenshots['home/hero/iteration-00'] = ['desktop'];
  return project;
}

describe('the canvas’s "In the app" cards', () => {
  it('shows the map’s pages and components before anything is adopted, with doctor’s pictures', () => {
    const canvas = studioCanvasInput(
      PROJECT.tree,
      RUNS,
      { ...PROJECT.local, map: MAP },
      { shotKey: 'k1' }
    );
    assert.deepEqual(
      canvas.input.sections.map(section => [section.id, section.frames.map(frame => frame.id)]),
      [
        // The project's own pages first, each with the map's components it does not have yet.
        ['home', ['hero', 'features', 'pricing']],
        ['about', ['team']],
        // Then the map's pages the project does not have; atoms are no cards (decision 5).
        ['shared', ['site-header']],
        ['contact', ['contact-form']]
      ]
    );
    const [pricing] = cardsOf(canvas, 'home', 'pricing');
    assert.equal(pricing!.id, 'iteration-00');
    assert.equal(pricing!.inApp, true);
    assert.deepEqual(pricing!.status, { glyph: 'none', word: 'In the app' });
    assert.equal(pricing!.thumbnail, '/api/map/component/pricing/screenshots/desktop?key=k1');
    assert.equal(cardsOf(canvas, 'contact', 'contact-form')[0]!.thumbnail, null);
    assert.deepEqual(canvas.cards['iteration:home/pricing/iteration-00'], {
      kind: 'map',
      run: null,
      generated: true,
      pullable: false
    });
    // The hero is the project's already (a component made on the web), so no map card is added.
    assert.ok(!cardsOf(canvas, 'home', 'hero').some(card => card.id === 'iteration-00'));
    assert.deepEqual(canvas.inApp, {
      pages: [
        {
          slug: 'shared',
          name: 'Shared',
          adopted: false,
          components: [
            { slug: 'site-header', name: 'Site header', kind: 'shared', adopted: false },
            // Atoms are on no page: each is offered on Shared, to adopt by hand.
            { slug: 'button', name: 'Button', kind: 'atom', adopted: false }
          ]
        },
        {
          slug: 'home',
          name: 'Home',
          address: '/',
          adopted: false,
          components: [
            { slug: 'hero', name: 'Hero', kind: 'section', adopted: false },
            { slug: 'pricing', name: 'Pricing', kind: 'section', adopted: false }
          ]
        },
        {
          slug: 'contact',
          name: 'Contact',
          address: '/contact',
          adopted: false,
          components: [
            { slug: 'contact-form', name: 'Contact form', kind: 'section', adopted: false }
          ]
        }
      ],
      toAdopt: 4,
      problem: null
    });
    // It lays out like any canvas.
    assert.ok(layoutCanvas(canvas.input).items.length > 0);
  });

  it('shows an adopted component’s baseline as the app’s, and nothing changes without a map', () => {
    const project = adoptedHero();
    const canvas = studioCanvasInput(project.tree, RUNS, { ...project.local, map: MAP });
    const baseline = cardsOf(canvas, 'home', 'hero').find(card => card.id === 'iteration-00')!;
    assert.equal(baseline.inApp, true);
    // The adopted page and component are marked too; one made on the web is not.
    const home = canvas.input.sections.find(section => section.id === 'home')!;
    assert.equal(home.inApp, true);
    assert.equal(home.frames.find(frame => frame.id === 'hero')!.inApp, true);
    assert.equal(home.frames.find(frame => frame.id === 'features')!.inApp, undefined);
    assert.equal(baseline.thumbnail, '/api/iterations/home/hero/iteration-00/screenshots/desktop');
    assert.equal(baseline.href, '/home/hero/iteration-00');
    assert.deepEqual(canvas.cards['iteration:home/hero/iteration-00'], {
      kind: 'local',
      run: null,
      generated: true,
      pullable: false,
      baseline: true
    });
    // A studio iteration beside it is no baseline.
    assert.equal(
      cardsOf(canvas, 'home', 'hero').find(card => card.id === 'iteration-01')!.inApp,
      undefined
    );
    assert.equal(canvas.inApp!.pages[1]!.components[0]!.adopted, true);
    assert.equal(canvas.inApp!.toAdopt, 3);

    const without = studioCanvasInput(PROJECT.tree, RUNS, PROJECT.local);
    assert.equal(without.inApp, null);
    assert.deepEqual(
      without.input.sections.map(section => section.id),
      ['home', 'about']
    );
  });
});

describe('adopting from the canvas', () => {
  const canvas = studioCanvasInput(PROJECT.tree, RUNS, { ...PROJECT.local, map: MAP });
  const ids = (key: string, input = canvas) =>
    selectionActions(input, key, STATE).map(action => [action.id, action.label]);

  it('offers Adopt on a component of the app, and Adopt page on a page with any left', () => {
    assert.deepEqual(ids('iteration:home/pricing/iteration-00'), [['adopt', 'Adopt']]);
    assert.deepEqual(ids('component:home/pricing'), [['adopt', 'Adopt']]);
    assert.deepEqual(ids('page:contact'), [['adopt', 'Adopt page']]);
    // A page the project has links to the web too.
    assert.deepEqual(ids('page:home'), [
      ['adopt', 'Adopt page'],
      ['web', 'Open on the web']
    ]);
    // Adopt all is the palette's, with how many it adopts.
    assert.deepEqual(
      canvasActions(null, { mode: 'canvas', sessions: 0, toAdopt: 4 })
        .filter(action => action.id === 'adopt-all')
        .map(action => [action.label, action.toolbar]),
      [['Adopt all 4', false]]
    );
    assert.ok(
      !canvasActions(null, { mode: 'canvas', sessions: 0 }).some(
        action => action.id === 'adopt-all'
      )
    );
  });

  it('opens, picks and compares a baseline, which is not forked or promoted yet', () => {
    const project = adoptedHero();
    project.tree.pages[0]!.components[0]!.selectedIteration = 0;
    const adopted = studioCanvasInput(project.tree, RUNS, { ...project.local, map: MAP });
    assert.deepEqual(
      ids('iteration:home/hero/iteration-00', adopted).map(([id]) => id),
      ['open', 'pick', 'web']
    );
  });
});
