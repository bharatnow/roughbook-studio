// The local UI's memory (A10 step 3 of ROUGHBOOK-APPLE-PLAN.md): `GET /api/learned` reads what
// Roughbook learned about the designer ("you") and the linked project's brand, and
// `POST /api/learned/:scope/:id/forget` forgets one sentence. Only the scope and the sentence's id
// go to the backend; nothing from the repo goes, and nothing is kept here.
import type { LearnedSentence } from '../api/client.js';
import type { ReadingsSource } from './readings.js';
import { BadRequest } from './studio.js';

/** What the routes need from the studio: the client and the linked project. */
export type LearnedSource = ReadingsSource;

/** What the taste screen shows: the person's sentences and the linked project's brand's. */
export type LearnedView = { project: string; you: LearnedSentence[]; brand: LearnedSentence[] };

/** A sentence's id as the backend issues it; anything else never reaches a URL. */
const SENTENCE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function sentences(reply: { sentences?: LearnedSentence[] } | null | undefined): LearnedSentence[] {
  return Array.isArray(reply?.sentences) ? reply.sentences : [];
}

export async function loadLearned({ api, link }: LearnedSource): Promise<LearnedView> {
  const [you, brand] = await Promise.all([
    api.myLearned(link.orgId),
    api.projectLearned(link.orgId, link.project)
  ]);
  return { project: link.project, you: sentences(you), brand: sentences(brand) };
}

export async function forgetLearned(
  { api, link }: LearnedSource,
  scope: unknown,
  id: unknown
): Promise<{ forgotten: true }> {
  if (scope !== 'you' && scope !== 'brand') {
    throw new BadRequest('Forget a sentence about you or about this brand.');
  }
  if (typeof id !== 'string' || !SENTENCE_ID.test(id)) {
    throw new BadRequest('That is not a learned sentence.');
  }
  await (scope === 'you'
    ? api.forgetMyLearned(link.orgId, id)
    : api.forgetProjectLearned(link.orgId, link.project, id));
  return { forgotten: true };
}
