// F6 of the frameworks plan: snapshot mode. The snapshot command's contract (keys in, images out,
// an exit code and a word per key), rendering only the changed keys, the optional device command,
// iterations placed in the source tree (mirrored there and excluded everywhere else), assets copied
// into an iteration for a snapshot stack, and doctor proving it all through the command.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { StudioApi } from '../api/client.js';
import { runDoctor } from '../doctor/run.js';
import { findSentinel, zipEntries } from '../doctor/sentinel.js';
import type { DoctorReport, DoctorTools } from '../doctor/types.js';
import {
  environmentFromHeader,
  parseEnvironmentHeader,
  readEnvironmentSync
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { runCapture } from '../launch/processes.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import type { RepoLink } from '../repo/link.js';
import { MIRROR_MARK, moduleOf, syncMirror } from '../repo/mirror.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { assetTarget, copyAssets, namedAssets } from '../runs/assets.js';
import { startRuns } from '../runs/lifecycle.js';
import { hashRepo } from '../runs/snapshot.js';
import type { StartedRun } from '../runs/types.js';
import { screenshotIteration } from '../screenshot/iteration.js';
import {
  commandFor,
  parseResultFile,
  parseSnapshotOutput,
  shotsVariable,
  snapshotShots
} from '../snapshot/contract.js';
import { deviceCommandFor, openOnDevice } from '../snapshot/device.js';
import { pngSize, sameProportions } from '../snapshot/png.js';
import { renderSnapshots, type SnapshotExec } from '../snapshot/render.js';
import { fakeFetch, ok, refused, tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const MIRROR = 'app/src/debug/kotlin/rough';

/** A snapshot stack with no recipe, its iterations mirrored into a debug-only source set. */
const HEADER = `---
contract: 1
recipe: none
stack:
  - android
  - kotlin
family: compose
mode: snapshot
entry: Iteration.kt
sources:
  - .kt
placement: in-tree ${MIRROR}
snapshot: gradlew roughSnapshots --keys={keys}
snapshotWindows: gradlew.bat roughSnapshots --keys={keys}
device: adb shell am start -d roughbook://preview/{key}
build: gradlew assembleRelease
buildOutput:
  - app/build/outputs
gate: build
fixture: preview.json
viewports:
  - phone 390x844 mobile
  - tablet 800x1280 mobile
variants:
  - light
  - dark
ignore:
  - .gradle
  - build
---

# This repo

A Compose app, previewed by snapshot tests on the JVM.
`;

const GOOD_SAMPLE = `package rough.{{roughbook:module}}

object Iteration {
  val text = "{{roughbook:marker}}"
}
`;
const BROKEN_SAMPLE = `package rough.{{roughbook:module}}

object Iteration {
  init { throw IllegalStateException("roughbook doctor: this iteration fails on purpose") }
}
`;

function write(repo: string, file: string, text: string | Buffer) {
  const full = path.join(repo, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function read(repo: string, file: string): string {
  return fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
}

function environmentOf(header: string, os: 'windows' | 'linux' = 'linux'): RepoEnvironment {
  return environmentFromHeader(parseEnvironmentHeader(header)!, LINK, os);
}

/** A PNG's signature and header, then `payload`: all the studio reads of one. */
function fakePng(width: number, height: number, payload: string): Buffer {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'latin1');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    Buffer.from(payload)
  ]);
}

/** A zip with deflated entries, as a build packs an app. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

type ToolFaults = Partial<{
  /** Prints nothing and writes nothing, exiting 1: a command that never learnt the contract. */
  silent: boolean;
  /** Says what came of each key in result.txt only, as a test runner that swallows output. */
  quiet: boolean;
  /** Renders every variant the same. */
  ignoresVariants: boolean;
  /** Keeps rendering what it first saw of each key. */
  stale: boolean;
  /** Square images whatever the viewport. */
  square: boolean;
  /** Ignores the fixture. */
  noFixture: boolean;
}>;

/**
 * A snapshot tool that keeps the contract: it reads the keys and shots from the variables and the
 * iterations from where the stack sees them, writes one image per shot whose bytes follow the
 * iteration's files and the variant, says ready, error or missing per key, and exits 1 when any
 * key did not render.
 */
function fakeSnapshotTool(faults: ToolFaults = {}) {
  const asked: string[][] = [];
  const commands: string[] = [];
  const seen = new Map<string, string>();
  const exec: SnapshotExec = async (command, _cwd, _timeoutMs, _shell, env) => {
    commands.push(command);
    if (faults.silent) return { code: 1, output: 'BUILD FAILED' };
    const keys = env.ROUGHBOOK_KEYS!.split(',');
    asked.push(keys);
    const shots = env.ROUGHBOOK_SHOTS!.split(',').map(item => item.split(':'));
    const lines: string[] = [];
    let failed = false;
    for (const key of keys) {
      const dir = path.join(env.ROUGHBOOK_ITERATIONS!, ...key.split('/'));
      const out = path.join(env.ROUGHBOOK_OUT!, ...key.split('/'));
      const say = (word: string) => {
        if (faults.quiet) {
          fs.mkdirSync(out, { recursive: true });
          fs.writeFileSync(path.join(out, 'result.txt'), `${word}\n`);
        } else lines.push(`> Task :app:test  roughbook: ${word.replace(/^(\w+)/, `$1 ${key}`)}`);
      };
      if (!fs.existsSync(dir)) {
        failed = true;
        say('missing');
        continue;
      }
      const files = fs
        .readdirSync(dir)
        .sort()
        .filter(file => !(faults.noFixture && file === 'preview.json'))
        .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
        .join('\n');
      if (files.includes('throw ')) {
        failed = true;
        say(
          'error: java.lang.IllegalStateException: roughbook doctor: this iteration fails on purpose'
        );
        continue;
      }
      if (!seen.has(key)) seen.set(key, files);
      const content = faults.stale ? seen.get(key)! : files;
      for (const [name, size, variant] of shots) {
        const [width, height] = size!.split('x').map(Number) as [number, number];
        const payload = createHash('sha256')
          .update(`${content}\n${faults.ignoresVariants ? '' : variant}`)
          .digest('hex');
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(
          path.join(out, `${name}.png`),
          fakePng(
            faults.square ? width * 2 : width * 2,
            faults.square ? width * 2 : height * 2,
            payload
          )
        );
      }
      say('ready');
    }
    return { code: failed ? 1 : 0, output: lines.join('\n') };
  };
  return { exec, asked, commands };
}

/** A prepared snapshot repo, its commands approved, with the setup's sample iterations. */
async function snapshotRepo(header = HEADER, samples = true): Promise<string> {
  const repo = await tempDir('roughbook-snapshot-');
  write(repo, 'settings.gradle.kts', 'include(":app")\n');
  write(repo, 'build.gradle.kts', '// the app\n');
  write(repo, 'rough/environment.md', header);
  if (samples) {
    write(repo, 'rough/setup/sample/good/Iteration.kt', GOOD_SAMPLE);
    write(repo, 'rough/setup/sample/good/preview.json', '{ "note": "{{roughbook:fixture}}" }\n');
    write(repo, 'rough/setup/sample/broken/Iteration.kt', BROKEN_SAMPLE);
  }
  applyPrep(planPrep(repo, { link: LINK, recipe: null }));
  await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, LINK)));
  return repo;
}

/** Doctor's tools for a snapshot repo: the fake tool, and a release build that leaks or not. */
function doctorTools(
  repo: string,
  tool: ReturnType<typeof fakeSnapshotTool>,
  build: { leaks?: boolean; code?: number } = {}
): Partial<DoctorTools> & { built: string[] } {
  const built: string[] = [];
  let clock = 0;
  return {
    built,
    snapshot: tool.exec,
    which: program => `/fake/bin/${program}`,
    browser: null,
    fetch: (async () => {
      throw new Error('snapshot mode asks no server');
    }) as typeof fetch,
    async exec(command) {
      built.push(command);
      // A release build that compiled the debug mirror would carry the sample's text.
      const mirrored = fs.existsSync(path.join(repo, ...MIRROR.split('/')))
        ? fs
            .readdirSync(path.join(repo, ...MIRROR.split('/')), { recursive: true })
            .map(String)
            .filter(file => file.endsWith('Iteration.kt'))
            .map(file => read(repo, `${MIRROR}/${file.split(path.sep).join('/')}`))
            .join('\n')
        : '';
      write(
        repo,
        'app/build/outputs/apk/release/app-release.apk',
        zip({ 'classes.dex': build.leaks ? `dex\n${mirrored}` : 'dex\napp only' })
      );
      return { code: build.code ?? 0 };
    },
    addresses: () => ['192.168.1.20'],
    sleep: async () => {},
    now: () => (clock += 1000)
  };
}

function statuses(report: DoctorReport): Record<string, string> {
  return Object.fromEntries(report.checks.map(check => [check.id, check.status]));
}

function check(report: DoctorReport, id: string) {
  return report.checks.find(item => item.id === id)!;
}

describe('the snapshot contract', () => {
  it('takes keys in the command line, and reads a word per key from any line of the output', () => {
    assert.equal(
      commandFor('gradlew roughSnapshots --keys={keys}', [
        'home/hero/iteration-01',
        'home/hero/iteration-02'
      ]),
      'gradlew roughSnapshots --keys=home/hero/iteration-01,home/hero/iteration-02'
    );
    const said = parseSnapshotOutput(
      [
        'roughbook: ready home/hero/iteration-01',
        '> Task :app:testDebugUnitTest roughbook: error home/hero/iteration-02: boom: it threw',
        'roughbook: missing home/hero/iteration-99',
        'roughbook: error home/hero/iteration-03: first try',
        'roughbook: ready home/hero/iteration-03',
        'not roughbook: ready home/hero'
      ].join('\r\n')
    );
    assert.deepEqual(Object.fromEntries(said), {
      'home/hero/iteration-01': { state: 'ready', message: null },
      'home/hero/iteration-02': { state: 'failed', message: 'boom: it threw' },
      'home/hero/iteration-99': { state: 'missing', message: null },
      // The last word on a key is what came of it.
      'home/hero/iteration-03': { state: 'ready', message: null }
    });
    assert.deepEqual(parseResultFile('ready\n'), { state: 'ready', message: null });
    assert.deepEqual(parseResultFile('missing'), { state: 'missing', message: null });
    assert.deepEqual(parseResultFile('error: Out of memory\n  at line 3'), {
      state: 'failed',
      message: 'Out of memory\n  at line 3'
    });
    assert.equal(parseResultFile('something else'), null);
  });

  it('names one shot per viewport in each variant, as screenshots are named', () => {
    const environment = environmentOf(HEADER);
    const shots = snapshotShots(environment);
    assert.deepEqual(
      shots.map(shot => shot.name),
      ['phone', 'tablet', 'phone-dark', 'tablet-dark']
    );
    assert.equal(
      shotsVariable(shots),
      'phone:390x844:light,tablet:800x1280:light,phone-dark:390x844:dark,tablet-dark:800x1280:dark'
    );
  });

  it('reads a PNG’s size and holds it to the viewport’s proportions at any density', () => {
    assert.deepEqual(pngSize(fakePng(1170, 2532, 'x')), { width: 1170, height: 2532 });
    assert.equal(pngSize(Buffer.from('not an image at all, not at all')), null);
    assert.ok(sameProportions({ width: 1170, height: 2532 }, { width: 390, height: 844 }));
    assert.ok(!sameProportions({ width: 1080, height: 1080 }, { width: 390, height: 844 }));
  });

  it('passes the command its variables, and keeps what it printed', async () => {
    const dir = await tempDir('roughbook-capture-');
    const ran = await runCapture(
      `"${process.execPath}" -e "console.log('roughbook: ready ' + process.env.ROUGHBOOK_KEYS); console.error('to stderr'); process.exit(3)"`,
      dir,
      30_000,
      'none',
      { ROUGHBOOK_KEYS: 'home/hero/iteration-01' }
    );
    assert.equal(ran.code, 3);
    assert.match(ran.output, /roughbook: ready home\/hero\/iteration-01/);
    assert.match(ran.output, /to stderr/);
  });
});

describe('rendering snapshots', () => {
  async function repoWith(keys: string[], header = HEADER) {
    const repo = await snapshotRepo(header, false);
    for (const key of keys) {
      write(repo, `rough/${key}/Iteration.kt`, `package rough.${moduleOf(key)}\n// ${key}\n`);
    }
    return { repo, environment: readEnvironmentSync(repo, LINK) };
  }

  it('renders the keys it is given to images at their screenshot paths, through the mirror', async () => {
    const { repo, environment } = await repoWith([
      'home/hero/iteration-01',
      'home/hero/iteration-02'
    ]);
    write(repo, 'rough/home/hero/iteration-02/Iteration.kt', 'throw here\n');
    const tool = fakeSnapshotTool();
    const run = await renderSnapshots(
      repo,
      environment,
      ['home/hero/iteration-01', 'home/hero/iteration-02', 'home/hero/iteration-07'],
      { exec: tool.exec }
    );
    assert.deepEqual(run.asked, [
      'home/hero/iteration-01',
      'home/hero/iteration-02',
      'home/hero/iteration-07'
    ]);
    assert.equal(run.code, 1);
    assert.match(
      tool.commands[0]!,
      /^gradlew(\.bat)? roughSnapshots --keys=home\/hero\/iteration-01,home\/hero\/iteration-02,home\/hero\/iteration-07$/
    );
    const one = run.results['home/hero/iteration-01']!;
    assert.equal(one.state, 'ready');
    assert.deepEqual(Object.keys(one.files), ['phone', 'tablet', 'phone-dark', 'tablet-dark']);
    assert.equal(one.files.phone, 'rough/.screenshots/home/hero/iteration-01/phone.png');
    assert.equal(run.results['home/hero/iteration-02']!.state, 'failed');
    assert.match(run.results['home/hero/iteration-02']!.message!, /fails on purpose/);
    assert.equal(run.results['home/hero/iteration-07']!.state, 'missing');
    // The tool read the iterations from the mirror, which the studio wrote before running it.
    assert.ok(
      fs.existsSync(
        path.join(repo, ...MIRROR.split('/'), 'home', 'hero', 'iteration-01', 'Iteration.kt')
      )
    );
    // The request file says it all again, for a tool that would rather read one.
    const request = JSON.parse(read(repo, 'rough/.roughbook/snapshot-request.json'));
    assert.deepEqual(request.keys, run.asked);
    assert.equal(request.shots.length, 4);
    assert.equal(request.shots[2].variant.scheme, 'dark');
    assert.equal(request.fixture, 'preview.json');
  });

  it('reads each key’s word from result.txt when the runner swallows its output', async () => {
    const { repo, environment } = await repoWith(['home/hero/iteration-01']);
    const tool = fakeSnapshotTool({ quiet: true });
    const run = await renderSnapshots(
      repo,
      environment,
      ['home/hero/iteration-01', 'home/hero/iteration-09'],
      {
        exec: tool.exec
      }
    );
    assert.equal(run.results['home/hero/iteration-01']!.state, 'ready');
    assert.equal(run.results['home/hero/iteration-01']!.said, true);
    assert.equal(run.results['home/hero/iteration-09']!.state, 'missing');
  });

  it('counts a key as rendered only with every image new, and says why one was not', async () => {
    const { repo, environment } = await repoWith(['home/hero/iteration-01']);
    // Exit 0 and every image written: rendered, though the command said nothing.
    const plain: SnapshotExec = async (_command, _cwd, _ms, _shell, env) => {
      for (const shot of env.ROUGHBOOK_SHOTS!.split(',')) {
        write(
          repo,
          `rough/.screenshots/home/hero/iteration-01/${shot.split(':')[0]}.png`,
          fakePng(780, 1688, shot)
        );
      }
      return { code: 0, output: '' };
    };
    const quietRun = await renderSnapshots(repo, environment, ['home/hero/iteration-01'], {
      exec: plain
    });
    assert.equal(quietRun.results['home/hero/iteration-01']!.state, 'ready');
    assert.equal(quietRun.results['home/hero/iteration-01']!.said, false);

    const cases: [SnapshotExec, RegExp][] = [
      [
        async () => ({
          code: 1,
          output: 'FAILURE: Build failed with an exception.\nCompilation error'
        }),
        /failed \(exit 1\): FAILURE.*Compilation error/
      ],
      [async () => ({ code: null, output: '' }), /did not finish within 150 s/],
      [
        async () => ({ code: 0, output: 'roughbook: ready home/hero/iteration-01' }),
        /said it rendered .* but wrote no image/
      ],
      [async () => ({ code: 0, output: '' }), /wrote no image for phone, tablet/]
    ];
    for (const [exec, why] of cases) {
      const run = await renderSnapshots(repo, environment, ['home/hero/iteration-01'], {
        exec,
        force: true
      });
      assert.equal(run.results['home/hero/iteration-01']!.state, 'failed');
      assert.match(run.results['home/hero/iteration-01']!.message!, why);
    }
  });

  it('renders only the keys whose files changed, every key with force, and a failed key again', async () => {
    const keys = ['home/hero/iteration-01', 'home/hero/iteration-02', 'home/hero/iteration-03'];
    const { repo, environment } = await repoWith(keys);
    write(repo, 'rough/home/hero/iteration-03/Iteration.kt', 'throw now\n');
    const tool = fakeSnapshotTool();
    await renderSnapshots(repo, environment, keys, { exec: tool.exec });
    assert.deepEqual(tool.asked.at(-1), keys);

    write(
      repo,
      'rough/home/hero/iteration-02/Iteration.kt',
      'package rough.home.hero.iteration_02\n// changed\n'
    );
    const again = await renderSnapshots(repo, environment, keys, { exec: tool.exec });
    // The failed one has no images of its files as they are, so it is asked again too.
    assert.deepEqual(again.asked, ['home/hero/iteration-02', 'home/hero/iteration-03']);
    assert.deepEqual(again.unchanged, ['home/hero/iteration-01']);
    assert.equal(again.results['home/hero/iteration-01']!.state, 'ready');

    const idle = await renderSnapshots(repo, environment, keys.slice(0, 2), { exec: tool.exec });
    assert.deepEqual(idle.asked, []);
    assert.equal(tool.asked.length, 2, 'nothing changed, so the command did not run');

    const forced = await renderSnapshots(repo, environment, keys.slice(0, 2), {
      exec: tool.exec,
      force: true
    });
    assert.deepEqual(forced.asked, keys.slice(0, 2));
  });

  it('is what taking an iteration’s screenshots does in snapshot mode, with no browser', async () => {
    const { repo, environment } = await repoWith(['home/hero/iteration-01']);
    const tool = fakeSnapshotTool();
    const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
    const shots = await screenshotIteration(
      repo,
      'http://localhost:1',
      target,
      {},
      undefined,
      null,
      undefined,
      environment,
      {
        snapshotExec: tool.exec
      }
    );
    assert.equal(shots.warning, null);
    assert.deepEqual(Object.keys(shots.files), ['phone', 'tablet', 'phone-dark', 'tablet-dark']);
    const again = await screenshotIteration(
      repo,
      'http://localhost:1',
      target,
      {},
      undefined,
      null,
      undefined,
      environment,
      {
        snapshotExec: tool.exec
      }
    );
    assert.equal(again.skipped, true);
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', 'throw it\n');
    const failed = await screenshotIteration(
      repo,
      'http://localhost:1',
      target,
      {},
      undefined,
      null,
      undefined,
      environment,
      {
        snapshotExec: tool.exec
      }
    );
    assert.match(failed.warning!, /home\/hero\/iteration-01: .*fails on purpose/);
  });

  it('never runs a snapshot command this machine has not approved', async () => {
    const { repo } = await repoWith(['home/hero/iteration-01']);
    // A commit changed the command: done, roughbook screenshot and finish_run do not run it.
    write(repo, 'rough/environment.md', HEADER.replaceAll('roughSnapshots', 'otherSnapshots'));
    const environment = readEnvironmentSync(repo, LINK);
    const tool = fakeSnapshotTool();
    const shots = await screenshotIteration(
      repo,
      'http://localhost:1',
      { page: 'home', component: 'hero', iteration: 'iteration-01' },
      {},
      undefined,
      null,
      undefined,
      environment,
      { snapshotExec: tool.exec }
    );
    assert.deepEqual(shots.files, {});
    assert.match(shots.warning!, /not approved on this machine \(gradlew(\.bat)? otherSnapshots/);
    assert.equal(tool.asked.length, 0);
  });
});

describe('the environment of a snapshot stack', () => {
  it('reads the snapshot and device commands per operating system', () => {
    const linux = environmentOf(HEADER, 'linux');
    assert.equal(linux.mode, 'snapshot');
    assert.equal(linux.snapshot, 'gradlew roughSnapshots --keys={keys}');
    assert.equal(
      environmentOf(HEADER, 'windows').snapshot,
      'gradlew.bat roughSnapshots --keys={keys}'
    );
    assert.equal(linux.device, 'adb shell am start -d roughbook://preview/{key}');
    // No start command and no preview address: snapshot mode serves nothing.
    assert.equal(linux.start.command, null);
    // Snapshot tools have no network: assets are copied in unless the header says otherwise.
    assert.equal(linux.assets.copy, true);
    assert.equal(
      environmentOf(HEADER.replace('gate: build', 'gate: build\nassetsCopy: no')).assets.copy,
      false
    );
    assert.deepEqual(
      environmentCommands(linux).map(item => item.field),
      ['snapshot', 'device', 'build']
    );
  });

  it('refuses a snapshot mode with no command, a device command with no key, and a command as preview', () => {
    assert.throws(
      () => environmentOf(HEADER.replace(/^snapshot.*\n/gm, '')),
      /snapshot is required when no recipe set this repo up/
    );
    assert.throws(
      () =>
        environmentOf(
          HEADER.replace(/^snapshot.*\n/gm, '').replace('recipe: none', 'recipe: next')
        ),
      /snapshot is the command that renders keys to images.*snapshot mode needs one/
    );
    assert.throws(
      () => environmentOf(HEADER.replace('roughbook://preview/{key}', 'roughbook://preview')),
      /device is the command that opens one iteration, with \{key\}/
    );
    assert.throws(
      () =>
        environmentOf(
          HEADER.replace('gate: build', 'gate: build\npreview: gradlew roughSnapshots')
        ),
      /preview is the address of a live preview; in snapshot mode the command .* is snapshot/
    );
    // A live preview may have a snapshot command too, for final review, and no device.
    const live = environmentOf(`---
contract: 1
recipe: none
mode: live
entry: index.tsx
sources:
  - .tsx
start: npx expo start --localhost @ http://localhost:8081
preview: /rough-preview/{key}
snapshot: node rough/snapshots.mjs
gate: build
---
`);
    assert.equal(live.snapshot, 'node rough/snapshots.mjs');
    assert.equal(live.device, null);
    assert.equal(live.assets.copy, false);
  });
});

describe('in-tree placement', () => {
  it('mirrors each iteration into the source tree, and takes out what rough/ no longer has', async () => {
    const repo = await snapshotRepo(HEADER, false);
    const environment = readEnvironmentSync(repo, LINK);
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', 'one\n');
    write(repo, 'rough/home/hero/iteration-01/preview.json', '{}\n');
    write(repo, 'rough/home/hero/iteration-01/assets/photo.png', 'png');
    write(repo, 'rough/home/cta/iteration-02/Iteration.kt', 'two\n');
    // Not an iteration: no entry file, and the prompts folder.
    write(repo, 'rough/home/hero/iteration-03/notes.md', 'unfinished\n');
    write(repo, 'rough/home/hero/prompts/run.md', 'prompt\n');
    const first = syncMirror(repo, environment)!;
    assert.equal(first.mirror, MIRROR);
    assert.equal(first.written, 4);
    const mirrored = (file: string) => path.join(repo, ...MIRROR.split('/'), ...file.split('/'));
    assert.equal(fs.readFileSync(mirrored('home/hero/iteration-01/Iteration.kt'), 'utf8'), 'one\n');
    assert.ok(fs.existsSync(mirrored('home/hero/iteration-01/assets/photo.png')));
    assert.ok(fs.existsSync(mirrored(MIRROR_MARK)));
    assert.ok(!fs.existsSync(mirrored('home/hero/iteration-03')));
    assert.ok(!fs.existsSync(mirrored('home/hero/prompts')));

    // A recipe's file at the mirror's root stays.
    write(repo, `${MIRROR}/registry.kt`, '// generated\n');
    const stamp = fs.statSync(mirrored('home/cta/iteration-02/Iteration.kt')).mtimeMs;
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', 'one, changed\n');
    fs.rmSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'preview.json'));
    fs.rmSync(path.join(repo, 'rough', 'home', 'cta'), { recursive: true });
    const second = syncMirror(repo, environment)!;
    assert.deepEqual([second.written, second.removed], [1, 2]);
    assert.equal(
      fs.readFileSync(mirrored('home/hero/iteration-01/Iteration.kt'), 'utf8'),
      'one, changed\n'
    );
    assert.ok(!fs.existsSync(mirrored('home/hero/iteration-01/preview.json')));
    assert.ok(!fs.existsSync(mirrored('home/cta')));
    assert.ok(fs.existsSync(mirrored('registry.kt')));
    assert.ok(stamp > 0);
    // Unchanged files are not written again, so the build's up-to-date checks hold.
    const third = syncMirror(repo, environment)!;
    assert.deepEqual([third.written, third.removed], [0, 0]);
  });

  it('never empties a folder the studio did not make', async () => {
    const repo = await snapshotRepo(HEADER, false);
    write(repo, `${MIRROR}/Main.kt`, 'the app\n');
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', 'one\n');
    assert.throws(
      () => syncMirror(repo, readEnvironmentSync(repo, LINK)),
      /already holds files the studio did not write/
    );
    assert.equal(read(repo, `${MIRROR}/Main.kt`), 'the app\n');
  });

  it('excludes the mirror: from git, from snapshots and the watcher, and from the run’s changes', async () => {
    const repo = await snapshotRepo(HEADER, false);
    const environment = readEnvironmentSync(repo, LINK);
    assert.ok(environment.ignore.includes(MIRROR));
    assert.match(read(repo, '.gitignore'), new RegExp(`^/${MIRROR}/$`, 'm'));
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', 'one\n');
    syncMirror(repo, environment);
    const files = Object.keys((await hashRepo(repo, environment.ignore)).files);
    assert.ok(files.includes('rough/home/hero/iteration-01/Iteration.kt'));
    assert.ok(!files.some(file => file.startsWith(`${MIRROR}/`)), files.join(', '));
    // An ignore entry that covers it already is enough.
    const covered = environmentOf(HEADER.replace('  - build\n', '  - build\n  - app/src/debug\n'));
    assert.ok(!covered.ignore.includes(MIRROR));
  });

  it('names a key as a dotted module path, for files that name their own package', () => {
    assert.equal(moduleOf('home/hero/iteration-01'), 'home.hero.iteration_01');
    assert.equal(moduleOf('404-page/hero-block/iteration-12'), '_404_page.hero_block.iteration_12');
  });
});

describe('the device command', () => {
  it('opens one key with the approved command, and says why it could not', async () => {
    const repo = await snapshotRepo(HEADER, false);
    const environment = readEnvironmentSync(repo, LINK);
    assert.equal(
      deviceCommandFor(environment.device!, 'home/hero/iteration-01'),
      'adb shell am start -d roughbook://preview/home/hero/iteration-01'
    );
    const lines: string[] = [];
    const opened = await openOnDevice(
      repo,
      environment,
      'home/hero/iteration-01',
      async (command, _cwd, _ms, _shell, env) => {
        lines.push(command, env.ROUGHBOOK_KEY!);
        return { code: 0, output: 'Starting: Intent' };
      }
    );
    assert.deepEqual(opened, { ok: true, message: 'Opened home/hero/iteration-01 on the device.' });
    assert.deepEqual(lines, [
      'adb shell am start -d roughbook://preview/home/hero/iteration-01',
      'home/hero/iteration-01'
    ]);
    const failed = await openOnDevice(repo, environment, 'home/hero/iteration-01', async () => ({
      code: 1,
      output: 'adb: no devices/emulators found'
    }));
    assert.equal(failed.ok, false);
    assert.match(
      failed.message,
      /exit 1\): adb: no devices\/emulators found.*emulator or device running/
    );

    const unapproved = { ...environment, device: 'adb shell am start -d other://{key}' };
    assert.match(
      (
        await openOnDevice(repo, unapproved, 'home/hero/iteration-01', async () => ({
          code: 0,
          output: ''
        }))
      ).message,
      /not approved on this machine/
    );
    assert.match(
      (await openOnDevice(repo, { ...environment, device: null }, 'home/hero/iteration-01'))
        .message,
      /names no device command/
    );
  });
});

describe('assets for a snapshot stack', () => {
  const PROMPT = `<context>
Hero photo: {{origin}}/api/files/project/site/hero%20shot.jpg.
Logo: /api/files/project/site/logo.svg, and again /api/files/project/site/logo.svg
Texture: /api/files/library/paper.png
Another project's: /api/files/project/other/secret.png
Not a file: /api/files/project/site/../../etc
</context>`;

  it('names each asset file a prompt uses, once, and only this project’s', () => {
    assert.deepEqual(
      namedAssets(PROMPT, 'site'),
      [
        { scope: 'project', file: 'hero shot.jpg' },
        { scope: 'project', file: 'logo.svg' },
        { scope: 'library', file: 'paper.png' }
      ].filter(asset => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.file))
    );
    assert.equal(assetTarget({ scope: 'project', file: 'logo.svg' }), 'assets/logo.svg');
    assert.equal(assetTarget({ scope: 'library', file: 'paper.png' }), 'assets/library/paper.png');
  });

  it('copies them into the iteration when a run starts, and tells the backend so', async () => {
    const repo = await snapshotRepo(HEADER, false);
    const runs: StartedRun[] = [
      {
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        iteration: 'iteration-01',
        parent: null,
        targetFolder: 'rough/home/hero/iteration-01',
        prompt: PROMPT.replace('{{origin}}', '{{roughbook:asset-origin}}'),
        checks: [{ kind: 'entry-file', file: 'Iteration.kt' }]
      }
    ];
    const fake = fakeFetch(request => {
      if (request.url.endsWith('/runs')) return ok(runs, 201);
      if (request.url.includes('/files/project/logo.svg')) return { text: '<svg/>' };
      if (request.url.includes('/files/library/paper.png')) return { text: 'paper' };
      return refused('NOT_FOUND', 404);
    });
    const api = new StudioApi({
      server: 'http://localhost:4000',
      token: 'rbi_token',
      userAgent: 'roughbook-studio/test',
      fetch: fake.fetch
    });
    await startRuns(repo, api, LINK, {
      page: 'home',
      component: 'hero',
      agent: 'claude-code',
      mode: 'interactive',
      kind: 'generate',
      directions: [{ direction: 'Quiet' }]
    });
    const body = fake.requests.find(request => request.url.endsWith('/runs'))!.body as Record<
      string,
      unknown
    >;
    assert.equal(body.assetsCopy, true);
    assert.equal(body.family, 'compose');
    assert.equal(read(repo, 'rough/home/hero/iteration-01/assets/logo.svg'), '<svg/>');
    assert.equal(read(repo, 'rough/home/hero/iteration-01/assets/library/paper.png'), 'paper');
    // The run's prompt names no address to open: a snapshot preview has none.
    assert.doesNotMatch(
      read(repo, 'rough/home/hero/prompts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md'),
      /rough-preview/
    );
  });

  it('copies nothing for a live web stack, which loads assets from the studio', async () => {
    const repo = await tempDir('roughbook-assets-');
    let asked = 0;
    const api = {
      file: async () => {
        asked += 1;
        return Buffer.from('x');
      }
    } as unknown as StudioApi;
    const copied = await copyAssets(
      repo,
      api,
      LINK,
      'rough/home/hero/iteration-01',
      'no assets here'
    );
    assert.deepEqual(copied, { copied: [], missing: [] });
    assert.equal(asked, 0);
  });
});

describe('the release build’s sentinel', () => {
  it('is found inside an app package, entry by entry, and not where it is absent', async () => {
    const repo = await tempDir('roughbook-sentinel-');
    write(
      repo,
      'out/app.apk',
      zip({ 'classes.dex': 'header roughbook-doctor-abc123 tail', 'res/a.xml': '<a/>' })
    );
    write(repo, 'out/clean.aab', zip({ 'base/dex/classes.dex': 'nothing here' }));
    assert.deepEqual(findSentinel(repo, ['out'], 'roughbook-doctor-abc123'), [
      'out/app.apk!classes.dex'
    ]);
    assert.deepEqual(
      zipEntries(fs.readFileSync(path.join(repo, 'out', 'clean.aab'))).map(entry => entry.name),
      ['base/dex/classes.dex']
    );
  });
});

describe('doctor in snapshot mode', () => {
  it('passes a snapshot stack through its command, mirrored in-tree and absent from the release build', async () => {
    const repo = await snapshotRepo();
    const tool = fakeSnapshotTool();
    const tools = doctorTools(repo, tool);
    const report = await runDoctor(repo, { devUrl: 'http://localhost:3000', tools });
    assert.equal(report.outcome, 'pass', JSON.stringify(report.checks, null, 2));
    assert.equal(report.environment.mode, 'snapshot');
    assert.deepEqual(statuses(report), {
      prerequisites: 'pass',
      environment: 'pass',
      app: 'pass',
      renders: 'pass',
      fixture: 'pass',
      'reports-broken': 'pass',
      'reports-missing': 'pass',
      screenshots: 'pass',
      fresh: 'pass',
      gate: 'pass',
      loopback: 'skip',
      'setup-files': 'pass',
      speed: 'skip'
    });
    assert.match(check(report, 'app').detail, new RegExp(`mirrored at ${MIRROR}/`));
    assert.match(
      check(report, 'screenshots').detail,
      /phone 780×1688, tablet 1600×2560, phone-dark/
    );
    assert.match(
      check(report, 'gate').detail,
      /holds nothing from rough\/, and the sample was mirrored/
    );
    assert.deepEqual(tools.built, ['gradlew assembleRelease']);
    // The first render asked for the two samples and a key with no iteration, in one command.
    assert.equal(tool.asked[0]!.length, 3);
    // Only the changed sample was ever asked again.
    assert.ok(
      tool.asked.slice(1).every(keys => keys.length === 1),
      JSON.stringify(tool.asked)
    );
    // Doctor's own pages are gone, from rough/ and from the mirror.
    assert.ok(
      !fs.readdirSync(path.join(repo, 'rough')).some(name => name.startsWith('doctor-check'))
    );
    assert.ok(
      !fs
        .readdirSync(path.join(repo, ...MIRROR.split('/')))
        .some(name => name.startsWith('doctor-check'))
    );
  });

  it('fails each check its fault breaks, naming the fix', async () => {
    const cases: [ToolFaults, { leaks?: boolean }, string, RegExp][] = [
      [{ silent: true }, {}, 'app', /said nothing of the keys and rendered none: BUILD FAILED/],
      [
        { ignoresVariants: true },
        {},
        'screenshots',
        /phone-dark is the same image as phone: dark changed nothing/
      ],
      [{ square: true }, {}, 'screenshots', /phone is 780×780, not the proportions of 390×844/],
      [{ stale: true }, {}, 'fresh', /changed sample's images did not change/],
      [{ noFixture: true }, {}, 'fixture', /images did not change/],
      [
        {},
        { leaks: true },
        'gate',
        /holds the sample iteration: app\/build\/outputs\/apk\/release\/app-release\.apk!classes\.dex/
      ]
    ];
    for (const [faults, build, id, detail] of cases) {
      const repo = await snapshotRepo();
      const report = await runDoctor(repo, {
        devUrl: 'http://localhost:3000',
        tools: doctorTools(repo, fakeSnapshotTool(faults), build)
      });
      const found = check(report, id);
      assert.equal(found.status, 'fail', `${id}: ${JSON.stringify(report.checks, null, 2)}`);
      assert.match(found.detail, detail);
      assert.ok(found.fix, `${id} names a fix`);
      assert.equal(report.outcome, 'fail');
    }
  });

  it('fails the renders, and counts no report, when one cause fails every key (no device)', async () => {
    const repo = await snapshotRepo();
    const noDevice: SnapshotExec = async (_command, _cwd, _ms, _shell, env) => ({
      code: 1,
      output: env
        .ROUGHBOOK_KEYS!.split(',')
        .map(key => `roughbook: error ${key}: No Android device or emulator is attached.`)
        .join('\n')
    });
    const report = await runDoctor(repo, {
      devUrl: 'http://localhost:3000',
      tools: { ...doctorTools(repo, fakeSnapshotTool()), snapshot: noDevice }
    });
    assert.equal(check(report, 'app').status, 'pass');
    assert.equal(check(report, 'renders').status, 'fail');
    assert.match(check(report, 'renders').detail, /No Android device or emulator is attached/);
    assert.equal(check(report, 'reports-broken').status, 'skip');
    assert.equal(check(report, 'reports-missing').status, 'skip');
    assert.equal(report.outcome, 'fail');
  });

  it('fails the setup files when the mirror would be committed, and wants the setup’s samples', async () => {
    const repo = await snapshotRepo();
    write(repo, '.gitignore', 'node_modules/\n');
    const report = await runDoctor(repo, {
      devUrl: 'http://localhost:3000',
      tools: doctorTools(repo, fakeSnapshotTool())
    });
    assert.match(
      check(report, 'setup-files').detail,
      /mirror app\/src\/debug\/kotlin\/rough\/ is not in \.gitignore/
    );

    const bare = await snapshotRepo(HEADER, false);
    const without = await runDoctor(bare, {
      devUrl: 'http://localhost:3000',
      tools: doctorTools(bare, fakeSnapshotTool())
    });
    assert.equal(check(without, 'renders').status, 'fail');
    assert.match(
      check(without, 'renders').detail,
      /rough\/setup\/sample\/good\/ and .* are missing/
    );
  });

  it('measures the snapshot budget with --speed, and leaves the repo unverified with --skip-build', async () => {
    const repo = await snapshotRepo();
    const tools = doctorTools(repo, fakeSnapshotTool());
    const report = await runDoctor(repo, {
      devUrl: 'http://localhost:3000',
      tools,
      speed: true,
      skipBuild: true
    });
    assert.equal(check(report, 'speed').status, 'pass', check(report, 'speed').detail);
    assert.match(check(report, 'speed').detail, /^Images rendered in .* \(budget 15 s\)/);
    assert.match(
      check(report, 'speed').detail,
      /taken again: none|screenshots not measured: in snapshot mode/
    );
    assert.equal(check(report, 'gate').status, 'skip');
    assert.equal(report.outcome, 'unverified');
  });

  it('checks a live repo’s snapshot command for final review with --snapshots', async () => {
    const repo = await snapshotRepo(
      HEADER.replace('mode: snapshot', 'mode: live').replace(
        'gate: build',
        'gate: build\nstart: gradlew run @ http://localhost:8080\npreview: /rough-preview/{key}'
      )
    );
    const report = await runDoctor(repo, {
      devUrl: 'http://localhost:8080',
      tools: doctorTools(repo, fakeSnapshotTool()),
      snapshots: true
    });
    assert.equal(report.environment.mode, 'snapshot');
    assert.equal(check(report, 'renders').status, 'pass', JSON.stringify(report.checks, null, 2));
    assert.equal(check(report, 'fresh').status, 'pass');
  });
});
