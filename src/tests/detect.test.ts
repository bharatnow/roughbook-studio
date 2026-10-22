import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { describeDetection, detectStack, majorOf } from '../recipes/detect.js';
import { tempDir } from './helpers.js';

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await tempDir('roughbook-detect-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: deps, devDependencies: dev });

describe('detection', () => {
  it('reads every row of the marker table, one fixture per row', async () => {
    const rows: [
      Record<string, string>,
      { guess: string; token: string; family: string; mode: string }
    ][] = [
      [
        { 'package.json': pkg({ next: '^16.3.0', react: '^19.2.0' }) },
        { guess: 'Next.js 16', token: 'next-16', family: 'react-like', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ nuxt: '^4.1.0', vue: '^3.5.0' }) },
        { guess: 'Nuxt 4', token: 'nuxt-4', family: 'markup-css', mode: 'live' }
      ],
      [
        {
          'package.json': pkg({}, { '@sveltejs/kit': '^2.0.0', svelte: '^5.0.0', vite: '^7.0.0' })
        },
        { guess: 'SvelteKit 2', token: 'sveltekit-2', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ astro: '^5.0.0' }) },
        { guess: 'Astro 5', token: 'astro-5', family: 'markup-css', mode: 'live' }
      ],
      [
        {
          'package.json': pkg(
            { react: '^19.0.0' },
            { '@react-router/dev': '^7.0.0', vite: '^7.0.0' }
          )
        },
        { guess: 'React Router 7', token: 'react-router-7', family: 'react-like', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ '@angular/core': '^20.0.0' }) },
        { guess: 'Angular 20', token: 'angular-20', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ expo: '~54.0.0', 'react-native': '0.81.0', react: '19.1.0' }) },
        { guess: 'Expo 54', token: 'expo-54', family: 'react-like', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ 'react-native': '0.81.0', react: '19.1.0' }) },
        { guess: 'React Native 0', token: 'react-native-0', family: 'react-like', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ react: '^19.2.0' }, { vite: '^8.0.0' }) },
        { guess: 'Vite with React', token: 'vite-8', family: 'react-like', mode: 'live' }
      ],
      [
        { 'package.json': pkg({ vue: '^3.5.0' }, { vite: '^7.0.0' }) },
        { guess: 'Vite with Vue', token: 'vite-7', family: 'markup-css', mode: 'live' }
      ],
      [
        {
          'composer.json': JSON.stringify({
            require: { php: '^8.2', 'laravel/framework': '^13.0' }
          }),
          artisan: '#!/usr/bin/env php'
        },
        { guess: 'Laravel 13', token: 'laravel-13', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'wp-config.php': '<?php' },
        { guess: 'WordPress', token: 'wordpress', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'style.css': '/*\nTheme Name: Acme\n*/' },
        { guess: 'WordPress theme', token: 'wordpress-theme', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'config/settings_schema.json': '[]', 'sections/.keep': '', 'templates/.keep': '' },
        { guess: 'Shopify theme', token: 'shopify-theme', family: 'markup-css', mode: 'live' }
      ],
      [
        { Gemfile: "source 'https://rubygems.org'\ngem 'rails', '~> 8.0'\n" },
        { guess: 'Rails 8', token: 'rails-8', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'manage.py': "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'site.settings')" },
        { guess: 'Django', token: 'django', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n' },
        { guess: 'Flutter', token: 'flutter', family: 'flutter', mode: 'live' }
      ],
      [
        { 'App.xcodeproj/project.pbxproj': '' },
        { guess: 'iOS or macOS (Swift)', token: 'ios', family: 'swiftui', mode: 'snapshot' }
      ],
      [
        { 'Package.swift': '// swift-tools-version:5.9' },
        { guess: 'iOS or macOS (Swift)', token: 'ios', family: 'swiftui', mode: 'snapshot' }
      ],
      [
        {
          'build.gradle.kts': 'plugins { id("com.android.application") }',
          'app/build.gradle.kts': 'android { buildFeatures { compose = true } }'
        },
        {
          guess: 'Android (Jetpack Compose)',
          token: 'android',
          family: 'compose',
          mode: 'snapshot'
        }
      ],
      [
        { 'Web.csproj': '<Project />' },
        { guess: '.NET', token: 'dotnet', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'go.mod': 'module site' },
        { guess: 'Go', token: 'go', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'Cargo.toml': '[package]' },
        { guess: 'Rust', token: 'rust', family: 'markup-css', mode: 'live' }
      ],
      [
        { 'index.html': '<h1>Hi</h1>' },
        { guess: 'a static site', token: 'static', family: 'markup-css', mode: 'standalone' }
      ]
    ];
    for (const [files, expected] of rows) {
      const detected = detectStack(await repoWith(files));
      assert.equal(detected.guess, expected.guess, JSON.stringify(files));
      assert.equal(detected.framework, expected.token, expected.guess);
      assert.equal(detected.stack[0], expected.token, expected.guess);
      assert.equal(detected.family, expected.family, expected.guess);
      assert.equal(detected.mode, expected.mode, expected.guess);
      assert.ok(detected.isProject, expected.guess);
    }
  });

  it('names nothing for a folder with no marker, and the setup run decides', async () => {
    const detected = detectStack(await repoWith({ 'notes.txt': 'hello' }));
    assert.deepEqual(
      [
        detected.guess,
        detected.framework,
        detected.stack,
        detected.family,
        detected.mode,
        detected.recipe
      ],
      [null, null, [], 'unknown', 'standalone', null]
    );
    assert.equal(detected.isProject, false);
    assert.match(describeDetection(detected)[0]!, /nothing recognized/);
  });

  it('lets the more specific match win: a server framework over its JavaScript tooling, a framework over its bundler', async () => {
    const laravel = detectStack(
      await repoWith({
        'composer.json': JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^13.0' } }),
        artisan: '',
        'package.json': pkg(
          {},
          { vite: '^7.0.0', tailwindcss: '^4.0.0', 'laravel-vite-plugin': '^2.0.0' }
        )
      })
    );
    assert.equal(laravel.guess, 'Laravel 13');
    assert.deepEqual(laravel.stack, ['laravel-13', 'vite-7', 'blade', 'tailwind-4', 'php-8']);
    assert.equal(laravel.family, 'markup-css');
    // Laravel has a recipe since F8, which the more specific match brings.
    assert.equal(laravel.recipe, 'laravel');

    const next = detectStack(
      await repoWith({
        'package.json': pkg(
          { next: '16.4.2', react: '19.2.0' },
          { vite: '^7.0.0', typescript: '^5' }
        )
      })
    );
    assert.equal(next.guess, 'Next.js 16');
    assert.deepEqual(next.stack, ['next-16', 'vite-7', 'react-19', 'typescript-5']);
    assert.equal(next.recipe, 'next');
  });

  it('notes the package manager, the container and the rule files', async () => {
    const repo = await repoWith({
      'composer.json': JSON.stringify({
        require: { 'laravel/framework': '^13.0' },
        'require-dev': { 'laravel/sail': '^1.0' }
      }),
      'package.json': '{}',
      'pnpm-lock.yaml': '',
      'compose.yaml': 'services: {}',
      'AGENTS.md': '# Rules',
      '.cursor/rules/style.mdc': '',
      '.github/copilot-instructions.md': ''
    });
    const detected = detectStack(repo);
    assert.deepEqual(detected.packageManagers, ['pnpm', 'composer']);
    assert.equal(detected.container, 'sail');
    assert.deepEqual(detected.ruleFiles, [
      'AGENTS.md',
      '.cursor/rules',
      '.github/copilot-instructions.md'
    ]);
    assert.ok(detected.ignore.includes('vendor') && detected.ignore.includes('node_modules'));
    const lines = describeDetection(detected);
    assert.match(lines.join('\n'), /Package manager: pnpm, composer/);
    assert.match(lines.join('\n'), /Container: sail/);
    assert.match(lines.join('\n'), /rule files to respect: AGENTS\.md/);

    const ddev = detectStack(
      await repoWith({ '.ddev/config.yaml': '', 'yarn.lock': '', 'package.json': '{}' })
    );
    assert.equal(ddev.container, 'ddev');
    assert.deepEqual(ddev.packageManagers, ['yarn']);
    const compose = detectStack(
      await repoWith({ 'docker-compose.yml': '', Gemfile: "gem 'rails'" })
    );
    assert.equal(compose.container, 'docker-compose');
    assert.deepEqual(compose.packageManagers, ['bundler']);
  });

  it('reads a major version out of any range, or none', () => {
    assert.equal(majorOf('^16.3.0'), '16');
    assert.equal(majorOf('~> 8.0'), '8');
    assert.equal(majorOf('>=3.1 <4'), '3');
    assert.equal(majorOf('latest'), null);
    assert.equal(majorOf(undefined), null);
  });
});
