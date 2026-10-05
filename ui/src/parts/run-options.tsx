import { InteractiveResultPanel } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { navigate } from '../router';
import type { Launched, RunView, StudioState } from '../types';

export type RunChoice = {
  agent: string;
  mode: 'interactive' | 'headless';
  terminal: 'builtin' | 'external';
};

const selectClass =
  'h-9 rounded-control border border-ash bg-canvas px-2 text-sm text-graphite outline-none focus:border-violet disabled:opacity-50';

/** The agent and where it runs, starting from this install's default. */
export function useRunChoice(state: StudioState | null): [RunChoice, (next: RunChoice) => void] {
  const found = state?.agents.filter(agent => agent.found) ?? [];
  const preferred = found.find(agent => agent.id === state?.defaultAgent)?.id ?? found[0]?.id ?? '';
  const [choice, setChoice] = useState<RunChoice>({
    agent: preferred,
    mode: 'interactive',
    terminal: state?.terminal.builtin === false ? 'external' : 'builtin'
  });
  // The agents arrive after the first render.
  useEffect(() => {
    if (!choice.agent && preferred) setChoice(current => ({ ...current, agent: preferred }));
  }, [choice.agent, preferred]);
  return [choice, setChoice];
}

export function RunOptions({
  state,
  choice,
  onChange
}: {
  state: StudioState;
  choice: RunChoice;
  onChange: (next: RunChoice) => void;
}) {
  const found = state.agents.filter(agent => agent.found);
  const agent = found.find(item => item.id === choice.agent);
  const headless = agent?.headless;
  if (!found.length) {
    return (
      <p className="text-sm text-danger">
        No coding agent was found. Install Claude Code or Codex, then reload this page.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-steel">Agent</span>
        <select
          value={choice.agent}
          onChange={event =>
            onChange({ ...choice, agent: event.target.value, mode: 'interactive' })
          }
          className={selectClass}
        >
          {found.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.version ? ` ${item.version}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-steel">How</span>
        <select
          value={choice.mode}
          onChange={event => onChange({ ...choice, mode: event.target.value as RunChoice['mode'] })}
          className={selectClass}
        >
          <option value="interactive">In a terminal, with you</option>
          <option value="headless" disabled={!headless?.ready}>
            Unattended{headless && !headless.ready ? ' (not available)' : ''}
          </option>
        </select>
      </label>
      {choice.mode === 'interactive' ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-steel">Where</span>
          <select
            value={choice.terminal}
            onChange={event =>
              onChange({ ...choice, terminal: event.target.value as RunChoice['terminal'] })
            }
            className={selectClass}
          >
            <option value="builtin" disabled={!state.terminal.builtin}>
              Here, in the built-in terminal
            </option>
            <option value="external">In your own terminal</option>
          </select>
        </label>
      ) : null}
      {headless && !headless.ready && choice.mode === 'interactive' ? (
        <p className="basis-full text-xs text-steel">Unattended: {headless.reason}</p>
      ) : null}
      {!state.terminal.builtin ? (
        <p className="basis-full text-xs text-steel">{state.terminal.reason}</p>
      ) : null}
    </div>
  );
}

/** Starts runs, opens the built-in terminal for the first, and says what happened. */
export function useStartRuns() {
  const { refresh, say } = useStudio();
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<Launched | null>(null);

  /** The runs' launch, or null when they could not start (the notice says why). */
  async function start(body: Record<string, unknown>, choice: RunChoice): Promise<Launched | null> {
    setBusy(true);
    setLaunched(null);
    try {
      const width = document.documentElement.clientWidth;
      const result = await post<{ runs: RunView[]; launched: Launched }>('/api/runs', {
        ...body,
        agent: choice.agent,
        mode: choice.mode,
        terminal: choice.terminal,
        // A first guess at the terminal's size; the page sends the real one when it joins.
        cols: Math.max(80, Math.min(200, Math.floor(width / 9))),
        rows: 32
      });
      await refresh();
      setLaunched(result.launched);
      const names = result.runs.map(run => run.iteration).join(', ');
      if (result.launched.kind === 'builtin' && result.launched.terminals[0]) {
        navigate(`/terminals/${result.launched.terminals[0].id}`);
      } else if (result.launched.kind === 'external') {
        say({ tone: 'info', text: `Started ${names} in ${result.launched.terminal}.` });
      } else if (result.launched.kind === 'headless') {
        say({ tone: 'info', text: `Started ${names} unattended. Its progress shows below.` });
      }
      return result.launched;
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { start, busy, launched };
}

/** The commands to paste, when no terminal could be opened. */
export function LaunchResult({ launched }: { launched: Launched | null }) {
  if (launched?.kind !== 'manual') return null;
  return (
    <div className="mt-3">
      <InteractiveResultPanel
        result={{
          ok: true,
          launched: false,
          message: launched.reason,
          commands: launched.commands
        }}
      />
    </div>
  );
}
