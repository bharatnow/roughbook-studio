import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyHostActions,
  firstComponent,
  onPageListRequest,
  requestPageList
} from './empty-host.ts';

function wire(pages: { slug: string; components: { slug: string }[] }[] = []) {
  const said: string[] = [];
  const actions = emptyHostActions({
    firstComponent: firstComponent({ tree: { pages } }),
    navigate: href => said.push(`navigate ${href}`),
    focusPrompt: () => said.push('prompt'),
    openPageList: () => said.push('pages')
  });
  return { actions, said };
}

describe("the studio host's empty-state actions", () => {
  it("Add a page opens the app's pages, where a page is adopted", () => {
    const { actions, said } = wire();
    actions.addPage({ project: 'site' });
    assert.deepEqual(said, ['pages']);
  });

  it('Generate in a frame selects its component and puts the keyboard in the prompt', () => {
    const { actions, said } = wire();
    actions.generateInFrame({ project: 'site', page: 'home', component: 'hero' });
    assert.deepEqual(said, ['navigate #/home/hero', 'prompt']);
  });

  it('Generate directions generates in the first component', () => {
    const { actions, said } = wire([
      { slug: 'about', components: [] },
      { slug: 'home', components: [{ slug: 'hero' }] }
    ]);
    actions.generateDirections?.({ project: 'site' });
    assert.deepEqual(said, ['navigate #/home/hero', 'prompt']);
  });

  it('Generate directions is not offered without a component, so Add a page stands alone', () => {
    assert.equal(wire().actions.generateDirections, undefined);
    assert.equal(wire([{ slug: 'about', components: [] }]).actions.generateDirections, undefined);
  });
});

describe('the page list request', () => {
  it('reaches an open canvas at once', () => {
    let opened = 0;
    const stop = onPageListRequest(() => (opened += 1));
    assert.equal(requestPageList(), true);
    assert.equal(opened, 1);
    stop();
  });

  it('waits for the canvas when none is open, and is answered once', () => {
    assert.equal(requestPageList(), false);
    let opened = 0;
    const stop = onPageListRequest(() => (opened += 1));
    assert.equal(opened, 1);
    stop();
    const again = onPageListRequest(() => (opened += 1));
    assert.equal(opened, 1);
    again();
  });
});
