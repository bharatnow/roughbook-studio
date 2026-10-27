// The in-page view's switch for WordPress block themes (B5b of ROUGHBOOK-BROWNFIELD-PLAN.md,
// decisions 41 and 42), part of the preview plugin for a mapped theme: in the local environment
// only, as the preview route, and for requests to this machine. WordPress renders the page as it always does;
// each adopted template part and pattern comes out inside its marker (`render_block`), and for
// `?roughbook-swap=<page>/<component>/<iteration>` the iteration's copy is rendered in its place by
// WordPress's own rendering: a pattern's copy through do_blocks as the pattern block does, a part's
// copy as the part's content, inside the wrapper WordPress draws for it. Blocks inside read the
// page's own data (its posts, its query, its site). Anywhere else the plugin adds nothing, so
// production answers the same with or without the parameters.
//
//   rough/preview-plugin.php        the plugin, with the switch after the preview (gitignored)
//   rough/preview-context.json      the adopted parts and patterns, and their iterations (generated)
//
// A part kept in the site's database (customised in the Site Editor) is marked but shows the
// database's copy, which a swap does not replace; a classic theme's parts are not marked.
import fs from 'node:fs';
import path from 'node:path';
import { hasMapFile, readMap } from '../../map/file.js';
import type { RepoMap } from '../../map/types.js';
import { ROUGH_DIR } from '../../repo/root.js';
import {
  CONTEXT_SENTINEL,
  MARKER_ELEMENT,
  MARKERS_PARAM,
  PICK_PARAM,
  SECTION_ATTRIBUTE,
  SWAP_PARAM,
  SWAPPED_ATTRIBUTE,
  contextSections
} from '../context.js';
import { ENTRY, PREVIEW_PLUGIN } from './preview.js';

export const CONTEXT_LIST = `${ROUGH_DIR}/preview-context.json`;

/**
 * What the plugin gains for a mapped theme, after the preview. The marker is display: contents, so
 * it draws no box; what it holds inherits the place in the layout the marker took (its block gap,
 * its content width), as it would have as the layout's own child.
 */
export const CONTEXT_BLOCK = `
/*
 * The in-page view (${CONTEXT_SENTINEL}): each adopted template part and pattern renders inside its marker,
 * and with ?${SWAP_PARAM}=<page>/<component>/<iteration> the iteration's copy renders in its place, through
 * WordPress's own rendering, with the page's own data. In the local environment only, as the preview
 * route answers, for this machine only; rough/preview-context.json lists what is adopted.
 */
( static function (): void {
	$rough = WP_CONTENT_DIR . '/rough';
	$list  = $rough . '/preview-context.json';
	if ( 'local' !== wp_get_environment_type() || ! is_file( $list ) || isset( $_GET['rough_preview'] ) ) {
		return;
	}
	$host = strtolower( preg_replace( '/:\\d+$/', '', (string) ( $_SERVER['HTTP_HOST'] ?? '' ) ) );
	if ( ! in_array( $host, array( 'localhost', '127.0.0.1', '[::1]' ), true ) ) {
		return;
	}
	$context = json_decode( (string) file_get_contents( $list ), true );
	if ( ! is_array( $context ) ) {
		return;
	}
	$swap    = isset( $_GET['${SWAP_PARAM}'] ) ? (string) wp_unslash( $_GET['${SWAP_PARAM}'] ) : '';
	$markers = '0' !== ( $_GET['${MARKERS_PARAM}'] ?? '' );
	$pick    = $markers && '1' === ( $_GET['${PICK_PARAM}'] ?? '' );
	$swapped = array();
	// The marker's key: the page whose template is rendering, among those the component is adopted on, else the first.
	$key_for = static function ( array $keys ): string {
		$current  = $GLOBALS['_wp_current_template_id'] ?? '';
		$template = is_string( $current ) && str_contains( $current, '//' ) ? substr( $current, strpos( $current, '//' ) + 2 ) : '';
		foreach ( $keys as $item ) {
			if ( ( $item['template'] ?? null ) === $template ) {
				return (string) $item['key'];
			}
		}
		return (string) $keys[0]['key'];
	};
	// The file the request swaps in for a section, or null.
	$shown_for = static function ( string $key ) use ( $swap, $context, $rough ): ?string {
		if ( '' === $swap || ! str_starts_with( $swap, $key . '/' ) || ! isset( $context['iterations'][ $swap ] ) ) {
			return null;
		}
		$file = $rough . '/' . $context['iterations'][ $swap ];
		return is_file( $file ) ? $file : null;
	};
	// A copy's markup: an HTML part as it is, a PHP file as it prints.
	$markup = static function ( string $file ): string {
		if ( str_ends_with( $file, '.html' ) ) {
			return (string) file_get_contents( $file );
		}
		$level = ob_get_level();
		ob_start();
		try {
			include $file;
		} catch ( \\Throwable $error ) {
			while ( ob_get_level() > $level ) {
				ob_end_clean();
			}
			throw $error;
		}
		return (string) ob_get_clean();
	};
	$mark = static function ( string $key, string $html, ?string $shown ) use ( $markers ): string {
		if ( ! $markers ) {
			return $html;
		}
		return '<${MARKER_ELEMENT} ${SECTION_ATTRIBUTE}="' . esc_attr( $key ) . '"'
			. ( null !== $shown ? ' ${SWAPPED_ATTRIBUTE}="' . esc_attr( $shown ) . '"' : '' )
			. ' style="display: contents">' . $html . '</${MARKER_ELEMENT}>';
	};
	// A pattern swapped: the copy rendered as the pattern block renders the theme's, inside its marker.
	$rendering = array();
	add_filter(
		'pre_render_block',
		static function ( $pre, $block ) use ( $context, $key_for, $shown_for, $markup, $mark, $swap, &$rendering ) {
			$slug = (string) ( $block['attrs']['slug'] ?? '' );
			if ( null !== $pre || 'core/pattern' !== ( $block['blockName'] ?? '' ) || empty( $context['patterns'][ $slug ] ) || isset( $rendering[ $slug ] ) ) {
				return $pre;
			}
			$key  = $key_for( $context['patterns'][ $slug ] );
			$file = $shown_for( $key );
			if ( null === $file ) {
				return $pre;
			}
			$rendering[ $slug ] = true;
			$html               = do_blocks( $markup( $file ) );
			unset( $rendering[ $slug ] );
			global $wp_embed;
			return $mark( $key, $wp_embed->autoembed( $html ), $swap );
		},
		10,
		2
	);
	// A part swapped: the copy is the part's content, which WordPress renders inside the part's own wrapper.
	add_filter(
		'get_block_file_template',
		static function ( $template, $id, $type ) use ( $context, $key_for, $shown_for, $markup, $swap, &$swapped ) {
			if ( 'wp_template_part' !== $type || ! is_object( $template ) || ! is_string( $id ) || ! str_contains( $id, '//' ) ) {
				return $template;
			}
			$slug = substr( $id, strpos( $id, '//' ) + 2 );
			if ( empty( $context['parts'][ $slug ] ) ) {
				return $template;
			}
			$key  = $key_for( $context['parts'][ $slug ] );
			$file = $shown_for( $key );
			if ( null !== $file ) {
				$template->content = $markup( $file );
				$swapped[ $key ]   = $swap;
			}
			return $template;
		},
		10,
		3
	);
	add_filter(
		'render_block',
		static function ( $html, $block ) use ( $context, $key_for, $mark, &$swapped ) {
			$slug = (string) ( $block['attrs']['slug'] ?? '' );
			$name = $block['blockName'] ?? '';
			$keys = 'core/template-part' === $name ? ( $context['parts'][ $slug ] ?? null ) : ( 'core/pattern' === $name ? ( $context['patterns'][ $slug ] ?? null ) : null );
			if ( empty( $keys ) ) {
				return $html;
			}
			$key = $key_for( $keys );
			return $mark( $key, (string) $html, $swapped[ $key ] ?? null );
		},
		10,
		2
	);
	if ( ! $markers ) {
		return;
	}
	add_action(
		'wp_head',
		static function (): void {
			echo '<style id="roughbook-sections">:where(${MARKER_ELEMENT}) > * { max-width: inherit; margin-left: inherit; margin-right: inherit; } :where(${MARKER_ELEMENT}) > :first-child { margin-block-start: inherit; } :where(${MARKER_ELEMENT}) > :last-child { margin-block-end: inherit; }</style>';
		}
	);
	if ( $pick ) {
		// With ?${PICK_PARAM}=1: a click names the section it fell in to the frame instead of following the page.
		add_action(
			'wp_footer',
			static function (): void {
				echo "<script>(function(){document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var s=e.target instanceof Element?e.target.closest('[${SECTION_ATTRIBUTE}]'):null;if(s)window.parent.postMessage({roughbook:'section',key:s.getAttribute('${SECTION_ATTRIBUTE}')},'*');},true);})();</script>";
			}
		);
	}
} )();
`;

/** The preview plugin as the recipe writes it: for a mapped theme, with the switch after the preview. */
export function pluginFor(repo: string): string {
  return hasMapFile(repo) ? `${PREVIEW_PLUGIN}${CONTEXT_BLOCK}` : PREVIEW_PLUGIN;
}

/** The template a page is rendered by, by its slug: `templates/front-page.html` is front-page. */
function templateOf(map: RepoMap, slug: string): string | null {
  const file = map.pages.find(page => page.slug === slug)?.files[0];
  return file && /^(templates|block-templates)\/[^/]+\.html$/.test(file)
    ? path.posix.basename(file, '.html')
    : null;
}

/** rough/preview-context.json, as the adopted parts and patterns are now. */
export function renderContextList(repo: string): string {
  let map: RepoMap | undefined;
  try {
    map = readMap(repo)?.map;
  } catch {
    map = undefined;
  }
  const parts: Record<string, { key: string; template: string | null }[]> = {};
  const patterns: Record<string, { key: string; template: string | null }[]> = {};
  const iterations: Record<string, string> = {};
  if (map) {
    for (const section of contextSections(repo, ENTRY, map)) {
      const [kind, slug] = section.source.export.split(' ') as [string, string | undefined];
      const file = section.source.files[0] ?? '';
      const into =
        kind === 'part' && slug && file.endsWith('.html')
          ? parts
          : kind === 'pattern' && slug
            ? patterns
            : null;
      if (!into || !slug) continue;
      (into[slug] ??= []).push({ key: section.key, template: templateOf(map, section.page) });
      for (const iteration of section.iterations) {
        iterations[iteration.key] = iteration.shown.slice(`${ROUGH_DIR}/`.length);
      }
    }
  }
  return `${JSON.stringify({ parts, patterns, iterations }, null, 2)}\n`;
}

/** Rewrites rough/preview-context.json when the adopted parts and patterns changed. Returns whether it wrote. */
export function writeContextList(repo: string): boolean {
  const file = path.join(repo, ...CONTEXT_LIST.split('/'));
  const text = renderContextList(repo);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}
