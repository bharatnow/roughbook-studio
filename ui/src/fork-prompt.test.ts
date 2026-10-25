// The canvas prompt's Fork (B3): its words, a Keep: line and Clean start become the fork's fields.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forkPrompt } from './fork-prompt.ts';

describe('the prompt’s Fork', () => {
  it('sends nothing more for an empty fork, as before', () => {
    assert.deepEqual(forkPrompt('', false), { fields: {} });
  });

  it('reads what changes, what is kept, and a clean start', () => {
    assert.deepEqual(forkPrompt('Bolder cards\nKeep: the layout, prices\nkeep: prices\n', true), {
      fields: {
        intent: { remain: ['the layout', 'prices'], change: 'Bolder cards' },
        radical: true
      }
    });
    assert.deepEqual(forkPrompt('Warmer\nand looser', false), {
      fields: { intent: { remain: [], change: 'Warmer\nand looser' } }
    });
    assert.deepEqual(forkPrompt('', true), { fields: { radical: true } });
  });

  it('refuses a Keep: line with nothing to change, and what is past the backend’s limits', () => {
    assert.ok('refusal' in forkPrompt('Keep: the layout', false));
    const many = Array.from({ length: 13 }, (_, i) => `part ${i}`).join(', ');
    assert.deepEqual(
      forkPrompt(
        `Calmer
Keep: ${many}`,
        false
      ),
      {
        refusal: 'Keep at most 12 things in one fork; this one lists 13.'
      }
    );
    const long = forkPrompt(
      `Calmer
Keep: ${'x'.repeat(81)}`,
      false
    );
    assert.match('refusal' in long ? long.refusal : '', /80 characters or fewer/);
    const wordy = forkPrompt('y'.repeat(2001), false);
    assert.match('refusal' in wordy ? wordy.refusal : '', /2000 characters or fewer; this is 2001/);
    assert.ok(
      'fields' in
        forkPrompt(
          `Calmer
Keep: ${'x'.repeat(80)}`,
          false
        )
    );
  });
});
