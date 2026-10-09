import { parseArgs } from 'node:util';
import { ALL_AGENTS } from '../agents/index.js';
import { readSettings, saveSettings } from '../config/settings.js';
import type { Command } from './context.js';
import { chooseAgent, sendHeartbeat } from './shared.js';

export const agents: Command = {
  name: 'agents',
  summary: 'List the coding agents and editors found here, and choose the default',
  usage: 'agents [--default <agent>]',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({ args, options: { default: { type: 'string' } } });
    if (values.default !== undefined) {
      const { adapter } = await chooseAgent(context, values.default);
      await saveSettings(context.configDir, { defaultAgent: adapter.id });
      io.out(`${adapter.name} is now the default agent.`);
      io.out('');
    }

    const settings = await readSettings(context.configDir);
    const detections = await Promise.all(ALL_AGENTS.map(adapter => context.detect(adapter)));
    for (const detection of detections) {
      const mark = detection.id === settings.defaultAgent ? '*' : ' ';
      if (!detection.found) {
        io.out(`${mark} ${detection.name} (${detection.id}): not found`);
        continue;
      }
      if (detection.id === 'other') {
        io.out(`${mark} ${detection.name} (other): opens the prompt with your default app`);
        continue;
      }
      io.out(
        `${mark} ${detection.name} (${detection.id}): ${detection.version ?? 'version unknown'}, from ${detection.executable?.source ?? 'unknown'}`
      );
      if (detection.kind === 'editor') {
        io.out(`    Opens:      the prompt in ${detection.name}, the instruction on the clipboard`);
        continue;
      }
      io.out(`    Signed in:  ${detection.signIn ?? 'it does not say'}`);
      io.out(
        `    Unattended: ${detection.headless.ready ? 'ready (roughbook run --headless)' : detection.headless.reason}`
      );
    }
    if (!settings.defaultAgent) {
      io.out('');
      io.out(
        'No default yet: roughbook run uses the first one found, terminal agents before editors. Set one with --default.'
      );
    }
    await sendHeartbeat(context, detections);
    return 0;
  }
};
