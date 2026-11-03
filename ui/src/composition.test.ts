import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectionActions } from './canvas-actions.ts';
import { iteration } from './canvas-fixture.ts';
import { studioCanvasInput } from './canvas-input.ts';
import {
  canCompose,
  composedKey,
  composedSrc,
  compositionName,
  pageVersions,
  sectionItems,
  versionName,
  versionOf
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

  it('offers Save version and Versions on an adopted page of the map, and Open on a composition', () => {
    const canvas = studioCanvasInput(PROJECT.tree, [], PROJECT.local);
    const state = {
      project: 'site',
      webUrl: null,
      compare: [],
      unfolded: [],
      composable: ['home']
    };
    assert.deepEqual(
      selectionActions(canvas, 'page:home', state)
        .filter(action => action.id === 'save-version' || action.id === 'versions')
        .map(action => [action.id, action.label, action.toolbar, action.href]),
      [
        ['save-version', 'Save version', true, undefined],
        ['versions', 'Versions', true, undefined]
      ]
    );
    assert.equal(
      selectionActions(canvas, 'page:about', state).some(action => action.id === 'save-version'),
      false
    );
    // No versions yet: nothing to list.
    const none = studioCanvasInput(PROJECT.tree, [], { ...PROJECT.local, compositions: [] });
    assert.equal(
      selectionActions(none, 'page:home', state).some(action => action.id === 'versions'),
      false
    );
    // The builder retired: a composition opens, and no action leads to /compose.
    assert.deepEqual(
      selectionActions(canvas, 'composition:home/composition-02', state).map(action => [
        action.id,
        action.href
      ]),
      [['open', '/home/compositions/composition-02']]
    );
    assert.equal(canCompose(PROJECT, 'home'), true);
    assert.equal(canCompose(PROJECT, 'about'), false);
  });

  it('saves the page as the canvas shows it, each section on the iteration it shows', () => {
    const canvas = studioCanvasInput(PROJECT.tree, [], PROJECT.local);
    // Hero's pick, Features' app version, and the logos' only iteration standing in.
    assert.deepEqual(versionOf(canvas, 'home'), {
      sections: [
        { component: 'hero', iteration: 'iteration-02' },
        { component: 'features', iteration: 'iteration-00' },
        { component: 'logos', iteration: 'iteration-01' }
      ]
    });
    assert.deepEqual(versionOf(canvas, 'about'), {
      problem: 'The page has no sections to save yet.'
    });
    // A web sketch the page shows is not in this repo, so a version cannot keep it: why, in words.
    const home = PROJECT.tree.pages[0]!;
    const tree = {
      ...PROJECT.tree,
      pages: [
        {
          ...home,
          components: home.components.map(item =>
            item.slug === 'logos'
              ? { ...item, iterations: [iteration('iteration-01', { origin: 'sketch' })] }
              : item
          )
        },
        PROJECT.tree.pages[1]!
      ]
    };
    const away = studioCanvasInput(tree, [], {
      ...PROJECT.local,
      iterations: PROJECT.local.iterations.filter(key => key !== 'home/logos/iteration-01')
    });
    assert.deepEqual(versionOf(away, 'home'), {
      problem:
        'A version keeps the page in this repo. Customer logos shows a web sketch: pull it into this repo first.'
    });
  });

  it('names a version by the date and time in the viewer’s locale, and lists the newest first', () => {
    const at = new Date(2026, 10, 3, 14, 5);
    assert.equal(versionName(at, 'en-GB'), '3 Nov, 14:05');
    assert.equal(versionName(at, 'en-US'), 'Nov 3, 2:05 PM');
    assert.deepEqual(
      pageVersions(PROJECT, 'home').map(item => item.id),
      ['composition-02', 'composition-01']
    );
    assert.deepEqual(pageVersions(PROJECT, 'about'), []);
  });

  it('gives the composed address', () => {
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

  it('says which of the page’s components the app no longer has, for their baselines’ mark (B7)', () => {
    const map = PROJECT.local.map!;
    const project: ProjectView = {
      ...PROJECT,
      local: {
        ...PROJECT.local,
        map: {
          ...map,
          components: map.components.map(item =>
            item.slug === 'features' ? { ...item, gone: '2026-10-27' } : item
          )
        }
      }
    };
    const listed = sectionItems(project, COMPOSITION);
    assert.equal(listed.find(item => item.component === 'features')!.gone, '2026-10-27');
    assert.ok(!('gone' in listed.find(item => item.component === 'hero')!));
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
