import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { nextSheet, PICTURES_NO_SAID, PICTURES_NO_WARNING, privacyWords } from './parts/sheets.ts';

const LINES = [
  'What Roughbook keeps, and what it does not:',
  '  Kept: the brief and context you give a project.',
  '  Not kept: your code, your file names or paths.'
];

describe('the local UI’s one-time sheets', () => {
  it('says plainly that No deletes stored pictures, before and after it', () => {
    assert.match(PICTURES_NO_WARNING, /No deletes them for good/);
    assert.match(PICTURES_NO_SAID, /already on Roughbook are deleted/);
    const sheet = readFileSync(new URL('./parts/pictures-sheet.tsx', import.meta.url), 'utf8');
    assert.match(sheet, /<p>\{PICTURES_NO_WARNING\}<\/p>/);
    assert.match(sheet, /: PICTURES_NO_SAID/);
  });

  it('asks the pictures question first, only while nobody has answered', () => {
    const open = { later: false, privacyClosed: false };
    assert.equal(nextSheet({ pictures: null, privacySheet: LINES }, open), 'pictures');
    assert.equal(nextSheet({ pictures: null, privacySheet: null }, open), 'pictures');
    assert.equal(nextSheet({ pictures: true, privacySheet: null }, open), null);
    assert.equal(nextSheet({ pictures: false, privacySheet: null }, open), null);
  });

  it('shows the privacy sheet once the question is answered or put off, or cannot be read', () => {
    const open = { later: false, privacyClosed: false };
    assert.equal(nextSheet({ pictures: true, privacySheet: LINES }, open), 'privacy');
    assert.equal(nextSheet({ privacySheet: LINES }, open), 'privacy');
    assert.equal(
      nextSheet({ pictures: null, privacySheet: LINES }, { ...open, later: true }),
      'privacy'
    );
    assert.equal(nextSheet({ pictures: null, privacySheet: null }, { ...open, later: true }), null);
    assert.equal(
      nextSheet({ pictures: false, privacySheet: LINES }, { ...open, privacyClosed: true }),
      null
    );
  });

  it('shows nothing before the state is read', () => {
    assert.equal(nextSheet(null, { later: false, privacyClosed: false }), null);
  });

  it('reads the CLI’s lines as a title and labelled sentences', () => {
    assert.deepEqual(privacyWords(LINES), {
      title: 'What Roughbook keeps, and what it does not',
      items: [
        { label: 'Kept', text: 'the brief and context you give a project.' },
        { label: 'Not kept', text: 'your code, your file names or paths.' }
      ]
    });
  });
});
