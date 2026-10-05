import {
  Drawer,
  Field,
  MAX_REFINE_OBSERVATIONS,
  REFINEMENT_PRESETS,
  buildObservationOptions,
  type Review
} from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { get, iterationPath } from '../api';
import { useStudio } from '../data';
import type { Feedback } from '../types';
import { LaunchResult, RunOptions, useRunChoice, useStartRuns } from './run-options';

const areaClass =
  'rounded-control border border-ash bg-canvas px-3 py-2 text-sm text-graphite outline-none placeholder:text-fog focus:border-violet';

/** A parent's reviews, for the observations a refinement can address. */
export function useReviews(page: string, component: string, iteration: string | null) {
  const { project } = useStudio();
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    if (!iteration) return;
    let live = true;
    get<Review[]>(`${iterationPath(page, component, iteration)}/reviews`)
      .then(list => live && setReviews(list))
      .catch(() => live && setReviews([]));
    return () => {
      live = false;
    };
    // The project is read again after every decision, so a new review shows here too.
  }, [page, component, iteration, project]);
  return reviews;
}

/** A refinement: always a new iteration, which a run with the chosen agent carries out. */
export function RefineForm({
  page,
  component,
  parent,
  feedback,
  onStarted
}: {
  page: string;
  component: string;
  parent: string;
  feedback: Feedback | null;
  onStarted?: () => void;
}) {
  const { state } = useStudio();
  const [choice, setChoice] = useRunChoice(state);
  const { start, busy, launched } = useStartRuns();
  const reviews = useReviews(page, component, parent);
  const observations = buildObservationOptions(reviews, feedback);
  const [preset, setPreset] = useState('simplify');
  const [intent, setIntent] = useState('');
  const [preserve, setPreserve] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  if (!state) return null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async event => {
        event.preventDefault();
        const started = await start(
          {
            page,
            component,
            kind: 'refine',
            parent,
            preset,
            intent,
            preserve,
            observationIds: picked
          },
          choice
        );
        // The commands to paste stay on screen; anything else has opened somewhere.
        if (started && started.kind !== 'manual') onStarted?.();
      }}
    >
      <Field label="Refinement">
        <select
          value={preset}
          onChange={event => setPreset(event.target.value)}
          className="h-9 rounded-control border border-ash bg-canvas px-3 text-sm text-graphite outline-none focus:border-violet"
        >
          {REFINEMENT_PRESETS.map(item => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      {observations.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-graphite">
            Observations to address (up to {MAX_REFINE_OBSERVATIONS})
          </legend>
          {observations.map(item => {
            const checked = picked.includes(item.id);
            const full = picked.length >= MAX_REFINE_OBSERVATIONS && !checked;
            return (
              <label
                key={item.id}
                className={`flex items-start gap-2 text-sm ${full ? 'text-fog' : 'text-graphite'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={full}
                  onChange={() =>
                    setPicked(current =>
                      checked ? current.filter(id => id !== item.id) : [...current, item.id]
                    )
                  }
                  className="mt-1 size-4 accent-[#5e4cff]"
                />
                <span>
                  {item.text}
                  <span className="block font-mono text-[11px] text-steel">{item.origin}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}
      <Field label="Keep recognizable from the parent (optional)">
        <textarea
          rows={2}
          value={preserve}
          onChange={event => setPreserve(event.target.value)}
          className={areaClass}
        />
      </Field>
      <Field label="Instruction (optional)">
        <textarea
          rows={3}
          value={intent}
          onChange={event => setIntent(event.target.value)}
          placeholder="Keep the composition; make the supporting line shorter."
          className={areaClass}
        />
      </Field>
      <RunOptions state={state} choice={choice} onChange={setChoice} />
      <div>
        <button
          type="submit"
          disabled={busy || !choice.agent}
          className="inline-flex h-9 items-center rounded-control bg-violet px-3 text-sm text-white hover:bg-violet/90 disabled:opacity-50"
        >
          {busy ? 'Starting' : `Refine ${parent}`}
        </button>
      </div>
      <p className="rounded-control border border-ash bg-frost px-3 py-2 text-xs text-slate">
        A refinement is always a new iteration. {parent} stays exactly as it is.
      </p>
      <LaunchResult launched={launched} />
    </form>
  );
}

export function RefineDrawer({
  open,
  onClose,
  page,
  component,
  parent,
  parentName,
  feedback
}: {
  open: boolean;
  onClose: () => void;
  page: string;
  component: string;
  parent: string;
  parentName: string;
  feedback: Feedback | null;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={`Refine ${parent}`}>
      <p className="mb-4 font-mono text-sm text-graphite">
        {parent} — {parentName}
      </p>
      {open ? (
        <RefineForm
          page={page}
          component={component}
          parent={parent}
          feedback={feedback}
          onStarted={onClose}
        />
      ) : null}
    </Drawer>
  );
}
