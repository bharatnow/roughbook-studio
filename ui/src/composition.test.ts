import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectionActions } from './canvas-actions.ts';
import { iteration } from './canvas-fixture.ts';
import { studioCanvasInput } from './canvas-input.ts';
import {
  appSections,
  canCompose,
  composedKey,
  composedSrc,
  compositionComponents,
  compositionName,
  sectionItems
} from './composition.ts';
import type { Component, CompositionView, ProjectView } from './types.ts';

function component(slug: string, name: string, ids: string[], extra: Partial<Component> = {}) {
  return {
    slug,
    name,
    status: 'active',
    brief: '',
    userQuestion: '',
    messages: { primary: '', supporting: [] },
    selectedIteration: null,
    copy: { versions: [], approved: null },
    promotions: [],
    iterations: ids.map(id =>
      iteration(id, id === 'iteration-00' ? { origin: 'app', name: 'In the app' } : {})
    ),
    ...extra
  } satisfies Component;
}

const COMPOSITION: CompositionView = {
  page: 'home',
  id: 'composition-02',
  number: 2,
  name: '',
  parent: 'composition-01',
  sections: [
    { component: 'features', iteration: 'iteration-00' },
    { component: 'logos', iteration: 'iteration-01' },
    { component: 'hero', iteration: 'iteration-02' }
  ],
  savedAt: '2026-10-26T10:00:00.000Z',
  address:
    '/rough-preview/home?roughbook-compose=features:iteration-00,logos:iteration-01,hero:iteration-02',
  pictures: ['thumbnail', 'desktop', 'phone']
};

const PROJECT: ProjectView = {
  tree: {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'components', publicDir: 'public' },
    pages: [
      {
        slug: 'home',
        name: 'Home',
        inApp: true,
        components: [
          component('hero', 'Hero', ['iteration-00', 'iteration-02', 'iteration-03'], {
            inApp: true,
            selectedIteration: 2
          }),
          component('features', 'Features', ['iteration-00'], { inApp: true }),
          component('logos', 'Customer logos', ['iteration-01'])
        ]
      },
      { slug: 'about', name: 'About', components: [] }
    ]
  },
  local: {
    iterations: [
      'home/hero/iteration-00',
      'home/hero/iteration-02',
      'home/features/iteration-00',
      'home/logos/iteration-01'
    ],
    screenshots: {},
    map: {
      pages: [
        {
          slug: 'home',
          name: 'Home',
          address: '/',
          signIn: 'no',
          sections: ['hero', 'features'],
          shots: []
        }
      ],
      components: ['hero', 'features'].map(slug => ({
        slug,
        name: slug,
        kind: 'section' as const,
        alone: 'yes' as const,
        why: null,
        shots: []
      })),
      problem: null
    },
    compositions: [
      { ...COMPOSITION, id: 'composition-01', number: 1, name: 'Logos up', pictures: [] },
      COMPOSITION
    ],
    composeTemplate: '/rough-preview/{page}?roughbook-compose='
  }
};

describe("a page's compositions in the local UI", () => {
  it('puts them on the canvas above the frames, with their thumbnails', () => {
    const canvas = studioCanvasInput(PROJECT.tree, [], PROJECT.local, { shotKey: 'k' });
    const home = canvas.input.sections.find(section => section.id === 'home')!;
    assert.deepEqual(home.compositions, [
      {
        id: 'composition-01',
        name: 'Logos up',
        thumbnail: null,
        href: '/home/compositions/composition-01',
        created: '2026-10-26T10:00:00.000Z',
        number: 1
      },
      {
        id: 'composition-02',
        name: 'Composition 2',
        thumbnail: '/api/compositions/home/composition-02/pictures/thumbnail?key=k',
        href: '/home/compositions/composition-02',
        created: '2026-10-26T10:00:00.000Z',
        number: 2
      }
    ]);
    assert.deepEqual(
      canvas.input.sections.find(section => section.id === 'about')!.compositions,
      []
    );
  });

  it('offers Compose on an adopted page of the map, and Open and Edit on a composition', () => {
    const canvas = studioCanvasInput(PROJECT.tree, [], PROJECT.local);
    const state = {
      project: 'site',
      webUrl: null,
      compare: [],
      unfolded: [],
      composable: ['home']
    };
    assert.deepEqual(
      selectionActions(canvas, 'page:home', state).find(action => action.id === 'compose'),
      { id: 'compose', label: 'Compose', toolbar: true, href: '/home/compose' }
    );
    assert.equal(
      selectionActions(canvas, 'page:about', state).some(action => action.id === 'compose'),
      false
    );
    assert.deepEqual(
      selectionActions(canvas, 'composition:home/composition-02', state).map(action => [
        action.id,
        action.href
      ]),
      [
        ['open', '/home/compositions/composition-02'],
        ['compose', '/home/compose?from=composition-02']
      ]
    );
    assert.equal(canCompose(PROJECT, 'home'), true);
    assert.equal(canCompose(PROJECT, 'about'), false);
  });

  it('gives the editor the page’s components, its order on baselines and the composed address', () => {
    assert.deepEqual(
      compositionComponents(PROJECT, 'home').map(item => [
        item.slug,
        item.name,
        item.iterations.map(one => one.id),
        item.selected ?? null
      ]),
      [
        ['hero', 'Hero', ['iteration-00', 'iteration-02'], 'iteration-02'],
        ['features', 'Features', ['iteration-00'], null],
        ['logos', 'Customer logos', ['iteration-01'], null]
      ]
    );
    assert.deepEqual(appSections(PROJECT, 'home'), [
      { component: 'hero', iteration: 'iteration-00' },
      { component: 'features', iteration: 'iteration-00' }
    ]);
    const src = composedSrc(PROJECT, 'http://localhost:3000', 'home')!;
    assert.equal(
      src([
        { component: 'logos', iteration: 'iteration-01' },
        { component: 'hero', iteration: null },
        { component: 'features', iteration: 'iteration-00' }
      ]),
      'http://localhost:3000/rough-preview/home?roughbook-compose=logos:iteration-01,features:iteration-00'
    );
    assert.equal(src([]), null);
    assert.equal(
      composedSrc({ ...PROJECT, local: { ...PROJECT.local, composeTemplate: null } }, 'x', 'home'),
      null
    );
    assert.equal(composedKey('home'), 'home/composition');
  });

  it('lists a saved composition’s sections, named and marked', () => {
    assert.equal(compositionName(COMPOSITION), 'Composition 2');
    assert.deepEqual(sectionItems(PROJECT, COMPOSITION), [
      {
        component: 'features',
        iteration: 'iteration-00',
        name: 'Features',
        inApp: true,
        href: '/home/features/iteration-00'
      },
      {
        component: 'logos',
        iteration: 'iteration-01',
        name: 'Customer logos',
        iterationName: 'Direction 01',
        inApp: false,
        href: '/home/logos/iteration-01'
      },
      {
        component: 'hero',
        iteration: 'iteration-02',
        name: 'Hero',
        iterationName: 'Direction 02',
        inApp: true,
        href: '/home/hero/iteration-02'
      }
    ]);
  });
});
