import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LAZY_IMPORT_NOTICE as SERVER_NOTICE } from '../../src/recipes/next/fault.ts';
import {
  LAZY_IMPORT_NOTICE,
  inPageNote,
  inPageSrc,
  pageViewAddress,
  pageViewSrc,
  pagesWithView,
  lazyImportNotice,
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

describe('the in-page view’s note', () => {
  it('is shown beside In its page where the frame offers it, and nowhere else', () => {
    const noted = { ...local, inPageNote: 'Native screens show components alone.' };
    assert.equal(
      inPageNote(noted, 'pricing/pricing-section/iteration-01'),
      'Native screens show components alone.'
    );
    assert.equal(inPageNote(noted, 'pricing/faq/iteration-01'), null);
    assert.equal(inPageNote(local, 'pricing/pricing-section/iteration-01'), null);
    assert.equal(inPageNote({ inPage: null, inPageNote: 'x' }, 'pricing/faq/iteration-01'), null);
  });
});

describe('Turbopack’s lost lazy import in the frame (B7b, decision 68)', () => {
  it('says what it is and to restart the dev server, for a preview’s error message alone', () => {
    const lost = {
      roughbook: 'error',
      id: 'home/hero/iteration-00',
      message:
        'Lazily compiled dynamic import [project]/rough/home/hero/iteration-00/index.tsx [app-rsc] (ecmascript, async loader) was not activated'
    };
    assert.equal(lazyImportNotice(lost), LAZY_IMPORT_NOTICE);
    assert.match(LAZY_IMPORT_NOTICE, /Restart the app's dev server/);
    assert.equal(lazyImportNotice({ ...lost, roughbook: 'ready' }), null);
    assert.equal(lazyImportNotice({ ...lost, message: 'Boom' }), null);
    assert.equal(lazyImportNotice('Lazily compiled dynamic import x was not activated'), null);
    assert.equal(lazyImportNotice(null), null);
  });

  it('has the server’s words', () => {
    assert.equal(LAZY_IMPORT_NOTICE, SERVER_NOTICE);
  });
});
