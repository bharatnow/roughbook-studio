// A studio run with a fake backend for the web asset routes (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T5),
// shared by the fetch_asset tests and the outbound-request test.
import fs from 'node:fs';
import path from 'node:path';
import { StudioApi } from '../api/client.js';
import type { WebAssetView } from '../api/webAssets.js';
import type { CommandContext } from '../commands/context.js';
import { saveCredentials } from '../config/credentials.js';
import { hostPlatform } from '../launch/platform.js';
import type { ToolCall } from '../mcp/server.js';
import { studioTools } from '../mcp/tools.js';
import type { RepoLink } from '../repo/link.js';
import { startRuns } from '../runs/lifecycle.js';
import type { StartedRun } from '../runs/types.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ASSET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SERVER = 'https://api.example.test';
const KEY = 'home/hero/iteration-03';
export const FOLDER = `rough/${KEY}`;
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: null
};
export const BYTES = 'wOF2 the font bytes as the server stored them';
export const RUN_ASSETS = `${SERVER}/v1/api/studio/orgs/${ORG}/runs/${RUN}/web-assets`;

export function view(overrides: Partial<WebAssetView> = {}): WebAssetView {
  return {
    id: ASSET,
    status: 'confirmed',
    sourceUrl: 'https://fonts.example.org/Inter-Variable.woff2',
    licence: 'OFL-1.1',
    licenceFrom: 'model',
    reason: 'The headline face',
    url: '/api/files/project/site/inter-variable.woff2',
    fileName: 'inter-variable.woff2',
    contentType: 'font/woff2',
    size: Buffer.byteLength(BYTES),
    confirmedBy: 'u1',
    confirmedAt: '2026-11-28T00:00:00.000Z',
    createdAt: '2026-11-28T00:00:00.000Z',
    ...overrides
  };
}

/** A repo with one run started on KEY, signed in, and a fake backend for the asset routes. */
export async function assetRun(
  options: {
    asset?: WebAssetView;
    bytes?: string;
    files?: Record<string, string>;
    refuseRun?: boolean;
  } = {}
) {
  const root = await tempDir('roughbook-fetch-asset-');
  const repo = path.join(root, 'app');
  const configDir = path.join(root, 'config');
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
    fs.writeFileSync(path.join(repo, ...file.split('/')), text);
  };
  write('package.json', '{}');
  write('rough/roughbook.json', JSON.stringify(LINK));
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: null,
    savedAt: '2026-11-28T00:00:00.000Z'
  });
  const asset = options.asset ?? view();
  const started: StartedRun = {
    runId: RUN,
    iteration: 'iteration-03',
    parent: null,
    targetFolder: FOLDER,
    prompt: '<task>\nGenerate it.\n</task>\n',
    checks: [{ kind: 'entry-file', file: 'index.tsx' }]
  };
  const backend = fakeFetch((request: RecordedRequest) => {
    const url = request.url;
    if (url.endsWith('/runs')) return ok([started], 201);
    if (options.refuseRun) return refused('RUN_NOT_FOUND', 404);
    if (url === RUN_ASSETS && request.method === 'GET') {
      return ok({ confirmed: [asset], rules: ['No logos or brand art of other companies.'] });
    }
    if (url === `${RUN_ASSETS}/${asset.id}/file`) return { text: options.bytes ?? BYTES };
    if (url === RUN_ASSETS && request.method === 'POST') {
      const body = request.body as { url: string };
      if (!body.url.startsWith('https:')) {
        return refused('WEB_ASSET_REFUSED', 400, 'Only https addresses can be fetched.');
      }
      if (body.url === asset.sourceUrl) return ok(asset, 201);
      return ok(
        view({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          status: 'pending',
          url: null,
          fileName: null,
          size: null
        }),
        201
      );
    }
    return refused('RUN_NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: backend.fetch
  });
  await startRuns(repo, api, LINK, {
    page: 'home',
    component: 'hero',
    agent: 'claude-code',
    mode: 'interactive',
    kind: 'generate',
    directions: [{ direction: 'Quiet' }]
  });
  // What the agent and the designer wrote, once the run's folder is there.
  for (const [file, text] of Object.entries(options.files ?? {})) write(file, text);
  backend.requests.length = 0;
  const context = {
    repoRoot: repo,
    cwd: repo,
    env: {},
    configDir,
    fetch: backend.fetch,
    platform: hostPlatform()
  } as unknown as CommandContext;
  const tool = studioTools(context, { devUrl: 'http://localhost:3000' }).find(
    item => item.name === 'fetch_asset'
  )!;
  const call = { roots: async () => [repo], progress: () => undefined } as unknown as ToolCall;
  const fetchAsset = async (args: Record<string, string>) =>
    JSON.parse(await tool.call({ run: RUN, ...args }, call));
  return { root, repo, backend, fetchAsset, tool, call };
}
