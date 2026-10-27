// The in-page view's switch for WordPress block themes (ROUGHBOOK-BROWNFIELD-PLAN.md, B5b,
// decisions 41 and 42): the preview plugin, for a mapped theme, marks each adopted template part
// and pattern where WordPress renders it and, for a swap, renders the iteration's copy in its place
// through WordPress's own rendering, in the local environment alone and for this machine
// only. Its list as the studio generates it; the PHP run with stand-ins for WordPress's functions,
// where PHP is on this machine; and nothing of it for a theme that maps nothing (ground rule 2).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import { CONTEXT_SENTINEL } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import {
  CONTEXT_BLOCK,
  CONTEXT_LIST,
  pluginFor,
  renderContextList,
  writeContextList
} from '../recipes/wordpress/context.js';
import {
  OVERRIDE_FILE,
  PLUGIN_FILE,
  PREVIEW_PLUGIN,
  PRODUCTION_CONFIG,
  overrideFor,
  productionConfig
} from '../recipes/wordpress/preview.js';
import { planPrep } from '../repo/prep.js';
import { tempDir } from './helpers.js';

const wordpress = recipeFor('wordpress')!;

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'theme',
  roughCommitted: true,
  appDir: null
};

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

function page(slug: string, sections: string[], extra: Partial<MapPage> = {}): MapPage {
  return {
    slug,
    name: slug,
    address: slug === 'shared' ? null : '/',
    example: null,
    signIn: 'no',
    files: [],
    sections,
    byAgent: false,
    ...extra
  };
}

function component(slug: string, files: string[], exported: string): MapComponent {
  return {
    slug,
    name: slug,
    kind: 'section',
    files,
    export: exported,
    fixture: null,
    alone: 'unknown',
    why: null,
    byAgent: false
  };
}

const THEME_MAP: RepoMap = {
  version: 1,
  by: ['wordpress'],
  pages: [
    page('shared', ['header']),
    page('front-page', ['hero', 'newsletter', 'cta'], { files: ['templates/front-page.html'] }),
    page('single-post', ['newsletter'], {
      address: '/?p=[id]',
      example: '/?p=1',
      files: ['templates/single.html']
    })
  ],
  components: [
    component('header', ['parts/header.html'], 'part header'),
    component('hero', ['patterns/hero.php'], 'pattern harbor-theme/hero'),
    component('newsletter', ['parts/newsletter.html'], 'part newsletter'),
    // A classic theme's part, which the switch does not mark.
    component('cta', ['template-parts/cta.php'], 'part template-parts/cta')
  ],
  missed: [],
  unplaced: []
};

const GUARD = "<?php defined( 'ABSPATH' ) || exit; ?>\n";

/** A mapped block theme with the front page's pattern and part adopted, a fork of each, and the part on a post too. */
async function themeRepo(): Promise<string> {
  const repo = await tempDir('roughbook-context-wp-');
  writeMap(repo, THEME_MAP);
  write(repo, 'style.css', '/*\nTheme Name: Harbor\n*/\n');
  write(repo, 'package.json', '{ "devDependencies": { "@wordpress/env": "11.17.0" } }\n');
  for (const key of [
    'shared/header/iteration-00',
    'front-page/hero/iteration-00',
    'front-page/hero/iteration-01',
    'front-page/newsletter/iteration-00',
    'front-page/newsletter/iteration-01',
    'front-page/cta/iteration-00',
    'front-page/cta/iteration-01',
    'single-post/newsletter/iteration-00'
  ]) {
    write(repo, `rough/${key}/index.php`, `${GUARD}<p>${key}</p>\n`);
  }
  const fork = (key: string, source: string, copy: string, text: string) => {
    write(repo, `rough/${key}/${copy}`, text);
    write(
      repo,
      `rough/${key}/.base/base.json`,
      JSON.stringify({ version: 1, files: [{ path: source, sha256: 'x', copy }] })
    );
  };
  fork(
    'front-page/hero/iteration-01',
    'patterns/hero.php',
    'hero.php',
    `${GUARD}<!-- wp:heading --><h1>Forked hero</h1><!-- /wp:heading -->\n`
  );
  fork(
    'front-page/newsletter/iteration-01',
    'parts/newsletter.html',
    'newsletter.html',
    '<!-- wp:paragraph --><p>Forked newsletter</p><!-- /wp:paragraph -->\n'
  );
  return repo;
}

describe('the WordPress switch’s list', () => {
  it('names each adopted part and pattern with the template it is on, and the file each swap renders', async () => {
    const repo = await themeRepo();
    assert.deepEqual(JSON.parse(renderContextList(repo)), {
      parts: {
        header: [{ key: 'shared/header', template: null }],
        newsletter: [
          { key: 'front-page/newsletter', template: 'front-page' },
          { key: 'single-post/newsletter', template: 'single' }
        ]
      },
      patterns: { 'harbor-theme/hero': [{ key: 'front-page/hero', template: 'front-page' }] },
      // Inside rough/, which WordPress has at wp-content/rough.
      iterations: {
        'front-page/hero/iteration-01': 'front-page/hero/iteration-01/hero.php',
        'front-page/newsletter/iteration-01': 'front-page/newsletter/iteration-01/newsletter.html'
      }
    });
    assert.equal(writeContextList(repo), true);
    assert.equal(writeContextList(repo), false);
    assert.equal(read(repo, CONTEXT_LIST), renderContextList(repo));
  });
});

describe('the WordPress switch in the setup', () => {
  it('is the preview plugin’s for a mapped theme only, behind a new version, its list generated', async () => {
    assert.equal(wordpress.version, 4);
    const repo = await themeRepo();
    const hook = wordpress.contextPreview!;
    assert.equal(hook.sentinel, CONTEXT_SENTINEL);
    assert.ok(CONTEXT_BLOCK.includes(CONTEXT_SENTINEL));
    assert.equal(pluginFor(repo), `${PREVIEW_PLUGIN}${CONTEXT_BLOCK}`);
    assert.deepEqual(hook.missing(repo, LINK), [PLUGIN_FILE]);
    const plan = planPrep(repo, { link: LINK, recipe: wordpress });
    assert.equal(
      plan.changes.find(change => change.file === PLUGIN_FILE)?.after,
      `${PREVIEW_PLUGIN}${CONTEXT_BLOCK}`
    );
    const gitignore = plan.changes.find(change => change.file === '.gitignore')!;
    assert.ok(gitignore.after.split('\n').includes(`/${CONTEXT_LIST}`));
    for (const change of plan.changes) write(repo, change.file, change.after);
    assert.deepEqual(hook.missing(repo, LINK), []);
    assert.deepEqual(hook.generated, [CONTEXT_LIST]);
    assert.ok(wordpress.generatedFiles.includes(CONTEXT_LIST));
    wordpress.syncPreview(repo);
    assert.ok(fs.existsSync(path.join(repo, CONTEXT_LIST)));
    // WordPress's plain links keep their own query.
    assert.equal(
      hook.address('/?p=1', 'single-post/newsletter/iteration-01', { pick: true }),
      '/?p=1&roughbook-swap=single-post/newsletter/iteration-01&roughbook-pick=1'
    );

    const plain = await tempDir('roughbook-context-wp-');
    write(plain, 'style.css', '/*\nTheme Name: Plain\n*/\n');
    assert.equal(pluginFor(plain), PREVIEW_PLUGIN);
    const before = planPrep(plain, { link: LINK, recipe: wordpress });
    assert.equal(before.changes.find(change => change.file === PLUGIN_FILE)?.after, PREVIEW_PLUGIN);
    assert.deepEqual(hook.missing(plain, LINK), []);
    wordpress.syncPreview(plain);
    assert.ok(!fs.existsSync(path.join(plain, CONTEXT_LIST)));
  });
});

/** WordPress's functions the plugin calls, as stand-ins, and the hooks it adds run as WordPress runs them. */
const HARNESS = `<?php
define( 'ABSPATH', __DIR__ . '/' );
define( 'WP_CONTENT_DIR', __DIR__ );
$GLOBALS['roughbook_hooks'] = array();
function add_filter( $name, $callback, $priority = 10, $args = 1 ) { $GLOBALS['roughbook_hooks'][ $name ][] = $callback; return true; }
function add_action( $name, $callback, $priority = 10, $args = 1 ) { return add_filter( $name, $callback, $priority, $args ); }
function roughbook_apply( $name, ...$args ) { foreach ( $GLOBALS['roughbook_hooks'][ $name ] ?? array() as $callback ) { $args[0] = $callback( ...$args ); } return $args[0]; }
function roughbook_do( $name ) { ob_start(); foreach ( $GLOBALS['roughbook_hooks'][ $name ] ?? array() as $callback ) { $callback(); } return (string) ob_get_clean(); }
function wp_get_environment_type() { return getenv( 'ROUGHBOOK_ENV' ) ?: 'local'; }
function wp_unslash( $value ) { return $value; }
function esc_attr( $value ) { return htmlspecialchars( (string) $value, ENT_QUOTES ); }
function wp_json_encode( $value ) { return json_encode( $value ); }
function do_blocks( $content ) { return '[blocks]' . $content; }
$GLOBALS['wp_embed'] = new class { public function autoembed( $content ) { return $content; } };
$_SERVER['HTTP_HOST'] = getenv( 'ROUGHBOOK_HOST' ) ?: 'localhost:8888';
parse_str( (string) getenv( 'ROUGHBOOK_QUERY' ), $_GET );
$GLOBALS['_wp_current_template_id'] = 'harbor//' . ( getenv( 'ROUGHBOOK_TEMPLATE' ) ?: 'front-page' );
require __DIR__ . '/plugin.php';
$part    = array( 'blockName' => 'core/template-part', 'attrs' => array( 'slug' => 'newsletter', 'tagName' => 'section' ) );
$pattern = array( 'blockName' => 'core/pattern', 'attrs' => array( 'slug' => 'harbor-theme/hero' ) );
$file    = roughbook_apply( 'get_block_file_template', (object) array( 'content' => 'the theme’s newsletter' ), 'harbor//newsletter', 'wp_template_part' );
echo json_encode(
	array(
		'head'         => roughbook_do( 'wp_head' ),
		'pattern'      => roughbook_apply( 'pre_render_block', null, $pattern, null ),
		'patternBlock' => roughbook_apply( 'render_block', '<div>the theme’s hero</div>', $pattern ),
		'partContent'  => $file->content,
		'part'         => roughbook_apply( 'render_block', '<section class="wp-block-template-part">' . $file->content . '</section>', $part ),
		'other'        => roughbook_apply( 'render_block', '<p>x</p>', array( 'blockName' => 'core/paragraph', 'attrs' => array() ) ),
		'footer'       => roughbook_do( 'wp_footer' ),
	)
);
`;

type Run = {
  head: string;
  pattern: string | null;
  patternBlock: string;
  partContent: string;
  part: string;
  other: string;
  footer: string;
};

describe('the WordPress switch, run', () => {
  let php = true;
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
  } catch {
    php = false;
  }

  async function runner() {
    const repo = await themeRepo();
    write(repo, 'plugin.php', pluginFor(repo));
    write(repo, 'harness.php', HARNESS);
    writeContextList(repo);
    return (env: Record<string, string> = {}): Run =>
      JSON.parse(
        execFileSync('php', [path.join(repo, 'harness.php')], {
          encoding: 'utf8',
          env: { ...process.env, ...env }
        })
      ) as Run;
  }

  it('marks each adopted part and pattern by the template the page is on, and leaves the rest', async t => {
    if (!php) return t.skip('PHP is not on the PATH');
    const run = await runner();
    const plain = run();
    assert.equal(
      plain.part,
      '<roughbook-section data-roughbook-section="front-page/newsletter" style="display: contents"><section class="wp-block-template-part">the theme’s newsletter</section></roughbook-section>'
    );
    assert.equal(
      plain.patternBlock,
      '<roughbook-section data-roughbook-section="front-page/hero" style="display: contents"><div>the theme’s hero</div></roughbook-section>'
    );
    assert.equal(plain.pattern, null);
    assert.equal(plain.other, '<p>x</p>');
    // The markers keep the layout's spacing for what they hold.
    assert.match(plain.head, /<style id="roughbook-sections">/);
    assert.equal(plain.footer, '');
    // On a post, the part is that page's.
    assert.match(
      run({ ROUGHBOOK_TEMPLATE: 'single' }).part,
      /data-roughbook-section="single-post\/newsletter"/
    );
  });

  it('swaps the iteration’s copy in for the request that asks, through WordPress’s own rendering', async t => {
    if (!php) return t.skip('PHP is not on the PATH');
    const run = await runner();
    const hero = run({ ROUGHBOOK_QUERY: 'roughbook-swap=front-page/hero/iteration-01' });
    assert.equal(
      hero.pattern,
      '<roughbook-section data-roughbook-section="front-page/hero" data-roughbook-swap="front-page/hero/iteration-01" style="display: contents">[blocks]<!-- wp:heading --><h1>Forked hero</h1><!-- /wp:heading -->\n</roughbook-section>'
    );
    assert.equal(hero.partContent, 'the theme’s newsletter');
    const news = run({ ROUGHBOOK_QUERY: 'roughbook-swap=front-page/newsletter/iteration-01' });
    assert.equal(news.pattern, null);
    // The part's content is the copy's, so WordPress draws its own wrapper around it.
    assert.equal(
      news.partContent,
      '<!-- wp:paragraph --><p>Forked newsletter</p><!-- /wp:paragraph -->\n'
    );
    assert.match(
      news.part,
      /^<roughbook-section data-roughbook-section="front-page\/newsletter" data-roughbook-swap="front-page\/newsletter\/iteration-01" style="display: contents">/
    );
    // A swap of another page's section, or of no iteration, changes nothing.
    const post = run({
      ROUGHBOOK_QUERY: 'roughbook-swap=front-page/newsletter/iteration-01',
      ROUGHBOOK_TEMPLATE: 'single'
    });
    assert.equal(post.partContent, 'the theme’s newsletter');
    assert.equal(
      run({ ROUGHBOOK_QUERY: 'roughbook-swap=front-page/hero/iteration-07' }).pattern,
      null
    );
  });

  it('without markers shows the page as it is, and with Pick names a clicked section to the frame', async t => {
    if (!php) return t.skip('PHP is not on the PATH');
    const run = await runner();
    const bare = run({
      ROUGHBOOK_QUERY: 'roughbook-markers=0&roughbook-swap=front-page/hero/iteration-01'
    });
    assert.equal(
      bare.part,
      '<section class="wp-block-template-part">the theme’s newsletter</section>'
    );
    assert.equal(
      bare.pattern,
      '[blocks]<!-- wp:heading --><h1>Forked hero</h1><!-- /wp:heading -->\n'
    );
    assert.equal(bare.head, '');
    const pick = run({ ROUGHBOOK_QUERY: 'roughbook-pick=1' });
    assert.match(pick.footer, /closest\('\[data-roughbook-section\]'\)/);
    assert.match(pick.footer, /postMessage\(\{roughbook:'section',key:/);
  });

  it('does nothing in production, for a request addressed to the network, or in the preview route', async t => {
    if (!php) return t.skip('PHP is not on the PATH');
    const run = await runner();
    const query = 'roughbook-swap=front-page/hero/iteration-01&roughbook-pick=1';
    for (const env of <Record<string, string>[]>[
      { ROUGHBOOK_ENV: 'production', ROUGHBOOK_QUERY: query },
      { ROUGHBOOK_ENV: 'staging', ROUGHBOOK_QUERY: query },
      // The local environment alone, as the preview route answers (review finding 14).
      { ROUGHBOOK_ENV: 'development', ROUGHBOOK_QUERY: query },
      { ROUGHBOOK_HOST: '192.168.1.37:8888', ROUGHBOOK_QUERY: query },
      { ROUGHBOOK_QUERY: `rough_preview=front-page/hero/iteration-01&${query}` }
    ]) {
      const shown = run(env);
      assert.equal(shown.pattern, null, JSON.stringify(env));
      assert.equal(
        shown.part,
        '<section class="wp-block-template-part">the theme’s newsletter</section>'
      );
      assert.equal(shown.head, '');
      assert.equal(shown.footer, '');
    }
  });
});

describe('the WordPress the switch shows', () => {
  it('mounts and activates the theme the repo is, when the repo has no wp-env config of its own', async () => {
    const repo = await themeRepo();
    const folder = path.basename(repo);
    const override = JSON.parse(overrideFor(repo)) as {
      themes?: string[];
      lifecycleScripts?: { afterStart?: string };
      config: Record<string, string>;
    };
    // wp-env infers the theme only when no config file is there, and the override is one.
    assert.deepEqual(override.themes, ['.']);
    assert.equal(
      override.lifecycleScripts?.afterStart,
      `npx wp-env run cli wp theme activate ${folder}`
    );
    assert.equal(override.config.WP_ENVIRONMENT_TYPE, 'local');
    const production = JSON.parse(productionConfig(repo)) as {
      themes: string[];
      lifecycleScripts?: { afterStart?: string };
    };
    assert.deepEqual(production.themes, ['.']);
    assert.equal(
      production.lifecycleScripts?.afterStart,
      `npx wp-env run cli --config ${PRODUCTION_CONFIG} wp theme activate ${folder}`
    );
    assert.equal(
      planPrep(repo, { link: LINK, recipe: wordpress }).changes.find(
        change => change.file === OVERRIDE_FILE
      )?.after,
      overrideFor(repo)
    );
    // A repo that says what its WordPress runs keeps its own themes and active theme.
    write(repo, '.wp-env.json', '{ "themes": ["../parent-theme", "."] }\n');
    const own = JSON.parse(overrideFor(repo)) as Record<string, unknown>;
    assert.equal(own.themes, undefined);
    assert.equal(own.lifecycleScripts, undefined);
    assert.equal(
      (JSON.parse(productionConfig(repo)) as Record<string, unknown>).lifecycleScripts,
      undefined
    );
  });
});
