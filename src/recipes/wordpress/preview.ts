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
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../../repo/root.js';

export const PLUGIN_FILE = `${ROUGH_DIR}/preview-plugin.php`;
export const OVERRIDE_FILE = '.wp-env.override.json';
export const PRODUCTION_CONFIG = '.wp-env.rough-production.json';
export const WRAPPER = `${ROUGH_DIR}/preview.php`;
export const ENTRY = 'index.php';
export const FIXTURE = 'preview.json';
export const PORT = 8888;
export const PRODUCTION_PORT = 8891;
const MARKER = 'Roughbook preview';

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
		// Loopback only: a site reachable on the network shows nothing from ${ROUGH_DIR}/ (contract point 5).
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
 */
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
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Whether a wp-env file is the recipe's own: it maps the preview plugin. */
export function isOurConfig(text: string | null): boolean {
  return Boolean(text?.includes(PLUGIN_FILE));
}

export function isOurPlugin(text: string | null): boolean {
  return Boolean(text?.includes(`Plugin Name: ${MARKER}`));
}
