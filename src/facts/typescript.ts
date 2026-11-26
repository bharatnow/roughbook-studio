// The client repo's own TypeScript, for the fact rules (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5, the
// studio). The rules in vendor/ walk a section's syntax tree with the compiler's parser, which the
// studio does not ship: it is loaded from the repo's node_modules, as the repo's own tools would
// resolve it, and set as the live `ts` binding the copied files import. Only the parser and
// transpileModule's syntax check are used; nothing is type-checked or run.
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TS from 'typescript';

/** Set by loadTypeScript; the vendor files read it through this ESM live binding. */
export let ts: typeof TS = undefined as unknown as typeof TS;

/**
 * Every part of the compiler the vendor files reach for as a value (src/facts/typescript.test.ts
 * checks this list against them). Enum members are named with their enum.
 */
export const TYPESCRIPT_APIS = [
  'createSourceFile',
  'forEachChild',
  'transpileModule',
  'isArrayLiteralExpression',
  'isBinaryExpression',
  'isIdentifier',
  'isJsxAttribute',
  'isJsxElement',
  'isJsxExpression',
  'isJsxFragment',
  'isJsxNamespacedName',
  'isJsxSelfClosingElement',
  'isJsxText',
  'isNoSubstitutionTemplateLiteral',
  'isNumericLiteral',
  'isObjectLiteralExpression',
  'isPrivateIdentifier',
  'isPropertyAssignment',
  'isPropertyDeclaration',
  'isPropertySignature',
  'isStringLiteral',
  'isTemplateExpression',
  'isTemplateHead',
  'isTemplateMiddle',
  'isTemplateTail',
  'DiagnosticCategory.Error',
  'JsxEmit.Preserve',
  'ModuleKind.ESNext',
  'ScriptKind.JSON',
  'ScriptKind.TS',
  'ScriptKind.TSX',
  'ScriptTarget.Latest',
  'SyntaxKind.CallExpression',
  'SyntaxKind.CaseClause',
  'SyntaxKind.ComputedPropertyName',
  'SyntaxKind.ElementAccessExpression',
  'SyntaxKind.EnumMember',
  'SyntaxKind.EqualsEqualsEqualsToken',
  'SyntaxKind.EqualsEqualsToken',
  'SyntaxKind.ExclamationEqualsEqualsToken',
  'SyntaxKind.ExclamationEqualsToken',
  'SyntaxKind.ExportDeclaration',
  'SyntaxKind.ExpressionStatement',
  'SyntaxKind.ExternalModuleReference',
  'SyntaxKind.ImportDeclaration',
  'SyntaxKind.InKeyword',
  'SyntaxKind.LiteralType',
  'SyntaxKind.NewExpression',
  'SyntaxKind.TaggedTemplateExpression'
] as const;

export type TypeScriptLoad = { ok: true } | { ok: false; why: string };

const INSTALL = 'Add it with npm i -D typescript.';

const cache = new Map<string, TypeScriptLoad>();
/** The compiler the vendor files were first evaluated with: their tables hold its SyntaxKind numbers. */
let bound: { module: typeof TS; version: string } | null = null;

function missingApis(candidate: unknown): string[] {
  return TYPESCRIPT_APIS.filter(name => {
    let value: unknown = candidate;
    for (const part of name.split('.')) {
      value =
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
    }
    return value === undefined;
  });
}

function load(repoRoot: string): TypeScriptLoad {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  let candidate: typeof TS;
  try {
    candidate = require('typescript') as typeof TS;
  } catch {
    return {
      ok: false,
      why: `Fact changes read your sections with TypeScript, which this repo doesn't have installed. ${INSTALL}`
    };
  }
  const version = typeof candidate?.version === 'string' ? candidate.version : 'of unknown version';
  const missing = missingApis(candidate);
  if (missing.length) {
    return {
      ok: false,
      why: `Fact changes read your sections with TypeScript, and this repo's TypeScript (${version}) is missing ts.${missing[0]}. Update it with npm i -D typescript@latest.`
    };
  }
  if (bound && bound.module !== candidate && bound.version !== candidate.version) {
    return {
      ok: false,
      why: `This studio already reads sections with TypeScript ${bound.version}, and this repo has ${version}. Restart the studio to use this repo's.`
    };
  }
  if (!bound) {
    bound = { module: candidate, version: candidate.version };
    ts = candidate;
  }
  return { ok: true };
}

/**
 * Loads the repo's TypeScript and sets the vendor files' `ts`, once per repo (a refusal is not
 * kept, so the next call looks again). The refusal is one
 * sentence for the designer. The first compiler loaded stays bound: a later repo's must be the
 * same version, because the vendor files' tables were built from the first one's enums.
 */
export function loadTypeScript(repoRoot: string): TypeScriptLoad {
  const key = path.resolve(repoRoot);
  const known = cache.get(key);
  if (known) return known;
  const result = load(key);
  // A refusal is asked again next time, so installing TypeScript needs no restart.
  if (result.ok) cache.set(key, result);
  return result;
}
