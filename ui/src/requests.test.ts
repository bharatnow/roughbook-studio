// The project's record as the transcript draws it (C6 of the composer audit): a run's one iteration
// becomes the shared list, and what cannot be read is left out.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deleteAddress, requestsAddress, requestsPage } from './requests.ts';

const LINE = {
  id: 'line-1',
  kind: 'prompt',
  words: 'Like C:\\client\\hero.tsx',
  reply: null,
  verb: null,
  page: 'home',
  component: 'hero',
  iteration: null,
  source: 'studio',
  runIds: ['run-1'],
  runs: [
    {
      id: 'run-1',
      status: 'finished',
      kind: 'generate',
      phase: null,
      iteration: { id: 'iteration-01', name: 'Calm', exists: true }
    }
  ],
  undoneAt: null,
  author: { id: 'user-1', name: 'Asha' },
  mine: true,
  createdAt: '2026-10-31T10:00:00.000Z'
};

describe('the record', () => {
  it('reads a line as the transcript draws it', () => {
    const page = requestsPage({ requests: [LINE], next: 'abc' });
    assert.equal(page.next, 'abc');
    const [entry] = page.requests;
    assert.equal(entry!.words, LINE.words);
    assert.equal(entry!.source, 'studio');
    assert.deepEqual(entry!.runs[0]!.iterations, [
      { id: 'iteration-01', name: 'Calm', exists: true }
    ]);
    assert.deepEqual(entry!.author, LINE.author);
  });

  it('keeps a deleted iteration by its run, and a run with none as none', () => {
    const page = requestsPage({
      requests: [
        {
          ...LINE,
          runs: [
            { id: 'run-1', iteration: { id: null, name: null, exists: false } },
            { id: 'run-2', iteration: null }
          ]
        }
      ]
    });
    assert.deepEqual(page.requests[0]!.runs[0]!.iterations, [
      { id: 'gone-run-1', name: 'Deleted', exists: false }
    ]);
    assert.deepEqual(page.requests[0]!.runs[1]!.iterations, []);
  });

  it('leaves out what cannot be read', () => {
    const page = requestsPage({
      requests: [null, { id: 'x' }, { ...LINE, createdAt: 'yesterday' }, { ...LINE, id: '' }]
    });
    assert.deepEqual(page, { requests: [], next: null });
    assert.deepEqual(requestsPage(null), { requests: [], next: null });
  });

  it('asks the local server, with the cursor in the address', () => {
    assert.equal(requestsAddress(), '/api/requests');
    assert.equal(requestsAddress(null), '/api/requests');
    assert.equal(requestsAddress('a b'), '/api/requests?cursor=a%20b');
    assert.equal(deleteAddress('line-1'), '/api/requests/line-1/delete');
  });
});
