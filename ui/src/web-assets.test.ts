import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ASSETS_HREF, parseRoute, titleFor } from './router.ts';
import {
  FETCH_LINE,
  NOTHING_WAITING,
  answersWithoutRows,
  assetFacts,
  confirmAsset,
  confirmBody,
  confirmPath,
  declineAsset,
  licenceText,
  rejectPath,
  sizeText,
  type RowAnswer,
  type WebAsset,
  type WebAssets
} from './web-assets.ts';

const PENDING: WebAsset = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  status: 'pending',
  sourceUrl: 'https://models.example.org/chair.glb',
  licence: 'CC0',
  licenceFrom: 'model',
  reason: 'The product in the hero',
  fileName: null,
  contentType: null,
  size: null,
  confirmedAt: null,
  createdAt: '2026-11-28T00:00:00.000Z'
};

const CONFIRMED: WebAsset = {
  ...PENDING,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'confirmed',
  sourceUrl: 'https://fonts.example.org/Inter.woff2',
  licence: 'OFL-1.1',
  licenceFrom: 'maker',
  reason: null,
  fileName: 'inter.woff2',
  contentType: 'font/woff2',
  size: 48_000,
  confirmedAt: '2026-11-28T01:00:00.000Z'
};

type Sent = { method: string; url: string; body: unknown };

/** The page's fetch to the local server, answering as it would and recording each call. */
function localServer(reply: (sent: Sent) => { status: number; json: unknown }) {
  const calls: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
    };
    calls.push(sent);
    const { status, json } = reply(sent);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the Assets screen's words", () => {
  it('has its own screen on the project’s address, never in a page’s way', () => {
    assert.deepEqual(parseRoute(`#${ASSETS_HREF}`), { screen: 'assets' });
    assert.equal(parseRoute('#/assets').screen, 'canvas');
    assert.equal(
      titleFor(parseRoute(`#${ASSETS_HREF}`), { name: 'Acme', pages: [] }),
      'Assets · Acme / Roughbook studio'
    );
  });

  it('says its type and size when known, and the licence with who named it', () => {
    assert.equal(sizeText(900), '900 bytes');
    assert.equal(sizeText(48_000), '47 KB');
    assert.equal(sizeText(1_200_000), '1.1 MB');
    assert.equal(assetFacts(CONFIRMED), 'font/woff2 · 47 KB');
    assert.equal(assetFacts({ contentType: null, size: 12 }), '12 bytes');
    assert.equal(assetFacts(PENDING), null);
    assert.equal(licenceText(PENDING), 'CC0, as the run named it');
    assert.equal(licenceText(CONFIRMED), 'OFL-1.1');
    assert.equal(
      licenceText({ licence: ' ', licenceFrom: 'model' }),
      'No licence named, as the run named it'
    );
  });

  it('sends the licence typed, trimmed, or nothing, and only the id in the address', () => {
    assert.deepEqual(confirmBody('  CC-BY-4.0 '), { licence: 'CC-BY-4.0' });
    assert.deepEqual(confirmBody('   '), {});
    assert.equal(confirmPath(PENDING), `/api/web-assets/${PENDING.id}/confirm`);
    assert.equal(rejectPath({ id: 'a/b' }), '/api/web-assets/a%2Fb/reject');
  });

  it('keeps an answer whose row is gone, and drops one whose row is listed', () => {
    const answers = {
      [PENDING.id]: {
        ok: true,
        message: 'Declined. Nothing was fetched.',
        sourceUrl: PENDING.sourceUrl
      },
      [CONFIRMED.id]: { ok: true, message: 'Confirmed.', sourceUrl: CONFIRMED.sourceUrl }
    };
    assert.deepEqual(answersWithoutRows(answers, { pending: [], confirmed: [CONFIRMED] }), [
      answers[PENDING.id]
    ]);
  });
});

describe('Confirm and Decline through the local server', () => {
  it('confirms with the licence and says so, and declines with an empty body', async () => {
    const calls = localServer(sent => ({
      status: 200,
      json: {
        ok: true,
        data: sent.url.endsWith('/confirm')
          ? { ...PENDING, status: 'confirmed', fileName: 'chair.glb', licence: 'CC-BY-4.0' }
          : { ...PENDING, status: 'rejected' }
      }
    }));
    assert.deepEqual(await confirmAsset(PENDING, ' CC-BY-4.0 '), {
      ok: true,
      message: 'Confirmed. chair.glb is in the project, under CC-BY-4.0.'
    });
    assert.deepEqual(await declineAsset(PENDING), {
      ok: true,
      message: 'Declined. Nothing was fetched.'
    });
    assert.deepEqual(calls, [
      { method: 'POST', url: confirmPath(PENDING), body: { licence: 'CC-BY-4.0' } },
      { method: 'POST', url: rejectPath(PENDING), body: {} }
    ]);
  });

  it('says the refusal in the backend’s words', async () => {
    localServer(() => ({
      status: 409,
      json: { ok: false, error: 'CONFLICT', message: 'That file is no longer waiting for you.' }
    }));
    assert.deepEqual(await confirmAsset(PENDING, ''), {
      ok: false,
      message: 'That file is no longer waiting for you.'
    });
    assert.deepEqual(await declineAsset(PENDING), {
      ok: false,
      message: 'That file is no longer waiting for you.'
    });
  });
});

describe('the Assets lists', () => {
  const render = async (props: { assets: WebAssets; answers?: Record<string, RowAnswer> }) => {
    // The package's .tsx compiles to React.createElement outside this project's JSX setting.
    (globalThis as { React?: typeof React }).React = React;
    const { AssetLists } = await import('./screens/assets.tsx');
    return renderToStaticMarkup(
      React.createElement(AssetLists, {
        answers: {},
        onAnswer: async () => {},
        ...props
      })
    );
  };

  it('shows the proposals first with Confirm, Decline and a licence field, then the confirmed files', async () => {
    const html = await render({ assets: { pending: [PENDING], confirmed: [CONFIRMED] } });
    assert.ok(html.indexOf('Waiting for you') < html.indexOf('In the project'));
    assert.ok(html.indexOf(PENDING.sourceUrl) < html.indexOf(CONFIRMED.sourceUrl));
    assert.match(html, /The product in the hero/);
    assert.match(html, /CC0, as the run named it/);
    assert.match(html, /font\/woff2 · 47 KB/);
    assert.match(html, />Confirm</);
    assert.match(html, />Decline</);
    assert.match(html, /name="licence"/);
    assert.match(html, /maxlength="200"/i);
    // 16 px below 768 px, so iOS does not zoom.
    assert.match(html, /text-base [^"]*md:text-sm/);
    // No hint paragraph: the fetch is explained in a HelpTip.
    assert.match(html, /About confirming a file/);
    assert.doesNotMatch(html, /<p[^>]*text-slate/);
    assert.doesNotMatch(html, new RegExp(NOTHING_WAITING));
    assert.ok(FETCH_LINE.includes('your machine never opens the address'));
  });

  it('says when nothing is waiting, and an answer whose row is gone', async () => {
    const html = await render({
      assets: { pending: [], confirmed: [] },
      answers: {
        [PENDING.id]: {
          ok: true,
          message: 'Declined. Nothing was fetched.',
          sourceUrl: PENDING.sourceUrl
        }
      }
    });
    assert.match(html, new RegExp(NOTHING_WAITING));
    assert.match(html, /chair\.glb: Declined\. Nothing was fetched\./);
    assert.doesNotMatch(html, /In the project/);
    assert.doesNotMatch(html, />Confirm</);
  });

  it('shows a row’s refusal beside it', async () => {
    const html = await render({
      assets: { pending: [PENDING], confirmed: [] },
      answers: {
        [PENDING.id]: {
          ok: false,
          message: 'Fetching files is not set up on this server.',
          sourceUrl: PENDING.sourceUrl
        }
      }
    });
    assert.match(html, /text-danger[^>]*>Fetching files is not set up on this server\./);
  });
});
