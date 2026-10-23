// F9 of the frameworks plan: the support tiers, as support.json lists them for the site. Each
// recipe is there in the launch order, with the start command and scaffold the recipe really has,
// the programs its commands and scaffold run, and doctor's own words for installing each, so
// what the site promises cannot drift from what the studio does. Whether a recipe passes is the
// plan's record (the conformance suite's runs), not something a unit test can see.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EnvironmentOs } from '../environment/types.js';
import { programOf } from '../launch/processes.js';
import { RECIPES } from '../recipes/index.js';
import { SUPPORT, supportFor, supportNote } from '../recipes/support.js';
import { installHint } from '../recipes/tools.js';

/** The program a site visitor installs for one a command runs: npm and npx come with Node.js. */
const INSTALLED_AS: Record<string, string> = { npm: 'node', npx: 'node' };

/** Programs every system has, or that live in the repo itself, which nobody installs. */
function installable(program: string): boolean {
  return !['sh', 'bash', 'cmd.exe', 'powershell'].includes(program) && !/[\\/]/.test(program);
}

function commandPrograms(id: string, os: EnvironmentOs): string[] {
  const recipe = RECIPES.find(item => item.id === id)!;
  const environment = recipe.environment(null, os);
  const lines = [
    environment.start.command,
    environment.build.command,
    environment.production?.command,
    environment.snapshot,
    environment.device
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);
  return lines.flatMap(line => programOf(line, environment.shell)).filter(installable);
}

describe('the support tiers the site shows', () => {
  it('lists every recipe once, in the launch order, by the name the studio uses', () => {
    assert.deepEqual(
      SUPPORT.recipes.map(item => item.id),
      RECIPES.map(recipe => recipe.id)
    );
    for (const recipe of RECIPES) assert.equal(supportFor(recipe.id)?.name, recipe.name);
  });

  it('records the recipes the plan has proven as passing, and the rest with their reason', () => {
    const passing = SUPPORT.recipes.filter(item => item.status === 'passing').map(item => item.id);
    assert.deepEqual(passing, ['next', 'vite', 'wordpress', 'laravel', 'expo', 'nuxt', 'compose']);
    for (const item of SUPPORT.recipes) {
      if (item.status === 'passing') {
        assert.equal(item.reason, null, item.id);
        assert.ok(item.systems.length > 0, item.id);
      } else {
        assert.equal(item.status, 'unverified', item.id);
        assert.match(item.reason ?? '', /^[A-Z].*\.$/, item.id);
        assert.deepEqual(item.systems, [], item.id);
      }
    }
  });

  it("names each recipe's real start command, scaffold and preview modes", () => {
    for (const recipe of RECIPES) {
      const item = supportFor(recipe.id)!;
      const environment = recipe.environment(null, 'linux');
      assert.equal(item.start, environment.start.command, recipe.id);
      assert.equal(item.scaffold, recipe.scaffold?.tool, recipe.id);
      assert.ok(item.modes.includes(environment.mode), recipe.id);
      // Snapshots are a mode of their own, or final review beside a live preview.
      assert.equal(
        item.modes.includes('snapshot'),
        environment.mode === 'snapshot' || Boolean(environment.snapshot),
        recipe.id
      );
      assert.equal(item.node, item.needs.includes('node'), recipe.id);
    }
  });

  it("asks for every program the recipe's commands and scaffold run, on Windows and Linux", () => {
    for (const recipe of RECIPES) {
      const item = supportFor(recipe.id)!;
      const listed = new Set([...item.needs, ...item.optional]);
      const programs = [
        ...commandPrograms(recipe.id, 'linux'),
        ...commandPrograms(recipe.id, 'windows'),
        ...(recipe.scaffold?.needs ?? [])
      ].map(program => INSTALLED_AS[program] ?? program);
      for (const program of programs) assert.ok(listed.has(program), `${recipe.id}: ${program}`);
      assert.ok(item.needs.includes('git'), `${recipe.id}: rough/ is kept in git`);
    }
  });

  it("says how to install each program in doctor's own words, and nothing else", () => {
    const named = new Set(SUPPORT.recipes.flatMap(item => [...item.needs, ...item.optional]));
    assert.deepEqual(Object.keys(SUPPORT.hints).sort(), [...named].sort());
    for (const tool of named) assert.equal(SUPPORT.hints[tool], installHint(tool), tool);
  });

  it('tells new and init about a recipe that is not proven yet, and says nothing of a passing one', () => {
    assert.equal(supportNote('next'), null);
    assert.equal(supportNote('rails'), null);
    assert.match(supportNote('flutter') ?? '', /^not yet proven: .*Flutter SDK; .*doctor decides/);
    assert.match(supportNote('swiftui') ?? '', /Mac/);
    assert.match(supportNote('shopify') ?? '', /development store/);
  });
});
