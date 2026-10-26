// A page's composition (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decisions 12 and 46 to 54): the app's
// own order from the map, compositions of one section per component, at most 30, a baseline
// named iteration-00, and the plan: kept, moved, added and removed, a replace being a remove plus
// an add in place.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appOrder,
  compositionId,
  compositionProblems,
  describePlan,
  formatSections,
  parseSections,
  planComposition,
  startingComposition,
  type CompositionSection
} from '../compositions/composition.js';
import type { RepoMap } from '../map/types.js';

const HOME = ['hero', 'features', 'testimonials', 'pricing'];

const MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [
    {
      slug: 'home',
      name: 'Home',
      address: '/',
      example: '/',
      signIn: 'no',
      files: ['app/page.tsx'],
      sections: HOME,
      byAgent: false
    }
  ],
  components: [...HOME, 'faq'].map(slug => ({
    slug,
    name: slug,
    kind: 'section' as const,
    files: [`components/${slug}.tsx`],
    export: 'default',
    fixture: null,
    alone: 'yes' as const,
    why: null,
    byAgent: false
  })),
  missed: [],
  unplaced: []
};

const on = (...items: string[]): CompositionSection[] =>
  items.map(item => {
    const [component, iteration = 'iteration-00'] = item.split(':') as [string, string?];
    return { component, iteration };
  });

describe("a page's composition", () => {
  it('starts from the map’s order, each section on its baseline', () => {
    assert.deepEqual(appOrder(MAP, 'home'), HOME);
    assert.deepEqual(
      startingComposition(MAP, 'home'),
      HOME.map(component => ({ component, iteration: 'iteration-00' }))
    );
    assert.throws(() => appOrder(MAP, 'about'), /rough\/map\.md has no page about/);
  });

  it('reads --sections, a section without an iteration on its baseline', () => {
    assert.deepEqual(parseSections('hero, testimonials:iteration-02 ,features'), [
      { component: 'hero', iteration: 'iteration-00' },
      { component: 'testimonials', iteration: 'iteration-02' },
      { component: 'features', iteration: 'iteration-00' }
    ]);
    assert.throws(() => parseSections(''), /Name the sections in order/);
    assert.throws(() => parseSections('Hero'), /Hero is not a section/);
    assert.throws(() => parseSections('hero:2'), /hero:2 is not a section/);
    assert.throws(() => parseSections('hero:iteration-01:x'), /is not a section/);
    assert.equal(
      formatSections(on('hero', 'testimonials:iteration-02')),
      'hero:iteration-00,testimonials:iteration-02'
    );
  });

  it('numbers compositions as the backend does', () => {
    assert.equal(compositionId(1), 'composition-01');
    assert.equal(compositionId(12), 'composition-12');
    assert.equal(compositionId(123), 'composition-123');
    assert.throws(() => compositionId(0));
  });

  it('holds each component once, at most 30, with no baseline for a new section', () => {
    const inApp = new Set(MAP.components.map(item => item.slug));
    assert.deepEqual(compositionProblems(on('hero', 'banner:iteration-01'), HOME, inApp), []);
    assert.deepEqual(compositionProblems([], HOME, inApp), [
      'A composition needs at least one section.'
    ]);
    assert.match(
      compositionProblems(on('hero', 'hero:iteration-02'), HOME, inApp).join(' '),
      /hero is in it twice/
    );
    assert.match(
      compositionProblems(on('hero', 'banner'), HOME, inApp).join(' '),
      /banner is a new section, not in the app, so it has no baseline/
    );
    // FAQ is the app's, on another page: not this page's to take.
    assert.match(
      compositionProblems(on('hero', 'faq'), HOME, inApp).join(' '),
      /faq is the app's, but not one of this page's components/
    );
    // Adopted on this page, though the page's file no longer renders it: it may join again.
    assert.deepEqual(compositionProblems(on('hero', 'faq'), HOME, inApp, new Set(['faq'])), []);
    const many = Array.from({ length: 31 }, (_, index) => `new-${index}:iteration-01`);
    assert.match(
      compositionProblems(on(...many), HOME, inApp).join(' '),
      /at most 30 sections; this one has 31/
    );
    assert.deepEqual(compositionProblems(on(...many.slice(0, 30)), HOME, inApp), []);
  });
});

describe("a composition's plan", () => {
  it('keeps the app’s own order as it is', () => {
    const plan = planComposition(HOME, startingComposition(MAP, 'home'));
    assert.deepEqual(
      plan.sections.map(item => item.status),
      ['kept', 'kept', 'kept', 'kept']
    );
    assert.deepEqual(plan.removed, []);
    assert.deepEqual(plan.counts, { kept: 4, moved: 0, added: 0, removed: 0 });
  });

  it('reorders: the fewest sections count as moved', () => {
    // B6's integration: Testimonials above Features, and a new section after the hero.
    const plan = planComposition(
      HOME,
      on('hero', 'banner:iteration-01', 'testimonials', 'features', 'pricing')
    );
    assert.deepEqual(
      plan.sections.map(item => [item.component, item.status]),
      [
        ['hero', 'kept'],
        ['banner', 'added'],
        ['testimonials', 'moved'],
        ['features', 'kept'],
        ['pricing', 'kept']
      ]
    );
    assert.equal(plan.sections[1]!.replaces, null);
    assert.deepEqual(plan.counts, { kept: 3, moved: 1, added: 1, removed: 0 });
    // Pricing to the top moves one section, not three.
    const top = planComposition(HOME, on('pricing', 'hero', 'features', 'testimonials'));
    assert.deepEqual(top.counts, { kept: 3, moved: 1, added: 0, removed: 0 });
    assert.equal(top.sections[0]!.status, 'moved');
  });

  it('adds and removes', () => {
    const plan = planComposition(HOME, on('hero', 'pricing', 'faq-new:iteration-01'));
    assert.deepEqual(plan.removed, ['features', 'testimonials']);
    assert.deepEqual(plan.counts, { kept: 2, moved: 0, added: 1, removed: 2 });
    // At the end, after pricing: in no removed section's place.
    assert.equal(plan.sections[2]!.replaces, null);
  });

  it('replaces: one removed and one added in its place', () => {
    const plan = planComposition(
      HOME,
      on('hero', 'features', 'quotes:iteration-03', 'pricing:iteration-02')
    );
    assert.deepEqual(plan.removed, ['testimonials']);
    assert.deepEqual(
      plan.sections.map(item => [item.component, item.status, item.replaces]),
      [
        ['hero', 'kept', null],
        ['features', 'kept', null],
        ['quotes', 'added', 'testimonials'],
        ['pricing', 'kept', null]
      ]
    );
    // A section on an iteration other than its baseline is still the app's section, kept.
    assert.equal(plan.sections[3]!.iteration, 'iteration-02');
    assert.deepEqual(
      describePlan(plan, slug => slug.toUpperCase()),
      [
        '  1. HERO (the app’s own): kept',
        '  2. FEATURES (the app’s own): kept',
        '  3. QUOTES (iteration-03): added, in place of TESTIMONIALS',
        '  4. PRICING (iteration-02): kept',
        '  - TESTIMONIALS: removed, replaced'
      ]
    );
  });

  it('replaces the first section in place, and each removed section once', () => {
    const plan = planComposition(HOME, on('a:iteration-01', 'b:iteration-01', 'pricing'));
    assert.deepEqual(plan.removed, ['hero', 'features', 'testimonials']);
    assert.deepEqual(
      plan.sections.map(item => item.replaces),
      ['hero', 'features', null]
    );
  });
});
