// Writes the conformance suite's fixture apps from the pinned scaffolds in conformance/fixtures.json:
// `node scripts/fixtures.mjs next` (or no name for every fixture). Each fixture is a fresh app in
// conformance/fixtures/<name>/ with a lockfile and no node_modules, so `npm ci` there gives the
// same app on every machine. `--latest` takes each scaffold's newest release instead, for the
// weekly run, and leaves fixtures.json alone.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(root, 'conformance', 'fixtures.json');
const fixturesDir = path.join(root, 'conformance', 'fixtures');

/** One argument for a Windows command line: quoted when it has a space or a shell character. */
function quote(arg) {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Runs npm or npx and waits. On Windows they are .cmd files, which Node refuses to start without
 * a shell, so the whole command line is built here and given to the shell as one string.
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

function write(name, fixture, latest) {
  const dir = path.join(fixturesDir, name);
  const version = latest ? 'latest' : fixture.version;
  console.log(`\n== ${name}: ${fixture.scaffold}@${version}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(fixturesDir, { recursive: true });
  // The scaffold makes the folder itself; it refuses a folder that is not empty. A scaffold that
  // refuses the fixture's name as an app's (create-expo-app and "expo") makes it as `app`.
  const appName = fixture.app ?? name;
  fs.rmSync(path.join(fixturesDir, appName), { recursive: true, force: true });
  run('npx', ['--yes', `${fixture.scaffold}@${version}`, appName, ...fixture.args], fixturesDir);
  if (appName !== name) fs.renameSync(path.join(fixturesDir, appName), dir);
  // Pin every dependency without installing any: node_modules is never committed.
  run(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    dir
  );
  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(dir, 'ROUGHBOOK-FIXTURE.md'),
    `# ${name}\n\nA conformance fixture written by \`node scripts/fixtures.mjs ${name}\` from ` +
      `${fixture.scaffold}@${version}${latest ? ' (the latest release at the time)' : ''}, ` +
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
  write(name, fixture, latest);
}
console.log(`\nWrote ${wanted.join(', ')} under conformance/fixtures/.`);
