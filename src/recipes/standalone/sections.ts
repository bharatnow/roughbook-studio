// What it takes to put an HTML iteration in one document with others. It was written to be a page of
// its own, in its own folder, so in a composition each section keeps what that gave it:
//
//   - A whole document gives up its html and head: the head's styles and scripts move in with the
//     body, and the body's attributes go to the element that stands for it.
//   - Each section has one element of its own around everything, which is what the canvas measures,
//     whatever the section starts with (a style element measures nothing).
//   - Relative addresses in its markup and styles are made to point at its own folder.
//   - Its top-level const, let and class stay its own: an inline script runs in a block, so two
//     sections can both say `const items`. Functions and vars stay global, so onclick still works.
//   - Each section's scripts see its own window.roughbookFixture while they run.
//   - A script or stylesheet two sections share is loaded once.
//
// All of this reads tags with patterns rather than a parser, as the rest of the standalone page does.
import { fixtureScript } from '../../standalone/page.js';

/** A tag and its attributes, whose quoted values may hold a `>`. */
const ATTRIBUTES = String.raw`(?:"[^"]*"|'[^']*'|[^>"'])*`;
/** A comment, left as it is; a script or style with its contents; any other opening tag. */
const PIECES = new RegExp(
  String.raw`<!--[\s\S]*?-->|<(script|style)\b(${ATTRIBUTES})>([\s\S]*?)</\1\s*>|<[a-z][^\s>/]*${ATTRIBUTES}>`,
  'gi'
);
const ATTRIBUTE = /(\s)([^\s=>/"']+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'data', 'action', 'xlink:href']);
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)|(@import\s+)(["'])([^"']+)\4/gi;

/** A section's document, split: what its head holds, its body's attributes, and its body. */
export function splitDocument(markup: string): { head: string; attributes: string; body: string } {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(markup);
  const body =
    /<body\b([^>]*)>([\s\S]*)<\/body\s*>/i.exec(markup) ??
    /<body\b([^>]*)>([\s\S]*)$/i.exec(markup);
  if (body) return { head: head?.[1] ?? '', attributes: body[1] ?? '', body: body[2] ?? '' };
  const rest = head ? markup.replace(head[0], '') : markup;
  return {
    head: head?.[1] ?? '',
    attributes: '',
    body: rest.replace(/<!doctype[^>]*>|<\/?html\b[^>]*>/gi, '')
  };
}

/** The tags of a head a body can hold too: its styles, stylesheets and scripts. */
export function documentHead(head: string): string[] {
  const kept = new RegExp(
    String.raw`<(script|style)\b${ATTRIBUTES}>[\s\S]*?</\1\s*>|<link\b${ATTRIBUTES}>`,
    'gi'
  );
  return head.replace(/<!--[\s\S]*?-->/g, '').match(kept) ?? [];
}

/** An address as it was meant from the iteration's folder; left alone unless it is relative. */
function fromFolder(address: string, sitePath: string): string {
  const value = address.trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(value)) return address;
  const url = new URL(value, `http://site${sitePath}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

function cssFromFolder(css: string, sitePath: string): string {
  return css.replace(
    CSS_URL,
    (whole, quote?: string, url?: string, at?: string, mark?: string, imported?: string) =>
      imported
        ? `${at}${mark}${fromFolder(imported, sitePath)}${mark}`
        : url
          ? `url(${quote}${fromFolder(url, sitePath)}${quote})`
          : whole
  );
}

function tagFromFolder(tag: string, sitePath: string): string {
  return tag.replace(
    ATTRIBUTE,
    (whole, space: string, name: string, equals: string, raw: string) => {
      const lower = name.toLowerCase();
      const mark = /^["']/.test(raw) ? raw[0]! : '';
      const value = mark ? raw.slice(1, -1) : raw;
      const changed = URL_ATTRIBUTES.has(lower)
        ? fromFolder(value, sitePath)
        : lower === 'srcset'
          ? value.replace(
              /(^|,\s*)([^\s,]+)/g,
              (_all, lead: string, url: string) => `${lead}${fromFolder(url, sitePath)}`
            )
          : lower === 'style'
            ? cssFromFolder(value, sitePath)
            : null;
      return changed === null ? whole : `${space}${name}${equals}${mark}${changed}${mark}`;
    }
  );
}

/** Whether a script element's opening tag is one that runs as a classic script. */
function classicScript(attributes: string): boolean {
  const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attributes)?.[1];
  return !type || /^(?:text|application)\/(?:java|ecma)script$/i.test(type);
}

/** Where a tag loads something a section could share, or null for any other tag. */
function shared(tag: string, name: string): string | null {
  if (name === 'link' && !/\srel\s*=\s*["']?stylesheet/i.test(tag)) return null;
  if (name !== 'link' && name !== 'script') return null;
  const found = new RegExp(
    String.raw`\s${name === 'link' ? 'href' : 'src'}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`,
    'i'
  ).exec(tag);
  return found ? (found[1] ?? found[2] ?? found[3] ?? null) : null;
}

/** A section's markup as it has to read in a shared document; `loaded` keeps what is already in it. */
export function sectionHtml(html: string, sitePath: string, loaded: Set<string>): string {
  return html.replace(PIECES, (piece, element?: string, attributes?: string, contents?: string) => {
    if (piece.startsWith('<!--')) return piece;
    const name = (element ?? /^<([a-z][^\s>/]*)/i.exec(piece)?.[1] ?? '').toLowerCase();
    if (name === 'style') {
      const open = tagFromFolder(`<style${attributes ?? ''}>`, sitePath);
      return `${open}${cssFromFolder(contents ?? '', sitePath)}</style>`;
    }
    if (name === 'script') {
      const open = tagFromFolder(`<script${attributes ?? ''}>`, sitePath);
      const source = shared(open, 'script');
      if (source !== null) {
        if (loaded.has(source)) return '';
        loaded.add(source);
        return `${open}${contents ?? ''}</script>`;
      }
      return classicScript(attributes ?? '') && (contents ?? '').trim()
        ? `${open}{\n${contents}\n}</script>`
        : piece;
    }
    const tag = tagFromFolder(piece, sitePath);
    const source = shared(tag, name);
    if (source !== null) {
      if (loaded.has(source)) return '';
      loaded.add(source);
    }
    return tag;
  });
}

/** One section of a composition: everything it brought, in one element of its own. */
export function sectionMarkup(
  markup: string,
  sitePath: string,
  fixture: unknown,
  loaded: Set<string>
): string {
  const { head, attributes, body } = splitDocument(markup);
  const open = tagFromFolder(`<div${attributes.replace(/\/\s*$/, '')}>`, sitePath);
  const tags = documentHead(head).join('\n');
  return `${open}
<script>${fixtureScript(fixture).trim()}</script>
${sectionHtml(`${tags}\n${body}`, sitePath, loaded)}
</div>`;
}
