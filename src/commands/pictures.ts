// `roughbook pictures [on|off]` (decision 25 of ROUGHBOOK-APPLE-PLAN.md): the linked project's
// pictures question, answered or changed here, as `roughbook telemetry` does for analytics.
import { outboxFor } from '../api/outbox.js';
import {
  answerPictures,
  describeAnswerError,
  describePicturesAnswer,
  readPicturesAnswer
} from '../pictures/answer.js';
import { requireRepoLink } from '../repo/link.js';
import { requireApi, type Command } from './context.js';

export const pictures: Command = {
  name: 'pictures',
  summary: "Upload this project's pictures, or keep them here; with no argument, say which",
  usage: 'pictures [on|off]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const [choice, ...rest] = args;
    if (rest.length || (choice !== undefined && choice !== 'on' && choice !== 'off')) {
      throw new Error(
        'Use roughbook pictures on, roughbook pictures off, or no argument to see it.'
      );
    }
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const api = await requireApi(context);
    if (!choice) {
      const answer = await readPicturesAnswer(api, link);
      if (answer === undefined) {
        io.err('The project could not be read now. Try again when the server can be reached.');
        return 1;
      }
      io.out(describePicturesAnswer(answer));
      return 0;
    }
    const on = choice === 'on';
    try {
      await answerPictures(api, link, on, outboxFor(repoRoot));
    } catch (error) {
      io.err(describeAnswerError(error));
      return 1;
    }
    io.out(
      on
        ? `${describePicturesAnswer(true)} Turn them off with roughbook pictures off.`
        : `${describePicturesAnswer(false)} Any already uploaded are deleted from Roughbook.`
    );
    return 0;
  }
};
