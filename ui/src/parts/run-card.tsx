import { Drawer, formatRelativeTime } from '@roughbook/ui';
import { useState } from 'react';
import { get, post } from '../api';
import { describe, useStudio } from '../data';
import { finishedBy, runRunning, runWord } from '../runs';
import { useDialogFocus } from './dialog-focus';
import type { RunView } from '../types';

const button =
  'inline-flex h-8 items-center rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost disabled:opacity-50';

const REVERTED: Record<string, string> = {
  restored: 'put back as it was before the run',
  removed: 'removed, since the run created it',
  unchanged: 'already as it was before the run',
  cannot: 'not kept by the studio; restore it from git or your editor'
};

/** The agent's name as the studio found it, or its id. */
export function useAgentName(id: string): string {
  const { state } = useStudio();
  return state?.agents.find(agent => agent.id === id)?.name ?? id;
}

/** What changed outside the iteration, and which of it the designer says was their own work. */
type WhoseChanges = { files: string[]; mine: string[]; outcome?: 'failed' | 'cancelled' };

/**
 * What can be done to a run: Done (which first asks whose the files changed outside its iteration
 * were), It failed, Cancel it, Stop, Copy prompt, and Put it back for a file after. For the run
 * card and for a making card's toolbar on the canvas.
 */
export function useRunOps(run: RunView) {
  const { refresh, say } = useStudio();
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<WhoseChanges | null>(null);

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

  return {
    busy,
    review,
    setReview,
    finish: (outcome?: 'failed' | 'cancelled') =>
      act('done', async () => {
        const { outOfScope } = await get<{ outOfScope: string[] }>(`/api/runs/${run.runId}/checks`);
        if (outOfScope.length) {
          setReview({ files: outOfScope, mine: [], outcome });
          return null;
        }
        await post(`/api/runs/${run.runId}/done`, outcome ? { outcome } : {});
        return null;
      }),
    complete: (choice: WhoseChanges) =>
      act('done', async () => {
        await post(`/api/runs/${run.runId}/done`, {
          ...(choice.outcome ? { outcome: choice.outcome } : {}),
          mine: choice.mine
        });
        setReview(null);
        return null;
      }),
    stop: () =>
      act('stop', async () => {
        await post(`/api/runs/${run.runId}/stop`);
        return 'Stopped the agent.';
      }),
    copyPrompt: () =>
      act('copy', async () => {
        const { prompt } = await get<{ prompt: string }>(`/api/runs/${run.runId}/prompt`);
        await navigator.clipboard.writeText(prompt);
        return 'The prompt is on the clipboard.';
      }),
    putBack: (file: string) =>
      act(`revert:${file}`, async () => {
        const { result } = await post<{ result: string }>(`/api/runs/${run.runId}/revert`, {
          file
        });
        return `${file}: ${REVERTED[result] ?? result}.`;
      })
  };
}

export type RunOps = ReturnType<typeof useRunOps>;

/**
 * One run: while it goes, how to reach it and finish it; after, how it ended in a word and what the
 * checks found. `compact` leaves out which iteration it made, for the inspector of that iteration;
 * `terminal={false}` its way to the terminal, for the dock that shows it.
 */
export function RunCard({
  run,
  compact = false,
  terminal = true
}: {
  run: RunView;
  compact?: boolean;
  terminal?: boolean;
}) {
  const agent = useAgentName(run.agent);
  const ops = useRunOps(run);
  const { busy, review, setReview } = ops;
  const open = run.status === 'started';
  const running = runRunning(run);
  const by = finishedBy(run);
  const label = `${run.iteration} · ${run.kind === 'generate' ? 'new direction' : `${run.kind} of ${run.parent}`}`;

  return (
    <div className={compact ? 'text-sm' : 'rounded-card border border-ash bg-canvas p-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {compact ? null : <span className="block font-mono text-xs text-graphite">{label}</span>}
          <span className={compact ? 'block text-graphite' : 'block text-xs text-steel'}>
            {agent} · {run.mode} · {formatRelativeTime(run.startedAt)}
            {by ? <span title={by.sentence}> · {by.word}</span> : null}
            {run.reported === 'queued' ? (
              <span title="The result waits in the outbox until the server can be reached.">
                {' '}
                · queued
              </span>
            ) : null}
          </span>
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
          {runWord(run)}
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
          onFinish={() => void ops.complete(review)}
          onBack={() => setReview(null)}
        />
      ) : open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {run.terminal && terminal ? (
            <a href={`#/terminals/${run.terminal.id}`} className={button}>
              Terminal
            </a>
          ) : null}
          <button
            type="button"
            className={button}
            disabled={busy !== null}
            onClick={() => void ops.copyPrompt()}
          >
            Copy prompt
          </button>
          <button
            type="button"
            disabled={busy !== null || run.headless?.status === 'running'}
            onClick={() => void ops.finish()}
            className="inline-flex h-8 items-center rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
          >
            {busy === 'done' ? 'Checking' : 'Done'}
          </button>
          {running ? (
            <button
              type="button"
              className={button}
              disabled={busy !== null}
              onClick={() => void ops.stop()}
            >
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void ops.finish('failed')}
              >
                It failed
              </button>
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void ops.finish('cancelled')}
              >
                Cancel it
              </button>
            </>
          )}
        </div>
      ) : run.failure || run.warnings.length || run.outOfScope.length || run.mine?.length ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {run.failure ? <li className="text-danger">{run.failure.message}</li> : null}
          {run.warnings.map(warning => (
            <li key={warning.code + warning.message} className="text-slate">
              <span className="font-mono text-[10px] text-steel">{warning.code}</span>{' '}
              {warning.message}
            </li>
          ))}
          {run.outOfScope.map(file => (
            <li key={file} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-graphite">{file}</span>
              {run.putBack?.includes(file) ? (
                <span className="text-steel">Put back</span>
              ) : (
                <button
                  type="button"
                  className="min-h-6 text-violet hover:underline disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => void ops.putBack(file)}
                >
                  Put it back
                </button>
              )}
            </li>
          ))}
          {run.mine?.length ? (
            <li className="text-steel">
              Yours, not counted: <span className="font-mono">{run.mine.join(', ')}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Before Done, as a drawer: for a making card's Done on the canvas, which has no card to grow. */
export function WhoseChangesDrawer({ run, ops }: { run: RunView; ops: RunOps }) {
  const { review, setReview, busy } = ops;
  useDialogFocus(review !== null);
  return (
    <Drawer
      open={review !== null}
      onClose={() => setReview(null)}
      title={`Finish ${run.iteration}`}
    >
      {review ? (
        <WhoseChangesPanel
          review={review}
          busy={busy !== null}
          onChange={mine => setReview({ ...review, mine })}
          onFinish={() => void ops.complete(review)}
          onBack={() => setReview(null)}
        />
      ) : null}
    </Drawer>
  );
}

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
        open. Tick what was your own work; the rest counts as the agent&apos;s and can be put back
        after.
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
