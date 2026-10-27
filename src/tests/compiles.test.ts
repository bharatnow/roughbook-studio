// Whether an iteration compiles is kept until what it was bundled from changes (review finding
// 10): its folder, and the app's files it imports, so a fixed app file lets it into the registry
// again without the folder changing, and nothing is bundled again while nothing changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compileProblem, compileStats } from '../recipes/compiles.js';
import { tempDir } from './helpers.js';

const FOLDER = 'rough/home/hero/iteration-01';
let tick = Date.now() / 1000;

/** Writes a file, its time a second past the last one written, as a save a moment later would. */
function write(repo: string, file: string, text: string) {
  const full = path.join(repo, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  tick += 1;
  fs.utimesSync(full, tick, tick);
  fs.utimesSync(path.dirname(full), tick, tick);
}

async function repo(hero: string | null): Promise<string> {
  const root = await tempDir('roughbook-compiles-');
  if (hero !== null) write(root, 'components/hero.tsx', hero);
  write(
    root,
    `${FOLDER}/index.tsx`,
    'import { Hero } from "../../../../components/hero";\n\nexport default function Fork() {\n  return <div className="fork"><Hero /></div>;\n}\n'
  );
  return root;
}

const GOOD = 'export function Hero() {\n  return <section>hero</section>;\n}\n';
const BROKEN = 'export function Hero() {\n  return <section>hero <<<</section\n}\n';

describe('whether an iteration compiles', () => {
  it('is checked again once the app file it imports is fixed, the folder unchanged', async () => {
    const root = await repo(BROKEN);
    assert.match(compileProblem(root, FOLDER, 'index.tsx') ?? '', /components\/hero\.tsx:2:\d+/);
    write(root, 'components/hero.tsx', GOOD);
    assert.equal(compileProblem(root, FOLDER, 'index.tsx'), null);
  });

  it('is checked again once a file it could not find is there', async () => {
    const root = await repo(null);
    assert.match(compileProblem(root, FOLDER, 'index.tsx') ?? '', /Could not resolve/);
    write(root, 'components/hero.tsx', GOOD);
    assert.equal(compileProblem(root, FOLDER, 'index.tsx'), null);
  });

  it('finds an app file it imports broken after it compiled', async () => {
    const root = await repo(GOOD);
    assert.equal(compileProblem(root, FOLDER, 'index.tsx'), null);
    write(root, 'components/hero.tsx', BROKEN);
    assert.match(compileProblem(root, FOLDER, 'index.tsx') ?? '', /components\/hero\.tsx:2:\d+/);
  });

  it('bundles nothing again while nothing it was bundled from changed', async () => {
    for (const hero of [GOOD, BROKEN]) {
      const root = await repo(hero);
      compileProblem(root, FOLDER, 'index.tsx');
      const bundles = compileStats.bundles;
      for (let again = 0; again < 3; again++) compileProblem(root, FOLDER, 'index.tsx');
      assert.equal(compileStats.bundles, bundles, hero);
      // A file the iteration does not import changes nothing.
      write(root, 'components/footer.tsx', GOOD);
      compileProblem(root, FOLDER, 'index.tsx');
      assert.equal(compileStats.bundles, bundles, hero);
    }
  });
});
