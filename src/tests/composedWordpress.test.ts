// The composed preview on WordPress: the preview plugin answers a page's slug with
// ?roughbook-compose=…, rendering each section with its fixture, in order, inside the one wrapper,
// each in its marker, in one measured root, with the shared script once and ready once. The real
// plugin and wrapper run with stand-ins for WordPress's functions, where PHP is on this machine; the
// test on real WordPress is the live check, which needs Docker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { recipeFor } from '../recipes/index.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { PREVIEW_PLUGIN, PREVIEW_WRAPPER, GUARD } from '../recipes/wordpress/preview.js';
import { tempDir } from './helpers.js';

const wordpress = recipeFor('wordpress')!;

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

/** WordPress's functions the plugin and wrapper call, and the request's own hook run as WordPress runs it. */
const HARNESS = `<?php
define( 'ABSPATH', __DIR__ . '/' );
define( 'WP_CONTENT_DIR', __DIR__ );
$GLOBALS['roughbook_redirect'] = null;
function add_action( $name, $callback, $priority = 10 ) { if ( 'template_redirect' === $name ) { $GLOBALS['roughbook_redirect'] = $callback; } }
function wp_get_environment_type() { return getenv( 'ROUGHBOOK_ENV' ) ?: 'local'; }
function wp_unslash( $value ) { return $value; }
function esc_attr( $value ) { return htmlspecialchars( (string) $value, ENT_QUOTES ); }
function esc_html( $value ) { return htmlspecialchars( (string) $value, ENT_QUOTES ); }
function wp_json_encode( $value ) { return json_encode( $value ); }
function do_blocks( $content ) { return $content; }
function status_header( $status ) { echo "STATUS {$status}\\n"; }
function nocache_headers() {}
function get_bloginfo() { return 'en-US'; }
function bloginfo() {}
function wp_head() {}
function wp_footer() {}
function wp_body_open() {}
function body_class() {}
$_SERVER['HTTP_HOST'] = getenv( 'ROUGHBOOK_HOST' ) ?: 'localhost:8888';
parse_str( (string) getenv( 'ROUGHBOOK_QUERY' ), $_GET );
require __DIR__ . '/plugin.php';
( $GLOBALS['roughbook_redirect'] )();
`;

const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function theme() {
  const repo = await tempDir('roughbook-composed-wp-');
  write(repo, 'plugin.php', PREVIEW_PLUGIN);
  write(repo, 'harness.php', HARNESS);
  write(repo, 'rough/preview.php', PREVIEW_WRAPPER);
  write(
    repo,
    'rough/home/hero/iteration-01/index.php',
    `<?php ${GUARD} ?>\n<style>.hero { min-height: 100vh; }</style>\n<section class="hero"><?php echo esc_html( $heading ?? 'none' ); ?></section>\n`
  );
  write(repo, 'rough/home/hero/iteration-01/preview.json', '{ "heading": "Fixture words" }\n');
  write(repo, 'rough/home/footer/iteration-01/index.php', '<footer>Footer</footer>\n');
  write(
    repo,
    'rough/home/broken/iteration-01/index.php',
    "<?php throw new RuntimeException( 'on purpose' );\n"
  );
  write(repo, 'rough/home/bad/iteration-01/index.php', '<p>x</p>\n');
  write(repo, 'rough/home/bad/iteration-01/preview.json', '"words"\n');
  write(repo, 'secret/hero/iteration-01/index.php', '<p>Outside rough</p>\n');
  return (query: string, env: Record<string, string> = {}): string =>
    execFileSync('php', [path.join(repo, 'harness.php')], {
      encoding: 'utf8',
      env: { ...process.env, ROUGHBOOK_QUERY: query, ...env }
    });
}

const COMPOSED = 'rough_preview=home&roughbook-compose=hero:iteration-01,footer:iteration-01';
const failure = (page: string) => `id: ${JSON.stringify(`${page}/composition`)}`;

describe('the composed preview on WordPress', () => {
  it('composes, behind a new version, at the address the canvas asks for', () => {
    assert.equal(wordpress.composes, true);
    assert.equal(wordpress.version, 5);
    assert.equal(
      composedAddress(wordpress.environment(null), 'home', [
        { component: 'hero', iteration: 'iteration-01' },
        { component: 'footer', iteration: 'iteration-01' }
      ]),
      '/?rough_preview=home&roughbook-compose=hero:iteration-01,footer:iteration-01'
    );
  });

  it('renders the sections in order, each in its marker with its fixture, one script and one ready', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const page = await (await theme())(COMPOSED);
    assert.match(page, /^STATUS 200\n/);
    const root = page.indexOf('<div data-roughbook-variant>');
    const hero = page.indexOf(
      '<roughbook-section data-roughbook-section="home/hero" style="display: contents">\n<section class="hero">Fixture words</section>'
    );
    const footer = page.indexOf(
      '<roughbook-section data-roughbook-section="home/footer" style="display: contents"><footer>Footer</footer>'
    );
    assert.ok(root > 0 && hero > root && footer > hero, page);
    // What draws nothing is not the section's first element, which the canvas measures.
    const style = page.indexOf('<style>.hero');
    assert.ok(style > root && style < hero, page);
    assert.equal(page.split('<roughbook-section').length, 3);
    assert.equal(page.split(LIVE_SCRIPT).length, 2);
    assert.equal(page.split("roughbook: 'ready'").length, 2);
    assert.ok(page.indexOf(LIVE_SCRIPT) > footer);
    assert.ok(page.indexOf('roughbook: \'ready\', id: "home\\/composition"') > footer, page);
  });

  it('takes the shared script through PHP word for word', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const page = await (await theme())(COMPOSED);
    assert.ok(page.includes('/(\\d*\\.?\\d+)[dsl]?vh\\b/g'));
    assert.ok(page.includes("[style*='vh']"));
  });

  it('answers a click with the section only when Pick is asked for', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const run = await theme();
    assert.ok(!run(COMPOSED).includes("roughbook:'section'"));
    const page = run(`${COMPOSED}&roughbook-pick=1`);
    assert.match(page, /closest\('\[data-roughbook-section\]'\)/);
    assert.match(page, /postMessage\(\{roughbook:'section',key:/);
  });

  it('answers a missing section as a missing iteration, and a broken one as a broken one', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const run = await theme();
    const missing = run('rough_preview=home&roughbook-compose=hero:iteration-01,gone:iteration-01');
    assert.match(missing, /^STATUS 404\n/);
    assert.ok(missing.includes(failure('home').replace('/', '\\/')), missing);
    assert.ok(!missing.includes('Fixture words'));
    const broken = run('rough_preview=home&roughbook-compose=broken:iteration-01');
    assert.match(broken, /^STATUS 500\n/);
    assert.match(broken, /on purpose/);
    assert.ok(broken.includes(failure('home').replace('/', '\\/')), broken);
    const fixture = run('rough_preview=home&roughbook-compose=bad:iteration-01');
    assert.match(fixture, /^STATUS 500\n/);
    assert.match(fixture, /preview\.json is not a JSON object/);
  });

  it('refuses every name it cannot trust before it touches the filesystem', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const run = await theme();
    for (const query of [
      'rough_preview=../secret&roughbook-compose=hero:iteration-01',
      'rough_preview=home%0A&roughbook-compose=hero:iteration-01',
      'rough_preview=home%2Fhero&roughbook-compose=footer:iteration-01',
      'rough_preview=home&roughbook-compose=../../secret/hero:iteration-01',
      'rough_preview=home&roughbook-compose=hero:iteration-01%0A',
      'rough_preview=home&roughbook-compose=hero:..%2F..%2Fsecret',
      'rough_preview=home&roughbook-compose=hero',
      'rough_preview=home&roughbook-compose=',
      'rough_preview=home&roughbook-compose[]=hero:iteration-01',
      `rough_preview=home&roughbook-compose=${Array(31).fill('hero:iteration-01').join(',')}`
    ]) {
      const page = run(query);
      assert.match(page, /^STATUS 404\n/, query);
      assert.ok(!page.includes('Outside rough') && !page.includes('Fixture words'), query);
    }
    const script = run(
      `rough_preview=${encodeURIComponent('</script><script>alert(1)')}&roughbook-compose=hero:iteration-01`
    );
    assert.match(script, /^STATUS 404\n/);
    assert.ok(!script.includes('</script><script>alert'), script);
  });

  it('keeps the gates: the local environment and this machine only', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const run = await theme();
    for (const env of <Record<string, string>[]>[
      { ROUGHBOOK_ENV: 'production' },
      { ROUGHBOOK_ENV: 'development' },
      { ROUGHBOOK_HOST: '192.168.1.37:8888' }
    ]) {
      const page = run(COMPOSED, env);
      assert.match(page, /^STATUS 404\n/, JSON.stringify(env));
      assert.ok(!page.includes('Fixture words'));
      assert.ok(!page.includes('data-roughbook-variant'));
    }
  });

  it('leaves the single iteration as it was: no root, no marker, no script, its own ready', async t => {
    if (!hasPhp) return t.skip('PHP is not on the PATH');
    const run = await theme();
    const page = run('rough_preview=home/hero/iteration-01');
    assert.match(page, /^STATUS 200\n/);
    assert.match(page, /<section class="hero">Fixture words<\/section>/);
    assert.ok(!page.includes('data-roughbook-variant'));
    assert.ok(!page.includes('<roughbook-section'));
    assert.ok(!page.includes(LIVE_SCRIPT));
    assert.ok(page.includes('id: "home\\/hero\\/iteration-01"'));
    const gone = run('rough_preview=home/hero/iteration-02');
    assert.match(gone, /^STATUS 404\n/);
    assert.match(gone, /There is no iteration home\/hero\/iteration-02 in this repo\./);
  });
});
