import { parseArgs } from 'node:util';
import { ApiError, OfflineError } from '../api/errors.js';
import { outboxFor } from '../api/outbox.js';
import { readLocalLink, readRepoLink } from '../repo/link.js';
import { openApi, type Command } from './context.js';

export const status: Command = {
  name: 'status',
  summary: 'Show the sign-in, the linked project and what is waiting to be sent',
  usage: 'status',
  needsRepo: false,
  async run(args, context) {
    const { io } = context;
    parseArgs({ args, options: {} });
    const { api, credentials } = await openApi(context);
    io.out(`Server:     ${api.server}`);

    let projects: Awaited<ReturnType<typeof api.projects>> | null = null;
    if (!credentials) {
      io.out('Signed in:  no (run roughbook login)');
    } else {
      try {
        const me = await api.me();
        io.out(`Signed in:  ${me.user.email}`);
        projects = await api.projects();
      } catch (error) {
        if (error instanceof OfflineError) {
          io.out(`Signed in:  ${credentials.signedInAs ?? 'yes'} (the server cannot be reached)`);
        } else if (error instanceof ApiError && error.status === 401) {
          io.out('Signed in:  no longer (run roughbook login)');
        } else {
          throw error;
        }
      }
    }

    if (!context.repoRoot) {
      io.out('Repo:       not in a linked repo');
      return 0;
    }
    io.out(`Repo:       ${context.repoRoot}`);
    const link = await readRepoLink(context.repoRoot);
    if (link) {
      const org = projects?.find(item => item.id === link.orgId);
      const project = org?.projects.find(item => item.slug === link.project);
      io.out(
        `Project:    ${project ? `${project.name} (${link.project})` : link.project}${org ? ` in ${org.name}` : ''}`
      );
      io.out(`rough/:     ${link.roughCommitted ? 'committed to git' : 'not committed'}`);
      if (!(await readLocalLink(context.repoRoot))) {
        io.out('            not linked on this machine yet (run roughbook init)');
      }
    }
    const outbox = outboxFor(context.repoRoot);
    const pending = await outbox.pending();
    const dropped = await outbox.dropped();
    io.out(`Waiting:    ${pending.length ? `${pending.length} to send` : 'nothing to send'}`);
    if (dropped.length) io.out(`Refused:    ${dropped.length} the server would not accept`);
    return 0;
  }
};
