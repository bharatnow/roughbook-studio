// The canvas prompt's modes (ROUGHBOOK-QUIET-UI-PLAN.md, U5; ROUGHBOOK-APPLE-PLAN.md, A7): New in
// the selected component, and Fork and Refine on a made iteration. With Complete features off there
// is one mode and the selection decides it (ROUGHBOOK-LEAN-PLAN.md, L3): words on a made iteration
// fork it, and otherwise start new ones. No JSX, so the tests can walk them.
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
  const fresh: StudioPromptMode = {
    id: 'new',
    label: 'New',
    placeholder: frame ? `Directions for ${frame}, one per line` : 'What should Roughbook make?',
    disabled: !frame
  };
  if (off) {
    return [
      usable
        ? {
            id: 'fork',
            label: 'Fork',
            placeholder: `What should change in ${iteration}`,
            disabled: false
          }
        : fresh
    ];
  }
  return [
    fresh,
    {
      id: 'fork',
      label: 'Fork',
      completeOnly: true,
      placeholder: !usable
        ? 'Select an iteration to fork it'
        : `What should change in a fork of ${iteration}; a Keep: line says what stays`,
      disabled: !usable
    },
    {
      id: 'refine',
      label: 'Refine',
      completeOnly: true,
      placeholder: !usable ? 'Select an iteration to refine it' : `How to refine ${iteration}`,
      disabled: !usable
    }
  ];
}

/** The mode the prompt is in: the one asked for while it can be used, otherwise the first. */
export function currentMode(
  modes: readonly StudioPromptMode[],
  asked: string
): StudioPromptMode['id'] {
  return modes.find(item => item.id === asked && !item.disabled)?.id ?? modes[0]?.id ?? 'new';
}
