// The look-screen check (ROUGHBOOK-ENGINE-PLAN.md, E8): a first-screen run's iteration is the
// first screen of a working product, not a poster. This mirrors the backend's
// utils/compile/lookScreen.ts, with what it imports (the fact kinds, the skeletons' names and
// builds, the content sheet's name key, the look's own file names); a change to one belongs in
// both, and the finding codes and messages are the backend's, word for word. It reads the files
// the agent wrote for what the brief's first-screen contract asks as far as files can show it: a
// labelled field in a form that submits, a header (with Log in where people have accounts), no
// dead button or anchor, no placeholder address, none of the look's points rendered, the subline
// said once, the contract's named objects with facts that can be counted, the assigned
// structure's carrier, only the content sheet's names, and only the pictures its imagery allows;
// with ROUGHBOOK-PROOF-MOTION-PLAN.md, M5, the sheet's values in its own case and no field whose
// placeholder is one of them. Every finding blocks: the studio fails the check with it, so the agent fixes it before finishing.
// With the project's media stances, no medium it avoids, by the media scan (a copy of the
// backend's, mediaScan.ts; ROUGHBOOK-MEDIA-PLAN.md, V2), and with the look's own medium, a soft
// word when the files do not show it (V3). The scan's less certain readings and the look's missing
// medium never block: the backend tells its critic of them, and the studio lists them as warnings.
import { mediaScan, type MediaUse, type ScannedMedium } from './mediaScan.js';
import type { SvgBoxes } from './svgBoxes.js';
import type { Finding } from './types.js';

/** The facts on a named object the check can count (the backend's rules/firstScreen.ts). */
export type FactKind = 'price' | 'rating' | 'time';

/** How a project's pictures are made (the backend's rules/contentSheet.ts). */
export type ImageryStance = 'photos' | 'illustration' | 'type';

/** The first-screen structures the engine assigns (the backend's rules/skeletons.ts, E3). */
export type SkeletonId =
  | 'search-first'
  | 'list-first'
  | 'map-first'
  | 'single-object'
  | 'editorial'
  | 'grid'
  | 'timeline'
  | 'conversation'
  | 'hero';

/** What a brief's first screen must carry past its words, as the backend's rules/look.ts sends it. */
export type LookScreen = {
  /** The look's subline, which no other line of the screen may repeat. */
  subline: string;
  /** The look's points: notes to the designer, never rendered. */
  points: string[];
  /** The header says "Log in": the brief's people have accounts. */
  account: boolean;
  /** What the working field is for, as the check's message says it. */
  action: string;
  /**
   * The named objects the screen shows and the facts on them it can check (prices, ratings,
   * time ranges); null when there is no brief, or nothing in its contract can be counted.
   */
  catalogue: { name: string; min: number; kinds: FactKind[] } | null;
  /** The structure Roughbook assigned (E3), whose carrier the check looks for. */
  skeleton: SkeletonId | null;
  /**
   * The content sheet's things (E2), which a listed thing's name must be one of: what they are
   * called, their names, the sheet's columns, and the words that are never an invented name (the
   * project's own name and every value on the sheet). Null or absent when the sheet has no rows.
   */
  content?: { label: string; names: string[]; columns: string[]; known: string[] } | null;
  /** The imagery stance and the photo URLs it allows (E2); null or absent with no stance. */
  pictures?: { stance: ImageryStance; urls: string[] } | null;
};

/** A finding of this check: every one blocks, as the backend marks it, but the media's soft ones. */
export type ScreenFinding = Finding & { blocks?: true };

/** One medium's stance in the project's Visual Direction (the backend's rules/catalogTypes.ts). */
export type MediaStance = { label: string; stance: 'preferred' | 'allowed' | 'avoid' };

/**
 * The skeletons' names and how each is built, as the backend's rules/skeletons.ts says them: the
 * name for get_checks, the build for the message that sends a look without its carrier back.
 */
export const SKELETONS: Record<SkeletonId, { name: string; build: string }> = {
  'search-first': {
    name: 'Search first',
    build:
      'The way in leads, large and centred on the first screen, and the named objects it filters sit directly under it, already showing before anything is typed.'
  },
  'list-first': {
    name: 'List first',
    build:
      'The named objects lead as a dense list of rows, one per object, with every fact on its row, taking most of the first screen; the way in is small, in the header or just above the list.'
  },
  'map-first': {
    name: 'Map first',
    build:
      'The place leads: a drawn map or plan of the area, as an inline <svg>, takes most of the first screen, with the named objects placed on it by name; picking one on the map shows its facts, and a short list of the same objects sits beside or under it.'
  },
  'single-object': {
    name: 'One thing, large',
    build:
      "One object fills the first screen at large size, with all its facts and the action on it, as a product page would show one product; the other objects follow as rows under it, each with every fact at body size, never a small thin row. For software, that object is the product's own screen, working."
  },
  editorial: {
    name: 'Editorial',
    build:
      'A short written story leads, set as a magazine page in an <article>: the named objects and their figures sit inside the running text and its captions, with one large figure; the way in closes the story.'
  },
  grid: {
    name: 'Grid',
    build:
      'Many objects at once, as an even CSS grid of tiles, each with its name and facts; the way in sits above the grid, and the grid is the largest thing on the first screen.'
  },
  timeline: {
    name: 'Timeline',
    build:
      'What happens, in order, as a numbered <ol> of steps across or down the first screen, each with a real time or number from the proof (from the first step to the last); the way in is step one, and the named objects appear inside the steps.'
  },
  conversation: {
    name: 'Question and answers',
    build:
      'The way in is one question the page asks in large type, with three to six answers as buttons (aria-pressed); choosing one shows the named objects that fit it, with their facts, under the question.'
  },
  hero: {
    name: 'Hero',
    build:
      'A large headline and one strong picture share the first screen, with the way in beside them and the named objects in a row under them.'
  }
};

/**
 * What a software screen shows when the project avoids Product UI (the backend's
 * rules/firstScreen.ts, ROUGHBOOK-MEDIA-PLAN.md decision 1), word for word.
 */
export const SOFTWARE_OUTCOME =
  'the outcome the customer gets from it (the report, the booking or the result)';

/**
 * The builds that ask for a picture, reworded for a project whose pictures are type only, as the
 * backend's rules/skeletons.ts `skeletonFor` words them (ROUGHBOOK-MEDIA-PLAN.md, V1 and decision 2).
 */
const TYPE_ONLY_BUILDS: Partial<Record<SkeletonId, string>> = {
  editorial:
    'A short written story leads, set as a magazine page in an <article>: the named objects and their figures sit inside the running text and its captions, with one large figure: its picture, if it has one, or else one of its numbers set large; the way in closes the story.',
  hero: 'A large headline and its picture, if it has one, share the first screen, with the way in beside them and the named objects in a row under them; with no picture, the headline fills that space in type.'
};

/** The map, for a project that avoids Illustration or whose pictures are type only (decision 7). */
const LABELLED_MAP_BUILD =
  'The place leads: a drawn map or plan of the area, as an inline <svg>, takes most of the first screen, with its streets or areas and the named objects labelled by name in <text> inside the <svg>, so it is a diagram that carries information, not an illustration; picking one on the map shows its facts, and a short list of the same objects sits beside or under it.';

/** The one large thing of a software project that avoids Product UI (decision 1). */
const NO_PRODUCT_UI_BUILD = `One object fills the first screen at large size, with all its facts and the action on it, as a product page would show one product; the other objects follow as rows under it, each with every fact at body size, never a small thin row. For software, that object is ${SOFTWARE_OUTCOME}, filled in with realistic data, never the product's own screen.`;

/**
 * Photography and Illustration as the picture style sets them, whatever the list says (the
 * backend's rules/visualDirection.ts `withPictureStyle`, which its `screenMedia` applies).
 */
const AVOIDED_BY_STYLE: Record<ImageryStance, Record<string, boolean>> = {
  photos: { photography: false, illustration: true },
  illustration: { photography: true, illustration: false },
  type: { photography: true, illustration: true }
};

const avoidsLabel = (
  media: readonly MediaStance[],
  label: string,
  pictureStyle: ImageryStance | null = null
) => {
  const wanted = label.toLowerCase();
  const byStyle = pictureStyle ? AVOIDED_BY_STYLE[pictureStyle][wanted] : undefined;
  if (byStyle !== undefined) return byStyle;
  return media.some(item => item.stance === 'avoid' && item.label.trim().toLowerCase() === wanted);
};

/**
 * A skeleton's name and build as a project with these media is told it, mirroring the backend's
 * rules/skeletons.ts `skeletonFor` with `screenMedia` (ROUGHBOOK-MEDIA-PLAN.md, V1): the picture
 * style sets Photography and Illustration first; with pictures of type only (the picture style, or
 * both avoided), a build that asks for a picture says "its picture, if it has one"; with
 * Illustration avoided (the photos style included) or type only, the map is labelled inside its
 * <svg>; with Product UI avoided, the one large thing of software is its outcome. Without media it
 * is SKELETONS[id].
 */
export function skeletonFor(
  id: SkeletonId,
  media: readonly MediaStance[] = [],
  pictureStyle: ImageryStance | null = null
): { name: string; build: string } {
  const typeOnly =
    pictureStyle === 'type' ||
    (avoidsLabel(media, 'Photography', pictureStyle) &&
      avoidsLabel(media, 'Illustration', pictureStyle));
  const build =
    id === 'map-first' && (typeOnly || avoidsLabel(media, 'Illustration', pictureStyle))
      ? LABELLED_MAP_BUILD
      : id === 'single-object' && avoidsLabel(media, 'Product UI')
        ? NO_PRODUCT_UI_BUILD
        : ((typeOnly ? TYPE_ONLY_BUILDS[id] : undefined) ?? SKELETONS[id].build);
  return { name: SKELETONS[id].name, build };
}

/** A skeleton's name, or its id when this studio does not know it yet. */
export function skeletonName(id: string): string {
  return (SKELETONS as Record<string, { name: string } | undefined>)[id]?.name ?? id;
}

/** The look's own files on the web, written for the model, which the check never reads. */
const LOOK_CSS = 'look.css';
const LOOK_WORDS = 'look.ts';

/** A name as the content sheet compares it: lowercased, letters and digits only. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const CODE = /\.(tsx|jsx|ts|js|mjs)$/i;
/** A tag's attributes, stepping over {expressions} two levels deep, as the craft floor reads them. */
const ATTRS = String.raw`(?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*`;
const BUTTON = new RegExp(String.raw`<(?:[A-Za-z][\w.]*\.)?button\b(${ATTRS})>`, 'g');
const HANDLED =
  /\bonClick\s*=|\btype\s*=\s*["']submit["']|\btype\s*=\s*\{\s*["'`]submit["'`]\s*\}|\.\.\./;
const ANCHOR = /\bhref\s*=\s*(?:["']#([^"']*)["']|\{\s*["'`]#([^"'`]*)["'`]\s*\})/g;
const ID = /\bid\s*=\s*(?:["']([^"']+)["']|\{\s*["'`]([^"'`]+)["'`]\s*\})/g;
const PLACEHOLDER_ADDRESS = /\bYour street\b|\bYour town\b|\bOpen today until\b/i;
const INPUT = /<input\b/;
const LABEL = /<label\b|\baria-label(?:ledby)?\s*=/;
const SUBMITS = new RegExp(String.raw`<form\b${ATTRS}\bonSubmit\s*=`);
const HEADER = /<header\b/;
const LOG_IN = /\b(?:log|sign) in\b/i;
const TIME_RANGE = /\b\d{1,3}\s?[–—-]\s?\d{1,3}\s?min\b/g;
const FEE = /[£$€]\s?\d+(?:[.,]\d{1,2})?|\bfree\b/gi;
const RATING = /\b[3-5]\.\d(?![\w%.])/g;
/** How many distinct values a counted fact needs across the entries. */
const DISTINCT = 3;
const PATTERNS: Record<FactKind, RegExp> = { price: FEE, rating: RATING, time: TIME_RANGE };
const KIND_WORDS: Record<FactKind, string> = {
  price: 'prices or fees',
  rating: 'ratings',
  time: 'time ranges'
};
/**
 * What each assigned structure must have in the files (ROUGHBOOK-ENGINE-PLAN.md, E3): its carrier,
 * found loosely, so a look built on another structure is sent back once. The search-first, the
 * single object and the hero are carried by the field and the objects the rest of the check asks for.
 */
const CARRIERS: Partial<Record<SkeletonId, { test: RegExp; lacks: string }>> = {
  'list-first': {
    test: /<(?:ul|ol)\b[\s\S]*<li\b|role\s*=\s*["']list["']/,
    lacks: 'no list of rows'
  },
  'map-first': { test: /<svg\b/, lacks: 'no drawn map (<svg>)' },
  editorial: { test: /<article\b/, lacks: 'no <article> carrying the story' },
  grid: {
    test: /\bgrid-cols-|display\s*:\s*['"]?grid|grid-template-columns/,
    lacks: 'no CSS grid of tiles'
  },
  timeline: { test: /<ol\b/, lacks: 'no numbered <ol> of steps' },
  conversation: {
    test: /aria-pressed|type\s*=\s*["']radio["']|role\s*=\s*["']radio/,
    lacks: 'no answers to choose (aria-pressed buttons or radios)'
  }
};

/** A point this short is an ordinary phrase, not a note copied to the screen. */
const NOTE_WORDS = 3;
/** This many words of the subline in a row, anywhere else, is the subline said again. */
const REPEAT_WORDS = 5;

const blocks = (code: string, message: string): ScreenFinding => ({ code, message, blocks: true });

/** Text as it is compared: one case, one space, no punctuation at either end. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
    .trim();
}

const words = (text: string) => plain(text).split(' ').filter(Boolean);

/** The runs of the subline that count as repeating it: every window of REPEAT_WORDS words. */
function sublineRuns(subline: string): string[] {
  const all = words(subline);
  if (all.length <= REPEAT_WORDS) return all.length ? [all.join(' ')] : [];
  return all
    .slice(0, all.length - REPEAT_WORDS + 1)
    .map((_, at) => all.slice(at, at + REPEAT_WORDS).join(' '));
}

/** The files the agent wrote, as code: never the look's own files. */
function written(files: Map<string, string>): [string, string][] {
  return [...files].filter(([path]) => path !== LOOK_CSS && path !== LOOK_WORDS && CODE.test(path));
}

function deadButtons(text: string): number {
  return [...text.matchAll(BUTTON)].filter(match => !HANDLED.test(match[1] ?? '')).length;
}

function deadAnchors(text: string, ids: Set<string>): string[] {
  return [...text.matchAll(ANCHOR)]
    .map(match => match[1] ?? match[2] ?? '')
    .filter(target => !target || !ids.has(target))
    .map(target => `#${target}`);
}

function catalogueFindings(
  source: string,
  catalogue: NonNullable<LookScreen['catalogue']>
): ScreenFinding[] {
  const counts = catalogue.kinds.map(kind => {
    const values = [...source.matchAll(PATTERNS[kind])].map(match => plain(match[0]));
    // Prices repeat more than the rest: two delivery fees across a list is ordinary.
    const needed = Math.min(DISTINCT, kind === 'price' ? 2 : DISTINCT, catalogue.min);
    return { kind, all: values.length, distinct: new Set(values).size, needed };
  });
  if (counts.every(item => item.all >= catalogue.min && item.distinct >= item.needed)) return [];
  const found = counts
    .map(item => `${item.all} ${KIND_WORDS[item.kind]} (${item.distinct} distinct)`)
    .join(', ');
  return [
    blocks(
      'NO_CATALOGUE',
      `The screen needs ${catalogue.name} by name, at least ${catalogue.min}, each with its ${catalogue.kinds.map(kind => KIND_WORDS[kind]).join(', ')}, the values varied from one to the next; found ${found}. Cards that carry only a category do not count.`
    )
  ];
}

/** An object literal with no object inside it: where a sketch keeps one listed thing. */
const FLAT_OBJECT = /\{([^{}]*)\}/g;
/** One property of it: its key, quoted or not, and its value when that is a plain string. */
const PROPERTY =
  /(["']?)\b([A-Za-z_$][\w$]*)\1\s*:\s*(?:(["'`])((?:\\.|(?!\3)[^\\\n])*?)\3(?=\s*[,}\n]|\s*$))?/g;
const NAME_KEYS = ['name', 'title'];
/** Keys that never carry a fact the sheet could have. */
const PLAIN_KEYS = new Set(['id', 'key', 'slug', 'href', 'url', 'src', 'alt', 'image', 'photo']);
/** How many invented names a message lists, and how many of the sheet's it offers instead. */
const SHOWN = 4;
const OFFERED = 6;

/** Two keys are the same column when one holds the other: "deliveryFee" and "fee". */
function sameColumn(key: string, column: string): boolean {
  const [a, b] = [nameKey(key), nameKey(column)];
  if (!a || !b) return false;
  return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
}

/** A name the sheet has, allowing one to hold the other: "Mama Ama's, Ancoats" is Mama Ama's. */
function onSheet(name: string, keys: string[]): boolean {
  const own = nameKey(name);
  return keys.some(
    key =>
      key === own ||
      (Math.min(key.length, own.length) >= 4 && (own.includes(key) || key.includes(own)))
  );
}

/**
 * The names the files give their listed things: an object literal's name (or title) that also
 * carries facts the sheet has, by its columns' keys or by one of its values; or a name on the
 * sheet. A heading, a link or a step carries none, so it is not a listed thing.
 */
function listedNames(source: string, content: NonNullable<LookScreen['content']>): string[] {
  const values = new Set(content.known.map(nameKey).filter(Boolean));
  const sheet = content.names.map(nameKey);
  const needed = Math.min(2, content.columns.length);
  const names: string[] = [];
  for (const [, body] of source.matchAll(FLAT_OBJECT)) {
    const props = [...body!.matchAll(PROPERTY)].map(match => ({
      key: match[2]!,
      value: match[3] ? (match[4] ?? '') : null
    }));
    const named = NAME_KEYS.map(key => props.find(prop => prop.key === key)).find(prop =>
      prop?.value?.trim()
    );
    if (!named) continue;
    const name = named.value!.replace(/\\(.)/g, '$1').trim();
    const facts = props.filter(prop => prop !== named && !PLAIN_KEYS.has(prop.key.toLowerCase()));
    const byColumn = facts.filter(prop =>
      content.columns.some(column => sameColumn(prop.key, column))
    ).length;
    const byValue = facts.some(prop => prop.value && values.has(nameKey(prop.value)));
    if (onSheet(name, sheet) || (needed && byColumn >= needed) || byValue) names.push(name);
  }
  return [...new Set(names)];
}

/**
 * Names given to listed things that are not on the content sheet (E2, rule 2): refused, not
 * discouraged. Only where the files list two things or more, so one heading is never a thing.
 */
function inventedFindings(
  source: string,
  content: NonNullable<LookScreen['content']>
): ScreenFinding[] {
  const listed = listedNames(source, content);
  if (listed.length < 2) return [];
  const sheet = content.names.map(nameKey);
  const known = content.known.map(nameKey).filter(Boolean);
  // A name that holds a value of the sheet's, or the brand, is a heading about it: "Tonight in Ancoats".
  const invented = listed.filter(name => !onSheet(name, sheet) && !onSheet(name, known));
  if (!invented.length) return [];
  const shown = invented.slice(0, SHOWN).map(name => `"${name}"`);
  const more = invented.length > SHOWN ? ` and ${invented.length - SHOWN} more` : '';
  const offered = content.names.slice(0, OFFERED).join(', ');
  return [
    blocks(
      'INVENTED_NAME',
      `The screen lists ${content.label} that are not on the project's content sheet: ${shown.join(', ')}${more}. Show only the sheet's ${content.label}, by their names there (${offered}${content.names.length > OFFERED ? ', …' : ''}), with their facts; never make one up.`
    )
  ];
}

/**
 * What the screen's text is, for the sheet's values (ROUGHBOOK-PROOF-MOTION-PLAN.md, M5): the
 * pieces of JSX text and of string literals that can be shown. Code is blanked first, keeping
 * positions: comments, regular expressions, import paths, a tag's attribute values (all but a
 * placeholder, title, alt or label, and handlers, whose strings can be shown), class-name calls,
 * object keys and code keys' values (id, slug, className...), strings compared or searched for,
 * and lists of lower-case strings in a file that lowers what it compares.
 */
const COMMENT = /\/\*[\s\S]*?\*\/|(?<![:\\])\/\/[^\n]*/g;
const REGEX_LITERAL =
  /(?<=[(,=:[!&|?{};]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*/g;
const IMPORT_PATH =
  /\bfrom\s*(["'])[^"'\n]*\1\s*;?\s*$|\bimport\s*(["'])[^"'\n]*\2|\b(?:require|import)\s*\(\s*(["'`])[^"'`\n]*\3\s*\)/gm;
const TAG = new RegExp(String.raw`<[A-Za-z][\w.:-]*\b${ATTRS}\/?>`, 'g');
const ATTR_VALUE = new RegExp(
  String.raw`([\w:.-]+)\s*=\s*("[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})`,
  'g'
);
/** Attributes whose value is shown as words; every other attribute's value is code. */
const TEXT_ATTRS = new Set(['placeholder', 'title', 'alt', 'label']);
const HANDLER = /^on[A-Z]/;
const OBJECT_KEY = /(?<=[{,]\s*)(["'`])(?:\\.|(?!\1)[^\\\n])*\1(?=\s*:)/g;
/** Keys whose string is code, never shown: an id, a slug, a class, an address. */
const CODE_KEY =
  /^(?:id|key|slug|href|url|src|image|photo|icon|type|kind|variant|tone|ref|class|className|style|path|[\w$]+(?:Id|Key|Slug|Class|ClassName|Url|Href|Src))$/;
const COMPARED = [
  /(?:[!=]==?|\bcase)\s*(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g,
  /(["'`])(?:\\.|(?!\1)[^\\\n])*\1(?=\s*[!=]==?)/g,
  /\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf|match|matchAll|replace|replaceAll|split|search|localeCompare|test|has|get)\s*\(\s*(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g
];
const STRING_LIST = /\[\s*(?:(["'`])(?:\\.|(?!\1)[^\\\n])*\1\s*,?\s*)+\]/g;
const LOWERS = /\.to(?:Locale)?LowerCase\s*\(/;
/** A call that joins class names: its strings are classes, never words. */
const CLASS_CALL =
  /\b(?:cn|clsx|cx|classNames|classnames|twMerge|twJoin|cva)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g;
/** An object's key, quoted or not: a string that is one is a lookup, never words ("verde"). */
const KEY_NAME = /(?<=[{,]\s*)(["']?)([\w$-]+)\1\s*:/g;
const STRING = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
/** JSX text, from a tag's end to the next tag; the `>` of `=>` and `->` ends no tag. */
const JSX_TEXT = /(?<![=-])>([^<>]*)(?=<)/g;
const BRACED = String.raw`\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const EXPRESSION = new RegExp(BRACED, 'g');
const AROUND_EXPRESSION = new RegExp(`(${BRACED})`);
/**
 * Text between two tags that is code, never words: `</>),\n  verde: (` in a map of drawings. Text
 * that is taken is blanked, so prose like `, only Larkford's own` must be taken, or its apostrophe
 * starts a string.
 */
const CODE_LIKE = /[=;]|&&|\|\||^\s*\)\s*[,;)}\]]/;
/** A value lowered as it is shown: `{kitchen.cuisine.toLowerCase()}` among a tag's children. */
const LOWERED =
  /(?<!(?:=|=>)\s*)\{\s*(?:[\w$]+\??\.)*([\w$]+)\s*\.\s*to(?:Locale)?LowerCase\s*\(\s*\)\s*\}/g;
/** Where one shown piece ends and the next starts: a list's separators, a clause's end. */
const PIECE = /[,·•|/\n()]|\s[–—-]\s|[.!?:;](?=\s|$)/;
const PLACEHOLDER = /\bplaceholder\s*=\s*(?:(["'])(.*?)\1|\{\s*(["'`])(.*?)\3\s*\})/g;
/** A placeholder that is an example already: "e.g. Old Market", "such as Northgate", "Try Verde". */
const EXAMPLE = /^(?:e\.\s?g\b\.?|eg\b|such as\b|for example\b|try\b)/i;

const blank = (text: string) => text.replace(/[^\n]/g, ' ');
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimmed = (text: string) => text.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
const capitalled = (text: string) => /\p{Lu}/u.test(text);

/** A file's code with what is never shown blanked, its positions kept. */
function shownSource(text: string): string {
  let out = text.replace(COMMENT, blank).replace(REGEX_LITERAL, blank).replace(IMPORT_PATH, blank);
  out = out.replace(TAG, tag =>
    tag.replace(ATTR_VALUE, (attr, name: string, value: string) =>
      TEXT_ATTRS.has(name) || HANDLER.test(name)
        ? attr
        : attr.slice(0, attr.length - value.length) + blank(value)
    )
  );
  out = out.replace(CLASS_CALL, blank).replace(OBJECT_KEY, blank);
  out = out.replace(PROPERTY, (match: string, _quote, key: string, string?: string) =>
    string && CODE_KEY.test(key) ? match.replace(/(["'`])[\s\S]*\1$/, blank) : match
  );
  for (const pattern of COMPARED) out = out.replace(pattern, blank);
  if (LOWERS.test(out)) {
    out = out.replace(STRING_LIST, list => (capitalled(list) ? list : blank(list)));
  }
  return out;
}

/**
 * The pieces of a file's text that can be shown: its JSX text, then its strings, but a piece that
 * is one of the files' object keys (`{ chorlton: <svg /> }`, `art: 'chorlton'`).
 */
function shownPieces(code: string, keys: Set<string>): string[] {
  const pieces: string[] = [];
  const add = (value: string) =>
    pieces.push(
      ...value
        .split(PIECE)
        .map(trimmed)
        .filter(piece => piece && !keys.has(piece))
    );
  const rest = code.replace(JSX_TEXT, (match, inner: string) => {
    const words = inner.replace(EXPRESSION, '\n');
    if (CODE_LIKE.test(words)) return match;
    add(words);
    // Taken: its apostrophes start no string, and its {expressions} are read as code below.
    const parts = inner.split(AROUND_EXPRESSION);
    return `>${parts.map((part, at) => (at % 2 ? part : blank(part))).join('')}`;
  });
  for (const [, , value] of rest.matchAll(STRING)) {
    if (value?.trim()) add(value.replace(/\$\{[^}]*\}/g, '\n').replace(/\\(.)/g, '$1'));
  }
  return pieces;
}

/** Where the found text lost a capital the sheet's value has: "vietnamese" for "Vietnamese". */
function lostCapital(value: string, found: string): boolean {
  return [...value].some(
    (char, at) => char !== char.toLowerCase() && found[at] === char.toLowerCase()
  );
}

/**
 * The sheet's values the screen writes in another case (ROUGHBOOK-PROOF-MOTION-PLAN.md, M5): a
 * name, or a value with a capital past its first letter ("South Indian", "St Bride's"), anywhere
 * in the shown text; any other value ("Vietnamese") where a shown piece is that value alone; and
 * any value the files hold under a key that is lowered as it is shown. Capitals added are fine.
 */
function caseFindings(
  own: [string, string][],
  content: NonNullable<LookScreen['content']>
): ScreenFinding[] {
  const names = new Set(content.names);
  const values = [...new Set([...content.names, ...content.known])]
    .filter(value => capitalled(value) && nameKey(value).length >= 3)
    .sort((a, b) => b.length - a.length)
    .map(value => ({
      value,
      anywhere: names.has(value) || capitalled(value.slice(1)),
      at: new RegExp(`(?<![\\p{L}\\p{N}])${escaped(value)}(?![\\p{L}\\p{N}])`, 'giu')
    }));
  if (!values.length) return [];
  const found: string[] = [];
  const note = (value: string) => {
    if (!found.includes(value)) found.push(value);
  };
  const source = own.map(([, text]) => text).join('\n');
  const keys = new Set([...source.matchAll(KEY_NAME)].map(match => match[2]!));
  for (const [, text] of own) {
    const code = shownSource(text);
    for (const piece of shownPieces(code, keys)) {
      for (const { value, anywhere, at } of values) {
        const lost = anywhere
          ? [...piece.matchAll(at)].some(match => lostCapital(value, match[0]))
          : piece.toLowerCase() === value.toLowerCase() && lostCapital(value, piece);
        if (lost) note(value);
      }
    }
    for (const [, key] of code.matchAll(LOWERED)) {
      for (const match of source.matchAll(PROPERTY)) {
        if (match[2] !== key || !match[3]) continue;
        const held = nameKey(match[4] ?? '');
        const value = values.find(item => nameKey(item.value) === held);
        if (value) note(value.value);
      }
    }
  }
  if (!found.length) return [];
  const shown = found.slice(0, SHOWN).map(value => `"${value}"`);
  const more = found.length > SHOWN ? ` and ${found.length - SHOWN} more` : '';
  return [
    blocks(
      'SHEET_CASE',
      `The screen writes the content sheet's values in another case: ${shown.join(', ')}${more}. Write each as the sheet does, with its capitals; never lower one as it is shown.`
    )
  ];
}

/**
 * Placeholders that are a bare value from the sheet, a name or any value, its places among them
 * (ROUGHBOOK-PROOF-MOTION-PLAN.md, M5): the field reads as filled in. An example ("e.g.
 * Northgate") or a hint ("Your neighbourhood") is not a value.
 */
function placeholderFindings(
  own: [string, string][],
  content: NonNullable<LookScreen['content']>
): ScreenFinding[] {
  const values = new Set([...content.names, ...content.known].map(nameKey).filter(Boolean));
  const files: string[] = [];
  const found: string[] = [];
  for (const [file, text] of own) {
    for (const match of text.replace(COMMENT, blank).matchAll(PLACEHOLDER)) {
      const placeholder = trimmed(match[2] ?? match[4] ?? '');
      if (!placeholder || EXAMPLE.test(placeholder) || placeholder.includes('${')) continue;
      if (!values.has(nameKey(placeholder))) continue;
      if (!files.includes(file)) files.push(file);
      if (!found.includes(placeholder)) found.push(placeholder);
    }
  }
  if (!found.length) return [];
  return [
    blocks(
      'PLACEHOLDER_VALUE',
      `${files.join(', ')} give${files.length === 1 ? 's' : ''} a field the placeholder ${found.map(value => `"${value}"`).join(', ')}, a bare value from the content sheet, so it reads as filled in. Make it an example, "e.g. ${found[0]}", or a hint, such as "Your neighbourhood".`
    )
  ];
}

const IMG = new RegExp(String.raw`<img\b(${ATTRS})>`, 'g');
const SRC = /\bsrc\s*=\s*(?:(["'])(.*?)\1|\{\s*(["'`])(.*?)\3\s*\})/;
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/g;
/** A string that is a picture's address: a project file, a photo service, or a raster file. */
const PICTURE_STRING =
  /(["'`])((?:https?:)?\/\/(?:images\.unsplash\.com|unsplash\.com|images\.pexels\.com|picsum\.photos|placehold\.co|via\.placeholder\.com|loremflickr\.com|source\.unsplash\.com)\/[^"'`\s]*|\/api\/files\/[^"'`\s]+|(?:https?:)?\/\/[^"'`\s]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"'`\s]*)?)\1/gi;
const RASTER = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)|^data:image\/(?:png|jpe?g|webp|gif|avif)/i;
const SVG = /^data:image\/svg\+xml|\.svg(?:[?#]|$)/i;
const PHOTO_PLACE = /^\/api\/files\/|^(?:https?:)?\/\//i;
/** Addresses that are fonts or styles, never pictures. */
const NOT_PICTURE = /\.(?:woff2?|ttf|otf|eot|css)(?:[?#]|$)|fonts\.(?:googleapis|gstatic)\.com/i;
/** The files a picture can be named in: the agent's code, styles and pages. */
const STYLED = /\.(tsx|jsx|ts|js|mjs|css|html)$/i;

type PictureUse = { file: string; src: string; img: boolean };

/** Every picture the files point at: <img> sources, CSS url()s, and picture addresses in strings. */
function pictureUses(own: [string, string][]): PictureUse[] {
  const uses: PictureUse[] = [];
  for (const [file, text] of own) {
    for (const [, attrs] of text.matchAll(IMG)) {
      const src = SRC.exec(attrs ?? '');
      const value = src ? (src[2] ?? src[4] ?? '') : '';
      if (value && !value.includes('${')) uses.push({ file, src: value.trim(), img: true });
    }
    for (const [, , value] of text.matchAll(CSS_URL)) {
      if (value?.trim()) uses.push({ file, src: value.trim(), img: false });
    }
    for (const [, , value] of text.matchAll(PICTURE_STRING)) {
      if (value) uses.push({ file, src: value, img: false });
    }
  }
  return uses;
}

/** The same address, allowing for encoding and for the host in front of a project file's path. */
function allowedUrl(src: string, urls: string[]): boolean {
  const decoded = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return urls.some(url => src === url || decoded(src) === decoded(url) || src.endsWith(url));
}

/**
 * Pictures the imagery stance does not allow (E2, decision 2): with photos, any but the chosen
 * ones (data: URIs, inline SVG and #fragments are drawing, never photos); with type or
 * illustration, any raster picture or photo address at all.
 */
function pictureFindings(
  own: [string, string][],
  pictures: NonNullable<LookScreen['pictures']>
): ScreenFinding[] {
  const uses = pictureUses(own).filter(
    use => !use.src.startsWith('#') && !NOT_PICTURE.test(use.src)
  );
  const wrong = uses.filter(use =>
    pictures.stance === 'photos'
      ? !use.src.startsWith('data:') && !allowedUrl(use.src, pictures.urls)
      : !SVG.test(use.src) &&
        (RASTER.test(use.src) ||
          PHOTO_PLACE.test(use.src) ||
          (use.img && !use.src.startsWith('data:')))
  );
  if (!wrong.length) return [];
  const files = [...new Set(wrong.map(use => use.file))].join(', ');
  const srcs = [...new Set(wrong.map(use => use.src))];
  const shown = srcs
    .slice(0, SHOWN)
    .map(src => `"${src.length > 80 ? `${src.slice(0, 77)}...` : src}"`)
    .join(', ');
  const more = srcs.length > SHOWN ? ` and ${srcs.length - SHOWN} more` : '';
  const fix =
    pictures.stance === 'photos'
      ? pictures.urls.length
        ? `Use only the project's chosen photos, by these URLs: ${pictures.urls.join(', ')}; draw nothing in place of a photo.`
        : 'None of its chosen photos is available yet: take the pictures off and let type, colour and space carry it.'
      : pictures.stance === 'illustration'
        ? "This project's pictures are illustrations in its own drawing language, drawn as inline SVG: take the photos off and draw instead."
        : 'This look has no pictures: take them off and let type, colour, rules and space carry it.';
  return [
    blocks(
      'PICTURE_NOT_ALLOWED',
      `${files} use${files.includes(',') ? '' : 's'} pictures the project's imagery does not allow: ${shown}${more}. ${fix}`
    )
  ];
}

/**
 * The project's media and the look's own, for the media checks (ROUGHBOOK-MEDIA-PLAN.md, V2 and
 * V3). Each may come on the check itself or as lookScreenFindings' options, which win.
 */
export type LookScreenMedia = {
  /** The project's Visual Direction: each medium's stance (the look's `material.media`). */
  media?: MediaStance[] | null;
  /** The one preferred medium the look was given to lead with (V3), or null for none. */
  medium?: string | null;
  /** The inline SVGs the render measured, when the check runs after a render. */
  boxes?: SvgBoxes | null;
};

/** An avoided medium the scan is sure of: blocking, sent back once (V2, decision 4). */
export const MEDIUM_AVOIDED = 'MEDIUM_AVOIDED';
/** An avoided medium the scan reads with less certainty, or Product UI: told to the critic (V2). */
export const MEDIUM_AVOIDED_UNSURE = 'MEDIUM_AVOIDED_UNSURE';
/** The look's own medium, which its files do not show: told to the critic, never blocking (V3). */
export const MEDIUM_MISSING = 'MEDIUM_MISSING';
/** The codes of the findings the critic is told and that never block (V2, V3; decision 5). */
export const CRITIC_MEDIA_CODES: readonly string[] = [MEDIUM_AVOIDED_UNSURE, MEDIUM_MISSING];
/**
 * The media an Avoid blocks when the scan is sure of them (decision 4); Product UI, which the scan
 * reads with lower confidence, is told to the critic, and Generated imagery is never scanned.
 */
export const BLOCKING_MEDIA: readonly ScannedMedium[] = [
  '3D',
  'Video',
  'Motion graphics',
  'Photography',
  'Illustration',
  'SVG diagrams'
];
const SCANNED: readonly ScannedMedium[] = [...BLOCKING_MEDIA, 'Product UI'];
/** How many places a media finding names before "and N more". */
const PLACES = 3;

/** A stance's or a look's medium as the scan names it, ignoring case; null when it is not scanned. */
function scannedMedium(label: string): ScannedMedium | null {
  const wanted = label.trim().toLowerCase();
  return SCANNED.find(medium => medium.toLowerCase() === wanted) ?? null;
}

/** What a line of evidence shows, in words: "a CSS 3D transform". */
function shownAs(medium: ScannedMedium, text: string): string {
  switch (medium) {
    case '3D':
      if (/three|@react-three/.test(text)) return 'a three.js scene';
      return /model-viewer/i.test(text) ? 'a 3D model viewer' : 'a CSS 3D transform';
    case 'Video':
      if (/<video\b/.test(text)) return 'a <video> element';
      return /youtube|vimeo/i.test(text) ? 'an embedded video player' : 'a video file';
    case 'Motion graphics':
      if (/<animate/.test(text)) return 'an SVG animation that runs on load';
      if (/requestAnimationFrame|useAnimationFrame/.test(text))
        return 'a frame loop started on load';
      if (/setInterval/.test(text)) return 'a timer that moves the screen at rest';
      if (/infinite|[iI]teration|\brepeat\b|animate-(?:ping|pulse|bounce)/.test(text)) {
        return 'an animation that loops';
      }
      if (/<motion\./.test(text)) return 'an entrance longer than 300 ms';
      return 'an animation that runs on load';
    case 'Photography':
      return 'a photo';
    case 'Illustration':
      return 'a drawing (an inline <svg>)';
    case 'SVG diagrams':
      return 'a labelled drawing (an inline <svg> with text, connectors or a route)';
    case 'Product UI':
      return /sidebar|side-?nav|side-?panel/i.test(text)
        ? "an app's sidebar and panel"
        : 'a drawn app window or device frame';
  }
}

/** Where a medium shows: "a CSS 3D transform in hero.css, line 12", the files' lines first. */
function places(use: MediaUse): string {
  const inFiles = use.evidence.filter(item => !/^rendered \d+px$/.test(item.file));
  const cited = (inFiles.length ? inFiles : use.evidence).map(item => {
    const rendered = /^rendered (\d+px)$/.exec(item.file);
    return rendered
      ? `${shownAs(use.medium, item.text)}, the page's inline <svg> number ${item.line} as rendered at ${rendered[1]}`
      : `${shownAs(use.medium, item.text)} in ${item.file}, line ${item.line}`;
  });
  const unique = [...new Set(cited)];
  const more = unique.length > PLACES ? ` and ${unique.length - PLACES} more` : '';
  return `${unique.slice(0, PLACES).join('; ')}${more}`;
}

/** How to take an avoided medium off, offering only what the project does not avoid too. */
function avoidFix(medium: ScannedMedium, avoided: Set<ScannedMedium>): string {
  switch (medium) {
    case '3D':
      return 'Keep the idea flat: no 3D transform, perspective or 3D library.';
    case 'Video':
      return 'Take the video off and let type, colour and space carry the idea.';
    // The words of the rules the sketch was given (the backend's firstScreen.ts STILL_AT_REST and
    // MOTION_HELD), so the send-back never allows what the prompt forbids (ROUGHBOOK-MEDIA-PLAN.md,
    // rule 1).
    case 'Motion graphics':
      return 'Let nothing on the first screen move on load or at rest: no entrance, no loop and no decorative animation. Motion may only show what changed when the way in is used, on transform and opacity, for at most 150 ms over a short distance.';
    case 'Photography':
      return `Take the photos off and let type, colour and space carry it${avoided.has('Illustration') ? '' : ', or a drawing'}.`;
    case 'Illustration':
      return `Take the drawing off${avoided.has('SVG diagrams') ? '' : ', or make it a diagram that carries labelled information (place names, values, steps)'}, and let type, colour and space carry the rest.`;
    case 'SVG diagrams':
      return `Take the labelled drawing off: no map, chart, flow or route drawn as <svg> with words in it. Say the places and facts as text instead${avoided.has('Illustration') ? '' : '; a drawing without labels may stay'}.`;
    case 'Product UI':
      return "Show the outcome the customer gets (the report, the booking, the result) instead of the product's screen.";
  }
}

/**
 * Whether a sure reading of an avoided medium blocks. Under the type picture style, Illustration
 * is avoided by the style itself, which still allows a drawn diagram of the offer and type or
 * shapes that move (decision 2): a drawing of shapes alone may be that moving drawing, so it is
 * a warning, never blocking (ROUGHBOOK-MEDIA-PLAN.md, V2).
 */
function blocksWhenSure(medium: ScannedMedium, pictureStyle: ImageryStance | null): boolean {
  if (!BLOCKING_MEDIA.includes(medium)) return false;
  return !(medium === 'Illustration' && pictureStyle === 'type');
}

/**
 * The avoided media the screen uses (ROUGHBOOK-MEDIA-PLAN.md, V2): decision 4's media the scan is
 * sure of block and are sent back once; a less certain reading, and Product UI, is a warning
 * (decision 7: an unclear drawing never blocks), which the backend tells its critic. A photo
 * PICTURE_NOT_ALLOWED already names is not named twice.
 */
function avoidedFindings(
  scanned: MediaUse[],
  media: MediaStance[],
  photosRefused: boolean,
  pictureStyle: ImageryStance | null = null
): ScreenFinding[] {
  const avoided = new Set(
    media.flatMap(item => {
      const medium = item.stance === 'avoid' ? scannedMedium(item.label) : null;
      return medium ? [medium] : [];
    })
  );
  return scanned.flatMap(use => {
    if (!avoided.has(use.medium)) return [];
    if (use.medium === 'Photography' && photosRefused) return [];
    const fix = avoidFix(use.medium, avoided);
    if (use.confidence === 'high' && blocksWhenSure(use.medium, pictureStyle)) {
      return [
        blocks(
          MEDIUM_AVOIDED,
          `The project avoids ${use.medium}, and the screen uses it: ${places(use)}. ${fix}`
        )
      ];
    }
    return [
      {
        code: MEDIUM_AVOIDED_UNSURE,
        message: `The project avoids ${use.medium}, and the screen may use it: ${places(use)}. The scan cannot be sure of this one, so it does not hold the screen back. ${fix}`
      }
    ];
  });
}

/**
 * The media whose absence the scan cannot tell: a look can show Product UI as plain HTML (a rota
 * table, a swap panel) that the scan does not read, as reports/Media baseline.md records for
 * coverwell. Until media-eval shows the scan reads them, a look given one is never told it is
 * missing (ROUGHBOOK-MEDIA-PLAN.md, V3).
 */
export const MISSING_UNREAD: readonly ScannedMedium[] = ['Product UI'];

/**
 * The look's own medium, when its files do not show it (ROUGHBOOK-MEDIA-PLAN.md, V3): a warning,
 * never blocking, which the backend tells its critic. A medium the scan does not read (Generated
 * imagery), one whose absence it cannot tell (MISSING_UNREAD), or one the project avoids, says
 * nothing.
 */
function missingFindings(
  scanned: MediaUse[],
  given: string,
  media: MediaStance[]
): ScreenFinding[] {
  const medium = scannedMedium(given);
  if (!medium || MISSING_UNREAD.includes(medium)) return [];
  if (scanned.some(use => use.medium === medium)) return [];
  if (media.some(item => item.stance === 'avoid' && scannedMedium(item.label) === medium))
    return [];
  return [
    {
      code: MEDIUM_MISSING,
      message: `This look was given ${medium} to lead with, and the scan finds none in its files. Let ${medium} carry the look where its structure has room.`
    }
  ];
}

/** The messages of the findings the critic is told (V2, V3), for its prompt. */
export function criticMediaNotes(findings: Finding[]): string[] {
  return findings.filter(item => CRITIC_MEDIA_CODES.includes(item.code)).map(item => item.message);
}

/**
 * What an iteration lacks to be a first screen, file by file in the order given. Each code once,
 * with where and how often; nothing when the screen has every part. The project's media and the
 * look's own medium come on the check or in `options`, which win (V2, V3).
 */
export function lookScreenFindings(
  files: Map<string, string>,
  check: LookScreen & LookScreenMedia,
  options: LookScreenMedia = {}
): ScreenFinding[] {
  const own = written(files);
  if (!own.length) return [];
  const source = own.map(([, text]) => text).join('\n');
  const compared = plain(source);
  const findings: ScreenFinding[] = [];

  const placeholders = own.filter(([, text]) => PLACEHOLDER_ADDRESS.test(text)).map(([f]) => f);
  if (placeholders.length) {
    findings.push(
      blocks(
        'PLACEHOLDER_ADDRESS',
        `${placeholders.join(', ')} writes "Your street", "Your town" or "Open today until" on the screen. Ask where the person is in a labelled field instead, with the city named.`
      )
    );
  }

  const rendered = check.points.filter(
    point => words(point).length >= NOTE_WORDS && compared.includes(plain(point))
  );
  if (rendered.length) {
    findings.push(
      blocks(
        'LOOK_NOTE_RENDERED',
        `The look's notes are rendered as text: ${rendered.map(point => `"${point}"`).join(', ')}. They say what the screen should prove; show that, and take the words off the screen.`
      )
    );
  }

  if (sublineRuns(check.subline).some(run => compared.includes(run))) {
    findings.push(
      blocks(
        'SUBLINE_REPEATED',
        'A line of the screen repeats the subline. Say it once, as words.subline; every other line is a checkable fact of its own.'
      )
    );
  }

  const lacks = [
    ...(INPUT.test(source) ? [] : ['no input']),
    ...(LABEL.test(source) ? [] : ['no label']),
    ...(SUBMITS.test(source) ? [] : ['no form with an onSubmit'])
  ];
  if (lacks.length) {
    findings.push(
      blocks(
        'NO_WORKING_FIELD',
        `The screen has no working field (${lacks.join(', ')}). It needs ${check.action}.`
      )
    );
  }

  const header = HEADER.test(source);
  if (!header || (check.account && !LOG_IN.test(source))) {
    findings.push(
      blocks(
        'NO_HEADER',
        `The screen has ${header ? 'a header without "Log in"' : 'no <header>'}. It needs a slim header with the project's name${check.account ? ' and "Log in"' : ''}.`
      )
    );
  }

  const ids = new Set(
    [...source.matchAll(ID)].map(match => match[1] ?? match[2] ?? '').filter(Boolean)
  );
  for (const [file, text] of own) {
    const dead = deadButtons(text);
    if (dead) {
      findings.push(
        blocks(
          'DEAD_BUTTON',
          `${file} has ${dead} button${dead === 1 ? '' : 's'} with no handler: give each an onClick, or type="submit" inside the form.`
        )
      );
    }
    const anchors = deadAnchors(text, ids);
    if (anchors.length) {
      findings.push(
        blocks(
          'DEAD_ANCHOR',
          `${file} links to ${[...new Set(anchors)].join(', ')}, which no element in these files has as its id. Point each link at an id that exists, or make it a button that does something.`
        )
      );
    }
  }

  if (check.catalogue) findings.push(...catalogueFindings(source, check.catalogue));
  if (check.content) {
    findings.push(
      ...inventedFindings(source, check.content),
      ...caseFindings(own, check.content),
      ...placeholderFindings(own, check.content)
    );
  }
  let photosRefused = false;
  if (check.pictures) {
    const styled = [...files].filter(
      ([path]) => path !== LOOK_CSS && path !== LOOK_WORDS && STYLED.test(path)
    );
    const refused = pictureFindings(styled, check.pictures);
    photosRefused = refused.length > 0;
    findings.push(...refused);
  }
  const media = options.media ?? check.media ?? [];
  const carrier = check.skeleton ? CARRIERS[check.skeleton] : undefined;
  // The build in the words the look's sketch was told, for its project's media (V1).
  const skeleton = check.skeleton
    ? skeletonFor(check.skeleton, media, check.pictures?.stance ?? null)
    : undefined;
  if (carrier && skeleton && !carrier.test.test(source)) {
    findings.push(
      blocks(
        'SKELETON_MISSING',
        `This look was assigned the ${skeleton.name} structure and its files have ${carrier.lacks}. ${skeleton.build}`
      )
    );
  }
  const medium = options.medium ?? check.medium ?? null;
  const avoids = media.some(item => item.stance === 'avoid' && scannedMedium(item.label));
  if (avoids || medium) {
    // Decision 7's reading of a drawing from the files, as the render has measured nothing yet.
    const boxes = options.boxes ?? check.boxes ?? undefined;
    const scanned = mediaScan(Object.fromEntries(files), boxes, { sureFromFiles: true });
    if (avoids) {
      findings.push(
        ...avoidedFindings(scanned, media, photosRefused, check.pictures?.stance ?? null)
      );
    }
    if (medium) findings.push(...missingFindings(scanned, medium, media));
  }
  return findings;
}
