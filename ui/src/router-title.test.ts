import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRoute, titleFor, type TitleNames } from './router.ts';

const TREE: TitleNames = {
  name: 'Acme',
  pages: [
    {
      slug: 'home',
      name: 'Home',
      components: [
        {
          slug: 'hero',
          name: 'Hero',
          iterations: [
            { id: 'iteration-01', name: 'Quiet type' },
            { id: 'iteration-02', name: ' ' }
          ]
        }
      ]
    }
  ]
};

const title = (hash: string, names: TitleNames | null = TREE) => titleFor(parseRoute(hash), names);

describe("the studio's tab titles", () => {
  it('name the document first, then what holds it, then the project, as the web does', () => {
    assert.equal(title('#/'), 'Acme / Roughbook studio');
    assert.equal(title('#/home'), 'Home · Acme / Roughbook studio');
    assert.equal(title('#/home/hero'), 'Hero · Home · Acme / Roughbook studio');
    assert.equal(
      title('#/home/hero/iterations'),
      'Hero iterations · Home · Acme / Roughbook studio'
    );
    assert.equal(title('#/home/hero/iteration-01'), 'Quiet type · Hero · Acme / Roughbook studio');
    assert.equal(
      title('#/home/hero/iterations/compare?ids=iteration-01,iteration-02'),
      'Compare Hero · Home · Acme / Roughbook studio'
    );
    assert.equal(title('#/home/compose'), 'Composition · Home · Acme / Roughbook studio');
    assert.equal(
      title('#/home/compositions/composition-02'),
      'Composition 02 · Home · Acme / Roughbook studio'
    );
    assert.equal(title('#/home?view=page'), 'Home · Acme / Roughbook studio');
  });

  it('keep a card and a terminal on the canvas they sit on', () => {
    assert.equal(
      title('#/home/hero/iterations#iteration-01'),
      'Hero iterations · Home · Acme / Roughbook studio'
    );
    assert.equal(
      title('#/terminals/11111111-1111-4111-8111-111111111111'),
      'Acme / Roughbook studio'
    );
  });

  it('call an unnamed iteration by its number and anything unknown by its slug', () => {
    assert.equal(
      title('#/home/hero/iteration-02'),
      'Iteration 02 · Hero · Acme / Roughbook studio'
    );
    assert.equal(
      title('#/pricing/plans/iteration-07'),
      'Iteration 07 · plans · Acme / Roughbook studio'
    );
    assert.equal(title('#/a/b/c/d'), 'Nothing here · Acme / Roughbook studio');
  });

  it('use slugs and leave the project out before it is read', () => {
    assert.equal(title('#/', null), 'Roughbook studio');
    assert.equal(title('#/home/hero', null), 'hero · home / Roughbook studio');
    assert.equal(title('#/a/b/c/d', null), 'Nothing here / Roughbook studio');
  });
});
