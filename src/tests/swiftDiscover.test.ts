// The SwiftUI map reader (A13 step 3 of ROUGHBOOK-APPLE-PLAN.md, after B1 of the brownfield plan):
// targets from Package.swift and an Xcode project's project.pbxproj, then pages, sections, Shared
// and atoms from the Swift sources, reading text only. No Swift or Xcode runs here: the Xcode
// project is the hand-written fixture in conformance/fixtures/swiftui-xcode, the package ones are
// the generated conformance fixture and small apps written here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RepoEnvironment } from '../environment/types.js';
import { buildMap } from '../map/build.js';
import { discoverersFor } from '../map/run.js';
import type { Discovered } from '../map/types.js';
import { recipeFor } from '../recipes/index.js';
import { discoverSwift } from '../recipes/swiftui/discover.js';
import { tempDir } from './helpers.js';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = path.join(studioRoot, 'conformance', 'fixtures');

function write(repo: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(repo, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

const input = (repo: string) => ({
  repo,
  ignore: ['.build', '.swiftpm', 'DerivedData', '.git'],
  own: []
});

function pageNamed(found: Discovered, name: string | null) {
  const page = found.pages.find(item => item.name === name);
  assert.ok(page, `no page ${name}: ${found.pages.map(item => item.name).join(', ')}`);
  return page;
}

function names(found: Discovered, keys: string[]): string[] {
  return keys.map(key => found.components.find(item => item.key === key)?.name ?? `?${key}`);
}

function kindOf(found: Discovered, name: string) {
  return found.components.find(item => item.name === name)?.kind;
}

function missedText(found: Discovered): string {
  return found.missed.map(item => `${item.what}: ${item.why}`).join('\n');
}

describe('the SwiftUI discoverer on an Xcode project', () => {
  const repo = path.join(fixtures, 'swiftui-xcode');

  it('reads the app target from project.pbxproj, and pages from the @main App down', async () => {
    const found = await discoverSwift(input(repo));
    assert.equal(found.by, 'swiftui');
    // Shared first; then the shell's tabs, each followed by where it navigates; then Settings.
    assert.deepEqual(
      found.pages.map(page => [page.name, page.address, page.files]),
      [
        [null, null, ['Tide/RootView.swift']],
        ['Today', null, ['Tide/Today/TodayView.swift']],
        ['Library', null, ['Tide/Library/LibraryView.swift']],
        ['Track detail', null, ['Tide/Library/TrackDetailView.swift']],
        ['Profile', null, ['Tide/Profile/ProfileView.swift']],
        ['Settings', null, ['Tide/Settings/SettingsView.swift']]
      ]
    );
    for (const page of found.pages) {
      assert.equal(page.signIn, 'unknown');
      assert.equal(page.example, null);
    }
  });

  it("gives each page its body's views in order, through stacks, containers and helpers", async () => {
    const found = await discoverSwift(input(repo));
    assert.deepEqual(names(found, pageNamed(found, null).sections), ['NowPlayingBar']);
    assert.deepEqual(names(found, pageNamed(found, 'Today').sections), [
      'TodayHeader',
      'StreakCard'
    ]);
    // `header` is the view's own helper, in an extension.
    assert.deepEqual(names(found, pageNamed(found, 'Library').sections), ['LibraryHeader']);
    // Card is a container: what it is handed stands in its place.
    assert.deepEqual(names(found, pageNamed(found, 'Track detail').sections), [
      'Artwork',
      'TrackCredits'
    ]);
    assert.deepEqual(pageNamed(found, 'Profile').sections, []);
    assert.deepEqual(names(found, pageNamed(found, 'Settings').sections), [
      'AccountSection',
      'NotificationsSection'
    ]);
  });

  it('tells Shared, sections and atoms apart, keyed by file and type', async () => {
    const found = await discoverSwift(input(repo));
    assert.equal(kindOf(found, 'NowPlayingBar'), 'shared');
    assert.equal(kindOf(found, 'TodayHeader'), 'section');
    // Rows in a ForEach, and a view in a UI/ folder, are atoms.
    assert.equal(kindOf(found, 'SessionRow'), 'atom');
    assert.equal(kindOf(found, 'TrackRow'), 'atom');
    assert.equal(kindOf(found, 'PillButton'), 'atom');
    assert.equal(kindOf(found, 'Card'), undefined);
    const header = found.components.find(item => item.name === 'TodayHeader')!;
    assert.deepEqual(header, {
      key: 'Tide/Today/TodayHeader.swift#TodayHeader',
      name: 'TodayHeader',
      kind: 'section',
      files: ['Tide/Today/TodayHeader.swift'],
      export: 'TodayHeader',
      fixture: null,
      fixtureFrom: null
    });
  });

  it('names what it cannot place, and lists only the target’s unused views as unplaced', async () => {
    const found = await discoverSwift(input(repo));
    const missed = missedText(found);
    assert.match(missed, /Tide\/Today\/NewSessionSheet\.swift: .*sheet.*TodayView/);
    assert.match(missed, /Tide\/Profile\/ProfileView\.swift: .*inline/);
    // The file outside the target and the test target are never read as the app's.
    assert.deepEqual(found.unplaced, ['Tide/Old/LegacyBanner.swift']);
    assert.doesNotMatch(JSON.stringify(found), /NotInTarget|TestHost|TideTests/);
  });
});

const ORBIT: Record<string, string> = {
  'Package.swift': `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Orbit",
    platforms: [.iOS(.v17)],
    targets: [
        .executableTarget(name: "OrbitApp", dependencies: ["OrbitKit"], path: "App"),
        .target(name: "OrbitKit"),
        // .target(name: "Gone"),
        .testTarget(name: "OrbitKitTests", dependencies: ["OrbitKit"])
    ]
)
`,
  'App/OrbitApp.swift': `import SwiftUI
import OrbitKit

@main
struct OrbitApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                HomeView()
            }
        }
    }
}
`,
  'Sources/OrbitKit/HomeView.swift': `import SwiftUI

public struct HomeView: View {
    @State private var name: String? = nil
    public init() {}

    public var body: some View {
        ScrollView {
            // LegacyHero()
            /* OldView() */
            HeroBanner(title: "Orbit \\(name ?? "you") OldView()")
            Text("Try OldView() first")
            Text(#"Raw "OldView()" too"#)
            FeatureGrid()
            NavigationLink(destination: AboutView()) { Text("About") }
            NavigationLink {
                HelpView()
            } label: {
                Label("Help", systemImage: "questionmark")
            }
        }
    }
}

#Preview("Home") {
    HomeView()
}
`,
  'Sources/OrbitKit/HeroBanner.swift': `import SwiftUI

struct HeroBanner: View {
    let title: String
    var body: some View {
        Text(title).font(.largeTitle)
    }
}
`,
  'Sources/OrbitKit/FeatureGrid.swift': `import SwiftUI

struct FeatureGrid: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))]) {
            ForEach(Feature.all) {
                FeatureTile(feature: $0)
            }
        }
    }
}

struct FeatureTile: View {
    let feature: Feature
    var body: some View {
        Text(feature.title)
    }
}

struct Feature: Identifiable {
    let id: Int
    let title: String
    static let all = [Feature(id: 1, title: "Fast")]
}
`,
  'Sources/OrbitKit/AboutView.swift': `import SwiftUI

struct AboutView: View {
    var body: some View {
        AboutContent()
    }
}

struct AboutContent: View {
    var body: some View {
        VStack {
            AboutIntro()
            TeamList()
        }
    }
}

struct AboutIntro: View {
    var body: some View { Text("About Orbit") }
}

struct TeamList: View {
    var body: some View { Text("The team") }
}
`,
  'Sources/OrbitKit/HelpView.swift': `import SwiftUI

struct HelpView: View {
    var body: some View {
        List {
            Text("Ask us anything")
        }
    }
}
`,
  'Sources/OrbitKit/Legacy.swift': `import SwiftUI

struct LegacyHero: View {
    var body: some View { Text("Old") }
}

struct OldView: View {
    var body: some View { Text("Older") }
}

#Preview {
    OldView()
}
`,
  'Tests/OrbitKitTests/HomeTests.swift': `import SwiftUI
@testable import OrbitKit

struct Host: View {
    var body: some View { HomeView() }
}
`
};

describe('the SwiftUI discoverer on a Swift package', () => {
  it("reads Package.swift's targets, their paths, and NavigationLink destinations", async () => {
    const repo = await tempDir();
    write(repo, ORBIT);
    const found = await discoverSwift(input(repo));
    assert.deepEqual(
      found.pages.map(page => [page.name, page.address, names(found, page.sections)]),
      [
        ['Home', null, ['HeroBanner', 'FeatureGrid']],
        // A page that renders one view of two sections or more gets that view's sections.
        ['About', null, ['AboutIntro', 'TeamList']],
        ['Help', null, []]
      ]
    );
    assert.deepEqual(pageNamed(found, 'About').files, ['Sources/OrbitKit/AboutView.swift']);
    assert.equal(kindOf(found, 'FeatureTile'), 'atom');
    assert.match(missedText(found), /Sources\/OrbitKit\/HelpView\.swift: .*inline/);
    // Comments, strings and #Preview blocks render nothing: Legacy.swift's views are unused.
    assert.deepEqual(found.unplaced, ['Sources/OrbitKit/Legacy.swift']);
    assert.doesNotMatch(JSON.stringify(found.components), /Gone|Host|OrbitKitTests/);
  });

  it('takes TabView children with .tabItem as pages, and names a file it cannot read', async () => {
    const repo = await tempDir();
    write(repo, {
      'Package.swift': `// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "Tabs", targets: [.executableTarget(name: "Tabs")])
`,
      'Sources/Tabs/TabsApp.swift': `import SwiftUI

@main struct TabsApp: App {
    var body: some Scene {
        WindowGroup { MainTabs() }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            FeedView()
                .tabItem { Label("Feed", systemImage: "list.bullet") }
            InboxScreen()
                .tabItem { Label("Inbox", systemImage: "tray") }
        }
    }
}

struct FeedView: View {
    var body: some View {
        VStack { FeedHeader(); FeedList() }
    }
}

struct InboxScreen: View {
    var body: some View { InboxList() }
}

struct FeedHeader: View { var body: some View { Text("Feed") } }
struct FeedList: View { var body: some View { Text("Items") } }
struct InboxList: View { var body: some View { Text("Mail") } }
`,
      'Sources/Tabs/Broken.swift': `import SwiftUI

struct HalfWritten: View {
    var body: some View {
        VStack {
            Text("mid-edit")
`
    });
    const found = await discoverSwift(input(repo));
    assert.deepEqual(
      found.pages.map(page => [page.name, names(found, page.sections)]),
      [
        ['Feed', ['FeedHeader', 'FeedList']],
        ['Inbox', ['InboxList']]
      ]
    );
    const broken = found.missed.find(item => item.what === 'Sources/Tabs/Broken.swift');
    assert.ok(broken, missedText(found));
    assert.equal(broken.unread, true);
  });

  it('names a package with no @main App, as the conformance fixture is', async () => {
    const found = await discoverSwift(input(path.join(fixtures, 'swiftui')));
    assert.deepEqual(found.pages, []);
    assert.match(missedText(found), /Package\.swift: .*@main/);
    assert.deepEqual(found.unplaced, ['Sources/Harbor/WelcomeView.swift']);
  });
});

describe('the SwiftUI discoverer on Xcode 16 projects and what it cannot read', () => {
  it("reads a synchronized folder, less its target's exceptions, and a split view's columns", async () => {
    const repo = await tempDir();
    write(repo, {
      'ios/Notes.xcodeproj/project.pbxproj': `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {
		AA0000000000000000000001 /* Notes */ = {isa = PBXFileSystemSynchronizedRootGroup; exceptions = (EE0000000000000000000001 /* Exceptions for "Notes" folder in "Notes" target */, ); path = Notes; sourceTree = "<group>"; };
		EE0000000000000000000001 /* Exceptions for "Notes" folder in "Notes" target */ = {isa = PBXFileSystemSynchronizedBuildFileExceptionSet; membershipExceptions = (Draft.swift, ); target = TT0000000000000000000001 /* Notes */; };
		MG0000000000000000000001 = {isa = PBXGroup; children = (AA0000000000000000000001 /* Notes */, PG0000000000000000000001 /* Products */, ); sourceTree = "<group>"; };
		PG0000000000000000000001 /* Products */ = {isa = PBXGroup; children = (); name = Products; sourceTree = "<group>"; };
		TT0000000000000000000001 /* Notes */ = {isa = PBXNativeTarget; buildPhases = (); fileSystemSynchronizedGroups = (AA0000000000000000000001 /* Notes */, ); name = Notes; productType = "com.apple.product-type.application"; };
		PP0000000000000000000001 /* Project object */ = {isa = PBXProject; mainGroup = MG0000000000000000000001; targets = (TT0000000000000000000001 /* Notes */, ); };
	};
	rootObject = PP0000000000000000000001 /* Project object */;
}
`,
      'ios/Notes/NotesApp.swift': `import SwiftUI

@main
struct NotesApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
`,
      'ios/Notes/ContentView.swift': `import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationSplitView {
            NoteList()
        } detail: {
            NoteEditor()
        }
    }
}
`,
      'ios/Notes/NoteList.swift': `import SwiftUI
struct NoteList: View { var body: some View { List { Text("A note") } } }
`,
      'ios/Notes/Editor/NoteEditor.swift': `import SwiftUI
struct NoteEditor: View {
    @State private var text = ""
    var body: some View {
        VStack {
            EditorToolbar()
            TextEditor(text: $text)
        }
    }
}
struct EditorToolbar: View { var body: some View { HStack { Text("B") } } }
`,
      'ios/Notes/Draft.swift': `import SwiftUI
struct Draft: View { var body: some View { Text("Not in the target") } }
`,
      'ios/Notes/Old.swift': `import SwiftUI
struct OldList: View { var body: some View { Text("Old") } }
`
    });
    const found = await discoverSwift(input(repo));
    assert.deepEqual(
      found.pages.map(page => [page.name, page.files, names(found, page.sections)]),
      [
        [null, ['ios/Notes/ContentView.swift'], ['NoteList']],
        ['Note editor', ['ios/Notes/Editor/NoteEditor.swift'], ['EditorToolbar']]
      ]
    );
    assert.equal(kindOf(found, 'NoteList'), 'shared');
    assert.deepEqual(found.unplaced, ['ios/Notes/Old.swift']);
    assert.doesNotMatch(JSON.stringify(found), /Draft/);
  });

  it('names a project it cannot parse, a UIKit app, and a repo with no targets', async () => {
    const broken = await tempDir();
    write(broken, {
      'Broken.xcodeproj/project.pbxproj': '// !$*UTF8*$!\n{ objects = { AA = {isa = PBXProject; \n',
      'Broken/App.swift': 'import UIKit\n'
    });
    assert.match(
      missedText(await discoverSwift(input(broken))),
      /Broken\.xcodeproj\/project\.pbxproj: could not be read/
    );

    const uikit = await tempDir();
    write(uikit, {
      'Package.swift':
        'import PackageDescription\nlet package = Package(name: "Old", targets: [.executableTarget(name: "Old")])\n',
      'Sources/Old/AppDelegate.swift': `import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
}
`
    });
    assert.match(missedText(await discoverSwift(input(uikit))), /UIKit/);

    const none = await tempDir();
    write(none, { 'Loose.swift': 'import SwiftUI\n' });
    const found = await discoverSwift(input(none));
    assert.deepEqual(found.pages, []);
    assert.match(missedText(found), /no Package\.swift or Xcode project/);
  });
});

describe('the map built from what it finds', () => {
  it('keeps one page per screen beside Shared, slugged by name and kept across runs', async () => {
    const found = await discoverSwift(input(path.join(fixtures, 'swiftui-xcode')));
    const first = buildMap([found], null, { fixture: null }).map;
    assert.deepEqual(
      first.pages.map(page => [page.slug, page.name, page.address, page.sections]),
      [
        ['shared', 'Shared', null, ['now-playing-bar']],
        ['today', 'Today', null, ['today-header', 'streak-card']],
        ['library', 'Library', null, ['library-header']],
        ['track-detail', 'Track detail', null, ['artwork', 'track-credits']],
        ['profile', 'Profile', null, []],
        ['settings', 'Settings', null, ['account-section', 'notifications-section']]
      ]
    );
    assert.equal(first.components.find(item => item.slug === 'now-playing-bar')!.kind, 'shared');
    assert.equal(first.components.find(item => item.slug === 'today-header')!.kind, 'section');
    // The map run renames a screen: the next build keeps its name and slug, not a second page.
    const renamed = {
      ...first,
      pages: first.pages.map(page =>
        page.slug === 'today' ? { ...page, name: 'Your day', signIn: 'no' as const } : page
      )
    };
    const again = buildMap([found], renamed, { fixture: null }).map;
    assert.deepEqual(
      again.pages.map(page => [page.slug, page.name, page.signIn]),
      [
        ['shared', 'Shared', 'unknown'],
        ['today', 'Your day', 'no'],
        ['library', 'Library', 'unknown'],
        ['track-detail', 'Track detail', 'unknown'],
        ['profile', 'Profile', 'unknown'],
        ['settings', 'Settings', 'unknown']
      ]
    );
  });
});

describe('discoverersFor', () => {
  const swiftui = recipeFor('swiftui')!;

  it("reaches the SwiftUI discoverer from an Xcode project's family, which has no recipe", () => {
    assert.equal(swiftui.discover, discoverSwift);
    const xcode: RepoEnvironment = {
      ...swiftui.environment(null),
      recipe: null,
      stack: ['ios'],
      family: 'swiftui'
    };
    assert.deepEqual(
      discoverersFor(xcode).map(recipe => recipe.id),
      ['swiftui']
    );
  });

  it("leaves every other stack's discoverers as they were", () => {
    const next = recipeFor('next')!;
    assert.deepEqual(
      discoverersFor({ ...next.environment(null), stack: ['next-16'] }).map(recipe => recipe.id),
      ['next']
    );
    const laravel = recipeFor('laravel')!;
    assert.deepEqual(
      discoverersFor({ ...laravel.environment(null), stack: ['laravel-13', 'vite-7'] }).map(
        recipe => recipe.id
      ),
      ['vite', 'laravel']
    );
    const flutter = recipeFor('flutter')!;
    assert.deepEqual(discoverersFor({ ...flutter.environment(null), stack: ['flutter'] }), []);
  });
});
