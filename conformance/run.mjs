// The conformance suite: roughbook doctor over a recipe's fixture, the way a designer's repo would
// see it. `node conformance/run.mjs next [--skip-build] [--speed] [--snapshots] [--keep]` copies the fixture to
// a temp folder, installs it, prepares it as `roughbook init` would (without a server: the link is
// a stand-in), starts its dev server, runs doctor against it, and takes everything down. How each
// fixture is installed, served and taken down is in conformance/fixtures.json; a recipe whose
// previews are snapshots has no dev server, and doctor runs its snapshot command. With `--speed`,
// doctor starts the dev server itself with the environment's start command, as `roughbook start`
// does, so the cold start is measured with the other budgets. Exit code: 0 pass, 1 fail, 2
// unverified. With `--snapshots`, doctor checks the recipe's snapshot command (final review beside
// a live preview) instead of the page. Needs `npm run build` first, since it runs the studio from
// dist/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args.find(arg => !arg.startsWith('--'));
const skipBuild = args.includes('--skip-build');
const speed = args.includes('--speed');
const snapshots = args.includes('--snapshots');
const keep = args.includes('--keep');
if (!name) {
  console.error(
    'Usage: node conformance/run.mjs <fixture> [--skip-build] [--speed] [--snapshots] [--keep]'
  );
  process.exit(2);
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'conformance', 'fixtures.json'), 'utf8')
);
const pinned = manifest.fixtures[name];
if (!pinned) {
  console.error(`No fixture named ${name} in conformance/fixtures.json.`);
  process.exit(2);
}
const fixture = path.join(root, 'conformance', 'fixtures', name);
if (!fs.existsSync(fixture)) {
  console.error(`No fixture ${name}: run npm run fixtures -- ${name} first.`);
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
const { serveUntil, stopStartedProcesses } = await dist('launch/processes.js');
const { closeKeptBrowsers } = await dist('screenshot/browser.js');
const { recipeFor } = await dist('recipes/index.js');
const recipe = recipeFor(name);
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
  if (name !== 'laravel') return;
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

  const live = environment.mode !== 'snapshot' && !snapshots && pinned.dev;
  const port = await freePort();
  const fill = text => text.replaceAll('{port}', String(port)).replaceAll('{store}', store ?? '');
  const devCommand = pinned.dev ? fill(pinned.dev) : null;
  const devUrl = fill(pinned.url ?? 'http://localhost:{port}');
  if (pinned.header?.length) {
    // What this copy names over the recipe: a store's address, a start command through npx.
    fs.writeFileSync(
      path.join(work, 'rough', 'environment.md'),
      `---\ncontract: 1\nrecipe: ${name}\n${pinned.header.map(fill).join('\n')}\n---\n\n# This repo\n\nThe conformance suite's copy of the ${name} fixture.\n`
    );
  }
  if (live && speed) {
    // The environment names the start command on this port, so doctor can start the app itself
    // and time the cold start; the rest of the environment stays the recipe's.
    fs.writeFileSync(
      path.join(work, 'rough', 'environment.md'),
      `---\ncontract: 1\nrecipe: ${name}\nstart: ${devCommand} @ ${devUrl}\n---\n\n# This repo\n\nThe conformance suite's copy of the ${name} fixture.\n`
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
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  code = 1;
} finally {
  await cleanUp();
}
process.exit(code);
