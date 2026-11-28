import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clickedHash, createNavigationProgress, hashOf } from './navigation.ts';
import { routeKeyOf, routeListener } from './router.ts';

const CLICK = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false
};

function anchor(attributes: Record<string, string>) {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes
  };
}

/** A line whose timers the test runs by hand. */
function manualLine(timeoutMs = 15_000) {
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const line = createNavigationProgress({
    timeoutMs,
    setTimer: (run, ms) => {
      next += 1;
      timers.set(next, { run, ms });
      return next as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: timer => void timers.delete(timer as unknown as number)
  });
  const fire = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.run();
    }
  };
  return { line, timers, fire };
}

describe("the studio's navigation line", () => {
  it('starts from a plain click on a hash link, and from nothing else', () => {
    assert.equal(clickedHash(CLICK, anchor({ href: '#/home/hero' })), '#/home/hero');
    assert.equal(clickedHash({ ...CLICK, defaultPrevented: true }, anchor({ href: '#/' })), null);
    assert.equal(clickedHash({ ...CLICK, button: 1 }, anchor({ href: '#/' })), null);
    assert.equal(clickedHash({ ...CLICK, metaKey: true }, anchor({ href: '#/' })), null);
    assert.equal(clickedHash({ ...CLICK, ctrlKey: true }, anchor({ href: '#/' })), null);
    assert.equal(clickedHash({ ...CLICK, shiftKey: true }, anchor({ href: '#/' })), null);
    assert.equal(clickedHash(CLICK, anchor({ href: '#/', target: '_blank' })), null);
    assert.equal(clickedHash(CLICK, anchor({ href: '#/', target: '_self' })), '#/');
    assert.equal(clickedHash(CLICK, anchor({ href: '#/', download: '' })), null);
    assert.equal(clickedHash(CLICK, anchor({ href: '#/', 'data-no-progress': '' })), null);
    // The web and the privacy page are another site; the browser loads them itself.
    assert.equal(clickedHash(CLICK, anchor({ href: 'https://roughbook.app/privacy' })), null);
  });

  it('reads the fragment of a hash change', () => {
    assert.equal(hashOf('http://localhost:4400/#/home'), '#/home');
    assert.equal(hashOf('http://localhost:4400/'), '');
    assert.equal(
      hashOf('http://localhost:4400/#/home/hero/iterations#iteration-03'),
      '#/home/hero/iterations#iteration-03'
    );
  });

  it('compares screens, not spellings', () => {
    assert.equal(routeKeyOf('#/home'), routeKeyOf('/home'));
    assert.equal(routeKeyOf(''), routeKeyOf('#/'));
    assert.notEqual(routeKeyOf('#/home'), routeKeyOf('#/home/hero'));
    assert.notEqual(routeKeyOf('#/?view=taste'), routeKeyOf('#/'));
  });

  it('starts for another screen, and finishes when it renders with nothing to load', () => {
    const { line } = manualLine();
    const seen: boolean[] = [];
    line.subscribe(() => seen.push(line.isActive()));
    line.arrive('a');
    assert.equal(line.go('a'), false, 'the screen shown');
    assert.equal(line.go('b', 'b'), false, 'the screen the address already names');
    assert.equal(line.isActive(), false);
    assert.equal(line.go('b', 'a'), true);
    assert.equal(line.isActive(), true);
    // A second start, as the hash change after a click is, draws nothing new.
    line.go('b');
    line.arrive('b');
    assert.equal(line.isActive(), false);
    assert.deepEqual(seen, [true, false]);
    assert.equal(line.current(), 'b');
  });

  it('waits for a placeholder to have its data before it finishes', () => {
    const { line } = manualLine();
    line.arrive('a');
    line.go('b');
    const release = line.hold();
    line.arrive('b');
    assert.equal(line.isActive(), true, 'the screen shows its placeholder');
    release();
    assert.equal(line.isActive(), false, 'the data is in');
    // A release twice (React's strict effects) counts once.
    release();
    line.go('c');
    const first = line.hold();
    const second = line.hold();
    line.arrive('c');
    first();
    assert.equal(line.isActive(), true);
    second();
    assert.equal(line.isActive(), false);
  });

  it('keeps a placeholder that was showing before the start from finishing a later one early', () => {
    const { line } = manualLine();
    const release = line.hold();
    line.arrive('a');
    line.go('b');
    release();
    assert.equal(line.isActive(), true, 'the new screen has not rendered yet');
    line.arrive('b');
    assert.equal(line.isActive(), false);
  });

  it('finishes by itself after 15 s when nothing arrives', () => {
    const { line, timers, fire } = manualLine();
    line.arrive('a');
    line.go('b');
    assert.deepEqual(
      [...timers.values()].map(timer => timer.ms),
      [15_000]
    );
    line.go('c');
    assert.equal(timers.size, 1, 'a new start restarts the one timer');
    fire();
    assert.equal(line.isActive(), false);
    line.go('d');
    line.arrive('d');
    assert.equal(timers.size, 0, 'an arrival clears it');
  });

  it('is told the route on a hash change before its transition', () => {
    const calls: string[] = [];
    const listener = routeListener(
      () => '#/?view=taste',
      route => calls.push(`set ${route.screen}`),
      run => {
        calls.push('transition');
        run();
      },
      route => calls.push(`started ${route.screen}`)
    );
    listener();
    assert.deepEqual(calls, ['started taste', 'transition', 'set taste']);
  });

  it('is mounted once, in the app shell, and every screen reports its arrival there', () => {
    const app = readFileSync(new URL('./app.tsx', import.meta.url), 'utf8');
    assert.match(app, /<NavigationLine \/>/);
    assert.match(app, /useArrival\(route\)/);
    const router = readFileSync(new URL('./router.ts', import.meta.url), 'utf8');
    assert.match(
      router,
      /appNavigation\.go\(routeKeyOf\(href\), routeKeyOf\(window\.location\.hash\)\)/
    );
  });
});

describe("a screen's loading placeholder", () => {
  it('shows the activity indicator and its words as one status', async () => {
    // The package's .tsx compiles to React.createElement outside this project's JSX setting.
    (globalThis as { React?: typeof React }).React = React;
    const { ScreenLoading } = await import('./parts/loading.tsx');
    const html = renderToStaticMarkup(
      React.createElement(ScreenLoading, { children: 'Loading the project…' })
    );
    assert.match(html, /^<div role="status"/);
    assert.match(html, /data-activity-indicator/);
    assert.match(html, /<span>Loading the project…<\/span>/);
    assert.match(html, /items-center justify-center/);
    assert.match(html, /min-h-\[50dvh\]/);
    const page = renderToStaticMarkup(
      React.createElement(ScreenLoading, { page: true, children: 'Loading…' })
    );
    assert.match(page, /min-h-\[100dvh\]/);
  });

  it('lets the line finish when the screen arrives at its problem instead of its data', async () => {
    (globalThis as { React?: typeof React }).React = React;
    const { ScreenLoading, holdWhileLoading } = await import('./parts/loading.tsx');
    const { line, timers } = manualLine();
    line.arrive('a');
    line.go('b');
    // Waiting for the project: the placeholder holds the line past the screen's render.
    const release = holdWhileLoading(line, null);
    line.arrive('b');
    assert.equal(line.isActive(), true);
    // The read fails: the effect runs again with the problem, releasing and holding nothing.
    release?.();
    assert.equal(holdWhileLoading(line, 'Cannot reach the studio server.'), undefined);
    assert.equal(line.isActive(), false, 'finished at the problem, not at the safety');
    assert.equal(timers.size, 0);
    // A screen that opens on a problem already finishes on its render.
    line.go('c');
    assert.equal(holdWhileLoading(line, 'Cannot reach the studio server.'), undefined);
    line.arrive('c');
    assert.equal(line.isActive(), false);
    const html = renderToStaticMarkup(
      React.createElement(ScreenLoading, {
        problem: 'Cannot reach the studio server.',
        children: 'Loading…'
      })
    );
    assert.match(html, /Cannot reach the studio server\./);
    assert.doesNotMatch(html, /data-activity-indicator/);
    assert.doesNotMatch(html, /Loading…/);
  });

  it('is given the project read’s problem on every screen that waits for the project', () => {
    for (const screen of ['canvas', 'compare', 'composition', 'iteration', 'page']) {
      const source = readFileSync(new URL(`./screens/${screen}.tsx`, import.meta.url), 'utf8');
      assert.match(source, /<ScreenLoading( page)? problem=\{problem\}>/, screen);
    }
  });

  it('stands in for every text placeholder the screens had', () => {
    for (const screen of [
      'canvas',
      'compare',
      'composition',
      'iteration',
      'page',
      'taste',
      'treatments',
      'assets'
    ]) {
      const source = readFileSync(new URL(`./screens/${screen}.tsx`, import.meta.url), 'utf8');
      assert.match(source, /<ScreenLoading( page)?( problem={problem})?>/, screen);
      assert.doesNotMatch(source, /<Missing>(Loading|Reading)/, screen);
    }
  });
});

describe('the studio’s own buttons while their work runs', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('use Button’s pending state with a gerund, not a changed label', () => {
    const cases: [string, string[]][] = [
      ['./parts/composition-promote.tsx', ['Preparing…', 'Running the checks…']],
      ['./parts/dock.tsx', ['Stopping…', 'Removing…']],
      [
        './parts/run-card.tsx',
        ['Copying…', 'Checking…', 'Stopping…', 'Cancelling…', 'Putting back…']
      ],
      ['./parts/status.tsx', ['Starting…', 'Saving…']],
      ['./screens/iteration.tsx', ['Keeping…', 'Taking screenshots…']]
    ];
    for (const [path, labels] of cases) {
      const source = read(path);
      for (const label of labels)
        assert.match(source, new RegExp(`pendingLabel="${label}"`), `${path}: ${label}`);
      assert.match(source, /pending=\{/, path);
    }
    assert.doesNotMatch(read('./parts/run-card.tsx'), /'Checking' :/);
    assert.doesNotMatch(read('./parts/composition-promote.tsx'), /busy \? 'Preparing'/);
    assert.doesNotMatch(read('./screens/iteration.tsx'), /'Taking screenshots'\n/);
  });

  it('names a run’s finish by the button that asked, so only that one turns', () => {
    assert.match(read('./parts/run-card.tsx'), /act\(outcome \?\? 'done'/);
    assert.match(read('./parts/verb-run.tsx'), /return \{ run, busy, verb, served, line \}/);
  });

  it('shows the indicator on the canvas toolbar’s and the terminal’s own buttons', () => {
    const canvas = read('./screens/canvas.tsx');
    for (const label of [
      'Checking…',
      'Stopping…',
      'Pulling…',
      'Saving…',
      'Starting…',
      'Keeping…'
    ]) {
      assert.ok(canvas.includes(label), label);
    }
    assert.match(canvas, /<ActivityIndicator \/>/);
    const terminal = read('./parts/terminal-view.tsx');
    assert.match(terminal, /Joining…/);
    assert.match(terminal, /aria-busy=\{joining \|\| undefined\}/);
  });
});
