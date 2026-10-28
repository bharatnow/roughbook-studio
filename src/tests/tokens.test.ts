import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The raw-color budget (ROUGHBOOK-APPLE-PLAN.md, A1 step 1): the local UI takes its colors from
// the --rb-* tokens of @roughbook/ui's theme.css, so they follow light, dark and increased
// contrast. Every `#` hex color and every rgb( or rgba( value written into ui/src (a class string,
// a style object, the terminal's xterm theme, a data-URL picture) is one that does not. The total
// may only go down: lower RAW_COLOR_BUDGET when a pass removes some, never raise it.
//
// Today's 8: the terminal dock's theme (three hexes, parts/terminal-view.tsx), the placeholder
// picture's SVG (two, canvas-input.ts) and three rgba shadows (parts/shell.tsx, parts/status.tsx,
// screens/iteration.tsx). It was 9 before A1 deleted accent-[#5e4cff] from parts/refine.tsx.
const RAW_COLOR_BUDGET = 8;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const HEX = /(?<![\w&#]|href=["'])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const RGB = /(?<![a-zA-Z0-9-])rgba?\(/g;

/** The raw colors in a source file, outside its comment lines. */
export function rawColors(source: string): string[] {
  const code = source
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|\/\*|\*|\{\s*\/\*)/.test(line))
    .join('\n');
  return [...code.matchAll(HEX), ...code.matchAll(RGB)].map(match => match[0]);
}

/** Every non-test .ts and .tsx under ui/src, by its path from the repo, and its raw colors. */
function rawColorsByFile(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const entry of readdirSync(path.join(root, 'ui', 'src'), {
    recursive: true,
    encoding: 'utf8'
  })) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    const file = path.posix.join('ui/src', entry.split(path.sep).join('/'));
    const colors = rawColors(readFileSync(path.join(root, file), 'utf8'));
    if (colors.length > 0) found[file] = colors;
  }
  return found;
}

describe('the raw-color budget', () => {
  it('counts hex colors and rgb()/rgba() values in classes, styles and pictures', () => {
    assert.deepEqual(rawColors(`className="mt-1 size-4 accent-[#5e4cff]"`), ['#5e4cff']);
    assert.deepEqual(rawColors(`'shadow-[0_8px_30px_rgba(39,40,53,0.12)]'`), ['rgba(']);
    assert.deepEqual(rawColors(`style={{ color: 'rgb(0 0 0)' }}`), ['rgb(']);
    assert.deepEqual(rawColors(`theme: { background: '#1a1b25', cursor: '#FFF' }`), [
      '#1a1b25',
      '#FFF'
    ]);
    assert.deepEqual(rawColors(`'<svg><rect fill="#eceff3"/><path stroke="#5b6274"/></svg>'`), [
      '#eceff3',
      '#5b6274'
    ]);
    assert.deepEqual(rawColors(`'#5e4cff80'`), ['#5e4cff80']);
  });

  it('leaves anchors, entities, ids, token names and comments alone', () => {
    assert.deepEqual(rawColors(`<a href="#add">Add</a>`), []);
    assert.deepEqual(rawColors(`<a href="#top">Top</a> &#123; issue #12345 #abcde`), []);
    assert.deepEqual(rawColors(`className="bg-violet text-graphite"`), []);
    assert.deepEqual(rawColors(`const v = 'var(--rb-accent)'; srgb(1)`), []);
    assert.deepEqual(rawColors(`  // was #5e4cff\n  /* rgba(0,0,0,0.1) */\n  {/* #fff */}`), []);
  });

  it(`holds the local UI to ${RAW_COLOR_BUDGET} raw colors`, () => {
    const found = rawColorsByFile();
    const total = Object.values(found).reduce((sum, colors) => sum + colors.length, 0);
    const where = Object.entries(found)
      .map(([file, colors]) => `  ${file}: ${colors.join(' ')}`)
      .join('\n');
    assert.ok(
      total <= RAW_COLOR_BUDGET,
      `ui/src holds ${total} raw colors; the budget is ${RAW_COLOR_BUDGET}. Use a --rb-* token or a theme class instead:\n${where}`
    );
  });
});
