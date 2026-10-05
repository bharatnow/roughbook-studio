import { parseArgs } from 'node:util';
import { ApiError, OfflineError } from '../api/errors.js';
import { clearCredentials } from '../config/credentials.js';
import { openApi, type Command } from './context.js';

export const logout: Command = {
  name: 'logout',
  summary: 'Sign this machine out',
  usage: 'logout',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    parseArgs({ args, options: {} });
    const { api, credentials } = await openApi(context);
    if (!credentials) {
      io.out('Not signed in.');
      return 0;
    }
    try {
      await api.logout();
    } catch (error) {
      if (error instanceof OfflineError) {
        io.err(
          `Could not reach ${api.server}. This machine has forgotten its sign-in, but the token works until you remove this studio in the web's settings.`
        );
      } else if (!(error instanceof ApiError && error.status === 401)) {
        throw error;
      }
    }
    await clearCredentials(context.configDir);
    io.out('Signed out.');
    return 0;
  }
};
