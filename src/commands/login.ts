import { parseArgs } from 'node:util';
import { ApiError, OfflineError } from '../api/errors.js';
import { saveCredentials } from '../config/credentials.js';
import { currentOs } from '../launch/platform.js';
import { STUDIO_VERSION } from '../version.js';
import { openApi, type Command } from './context.js';

/** Consecutive unreachable polls before giving up. */
const OFFLINE_TRIES = 5;

export const login: Command = {
  name: 'login',
  summary: 'Sign this machine in to Roughbook',
  usage: 'login [--server <url>] [--no-browser]',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: { server: { type: 'string' }, 'no-browser': { type: 'boolean' } }
    });
    const { api, credentials } = await openApi(context, values.server);

    if (credentials) {
      try {
        const me = await api.me();
        io.out(`Signed in to ${api.server} as ${me.user.email} already.`);
        io.out('Run roughbook logout first to sign in as someone else.');
        return 0;
      } catch (error) {
        // A token removed on the web: sign in afresh.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    }

    const anonymous = api.signedOut();
    const login = await anonymous.startDeviceLogin({
      studioVersion: STUDIO_VERSION,
      os: currentOs()
    });
    io.out(`To sign in, open ${login.verificationUri} and enter this code:`);
    io.out('');
    io.out(`    ${login.userCode}`);
    io.out('');
    if (!values['no-browser'] && (await context.openUrl(login.verificationUriComplete))) {
      io.out('Your browser should have opened the page.');
    }
    io.out('Waiting for you to approve it…');

    let interval = login.interval * 1000;
    let offline = 0;
    const tries = Math.ceil(login.expiresIn / login.interval) + OFFLINE_TRIES;
    for (let attempt = 0; attempt < tries; attempt++) {
      await context.sleep(interval);
      try {
        const issued = await anonymous.pollDeviceLogin(login.deviceCode);
        const me = await anonymous.withToken(issued.token).me();
        await saveCredentials(context.configDir, {
          server: api.server,
          installId: issued.installId,
          token: issued.token,
          signedInAs: me.user.email,
          savedAt: new Date().toISOString()
        });
        io.out(`Signed in to ${api.server} as ${me.user.email}.`);
        io.out('Next, run roughbook init in the repo you want to design in.');
        return 0;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'AUTHORIZATION_PENDING') continue;
          if (error.code === 'SLOW_DOWN') {
            interval += 5000;
            continue;
          }
          if (error.code === 'ACCESS_DENIED') {
            io.err('The sign-in was turned away. Run roughbook login to try again.');
            return 1;
          }
          if (error.code === 'EXPIRED_TOKEN') {
            io.err('The code expired before it was approved. Run roughbook login again.');
            return 1;
          }
          throw error;
        }
        if (error instanceof OfflineError && ++offline < OFFLINE_TRIES) continue;
        throw error;
      }
    }
    io.err('The code expired before it was approved. Run roughbook login again.');
    return 1;
  }
};
