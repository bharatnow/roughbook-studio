// F6 of the frameworks plan: the Expo and Flutter recipes, as `init` plans them, as their preview
// setup keeps up with rough/, and as doctor checks their snapshots. Neither stack's tools run here:
// Expo's live preview is proven on a fresh app by the conformance suite, and Flutter's on a real
// Flutter app is still to be proven (no Flutter SDK on the machine F6 was built on).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runDoctor } from '../doctor/run.js';
import type { DoctorTools } from '../doctor/types.js';
import { readEnvironmentSync } from '../environment/read.js';
import { currentOs, hostPlatform } from '../launch/platform.js';
import { runCapture } from '../launch/processes.js';
import { detectStack } from '../recipes/detect.js';
import { expo } from '../recipes/expo/index.js';
import { SNAPSHOT_SCRIPT_CONTENT } from '../recipes/expo/snapshots.js';
import { flutter } from '../recipes/flutter/index.js';
import { dartString, renderRegistry } from '../recipes/flutter/preview.js';
import { recipeFor } from '../recipes/index.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import type { RepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { importsFromRough } from '../runs/checks.js';
import { tempDir } from './helpers.js';

const LINK: Omit<RepoLink, 'appDir'> = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'app',
  roughCommitted: true
};

function write(repo: string, file: string, text: string | Buffer) {
  const full = path.join(repo, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function read(repo: string, file: string): string {
  return fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
}

const exists = (repo: string, file: string) => fs.existsSync(path.join(repo, ...file.split('/')));

async function expoApp(): Promise<string> {
  const repo = await tempDir('roughbook-expo-');
  write(
    repo,
    'package.json',
    JSON.stringify({
      name: 'expo-app',
      main: 'expo-router/entry',
      dependencies: {
        expo: '~58.0.16',
        'expo-router': '~58.0.24',
        react: '19.3.0',
        'react-native': '0.88.0'
      }
    })
  );
  write(
    repo,
    'tsconfig.json',
    '{\n  "extends": "expo/tsconfig.base",\n  "include": ["**/*.ts", "**/*.tsx"]\n}\n'
  );
  write(repo, 'src/app/_layout.tsx', 'export default function Layout() { return null; }\n');
  write(repo, 'src/app/index.tsx', 'export default function Home() { return null; }\n');
  return repo;
}

async function flutterApp(): Promise<string> {
  const repo = await tempDir('roughbook-flutter-');
  write(
    repo,
    'pubspec.yaml',
    'name: harbor_app\ndescription: A Flutter app.\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n'
  );
  write(
    repo,
    'lib/main.dart',
    "import 'package:flutter/material.dart';\n\nvoid main() => runApp(const MaterialApp());\n"
  );
  return repo;
}

describe('the Expo recipe', () => {
  it('is what detection offers an Expo app', async () => {
    const detected = detectStack(await expoApp());
    assert.equal(detected.recipe, 'expo');
    assert.equal(detected.family, 'react-like');
    assert.equal(recipeFor('expo'), expo);
  });

  it('plans the route under Expo Router, the wrapper, the registry and the snapshot script', async () => {
    const repo = await expoApp();
    const plan = planPrep(repo, { link: LINK, recipe: expo });
    assert.deepEqual(plan.problems, []);
    const files = plan.changes.map(change => change.file);
    for (const file of [
      'src/app/rough-preview/[...key].tsx',
      'rough/preview.tsx',
      'rough/preview-registry.ts',
      'rough/snapshots.mjs',
      '.gitignore',
      'tsconfig.json'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    applyPrep(plan);
    const route = read(repo, 'src/app/rough-preview/[...key].tsx');
    // The registry imported as it is (a conditional import loses Metro's server render), and every
    // iteration in it only under __DEV__, which a production bundle folds to nothing.
    assert.match(
      route,
      /^import \* as registryModule from "\.\.\/\.\.\/\.\.\/rough\/preview-registry";$/m
    );
    assert.match(route, /if \(!mounted\) return null;/);
    const registry = read(repo, 'rough/preview-registry.ts');
    assert.match(
      registry,
      /export const Preview: .* = __DEV__\n {2}\? require\("\.\/preview"\)\.default\n {2}: null;/
    );
    assert.match(registry, /export const loaders: .* = __DEV__\n {2}\? \{\n {4}\}\n {2}: \{\};/);
    assert.match(route, /postMessage\(\{ roughbook: word, id/);
    assert.match(route, /console\.log\(`roughbook: \$\{word\} \$\{id\}/);
    assert.match(route, /There is no iteration \$\{key\} in this repo\./);
    assert.match(read(repo, '.gitignore'), /^\/src\/app\/rough-preview\/$/m);
    assert.match(read(repo, 'tsconfig.json'), /"rough"/);
    assert.match(read(repo, 'rough/AGENTS.md'), /React Native component/);
    // Planned again, nothing changes.
    assert.deepEqual(planPrep(repo, { link: LINK, recipe: expo }).changes, []);

    const environment = expo.environment(null);
    assert.equal(environment.mode, 'live');
    assert.equal(environment.start.command, 'npx expo start --localhost --port 8081');
    assert.equal(environment.preview, '/rough-preview/{key}');
    assert.equal(environment.snapshot, 'node rough/snapshots.mjs');
    assert.equal(environment.device, 'node rough/snapshots.mjs --open {key}');
    assert.deepEqual(environment.build, {
      command: 'npx expo export --platform web',
      output: ['dist']
    });
    assert.deepEqual(expo.setupFiles(repo, { ...LINK, appDir: 'src/app' }), [
      'src/app/rough-preview/[...key].tsx'
    ]);
    assert.deepEqual(
      importsFromRough(
        repo,
        ['src/app/rough-preview/[...key].tsx', 'src/app/index.tsx'],
        expo.importAllowed({ ...LINK, appDir: 'src/app' }),
        environment.code
      ),
      []
    );
  });

  it('keeps the registry up with the iterations, with their fixtures', async () => {
    const repo = await expoApp();
    applyPrep(planPrep(repo, { link: LINK, recipe: expo }));
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function A() { return null; }\n'
    );
    write(repo, 'rough/home/hero/iteration-01/preview.json', '{ "title": "Hi" }\n');
    write(
      repo,
      'rough/home/hero/iteration-02/index.tsx',
      'export default function B() { return null; }\n'
    );
    syncIterations(repo, expo.environment(null));
    const registry = read(repo, 'rough/preview-registry.ts');
    assert.match(
      registry,
      /"home\/hero\/iteration-01": \(\) => require\("\.\/home\/hero\/iteration-01\/index"\),/
    );
    assert.match(
      registry,
      /"home\/hero\/iteration-02": \(\) => require\("\.\/home\/hero\/iteration-02\/index"\),/
    );
    assert.match(
      registry,
      /"home\/hero\/iteration-01": \(\) => require\("\.\/home\/hero\/iteration-01\/preview\.json"\),/
    );
    assert.doesNotMatch(registry, /iteration-02\/preview\.json/);
  });

  describe('final-review snapshots on a device', () => {
    /** An adb that answers as one emulator would, and takes a "screen" of whatever it was last asked to open. */
    async function fakeAdb(options: { devices?: boolean; says?: 'ready' | 'error' } = {}) {
      const dir = await tempDir('roughbook-adb-');
      const state = path.join(dir, 'state.json');
      const script = path.join(dir, 'adb.mjs');
      fs.writeFileSync(
        script,
        `import fs from "node:fs";
const state = ${JSON.stringify(state)};
const saved = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : { calls: [], opened: null, night: "no" };
const args = process.argv.slice(2);
saved.calls.push(args.join(" "));
const out = (text) => process.stdout.write(text);
if (args[0] === "devices") out(${JSON.stringify(options.devices === false ? 'List of devices attached\n\n' : 'List of devices attached\nemulator-5554\tdevice\n\n')});
if (args[0] === "shell" && args[1] === "am") saved.opened = args[args.indexOf("-d") + 1];
if (args[0] === "shell" && args[1] === "cmd") saved.night = args[4];
if (args[0] === "logcat" && args[1] === "-d" && saved.opened) {
  const key = new URL(saved.opened.replace("exp://", "http://")).pathname.replace(/^.*\\/rough-preview\\//, "");
  out(${JSON.stringify(options.says === 'error' ? 'I ReactNativeJS: roughbook: error ' : 'I ReactNativeJS: roughbook: ready ')} + key + ${JSON.stringify(options.says === 'error' ? ': Text strings must be rendered within a <Text> component.' : '')} + "\\n");
}
if (args[0] === "exec-out") out("PNG of " + saved.opened + " night " + saved.night);
fs.writeFileSync(state, JSON.stringify(saved));
`
      );
      return {
        script,
        calls: () => (JSON.parse(fs.readFileSync(state, 'utf8')) as { calls: string[] }).calls
      };
    }

    async function runScript(adb: string, keys: string, extra: string[] = []) {
      const repo = await expoApp();
      write(repo, 'rough/snapshots.mjs', SNAPSHOT_SCRIPT_CONTENT);
      write(
        repo,
        'rough/home/hero/iteration-01/index.tsx',
        'export default function A() { return null; }\n'
      );
      const out = path.join(repo, 'rough', '.screenshots');
      const ran = await runCapture(
        `node rough/snapshots.mjs ${extra.join(' ')}`,
        repo,
        120_000,
        'none',
        {
          ROUGHBOOK_ADB: adb,
          ANDROID_HOME: '',
          ROUGHBOOK_KEYS: keys,
          ROUGHBOOK_SHOTS: 'phone:390x844:light,phone-dark:390x844:dark',
          ROUGHBOOK_OUT: out,
          ROUGHBOOK_ITERATIONS: path.join(repo, 'rough'),
          ROUGHBOOK_DEV_URL: 'http://localhost:8081'
        }
      );
      return { repo, out, ran };
    }

    it('renders each key at every shot on the device, and says what came of it', async () => {
      const adb = await fakeAdb();
      const { out, ran } = await runScript(
        adb.script,
        'home/hero/iteration-01,home/hero/iteration-09'
      );
      assert.equal(ran.code, 1, ran.output);
      assert.match(ran.output, /^roughbook: ready home\/hero\/iteration-01$/m);
      assert.match(ran.output, /^roughbook: missing home\/hero\/iteration-09$/m);
      assert.equal(
        fs.readFileSync(path.join(out, 'home', 'hero', 'iteration-01', 'phone.png'), 'utf8'),
        'PNG of exp://127.0.0.1:8081/--/rough-preview/home/hero/iteration-01 night no'
      );
      assert.equal(
        fs.readFileSync(path.join(out, 'home', 'hero', 'iteration-01', 'phone-dark.png'), 'utf8'),
        'PNG of exp://127.0.0.1:8081/--/rough-preview/home/hero/iteration-01?roughbook-scheme=dark night yes'
      );
      const calls = adb.calls();
      assert.ok(calls.includes('reverse tcp:8081 tcp:8081'));
      assert.ok(calls.includes('shell wm size 1170x2532'));
      assert.ok(calls.includes('shell wm size reset'));
    });

    it('passes on the route’s error, and says plainly when there is no device', async () => {
      const failing = await runScript(
        (await fakeAdb({ says: 'error' })).script,
        'home/hero/iteration-01'
      );
      assert.match(
        failing.ran.output,
        /^roughbook: error home\/hero\/iteration-01: Text strings must be rendered/m
      );
      const none = await runScript(
        (await fakeAdb({ devices: false })).script,
        'home/hero/iteration-01'
      );
      assert.equal(none.ran.code, 1);
      assert.match(
        none.ran.output,
        /roughbook: error home\/hero\/iteration-01: No Android device or emulator is attached/
      );
    });

    it('opens one key on the device for the device command', async () => {
      const adb = await fakeAdb();
      const { ran } = await runScript(adb.script, '', ['--open', 'home/hero/iteration-01']);
      assert.equal(ran.code, 0, ran.output);
      assert.ok(
        adb
          .calls()
          .includes(
            'shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081/--/rough-preview/home/hero/iteration-01'
          )
      );
    });
  });
});

describe('the Flutter recipe', () => {
  it('is what detection offers a Flutter app', async () => {
    const detected = detectStack(await flutterApp());
    assert.equal(detected.recipe, 'flutter');
    assert.equal(detected.family, 'flutter');
  });

  it('plans its preview entry and snapshot test, with the app’s package, and mirrors in lib/rough', async () => {
    const repo = await flutterApp();
    const plan = planPrep(repo, { link: LINK, recipe: flutter });
    const files = plan.changes.map(change => change.file);
    for (const file of [
      'lib/rough_preview.dart',
      'test/rough_snapshot_test.dart',
      'rough/preview.dart',
      '.gitignore'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    applyPrep(plan);
    assert.match(
      read(repo, 'lib/rough_preview.dart'),
      /import 'package:harbor_app\/rough\/registry\.dart';/
    );
    assert.match(
      read(repo, 'test/rough_snapshot_test.dart'),
      /import 'package:harbor_app\/rough\/registry\.dart';/
    );
    assert.match(
      read(repo, 'test/rough_snapshot_test.dart'),
      /File\('\$out\/\$key\/\$\{shot\.name\}\.png'\)/
    );
    const gitignore = read(repo, '.gitignore');
    for (const entry of [
      '/lib/rough/',
      '/lib/rough_preview.dart',
      '/test/rough_snapshot_test.dart'
    ]) {
      assert.ok(gitignore.split('\n').includes(entry), `${entry} in .gitignore`);
    }
    assert.match(read(repo, 'rough/AGENTS.md'), /`iteration\.dart` holds the design/);

    const environment = readEnvironmentSync(repo, { ...LINK, appDir: 'lib' });
    assert.deepEqual(environment.placement, { kind: 'in-tree', path: 'lib/rough' });
    assert.equal(environment.snapshot, 'flutter test test/rough_snapshot_test.dart');
    assert.equal(environment.preview, '/#/rough-preview/{key}');
    assert.equal(environment.assets.copy, true);
    assert.equal(environment.shell, currentOs(hostPlatform()) === 'windows' ? 'cmd' : 'none');
    assert.deepEqual(
      importsFromRough(
        repo,
        ['lib/rough_preview.dart', 'test/rough_snapshot_test.dart'],
        flutter.importAllowed({ ...LINK, appDir: 'lib' }),
        environment.code
      ),
      []
    );
  });

  it('mirrors the iterations into lib/rough with a registry of them and the wrapper', async () => {
    const repo = await flutterApp();
    applyPrep(planPrep(repo, { link: LINK, recipe: flutter }));
    write(repo, 'rough/preview.dart', "// the app's own wrapper\n");
    write(
      repo,
      'rough/home/hero/iteration-01/iteration.dart',
      "Widget buildIteration(Map<String, dynamic> f) => const Text('a');\n"
    );
    write(repo, 'rough/home/hero/iteration-01/preview.json', '{ "price": "$9" }\n');
    write(
      repo,
      'rough/home/hero/iteration-02/iteration.dart',
      "Widget buildIteration(Map<String, dynamic> f) => const Text('b');\n"
    );
    const environment = flutter.environment(null);
    syncIterations(repo, environment);
    assert.ok(exists(repo, 'lib/rough/home/hero/iteration-01/iteration.dart'));
    assert.equal(read(repo, 'lib/rough/preview.dart'), "// the app's own wrapper\n");
    const registry = read(repo, 'lib/rough/registry.dart');
    assert.match(registry, /^import "home\/hero\/iteration-01\/iteration\.dart" as i0;$/m);
    assert.match(registry, /"home\/hero\/iteration-02": i1\.buildIteration,/);
    // The fixture as a Dart string, its $ escaped.
    assert.match(registry, /"home\/hero\/iteration-01": "\{ \\"price\\": \\"\\\$9\\" \}\\n",/);
    assert.equal(dartString('a $b "c"'), '"a \\$b \\"c\\""');

    fs.rmSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-02'), { recursive: true });
    syncIterations(repo, environment);
    assert.ok(!exists(repo, 'lib/rough/home/hero/iteration-02'));
    assert.doesNotMatch(read(repo, 'lib/rough/registry.dart'), /iteration-02/);
    assert.equal(
      renderRegistry([], {}).includes(
        'final Map<String, Widget Function(Map<String, dynamic> fixture)> iterations = {\n};'
      ),
      true
    );
  });

  it('passes doctor’s snapshot checks through its command, the mirror absent from the web build', async () => {
    const repo = await flutterApp();
    const link = { ...LINK, appDir: 'lib' };
    write(repo, 'rough/roughbook.json', JSON.stringify(link));
    applyPrep(planPrep(repo, { link: LINK, recipe: flutter }));
    await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, link)));
    const asked: string[][] = [];
    let clock = 0;
    const tools: Partial<DoctorTools> = {
      which: program => `/fake/bin/${program}`,
      browser: null,
      // A flutter test that keeps the contract: an image per shot from the mirrored iteration.
      snapshot: async (_command, _cwd, _ms, _shell, env) => {
        const keys = env.ROUGHBOOK_KEYS!.split(',');
        asked.push(keys);
        for (const key of keys) {
          const dir = path.join(env.ROUGHBOOK_ITERATIONS!, ...key.split('/'));
          const result = path.join(env.ROUGHBOOK_OUT!, ...key.split('/'), 'result.txt');
          fs.mkdirSync(path.dirname(result), { recursive: true });
          if (!fs.existsSync(dir)) {
            fs.writeFileSync(result, 'missing');
            continue;
          }
          const files = fs
            .readdirSync(dir)
            .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
            .join('\n');
          if (files.includes('throw StateError')) {
            fs.writeFileSync(
              result,
              'error: Bad state: roughbook doctor: this iteration fails on purpose'
            );
            continue;
          }
          for (const shot of env.ROUGHBOOK_SHOTS!.split(',')) {
            const [name, size, variant] = shot.split(':') as [string, string, string];
            const [width, height] = size.split('x').map(Number) as [number, number];
            const header = Buffer.alloc(25);
            header.writeUInt32BE(13, 0);
            header.write('IHDR', 4, 'latin1');
            header.writeUInt32BE(width * 3, 8);
            header.writeUInt32BE(height * 3, 12);
            fs.writeFileSync(
              path.join(env.ROUGHBOOK_OUT!, ...key.split('/'), `${name}.png`),
              Buffer.concat([
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                header,
                Buffer.from(`${files}${variant}`)
              ])
            );
          }
          fs.writeFileSync(result, 'ready');
        }
        return { code: 0, output: '00:03 +2: All tests passed!' };
      },
      exec: async (_command, cwd) => {
        write(cwd, 'build/web/main.dart.js', 'the app, and nothing of lib/rough');
        return { code: 0 };
      },
      addresses: () => [],
      sleep: async () => {},
      now: () => (clock += 1000)
    };
    const report = await runDoctor(repo, {
      devUrl: 'http://127.0.0.1:8080',
      tools,
      snapshots: true
    });
    const failed = report.checks.filter(check => check.status === 'fail');
    assert.deepEqual(failed, [], JSON.stringify(report.checks, null, 2));
    assert.equal(report.outcome, 'pass');
    // The registry the test imports listed doctor's samples while they rendered, and not after.
    assert.doesNotMatch(read(repo, 'lib/rough/registry.dart'), /doctor-check/);
    assert.ok(asked[0]!.length === 3);
  });
});
