// Laravel with Blade (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 5th in the launch order): live, on
// the app's own `php artisan serve`, through a route registered only in the local environment.
// F3 proved the setup on a fresh Laravel 13 app built by the setup run, and F7 ported a sketch
// into it; this recipe writes the same without an agent.
import type { EnvironmentOs, RepoEnvironment } from '../../environment/types.js';
import { currentOs, hostPlatform } from '../../launch/platform.js';
import type { RepoLink } from '../../repo/link.js';
import { planTailwindSource, read, type PrepChange } from '../../repo/plan.js';
import { withSnippet } from '../../repo/setup.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import { layOut, type AppCopy, type AppCopyInput } from '../fromApp.js';
import type { MapComponent } from '../../map/types.js';
import type { PreviewPlan, Recipe } from '../types.js';
import { discoverLaravel } from './discover.js';
import {
  ENTRY,
  FIXTURE,
  PREVIEW_ROUTE,
  ROUTE_FILE,
  WEB_ROUTES,
  WEB_SNIPPET,
  WRAPPER,
  isOurRoute,
  previewWrapper
} from './preview.js';

const PORT = 8000;
const PRODUCTION_PORT = 8001;

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const route = read(repo, ROUTE_FILE);
  if (route !== PREVIEW_ROUTE) {
    if (route !== null && !isOurRoute(route)) {
      manual.push(`${ROUTE_FILE} exists and was not written by Roughbook, so it was left alone.`);
    } else {
      changes.push({
        file: ROUTE_FILE,
        action: route === null ? 'create' : 'edit',
        summary:
          route === null ? 'Add the development-only preview route.' : 'Update the preview route.',
        after: PREVIEW_ROUTE
      });
    }
  }
  const web = read(repo, WEB_ROUTES);
  if (web === null) {
    manual.push(
      `${WEB_ROUTES} was not found: load ${ROUTE_FILE} from the app's web routes when app()->environment('local'), so previews have a route.`
    );
  } else {
    const after = withSnippet(web, WEB_SNIPPET);
    if (after !== web.replace(/\r\n/g, '\n')) {
      changes.push({
        file: WEB_ROUTES,
        action: 'edit',
        summary: 'Load the preview route in the local environment only.',
        after
      });
    }
  }
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: "Add the wrapper with the app's styles.",
      after: previewWrapper(repo)
    });
  }
  const tailwind = planTailwindSource(repo, ['resources/css']);
  if (tailwind && 'manual' in tailwind) manual.push(tailwind.manual);
  else if (tailwind) changes.push(tailwind);
  return { changes, manual, ignoredFromBuild: [], gitWanted: [`/${ROUTE_FILE}`] };
}

const SETUP_NOTES = `This repo is on Laravel with Blade, which has a recipe: roughbook init writes ${ROUTE_FILE}, a
route that renders rough/<page>/<component>/<iteration>/${ENTRY} through the app's own views (rough/ is
the view namespace rough::) with the iteration's ${FIXTURE} as its variables, inside ${WRAPPER} (the
app's @vite styles once they are built or served), answers 404 for a key with no iteration and 500 for
one that fails, posting the error message, and answers this machine only; and three lines at the end of
${WEB_ROUTES} that load it only when app()->environment('local'), so in production the route is never
registered and answers 404 (gate: runtime, proven by php artisan serve with APP_ENV=production). The
app starts with its own composer run dev (the server on 8000 and Vite, so the Tailwind classes a new
iteration uses are compiled; an app without that script names php artisan serve and npm run dev in
start). Blade recompiles a changed view on the next request, so the studio reloads the frame (reload:
studio). Where the app uses Tailwind 4, resources/css/app.css gains an @source line for rough/. Start from that
setup; change it only where this app needs it: its layout's fonts and head belong in the wrapper, a
preview that needs a signed-in user or seeded data reads the app's own configuration, and a session
or cache driver this machine's PHP cannot run (a database driver without pdo_sqlite) is the app's to
change in its .env. Keep recipe: laravel so the studio keeps the route up to date.`;

/** Blade's component names are kebab-case: `pricing-table.blade.php`, used as <x-pricing-table>. */
function bladeName(componentName: string): string {
  return (
    componentName
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'component'
  );
}

/** The fixture's keys a view can take as variables; null when the fixture is not JSON. */
function fixtureKeys(fixture: string | null): string[] | null {
  if (fixture === null) return [];
  try {
    const parsed = JSON.parse(fixture) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).filter(key => /^[A-Za-z_]\w*$/.test(key))
      : [];
  } catch {
    return null;
  }
}

/**
 * An iteration that renders one of the app's views or components as it is (decision 2 of the
 * brownfield plan), with the fixture's keys as the view's variables, as the preview route passes
 * them: a view included, a component given each key as an attribute, a Livewire component by name.
 */
export function bladePointer(
  component: MapComponent,
  input: { fixture: string | null }
): Record<string, string> | null {
  const [kind, name] = component.export.split(' ') as [string, string | undefined];
  const keys = fixtureKeys(input.fixture);
  if (!keys) return null;
  let body: string;
  if (kind === 'view' && name) body = `@include('${name}')`;
  else if (kind === 'livewire' && name) body = `@livewire('${name}')`;
  else if (kind.startsWith('x-')) {
    const attributes = keys.map(key => ` :${bladeName(key)}="$${key}"`).join('');
    body = `<x-dynamic-component component="${kind.slice(2)}"${attributes} />`;
  } else return null;
  return {
    [ENTRY]: `{{-- ${component.name}, as the app has it: a pointer, never a copy. --}}
${body}
`,
    ...(input.fixture !== null ? { [FIXTURE]: input.fixture } : {})
  };
}

/**
 * A fork's starting files (B3): a view the app includes is copied as the entry itself, which the
 * preview renders with the fixture's keys as its variables, as the include does. An anonymous
 * component is copied by its own name and included with the attributes and the empty slot the
 * pointer's tag gives it. A class or Livewire component is not copied: its PHP class would be
 * declared twice.
 */
export function bladeFromApp(component: MapComponent, input: AppCopyInput): AppCopy | null {
  const [kind, name] = component.export.split(' ') as [string, string | undefined];
  const source = component.files[0];
  if (component.files.length !== 1 || !source?.endsWith('.blade.php')) return null;
  const keys = fixtureKeys(input.fixture);
  const text = input.read(source);
  if (!keys || text === null) return null;
  const fixture: Record<string, string> =
    input.fixture !== null ? { [FIXTURE]: input.fixture } : {};
  if (kind === 'view' && name) {
    return { files: { [ENTRY]: text, ...fixture }, copies: { [source]: ENTRY } };
  }
  if (!kind.startsWith('x-')) return null;
  const copies = layOut([source], [ENTRY, FIXTURE]);
  const copy = copies[source]!;
  const view = `rough::${input.iterationDir
    .split('/')
    .slice(1)
    .join('.')}.${copy.replace(/\.blade\.php$/, '')}`;
  const attributes = keys.map(key => `'${bladeName(key)}' => $${key}`).join(', ');
  return {
    files: {
      [copy]: text,
      [ENTRY]: `{{-- ${component.name}, copied from ${source}: this iteration changes the copy, ${copy}. --}}
@include('${view}', ['attributes' => new \\Illuminate\\View\\ComponentAttributeBag([${attributes}]), 'slot' => new \\Illuminate\\Support\\HtmlString('')])
`,
      ...fixture
    },
    copies
  };
}

export const laravel: Recipe = {
  id: 'laravel',
  name: 'Laravel with Blade',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link, os?: EnvironmentOs): RepoEnvironment {
    // Production mode is a variable set before the command, which each OS's shell says its own way.
    const windows = (os ?? currentOs(hostPlatform())) === 'windows';
    const serve = `php artisan serve --port ${PRODUCTION_PORT}`;
    return {
      contract: 1,
      recipe: 'laravel',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'markup-css',
      mode: 'live',
      entry: ENTRY,
      sources: ['.blade.php', '.php', '.css', '.js', '.json', '.md', '.svg'],
      code: ['.php', '.js'],
      placement: { kind: 'rough' },
      wrapper: WRAPPER,
      runtime: { kind: 'local' },
      shell: windows ? 'powershell' : 'sh',
      // The app's own dev script (Laravel 11 and later): its server on 8000 and Vite, so the
      // Tailwind classes a new iteration uses are compiled as it is written.
      start: { command: 'composer run dev', url: `http://127.0.0.1:${PORT}` },
      preview: '/rough-preview/{key}',
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
      ignore: [
        'vendor',
        'node_modules',
        'storage',
        'bootstrap/cache',
        'public/build',
        'public/hot',
        '.git'
      ],
      overlays: [],
      fixture: FIXTURE,
      build: { command: null, output: [] },
      gate: 'runtime',
      production: {
        command: windows ? `$env:APP_ENV='production'; ${serve}` : `APP_ENV=production ${serve}`,
        url: `http://127.0.0.1:${PRODUCTION_PORT}`
      },
      checks: [],
      timeouts: { start: 60, preview: 60, build: 600 },
      promote: { dir: 'resources/views/components', extensions: ['.blade.php'] },
      assets: { dir: 'public/images', url: '/images', copy: false },
      copy: { kind: 'inline' },
      // A sketch is React, which Blade does not render: it is ported.
      sketches: 'port',
      terms: { page: 'view', component: 'component' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverLaravel,
  pointer: bladePointer,
  fromApp: bladeFromApp,
  setupFiles: () => [ROUTE_FILE],
  snippets: () => [{ file: WEB_ROUTES, text: WEB_SNIPPET }],
  agentRules:
    environment => `- \`${environment.entry}\` is a Blade view, rendered inside \`${WRAPPER}\` with the app's styles:
  markup with the app's Tailwind classes and Blade components (\`<x-…>\`), and no layout of its own.
  Its \`${FIXTURE}\` keys are its variables; give each a default with \`??\` so it renders without one.
- Include another file of the iteration with \`@include('rough::<page>.<component>.<iteration>.<file>')\`.
`,
  roughTsconfig: () => null,
  placeholder:
    () => `<div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; text-align: center; font-family: system-ui, sans-serif; color: #5b6274; background: #f6f8fa;">
    <p>${PLACEHOLDER_LINE}</p>
</div>
`,
  generatedFiles: [],
  importAllowed: () => [ROUTE_FILE],
  syncPreview: () => {},
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${bladeName(componentName)}.blade.php`,
  promoteExtensions: ['.blade.php'],
  promoteWords: {
    read: 'composer.json, resources/views/components and resources/css/app.css\n(the Tailwind theme)',
    rules: [
      '- Write an anonymous Blade component: its props with @props, and {{ $slot }} where\n  content goes.'
    ],
    usage: 'its tag, such as <x-hero />, and its props'
  },
  craft: familyCraft('markup-css'),
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `<section data-roughbook="doctor">
    <h1>${marker}</h1>
    <p>{{ $note ?? '' }}</p>
</section>
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `@php
    throw new \\RuntimeException('roughbook doctor: this iteration fails on purpose');
@endphp
`
    }
  }),
  scaffold: {
    tool: 'composer create-project',
    needs: ['php', 'composer', 'npm'],
    steps: name => [
      {
        kind: 'run',
        summary: 'Make a Laravel app with composer create-project',
        line: `composer create-project laravel/laravel:~13.0 ${name} --prefer-dist --no-interaction`,
        shell: 'none',
        // Composer is a batch file on Windows, which only a shell starts.
        shellWindows: 'cmd',
        in: 'parent'
      },
      {
        kind: 'run',
        summary: 'Install its front-end dependencies',
        line: 'npm install',
        shell: 'none',
        in: 'app'
      },
      {
        kind: 'run',
        summary: 'Build its styles, so previews have them',
        line: 'npm run build',
        shell: 'none',
        in: 'app'
      }
    ]
  }
};
