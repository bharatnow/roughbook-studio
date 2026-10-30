// The project's pictures question (decision 25 of ROUGHBOOK-APPLE-PLAN.md): nothing goes up before
// a yes. Asked once, where a person can answer it (init, run in a terminal, adopt); never in an
// agent's shell, an unattended or editor run, or MCP's finish_run, which leave it unanswered and
// say so in one line. Until then the pictures are taken and kept here, waiting in the outbox, and
// a yes sends them; a no turns pictures off, as the web's setting does, which deletes any stored
// on Roughbook for good. So only a typed n is a no: Enter, or anything else, is "not now".
import type { StudioApi } from '../api/client.js';
import { ApiError, describeError } from '../api/errors.js';
import type { Outbox } from '../api/outbox.js';
import type { Io } from '../io.js';

/** Said wherever nobody can answer, so the designer knows why nothing went up. */
export const PICTURES_WAIT_LINE =
  'Pictures stay on this machine until someone answers: roughbook pictures on|off';

/** The question, after the two lines that explain it. */
export const PICTURES_QUESTION = "Upload this project's pictures to Roughbook?";

type ProjectLink = { orgId: string; project: string };

/**
 * The project's answer: true, false, or null while nobody has answered; undefined when the project
 * cannot be read now. A backend older than the question says nothing, which means on.
 */
export async function readPicturesAnswer(
  api: StudioApi,
  link: ProjectLink
): Promise<boolean | null | undefined> {
  try {
    const tree = await api.project(link.orgId, link.project);
    return tree.pictures === undefined ? true : tree.pictures;
  } catch {
    return undefined;
  }
}

/** The answer in a sentence. */
export function describePicturesAnswer(answer: boolean | null): string {
  if (answer === true)
    return "This project's pictures go up to Roughbook, for its team and reviewers.";
  if (answer === false) return "This project's pictures stay on this machine.";
  return 'Not answered yet, so pictures stay on this machine.';
}

/** Why the backend would not take the answer, in words. */
export function describeAnswerError(error: unknown): string {
  if (error instanceof ApiError && (error.status === 403 || error.code === 'FORBIDDEN')) {
    return "Only the project's owner or an editor can answer. Ask one to run roughbook pictures on or off, or to set it on the web.";
  }
  return `The answer was not saved: ${describeError(error)}`;
}

/**
 * Saves the answer, one boolean; after a yes, what waited in the outbox goes now. Throws when the
 * backend refused it.
 */
export async function answerPictures(
  api: StudioApi,
  link: ProjectLink,
  on: boolean,
  outbox?: Outbox
): Promise<void> {
  await api.setPictures(link.orgId, link.project, on);
  if (on && outbox) {
    try {
      await outbox.flush(api);
    } catch {
      // They go with the next flush.
    }
  }
}

/**
 * Asks the project's pictures question, when nobody has answered it and `ask` allows (a person at
 * a terminal). Returns the answer, or null while there is none. The studio cannot tell whether the
 * project has stored pictures (the project's tree does not say), so the question always says what
 * a no does to them. Only y or n answers: Enter, anything else and nobody there all leave the
 * question open and say the one line, so it is asked again.
 */
export async function ensurePicturesAnswer(
  io: Io,
  api: StudioApi,
  link: ProjectLink,
  options: { ask?: boolean; outbox?: Outbox } = {}
): Promise<boolean | null> {
  const answer = await readPicturesAnswer(api, link);
  // Offline, or not this install's to read: asked another time.
  if (answer === undefined) return null;
  if (answer !== null) return answer;
  if (options.ask === false) {
    io.out(PICTURES_WAIT_LINE);
    return null;
  }
  io.out('');
  io.out(
    "Roughbook can upload pictures of this project's studio iterations and adopted pages, so its team and client reviewers see them on the web."
  );
  io.out('Only the pictures go: never your code, file names or paths.');
  io.out(
    'If this project already has pictures on Roughbook, a no deletes them for good, for its team and client reviewers too.'
  );
  const reply = (await io.ask(`${PICTURES_QUESTION} [y/n, Enter for not now] `))?.trim() ?? '';
  const yes = /^y(es)?$/i.test(reply);
  if (!yes && !/^no?$/i.test(reply)) {
    io.out(PICTURES_WAIT_LINE);
    return null;
  }
  try {
    await answerPictures(api, link, yes, options.outbox);
  } catch (error) {
    io.out(describeAnswerError(error));
    io.out(PICTURES_WAIT_LINE);
    return null;
  }
  io.out(
    yes
      ? 'Pictures go up for this project. Turn them off with roughbook pictures off.'
      : 'Pictures stay on this machine. Any already on Roughbook are deleted. Turn them on with roughbook pictures on.'
  );
  return yes;
}
