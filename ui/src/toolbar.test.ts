import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { studioCommands } from './commands.ts';
import { TOOLBAR_ITEMS, documentItems, projectLink } from './toolbar.ts';

const INPUT = { project: 'site', webUrl: 'https://roughbook.example/', complete: false };

describe("the shell's toolbar", () => {
  it('links the project on the web, and nothing when the studio has no web address', () => {
    assert.equal(projectLink(INPUT), 'https://roughbook.example/projects/site');
    assert.equal(projectLink({ ...INPUT, webUrl: null }), null);
    assert.deepEqual(documentItems({ ...INPUT, webUrl: null }), []);
  });

  it('offers Your look, Project settings and Copy link; Complete features adds three', () => {
    assert.deepEqual(
      documentItems(INPUT).map(item => item.label),
      ['Your look', 'Project settings', 'Copy link']
    );
    assert.deepEqual(
      documentItems({ ...INPUT, complete: true }).map(item => item.label),
      ['Your look', 'Project settings', 'Strategy', 'Art direction', 'Library', 'Copy link']
    );
    assert.deepEqual(documentItems(INPUT)[0]!.run, {
      kind: 'href',
      href: 'https://roughbook.example/projects/site/design-system',
      external: true
    });
    assert.deepEqual(documentItems(INPUT).at(-1)!.run, {
      kind: 'copy',
      text: 'https://roughbook.example/projects/site',
      done: 'Copied the link to this project.'
    });
  });

  it('never offers what only the web can do', () => {
    const labels = documentItems({ ...INPUT, complete: true }).map(item => item.label);
    for (const label of ['Rename…', 'Archive…', 'Delete…']) assert.ok(!labels.includes(label));
  });

  it('makes every toolbar and menu item a command too, on the canvas and off it', () => {
    for (const complete of [false, true]) {
      const items = [...TOOLBAR_ITEMS, ...documentItems({ ...INPUT, complete })];
      const off = studioCommands(null, null, { ...INPUT, complete });
      for (const item of items) {
        const found = off.find(command => command.id === item.id);
        assert.ok(found, `${item.id} is a command`);
        assert.deepEqual(found.run, item.run, item.id);
        assert.equal(found.label, item.label, item.id);
      }
    }
  });
});
