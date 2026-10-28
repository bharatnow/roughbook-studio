// The Complete features switch in the local UI (A7 of ROUGHBOOK-APPLE-PLAN.md): one boolean posted
// to the local server, the state read again after, and a refusal said in words, never thrown.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeFeaturesOf, switchCompleteFeatures } from './features.ts';

describe('the Complete features switch', () => {
  it('reads a state without it, from an older studio server, as on', () => {
    assert.equal(completeFeaturesOf(null), true);
    assert.equal(completeFeaturesOf({}), true);
    assert.equal(completeFeaturesOf({ completeFeatures: false }), false);
    assert.equal(completeFeaturesOf({ completeFeatures: true }), true);
  });

  it('posts one boolean to /api/features and reads the state again', async () => {
    for (const on of [true, false]) {
      const posted: [string, unknown][] = [];
      let refreshed = 0;
      const result = await switchCompleteFeatures(on, {
        post: async (path, body) => {
          posted.push([path, body]);
          return { completeFeatures: on };
        },
        refresh: async () => {
          refreshed += 1;
        }
      });
      assert.deepEqual(posted, [['/api/features', { on }]]);
      assert.equal(refreshed, 1);
      assert.equal(result.ok, true);
      assert.match(result.message, on ? /Complete features on/ : /Complete features off/);
    }
  });

  it('says a refusal in words and leaves the state as it was', async () => {
    let refreshed = 0;
    const result = await switchCompleteFeatures(false, {
      post: async () => {
        throw new Error('Roughbook cannot be reached.');
      },
      refresh: async () => {
        refreshed += 1;
      }
    });
    assert.deepEqual(result, { ok: false, message: 'Roughbook cannot be reached.' });
    assert.equal(refreshed, 0);
  });
});
