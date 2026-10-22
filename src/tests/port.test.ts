// F7 of the frameworks plan: web sketches into any stack. A sketch is React with Tailwind, made in
// the sandbox (decision 14). Pulling one copies its files only where they render as they are; on
// any other stack, or where the app lacks a package it imports, it is ported by a pull run whose
// agent rebuilds it from the sketch's files, kept beside the component as a reference. Promote
// writes any template or source file the environment's stack uses, with copy in its localized file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Promotion, SketchFile } from '../api/types.js';
import {
  CRAFT_PLACEHOLDER,
  ENVIRONMENT_LINE,
  PREVIEW_PLACEHOLDER,
  PRIMITIVES_PLACEHOLDER,
  defaultEnvironment,
  environmentFromHeader,
  fillEnvironment,
  parseEnvironmentHeader,
  previewSentence
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { expo } from '../recipes/expo/index.js';
import { flutter } from '../recipes/flutter/index.js';
import { next } from '../recipes/next/index.js';
import { listIterations } from '../repo/iterations.js';
import { syncMirror } from '../repo/mirror.js';
import { checkCopyFile, checkTargetFile, fillInPrompt, promoteWords } from '../runs/promote.js';
import { planPull, sketchReferenceDir, writeSketchReference } from '../runs/pull.js';
import { tempDir } from './helpers.js';

const SKETCH: SketchFile[] = [
  {
    path: 'index.tsx',
    encoding: 'utf8',
    content:
      'import { motion } from "motion/react";\nimport { ArrowRight } from "lucide-react";\nimport "./styles.css";\n\nexport default function Hero() {\n  return <motion.section className="min-h-[100dvh]"><ArrowRight /></motion.section>;\n}\n'
  },
  { path: 'styles.css', encoding: 'utf8', content: '.mark { color: red; }\n' },
  {
    path: 'parts/badge.png',
    encoding: 'base64',
    content: Buffer.from([137, 80, 78, 71]).toString('base64')
  }
];

const npm = (packages: string[]) => `npm install ${packages.join(' ')}`;
const deps = (...names: string[]) => new Set(names);
const header = (text: string): RepoEnvironment =>
  environmentFromHeader(parseEnvironmentHeader(text)!, null, 'linux');

/** A Vite app with React set up by its agent, no recipe, which says sketches render as they are. */
const VITE = `---
contract: 1
recipe: none
stack:
  - vite-8
  - react-19
family: react-like
entry: index.tsx
sources:
  - .tsx
  - .css
start: npm run dev @ http://localhost:5173
preview: /rough-preview.html?key={key}
gate: build
sketches: copy
---
`;

/** A Laravel app with Blade, no recipe: its iterations are views. */
const LARAVEL = `---
contract: 1
recipe: none
stack:
  - laravel-13
  - blade
family: markup-css
entry: index.blade.php
sources:
  - .blade.php
  - .css
start: php artisan serve @ http://127.0.0.1:8000
preview: /rough-preview/{key}
gate: runtime
promote: resources/views/components
promoteExtensions:
  - .blade.php
assets: public/images @ /images
copy: localized lang/en/sections.php
ignore:
  - vendor
  - node_modules
  - storage
---
`;

describe('pulling a web sketch into any stack', () => {
  it('copies where the recipe renders a sketch as it is and the app lists its packages', () => {
    const plan = planPull(
      next.environment(null),
      SKETCH,
      deps('next', 'react', 'motion', 'lucide-react', 'tailwindcss'),
      npm
    );
    assert.deepEqual(plan, { how: 'copy', why: [], missingPackages: [], add: null });
  });

  it('ports where the app lacks a package the sketch imports, and offers to add it', () => {
    const plan = planPull(
      next.environment(null),
      SKETCH,
      deps('next', 'react', 'lucide-react', 'tailwindcss'),
      npm
    );
    assert.equal(plan.how, 'port');
    assert.deepEqual(plan.missingPackages, ['motion']);
    assert.equal(plan.add, 'npm install motion');
    assert.match(plan.why[0]!, /imports motion, which this app does not list/);

    // The same in an agent-built Vite app that says a sketch renders there as it is (F7).
    const vite = header(VITE);
    assert.equal(vite.sketches, 'copy');
    const fresh = planPull(vite, SKETCH, deps('react', 'react-dom', 'tailwindcss'), npm);
    assert.equal(fresh.how, 'port');
    assert.deepEqual(fresh.missingPackages, ['motion', 'lucide-react']);
    assert.equal(fresh.add, 'npm install motion lucide-react');
  });

  it('ports where the app has no Tailwind, with nothing to add, since adding it is a setup', () => {
    const plan = planPull(next.environment(null), SKETCH, deps('motion', 'lucide-react'), npm);
    assert.equal(plan.how, 'port');
    assert.equal(plan.add, null);
    assert.match(plan.why.join(' '), /does not list tailwindcss/);
    const unread = planPull(next.environment(null), SKETCH, null, npm);
    assert.equal(unread.how, 'port');
    assert.match(unread.why[0]!, /package\.json cannot be read/);
  });

  it('ports on a stack whose recipe does not render a sketch, or whose iterations are not React', () => {
    for (const environment of [
      expo.environment(null),
      flutter.environment(null),
      header(LARAVEL)
    ]) {
      const plan = planPull(
        environment,
        SKETCH,
        deps('motion', 'lucide-react', 'tailwindcss'),
        npm
      );
      assert.equal(plan.how, 'port', environment.entry);
      assert.equal(plan.add, null, environment.entry);
      assert.match(plan.why[0]!, /does not render one as it is/);
    }
    // A setup that says sketches copy, but whose entry is not a sketch's, still ports.
    const views = header(LARAVEL.replace('gate: runtime', 'gate: runtime\nsketches: copy'));
    const plan = planPull(views, SKETCH, deps('motion', 'lucide-react', 'tailwindcss'), npm);
    assert.equal(plan.how, 'port');
    assert.match(plan.why[0]!, /An iteration here is index\.blade\.php, and the sketch has none/);
    // A repo no recipe set up ports unless its environment says otherwise.
    assert.equal(header(LARAVEL).sketches, 'port');
    assert.equal(defaultEnvironment().sketches, 'copy');
  });

  it('refuses a sketches field it cannot read, naming the field', () => {
    assert.throws(
      () => header(VITE.replace('sketches: copy', 'sketches: always')),
      /sketches is copy, where a web sketch renders as it is, or port/
    );
  });

  it("keeps a ported sketch's files beside the component, where no preview, registry or mirror reads them", async () => {
    const repo = await tempDir('roughbook-port-');
    const target = { page: 'home', component: 'hero', sketch: 'iteration-03' };
    assert.equal(
      sketchReferenceDir('home', 'hero', 'iteration-03'),
      'rough/home/hero/sketches/iteration-03'
    );
    assert.throws(() => sketchReferenceDir('home', 'hero', '../x'));
    const folder = writeSketchReference(repo, target, SKETCH);
    const at = (file: string) => path.join(repo, ...folder.split('/'), ...file.split('/'));
    assert.equal(fs.readFileSync(at('index.tsx'), 'utf8'), SKETCH[0]!.content);
    assert.deepEqual([...fs.readFileSync(at('parts/badge.png'))], [137, 80, 78, 71]);
    // Not an iteration: never listed, so never previewed or mirrored.
    fs.mkdirSync(path.join(repo, 'rough/home/hero/iteration-07'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'rough/home/hero/iteration-07/index.tsx'), 'x');
    assert.deepEqual(listIterations(repo, 'index.tsx'), ['home/hero/iteration-07']);
    const inTree = { ...flutter.environment(null), entry: 'index.tsx' };
    syncMirror(repo, inTree);
    assert.ok(fs.existsSync(path.join(repo, 'lib/rough/home/hero/iteration-07/index.tsx')));
    assert.ok(!fs.existsSync(path.join(repo, 'lib/rough/home/hero/sketches')));
    // Written again, only what differs is rewritten.
    const before = fs.statSync(at('styles.css')).mtimeMs;
    fs.writeFileSync(at('index.tsx'), 'changed by hand\n');
    writeSketchReference(repo, target, SKETCH);
    assert.equal(fs.readFileSync(at('index.tsx'), 'utf8'), SKETCH[0]!.content);
    assert.equal(fs.statSync(at('styles.css')).mtimeMs, before);
    assert.throws(
      () =>
        writeSketchReference(repo, target, [
          { path: '../evil.tsx', encoding: 'utf8', content: '' }
        ]),
      /will not write/
    );
  });
});

describe('the preview sentence of a local prompt', () => {
  it("keeps the live mode's words, and says what a snapshot or standalone preview is", () => {
    const live = previewSentence(next.environment(null));
    assert.equal(
      live,
      "This iteration renders inside the client's app, through a development-only\npreview route, with the app's own root layout and global styles."
    );
    const snapshot = previewSentence({ ...defaultEnvironment(), mode: 'snapshot' });
    assert.match(snapshot, /shown as images: the repo's snapshot command renders it/);
    assert.doesNotMatch(snapshot, /route/);
    const standalone = previewSentence({ ...defaultEnvironment(), mode: 'standalone' });
    assert.match(standalone, /the studio's own preview page/);
    assert.doesNotMatch(standalone, /route/);
    const prompt = `<implementation>\n${PREVIEW_PLACEHOLDER} Read the app\nfirst.\n</implementation>\n`;
    assert.equal(
      fillEnvironment(prompt, next.environment(null)),
      `<implementation>\n${live} Read the app\nfirst.\n</implementation>\n`
    );
    assert.equal(
      fillEnvironment(prompt, { ...defaultEnvironment(), mode: 'snapshot' }, { preview: '{{p}}' }),
      prompt,
      'a stand-in the backend names otherwise is left alone'
    );
  });
});

/** The floor's paragraph every recorded local prompt has (the backend's golden fixtures). */
const RECORDED_FLOOR = `Use native elements (button, a, input, label) and label every control. Keep headings in
order. Give every control hover, focus-visible, active and disabled styles, make every target at
least 24 px, and keep inputs at 16 px or more on phones. Set color-scheme with the colors.
Give every animation a reduced-motion path, animate only transform and opacity, and never use
transition: all.
Reserve the space of every image and video, never lazy-load the first image, and load only the
font weights you use.`;

/** Rules only a web page has, which no other stack's prompt may carry. */
const WEB_ONLY =
  /native elements|button, a, input, label|focus-visible|color-scheme|transition: all|16 px|24 px|lazy-load|shadcn|Radix|Base UI/;

describe("the craft a local prompt's rules ask for", () => {
  // As the backend writes them since local prompts go to any stack: the floor's paragraph and the
  // libraries after the app's own primitives, for the studio to fill by recipe or family.
  const rules = `<rules>\n${CRAFT_PLACEHOLDER}\n\nReuse the app's own components and primitives${PRIMITIVES_PLACEHOLDER}, and\ninstall nothing.\n</rules>\n`;
  const without = (family: RepoEnvironment['family'], mode: RepoEnvironment['mode'] = 'live') => ({
    ...defaultEnvironment(),
    recipe: null,
    family,
    mode
  });

  it('fills the recorded words for a React app on the web, byte for byte', () => {
    const recorded = `<rules>\n${RECORDED_FLOOR}\n\nReuse the app's own components and primitives, such as shadcn/ui, Radix or Base UI, and\ninstall nothing.\n</rules>\n`;
    // The fallback recipe's for a repo with no environment file, and an agent-built Vite app's.
    for (const environment of [defaultEnvironment(), next.environment(null), header(VITE)]) {
      assert.equal(fillEnvironment(rules, environment), recorded, environment.recipe ?? 'none');
    }
  });

  it("gives any other web page the web's floor, with no React library", () => {
    // A site on the studio's own page is a web page, whatever its stack.
    for (const environment of [header(LARAVEL), without('unknown', 'standalone')]) {
      assert.equal(
        fillEnvironment(rules, environment),
        `<rules>\n${RECORDED_FLOOR}\n\nReuse the app's own components and primitives, and\ninstall nothing.\n</rules>\n`,
        environment.family
      );
    }
  });

  it('tells a toolkit that draws its own controls nothing of the web, in its own terms', () => {
    const cases: [RepoEnvironment, RegExp[]][] = [
      [flutter.environment(null), [/Semantics\(header: true\)/, /48 by 48 logical pixels/]],
      [without('flutter'), [/Semantics\(header: true\)/, /tooltip/]],
      [without('compose'), [/semantics \{ heading\(\) \}/, /contentDescription/, /48 by 48 dp/]],
      [without('swiftui', 'snapshot'), [/\.isHeader/, /accessibilityLabel/, /44 by 44 points/]],
      // React Native on Expo is React-like, but has no DOM: its recipe says so.
      [expo.environment(null), [/Pressable/, /accessibilityRole="header"/, /never DOM/]],
      // A stack the studio does not know is told nothing of any one.
      [without('unknown'), [/the platform's own controls/]]
    ];
    for (const [environment, words] of cases) {
      const label = `${environment.recipe ?? 'none'} ${environment.family}`;
      const filled = fillEnvironment(rules, environment);
      assert.doesNotMatch(filled, WEB_ONLY, label);
      assert.doesNotMatch(filled, /\{\{roughbook:/, label);
      for (const word of words) assert.match(filled, word, label);
      assert.ok(
        filled.endsWith(
          "\n\nReuse the app's own components and primitives, and\ninstall nothing.\n</rules>\n"
        ),
        label
      );
      assert.match(filled, /reduced-motion path/, label);
    }
  });

  it('fills the stand-ins the backend names', () => {
    assert.equal(CRAFT_PLACEHOLDER, '{{roughbook:craft}}');
    assert.equal(PRIMITIVES_PLACEHOLDER, '{{roughbook:primitives}}');
    const filled = fillEnvironment('<c>\n\nprimitives<p>, and', without('compose'), {
      craft: '<c>',
      primitives: '<p>'
    });
    assert.doesNotMatch(filled, /<c>|<p>/);
    assert.match(filled, /primitives, and$/);
  });
});

describe('promote on any stack', () => {
  it("accepts a file of the environment's kinds inside the repo, outside rough/, the public folder and the ignored folders", () => {
    const laravel = header(LARAVEL);
    const check = (file: string) =>
      checkTargetFile(file, 'public/images', laravel.promote.extensions, laravel.ignore);
    assert.equal(check('resources/views/components/hero.blade.php'), null);
    assert.match(check('resources/views/components/Hero.tsx')!, /must be a \.blade\.php path/);
    assert.match(
      check('vendor/laravel/x/hero.blade.php')!,
      /vendor\/, which rough\/environment\.md ignores/
    );
    assert.match(check('storage/hero.blade.php')!, /storage\//);
    assert.match(check('rough/home/hero.blade.php')!, /rough\//);
    assert.match(check('public/images/hero.blade.php')!, /public folder/);
    assert.match(check('../hero.blade.php')!, /relative path/);
    // Flutter's in-tree mirror is the studio's copy of rough/, never the app's own code.
    const dart = flutter.environment(null);
    assert.equal(checkTargetFile('lib/widgets/hero.dart', 'assets', ['.dart'], dart.ignore), null);
    assert.match(
      checkTargetFile('lib/rough/hero.dart', 'assets', ['.dart'], dart.ignore)!,
      /lib\/rough\//
    );
  });

  it("lands approved copy in the repo's localized file, which must be the app's own", () => {
    const laravel = header(LARAVEL);
    assert.deepEqual(laravel.copy, { kind: 'localized', file: 'lang/en/sections.php' });
    assert.equal(checkCopyFile('lang/en/sections.php', laravel.ignore), null);
    assert.match(checkCopyFile('rough/copy.php')!, /never one in rough/);
    assert.match(checkCopyFile('vendor/lang.php', laravel.ignore)!, /vendor\//);
    const words = promoteWords(laravel, null, 'public/images', { hasEnvironmentFile: true });
    assert.match(
      words.keepCopy,
      /^The approved copy, word for word, in lang\/en\/sections\.php: add each string there/
    );
    assert.equal(words.except, ', except lang/en/sections.php, where the approved copy goes');
    assert.equal(words.environment, `${ENVIRONMENT_LINE}\n`);
    // A folder the app serves at /images: its assets are used from there (decision 29).
    assert.deepEqual(laravel.assets, { dir: 'public/images', url: '/images', copy: false });
    assert.equal(words.assetBase, '/images/');
    assert.equal(words.rules, '');
    assert.doesNotMatch(Object.values(words).join(' '), /use client|Tailwind|package\.json|\.tsx/);
  });

  it('uses bundled assets as the files they are, where the stack ships them with its code', () => {
    const dart = flutter.environment(null);
    assert.equal(dart.assets.url, null);
    const words = promoteWords(dart, flutter, 'assets', { hasEnvironmentFile: true });
    assert.equal(words.assetBase, 'assets/');
    assert.match(words.assetIntro, /the way this stack uses a file that ships with its code/);
    assert.match(words.rules, /pubspec\.yaml/);
    assert.equal(words.usage, 'its import line and constructor arguments');
    for (const [text, url] of [
      ['assets: assets @ bundled', null],
      ['assets: public', '/'],
      ['assets: web/static @ /static/', '/static']
    ] as const) {
      assert.equal(
        header(LARAVEL.replace('assets: public/images @ /images', text)).assets.url,
        url,
        text
      );
    }
    assert.throws(
      () => header(LARAVEL.replace('assets: public/images @ /images', 'assets: public @ images')),
      /assets is the folder promoted assets go to/
    );
  });

  it("fills the promote prompt's stand-ins, to Next.js's words byte for byte with no environment file", () => {
    const standIns = {
      environment: '{{roughbook:environment}}',
      read: '{{roughbook:promote-read}}',
      keepCopy: '{{roughbook:copy-keep}}',
      except: '{{roughbook:copy-except}}',
      assetIntro: '{{roughbook:asset-intro}}',
      assetBase: '{{roughbook:asset-base}}',
      rules: '{{roughbook:promote-rules}}',
      usage: '{{roughbook:usage}}'
    };
    const promotion = {
      prompt:
        '<first>\n{{roughbook:environment}}\nread: {{roughbook:promote-read}}, near {{roughbook:target-dir}}/\n</first>\n- {{roughbook:copy-keep}}\n{{roughbook:asset-intro}}\n- /api/files/project/site/a.png -> {{roughbook:asset-base}}rough/home/hero/a.png (already copied to {{roughbook:public-dir}}/rough/home/hero/a.png)\n- Do not edit any existing file{{roughbook:copy-except}}.\n{{roughbook:promote-rules}}\n- Do not commit.\nUse: {{roughbook:usage}}.\n',
      placeholders: {
        targetFile: '{{roughbook:target-file}}',
        targetDir: '{{roughbook:target-dir}}',
        publicDir: '{{roughbook:public-dir}}',
        ...standIns
      }
    } as Promotion;
    const words = promoteWords(next.environment(null), next, 'public', {
      hasEnvironmentFile: false
    });
    assert.equal(
      fillInPrompt(promotion, 'src/components/Hero.tsx', 'public', words),
      '<first>\nread: package.json, how styling is done\n(Tailwind config or CSS files), near src/components/\n</first>\n- The approved copy, word for word. Do not rewrite, shorten or add claims.\nReplace each studio URL in the reference with its public path in this repo:\n- /api/files/project/site/a.png -> /rough/home/hero/a.png (already copied to public/rough/home/hero/a.png)\n- Do not edit any existing file.\n- Add "use client" only if the component needs it.\n- Do not commit.\nUse: its import line and props.\n'
    );
    // A prompt from a server that left no such stand-ins reads as it came.
    const plain = { ...promotion, prompt: 'Write {{roughbook:target-file}}.\n' } as Promotion;
    assert.equal(fillInPrompt(plain, 'a/B.tsx', 'public', words), 'Write a/B.tsx.\n');
  });
});
