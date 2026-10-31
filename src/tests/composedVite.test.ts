// The composed preview on Vite with React: the preview page's script also answers a page's key with
// ?roughbook-compose=…, each section with its fixture, in order, inside one Preview, in its marker,
// in the root the shared script measures, ready once all have rendered. The single iteration by its
// key stays as it was, and an adopted component inside a composed section adds no marker of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { writeMap } from '../map/file.js';
import { recipeFor } from '../recipes/index.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { contextFiles, CONTEXT_SECTION } from '../recipes/vite/context.js';
import { PREVIEW_SCRIPT } from '../recipes/vite/preview.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const vite = recipeFor('vite')!;

async function viteApp(): Promise<string> {
  const repo = await tempDir('roughbook-composed-vite-');
  fs.writeFileSync(
    path.join(repo, 'vite.config.ts'),
    'export default defineConfig({ plugins: [react()] });\n'
  );
  writeMap(repo, { version: 1, by: ['vite'], pages: [], components: [], missed: [], unplaced: [] });
  return repo;
}

describe('the composed preview on Vite', () => {
  it('composes, at the version that brings a repo forward', () => {
    assert.equal(vite.composes, true);
    assert.equal(vite.version, 6);
    assert.equal(
      composedAddress(vite.environment(null), 'home', [
        { component: 'hero', iteration: 'iteration-01' },
        { component: 'footer', iteration: 'iteration-01' }
      ]),
      '/rough-preview.html?key=home&roughbook-compose=hero:iteration-01,footer:iteration-01'
    );
  });

  it('renders the sections in markers, in one Preview, in the measured root', () => {
    assert.match(PREVIEW_SCRIPT, /const composed = params\.get\("roughbook-compose"\);/);
    assert.match(
      PREVIEW_SCRIPT,
      /<div data-roughbook-variant="">\n\s+<Preview>\n\s+\{sections\.map\(\(section\) =>/
    );
    assert.match(
      PREVIEW_SCRIPT,
      /createElement\(\n\s+"roughbook-section",\n\s+\{ key: section\.id, "data-roughbook-section": section\.marker, style: \{ display: "contents" \} \},\n\s+createElement\(section\.Section, section\.fixture\),/
    );
    assert.match(PREVIEW_SCRIPT, /<\/div>\n\s+<ComposedReady \/>\n\s+<\/Boundary>/);
  });

  it('answers a missing section as a missing iteration, under the composition’s id', () => {
    assert.match(
      PREVIEW_SCRIPT,
      /if \(!load\) throw new Error\(`There is no iteration \$\{id\} in this repo\.`\);/
    );
    assert.match(PREVIEW_SCRIPT, /id: composed === null \? key : `\$\{key\}\/composition`/);
  });

  it('runs the shared script on the composed page alone, after the loopback gate', () => {
    assert.ok(PREVIEW_SCRIPT.includes(`const LIVE = ${JSON.stringify(LIVE_SCRIPT)};`));
    assert.equal(PREVIEW_SCRIPT.split('live.textContent = LIVE').length, 2);
    assert.ok(
      PREVIEW_SCRIPT.indexOf('await showComposition(app, composed)') >
        PREVIEW_SCRIPT.indexOf('if (!LOOPBACK.test(window.location.hostname))')
    );
    assert.match(PREVIEW_SCRIPT, /async function showComposition[\s\S]*pick\(\);/);
    assert.match(PREVIEW_SCRIPT, /postMessage\(\{ roughbook: "section", key: name \}, "\*"\)/);
  });

  it('keeps an adopted component from marking or picking inside a composition', () => {
    const section = contextFiles().find(item => item.file === CONTEXT_SECTION)!.content;
    assert.match(section, /const markers = !composed && search\.get/);
    assert.match(section, /if \(live && !composed && new URLSearchParams/);
  });

  it('asks a mapped repo with the script from before compositions for the upgrade', async () => {
    const repo = await viteApp();
    const file = 'rough/preview-entry.tsx';
    fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
    fs.writeFileSync(path.join(repo, file), "// Roughbook preview page's script.\n");
    assert.ok(vite.contextPreview!.missing(repo, LINK).includes(file));
    assert.ok(vite.planPreview(repo, LINK).changes.some(change => change.file === file));
    fs.writeFileSync(path.join(repo, file), PREVIEW_SCRIPT);
    assert.ok(!vite.contextPreview!.missing(repo, LINK).includes(file));
  });
});
