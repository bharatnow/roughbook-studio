import {
  Canvas,
  Drawer,
  PromotePanel,
  SelectionToolbar,
  cn,
  selectionToolbarItem,
  useCanvasNarrow,
  useUiHost,
  type CanvasControls,
  type CanvasView
} from '@roughbook/ui';
import {
  DEFAULT_CARD_VIEW,
  keyForFocus,
  type CanvasFocus,
  type CanvasItem,
  type CardView
} from '@roughbook/ui/canvas';
import {
  Check,
  CloudDownload,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  GitFork,
  Layers,
  PackageCheck,
  Square,
  SquareTerminal,
  Wand2
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { post } from '../api';
import {
  MAX_COMPARE,
  canvasEntry,
  selectionActions,
  type CanvasMode,
  type SelectionState,
  type StudioAction,
  type StudioActionId
} from '../canvas-actions';
import { studioCanvasInput, type StudioCanvas } from '../canvas-input';
import { studioCommands, type StudioCommand } from '../commands';
import { describe, findComponent, useStudio } from '../data';
import { BriefDrawer } from '../parts/brief';
import { useChrome } from '../parts/chrome';
import { useDialogFocus } from '../parts/dialog-focus';
import { Missing } from '../parts/missing';
import { useAppCommands } from '../parts/palette';
import { StudioPrompt, partsOf } from '../parts/prompt';
import { RefineDrawer } from '../parts/refine';
import { WhoseChangesDrawer, useRunOps, type RunOps } from '../parts/run-card';
import { LaunchResult } from '../parts/run-options';
import { addressFor, navigate } from '../router';
import type { Launched, ProjectView, RunView, StudioState } from '../types';

const PROMPT_FIELD = 'canvas-prompt';

/** What the canvas keeps while the app runs, so it comes back the same from the stage or Compare. */
const kept: {
  view?: CanvasView;
  selection?: string | null;
  unfolded?: string[];
  list?: boolean;
  compare?: string[];
  cardView?: CardView;
} = {};

const ICONS: Partial<Record<StudioActionId, typeof GitFork>> = {
  fork: GitFork,
  refine: Wand2,
  pick: Layers,
  compare: Columns2,
  promote: PackageCheck,
  done: Check,
  stop: Square,
  'copy-prompt': Copy,
  terminal: SquareTerminal,
  pull: CloudDownload,
  web: ExternalLink,
  brief: FileText
};

const RUN_ACTIONS = new Set<StudioActionId>(['done', 'stop', 'copy-prompt']);

/** "Hero" → "Hero.tsx" in the components folder, as `roughbook promote` names it. */
function defaultFile(componentsDir: string, name: string): string {
  const pascal = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${componentsDir.replace(/\/+$/, '')}/${pascal || 'Component'}.tsx`;
}

function Icon({ id }: { id: StudioActionId }) {
  const Glyph = ICONS[id];
  return Glyph ? <Glyph className="size-4" strokeWidth={1.5} /> : null;
}

/**
 * A making card's Done, Stop and Copy prompt in its toolbar, with Done's question about files
 * changed outside the iteration in a drawer. Its operations are lent to the palette while shown.
 */
function RunButtons({
  run,
  actions,
  opsRef
}: {
  run: RunView;
  actions: StudioAction[];
  opsRef: MutableRefObject<{ runId: string; ops: RunOps } | null>;
}) {
  const ops = useRunOps(run);
  useEffect(() => {
    opsRef.current = { runId: run.runId, ops };
    return () => {
      if (opsRef.current?.runId === run.runId) opsRef.current = null;
    };
  });
  const busy = ops.busy !== null;
  return (
    <>
      {actions.map(action => (
        <button
          key={action.id}
          type="button"
          disabled={busy || (action.id === 'done' && run.headless?.status === 'running')}
          onClick={() =>
            void (action.id === 'done'
              ? ops.finish()
              : action.id === 'stop'
                ? ops.stop()
                : ops.copyPrompt())
          }
          className={selectionToolbarItem}
        >
          <Icon id={action.id} />
          {action.id === 'done' && ops.busy === 'done' ? 'Checking' : action.label}
        </button>
      ))}
      <WhoseChangesDrawer run={run} ops={ops} />
    </>
  );
}

/** The studio's home (ROUGHBOOK-QUIET-UI-PLAN.md, U5): the project's canvas, focused by the address. */
export function CanvasScreen({ focus, session }: { focus: CanvasFocus; session?: string }) {
  const { project, state } = useStudio();
  if (!project || !state) {
    return (
      <div className="px-4 py-8">
        <Missing>Loading the project…</Missing>
      </div>
    );
  }
  return <StudioCanvasView project={project} state={state} focus={focus} session={session} />;
}

function StudioCanvasView({
  project,
  state,
  focus,
  session
}: {
  project: ProjectView;
  state: StudioState;
  focus: CanvasFocus;
  session?: string;
}) {
  const { runs, terminals, runsReady, refresh, say } = useStudio();
  const { setCrumbs, palette, dock, showSession } = useChrome();
  const { Link } = useUiHost();
  const runApp = useAppCommands();
  const controls = useRef<CanvasControls | null>(null);
  const runOps = useRef<{ runId: string; ops: RunOps } | null>(null);

  // Read again every few seconds while a run is open; drawn again only when something changed.
  const signature = JSON.stringify([project, runs, state.shotKey]);
  const canvas: StudioCanvas = useMemo(
    () => studioCanvasInput(project.tree, runs, project.local, { shotKey: state.shotKey }),
    // The signature stands for all three.
    [signature]
  );

  // --- the selection, and the address it moves --------------------------------------------------

  const routeKey = keyForFocus(focus);
  const returning = kept.view !== undefined && kept.selection === routeKey;
  const [selection, setSelectionState] = useState<string | null>(routeKey);
  const select = (key: string | null) => {
    setSelectionState(key);
    kept.selection = key;
    const address = addressFor(key);
    if (window.location.hash !== address) window.history.replaceState(null, '', address);
  };
  // A new address (a link, the breadcrumb, a command) selects its item; a session's selects its
  // run's card, below.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!session) controls.current?.select(keyForFocus(focus));
  }, [focus, session]);

  // What a pull, a prompt or a session's address names: selected at once, or once the canvas has
  // its card. The keyboard goes to it unless a terminal has just taken it.
  const latest = useRef(canvas);
  latest.current = canvas;
  const pending = useRef<{ key: string; focus: boolean } | null>(null);
  const selectWhenThere = (key: string, focus: boolean) => {
    if (latest.current.cards[key]) controls.current?.select(key, { focus });
    else pending.current = { key, focus };
  };
  useEffect(() => {
    const wanted = pending.current;
    if (wanted && canvas.cards[wanted.key]) {
      pending.current = null;
      controls.current?.select(wanted.key, { focus: wanted.focus });
    }
  }, [canvas]);

  // The bar's breadcrumb follows the selection.
  useEffect(() => {
    const entry = canvasEntry(canvas.input, selection);
    if (!entry) return setCrumbs([]);
    const page = entry.section;
    setCrumbs([
      { href: `#/${page.id}`, label: page.name },
      ...(entry.kind === 'section'
        ? []
        : [{ href: `#/${page.id}/${entry.frame.id}`, label: entry.frame.name }]),
      ...(entry.kind === 'card' ? [{ href: addressFor(selection), label: entry.card.name }] : [])
    ]);
  }, [canvas, selection, setCrumbs]);
  useEffect(() => () => setCrumbs([]), [setCrumbs]);

  // --- the terminal dock ---------------------------------------------------------------------------

  // A session's old address opens it in the dock, its run's card selected.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !runsReady || handled.current === session) return;
    handled.current = session;
    showSession(session);
    const runId = terminals.find(item => item.id === session)?.runId;
    const run = runs.find(item => item.runId === runId);
    if (run) selectWhenThere(`iteration:${run.page}/${run.component}/${run.iteration}`, false);
  }, [session, runsReady, terminals, runs, showSession]);

  // Closed until a run starts: a session that starts after the canvas opened opens the dock.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!runsReady) return;
    if (!seen.current) {
      seen.current = new Set(terminals.map(item => item.id));
      return;
    }
    const fresh = terminals.find(item => !seen.current!.has(item.id) && item.status === 'running');
    for (const item of terminals) seen.current.add(item.id);
    if (fresh) showSession(fresh.id);
  }, [terminals, runsReady, showSession]);

  // --- what the canvas keeps ------------------------------------------------------------------------

  const [compare, setCompare] = useState<string[]>(() => kept.compare ?? []);
  const [unfolded, setUnfolded] = useState<string[]>(() => kept.unfolded ?? []);
  const [list, setList] = useState(() => kept.list ?? false);
  const [cardView, setCardView] = useState<CardView>(() => kept.cardView ?? DEFAULT_CARD_VIEW);
  const narrow = useCanvasNarrow();
  const mode: CanvasMode = narrow ? 'phone' : list ? 'list' : 'canvas';
  const selState: SelectionState = {
    project: project.tree.slug,
    webUrl: state.webUrl,
    compare,
    unfolded
  };

  function toggleCompare(key: string) {
    const facts = canvas.cards[key];
    if (facts?.kind !== 'local' || !facts.generated || facts.run) return;
    setCompare(picked => {
      const own = partsOf(key);
      const firstPick = picked[0] ? partsOf(picked[0]) : null;
      // One component at a time, since Compare is a component's.
      const base =
        firstPick && (firstPick.page !== own.page || firstPick.component !== own.component)
          ? []
          : picked;
      const next = base.includes(key)
        ? base.filter(item => item !== key)
        : base.length < MAX_COMPARE
          ? [...base, key]
          : base;
      kept.compare = next;
      return next;
    });
  }

  // --- drawers ----------------------------------------------------------------------------------------

  const [brief, setBrief] = useState<{ page: string; component: string } | null>(null);
  const [promote, setPromote] = useState<{ page: string; component: string } | null>(null);
  const [refine, setRefine] = useState<{ page: string; component: string; id: string } | null>(
    null
  );
  const [launched, setLaunched] = useState<Launched | null>(null);
  useDialogFocus(Boolean(brief || promote || refine || launched));
  const [promptMode, setPromptMode] = useState('new');
  const [pulling, setPulling] = useState<string | null>(null);

  function promptFor(next: string) {
    setPromptMode(next);
    document.getElementById(PROMPT_FIELD)?.focus();
  }

  async function pull(page: string, component: string, sketch: string) {
    setPulling(sketch);
    try {
      const pulled = await post<{ iteration: string; advice: string[] }>(
        `/api/sketches/${encodeURIComponent(page)}/${encodeURIComponent(component)}/${encodeURIComponent(sketch)}/pull`
      );
      say({
        tone: 'info',
        text: [`Pulled ${sketch} into rough/ as ${pulled.iteration}.`, ...pulled.advice].join(' ')
      });
      await refresh();
      selectWhenThere(`iteration:${page}/${component}/${pulled.iteration}`, true);
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setPulling(null);
    }
  }

  // --- what each action does ---------------------------------------------------------------------

  function act(id: StudioActionId, key: string | null, session?: string) {
    const at = partsOf(key);
    const view = controls.current;
    const found = key
      ? selectionActions(canvas, key, selState).find(action => action.id === id)
      : undefined;
    switch (id) {
      case 'fork':
      case 'refine':
        if (key && key !== selection) view?.select(key);
        promptFor(id);
        return;
      case 'pick':
        if (key) toggleCompare(key);
        return;
      case 'promote':
        if (at.page && at.component) setPromote({ page: at.page, component: at.component });
        return;
      case 'brief':
        if (at.page && at.component) setBrief({ page: at.page, component: at.component });
        return;
      case 'fold':
        if (at.page && at.component) view?.toggleFold(`component:${at.page}/${at.component}`);
        return;
      case 'pull':
        if (at.page && at.component && at.iteration) {
          void pull(at.page, at.component, at.iteration);
        }
        return;
      case 'terminal':
        showSession(session ?? found?.session ?? null);
        return;
      case 'done':
      case 'failed':
      case 'cancel':
      case 'stop':
      case 'copy-prompt': {
        const ops = runOps.current?.ops;
        if (!ops) return;
        if (id === 'stop') void ops.stop();
        else if (id === 'copy-prompt') void ops.copyPrompt();
        else void ops.finish(id === 'done' ? undefined : id === 'failed' ? 'failed' : 'cancelled');
        return;
      }
      case 'prompt':
        document.getElementById(PROMPT_FIELD)?.focus();
        return;
      case 'zoom-in':
        view?.zoomBy(1.25);
        return;
      case 'zoom-out':
        view?.zoomBy(0.8);
        return;
      case 'zoom-reset':
        view?.zoomReset();
        return;
      case 'fit-all':
        view?.fitAll();
        return;
      case 'fit-selection':
        view?.fitSelection();
        return;
      case 'list':
        view?.setList(mode !== 'list');
        return;
      case 'dock':
        showSession(null);
        return;
      default:
        // Open, Compare and the web are links.
        if (found?.href && found.external) window.open(found.href, '_blank', 'noreferrer');
        else if (found?.href) navigate(found.href);
    }
  }

  function run(command: StudioCommand) {
    if (runApp(command)) return;
    const what = command.run;
    switch (what.kind) {
      case 'action':
        act(what.action, what.key, what.session);
        return;
      case 'select':
        controls.current?.select(what.key, { focus: true });
        return;
      case 'pull':
        void pull(what.page, what.component, what.sketch);
        return;
      case 'session':
        showSession(what.id);
        return;
      default:
        return;
    }
  }

  // The palette in the bar reads the canvas when it opens, and runs what is chosen here.
  useEffect(() => {
    palette.current = {
      commands: () =>
        studioCommands(selection, {
          name: project.tree.name,
          canvas,
          state: selState,
          mode,
          sessions: terminals,
          agents: state.agents,
          defaultAgent: state.defaultAgent
        }),
      run
    };
    return () => {
      palette.current = null;
    };
  });

  // --- the selection's toolbar --------------------------------------------------------------------

  function toolbarItem(action: StudioAction, item: CanvasItem): ReactNode {
    const icon = <Icon id={action.id} />;
    if (action.href) {
      return action.external ? (
        <a
          key={action.id}
          href={action.href}
          target="_blank"
          rel="noreferrer"
          className={selectionToolbarItem}
        >
          {icon}
          {action.label}
        </a>
      ) : (
        <Link key={action.id} href={action.href} className={selectionToolbarItem}>
          {icon}
          {action.label}
        </Link>
      );
    }
    const pressed = action.id === 'pick' ? compare.includes(item.key) : undefined;
    return (
      <button
        key={action.id}
        type="button"
        aria-pressed={pressed}
        disabled={action.id === 'pull' && pulling !== null}
        title={action.keys ? `${action.label} (${action.keys})` : undefined}
        onClick={() => act(action.id, item.key, action.session)}
        className={cn(selectionToolbarItem, pressed && 'bg-frost')}
      >
        {icon}
        {action.id === 'pull' && pulling === item.id ? 'Pulling' : action.label}
      </button>
    );
  }

  function actions(item: CanvasItem): ReactNode {
    const all = selectionActions(canvas, item.key, selState).filter(action => action.toolbar);
    if (!all.length) return null;
    const run = canvas.cards[item.key]?.run ?? null;
    const runActions = all.filter(action => RUN_ACTIONS.has(action.id));
    const items: ReactNode[] = [];
    for (const action of all) {
      if (RUN_ACTIONS.has(action.id)) {
        if (run && action === runActions[0]) {
          items.push(<RunButtons key="run" run={run} actions={runActions} opsRef={runOps} />);
        }
      } else {
        items.push(toolbarItem(action, item));
      }
    }
    return <SelectionToolbar label={`${item.name} actions`}>{items}</SelectionToolbar>;
  }

  // --- the drawers' items -------------------------------------------------------------------------

  const briefOf = brief ? findComponent(project, brief.page, brief.component) : null;
  const promoteOf = promote ? findComponent(project, promote.page, promote.component) : null;
  const promoteSelected = promoteOf
    ? promoteOf.component.iterations.find(
        item => item.number === promoteOf.component.selectedIteration
      )
    : undefined;
  const refineOf = refine ? findComponent(project, refine.page, refine.component) : null;
  const refineIteration = refineOf?.component.iterations.find(item => item.id === refine?.id);
  const webBase = state.webUrl ? `${state.webUrl}/projects/${project.tree.slug}` : null;
  const promoteAgent =
    (
      state.agents.find(agent => agent.found && agent.id === state.defaultAgent) ??
      state.agents.find(agent => agent.found)
    )?.name ?? 'your agent';

  const prompt = (
    <StudioPrompt
      canvas={canvas}
      selection={selection}
      mode={promptMode}
      onModeChange={setPromptMode}
      fieldId={PROMPT_FIELD}
      onStarted={({ runs: made, launched: how }) => {
        const first = made[0];
        // A built-in terminal has the keyboard; its session's address selects the card.
        if (first && how.kind !== 'builtin') {
          selectWhenThere(`iteration:${first.page}/${first.component}/${first.iteration}`, true);
        }
      }}
      onLaunched={setLaunched}
      onRefineOptions={() => {
        const at = partsOf(selection);
        if (at.page && at.component && at.iteration) {
          setRefine({ page: at.page, component: at.component, id: at.iteration });
        }
      }}
    />
  );

  return (
    <div data-studio-canvas className="flex min-h-0 flex-1 flex-col">
      <Canvas
        input={canvas.input}
        label={`${project.tree.name} canvas`}
        selection={selection}
        onSelect={select}
        opening={{
          key: routeKey,
          cards: focus.kind === 'iterations' || focus.kind === 'iteration'
        }}
        defaultView={returning ? kept.view : null}
        onViewChange={view => (kept.view = view)}
        defaultUnfolded={unfolded}
        onUnfoldedChange={next => {
          setUnfolded(next);
          kept.unfolded = next;
        }}
        defaultList={list}
        onListChange={next => {
          setList(next);
          kept.list = next;
        }}
        autoFocus={returning}
        marked={new Set(compare)}
        actions={actions}
        prompt={prompt}
        promptFieldId={PROMPT_FIELD}
        onToggleCompare={toggleCompare}
        cardView={cardView}
        onCardViewChange={next => {
          setCardView(next);
          kept.cardView = next;
        }}
        controlsRef={controls}
        controls={
          terminals.length && !dock.open ? (
            <button
              type="button"
              onClick={() => act('dock', null)}
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-ash bg-canvas px-3 text-sm text-graphite outline-none hover:border-mist focus-visible:ring-2 focus-visible:ring-violet"
            >
              <SquareTerminal className="size-4" strokeWidth={1.5} />
              Terminals
              <span className="font-mono text-xs text-steel">{terminals.length}</span>
            </button>
          ) : null
        }
      />

      <BriefDrawer
        component={briefOf?.component ?? null}
        webHref={briefOf && webBase ? `${webBase}/${brief!.page}/${brief!.component}/brief` : null}
        onClose={() => setBrief(null)}
      />
      <Drawer
        open={promoteOf !== null}
        onClose={() => setPromote(null)}
        title={promoteOf ? `Promote ${promoteOf.component.name}` : 'Promote'}
        size="lg"
      >
        {promoteOf ? (
          <PromotePanel
            project={project.tree.slug}
            page={promoteOf.page.slug}
            component={promoteOf.component.slug}
            iteration={
              promoteSelected &&
              project.local.iterations.includes(
                `${promoteOf.page.slug}/${promoteOf.component.slug}/${promoteSelected.id}`
              )
                ? promoteSelected.id
                : null
            }
            iterationName={promoteSelected?.name ?? ''}
            linked
            defaultFile={defaultFile(project.tree.delivery.componentsDir, promoteOf.component.name)}
            promotions={promoteOf.component.promotions}
            agentName={promoteAgent}
          />
        ) : null}
      </Drawer>
      {refine && refineIteration ? (
        <RefineDrawer
          open
          onClose={() => setRefine(null)}
          page={refine.page}
          component={refine.component}
          parent={refine.id}
          parentName={refineIteration.name}
          feedback={refineIteration.feedback}
        />
      ) : null}
      <Drawer open={launched !== null} onClose={() => setLaunched(null)} title="Started">
        <LaunchResult launched={launched} />
      </Drawer>
    </div>
  );
}
