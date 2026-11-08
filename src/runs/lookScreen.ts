// The look-screen check (ROUGHBOOK-ENGINE-PLAN.md, E8): a first-screen run's iteration is the
// first screen of a working product, not a poster. This mirrors the backend's
// utils/compile/lookScreen.ts, with what it imports (the fact kinds, the skeletons' names and
// builds, the content sheet's name key, the look's own file names); a change to one belongs in
// both, and the finding codes and messages are the backend's, word for word. It reads the files
// the agent wrote for what the brief's first-screen contract asks as far as files can show it: a
// labelled field in a form that submits, a header (with Log in where people have accounts), no
// dead button or anchor, no placeholder address, none of the look's points rendered, the subline
// said once, the contract's named objects with facts that can be counted, the assigned
// structure's carrier, only the content sheet's names, and only the pictures its imagery allows.
// Every finding blocks: the studio fails the check with it, so the agent fixes it before finishing.
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

/** A finding of this check: every one blocks, as the backend marks it. */
export type ScreenFinding = Finding & { blocks?: true };

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
      "One object fills the first screen at large size, with all its facts and the action on it, as a product page would show one product; the other objects follow as a small row under it. For software, that object is the product's own screen, working."
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
 * What an iteration lacks to be a first screen, file by file in the order given. Each code once,
 * with where and how often; nothing when the screen has every part.
 */
export function lookScreenFindings(files: Map<string, string>, check: LookScreen): ScreenFinding[] {
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
  if (check.content) findings.push(...inventedFindings(source, check.content));
  if (check.pictures) {
    const styled = [...files].filter(
      ([path]) => path !== LOOK_CSS && path !== LOOK_WORDS && STYLED.test(path)
    );
    findings.push(...pictureFindings(styled, check.pictures));
  }
  const carrier = check.skeleton ? CARRIERS[check.skeleton] : undefined;
  const skeleton = check.skeleton ? SKELETONS[check.skeleton] : undefined;
  if (carrier && skeleton && !carrier.test.test(source)) {
    findings.push(
      blocks(
        'SKELETON_MISSING',
        `This look was assigned the ${skeleton.name} structure and its files have ${carrier.lacks}. ${skeleton.build}`
      )
    );
  }
  return findings;
}
