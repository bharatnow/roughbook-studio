import { CommandPalette } from '@roughbook/ui';
import { studioCommands, type StudioCommand } from '../commands';
import { navigate } from '../router';
import { useChrome } from './chrome';
import { useMakeDefault } from './status';

/** Runs the commands every screen has: links, the status, the default agent. */
export function useAppCommands() {
  const { setStatusOpen } = useChrome();
  const { makeDefault } = useMakeDefault();
  return (command: StudioCommand): boolean => {
    const run = command.run;
    switch (run.kind) {
      case 'href':
        if (run.external) window.open(run.href, '_blank', 'noreferrer');
        else navigate(run.href);
        return true;
      case 'status':
        // After the palette has given the keyboard back, so the popover keeps it.
        window.requestAnimationFrame(() => setStatusOpen(true));
        return true;
      case 'default-agent':
        void makeDefault(run.agent);
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
  return (
    <CommandPalette<StudioCommand>
      commands={() => palette.current?.commands() ?? studioCommands(null, null)}
      onRun={command => {
        if (palette.current) palette.current.run(command);
        else runApp(command);
      }}
      placeholder="Search commands, components and iterations"
    />
  );
}
