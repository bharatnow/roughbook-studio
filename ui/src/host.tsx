import {
  REVIEW_CHECKS,
  REVIEW_FIELDS,
  UiHostProvider,
  type LinkProps,
  type PromoteResult,
  type UiHost
} from '@roughbook/ui';
import { useMemo, type ReactNode } from 'react';
import { iterationPath, post } from './api';
import { describe, useStudio } from './data';
import { navigate } from './router';

function Anchor({ href, ...rest }: LinkProps) {
  return <a href={`#${href}`} {...rest} />;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** One entry per line, without the empty ones. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * The rating a form gives: 1 to 5, null for none (which takes the designer's back), or nothing
 * when the form has no rating field, as when deselecting.
 */
function rated(form: FormData): { rating?: number | null } {
  if (!form.has('rating')) return {};
  const value = Number(field(form, 'rating'));
  return { rating: Number.isInteger(value) && value >= 1 && value <= 5 ? value : null };
}

/** The iteration a form names in its hidden fields. */
function targetOf(form: FormData) {
  return {
    page: field(form, 'page'),
    component: field(form, 'component'),
    iteration: field(form, 'iterationId')
  };
}

/**
 * What @roughbook/ui's components may do here: the same decisions as on the web, sent to the
 * local server, which queues them in the outbox. Forks start from the run panel instead, since a
 * local fork is a run with an agent.
 */
export function StudioUiHost({ children }: { children: ReactNode }) {
  const { state, refresh, say } = useStudio();
  const devUrl = state?.devUrl ?? 'http://localhost:3000';

  const host = useMemo<UiHost>(() => {
    const decide = async (
      target: { page: string; component: string; iteration: string },
      decision: Record<string, unknown>,
      done: string
    ) => {
      try {
        const { status } = await post<{ status: 'sent' | 'queued' }>(
          `${iterationPath(target.page, target.component, target.iteration)}/decisions`,
          decision
        );
        say({
          tone: 'info',
          text:
            status === 'queued'
              ? `${done} It waits in the outbox until the server can be reached.`
              : done
        });
      } catch (error) {
        say({ tone: 'error', text: describe(error) });
      }
      await refresh();
    };

    return {
      Link: Anchor,
      navigate,
      previewSrc: ({ page, component, iteration }) =>
        `${devUrl}/rough-preview/${page}/${component}/${iteration}`,
      actions: {
        selectIteration: form =>
          decide(
            targetOf(form),
            { kind: 'select', reason: field(form, 'reason'), ...rated(form) },
            'Saved.'
          ),
        rejectIteration: form => {
          const preset = field(form, 'reasonPreset');
          const reason = preset === 'Custom' ? field(form, 'reasonCustom') : preset;
          return decide(
            targetOf(form),
            { kind: 'reject', reason, why: field(form, 'why'), ...rated(form) },
            'Rejected. The next prompt for this project remembers why.'
          );
        },
        rateIteration: form =>
          decide(
            targetOf(form),
            { kind: 'rate', rating: rated(form).rating ?? null },
            'Rating saved.'
          ),
        markPromising: target =>
          decide(target, { kind: 'status', status: 'promising' }, 'Marked promising.'),
        archiveIteration: target =>
          decide(target, { kind: 'status', status: 'archived' }, 'Archived.'),
        saveReview: form => {
          const fields: Record<string, string> = {};
          for (const item of REVIEW_FIELDS) {
            const value = field(form, `field-${item.key}`).trim();
            if (value) fields[item.key] = value;
          }
          const checklist: Record<string, boolean> = {};
          for (const item of REVIEW_CHECKS) {
            if (form.get(`check-${item.key}`)) checklist[item.key] = true;
          }
          return decide(
            targetOf(form),
            {
              kind: 'review',
              decision: field(form, 'decision'),
              reason: field(form, 'reason'),
              observations: lines(field(form, 'observations')),
              fields,
              checklist
            },
            'Review saved.'
          );
        },
        saveCompareNotes: form =>
          decide(
            targetOf(form),
            {
              kind: 'notes',
              likes: lines(field(form, 'likes')),
              dislikes: lines(field(form, 'dislikes'))
            },
            'Notes saved.'
          ),
        saveNotes: form =>
          decide(
            targetOf(form),
            { kind: 'notes', designerNotes: field(form, 'designerNotes') },
            'Notes saved.'
          ),
        promote: async input => {
          const result = await post<PromoteResult>('/api/promote', {
            page: input.page,
            component: input.component,
            iteration: input.iteration,
            targetFile: input.targetFile
          }).catch((error): PromoteResult => ({
            ok: false,
            launched: false,
            message: describe(error),
            commands: [],
            assets: [],
            missingAssets: []
          }));
          await refresh();
          return result;
        }
      }
    };
  }, [devUrl, refresh, say]);

  return <UiHostProvider host={host}>{children}</UiHostProvider>;
}
