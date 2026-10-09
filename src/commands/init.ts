import path from 'node:path';
import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import type { OrgProjects } from '../api/types.js';
import { confirm, type Io } from '../io.js';
import { changedLines } from '../repo/diff.js';
import { appRoot, detectFramework } from '../repo/framework.js';
import { readLocalLink, readRepoLink, writeLocalLink, type RepoLink } from '../repo/link.js';
import { applyPrep, checkRepo, planPrep, type PrepPlan } from '../repo/prep.js';
import { gitInit, writeScratch } from '../repo/scratch.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { openApi, type Command } from './context.js';

type Choice = { orgId: string; orgName: string; slug: string; name: string };

type InitOptions = {
  project?: string;
  new?: string;
  org?: string;
};

/** The lines of an edit shown under it, at most this many. */
const SHOWN_LINES = 12;

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
  if (/^n(ew)?$/i.test(answer)) {
    const name = await io.ask('Name of the new project: ');
    if (!name) throw new Error('A new project needs a name.');
    return create(await pickOrg(), name);
  }
  const chosen = all[Number(answer) - 1];
  if (!chosen) throw new Error(`There is no choice ${answer}.`);
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

export const init: Command = {
  name: 'init',
  summary: 'Link this repo to a Roughbook project and prepare it, showing every change first',
  usage:
    'init [--project <slug> | --new <name>] [--org <id>] [--commit | --no-commit] [--yes] [--scratch <dir>]',
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
        scratch: { type: 'string' }
      }
    });
    if (values.commit && values['no-commit']) throw new Error('Choose --commit or --no-commit.');
    if (values.project && values.new) throw new Error('Choose --project or --new.');

    const { api, credentials } = await openApi(context);
    if (!credentials) throw new Error('Not signed in. Run roughbook login first.');

    let repo: string;
    if (values.scratch) {
      repo = path.resolve(context.cwd, values.scratch);
      writeScratch(repo);
      io.out(`Created a Next.js app in ${repo}. Run npm install there before roughbook start.`);
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

    const existing = await readRepoLink(repo).catch(() => null);
    const choice = await chooseProject(api, io, values, existing);
    let committed: boolean;
    if (values.commit || values['no-commit']) committed = Boolean(values.commit);
    else if (existing) committed = existing.roughCommitted;
    else if (values.yes) committed = true;
    else {
      committed = await confirm(
        io,
        'Commit rough/ to git? It is the only record of your iterations.',
        true
      );
    }
    if (!committed) {
      io.out('rough/ will be ignored by git, so nothing backs up its iterations.');
    }

    const plan = planPrep(repo, {
      link: { version: 1, orgId: choice.orgId, project: choice.slug, roughCommitted: committed }
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
      const linked = await api.link(choice.orgId, {
        project: choice.slug,
        framework: detectFramework(repo),
        roughCommitted: committed
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
    io.out('Next, run roughbook start.');
    return 0;
  }
};
