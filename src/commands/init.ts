import path from 'node:path';
import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import type { OrgProjects } from '../api/types.js';
import { ENVIRONMENT_FILE, hasEnvironmentFile, readEnvironment } from '../environment/read.js';
import { askYesNo, confirm, type Io } from '../io.js';
import { describeDetection, detectStack } from '../recipes/detect.js';
import { RECIPES, fallbackRecipe, recipeFor } from '../recipes/index.js';
import { supportNote } from '../recipes/support.js';
import { changedLines } from '../repo/diff.js';
import { gitInit } from '../repo/git.js';
import { readLocalLink, readRepoLink, writeLocalLink, type RepoLink } from '../repo/link.js';
import { applyPrep, checkRepo, planPrep, type PrepPlan } from '../repo/prep.js';
import { ROUGH_DIR, appRoot } from '../repo/root.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { openApi, type Command, type CommandContext } from './context.js';
import { runDoctorHere } from './doctor.js';
import { applyTemplates, approveEnvironment, startSetupRun } from './setup.js';

type Choice = { orgId: string; orgName: string; slug: string; name: string };

type InitOptions = {
  project?: string;
  new?: string;
  org?: string;
};

/** The lines of an edit shown under it, at most this many. */
const SHOWN_LINES = 12;

/**
 * The choice an answer to "Which project?" names: its number, or its name, slug or whole line in
 * any case; "n", or the new choice's own words, for a new project. Null when it names none.
 */
function answered(all: Choice[], answer: string): Choice | 'new' | null {
  const text = answer.replace(/\s+/g, ' ').trim().toLowerCase();
  if (text === 'n') return 'new';
  if (/^\d+$/.test(text)) return all[Number(text) - 1] ?? null;
  const named = all.filter(choice =>
    [choice.name, choice.slug, `${choice.name} (${choice.slug})`].some(
      label => label.toLowerCase() === text
    )
  );
  if (named.length > 1) throw new Error(`Several projects are called ${answer}. Type its number.`);
  if (named.length) return named[0]!;
  return /^(a )?new( project)?$/.test(text) ? 'new' : null;
}

async function chooseProject(
  api: StudioApi,
  io: Io,
  options: InitOptions,
  existing: RepoLink | null
): Promise<Choice> {
  const editable = (await api.projects()).filter(org => org.role !== 'viewer');
  if (!editable.length) {
    throw new Error('You can only view your organizations. Ask an owner to make you an editor.');
  }
  const orgs = options.org ? editable.filter(org => org.id === options.org) : editable;
  if (!orgs.length) throw new Error(`You cannot edit an organization with the id ${options.org}.`);

  const create = async (org: OrgProjects, name: string): Promise<Choice> => {
    const { slug } = await api.createProject(org.id, name);
    io.out(`Created the project ${name} (${slug}) in ${org.name}.`);
    return { orgId: org.id, orgName: org.name, slug, name };
  };
  const pickOrg = async (): Promise<OrgProjects> => {
    if (orgs.length === 1) return orgs[0]!;
    io.out('Which organization is it for?');
    orgs.forEach((org, index) => io.out(`  ${index + 1}. ${org.name}`));
    const answer = await io.ask('Organization: ');
    const org = answer === null ? undefined : orgs[Number(answer) - 1];
    if (!org) throw new Error('Pass --org <id> to choose the organization.');
    return org;
  };

  if (options.new) return create(await pickOrg(), options.new);

  const all = orgs.flatMap(org =>
    org.projects.map(project => ({
      orgId: org.id,
      orgName: org.name,
      slug: project.slug,
      name: project.name
    }))
  );
  if (options.project) {
    const matches = all.filter(choice => choice.slug === options.project);
    if (matches.length === 1) return matches[0]!;
    if (!matches.length) throw new Error(`No project ${options.project} that you can edit.`);
    throw new Error(
      `Several organizations have a project ${options.project}. Add --org with one of: ${matches.map(choice => `${choice.orgId} (${choice.orgName})`).join(', ')}.`
    );
  }
  if (existing && !options.org) {
    const linked = all.find(
      choice => choice.orgId === existing.orgId && choice.slug === existing.project
    );
    if (linked) return linked;
    io.err('rough/roughbook.json names a project you cannot edit. Choose another.');
  }

  io.out('Which project does this repo work on?');
  all.forEach((choice, index) =>
    io.out(
      `  ${index + 1}. ${choice.name} (${choice.slug})${orgs.length > 1 ? ` in ${choice.orgName}` : ''}`
    )
  );
  io.out('  n. A new project');
  const answer = await io.ask('Project: ');
  if (answer === null) {
    throw new Error('Pass --project <slug> or --new <name> when nobody can answer questions.');
  }
  const chosen = answered(all, answer);
  if (chosen === 'new') {
    const name = await io.ask('Name of the new project: ');
    if (!name) throw new Error('A new project needs a name.');
    const org = await pickOrg();
    if (!(await confirm(io, `Create a new project called "${name}" in ${org.name}?`, true))) {
      throw new Error('No project was created. Run roughbook init again to choose one.');
    }
    return create(org, name);
  }
  if (!chosen) {
    throw new Error(
      `There is no choice ${answer}. Answer with a project's number, name or slug, or n for a new project.`
    );
  }
  return chosen;
}

function printPlan(io: Io, plan: PrepPlan): void {
  if (!plan.changes.length) io.out(`${plan.repo} is ready. Nothing to change.`);
  else io.out(`Changes in ${plan.repo}:`);
  for (const change of plan.changes) {
    io.out(`  ${change.action === 'create' ? '+' : '~'} ${change.file}: ${change.summary}`);
    if (change.action !== 'edit') continue;
    const before = plan.before[change.file] ?? '';
    const { removed, added } = changedLines(before, change.after);
    const lines = [
      ...removed.map(line => `      - ${line}`),
      ...added.map(line => `      + ${line}`)
    ];
    for (const line of lines.slice(0, SHOWN_LINES)) io.out(line);
    if (lines.length > SHOWN_LINES) io.out(`      … ${lines.length - SHOWN_LINES} more lines`);
  }
  for (const step of plan.manual) io.out(`  ! By hand: ${step}`);
}

/** Whether the app answers at its address now, so doctor can run at the end of init. */
async function appAnswers(context: CommandContext, url: string): Promise<boolean> {
  try {
    const response = await (context.fetch ?? fetch)(`${url.replace(/\/+$/, '')}/`, {
      signal: AbortSignal.timeout(3000),
      redirect: 'manual'
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export const init: Command = {
  name: 'init',
  summary: 'Link this repo to a Roughbook project and prepare it, showing every change first',
  usage:
    'init [--project <slug> | --new <name>] [--org <id>] [--commit | --no-commit] [--yes] [--setup | --no-setup] [--recipe <id>] [--scratch <dir>]',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        project: { type: 'string' },
        new: { type: 'string' },
        org: { type: 'string' },
        commit: { type: 'boolean' },
        'no-commit': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        setup: { type: 'boolean' },
        'no-setup': { type: 'boolean' },
        agent: { type: 'string' },
        recipe: { type: 'string' },
        scratch: { type: 'string' }
      }
    });
    if (values.commit && values['no-commit']) throw new Error('Choose --commit or --no-commit.');
    if (values.setup && values['no-setup']) throw new Error('Choose --setup or --no-setup.');
    if (values.project && values.new) throw new Error('Choose --project or --new.');
    const named = values.recipe === undefined ? undefined : recipeFor(values.recipe);
    if (named === null) {
      throw new Error(
        `No recipe ${values.recipe}. The recipes are ${RECIPES.map(item => item.id).join(', ')}.`
      );
    }

    const { api, credentials } = await openApi(context);
    if (!credentials) throw new Error('Not signed in. Run roughbook login first.');

    let repo: string;
    if (values.scratch) {
      repo = path.resolve(context.cwd, values.scratch);
      // The fallback recipe's minimal app, written without the network; roughbook new runs a
      // recipe's own scaffold instead.
      const scratch = fallbackRecipe.scratch;
      if (!scratch) throw new Error(`${fallbackRecipe.name} has no scratch app to write.`);
      scratch.write(repo);
      io.out(scratch.written(repo));
      if (await gitInit(repo)) io.out('Started a git repository there.');
      else io.out('git was not found, so no repository was started. rough/ needs git to be kept.');
    } else {
      repo = context.repoRoot ?? appRoot(context.cwd);
    }
    const problems = checkRepo(repo);
    if (problems.length) {
      for (const problem of problems) io.err(problem);
      return 1;
    }

    // Detection: the marker files' guess, shown before anything is written (decision 6).
    const detected = detectStack(repo);
    for (const line of describeDetection(detected)) io.out(line);
    const existing = await readRepoLink(repo).catch(() => null);
    // A repo with an environment file: a teammate's clone, or one whose setup run is done. Its
    // environment names the recipe, or none; detection decides only when there is no file yet.
    const existingEnvironment = hasEnvironmentFile(repo)
      ? await readEnvironment(repo, existing).catch(() => null)
      : null;
    // --recipe names it over detection's guess (roughbook new passes the one it scaffolded).
    const recipe = existingEnvironment
      ? recipeFor(existingEnvironment.recipe)
      : (named ?? recipeFor(detected.recipe));
    if (existingEnvironment) {
      io.out(
        `${ROUGH_DIR}/${ENVIRONMENT_FILE} is here: ${recipe ? `the ${recipe.name} recipe` : "your team's own setup"}, ${existingEnvironment.mode} previews.`
      );
    } else if (recipe) {
      io.out(`The ${recipe.name} recipe fits: init writes its preview setup.`);
      const note = supportNote(recipe.id);
      if (note) io.out(`The ${recipe.name} recipe is ${note}.`);
    } else {
      io.out(
        `No recipe fits${detected.guess ? ` ${detected.guess}` : ''}: your agent builds the preview setup in a setup run (roughbook setup), and roughbook doctor checks it.`
      );
    }

    const choice = await chooseProject(api, io, values, existing);
    let committed: boolean;
    if (values.commit || values['no-commit']) committed = Boolean(values.commit);
    else if (existing) committed = existing.roughCommitted;
    else if (values.yes) committed = true;
    else {
      // A choice, not an approval: with nobody to answer it keeps the default, and nothing is
      // written without the yes to apply below.
      committed =
        (await askYesNo(
          io,
          'Commit rough/ to git? It is the only record of your iterations.',
          true
        )) ?? true;
    }
    if (!committed) {
      io.out('rough/ will be ignored by git, so nothing backs up its iterations.');
    }

    const stack = existingEnvironment?.stack.length ? existingEnvironment.stack : detected.stack;
    const family = existingEnvironment?.family ?? detected.family;
    const plan = planPrep(repo, {
      link: {
        version: 1,
        orgId: choice.orgId,
        project: choice.slug,
        roughCommitted: committed,
        ...(stack.length ? { stack } : {}),
        ...(stack.length || existingEnvironment ? { family } : {})
      },
      recipe
    });
    if (plan.problems.length) {
      for (const problem of plan.problems) io.err(problem);
      return 1;
    }
    printPlan(io, plan);
    if (plan.changes.length && !values.yes) {
      const answer = await io.ask(
        `Apply ${plan.changes.length === 1 ? 'this change' : `these ${plan.changes.length} changes`}? [Y/n] `
      );
      if (answer === null || (answer && !/^y(es)?$/i.test(answer))) {
        io.out('Nothing was written. Run again with --yes to apply these changes.');
        return answer === null ? 1 : 0;
      }
    }

    const local = await readLocalLink(repo);
    const sameLink =
      local?.installId === credentials.installId &&
      existing?.orgId === choice.orgId &&
      existing.project === choice.slug &&
      existing.roughCommitted === committed;
    let linkId = local?.linkId ?? null;
    if (!sameLink || !linkId) {
      // The server hears the tokens and the family, never a path (decision 15).
      const linked = await api.link(choice.orgId, {
        project: choice.slug,
        framework: detected.framework,
        roughCommitted: committed,
        ...(stack.length ? { stack } : {}),
        ...(stack.length || existingEnvironment ? { family } : {}),
        ...(existingEnvironment ? { mode: existingEnvironment.mode } : {})
      });
      linkId = linked.linkId;
    }
    applyPrep(plan);
    // A run still open did not make these changes, so its Done does not count them.
    await recordOwnWritesForOpenRuns(
      repo,
      plan.changes.map(change => change.file)
    );
    await writeLocalLink(repo, {
      linkId,
      installId: credentials.installId,
      linkedAt: new Date().toISOString()
    });
    io.out(`Linked to ${choice.name} (${choice.slug}) in ${choice.orgName}.`);
    if (plan.changes.length) {
      io.out(
        `Applied ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}; review them with git diff.`
      );
    }

    const link = (await readRepoLink(repo))!;
    const repoContext = { ...context, repoRoot: repo };
    // A clone, or a repo set up before: the templates go into place without an agent, the
    // commands are approved here, and doctor runs when the app answers (decision 28).
    if (existingEnvironment && !recipe) {
      if (!(await applyTemplates(repoContext, repo, existingEnvironment, Boolean(values.yes)))) {
        return 1;
      }
    }
    if (existingEnvironment || recipe) {
      const environment = existingEnvironment ?? recipe!.environment(link);
      await approveEnvironment(repoContext, repo, environment, Boolean(values.yes));
      if (await appAnswers(context, environment.start.url)) {
        io.out(`The app answers at ${environment.start.url}; running roughbook doctor.`);
        await runDoctorHere(repoContext, repo, link, { yes: values.yes });
      } else {
        io.out(
          `Next, start the app${environment.start.command ? ` (${environment.start.command})` : ''} and run roughbook doctor, then roughbook start.`
        );
      }
      return 0;
    }

    // No recipe and no environment yet: the setup run builds the preview (decision 8).
    const wantSetup =
      values.setup ||
      (!values['no-setup'] &&
        !values.yes &&
        (await confirm(io, 'Start the setup run now, with your agent?', true)));
    if (wantSetup) {
      return startSetupRun(repoContext, api, repo, link, { kind: 'setup', agent: values.agent });
    }
    io.out('Next, run roughbook setup to have your agent build the preview setup.');
    return 0;
  }
};
