// Doctor in snapshot mode (ROUGHBOOK-FRAMEWORKS-PLAN.md, "roughbook doctor"): the same checks as a
// live preview's, proven through the repo's own snapshot command instead of a page. Doctor writes
// its samples, has the command render them with a key that has no iteration, and reads what came
// of each; then it changes the sample's fixture and its text, and expects new images for the
// changed key alone. Images cannot be read for text, so a change is proven by the images changing,
// and the sample's text is what the production build must not hold.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';
import { snapshotShots } from '../snapshot/contract.js';
import { pngSize, sameProportions } from '../snapshot/png.js';
import { renderSnapshots, type KeyResult, type SnapshotExec } from '../snapshot/render.js';
import { ORDER, SNAPSHOT_NAMES, result, rewrite, writeFiles } from './checks.js';
import { buildGate } from './gate.js';
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
import { setupFilesCheck } from './setupFiles.js';
import { judgeSpeed } from './speed.js';
import type { CheckId, CheckResult, DoctorOptions, DoctorTools } from './types.js';

const CONTRACT_FIX =
  'The snapshot command renders each key it is given ({keys}, ROUGHBOOK_KEYS or the request file) to one PNG per shot at ROUGHBOOK_OUT/<key>/<shot>.png, and says what came of each: a line "roughbook: ready <key>", "roughbook: missing <key>" or "roughbook: error <key>: <why>", or the same in result.txt beside the images (rough/CONTRACT.md, snapshot mode).';

/** The bytes of a key's first image, or null. */
function firstImage(repoRoot: string, outcome: KeyResult | undefined): Buffer | null {
  const file = outcome ? Object.values(outcome.files)[0] : undefined;
  if (!file) return null;
  try {
    return fs.readFileSync(path.join(repoRoot, ...file.split('/')));
  } catch {
    return null;
  }
}

/** Whether a variant is one the images must show: a scheme, a direction or a text size of its own. */
function mustShow(variant: { scheme: unknown; dir: unknown; text: unknown } | null): boolean {
  return Boolean(variant && (variant.scheme === 'dark' || variant.dir === 'rtl' || variant.text));
}

export async function runSnapshotChecks(
  repoRoot: string,
  environment: RepoEnvironment,
  recipe: Recipe | null,
  link: RepoLink | null,
  tools: DoctorTools,
  options: DoctorOptions,
  checks: CheckResult[]
): Promise<void> {
  const push = (id: CheckId, status: CheckResult['status'], detail: string, fix?: string) =>
    checks.push(result(id, status, detail, fix ?? null, SNAPSHOT_NAMES));
  const skipFrom = (id: CheckId, detail: string) => {
    for (const next of ORDER.slice(ORDER.indexOf(id))) push(next, 'skip', detail);
  };
  if (!environment.snapshot) {
    push(
      'app',
      'fail',
      `${ROUGH_DIR}/environment.md names no snapshot command, so nothing renders the images.`,
      'Name the command that renders keys to images in rough/environment.md (snapshot), or run roughbook setup --fix.'
    );
    skipFrom('renders', 'Not checked: there is no snapshot command.');
    return;
  }
  const marker = `roughbook-doctor-${randomBytes(4).toString('hex')}`;
  const fixtureNote = `fixture-${randomBytes(3).toString('hex')}`;
  const page = `${DOCTOR_PAGE}-${randomBytes(2).toString('hex')}`;
  const keyOf = (iteration: string) => `${page}/${DOCTOR_COMPONENT}/${iteration}`;
  const [good, broken, missing, speed] = [GOOD, BROKEN, MISSING, SPEED].map(keyOf) as [
    string,
    string,
    string,
    string
  ];
  const source = sampleSource(repoRoot, environment, recipe);
  if (!source) {
    push('app', 'skip', 'Not checked: there is no sample iteration to render.');
    push(
      'renders',
      'fail',
      `${ROUGH_DIR}/setup/sample/good/ and ${ROUGH_DIR}/setup/sample/broken/ are missing: the setup run writes one iteration that renders (its ${environment.entry}, with ${SAMPLE_MARKER} as text it shows${environment.fixture ? `, and ${environment.fixture} with ${SAMPLE_FIXTURE} in a value it shows` : ''}) and one that fails.`,
      'Run roughbook setup --fix so your agent writes the sample iterations, or write them by hand after rough/CONTRACT.md.'
    );
    skipFrom('fixture', 'Not checked: there is no sample iteration.');
    return;
  }
  const exec: SnapshotExec = (command, cwd, timeoutMs, shell, env) =>
    tools.snapshot(command, cwd, timeoutMs, shell, env);
  const render = (keys: string[], force = false) =>
    renderSnapshots(repoRoot, environment, keys, { exec, force, now: () => tools.now() });
  const goodFolder = iterationDir(page, DOCTOR_COMPONENT, GOOD);
  clearDoctorFolders(repoRoot);
  writeFiles(repoRoot, goodFolder, source('good', { marker, fixtureNote, key: good }));
  writeFiles(
    repoRoot,
    iterationDir(page, DOCTOR_COMPONENT, BROKEN),
    source('broken', { marker, fixtureNote, key: broken })
  );
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const shots = snapshotShots(environment);
  try {
    // 2. The command runs: the two samples and a key with no iteration, in one go.
    let first: Awaited<ReturnType<typeof render>>;
    try {
      first = await render([good, broken, missing], true);
    } catch (error) {
      push(
        'app',
        'fail',
        error instanceof Error ? error.message : String(error),
        'Fix what the message names in rough/environment.md (placement), and run roughbook doctor again.'
      );
      skipFrom(
        'renders',
        'Not checked: the iterations could not be put where the stack sees them.'
      );
      return;
    }
    const goodResult = first.results[good]!;
    const said = Object.values(first.results).some(item => item.said);
    if (first.code === null) {
      push(
        'app',
        'fail',
        `The snapshot command did not finish within ${environment.timeouts.preview} s.`,
        'Give it longer in rough/environment.md (timeoutPreview), or run it by hand to see why; a first run may download its tools.'
      );
      skipFrom('renders', 'Not checked: the snapshot command did not finish.');
      return;
    }
    if (goodResult.state !== 'ready' && !said) {
      push(
        'app',
        'fail',
        `The snapshot command ran (exit ${first.code}) but said nothing of the keys and rendered none${first.tail ? `: ${first.tail}` : '.'}`,
        CONTRACT_FIX
      );
      skipFrom('renders', 'Not checked: the snapshot command rendered nothing.');
      return;
    }
    push(
      'app',
      'pass',
      `The snapshot command ran for three keys in ${seconds(first.ms)} (exit ${first.code})${
        environment.placement.kind === 'in-tree'
          ? `, with the iterations mirrored at ${environment.placement.path}/`
          : ''
      }.`
    );

    // 3. The states.
    const rendered = goodResult.state === 'ready';
    push(
      'renders',
      rendered ? 'pass' : 'fail',
      rendered
        ? `The sample iteration rendered ${Object.keys(goodResult.files).length} image${shots.length === 1 ? '' : 's'}.`
        : `The sample iteration did not render: ${goodResult.message ?? 'no images came out.'}`,
      rendered ? undefined : CONTRACT_FIX
    );
    const unrendered = 'Not checked: the sample iteration did not render.';

    // The fixture: the same sample with another value in its fixture must give other images.
    if (!environment.fixture) {
      push('fixture', 'skip', "This stack's preview takes no fixture.");
    } else if (!rendered) {
      push('fixture', 'skip', unrendered);
    } else {
      const fixtureFile = path.join(repoRoot, ...goodFolder.split('/'), environment.fixture);
      if (!fs.existsSync(fixtureFile)) {
        push(
          'fixture',
          'fail',
          `The sample iteration has no ${environment.fixture}.`,
          `The sample that renders holds ${environment.fixture} with ${SAMPLE_FIXTURE} in a value it shows.`
        );
      } else {
        const before = firstImage(repoRoot, goodResult);
        fs.writeFileSync(
          fixtureFile,
          fs.readFileSync(fixtureFile, 'utf8').replaceAll(fixtureNote, `${fixtureNote}-changed`)
        );
        const again = await render([good]);
        const after = firstImage(repoRoot, again.results[good]);
        push(
          'fixture',
          after && before && !after.equals(before) ? 'pass' : 'fail',
          after && before && !after.equals(before)
            ? `Another value in the sample's ${environment.fixture} gave other images.`
            : again.results[good]?.state !== 'ready'
              ? `With another value in its ${environment.fixture}, the sample did not render: ${again.results[good]?.message ?? ''}`.trim()
              : `With another value in its ${environment.fixture}, the sample's images did not change.`,
          `Pass the contents of an iteration's ${environment.fixture} to it as its inputs (contract point 2).`
        );
      }
    }

    const brokenResult = first.results[broken]!;
    const missingResult = first.results[missing]!;
    // When the sample that renders did not, the others failing says nothing of how the command
    // reports them: the same cause failed every key.
    const sameCause = (other: KeyResult) =>
      !rendered && other.state === 'failed' && other.message === goodResult.message;
    if (sameCause(brokenResult)) push('reports-broken', 'skip', unrendered);
    else
      push(
        'reports-broken',
        brokenResult.state === 'failed' ? 'pass' : 'fail',
        brokenResult.state === 'failed'
          ? `The failing iteration was reported: ${brokenResult.message}`
          : brokenResult.state === 'ready'
            ? 'The failing iteration was reported as rendered.'
            : 'The failing iteration was reported as missing, though it is there.',
        'An iteration that fails to render is reported with "roughbook: error <key>: <why>" (or error: in result.txt), and gets no images (rough/CONTRACT.md).'
      );
    if (sameCause(missingResult)) push('reports-missing', 'skip', unrendered);
    else
      push(
        'reports-missing',
        missingResult.state !== 'ready' ? 'pass' : 'fail',
        missingResult.state === 'missing'
          ? 'A key with no iteration was reported missing.'
          : missingResult.state === 'failed'
            ? `A key with no iteration was reported: ${missingResult.message}`
            : 'A key with no iteration was reported as rendered.',
        'A key with no iteration is reported with "roughbook: missing <key>" (or missing in result.txt).'
      );

    // 4. Every shot a PNG at its viewport's proportions, and the variants showing.
    if (!rendered) {
      push('screenshots', 'skip', unrendered);
    } else {
      const latest = (await render([good])).results[good]!;
      const problems: string[] = [];
      const sizes: string[] = [];
      const bytes = new Map<string, Buffer>();
      for (const shot of shots) {
        const file = latest.files[shot.name];
        if (!file) {
          problems.push(`no image for ${shot.name}`);
          continue;
        }
        const data = fs.readFileSync(path.join(repoRoot, ...file.split('/')));
        bytes.set(shot.name, data);
        const size = pngSize(data);
        if (!size) problems.push(`${shot.name}.png is not a PNG`);
        else if (!sameProportions(size, shot.viewport)) {
          problems.push(
            `${shot.name} is ${size.width}×${size.height}, not the proportions of ${shot.viewport.width}×${shot.viewport.height}`
          );
        } else sizes.push(`${shot.name} ${size.width}×${size.height}`);
      }
      for (const shot of shots) {
        const base = shots.find(item => item.viewport.name === shot.viewport.name)!;
        if (shot === base || !mustShow(shot.variant)) continue;
        const one = bytes.get(shot.name);
        const other = bytes.get(base.name);
        if (one && other && one.equals(other)) {
          problems.push(
            `${shot.name} is the same image as ${base.name}: ${shot.variant!.id} changed nothing`
          );
        }
      }
      push(
        'screenshots',
        problems.length ? 'fail' : 'pass',
        problems.length
          ? `${problems.join('; ')}.`
          : `${shots.length} image${shots.length === 1 ? '' : 's'}: ${sizes.join(', ')}.`,
        'Render each key at every viewport the environment names (its width and height at any density) and in every variant, applying a dark scheme, right-to-left text and large text the way the app does (ROUGHBOOK_SHOTS, or shots in the request file).'
      );
    }

    // 5. Only a changed iteration is rendered again, and a change shows.
    const changed = `${marker}-changed`;
    if (!rendered) {
      push('fresh', 'skip', unrendered);
    } else {
      const idle = await render([good]);
      const before = firstImage(repoRoot, idle.results[good]);
      rewrite(repoRoot, goodFolder, marker, changed);
      const after = await render([good]);
      const image = firstImage(repoRoot, after.results[good]);
      const problems: string[] = [];
      if (idle.asked.includes(good)) {
        problems.push('the unchanged sample was rendered again');
      }
      if (after.asked.join() !== good) problems.push('the changed sample was not rendered again');
      else if (after.results[good]?.state !== 'ready') {
        problems.push(`the changed sample did not render: ${after.results[good]?.message}`);
      } else if (!image || (before && image.equals(before))) {
        problems.push("the changed sample's images did not change");
      }
      push(
        'fresh',
        problems.length ? 'fail' : 'pass',
        problems.length
          ? `${problems.join('; ').replace(/^./, char => char.toUpperCase())}.`
          : `With nothing changed the sample was not rendered again; after a change it alone was, in ${seconds(after.ms)}, and its images changed.`,
        "The snapshot command must render an iteration's files as they are now, each time it is asked: no cache of its own that outlives a change (contract point 4)."
      );
    }

    // 6. The gate: the production build, with the sample in place, holds nothing of it.
    if (options.skipBuild) {
      push(
        'gate',
        'skip',
        'The production build was skipped (--skip-build), so the repo is unverified.'
      );
    } else {
      const problems: string[] = [];
      const fixes: string[] = [];
      const held: string[] = [];
      if (environment.gate !== 'build') {
        problems.push(
          'Snapshot mode serves nothing in production to ask, so its gate is the production build (gate: build).'
        );
        fixes.push(
          'Set gate: build, with the release build command (build) and the folders it writes (buildOutput).'
        );
      }
      syncIterations(repoRoot, environment);
      const found = await buildGate(repoRoot, environment, tools, changed);
      problems.push(...found.problems);
      fixes.push(...found.fixes);
      held.push(...found.held);
      if (environment.placement.kind === 'in-tree' && !problems.length) {
        held.push(`the sample was mirrored at ${environment.placement.path}/ while it built`);
      }
      const said = held.join(', and ');
      push(
        'gate',
        problems.length ? 'fail' : 'pass',
        problems.length ? problems.join(' ') : `${said.charAt(0).toUpperCase()}${said.slice(1)}.`,
        fixes.join(' ')
      );
    }

    // 7. Nothing is served.
    push(
      'loopback',
      'skip',
      'Snapshot mode serves nothing: its images are files in rough/.screenshots/.'
    );

    // 8. The setup files.
    checks.push(await setupFilesCheck(repoRoot, environment, recipe, link, SNAPSHOT_NAMES));

    // 9. Speed: a new iteration to its images, and nothing rendered again with nothing changed.
    if (!options.speed) {
      push(
        'speed',
        'skip',
        'Not checked: pass --speed to measure the budgets (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed").'
      );
      return;
    }
    writeFiles(
      repoRoot,
      iterationDir(page, DOCTOR_COMPONENT, SPEED),
      source('good', { marker: `${marker}-speed`, fixtureNote, key: speed })
    );
    const startedAt = tools.now();
    const timed = await render([speed]);
    const visible = timed.results[speed]?.state === 'ready' ? tools.now() - startedAt : null;
    const repeat = await render([speed]);
    const judged = judgeSpeed({
      snapshot: true,
      previewVisibleMs: visible,
      coldStartMs: null,
      noColdStart: 'the snapshot tool starts with each render, kept warm by its own daemon',
      screenshotsMs: null,
      noScreenshots: 'in snapshot mode the images are the screenshots',
      shots: shots.length,
      again: repeat.asked.length * shots.length,
      viewports: environment.viewports.length,
      variants: Math.max(1, environment.variants.length)
    });
    push('speed', judged.pass ? 'pass' : 'fail', judged.detail, judged.fix ?? undefined);
  } finally {
    fs.rmSync(path.join(repoRoot, ROUGH_DIR, page), { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, ROUGH_DIR, '.screenshots', page), {
      recursive: true,
      force: true
    });
    try {
      syncIterations(repoRoot, environment);
    } catch {
      // The mirror was refused above; there is nothing of doctor's in it.
    }
  }
}
