// Running a plain verb from a screen (A7 of ROUGHBOOK-APPLE-PLAN.md): through the host's
// `runVerb`, its answer said in words on the screen's line (`line`), and "Undo …" offered on the bar for ten seconds through the
// host's `undoVerb`. The canvas and the stage share it.
import {
  MenuButton,
  REJECTION_REASONS,
  VERB_LABELS,
  useUiHost,
  useUndo,
  type IterationTarget,
  type VerbId,
  type VerbResult
} from '@roughbook/ui';
import { HOW_FAR } from '@roughbook/ui/commands';
import { useState } from 'react';
import { HOW_FAR_WORDS } from '../commands';
import { verbLine, type Line } from '../output';

/** Not this's reasons, posted at once; "Other…" asks for the designer's own words. */
export const NOT_THIS_REASONS = REJECTION_REASONS.filter(reason => reason !== 'Custom');

export function useRunVerb() {
  const { actions } = useUiHost();
  const undo = useUndo();
  /** The iteration a verb is running on, by id, so its buttons wait. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Which verb that is, so only its own button shows it is working. */
  const [verb, setVerb] = useState<VerbId | null>(null);
  /** What the last verb, or its Undo, said. */
  const [line, setLine] = useState<Line | null>(null);

  async function run(
    verb: VerbId,
    target: IterationTarget,
    fields: Record<string, string> = {}
  ): Promise<VerbResult | null> {
    if (!actions.runVerb) return null;
    setBusy(target.iteration);
    setVerb(verb);
    try {
      const result = await actions.runVerb(verb, target, fields);
      setLine(verbLine(result));
      const back = result.ok ? result.undo : null;
      if (back && actions.undoVerb) {
        const undoVerb = actions.undoVerb;
        undo.offer(back.label || VERB_LABELS[verb], async () => {
          const answer = await undoVerb(back);
          if (!answer.ok) throw new Error(answer.message);
          setLine(verbLine(answer));
        });
      }
      return result;
    } finally {
      setBusy(null);
      setVerb(null);
    }
  }

  const served = (verb: VerbId) => Boolean(actions.runVerb) && (actions.verbs ?? []).includes(verb);

  return { run, busy, verb, served, line };
}

/** Something different's one "How far" control: the four strengths, nearest first. */
export function HowFarMenu({
  disabled,
  onChoose
}: {
  disabled?: string;
  onChoose: (howFar: (typeof HOW_FAR)[number]) => void;
}) {
  return (
    <MenuButton
      label={VERB_LABELS.different}
      align="start"
      items={HOW_FAR.map(howFar => ({
        label: HOW_FAR_WORDS[howFar],
        ...(disabled ? { disabled } : {}),
        onSelect: () => onChoose(howFar)
      }))}
    />
  );
}

/** Not this: a reason at once, or "Other…" for the designer's own words. */
export function NotThisMenu({
  disabled,
  onReason,
  onOther
}: {
  disabled?: string;
  onReason: (reason: string) => void;
  onOther: () => void;
}) {
  return (
    <MenuButton
      label={VERB_LABELS['not-this']}
      align="start"
      items={[
        ...NOT_THIS_REASONS.map(reason => ({
          label: reason,
          ...(disabled ? { disabled } : {}),
          onSelect: () => onReason(reason)
        })),
        { label: 'Other…', onSelect: onOther }
      ]}
    />
  );
}
