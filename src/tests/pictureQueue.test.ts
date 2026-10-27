// Pictures as they are needed (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md): the cards on screen
// first, then the rest, one at a time; a failure is not retried until shown again a minute later;
// the app being down pauses the queue; and `roughbook adopt` leaves what it did not picture for
// `start`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  leaveForStart,
  PictureOrder,
  PictureQueue,
  RETRY_AFTER_MS,
  takeLeftForStart,
  type TakeResult
} from '../pictures/queue.js';
import { tempDir } from './helpers.js';

function drain(order: PictureOrder): string[] {
  const out: string[] = [];
  for (let key = order.next(); key; key = order.next()) out.push(key);
  return out;
}

describe('the order pictures are taken in', () => {
  it('takes the shown cards first, in their order, then the rest as they came', () => {
    const order = new PictureOrder();
    order.add(['a', 'b', 'c', 'd']);
    order.show(['c', 'x']);
    assert.deepEqual(drain(order), ['c', 'x', 'a', 'b', 'd']);
  });

  it('moves cards scrolled away to the front of the rest, and keeps each key once', () => {
    const order = new PictureOrder();
    order.add(['a', 'b']);
    order.show(['p', 'q']);
    order.show(['b', 'r', 'r']);
    order.add(['a', 'p', 's']);
    assert.deepEqual(drain(order), ['b', 'r', 'p', 'q', 'a', 's']);
  });

  it('tries a failed key again only when it is shown after a minute', () => {
    let now = 0;
    const order = new PictureOrder(() => now);
    order.failed('a');
    order.add(['a']);
    order.show(['a']);
    assert.deepEqual(drain(order), []);
    now = RETRY_AFTER_MS;
    order.show(['a']);
    assert.deepEqual(drain(order), ['a']);
  });

  it('drops a key that is gone', () => {
    const order = new PictureOrder();
    order.add(['a', 'b']);
    order.show(['c']);
    order.drop('a');
    order.drop('c');
    assert.deepEqual(drain(order), ['b']);
  });
});

describe('the picture queue', () => {
  it('takes one at a time, and says which pictures changed', async () => {
    let busy = 0;
    let most = 0;
    const taken: string[] = [];
    const heard: string[] = [];
    const idled: boolean[] = [];
    const results: Record<string, TakeResult> = { a: 'taken', b: 'kept', c: 'failed' };
    const queue = new PictureQueue(
      async key => {
        busy += 1;
        most = Math.max(most, busy);
        await new Promise(resolve => setTimeout(resolve, 2));
        taken.push(key);
        busy -= 1;
        return results[key] ?? 'taken';
      },
      { onTaken: key => heard.push(key), onIdle: () => idled.push(true) }
    );
    queue.add(['a', 'b', 'c']);
    queue.show(['d']);
    await queue.idle();
    assert.equal(most, 1);
    // `a` was already being taken when `d` was shown.
    assert.deepEqual(taken, ['a', 'd', 'b', 'c']);
    assert.deepEqual(heard.sort(), ['a', 'd']);
    assert.equal(idled.length, 1);
    assert.deepEqual(queue.view(), { taking: null, shown: 0, rest: 0, paused: false });
  });

  it('pauses while nothing can be taken, and goes on when asked again', async () => {
    let up = false;
    const taken: string[] = [];
    const queue = new PictureQueue(async key => {
      if (!up) return 'wait';
      taken.push(key);
      return 'taken';
    });
    queue.show(['a', 'b']);
    await queue.idle();
    assert.deepEqual(taken, []);
    assert.equal(queue.view().paused, true);
    assert.equal(queue.view().shown, 2);
    up = true;
    queue.show(['b']);
    await queue.idle();
    assert.deepEqual(taken, ['b', 'a']);
  });

  it('tries again by itself a while after nothing could be taken, so a card shown early is pictured', async () => {
    let up = false;
    const taken: string[] = [];
    const queue = new PictureQueue(
      async key => {
        if (!up) return 'wait';
        taken.push(key);
        return 'taken';
      },
      { retryMs: 20 }
    );
    queue.show(['a', 'b']);
    await queue.idle();
    assert.equal(queue.view().paused, true);
    // The app comes up; the canvas asks nothing more.
    up = true;
    await new Promise(resolve => setTimeout(resolve, 80));
    await queue.idle();
    assert.deepEqual(taken, ['a', 'b']);
    queue.stop();
  });

  it('counts a take that throws as failed, and goes on', async () => {
    const taken: string[] = [];
    const queue = new PictureQueue(async key => {
      if (key === 'a') throw new Error('no browser');
      taken.push(key);
      return 'taken';
    });
    queue.show(['a', 'b']);
    await queue.idle();
    assert.deepEqual(taken, ['b']);
  });
});

describe('what `roughbook adopt` leaves for `start`', () => {
  it('keeps each key once until start takes them', async () => {
    const repo = await tempDir();
    assert.deepEqual(await takeLeftForStart(repo), []);
    await leaveForStart(repo, ['home/hero/iteration-00', 'home/faq/iteration-00']);
    await leaveForStart(repo, ['home/faq/iteration-00', 'about/team/iteration-00']);
    assert.deepEqual(await takeLeftForStart(repo), [
      'home/hero/iteration-00',
      'home/faq/iteration-00',
      'about/team/iteration-00'
    ]);
    assert.deepEqual(await takeLeftForStart(repo), []);
  });
});
