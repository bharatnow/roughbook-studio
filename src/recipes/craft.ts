// What a local prompt's rules ask of a stack's craft (the backend's {{roughbook:craft}} and
// {{roughbook:primitives}}): local prompts go to any stack since F3 of the frameworks plan, and the
// floor a web page needs (native elements, color-scheme, transition: all) means nothing to a
// toolkit that draws its own controls. A recipe says its own; a repo set up by none gets its
// family's. Kept here, among the recipes, since it names each toolkit's own ways (the guard).
import type { Family, RepoEnvironment } from '../environment/types.js';

export type CraftWords = {
  /** The floor's paragraph: controls and their names, headings, states, targets, colors, motion and media. */
  floor: string;
  /** What follows "Reuse the app's own components and primitives": ", such as …", or nothing. */
  primitives: string;
};

/**
 * A web page's floor, as the backend gives every sketch and every recorded local prompt has it:
 * the words a React app on the web was always told, byte for byte.
 */
export const WEB_FLOOR = `Use native elements (button, a, input, label) and label every control. Keep headings in
order. Give every control hover, focus-visible, active and disabled styles, make every target at
least 24 px, and keep inputs at 16 px or more on phones. Set color-scheme with the colors.
Give every animation a reduced-motion path, animate only transform and opacity, and never use
transition: all.
Reserve the space of every image and video, never lazy-load the first image, and load only the
font weights you use.`;

/** What a React app on the web reuses: the primitives the recorded prompts name. */
export const REACT_WEB_CRAFT: CraftWords = {
  floor: WEB_FLOOR,
  primitives: ', such as shadcn/ui, Radix or Base UI'
};

/** Any other web page: the same floor, and no React library. */
const MARKUP_CRAFT: CraftWords = { floor: WEB_FLOOR, primitives: '' };

const FLUTTER_FLOOR = `Use Flutter's own widgets for controls (the Material or Cupertino buttons, TextField,
Checkbox) and give every control a name a screen reader reads: its text, a tooltip or a Semantics
label. Mark headings with Semantics(header: true), in order. Give every control pressed, focused
and disabled states, and make every target at least 48 by 48 logical pixels. Take colors from the
app's Theme, so the dark variant follows, and let text scale with the system's text size.
Give every animation a reduced-motion path (MediaQuery.disableAnimationsOf), and animate only
transforms and opacity.
Give every image its size before it loads, and bundle only the font weights you use.`;

const SWIFTUI_FLOOR = `Use SwiftUI's own controls (Button, Toggle, TextField, Link) and give every control a name
VoiceOver reads: its text, or an accessibilityLabel. Mark headings with
.accessibilityAddTraits(.isHeader), in order. Give every control pressed, focused and disabled
states, and make every target at least 44 by 44 points. Take colors from the app's assets or the
semantic colors, so Dark Mode follows, and set text in text styles, so Dynamic Type does.
Give every animation a reduced-motion path (accessibilityReduceMotion), and animate only
position, scale, rotation and opacity.
Give every image its frame before it loads, and bundle only the font weights you use.`;

const COMPOSE_FLOOR = `Use Compose's own components (Material's Button, IconButton, TextField, Checkbox) and give
every control a name TalkBack reads: its text, or a contentDescription. Mark headings with
Modifier.semantics { heading() }, in order. Give every control pressed, focused and disabled
states, and make every target at least 48 by 48 dp. Take colors and type from the app's
MaterialTheme, so the dark theme follows, and size text in sp, so it scales with the system.
Give every animation a reduced-motion path, for when the system's animations are off, and
animate only graphicsLayer transforms and alpha.
Give every image its size before it loads, and bundle only the font weights you use.`;

/** For a stack the studio knows nothing of: what holds on any platform. */
const NEUTRAL_FLOOR = `Use the platform's own controls and give every control a name a screen reader reads. Mark
headings as headings, in order. Give every control focused, pressed and disabled states, and
make every target big enough to hit with a finger. Follow the system's light and dark appearance
with the colors, and let text scale with the system's text size.
Give every animation a reduced-motion path, and animate only transforms and opacity.
Reserve the space of every image and video, and load only the font weights you use.`;

const FAMILY_CRAFT: Record<Family, CraftWords> = {
  'react-like': REACT_WEB_CRAFT,
  'markup-css': MARKUP_CRAFT,
  flutter: { floor: FLUTTER_FLOOR, primitives: '' },
  swiftui: { floor: SWIFTUI_FLOOR, primitives: '' },
  compose: { floor: COMPOSE_FLOOR, primitives: '' },
  unknown: { floor: NEUTRAL_FLOOR, primitives: '' }
};

/** A family's words, for a repo no recipe set up. */
export function familyCraft(family: Family): CraftWords {
  return FAMILY_CRAFT[family];
}

/**
 * The words a repo's prompts get: its recipe's, or its family's. A family the studio does not know
 * gets nothing of any one stack, unless the studio's own page shows its iterations: that is a web
 * page, whatever the stack (standalone mode shows HTML and React entries).
 */
export function stackCraft(
  environment: Pick<RepoEnvironment, 'family' | 'mode'>,
  recipe: { craft: CraftWords } | null
): CraftWords {
  if (recipe) return recipe.craft;
  if (environment.family === 'unknown' && environment.mode === 'standalone') return MARKUP_CRAFT;
  return familyCraft(environment.family);
}
