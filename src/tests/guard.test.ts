// The core names no stack (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 7 and "The guard"): only
// src/recipes/ may. Each exception is listed in src/recipes/guard-allow.json with its reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RECIPES } from '../recipes/index.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowFile = path.join(src, 'recipes', 'guard-allow.json');

type Rule = { name: string; pattern: RegExp };

/** A stack named as code: an import, a folder, a config, a directive, or its product's name. */
const STACK_RULES: Rule[] = [
  { name: 'next as an import or dependency', pattern: /['"`]next(?:\/[^'"`]*)?['"`]/ },
  { name: 'the .next folder', pattern: /(?<![\w.])\.next\b/ },
  { name: 'next.config', pattern: /\bnext\.config\b/ },
  { name: 'next-env.d.ts', pattern: /\bnext-env\.d\.ts\b/ },
  { name: 'Next.js by name', pattern: /\bNext\.js\b|\bnextjs\b/i },
  { name: 'the App Router', pattern: /\bApp Router\b/ },
  { name: 'create-next-app', pattern: /\bcreate-next-app\b/ },
  { name: 'cacheComponents', pattern: /\bcacheComponents\b/ },
  { name: 'Turbopack by name', pattern: /\bturbopack\b/i },
  { name: 'the "use client" directive', pattern: /use client/ },
  {
    name: 'another stack by name',
    pattern:
      /\b(?:vite|expo|astro|nuxt|sveltekit|svelte|remix|react-router|laravel|flutter|swiftui|compose|django|rails|shopify|wordpress|angular)\b/i
  },
  { name: 'the entry file by name', pattern: /\bindex\.tsx\b/ }
];

/** An extension list belongs to a check family or a recipe, never to the core. */
const EXTENSIONS_RULE: Rule = {
  name: 'extensions',
  pattern: /[(|]\s*(?:tsx|jsx|css)\s*[|)]/
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'recipes' || entry.name === 'tests' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('the guard', () => {
  const allowed = JSON.parse(fs.readFileSync(allowFile, 'utf8')) as {
    file: string;
    rule: string;
    reason: string;
  }[];
  const files = sourceFiles(src);

  it('finds no stack named outside src/recipes/', () => {
    const findings: string[] = [];
    for (const file of files) {
      const relative = path.relative(path.dirname(src), file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const exceptions = allowed.filter(entry => entry.file === relative).map(entry => entry.rule);
      for (const rule of [...STACK_RULES, EXTENSIONS_RULE]) {
        if (exceptions.includes(rule.name)) continue;
        lines.forEach((line, index) => {
          if (rule.pattern.test(line))
            findings.push(`${relative}:${index + 1} (${rule.name}): ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(findings, [], `The core names a stack:\n${findings.join('\n')}`);
  });

  it('lets the core import no recipe’s own folder: what it needs of one comes through the Recipe', () => {
    const own = new RegExp(
      `(?:from\\s+|import\\(\\s*)['"](?:\\.\\.?/)+recipes/(?:${RECIPES.map(recipe => recipe.id).join('|')})/`
    );
    const findings: string[] = [];
    for (const file of files) {
      const relative = path.relative(path.dirname(src), file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (own.test(line)) findings.push(`${relative}:${index + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(
      findings,
      [],
      `The core imports a recipe's own folder:\n${findings.join('\n')}`
    );
  });

  it('keeps every exception explained, and only for a file that exists', () => {
    for (const entry of allowed) {
      assert.ok(fs.existsSync(path.join(path.dirname(src), entry.file)), entry.file);
      assert.ok(entry.reason.length > 20, `${entry.file}: say why`);
      assert.ok(
        [...STACK_RULES, EXTENSIONS_RULE].some(rule => rule.name === entry.rule),
        `${entry.file}: no rule named ${entry.rule}`
      );
    }
  });
});
