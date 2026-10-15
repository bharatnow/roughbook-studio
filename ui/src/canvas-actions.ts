// What can be done on the studio's canvas (ROUGHBOOK-QUIET-UI-PLAN.md, U5 step 2): the selection's
// actions, which its toolbar draws, and the canvas's own controls. The palette offers each as a
// command (commands.ts), so the toolbar, the controls and ⌘K never disagree. An action with
// `toolbar: false` is the palette's alone (rule 7: new and rare things go there).
import type {
  CanvasCardInput,
  CanvasFrameInput,
  CanvasInput,
  CanvasSectionInput
} from '@roughbook/ui/canvas';
import type { StudioCanvas } from './canvas-input.ts';
import { runRunning } from './runs.ts';

export type SelectionActionId =
  | 'open'
  | 'fork'
  | 'refine'
  | 'pick'
  | 'compare'
  | 'promote'
  | 'done'
  | 'stop'
  | 'copy-prompt'
  | 'terminal'
  | 'failed'
  | 'cancel'
  | 'pull'
  | 'web'
  | 'brief'
  | 'fold';

export type CanvasWideActionId =
  'prompt' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fit-all' | 'fit-selection' | 'list' | 'dock';

export type StudioActionId = SelectionActionId | CanvasWideActionId;

export type StudioAction = {
  id: StudioActionId;
  label: string;
  /** In the selection's toolbar as well as the palette. */
  toolbar: boolean;
  /** Where it goes, for an action that is a link: a screen of the studio, or the web. */
  href?: string;
  /** The link leaves the studio, for the web. */
  external?: boolean;
  /** Its key on the canvas, said beside it. */
  keys?: string;
  /** The terminal session it shows. */
  session?: string;
};

/** What the canvas shows: the canvas itself, the list a desktop can switch to, or a narrow window's list. */
export type CanvasMode = 'canvas' | 'list' | 'phone';

export type SelectionState = {
  /** The project's slug, for its address on the web. */
  project: string;
  /** The web, where the project's brief is edited; null when the studio does not know it. */
  webUrl: string | null;
  /** Cards picked to compare, by key, in the order picked. */
  compare: readonly string[];
  /** Frames, by key, whose rejected cards show. */
  unfolded: readonly string[];
};

/** Compare shows up to four iterations side by side. */
export const MAX_COMPARE = 4;

export type CanvasEntry =
  | { kind: 'section'; section: CanvasSectionInput }
  | { kind: 'frame'; section: CanvasSectionInput; frame: CanvasFrameInput }
  | {
      kind: 'card';
      section: CanvasSectionInput;
      frame: CanvasFrameInput;
      card: CanvasCardInput;
    };

/** The item a canvas key names, from the canvas's input; null for one that is not there. */
export function canvasEntry(input: CanvasInput, key: string | null): CanvasEntry | null {
  if (!key) return null;
  const at = key.indexOf(':');
  const [page = '', component = '', iteration = ''] = key.slice(at + 1).split('/');
  const section = input.sections.find(entry => entry.id === page);
  if (!section) return null;
  const kind = key.slice(0, at);
  if (kind === 'page') return { kind: 'section', section };
  const frame = section.frames.find(entry => entry.id === component);
  if (!frame) return null;
  if (kind === 'component' || kind === 'folded') return { kind: 'frame', section, frame };
  const card = kind === 'iteration' ? frame.cards.find(entry => entry.id === iteration) : undefined;
  return card ? { kind: 'card', section, frame, card } : null;
}

/** The ids picked to compare in one component, in the order picked. */
export function picksIn(compare: readonly string[], page: string, component: string): string[] {
  const prefix = `iteration:${page}/${component}/`;
  return compare.filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
}

function compareAction(page: string, component: string, ids: string[]): StudioAction[] {
  return ids.length >= 2
    ? [
        {
          id: 'compare',
          label: `Compare ${ids.length}`,
          toolbar: true,
          href: `/${page}/${component}/iterations/compare?ids=${ids.join(',')}`
        }
      ]
    : [];
}

function webAction(
  state: SelectionState,
  path: string,
  label: string,
  toolbar = false
): StudioAction[] {
  return state.webUrl
    ? [
        {
          id: 'web',
          label,
          toolbar,
          href: `${state.webUrl}/projects/${state.project}/${path}`,
          external: true
        }
      ]
    : [];
}

/** The selection's actions, toolbar's first, as `canvas` and `state` allow. */
export function selectionActions(
  canvas: StudioCanvas,
  key: string,
  state: SelectionState
): StudioAction[] {
  const entry = canvasEntry(canvas.input, key);
  if (!entry) return [];
  const page = entry.section.id;
  if (entry.kind === 'section') return webAction(state, page, 'Open on the web');
  const component = entry.frame.id;
  const picks = picksIn(state.compare, page, component);

  if (entry.kind === 'frame') {
    const selected = entry.frame.cards.find(card => card.selected);
    const folded = entry.frame.cards.filter(card => card.folded).length;
    const open = state.unfolded.includes(`component:${page}/${component}`);
    const promotable =
      selected && canvas.cards[`iteration:${page}/${component}/${selected.id}`]?.kind === 'local';
    return [
      { id: 'brief', label: 'Brief', toolbar: true },
      ...compareAction(page, component, picks),
      ...(promotable ? [{ id: 'promote' as const, label: 'Promote', toolbar: true }] : []),
      ...(folded
        ? [
            {
              id: 'fold' as const,
              label: `${open ? 'Hide' : 'Show'} ${folded} rejected`,
              toolbar: true
            }
          ]
        : []),
      ...webAction(state, `${page}/${component}`, 'Open on the web')
    ];
  }

  const { card } = entry;
  const facts = canvas.cards[key];
  if (!facts) return [];
  if (facts.kind === 'sketch') {
    return [
      ...(facts.pullable ? [{ id: 'pull' as const, label: 'Pull', toolbar: true }] : []),
      ...webAction(state, `${page}/${component}/${card.id}`, 'View on the web', true)
    ];
  }

  const actions: StudioAction[] = [];
  if (facts.kind === 'local') {
    actions.push({ id: 'open', label: 'Open', toolbar: true, href: card.href, keys: 'Enter' });
  }
  const run = facts.run;
  if (run) {
    const running = runRunning(run);
    actions.push({ id: 'done', label: 'Done', toolbar: true });
    if (running) actions.push({ id: 'stop', label: 'Stop', toolbar: true });
    actions.push({ id: 'copy-prompt', label: 'Copy prompt', toolbar: true });
    if (run.terminal) {
      actions.push({ id: 'terminal', label: 'Terminal', toolbar: true, session: run.terminal.id });
    }
    if (!running) {
      actions.push(
        { id: 'failed', label: 'It failed', toolbar: false },
        { id: 'cancel', label: 'Cancel it', toolbar: false }
      );
    }
  } else if (facts.generated) {
    const picked = state.compare.includes(key);
    actions.push(
      { id: 'fork', label: 'Fork', toolbar: true },
      { id: 'refine', label: 'Refine', toolbar: true },
      { id: 'pick', label: picked ? 'Unpick' : 'Pick', toolbar: true, keys: 'Shift-click' },
      ...compareAction(page, component, picks),
      ...(card.selected ? [{ id: 'promote' as const, label: 'Promote', toolbar: true }] : [])
    );
  }
  if (facts.kind === 'local') {
    actions.push(...webAction(state, `${page}/${component}/${card.id}`, 'Open on the web'));
  }
  return actions;
}

/** The canvas's own controls, as `mode` shows them, and the terminals once there are any. */
export function canvasActions(
  selection: string | null,
  { mode, sessions }: { mode: CanvasMode; sessions: number }
): StudioAction[] {
  const actions: StudioAction[] = [
    { id: 'prompt', label: 'Write a prompt', toolbar: false, keys: '/' }
  ];
  if (mode === 'canvas') {
    actions.push(
      { id: 'zoom-in', label: 'Zoom in', toolbar: false, keys: '+' },
      { id: 'zoom-out', label: 'Zoom out', toolbar: false, keys: '-' },
      { id: 'zoom-reset', label: 'Zoom to 100%', toolbar: false, keys: 'Shift 0' },
      { id: 'fit-all', label: 'Fit everything', toolbar: false, keys: 'Shift 1' }
    );
    if (selection) {
      actions.push({
        id: 'fit-selection',
        label: 'Fit the selection',
        toolbar: false,
        keys: 'Shift 2'
      });
    }
  }
  if (mode !== 'phone') {
    actions.push({
      id: 'list',
      label: mode === 'list' ? 'Canvas view' : 'List view',
      toolbar: false,
      keys: 'L'
    });
  }
  if (sessions) actions.push({ id: 'dock', label: 'Terminals', toolbar: false });
  return actions;
}
