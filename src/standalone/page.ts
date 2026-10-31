// The page the standalone server wraps an iteration in: the site's stylesheets, the fixture, the
// variant on its root, and the contract's messages (rough/CONTRACT.md, point 3), the same for every
// kind of iteration. A failed or missing one gets a page of its own that posts the error.
import { VARIANT_PARAMS } from '../environment/variants.js';
import { MARKER_ELEMENT, SECTION_ATTRIBUTE } from '../recipes/context.js';
import { LIVE_SCRIPT } from '../recipes/live.js';

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

/** A section of a composition in its marker, for a renderer that writes HTML. */
export function sectionMarker(page: string, component: string, inner: string): string {
  return `<${MARKER_ELEMENT} ${SECTION_ATTRIBUTE}="${escape(`${page}/${component}`)}" style="display: contents">
${inner}
</${MARKER_ELEMENT}>`;
}

/** With ?roughbook-pick=1: a click names the section it fell in to the frame, and goes nowhere. */
export const PICK_SCRIPT = `document.addEventListener("click", function (event) {
  event.preventDefault();
  event.stopPropagation();
  var section = event.target instanceof Element ? event.target.closest("[${SECTION_ATTRIBUTE}]") : null;
  var key = section && section.getAttribute("${SECTION_ATTRIBUTE}");
  if (key) window.parent.postMessage({ roughbook: "section", key: key }, "*");
}, true);`;

export type ComposedPageInput = {
  page: string;
  /** Every section in its marker. */
  markup: string;
  head: string[];
  bodyAttributes: string;
  stylesheets: string[];
  variant: PageVariant;
  readyOn: 'load' | 'script';
  pick: boolean;
};

/**
 * A page's composition: one document whose sections all sit in one data-roughbook-variant root,
 * which runs the script the canvas talks to. The variant's word is on that root, since the script
 * measures the first element with the attribute, and the rest is on the page's root as ever.
 */
export function composedPage(input: ComposedPageInput): string {
  const id = `${input.page}/composition`;
  const tags = [
    `<script>${messagesScript(id, input.readyOn)}</script>`,
    `<script>${LIVE_SCRIPT}</script>`,
    ...(input.pick ? [`<script>${PICK_SCRIPT}</script>`] : []),
    ...input.stylesheets.map(href => `<link rel="stylesheet" href="${escape(href)}">`),
    ...input.head
  ].join('\n');
  const word = input.variant.word ? `="${escape(input.variant.word)}"` : '';
  return `<!doctype html>
<html${rootAttributes({ ...input.variant, word: null })}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(id)}</title>
${tags}
</head>
<body${input.bodyAttributes}>
<div data-roughbook-variant${word}>
${input.markup}
</div>
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
