// The prompt's reader (I1 of the chat audit): the words, the mode and the selection's slugs go to
// the local server, and a failure reads as "could not be read", never as a thrown error.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOT_READ, understandFrom } from './understand.ts';

const SELECTED = { page: 'home', component: 'hero', iteration: null };

describe('the prompt reader', () => {
  it('posts the words, the mode and the selection, and answers the reply', async () => {
    const posted: [string, unknown][] = [];
    const reply = { ...NOT_READ, read: true, intent: 'chat' as const, reply: 'Hello.' };
    const understand = understandFrom(SELECTED, async (path, body) => {
      posted.push([path, body]);
      return reply;
    });
    assert.deepEqual(await understand({ words: 'hello', mode: 'new' }), reply);
    assert.deepEqual(posted, [
      ['/api/understand', { ...SELECTED, words: 'hello', mode: 'new', facts: true }]
    ]);
  });

  it('accepts a fact reading as it comes, for the composer to offer the sheet', async () => {
    const fact = { ...NOT_READ, read: true, intent: 'fact' as const, confidence: 'high' as const };
    const understand = understandFrom(SELECTED, async () => fact);
    assert.equal(
      (await understand({ words: 'Northside closes at 18:00', mode: 'new' })).intent,
      'fact'
    );
  });

  it('says when a message left a line, and only then', async () => {
    let kept = 0;
    const answers = [{ ...NOT_READ, requestId: 'line-1' }, NOT_READ];
    const understand = understandFrom(
      SELECTED,
      async () => answers.shift(),
      () => (kept += 1)
    );
    await understand({ words: 'hello', mode: 'new' });
    assert.equal(kept, 1);
    await understand({ words: 'hello', mode: 'new' });
    assert.equal(kept, 1);
  });

  it('answers the failed read when the call fails, charging nothing', async () => {
    const understand = understandFrom(SELECTED, async () => {
      throw new Error('offline');
    });
    const answer = await understand({ words: 'hello', mode: 'new' });
    assert.deepEqual(answer, NOT_READ);
    assert.equal(answer.read, false);
    assert.equal(answer.credits, 0);
  });
});
