import { StatusDot, Switch } from '@roughbook/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { activityView } from '../activity';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { completeFeaturesOf, switchCompleteFeatures } from '../features';
import { useChrome } from './chrome';

const row = 'border-t border-ash py-2 first:border-t-0 first:pt-0';
const term = 'font-mono text-[11px] tracking-[0.08em] text-steel uppercase';

/**
 * The default agent, from here as from the palette. A refusal is kept in words for the caller to
 * show beside its control, and returned, so a caller without one can say it its own way.
 */
export function useMakeDefault() {
  const { refreshState } = useStudio();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  async function makeDefault(agent: string): Promise<string | null> {
    setBusy(true);
    try {
      await post('/api/agents/default', { agent });
      await refreshState();
      setRefusal(null);
      return null;
    } catch (error) {
      const words = describe(error);
      setRefusal(words);
      return words;
    } finally {
      setBusy(false);
    }
  }
  return { makeDefault, busy, refusal };
}

/**
 * The Complete features switch (A7 of ROUGHBOOK-APPLE-PLAN.md), the studio's settings: for this
 * person everywhere, so the web shows the same. A refusal stays beside it in words.
 */
function CompleteFeaturesSwitch() {
  const { state, refreshState } = useStudio();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  async function toggle(on: boolean) {
    setBusy(true);
    const result = await switchCompleteFeatures(on, { post, refresh: refreshState });
    setRefusal(result.ok ? null : result.message);
    setBusy(false);
  }
  return (
    <>
      <Switch
        label="Complete features"
        checked={completeFeaturesOf(state)}
        disabled={busy || !state}
        onChange={event => void toggle(event.target.checked)}
        className="w-full text-graphite"
      />
      <span className="block text-xs text-slate">
        Every tool, as on the web. Off keeps the everyday ones.
      </span>
      {refusal ? (
        <span role="alert" className="block text-xs text-danger">
          {refusal}
        </span>
      ) : null}
    </>
  );
}

/** The app's state in a word, for the status popover. */
const APP_WORDS: Record<string, string> = {
  unknown: 'Not asked yet',
  starting: 'Starting',
  up: 'Answering',
  down: 'Not answering'
};

/**
 * The bar's one status dot (ROUGHBOOK-QUIET-UI-PLAN.md, U5): ready, or asking for attention when
 * the server cannot be reached or decisions wait to be sent. Its popover holds the dev server, the
 * outbox, the agents and the version, which the old bar and overview said all the time.
 */
export function StatusButton() {
  const { state, problem, refreshState } = useStudio();
  const { statusOpen: open, setStatusOpen: setOpen } = useChrome();
  const { makeDefault, busy, refusal: defaultRefusal } = useMakeDefault();
  const [starting, setStarting] = useState(false);
  // What Start the app answered, in words beside it.
  const [startNote, setStartNote] = useState<{ text: string; error: boolean } | null>(null);
  async function startApp() {
    setStarting(true);
    try {
      const result = await post<{ started: boolean; reason: string | null }>('/api/app/start');
      setStartNote({
        text: result.started
          ? 'Starting the app; its session is in the terminals.'
          : (result.reason ?? 'The app was not started.'),
        error: false
      });
      await refreshState();
    } catch (error) {
      setStartNote({ text: describe(error), error: true });
    } finally {
      setStarting(false);
    }
  }
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
  const environmentProblem = state?.environmentProblem ?? null;
  // What the agents are doing (A8 step 5): a spin while one works, words when one may be waiting.
  const activity = activityView(state);
  const attention =
    Boolean(problem) ||
    Boolean(environmentProblem) ||
    pending > 0 ||
    dropped.length > 0 ||
    Boolean(activity?.attention);
  const canStart = Boolean(
    state?.environment.start.command &&
    state.environment.start.approved &&
    state.terminal.builtin &&
    state.app.status === 'down'
  );
  const word = problem
    ? 'Cannot reach Roughbook'
    : activity?.attention
      ? activity.word
      : pending
        ? `${pending} waiting to send`
        : dropped.length
          ? `${dropped.length} not sent`
          : (activity?.word ?? 'Running');
  // Beside the dot on a wide bar: what to send, or what the agents are doing.
  const shown = pending ? `${pending} to send` : (activity?.word ?? null);
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
        className="inline-flex h-9 items-center gap-1 rounded-control px-1.5 text-sm text-slate hover:bg-frost hover:text-graphite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {activity?.spinning && !attention ? (
          <span
            role="img"
            aria-label={word}
            className="inline-flex size-6 shrink-0 items-center justify-center"
          >
            <span
              aria-hidden
              className="size-3 rounded-full border-2 border-ash border-t-graphite motion-safe:animate-spin forced-colors:border-[CanvasText]"
            />
          </span>
        ) : (
          <StatusDot state={attention ? 'attention' : 'ready'} label={word} focusable={false} />
        )}
        <span className="hidden lg:inline">{shown}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-ash bg-canvas p-3 text-sm shadow-elevation-1"
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
                <span className="block text-xs text-slate">
                  {state
                    ? `${state.environment.mode === 'live' ? "The app's own dev server" : state.environment.mode === 'snapshot' ? 'Rendered images' : "The studio's own server"}: ${APP_WORDS[state.app.status] ?? state.app.status}.`
                    : null}
                  {environmentProblem ? (
                    <span className="block text-danger">{environmentProblem}</span>
                  ) : null}
                </span>
                {canStart ? (
                  <button
                    type="button"
                    disabled={starting}
                    onClick={() => void startApp()}
                    className="mt-1 min-h-6 text-xs text-violet hover:underline disabled:opacity-50"
                  >
                    Start the app
                  </button>
                ) : null}
                {startNote ? (
                  <output
                    className={`block text-xs ${startNote.error ? 'text-danger' : 'text-slate'}`}
                  >
                    {startNote.text}
                  </output>
                ) : null}
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
            {activity ? (
              <div className={row}>
                <dt className={term}>Activity</dt>
                <dd className="mt-1 text-graphite">{activity.word}</dd>
              </div>
            ) : null}
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
                  {defaultRefusal ? (
                    <output className="mt-1 block text-xs text-danger">{defaultRefusal}</output>
                  ) : null}
                </dd>
              </div>
            ) : null}
            <div className={row}>
              <dt className={term}>Settings</dt>
              <dd className="mt-1">
                <CompleteFeaturesSwitch />
              </dd>
            </div>
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
