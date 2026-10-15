import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from 'react';
import type { StudioCommand } from '../commands';

/** One step of the bar's breadcrumb: where it goes, and its name. */
export type Crumb = { href: string; label: string };

/** What a screen gives the bar's palette: its commands when it opens, and how to run one. */
export type PaletteSource = {
  commands: () => StudioCommand[];
  run: (command: StudioCommand) => void;
};

type Chrome = {
  /** The breadcrumb after the project, which the canvas moves with its selection. */
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
  /** The screen's palette commands; none off the canvas. */
  palette: MutableRefObject<PaletteSource | null>;
  /** The bar's status popover. */
  statusOpen: boolean;
  setStatusOpen: (open: boolean) => void;
  /**
   * The terminal dock at the foot: closed until a run starts, then one tab per session. `focus`:
   * the shown session's terminal takes the keyboard, as when a run or a command opened it.
   */
  dock: { open: boolean; session: string | null; focus: boolean };
  /** Shows a session (or the last one shown, for null); `focus` false for the dock's own tabs. */
  showSession: (id: string | null, focus?: boolean) => void;
  /** The terminal took the keyboard: a dock drawn again later leaves it where it is. */
  focusTaken: () => void;
  closeDock: () => void;
};

const Context = createContext<Chrome | null>(null);

export function useChrome(): Chrome {
  const chrome = useContext(Context);
  if (!chrome) throw new Error('useChrome outside ChromeProvider');
  return chrome;
}

/** The bar, the palette and the dock, held above the screens so they last as the address moves. */
export function ChromeProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const palette = useRef<PaletteSource | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [dock, setDock] = useState<Chrome['dock']>({ open: false, session: null, focus: false });
  const showSession = useCallback(
    (id: string | null, focus = true) =>
      setDock(current => ({ open: true, session: id ?? current.session, focus })),
    []
  );
  const focusTaken = useCallback(() => setDock(current => ({ ...current, focus: false })), []);
  const closeDock = useCallback(() => setDock(current => ({ ...current, open: false })), []);
  const value = useMemo<Chrome>(
    () => ({
      crumbs,
      setCrumbs,
      palette,
      statusOpen,
      setStatusOpen,
      dock,
      showSession,
      focusTaken,
      closeDock
    }),
    [crumbs, statusOpen, dock, showSession, focusTaken, closeDock]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
