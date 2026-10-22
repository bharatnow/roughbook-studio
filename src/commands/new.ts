// `roughbook new` (decision 35 of the frameworks plan): an app of a recipe's stack from an empty
// folder. It picks a recipe, runs the recipe's scaffold (the stack's own tool where it has one),
// starts git, then runs `init` in the new folder, which links it to a project and writes the
// recipe's preview setup. A project that began
// on web sketches before it had a repo picks its stack here, and is told how to bring the sketches
// in: `pull` ports each into the stack, rebuilt by the designer's agent (F7).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hostLookup } from '../agents/index.js';
import type { Shell } from '../environment/types.js';
import { confirm } from '../io.js';
import { currentOs } from '../launch/platform.js';
import { runVisible } from '../launch/processes.js';
import { findProgramOnPath } from '../launch/which.js';
import { RECIPES, recipeFor } from '../recipes/index.js';
import { installHint } from '../recipes/tools.js';
import type { Recipe, ScaffoldStep } from '../recipes/types.js';
import { gitInit } from '../repo/git.js';
import { readRepoLink } from '../repo/link.js';
import { openApi, type Command, type CommandContext } from './context.js';
import { init } from './init.js';

/** A folder name every scaffold takes: npm's, Composer's and Gradle's rules at once. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** One step as it runs on this machine: its line and shell for this OS, and its folder. */
export type ScaffoldRun = { line: string; shell: Shell; cwd: string };

/** What `new` does outside its own files: runs a step in the terminal, finds a program. */
export type ScaffoldTools = {
  run(step: ScaffoldRun): Promise<number>;
  which(program: string): string | null;
};

function realScaffoldTools(env: NodeJS.ProcessEnv): ScaffoldTools {
  const lookup = hostLookup(env);
  return {
    run: step => runVisible(step.line, step.cwd, step.shell),
    which: program => findProgramOnPath(program, lookup)
  };
}

/** The recipes `new` can start, in the launch order. */
function scaffolded(): Recipe[] {
  return RECIPES.filter(recipe => recipe.scaffold);
}

async function chooseRecipe(context: CommandContext, named: string | undefined): Promise<Recipe> {
  const { io } = context;
  const all = scaffolded();
  if (named) {
    const recipe = recipeFor(named);
    if (!recipe?.scaffold) {
      throw new Error(
        `No recipe ${named} to start an app from. The recipes are ${all.map(item => item.id).join(', ')}.`
      );
    }
    return recipe;
  }
  io.out('Which stack is the new app on?');
  all.forEach((recipe, index) => io.out(`  ${index + 1}. ${recipe.name} (${recipe.id})`));
  const answer = (await io.ask('Stack: '))?.trim().toLowerCase();
  if (!answer) throw new Error('Name the stack: roughbook new <recipe> <folder>.');
  const chosen = /^\d+$/.test(answer)
    ? all[Number(answer) - 1]
    : all.find(recipe => recipe.id === answer || recipe.name.toLowerCase() === answer);
  if (!chosen) {
    throw new Error(
      `There is no stack ${answer}. Answer with its number or one of ${all.map(item => item.id).join(', ')}.`
    );
  }
  return chosen;
}

/** Why the app cannot be made in `dir`, or null: a file there, or a folder that is not empty. */
function folderProblem(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return `${dir} is a file.`;
  return fs.readdirSync(dir).length ? `${dir} is not empty.` : null;
}

/** A step's command line and shell on this machine, or null for files the studio writes. */
function resolved(
  step: ScaffoldStep,
  windows: boolean
): { line: string; shell: Shell; summary: string } | null {
  if (step.kind !== 'run') return null;
  return {
    line: (windows && step.windows) || step.line,
    shell: (windows && step.shellWindows) || step.shell,
    summary: step.summary
  };
}

export const create: Command = {
  name: 'new',
  summary: "Start an app of a recipe's stack in an empty folder, then link and prepare it",
  usage:
    'new [<recipe>] [<folder>] [--project <slug> | --new <name>] [--org <id>] [--commit | --no-commit] [--yes]',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        new: { type: 'string' },
        org: { type: 'string' },
        commit: { type: 'boolean' },
        'no-commit': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' }
      }
    });
    if (values.project && values.new) throw new Error('Choose --project or --new.');
    if (values.commit && values['no-commit']) throw new Error('Choose --commit or --no-commit.');
    // Nothing is made that cannot be linked: the sign-in first.
    const { credentials } = await openApi(context);
    if (!credentials) throw new Error('Not signed in. Run roughbook login first.');

    const recipe = await chooseRecipe(context, positionals[0]);
    const scaffold = recipe.scaffold!;
    const given = positionals[1] ?? (await io.ask('Folder for the new app: '))?.trim();
    if (!given) throw new Error(`Name the folder: roughbook new ${recipe.id} <folder>.`);
    const dir = path.resolve(context.cwd, given);
    const name = path.basename(dir);
    if (!NAME.test(name)) {
      throw new Error(
        `${name} cannot be the app's folder: use lowercase letters, digits and hyphens, starting with a letter or digit, as every stack's tools take.`
      );
    }
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) throw new Error(`${parent} does not exist.`);
    const problem = folderProblem(dir);
    if (problem) throw new Error(problem);

    const tools = context.scaffoldTools ?? realScaffoldTools(context.env);
    const missing = scaffold.needs.filter(program => !tools.which(program));
    if (missing.length) {
      throw new Error(
        missing.map(program => `${program} is not on the PATH: ${installHint(program)}`).join(' ')
      );
    }

    const windows = currentOs(context.platform) === 'windows';
    const steps = scaffold.steps(name);
    io.out(`A ${recipe.name} app in ${dir}, with ${scaffold.tool}:`);
    for (const step of steps) {
      const run = resolved(step, windows);
      io.out(
        run
          ? `  $ ${run.line}${step.kind === 'run' && step.in === 'app' ? ` (in ${name})` : ''}`
          : `  + ${step.summary}: ${Object.keys(step.kind === 'write' ? step.files : {}).length} files`
      );
    }
    io.out('  then git init, and roughbook init to link it and write its preview setup.');
    if (!values.yes && !(await confirm(io, 'Make it?', true))) {
      io.out('Nothing was made.');
      return 0;
    }

    for (const step of steps) {
      if (step.kind === 'write') {
        for (const [file, text] of Object.entries(step.files)) {
          const target = path.join(dir, ...file.split('/'));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, text);
        }
        continue;
      }
      const run = resolved(step, windows)!;
      const cwd = step.in === 'app' ? dir : parent;
      if (step.in === 'app') fs.mkdirSync(dir, { recursive: true });
      const code = await tools.run({ line: run.line, shell: run.shell, cwd });
      if (code !== 0) {
        throw new Error(
          `${step.summary}: ${run.line} failed (exit ${code}). Nothing was linked; fix what it reported, empty ${dir}, and run roughbook new again.`
        );
      }
    }
    if (!fs.existsSync(dir)) {
      throw new Error(`${scaffold.tool} finished, but made no folder ${dir}. Nothing was linked.`);
    }
    io.out(`Made ${name} with ${scaffold.tool}.`);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      if (await gitInit(dir)) io.out('Started a git repository there.');
      else io.out('git was not found, so no repository was started. rough/ needs git to be kept.');
    }

    // init in the new folder, with the recipe the app was made from.
    const initArgs = [
      '--recipe',
      recipe.id,
      ...(values.project ? ['--project', values.project] : []),
      ...(values.new ? ['--new', values.new] : []),
      ...(values.org ? ['--org', values.org] : []),
      ...(values.commit ? ['--commit'] : []),
      ...(values['no-commit'] ? ['--no-commit'] : []),
      ...(values.yes ? ['--yes'] : [])
    ];
    const code = await init.run(initArgs, { ...context, cwd: dir, repoRoot: dir });
    if (code !== 0) return code;
    await sketchesToPort(context, dir, recipe);
    return 0;
  }
};

/**
 * A project that began on web sketches, before this repo: the components that have them, and how
 * pull brings each in, ported into this stack. Quiet when the project has none or cannot be read.
 */
async function sketchesToPort(context: CommandContext, dir: string, recipe: Recipe): Promise<void> {
  const link = await readRepoLink(dir).catch(() => null);
  if (!link) return;
  try {
    const { api } = await openApi(context);
    const tree = await api.project(link.orgId, link.project);
    const components = tree.pages.flatMap(page =>
      page.components
        .filter(component => component.iterations.length)
        .map(component => `${page.slug}/${component.slug}`)
    );
    if (!components.length) return;
    context.io.out(
      `${tree.name} already has iterations from the web for ${components.length === 1 ? 'one component' : `${components.length} components`}. Bring a web sketch in, rebuilt in ${recipe.name} by your agent (a port):`
    );
    for (const component of components.slice(0, 8)) {
      context.io.out(`  roughbook pull ${component}`);
    }
    if (components.length > 8) context.io.out(`  … and ${components.length - 8} more.`);
  } catch {
    // The project's tree is a convenience here; the link is made either way.
  }
}
