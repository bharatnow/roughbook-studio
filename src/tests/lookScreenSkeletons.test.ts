import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SKELETONS,
  SOFTWARE_OUTCOME,
  lookScreenFindings,
  skeletonFor,
  type LookScreen,
  type MediaStance,
  type SkeletonId
} from '../runs/lookScreen.js';

// ROUGHBOOK-MEDIA-PLAN.md, V1: the structures' builds as the backend's rules/skeletons.ts
// `skeletonFor` says them for a project's media, word for word, and the look-screen check sending a
// look back in those words.

const IDS = Object.keys(SKELETONS) as SkeletonId[];
const avoid = (...labels: string[]): MediaStance[] =>
  labels.map(label => ({ label, stance: 'avoid' as const }));

describe('the structures, with the project’s media', () => {
  it('are the plain builds with no media', () => {
    for (const id of IDS) assert.deepEqual(skeletonFor(id), SKELETONS[id], id);
    // The single object's others follow as full rows (the backend since 4eb9744).
    assert.match(
      SKELETONS['single-object'].build,
      /the other objects follow as rows under it, each with every fact at body size, never a small thin row\./
    );
  });

  it('ask for a picture only if there is one, for type-only pictures', () => {
    for (const media of [
      { items: [], style: 'type' as const },
      { items: avoid('Photography', 'Illustration'), style: null }
    ]) {
      assert.match(
        skeletonFor('hero', media.items, media.style).build,
        /its picture, if it has one/
      );
      assert.match(
        skeletonFor('editorial', media.items, media.style).build,
        /its picture, if it has one, or else one of its numbers set large/
      );
      assert.doesNotMatch(
        skeletonFor('hero', media.items, media.style).build,
        /one strong picture/
      );
    }
  });

  it('label the map inside its <svg> when Illustration is avoided', () => {
    const map = skeletonFor('map-first', avoid('Illustration')).build;
    assert.match(
      map,
      /labelled by name in <text> inside the <svg>, so it is a diagram that carries information, not an illustration/
    );
    assert.equal(skeletonFor('map-first', [], 'type').build, map);
    // The photos style avoids Illustration whatever the list says (the backend's screenMedia).
    assert.equal(skeletonFor('map-first', [], 'photos').build, map);
    assert.equal(skeletonFor('map-first', [], 'illustration').build, SKELETONS['map-first'].build);
    assert.equal(
      skeletonFor('map-first', avoid('Illustration'), 'illustration').build,
      SKELETONS['map-first'].build
    );
  });

  it('let the picture style decide Photography and Illustration, as the backend does', () => {
    // A photos project is not type only, even when its list avoids both picture media.
    const both = avoid('Photography', 'Illustration');
    assert.equal(skeletonFor('hero', both, 'photos').build, SKELETONS.hero.build);
    assert.match(skeletonFor('hero', both).build, /its picture, if it has one/);
  });

  it('show the software outcome when Product UI is avoided', () => {
    const one = skeletonFor('single-object', avoid('product ui')).build;
    assert.ok(
      one.endsWith(
        `For software, that object is ${SOFTWARE_OUTCOME}, filled in with realistic data, never the product's own screen.`
      )
    );
    assert.doesNotMatch(one, /the product's own screen, working/);
  });

  it('send a look back in its project’s words', () => {
    const check: LookScreen & { media: MediaStance[] } = {
      subline: 'Dinner from the kitchens down the road.',
      points: [],
      account: false,
      action: 'a labelled field in a form whose submit does something',
      catalogue: null,
      skeleton: 'map-first',
      media: [
        { label: 'Illustration', stance: 'avoid' },
        { label: 'SVG diagrams', stance: 'allowed' }
      ]
    };
    const findings = lookScreenFindings(
      new Map([['index.tsx', '<main><header>Dishpatch</header></main>']]),
      check
    );
    const missing = findings.find(item => item.code === 'SKELETON_MISSING');
    assert.ok(missing);
    assert.match(
      missing.message,
      /^This look was assigned the Map first structure and its files have no drawn map \(<svg>\)\./
    );
    assert.match(missing.message, /labelled by name in <text> inside the <svg>/);
  });
});
