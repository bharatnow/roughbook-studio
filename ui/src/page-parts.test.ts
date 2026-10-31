import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageParts, webPageSrc } from './composition.ts';

const section = (component: string, iteration = 'iteration-01') => ({ component, iteration });
const runners = (here: string[]) => ({
  here: new Set(here),
  local: (list: { component: string }[]) => `/app:${list.map(item => item.component).join()}`,
  web: (list: { component: string }[]) => `/web:${list.map(item => item.component).join()}`
});
const home = (component: string) => `home/${component}/iteration-01`;

describe('a page as it runs', () => {
  it('is one address when one place runs every section', () => {
    const sections = [section('hero'), section('footer')];
    assert.equal(
      pageParts('home', sections, runners([home('hero'), home('footer')])),
      '/app:hero,footer'
    );
    assert.equal(pageParts('home', sections, runners([])), '/web:hero,footer');
  });

  it('keeps a mixed page in order, in as few frames as it can', () => {
    const sections = [section('a'), section('b'), section('c'), section('d')];
    const parts = pageParts('home', sections, runners([home('a'), home('b'), home('d')]));
    assert.deepEqual(
      (parts as { src: string }[]).map(part => part.src),
      ['/app:a,b', '/web:c', '/app:d']
    );
  });

  it('does not run a page when any part of it cannot', () => {
    const sections = [section('a'), section('b')];
    assert.equal(pageParts('home', sections, { ...runners([home('a')]), web: null }), null);
    assert.equal(pageParts('home', sections, { ...runners([]), web: null }), null);
    assert.equal(pageParts('home', [], runners([])), null);
  });

  it('asks this server for web sketches, with the frame’s key', () => {
    assert.equal(
      webPageSrc('home', [section('hero')], 'k 1'),
      '/api/pages/home/composed?sections=hero%3Aiteration-01&key=k%201'
    );
  });
});
