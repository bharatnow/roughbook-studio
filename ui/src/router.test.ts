import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TASTE_HREF, addressFor, parseRoute, routeListener } from './router.ts';

describe("the studio's addresses", () => {
  it('opens the canvas on the project, a page, a component and its iterations', () => {
    assert.deepEqual(parseRoute(''), { screen: 'canvas', focus: { kind: 'project' } });
    assert.deepEqual(parseRoute('#/'), { screen: 'canvas', focus: { kind: 'project' } });
    assert.deepEqual(parseRoute('#/home'), {
      screen: 'canvas',
      focus: { kind: 'page', page: 'home' }
    });
    assert.deepEqual(parseRoute('#/home/hero'), {
      screen: 'canvas',
      focus: { kind: 'component', page: 'home', component: 'hero' }
    });
    // The old component screen's address.
    assert.deepEqual(parseRoute('#/home/hero/iterations'), {
      screen: 'canvas',
      focus: { kind: 'iterations', page: 'home', component: 'hero' }
    });
    // A card, as selecting one writes it.
    assert.deepEqual(parseRoute('#/home/hero/iterations#iteration-03'), {
      screen: 'canvas',
      focus: { kind: 'iteration', page: 'home', component: 'hero', iteration: 'iteration-03' }
    });
  });

  it("opens a terminal session in the canvas's dock, where its own screen was", () => {
    assert.deepEqual(parseRoute('#/terminals/11111111-1111-4111-8111-111111111111'), {
      screen: 'canvas',
      focus: { kind: 'project' },
      session: '11111111-1111-4111-8111-111111111111'
    });
  });

  it('keeps the stage and Compare as their own screens', () => {
    assert.deepEqual(parseRoute('#/home/hero/iteration-03?refine=1'), {
      screen: 'iteration',
      page: 'home',
      component: 'hero',
      iteration: 'iteration-03',
      refine: true
    });
    assert.deepEqual(parseRoute('#/home/hero/iterations/compare?ids=iteration-01,iteration-02'), {
      screen: 'compare',
      page: 'home',
      component: 'hero',
      ids: ['iteration-01', 'iteration-02']
    });
    assert.deepEqual(parseRoute('#/home/hero/nothing'), { screen: 'missing' });
  });

  it('writes the address of what the canvas selects, which opens on it again', () => {
    for (const key of [
      null,
      'page:home',
      'component:home/hero',
      'iteration:home/hero/iteration-03',
      'folded:home/hero'
    ]) {
      const address = addressFor(key);
      assert.equal(parseRoute(address).screen, 'canvas', address);
    }
    assert.equal(addressFor(null), '#/');
    assert.equal(
      addressFor('iteration:home/hero/iteration-03'),
      '#/home/hero/iterations#iteration-03'
    );
    assert.equal(addressFor('folded:home/hero'), '#/home/hero');
  });

  it("opens the retired builder's links on the canvas, and a composition's own view (B6)", () => {
    // Save version is one click on the canvas now, so the builder's old links open the page there.
    const page = { screen: 'canvas', focus: { kind: 'page', page: 'home' } };
    assert.deepEqual(parseRoute('#/home/compose'), page);
    assert.deepEqual(parseRoute('#/home/compose?from=composition-02'), page);
    assert.deepEqual(parseRoute('#/home/compose?from=../x'), page);
    assert.deepEqual(parseRoute('#/home/compositions/composition-02'), {
      screen: 'composition',
      page: 'home',
      id: 'composition-02'
    });
    assert.equal(parseRoute('#/home/compositions/notes').screen, 'missing');
  });

  it("opens what Roughbook learned (A10) on the project's address, never in a page's way", () => {
    assert.deepEqual(parseRoute(`#${TASTE_HREF}`), { screen: 'taste' });
    assert.deepEqual(parseRoute('#/taste'), {
      screen: 'canvas',
      focus: { kind: 'page', page: 'taste' }
    });
    assert.equal(parseRoute('#/home?view=taste').screen, 'canvas');
  });
});

describe('following the address', () => {
  it('moves to a new route inside a transition, so the card-to-stage morph can play', () => {
    const calls: string[] = [];
    const listener = routeListener(
      () => '#/home/hero/iteration-03',
      route => calls.push(`set ${route.screen}`),
      run => {
        calls.push('transition');
        run();
        calls.push('done');
      }
    );
    listener();
    assert.deepEqual(calls, ['transition', 'set iteration', 'done']);
  });
});
