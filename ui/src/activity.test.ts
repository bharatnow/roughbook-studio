// The status button's activity words (A8 step 5 of ROUGHBOOK-APPLE-PLAN.md, decision 37).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityView } from './activity.ts';

describe('the status button’s activity', () => {
  it('says nothing for an older server or an idle studio', () => {
    assert.equal(activityView(null), null);
    assert.equal(activityView({}), null);
    assert.equal(activityView({ activity: { state: 'idle', where: null, runId: null } }), null);
  });

  it('spins while an agent works, here or unattended', () => {
    for (const where of ['builtin', 'headless'] as const) {
      assert.deepEqual(activityView({ activity: { state: 'working', where, runId: 'r' } }), {
        word: 'An agent is working',
        spinning: true,
        attention: false
      });
    }
  });

  it('says an agent may be waiting after a silence, and is asking after a bell', () => {
    assert.deepEqual(
      activityView({ activity: { state: 'waiting', where: 'builtin', runId: 'r' } }),
      { word: 'An agent may be waiting for you', spinning: false, attention: true }
    );
    assert.deepEqual(
      activityView({ activity: { state: 'attention', where: 'builtin', runId: 'r' } }),
      { word: 'An agent is asking for you', spinning: false, attention: true }
    );
  });

  it('says where a run it cannot hear is', () => {
    assert.deepEqual(activityView({ activity: { state: 'idle', where: 'terminal', runId: 'r' } }), {
      word: 'In your terminal',
      spinning: false,
      attention: false
    });
    assert.deepEqual(activityView({ activity: { state: 'idle', where: 'editor', runId: 'r' } }), {
      word: 'In your editor',
      spinning: false,
      attention: false
    });
  });
});
