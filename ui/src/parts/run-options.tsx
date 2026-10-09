import { InteractiveResultPanel } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { navigate } from '../router';
import type { AgentView, Launched, RunView, StudioState } from '../types';

export type RunChoice = {
  agent: string;
  mode: 'interactive' | 'headless' | 'editor';
  terminal: 'builtin' | 'external';
};

type EditorLaunched = Extract<Launched, { kind: 'editor' }>;

const selectClass =
  'h-9 rounded-control border border-ash bg-canvas px-2 text-sm text-graphite outline-none focus:border-violet disabled:opacity-50';

/** An editor's runs are always the designer's, in the editor; a terminal agent starts with you. */
function modeFor(agent: AgentView | undefined): RunChoice['mode'] {
  return agent?.kind === 'editor' ? 'editor' : 'interactive';
}

/** The agent and where it runs, starting from this install's default. */
export function useRunChoice(state: StudioState | null): [RunChoice, (next: RunChoice) => void] {
  const found = state?.agents.filter(agent => agent.found) ?? [];
  // The default, else the first found, terminal agents before editors; "your own" only if chosen.
  const preferred =
    found.find(agent => agent.id === state?.defaultAgent) ??
    found.find(agent => agent.id !== 'other') ??
    found[0];
  const [choice, setChoice] = useState<RunChoice>({
    agent: preferred?.id ?? '',
    mode: modeFor(preferred),
    terminal: state?.terminal.builtin === false ? 'external' : 'builtin'
  });
  const preferredId = preferred?.id ?? '';
  const preferredMode = modeFor(preferred);
  // The agents arrive after the first render.
  useEffect(() => {
    if (!choice.agent && preferredId) {
      setChoice(current => ({ ...current, agent: preferredId, mode: preferredMode }));
    }
  }, [choice.agent, preferredId, preferredMode]);
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
        No coding agent or editor was found. Install Claude Code, Codex or an editor such as Cursor,
        then reload this page.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-steel">Agent</span>
        <select
          value={choice.agent}
          onChange={event => {
            const next = found.find(item => item.id === event.target.value);
            onChange({ ...choice, agent: event.target.value, mode: modeFor(next) });
          }}
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
      {agent?.kind === 'editor' ? (
        <p className="basis-full text-xs text-steel">
          {agent.id === 'other'
            ? 'Opens the prompt with your default app and copies the instruction for your agent.'
            : `Opens the repo and the prompt in ${agent.name} and copies the instruction for its agent.`}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-steel">How</span>
            <select
              value={choice.mode}
              onChange={event =>
                onChange({ ...choice, mode: event.target.value as RunChoice['mode'] })
              }
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
        </>
      )}
    </div>
  );
}

/** Where an editor launch put the prompt, in words. */
function openedIn(launched: EditorLaunched): string {
  const many = launched.instructions.length > 1;
  if (launched.opened === 'editor') {
    return `Opened the repo and the prompt${many ? 's' : ''} in ${launched.editor}.`;
  }
  if (launched.opened === 'default-app') return 'Opened the prompt with your default app.';
  return 'Open the prompt in your editor.';
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
      } else if (result.launched.kind === 'editor') {
        say({ tone: 'info', text: `Started ${names}. ${openedIn(result.launched)}` });
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

/** For an editor: each instruction to paste into a new chat with its agent, with a Copy button. */
function EditorHandoff({ launched }: { launched: EditorLaunched }) {
  const [copied, setCopied] = useState<number | null>(launched.copied ? 0 : null);
  const agent = launched.editor === 'Your own editor' ? 'your agent' : `${launched.editor}'s agent`;
  return (
    <div className="mt-3 rounded-card border border-ash bg-frost p-3 text-sm">
      <p className="text-graphite">{openedIn(launched)}</p>
      <p className="mt-1 text-xs text-slate">
        Paste {launched.instructions.length > 1 ? 'each line' : 'this'} into a new chat with {agent}
        {launched.instructions.length > 1 ? ', one chat per iteration' : ''}, then press Done on the
        run when it has finished.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {launched.instructions.map((instruction, index) => (
          <li key={instruction} className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 font-mono text-xs break-all text-graphite">{instruction}</code>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-control border border-ash bg-canvas px-3 text-xs text-graphite hover:border-mist"
              onClick={() =>
                void navigator.clipboard.writeText(instruction).then(() => setCopied(index))
              }
            >
              {copied === index ? 'Copied' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The commands to paste when no terminal could be opened, or an editor's instructions. */
export function LaunchResult({ launched }: { launched: Launched | null }) {
  if (launched?.kind === 'editor') return <EditorHandoff launched={launched} />;
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
