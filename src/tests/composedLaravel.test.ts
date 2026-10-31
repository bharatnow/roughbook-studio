// The composed preview on Laravel with Blade: the route answers a page's key with ?roughbook-compose=…,
// each section with its fixture, in order, in its marker, inside the one wrapper, with the shared live
// script once and ready under the composition's id. Only a mapped repo's route has it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { writeMap } from '../map/file.js';
import { recipeFor } from '../recipes/index.js';
import { CONTEXT_BLOCK } from '../recipes/laravel/context.js';
import { routeFile } from '../recipes/laravel/index.js';
import {
  COMPOSED_ROUTE,
  PREVIEW_ROUTE,
  ROUTE_FILE,
  previewWrapper
} from '../recipes/laravel/preview.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const laravel = recipeFor('laravel')!;

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

async function bladeApp(mapped: boolean): Promise<string> {
  const repo = await tempDir('roughbook-composed-laravel-');
  write(repo, 'routes/web.php', '<?php\n');
  if (mapped) {
    writeMap(repo, {
      version: 1,
      by: ['laravel'],
      pages: [],
      components: [],
      missed: [],
      unplaced: []
    });
  }
  return repo;
}

describe('the composed preview on Laravel', () => {
  it('composes, at a version that brings a repo forward', () => {
    assert.equal(laravel.composes, true);
    assert.equal(laravel.version, 4);
  });

  it('gives the address the route answers', () => {
    const environment = laravel.environment(null);
    assert.equal(
      composedAddress(environment, 'home', [
        { component: 'hero', iteration: 'iteration-01' },
        { component: 'footer', iteration: 'iteration-01' }
      ]),
      '/rough-preview/home?roughbook-compose=hero:iteration-01,footer:iteration-01'
    );
  });

  it('is in every repo’s route, with the in-page switch only where the repo is mapped', async () => {
    const mapped = await bladeApp(true);
    assert.equal(routeFile(mapped), `${COMPOSED_ROUTE}${CONTEXT_BLOCK}`);
    assert.equal(
      laravel.planPreview(mapped, LINK).changes.find(change => change.file === ROUTE_FILE)?.after,
      routeFile(mapped)
    );
    const plain = await bladeApp(false);
    assert.equal(routeFile(plain), COMPOSED_ROUTE);
  });

  it('checks the address before it looks for a file, behind the route’s gates', () => {
    const route = COMPOSED_ROUTE;
    const at = (text: string) => {
      const index = route.indexOf(text);
      assert.notEqual(index, -1, text);
      return index;
    };
    const branch = at("$request->query->has('roughbook-compose')");
    assert.ok(at('$request->getHost()') < branch);
    assert.ok(at("'/^[a-z0-9]+(?:-[a-z0-9]+)*:iteration-\\d{2,}\\z/'") > branch);
    assert.ok(at('if (! $found || $sections === [] || count($sections) > 30)') < at('is_file('));
    // \z, not $, which a trailing newline in the address would pass.
    assert.ok(route.includes("'/^[a-z0-9]+(?:-[a-z0-9]+)*\\z/'"));
    // The page and its sections are checked before the id is built into the failure.
    assert.match(route, /\$key = \$found \? \$page\.'\/composition' : 'composition';/);
  });

  it('renders each section in its marker, inside the one root, with the script once', () => {
    const route = COMPOSED_ROUTE;
    assert.ok(
      route.includes(
        `'<roughbook-section data-roughbook-section="'.$page.'/'.$component.'" style="display: contents">'.$shown.'</roughbook-section>'`
      )
    );
    assert.ok(
      route.includes(
        `'<div data-roughbook-variant>'.$slot.'</div><script>'.$live.'</script>'.$pick`
      )
    );
    assert.equal(route.split(LIVE_SCRIPT).length, 2);
    assert.ok(!route.split(LIVE_SCRIPT)[0]!.endsWith('"'));
    assert.match(route, /<<<'ROUGHBOOK_LIVE'\n/);
    assert.match(route, /query\('roughbook-pick'\) === '1'/);
    assert.match(route, /postMessage\(\{roughbook:'section'/);
  });

  it('says ready through the wrapper, once, under the composition’s id', async () => {
    const wrapper = previewWrapper(await bladeApp(true));
    assert.equal(wrapper.split("roughbook: 'ready'").length, 2);
    assert.match(wrapper, /id: @json\(\$key\)/);
    assert.match(COMPOSED_ROUTE, /'key' => \$key,\n\s+'slot' =>/);
    assert.ok(COMPOSED_ROUTE.includes('use (&$key)'));
  });

  it('leaves a composition’s markers to the route, and asks an older route to upgrade', async () => {
    assert.ok(CONTEXT_BLOCK.includes("$request->query->has('roughbook-compose') ||"));
    const repo = await bladeApp(true);
    write(repo, ROUTE_FILE, `${PREVIEW_ROUTE}<!-- the switch of version 2 -->`);
    assert.ok(laravel.contextPreview!.missing(repo, LINK).includes(ROUTE_FILE));
    write(repo, ROUTE_FILE, routeFile(repo));
    assert.ok(!laravel.contextPreview!.missing(repo, LINK).includes(ROUTE_FILE));
  });

  it('writes PHP that parses, where PHP is on this machine', async t => {
    try {
      execFileSync('php', ['-v'], { stdio: 'ignore' });
    } catch {
      return t.skip('PHP is not on the PATH');
    }
    const repo = await tempDir('roughbook-composed-laravel-');
    write(repo, 'route.php', routeFile(await bladeApp(true)));
    assert.match(
      execFileSync('php', ['-l', path.join(repo, 'route.php')], { encoding: 'utf8' }),
      /No syntax errors/
    );
  });
});
