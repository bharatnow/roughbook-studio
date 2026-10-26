import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inPageSrc,
  pageViewAddress,
  pageViewSrc,
  pagesWithView,
  pickedAddress
} from './in-page.ts';
import { parseRoute } from './router.ts';

const local = {
  inPage: {
    pricing: '/pricing',
    'pricing/pricing-section/iteration-01':
      '/pricing?roughbook-swap=pricing/pricing-section/iteration-01'
  }
};

describe('the in-page view', () => {
  it('frames an iteration in its page and an adopted page’s own view on the app’s dev server', () => {
    assert.equal(
      inPageSrc(local, 'http://localhost:3000', 'pricing/pricing-section/iteration-01'),
      'http://localhost:3000/pricing?roughbook-swap=pricing/pricing-section/iteration-01'
    );
    assert.equal(
      pageViewSrc(local, 'http://127.0.0.1:8000/', 'pricing'),
      'http://127.0.0.1:8000/pricing'
    );
    assert.equal(inPageSrc(local, 'http://localhost:3000', 'pricing/faq/iteration-01'), null);
    assert.equal(
      inPageSrc({ inPage: null }, 'http://localhost:3000', 'pricing/faq/iteration-01'),
      null
    );
    assert.equal(pageViewSrc({}, 'http://localhost:3000', 'pricing'), null);
    assert.deepEqual(pagesWithView(local), ['pricing']);
  });

  it('opens a page’s view at its own address, and a picked section on the canvas', () => {
    assert.equal(pageViewAddress('pricing'), '/pricing?view=page');
    assert.deepEqual(parseRoute('#/pricing?view=page'), { screen: 'page', page: 'pricing' });
    assert.deepEqual(parseRoute('#/pricing'), {
      screen: 'canvas',
      focus: { kind: 'page', page: 'pricing' }
    });
    assert.equal(pickedAddress('pricing/pricing-section'), '#/pricing/pricing-section');
    assert.deepEqual(parseRoute(pickedAddress('pricing/pricing-section')!), {
      screen: 'canvas',
      focus: { kind: 'component', page: 'pricing', component: 'pricing-section' }
    });
    assert.equal(pickedAddress('pricing'), null);
    assert.equal(pickedAddress('<script>/x'), null);
  });
});
