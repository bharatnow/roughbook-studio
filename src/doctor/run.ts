// `roughbook doctor`: proves the preview contract on this repo, check by check, and says what to
// fix. It writes two sample iterations of its own (one that renders, one that fails) under a page
// of its own, rough/doctor-check-<id>/, asks the app's dev server about them the way the studio
// would, and takes them away again. ROUGHBOOK-FRAMEWORKS-PLAN.md, "roughbook doctor".
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultEnvironment, previewUrl, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { fallbackRecipe, recipeFor } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { STUDIO_VERSION } from '../version.js';
import { findSentinel } from './sentinel.js';
import { realTools } from './tools.js';
import type {
  CheckId,
  CheckResult,
  DoctorOptions,
  DoctorOutcome,
  DoctorReport,
  DoctorTools
} from './types.js';

/**
 * Where doctor's own iterations live while it runs: a page of its own, this name and a short id
 * new each run, and one component.
 */
export const DOCTOR_PAGE = 'doctor-check';
export const DOCTOR_COMPONENT = 'sample';
const GOOD = 'iteration-01';
const BROKEN = 'iteration-02';
const MISSING = 'iteration-99';

const NAMES: Record<CheckId, string> = {
  environment: 'The environment reads',
  app: 'The app answers',
  renders: 'An iteration renders and says so',
  fixture: 'The fixture reaches the iteration',
  'reports-broken': 'A failed iteration is reported',
  'reports-missing': 'A missing iteration is reported',
  screenshots: 'Screenshots come out clean',
  fresh: 'A change shows without a restart',
  gate: 'Nothing reaches production',
  loopback: 'The preview answers this machine only',
  'setup-files': 'The setup files are listed',
  speed: 'The speed budgets hold'
};

const ORDER: CheckId[] = [
  'environment',
  'app',
  'renders',
  'fixture',
  'reports-broken',
  'reports-missing',
  'screenshots',
  'fresh',
  'gate',
  'loopback',
  'setup-files',
  'speed'
];

function result(
  id: CheckId,
  status: CheckResult['status'],
  detail: string,
  fix: string | null = null
) {
  return { id, name: NAMES[id], status, detail, fix };
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

function writeFiles(repoRoot: string, folder: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repoRoot, ...folder.split('/'), ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** Every file of a folder with `from` replaced by `to`, so the preview has something to notice. */
function rewrite(repoRoot: string, folder: string, from: string, to: string): void {
  const dir = path.join(repoRoot, ...folder.split('/'));
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replaceAll(from, to));
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
  const tools: DoctorTools = { ...realTools(process.env), ...options.tools };
  const checks: CheckResult[] = [];
  const skipFrom = (id: CheckId, detail: string) => {
    for (const next of ORDER.slice(ORDER.indexOf(id))) checks.push(result(next, 'skip', detail));
  };
  const report = (environment: RepoEnvironment): DoctorReport => ({
    studio: STUDIO_VERSION,
    environment: summarize(environment),
    outcome: outcomeOf(checks),
    checks
  });

  // 1. The environment.
  let environment: RepoEnvironment;
  try {
    environment = await readEnvironment(repoRoot);
  } catch (error) {
    checks.push(
      result(
        'environment',
        'fail',
        error instanceof Error ? error.message : String(error),
        `Fix the header of ${ROUGH_DIR}/environment.md, or run roughbook setup to write it again.`
      )
    );
    skipFrom('app', 'Not checked: the environment could not be read.');
    return report(defaultEnvironment());
  }
  const recipe: Recipe = recipeFor(environment.recipe) ?? fallbackRecipe;
  checks.push(
    result(
      'environment',
      'pass',
      `${recipe.name} (${environment.family}, ${environment.mode} preview, gate: ${environment.gate}).`
    )
  );
  if (environment.mode !== 'live') {
    skipFrom(
      'app',
      `Not checked yet: ${environment.mode} previews are checked from F${environment.mode === 'snapshot' ? '6' : '5'} of the frameworks plan.`
    );
    return report(environment);
  }

  const seconds = (count: number) => count * 1000;
  const base = options.devUrl.replace(/\/+$/, '');
  const marker = `roughbook-doctor-${randomBytes(4).toString('hex')}`;
  const fixtureNote = `fixture-${randomBytes(3).toString('hex')}`;
  const samples = recipe.doctorSamples({ marker, fixtureNote });
  // A page named anew each run: a dev server's watcher (webpack's, on Windows) loses a folder
  // that was deleted and made again, and would then miss the change to the iteration.
  const page = `${DOCTOR_PAGE}-${randomBytes(2).toString('hex')}`;
  const own = `${ROUGH_DIR}/${page}`;
  const goodFolder = iterationDir(page, DOCTOR_COMPONENT, GOOD);
  const brokenFolder = iterationDir(page, DOCTOR_COMPONENT, BROKEN);
  const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-doctor-'));
  // The folders left by a doctor that crashed are doctor's own to clear.
  clearDoctorFolders(repoRoot);
  writeFiles(repoRoot, goodFolder, samples.good);
  writeFiles(repoRoot, brokenFolder, samples.broken);
  recipe.syncPreview(repoRoot);
  try {
    // 2. The app.
    const home = await ask(tools, `${base}/`, seconds(environment.timeouts.start));
    if (!home) {
      checks.push(
        result(
          'app',
          'fail',
          `Nothing answered at ${base}.`,
          `Start the app's dev server there (its usual address is ${environment.start.url}), or name it with --dev-url, and run roughbook doctor again.`
        )
      );
      skipFrom('renders', 'Not checked: the app did not answer.');
      return report(environment);
    }
    checks.push(result('app', 'pass', `${base} answered (HTTP ${home.status}).`));

    // 3. The states: a rendered iteration, a failed one, a missing one.
    const previewMs = seconds(environment.timeouts.preview);
    const url = (iteration: string) =>
      previewUrl(base, page, DOCTOR_COMPONENT, iteration, environment);
    // A dev server notices the new iteration and the rewritten preview setup on its own time (a
    // recompile tick, or a first compile of the route), so the page is asked until it shows the
    // iteration, within the preview timeout.
    const showing = async (needle: string) => {
      const deadline = tools.now() + previewMs;
      let last: Awaited<ReturnType<typeof ask>> = null;
      for (;;) {
        last = await ask(tools, url(GOOD), previewMs);
        if (last?.text.includes(needle)) return { answer: last, shown: true };
        if (tools.now() >= deadline) return { answer: last, shown: false };
        await tools.sleep(500);
      }
    };
    const first = await showing(marker);
    const good = first.answer;
    const goodProbe = await tools.probe({
      url: url(GOOD),
      overlays: environment.overlays,
      timeoutMs: previewMs,
      expect: marker
    });
    const rendered = good?.status === 200 && first.shown;
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
    } else if (good?.text.includes(fixtureNote)) {
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
      for (const viewport of environment.viewports) {
        const file = path.join(shotsDir, `${viewport.name}.png`);
        if (
          await tools.screenshot({
            url: url(GOOD),
            file,
            size: viewport,
            overlays: environment.overlays
          })
        ) {
          taken.push(viewport.name);
        }
      }
      const missed = environment.viewports
        .map(viewport => viewport.name)
        .filter(name => !taken.includes(name));
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

    // 5. Freshness.
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
      if (environment.gate === 'build' || environment.gate === 'both') {
        if (!environment.build.command) {
          problems.push('The gate is the build, but the environment names no build command.');
          fixes.push('Name the production build command in rough/environment.md (build).');
        } else {
          const built = await tools.exec(
            environment.build.command,
            repoRoot,
            seconds(environment.timeouts.build)
          );
          if (built.code === null) {
            problems.push(
              `The production build did not finish within ${environment.timeouts.build} s.`
            );
            fixes.push(
              'Give it longer in rough/environment.md (timeouts), or run it by hand to see why.'
            );
          } else if (built.code !== 0) {
            problems.push(`The production build failed (exit ${built.code}).`);
            fixes.push(
              'Run the build by hand and fix what it reports; the preview setup must not break it.'
            );
          } else {
            const leaked = findSentinel(repoRoot, environment.build.output, changed);
            if (leaked.length) {
              problems.push(
                `The production build holds the sample iteration: ${leaked.slice(0, 3).join(', ')}${leaked.length > 3 ? ', …' : ''}.`
              );
              fixes.push(
                'Nothing from rough/ may reach the production build; keep the preview setup to development (contract point 1).'
              );
            }
          }
        }
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
            seconds(environment.timeouts.start)
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
              const answer = await ask(
                tools,
                previewUrl(
                  environment.production.url,
                  DOCTOR_PAGE,
                  DOCTOR_COMPONENT,
                  GOOD,
                  environment
                ),
                previewMs
              );
              if (!answer || answer.status !== 404) {
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
      checks.push(
        problems.length
          ? result('gate', 'fail', problems.join(' '), fixes.join(' '))
          : result(
              'gate',
              'pass',
              environment.gate === 'build'
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
      const open = exposed?.status === 200 && exposed.text.includes(changed);
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

    checks.push(
      result(
        'setup-files',
        'skip',
        'Not checked yet: listed setup files come with F3 of the frameworks plan.'
      )
    );
    checks.push(
      result(
        'speed',
        'skip',
        'Not checked yet: the speed budgets come with F4 of the frameworks plan.'
      )
    );
    return report(environment);
  } finally {
    fs.rmSync(path.join(repoRoot, ...own.split('/')), { recursive: true, force: true });
    recipe.syncPreview(repoRoot);
    fs.rmSync(shotsDir, { recursive: true, force: true });
  }
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
