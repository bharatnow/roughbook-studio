// The local UI's fact sheet host (U5 of the fact-change plan): the sheet's forms become the local
// server's JSON bodies by the sheet's own field names, and a failed call reads as words.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FACT_FIELDS } from '@roughbook/ui/fact-sheet';
import { changeBody, changeFrom, readSheet, undoBody, undoFrom } from './facts.ts';

const EDITS = [{ kind: 'set', subject: 'Hours', old: '19:00', new: '18:00' }];
const ID = '33333333-3333-4333-8333-333333333333';

function changeForm(): FormData {
  const form = new FormData();
  form.set(FACT_FIELDS.summary, 'Northside closes at 18:00');
  form.set(FACT_FIELDS.edits, JSON.stringify(EDITS));
  form.append(FACT_FIELDS.place, 'home/hero/index.tsx:40|0');
  form.append(FACT_FIELDS.place, 'about/team/index.tsx:12|0');
  return form;
}

describe('the fact sheet host', () => {
  it('turns the change form into its body', () => {
    assert.deepEqual(changeBody(changeForm()), {
      summary: 'Northside closes at 18:00',
      edits: EDITS,
      places: ['home/hero/index.tsx:40|0', 'about/team/index.tsx:12|0']
    });
    const broken = new FormData();
    broken.set(FACT_FIELDS.edits, '{not json');
    assert.deepEqual(changeBody(broken), { summary: '', edits: null, places: [] });
  });

  it('turns the undo form into its change ids', () => {
    const form = new FormData();
    form.append(FACT_FIELDS.changeId, ID);
    assert.deepEqual(undoBody(form), { changeIds: [ID] });
  });

  it('posts the change and the undo to the local server, and reads a failure as words', async () => {
    const posted: [string, unknown][] = [];
    let done = 0;
    const answer = { ok: true, message: 'Changed 2 places.', summary: 'x', changeIds: [ID] };
    const change = changeFrom(
      async (path, body) => {
        posted.push([path, body]);
        return answer;
      },
      String,
      () => (done += 1)
    );
    assert.deepEqual(await change(null, changeForm()), answer);
    assert.equal(posted[0]![0], '/api/facts/change');
    assert.equal(done, 1);

    const failing = undoFrom(
      async () => {
        throw new Error('The studio answered 502.');
      },
      error => (error as Error).message
    );
    const form = new FormData();
    form.append(FACT_FIELDS.changeId, ID);
    assert.deepEqual(await failing({ ...answer }, form), {
      ok: false,
      message: 'The studio answered 502.',
      summary: 'x',
      changeIds: [ID]
    });
  });

  it('reads a sheet that could not be had as a refusal', async () => {
    const sheet = await readSheet(
      'Northside closes at 18:00',
      async () => {
        throw new Error('offline');
      },
      () => 'The studio is offline.'
    );
    assert.equal(sheet.refusal, 'The studio is offline.');
    assert.equal(sheet.reading.summary, 'Northside closes at 18:00');
  });
});
