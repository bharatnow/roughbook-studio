# swiftui-xcode

An Xcode app project written by hand for the Swift map reader's tests
(`src/tests/swiftDiscover.test.ts`), beside the generated Swift package in `../swiftui`. It is not
in `conformance/fixtures.json`: nothing here builds or runs it, and no Swift or Xcode runs on it.
The discoverer reads its targets from `Tide.xcodeproj/project.pbxproj` and its views from the
sources the app target names.

What it has, as the tests expect it:

- `TideApp`, the `@main` App: a `WindowGroup` with `RootView`, and a macOS `Settings` scene.
- `RootView`, the shell: a `TabView` of Today, Library and Profile, and the player bar under every
  tab (Shared).
- Library's `navigationDestination` to the track detail, whose credits sit in a `Card` container.
- Rows in `ForEach` and the pill button in `UI/` (atoms), a sheet, a page written inline (Profile),
  a view nothing shows (`Old/LegacyBanner.swift`), a file outside the target
  (`Scratch/NotInTarget.swift`) and a test target, none of which is read as one of the app's pages.
