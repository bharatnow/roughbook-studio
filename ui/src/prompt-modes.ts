// The canvas prompt's modes (ROUGHBOOK-QUIET-UI-PLAN.md, U5; ROUGHBOOK-APPLE-PLAN.md, A7): New in
// the selected component, and Fork and Refine on a made iteration. Fork and Refine are
// complete-only: with Complete features off they stay, dimmed, saying how to have them, since the
// plain verbs do the everyday part. No JSX, so the tests can walk them.
import type { PromptMode } from '@roughbook/ui';

export type StudioPromptMode = PromptMode & {
  id: 'new' | 'fork' | 'refine';
  disabled: boolean;
  /** Complete features only (A7). */
  completeOnly?: true;
};

export function promptModes({
  frame,
  iteration,
  made,
  complete
}: {
  /** The selected component's name, or null when none is selected. */
  frame: string | null;
  /** The selected iteration's id, or null. */
  iteration: string | null;
  /** It has its files and no run is making it, so it can be forked or refined. */
  made: boolean;
  /** The Complete features switch; unknown reads as on. */
  complete?: boolean;
}): StudioPromptMode[] {
  const off = complete === false;
  const usable = made && iteration !== null;
  const quiet = (label: string, instead: string) =>
    `${label}: turn on Complete features in Settings, or use ${instead}`;
  return [
    {
      id: 'new',
      label: 'New',
      placeholder: frame
        ? `Directions for ${frame}, one per line`
        : 'Select a component to start iterations in it',
      disabled: !frame
    },
    {
      id: 'fork',
      label: 'Fork',
      completeOnly: true,
      placeholder: !usable
        ? 'Select an iteration to fork it'
        : off
          ? quiet('Fork', 'More like this')
          : `What should change in a fork of ${iteration}; a Keep: line says what stays`,
      disabled: !usable || off
    },
    {
      id: 'refine',
      label: 'Refine',
      completeOnly: true,
      placeholder: !usable
        ? 'Select an iteration to refine it'
        : off
          ? quiet('Refine', 'Polish')
          : `How to refine ${iteration}`,
      disabled: !usable || off
    }
  ];
}

/** The mode the prompt is in: the one asked for while it can be used, otherwise New. */
export function currentMode(
  modes: readonly StudioPromptMode[],
  asked: string
): StudioPromptMode['id'] {
  return modes.find(item => item.id === asked && !item.disabled)?.id ?? 'new';
}
