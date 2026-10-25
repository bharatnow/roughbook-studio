// Writes the conformance suite's fixture apps from the pinned scaffolds in conformance/fixtures.json:
// `node scripts/fixtures.mjs next` (or no name for every fixture). Each fixture is a fresh app in
// conformance/fixtures/<name>/ with its lockfiles and none of what they install (node_modules,
// vendor), so `npm ci` or `composer install` there gives the same app on every machine. `--latest`
// takes each scaffold's newest release instead, for the weekly run, and leaves fixtures.json alone.
// A fixture's runner says how its scaffold runs: npx (the default), composer create-project, the
// studio's own scaffold for the recipe (which needs `npm run build` first), or flutter create.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(root, 'conformance', 'fixtures.json');
const fixturesDir = path.join(root, 'conformance', 'fixtures');

/** What a scaffold leaves that its lockfiles bring back, or that no repo commits. */
const INSTALLED = ['node_modules', 'vendor', '.git', '.gradle', '.kotlin', '.build', '.dart_tool'];

/** One argument for a Windows command line: quoted when it has a space or a shell character. */
function quote(arg) {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Runs a program and waits. On Windows npm, npx, composer, gradle and flutter are batch files,
 * which Node refuses to start without a shell, so the whole command line is built here and given
 * to the shell as one string.
 */
function run(command, args, cwd) {
  // No one answers a scaffold's questions here: no input, and CI set, so it takes its defaults
  // (create-expo-app otherwise asks about the git repository the fixtures folder is in).
  const options = {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CI: '1' }
  };
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].map(quote).join(' '), { ...options, shell: true })
      : spawnSync(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd} (exit ${result.status ?? 'signal'})`
    );
  }
}

/** The fixture's arguments, with the app's folder where `{app}` stands, or first when none does. */
function withApp(args, appName) {
  return args.includes('{app}')
    ? args.map(arg => (arg === '{app}' ? appName : arg))
    : [appName, ...args];
}

/** The studio's own scaffold for a recipe, from dist/: its files written, its commands run. */
async function studioScaffold(name, appName, dir) {
  const index = path.join(root, 'dist', 'recipes', 'index.js');
  if (!fs.existsSync(index)) throw new Error('The studio is not built: run npm run build first.');
  const { recipeFor } = await import(pathToFileURL(index).href);
  const recipe = recipeFor(name);
  if (!recipe?.scaffold) throw new Error(`The studio has no scaffold for ${name}.`);
  const windows = process.platform === 'win32';
  for (const step of recipe.scaffold.steps(appName)) {
    if (step.kind === 'write') {
      for (const [file, text] of Object.entries(step.files)) {
        const target = path.join(dir, ...file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      }
      continue;
    }
    const line = (windows && step.windows) || step.line;
    // Installing is the lockfile's business here: it is pinned below, with nothing installed.
    if (/^npm install\b/.test(line)) continue;
    const [command, ...args] = line.split(' ');
    run(command, args, step.in === 'app' ? dir : path.dirname(dir));
  }
  return `the studio's ${recipe.name} scaffold (recipe version ${recipe.version})`;
}

async function write(name, fixture, latest) {
  const dir = path.join(fixturesDir, name);
  const runner = fixture.runner ?? 'npx';
  const version = latest ? 'latest' : fixture.version;
  console.log(`\n== ${name}: ${fixture.scaffold ?? runner}@${version}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(fixturesDir, { recursive: true });
  // The scaffold makes the folder itself; it refuses a folder that is not empty. A scaffold that
  // refuses the fixture's name as an app's (create-expo-app and "expo") makes it as `app`.
  const appName = fixture.app ?? name;
  const made = path.join(fixturesDir, appName);
  fs.rmSync(made, { recursive: true, force: true });
  let source = `${fixture.scaffold}@${version}`;
  if (runner === 'npx') {
    run(
      'npx',
      ['--yes', `${fixture.scaffold}@${version}`, ...withApp(fixture.args, appName)],
      fixturesDir
    );
  } else if (runner === 'composer') {
    const constraint = latest ? fixture.scaffold : `${fixture.scaffold}:${fixture.version}`;
    run('composer', ['create-project', constraint, appName, ...fixture.args], fixturesDir);
    // Pin every package without installing any: vendor is never committed.
    run('composer', ['update', '--no-install', '--no-scripts', '--no-interaction'], made);
    source = `composer create-project ${constraint}`;
  } else if (runner === 'studio') {
    fs.mkdirSync(made, { recursive: true });
    source = await studioScaffold(name, appName, made);
  } else if (runner === 'flutter') {
    run('flutter', ['create', ...fixture.args, appName], fixturesDir);
    source = `flutter create (Flutter ${fixture.version})`;
  } else {
    throw new Error(`${name}: no runner ${runner}.`);
  }
  if (appName !== name) fs.renameSync(made, dir);
  // Pin every JavaScript dependency without installing any: node_modules is never committed.
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    run(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      dir
    );
  }
  for (const folder of INSTALLED) {
    fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
  }
  fs.writeFileSync(
    path.join(dir, 'ROUGHBOOK-FIXTURE.md'),
    `# ${name}\n\nA conformance fixture written by \`node scripts/fixtures.mjs ${name}\` from ` +
      `${source}${latest ? ' (the latest release at the time)' : ''}, ` +
      `with the arguments in \`conformance/fixtures.json\`. Do not edit it by hand: regenerate it.\n`
  );
}

const args = process.argv.slice(2);
const latest = args.includes('--latest');
const names = args.filter(arg => !arg.startsWith('--'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const wanted = names.length ? names : Object.keys(manifest.fixtures);
for (const name of wanted) {
  const fixture = manifest.fixtures[name];
  if (!fixture) {
    console.error(`No fixture named ${name} in conformance/fixtures.json.`);
    process.exit(2);
  }
  // A brownfield fixture is another one's scaffold with its overlay: there is nothing to write.
  if (fixture.from) {
    console.log(
      `\n== ${name}: the ${fixture.from} fixture with conformance/overlays/${fixture.overlay}/`
    );
    continue;
  }
  await write(name, fixture, latest);
}
console.log(`\nWrote ${wanted.join(', ')} under conformance/fixtures/.`);
