// The composed preview on Nuxt: the preview page answers a page's key with ?roughbook-compose=…, each
// section with its fixture, in order, inside one preview.vue, each in its marker, in one root the shared
// script measures, with Pick, ready once; the single iteration's route stays as it was.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { LIVE_FUNCTION } from '../recipes/live.js';
import { recipeFor } from '../recipes/index.js';
import { contextFiles } from '../recipes/nuxt/context.js';
import { PAGE_FILE, PREVIEW_MODULE, PREVIEW_PAGE } from '../recipes/nuxt/preview.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const nuxt = recipeFor('nuxt')!;
const LINK = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true
} as RepoLink;

describe('the composed preview on Nuxt', () => {
  it('composes, at the next recipe version, and gives the preview route’s address', () => {
    assert.equal(nuxt.composes, true);
    assert.equal(nuxt.version, 4);
    assert.equal(
      composedAddress(
        { preview: nuxt.environment(null).preview, recipe: 'nuxt', mode: 'live' },
        'home',
        [
          { component: 'hero', iteration: 'iteration-01' },
          { component: 'footer', iteration: 'iteration-01' }
        ]
      ),
      '/rough-preview/home?roughbook-compose=hero:iteration-01,footer:iteration-01'
    );
  });

  it('renders the sections in markers, inside one Preview, inside the measured root', () => {
    assert.match(
      PREVIEW_PAGE,
      /<div v-else-if="composed !== null" data-roughbook-variant>\n {4}<Preview>\n {6}<Sections \/>\n {4}<\/Preview>\n {2}<\/div>/
    );
    assert.match(
      PREVIEW_PAGE,
      /"roughbook-section",\n\s+\{ key: section\.key, "data-roughbook-section": section\.marker, style: \{ display: "contents" \} \}/
    );
    assert.match(PREVIEW_PAGE, /\[h\(section\.component, section\.fixture\)\]/);
    assert.ok(PREVIEW_PAGE.indexOf('const loadFixture = fixtures[item.key]') > 0);
  });

  it('answers a missing section as a missing iteration, on this machine only', () => {
    assert.match(PREVIEW_PAGE, /!KEY\.test\(item\.key\) \|\| !iterations\[item\.key\]/);
    assert.match(
      PREVIEW_PAGE,
      /failure\.value = `There is no iteration \$\{absent\.key\} in this repo\.`;\n {4}status = 404;/
    );
    assert.ok(
      PREVIEW_PAGE.indexOf('} else if (composed !== null) {') >
        PREVIEW_PAGE.indexOf('if (!LOOPBACK.test(url.hostname)) {')
    );
    assert.match(PREVIEW_MODULE, /if \(!nuxt\.options\.dev\) return;/);
  });

  it('runs the shared script on a composition alone, says ready once under its own id, and picks', () => {
    assert.ok(PREVIEW_PAGE.includes(`const live = ${LIVE_FUNCTION};`));
    assert.equal(PREVIEW_PAGE.split('live()').length, 2);
    assert.match(
      PREVIEW_PAGE,
      /if \(composed !== null && !failure\.value\) composePage\(\);\n {2}post\(/
    );
    assert.match(PREVIEW_PAGE, /const id = composed === null \? key : `\$\{key\}\/composition`;/);
    assert.match(PREVIEW_PAGE, /\{ \.\.\.message, id \}/);
    assert.equal(PREVIEW_PAGE.split('roughbook: "ready"').length, 2);
    assert.match(PREVIEW_PAGE, /params\.get\("roughbook-pick"\) === "1"/);
    assert.match(PREVIEW_PAGE, /postMessage\(\{ roughbook: "section", key: name \}, "\*"\)/);
  });

  it('keeps the single iteration’s route', () => {
    assert.match(
      PREVIEW_PAGE,
      /<Preview v-else>\n {4}<component :is="Iteration" v-bind="fixture" \/>\n {2}<\/Preview>/
    );
    assert.match(PREVIEW_PAGE, /else if \(!KEY\.test\(key\) \|\| !iterations\[key\]\)/);
  });

  it('leaves an adopted component without a marker of its own inside a composition', () => {
    const section = contextFiles().find(item => item.file.endsWith('context-section.ts'))!;
    assert.match(
      section.content,
      /url\.searchParams\.has\("roughbook-compose"\)\) return \(\) => h\(Original, attrs, slots\);/
    );
  });

  it('leaves a page from before compositions to setup --upgrade', async () => {
    const repo = await tempDir('roughbook-composed-nuxt-');
    for (const item of contextFiles()) {
      fs.mkdirSync(path.dirname(path.join(repo, item.file)), { recursive: true });
      fs.writeFileSync(path.join(repo, item.file), item.content);
    }
    const page = path.join(repo, PAGE_FILE);
    fs.writeFileSync(page, '<!-- Roughbook preview page -->\n');
    assert.deepEqual(nuxt.contextPreview!.missing(repo, LINK), [PAGE_FILE]);
    fs.writeFileSync(page, PREVIEW_PAGE);
    assert.deepEqual(nuxt.contextPreview!.missing(repo, LINK), []);
  });
});
