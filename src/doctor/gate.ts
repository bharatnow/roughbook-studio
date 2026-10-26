// The build gate (decision 11): the production build passes and nothing from rough/ is in what it
// outputs, or, for a site with no build, in the folders it publishes as they are. Shared by every
// mode; the runtime gate, which asks a served app, is the live and standalone modes' own.
import type { RepoEnvironment } from '../environment/types.js';
import { findSentinel } from './sentinel.js';
import type { DoctorTools } from './types.js';

export type GateFindings = { problems: string[]; fixes: string[]; held: string[] };

/**
 * The build gate over the repo, with `sentinel` the sample's text no production output may hold,
 * and `switchSentinel` the in-page view's (B5), when the recipe has one: where the output holds it,
 * or null when the output was not searched.
 */
export async function buildGate(
  repoRoot: string,
  environment: RepoEnvironment,
  tools: Pick<DoctorTools, 'exec'>,
  sentinel: string,
  switchSentinel: string | null = null
): Promise<GateFindings & { published: boolean; switchLeaked: string[] | null }> {
  let switchLeaked: string[] | null = null;
  /** The switch's sentinel in the output, as a problem of the gate's when it is there. */
  const searchSwitch = () => {
    if (!switchSentinel) return;
    switchLeaked = findSentinel(repoRoot, environment.build.output, switchSentinel);
    if (switchLeaked.length) {
      problems.push(`The production build holds the in-page view's switch: ${list(switchLeaked)}.`);
      fixes.push(
        'The switch is for development only: its rule must apply in the dev server alone (roughbook setup --upgrade writes it so).'
      );
    }
  };
  const problems: string[] = [];
  const fixes: string[] = [];
  const held: string[] = [];
  // A site with no build is published as it is: its folders are what reaches production.
  const published = !environment.build.command && environment.build.output.length > 0;
  const list = (found: string[]) =>
    `${found.slice(0, 3).join(', ')}${found.length > 3 ? ', …' : ''}`;
  if (published) {
    const folders = environment.build.output.join(', ');
    const leaked = findSentinel(repoRoot, environment.build.output, sentinel);
    if (leaked.length) {
      problems.push(
        `The folders the site publishes as they are (${folders}) hold the sample iteration: ${list(leaked)}.`
      );
      fixes.push(
        'Nothing from rough/ may be published: publish a folder that does not hold rough/ (buildOutput), or keep rough/ out of what the site deploys (contract point 1).'
      );
    } else {
      held.push(
        `nothing is built, and the folders published as they are (${folders}) hold nothing from rough/`
      );
    }
    searchSwitch();
  } else if (!environment.build.command) {
    problems.push('The gate is the build, but the environment names no build command.');
    fixes.push(
      'Name the production build command in rough/environment.md (build), or, for a site published as it is, build: none and the folders it publishes (buildOutput).'
    );
  } else {
    const built = await tools.exec(
      environment.build.command,
      repoRoot,
      environment.timeouts.build * 1000,
      environment.shell
    );
    if (built.code === null) {
      problems.push(`The production build did not finish within ${environment.timeouts.build} s.`);
      fixes.push(
        'Give it longer in rough/environment.md (timeouts), or run it by hand to see why.'
      );
    } else if (built.code !== 0) {
      problems.push(`The production build failed (exit ${built.code}).`);
      fixes.push(
        'Run the build by hand and fix what it reports; the preview setup must not break it.'
      );
    } else if (!environment.build.output.length) {
      problems.push(
        'The production build passed, but the environment names no folder it outputs to, so nothing could be searched.'
      );
      fixes.push(
        'Name the folders the production build writes in rough/environment.md (buildOutput).'
      );
    } else {
      const leaked = findSentinel(repoRoot, environment.build.output, sentinel);
      if (leaked.length) {
        problems.push(`The production build holds the sample iteration: ${list(leaked)}.`);
        fixes.push(
          'Nothing from rough/ may reach the production build; keep the preview setup to development (contract point 1).'
        );
      } else held.push('the production build passed and holds nothing from rough/');
      searchSwitch();
    }
  }
  return { problems, fixes, held, published, switchLeaked };
}
