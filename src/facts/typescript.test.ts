import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as studioTs from 'typescript';
import { TYPESCRIPT_APIS, loadTypeScript } from './typescript.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-facts-ts-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"client"}\n');
  return dir;
}

/** A package named typescript in the repo's node_modules, with `body` as its main. */
function fakeTypeScript(repo: string, body: string): void {
  const dir = path.join(repo, 'node_modules', 'typescript');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"typescript","main":"index.js"}\n');
  fs.writeFileSync(path.join(dir, 'index.js'), body);
}

const studioTypeScript = createRequire(import.meta.url).resolve('typescript');
const reexport = `module.exports = require(${JSON.stringify(studioTypeScript)});\n`;

describe('loading the repo’s TypeScript', () => {
  it('says in one sentence when the repo has none, and looks again next time', t => {
    const repo = tempRepo();
    try {
      createRequire(path.join(repo, 'package.json')).resolve('typescript');
      t.skip('a TypeScript above the temp folder resolves, so the refusal cannot be seen here');
      return;
    } catch {
      // none above the temp folder: the case under test
    }
    const refused = loadTypeScript(repo);
    assert.deepEqual(refused, {
      ok: false,
      why: "Fact changes read your sections with TypeScript, which this repo doesn't have installed. Add it with npm i -D typescript."
    });
    fakeTypeScript(repo, reexport);
    assert.deepEqual(loadTypeScript(repo), { ok: true });
  });

  it('refuses a TypeScript without the parts the rules use', () => {
    const repo = tempRepo();
    fakeTypeScript(repo, "module.exports = { version: '1.8.0' };\n");
    const refused = loadTypeScript(repo);
    assert.equal(refused.ok, false);
    assert.match(
      !refused.ok ? refused.why : '',
      /this repo's TypeScript \(1\.8\.0\) is missing ts\.createSourceFile\. Update it/
    );
  });

  it('loads the repo’s own copy and keeps it', () => {
    const repo = tempRepo();
    fakeTypeScript(repo, reexport);
    assert.deepEqual(loadTypeScript(repo), { ok: true });
    // Cached: taking the package away changes nothing for this repo.
    fs.rmSync(path.join(repo, 'node_modules'), { recursive: true, force: true });
    assert.deepEqual(loadTypeScript(repo), { ok: true });
  });

  it('lists every part of the compiler the vendor files use as a value', () => {
    const used = new Set<string>();
    const vendor = path.join(here, 'vendor');
    for (const name of fs.readdirSync(vendor)) {
      const text = fs.readFileSync(path.join(vendor, name), 'utf8');
      const source = studioTs.createSourceFile(name, text, studioTs.ScriptTarget.Latest, true);
      const visit = (node: studioTs.Node): void => {
        if (
          studioTs.isPropertyAccessExpression(node) &&
          studioTs.isIdentifier(node.expression) &&
          node.expression.text === 'ts'
        ) {
          const parent = node.parent;
          used.add(
            studioTs.isPropertyAccessExpression(parent) && parent.expression === node
              ? `${node.name.text}.${parent.name.text}`
              : node.name.text
          );
        }
        studioTs.forEachChild(node, visit);
      };
      visit(source);
    }
    assert.ok(used.size > 20, 'the vendor files use the compiler');
    const listed = new Set<string>(TYPESCRIPT_APIS);
    assert.deepEqual(
      [...used].filter(name => !listed.has(name)).sort(),
      [],
      'add these to TYPESCRIPT_APIS'
    );
  });
});
