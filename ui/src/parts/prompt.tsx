import { HelpTip, PromptBar } from '@roughbook/ui';
import { focusForKey } from '@roughbook/ui/canvas';
import { Eraser, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canvasEntry } from '../canvas-actions';
import type { StudioCanvas } from '../canvas-input';
import { useStudio } from '../data';
import { forkPrompt } from '../fork-prompt';
import type { Launched, RunView } from '../types';
import { RunOptions, useRunChoice, useStartRuns } from './run-options';

/** A run's directions at most, as the run panel allowed. */
const MAX_DIRECTIONS = 8;
/** A line that says what the directions test, rather than one more direction. */
const TESTS = /^tests?:\s*/i;

/** The page, component and iteration a key names. */
export function partsOf(key: string | null) {
  const focus = focusForKey(key);
  return {
    page: focus.kind === 'project' ? null : focus.page,
    component:
      focus.kind === 'component' || focus.kind === 'iterations' || focus.kind === 'iteration'
        ? focus.component
        : null,
    iteration: focus.kind === 'iteration' ? focus.iteration : null
  };
}

/**
 * The canvas's prompt (ROUGHBOOK-QUIET-UI-PLAN.md, U5): the run panel's three modes on
 * @roughbook/ui's PromptBar, with the agent and where it runs as its chip. New starts one
 * iteration per line in the selected component; Fork copies the selected iteration for the agent
 * to take somewhere new; Refine asks for a new iteration that changes it as the words say. A
 * refusal is said beside the field and puts the words back.
 */
export function StudioPrompt({
  canvas,
  selection,
  mode,
  onModeChange,
  fieldId,
  onStarted,
  onLaunched,
  onRefineOptions
}: {
  canvas: StudioCanvas;
  selection: string | null;
  mode: string;
  onModeChange: (mode: string) => void;
  fieldId: string;
  /** With the runs it started and how, to select the first. */
  onStarted: (started: { runs: RunView[]; launched: Launched }) => void;
  /** A launch that left something to do: commands to paste, or an editor's instructions. */
  onLaunched: (launched: Launched) => void;
  /** The refine drawer, with presets, observations and what to keep. */
  onRefineOptions: () => void;
}) {
  const { state } = useStudio();
  const [choice, setChoice] = useRunChoice(state);
  const { start } = useStartRuns();
  const [answer, setAnswer] = useState<{ message: string; tone: 'status' | 'error' } | null>(null);
  // Each send draws the form anew: React resets a form after its action, which would leave the
  // mode's radios at the ones first drawn. A refusal puts the words and the keyboard back.
  const [field, setField] = useState({ key: 0, value: '', refused: false });
  // A radical fork: an empty folder, with what the parent was and what reviews said.
  const [cleanStart, setCleanStart] = useState(false);
  useEffect(() => {
    if (field.refused) document.getElementById(fieldId)?.focus();
  }, [field, fieldId]);

  const at = partsOf(selection);
  const entry = canvasEntry(canvas.input, selection);
  const frame = entry && entry.kind !== 'section' ? entry.frame : null;
  const facts = selection ? canvas.cards[selection] : undefined;
  const iteration = at.iteration;
  // A local iteration with its files and no run making it can be forked or refined.
  const made = facts?.kind === 'local' && facts.generated && !facts.run && iteration !== null;
  const modes = [
    {
      id: 'new',
      label: 'New',
      placeholder: frame
        ? `Directions for ${frame.name}, one per line`
        : 'Select a component to start iterations in it',
      disabled: !frame
    },
    {
      id: 'fork',
      label: 'Fork',
      placeholder: made
        ? `What should change in a fork of ${iteration}; a Keep: line says what stays`
        : 'Select an iteration to fork it',
      disabled: !made
    },
    {
      id: 'refine',
      label: 'Refine',
      placeholder: made ? `How to refine ${iteration}` : 'Select an iteration to refine it',
      disabled: !made
    }
  ];
  const current = modes.find(item => item.id === mode && !item.disabled)?.id ?? 'new';

  async function send(form: FormData) {
    const text = String(form.get('directions') ?? '');
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const refuse = (message: string) => {
      setAnswer({ message, tone: 'error' });
      // The form empties itself after its action; the words come back.
      setField(value => ({ key: value.key + 1, value: text, refused: true }));
    };
    if (!state || !choice.agent) return refuse('No coding agent or editor was found.');
    if (!at.page || !at.component) return refuse('Select a component first.');
    let body: Record<string, unknown>;
    if (current === 'new') {
      const tests = lines.find(line => TESTS.test(line))?.replace(TESTS, '');
      const directions = lines.filter(line => !TESTS.test(line));
      if (!directions.length) return refuse('Write a direction, one per line.');
      if (directions.length > MAX_DIRECTIONS) {
        return refuse(`Up to ${MAX_DIRECTIONS} directions at a time.`);
      }
      body = {
        page: at.page,
        component: at.component,
        kind: 'generate',
        directions: directions.map(direction => ({
          direction,
          ...(tests ? { hypothesis: tests } : {})
        }))
      };
    } else if (current === 'fork') {
      const fork = forkPrompt(text, cleanStart);
      if ('refusal' in fork) return refuse(fork.refusal);
      body = {
        page: at.page,
        component: at.component,
        kind: 'fork',
        parent: iteration,
        ...fork.fields
      };
    } else {
      if (!lines.length) return refuse(`Say how ${iteration} should change.`);
      body = {
        page: at.page,
        component: at.component,
        kind: 'refine',
        parent: iteration,
        preset: 'custom',
        intent: text.trim()
      };
    }
    setAnswer(null);
    const started = await start(body, choice);
    if (!started) {
      // The notice says why; the words wait for another try.
      setField(value => ({ key: value.key + 1, value: text, refused: true }));
      return;
    }
    setField(value => ({ key: value.key + 1, value: '', refused: false }));
    setCleanStart(false);
    onModeChange('new');
    onStarted(started);
    if (started.launched.kind === 'manual' || started.launched.kind === 'editor') {
      onLaunched(started.launched);
    }
  }

  if (!state) return null;
  return (
    <PromptBar
      key={field.key}
      action={send}
      modes={modes}
      mode={current}
      onModeChange={next => {
        setAnswer(null);
        onModeChange(next);
      }}
      chip={
        <div className="flex flex-wrap items-center gap-0.5">
          {current === 'fork' ? (
            <button
              type="button"
              aria-pressed={cleanStart}
              onClick={() => setCleanStart(value => !value)}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm text-slate outline-none hover:bg-frost hover:text-graphite focus-visible:ring-2 focus-visible:ring-violet aria-pressed:bg-frost aria-pressed:text-graphite"
            >
              <Eraser className="size-3.5" strokeWidth={1.5} />
              Clean start
            </button>
          ) : null}
          {current === 'refine' ? (
            <button
              type="button"
              onClick={onRefineOptions}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm text-slate outline-none hover:bg-frost hover:text-graphite focus-visible:ring-2 focus-visible:ring-violet"
            >
              <SlidersHorizontal className="size-3.5" strokeWidth={1.5} />
              Options
            </button>
          ) : null}
          <RunOptions state={state} choice={choice} onChange={setChoice} compact />
          <HelpTip label="About the prompt">
            <strong className="font-medium">New</strong>: one iteration per line, up to{' '}
            {MAX_DIRECTIONS}; a line starting with <span className="font-mono">Tests:</span> says
            what they test. <strong className="font-medium">Fork</strong>: a copy of the selected
            iteration the agent takes where the words say, keeping what a{' '}
            <span className="font-mono">Keep:</span> line lists; Clean start begins empty instead,
            from what it was and what reviews said. <strong className="font-medium">Refine</strong>:
            a new iteration that changes it as you say; Options has the presets. Ctrl Enter sends.
          </HelpTip>
        </div>
      }
      fieldId={fieldId}
      fieldKey={field.key}
      defaultValue={field.value}
      label="Prompt"
      message={answer?.message ?? null}
      tone={answer?.tone ?? 'status'}
      disabled={modes.find(item => item.id === current)?.disabled ?? true}
    />
  );
}
