// Flutter (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 7th in the launch order): live through the
// app's web target, and snapshots rendered on this machine by Flutter's own engine in a widget
// test, for final review. Iterations are mirrored into lib/rough/ (decision 25), since lib/
// compiles nothing outside itself. Built and tested here without a Flutter SDK: its run against a
// real Flutter app is still to be proven (F6's status in the plan).
import type { RepoEnvironment } from '../../environment/types.js';
import { currentOs, hostPlatform } from '../../launch/platform.js';
import type { RepoLink } from '../../repo/link.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR } from '../../repo/root.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  ENTRY,
  FIXTURE,
  MIRROR,
  PREVIEW_ENTRY,
  PREVIEW_WRAPPER,
  SNAPSHOT_TEST,
  WRAPPER,
  isOurFlutterFile,
  packageName,
  previewEntry,
  snapshotTest,
  syncFlutterPreview
} from './preview.js';

const PORT = 8080;

/** The recipe's own files outside rough/, as they are for this app. */
function ownFiles(repo: string): { file: string; content: string; summary: string }[] {
  const pkg = packageName(repo);
  return [
    {
      file: PREVIEW_ENTRY,
      content: previewEntry(pkg),
      summary: "Add the web target's development-only preview entry."
    },
    {
      file: SNAPSHOT_TEST,
      content: snapshotTest(pkg),
      summary: 'Add the test that renders snapshots of iterations.'
    }
  ];
}

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  for (const own of ownFiles(repo)) {
    const current = read(repo, own.file);
    if (current === own.content) continue;
    if (current !== null && !isOurFlutterFile(current)) {
      manual.push(`${own.file} exists and was not written by Roughbook, so it was left alone.`);
      continue;
    }
    changes.push({
      file: own.file,
      action: current === null ? 'create' : 'edit',
      summary: current === null ? own.summary : `Update ${own.file}.`,
      after: own.content
    });
  }
  if (read(repo, `${ROUGH_DIR}/${WRAPPER}`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/${WRAPPER}`,
      action: 'create',
      summary: "Add the wrapper for the app's theme and providers.",
      after: PREVIEW_WRAPPER
    });
  }
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [`/${PREVIEW_ENTRY}`, `/${SNAPSHOT_TEST}`]
  };
}

const SETUP_NOTES = `This repo is on Flutter, which has a recipe: iterations are mirrored by the studio into
${MIRROR}/ (placement: in-tree ${MIRROR}, gitignored), beside a generated ${MIRROR}/registry.dart that imports
each iteration's ${ENTRY} (a top-level Widget buildIteration(Map<String, dynamic> fixture)) and embeds its
${FIXTURE}, and ${MIRROR}/${WRAPPER}, copied from rough/${WRAPPER}, which wraps every iteration in the app's
theme. roughbook init writes ${PREVIEW_ENTRY}, the web target's preview (flutter run -d web-server -t
${PREVIEW_ENTRY}, at /#/rough-preview/<key>, posting the ready and error messages, semantics on so its text
is in the page), and ${SNAPSHOT_TEST}, the snapshot command, which renders each key at every shot with
Flutter's own engine and writes the PNGs and result.txt. The app's lib/main.dart never imports
${MIRROR}/, so flutter build web holds nothing of it (gate: build). Start from that setup; make
rough/${WRAPPER} the app's own (its ThemeData, dark theme, localizations and providers), and keep
recipe: flutter so the studio keeps the registry.`;

export const flutter: Recipe = {
  id: 'flutter',
  name: 'Flutter',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: () => 'lib',
  environment(link, os): RepoEnvironment {
    // flutter is a batch file on Windows, which only a shell starts.
    const windows = (os ?? currentOs(hostPlatform())) === 'windows';
    return {
      contract: 1,
      recipe: 'flutter',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'flutter',
      mode: 'live',
      entry: ENTRY,
      sources: ['.dart', '.json', '.md'],
      code: ['.dart'],
      placement: { kind: 'in-tree', path: MIRROR },
      wrapper: `${ROUGH_DIR}/${WRAPPER}`,
      runtime: { kind: 'local' },
      shell: windows ? 'cmd' : 'none',
      start: {
        command: `flutter run -d web-server --web-hostname 127.0.0.1 --web-port ${PORT} -t ${PREVIEW_ENTRY}`,
        url: `http://127.0.0.1:${PORT}`
      },
      preview: '/#/rough-preview/{key}',
      snapshot: `flutter test ${SNAPSHOT_TEST}`,
      device: null,
      viewports: [
        { name: 'phone', width: 390, height: 844, mobile: true },
        { name: 'tablet', width: 820, height: 1180, mobile: true }
      ],
      variants: ['light', 'dark'],
      // flutter run on the web target does not reload on its own: the frame reloads the page.
      reload: 'studio',
      stylesheets: [],
      public: null,
      ignore: ['.git', '.dart_tool', 'build', 'ios/Pods', 'android/.gradle', MIRROR],
      overlays: [],
      fixture: FIXTURE,
      build: { command: 'flutter build web', output: ['build/web'] },
      gate: 'build',
      production: null,
      checks: ['flutter analyze'],
      timeouts: { start: 240, preview: 300, build: 900 },
      promote: { dir: 'lib/widgets', extensions: ['.dart'] },
      assets: { dir: 'assets', url: null, copy: true },
      copy: { kind: 'inline' },
      sketches: 'port',
      terms: { page: 'screen', component: 'widget' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  setupFiles: repo => ownFiles(repo).map(own => own.file),
  agentRules:
    environment => `- \`${environment.entry}\` holds a top-level \`Widget buildIteration(Map<String, dynamic> fixture)\`,
  which the studio mirrors into ${MIRROR}/ and shows on the web target and in snapshots. Import the
  app's own widgets as \`package:\` imports; import another file of the iteration by its relative path.
- Take colours, type and spacing from the app's Theme.of(context), so the dark variant follows.
`,
  roughTsconfig: () => null,
  placeholder: () => `import 'package:flutter/material.dart';

Widget buildIteration(Map<String, dynamic> fixture) =>
    const Center(child: Padding(padding: EdgeInsets.all(32), child: Text('${PLACEHOLDER_LINE}')));
`,
  generatedFiles: [],
  importAllowed: () => [PREVIEW_ENTRY, SNAPSHOT_TEST, MIRROR],
  syncPreview: syncFlutterPreview,
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${componentName.replace(/-/g, '_')}.dart`,
  promoteExtensions: ['.dart'],
  promoteWords: {
    read: "pubspec.yaml, the app's ThemeData and its theme\nextensions",
    rules: [
      "- If an asset's folder is not among pubspec.yaml's flutter assets, say which line to add\n  there; do not edit pubspec.yaml yourself."
    ],
    usage: 'its import line and constructor arguments'
  },
  craft: familyCraft('flutter'),
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `import 'package:flutter/material.dart';

Widget buildIteration(Map<String, dynamic> fixture) => Column(
      children: [Text('${marker}'), Text('\${fixture['note'] ?? ''}')],
    );
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `import 'package:flutter/widgets.dart';

Widget buildIteration(Map<String, dynamic> fixture) =>
    throw StateError('roughbook doctor: this iteration fails on purpose');
`
    }
  }),
  scaffold: {
    tool: 'flutter create',
    needs: ['flutter'],
    steps: name => [
      {
        kind: 'run',
        summary: 'Make a Flutter app for the web, Android and iOS with flutter create',
        // A folder name may hold hyphens; a Dart package's name may not.
        line: `flutter create --project-name ${name.replace(/-/g, '_')} --platforms web,android,ios ${name}`,
        shell: 'none',
        // flutter is a batch file on Windows, which only a shell starts.
        shellWindows: 'cmd',
        in: 'parent'
      }
    ]
  }
};
