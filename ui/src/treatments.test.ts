import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TREATMENTS_HREF, parseRoute, titleFor } from './router.ts';
import { projectTreatments, treatmentsWebHref } from './treatments.ts';

const GLASS = {
  id: 'glass-header',
  name: 'Glass header',
  kind: 'material',
  words: 'Glass on the floating header, so the page shows through.',
  where: ['the header'],
  techniqueId: 'frosted-glass',
  css: '.rb-glass-header { backdrop-filter: blur(12px); }',
  source: 'library',
  sourceRef: null,
  updatedAt: '2026-11-28T10:00:00.000Z'
};

describe("the project's treatments in the studio (parity T6)", () => {
  it('reads them from the project read, and [] where an older backend sends none', () => {
    assert.deepEqual(projectTreatments({ designSystem: { treatments: [GLASS] } }), [GLASS]);
    assert.deepEqual(projectTreatments({ slug: 'site', pages: [] }), []);
    assert.deepEqual(projectTreatments({ designSystem: {} }), []);
    assert.deepEqual(projectTreatments(null), []);
  });

  it('drops what it cannot name, and reads an unknown kind or source as the plain one', () => {
    const read = projectTreatments({
      designSystem: {
        treatments: [{ id: '', name: 'No id' }, { ...GLASS, kind: 'sparkle', source: 'x' }, 7]
      }
    });
    assert.equal(read.length, 1);
    assert.equal(read[0]!.kind, 'other');
    assert.equal(read[0]!.source, 'maker');
  });

  it("links Edit on the web to the project's look tuner, and nowhere without a web address", () => {
    assert.equal(
      treatmentsWebHref({ project: 'site', webUrl: 'https://roughbook.example/' }),
      'https://roughbook.example/projects/site/look/tune'
    );
    assert.equal(treatmentsWebHref({ project: 'site', webUrl: null }), null);
  });

  it("has its own screen on the project's address, never in a page's way", () => {
    assert.deepEqual(parseRoute(`#${TREATMENTS_HREF}`), { screen: 'treatments' });
    assert.equal(parseRoute('#/treatments').screen, 'canvas');
    assert.equal(
      titleFor(parseRoute(`#${TREATMENTS_HREF}`), { name: 'Acme', pages: [] }),
      'Treatments · Acme / Roughbook studio'
    );
  });

  it('shows each treatment without Add, Change or Remove, and no preview it was not given', async () => {
    // The package's .tsx compiles to React.createElement outside this project's JSX setting.
    (globalThis as { React?: typeof React }).React = React;
    const { MAX_TREATMENTS, TreatmentList } = await import('@roughbook/ui');
    const html = renderToStaticMarkup(
      React.createElement(TreatmentList, {
        treatments: projectTreatments({ designSystem: { treatments: [GLASS] } }),
        previews: {},
        max: MAX_TREATMENTS
      })
    );
    assert.match(html, /Glass header/);
    assert.match(html, /Glass on the floating header/);
    assert.match(html, /On the header/);
    assert.match(html, /The preview is not ready yet\./);
    assert.doesNotMatch(html, /<iframe/);
    assert.doesNotMatch(html, /<form/);
    for (const control of ['Change', 'Remove', 'Add a treatment', 'Undo remove', 'Save']) {
      assert.ok(!html.includes(`>${control}<`), `no ${control}`);
    }
  });
});
