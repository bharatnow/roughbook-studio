// WordPress themes, classic and block (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 3rd in the launch
// order): live, on WordPress run by wp-env in Docker, through a must-use plugin mapped in for
// development only. The runtime gate is the same WordPress in production mode, where the plugin
// answers its address with 404.
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR } from '../../repo/root.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  DENY,
  DENY_FILE,
  ENTRY,
  FIXTURE,
  GUARD,
  OVERRIDE,
  OVERRIDE_FILE,
  PLUGIN_FILE,
  PORT,
  PREVIEW_PLUGIN,
  PREVIEW_WRAPPER,
  PRODUCTION_CONFIG,
  PRODUCTION_PORT,
  RELEASE_LIST,
  WRAPPER,
  isOurConfig,
  isOurDeny,
  isOurPlugin,
  productionConfig,
  themeFolder,
  withRoughReleased
} from './preview.js';

/** The wp-env release the scaffold pins; the conformance fixture pins the same. */
const WP_ENV_VERSION = '11.17.0';

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const own: { file: string; content: string; summary: string; ours: (text: string) => boolean }[] =
    [
      {
        file: PLUGIN_FILE,
        content: PREVIEW_PLUGIN,
        summary: 'Add the development-only preview plugin.',
        ours: isOurPlugin
      },
      {
        file: OVERRIDE_FILE,
        content: OVERRIDE,
        summary: "Map the preview plugin into wp-env's WordPress, in the local environment.",
        ours: isOurConfig
      },
      {
        file: PRODUCTION_CONFIG,
        content: productionConfig(repo),
        summary: 'Describe the same WordPress in production mode, for the runtime gate.',
        ours: isOurConfig
      },
      {
        file: DENY_FILE,
        content: DENY,
        summary:
          'Refuse rough/ on a live site that reads .htaccess: it ships in the theme’s folder.',
        ours: isOurDeny
      }
    ];
  for (const item of own) {
    const current = read(repo, item.file);
    if (current === item.content) continue;
    if (current !== null && !item.ours(current)) {
      manual.push(
        item.file === OVERRIDE_FILE
          ? `${OVERRIDE_FILE} is your own, so it was left alone: add to its "mappings" "wp-content/mu-plugins/rough-preview.php": "./${PLUGIN_FILE}" and "wp-content/rough": "./${ROUGH_DIR}", and to its "config" "WP_ENVIRONMENT_TYPE": "local".`
          : item.file === DENY_FILE
            ? `${DENY_FILE} is your own, so it was left alone: it must refuse every file in ${ROUGH_DIR}/ (Require all denied).`
            : `${item.file} exists and was not written by Roughbook, so it was left alone.`
      );
      continue;
    }
    changes.push({
      file: item.file,
      action: current === null ? 'create' : 'edit',
      summary: current === null ? item.summary : `Update ${item.file}.`,
      after: item.content
    });
  }
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: "Add the wrapper with the theme's styles.",
      after: PREVIEW_WRAPPER
    });
  }
  // A theme's own release list leaves rough/ out of the zip; a theme without one gets none, since
  // a new .distignore would change what its release takes.
  const release = read(repo, RELEASE_LIST);
  const released = release === null ? null : withRoughReleased(release);
  if (released !== null) {
    changes.push({
      file: RELEASE_LIST,
      action: 'edit',
      summary: `Leave ${ROUGH_DIR}/ out of the theme's release zip.`,
      after: released
    });
  }
  if (read(repo, 'package.json') === null || !/@wordpress\/env/.test(read(repo, 'package.json')!)) {
    manual.push(
      `This recipe runs WordPress with wp-env in Docker: add @wordpress/env as a development dependency (npm install --save-dev @wordpress/env@${WP_ENV_VERSION}), or run roughbook setup to fit the WordPress you already run.`
    );
  }
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [`/${OVERRIDE_FILE}`, `/${PRODUCTION_CONFIG}`, `/${PLUGIN_FILE}`]
  };
}

const SETUP_NOTES = `This repo is a WordPress theme, which has a recipe: WordPress runs in Docker through wp-env (npx
wp-env start, at http://localhost:${PORT}), and roughbook init writes ${PLUGIN_FILE}, a must-use plugin that
${OVERRIDE_FILE} (wp-env's local overrides, never committed) maps into WordPress with rough/ beside it at
wp-content/rough, setting the local environment. At /?rough_preview=<page>/<component>/<iteration> it renders
the iteration's ${ENTRY} (PHP and block markup, run through do_blocks) with its ${FIXTURE} keys as
variables, inside ${WRAPPER} (wp_head and wp_footer, so the theme's styles and theme.json presets apply),
answers 404 for a key with no iteration and 500 for one that fails, posting the error message, and
refuses a request whose Host is not this machine's name (wp-env serves every interface, and a request can
name localhost, so that holds against a browser only); anywhere but the local environment it answers 404. ${PRODUCTION_CONFIG} is the
same WordPress in production mode on port ${PRODUCTION_PORT} (gate: runtime, started with npx wp-env start
--config ${PRODUCTION_CONFIG}; stop it after with npx wp-env stop --config ${PRODUCTION_CONFIG}). rough/ is in
the theme's folder, so a deploy can put it on the live site, where it stays inert: every PHP file in it starts
with <?php ${GUARD} ?>, ${DENY_FILE} refuses the folder on Apache, a .distignore leaves it out of the release
zip, and doctor's gate asks the production WordPress for the sample's own files there. PHP reads a changed iteration on
the next request, so the studio reloads the frame (reload: studio). Start from that setup; change it only
where this theme needs it: its header and footer template parts belong in the wrapper, and a theme that
runs on another local WordPress (Local, ddev, Lando) needs the plugin copied into that site's mu-plugins
and rough/ where it finds it. Keep recipe: wordpress so the studio keeps the plugin up to date.`;

/** A folder name as a theme's name: `harbor-theme` is Harbor Theme. */
function themeName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** A minimal block theme run by wp-env: what roughbook new writes for a theme from nothing. */
export function themeFiles(name: string): Record<string, string> {
  const title = themeName(name);
  return {
    'style.css': `/*
Theme Name: ${title}
Text Domain: ${name}
Version: 0.1.0
Requires at least: 6.6
Requires PHP: 8.1
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Description: A block theme, started by roughbook new.
*/
`,
    'theme.json': `${JSON.stringify(
      {
        $schema: 'https://schemas.wp.org/trunk/theme.json',
        version: 3,
        settings: {
          appearanceTools: true,
          layout: { contentSize: '720px', wideSize: '1200px' },
          color: {
            palette: [
              { slug: 'base', name: 'Base', color: '#ffffff' },
              { slug: 'contrast', name: 'Contrast', color: '#111111' },
              { slug: 'accent', name: 'Accent', color: '#1f5c45' }
            ]
          },
          typography: {
            fontFamilies: [
              {
                slug: 'system',
                name: 'System',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
              }
            ]
          }
        },
        styles: {
          color: {
            background: 'var(--wp--preset--color--base)',
            text: 'var(--wp--preset--color--contrast)'
          },
          typography: { fontFamily: 'var(--wp--preset--font-family--system)' }
        },
        templateParts: [
          { name: 'header', title: 'Header', area: 'header' },
          { name: 'footer', title: 'Footer', area: 'footer' }
        ]
      },
      null,
      2
    )}\n`,
    'templates/index.html': `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group"><!-- wp:query {"queryId":0,"query":{"perPage":10,"postType":"post","inherit":true}} -->
<div class="wp-block-query"><!-- wp:post-template -->
<!-- wp:post-title {"isLink":true} /-->

<!-- wp:post-excerpt /-->
<!-- /wp:post-template --></div>
<!-- /wp:query --></main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
`,
    'parts/header.html': `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:site-title /--></div>
<!-- /wp:group -->
`,
    'parts/footer.html': `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:paragraph -->
<p>${title}</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->
`,
    'package.json': `${JSON.stringify(
      {
        name,
        private: true,
        description: `${title}, a WordPress block theme.`,
        scripts: { start: 'wp-env start', stop: 'wp-env stop' },
        devDependencies: { '@wordpress/env': WP_ENV_VERSION }
      },
      null,
      2
    )}\n`,
    '.gitignore': 'node_modules/\n',
    // What a release zip of the theme leaves out (wp dist-archive and most release scripts read it).
    '.distignore': [
      '.git',
      '.gitignore',
      '.distignore',
      'node_modules',
      'package.json',
      'package-lock.json',
      'rough',
      '.wp-env*.json',
      ''
    ].join('\n'),
    'README.md': `# ${title}

A WordPress block theme. \`npm install\`, then \`npm start\` runs WordPress with this theme in
Docker at http://localhost:${PORT} (wp-env; Docker must be running). Designs live in rough/.
`
  };
}

export const wordpress: Recipe = {
  id: 'wordpress',
  name: 'WordPress themes',
  // 2: rough/ is inert on a live site (the guard, rough/.htaccess, .distignore).
  version: 2,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'wordpress',
      recipeVersion: 2,
      stack: link?.stack ?? [],
      family: 'markup-css',
      mode: 'live',
      entry: ENTRY,
      sources: ['.php', '.html', '.css', '.js', '.json', '.md', '.svg'],
      code: ['.php', '.js'],
      placement: { kind: 'rough' },
      wrapper: WRAPPER,
      runtime: { kind: 'container', url: `http://localhost:${PORT}` },
      shell: 'none',
      start: { command: 'npx wp-env start', url: `http://localhost:${PORT}` },
      preview: '/?rough_preview={key}',
      snapshot: null,
      device: null,
      viewports: [
        { name: 'desktop', width: 1440, height: 900, mobile: false },
        { name: 'mobile', width: 390, height: 844, mobile: true }
      ],
      variants: ['light'],
      reload: 'studio',
      stylesheets: [],
      public: null,
      ignore: ['node_modules', 'vendor', '.git'],
      overlays: ['#wpadminbar'],
      fixture: FIXTURE,
      build: { command: null, output: [] },
      gate: 'runtime',
      production: {
        command: `npx wp-env start --config ${PRODUCTION_CONFIG}`,
        url: `http://localhost:${PRODUCTION_PORT}`
      },
      checks: [],
      // A first start pulls and builds WordPress's images, which took more than ten minutes here.
      timeouts: { start: 1200, preview: 60, build: 600 },
      promote: { dir: 'patterns', extensions: ['.php', '.html'] },
      assets: { dir: 'assets/images', url: null, copy: false },
      copy: { kind: 'inline' },
      // A sketch is React, which a theme does not render: it is ported.
      sketches: 'port',
      terms: { page: 'template', component: 'pattern' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  // The override file only when it is the recipe's own as written, never one of the designer's.
  setupFiles: repo => [
    ...(read(repo, OVERRIDE_FILE)?.replace(/\r\n/g, '\n') === OVERRIDE ||
    read(repo, OVERRIDE_FILE) === null
      ? [OVERRIDE_FILE]
      : []),
    PRODUCTION_CONFIG
  ],
  agentRules:
    environment => `- \`${environment.entry}\` is a part of a page, rendered inside \`${WRAPPER}\` with the theme's styles:
  block markup (\`<!-- wp:group -->\` and the core blocks) where blocks can hold the design, so it can
  become a pattern, with the theme.json presets (\`has-accent-color\`, \`var(--wp--preset--…)\`);
  plain HTML where they cannot. Its \`${FIXTURE}\` keys are PHP variables; escape each as you print it
  (\`esc_html( $heading ?? '' )\`).
- Start every PHP file you write with \`<?php ${GUARD} ?>\` on its first line. rough/ ships in the
  theme's folder, and the line keeps a file inert where a live site's web server runs it directly.
`,
  roughTsconfig: () => null,
  placeholder: () => `<?php ${GUARD} ?>
<div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; text-align: center; font-family: system-ui, sans-serif; color: #5b6274; background: #f6f8fa;">
	<p>${PLACEHOLDER_LINE}</p>
</div>
`,
  generatedFiles: [],
  importAllowed: () => [],
  syncPreview: () => {},
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${componentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.php`,
  promoteExtensions: ['.php', '.html'],
  promoteWords: {
    read: "style.css, theme.json (its presets) and the theme's patterns/ and\nparts/",
    rules: [
      "- A pattern starts with its header comment: Title, Slug (the theme's text domain, a slash and\n  the name) and Categories; its markup is block markup.",
      "- Use an asset as get_theme_file_uri( 'assets/images/<file>' )."
    ],
    usage: 'its slug, as a block editor inserts it'
  },
  craft: familyCraft('markup-css'),
  deployedAt: repo => {
    const theme = themeFolder(repo);
    return {
      paths: theme ? [`/wp-content/themes/${theme}`] : [],
      fix: `Keep ${ROUGH_DIR}/ off the live site: start every PHP file in it with <?php ${GUARD} ?>, keep ${DENY_FILE} (roughbook setup --upgrade writes it) for Apache, refuse the folder in nginx (location ~ /${ROUGH_DIR}/ { deny all; }), or deploy the theme without it (${RELEASE_LIST}).`
    };
  },
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `<?php ${GUARD} ?>
<section data-roughbook="doctor">
	<p>${marker}</p>
	<p><?php echo esc_html( $note ?? '' ); ?></p>
</section>
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `<?php
${GUARD}
throw new RuntimeException( 'roughbook doctor: this iteration fails on purpose' );
`
    }
  }),
  scaffold: {
    tool: 'a block theme with wp-env',
    needs: ['npm', 'docker'],
    steps: name => [
      {
        kind: 'write',
        summary: 'Write a block theme, run in Docker by wp-env',
        files: themeFiles(name)
      },
      {
        kind: 'run',
        summary: 'Install wp-env',
        line: 'npm install',
        shell: 'none',
        in: 'app'
      }
    ]
  }
};
