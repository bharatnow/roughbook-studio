// The composed preview on Shopify themes (B6, decisions 46 and 54). Liquid reads no parameter of an
// address, so the template sends the composed address on to search terms it can read, and renders
// each section through the dispatcher, in its marker. Liquid is not run here: these pin the template
// as text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { recipeFor } from '../recipes/index.js';
import { PREVIEW_TEMPLATE, TEMPLATE } from '../recipes/shopify/preview.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const shopify = recipeFor('shopify')!;

/** The page's part of the template: the branch for a composition, and the one for an iteration. */
function branches(): { composed: string; single: string } {
  const start = PREVIEW_TEMPLATE.indexOf("{%- if rough_words.first == 'roughbook-compose' -%}");
  const middle = PREVIEW_TEMPLATE.indexOf(
    '{%- else -%}\n  {%- assign rough_key = search.terms -%}'
  );
  assert.ok(start > 0 && middle > start);
  return {
    composed: PREVIEW_TEMPLATE.slice(start, middle),
    single: PREVIEW_TEMPLATE.slice(middle)
  };
}

/** Runs the address's script as a browser would, and says where it went and what it posted. */
function follow(search: string): { went: string | null; posted: unknown[] } {
  const script = /<script>([\s\S]*?)<\/script>/.exec(branches().single)![1]!;
  const posted: unknown[] = [];
  let went: string | null = null;
  const window = {
    location: {
      search,
      pathname: '/search',
      replace: (to: string) => {
        went = to;
      }
    },
    parent: { postMessage: (message: unknown) => posted.push(message) }
  };
  new Function('window', script)(window);
  return { went, posted };
}

describe('the composed preview on Shopify themes', () => {
  it('composes, at a version that brings a theme forward', () => {
    assert.equal(shopify.composes, true);
    assert.equal(shopify.version, 2);
  });

  it('builds its address on the search the preview already is', () => {
    const address = composedAddress(shopify.environment(null), 'home', [
      { component: 'hero', iteration: 'iteration-01' },
      { component: 'footer', iteration: 'iteration-00' }
    ]);
    assert.equal(
      address,
      '/search?q=home&view=rough-preview&roughbook-compose=hero:iteration-01,footer:iteration-00'
    );
  });

  it('sends that address on to terms Liquid can read, keeping the rest of it', () => {
    const { went, posted } = follow(
      '?q=home&view=rough-preview&roughbook-pick=1&roughbook-compose=hero:iteration-01,footer:iteration-00'
    );
    assert.deepEqual(posted, []);
    const search = new URLSearchParams(went!.split('?')[1]);
    assert.equal(
      search.get('q'),
      'roughbook-compose home home/hero/iteration-01 home/footer/iteration-00'
    );
    assert.equal(search.get('view'), 'rough-preview');
    assert.equal(search.get('roughbook-pick'), '1');
    assert.equal(search.has('roughbook-compose'), false);
  });

  it('refuses an address that names no sections, under the composition’s id', () => {
    for (const search of [
      '?q=home&roughbook-compose=',
      '?q=home/hero&roughbook-compose=hero:iteration-01'
    ]) {
      const { went, posted } = follow(search);
      assert.equal(went, null);
      assert.equal((posted[0] as { roughbook: string }).roughbook, 'error');
      assert.match((posted[0] as { id: string }).id, /\/composition$/);
    }
  });

  it('leaves the address of one iteration alone', () => {
    const { went, posted } = follow('?q=home/hero/iteration-01&view=rough-preview');
    assert.equal(went, null);
    assert.deepEqual(posted, []);
  });

  it('marks each section inside the one wrapper and the one root', () => {
    const { composed } = branches();
    assert.match(composed, /<div id="rough-preview" data-roughbook-variant>/);
    assert.match(
      composed,
      /<roughbook-section data-roughbook-section="\{\{ rough_page \| escape \}\}\/\{\{ rough_parts\[1\] \| escape \}\}" style="display: contents">\n\s+\{%- render 'rough-preview', key: rough_key -%\}\n\s+<\/roughbook-section>/
    );
    // The loop is captured whole, and the wrapper is rendered once around it.
    assert.equal(composed.split("render 'rough-preview-wrapper'").length, 2);
    assert.ok(composed.indexOf('{%- endcapture -%}') < composed.indexOf('rough-preview-wrapper'));
    assert.ok(composed.indexOf('{%- endfor -%}') < composed.indexOf('{%- endcapture -%}'));
    assert.match(composed, /\{%- else -%\}\n\s+<p data-rough-missing>/);
  });

  it('runs the shared script on a composition only, then says ready once under its id', () => {
    const { composed, single } = branches();
    assert.equal(PREVIEW_TEMPLATE.split(LIVE_SCRIPT).length, 2);
    assert.ok(composed.includes(`${LIVE_SCRIPT}{% endraw %}`));
    // Not on a page that failed, whose error is its answer.
    assert.match(composed, /\{% raw %\}if \(!document\.querySelector\("\[data-rough-missing\]"\)/);
    assert.ok(!single.includes('roughbookLive'));
    assert.match(composed, /var key = \{\{ rough_page \| json \}\} \+ '\/composition';/);
    assert.equal(composed.split("{ roughbook: 'ready', id: key }").length, 2);
    // The canvas answers ready with the device's height, so the script must already be listening.
    assert.ok(composed.indexOf('roughbookLive') < composed.indexOf("{ roughbook: 'ready'"));
    assert.ok(!single.includes('data-roughbook-variant'));
    assert.match(single, /var key = \{\{ rough_key \| json \}\};/);
  });

  it('keeps all of it behind the development theme', () => {
    const gate = PREVIEW_TEMPLATE.indexOf("{%- if theme.role == 'development' -%}");
    assert.ok(gate > 0);
    assert.ok(gate < PREVIEW_TEMPLATE.indexOf('rough_words'));
    assert.ok(gate < PREVIEW_TEMPLATE.indexOf('<script>'));
    assert.ok(PREVIEW_TEMPLATE.trimEnd().endsWith('{%- endif -%}\n{%- endif -%}'));
  });

  it('brings a theme with the old template forward, and asks for no new file', async () => {
    const repo = await tempDir('roughbook-composed-shopify-');
    fs.mkdirSync(path.join(repo, 'templates'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ...TEMPLATE.split('/')),
      '{%- comment -%} Roughbook preview template, before compositions. {%- endcomment -%}\n'
    );
    const { changes, gitWanted } = shopify.planPreview(repo, LINK);
    const template = changes.find(change => change.file === TEMPLATE);
    assert.equal(template?.action, 'edit');
    assert.equal(template?.after, PREVIEW_TEMPLATE);
    assert.ok(gitWanted.includes(`/${TEMPLATE}`));
    assert.ok(shopify.setupFiles(repo, LINK).includes(TEMPLATE));
    assert.deepEqual(changes.map(change => change.file).sort(), ['rough/preview.liquid', TEMPLATE]);
  });
});
