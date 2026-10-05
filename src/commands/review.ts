import { parseArgs } from 'node:util';
import { outboxFor } from '../api/outbox.js';
import { requireRepoLink } from '../repo/link.js';
import { sendDecision, type Decision } from '../runs/reviews.js';
import { requireApi, type Command } from './context.js';
import { parseIteration } from './shared.js';

const DECISIONS = ['explore', 'refine', 'select', 'reject'] as const;

export const review: Command = {
  name: 'review',
  summary: 'Select, reject or note observations on a local iteration',
  usage:
    'review <page>/<component>/<iteration> (--select [--reason <text>] | --reject <reason> [--why <text>] | --note <observation>...)',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        select: { type: 'boolean', default: false },
        reason: { type: 'string' },
        reject: { type: 'string' },
        why: { type: 'string' },
        note: { type: 'string', multiple: true },
        decision: { type: 'string' }
      }
    });
    const target = parseIteration(positionals[0]);
    const asked = [values.select, values.reject !== undefined, Boolean(values.note?.length)];
    if (asked.filter(Boolean).length !== 1) {
      throw new Error('Choose one: --select, --reject "<reason>", or --note "<observation>".');
    }

    let decision: Decision;
    if (values.select) {
      decision = { kind: 'select', reason: values.reason };
    } else if (values.reject !== undefined) {
      if (!values.reject.trim())
        throw new Error('A rejection needs a reason; it teaches the next prompt.');
      decision = { kind: 'reject', reason: values.reject, why: values.why };
    } else {
      const wanted = values.decision;
      if (wanted !== undefined && !(DECISIONS as readonly string[]).includes(wanted)) {
        throw new Error(`--decision is one of ${DECISIONS.join(', ')}.`);
      }
      decision = {
        kind: 'review',
        observations: values.note,
        ...(wanted ? { decision: wanted as (typeof DECISIONS)[number] } : {}),
        ...(values.reason ? { reason: values.reason } : {})
      };
    }

    const repoRoot = context.repoRoot!;
    const result = await sendDecision(
      await requireApi(context),
      outboxFor(repoRoot),
      await requireRepoLink(repoRoot),
      target,
      decision
    );
    if (result.status === 'queued') {
      io.out('Saved in the outbox; it goes to the server when it can be reached.');
      return 0;
    }
    if (decision.kind === 'select') {
      // Selecting the selected iteration clears the selection, as on the web.
      const iterations = Array.isArray(result.data)
        ? (result.data as { id: string; status: string }[])
        : [];
      const now = iterations.find(item => item.id === target.iteration)?.status;
      io.out(now === 'selected' ? `${target.iteration} is selected.` : 'The selection is cleared.');
    } else {
      io.out(decision.kind === 'reject' ? `${target.iteration} is rejected.` : 'Review saved.');
    }
    return 0;
  }
};
