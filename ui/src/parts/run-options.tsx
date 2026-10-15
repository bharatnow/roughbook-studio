import { HelpTip, InteractiveResultPanel } from '@roughbook/ui';
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

const chipSelectClass =
  'h-7 max-w-44 rounded-full border border-transparent bg-transparent px-2 text-sm text-slate outline-none hover:bg-frost hover:text-graphite focus-visible:ring-2 focus-visible:ring-violet';

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

/** Where a terminal agent runs: one choice for the mode and the terminal. */
type Where = 'builtin' | 'external' | 'headless';

const WHERE_WORDS: Record<Where, string> = {
  builtin: 'Built-in terminal',
  external: 'Your terminal',
  headless: 'Unattended'
};

function whereOf(choice: RunChoice): Where {
  return choice.mode === 'headless' ? 'headless' : choice.terminal;
}

/** What each choice means, and why one is not offered, for the HelpTip beside them. */
function RunHelp({ state, agent }: { state: StudioState; agent: AgentView | undefined }) {
  if (agent?.kind === 'editor') {
    return (
      <>
        {agent.id === 'other'
          ? 'Opens the prompt with your default app and copies the instruction for your agent.'
          : `Opens the repo and the prompt in ${agent.name} and copies the instruction for its agent.`}
      </>
    );
  }
  const headless = agent?.headless;
  return (
    <>
      <strong className="font-medium">Built-in terminal</strong>: the agent works here, with you.{' '}
      <strong className="font-medium">Your terminal</strong>: it opens in your own terminal app.{' '}
      <strong className="font-medium">Unattended</strong>: it works on its own and finishes when it
      exits.
      {headless && !headless.ready ? (
        <span className="mt-2 block">Unattended: {headless.reason}</span>
      ) : null}
      {!state.terminal.builtin ? <span className="mt-2 block">{state.terminal.reason}</span> : null}
    </>
  );
}

/**
 * The agent and where it runs. `compact` is the prompt's chip: the two selects named for a screen
 * reader rather than labelled, with the help beside them.
 */
export function RunOptions({
  state,
  choice,
  onChange,
  compact = false
}: {
  state: StudioState;
  choice: RunChoice;
  onChange: (next: RunChoice) => void;
  compact?: boolean;
}) {
  const found = state.agents.filter(agent => agent.found);
  const agent = found.find(item => item.id === choice.agent);
  const headless = agent?.headless;
  const select = compact ? chipSelectClass : selectClass;
  if (!found.length) {
    return (
      <p className="text-sm text-danger">
        No coding agent or editor was found. Install Claude Code, Codex or an editor such as Cursor,
        then reload this page.
      </p>
    );
  }
  const agentSelect = (
    <select
      aria-label={compact ? 'Agent' : undefined}
      value={choice.agent}
      onChange={event => {
        const next = found.find(item => item.id === event.target.value);
        onChange({ ...choice, agent: event.target.value, mode: modeFor(next) });
      }}
      className={select}
    >
      {found.map(item => (
        <option key={item.id} value={item.id}>
          {item.name}
          {item.version && !compact ? ` ${item.version}` : ''}
        </option>
      ))}
    </select>
  );
  const whereSelect =
    agent?.kind === 'editor' ? null : (
      <select
        aria-label={compact ? 'Where it runs' : undefined}
        value={whereOf(choice)}
        onChange={event => {
          const where = event.target.value as Where;
          onChange(
            where === 'headless'
              ? { ...choice, mode: 'headless' }
              : { ...choice, mode: 'interactive', terminal: where }
          );
        }}
        className={select}
      >
        {(Object.keys(WHERE_WORDS) as Where[]).map(where => (
          <option
            key={where}
            value={where}
            disabled={
              (where === 'builtin' && !state.terminal.builtin) ||
              (where === 'headless' && !headless?.ready)
            }
          >
            {WHERE_WORDS[where]}
          </option>
        ))}
      </select>
    );
  const help = (
    <HelpTip label="About where the agent runs">
      <RunHelp state={state} agent={agent} />
    </HelpTip>
  );
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-0.5">
        {agentSelect}
        {whereSelect}
        {help}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-steel">Agent</span>
        {agentSelect}
      </label>
      {whereSelect ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-steel">Where</span>
          {whereSelect}
        </label>
      ) : null}
      <span className="pb-1.5">{help}</span>
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

  /** The runs and their launch, or null when they could not start (the notice says why). */
  async function start(
    body: Record<string, unknown>,
    choice: RunChoice
  ): Promise<{ runs: RunView[]; launched: Launched } | null> {
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
        // The canvas, with the session in its dock and the run's card selected.
        navigate(`/terminals/${result.launched.terminals[0].id}`);
      } else if (result.launched.kind === 'external') {
        say({ tone: 'info', text: `Started ${names} in ${result.launched.terminal}.` });
      } else if (result.launched.kind === 'headless') {
        say({ tone: 'info', text: `Started ${names} unattended.` });
      } else if (result.launched.kind === 'editor') {
        say({ tone: 'info', text: `Started ${names}. ${openedIn(result.launched)}` });
      }
      return result;
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
  const many = launched.instructions.length > 1;
  return (
    <div className="mt-3 rounded-card border border-ash bg-frost p-3 text-sm">
      <div className="text-graphite">
        {openedIn(launched)} Paste {many ? 'each line' : 'this'} into a new chat with {agent}.{' '}
        <HelpTip label="About finishing an editor's run">
          {many ? 'One chat per iteration. ' : ''}
          {launched.mcp?.ready
            ? 'It checks and finishes the run itself through the Roughbook MCP tools, or press Done on the run.'
            : 'Press Done on the run when it has finished.'}
          {launched.mcp?.ready === false ? (
            <span className="mt-2 block">
              Run <code className="font-mono">{launched.mcp.install}</code> once, so {agent} can
              check and finish runs itself.
            </span>
          ) : null}
        </HelpTip>
      </div>
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
