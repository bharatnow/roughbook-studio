import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { readSnapshotSections, snapshotPage, snapshotPolicy } from '../server/snapshotPage.js';

const sections = [{ component: 'hero', iteration: 'iteration-01' }];

describe('a snapshot stack’s page on the canvas', () => {
  it('reads sections, and refuses anything else', () => {
    assert.deepEqual(readSnapshotSections('hero:iteration-01,footer:iteration-02'), [
      { component: 'hero', iteration: 'iteration-01' },
      { component: 'footer', iteration: 'iteration-02' }
    ]);
    for (const bad of [
      '',
      'hero',
      'hero:x',
      '../a:iteration-01',
      'a:iteration-01:b',
      '<x>:iteration-01'
    ]) {
      assert.equal(readSnapshotSections(bad), null, bad);
    }
  });

  it('marks each section, answers the canvas, and asks for the nearest shot', () => {
    const page = snapshotPage({
      page: 'home',
      sections,
      shots: [{ name: 'phone', width: 390 }],
      imageKey: 'a&b',
      nonce: 'n1'
    });
    assert.match(page, /<div data-roughbook-variant>/);
    assert.match(page, /data-roughbook-section="home\/hero"/);
    assert.ok(page.includes('/api/iterations/home/hero/iteration-01/screenshots/{shot}?key=a%26b'));
    assert.ok(page.includes(`<script nonce="n1">${LIVE_SCRIPT}</script>`));
    assert.match(page, /roughbook: 'ready', id: id/);
    assert.ok(page.includes('"home/composition"'));
  });

  it('may run only its own scripts', () => {
    assert.match(snapshotPolicy('n1'), /default-src 'none'/);
    assert.match(snapshotPolicy('n1'), /script-src 'nonce-n1'/);
  });
});
