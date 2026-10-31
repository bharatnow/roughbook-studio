import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactLocalPaths, redactRunRequest, restoreLocalPaths } from './localPaths.js';
import type { StartRunRequest } from './types.js';

const one = (text: string) => redactLocalPaths([text]);

describe('redacting local paths from typed words', () => {
  for (const [label, path] of [
    ['Windows, backslashed', 'C:\\Users\\dana\\client-app\\src\\hero.tsx'],
    ['Windows, forward', 'd:/work/client-app/hero.tsx'],
    ['UNC', '\\\\fileserver\\share\\brand\\logo.svg'],
    ['UNC long form', '\\\\?\\C:\\Users\\dana\\logo.svg'],
    ['POSIX home on Linux', '/home/dana/client-app/hero.tsx'],
    ['POSIX home on a Mac', '/Users/dana/Desktop/logo.svg'],
    ['the root user', '/root/client-app'],
    ['a system root', '/etc/nginx/nginx.conf'],
    ['another system root', '/var/www/client/index.html'],
    ['a mount', '/mnt/c/Users/dana/app'],
    ['a Mac volume', '/Volumes/Work/client/logo.svg'],
    ['the home shorthand', '~/client-app/hero.tsx'],
    ['the home shorthand, backslashed', '~\\client-app\\hero.tsx'],
    ['a file URL', 'file:///C:/Users/dana/hero.tsx'],
    ['a file URL with a host', 'file://server/share/hero.tsx'],
    ['a file URL in capitals', 'FILE:///home/dana/hero.tsx']
  ]) {
    it(`takes ${label} out, and gives it back`, () => {
      const text = `Match the hero in ${path} but warmer`;
      const { texts, paths } = one(text);
      assert.equal(texts[0], 'Match the hero in [local path 1] but warmer');
      assert.equal(restoreLocalPaths(texts[0], paths), text);
    });
  }

  it('keeps the punctuation of the sentence around a path', () => {
    const { texts, paths } = one('See (/home/dana/app/hero.tsx), then C:\\app\\logo.svg.');
    assert.equal(texts[0], 'See ([local path 1]), then [local path 2].');
    assert.deepEqual([...paths.values()], ['/home/dana/app/hero.tsx', 'C:\\app\\logo.svg']);
  });

  it('takes a path with spaces whole, quoted or backslashed', () => {
    assert.equal(
      one('Use "C:/Users/Dana Smith/my app/hero.tsx" here').texts[0],
      'Use "[local path 1]" here'
    );
    assert.equal(one("Use '/Users/Dana Smith/my app' here").texts[0], "Use '[local path 1]' here");
    assert.equal(
      one('Use C:\\Program Files\\Acme App\\logo.svg here').texts[0],
      'Use [local path 1] here'
    );
  });

  it('keeps a route group inside a path', () => {
    const { paths } = one('Look at /home/dana/app/(marketing)/page.tsx first');
    assert.deepEqual([...paths.values()], ['/home/dana/app/(marketing)/page.tsx']);
  });

  it('gives one path one stand-in, across all the words', () => {
    const { texts, paths } = redactLocalPaths(['~/a/b and ~/c/d', 'again ~/a/b']);
    assert.deepEqual(texts, ['[local path 1] and [local path 2]', 'again [local path 1]']);
    assert.equal(paths.size, 2);
  });

  it('never reuses a stand-in the designer typed', () => {
    const text = 'Keep [local path 1] and read ~/a/b';
    const { texts, paths } = one(text);
    assert.equal(texts[0], 'Keep [local path 1] and read [local path 2]');
    assert.equal(restoreLocalPaths(texts[0], paths), text);
  });

  it('restores a path holding what a replacement string would read as a pattern', () => {
    const { texts, paths } = one('Read ~/a/$&/$1/b');
    assert.equal(restoreLocalPaths(texts[0], paths), 'Read ~/a/$&/$1/b');
  });

  for (const text of [
    'A calm hero with a warm palette',
    'Use and/or instead of either/or, and a 12/24 grid',
    'Light/dark, before/after, input/output, 3/4 width',
    'Link to https://example.com/home/dana/hero.png and http://acme.test/usr/bin/x',
    'See www.example.com/Users/dana and example.com/etc/x',
    'An s3://bucket/home/dana/x and ftp://host/var/x',
    'The /home page and the /pricing and /about routes, /etc alone, /tmp',
    'Relative src/app/page.tsx, ./home/dana, ../var/x and rough/home/hero/iteration-01',
    'Ratio 16:9, time 12:30, note: this, A: yes',
    'The ~ sign, ~20px, 5~/day, a\\b in a regex, \\n and \\\\',
    'Tailwind w-1/2 and h-[calc(100%-2rem)] with #0b1f3a',
    'An email dana@example.com/home/x'
  ]) {
    it(`leaves ordinary words alone: ${text}`, () => {
      const { texts, paths } = one(text);
      assert.equal(texts[0], text);
      assert.equal(paths.size, 0);
    });
  }
});

describe('redacting a run request', () => {
  const base = { page: 'home', component: 'hero', agent: 'claude-code', mode: 'headless' } as const;
  const path = 'C:\\Users\\dana\\app\\hero.tsx';

  it('covers a direction and its hypothesis, and adds no field', () => {
    const { request, paths } = redactRunRequest({
      ...base,
      kind: 'generate',
      directions: [
        { direction: `Like ${path}`, hypothesis: `Since ${path} sells` },
        { direction: 'Quiet' }
      ]
    });
    assert.deepEqual(request, {
      ...base,
      kind: 'generate',
      directions: [
        { direction: 'Like [local path 1]', hypothesis: 'Since [local path 1] sells' },
        { direction: 'Quiet' }
      ]
    });
    assert.equal(paths.get('[local path 1]'), path);
  });

  it('covers what a fork changes and keeps', () => {
    const { request } = redactRunRequest({
      ...base,
      kind: 'fork',
      parent: 'iteration-01',
      intent: { change: `Use ${path}`, remain: ['the headline', `~/brand/type.css`] }
    });
    assert.deepEqual((request as { intent: unknown }).intent, {
      change: 'Use [local path 1]',
      remain: ['the headline', '[local path 2]']
    });
  });

  it('covers a refinement’s intent and what it preserves', () => {
    const { request } = redactRunRequest({
      ...base,
      kind: 'refine',
      parent: 'iteration-01',
      preset: 'custom',
      intent: `Tighten ${path}`,
      preserve: '/home/dana/keep.tsx'
    });
    const refine = request as Extract<StartRunRequest, { kind: 'refine' }>;
    assert.equal(refine.intent, 'Tighten [local path 1]');
    assert.equal(refine.preserve, '[local path 2]');
  });

  it('covers instructions on a batch, a fork with no intent and a refinement', () => {
    const generate = redactRunRequest({
      ...base,
      kind: 'generate',
      directions: [{ direction: `Like ${path}` }],
      instructions: `Keep ${path} and ~/brand/type.css`
    });
    assert.deepEqual(generate.request, {
      ...base,
      kind: 'generate',
      directions: [{ direction: 'Like [local path 1]' }],
      instructions: 'Keep [local path 1] and [local path 2]'
    });
    assert.equal(generate.paths.size, 2);
    const fork = redactRunRequest({
      ...base,
      kind: 'fork',
      parent: 'iteration-01',
      instructions: `Keep ${path}`
    });
    assert.deepEqual(fork.request, {
      ...base,
      kind: 'fork',
      parent: 'iteration-01',
      instructions: 'Keep [local path 1]'
    });
    assert.equal(fork.paths.get('[local path 1]'), path);
    const refine = redactRunRequest({
      ...base,
      kind: 'refine',
      parent: 'iteration-01',
      preset: 'custom',
      intent: 'Tighten',
      instructions: `Keep ${path}`
    });
    assert.equal((refine.request as { instructions?: string }).instructions, 'Keep [local path 1]');
  });

  it('leaves a request with no typed words as it is', () => {
    const request: StartRunRequest = { ...base, kind: 'pull', sketch: 'iteration-02' };
    assert.deepEqual(redactRunRequest(request), { request, paths: new Map() });
    const fork: StartRunRequest = { ...base, kind: 'fork', parent: 'iteration-01' };
    assert.deepEqual(redactRunRequest(fork).request, fork);
  });
});
