import { CommandPalette, useUiHost } from '@roughbook/ui';
import { atRest, studioCommands, type StudioCommand } from '../commands';
import { useStudio } from '../data';
import { completeFeaturesOf } from '../features';
import { errorLine, infoLine } from '../output';
import { navigate } from '../router';
import { useChrome } from './chrome';
import { useMakeDefault } from './status';

/** The canvas's prompt field, which the toolbar's Generate puts the keyboard in. */
export const PROMPT_FIELD = 'canvas-prompt';

/** The canvas's prompt, with the keyboard in it: here, or on the canvas once it is drawn. */
export function focusPrompt() {
  const here = document.getElementById(PROMPT_FIELD);
  if (here) {
    here.focus();
    return;
  }
  navigate('/');
  let tries = 0;
  const wait = window.setInterval(() => {
    const field = document.getElementById(PROMPT_FIELD);
    if (field || ++tries > 40) window.clearInterval(wait);
    field?.focus();
  }, 50);
}

/**
 * Runs the commands every screen has: links, the status, the default agent, Copy link and
 * Generate. What they say goes on the bar's line, under the toolbar.
 */
export function useAppCommands() {
  const { setStatusOpen, setBarLine } = useChrome();
  const { makeDefault } = useMakeDefault();
  const host = useUiHost();
  return (command: StudioCommand): boolean => {
    const run = command.run;
    switch (run.kind) {
      case 'href':
        if (run.external) window.open(run.href, '_blank', 'noreferrer');
        else navigate(run.href);
        return true;
      case 'status':
        setStatusOpen(true);
        return true;
      case 'default-agent':
        setBarLine(null);
        void makeDefault(run.agent).then(refusal => {
          if (refusal) setBarLine(errorLine(refusal));
        });
        return true;
      case 'complete-features':
        void host.actions.setCompleteFeatures?.(run.on);
        return true;
      case 'copy':
        void navigator.clipboard.writeText(run.text).then(
          () => setBarLine(infoLine(run.done)),
          () => setBarLine(errorLine(`Could not reach the clipboard. The link is ${run.text}`))
        );
        return true;
      case 'generate':
        focusPrompt();
        return true;
      default:
        return false;
    }
  };
}

/** The bar's command palette: the canvas's commands where it is open, the studio's elsewhere. */
export function StudioPalette() {
  const { palette } = useChrome();
  const runApp = useAppCommands();
  const { state } = useStudio();
  const complete = completeFeaturesOf(state);
  return (
    <CommandPalette<StudioCommand>
      commands={() =>
        atRest(
          palette.current?.commands() ??
            studioCommands(null, null, {
              complete,
              project: state?.project.slug,
              webUrl: state?.webUrl ?? null
            })
        )
      }
      onRun={command => {
        if (palette.current) palette.current.run(command);
        else runApp(command);
      }}
      placeholder="Search commands, components and iterations"
    />
  );
}
