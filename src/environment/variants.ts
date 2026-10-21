// The environment's variants (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 33): words such as `light`,
// `dark`, `en`, `ar` or `large-text`, which the frame and the screenshots cover. Each word is
// read here as what it asks of the preview, and reaches it as the contract's query parameters,
// the same on every stack; the screenshot emulates what the browser can (the colour scheme, the
// locale) and the preview setup applies the rest (the text direction, its own words).

export type ResolvedVariant = {
  /** The word as the environment names it. */
  id: string;
  /** The word as a button shows it. */
  label: string;
  scheme: 'light' | 'dark' | null;
  dir: 'ltr' | 'rtl' | null;
  /** A language tag, as the preview's `lang` and the browser's locale. */
  lang: string | null;
  text: 'large' | null;
};

/** The query parameters that carry a variant to the preview (rough/CONTRACT.md, point 2). */
export const VARIANT_PARAMS = {
  scheme: 'roughbook-scheme',
  dir: 'roughbook-dir',
  lang: 'roughbook-lang',
  text: 'roughbook-text',
  word: 'roughbook-variant'
} as const;

/** Languages written right to left, by their language subtag. */
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

const LANGUAGE_TAG = /^([a-z]{2,3})(?:-([a-z0-9]{2,8}))?$/;

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** What one variant word asks of the preview. */
export function describeVariant(word: string): ResolvedVariant {
  const id = word.trim().toLowerCase();
  const none = { scheme: null, dir: null, lang: null, text: null } as const;
  if (id === 'light' || id === 'dark') {
    return { id, label: capitalized(id), ...none, scheme: id };
  }
  if (id === 'large-text' || id === 'text-large' || id === 'large') {
    return { id, label: 'Large text', ...none, text: 'large' };
  }
  const tag = LANGUAGE_TAG.exec(id);
  if (tag) {
    const language = tag[1]!;
    const region = tag[2];
    const lang = region
      ? `${language}-${region.length === 2 ? region.toUpperCase() : region}`
      : language;
    return {
      id,
      label: lang.toUpperCase(),
      ...none,
      dir: RTL.has(language) ? 'rtl' : 'ltr',
      lang
    };
  }
  return { id, label: capitalized(id.replace(/-/g, ' ')), ...none };
}

export function resolveVariants(words: string[]): ResolvedVariant[] {
  return words.map(describeVariant);
}

/** The parameters a variant adds to a preview's address; none for light, left-to-right text. */
export function variantParams(variant: ResolvedVariant): [string, string][] {
  const params: [string, string][] = [];
  if (variant.scheme === 'dark') params.push([VARIANT_PARAMS.scheme, 'dark']);
  if (variant.dir === 'rtl') params.push([VARIANT_PARAMS.dir, 'rtl']);
  if (variant.lang) params.push([VARIANT_PARAMS.lang, variant.lang]);
  if (variant.text === 'large') params.push([VARIANT_PARAMS.text, 'large']);
  const resolved =
    variant.scheme !== null ||
    variant.dir !== null ||
    variant.lang !== null ||
    variant.text !== null;
  if (!resolved) params.push([VARIANT_PARAMS.word, variant.id]);
  return params;
}

/** A preview's address in one variant: its parameters after whatever query the address has. */
export function withVariant(url: string, variant: ResolvedVariant | null): string {
  const params = variant ? variantParams(variant) : [];
  if (!params.length) return url;
  const [base, hash = ''] = url.split(/(#.*)/s, 2);
  const query = new URLSearchParams(params).toString();
  return `${base}${base!.includes('?') ? '&' : '?'}${query}${hash}`;
}

/**
 * The name of a screenshot at one viewport in one variant: the viewport alone for the first
 * variant (`desktop`, as before variants), the variant after it for the others (`desktop-dark`).
 */
export function screenshotName(
  viewport: string,
  variant: ResolvedVariant | null,
  variants: ResolvedVariant[]
): string {
  if (!variant || variants[0]?.id === variant.id) return viewport;
  return `${viewport}-${variant.id}`;
}

/** Every screenshot an environment asks for: each viewport in each variant, in that order. */
export function screenshotSet(
  viewports: { name: string }[],
  words: string[]
): { name: string; viewport: string; variant: ResolvedVariant | null }[] {
  const variants = resolveVariants(words);
  const list = variants.length ? variants : [null];
  const set: { name: string; viewport: string; variant: ResolvedVariant | null }[] = [];
  for (const variant of list) {
    for (const viewport of viewports) {
      set.push({
        name: screenshotName(viewport.name, variant, variants),
        viewport: viewport.name,
        variant
      });
    }
  }
  return set;
}
