// Shopify themes: Liquid renders on Shopify's servers, from the files `shopify theme dev` uploads
// to a development theme, and only from the theme's own flat folders. So the studio writes each
// iteration of rough/ as a snippet, and a dispatcher snippet that renders the one asked for with
// its fixture's values; an alternate search template shows it at
// /search?q=<page>/<component>/<iteration>&view=rough-preview (search.terms is the one part of an
// address Liquid can read). Every one of these files is gitignored and rewritten by the studio:
//
//   snippets/rough-iteration--<page>--<component>--<iteration>.liquid   each iteration
//   snippets/rough-preview.liquid                                      the dispatcher
//   snippets/rough-preview-wrapper.liquid                              rough/preview.liquid, copied
//   templates/search.rough-preview.liquid                              the page that shows one
//
// The template renders nothing outside a development theme (theme.role), so a theme pushed with
// them by mistake shows its search page, never an iteration; and a theme deployed from git has
// none of them.
import fs from 'node:fs';
import path from 'node:path';
import { listFixtures, listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const ENTRY = 'index.liquid';
export const FIXTURE = 'preview.json';
export const WRAPPER = `${ROUGH_DIR}/preview.liquid`;
export const TEMPLATE = 'templates/search.rough-preview.liquid';
export const DISPATCH = 'snippets/rough-preview.liquid';
export const WRAPPER_SNIPPET = 'snippets/rough-preview-wrapper.liquid';
export const ITERATION_PREFIX = 'rough-iteration--';
const MARKER = 'Roughbook preview';

/** The snippet an iteration is written as: its key's parts joined by two hyphens. */
export function snippetName(key: string): string {
  return `${ITERATION_PREFIX}${key.split('/').join('--')}`;
}

export const PREVIEW_TEMPLATE = `{%- comment -%}
  ${MARKER} template: development only, not committed (see .gitignore). The Roughbook studio shows
  one iteration of ${ROUGH_DIR}/ at /search?q=<page>/<component>/<iteration>&view=rough-preview, inside the
  theme's layout, and only on a development theme (shopify theme dev): anywhere else it renders
  nothing of ${ROUGH_DIR}/. Written by roughbook init from the Shopify recipe, which rewrites it.
{%- endcomment -%}
{%- if theme.role == 'development' -%}
  {%- assign rough_key = search.terms -%}
  <div id="rough-preview">
    {%- capture rough_iteration -%}{%- render 'rough-preview', key: rough_key -%}{%- endcapture -%}
    {%- render 'rough-preview-wrapper', iteration: rough_iteration -%}
  </div>
  <script>
    (function () {
      var key = {{ rough_key | json }};
      var params = new URLSearchParams(window.location.search);
      // The variant the studio asks for in the address (rough/CONTRACT.md, point 2).
      var root = document.documentElement;
      var scheme = params.get('roughbook-scheme');
      if (scheme === 'dark') root.classList.add('dark');
      if (scheme === 'dark' || scheme === 'light') root.style.colorScheme = scheme;
      if (params.get('roughbook-dir') === 'rtl') root.dir = 'rtl';
      var lang = (params.get('roughbook-lang') || '').replace(/[^A-Za-z0-9-]/g, '');
      if (lang) root.lang = lang;
      if (params.get('roughbook-text') === 'large') root.style.fontSize = '125%';
      // Ready, or the error Liquid wrote in the iteration's place (rough/CONTRACT.md, point 3).
      var shown = document.getElementById('rough-preview');
      var missing = shown.querySelector('[data-rough-missing]');
      var text = shown.textContent || '';
      var failed = /Liquid (syntax )?error/i.exec(text);
      var message = missing
        ? missing.textContent
        : failed
          ? text.slice(failed.index, failed.index + 300).trim()
          : null;
      window.parent.postMessage(
        message ? { roughbook: 'error', id: key, message: message } : { roughbook: 'ready', id: key },
        '*'
      );
    })();
  </script>
{%- endif -%}
`;

export const PREVIEW_WRAPPER = `{%- comment -%}
  Wraps every iteration previewed through this theme, inside its layout (layout/theme.liquid, with
  its header and footer). Add what a section needs around it here; the iteration is {{ iteration }}.
{%- endcomment -%}
<div class="rough-preview">{{ iteration }}</div>
`;

/** A Liquid parameter's name, as `render` takes it. */
const PARAM = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * One fixture value as `render` takes it: numbers and booleans as they are, anything else captured
 * as raw text first (Liquid strings have no escapes), named after its parameter.
 */
function fixtureArgs(fixture: Record<string, unknown>): { captures: string[]; args: string[] } {
  const captures: string[] = [];
  const args: string[] = [];
  for (const [name, value] of Object.entries(fixture)) {
    if (!PARAM.test(name)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push(`${name}: ${String(value)}`);
      continue;
    }
    const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(
      /\{%-?\s*endraw/g,
      ''
    );
    const variable = `rough_${name.replace(/-/g, '_')}`;
    captures.push(
      `    {%- capture ${variable} -%}{%- raw -%}${text}{%- endraw -%}{%- endcapture -%}`
    );
    args.push(`${name}: ${variable}`);
  }
  return { captures, args };
}

/** The dispatcher: each iteration by its key, with its fixture's values. */
export function renderDispatch(
  entries: { key: string; fixture: Record<string, unknown> }[]
): string {
  const cases = entries.map(({ key, fixture }) => {
    const { captures, args } = fixtureArgs(fixture);
    return [
      `  {%- when '${key}' -%}`,
      ...captures,
      `    {%- render '${snippetName(key)}'${args.length ? `, ${args.join(', ')}` : ''} -%}`
    ].join('\n');
  });
  return `{%- comment -%}
  Generated by Roughbook from the iterations in ${ROUGH_DIR}/. Do not edit; it is never committed.
{%- endcomment -%}
{%- case key -%}
${cases.join('\n')}${cases.length ? '\n' : ''}  {%- else -%}
    <p data-rough-missing>There is no iteration {{ key | escape }} in this repo.</p>
{%- endcase -%}
`;
}

function readFixture(repo: string, key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(repo, ROUGH_DIR, ...key.split('/'), FIXTURE), 'utf8')
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeIfChanged(file: string, text: string): void {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * Brings the theme's generated files to rough/'s iterations: a snippet per iteration, the
 * dispatcher, and the wrapper; snippets of iterations rough/ no longer has are taken out. Nothing is
 * written in a repo the recipe has not prepared (no template).
 */
export function syncShopifyPreview(repo: string): void {
  if (!fs.existsSync(path.join(repo, ...TEMPLATE.split('/')))) return;
  const keys = listIterations(repo, ENTRY);
  const withFixture = new Set(listFixtures(repo, keys, FIXTURE));
  const snippets = path.join(repo, 'snippets');
  const wanted = new Set<string>();
  for (const key of keys) {
    const name = `${snippetName(key)}.liquid`;
    wanted.add(name);
    writeIfChanged(
      path.join(snippets, name),
      fs.readFileSync(path.join(repo, ROUGH_DIR, ...key.split('/'), ENTRY), 'utf8')
    );
  }
  if (fs.existsSync(snippets)) {
    for (const file of fs.readdirSync(snippets)) {
      if (file.startsWith(ITERATION_PREFIX) && !wanted.has(file)) {
        fs.rmSync(path.join(snippets, file), { force: true });
      }
    }
  }
  writeIfChanged(
    path.join(repo, ...DISPATCH.split('/')),
    renderDispatch(
      keys.map(key => ({ key, fixture: withFixture.has(key) ? readFixture(repo, key) : {} }))
    )
  );
  const wrapper = path.join(repo, ...WRAPPER.split('/'));
  writeIfChanged(
    path.join(repo, ...WRAPPER_SNIPPET.split('/')),
    fs.existsSync(wrapper) ? fs.readFileSync(wrapper, 'utf8') : PREVIEW_WRAPPER
  );
}

export function isOurTemplate(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
