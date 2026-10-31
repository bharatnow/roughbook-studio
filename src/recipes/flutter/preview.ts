// Flutter: lib/ compiles only what is imported, and nothing from rough/, so iterations are placed in
// the source tree (decision 25): the studio mirrors rough/ into lib/rough/ (gitignored), and this
// recipe writes, beside the mirror's iterations, the registry that imports each and the wrapper
// copied from rough/preview.dart. Two entry points use them, both outside the app's own:
//
//   lib/rough_preview.dart          the web target's preview (flutter run -t), development only
//   test/rough_snapshot_test.dart   the snapshot command: renders keys to PNGs on this machine
//
// The app's own lib/main.dart never imports lib/rough/, so `flutter build web` holds nothing of it:
// the build gate. Neither file is committed; both are the recipe's, rewritten by setup --upgrade.
//
// Flutter web paints to a canvas, so the shared live script (../live.ts) sees nothing of the page and
// no CSS window height exists. The composed route says the same words itself from measured widgets,
// and sections read the device's height from the MediaQuery it gives them.
import fs from 'node:fs';
import path from 'node:path';
import { listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';
import { COMPOSE_PARAM, PICK_PARAM } from '../context.js';

export const MIRROR = 'lib/rough';
export const ENTRY = 'iteration.dart';
export const FIXTURE = 'preview.json';
export const WRAPPER = 'preview.dart';
export const REGISTRY = 'registry.dart';
export const PREVIEW_ENTRY = 'lib/rough_preview.dart';
export const SNAPSHOT_TEST = 'test/rough_snapshot_test.dart';
const MARKER = 'Written by Roughbook (the Flutter recipe)';

/** The app's package name, from pubspec.yaml, which package imports start with. */
export function packageName(repo: string): string {
  try {
    const pubspec = fs.readFileSync(path.join(repo, 'pubspec.yaml'), 'utf8');
    return /^name:\s*([a-z_][a-z0-9_]*)\s*$/m.exec(pubspec)?.[1] ?? 'app';
  } catch {
    return 'app';
  }
}

/** A text as a Dart string literal: JSON's escapes are Dart's, and `$` is escaped too. */
export function dartString(text: string): string {
  return JSON.stringify(text).replace(/\$/g, '\\$');
}

/** The registry: each iteration's build function and its fixture's text, by key. */
export function renderRegistry(keys: string[], fixtures: Record<string, string>): string {
  const imports = keys.map((key, index) => `import ${dartString(`${key}/${ENTRY}`)} as i${index};`);
  return `// ${MARKER} from the iterations in ${ROUGH_DIR}/. Do not edit; it is never committed.
import 'package:flutter/widgets.dart';

${imports.join('\n')}${imports.length ? '\n' : ''}
export ${dartString(WRAPPER)};

/** Each iteration's build function, by key. */
final Map<String, Widget Function(Map<String, dynamic> fixture)> iterations = {
${keys.map((key, index) => `  ${dartString(key)}: i${index}.buildIteration,\n`).join('')}};

/** Each iteration's ${FIXTURE}, as text, where it has one: its inputs for the preview. */
const Map<String, String> fixtures = {
${Object.entries(fixtures)
  .map(([key, text]) => `  ${dartString(key)}: ${dartString(text)},\n`)
  .join('')}};
`;
}

export const PREVIEW_WRAPPER = `// Wraps every iteration previewed in this app, on the web target and in its snapshots. Make it
// your app's own: its theme and dark theme, its localizations, its providers. Roughbook copies
// this file into ${MIRROR}/ beside the iterations.
import 'package:flutter/material.dart';

Widget roughPreview({
  required Widget child,
  required Brightness brightness,
  required TextDirection direction,
  Locale? locale,
  double textScale = 1,
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(useMaterial3: true, brightness: Brightness.light),
    darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
    themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
    locale: locale,
    builder: (context, app) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
      child: Directionality(textDirection: direction, child: app!),
    ),
    home: Scaffold(body: child),
  );
}
`;

/** The web target's preview: one key from the address, its variant, and the ready or error word. */
export function previewEntry(pkg: string): string {
  return `// ${MARKER}. Development only, not committed (see .gitignore).
// The web target's preview of one iteration from ${ROUGH_DIR}/ (mirrored in ${MIRROR}/), at
// /#/rough-preview/<page>/<component>/<iteration>, run as flutter run -d web-server -t ${PREVIEW_ENTRY}.
// The app's own lib/main.dart never imports ${MIRROR}/, so its production build holds none of it.
import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/semantics.dart';
import 'package:${pkg}/rough/registry.dart';

@JS('window.parent.postMessage')
external void _post(JSAny message, JSString origin);

@JS('window.parent')
external JSAny? get _parent;

@JS('window.self')
external JSAny? get _self;

@JS('window.addEventListener')
external void _listen(JSString type, JSFunction handler, JSBoolean capture);

@JS('window.location.reload')
external void _reload();

extension type _Message(JSObject _) implements JSObject {
  external JSAny? get source;
  external JSAny? get data;
  external void stopImmediatePropagation();
}

extension type _Key(JSObject _) implements JSObject {
  external String? get key;
}

void _say(String word, String key, [String? message]) {
  _post(<String, Object?>{'roughbook': word, 'id': key, if (message != null) 'message': message}.jsify()!, '*'.toJS);
}

/// Whether a section failed, so the page stops saying it is ready, painted or any size.
var _failed = false;

void main() {
  final uri = Uri.base;
  final route = uri.fragment.split('?').first;
  final key = route.replaceFirst(RegExp(r'^/?rough-preview/'), '');
  // The route sits in the fragment, so what follows it does too; a variant comes before the #.
  final query = {...uri.queryParameters, ...Uri.splitQueryString(uri.fragment.substring(route.length).replaceFirst('?', ''))};
  final composed = query['${COMPOSE_PARAM}'];
  // Answers this machine only (the preview contract, point 5).
  if (!RegExp(r'^(localhost|127\\.0\\.0\\.1|\\[::1\\])$').hasMatch(uri.host)) {
    _say('error', composed == null ? key : '$key/composition', 'The preview answers this machine only.');
    return;
  }
  if (composed != null) {
    _compose(key, composed, query);
    return;
  }
  final build = iterations[key];
  if (build == null) {
    _say('error', key, 'There is no iteration $key in this repo.');
    runApp(Directionality(textDirection: TextDirection.ltr, child: Text('There is no iteration $key in this repo.')));
    return;
  }
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    _say('error', key, details.exceptionAsString());
  };
  // The text in the page, for the studio's doctor and for screen readers.
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  final fixture = fixtures[key] == null ? <String, dynamic>{} : jsonDecode(fixtures[key]!) as Map<String, dynamic>;
  runApp(_preview(query, _Built(make: () => build(fixture))));
  WidgetsBinding.instance.addPostFrameCallback((_) => _say('ready', key));
}

/// The variant the studio asks for in the address, on the app's own wrapper.
Widget _preview(Map<String, String> query, Widget child) {
  return roughPreview(
    brightness: query['roughbook-scheme'] == 'dark' ? Brightness.dark : Brightness.light,
    direction: query['roughbook-dir'] == 'rtl' ? TextDirection.rtl : TextDirection.ltr,
    locale: query['roughbook-lang'] == null ? null : Locale.fromSubtags(languageCode: query['roughbook-lang']!.split('-').first),
    textScale: query['roughbook-text'] == 'large' ? 1.3 : 1,
    child: child,
  );
}

/// A page's composition: each section's iteration and fixture, in order; a section the registry
/// lacks answers as a missing iteration.
void _compose(String page, String composed, Map<String, String> query) {
  final id = '$page/composition';
  void refuse(String message) {
    _say('error', id, message);
    runApp(Directionality(textDirection: TextDirection.ltr, child: Text(message)));
  }

  final named = composed.split(',').where((section) => section.isNotEmpty).toList();
  if (!RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$').hasMatch(page) || named.isEmpty || named.length > 30) {
    refuse('There is no composition at $page in this repo.');
    return;
  }
  final sections = <_Section>[];
  for (final section in named) {
    final parts = section.split(':');
    final component = parts.first;
    final key = '$page/$component/\${parts.length > 1 ? parts[1] : ''}';
    final build = iterations[key];
    if (build == null) {
      refuse('There is no iteration $key in this repo.');
      return;
    }
    final fixture = fixtures[key];
    sections.add(_Section(component, _Built(make: () => build(fixture == null ? <String, dynamic>{} : jsonDecode(fixture) as Map<String, dynamic>))));
  }
  FlutterError.onError = (details) {
    // The route is in the address and the wrapper's app has only its home: not the page's fault.
    if (details.exception.toString().startsWith('Could not navigate to initial route')) return;
    _failed = true;
    FlutterError.presentError(details);
    _say('error', id, details.exceptionAsString());
  };
  // The text in the page, for the studio's doctor and for screen readers.
  WidgetsFlutterBinding.ensureInitialized();
  SemanticsBinding.instance.ensureSemantics();
  runApp(_preview(query, _Composed(page: page, sections: sections, pick: query['${PICK_PARAM}'] == '1')));
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!_failed) _say('ready', id);
  });
}

class _Section {
  _Section(this.component, this.child);
  final String component;
  final Widget child;
  final GlobalKey key = GlobalKey();
}

/// The sections, one under another, and what a canvas needs of them. It runs the page in a frame as
/// tall as the page, so the page says how tall it is and where each section starts, and the sections
/// read the device's height from their MediaQuery, not the frame's. A browser holds back rendering
/// in a frame it is not drawing, so these go by the clock as well. Outside a frame it does nothing.
class _Composed extends StatefulWidget {
  const _Composed({required this.page, required this.sections, required this.pick});
  final String page;
  final List<_Section> sections;
  final bool pick;
  @override
  State<_Composed> createState() => _ComposedState();
}

class _ComposedState extends State<_Composed> {
  final _root = GlobalKey();
  final _framed = !_parent.strictEquals(_self).toDart;
  double? _height;
  String _said = '';
  Timer? _waiting;

  @override
  void initState() {
    super.initState();
    if (!_framed) return;
    _listen('message'.toJS, _hear.toJS, false.toJS);
    // On the way down, before the engine's own key handling sees it.
    _listen('keydown'.toJS, _escape.toJS, true.toJS);
    // The route is in the fragment, so a new address in the frame loads nothing and the wrapper's app
    // would be asked for a route it does not have. It is a new page, so load it.
    _listen('popstate'.toJS, _moved.toJS, true.toJS);
    SchedulerBinding.instance.addPersistentFrameCallback((_) => _later());
    for (final wait in const [300, 1000, 2500, 5000]) {
      Timer(Duration(milliseconds: wait), _measure);
    }
    Timer(const Duration(milliseconds: 300), () {
      if (!_failed) _tell('painted');
    });
  }

  void _tell(String word) => _post(<String, Object?>{'roughbook': word}.jsify()!, '*'.toJS);

  void _hear(_Message event) {
    if (!event.source.strictEquals(_parent).toDart) return;
    final data = event.data.dartify();
    if (data is! Map || data['roughbook'] != 'viewport') return;
    final height = data['height'];
    if (height is! num || height <= 0) return;
    setState(() => _height = height.toDouble());
    // A frame the browser is not drawing gets no animation frames, so this one goes by the clock.
    SchedulerBinding.instance.scheduleWarmUpFrame();
    SchedulerBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _escape(_Key event) {
    if (event.key == 'Escape') _tell('escape');
  }

  void _moved(_Message event) {
    event.stopImmediatePropagation();
    _reload();
  }

  void _later() {
    _waiting?.cancel();
    _waiting = Timer(const Duration(milliseconds: 100), () => _measure(changed: true));
  }

  void _measure({bool changed = false}) {
    final root = _root.currentContext?.findRenderObject();
    if (_failed || root is! RenderBox || !root.hasSize) return;
    final height = root.localToGlobal(Offset(0, root.size.height)).dy.ceil();
    final sections = <Map<String, Object?>>[
      for (final section in widget.sections)
        if (section.key.currentContext?.findRenderObject() case final RenderBox box when box.hasSize)
          {'component': section.component, 'top': box.localToGlobal(Offset.zero).dy.round()},
    ];
    final message = <String, Object?>{'roughbook': 'size', 'height': height, 'sections': sections};
    final text = jsonEncode(message);
    if (changed && text == _said) return;
    _said = text;
    _post(message.jsify()!, '*'.toJS);
  }

  void _picked(_Section section) {
    _post(<String, Object?>{'roughbook': 'section', 'key': '\${widget.page}/\${section.component}'}.jsify()!, '*'.toJS);
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    // The frame's first height is the device's until the canvas says, and the frame then grows to the page.
    if (_height == null && media.size.height > 0) _height = media.size.height;
    return MediaQuery(
      data: media.copyWith(size: Size(media.size.width, _height ?? media.size.height)),
      child: SingleChildScrollView(
        // The frame is as tall as the page, so a wheel over it belongs to the canvas.
        physics: _framed ? const NeverScrollableScrollPhysics() : null,
        child: Column(
          key: _root,
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final section in widget.sections)
              KeyedSubtree(
                key: section.key,
                child: widget.pick
                    ? GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => _picked(section),
                        child: AbsorbPointer(child: section.child),
                      )
                    : section.child,
              ),
          ],
        ),
      ),
    );
  }
}

class _Built extends StatelessWidget {
  const _Built({required this.make});
  final Widget Function() make;
  @override
  Widget build(BuildContext context) => make();
}
`;
}

/** The snapshot command's test: each key in ROUGHBOOK_KEYS at every shot, as a PNG in ROUGHBOOK_OUT. */
export function snapshotTest(pkg: string): string {
  return `// ${MARKER}. Not committed (see .gitignore).
// The snapshot command (rough/CONTRACT.md, the snapshot contract): flutter test ${SNAPSHOT_TEST}
// renders each key in ROUGHBOOK_KEYS at every shot in ROUGHBOOK_SHOTS with Flutter's own engine on
// this machine, writes <ROUGHBOOK_OUT>/<key>/<shot>.png, and says what came of each in result.txt.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:${pkg}/rough/registry.dart';

class _Shot {
  _Shot(this.name, this.width, this.height, this.variant);
  final String name;
  final double width;
  final double height;
  final String variant;
}

List<_Shot> _shots() {
  final text = Platform.environment['ROUGHBOOK_SHOTS'] ?? 'phone:390x844:light';
  return text.split(',').where((item) => item.isNotEmpty).map((item) {
    final parts = item.split(':');
    final size = parts[1].split('x');
    return _Shot(parts[0], double.parse(size[0]), double.parse(size[1]), parts.length > 2 ? parts[2] : '');
  }).toList();
}

/** The app's fonts and Material's, so text renders as it does in the app rather than as boxes. */
Future<void> _loadFonts() async {
  try {
    final manifest = jsonDecode(await rootBundle.loadString('FontManifest.json')) as List<dynamic>;
    for (final entry in manifest.cast<Map<String, dynamic>>()) {
      final loader = FontLoader(entry['family'] as String);
      for (final font in (entry['fonts'] as List<dynamic>).cast<Map<String, dynamic>>()) {
        loader.addFont(rootBundle.load(font['asset'] as String));
      }
      await loader.load();
    }
  } catch (_) {
    // An app with no fonts of its own.
  }
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) return;
  final dir = Directory('$root/bin/cache/artifacts/material_fonts');
  if (!dir.existsSync()) return;
  final roboto = FontLoader('Roboto');
  for (final file in dir.listSync().whereType<File>().where((file) => file.path.contains('Roboto'))) {
    roboto.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
  }
  await roboto.load();
}

void main() {
  final keys = (Platform.environment['ROUGHBOOK_KEYS'] ?? '').split(',').where((key) => key.isNotEmpty).toList();
  final out = Platform.environment['ROUGHBOOK_OUT'] ?? 'rough/.screenshots';
  final shots = _shots();
  setUpAll(_loadFonts);
  for (final key in keys) {
    testWidgets('roughbook $key', (tester) async {
      final result = File('$out/$key/result.txt')..createSync(recursive: true);
      final build = iterations[key];
      if (build == null) {
        result.writeAsStringSync('missing');
        return;
      }
      final fixture = fixtures[key] == null ? <String, dynamic>{} : jsonDecode(fixtures[key]!) as Map<String, dynamic>;
      try {
        for (final shot in shots) {
          tester.view.devicePixelRatio = 3;
          tester.view.physicalSize = Size(shot.width * 3, shot.height * 3);
          final boundary = GlobalKey();
          await tester.pumpWidget(RepaintBoundary(
            key: boundary,
            child: roughPreview(
              brightness: shot.variant == 'dark' ? Brightness.dark : Brightness.light,
              direction: const {'ar', 'he', 'fa', 'ur'}.contains(shot.variant.split('-').first) ? TextDirection.rtl : TextDirection.ltr,
              textScale: shot.variant == 'large-text' ? 1.3 : 1,
              child: Builder(builder: (_) => build(fixture)),
            ),
          ));
          await tester.pumpAndSettle();
          final error = tester.takeException();
          if (error != null) throw error;
          final render = boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
          final bytes = await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 3);
            return image.toByteData(format: ui.ImageByteFormat.png);
          });
          File('$out/$key/\${shot.name}.png')
            ..createSync(recursive: true)
            ..writeAsBytesSync(bytes!.buffer.asUint8List());
        }
        result.writeAsStringSync('ready');
      } catch (error) {
        result.writeAsStringSync('error: $error');
        rethrow;
      } finally {
        tester.view.reset();
      }
    });
  }
}
`;
}

/** The registry as the iterations in the repo are now. */
export function currentRegistry(repo: string): string {
  const keys = listIterations(repo, ENTRY);
  const fixtures: Record<string, string> = {};
  for (const key of keys) {
    const file = path.join(repo, ROUGH_DIR, ...key.split('/'), FIXTURE);
    if (fs.existsSync(file)) fixtures[key] = fs.readFileSync(file, 'utf8');
  }
  return renderRegistry(keys, fixtures);
}

function writeIfChanged(file: string, content: string): boolean {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

/**
 * Brings the mirror's own files up to date, after the studio mirrored the iterations: the
 * registry, and the wrapper copied from rough/preview.dart (the recipe's default when the repo has
 * none yet).
 */
export function syncFlutterPreview(repo: string): void {
  const mirror = path.join(repo, ...MIRROR.split('/'));
  if (!fs.existsSync(mirror)) return;
  const wrapper = path.join(repo, ROUGH_DIR, WRAPPER);
  writeIfChanged(
    path.join(mirror, WRAPPER),
    fs.existsSync(wrapper) ? fs.readFileSync(wrapper, 'utf8') : PREVIEW_WRAPPER
  );
  writeIfChanged(path.join(mirror, REGISTRY), currentRegistry(repo));
}

export function isOurFlutterFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
