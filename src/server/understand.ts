// The local UI's reading of a message (I1 of the chat audit): `POST /api/understand` with the words
// the designer typed, the prompt's mode and the current selection's slugs. Nothing else goes: a
// path in the words leaves as a stand-in, and comes back in the answer, so a direction the page
// starts a run from still says what was typed. Nothing is written here.
import type { StudioApi, UnderstandBody, UnderstandReply } from '../api/client.js';
import { redactLocalPaths, restoreLocalPaths, type LocalPaths } from '../runs/localPaths.js';
import { BadRequest } from './studio.js';

/** The longest words the backend reads. */
const MAX_WORDS = 4000;
const MAX_SLUG = 200;
const MODES: readonly string[] = ['new', 'fork', 'refine'] satisfies UnderstandBody['mode'][];

/** What the route needs from the studio: the client and the linked project. */
export type UnderstandSource = { api: StudioApi; link: { orgId: string; project: string } };

/** The body the backend takes, and the paths its stand-ins hold. */
export type ParsedUnderstand = { body: UnderstandBody; paths: LocalPaths };

/** A selection's slug, or nothing: a message may be sent with nothing selected. */
export function slug(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SLUG) {
    throw new BadRequest(`The selected ${what} cannot be read.`);
  }
  return value;
}

/**
 * Reads the page's request as the backend's schema would, keeping nothing else, with each path in
 * the words swapped for its stand-in. Throws BadRequest in words.
 */
export function parseUnderstand(body: Record<string, unknown>): ParsedUnderstand {
  const typed = typeof body.words === 'string' ? body.words.trim() : '';
  if (!typed) throw new BadRequest('Write something first.');
  const {
    texts: [words],
    paths
  } = redactLocalPaths([typed]);
  if (words.length > MAX_WORDS) {
    throw new BadRequest(`The message is longer than ${MAX_WORDS} characters.`);
  }
  if (typeof body.mode !== 'string' || !MODES.includes(body.mode)) {
    throw new BadRequest('Say whether this is new, a fork or a refinement.');
  }
  const page = slug(body.page, 'page');
  const component = slug(body.component, 'component');
  const iteration = slug(body.iteration, 'iteration');
  return {
    body: {
      words,
      mode: body.mode as UnderstandBody['mode'],
      ...(page === undefined ? {} : { page }),
      ...(component === undefined ? {} : { component }),
      ...(iteration === undefined ? {} : { iteration })
    },
    paths
  };
}

/** The answer as the page shows it, with the paths the model repeated back in their places. */
function restored(reply: UnderstandReply, paths: LocalPaths): UnderstandReply {
  const back = (text: string) => restoreLocalPaths(text, paths);
  return {
    ...reply,
    directions: reply.directions.map(back),
    instructions: back(reply.instructions),
    assumptions: reply.assumptions.map(back),
    question: reply.question && {
      text: back(reply.question.text),
      options: reply.question.options.map(back)
    },
    reply: reply.reply === null ? null : back(reply.reply),
    // An older backend leaves it out.
    rule: reply.rule ? back(reply.rule) : null
  };
}

/** Asks the backend what the message means; its refusals pass on as ApiErrors. */
export async function understandMessage(
  source: UnderstandSource,
  body: Record<string, unknown>
): Promise<UnderstandReply> {
  const { body: request, paths } = parseUnderstand(body);
  const { api, link } = source;
  return restored(await api.understand(link.orgId, link.project, request), paths);
}
