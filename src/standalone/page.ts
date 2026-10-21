// The page the standalone server wraps an iteration in: the site's stylesheets, the fixture, the
// variant on its root, and the contract's messages (rough/CONTRACT.md, point 3), the same for every
// kind of iteration. A failed or missing one gets a page of its own that posts the error.
import { VARIANT_PARAMS } from '../environment/variants.js';

/** Where an HTML wrapper puts the iteration. */
export const ITERATION_STAND_IN = '{{roughbook:iteration}}';

/** The page's own folder on the site, beside an iteration's files: the fixture, a bundle. */
export const FILES_DIR = '__roughbook';

/** What a variant's query parameters ask of the page's root (rough/CONTRACT.md, point 2). */
export type PageVariant = {
  scheme: 'dark' | null;
  dir: 'ltr' | 'rtl' | null;
  lang: string | null;
  text: 'large' | null;
  /** A word of the setup's own. */
  word: string | null;
};

/** A value as JavaScript inside an HTML script element. */
function json(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function variantOf(query: URLSearchParams): PageVariant {
  const dir = query.get(VARIANT_PARAMS.dir);
  const lang = query.get(VARIANT_PARAMS.lang);
  const word = query.get(VARIANT_PARAMS.word);
  return {
    scheme: query.get(VARIANT_PARAMS.scheme) === 'dark' ? 'dark' : null,
    dir: dir === 'rtl' || dir === 'ltr' ? dir : null,
    lang: lang && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(lang) ? lang : null,
    text: query.get(VARIANT_PARAMS.text) === 'large' ? 'large' : null,
    word: word && /^[a-z][a-z0-9-]*$/.test(word) ? word : null
  };
}

/** The variant as attributes of the page's root, with a space before each; empty for the default. */
function rootAttributes(variant: PageVariant): string {
  const attributes: string[] = [];
  const style: string[] = [];
  if (variant.lang) attributes.push(`lang="${escape(variant.lang)}"`);
  if (variant.dir) attributes.push(`dir="${variant.dir}"`);
  if (variant.scheme === 'dark') {
    attributes.push('class="dark"');
    style.push('color-scheme: dark');
  }
  if (variant.text === 'large') {
    attributes.push('data-roughbook-text="large"');
    style.push('font-size: 125%');
  }
  if (variant.word) attributes.push(`data-roughbook-variant="${escape(variant.word)}"`);
  if (style.length) attributes.push(`style="${style.join('; ')}"`);
  return attributes.map(attribute => ` ${attribute}`).join('');
}

/**
 * The script the page runs before anything else: it posts `ready` to its parent once the page
 * loaded (or when the iteration's own script calls `roughbookReady()`), and `error` with the
 * reason when the iteration throws or a promise of it fails, never both.
 */
export function messagesScript(key: string, readyOn: 'load' | 'script'): string {
  return `(function () {
  var id = ${json(key)};
  var done = false;
  var target = window.parent || window;
  function post(message) {
    try {
      target.postMessage(message, '*');
    } catch (error) {}
  }
  function fail(text) {
    if (done) return;
    done = true;
    post({ roughbook: 'error', id: id, message: String(text || 'The iteration failed to render.') });
  }
  window.roughbookFail = fail;
  window.roughbookReady = function () {
    if (done) return;
    done = true;
    post({ roughbook: 'ready', id: id });
  };
  window.addEventListener('error', function (event) {
    fail((event && (event.message || (event.error && event.error.message))) || '');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    fail(reason && reason.message ? reason.message : reason);
  });${
    readyOn === 'load'
      ? `
  window.addEventListener('load', function () {
    window.roughbookReady();
  });`
      : ''
  }
})();`;
}

/** The fixture as the page's script sets it, before the iteration runs. */
export function fixtureScript(value: unknown): string {
  return `window.roughbookFixture = ${json(value)};\n`;
}

function isDocument(markup: string): boolean {
  return /^\s*<!doctype/i.test(markup) || /<html[\s>]/i.test(markup);
}

/** A whole document of the iteration's, with the page's tags first in its head. */
function intoDocument(markup: string, tags: string, attributes: string): string {
  // The page's attributes come first, so they win over the document's own of the same name.
  const html = attributes ? markup.replace(/<html\b/i, `<html${attributes}`) : markup;
  if (/<head\b[^>]*>/i.test(html))
    return html.replace(/<head\b[^>]*>/i, open => `${open}\n${tags}`);
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, open => `${open}\n<head>\n${tags}\n</head>`);
  }
  return `${tags}\n${html}`;
}

export type PageInput = {
  key: string;
  markup: string;
  /** The renderer's own tags for the head. */
  head: string[];
  /** The site's stylesheets, as its pages link them. */
  stylesheets: string[];
  variant: PageVariant;
  readyOn: 'load' | 'script';
  /** Whether the iteration has a fixture, which the page's own script sets. */
  fixture: boolean;
};

/** The page an iteration is shown in: a fragment inside the studio's document, or its own. */
export function standalonePage(input: PageInput): string {
  const tags = [
    `<script>${messagesScript(input.key, input.readyOn)}</script>`,
    ...(input.fixture ? [`<script src="./${FILES_DIR}/fixture.js"></script>`] : []),
    ...input.stylesheets.map(href => `<link rel="stylesheet" href="${escape(href)}">`),
    ...input.head
  ].join('\n');
  const attributes = rootAttributes(input.variant);
  if (isDocument(input.markup)) return intoDocument(input.markup, tags, attributes);
  return `<!doctype html>
<html${attributes}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(input.key)}</title>
${tags}
</head>
<body>
${input.markup}
</body>
</html>
`;
}

/** The page for a key with no iteration (404) or one that did not render (500), posting the error. */
export function errorPage(key: string, status: 404 | 500, message: string): string {
  const heading = status === 404 ? 'No iteration here' : 'The iteration did not render';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(heading)}</title>
<script>(window.parent || window).postMessage(${json({ roughbook: 'error', id: key, message })}, '*');</script>
</head>
<body style="margin: 0; background: #fff; color: #1f2933; font: 14px/1.5 system-ui, sans-serif">
<main style="padding: 24px">
<h1 style="margin: 0 0 8px; font-size: 16px">${escape(heading)}</h1>
<pre style="margin: 0; white-space: pre-wrap; font: 13px/1.5 ui-monospace, monospace">${escape(message)}</pre>
</main>
</body>
</html>
`;
}
