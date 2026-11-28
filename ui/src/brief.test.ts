import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { noticeTone, primaryMessageNotices } from './parts/brief-notices.ts';
import type { StoredWordNotice } from './types.ts';

const notice = (over: Partial<StoredWordNotice>): StoredWordNotice => ({
  doc: 'component',
  field: 'component.messages.primary',
  key: 'messages.primary',
  index: null,
  text: 'Watch the film',
  source: 'user',
  resolution: 'mark',
  kinds: ['media'],
  message: 'Sketches keep this line but show no video: the media has none.',
  ...over
});

describe('the brief sheet’s notices (W5)', () => {
  it('shows the backend’s notices on the primary message only', () => {
    const primary = notice({});
    const supporting = notice({
      key: 'messages.supporting.0',
      field: 'component.messages.supporting',
      index: 0
    });
    const page = notice({ doc: 'page', key: 'messages.primary' });
    assert.deepEqual(primaryMessageNotices({ notices: [primary, supporting, page] }), [primary]);
  });

  it('shows nothing when the backend sends no notices', () => {
    assert.deepEqual(primaryMessageNotices({}), []);
    assert.deepEqual(primaryMessageNotices({ notices: [] }), []);
  });

  it('warns on a person’s kept line and informs on a pick’s, as the web does', () => {
    assert.equal(noticeTone({ source: 'user', resolution: 'mark' }), 'warning');
    assert.equal(noticeTone({ source: 'look', resolution: 'mark' }), 'info');
    assert.equal(noticeTone({ source: 'user', resolution: 'omit' }), 'info');
  });

  it('draws each with FieldNotice beside an Edit on the web link', () => {
    const sheet = readFileSync(new URL('./parts/brief.tsx', import.meta.url), 'utf8');
    assert.match(sheet, /<FieldNotice text=\{notice\.message\} tone=\{noticeTone\(notice\)\} \/>/);
    assert.equal(sheet.match(/Edit on the web/g)?.length, 2);
  });
});
