// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/services/sketch/tools/technique.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The technique library's tool (ROUGHBOOK-STUDIO-POWER-PLAN.md, SP4): the list, one entry by
// name, or the best entries for a need. It only reads code data, so it never fails a run.
import {
  TECHNIQUES,
  formatTechnique,
  techniqueByName,
  techniqueList,
  techniquesForNeed
} from './techniques/index.js';
import type { ExtraTool, ExtraToolOutcome } from '../vendor-shims.js';

export const TECHNIQUE_TOOL_NAME = 'technique';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The tool's answer for an input, as text. */
export function techniqueAnswer(input: Record<string, unknown>): ExtraToolOutcome {
  const name = text(input.name);
  const need = text(input.need);
  if (name) {
    const entry = techniqueByName(name);
    if (entry) return { content: formatTechnique(entry), isError: false };
    if (!need) {
      return { content: `No technique is named "${name}".\n\n${techniqueList()}`, isError: true };
    }
  }
  if (need) {
    const found = techniquesForNeed(need);
    if (!found.length) {
      return {
        content: `No entry matches "${need}": build it yourself, keeping the floors, or start from one of these.\n\n${techniqueList()}`,
        isError: false
      };
    }
    const intro =
      found.length > 1
        ? `The best ${found.length} entries for "${need}", best first. Combine them as the need asks.`
        : `The best entry for "${need}".`;
    return { content: [intro, ...found.map(formatTechnique)].join('\n\n'), isError: false };
  }
  return { content: techniqueList(), isError: false };
}

export const techniqueTool: ExtraTool | null = {
  tool: {
    name: TECHNIQUE_TOOL_NAME,
    description: `The technique library: ${TECHNIQUES.length} tested recipes (glass, clay, tactile, hard shadow, bento, editorial, 3D, shaders, scroll, view transitions, type, micro-interactions, mesh and grain, video, Rive, Lottie) with code, floors and checks. No input lists them; name returns one; need (free words) returns the best matches. Start from these and adapt; combine or go beyond them.`,
    input: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'An entry id or name.' },
        need: { type: 'string', description: 'What you need, e.g. "glass header over video".' }
      },
      additionalProperties: false
    }
  },
  async run(input) {
    return techniqueAnswer(input);
  }
};
