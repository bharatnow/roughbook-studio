// Copies the backend's house rules and technique library into src/rules/vendor/
// (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T1 and T2), as scripts/sync-facts.mjs copies the fact rules:
// verbatim but for mechanical rewrites of their imports.
// - houseRules.ts and modelTells.ts (src/utils/rules/): the floors, the defaults and what lifts them;
// - houseChecks.ts (src/utils/compile/): the house check's scan, which runs/checks.ts runs;
// - techniques/ (src/utils/rules/techniques/): every entry, the need lookup and the formatter;
// - technique.ts (src/services/sketch/tools/): the web's technique tool, whose techniqueAnswer the
//   studio's MCP tool returns, so both answer alike.
// Relative imports of copied files get `.js`, as the studio's ESM build needs, and point where the
// copy lands; the types of backend files not copied point at the hand-written ../vendor-shims.ts. An import
// the script does not know fails the sync, so a new dependency is never missed. Only top-level
// import statements are rewritten: an entry's code, held in strings, is copied as it is.
//
//   node scripts/sync-rules.mjs [backendPath]     (default ../roughbook-backend)
//
// src/rules/sync.test.ts runs generate() in memory and fails when the copies are out of step.
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR_DIR = path.join(root, 'src', 'rules', 'vendor');
const SHIMS = '../vendor-shims.js';

/**
 * Each copied file: where it is in the backend (under src/), where it lands in vendor/, and how
 * each of its imports is rewritten.
 */
const FILES = [
  {
    from: 'utils/rules/houseRules.ts',
    to: 'houseRules.ts',
    imports: { './modelTells': './modelTells.js' }
  },
  { from: 'utils/rules/modelTells.ts', to: 'modelTells.ts', imports: {} },
  {
    from: 'utils/compile/houseChecks.ts',
    to: 'houseChecks.ts',
    imports: { '../rules/houseRules': './houseRules.js', './checks': SHIMS }
  },
  {
    from: 'services/sketch/tools/technique.ts',
    to: 'technique.ts',
    imports: { '../../../utils/rules/techniques': './techniques/index.js', './types': SHIMS }
  }
];
const TECHNIQUES = 'utils/rules/techniques';

/** The module specifier as the copy needs it, or a thrown error for one the sync doesn't know. */
function rewriteSpecifier(file, specifier, imports) {
  const next = imports[specifier];
  if (next) return next;
  throw new Error(
    `${file} imports ${specifier}, which scripts/sync-rules.mjs neither copies nor shims. Add it.`
  );
}

/** One file's top-level imports rewritten, the rest of its text untouched. */
function rewriteImports(file, text, imports) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const next = rewriteSpecifier(file, specifier.text, imports);
    edits.push({ start: specifier.getStart(source) + 1, end: specifier.end - 1, text: next });
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

const header = from =>
  [
    `// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/${from}).`,
    '// Checked by the backend under its own compiler options, so not by the studio here:',
    '// @ts-nocheck',
    ''
  ].join('\n');

/** Every vendor file, by its path in src/rules/vendor/ with forward slashes, as the sync writes it. */
export function generate(backendPath) {
  const src = path.join(backendPath, 'src');
  if (!fs.existsSync(path.join(src, TECHNIQUES)))
    throw new Error(`${path.join(src, TECHNIQUES)} is not there: is ${backendPath} the backend?`);
  const read = from => fs.readFileSync(path.join(src, from), 'utf8').replace(/\r\n/g, '\n');
  const out = new Map();
  for (const { from, to, imports } of FILES) {
    out.set(to, header(from) + rewriteImports(from, read(from), imports));
  }
  const entries = fs
    .readdirSync(path.join(src, TECHNIQUES))
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  // Every technique file may import its siblings, and nothing else.
  const siblings = Object.fromEntries(
    entries.map(name => [`./${name.slice(0, -3)}`, `./${name.slice(0, -3)}.js`])
  );
  for (const name of entries) {
    const from = `${TECHNIQUES}/${name}`;
    out.set(`techniques/${name}`, header(from) + rewriteImports(from, read(from), siblings));
  }
  return out;
}

/** The files under a folder, by their paths relative to it with forward slashes. */
export function listVendor(dir = VENDOR_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
    );
}

function main() {
  // A path given is the shell's; the default is beside the studio's checkout.
  const backendPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, '..', 'roughbook-backend');
  const files = generate(backendPath);
  for (const name of listVendor()) {
    if (!files.has(name)) fs.rmSync(path.join(VENDOR_DIR, ...name.split('/')), { force: true });
  }
  for (const [name, content] of files) {
    const file = path.join(VENDOR_DIR, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  process.stdout.write(`Wrote ${files.size} files to ${path.relative(root, VENDOR_DIR)}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
