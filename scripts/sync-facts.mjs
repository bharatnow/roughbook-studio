// Copies the backend's fact rules into src/facts/vendor/ (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5, the
// studio): the index (factIndex.ts), the finder (factFind.ts), the splice (factSplice.ts) and what
// they read figures and names with (factPlacement.ts), verbatim but for mechanical rewrites:
// - `import * as ts from 'typescript'` becomes the live binding in ../typescript.js, which
//   loadTypeScript sets from the client repo's own TypeScript (the studio ships no compiler);
// - relative imports of copied files get `.js`, as the studio's ESM build needs;
// - imports of anything else (pagePath, the shared page's slug, the backend's types) point at the
//   hand-written ../vendor-shims.ts.
// factChangeApply.ts is not copied whole: its applyFactEdits needs the backend's project, script
// and plan types. Only what the finder and splice import is extracted from it, statement by
// statement: FactEdit, normaliseFact, factPattern, countFact, and the escape helper factPattern
// uses. An import the script does not know fails the sync, so a new dependency is never missed.
//
//   node scripts/sync-facts.mjs [backendPath]     (default ../roughbook-backend)
//
// src/facts/sync.test.ts runs generate() in memory and fails when the copies are out of step.
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR_DIR = path.join(root, 'src', 'facts', 'vendor');
const RULES = path.join('src', 'utils', 'rules');

/** Copied whole. */
const WHOLE = ['factIndex', 'factFind', 'factSplice', 'factPlacement'];
/** Copied in part: these top-level declarations only, in source order. */
const EXTRACT = {
  factChangeApply: ['FactEdit', 'escape', 'normaliseFact', 'factPattern', 'countFact']
};
const COPIED = new Set([...WHOLE, ...Object.keys(EXTRACT)]);

/** Imports of files not copied, redirected to the shims. */
const SHIMMED = new Set([
  './sitePlan',
  './catalogTypes',
  './sitePlanTypes',
  './siteScriptTypes',
  '../format/shared',
  '../sketch/files'
]);
const SHIMS = '../vendor-shims.js';
const TS_IMPORT = "import * as ts from 'typescript';";
const TS_BINDING = "import { ts } from '../typescript.js';";

const header = (name, note) =>
  [
    `// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/${name}.ts).`,
    ...(note ? [`// ${note}`] : []),
    '// Checked by the backend under its own compiler options, so not by the studio here:',
    '// @ts-nocheck',
    ''
  ].join('\n');

/** The module specifier as the vendor file needs it, or a thrown error for one the sync doesn't know. */
function rewriteSpecifier(file, specifier) {
  if (specifier.startsWith('./') && COPIED.has(specifier.slice(2))) return `${specifier}.js`;
  if (SHIMMED.has(specifier)) return SHIMS;
  throw new Error(
    `${file}.ts imports ${specifier}, which scripts/sync-facts.mjs neither copies nor shims. Add it to one of the two.`
  );
}

/** One file's imports rewritten, the rest of its text untouched. */
function rewriteImports(file, text) {
  const source = ts.createSourceFile(`${file}.ts`, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    if (specifier.text === 'typescript') {
      if (statement.getText(source) !== TS_IMPORT) {
        throw new Error(`${file}.ts imports typescript other than as \`${TS_IMPORT}\`.`);
      }
      edits.push({ start: statement.getStart(source), end: statement.end, text: TS_BINDING });
      continue;
    }
    const next = rewriteSpecifier(file, specifier.text);
    edits.push({ start: specifier.getStart(source) + 1, end: specifier.end - 1, text: next });
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** The named top-level declarations of a file, each with its leading comment, in source order. */
function extract(file, text, names) {
  const source = ts.createSourceFile(`${file}.ts`, text, ts.ScriptTarget.Latest, true);
  const nameOf = statement => {
    if (ts.isVariableStatement(statement)) {
      const [declaration] = statement.declarationList.declarations;
      return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
    }
    return statement.name && ts.isIdentifier(statement.name) ? statement.name.text : null;
  };
  const found = new Set();
  const parts = [];
  for (const statement of source.statements) {
    const name = nameOf(statement);
    if (!name || !names.includes(name)) continue;
    found.add(name);
    // The leading trivia since the previous statement, less the blank lines before the comment.
    parts.push(statement.getFullText(source).replace(/^\s*\n/, ''));
  }
  const missing = names.filter(name => !found.has(name));
  if (missing.length) {
    throw new Error(`${file}.ts no longer declares ${missing.join(', ')} at its top level.`);
  }
  return `${parts.join('\n\n')}\n`;
}

/** Every vendor file, by its name in src/facts/vendor/, as the sync writes it. */
export function generate(backendPath) {
  const rules = path.join(backendPath, RULES);
  if (!fs.existsSync(rules))
    throw new Error(`${rules} is not there: is ${backendPath} the backend?`);
  const read = file =>
    fs.readFileSync(path.join(rules, `${file}.ts`), 'utf8').replace(/\r\n/g, '\n');
  const out = new Map();
  for (const file of WHOLE) {
    out.set(`${file}.ts`, header(file) + rewriteImports(file, read(file)));
  }
  for (const [file, names] of Object.entries(EXTRACT)) {
    const note = `Only ${names.join(', ')}: the rest applies edits to the backend's own docs.`;
    out.set(`${file}.ts`, header(file, note) + extract(file, read(file), names));
  }
  return out;
}

function main() {
  // A path given is the shell's; the default is beside the studio's checkout.
  const backendPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, '..', 'roughbook-backend');
  const files = generate(backendPath);
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  for (const name of fs.readdirSync(VENDOR_DIR)) {
    if (!files.has(name)) fs.rmSync(path.join(VENDOR_DIR, name), { force: true });
  }
  for (const [name, content] of files) fs.writeFileSync(path.join(VENDOR_DIR, name), content);
  process.stdout.write(`Wrote ${files.size} files to ${path.relative(root, VENDOR_DIR)}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
