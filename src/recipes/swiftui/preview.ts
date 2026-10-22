// SwiftUI, in a Swift package: iterations are snapshot images rendered on this Mac by SwiftUI's own
// ImageRenderer, in a test target a release build never compiles. A package compiles only its
// targets' folders, so the studio mirrors rough/ into the test target (decision 25). Everything is
// in that one folder, gitignored, and Package.swift declares the target only where the folder is,
// so a clone the studio has not prepared builds as before:
//
//   Tests/RoughSnapshotTests/Iterations/          the mirror of rough/
//   Tests/RoughSnapshotTests/RoughIteration.swift what an iteration is
//   Tests/RoughSnapshotTests/RoughRegistry.swift  each iteration's type, by key (generated)
//   Tests/RoughSnapshotTests/RoughPreview.swift   rough/RoughPreview.swift, copied
//   Tests/RoughSnapshotTests/RoughSnapshotTests.swift   the snapshot command
//   Package.swift                                 the target, appended
//
// Built and tested without a Mac: its run on macOS is still to be proven (F8's status in the plan).
import fs from 'node:fs';
import path from 'node:path';
import { listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const TARGET = 'RoughSnapshotTests';
export const TARGET_DIR = `Tests/${TARGET}`;
export const MIRROR = `${TARGET_DIR}/Iterations`;
export const ENTRY = 'Iteration.swift';
export const FIXTURE = 'preview.json';
export const WRAPPER = `${ROUGH_DIR}/RoughPreview.swift`;
export const ITERATION_FILE = `${TARGET_DIR}/RoughIteration.swift`;
export const REGISTRY_FILE = `${TARGET_DIR}/RoughRegistry.swift`;
export const WRAPPER_COPY = `${TARGET_DIR}/RoughPreview.swift`;
export const TEST_FILE = `${TARGET_DIR}/RoughSnapshotTests.swift`;
const MARKER = 'Written by Roughbook (the SwiftUI recipe)';
const COPIED = `// Copied by Roughbook from ${WRAPPER}: edit that file. Never committed.\n`;

/** The type an iteration is, named by its key: home/hero/iteration-01 is HomeHeroIteration01. */
export function typeName(key: string): string {
  const name = key
    .split(/[/-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : `Rough${name}`;
}

/** The app's own module, the first target Package.swift declares that is not a test's. */
export function mainTarget(manifest: string): string | null {
  return /\.(?:target|executableTarget)\(\s*name:\s*"([^"]+)"/.exec(manifest)?.[1] ?? null;
}

/** What Package.swift gains: the test target, declared only where its folder is. */
export function manifestSnippet(target: string): string {
  return `
// Roughbook (development only): the snapshot tests that render design iterations with SwiftUI's
// ImageRenderer, from the iterations the studio mirrors into ${TARGET_DIR}/. A test target is never in
// a release build, and it is declared only where its folder is, so a clone without it builds as before.
import Foundation

if FileManager.default.fileExists(atPath: Context.packageDirectory + "/${TARGET_DIR}") {
    package.targets.append(
        .testTarget(name: "${TARGET}", dependencies: ["${target}"], path: "${TARGET_DIR}")
    )
}
`;
}

export const ROUGH_ITERATION = `// ${MARKER}. Development only, never committed.
import SwiftUI

/// What every iteration in rough/ is: a view named for its key (home/hero/iteration-01 is
/// HomeHeroIteration01), made from its fixture's values. One that cannot be made throws, which
/// fails its own snapshots alone.
protocol RoughIteration: View {
    init(fixture: [String: String]) throws
}
`;

/** The registry: each iteration's type, by key. */
export function renderRegistry(keys: string[]): string {
  return `// ${MARKER} from the iterations in ${ROUGH_DIR}/. Do not edit; it is never committed.
@MainActor
enum RoughRegistry {
    static let iterations: [String: any RoughIteration.Type] = [
${keys.map(key => `        ${JSON.stringify(key)}: ${typeName(key)}.self,\n`).join('')}${keys.length ? '' : '        :\n'}    ]
}
`;
}

export const SNAPSHOT_TEST = `// ${MARKER}. Development only, never committed.
import ImageIO
import SwiftUI
import UniformTypeIdentifiers
import XCTest

/// Roughbook's snapshot command (rough/CONTRACT.md): renders each key in ROUGHBOOK_KEYS at every
/// shot in ROUGHBOOK_SHOTS with SwiftUI's ImageRenderer on this Mac, and writes
/// <ROUGHBOOK_OUT>/<key>/<shot>.png and result.txt. With no keys it renders nothing.
@MainActor
final class RoughSnapshotTests: XCTestCase {
    enum Failure: Error, CustomStringConvertible {
        case notRendered
        case notWritten
        var description: String {
            self == .notRendered ? "ImageRenderer gave no image." : "The image could not be written."
        }
    }

    func testRender() throws {
        let env = ProcessInfo.processInfo.environment
        let keys = (env["ROUGHBOOK_KEYS"] ?? "").split(separator: ",").map(String.init)
        let out = URL(fileURLWithPath: env["ROUGHBOOK_OUT"] ?? "${ROUGH_DIR}/.screenshots")
        let shots = (env["ROUGHBOOK_SHOTS"] ?? "phone:390x844:light")
            .split(separator: ",")
            .map { $0.split(separator: ":").map(String.init) }
        let iterations = URL(fileURLWithPath: env["ROUGHBOOK_ITERATIONS"] ?? "${MIRROR}")
        let fixtureName = env["ROUGHBOOK_FIXTURE"].flatMap { $0.isEmpty ? nil : $0 } ?? "${FIXTURE}"
        var failed: [String] = []
        for key in keys where !key.isEmpty {
            let folder = out.appendingPathComponent(key)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let result = folder.appendingPathComponent("result.txt")
            guard let type = RoughRegistry.iterations[key] else {
                try "missing".write(to: result, atomically: true, encoding: .utf8)
                failed.append(key)
                continue
            }
            var fixture: [String: String] = [:]
            let fixtureFile = iterations.appendingPathComponent(key).appendingPathComponent(fixtureName)
            if let data = try? Data(contentsOf: fixtureFile),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            {
                for (name, value) in json { fixture[name] = "\\(value)" }
            }
            do {
                let iteration = try type.init(fixture: fixture)
                for shot in shots where shot.count >= 2 {
                    let size = shot[1].split(separator: "x").compactMap { Double($0) }
                    guard size.count == 2 else { continue }
                    let variant = shot.count > 2 ? shot[2] : ""
                    let locale = Locale(identifier: variant)
                    let rightToLeft = Locale.Language(identifier: variant).characterDirection == .rightToLeft
                    let view = RoughPreview { AnyView(iteration) }
                        .frame(width: size[0], height: size[1])
                        .environment(\\.colorScheme, variant == "dark" ? .dark : .light)
                        .environment(\\.layoutDirection, rightToLeft ? .rightToLeft : .leftToRight)
                        .environment(\\.locale, variant == "dark" || variant == "light" ? .current : locale)
                    let renderer = ImageRenderer(content: view)
                    renderer.scale = 3
                    guard let image = renderer.cgImage else { throw Failure.notRendered }
                    let file = folder.appendingPathComponent("\\(shot[0]).png") as CFURL
                    guard let destination = CGImageDestinationCreateWithURL(file, UTType.png.identifier as CFString, 1, nil)
                    else { throw Failure.notWritten }
                    CGImageDestinationAddImage(destination, image, nil)
                    guard CGImageDestinationFinalize(destination) else { throw Failure.notWritten }
                }
                try "ready".write(to: result, atomically: true, encoding: .utf8)
            } catch {
                try "error: \\(error)".write(to: result, atomically: true, encoding: .utf8)
                failed.append(key)
            }
        }
        if !failed.isEmpty { XCTFail("Not rendered: \\(failed.joined(separator: ", "))") }
    }
}
`;

export const PREVIEW_WRAPPER = `import SwiftUI

/// Wraps every iteration in what the app's screens have around them: make it the app's own, with
/// its fonts, tint and environment values. Roughbook copies this file beside the iterations.
struct RoughPreview<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(.background)
    }
}
`;

export function wrapperCopy(repo: string): string {
  const own = path.join(repo, ...WRAPPER.split('/'));
  return COPIED + (fs.existsSync(own) ? fs.readFileSync(own, 'utf8') : PREVIEW_WRAPPER);
}

function writeIfChanged(file: string, text: string): void {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Keeps the registry and the wrapper's copy up with rough/, in a repo the recipe prepared. */
export function syncSwiftPreview(repo: string): void {
  if (!fs.existsSync(path.join(repo, ...TARGET_DIR.split('/')))) return;
  writeIfChanged(
    path.join(repo, ...REGISTRY_FILE.split('/')),
    renderRegistry(listIterations(repo, ENTRY))
  );
  writeIfChanged(path.join(repo, ...WRAPPER_COPY.split('/')), wrapperCopy(repo));
}

export function isOurFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER) || text?.startsWith(COPIED));
}
