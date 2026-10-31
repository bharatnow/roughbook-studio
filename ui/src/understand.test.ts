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
    assert.deepEqual(posted, [['/api/understand', { ...SELECTED, words: 'hello', mode: 'new' }]]);
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
