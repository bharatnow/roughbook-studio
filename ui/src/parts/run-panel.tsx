import { Field, TextInput } from '@roughbook/ui';
import { useState } from 'react';
import { useStudio } from '../data';
import type { Feedback, Iteration } from '../types';
import { RefineForm } from './refine';
import { LaunchResult, RunOptions, useRunChoice, useStartRuns } from './run-options';

type Kind = 'generate' | 'fork' | 'refine';

const tabClass = (active: boolean) =>
  `h-7 rounded-full px-3 text-sm ${active ? 'bg-canvas text-graphite shadow-[0_1px_1px_rgba(39,40,53,0.1)]' : 'text-slate hover:text-graphite'}`;

/** Starts iterations of one component: new directions, a fork, or a refinement. */
export function RunPanel({
  page,
  component,
  iterations
}: {
  page: string;
  component: string;
  iterations: Iteration[];
}) {
  const { state } = useStudio();
  const [kind, setKind] = useState<Kind>('generate');
  const [choice, setChoice] = useRunChoice(state);
  const { start, busy, launched } = useStartRuns();
  const [directions, setDirections] = useState<string[]>(['']);
  const [hypothesis, setHypothesis] = useState('');
  const generated = iterations.filter(item => item.generation.mode !== 'pending');
  const [parent, setParent] = useState('');
  const chosen = generated.find(item => item.id === parent) ?? generated.at(-1) ?? null;

  if (!state) return null;
  const filled = directions.map(item => item.trim()).filter(Boolean);

  return (
    <section className="rounded-card border border-ash bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base tracking-tight text-graphite">Run</h2>
        <div className="flex rounded-full bg-frost p-1">
          <button
            type="button"
            className={tabClass(kind === 'generate')}
            onClick={() => setKind('generate')}
          >
            New directions
          </button>
          <button
            type="button"
            disabled={!generated.length}
            className={tabClass(kind === 'fork')}
            onClick={() => setKind('fork')}
          >
            Fork
          </button>
          <button
            type="button"
            disabled={!generated.length}
            className={tabClass(kind === 'refine')}
            onClick={() => setKind('refine')}
          >
            Refine
          </button>
        </div>
      </div>

      {kind !== 'generate' && chosen ? (
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-xs text-steel">{kind === 'fork' ? 'Fork' : 'Refine'}</span>
          <select
            value={chosen.id}
            onChange={event => setParent(event.target.value)}
            className="h-9 rounded-control border border-ash bg-canvas px-2 text-sm text-graphite outline-none focus:border-violet"
          >
            {generated.map(item => (
              <option key={item.id} value={item.id}>
                {item.id} — {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {kind === 'refine' && chosen ? (
        <div className="mt-4">
          <RefineForm
            key={chosen.id}
            page={page}
            component={component}
            parent={chosen.id}
            feedback={chosen.feedback as Feedback}
          />
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={async event => {
            event.preventDefault();
            if (kind === 'fork' && chosen) {
              await start({ page, component, kind: 'fork', parent: chosen.id }, choice);
              return;
            }
            const started = await start(
              {
                page,
                component,
                kind: 'generate',
                directions: filled.map(direction => ({
                  direction,
                  ...(hypothesis.trim() ? { hypothesis: hypothesis.trim() } : {})
                }))
              },
              choice
            );
            if (started) setDirections(['']);
          }}
        >
          {kind === 'generate' ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-sm text-graphite">
                  Directions (one iteration each, up to eight)
                </span>
                {directions.map((value, index) => (
                  <TextInput
                    key={index}
                    value={value}
                    placeholder={
                      index === 0 ? 'Quiet editorial, one strong headline' : 'Another direction'
                    }
                    onChange={event =>
                      setDirections(current =>
                        current.map((item, at) => (at === index ? event.target.value : item))
                      )
                    }
                  />
                ))}
                {directions.length < 8 ? (
                  <button
                    type="button"
                    onClick={() => setDirections(current => [...current, ''])}
                    className="self-start text-sm text-violet hover:underline"
                  >
                    Add a direction
                  </button>
                ) : null}
              </div>
              <Field label="What it tests (optional)">
                <TextInput
                  value={hypothesis}
                  onChange={event => setHypothesis(event.target.value)}
                  placeholder="Restraint reads as confidence."
                />
              </Field>
            </>
          ) : (
            <p className="text-sm text-slate">
              A fork starts from a copy of {chosen?.id}, and the agent takes it somewhere new.
            </p>
          )}
          <RunOptions state={state} choice={choice} onChange={setChoice} />
          <div>
            <button
              type="submit"
              disabled={busy || !choice.agent || (kind === 'generate' && !filled.length)}
              className="inline-flex h-9 items-center rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
            >
              {busy
                ? 'Starting'
                : kind === 'fork'
                  ? `Fork ${chosen?.id ?? ''}`
                  : `Start ${filled.length > 1 ? `${filled.length} iterations` : 'an iteration'}`}
            </button>
          </div>
          <LaunchResult launched={launched} />
        </form>
      )}
    </section>
  );
}
