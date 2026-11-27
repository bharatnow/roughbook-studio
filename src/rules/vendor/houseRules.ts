// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/houseRules.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The house rules as data (ROUGHBOOK-STUDIO-POWER-PLAN.md, SP1, rules 1-3 and decisions 1-2):
// every rule Roughbook holds a run to is a floor, which protects people and is never lifted, or a
// default, which stops the model's drift when the maker says nothing and lifts when the maker's
// own words ask for it. Lifting is decided here, by code, from the maker's fields; the model is
// told the result and never decides it. Prompts (baselineRules, look, firstScreen, skeletons,
// promptCompiler), checks (checks.ts) and the critic (lookCritic.ts) read these tags.
import { MODEL_TELLS } from './modelTells.js';

export type HouseRuleKind = 'floor' | 'default';

export type HouseRule = {
  id: string;
  kind: HouseRuleKind;
  /** The rule in words, as the run's record names it. */
  text: string;
  /** Phrases in the maker's own words that lift it; a floor has none. */
  liftWhen?: RegExp[];
  /** Other defaults whose lift lifts this one too (the critic's tells follow the prompt's). */
  follows?: string[];
};

/** A default the maker's words lifted: which, by what phrase, and from which of their fields. */
export type Lift = { id: string; phrase: string; from: string };

/** What an iteration records of the house rules (SP1): the defaults it kept and those lifted. */
export type HouseRecord = { used: string[]; lifted: Lift[] };

// --- floors (plan rule 2) ---------------------------------------------------------------------

export const FLOORS: HouseRule[] = [
  {
    id: 'sandbox',
    kind: 'floor',
    text: 'A sketch runs only in its sandbox: it loads nothing from another site at run time and reads no secret, key or token.'
  },
  {
    id: 'phone-390',
    kind: 'floor',
    text: 'At 390 px nothing scrolls sideways, the main action is reachable, and fields are 16 px or more.'
  },
  {
    id: 'reduced-motion',
    kind: 'floor',
    text: 'Every animation has a reduced-motion version, and every translucent surface has an opaque one.'
  },
  {
    id: 'contrast',
    kind: 'floor',
    text: 'Text a person must read meets contrast against what is really behind it.'
  },
  {
    id: 'nothing-hidden',
    kind: 'floor',
    text: 'Nothing a person must read starts hidden: it is readable with no animation run.'
  },
  {
    id: 'keyboard-focus',
    kind: 'floor',
    text: 'Every control works by keyboard, with a visible focus ring.'
  }
];

// --- defaults (plan rule 1, decisions 1 and 2) ------------------------------------------------

const FULL_HEIGHT =
  /\bfull[- ]?(?:height|screen|viewport|bleed)\b|\b100\s?[dsl]?vh\b|\b(?:min-)?h-screen\b|\bposter (?:opener|hero|intro)\b|\bwindow[- ]tall\b/i;
// "slow" and "cinematic" lift only beside a word for movement, so a "slow-roast" brief does not.
const MOVING = String.raw`\b(?:motion|animat\w*|transitions?|mov(?:e|es|ing|ement)|pace|fades?|reveals?|scroll\w*)\b`;
const UNHURRIED = String.raw`\b(?:slow(?:er)?|cinematic|unhurried|languid)\b`;
const SLOW_MOTION = new RegExp(
  [
    `${UNHURRIED}(?=.*${MOVING})`,
    `${MOVING}.*${UNHURRIED}`,
    String.raw`\b\d{2,5}\s?ms\b`,
    String.raw`\b\d+(?:\.\d+)?\s?(?:s|secs?|seconds?)\s+(?:motion|animations?|transitions?|fades?|reveals?)\b`,
    String.raw`\blong(?:er)? (?:motion|animations?|transitions?)\b`
  ].join('|'),
  'i'
);
const SCROLL_MOTION =
  /\bscroll[- ]?(?:story|stories|telling|driven|linked|scenes?|reveals?|animations?|motion)\b|\bparallax\b|\bpin(?:ned|ning)? (?:sections?|scenes?|panels?|on scroll)\b|\bscroll[- ]?pin\w*\b|\bon scroll\b|\bentrance animations?\b|\banimat\w* on (?:load|scroll|entry)\b|\bsection[- ]transitions?\b|\btext[- ]animation\b/i;
const OPENER =
  /\b(?:poster|story|storytelling|experience|experiential|immersive|cinematic|editorial|film)[- ](?:opener|first screen|hero|intro|landing)\b|\bopen(?:s|ing)? (?:with|on) (?:an? )?(?:poster|story|film|experience)\b|\bnot a working product\b/i;

/** Each model tell's phrases (modelTells.ts), keyed by its id. */
const TELL_LIFTS: Record<string, RegExp[]> = {
  'default-sans': [/\b(?:inter|space grotesk)\b/i],
  'purple-gradient': [/\bpurple[- ](?:to[- ])?blue\b|\b(?:purple|violet) gradients?\b/i],
  'cream-serif-terracotta': [/\bterracotta\b/i],
  'black-acid-green': [/\bacid[- ]green\b|\bneon green\b/i],
  'identical-cards': [/\bcard grid\b|\bgrid of cards\b|\b(?:rounded|identical) cards\b/i],
  'eyebrow-everywhere': [/\beyebrows?\b|\bkickers?\b/i],
  'decorative-numbering': [/\b01,? 02\b|\bnumbered (?:sections|steps|chapters)\b/i],
  'middle-dot-meta': [/\bmiddle[- ]dots?\b|·/i],
  'arrow-links': [/\barrows? on (?:every |the |all )?links?\b|\barrow links?\b/i],
  'fake-screenshot': [/\b(?:coded|css|html|styled[- ]div) (?:screenshots?|mock-?ups?)\b/i],
  'gradient-text': [
    /\bgradient[- ](?:filled )?(?:text|type|headlines?|headings?|words?)\b|\btext gradients?\b/i
  ],
  'ambient-backgrounds': [
    /\b(?:glass|glassy|glassmorphism|frosted|translucent|mesh(?: gradients?)?|aurora|glow(?:s|ing)?|halos?|blobs?|bokeh|grid backgrounds?)\b/i
  ],
  'em-dashes': [/\bem[- ]?dash(?:es)?\b/i]
};

/** The prompt's id for a model tell. */
export const tellId = (id: string) => `tell:${id}`;

export const DEFAULTS: HouseRule[] = [
  ...MODEL_TELLS.map(tell => ({
    id: tellId(tell.id),
    kind: 'default' as const,
    text: tell.text,
    liftWhen: TELL_LIFTS[tell.id] ?? []
  })),
  {
    id: 'motion-cap',
    kind: 'default',
    text: 'Motion runs 150 to 300 ms, on transform and opacity only.',
    liftWhen: [SLOW_MOTION]
  },
  {
    id: 'no-load-scroll-motion',
    kind: 'default',
    text: 'Nothing moves on load or on scroll.',
    liftWhen: [SCROLL_MOTION]
  },
  {
    id: 'no-full-height',
    kind: 'default',
    text: 'No section is sized to the window (min-h-screen, h-screen, 100vh).',
    liftWhen: [FULL_HEIGHT]
  },
  {
    id: 'working-product-screen',
    kind: 'default',
    text: "A look's first screen is a working product, not a poster (the default for products and services).",
    liftWhen: [OPENER]
  },
  {
    id: 'skeleton-structure',
    kind: 'default',
    text: 'A look builds exactly the structure it was assigned.',
    liftWhen: [
      /\b(?:my|our|its|their) own (?:structure|layout)\b|\b(?:free|custom|unusual|unconventional|broken) (?:structure|layout|grid)\b|\banti-?grid\b/i
    ]
  },
  {
    id: 'type-cap',
    kind: 'default',
    text: 'At most three type sizes in a section.',
    liftWhen: [
      /\b(?:more than three|many|lots of|four|five|six|\d+) (?:type|font|text) sizes\b|\b(?:expressive|kinetic|giant|oversized|huge) (?:type|typography)\b|\btype as (?:the )?(?:image|picture|hero)\b/i
    ]
  },
  {
    id: 'three-procedural',
    kind: 'default',
    text: 'three.js scenes use procedural geometry only.',
    liftWhen: [
      /\b(?:gltf|glb|hdri|photogrammetry|3d (?:models?|scans?|assets?)|scanned (?:models?|objects?)|textured (?:models?|scenes?))\b/i
    ]
  },
  // The look critic's tells (lookCritic.ts TELLS). Most follow a prompt default; the content ones
  // (placeholder data, unsourced numbers, generic copy, claims with no object) lift only by name.
  {
    id: 'critic:blob-field',
    kind: 'default',
    text: 'A field and a button on a blob or gradient with nothing real behind them.',
    follows: ['working-product-screen', tellId('ambient-backgrounds')]
  },
  {
    id: 'critic:placeholder-data',
    kind: 'default',
    text: 'Placeholder-feeling data: round or identical numbers, generic names, no places.'
  },
  {
    id: 'critic:stock-cutouts',
    kind: 'default',
    text: 'Stock-style cut-outs or glossy 3D tiles as the only pictures.',
    liftWhen: [
      /\b(?:glossy|clay|claymorph\w*) 3d\b|\b3d (?:tiles|icons|renders?)\b|\bcut-?outs?\b/i
    ]
  },
  {
    id: 'critic:three-up',
    kind: 'default',
    text: 'A three-up icon row of benefits with no numbers.',
    follows: [tellId('identical-cards')]
  },
  {
    id: 'critic:unsourced-numbers',
    kind: 'default',
    text: 'Numbers with no source, or that contradict the brief.'
  },
  {
    id: 'critic:generic-copy',
    kind: 'default',
    text: 'Generic copy: "delicious", "seamless", "elevate", "from our X to yours".'
  },
  {
    id: 'critic:decorative-blobs',
    kind: 'default',
    text: 'Decorative blobs, waves or orbs with no job.',
    follows: [tellId('ambient-backgrounds')],
    liftWhen: [/\b(?:waves?|orbs?)\b/i]
  },
  {
    id: 'critic:equal-actions',
    kind: 'default',
    text: 'Equal-weight actions competing for the first click.'
  },
  {
    id: 'critic:symmetry',
    kind: 'default',
    text: 'Symmetry everywhere: centred headline, subline, field and a centred row of three.',
    liftWhen: [/\bsymmetr(?:y|ical)\b|\bcent(?:red|ered)\b/i]
  },
  {
    id: 'critic:claims-no-object',
    kind: 'default',
    text: 'Claims with no visible object: "our own couriers" with no courier, no number.'
  },
  {
    id: 'critic:empty-hero',
    kind: 'default',
    text: 'An oversized, empty hero: content ends far above the fold line.',
    follows: ['no-full-height', 'working-product-screen']
  }
];

/** The critic's last tell is a floor: what a person sees broken is never a choice. */
export const CRITIC_FLOOR_TELL: HouseRule = {
  id: 'critic:visible-defects',
  kind: 'floor',
  text: 'Defects a person sees at once: an empty slot, overlapping text, truncation, low contrast.'
};

export const HOUSE_RULES: HouseRule[] = [...FLOORS, ...DEFAULTS, CRITIC_FLOOR_TELL];

const BY_ID = new Map(HOUSE_RULES.map(rule => [rule.id, rule]));

export const houseRule = (id: string): HouseRule | undefined => BY_ID.get(id);
export const isDefault = (id: string) => BY_ID.get(id)?.kind === 'default';

/**
 * The check codes each default owns (checks.ts, detector.ts, lookScreen.ts, houseChecks.ts): a
 * finding with one of these codes is dropped when its default is lifted. A code not here is a
 * floor's, or no house rule's, and always stands.
 */
export const DEFAULT_CODES: Record<string, string> = {
  TELL_PURPLE_GRADIENT: tellId('purple-gradient'),
  TELL_IDENTICAL_CARDS: tellId('identical-cards'),
  TELL_DECORATIVE_NUMBERING: tellId('decorative-numbering'),
  TELL_MIDDLE_DOT_META: tellId('middle-dot-meta'),
  TELL_GRADIENT_TEXT: tellId('gradient-text'),
  TELL_GLOW_BLOB: tellId('ambient-backgrounds'),
  TELL_DECORATIVE_GLASS: tellId('ambient-backgrounds'),
  TELL_DEFAULT_SANS: tellId('default-sans'),
  HOUSE_FULL_HEIGHT: 'no-full-height',
  HOUSE_MOTION_OVER_CAP: 'motion-cap',
  HOUSE_SCROLL_MOTION: 'no-load-scroll-motion',
  NO_WORKING_FIELD: 'working-product-screen',
  NO_HEADER: 'working-product-screen',
  NO_CATALOGUE: 'working-product-screen',
  SKELETON_MISSING: 'skeleton-structure'
};

// --- lifting ----------------------------------------------------------------------------------

/** The maker's own words, field by field. Empty fields are fine. */
export type Direction = {
  /** One entry per field: where it came from and what it says. */
  words: { from: string; text: string }[];
  /** Defaults the maker switched off by name (default ids); floors are never switched. */
  defaults?: string[];
};

/** Words that turn a phrase into a refusal: "no glass", "never full-height", "avoid parallax". */
const NEGATION =
  /\b(?:no|not|never|avoid|avoids|avoiding|without|nothing|none|don'?t|do not|doesn'?t|skip|ban|banned|instead of|rather than|less|fewer|stop|forbid|forbidden)\b/i;

/** A field split into clauses, so "no glass, but a full-height opener" is two decisions. */
function clauses(text: string): string[] {
  return text
    .split(/[.;,!?\n()]+|\s+(?:but|and then|however|although|though|while)\s+/i)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const clip = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The first clause of `text` where `pattern` matches and nothing before it in the clause refuses. */
function liftingClause(text: string, pattern: RegExp): string | null {
  for (const clause of clauses(text)) {
    const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(clause);
    if (!match) continue;
    if (NEGATION.test(clause.slice(0, match.index))) continue;
    // "glass-free", "parallax-free": a refusal written after the word.
    if (/^[- ]?(?:free|less)\b/i.test(clause.slice(match.index + match[0].length))) continue;
    return clip(clause);
  }
  return null;
}

/**
 * The defaults the maker's words lift, each with the phrase that lifted it, in the order of
 * DEFAULTS. A default lifts when one of its patterns is found in a clause no negation precedes,
 * when the maker names it in `defaults`, or when a default it follows lifts. Floors never lift.
 */
export function liftedDefaults(direction: Direction): Lift[] {
  const found = new Map<string, Lift>();
  for (const id of direction.defaults ?? []) {
    if (isDefault(id) && !found.has(id)) {
      found.set(id, { id, phrase: 'switched off by name', from: 'defaults' });
    }
  }
  for (const rule of DEFAULTS) {
    if (found.has(rule.id) || !rule.liftWhen?.length) continue;
    for (const { from, text } of direction.words) {
      if (!text?.trim()) continue;
      const phrase = rule.liftWhen.map(pattern => liftingClause(text, pattern)).find(Boolean);
      if (phrase) {
        found.set(rule.id, { id: rule.id, phrase, from });
        break;
      }
    }
  }
  for (const rule of DEFAULTS) {
    if (found.has(rule.id)) continue;
    const by = rule.follows?.map(id => found.get(id)).find(Boolean);
    if (by) found.set(rule.id, { ...by, id: rule.id });
  }
  return DEFAULTS.filter(rule => found.has(rule.id)).map(rule => found.get(rule.id)!);
}

/** The lift of one default, or undefined when it holds. */
export function liftOf(lifts: readonly Lift[] | null | undefined, id: string): Lift | undefined {
  return lifts?.find(lift => lift.id === id);
}

/** The ids lifted. */
export const liftedIds = (lifts: readonly Lift[] | null | undefined): string[] =>
  (lifts ?? []).map(lift => lift.id);

/** "the maker asked for "a glass header"", as every reworded line says it. */
export const askedFor = (lift: Lift) => `the maker asked for "${lift.phrase}"`;

/** The iteration's record: every default kept, and each lifted one with its phrase. */
export function houseRecord(lifts: readonly Lift[]): HouseRecord {
  const lifted = new Set(liftedIds(lifts));
  return {
    used: DEFAULTS.filter(rule => !lifted.has(rule.id)).map(rule => rule.id),
    lifted: [...lifts]
  };
}

/** A stored record read back, or null when there is none or it cannot be read. */
export function readHouseRecord(raw: unknown): HouseRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as { used?: unknown; lifted?: unknown };
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const used = Array.isArray(source.used) ? source.used.filter(isDefault) : [];
  const lifted = (Array.isArray(source.lifted) ? source.lifted : [])
    .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>) : {}))
    .map(item => ({ id: text(item.id), phrase: text(item.phrase), from: text(item.from) }))
    .filter(item => isDefault(item.id));
  return { used, lifted };
}
