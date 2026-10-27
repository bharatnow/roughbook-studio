// A new section's file (ROUGHBOOK-BROWNFIELD-PLAN.md, decision 56): beside the page's own sections,
// in the folder most of them are in, named in their style, with their extension, as a folder with
// an index file when they are. It reads only the map, so it names no stack.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameStyle, newSectionFile } from '../map/place.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';

function page(slug: string, sections: string[]): MapPage {
  return {
    slug,
    name: slug,
    address: slug === 'shared' ? null : `/${slug}`,
    example: null,
    signIn: 'no',
    files: [],
    sections,
    byAgent: false
  };
}

function component(
  slug: string,
  files: string[],
  kind: MapComponent['kind'] = 'section'
): MapComponent {
  return {
    slug,
    name: slug,
    kind,
    files,
    export: 'default',
    fixture: null,
    alone: 'unknown',
    why: null,
    byAgent: false
  };
}

/** A map with one page, `home`, whose sections are these files in this order. */
function homeOf(files: Record<string, string[]>, extra: MapComponent[] = []): RepoMap {
  const components = [
    ...Object.entries(files).map(([slug, list]) => component(slug, list)),
    ...extra
  ];
  return {
    version: 1,
    by: ['test'],
    pages: [
      page('home', [...Object.keys(files), ...extra.map(item => item.slug)]),
      page('shared', [])
    ],
    components,
    missed: [],
    unplaced: []
  };
}

describe('a new section’s file', () => {
  it('goes beside Home’s own sections, as on the kept fixture', () => {
    const map = homeOf({
      hero: ['components/home/hero.tsx'],
      'logo-wall': ['components/LogoWall.tsx'],
      testimonials: ['components/home/testimonials.tsx'],
      features: ['components/home/features.tsx'],
      'pricing-section': ['components/pricing/pricing-section.tsx']
    });
    assert.equal(newSectionFile(map, 'home', 'press-quotes'), 'components/home/press-quotes.tsx');
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'components/home/logo-wall.tsx');
  });

  it('names it in the files’ style, and takes the slug for a mixed or unknown one', () => {
    const style = (names: string[]) =>
      newSectionFile(
        homeOf(Object.fromEntries(names.map((name, index) => [`s${index}`, [`ui/${name}.vue`]]))),
        'home',
        'logo-wall'
      );
    assert.equal(style(['PricingSection', 'Hero']), 'ui/LogoWall.vue');
    assert.equal(style(['pricing-section', 'hero']), 'ui/logo-wall.vue');
    assert.equal(style(['pricingSection', 'hero']), 'ui/logoWall.vue');
    assert.equal(style(['pricing_section', 'hero']), 'ui/logo_wall.vue');
    assert.equal(style(['hero', 'features']), 'ui/logo-wall.vue', 'one word each: unknown');
    assert.equal(style(['PricingSection', 'pricing-plans']), 'ui/logo-wall.vue', 'mixed');
    assert.equal(style(['Pricing.section']), 'ui/logo-wall.vue', 'neither');
    // A slug's number stays with its word.
    assert.equal(
      newSectionFile(homeOf({ a: ['ui/HeroBanner.vue'] }), 'home', 'launch-banner-2'),
      'ui/LaunchBanner2.vue'
    );
  });

  it('judges the style from the files in the chosen folder alone', () => {
    const map = homeOf({
      hero: ['sections/HeroBlock.tsx'],
      features: ['sections/FeatureGrid.tsx'],
      faq: ['other/frequently-asked.tsx']
    });
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'sections/LogoWall.tsx');
  });

  it('takes the extension most of them have', () => {
    const map = homeOf({
      a: ['ui/a.jsx'],
      b: ['ui/b.tsx'],
      c: ['ui/c.tsx']
    });
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'ui/logo-wall.tsx');
  });

  it('breaks a tie of folders by the first section in the page’s order', () => {
    const map = homeOf({
      hero: ['b/hero.tsx'],
      features: ['a/features.tsx'],
      faq: ['a/faq.tsx'],
      cta: ['b/cta.tsx']
    });
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'b/logo-wall.tsx');
  });

  it('makes a folder with an index file where the sections are folders', () => {
    const map = homeOf({
      hero: ['src/sections/Hero/index.ts', 'src/sections/Hero/Hero.module.css'],
      features: ['src/sections/Features/index.ts'],
      cta: ['src/sections/Cta.ts']
    });
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'src/sections/LogoWall/index.ts');
  });

  it('counts only the sections that are files, leaving shared parts and atoms out', () => {
    const map = homeOf(
      {
        hero: ['components/home/hero.tsx'],
        features: []
      },
      [
        component('site-header', ['components/layout/site-header.tsx'], 'shared'),
        component('footer', ['components/layout/footer.tsx'], 'shared'),
        component('button', ['components/ui/button.tsx'], 'atom'),
        component('badge', ['components/ui/badge.tsx'], 'atom')
      ]
    );
    assert.equal(newSectionFile(map, 'home', 'logo-wall'), 'components/home/logo-wall.tsx');
  });

  it('places nothing for a page whose sections have no files, or a page not in the map', () => {
    assert.equal(newSectionFile(homeOf({ hero: [], features: [] }), 'home', 'logo-wall'), null);
    assert.equal(newSectionFile(homeOf({}), 'home', 'logo-wall'), null);
    assert.equal(newSectionFile(homeOf({ hero: ['a/hero.tsx'] }), 'about', 'logo-wall'), null);
  });

  it('puts it at the repo’s root when the sections are there', () => {
    assert.equal(
      newSectionFile(homeOf({ hero: ['Hero.swift'], cta: ['CallToAction.swift'] }), 'home', 'x-y'),
      'XY.swift'
    );
  });

  it('reads a name’s style', () => {
    assert.deepEqual(nameStyle('hero'), ['kebab', 'camel', 'snake']);
    assert.deepEqual(nameStyle('pricing-section'), ['kebab']);
    assert.deepEqual(nameStyle('pricingSection'), ['camel']);
    assert.deepEqual(nameStyle('pricing_section'), ['snake']);
    assert.deepEqual(nameStyle('PricingSection'), ['pascal']);
    assert.deepEqual(nameStyle('Hero'), ['pascal']);
    assert.deepEqual(nameStyle('Pricing_Section'), []);
  });
});
