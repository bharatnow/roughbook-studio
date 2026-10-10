import { formatRelativeTime } from '@roughbook/ui';
import { useState } from 'react';
import { get, post } from '../api';
import { describe, useStudio } from '../data';
import type { RunView } from '../types';

const button =
  'inline-flex h-8 items-center rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost disabled:opacity-50';

const OUTCOMES: Record<string, string> = {
  completed: 'Completed',
  completed_with_warnings: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

const REVERTED: Record<string, string> = {
  restored: 'put back as it was before the run',
  removed: 'removed, since the run created it',
  unchanged: 'already as it was before the run',
  cannot: 'not kept by the studio; restore it from git or your editor'
};

/** One run: while it goes, how to reach it and finish it; after, what the checks found. */
export function RunCard({ run }: { run: RunView }) {
  const { refresh, say } = useStudio();
  const [busy, setBusy] = useState<string | null>(null);
  const open = run.status === 'started';
  const running = run.terminal?.status === 'running' || run.headless?.status === 'running';
  const label = `${run.iteration} · ${run.kind === 'generate' ? 'new direction' : `${run.kind} of ${run.parent}`}`;

  async function act(name: string, work: () => Promise<string | null>) {
    setBusy(name);
    try {
      const text = await work();
      if (text) say({ tone: 'info', text });
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  const [review, setReview] = useState<WhoseChanges | null>(null);

  /** Done: first what changed outside the iteration, for the designer to say whose it was. */
  const finish = (outcome?: 'failed' | 'cancelled') =>
    act('done', async () => {
      const { outOfScope } = await get<{ outOfScope: string[] }>(`/api/runs/${run.runId}/checks`);
      if (outOfScope.length) {
        setReview({ files: outOfScope, mine: [], outcome });
        return null;
      }
      await post(`/api/runs/${run.runId}/done`, outcome ? { outcome } : {});
      return null;
    });

  const complete = (choice: WhoseChanges) =>
    act('done', async () => {
      await post(`/api/runs/${run.runId}/done`, {
        ...(choice.outcome ? { outcome: choice.outcome } : {}),
        mine: choice.mine
      });
      setReview(null);
      return null;
    });

  return (
    <li className="rounded-card border border-ash bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-graphite">{label}</p>
          <p className="text-xs text-steel">
            {run.agent} · {run.mode} · started {formatRelativeTime(run.startedAt)}
          </p>
        </div>
        <span
          className={`inline-flex h-5 items-center rounded-full px-2 font-mono text-[11px] ${
            open
              ? 'bg-violet/10 text-violet'
              : run.outcome === 'failed'
                ? 'bg-danger/10 text-danger'
                : 'bg-frost text-slate'
          }`}
        >
          {open
            ? running
              ? 'Working'
              : 'Waiting for Done'
            : (OUTCOMES[run.outcome ?? ''] ?? 'Finished')}
        </span>
      </div>

      {run.headless?.lines.length ? (
        <pre className="mt-2 max-h-32 overflow-auto rounded-control bg-cloud px-2 py-1 font-mono text-[11px] text-slate">
          {run.headless.lines.slice(-8).join('\n')}
        </pre>
      ) : null}
      {run.headless?.error ? (
        <p className="mt-2 text-xs text-danger">{run.headless.error}</p>
      ) : null}

      {open && review ? (
        <WhoseChangesPanel
          review={review}
          busy={busy !== null}
          onChange={mine => setReview({ ...review, mine })}
          onFinish={() => void complete(review)}
          onBack={() => setReview(null)}
        />
      ) : open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {run.terminal ? (
            <a href={`#/terminals/${run.terminal.id}`} className={button}>
              {run.terminal.status === 'running' ? 'Open the terminal' : 'See the session'}
            </a>
          ) : null}
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() =>
              act('copy', async () => {
                const { prompt } = await get<{ prompt: string }>(`/api/runs/${run.runId}/prompt`);
                await navigator.clipboard.writeText(prompt);
                return 'The prompt is on the clipboard.';
              })
            }
          >
            Copy prompt
          </button>
          <button
            type="button"
            disabled={busy !== null || run.headless?.status === 'running'}
            onClick={() => void finish()}
            className="inline-flex h-8 items-center rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
          >
            {busy === 'done' ? 'Checking' : 'Done'}
          </button>
          {running ? (
            <button
              type="button"
              className={button}
              disabled={busy !== null}
              onClick={() =>
                act('stop', async () => {
                  await post(`/api/runs/${run.runId}/stop`);
                  return 'Stopped the agent.';
                })
              }
            >
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void finish('failed')}
              >
                It failed
              </button>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void finish('cancelled')}
              >
                Cancel it
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {run.failure ? <p className="text-danger">{run.failure.message}</p> : null}
          {run.warnings.map(warning => (
            <p key={warning.code + warning.message} className="text-slate">
              <span className="font-mono text-[10px] text-steel">{warning.code}</span>{' '}
              {warning.message}
            </p>
          ))}
          {run.outOfScope.length ? (
            <ul className="mt-1 flex flex-col gap-1">
              {run.outOfScope.map(file => (
                <li key={file} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-graphite">{file}</span>
                  <button
                    type="button"
                    className="text-violet hover:underline disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() =>
                      act(`revert:${file}`, async () => {
                        const { result } = await post<{ result: string }>(
                          `/api/runs/${run.runId}/revert`,
                          { file }
                        );
                        return `${file}: ${REVERTED[result] ?? result}.`;
                      })
                    }
                  >
                    Put it back
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {run.mine?.length ? (
            <p className="text-steel">
              Yours, not counted: <span className="font-mono">{run.mine.join(', ')}</span>
            </p>
          ) : null}
          {run.reported === 'queued' ? (
            <p className="text-steel">
              The result waits in the outbox until the server can be reached.
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** What changed outside the iteration, and which of it the designer says was their own work. */
type WhoseChanges = { files: string[]; mine: string[]; outcome?: 'failed' | 'cancelled' };

/** Before Done: the files changed outside the iteration, each to tick as the designer's own. */
function WhoseChangesPanel({
  review,
  busy,
  onChange,
  onFinish,
  onBack
}: {
  review: WhoseChanges;
  busy: boolean;
  onChange: (mine: string[]) => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const count = review.files.length;
  const toggle = (file: string) =>
    onChange(
      review.mine.includes(file)
        ? review.mine.filter(item => item !== file)
        : [...review.mine, file]
    );
  return (
    <div className="mt-3 rounded-card border border-ash bg-frost p-3 text-xs">
      <p className="text-graphite">
        {count} {count === 1 ? 'file' : 'files'} changed outside the iteration while the run was
        open. Tick what was your own work; the rest counts as the agent's and can be put back after.
      </p>
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          className="min-h-6 text-violet hover:underline"
          onClick={() => onChange(review.files)}
        >
          All mine
        </button>
        <button
          type="button"
          className="min-h-6 text-violet hover:underline"
          onClick={() => onChange([])}
        >
          None
        </button>
      </div>
      <ul className="mt-1 max-h-48 overflow-auto">
        {review.files.map(file => (
          <li key={file}>
            <label className="flex min-h-6 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={review.mine.includes(file)}
                onChange={() => toggle(file)}
              />
              <span className="font-mono break-all text-graphite">{file}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onFinish}
          className="inline-flex h-8 items-center rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
        >
          {busy ? 'Checking' : 'Finish'}
        </button>
        <button type="button" disabled={busy} onClick={onBack} className={button}>
          Back
        </button>
      </div>
    </div>
  );
}
