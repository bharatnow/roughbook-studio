// WordPress themes, run by wp-env in Docker: a must-use plugin, mapped into WordPress by the
// repo's own .wp-env.override.json (local overrides, never committed), shows one iteration of the
// theme's rough/ folder at /?rough_preview=<page>/<component>/<iteration>, only when WordPress runs
// in the local environment. Four pieces:
//
//   rough/preview-plugin.php          the plugin (development only, gitignored)
//   .wp-env.override.json             maps it and rough/ into WordPress, sets the local environment
//   .wp-env.rough-production.json     the same WordPress in production mode, for the runtime gate
//   rough/preview.php                 wraps iterations in the theme's styles (committed)
//
// Nothing of it is in the theme: a production site has neither the plugin nor its mapping, and
// with WP_ENVIRONMENT_TYPE set to production the plugin answers its address with 404 anyway.
//
// rough/ itself is in the theme's folder, committed, so a deploy of the theme puts it on the live
// site, where the web server may be asked for its files directly. There it is inert: every PHP
// file starts with GUARD, which stops it outside WordPress (the plugin includes them inside), and
// rough/.htaccess refuses the folder on Apache and LiteSpeed. A release zip leaves it out
// (.distignore), and doctor's gate asks the theme's copy of it for the sample's own files.
import fs from 'node:fs';
import path from 'node:path';
import { covers } from '../../repo/plan.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const PLUGIN_FILE = `${ROUGH_DIR}/preview-plugin.php`;
export const OVERRIDE_FILE = '.wp-env.override.json';
export const PRODUCTION_CONFIG = '.wp-env.rough-production.json';
export const WRAPPER = `${ROUGH_DIR}/preview.php`;
export const DENY_FILE = `${ROUGH_DIR}/.htaccess`;
export const RELEASE_LIST = '.distignore';
export const ENTRY = 'index.php';
export const FIXTURE = 'preview.json';
export const PORT = 8888;
export const PRODUCTION_PORT = 8891;
const MARKER = 'Roughbook preview';

/** The first statement of every PHP file in rough/: outside WordPress, the file does nothing. */
export const GUARD = "defined( 'ABSPATH' ) || exit;";

/** rough/.htaccess: Apache 2.4 and 2.2, and LiteSpeed, refuse every file in rough/. */
export const DENY = `# Written by Roughbook. rough/ holds design iterations, never part of the live site: a web
# server that reads this file refuses everything in the folder.
<IfModule mod_authz_core.c>
	Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
	Order allow,deny
	Deny from all
</IfModule>
`;

export function isOurDeny(text: string | null): boolean {
  return Boolean(text?.startsWith('# Written by Roughbook.'));
}

/** A theme's .distignore with rough/ in it, in the file's own line endings; null when it is. */
export function withRoughReleased(text: string): string | null {
  if (text.split(/\r?\n/).some(line => line.trim() && covers(line, ROUGH_DIR))) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.length && !/\r?\n$/.test(text) ? `${text}${eol}` : text;
  return `${body}${ROUGH_DIR}${eol}`;
}

/** Where wp-env puts the plugin and rough/ inside WordPress. */
export const MAPPINGS = {
  'wp-content/mu-plugins/rough-preview.php': `./${PLUGIN_FILE}`,
  'wp-content/rough': `./${ROUGH_DIR}`
};

export const PREVIEW_PLUGIN = `<?php
/**
 * Plugin Name: ${MARKER}
 * Description: Development only, not committed (see .gitignore). wp-env maps it into wp-content/mu-plugins/ (${OVERRIDE_FILE}), with ${ROUGH_DIR}/ at wp-content/rough/. It shows one iteration at /?rough_preview=<page>/<component>/<iteration>, only when WordPress runs in the local environment. Written by roughbook init from the WordPress recipe, which rewrites it (roughbook setup --upgrade).
 */
${GUARD}

/** A page that says what went wrong, and posts it to the Roughbook studio (rough/CONTRACT.md, point 3). */
function roughbook_preview_failed( int $status, string $key, string $message ): void {
	status_header( $status );
	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );
	echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Roughbook preview</title></head><body>';
	echo '<pre style="padding: 2rem; white-space: pre-wrap; font-family: ui-monospace, monospace;">' . esc_html( $message ) . '</pre>';
	echo "<script>window.parent.postMessage({ roughbook: 'error', id: " . wp_json_encode( $key ) . ', message: ' . wp_json_encode( $message ) . " }, '*');</script>";
	echo '</body></html>';
	exit;
}

add_action(
	'template_redirect',
	static function (): void {
		if ( ! isset( $_GET['rough_preview'] ) ) {
			return;
		}
		$key = (string) wp_unslash( $_GET['rough_preview'] );
		// Development only (the runtime gate): anywhere but the local environment, there is no preview.
		if ( 'local' !== wp_get_environment_type() ) {
			roughbook_preview_failed( 404, $key, 'Not found.' );
		}
		// Asked by another name than this machine's, it shows nothing from ${ROUGH_DIR}/ (contract point 5). A
		// request can name localhost, and wp-env serves every interface: this holds against a browser only.
		$host = strtolower( preg_replace( '/:\\d+$/', '', (string) ( $_SERVER['HTTP_HOST'] ?? '' ) ) );
		if ( ! in_array( $host, array( 'localhost', '127.0.0.1', '[::1]' ), true ) ) {
			roughbook_preview_failed( 404, $key, 'The preview answers this machine only.' );
		}
		$rough  = WP_CONTENT_DIR . '/rough';
		$folder = $rough . '/' . $key;
		if ( ! preg_match( '#^[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*/iteration-\\d{2,}$#', $key ) || ! is_file( $folder . '/${ENTRY}' ) ) {
			roughbook_preview_failed( 404, $key, "There is no iteration {$key} in this repo." );
		}
		$fixture = array();
		if ( is_file( $folder . '/${FIXTURE}' ) ) {
			$fixture = json_decode( (string) file_get_contents( $folder . '/${FIXTURE}' ), true );
			if ( ! is_array( $fixture ) ) {
				roughbook_preview_failed( 500, $key, '${FIXTURE} is not a JSON object.' );
			}
		}
		// The iteration first, then the page around it, as a block theme's template is: blocks it
		// renders put their styles in the head.
		$level = ob_get_level();
		try {
			$iteration = ( static function ( string $roughbook_file, array $fixture ): string {
				extract( $fixture, EXTR_SKIP );
				ob_start();
				include $roughbook_file;
				return (string) ob_get_clean();
			} )( $folder . '/${ENTRY}', $fixture );
			$iteration = do_blocks( $iteration );
		} catch ( \\Throwable $error ) {
			while ( ob_get_level() > $level ) {
				ob_end_clean();
			}
			roughbook_preview_failed( 500, $key, $error->getMessage() );
		}
		// The variant the studio asks for in the address (contract point 2).
		$variant = array(
			'scheme' => ( $_GET['roughbook-scheme'] ?? '' ) === 'dark' ? 'dark' : 'light',
			'dir'    => ( $_GET['roughbook-dir'] ?? '' ) === 'rtl' ? 'rtl' : 'ltr',
			'lang'   => preg_replace( '/[^A-Za-z0-9-]/', '', (string) ( $_GET['roughbook-lang'] ?? '' ) ),
			'large'  => ( $_GET['roughbook-text'] ?? '' ) === 'large',
		);
		status_header( 200 );
		nocache_headers();
		include $rough . '/preview.php';
		exit;
	},
	0
);
`;

export const PREVIEW_WRAPPER = `<?php
/**
 * Wraps every iteration previewed through this theme: the theme's styles (wp_head), the variant the
 * studio asks for, and the ready message Roughbook waits for (rough/CONTRACT.md, points 2 and 3).
 * Make it the theme's own: its header and footer template parts around the iteration, if its pages
 * have them (block_template_part( 'header' )).
 *
 * In scope: $iteration (the iteration, rendered), $key, and $variant (scheme, dir, lang, large).
 * Its first statement keeps it inert where a live site's web server is asked for it directly.
 */
${GUARD}
?><!DOCTYPE html>
<html lang="<?php echo esc_attr( $variant['lang'] ? $variant['lang'] : get_bloginfo( 'language' ) ); ?>" dir="<?php echo esc_attr( $variant['dir'] ); ?>" class="<?php echo 'dark' === $variant['scheme'] ? 'dark' : ''; ?>" style="color-scheme: <?php echo esc_attr( $variant['scheme'] ); ?>;<?php echo $variant['large'] ? ' font-size: 125%;' : ''; ?>">
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<?php echo $iteration; // phpcs:ignore WordPress.Security.EscapeOutput ?>
<?php wp_footer(); ?>
<script>
	window.parent.postMessage({ roughbook: 'ready', id: <?php echo wp_json_encode( $key ); ?> }, '*');
</script>
</body>
</html>
`;

/** The development environment's overrides: the plugin and rough/ mapped, the local environment. */
export const OVERRIDE = `${JSON.stringify(
  { config: { WP_ENVIRONMENT_TYPE: 'local' }, mappings: MAPPINGS },
  null,
  2
)}\n`;

/** Whether the repo says itself what its WordPress runs, in a .wp-env.json of its own. */
function hasOwnConfig(repo: string): boolean {
  return fs.existsSync(path.join(repo, '.wp-env.json'));
}

/** wp-env's command that makes the repo's theme the active one, after each start. */
function activateTheme(repo: string, config: string | null): string {
  const folder = path.basename(path.resolve(repo));
  const name = /^[\w.-]+$/.test(folder) ? folder : `'${folder.replace(/'/g, `'\\''`)}'`;
  return `npx wp-env run cli${config ? ` --config ${config}` : ''} wp theme activate ${name}`;
}

/**
 * The overrides as the recipe writes them for this repo. With no .wp-env.json, wp-env would take
 * the folder for the theme, but any config file stops it guessing, the override among them: so the
 * override says it, and makes the theme the active one after each start, as the previews (the
 * theme's styles) and the in-page view (its templates) need. A repo with its own .wp-env.json
 * keeps its themes and the theme it chose.
 */
export function overrideFor(repo: string): string {
  if (hasOwnConfig(repo)) return OVERRIDE;
  return `${JSON.stringify(
    {
      config: { WP_ENVIRONMENT_TYPE: 'local' },
      mappings: MAPPINGS,
      themes: ['.'],
      lifecycleScripts: { afterStart: activateTheme(repo, null) }
    },
    null,
    2
  )}\n`;
}

type WpEnvConfig = Record<string, unknown> & {
  config?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
};

/**
 * The same WordPress as the repo's own .wp-env.json describes (its core, PHP, plugins and themes),
 * in production mode on a port of its own, with the plugin mapped: the runtime gate asks it.
 */
export function productionConfig(repo: string): string {
  let own: WpEnvConfig = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(repo, '.wp-env.json'), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) own = parsed as WpEnvConfig;
  } catch {
    // No .wp-env.json: wp-env's defaults, with this folder as the theme.
  }
  const config: WpEnvConfig = {};
  for (const field of ['core', 'phpVersion', 'plugins', 'themes', 'multisite']) {
    if (own[field] !== undefined) config[field] = own[field];
  }
  if (config.themes === undefined) config.themes = ['.'];
  config.port = PRODUCTION_PORT;
  // wp-env starts a tests site beside it, on 8889 unless told: the development one has that port.
  config.testsPort = PRODUCTION_PORT + 1;
  config.config = { ...(own.config ?? {}), WP_ENVIRONMENT_TYPE: 'production', WP_DEBUG: false };
  config.mappings = { ...(own.mappings ?? {}), ...MAPPINGS };
  // The same theme active as in development, so the gate asks the theme's own pages.
  if (!hasOwnConfig(repo)) {
    config.lifecycleScripts = { afterStart: activateTheme(repo, PRODUCTION_CONFIG) };
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The theme's folder under wp-content/themes/ in wp-env's WordPress, which names a local theme by
 * its folder: the repo's, when the repo is the theme (wp-env's default, or "." in its themes).
 * Null when .wp-env.json names other themes only.
 */
export function themeFolder(repo: string): string | null {
  let themes: unknown;
  try {
    themes = (JSON.parse(fs.readFileSync(path.join(repo, '.wp-env.json'), 'utf8')) as WpEnvConfig)
      .themes;
  } catch {
    themes = undefined;
  }
  const isRepo = (entry: unknown) =>
    typeof entry === 'string' && path.resolve(repo, entry) === path.resolve(repo);
  if (Array.isArray(themes) && !themes.some(isRepo)) return null;
  return path.basename(path.resolve(repo));
}

/** Whether a wp-env file is the recipe's own: it maps the preview plugin. */
export function isOurConfig(text: string | null): boolean {
  return Boolean(text?.includes(PLUGIN_FILE));
}

export function isOurPlugin(text: string | null): boolean {
  return Boolean(text?.includes(`Plugin Name: ${MARKER}`));
}
