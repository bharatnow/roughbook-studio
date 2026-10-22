// Detection: which stack a repo is on, from its marker files, before anything is written
// (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Detection"). The guess is shown to the designer, decides which
// recipe the setup run is offered, and gives the server its stack tokens (decision 15); the setup
// run's own reading of the repo wins. Every row is read, since a repo often matches more than one,
// and the more specific match names the stack: a server framework over the JavaScript tooling it
// builds its assets with, a JavaScript framework over the bundler it runs on. This is the one
// place in the studio, with the recipes, that names stacks.
import fs from 'node:fs';
import path from 'node:path';
import type { Family, PreviewMode } from '../environment/types.js';

export type Detected = {
  /** The most specific match, named for people, or null when no marker matched. */
  guess: string | null;
  /** Short tokens, most specific first: what the link records and the server sees. */
  stack: string[];
  /** The one token the link's framework column keeps: the most specific framework, or null. */
  framework: string | null;
  family: Family;
  mode: PreviewMode;
  /** The recipe that fits the guess, or null. */
  recipe: string | null;
  /** The package managers the lockfiles name, such as composer and npm. */
  packageManagers: string[];
  /** A container setup the repo runs in, or null. */
  container: string | null;
  /** The repo's own agent rule files, repo-relative, which the setup run respects. */
  ruleFiles: string[];
  /** Whether any marker at all was found: the folder looks like a project. */
  isProject: boolean;
  /** Folders no repo on this stack commits, for a snapshot taken before the environment exists. */
  ignore: string[];
};

type Match = {
  /** Lower is more specific. */
  priority: number;
  name: string;
  token: string;
  family: Family;
  mode: PreviewMode;
  recipe?: string;
};

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
};

function readJson(repo: string, file: string): Manifest | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

function readText(repo: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, file), 'utf8');
  } catch {
    return null;
  }
}

function exists(repo: string, file: string): boolean {
  return fs.existsSync(path.join(repo, file));
}

function entries(repo: string): string[] {
  try {
    return fs.readdirSync(repo);
  } catch {
    return [];
  }
}

/** The major version in a dependency's range, such as `^16.3.0` or `~> 8.0`; null when none. */
export function majorOf(range: string | undefined): string | null {
  if (!range) return null;
  const match = /(\d+)(?:\.\d+)*/.exec(range);
  return match ? match[1]! : null;
}

function withMajor(name: string, range: string | undefined): string {
  const major = majorOf(range);
  return major ? `${name}-${major}` : name;
}

/** The JavaScript frameworks and tools package.json may name, the most specific first. */
const JS_FRAMEWORKS: {
  dependency: string;
  token: string;
  name: string;
  family: Family;
  recipe?: string;
}[] = [
  { dependency: 'next', token: 'next', name: 'Next.js', family: 'react-like', recipe: 'next' },
  { dependency: 'nuxt', token: 'nuxt', name: 'Nuxt', family: 'markup-css', recipe: 'nuxt' },
  { dependency: '@sveltejs/kit', token: 'sveltekit', name: 'SvelteKit', family: 'markup-css' },
  { dependency: 'astro', token: 'astro', name: 'Astro', family: 'markup-css' },
  {
    dependency: '@react-router/dev',
    token: 'react-router',
    name: 'React Router',
    family: 'react-like'
  },
  { dependency: '@angular/core', token: 'angular', name: 'Angular', family: 'markup-css' },
  { dependency: 'expo', token: 'expo', name: 'Expo', family: 'react-like', recipe: 'expo' },
  {
    dependency: 'react-native',
    token: 'react-native',
    name: 'React Native',
    family: 'react-like'
  }
];

/** Tokens noted beside the guess: the language, the styling, the bundler. */
const JS_EXTRAS: { dependency: string; token: string }[] = [
  { dependency: 'react', token: 'react' },
  { dependency: 'vue', token: 'vue' },
  { dependency: 'svelte', token: 'svelte' },
  { dependency: 'tailwindcss', token: 'tailwind' },
  { dependency: 'typescript', token: 'typescript' }
];

/** The marker table, read in full over one repo. */
export function detectStack(repo: string): Detected {
  const matches: Match[] = [];
  const extras: string[] = [];
  const names = entries(repo);
  const pkg = readJson(repo, 'package.json');
  const composer = readJson(repo, 'composer.json');
  const deps = pkg ? { ...pkg.devDependencies, ...pkg.dependencies } : {};
  const phpDeps = composer ? { ...composer['require-dev'], ...composer.require } : {};

  // Server frameworks: the most specific, since they build their assets with the JavaScript tooling
  // package.json also names.
  if (typeof phpDeps['laravel/framework'] === 'string' || exists(repo, 'artisan')) {
    const token = withMajor('laravel', phpDeps['laravel/framework']);
    matches.push({
      priority: 10,
      name: `Laravel${token.includes('-') ? ` ${token.split('-')[1]}` : ''}`,
      token,
      family: 'markup-css',
      mode: 'live',
      recipe: 'laravel'
    });
    extras.push('blade');
  }
  const themeStyle = readText(repo, 'style.css');
  if (
    exists(repo, 'wp-content') ||
    exists(repo, 'wp-config.php') ||
    (themeStyle !== null && /^\s*\*?\s*Theme Name:/m.test(themeStyle))
  ) {
    const theme = !exists(repo, 'wp-content') && !exists(repo, 'wp-config.php');
    matches.push({
      priority: 10,
      name: theme ? 'WordPress theme' : 'WordPress',
      token: theme ? 'wordpress-theme' : 'wordpress',
      family: 'markup-css',
      mode: 'live',
      // The recipe runs a theme in wp-env; a whole site's repo is the setup run's to fit.
      ...(theme ? { recipe: 'wordpress' } : {})
    });
  }
  if (
    exists(repo, 'config/settings_schema.json') &&
    exists(repo, 'sections') &&
    exists(repo, 'templates')
  ) {
    matches.push({
      priority: 10,
      name: 'Shopify theme',
      token: 'shopify-theme',
      family: 'markup-css',
      mode: 'live',
      recipe: 'shopify'
    });
    extras.push('liquid');
  }
  const gemfile = readText(repo, 'Gemfile');
  if (gemfile && /^\s*gem\s+['"]rails['"]/m.test(gemfile)) {
    const range = /^\s*gem\s+['"]rails['"]\s*,\s*['"]([^'"]+)['"]/m.exec(gemfile)?.[1];
    const token = withMajor('rails', range);
    matches.push({
      priority: 10,
      name: `Rails${token.includes('-') ? ` ${token.split('-')[1]}` : ''}`,
      token,
      family: 'markup-css',
      mode: 'live'
    });
    extras.push('ruby');
  }
  const manage = readText(repo, 'manage.py');
  if (manage && /settings/.test(manage)) {
    matches.push({
      priority: 10,
      name: 'Django',
      token: 'django',
      family: 'markup-css',
      mode: 'live'
    });
    extras.push('python');
  }
  if (names.some(name => name.endsWith('.csproj'))) {
    matches.push({
      priority: 10,
      name: '.NET',
      token: 'dotnet',
      family: 'markup-css',
      mode: 'live'
    });
  }

  // Mobile and native: previews by snapshot, or live through a web target.
  const pubspec = readText(repo, 'pubspec.yaml');
  if (pubspec && /^\s*flutter\s*:/m.test(pubspec)) {
    matches.push({
      priority: 15,
      name: 'Flutter',
      token: 'flutter',
      family: 'flutter',
      mode: 'live',
      recipe: 'flutter'
    });
    extras.push('dart');
  }
  if (
    exists(repo, 'Package.swift') ||
    names.some(name => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'))
  ) {
    matches.push({
      priority: 15,
      name: 'iOS or macOS (Swift)',
      token: 'ios',
      family: 'swiftui',
      mode: 'snapshot',
      // The recipe is for a Swift package; an Xcode project is the setup run's to fit.
      ...(exists(repo, 'Package.swift') ? { recipe: 'swiftui' } : {})
    });
    extras.push('swift');
  }
  const gradle = readText(repo, 'build.gradle.kts') ?? readText(repo, 'build.gradle');
  const appGradle =
    readText(repo, 'app/build.gradle.kts') ?? readText(repo, 'app/build.gradle') ?? '';
  if (gradle !== null && /compose/i.test(`${gradle}\n${appGradle}`)) {
    matches.push({
      priority: 15,
      name: 'Android (Jetpack Compose)',
      token: 'android',
      family: 'compose',
      mode: 'snapshot',
      recipe: 'compose'
    });
    extras.push('kotlin');
  }

  // JavaScript frameworks, then the bundler they run on.
  for (const framework of JS_FRAMEWORKS) {
    if (typeof deps[framework.dependency] !== 'string') continue;
    const token = withMajor(framework.token, deps[framework.dependency]);
    const major = majorOf(deps[framework.dependency]);
    matches.push({
      priority: 20,
      name: `${framework.name}${major ? ` ${major}` : ''}`,
      token,
      family: framework.family,
      mode: 'live',
      recipe: framework.recipe
    });
  }
  if (typeof deps.vite === 'string') {
    const react = typeof deps.react === 'string';
    const vue = typeof deps.vue === 'string';
    const svelte = typeof deps.svelte === 'string';
    matches.push({
      priority: 30,
      name: `Vite${react ? ' with React' : vue ? ' with Vue' : svelte ? ' with Svelte' : ''}`,
      token: withMajor('vite', deps.vite),
      family: react ? 'react-like' : 'markup-css',
      mode: 'live',
      ...(react ? { recipe: 'vite' } : {})
    });
  } else if (typeof deps.react === 'string') {
    matches.push({
      priority: 32,
      name: 'React',
      token: withMajor('react', deps.react),
      family: 'react-like',
      mode: 'live'
    });
  } else if (typeof deps.vue === 'string') {
    matches.push({
      priority: 32,
      name: 'Vue',
      token: withMajor('vue', deps.vue),
      family: 'markup-css',
      mode: 'live'
    });
  }
  for (const extra of JS_EXTRAS) {
    if (typeof deps[extra.dependency] === 'string') {
      const token = withMajor(extra.token, deps[extra.dependency]);
      if (!matches.some(match => match.token === token)) extras.push(token);
    }
  }
  if (composer && typeof phpDeps.php === 'string') extras.push(withMajor('php', phpDeps.php));
  else if (composer) extras.push('php');

  // Languages and plain sites.
  if (exists(repo, 'go.mod')) {
    matches.push({ priority: 40, name: 'Go', token: 'go', family: 'markup-css', mode: 'live' });
  }
  if (exists(repo, 'Cargo.toml')) {
    matches.push({ priority: 40, name: 'Rust', token: 'rust', family: 'markup-css', mode: 'live' });
  }
  if (!matches.length && names.some(name => /\.html?$/.test(name))) {
    matches.push({
      priority: 50,
      name: 'a static site',
      token: 'static',
      family: 'markup-css',
      mode: 'standalone'
    });
  }

  matches.sort((a, b) => a.priority - b.priority);
  const primary = matches[0] ?? null;
  const stack = [...new Set([...matches.map(match => match.token), ...extras])];
  const ignore = ['.git', 'node_modules'];
  if (composer) ignore.push('vendor', 'storage/framework', 'public/build', 'public/hot');
  if (gemfile) ignore.push('vendor/bundle', 'tmp', 'log');
  if (pubspec) ignore.push('.dart_tool', 'build');
  if (gradle !== null) ignore.push('.gradle', 'build');
  if (names.some(name => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'))) {
    ignore.push('Pods', 'DerivedData');
  }
  if (pkg)
    ignore.push(
      'dist',
      '.next',
      '.nuxt',
      '.svelte-kit',
      '.astro',
      '.turbo',
      '.vercel',
      'out',
      'build'
    );
  if (manage) ignore.push('__pycache__', '.venv', 'venv', 'staticfiles');
  if (names.some(name => name.endsWith('.csproj'))) ignore.push('bin', 'obj');
  return {
    guess: primary?.name ?? null,
    stack,
    framework: primary?.token ?? null,
    family: primary?.family ?? 'unknown',
    mode: primary?.mode ?? 'standalone',
    recipe: primary?.recipe ?? null,
    packageManagers: packageManagers(repo),
    container: container(repo, phpDeps),
    ruleFiles: ruleFiles(repo),
    isProject: matches.length > 0 || pkg !== null || composer !== null,
    ignore: [...new Set(ignore)]
  };
}

/**
 * Whether a folder holds a project's manifest: what `init` looks for on its way up from where it
 * was run, so a folder of loose files (an HTML page in a temp folder) never reads as the app.
 */
export function hasProjectMarker(dir: string): boolean {
  if (
    [
      'package.json',
      'composer.json',
      'Gemfile',
      'pubspec.yaml',
      'manage.py',
      'Package.swift',
      'build.gradle',
      'build.gradle.kts',
      'go.mod',
      'Cargo.toml',
      'wp-config.php',
      'artisan'
    ].some(file => exists(dir, file))
  ) {
    return true;
  }
  return entries(dir).some(
    name => name.endsWith('.csproj') || name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace')
  );
}

/** The package managers the repo's lockfiles name. */
export function packageManagers(repo: string): string[] {
  const found: string[] = [];
  const has = (file: string) => exists(repo, file);
  if (has('pnpm-lock.yaml')) found.push('pnpm');
  else if (has('yarn.lock')) found.push('yarn');
  else if (has('bun.lock') || has('bun.lockb')) found.push('bun');
  else if (has('package-lock.json') || has('package.json')) found.push('npm');
  if (has('composer.json') || has('composer.lock')) found.push('composer');
  if (has('Gemfile') || has('Gemfile.lock')) found.push('bundler');
  if (has('poetry.lock')) found.push('poetry');
  else if (has('uv.lock')) found.push('uv');
  else if (has('Pipfile.lock') || has('Pipfile')) found.push('pipenv');
  else if (has('requirements.txt')) found.push('pip');
  if (has('pubspec.yaml')) found.push('pub');
  return found;
}

/** A container setup the app runs in: Laravel Sail, ddev or Docker Compose. */
export function container(repo: string, phpDeps: Record<string, string> = {}): string | null {
  if (typeof phpDeps['laravel/sail'] === 'string') return 'sail';
  if (exists(repo, '.ddev')) return 'ddev';
  if (
    ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].some(file =>
      exists(repo, file)
    )
  ) {
    return 'docker-compose';
  }
  return null;
}

/** The rule files agents already read in this repo, which the setup run respects and never overwrites. */
export function ruleFiles(repo: string): string[] {
  return [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursorrules',
    '.cursor/rules',
    '.windsurfrules',
    '.github/copilot-instructions.md'
  ].filter(file => exists(repo, file));
}

/**
 * The app's framework and major version from package.json, such as `next-16`: what the link
 * records, so ratings can be compared by setup. Null when none is recognized.
 */
export function detectFramework(repo: string): string | null {
  return detectStack(repo).framework;
}

/** The detection in a few lines for the designer, and for the setup run's prompt. */
export function describeDetection(detected: Detected): string[] {
  const lines: string[] = [];
  lines.push(
    detected.guess
      ? `Stack: ${detected.guess} (${detected.stack.join(', ')}); ${detected.family} checks, ${detected.mode} previews.`
      : 'Stack: nothing recognized from the marker files; the setup run decides, and the studio can fall back to standalone previews.'
  );
  if (detected.packageManagers.length) {
    lines.push(`Package manager: ${detected.packageManagers.join(', ')}.`);
  }
  if (detected.container) lines.push(`Container: ${detected.container}.`);
  if (detected.ruleFiles.length) {
    lines.push(`Agent rule files to respect: ${detected.ruleFiles.join(', ')}.`);
  }
  return lines;
}
