// The conformance suite: roughbook doctor over a recipe's fixture, the way a designer's repo would
// see it. `node conformance/run.mjs next [--skip-build] [--keep]` copies the fixture to a temp
// folder, installs it, prepares it as `roughbook init` would (without a server: the link is a
// stand-in), starts its dev server, runs doctor against it, and takes everything down. Exit code:
// 0 pass, 1 fail, 2 unverified. Needs `npm run build` first, since it runs the studio from dist/.
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
const keep = args.includes('--keep');
if (!name) {
  console.error('Usage: node conformance/run.mjs <fixture> [--skip-build] [--keep]');
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

const dist = file => import(pathToFileURL(path.join(root, 'dist', file)).href);
const { planPrep, applyPrep } = await dist('repo/prep.js');
const { runDoctor, renderReport, exitCodeFor } = await dist('doctor/run.js');
const { serveUntil } = await dist('launch/processes.js');

/** How the fixture's dev server is started, per recipe, with the port it should take. */
const DEV_COMMANDS = {
  next: port => `npm run dev -- --port ${port}`
};
const devCommand = DEV_COMMANDS[name];
if (!devCommand) {
  console.error(`No dev command known for ${name}; add it to conformance/run.mjs.`);
  process.exit(2);
}

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function run(command, cwd) {
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, { cwd, stdio: 'inherit', shell: true, windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'signal'})`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), `roughbook-conformance-${name}-`));
console.log(`Fixture ${name} in ${work}`);
let served = null;
let code = 2;
try {
  fs.cpSync(fixture, work, {
    recursive: true,
    filter: source => !source.split(path.sep).includes('node_modules')
  });
  run('npm ci --no-audit --no-fund', work);

  // As roughbook init would, with a stand-in link: the suite has no server to link to.
  const plan = planPrep(work, {
    link: { version: 1, orgId: 'conformance', project: 'fixture', roughCommitted: true }
  });
  if (plan.problems.length) throw new Error(plan.problems.join(' '));
  applyPrep(plan);
  console.log(`Prepared: ${plan.changes.map(change => change.file).join(', ')}`);
  for (const step of plan.manual) console.log(`By hand: ${step}`);

  const port = await freePort();
  const devUrl = `http://localhost:${port}`;
  console.log(`\nStarting the dev server at ${devUrl}`);
  served = await serveUntil(devCommand(port), work, `${devUrl}/`, 180_000);
  if (!served) throw new Error('The dev server did not answer within 180 s.');

  // The suite's own checkout: its commands are the recipe's, approved here as a CI owner would.
  const report = await runDoctor(work, { devUrl, skipBuild, approve: true });
  console.log('');
  for (const line of renderReport(report)) console.log(line);
  code = exitCodeFor(report.outcome);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  code = 1;
} finally {
  if (served) await served.stop();
  if (keep) console.log(`\nKept ${work}`);
  else {
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      console.log(`\nCould not remove ${work}; remove it by hand.`);
    }
  }
}
process.exit(code);
