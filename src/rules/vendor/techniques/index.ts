// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/index.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The technique library (ROUGHBOOK-STUDIO-POWER-PLAN.md, SP4): tested recipes a sketch starts
// from and adapts to its look, seeded from reports/Expressive web audit.html, Parts 2 and 3.
// Entries are presets, never limits. New entries come from runs that worked, kept only when the
// owner approves.
import { DEPTH_TECHNIQUES } from './depth.js';
import { INTERACTION_TECHNIQUES } from './interaction.js';
import { LAYOUT_TECHNIQUES } from './layout.js';
import { MATERIAL_TECHNIQUES } from './material.js';
import { MOTION_TECHNIQUES } from './motion.js';
import { SURFACE_TECHNIQUES } from './surface.js';
import { TECHNIQUE_CHECKS, type Technique } from './types.js';

export * from './types.js';

export const TECHNIQUES: Technique[] = [
  ...MATERIAL_TECHNIQUES,
  ...SURFACE_TECHNIQUES,
  ...LAYOUT_TECHNIQUES,
  ...DEPTH_TECHNIQUES,
  ...MOTION_TECHNIQUES,
  ...INTERACTION_TECHNIQUES
];

/** The prompt's line for the library; the sketch prompt carries it beside the tool. */
export const TECHNIQUE_RULE =
  "For an expressive effect (a material, a ground, 3D or a shader, scroll or type motion, a micro-interaction, video or animation files), call the technique tool first and start from the matching entry, adapting its code to this look's variables and keeping its reduced-motion, 390 px and fallback floors. The entries are presets, not limits: combine them, or go beyond them when the direction asks.";

/**
 * The same line for an iteration written in the client's own app (ROUGHBOOK-STUDIO-PARITY-PLAN.md,
 * T2, decision 1): the studio's technique tool gives the entry, the app's own components, tokens
 * and installed libraries carry it, and nothing is installed; a library the entry needs that the
 * app lacks is named for the designer to add.
 */
export const TECHNIQUE_APP_RULE =
  "For an expressive effect (a material, a ground, 3D or a shader, scroll or type motion, a micro-interaction, video or animation files), call the technique tool (the roughbook MCP tool) first and start from the matching entry, adapting its code to this look and to the app: use its own components, tokens and the libraries it already has, and keep the entry's reduced-motion, 390 px and fallback floors. Install nothing. Where the entry needs a library the app does not have, build the effect without it or leave it out, and name the missing library when you finish, so the designer can add it. The entries are presets, not limits: combine them, or go beyond them when the direction asks.";

/** An entry by id or by name, ignoring case, spaces and dashes. */
export function techniqueByName(name: string): Technique | undefined {
  const key = squash(name);
  return TECHNIQUES.find(item => squash(item.id) === key || squash(item.name) === key);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STOP = new Set(
  'a an the and or for of on in at by with over under behind to from my our your that this some like want need make use using is be it as page section site one'.split(
    ' '
  )
);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .map(word => word.replace(/^\.+|\.+$/g, ''))
      .filter(word => word.length > 1 && !STOP.has(word))
      .map(stem)
  );
}

/** How well an entry answers a need: keywords count most, then name and styles, then summary. */
function score(entry: Technique, need: string, asked: Set<string>): number {
  const fields: [Set<string>, number][] = [
    [words(entry.keywords.join(' ')), 3],
    [words(`${entry.name} ${entry.id.replace(/-/g, ' ')}`), 2],
    [words(entry.styles.join(' ').replace(/-/g, ' ')), 2],
    [words(entry.summary), 1]
  ];
  let total = 0;
  for (const word of asked) {
    total += Math.max(0, ...fields.map(([set, weight]) => (set.has(word) ? weight : 0)));
  }
  const text = ` ${need.toLowerCase()} `;
  for (const phrase of entry.keywords) {
    if (phrase.includes(' ') && text.includes(` ${phrase} `)) total += 2;
  }
  return total;
}

/** The best one to three entries for a need in free words, best first; none when nothing matches. */
export function techniquesForNeed(need: string): Technique[] {
  const asked = words(need);
  if (!asked.size) return [];
  const ranked = TECHNIQUES.map(entry => ({ entry, points: score(entry, need, asked) }))
    .filter(item => item.points > 0)
    .sort((a, b) => b.points - a.points);
  const top = ranked[0]?.points ?? 0;
  if (top < 2) return [];
  return ranked
    .filter(item => item.points >= Math.max(2, top / 2))
    .slice(0, 3)
    .map(item => item.entry);
}

/** The library's list: ids, names and one-line summaries. */
export function techniqueList(): string {
  return [
    'Technique library. Each entry is a tested starting point: adapt it to the look, combine entries, or go beyond them.',
    "Call with name for an entry's code, needs, cost, floors and checks; with need for the best matches.",
    '',
    ...TECHNIQUES.map(item => `- ${item.id}: ${item.name}. ${item.summary}`)
  ].join('\n');
}

function extension(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

/** One entry in full, as the tool returns it. */
export function formatTechnique(entry: Technique): string {
  return [
    `# ${entry.name} (${entry.id})`,
    `Styles: ${entry.styles.join(', ')}`,
    entry.summary,
    '',
    `Use: ${entry.use}`,
    '',
    'Needs:',
    `- Packages: ${entry.needs.packages.length ? entry.needs.packages.join(', ') : 'none beyond React'}`,
    `- Browsers: ${entry.needs.browsers}`,
    `- Assets: ${entry.needs.assets}`,
    '',
    `Cost: ${entry.cost.bytes} Phone: ${entry.cost.phone}`,
    '',
    'Floors (keep these whatever you change):',
    `- Reduced motion: ${entry.floors.reducedMotion}`,
    `- 390 px: ${entry.floors.phone}`,
    `- Fallback: ${entry.floors.fallback}`,
    '',
    'Checks measured when this is used:',
    ...entry.checks.map(check => `- ${check.id}: ${check.what} (${TECHNIQUE_CHECKS[check.id]})`),
    '',
    "Code. Start here and adapt it to the look: rename, move files, change the shape and the words. Colours, fonts, corners, space and motion stay on the look's variables.",
    ...entry.code.flatMap(file => [
      '',
      `${file.path}:`,
      `\`\`\`${extension(file.path)}`,
      file.content.trimEnd(),
      '```'
    ])
  ].join('\n');
}
