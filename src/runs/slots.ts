import fs from 'node:fs';
import path from 'node:path';
import { defaultEnvironment } from '../environment/read.js';
import { fallbackRecipe } from '../recipes/index.js';
import { PLACEHOLDER_LINE } from './placeholder.js';
import { ITERATION, SLUG, iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { assertRunId } from './store.js';

export { isPlaceholder } from './placeholder.js';

/**
 * What a new slot shows in a repo no recipe set up: the one sentence every placeholder carries,
 * as plain text, so whatever the stack renders it as, the studio can tell the slot is unwritten.
 */
export function genericPlaceholder(): string {
  return `${PLACEHOLDER_LINE}\n`;
}

/** What a new slot shows until its agent has written it: the entry file, from the recipe. */
export type Placeholder = { file: string; content: string };

/** The placeholder of a repo with no environment file: its fallback recipe's. */
export function defaultPlaceholder(): Placeholder {
  const { entry } = defaultEnvironment();
  return { file: entry, content: fallbackRecipe.placeholder(entry) };
}

export function assertTarget(page: string, component: string, iteration: string): void {
  if (!SLUG.test(page) || !SLUG.test(component) || !ITERATION.test(iteration)) {
    throw new Error(`Not an iteration: ${page}/${component}/${iteration}`);
  }
}

/** Where a run's prompt is kept, repo-relative with forward slashes. Committed with rough/. */
export function promptFile(page: string, component: string, runId: string): string {
  return `${ROUGH_DIR}/${page}/${component}/prompts/${assertRunId(runId)}.md`;
}

/**
 * The one line every agent is given, whichever agent it is. A run the designer drives also says
 * how to finish it, since the line the designer pastes carries more weight than a prompt's last
 * section; an unattended run ends when its agent exits, and a promotion is not a run.
 */
export function handoffLine(prompt: string, finish = false): string {
  const follow = `Follow the instructions in ${prompt}`;
  return finish
    ? `${follow}. When the iteration is ready, finish the run with the roughbook MCP tools: get_checks, then finish_run.`
    : follow;
}

/**
 * How a run the designer drives ends, added below the backend's prompt: through the studio's MCP
 * tools when the agent has them, else by the designer. An unattended run ends when its agent
 * exits, so its prompt has none.
 */
export function finishingSection(runId: string, previewUrl: string | null = null): string {
  const devServer = previewUrl
    ? `The app's dev server is the designer's: never start, restart or stop it, or
any other process. While it runs, this iteration renders at
${previewUrl}
and finish_run takes the screenshots through it.`
    : `The app's dev server is the designer's: never start, restart or stop it, or
any other process; finish_run takes the screenshots through it.`;
  return `<finishing>
Roughbook run: ${assertRunId(runId)}
When the iteration is ready and you have the Roughbook MCP tools, call
get_checks with this run id, fix what it reports inside the target folder,
then call finish_run with it once and pass on what it says. Without those
tools, tell the designer the iteration is ready; they finish the run in the
Roughbook studio or with roughbook done. The tools are in the MCP server named
roughbook; if your editor lists or groups tools by server, open that group.
${devServer}
</finishing>
`;
}

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

function filesIn(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full, base) : [path.relative(base, full)];
  });
}

/** Whether an iteration's folder exists in rough/ with any file in it. */
export function iterationExists(repoRoot: string, page: string, component: string, id: string) {
  return filesIn(toDisk(repoRoot, iterationDir(page, component, id))).length > 0;
}

/**
 * Makes a run's folder: the placeholder for a new direction, or a copy of the parent for a fork
 * or refinement, which the agent then changes. An existing iteration is never written over.
 */
export function createSlot(
  repoRoot: string,
  slot: { page: string; component: string; iteration: string; parent: string | null },
  placeholder: Placeholder = defaultPlaceholder()
): string {
  assertTarget(slot.page, slot.component, slot.iteration);
  const relative = iterationDir(slot.page, slot.component, slot.iteration);
  const dir = toDisk(repoRoot, relative);
  if (filesIn(dir).length) {
    throw new Error(`${relative} already exists. An existing iteration is never written over.`);
  }
  if (slot.parent) {
    assertTarget(slot.page, slot.component, slot.parent);
    const from = toDisk(repoRoot, iterationDir(slot.page, slot.component, slot.parent));
    const files = filesIn(from);
    if (!files.length) {
      throw new Error(
        `${iterationDir(slot.page, slot.component, slot.parent)} is not in this repo, so it cannot be forked here.`
      );
    }
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(path.join(from, file), path.join(dir, file));
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, placeholder.file), placeholder.content);
  }
  return relative;
}

/** Writes a run's prompt beside its component, with `\n` line endings. */
export function writePrompt(repoRoot: string, file: string, prompt: string): void {
  const target = toDisk(repoRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, prompt.replace(/\r\n/g, '\n'));
}
