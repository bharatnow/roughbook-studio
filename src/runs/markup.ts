// How the markup-css family's checks read a template's markup (decision 23 of the frameworks plan:
// silence is never a pass), as the backend's utils/compile/markup.ts reads it. Blade, Vue, Liquid,
// PHP and HTML files are read as markup, as JSX is in a .tsx file: their class="…" lists, and their
// tags with the template's expressions stepped over.

/** Templates, read as markup; a Blade view's .blade.php ends in .php. */
export const MARKUP = /\.(vue|liquid|php|html)$/i;

/** An {expression} two levels deep: Blade's and Vue's {{ }}, Blade's {!! !!}, Liquid's {% %}. */
const EXPRESSION = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`;
/** PHP's <?php … ?> and <?= … ?>, whose -> and ?> do not end the tag around them; never past a <?. */
const PHP = String.raw`<\?(?:[^?<]|\?(?!>)|<(?!\?))*\?>`;
/** A quoted value, with the expressions and PHP inside it stepped over, since they may hold its quote. */
const QUOTED = (quote: string) =>
  String.raw`${quote}(?:${PHP}|${EXPRESSION}|<(?!\?)|[^${quote}{<])*${quote}`;

/**
 * A tag's attributes in a template, stepping over expressions, PHP and quoted values, so Vue's
 * `@click="() => open()"` and PHP's `$image->url` stay inside the tag. A bare < ends them, so a tag
 * left open costs no more than the text up to the next one.
 */
export const MARKUP_ATTRS = String.raw`(?:${PHP}|${EXPRESSION}|${QUOTED('"')}|${QUOTED("'")}|[^<>{}"'])*`;

/** class="…" and className="…": not Vue's bound :class, an expression, nor PHP's $class. */
const CLASS = new RegExp(
  String.raw`(?<![\w:@.$-])class(?:Name)?\s*=\s*(?:(${QUOTED('"')})|(${QUOTED("'")}))`,
  'g'
);

/** The class lists a template's tags carry, in the order they come. */
export function markupClassLists(text: string): string[] {
  return [...text.matchAll(CLASS)].map(match => (match[1] ?? match[2] ?? '').slice(1, -1));
}
