// `roughbook doctor`: proves the preview contract on this repo, check by check, and says what to
// fix. It writes two sample iterations of its own (one that renders, one that fails) under a page
// of its own, rough/doctor-check-<id>/, asks the app's dev server about them the way the studio
// would, and takes them away again. ROUGHBOOK-FRAMEWORKS-PLAN.md, "roughbook doctor".
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ENVIRONMENT_FILE,
  defaultEnvironment,
  previewUrl,
  readEnvironment
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { screenshotSet, withVariant } from '../environment/variants.js';
import { programOf, type Served } from '../launch/processes.js';
import { installHint } from '../recipes/tools.js';
import { recipeOf } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import {
  approveCommands,
  describeCommand,
  environmentCommands,
  readApprovals,
  unapprovedCommands
} from '../repo/approvals.js';
import { iterationDir } from '../repo/iterations.js';
import { syncIterations } from '../repo/mirror.js';
import { readRepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import type { takeScreenshot } from '../screenshot/browser.js';
import { screenshotIteration } from '../screenshot/iteration.js';
import { siteFile } from '../standalone/files.js';
import { startStandaloneServer, type StandaloneServer } from '../standalone/server.js';
import { STUDIO_VERSION } from '../version.js';
import { ORDER, result, rewrite, writeFiles } from './checks.js';
import { buildGate } from './gate.js';
import { setupFilesCheck } from './setupFiles.js';
import { runSnapshotChecks } from './snapshot.js';
import { judgeSpeed, type SpeedMeasures } from './speed.js';
import { realTools } from './tools.js';
import type {
  CheckId,
  CheckResult,
  DoctorOptions,
  DoctorOutcome,
  DoctorReport,
  DoctorTools
} from './types.js';

import {
  BROKEN,
  DOCTOR_COMPONENT,
  DOCTOR_PAGE,
  GOOD,
  MISSING,
  SAMPLE_FIXTURE,
  SAMPLE_MARKER,
  SPEED,
  clearDoctorFolders,
  sampleSource
} from './samples.js';

export {
  DOCTOR_COMPONENT,
  DOCTOR_PAGE,
  SAMPLE_FIXTURE,
  SAMPLE_KEY,
  SAMPLE_MARKER,
  SAMPLE_MODULE,
  clearDoctorFolders,
  sampleSource,
  setupSamples
} from './samples.js';

/** The answer at a URL: its status and text, or null when nothing answered in time. */
async function ask(
  tools: DoctorTools,
  url: string,
  timeoutMs: number
): Promise<{ status: number; text: string } | null> {
  try {
    const response = await tools.fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual'
    });
    return { status: response.status, text: await response.text() };
  } catch {
    return null;
  }
}

export function exitCodeFor(outcome: DoctorOutcome): number {
  return outcome === 'pass' ? 0 : outcome === 'fail' ? 1 : 2;
}

function outcomeOf(checks: CheckResult[]): DoctorOutcome {
  if (checks.some(check => check.status === 'fail')) return 'fail';
  if (checks.find(check => check.id === 'gate')?.status === 'skip') return 'unverified';
  return 'pass';
}

function summarize(environment: RepoEnvironment): DoctorReport['environment'] {
  return {
    contract: environment.contract,
    recipe: environment.recipe,
    stack: environment.stack,
    family: environment.family,
    mode: environment.mode,
    gate: environment.gate
  };
}

export async function runDoctor(repoRoot: string, options: DoctorOptions): Promise<DoctorReport> {
  const tools: DoctorTools = { ...realTools(process.env, repoRoot), ...options.tools };
  const checks: CheckResult[] = [];
  const skipFrom = (id: CheckId, detail: string) => {
    for (const next of ORDER.slice(ORDER.indexOf(id))) checks.push(result(next, 'skip', detail));
  };
  const report = (environment: RepoEnvironment): DoctorReport => ({
    studio: STUDIO_VERSION,
    // With --snapshots, what was checked is the snapshot command: the report says so.
    environment: { ...summarize(environment), ...(options.snapshots ? { mode: 'snapshot' } : {}) },
    outcome: outcomeOf(checks),
    checks
  });

  // 1. The environment, and the commands it names approved on this machine (decision 18).
  let environment: RepoEnvironment;
  const link = await readRepoLink(repoRoot).catch(() => null);
  try {
    environment = await readEnvironment(repoRoot, link);
  } catch (error) {
    checks.push(result('prerequisites', 'skip', 'Not checked: the environment could not be read.'));
    checks.push(
      result(
        'environment',
        'fail',
        error instanceof Error ? error.message : String(error),
        `Fix the header of ${ROUGH_DIR}/${ENVIRONMENT_FILE}, or run roughbook setup to write it again.`
      )
    );
    skipFrom('app', 'Not checked: the environment could not be read.');
    return report(defaultEnvironment());
  }
  const recipe: Recipe | null = recipeOf(environment);
  const setupName = recipe ? recipe.name : 'Your agent\u2019s setup (no recipe)';

  // 0. The prerequisites: every program the commands name, on the PATH the declared shell sees.
  const programs = [
    ...new Set(
      environmentCommands(environment).flatMap(item => programOf(item.command, item.shell))
    )
  ];
  const missingTools = programs.filter(program => !tools.which(program));
  if (missingTools.length) {
    checks.push(
      result(
        'prerequisites',
        'fail',
        `Not on the PATH: ${missingTools.join(', ')}.`,
        missingTools.map(tool => `${tool}: ${installHint(tool)}`).join(' ')
      )
    );
  } else {
    checks.push(
      result(
        'prerequisites',
        'pass',
        `${
          programs.length
            ? `${programs.join(', ')} ${programs.length === 1 ? 'is' : 'are'} on the PATH`
            : 'The environment names no command to run'
        }${tools.browser ? '' : '; no browser was found for screenshots (set ROUGHBOOK_BROWSER)'}.`
      )
    );
  }

  const approvals = await readApprovals(repoRoot);
  let pending = unapprovedCommands(environment, approvals);
  if (pending.length && options.approve) {
    await approveCommands(repoRoot, pending);
    pending = [];
  }
  if (pending.length) {
    checks.push(
      result(
        'environment',
        'fail',
        `${pending.length} command${pending.length === 1 ? ' is' : 's are'} not approved on this machine: ${pending.map(describeCommand).join('; ')}.`,
        'Run roughbook doctor in a terminal and approve them when asked, or roughbook doctor --yes once you have read them (decision 18 of the frameworks plan: a committed file never runs code on your machine unseen).'
      )
    );
    skipFrom('app', 'Not checked: the commands are not approved.');
    return report(environment);
  }
  checks.push(
    result(
      'environment',
      'pass',
      `${setupName} (${environment.family}, ${environment.mode} preview, gate: ${environment.gate}${
        environment.runtime.kind === 'container'
          ? `, in a container at ${environment.runtime.url}`
          : ''
      })${programs.length ? `; ${programs.length === 1 ? 'its command is' : 'its commands are'} approved` : ''}.`
    )
  );
  // Snapshot mode, or a live repo's snapshot command for final review (--snapshots): the images
  // the repo's own tool renders, checked the same way (src/doctor/snapshot.ts).
  if (environment.mode === 'snapshot' || options.snapshots) {
    await runSnapshotChecks(repoRoot, environment, recipe, link, tools, options, checks);
    return report(environment);
  }

  const seconds = (count: number) => count * 1000;
  /** Where previews are asked: the app's dev server, or the standalone server doctor starts. */
  let base = options.devUrl.replace(/\/+$/, '');
  /** The environment as previews are asked through it: in standalone mode, with the token. */
  let shown = environment;
  const marker = `roughbook-doctor-${randomBytes(4).toString('hex')}`;
  const fixtureNote = `fixture-${randomBytes(3).toString('hex')}`;
  // A page named anew each run: a dev server's watcher (webpack's, on Windows) loses a folder
  // that was deleted and made again, and would then miss the change to the iteration.
  const page = `${DOCTOR_PAGE}-${randomBytes(2).toString('hex')}`;
  const keyOf = (iteration: string) => `${page}/${DOCTOR_COMPONENT}/${iteration}`;
  // A recipe knows how to write an iteration in its stack; the setup run writes samples for a
  // stack with no recipe, in rough/setup/sample/, with stand-ins for the marker and the fixture.
  const source = sampleSource(repoRoot, environment, recipe);
  const samples = source && {
    good: source('good', { marker, fixtureNote, key: keyOf(GOOD) }),
    broken: source('broken', { marker, fixtureNote, key: keyOf(BROKEN) })
  };
  if (!samples || !source) {
    checks.push(
      result('app', 'skip', 'Not checked: there is no sample iteration to render.'),
      result(
        'renders',
        'fail',
        `${ROUGH_DIR}/setup/sample/good/ and ${ROUGH_DIR}/setup/sample/broken/ are missing: the setup run writes one iteration that renders (its ${environment.entry}, with ${SAMPLE_MARKER} where text shows${environment.fixture ? `, and ${environment.fixture} with ${SAMPLE_FIXTURE} in a value it shows` : ''}) and one that fails.`,
        'Run roughbook setup --fix so your agent writes the sample iterations, or write them by hand after rough/CONTRACT.md.'
      )
    );
    skipFrom('fixture', 'Not checked: there is no sample iteration.');
    return report(environment);
  }
  const own = `${ROUGH_DIR}/${page}`;
  const goodFolder = iterationDir(page, DOCTOR_COMPONENT, GOOD);
  const brokenFolder = iterationDir(page, DOCTOR_COMPONENT, BROKEN);
  const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-doctor-'));
  // The folders left by a doctor that crashed are doctor's own to clear.
  clearDoctorFolders(repoRoot);
  writeFiles(repoRoot, goodFolder, samples.good);
  writeFiles(repoRoot, brokenFolder, samples.broken);
  syncIterations(repoRoot, environment);
  /** The app, when doctor started it itself (--speed with nothing answering), stopped at the end. */
  let startedApp: Served | null = null;
  /** The studio's own server, in standalone mode, stopped at the end. */
  let standalone: StandaloneServer | null = null;
  let coldStartedAt: number | null = null;
  let coldStartMs: number | null = null;
  try {
    // 2. The app: in standalone mode, the studio's own server and the site's files it loads,
    // since nothing of the app runs for a preview; otherwise the app's dev server, and the
    // container it runs in when it does.
    if (environment.mode === 'standalone') {
      standalone = await startStandaloneServer(repoRoot, () => environment);
      base = standalone.url;
      shown = standalone.environment;
      const missing = siteProblems(repoRoot, environment);
      if (missing.length) {
        checks.push(
          result(
            'app',
            'fail',
            missing.join(' '),
            "Name the site's folder (public) and its stylesheets as its pages link them, each a path under that folder or a full address (stylesheets), in rough/environment.md."
          )
        );
        skipFrom('renders', 'Not checked: the site the previews load is not all there.');
        return report(environment);
      }
      const sheets = environment.stylesheets;
      checks.push(
        result(
          'app',
          'pass',
          `The studio's standalone server started at ${base}${
            environment.public
              ? `, with ${environment.public === '.' ? 'the repo' : `${environment.public}/`} as the site's root`
              : ''
          }${sheets.length ? `; it loads ${sheets.join(', ')}` : '; it loads no stylesheet of the site'}.`
        )
      );
    } else {
      if (environment.runtime.kind === 'container') {
        const container = await ask(
          tools,
          environment.runtime.url,
          seconds(environment.timeouts.start)
        );
        if (!container) {
          checks.push(
            result(
              'app',
              'fail',
              `The container at ${environment.runtime.url} did not answer.`,
              'Start the container the environment names (runtime), and run roughbook doctor again.'
            )
          );
          skipFrom('renders', 'Not checked: the container did not answer.');
          return report(environment);
        }
      }
      let home = await ask(tools, `${base}/`, seconds(environment.timeouts.start));
      if (!home && options.startApp && environment.start.command) {
        // As roughbook start does: the approved start command, in its shell, timed from here to
        // the first preview for the cold-start budget.
        coldStartedAt = tools.now();
        startedApp = await tools.serve(
          environment.start.command,
          repoRoot,
          `${base}/`,
          seconds(environment.timeouts.start),
          environment.shell
        );
        if (startedApp) home = await ask(tools, `${base}/`, seconds(environment.timeouts.start));
      }
      if (!home) {
        checks.push(
          result(
            'app',
            'fail',
            `Nothing answered at ${base}.`,
            `Start the app's dev server there (its usual address is ${environment.start.url}${
              environment.start.command ? `, started with ${environment.start.command}` : ''
            }), or name it with --dev-url, and run roughbook doctor again.`
          )
        );
        skipFrom('renders', 'Not checked: the app did not answer.');
        return report(environment);
      }
      checks.push(
        result(
          'app',
          'pass',
          `${base} answered (HTTP ${home.status})${
            environment.runtime.kind === 'container'
              ? `, from the container at ${environment.runtime.url}`
              : ''
          }${startedApp ? `, started by doctor with ${environment.start.command}` : ''}.`
        )
      );
    }

    // 3. The states: a rendered iteration, a failed one, a missing one.
    const previewMs = seconds(environment.timeouts.preview);
    const url = (iteration: string) => previewUrl(base, page, DOCTOR_COMPONENT, iteration, shown);
    // A dev server notices the new iteration and the rewritten preview setup on its own time (a
    // recompile tick, or a first compile of the route), so the page is asked until it shows the
    // iteration, within the preview timeout: in the HTML the server sends, or, for a preview the
    // browser renders on the client (a bundler's page, a workshop), in the page's text once it
    // settled, which the probe reads.
    const probeAt = (target: string, expect?: string) =>
      tools.probe({ url: target, overlays: environment.overlays, timeoutMs: previewMs, expect });
    const showing = async (needle: string) => {
      const deadline = tools.now() + previewMs;
      let last: Awaited<ReturnType<typeof ask>> = null;
      let probe: Awaited<ReturnType<typeof probeAt>> | null = null;
      for (;;) {
        last = await ask(tools, url(GOOD), previewMs);
        if (last?.text.includes(needle)) return { answer: last, shown: true, probe };
        if (last?.status === 200 && tools.browser) {
          probe = await probeAt(url(GOOD), needle);
          if (probe.text.includes(needle)) return { answer: last, shown: true, probe };
        }
        if (tools.now() >= deadline) return { answer: last, shown: false, probe };
        await tools.sleep(500);
      }
    };
    const first = await showing(marker);
    const good = first.answer;
    const goodProbe = first.probe ?? (await probeAt(url(GOOD), marker));
    /** Whether the server's HTML or the rendered page shows a text. */
    const pageShows = (needle: string) =>
      Boolean(good?.text.includes(needle)) || goodProbe.text.includes(needle);
    const rendered = good?.status === 200 && first.shown;
    if (coldStartedAt !== null && rendered) coldStartMs = tools.now() - coldStartedAt;
    // The server sent the iteration, but the browser shows something else: a layout of the app's
    // that decides what to show by path, showing its own view instead of the route. Nothing that
    // needs the iteration on the page can be judged until it shows, so those checks are skipped.
    const hidden = rendered && Boolean(tools.browser) && !goodProbe.shows;
    const unseen = 'Not checked: the page did not show the sample iteration (see renders).';
    if (!rendered) {
      checks.push(
        result(
          'renders',
          'fail',
          good
            ? good.status === 200
              ? `${url(GOOD)} answered HTTP 200 for ${environment.timeouts.preview} s without the iteration in it.`
              : `${url(GOOD)} answered HTTP ${good.status}.`
            : `${url(GOOD)} did not answer within ${environment.timeouts.preview} s.`,
          good?.status === 200
            ? 'The dev server never picked the new iteration up: it must watch rough/ and the preview setup for changes. Restart it and run roughbook doctor again; if that helps, the preview setup needs to tell the dev server about rough/.'
            : 'The preview must render an iteration from rough/ inside the app, at its key, and post the ready message (contract point 3). Check the preview setup roughbook init wrote, or run roughbook setup --fix.'
        )
      );
    } else if (hidden) {
      checks.push(
        result(
          'renders',
          'fail',
          `The app sent the iteration to the page, but the page shows something else${goodProbe.error ? `, and posted an error: ${goodProbe.error}` : ''}.`,
          `Something in the app shows its own view instead of this route: a layout or wrapper that decides what to show by path must let the preview's address (${new URL(url(GOOD)).pathname}) through in development (contract point 3).`
        )
      );
    } else if (tools.browser && !goodProbe.ready) {
      checks.push(
        result(
          'renders',
          'fail',
          goodProbe.error
            ? `The page rendered the iteration but posted an error: ${goodProbe.error}`
            : goodProbe.exceptions.length
              ? `The page rendered the iteration but never posted the ready message; the browser reported: ${goodProbe.exceptions[0]}`
              : 'The page rendered the iteration but never posted the ready message.',
          'Post { roughbook: "ready", id } to the parent once the iteration has rendered (contract point 3).'
        )
      );
    } else {
      checks.push(
        result(
          'renders',
          'pass',
          tools.browser
            ? 'The sample iteration rendered and posted ready.'
            : 'The sample iteration rendered; no browser was found to hear the ready message.'
        )
      );
    }

    if (!environment.fixture) {
      checks.push(result('fixture', 'skip', "This stack's preview takes no fixture."));
    } else if (pageShows(fixtureNote)) {
      checks.push(
        result('fixture', 'pass', `The sample's ${environment.fixture} reached the iteration.`)
      );
    } else {
      checks.push(
        result(
          'fixture',
          'fail',
          `The sample's ${environment.fixture} did not reach the iteration.`,
          `Pass the contents of an iteration's ${environment.fixture} to it as its inputs (contract point 2).`
        )
      );
    }

    if (hidden) {
      checks.push(result('reports-broken', 'skip', unseen));
      checks.push(result('reports-missing', 'skip', unseen));
    } else {
      const broken = await ask(tools, url(BROKEN), previewMs);
      const brokenProbe = await tools.probe({
        url: url(BROKEN),
        overlays: environment.overlays,
        timeoutMs: previewMs
      });
      const brokenReported =
        broken !== null &&
        ((broken.status >= 500 && broken.status < 600) || Boolean(brokenProbe.error));
      checks.push(
        brokenReported && !brokenProbe.ready
          ? result(
              'reports-broken',
              'pass',
              broken!.status >= 500
                ? `The failing iteration answered HTTP ${broken!.status}.`
                : `The failing iteration posted an error: ${brokenProbe.error}`
            )
          : result(
              'reports-broken',
              'fail',
              broken
                ? `The failing iteration answered HTTP ${broken.status}${brokenProbe.ready ? ' and posted ready' : ' and posted no error'}.`
                : 'The failing iteration did not answer.',
              'An iteration that fails to render must answer 500, or post { roughbook: "error", id, message } (contract point 3).'
            )
      );

      const missing = await ask(tools, url(MISSING), previewMs);
      const missingProbe = await tools.probe({
        url: url(MISSING),
        overlays: environment.overlays,
        timeoutMs: previewMs
      });
      const missingReported =
        missing !== null && (missing.status === 404 || Boolean(missingProbe.error));
      checks.push(
        missingReported && !missingProbe.ready
          ? result(
              'reports-missing',
              'pass',
              missing!.status === 404
                ? 'A key with no iteration answered HTTP 404.'
                : `A key with no iteration posted an error: ${missingProbe.error}`
            )
          : result(
              'reports-missing',
              'fail',
              missing
                ? `A key with no iteration answered HTTP ${missing.status} and posted no error.`
                : 'A key with no iteration did not answer.',
              'A key with no iteration must answer 404, or post { roughbook: "error", id, message } (contract point 3).'
            )
      );
    }

    // 4. Screenshots at every viewport, with no overlay showing.
    if (hidden) {
      checks.push(result('screenshots', 'skip', unseen));
    } else if (!tools.browser) {
      checks.push(
        result(
          'screenshots',
          'skip',
          'No Chrome, Chromium or Edge was found. Set ROUGHBOOK_BROWSER to one to check screenshots.'
        )
      );
    } else {
      const taken: string[] = [];
      const set = screenshotSet(environment.viewports, environment.variants);
      for (const shot of set) {
        const viewport = environment.viewports.find(item => item.name === shot.viewport)!;
        const file = path.join(shotsDir, `${shot.name}.png`);
        if (
          await tools.screenshot({
            url: withVariant(url(GOOD), shot.variant),
            file,
            size: viewport,
            overlays: environment.overlays,
            variant: shot.variant
          })
        ) {
          taken.push(shot.name);
        }
      }
      const missed = set.map(shot => shot.name).filter(name => !taken.includes(name));
      if (missed.length) {
        checks.push(
          result(
            'screenshots',
            'fail',
            `No screenshot came out at ${missed.join(', ')}.`,
            'The browser could not photograph the preview. Open it in a browser to see why.'
          )
        );
      } else if (goodProbe.visibleOverlays) {
        checks.push(
          result(
            'screenshots',
            'fail',
            `${goodProbe.visibleOverlays} development overlay${goodProbe.visibleOverlays === 1 ? '' : 's'} showed on the page.`,
            `Name the app's development overlays in rough/environment.md (overlays), so screenshots hide them.`
          )
        );
      } else {
        checks.push(
          result(
            'screenshots',
            'pass',
            `Screenshots came out at ${taken.join(', ')}, with no overlay showing.`
          )
        );
      }
    }

    // 5. Freshness: in the server's HTML, or in the page the browser renders.
    const changed = `${marker}-changed`;
    rewrite(repoRoot, goodFolder, marker, changed);
    const deadline = tools.now() + previewMs;
    let fresh = false;
    for (;;) {
      const again = await ask(tools, url(GOOD), previewMs);
      if (again?.text.includes(changed)) {
        fresh = true;
        break;
      }
      if (again?.status === 200 && tools.browser && !good?.text.includes(marker)) {
        if ((await probeAt(url(GOOD), changed)).text.includes(changed)) {
          fresh = true;
          break;
        }
      }
      if (tools.now() >= deadline) break;
      await tools.sleep(500);
    }
    checks.push(
      fresh
        ? result('fresh', 'pass', 'A change to the iteration showed at its preview URL.')
        : result(
            'fresh',
            'fail',
            `A change to the iteration did not show within ${environment.timeouts.preview} s.`,
            "The preview must pick up a change to an iteration's files without a restart: the app's own reload, or a plain reload of the page (contract point 4). If an iteration's folder was deleted and made again while the dev server ran, restart the dev server: some watchers lose such a folder."
          )
    );

    // 6. The gate.
    if (options.skipBuild) {
      checks.push(
        result(
          'gate',
          'skip',
          'The production build was skipped (--skip-build), so the repo is unverified.'
        )
      );
    } else {
      const problems: string[] = [];
      const fixes: string[] = [];
      /** What held, in words, where the gate is not the plain build or route (below). */
      const held: string[] = [];
      let published = false;
      // A standalone preview is the studio's, so what the served site must not hand out is rough/.
      const servesSite = environment.mode === 'standalone';
      if (environment.gate === 'build' || environment.gate === 'both') {
        const found = await buildGate(repoRoot, environment, tools, changed);
        problems.push(...found.problems);
        fixes.push(...found.fixes);
        held.push(...found.held);
        published = found.published;
      }
      if (environment.gate === 'runtime' || environment.gate === 'both') {
        if (!environment.production) {
          problems.push('The gate is the runtime, but the environment says how to run production.');
          fixes.push(
            'Name the production command and address in rough/environment.md (production).'
          );
        } else {
          const served = await tools.serve(
            environment.production.command,
            repoRoot,
            environment.production.url,
            seconds(environment.timeouts.start),
            environment.shell
          );
          if (!served) {
            problems.push(
              `The app did not answer at ${environment.production.url} in production mode within ${environment.timeouts.start} s.`
            );
            fixes.push(
              'Check the production command in rough/environment.md (production) by running it by hand.'
            );
          } else {
            try {
              // The sample iteration's own file, which a site serving its folder as it is would
              // hand out; for a live preview, its route.
              const asked = servesSite
                ? `${environment.production.url}/${iterationDir(page, DOCTOR_COMPONENT, GOOD)}/${environment.entry}`
                : previewUrl(
                    environment.production.url,
                    DOCTOR_PAGE,
                    DOCTOR_COMPONENT,
                    GOOD,
                    environment
                  );
              const answer = await ask(tools, asked, previewMs);
              if (servesSite) {
                // What counts is whether the sample's own text came back, as the build gate looks
                // for it: a server may answer a missing file with a page of the site's own (PHP's
                // built-in server walks up to the nearest index.php), which is not the iteration.
                const leaked =
                  answer !== null &&
                  answer.status >= 200 &&
                  answer.status < 300 &&
                  answer.text.includes(changed);
                if (answer && !leaked) {
                  held.push(
                    `in production mode the site does not serve rough/ (the sample's ${environment.entry} answered HTTP ${answer.status}${answer.status < 300 ? ' with a page of the site’s own' : ''})`
                  );
                } else {
                  problems.push(
                    answer
                      ? `In production mode the site served the sample iteration's own file, ${new URL(asked).pathname}: rough/ must not be on the site.`
                      : `In production mode the site did not answer for the sample iteration's own file, ${new URL(asked).pathname}, so it cannot be shown to keep rough/ off the site.`
                  );
                  fixes.push(
                    'Serve the site from a folder that does not hold rough/ (a document root such as public/), or refuse /rough/ there (contract point 1).'
                  );
                }
              } else if (!answer || answer.status !== 404) {
                problems.push(
                  `In production mode the preview answered ${answer ? `HTTP ${answer.status}` : 'nothing'}, not 404.`
                );
                fixes.push(
                  'The preview must answer 404 when the app runs in production mode (contract point 1).'
                );
              }
            } finally {
              await served.stop();
            }
          }
        }
      }
      const said = held.join(', and ');
      checks.push(
        problems.length
          ? result('gate', 'fail', problems.join(' '), fixes.join(' '))
          : result(
              'gate',
              'pass',
              published || servesSite
                ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
                : environment.gate === 'build'
                  ? 'The production build passed and holds nothing from rough/.'
                  : environment.gate === 'runtime'
                    ? 'In production mode the preview answers 404.'
                    : 'The production build holds nothing from rough/, and in production mode the preview answers 404.'
            )
      );
    }

    // 7. Loopback.
    const [address] = tools.addresses();
    if (!address) {
      checks.push(result('loopback', 'skip', 'This machine has no network address to try from.'));
    } else {
      const outside = new URL(url(GOOD));
      outside.hostname = address;
      const exposed = await ask(tools, outside.toString(), 5000);
      // A page the browser renders would show the iteration from the network too.
      const open =
        exposed?.status === 200 &&
        (exposed.text.includes(changed) ||
          (Boolean(tools.browser) &&
            !good?.text.includes(marker) &&
            (await probeAt(outside.toString(), changed)).text.includes(changed)));
      checks.push(
        open
          ? result(
              'loopback',
              'fail',
              `The preview answered from the network, at ${address}.`,
              'Bind the dev server to 127.0.0.1, or make the preview refuse requests not addressed to localhost (contract point 5).'
            )
          : result(
              'loopback',
              'pass',
              exposed
                ? `From ${address} the preview answered HTTP ${exposed.status}, showing nothing.`
                : `From ${address} nothing answered.`
            )
      );
    }

    // 8. The setup files: each listed one in place and matching its template, the recipe's own
    // files as the recipe writes them now, and nothing else changed outside rough/ by the setup run.
    checks.push(await setupFilesCheck(repoRoot, environment, recipe, link));

    // 9. The speed budgets, with --speed: a new iteration (as a finished run leaves one), warmed
    // once and timed until it shows and says ready; its screenshots at every viewport and
    // variant, then again with nothing changed; and the cold start when doctor started the app.
    if (!options.speed) {
      checks.push(
        result(
          'speed',
          'skip',
          'Not checked: pass --speed to measure the budgets (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed").'
        )
      );
      return report(environment);
    }
    const measures: SpeedMeasures = {
      previewVisibleMs: null,
      coldStartMs,
      ...(standalone ? { noColdStart: 'nothing of the app starts for a standalone preview' } : {}),
      screenshotsMs: null,
      shots: 0,
      again: 0,
      viewports: environment.viewports.length,
      variants: Math.max(1, environment.variants.length)
    };
    const speedMarker = `${marker}-speed`;
    writeFiles(
      repoRoot,
      iterationDir(page, DOCTOR_COMPONENT, SPEED),
      source('good', { marker: speedMarker, fixtureNote, key: keyOf(SPEED) })
    );
    syncIterations(repoRoot, environment);
    const startedAt = tools.now();
    // The warming request, as a finished run makes it; then until the page shows it and says ready.
    await ask(tools, url(SPEED), previewMs);
    const until = tools.now() + previewMs;
    for (;;) {
      const answer = await ask(tools, url(SPEED), previewMs);
      if (answer?.status === 200) {
        const probe = tools.browser ? await probeAt(url(SPEED), speedMarker) : null;
        const shown =
          answer.text.includes(speedMarker) || Boolean(probe?.text.includes(speedMarker));
        if (shown && (!tools.browser || probe?.ready)) {
          measures.previewVisibleMs = tools.now() - startedAt;
          break;
        }
      }
      if (tools.now() >= until) break;
      await tools.sleep(250);
    }
    if (tools.browser) {
      const browser = tools.browser;
      const target = { page, component: DOCTOR_COMPONENT, iteration: SPEED };
      let count = 0;
      const take: typeof takeScreenshot = async input => {
        count += 1;
        return tools.screenshot({
          url: input.url,
          file: input.file,
          size: { name: '', ...input.size },
          overlays: input.overlays ?? [],
          variant: input.variant
        });
      };
      const answered = async (asked: string) => ({ status: 200, url: asked });
      const shotsAt = tools.now();
      await screenshotIteration(repoRoot, base, target, {}, take, browser, answered, shown);
      measures.screenshotsMs = tools.now() - shotsAt;
      measures.shots = count;
      count = 0;
      await screenshotIteration(repoRoot, base, target, {}, take, browser, answered, shown);
      measures.again = count;
    }
    const judged = judgeSpeed(measures);
    checks.push(
      judged.pass
        ? result('speed', 'pass', judged.detail)
        : result('speed', 'fail', judged.detail, judged.fix)
    );
    return report(environment);
  } finally {
    fs.rmSync(path.join(repoRoot, ...own.split('/')), { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, ROUGH_DIR, '.screenshots', page), {
      recursive: true,
      force: true
    });
    syncIterations(repoRoot, environment);
    fs.rmSync(shotsDir, { recursive: true, force: true });
    if (startedApp) await startedApp.stop();
    if (standalone) await standalone.close();
  }
}

/**
 * What the standalone previews would miss of the site: its public folder, or a stylesheet the
 * environment names on the site that is not in it. Addresses elsewhere are the browser's to load.
 */
function siteProblems(repoRoot: string, environment: RepoEnvironment): string[] {
  const problems: string[] = [];
  const folder = environment.public;
  const root = folder ? path.join(repoRoot, ...(folder === '.' ? [] : folder.split('/'))) : null;
  if (folder && root && !(fs.existsSync(root) && fs.statSync(root).isDirectory())) {
    problems.push(`The site's folder ${folder}/ (public) is not in the repo.`);
    return problems;
  }
  for (const sheet of environment.stylesheets.filter(item => item.startsWith('/'))) {
    if (!root || !siteFile(root, sheet.split('?')[0]!)) {
      problems.push(
        `stylesheets names ${sheet}, which is not in the site's folder${folder ? ` (${folder === '.' ? 'the repo' : `${folder}/`})` : ''}.`
      );
    }
  }
  return problems;
}

/** The report as lines for the terminal. */
export function renderReport(report: DoctorReport): string[] {
  const lines: string[] = [];
  for (const check of report.checks) {
    const mark = check.status === 'pass' ? 'ok  ' : check.status === 'fail' ? 'FAIL' : 'skip';
    lines.push(`${mark}  ${check.id}  ${check.name}: ${check.detail}`);
    if (check.status === 'fail' && check.fix) lines.push(`      fix: ${check.fix}`);
  }
  const passed = report.checks.filter(check => check.status === 'pass').length;
  const failed = report.checks.filter(check => check.status === 'fail').length;
  const skipped = report.checks.filter(check => check.status === 'skip').length;
  lines.push('');
  lines.push(
    `${report.outcome === 'pass' ? 'The preview keeps the contract' : report.outcome === 'fail' ? 'The preview breaks the contract' : 'The preview is unverified'}: ${passed} passed, ${failed} failed, ${skipped} skipped.`
  );
  return lines;
}

/** The report for a support ticket: the checks and the versions, no path and no value from the repo. */
export function redactedReport(
  report: DoctorReport,
  versions: { node: string; os: string }
): Record<string, unknown> {
  const scrub = (text: string) =>
    text
      .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
      .replace(/(?:\/[\w.-]+){2,}/g, '<path>')
      .replace(/https?:\/\/[^\s"']+/g, '<url>');
  return {
    studio: report.studio,
    node: versions.node,
    os: versions.os,
    environment: report.environment,
    outcome: report.outcome,
    checks: report.checks.map(check => ({
      id: check.id,
      status: check.status,
      detail: scrub(check.detail),
      fix: check.fix ? scrub(check.fix) : null
    }))
  };
}
