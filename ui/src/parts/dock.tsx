import { StatusDot, cn } from '@roughbook/ui';
import { X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { endedLabel } from '../types';
import { useChrome } from './chrome';
import { RunCard } from './run-card';
import { TerminalView } from './terminal-view';

const control =
  'inline-flex h-8 shrink-0 items-center rounded-control px-2.5 text-sm text-graphite outline-none hover:bg-frost focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50';

/**
 * The terminal dock at the foot of the canvas (ROUGHBOOK-QUIET-UI-PLAN.md, U5): closed until a run
 * starts, then one tab per built-in terminal session, runs' agents and promotions alike, with the
 * run's card beside its session. Esc stays the agent's, so the dock closes with its own button. In
 * a narrow window it covers the canvas below the bar.
 */
export function Dock() {
  const { terminals, runs, refreshRuns, say } = useStudio();
  const { dock, showSession, closeDock } = useChrome();
  const [busy, setBusy] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  if (!dock.open || !terminals.length) return null;
  const active = terminals.find(item => item.id === dock.session) ?? terminals.at(-1)!;
  const run = active.runId ? runs.find(item => item.runId === active.runId) : undefined;

  async function act(path: string) {
    setBusy(true);
    try {
      await post(path);
      await refreshRuns();
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setBusy(false);
    }
  }

  // Left and right move between the tabs, as in any tab list.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const at = terminals.findIndex(item => item.id === active.id);
    const next =
      terminals[(at + (event.key === 'ArrowRight' ? 1 : -1) + terminals.length) % terminals.length];
    if (!next) return;
    event.preventDefault();
    showSession(next.id);
    window.requestAnimationFrame(() =>
      tabs.current?.querySelector<HTMLElement>(`[data-session="${next.id}"]`)?.focus()
    );
  }

  return (
    <section
      aria-label="Terminals"
      className="z-30 flex shrink-0 flex-col border-t border-ash bg-canvas max-md:fixed max-md:inset-x-0 max-md:top-12 max-md:bottom-0 md:h-[min(45dvh,440px)]"
    >
      <div className="flex h-11 items-center gap-1 border-b border-ash px-2">
        <div
          ref={tabs}
          role="tablist"
          aria-label="Sessions"
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {terminals.map(session => {
            const selected = session.id === active.id;
            return (
              <button
                key={session.id}
                type="button"
                role="tab"
                data-session={session.id}
                aria-selected={selected}
                aria-controls="dock-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => showSession(session.id)}
                className={cn(
                  'inline-flex h-8 max-w-56 shrink-0 items-center gap-1 rounded-control px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-violet',
                  selected ? 'bg-frost text-graphite' : 'text-slate hover:text-graphite'
                )}
              >
                <StatusDot
                  state={session.status === 'running' ? 'making' : 'none'}
                  label={endedLabel(session)}
                  focusable={false}
                  className="-ml-1"
                />
                <span className="truncate">{session.title}</span>
              </button>
            );
          })}
        </div>
        {active.status === 'running' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(`/api/terminals/${active.id}/stop`)}
            className={control}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            title="Let this ended session go"
            onClick={() => void act(`/api/terminals/${active.id}/remove`)}
            className={control}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={closeDock}
          aria-label="Close the terminals"
          title="Close the terminals; the sessions keep running"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-slate outline-none hover:bg-frost hover:text-graphite focus-visible:ring-2 focus-visible:ring-violet"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div id="dock-panel" role="tabpanel" className="flex min-h-0 flex-1 gap-3 p-2">
        <div className="min-h-0 min-w-0 flex-1">
          <TerminalView key={active.id} id={active.id} onExit={() => void refreshRuns()} />
        </div>
        {run ? (
          <aside aria-label="Its run" className="hidden w-72 shrink-0 overflow-y-auto lg:block">
            <RunCard run={run} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
