// SwiftUI (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 9th in the launch order): snapshot images
// rendered on a Mac by SwiftUI's ImageRenderer, from a test target the studio fills with a mirror of
// rough/; the release build, which never compiles a test target, is the gate. For a Swift package;
// an Xcode app project gets the same pieces from the setup run. Built here without a Mac, so its
// run is unverified until one runs it (F8's status in the plan).
import type { RepoEnvironment } from '../../environment/types.js';
import { listIterations } from '../../repo/iterations.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { withSnippet } from '../../repo/setup.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import { discoverSwift } from './discover.js';
import {
  ENTRY,
  FIXTURE,
  ITERATION_FILE,
  MIRROR,
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  ROUGH_ITERATION,
  SAMPLES_FILE,
  SNAPSHOT_TEST,
  TARGET,
  TARGET_DIR,
  TEST_FILE,
  WRAPPER,
  WRAPPER_COPY,
  isOurFile,
  mainTarget,
  manifestSnippet,
  renderRegistry,
  sampleName,
  samplesFor,
  swiftString,
  syncSwiftPreview,
  typeName,
  wrapperCopy
} from './preview.js';

const MANIFEST = 'Package.swift';
const RELEASE_PATH = '.build/rough-release';

/** The closing preview of an iteration's file: named for its direction, over the shared samples. */
function previewBlock(key: string, name: string): string {
  return `#Preview("${swiftString(name)}") {
    ${typeName(key)}(fixture: RoughSamples.${sampleName(key)})
}
`;
}

/** The preview line of an iteration's file, when it is the one named by its key. */
const keyPreview = (key: string) => `#Preview("${swiftString(key)}")`;

function snippetFor(repo: string): string | null {
  const manifest = read(repo, MANIFEST);
  const target = manifest === null ? null : mainTarget(manifest);
  return target ? manifestSnippet(target) : null;
}

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const manifest = read(repo, MANIFEST);
  const snippet = snippetFor(repo);
  if (manifest === null || snippet === null) {
    manual.push(
      `${manifest === null ? `There is no ${MANIFEST}` : `${MANIFEST} declares no target to depend on`}: this recipe is for a Swift package. In an Xcode project, add a unit test target ${TARGET} that compiles ${TARGET_DIR}/ and depends on the app, or run roughbook setup to fit the project.`
    );
    return { changes, manual, ignoredFromBuild: [], gitWanted: [`/${TARGET_DIR}/`] };
  }
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: 'Add the wrapper around every iteration.',
      after: PREVIEW_WRAPPER
    });
  }
  const own = [
    { file: ITERATION_FILE, content: ROUGH_ITERATION, summary: 'Add what an iteration is.' },
    {
      file: REGISTRY_FILE,
      content: renderRegistry(listIterations(repo, ENTRY)),
      summary: 'Add the registry of iterations the snapshot tests render.'
    },
    {
      file: SAMPLES_FILE,
      content: samplesFor(repo),
      summary: "Add each component's sample data, which every direction's preview shows."
    },
    { file: WRAPPER_COPY, content: wrapperCopy(repo), summary: "Add the wrapper's copy." },
    { file: TEST_FILE, content: SNAPSHOT_TEST, summary: 'Add the tests that render snapshots.' }
  ];
  for (const item of own) {
    const current = read(repo, item.file);
    if (current === item.content) continue;
    if (current !== null && !isOurFile(current)) {
      manual.push(`${item.file} exists and was not written by Roughbook, so it was left alone.`);
      continue;
    }
    changes.push({
      file: item.file,
      action: current === null ? 'create' : 'edit',
      summary: current === null ? item.summary : `Update ${item.file}.`,
      after: item.content
    });
  }
  const after = withSnippet(manifest, snippet);
  if (after !== manifest.replace(/\r\n/g, '\n')) {
    changes.push({
      file: MANIFEST,
      action: 'edit',
      summary: `Declare the ${TARGET} test target where its folder is.`,
      after
    });
  }
  return { changes, manual, ignoredFromBuild: [], gitWanted: [`/${TARGET_DIR}/`] };
}

const SETUP_NOTES = `This repo is a Swift package with SwiftUI, which has a recipe: iterations are snapshot images
rendered on a Mac by SwiftUI's ImageRenderer (mode: snapshot; macOS 13 or later, no simulator). Everything
the studio adds is the test target ${TARGET}, in ${TARGET_DIR}/ (gitignored), which Package.swift gains at
its end, declared only where that folder is: the mirror of rough/ (placement: in-tree ${MIRROR}),
RoughIteration.swift (an iteration is a View named for its key, home/hero/iteration-01 is
HomeHeroIteration01, made by init(fixture: [String: String]) throws), the generated RoughRegistry.swift,
the generated RoughSamples.swift (each component's sample data, from its first fixture, which every
iteration's closing #Preview("<direction>") shows in Xcode's canvas),
a copy of ${WRAPPER}, and RoughSnapshotTests.swift, the snapshot command (swift test --filter ${TARGET}),
which renders each key at every shot in light and dark and writes the PNGs and result.txt. A release
build never compiles a test target (gate: build, swift build -c release into ${RELEASE_PATH}). Start from
that setup; make ${WRAPPER} the app's own (its fonts, tint and environment values), and keep recipe:
swiftui so the studio keeps the target up to date. An Xcode app project, or an iOS-only package
ImageRenderer cannot build for macOS, needs a unit test target of its own run by xcodebuild test on a
simulator instead: write it in the setup run and name its command as snapshot.`;

/** A Swift package with a SwiftUI library, as `swift package init` would start one, by text. */
export function swiftPackageFiles(name: string): Record<string, string> {
  const module = pascalCase(name) || 'App';
  return {
    'Package.swift': `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "${module}",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "${module}", targets: ["${module}"])
    ],
    targets: [
        .target(name: "${module}"),
        .testTarget(name: "${module}Tests", dependencies: ["${module}"])
    ]
)
`,
    [`Sources/${module}/${module}Theme.swift`]: `import SwiftUI

/// ${module}'s colours and type, for its screens and components.
public enum ${module}Theme {
    public static let accent = Color(red: 0.12, green: 0.36, blue: 0.27)
    public static let title = Font.system(.largeTitle, design: .rounded).weight(.semibold)
    public static let body = Font.body
}
`,
    [`Sources/${module}/WelcomeView.swift`]: `import SwiftUI

/// The first screen.
public struct WelcomeView: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 12) {
            Text("${module}").font(${module}Theme.title)
            Text("Designs live in rough/.").font(${module}Theme.body).foregroundStyle(.secondary)
        }
        .padding(32)
        .tint(${module}Theme.accent)
    }
}
`,
    [`Tests/${module}Tests/${module}Tests.swift`]: `import XCTest
@testable import ${module}

final class ${module}Tests: XCTestCase {
    func testTheme() {
        XCTAssertNotNil(${module}Theme.accent)
    }
}
`,
    '.gitignore': `.DS_Store
/.build
/.swiftpm
/Packages
xcuserdata/
DerivedData/
`,
    'README.md': `# ${module}

A Swift package with SwiftUI. \`swift build\` and \`swift test\` on a Mac (Xcode 16 or later); add it to an
app in Xcode as a local package. Designs live in rough/.
`
  };
}

export const swiftui: Recipe = {
  id: 'swiftui',
  name: 'SwiftUI',
  // 2: every iteration ends with a #Preview named for its direction, over the shared sample data in
  // the generated RoughSamples.swift (A13 of the Apple plan).
  version: 2,
  // init and setup offer Xcode's MCP bridge, a package or an Xcode app project alike.
  xcodeBridge: true,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'swiftui',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'swiftui',
      mode: 'snapshot',
      entry: ENTRY,
      sources: ['.swift', '.json', '.md'],
      code: ['.swift'],
      placement: { kind: 'in-tree', path: MIRROR },
      wrapper: WRAPPER,
      runtime: { kind: 'local' },
      shell: 'none',
      start: { command: null, url: 'http://localhost:3000' },
      preview: '/rough-preview/{key}',
      snapshot: `swift test --filter ${TARGET}`,
      device: null,
      viewports: [
        { name: 'phone', width: 390, height: 844, mobile: true },
        { name: 'tablet', width: 820, height: 1180, mobile: true }
      ],
      variants: ['light', 'dark'],
      reload: 'studio',
      stylesheets: [],
      public: null,
      ignore: ['.build', '.swiftpm', 'DerivedData', '.git', TARGET_DIR],
      overlays: [],
      fixture: FIXTURE,
      build: {
        command: `swift build -c release --scratch-path ${RELEASE_PATH}`,
        output: [RELEASE_PATH]
      },
      gate: 'build',
      production: null,
      checks: [],
      timeouts: { start: 60, preview: 600, build: 900 },
      promote: { dir: 'Sources', extensions: ['.swift'] },
      assets: { dir: null, url: null, copy: true },
      copy: { kind: 'inline' },
      sketches: 'port',
      terms: { page: 'screen', component: 'view' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverSwift,
  setupFiles: () => [ITERATION_FILE, REGISTRY_FILE, SAMPLES_FILE, WRAPPER_COPY, TEST_FILE],
  snippets: repo => {
    const snippet = snippetFor(repo);
    return snippet ? [{ file: MANIFEST, text: snippet }] : [];
  },
  agentRules:
    environment => `- \`${environment.entry}\` holds a SwiftUI view named for its key, \`home/hero/iteration-01\` as
  \`struct HomeHeroIteration01: RoughIteration\`, with \`init(fixture: [String: String])\` taking the
  values of \`${FIXTURE}\`. Every other type of the iteration is nested inside it, since all iterations
  share one module. Import the app's module (\`@testable import\` for its internal views).
- End the file with one preview named for the run's direction, the words after \`Direction:\` in
  your prompt, over the sample data every direction of the component shares:
  \`#Preview("<direction>") { HomeHeroIteration01(fixture: RoughSamples.home_hero) }\`, where
  \`RoughSamples.<page>_<component>\` (camel case within each: \`order-history/line-item\` is
  \`orderHistory_lineItem\`) is generated from the component's fixture. A fork or refinement keeps
  its parent's preview name; with no direction, the preview is named by the iteration's key. Write
  \`try!\` before the type if its init throws, and keep this the file's only preview.
- Take colours from the app's assets or the semantic colours, and type from text styles, so Dark Mode
  and Dynamic Type follow.
`,
  roughTsconfig: () => null,
  // `direction` is the run's, as its prompt names it, when the caller has it (A13).
  placeholder: (
    _entry: string,
    key = 'home/hero/iteration-01',
    direction?: string
  ) => `import SwiftUI

struct ${typeName(key)}: RoughIteration {
    init(fixture: [String: String]) {}

    var body: some View {
        Text("${PLACEHOLDER_LINE}")
            .multilineTextAlignment(.center)
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

${previewBlock(key, direction?.trim() || key)}`,
  // A fork's type is named by the parent's key: the new key's, so the two never clash in one module.
  // A preview named by the parent's key follows it; one named for a direction keeps its name.
  retarget: (_file, text, from, to) =>
    text
      .replace(new RegExp(`\\b${typeName(from)}\\b`, 'g'), typeName(to))
      .replaceAll(keyPreview(from), keyPreview(to)),
  generatedFiles: [],
  importAllowed: () => [TARGET_DIR],
  syncPreview: syncSwiftPreview,
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${pascalCase(componentName)}.swift`,
  promoteExtensions: ['.swift'],
  promoteWords: {
    read: "Package.swift, the app's theme and its views",
    rules: [
      '- Write a public SwiftUI View in the folder of the target it belongs to (Sources/<target>/),\n  with its values as stored properties and an init.'
    ],
    usage: 'its type and its init'
  },
  craft: familyCraft('swiftui'),
  doctorSamples: ({ marker, fixtureNote, key }) => ({
    good: {
      [ENTRY]: `import SwiftUI

struct ${typeName(key)}: RoughIteration {
    let note: String

    init(fixture: [String: String]) {
        note = fixture["note"] ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("${marker}").font(.title)
            Text(note)
        }
        .padding(24)
    }
}
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `import SwiftUI

struct ${typeName(key)}: RoughIteration {
    struct Broken: Error {}

    init(fixture: [String: String]) throws {
        throw Broken()
    }

    var body: some View { EmptyView() }
}
`
    }
  }),
  scaffold: {
    tool: 'a Swift package with SwiftUI',
    needs: ['swift'],
    steps: name => [
      {
        kind: 'write',
        summary: 'Write a Swift package with a SwiftUI library and its tests',
        files: swiftPackageFiles(name)
      }
    ]
  }
};
