import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidedText, errorLine, infoLine, lineOf, newest, shotsLine, verbLine } from './output.ts';

describe('the output lines that replace the notice', () => {
  it('makes a line with its tone, its words and when it was said', () => {
    assert.deepEqual(lineOf('info', 'Saved.', 5), { tone: 'info', text: 'Saved.', at: 5 });
    assert.deepEqual(infoLine('Saved.', 6), { tone: 'info', text: 'Saved.', at: 6 });
    assert.equal(errorLine(new Error('No server.'), 7).text, 'No server.');
    assert.equal(errorLine('Plain words', 7).text, 'Plain words');
    assert.equal(errorLine(new Error('No server.'), 7).tone, 'error');
  });

  it('keeps the newest of several lines, and nothing when there are none', () => {
    const old = infoLine('Old', 1);
    const fresh = errorLine('Fresh', 9);
    assert.equal(newest(old, null, fresh, undefined), fresh);
    assert.equal(newest(fresh, old), fresh);
    assert.equal(newest(null, undefined), null);
  });

  it('says a decision waits in the outbox when it was queued', () => {
    assert.equal(decidedText('Saved.', 'sent'), 'Saved.');
    assert.equal(
      decidedText('Saved.', 'queued'),
      'Saved. It waits in the outbox until the server can be reached.'
    );
  });

  it("says a verb's answer in its own tone", () => {
    assert.equal(verbLine({ ok: true, message: 'Made two.' }, 1).tone, 'info');
    assert.equal(verbLine({ ok: false, message: 'Not made.' }, 1).tone, 'error');
    assert.equal(verbLine({ ok: false, message: 'Not made.' }, 1).text, 'Not made.');
  });

  it('counts the screenshots taken, or gives the warning as the error', () => {
    assert.equal(
      shotsLine({ files: { a: '', b: '' }, warning: null }, 1).text,
      'Took 2 screenshots.'
    );
    assert.equal(shotsLine({ files: { a: '' }, warning: null }, 1).text, 'Took 1 screenshot.');
    const warned = shotsLine({ files: {}, warning: 'The app is down.' }, 1);
    assert.deepEqual([warned.tone, warned.text], ['error', 'The app is down.']);
  });
});
