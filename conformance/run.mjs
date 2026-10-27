// The conformance suite: roughbook doctor over a recipe's fixture, the way a designer's repo would
// see it. `node conformance/run.mjs next [--skip-build] [--speed] [--snapshots] [--keep]` copies the fixture to
// a temp folder, installs it, prepares it as `roughbook init` would (without a server: the link is
// a stand-in), starts its dev server, runs doctor against it, and takes everything down. How each
// fixture is installed, served and taken down is in conformance/fixtures.json; a recipe whose
// previews are snapshots has no dev server, and doctor runs its snapshot command. With `--speed`,
// doctor starts the dev server itself with the environment's start command, as `roughbook start`
// does, so the cold start is measured with the other budgets. Exit code: 0 pass, 1 fail, 2
// unverified. With `--snapshots`, doctor checks the recipe's snapshot command (final review beside
// a live preview) instead of the page. A fixture with an overlay gains its pages over the scaffold's,
// and one marked map (or any, with `--map`) is mapped as `roughbook map` maps it before doctor, so
// doctor's map checks run (ROUGHBOOK-BROWNFIELD-PLAN.md, B1). Needs `npm run build` first, since it
// runs the studio from dist/. Given several fixtures, it runs each in turn, in a process of its own
// with the same flags, and exits with the worst of their codes (B5b, decision 45).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const names = args.filter(arg => !arg.startsWith('--'));
const name = names[0];
const skipBuild = args.includes('--skip-build');
const speed = args.includes('--speed');
const snapshots = args.includes('--snapshots');
const keep = args.includes('--keep');
const mapped = args.includes('--map');
if (!name) {
  console.error(
    'Usage: node conformance/run.mjs <fixture> [<fixture> …] [--skip-build] [--speed] [--snapshots] [--map] [--keep]'
  );
  process.exit(2);
}
if (names.length > 1) {
  const flags = args.filter(arg => arg.startsWith('--'));
  const outcomes = [];
  for (const each of names) {
    const started = performance.now();
    const ran = spawnSync(process.execPath, [fileURLToPath(import.meta.url), each, ...flags], {
      stdio: 'inherit',
      windowsHide: true
    });
    outcomes.push({
      name: each,
      code: ran.status ?? 1,
      seconds: Math.round((performance.now() - started) / 1000)
    });
  }
  const words = { 0: 'passed', 1: 'failed', 2: 'unverified' };
  console.log('\nConformance:');
  for (const outcome of outcomes) {
    console.log(
      `  ${outcome.name}: ${words[outcome.code] ?? 'failed'} (exit ${outcome.code}, ${outcome.seconds} s)`
    );
  }
  // Failed over unverified over passed.
  const codes = outcomes.map(outcome => outcome.code);
  process.exit(codes.some(code => code !== 0 && code !== 2) ? 1 : codes.includes(2) ? 2 : 0);
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'conformance', 'fixtures.json'), 'utf8')
);
const pinned = manifest.fixtures[name];
if (!pinned) {
  console.error(`No fixture named ${name} in conformance/fixtures.json.`);
  process.exit(2);
}
// A brownfield fixture is another one's scaffold with an overlay of its own (B1 of the brownfield
// plan): the scaffold's recipe, the overlay's pages.
const base = pinned.from ?? name;
const fixture = path.join(root, 'conformance', 'fixtures', base);
if (!fs.existsSync(fixture)) {
  console.error(`No fixture ${base}: run npm run fixtures -- ${base} first.`);
  process.exit(2);
}
const overlay = pinned.overlay ? path.join(root, 'conformance', 'overlays', pinned.overlay) : null;
if (overlay && !fs.existsSync(overlay)) {
  console.error(`No overlay ${pinned.overlay} in conformance/overlays/.`);
  process.exit(2);
}
if (!fs.existsSync(path.join(root, 'dist', 'doctor', 'run.js'))) {
  console.error('The studio is not built: run npm run build first.');
  process.exit(2);
}
// A store the designer signed in to, for a recipe whose previews need one (Shopify's theme dev).
const store = pinned.store ? process.env[pinned.store] : undefined;
if (pinned.store && !store) {
  console.error(
    `${name} previews need a store: sign in to its CLI with your development store, and set ${pinned.store} to the store's name.`
  );
  process.exit(2);
}

const dist = file => import(pathToFileURL(path.join(root, 'dist', file)).href);
const { planPrep, applyPrep } = await dist('repo/prep.js');
const { runDoctor, renderReport, exitCodeFor } = await dist('doctor/run.js');
const { serveUntil, stopProcess, stopStartedProcesses, trackProcess } =
  await dist('launch/processes.js');
const { closeKeptBrowsers } = await dist('screenshot/browser.js');
const { recipeFor } = await dist('recipes/index.js');
const { mapRepo, describeMap, countMap } = await dist('map/run.js');
const { readEnvironment } = await dist('environment/read.js');
const { readRepoLink } = await dist('repo/link.js');
const { planAppSlot, writeAppSlot } = await dist('runs/base.js');
const { readMap } = await dist('map/file.js');
const { composedAddress } = await dist('compositions/save.js');
const recipe = recipeFor(base);
const environment = recipe.environment(null);

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function run(command, cwd, mustPass = true) {
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true, windowsHide: true });
  if (mustPass && result.status !== 0) {
    throw new Error(`${command} failed (exit ${result.status ?? 'signal'})`);
  }
}

/** Whether this machine's PHP has a module, such as pdo_sqlite. */
function phpHas(module, cwd) {
  const result = spawnSync('php -m', { cwd, encoding: 'utf8', shell: true, windowsHide: true });
  return result.status === 0 && result.stdout.split(/\r?\n/).some(line => line.trim() === module);
}

/**
 * What a fresh copy of a fixture needs on this machine beyond its install commands, named here
 * since it is the machine's, not the recipe's: Laravel's default sessions and cache are in SQLite,
 * which a PHP without pdo_sqlite cannot open, so they go to files there, as F3 found.
 */
function prepareMachine(work) {
  if (base !== 'laravel') return;
  if (phpHas('pdo_sqlite', work)) {
    fs.writeFileSync(path.join(work, 'database', 'database.sqlite'), '');
    run('php artisan migrate --force --no-interaction', work);
    return;
  }
  console.log('\nThis PHP has no pdo_sqlite: the copy keeps its sessions and cache in files.');
  const env = path.join(work, '.env');
  fs.writeFileSync(
    env,
    fs
      .readFileSync(env, 'utf8')
      .replace(/^SESSION_DRIVER=.*$/m, 'SESSION_DRIVER=file')
      .replace(/^CACHE_STORE=.*$/m, 'CACHE_STORE=file')
      .replace(/^QUEUE_CONNECTION=.*$/m, 'QUEUE_CONNECTION=sync')
  );
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), `roughbook-conformance-${name}-`));
console.log(`Fixture ${name} in ${work}`);
let code = 2;
let cleaning = null;

/**
 * Takes everything down, once: doctor's browser, every process the studio's code started with
 * everything it started (the dev server, even one still starting, and the app doctor starts
 * itself with --speed), what the dev command started outside it, and the copy.
 */
/**
 * The composed preview of `key`'s page: its sections' baselines written as roughbook adopt writes
 * them, then the page in reverse, `key`'s section on its iteration-01, asked until it answers (the
 * dev server compiles the route and the registry first).
 */
async function checkComposition(work, devUrl, key) {
  const [page, own] = key.split('/');
  const map = readMap(work)?.map;
  const sections = map?.pages.find(item => item.slug === page)?.sections ?? [];
  for (const slug of sections) {
    const folder = path.join(work, 'rough', page, slug, 'iteration-00');
    if (fs.existsSync(folder)) continue;
    const component = map.components.find(item => item.slug === slug);
    const files =
      component &&
      recipe.pointer?.(component, {
        iterationDir: `rough/${page}/${slug}/iteration-00`,
        fixture: null
      });
    for (const [file, text] of Object.entries(files ?? {})) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), text);
    }
  }
  recipe.syncPreview(work);
  const chosen = [...sections]
    .reverse()
    .filter(slug => fs.existsSync(path.join(work, 'rough', page, slug, 'iteration-00')))
    .map(slug => ({ component: slug, iteration: slug === own ? 'iteration-01' : 'iteration-00' }));
  const address = composedAddress(environment, page, chosen);
  const wanted = chosen.map(item => `${page}/${item.component}`);
  let found = [];
  let status = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${devUrl}${address}`, { signal: AbortSignal.timeout(60_000) });
      status = response.status;
      const html = await response.text();
      // A baseline renders the app's own component, which the in-page view marks too: one key each.
      found = [...html.matchAll(/data-roughbook-section="([^"]+)"/g)]
        .map(match => match[1])
        .filter((item, index, all) => item !== all[index - 1]);
      if (status === 200 && found.length >= wanted.length) break;
    } catch {
      status = null;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const inOrder = wanted.every((item, index) => found[index] === item);
  return {
    ok: status === 200 && inOrder,
    message:
      status === 200 && inOrder
        ? `${address} rendered ${wanted.length} sections in order, each in its marker.`
        : `${address} answered ${status ?? 'nothing'}, with ${found.join(', ') || 'no markers'}; wanted ${wanted.join(', ')}.`
  };
}

/** A baseline of `page`/`slug` as roughbook adopt writes it; false when the recipe cannot point at it. */
function writeBaseline(work, map, page, slug) {
  const folder = path.join(work, 'rough', page, slug, 'iteration-00');
  if (fs.existsSync(folder)) return true;
  const component = map.components.find(item => item.slug === slug);
  // Its fixture, where the map wrote one: a section with required props renders alone with it.
  const fixtureFile = component?.fixture ? path.join(work, ...component.fixture.split('/')) : null;
  const fixture =
    fixtureFile && fs.existsSync(fixtureFile) ? fs.readFileSync(fixtureFile, 'utf8') : null;
  const files =
    component &&
    recipe.pointer?.(component, { iterationDir: `rough/${page}/${slug}/iteration-00`, fixture });
  if (!files) return false;
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  }
  return true;
}

/** `next dev` on `port` with its output in `log`, once it answers; stopped with everything else. */
async function serveLogged(work, port, devUrl, log) {
  const out = fs.openSync(log, 'w');
  const child = trackProcess(
    spawn(
      process.execPath,
      [
        path.join(work, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'dev',
        '--port',
        String(port)
      ],
      {
        cwd: work,
        stdio: ['ignore', out, out],
        windowsHide: true,
        detached: process.platform !== 'win32'
      }
    )
  );
  fs.closeSync(out);
  const deadline = Date.now() + environment.timeouts.start * 1000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${devUrl}/`, {
        signal: AbortSignal.timeout(60_000),
        redirect: 'manual'
      });
      await response.body?.cancel();
      return child;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  await stopProcess(child);
  throw new Error(`next dev did not answer within ${environment.timeouts.start} s (${log}).`);
}

const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.mts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs'
];

/** Turbopack's development cache as it stands: its size and its newest file's time. */
function cacheState(dir) {
  let size = 0;
  let newest = 0;
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []) {
    try {
      const stat = fs.statSync(path.join(dir, file));
      size += stat.size;
      newest = Math.max(newest, stat.mtimeMs);
    } catch {
      // Turbopack replaced it while this looked.
    }
  }
  return `${size}:${newest}`;
}

/**
 * Whether the cache changed from `before` and then stayed the same for 3 s, within 120 s, as
 * conformance/upstream/next-lazy-ssr/repro.mjs waits for it.
 */
async function cacheWritten(dir, before) {
  const start = Date.now();
  let last = before;
  let since = Date.now();
  while (Date.now() - start < 120_000) {
    const now = cacheState(dir);
    if (now !== last) [last, since] = [now, Date.now()];
    else if (now !== before && Date.now() - since > 3000) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * The Turbopack cache fault (B7b of the brownfield plan, decisions 67 and 68), as the lead
 * reproduced it: `next dev` restarted onto its old development cache after files changed while it
 * was down answered "Lazily compiled dynamic import … was not activated" for what the earlier run
 * never compiled. Run 1 asks one swap and, with the cache on, waits until Turbopack has written
 * it; while it is down the in-page section's file moves, with the imports, the map and the
 * switch's files following; run 2, on the same .next/dev, asks a swap and previews run 1 never
 * compiled. Each must answer 200, and neither log may hold the error.
 */
async function checkRestart(work, port, devUrl) {
  await stopStartedProcesses();
  const map = readMap(work)?.map;
  const [page, slug] = pinned.inPage[0].split('/');
  const lines = [];
  // What no run has compiled yet: two more iterations of the in-page section, and baselines of
  // the sections of another page.
  for (const iteration of ['iteration-02', 'iteration-03']) {
    const target = { page, component: slug, iteration };
    writeAppSlot(
      work,
      `rough/${page}/${slug}/${iteration}`,
      planAppSlot(work, recipe, environment, target),
      { parent: 'iteration-00', commit: null }
    );
  }
  const other = map.pages.find(item => item.slug !== page && item.address === '/');
  const previews = (other?.sections ?? [])
    .filter(section => writeBaseline(work, map, other.slug, section))
    .slice(0, 3)
    .map(section => `${other.slug}/${section}/iteration-00`);
  recipe.syncPreview(work);
  const logs = ['run-1', 'run-2'].map(run =>
    path.join(work, '.next', `roughbook-conformance-${run}.log`)
  );
  fs.mkdirSync(path.dirname(logs[0]), { recursive: true });
  /** A page's answer: its status, and for a swap whether its marker says it swapped that in. */
  const ask = async (address, swap = null) => {
    try {
      const response = await fetch(`${devUrl}${address}`, {
        signal: AbortSignal.timeout(240_000),
        redirect: 'manual'
      });
      const html = await response.text();
      const shown = swap === null || html.includes(`data-roughbook-swap="${swap}"`);
      // What an error page says, in a line.
      const why =
        response.status === 200
          ? ''
          : (/(?:Error|⨯)[^<\n]{0,200}/.exec(html)?.[0] ??
            html
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 200));
      return { status: response.status, ok: response.status === 200 && shown, shown, why };
    } catch {
      return { status: null, ok: false, shown: false };
    }
  };
  const swapAt = iteration => `${page}/${slug}/${iteration}`;
  const address = map.pages.find(item => item.slug === page)?.address ?? `/${page}`;
  const answers = [];

  const cacheDir = path.join(work, '.next', 'dev', 'cache', 'turbopack');
  const before = cacheState(cacheDir);
  const first = await serveLogged(work, port, devUrl, logs[0]);
  const swap02 = await ask(
    `${address}?roughbook-swap=${swapAt('iteration-02')}`,
    swapAt('iteration-02')
  );
  answers.push(['run 1: swap iteration-02', swap02]);
  // Turbopack writes its cache once the server has been idle a moment; stopped before then, run 2
  // has nothing to restore and the fault cannot show. With the cache off nothing is written.
  const config = NEXT_CONFIGS.map(file => path.join(work, file)).find(file => fs.existsSync(file));
  const cacheOn = !/turbopackFileSystemCacheForDev:\s*false/.test(
    config ? fs.readFileSync(config, 'utf8') : ''
  );
  lines.push(
    cacheOn
      ? `run 1 left the cache ${(await cacheWritten(cacheDir, before)) ? 'written' : 'unwritten after 120 s'}`
      : "the config turns Turbopack's development cache off: nothing to wait for"
  );
  await stopProcess(first);

  // While it is down: the adopted file moves, the app's imports follow, then the map and the
  // switch's files, as a teammate's commit and roughbook start would leave them.
  const component = map.components.find(item => item.slug === slug);
  const from = component.files[0];
  const to = from.replace(/([^/]+)(\.\w+)$/, '$1-moved$2');
  fs.renameSync(path.join(work, ...from.split('/')), path.join(work, ...to.split('/')));
  const [spec, moved] = [from, to].map(file => `@/${file.replace(/\.\w+$/, '')}`);
  let imports = 0;
  for (const folder of ['app', 'components']) {
    for (const file of fs.readdirSync(path.join(work, folder), { recursive: true })) {
      if (!/\.tsx?$/.test(file)) continue;
      const full = path.join(work, folder, file);
      const text = fs.readFileSync(full, 'utf8');
      const now = text.replaceAll(`"${spec}"`, `"${moved}"`).replaceAll(`'${spec}'`, `'${moved}'`);
      if (now !== text) {
        fs.writeFileSync(full, now);
        imports += 1;
      }
    }
  }
  const mappedAgain = await mapRepo(work, await readEnvironment(work), await readRepoLink(work), {
    full: true
  });
  applyPrep(
    planPrep(work, {
      link: { version: 1, orgId: 'conformance', project: 'fixture', roughCommitted: true },
      recipe
    })
  );
  recipe.syncPreview(work);
  const followed = fs
    .readFileSync(path.join(work, 'rough', 'context-modules.json'), 'utf8')
    .includes(to);
  lines.push(
    `moved ${from} to ${to}: ${imports} file${imports === 1 ? '' : 's'} import it; the map ${mappedAgain?.renamed.length ? `renamed ${mappedAgain.renamed.length}` : 'renamed nothing'}; the switch's files ${followed ? 'follow it' : 'do not name it'}`
  );

  const second = await serveLogged(work, port, devUrl, logs[1]);
  answers.push(['run 2: the page', await ask(address)]);
  answers.push([
    'run 2: swap iteration-03',
    await ask(`${address}?roughbook-swap=${swapAt('iteration-03')}`, swapAt('iteration-03'))
  ]);
  for (const key of previews) {
    answers.push([`run 2: preview ${key}`, await ask(environment.preview.replace('{key}', key))]);
  }
  await stopProcess(second);

  const lost = logs.map(log => fs.readFileSync(log, 'utf8').split('was not activated').length - 1);
  for (const [what, answer] of answers) {
    lines.push(
      `${what}: ${answer.status ?? 'nothing'}${answer.status === 200 && !answer.shown ? ' without the iteration in its marker' : ''}${answer.why ? ` (${answer.why})` : ''}`
    );
  }
  lines.push(`"was not activated" in the logs: run 1 ${lost[0]}, run 2 ${lost[1]}`);
  const ok =
    followed &&
    previews.length > 0 &&
    answers.every(([, answer]) => answer.ok) &&
    lost.every(count => count === 0);
  return {
    ok,
    message: ok
      ? `next dev restarted onto its cache after the move answered all ${answers.length} asks.`
      : 'next dev restarted onto its cache after the move did not answer everything.',
    lines
  };
}

function cleanUp() {
  cleaning ??= (async () => {
    await Promise.all([closeKeptBrowsers(), stopStartedProcesses()]);
    // What the dev command started outside its own process (wp-env's containers).
    for (const command of pinned.down ?? []) {
      try {
        run(command, work, false);
      } catch {
        // Taking down is best effort; the report already stands.
      }
    }
    if (keep) {
      console.log(`\nKept ${work}`);
      return;
    }
    try {
      // fs.rmSync gives up at once on Windows while a file is still open (a server's child still
      // exiting), whatever its maxRetries says; fs.promises.rm waits between its tries.
      await fs.promises.rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      console.log(`\nCould not remove ${work}; remove it by hand.`);
    }
  })();
  return cleaning;
}

// Ctrl+C, or the run being stopped: without this the process dies at once, the dev server goes on
// running from the copy, and the copy stays in the temp folder. A second signal ends it at once.
let interrupted = false;
for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143]
]) {
  process.on(signal, () => {
    if (interrupted) process.exit(exitCode);
    interrupted = true;
    console.error(`\nInterrupted: taking the fixture down.`);
    void cleanUp().finally(() => process.exit(exitCode));
  });
}
try {
  fs.cpSync(fixture, work, {
    recursive: true,
    filter: source => !source.split(path.sep).includes('node_modules')
  });
  // The pages an existing app has, over the scaffold's (the brownfield plan's B1).
  if (overlay) {
    fs.cpSync(overlay, work, {
      recursive: true,
      filter: source => path.basename(source) !== 'ROUGHBOOK-OVERLAY.md'
    });
    console.log(`Overlaid conformance/overlays/${pinned.overlay}/`);
  }
  // A wrapper script loses its mode on a checkout made on Windows.
  if (process.platform !== 'win32' && fs.existsSync(path.join(work, 'gradlew'))) {
    fs.chmodSync(path.join(work, 'gradlew'), 0o755);
  }
  for (const command of pinned.install ?? []) run(command, work);
  prepareMachine(work);

  // As roughbook init would, with a stand-in link: the suite has no server to link to.
  const plan = planPrep(work, {
    link: { version: 1, orgId: 'conformance', project: 'fixture', roughCommitted: true },
    recipe
  });
  if (plan.problems.length) throw new Error(plan.problems.join(' '));
  applyPrep(plan);
  console.log(`Prepared: ${plan.changes.map(change => change.file).join(', ')}`);
  for (const step of plan.manual) console.log(`By hand: ${step}`);

  // Mapped and set up before the dev server starts, as a designer maps, runs roughbook setup
  // --upgrade and then starts the app: a dev server restarting for a changed config is not checked here.
  // The map of what the copy already has, as roughbook map writes it with no agent: doctor's map
  // checks then ask its pages and render its sections (the brownfield plan's B1).
  if (pinned.map || mapped) {
    const started = performance.now();
    const result = await mapRepo(work, await readEnvironment(work), await readRepoLink(work));
    const ms = Math.round(performance.now() - started);
    if (result) {
      console.log(
        `\nMapped in ${ms} ms (the discoverers alone: ${result.ms} ms): ${countMap(result.map)}.`
      );
      for (const line of describeMap(result.map)) console.log(line);
      for (const item of result.map.missed) console.log(`  missed ${item.what}: ${item.why}`);
      for (const file of result.map.unplaced) console.log(`  unplaced ${file}`);
    } else {
      console.log('\nNo discoverer fits this recipe, so nothing was mapped.');
    }
  }

  // The in-page view (B5 of the brownfield plan): each section named in inPage adopted as roughbook
  // adopt makes its baseline, an iteration copied from the app by the studio itself (no agent), and
  // the switch set up as roughbook setup --upgrade sets it up, so doctor's map-context shows it.
  if (pinned.inPage?.length) {
    const map = readMap(work)?.map;
    for (const key of pinned.inPage) {
      const [page, slug] = key.split('/');
      const component = map?.components.find(item => item.slug === slug);
      const files =
        component &&
        recipe.pointer?.(component, {
          iterationDir: `rough/${page}/${slug}/iteration-00`,
          fixture: null
        });
      if (!files) throw new Error(`The map has no ${key} to show in its page.`);
      for (const [file, text] of Object.entries(files)) {
        const target = path.join(work, 'rough', page, slug, 'iteration-00', ...file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      }
      const target = { page, component: slug, iteration: 'iteration-01' };
      const slot = planAppSlot(work, recipe, environment, target);
      writeAppSlot(work, `rough/${page}/${slug}/iteration-01`, slot, {
        parent: 'iteration-00',
        commit: null
      });
    }
    const upgrade = planPrep(work, {
      link: { version: 1, orgId: 'conformance', project: 'fixture', roughCommitted: true },
      recipe
    });
    applyPrep(upgrade);
    recipe.syncPreview(work);
    console.log(
      `
In its page: ${pinned.inPage.join(', ')}, with iteration-01 copied from the app; set up: ${upgrade.changes.map(change => change.file).join(', ') || 'nothing new'}`
    );
  }

  const live = environment.mode !== 'snapshot' && !snapshots && pinned.dev;
  const port = await freePort();
  const fill = text => text.replaceAll('{port}', String(port)).replaceAll('{store}', store ?? '');
  const devCommand = pinned.dev ? fill(pinned.dev) : null;
  const devUrl = fill(pinned.url ?? 'http://localhost:{port}');
  if (pinned.header?.length) {
    // What this copy names over the recipe: a store's address, a start command through npx.
    fs.writeFileSync(
      path.join(work, 'rough', 'environment.md'),
      `---\ncontract: 1\nrecipe: ${base}\n${pinned.header.map(fill).join('\n')}\n---\n\n# This repo\n\nThe conformance suite's copy of the ${name} fixture.\n`
    );
  }
  if (live && speed) {
    // The environment names the start command on this port, so doctor can start the app itself
    // and time the cold start; the rest of the environment stays the recipe's.
    fs.writeFileSync(
      path.join(work, 'rough', 'environment.md'),
      `---\ncontract: 1\nrecipe: ${base}\nstart: ${devCommand} @ ${devUrl}\n---\n\n# This repo\n\nThe conformance suite's copy of the ${name} fixture.\n`
    );
    console.log(`\nDoctor starts the dev server itself at ${devUrl} (--speed)`);
  } else if (live) {
    console.log(`\nStarting the dev server at ${devUrl}`);
    // Stopped in cleanUp with everything else the studio's code started.
    const served = await serveUntil(
      devCommand,
      work,
      `${devUrl}/`,
      environment.timeouts.start * 1000,
      environment.shell,
      // A container is brought up by a command that exits once the app in it is set up.
      { untilExit: environment.runtime.kind === 'container' }
    );
    if (!served) {
      throw new Error(`The dev server did not answer within ${environment.timeouts.start} s.`);
    }
  } else {
    console.log('\nNo dev server: doctor runs the snapshot command.');
  }

  // The suite's own checkout: its commands are the recipe's, approved here as a CI owner would.
  const report = await runDoctor(work, {
    devUrl,
    skipBuild,
    approve: true,
    speed,
    startApp: speed,
    snapshots
  });
  console.log('');
  for (const line of renderReport(report)) console.log(line);
  code = exitCodeFor(report.outcome);

  // A page's composition (B6 of the brownfield plan), where the recipe composes: every section of
  // the in-page fixture's page adopted, composed in reverse with its in-page iteration, and asked
  // of the preview route, which must render each in its marker, in that order.
  if (live && recipe.composes && pinned.inPage?.length) {
    const composed = await checkComposition(work, devUrl, pinned.inPage[0]);
    console.log(`
Composition: ${composed.message}`);
    if (!composed.ok) code = 1;
  }

  // The Turbopack cache fault (B7b): next dev restarted onto its cache after a move.
  if (live && !speed && pinned.restart && pinned.inPage?.length) {
    const restarted = await checkRestart(work, port, devUrl);
    console.log(`
Restart: ${restarted.message}`);
    for (const line of restarted.lines) console.log(`  ${line}`);
    if (!restarted.ok) code = 1;
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  code = 1;
} finally {
  await cleanUp();
}
process.exit(code);
