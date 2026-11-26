// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/factIndex.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Where every fact is stated (ROUGHBOOK-FACT-CHANGE-PLAN.md, U1): every place a drawn site says
// something a visitor can read, with the figures, names and proof items it carries, and every
// listing that enumerates a collection of the site's pages. A change of fact (U2) is found by
// looking it up here, and swapped (U3) at the offsets each place records, so nobody has to find
// the places by hand. Built from each picked section's own files, which are only parsed, never
// run (`createSourceFile` does no type-checking and evaluates nothing). Pure and deterministic:
// the same input gives the same places in the same order. The web needs no mirror, because the
// backend decides (web AGENTS.md rule 1).
import { ts } from '../typescript.js';
import type { SiteRecord } from '../vendor-shims.js';
import { COMMON_WORDS, figuresIn, nameIn, namesIn, sharedNames, statesFact } from './factPlacement.js';
import { pagePath } from '../vendor-shims.js';
import type { SitePlan } from '../vendor-shims.js';
import type { SiteScript } from '../vendor-shims.js';
import { SHARED_PAGE_SLUG } from '../vendor-shims.js';
import type { SketchFile } from '../vendor-shims.js';

// ---------------------------------------------------------------------------------------------
// The shapes (the plan's U1 spec). FactIndexService builds the input and stores nothing.
// ---------------------------------------------------------------------------------------------

export type FactIndexSection = {
  /** The component's slug: the place's `section`. */
  component: string;
  name: string;
  /** The picked iteration whose files these are. */
  iteration: string;
  /** Kept (X8): changed only for the fact itself, and shown as kept. */
  kept: boolean;
  files: SketchFile[];
};

export type FactIndexPage = {
  slug: string;
  name: string;
  /** 'shared' for the header and footer page, which is on every page. */
  kind: 'page' | 'shared';
  sections: FactIndexSection[];
};

export type FactIndexInput = {
  pages: FactIndexPage[];
  siteMap: Pick<SiteRecord, 'nav' | 'links'>;
  /** The landed plan, or null before one is approved. */
  plan: SitePlan | null;
  /** The approved script, or null before one is approved: its real proof is what `proof` names. */
  script: SiteScript | null;
};

export type Place = {
  /** Stable for the same input: page, section, file and offset (or the site map entry). */
  id: string;
  page: string;
  /** The component slug, or 'nav' / 'links' for the site map's entries. */
  section: string;
  /** '' for the site map's entries. */
  iteration: string;
  /** The file's path within the iteration; '' for the site map's entries. */
  file: string;
  /**
   * Character offsets of the literal's content in the file (inside the quotes, or the JSX text
   * without its surrounding whitespace), so U3 can splice: content.slice(0, start) + new +
   * content.slice(end). 0 and 0 for the site map's entries. The slice is the source as written,
   * escapes and entities included; `text` is what a visitor reads.
   */
  start: number;
  end: number;
  /** What a visitor reads: whitespace collapsed, JSX entities and string escapes resolved. */
  text: string;
  /** The figures as said (`figuresIn`'s raw), in order. */
  figures: string[];
  names: string[];
  /** The real proof ids the text states, as the facts plan's rule 1 (`statesFact`) reads it. */
  proof: string[];
  /** The link the text sits under, as written: an element's or a data object's href. */
  href?: string;
};

export type Listing = {
  id: string;
  page: string;
  section: string;
  /** 'cards' for a repeated data shape or element, 'links' when every member is linked, else 'text'. */
  kind: 'cards' | 'links' | 'text';
  /** The page slugs it enumerates, in the order it first names or links them. */
  members: string[];
};

export type FactIndex = { places: Place[]; listings: Listing[] };

// ---------------------------------------------------------------------------------------------
// What a visitor can read in a file.
// ---------------------------------------------------------------------------------------------

/** The look's files hold colours, type and motion, never a claim. */
const LOOK_FILES = new Set(['look.css', 'look.ts', 'look.tokens.json']);

/**
 * Props and data keys whose values are never shown: styling, identity, routing, media and
 * behaviour. `href` and `to` are read apart, as the link of the text beside them.
 */
const HIDDEN_KEYS = new Set(
  [
    'className',
    'class',
    'style',
    'styles',
    'key',
    'id',
    'ref',
    'src',
    'srcSet',
    'sizes',
    'icon',
    'variant',
    'type',
    'as',
    'tone',
    'size',
    'color',
    'colour',
    'slug',
    'image',
    'img',
    'photo',
    'video',
    'poster',
    'url',
    'link',
    'path',
    'kind',
    'layout',
    'align',
    'theme',
    'role',
    'rel',
    'target',
    'fill',
    'stroke',
    'd',
    'viewBox',
    'xmlns',
    'width',
    'height',
    'fit',
    'position',
    'loading',
    'method',
    'action',
    'autoComplete',
    'inputMode',
    'pattern',
    'htmlFor',
    'form',
    'lang',
    'dir',
    'background',
    'bg',
    'accent',
    'gradient',
    'easing',
    'transition',
    'animation',
    'font',
    'weight',
    'ratio',
    'aspect',
    'mode',
    'state',
    'status',
    'tag',
    'element',
    'component'
  ].map(key => key.toLowerCase())
);
/** On an HTML element only these attributes are read aloud or shown. */
const READABLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'title',
  'placeholder'
]);
const LINK_KEYS = new Set(['href', 'to']);
/**
 * Where a literal is code: imports, types, directives ('use client'), case labels, keys, enum
 * members, and call arguments (class helpers, hooks, selectors and tagged CSS take strings no
 * visitor reads).
 */
const LITERAL_CONTEXT_SKIP = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExternalModuleReference,
  ts.SyntaxKind.LiteralType,
  ts.SyntaxKind.ExpressionStatement, // 'use client'
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.ComputedPropertyName,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.TaggedTemplateExpression
]);
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InKeyword
]);

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  pound: '£',
  euro: '€',
  middot: '·',
  copy: '©'
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Strings that are code, not words: class lists, CSS values, slugs and identifiers, paths and
 * URLs, file names. A string a visitor reads has a space, a capital or a figure, so a lowercase
 * single token is taken as an identifier ("primary", "grid-cols-3").
 */
function looksLikeCode(text: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  if (/^(\/|\.\.?\/|#|https?:|mailto:|tel:|data:|www\.)/i.test(text)) return true;
  if (/\.(png|jpe?g|svg|webp|avif|gif|mp4|webm|mov|css|tsx?|jsx?|json|woff2?)$/i.test(text))
    return true;
  if (
    /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|var\(--|calc\(|cubic-bezier\(|translate|rotate|scale\()/i.test(
      text
    )
  )
    return true;
  // Any CSS function value: color-mix(), clamp(), linear-gradient(), url() and the rest.
  if (/^[a-z][a-z-]*\(.*\)$/.test(text) && !/[A-Z]/.test(text)) return true;
  if (/[\w-]+\s*:\s*[^;]+;/.test(text)) return true;
  if (/^(-?\d*\.?\d+(px|rem|em|%|vh|vw|svh|dvh|ms|s|deg|fr)\s*)+$/.test(text)) return true;
  // camelCase, kebab-case or snake_case with no space and no capital first.
  if (!/\s/.test(text) && /^[a-z][\w-]*$/.test(text)) return true;
  if (!/\s/.test(text) && /^[a-z]+[A-Z]\w*$/.test(text)) return true;
  // A class list: lowercase tokens, half or more with a utility's punctuation. A utility token
  // always has a letter ("md:grid", "p-4"); "08:00 to 19:00" is a time, not three classes.
  const tokens = text.split(/\s+/);
  if (
    tokens.length >= 2 &&
    tokens.every(token => /^[!a-z0-9\-:/[\].%#()_&>~*@]+$/.test(token)) &&
    tokens.filter(token => /[a-z]/.test(token) && /[-:/[]/.test(token)).length * 2 >= tokens.length
  )
    return true;
  return false;
}

/** The name of a JSX attribute or object property as written, or ''. */
function keyName(name: ts.Node | undefined): string {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return '';
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

const isIntrinsic = (tag: string) => /^[a-z]/.test(tag) && !tag.includes('.');

/** A string literal's value when the node is one with no substitutions; else null. */
function literalValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalValue(node.expression);
  return null;
}

/** The href an element carries as a plain string. */
function elementHref(node: ts.JsxOpeningLikeElement): string | undefined {
  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (!LINK_KEYS.has(keyName(attribute.name))) continue;
    const value = literalValue(attribute.initializer);
    if (value !== null) return value;
  }
  return undefined;
}

/** The href a data object carries as a plain string. */
function objectHref(node: ts.ObjectLiteralExpression): string | undefined {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!LINK_KEYS.has(keyName(property.name))) continue;
    const value = literalValue(property.initializer);
    if (value !== null) return value;
  }
  return undefined;
}

/** One readable run of text in a file, before the facts are read from it. */
type RawLine = { start: number; end: number; text: string; href?: string; node: ts.Node };

function scriptKind(path: string): ts.ScriptKind | null {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'tsx') return ts.ScriptKind.TSX;
  if (extension === 'ts') return ts.ScriptKind.TS;
  if (extension === 'json') return ts.ScriptKind.JSON;
  return null;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).toLowerCase();

/**
 * Whether a literal's surroundings make it shown: not an import, a type, a comparison, a call's
 * argument (class helpers, hooks, selectors), a key, or a hidden prop or data key's value.
 */
function literalShown(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (LITERAL_CONTEXT_SKIP.has(parent.kind)) return false;
  if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return false;
  if (ts.isPropertyAssignment(parent)) {
    if (parent.name === node) return false;
    const key = keyName(parent.name).toLowerCase();
    if (HIDDEN_KEYS.has(key) || LINK_KEYS.has(key) || key.startsWith('data-')) return false;
  }
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node)
    return false;
  if (ts.isJsxAttribute(parent)) return false; // read by the attribute's own rule
  return true;
}

/**
 * Whether a JSX attribute's value is shown: on an HTML element, only alt, aria-label, title and
 * placeholder; on a component, any prop but the hidden ones, links and handlers, because
 * `<Card title="Northside" body="…">` passes the words a visitor reads.
 */
function attributeShown(attribute: ts.JsxAttribute): boolean {
  const name = keyName(attribute.name);
  const owner = attribute.parent.parent as ts.JsxOpeningLikeElement;
  const lower = name.toLowerCase();
  if (isIntrinsic(tagName(owner))) return READABLE_ATTRIBUTES.has(lower);
  if (HIDDEN_KEYS.has(lower) || LINK_KEYS.has(lower)) return false;
  if (/^on[A-Z]/.test(name) || lower.startsWith('data-')) return false;
  return true;
}

/** Every readable line of one file, in source order. */
function readFile(file: SketchFile): RawLine[] {
  const kind = scriptKind(file.path);
  if (kind === null || file.encoding !== 'utf8' || LOOK_FILES.has(baseName(file.path))) return [];
  const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, kind);
  const lines: RawLine[] = [];
  const hrefs: (string | undefined)[] = [];
  const href = () => [...hrefs].reverse().find(item => item !== undefined);

  // Offsets leave out the whitespace around the words, so a swap keeps the spaces either side
  // ("Open until " before a `${time}` keeps its space).
  const push = (node: ts.Node, start: number, end: number, text: string) => {
    const shown = collapse(text);
    if (!shown || looksLikeCode(shown)) return;
    const raw = file.content.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    lines.push({ start: start + lead, end: end - trail, text: shown, href: href(), node });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      if (!attributeShown(node)) return;
      const value = node.initializer;
      if (value && ts.isStringLiteral(value)) {
        push(value, value.getStart(source) + 1, value.end - 1, decodeEntities(value.text));
        return;
      }
    }
    if (ts.isJsxText(node)) {
      const raw = file.content.slice(node.pos, node.end);
      if (raw.trim()) push(node, node.pos, node.end, decodeEntities(raw));
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (literalShown(node)) push(node, node.getStart(source) + 1, node.end - 1, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (!literalShown(node)) return;
      // Each written part of `Open until ${time} on Fridays` is its own line; the parts between
      // `${` and `}` are code and are visited as code.
      const head = node.head;
      push(head, head.getStart(source) + 1, head.end - 2, head.text);
      for (const span of node.templateSpans) {
        visit(span.expression);
        const literal = span.literal;
        const close = ts.isTemplateTail(literal) ? 1 : 2;
        push(literal, literal.getStart(source) + 1, literal.end - close, literal.text);
      }
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      hrefs.push(elementHref(opening));
      ts.forEachChild(node, visit);
      hrefs.pop();
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      hrefs.push(objectHref(node));
      ts.forEachChild(node, visit);
      hrefs.pop();
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The site's pages, as links and names point to them.
// ---------------------------------------------------------------------------------------------

type SitePage = { slug: string; name: string; handles: string[]; families: string[] };

/**
 * The words that mark a page as one of a kind: the slug's first folder ("clinics/northside"), its
 * first and last hyphen words ("clinic-northside", "northside-clinic") and the name's last word,
 * singular ("Northside Clinic"). The script has no page kind, so these stand in for one. Common
 * words ("us" in "about-us") never mark a kind.
 */
function familiesOf(slug: string, name: string): string[] {
  const keys = new Set<string>();
  const folders = slug.split('/');
  if (folders.length > 1) keys.add(`/${folders[0]}`);
  const words = folders[folders.length - 1].split('-');
  if (words.length > 1) {
    keys.add(`${words[0]}-`);
    keys.add(`-${words[words.length - 1].replace(/s$/, '')}`);
  }
  const last = (name.trim().split(/\s+/).pop() ?? '').toLowerCase().replace(/s$/, '');
  if (name.trim().includes(' ') && last) keys.add(`~${last}`);
  return [...keys].filter(key => {
    const word = key.replace(/[/~-]/g, '');
    return word.length >= 3 && !COMMON_WORDS.has(word);
  });
}

/** The site's pages, the shared page and home left out: they are on every page, never a member. */
function sitePages(input: FactIndexInput): SitePage[] {
  const named = new Map<string, string>();
  for (const page of input.pages) if (page.kind === 'page') named.set(page.slug, page.name);
  for (const page of input.plan?.pages ?? [])
    if (!named.has(page.slug)) named.set(page.slug, page.name);
  const pages = [...named]
    .filter(([slug]) => slug !== SHARED_PAGE_SLUG && pagePath(slug) !== '/')
    .map(([slug, name]) => ({ slug, name, families: familiesOf(slug, name) }));
  // A family word a page's name ends with is the kind, not the name: "Northside" names the page
  // "Northside Clinic" when three pages end in "Clinic".
  const counts = new Map<string, number>();
  for (const page of pages)
    for (const family of page.families) counts.set(family, (counts.get(family) ?? 0) + 1);
  return pages.map(page => {
    const handles = new Set<string>([page.name.trim()]);
    const words = page.name.trim().split(/\s+/);
    const last = `~${(words[words.length - 1] ?? '').toLowerCase().replace(/s$/, '')}`;
    if (words.length > 1 && (counts.get(last) ?? 0) >= 3) handles.add(words.slice(0, -1).join(' '));
    const tail = page.slug.split('/').pop() ?? '';
    const slugWords = tail.split('-');
    const kind = `-${slugWords[slugWords.length - 1].replace(/s$/, '')}`;
    handles.add(
      (slugWords.length > 1 && (counts.get(kind) ?? 0) >= 3
        ? slugWords.slice(0, -1)
        : slugWords
      ).join(' ')
    );
    return {
      ...page,
      handles: [...handles].filter(
        handle => handle.length >= 3 && !COMMON_WORDS.has(handle.toLowerCase())
      )
    };
  });
}

/** The page an href reaches, by its path, or null for an outside link, an anchor or a file. */
function pageOfHref(href: string, byPath: Map<string, string>): string | null {
  if (href.startsWith('#')) return null;
  const path = href
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (!path.startsWith('/') && path !== '') return byPath.get(`/${path}`) ?? null;
  return byPath.get(path || '/') ?? null;
}

/** The pages a line links to or names, in order: a link first, then names longest first. */
function pagesOf(
  line: { text: string; href?: string },
  pages: SitePage[],
  byPath: Map<string, string>
): string[] {
  const found: string[] = [];
  const linked = line.href ? pageOfHref(line.href, byPath) : null;
  if (linked) found.push(linked);
  for (const page of pages)
    if (!found.includes(page.slug) && page.handles.some(handle => nameIn(handle, line.text)))
      found.push(page.slug);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Names, figures and proof.
// ---------------------------------------------------------------------------------------------

/**
 * `namesIn` skips a sentence's first word, which is right for prose and wrong for a card's title:
 * "Northside Clinic" names Northside. So a title-case label (every word capitalised or a common
 * word) has its first word read as a name too.
 */
function namesOf(text: string): string[] {
  const names = namesIn(text);
  const words = text.split(/\s+/);
  const first = (words[0] ?? '').replace(/[^\p{L}\p{N}'’&-]/gu, '').replace(/['’]s$/u, '');
  const titleCase = words.every(
    word => /^[\p{Lu}\p{N}&£$€]/u.test(word) || COMMON_WORDS.has(word.toLowerCase())
  );
  if (
    words.length <= 6 &&
    titleCase &&
    /^\p{Lu}/u.test(first) &&
    !COMMON_WORDS.has(first.toLowerCase()) &&
    !names.includes(first)
  )
    names.unshift(first);
  return names;
}

type ProofClaim = { proof: string; claim: string };

/**
 * The real proof items a text can state: every real item of the script, the ledger's claims among
 * them (`claimsLedger` carries only real items a section holds; a real item no section holds can
 * still be stated). Names two or more claims share never count alone, as in `strayFacts`.
 */
function proofClaims(script: SiteScript | null): { claims: ProofClaim[]; shared: Set<string> } {
  const claims = (script?.proof ?? [])
    .filter(item => item.status === 'real' && item.claim.text.trim())
    .map(item => ({ proof: item.id, claim: item.claim.text }));
  return { claims, shared: sharedNames(claims.map(item => item.claim)) };
}

// ---------------------------------------------------------------------------------------------
// Listings.
// ---------------------------------------------------------------------------------------------

/**
 * Rule one: the pages a list names or links, grouped by kind, each kind with three or more. A
 * smaller group inside a larger one is the same listing.
 */
function kindListings(order: string[], pages: SitePage[]): string[][] {
  const bySlug = new Map(pages.map(page => [page.slug, page]));
  const groups = new Map<string, string[]>();
  for (const slug of order)
    for (const family of bySlug.get(slug)?.families ?? [])
      groups.set(family, [...(groups.get(family) ?? []), slug]);
  const big = [...groups.values()].filter(members => members.length >= 3);
  return dedupeGroups(big);
}

function dedupeGroups(groups: string[][]): string[][] {
  const sorted = [...groups].sort((a, b) => b.length - a.length);
  const kept: string[][] = [];
  for (const group of sorted) {
    const key = new Set(group);
    if (kept.some(other => [...key].every(slug => other.includes(slug)))) continue;
    kept.push(group);
  }
  return kept;
}

/**
 * Rule two: a data shape repeated three or more times, each naming a different page: an array of
 * objects with the same keys, or sibling elements of one tag. Members in the shape's order.
 */
function shapeListings(
  file: ts.SourceFile,
  lines: RawLine[],
  pages: SitePage[],
  byPath: Map<string, string>,
  own: string
): { members: string[]; links: boolean }[] {
  const groups: { members: string[]; links: boolean }[] = [];
  const pagesInside = (node: ts.Node): string[] => {
    const inside = lines.filter(line => line.node.pos >= node.pos && line.node.end <= node.end);
    const hrefs = new Set<string>();
    const found: string[] = [];
    // A card's link counts even when no line sits under it (an image card with words beside it).
    const objectLink = ts.isObjectLiteralExpression(node) ? objectHref(node) : undefined;
    const elementLink = ts.isJsxElement(node)
      ? elementHref(node.openingElement)
      : ts.isJsxSelfClosingElement(node)
        ? elementHref(node)
        : undefined;
    for (const link of [objectLink, elementLink]) if (link) hrefs.add(link);
    for (const link of hrefs) {
      const slug = pageOfHref(link, byPath);
      if (slug && !found.includes(slug)) found.push(slug);
    }
    for (const line of inside)
      for (const slug of pagesOf(line, pages, byPath)) if (!found.includes(slug)) found.push(slug);
    return found.filter(slug => slug !== own);
  };
  const consider = (items: ts.Node[]) => {
    if (items.length < 3) return;
    const members: string[] = [];
    let links = true;
    for (const item of items) {
      const slug = pagesInside(item).find(candidate => !members.includes(candidate));
      if (!slug) return;
      members.push(slug);
      // An item that is one linked line ("<li><a href>Northside</a></li>") makes a list of links;
      // anything more is a card.
      const inside = lines.filter(line => line.node.pos >= item.pos && line.node.end <= item.end);
      if (inside.length !== 1 || inside[0].href === undefined) links = false;
    }
    groups.push({ members, links });
  };
  const shapeOf = (node: ts.ObjectLiteralExpression) =>
    node.properties
      .map(property => keyName(property.name))
      .sort()
      .join(',');
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      const objects = node.elements.filter(ts.isObjectLiteralExpression);
      const byShape = new Map<string, ts.Node[]>();
      for (const object of objects)
        byShape.set(shapeOf(object), [...(byShape.get(shapeOf(object)) ?? []), object]);
      for (const items of byShape.values()) consider(items);
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const byTag = new Map<string, ts.Node[]>();
      for (const child of node.children) {
        const opening = ts.isJsxElement(child)
          ? child.openingElement
          : ts.isJsxSelfClosingElement(child)
            ? child
            : null;
        if (!opening) continue;
        const tag = tagName(opening);
        byTag.set(tag, [...(byTag.get(tag) ?? []), child]);
      }
      for (const items of byTag.values()) consider(items);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return groups;
}

// ---------------------------------------------------------------------------------------------
// The index.
// ---------------------------------------------------------------------------------------------

export function buildFactIndex(input: FactIndexInput): FactIndex {
  const pages = sitePages(input);
  const byPath = new Map<string, string>();
  for (const page of [...input.pages, ...(input.plan?.pages ?? [])])
    if (!byPath.has(pagePath(page.slug))) byPath.set(pagePath(page.slug), page.slug);
  const { claims, shared } = proofClaims(input.script);
  const proofOf = (text: string) =>
    claims.filter(item => statesFact(text, item.claim, { shared })).map(item => item.proof);
  const facts = (text: string) => ({
    figures: figuresIn(text).map(figure => figure.raw),
    names: namesOf(text),
    proof: proofOf(text)
  });

  const places: Place[] = [];
  const listings: Listing[] = [];
  const addListing = (page: string, section: string, kind: Listing['kind'], members: string[]) => {
    const key = members.join(',');
    if (
      listings.some(
        item => item.page === page && item.section === section && item.members.join(',') === key
      )
    )
      return;
    const n = listings.filter(item => item.page === page && item.section === section).length;
    listings.push({ id: `${page}/${section}/listing-${n + 1}`, page, section, kind, members });
  };

  for (const page of input.pages) {
    for (const section of page.sections) {
      const sectionLines: RawLine[] = [];
      const shapes: { members: string[]; links: boolean }[] = [];
      const files = [...section.files].sort((a, b) => a.path.localeCompare(b.path));
      for (const file of files) {
        const kind = scriptKind(file.path);
        if (kind === null || file.encoding !== 'utf8' || LOOK_FILES.has(baseName(file.path)))
          continue;
        const lines = readFile(file);
        for (const line of lines) {
          places.push({
            id: `${page.slug}/${section.component}/${file.path}:${line.start}`,
            page: page.slug,
            section: section.component,
            iteration: section.iteration,
            file: file.path,
            start: line.start,
            end: line.end,
            text: line.text,
            ...facts(line.text),
            ...(line.href !== undefined ? { href: line.href } : {})
          });
        }
        sectionLines.push(...lines);
        if (lines.length) {
          const source = lines[0].node.getSourceFile();
          shapes.push(...shapeListings(source, lines, pages, byPath, page.slug));
        }
      }
      // Cards first: a repeated shape is the stronger reading of the same members.
      for (const members of dedupeGroups(shapes.map(shape => shape.members))) {
        const links = shapes.some(shape => shape.links && shape.members.join() === members.join());
        addListing(page.slug, section.component, links ? 'links' : 'cards', members);
      }
      const linked = new Set<string>();
      const order: string[] = [];
      for (const line of sectionLines) {
        const linkSlug = line.href ? pageOfHref(line.href, byPath) : null;
        if (linkSlug) linked.add(linkSlug);
        for (const slug of pagesOf(line, pages, byPath))
          if (slug !== page.slug && !order.includes(slug)) order.push(slug);
      }
      for (const members of kindListings(order, pages)) {
        const covered = listings.some(
          item =>
            item.page === page.slug &&
            item.section === section.component &&
            members.every(slug => item.members.includes(slug))
        );
        if (covered) continue;
        const kind = members.every(slug => linked.has(slug)) ? 'links' : 'text';
        addListing(page.slug, section.component, kind, members);
      }
    }
  }

  // The site map: the nav is on every page (the shared page's), each link on the page it leaves.
  const pageName = new Map(pages.map(page => [page.slug, page.name]));
  for (const item of input.siteMap.nav) {
    places.push({
      id: `nav:${item.page}`,
      page: SHARED_PAGE_SLUG,
      section: 'nav',
      iteration: '',
      file: '',
      start: 0,
      end: 0,
      text: item.label,
      ...facts(item.label),
      href: pagePath(item.page)
    });
  }
  for (const members of kindListings(
    input.siteMap.nav.map(item => item.page),
    pages
  ))
    addListing(SHARED_PAGE_SLUG, 'nav', 'links', members);

  const linksFrom = new Map<string, string[]>();
  for (const link of input.siteMap.links) {
    // A link with no label reads as its page's name wherever it is shown.
    const text = link.label ?? pageName.get(link.to) ?? '';
    places.push({
      id: `links:${link.from}>${link.to}`,
      page: link.from,
      section: 'links',
      iteration: '',
      file: '',
      start: 0,
      end: 0,
      text,
      ...facts(text),
      href: pagePath(link.to)
    });
    linksFrom.set(link.from, [...(linksFrom.get(link.from) ?? []), link.to]);
  }
  for (const [from, targets] of linksFrom)
    for (const members of kindListings(targets, pages)) addListing(from, 'links', 'links', members);

  return { places, listings };
}
