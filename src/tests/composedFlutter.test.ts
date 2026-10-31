// The composed preview on Flutter: the web target paints to a canvas, so the entry itself says what
// the shared live script says elsewhere, from measured widgets, and gives its sections the device's
// height in a MediaQuery. The Dart is run on a real app by hand; these hold its shape.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { flutter } from '../recipes/flutter/index.js';
import { previewEntry } from '../recipes/flutter/preview.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: 'lib'
};

const entry = previewEntry('harbor_app');

describe('the composed preview on Flutter', () => {
  it('composes, at the version that brings a repo forward, in the fragment', () => {
    assert.equal(flutter.composes, true);
    assert.equal(flutter.version, 2);
    const address = composedAddress(flutter.environment(LINK), 'home', [
      { component: 'hero', iteration: 'iteration-00' },
      { component: 'footer', iteration: 'iteration-01' }
    ]);
    assert.equal(
      address,
      '/#/rough-preview/home?roughbook-compose=hero:iteration-00,footer:iteration-01'
    );
  });

  it('reads the address from the fragment, and a variant from either side of it', () => {
    assert.match(entry, /uri\.fragment\.substring\(route\.length\)/);
    assert.match(entry, /\{\.\.\.uri\.queryParameters, \.\.\.Uri\.splitQueryString\(/);
    assert.match(entry, /final composed = query\['roughbook-compose'\];/);
  });

  it('stays behind the host check, and a missing section answers as a missing iteration does', () => {
    assert.ok(
      entry.indexOf('_compose(key, composed, query);') > entry.indexOf('hasMatch(uri.host)')
    );
    assert.match(entry, /final id = '\$page\/composition';/);
    assert.match(entry, /if \(build == null\) \{\n {6}refuse\('There is no iteration \$key/);
    assert.match(entry, /named\.length > 30/);
  });

  it('renders each section with its fixture inside the one wrapper', () => {
    assert.match(entry, /jsonDecode\(fixture\)/);
    assert.match(entry, /runApp\(_preview\(query, _Composed\(/);
    assert.equal(entry.match(/roughPreview\(/g)?.length, 1);
  });

  it('speaks the canvas’s words, and none once a section has failed', () => {
    assert.match(entry, /_say\('ready', id\)/);
    assert.match(entry, /_tell\('painted'\)/);
    assert.match(entry, /'roughbook': 'size', 'height': height, 'sections': sections/);
    assert.match(entry, /'component': section\.component, 'top':/);
    assert.match(entry, /_tell\('escape'\)/);
    assert.match(entry, /data\['roughbook'\] != 'viewport'/);
    assert.match(entry, /event\.source\.strictEquals\(_parent\)/);
    assert.match(entry, /if \(!_failed\) _say\('ready', id\);/);
    assert.match(entry, /if \(!_failed\) _tell\('painted'\);/);
    assert.match(entry, /if \(_failed \|\| root is! RenderBox/);
    // Pick, under the marker's key.
    assert.match(entry, /query\['roughbook-pick'\] == '1'/);
    assert.match(
      entry,
      /'roughbook': 'section', 'key': '\$\{widget\.page\}\/\$\{section\.component\}'/
    );
  });

  it('gives the sections the device’s height, not the frame’s', () => {
    assert.match(entry, /media\.copyWith\(size: Size\(media\.size\.width, _height \?\? /);
  });

  it('keeps the single iteration’s route as it was', () => {
    assert.match(entry, /final build = iterations\[key\];/);
    assert.match(entry, /_say\('ready', key\)/);
  });

  it('writes no file besides the entry and the snapshot test, and plans the entry forward', async () => {
    const repo = await tempDir('roughbook-composed-flutter-');
    fs.writeFileSync(path.join(repo, 'pubspec.yaml'), 'name: harbor_app\n');
    assert.deepEqual(flutter.setupFiles(repo, LINK), [
      'lib/rough_preview.dart',
      'test/rough_snapshot_test.dart'
    ]);
    fs.mkdirSync(path.join(repo, 'lib'));
    fs.writeFileSync(
      path.join(repo, 'lib', 'rough_preview.dart'),
      '// Written by Roughbook (the Flutter recipe). The route as it was.\n'
    );
    const change = flutter
      .planPreview(repo, LINK)
      .changes.find(item => item.file === 'lib/rough_preview.dart');
    assert.equal(change?.action, 'edit');
    assert.equal(change?.after, entry);
  });
});
