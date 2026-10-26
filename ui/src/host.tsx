import {
  REVIEW_CHECKS,
  REVIEW_FIELDS,
  UiHostProvider,
  type LinkProps,
  type PromoteCommitResult,
  type PromoteFinish,
  type PromoteResult,
  type UiHost
} from '@roughbook/ui';
import { useMemo, type ReactNode } from 'react';
import { iterationPath, post, promotePath } from './api';
import { describe, useStudio } from './data';
import { pickedAddress } from './in-page';
import { navigate } from './router';

/** The screens are in the fragment. `prefetch` is for hosts that load pages ahead; an anchor drops it. */
function Anchor({ href, prefetch, ...rest }: LinkProps) {
  void prefetch;
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
  // The preview's path comes from the repo's environment, whatever the stack.
  const previewTemplate = state?.environment.preview ?? '/rough-preview/{key}';

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

    /** Adopts from the map; a refusal is thrown in words, for the list to show beside it. */
    const adopt = async (body: Record<string, string | boolean>) => {
      let answer: { lines: string[] };
      try {
        answer = await post<{ lines: string[] }>('/api/adopt', body);
      } catch (error) {
        throw new Error(describe(error));
      }
      say({ tone: 'info', text: answer.lines.join(' ') });
      await refresh();
    };

    return {
      Link: Anchor,
      navigate,
      previewSrc: ({ page, component, iteration }) =>
        `${devUrl}${previewTemplate.replaceAll('{key}', `${page}/${component}/${iteration}`)}`,
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
            targetFile: input.targetFile,
            ...(input.branch ? { branch: input.branch } : {})
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
        },
        // The promote's finish, back in the app's own files (B4 of the brownfield plan).
        finishPromotion: async target => {
          const finished = await post<PromoteFinish>(
            `${promotePath(target.page, target.component, target.iteration)}/finish`
          );
          await refresh();
          return finished;
        },
        revertPromoteFile: async input => {
          await post(`${promotePath(input.page, input.component, input.iteration)}/revert`, {
            path: input.path
          });
        },
        commitPromotion: input =>
          post<PromoteCommitResult>(
            `${promotePath(input.page, input.component, input.iteration)}/commit`,
            { commit: input.commit }
          ).catch((error): PromoteCommitResult => ({ ok: false, message: describe(error) })),
        // The map's list (B2 of the brownfield plan): names reach the server, nothing else.
        adopt: ({ page, component }) => adopt(component ? { page, component } : { page }),
        // The list asked first, with the count, above 50 components (decision 29).
        adoptAll: () => adopt({ all: true, yes: true }),
        // A click on the app's page picked a section (B5): the canvas, with it selected.
        pickSection: key => {
          const to = pickedAddress(key);
          if (to) navigate(to);
        },
        // A page's composition (B6): a new section by its name, and Save, through the local server.
        addPageSection: async ({ page, name }) => {
          let made: { slug: string; name: string };
          try {
            made = await post<{ slug: string; name: string }>('/api/sections', { page, name });
          } catch (error) {
            throw new Error(describe(error));
          }
          say({
            tone: 'info',
            text: `Made ${made.name}, a new section. Its first iteration is a run: start one on the canvas.`
          });
          await refresh();
          return made;
        },
        saveComposition: async ({ page, name, parent, sections }) => {
          try {
            const saved = await post<{ id: string; number: number; lines: string[] }>(
              '/api/compositions',
              { page, name, parent, sections }
            );
            await refresh();
            return { ok: true, message: `Saved ${saved.id}.`, id: saved.id };
          } catch (error) {
            return { ok: false, message: describe(error) };
          }
        }
      }
    };
  }, [devUrl, previewTemplate, refresh, say]);

  return <UiHostProvider host={host}>{children}</UiHostProvider>;
}
