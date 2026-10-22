// Doctor's own sample iterations: where they are written while it runs, and what they hold, from
// the recipe or from the setup run's templates in rough/setup/sample/.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import type { Recipe } from '../recipes/types.js';
import { moduleOf } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';

/**
 * Where doctor's own iterations live while it runs: a page of its own, this name and a short id
 * new each run, and one component.
 */
export const DOCTOR_PAGE = 'doctor-check';
export const DOCTOR_COMPONENT = 'sample';
export const GOOD = 'iteration-01';
export const BROKEN = 'iteration-02';
/** The third sample, written during the speed check: a finished run, as the studio sees one. */
export const SPEED = 'iteration-03';
export const MISSING = 'iteration-99';

/** The stand-ins a setup run's sample iteration carries, which doctor fills before rendering it. */
export const SAMPLE_MARKER = '{{roughbook:marker}}';
export const SAMPLE_FIXTURE = '{{roughbook:fixture}}';
/**
 * The sample's own key, `<page>/<component>/<iteration>`, and the same as a dotted module path
 * (`doctor_check_1a2b.sample.iteration_01`), for a stack whose files name their own package: the
 * page doctor writes under is named anew each run, so a sample cannot spell either out.
 */
export const SAMPLE_KEY = '{{roughbook:key}}';
export const SAMPLE_MODULE = '{{roughbook:module}}';

export type SampleInput = { marker: string; fixtureNote: string; key: string };

/** One sample iteration's files, by name, for the key it is written at. */
export type SampleSource = (which: 'good' | 'broken', input: SampleInput) => Record<string, string>;

/**
 * Where doctor's samples come from: the recipe, which knows how to write an iteration in its
 * stack, or, for a stack with no recipe, the setup run's rough/setup/sample/good/ (renders the
 * marker and its fixture) and rough/setup/sample/broken/ (fails to render), their files flat, with
 * the stand-ins filled. Null when the setup's samples are missing or empty.
 */
export function sampleSource(
  repoRoot: string,
  environment: RepoEnvironment,
  recipe: Recipe | null
): SampleSource | null {
  if (recipe) return (which, input) => recipe.doctorSamples(input)[which];
  const read = (which: string): Record<string, string> | null => {
    const dir = path.join(repoRoot, ROUGH_DIR, 'setup', 'sample', which);
    if (!fs.existsSync(dir)) return null;
    const files: Record<string, string> = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) files[entry.name] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    }
    return Object.keys(files).length ? files : null;
  };
  const templates = { good: read('good'), broken: read('broken') };
  if (
    !templates.good ||
    !templates.broken ||
    !templates.good[environment.entry] ||
    !templates.broken[environment.entry]
  ) {
    return null;
  }
  return (which, input) =>
    Object.fromEntries(
      Object.entries(templates[which]!).map(([name, content]) => [
        name,
        content
          .replaceAll(SAMPLE_MARKER, () => input.marker)
          .replaceAll(SAMPLE_FIXTURE, () => input.fixtureNote)
          .replaceAll(SAMPLE_MODULE, () => moduleOf(input.key))
          .replaceAll(SAMPLE_KEY, () => input.key)
      ])
    );
}

/**
 * The sample iterations a setup run wrote for a stack with no recipe, filled for doctor's usual
 * keys; null when either is missing or empty.
 */
export function setupSamples(
  repoRoot: string,
  environment: RepoEnvironment,
  input: { marker: string; fixtureNote: string },
  page: string = DOCTOR_PAGE
): { good: Record<string, string>; broken: Record<string, string> } | null {
  const source = sampleSource(repoRoot, environment, null);
  if (!source) return null;
  return {
    good: source('good', { ...input, key: `${page}/${DOCTOR_COMPONENT}/${GOOD}` }),
    broken: source('broken', { ...input, key: `${page}/${DOCTOR_COMPONENT}/${BROKEN}` })
  };
}

/** Removes every folder doctor made under rough/: this run's, or a crashed run's. */
export function clearDoctorFolders(repoRoot: string): void {
  const rough = path.join(repoRoot, ROUGH_DIR);
  if (!fs.existsSync(rough)) return;
  for (const entry of fs.readdirSync(rough)) {
    if (entry === DOCTOR_PAGE || entry.startsWith(`${DOCTOR_PAGE}-`)) {
      fs.rmSync(path.join(rough, entry), { recursive: true, force: true });
    }
  }
}
