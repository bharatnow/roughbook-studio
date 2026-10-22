import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyChecks } from '../runs/checks.js';
import { nativeFloorFindings, unescapeNative } from '../runs/nativeFloor.js';

// The same cases as the backend's src/tests/compile/nativeFloor.test.ts: the backend sends the
// native-floor check for the native toolkits' families, and both sides apply it the same way.

const FLUTTER = `import 'package:flutter/material.dart';

Widget buildIteration(Map<String, dynamic> fixture) => Column(children: [
      const Text('Lorem ipsum dolor sit amet'),
      IconButton(icon: const Icon(Icons.close), onPressed: () {}),
      IconButton.filled(onPressed: () {}, icon: const Icon(Icons.add)),
      IconButton(tooltip: 'Share', icon: const Icon(Icons.share), onPressed: () {}),
      Text('Don\\'t wait for \\$9 bowls'),
    ]);
`;

const SWIFTUI = `import SwiftUI

struct Iteration: View {
  var body: some View {
    VStack {
      Text("Your Company")
      Button(action: { close() }) { Image(systemName: "xmark") }
      Button { share() } label: { Image(systemName: "square.and.arrow.up") }
        .accessibilityLabel("Share")
      Button { save() } label: { Label("Save", systemImage: "tray") }
      Button("Done") { done() }
      Button { more() } label: {
        Image(systemName: "ellipsis")
      }
      .buttonStyle(.plain)
    }
  }
}
`;

const COMPOSE = `package rough.home.hero.iteration_01

@Composable
fun Iteration(fixture: Map<String, String>) {
  Column {
    Text("Signed, Jane Doe")
    IconButton(onClick = {}) { Icon(Icons.Default.Close, contentDescription = null) }
    IconButton(onClick = {}) { Icon(Icons.Default.Share, contentDescription = "Share") }
    FilledIconButton(onClick = {}, modifier = Modifier.semantics { contentDescription = "Add" }) {
      Icon(Icons.Default.Add, contentDescription = null)
    }
    OutlinedIconButton(onClick = {}) {
      Icon(Icons.Default.Menu, contentDescription = null)
    }
    Text("Say \\"hello\\" for \\$9")
  }
}
`;

describe('the native floor', () => {
  it('reads a Flutter iteration: placeholder copy, and icon buttons with no tooltip', () => {
    assert.deepEqual(nativeFloorFindings(new Map([['iteration.dart', FLUTTER]]), 'flutter'), [
      {
        code: 'PLACEHOLDER_COPY',
        message:
          'iteration.dart has placeholder copy, such as lorem ipsum or a stand-in name like Jane Doe.'
      },
      {
        code: 'ICON_BUTTON_UNNAMED',
        message:
          'iteration.dart has an icon-only button with no name for a screen reader (2 of them): an IconButton with no tooltip.'
      }
    ]);
  });

  it('reads a SwiftUI iteration: a Button labelled by an Image alone, unless it is named after', () => {
    const findings = nativeFloorFindings(new Map([['Iteration.swift', SWIFTUI]]), 'swiftui');
    assert.deepEqual(
      findings.map(finding => finding.code),
      ['PLACEHOLDER_COPY', 'ICON_BUTTON_UNNAMED']
    );
    assert.match(findings[1]!.message, /\(2 of them\): a Button labelled by an Image alone/);
  });

  it('reads a Compose iteration: an IconButton whose Icon has no description and nothing names', () => {
    const findings = nativeFloorFindings(new Map([['Iteration.kt', COMPOSE]]), 'compose');
    assert.deepEqual(
      findings.map(finding => finding.code),
      ['PLACEHOLDER_COPY', 'ICON_BUTTON_UNNAMED']
    );
    assert.match(
      findings[1]!.message,
      /\(2 of them\): an IconButton whose Icon has contentDescription = null/
    );
  });

  it("reads only its own toolkit's files, and passes clean ones", () => {
    assert.deepEqual(nativeFloorFindings(new Map([['notes.md', FLUTTER]]), 'flutter'), []);
    assert.deepEqual(nativeFloorFindings(new Map([['Iteration.kt', FLUTTER]]), 'swiftui'), []);
    const clean = `IconButton(tooltip: 'Close', icon: const Icon(Icons.close), onPressed: () {})`;
    assert.deepEqual(nativeFloorFindings(new Map([['iteration.dart', clean]]), 'flutter'), []);
  });

  it('applies the check the backend sends, the headline read through the string escapes', () => {
    const outcome = applyChecks(
      [
        { kind: 'entry-file', file: 'iteration.dart' },
        {
          kind: 'approved-headline',
          version: 2,
          headline: "Don't wait for $9 bowls",
          native: true
        },
        { kind: 'native-floor', family: 'flutter' }
      ],
      {
        iterationId: 'iteration-01',
        files: new Map([['iteration.dart', FLUTTER]]),
        parentFiles: null
      }
    );
    assert.equal(outcome.failure, null);
    assert.deepEqual(
      outcome.warnings.map(warning => warning.code),
      ['PLACEHOLDER_COPY', 'ICON_BUTTON_UNNAMED']
    );
    assert.equal(unescapeNative('Say \\"hi\\" for \\$9'), 'Say "hi" for $9');
  });
});
