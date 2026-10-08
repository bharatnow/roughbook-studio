import { readSettings } from '../config/settings.js';
import { saveConsent, telemetryDisabled } from '../telemetry/events.js';
import { requireApi, type Command } from './context.js';

/** The answer in a sentence. */
export function describeConsent(consent: boolean | null): string {
  if (consent === true) return 'This studio shares usage analytics.';
  if (consent === false) return 'This studio shares no usage analytics.';
  return 'Not answered yet, so nothing is shared.';
}

export const telemetry: Command = {
  name: 'telemetry',
  summary: 'Share usage analytics from this studio, or stop; with no argument, say which',
  usage: 'telemetry [on|off]',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    const [choice, ...rest] = args;
    if (rest.length || (choice !== undefined && choice !== 'on' && choice !== 'off')) {
      throw new Error(
        'Use roughbook telemetry on, roughbook telemetry off, or no argument to see it.'
      );
    }
    if (choice) {
      await saveConsent(context, await requireApi(context), choice === 'on');
      io.out(
        choice === 'on'
          ? describeConsent(true)
          : `${describeConsent(false)} What was waiting to be sent is dropped.`
      );
    } else {
      io.out(describeConsent((await readSettings(context.configDir)).analyticsConsent));
    }
    if (telemetryDisabled(context.env)) {
      io.out('ROUGHBOOK_TELEMETRY is off on this machine, so nothing is shared while it is.');
    }
    return 0;
  }
};
