import { StatusDot } from '@roughbook/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { useChrome } from './chrome';

const row = 'border-t border-ash py-2 first:border-t-0 first:pt-0';
const term = 'font-mono text-[11px] tracking-[0.08em] text-steel uppercase';

/** The default agent, from here as from the palette. */
export function useMakeDefault() {
  const { refreshState, say } = useStudio();
  const [busy, setBusy] = useState(false);
  async function makeDefault(agent: string) {
    setBusy(true);
    try {
      await post('/api/agents/default', { agent });
      await refreshState();
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setBusy(false);
    }
  }
  return { makeDefault, busy };
}

/**
 * The bar's one status dot (ROUGHBOOK-QUIET-UI-PLAN.md, U5): ready, or asking for attention when
 * the server cannot be reached or decisions wait to be sent. Its popover holds the dev server, the
 * outbox, the agents and the version, which the old bar and overview said all the time.
 */
export function StatusButton() {
  const { state, problem } = useStudio();
  const { statusOpen: open, setStatusOpen: setOpen } = useChrome();
  const { makeDefault, busy } = useMakeDefault();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Opened from the palette: the keyboard comes here, and Tab goes on into the popover.
    if (!root.current?.contains(document.activeElement)) button.current?.focus();
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen]);

  const pending = state?.outbox.pending ?? 0;
  const dropped = state?.outbox.dropped ?? [];
  const attention = Boolean(problem) || pending > 0 || dropped.length > 0;
  const word = problem
    ? 'Cannot reach Roughbook'
    : pending
      ? `${pending} waiting to send`
      : dropped.length
        ? `${dropped.length} not sent`
        : 'Running';
  const found = state?.agents.filter(agent => agent.found) ?? [];

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Studio status: ${word}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex h-9 items-center gap-1 rounded-control px-1.5 text-sm text-slate outline-none hover:bg-frost hover:text-graphite focus-visible:ring-2 focus-visible:ring-violet"
      >
        <StatusDot state={attention ? 'attention' : 'ready'} label={word} focusable={false} />
        <span className="hidden lg:inline">{pending ? `${pending} to send` : null}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-ash bg-canvas p-3 text-sm shadow-[0_8px_30px_rgba(39,40,53,0.14)]"
        >
          <dl>
            {problem ? (
              <div className={row}>
                <dt className={term}>Roughbook</dt>
                <dd className="mt-1 text-danger">{problem}</dd>
              </div>
            ) : null}
            <div className={row}>
              <dt className={term}>Previews</dt>
              <dd className="mt-1">
                {state ? (
                  <a
                    href={state.devUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs break-all text-violet hover:underline"
                  >
                    {state.devUrl}
                  </a>
                ) : null}
                <span className="block text-xs text-slate">The app&apos;s own dev server.</span>
              </dd>
            </div>
            <div className={row}>
              <dt className={term}>Outbox</dt>
              <dd className="mt-1 text-graphite">
                {pending ? `${pending} waiting to send` : 'Nothing waiting'}
                {dropped.map(item => (
                  <span key={item.path + item.droppedAt} className="block text-xs text-danger">
                    Not sent: <span className="font-mono">{item.path}</span> ({item.code})
                  </span>
                ))}
              </dd>
            </div>
            {found.length ? (
              <div className={row}>
                <dt className={term}>Agents</dt>
                <dd className="mt-1">
                  <ul className="flex flex-col gap-1">
                    {found.map(agent => (
                      <li key={agent.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-graphite">
                          {agent.name}
                          <span className="block text-xs text-steel">
                            {agent.version ? `${agent.version} · ` : ''}
                            {agent.signIn ??
                              (agent.signedIn === false ? 'Not signed in' : 'Signed in')}
                            {agent.headless.ready ? ' · can run unattended' : ''}
                          </span>
                        </span>
                        {state?.defaultAgent === agent.id ? (
                          <span className="text-xs text-steel">Default</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void makeDefault(agent.id)}
                            className="min-h-6 shrink-0 text-xs text-violet hover:underline disabled:opacity-50"
                          >
                            Make default
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            <div className={row}>
              <dt className={term}>Version</dt>
              <dd className="mt-1 font-mono text-xs text-graphite">
                {state ? `roughbook ${state.version}` : null}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
