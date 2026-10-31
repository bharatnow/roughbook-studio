// The prompt's rule saver (I3 of the chat audit): a component's rule goes with its slugs, a project's
// without them, and the answer is the card's line.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveRuleFrom } from './save-rule.ts';

const SELECTED = { page: 'home', component: 'hero', name: 'Hero' };
const words = (error: unknown) => (error as Error).message;

describe('the prompt rule saver', () => {
  it('sends a component rule with the slugs and says where it went', async () => {
    const posted: [string, unknown][] = [];
    const save = saveRuleFrom(
      SELECTED,
      async (path, body) => {
        posted.push([path, body]);
      },
      words
    );
    assert.deepEqual(await save({ text: 'No gradients', scope: 'component' }), {
      ok: true,
      message: 'Saved to Hero’s constraints'
    });
    assert.deepEqual(posted, [
      ['/api/rules', { text: 'No gradients', scope: 'component', page: 'home', component: 'hero' }]
    ]);
  });

  it('sends a project rule without the slugs', async () => {
    const posted: unknown[] = [];
    const save = saveRuleFrom(
      SELECTED,
      async (_path, body) => {
        posted.push(body);
      },
      words
    );
    assert.deepEqual(await save({ text: 'No gradients', scope: 'project' }), {
      ok: true,
      message: 'Saved to the project’s rules'
    });
    assert.deepEqual(posted, [{ text: 'No gradients', scope: 'project' }]);
  });

  it('answers the refusal in words', async () => {
    const save = saveRuleFrom(
      SELECTED,
      async () => {
        throw new Error('This project has 12 rules.');
      },
      words
    );
    assert.deepEqual(await save({ text: 'calm', scope: 'project' }), {
      ok: false,
      message: 'This project has 12 rules.'
    });
  });
});
