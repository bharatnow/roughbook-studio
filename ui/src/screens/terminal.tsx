import { useState } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { RunCard } from '../parts/run-card';
import { TerminalView } from '../parts/terminal-view';
import { endedLabel } from '../types';

/** One session, full height, with its run's Done beside it. */
export function TerminalScreen({ id }: { id: string }) {
  const { terminals, runs, refreshRuns, say } = useStudio();
  const [stopping, setStopping] = useState(false);
  const session = terminals.find(item => item.id === id);
  const run = session?.runId ? runs.find(item => item.runId === session.runId) : undefined;
  const back = run ? `#/${run.page}/${run.component}/iterations` : '#/';

  if (!session) {
    return (
      <p className="text-sm text-slate">
        This session has ended and was let go.{' '}
        <a href="#/" className="text-violet hover:underline">
          Back to the project
        </a>
      </p>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <a href={back} className="text-sm text-violet hover:underline">
              Back
            </a>
            <h1 className="font-display text-lg tracking-tight text-graphite">{session.title}</h1>
          </div>
          {session.status === 'running' ? (
            <button
              type="button"
              disabled={stopping}
              onClick={async () => {
                setStopping(true);
                try {
                  await post(`/api/terminals/${id}/stop`);
                  await refreshRuns();
                } catch (error) {
                  say({ tone: 'error', text: describe(error) });
                } finally {
                  setStopping(false);
                }
              }}
              className="inline-flex h-8 items-center rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost disabled:opacity-50"
            >
              Stop the agent
            </button>
          ) : (
            <span className="font-mono text-xs text-steel">{endedLabel(session)}</span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <TerminalView id={id} onExit={() => void refreshRuns()} />
        </div>
      </div>
      {run ? (
        <aside className="w-full shrink-0 lg:w-80">
          <ul>
            <RunCard run={run} />
          </ul>
          <p className="mt-3 text-xs text-steel">
            When the agent says it has finished, press Done: the studio checks the iteration, lists
            any file changed outside it, and takes screenshots.
          </p>
          <a
            href={`#/${run.page}/${run.component}/${run.iteration}`}
            className="mt-3 inline-flex text-sm text-violet hover:underline"
          >
            Look at {run.iteration}
          </a>
        </aside>
      ) : null}
    </div>
  );
}
