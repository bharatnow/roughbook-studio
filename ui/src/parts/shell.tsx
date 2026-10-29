import { Button, MenuButton, Toolbar } from '@roughbook/ui';
import { ChevronLeft, House } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { post } from '../api';
import type { StudioCommand } from '../commands';
import { useStudio } from '../data';
import { completeFeaturesOf } from '../features';
import { TOOLBAR_ITEMS, documentItems, type DocumentItem } from '../toolbar';
import { useChrome } from './chrome';
import { Dock } from './dock';
import { OutputLine } from './output-line';
import { StudioPalette, useAppCommands } from './palette';
import { PicturesSheet } from './pictures-sheet';
import { PrivacySheet } from './privacy-sheet';
import { nextSheet, type SheetsState } from './sheets';
import { StatusButton } from './status';

/** A toolbar or menu item as the command it also is, for the palette's runner. */
function asCommand(item: DocumentItem): StudioCommand {
  return { id: item.id, label: item.label, group: 'Studio', run: item.run };
}

const LATER_KEY = 'roughbook.picturesLater';

/** "Ask me later" holds for this tab's session, across screens and reloads. */
function readLater(): boolean {
  try {
    return window.sessionStorage.getItem(LATER_KEY) === '1';
  } catch {
    return false;
  }
}

let laterThisSession = false;
let privacyClosedHere = false;

/**
 * The two one-time sheets (A4 of ROUGHBOOK-APPLE-PLAN.md): the project's pictures question while
 * nobody has answered it, then the privacy sheet once per install. One at a time.
 */
function OneTimeSheets() {
  const { state, refreshState } = useStudio();
  const [later, setLater] = useState(() => laterThisSession || readLater());
  const [privacyClosed, setPrivacyClosed] = useState(privacyClosedHere);
  const sheets = state as (SheetsState & { webUrl: string | null }) | null;
  const showing = nextSheet(sheets, { later, privacyClosed });

  function askLater() {
    laterThisSession = true;
    try {
      window.sessionStorage.setItem(LATER_KEY, '1');
    } catch {
      // Held for this page only.
    }
    setLater(true);
  }

  function closePrivacy() {
    privacyClosedHere = true;
    setPrivacyClosed(true);
    void post('/api/privacy-sheet/seen')
      .then(refreshState)
      .catch(() => {
        // Shown again next time, which is better than never.
      });
  }

  return (
    <>
      <PicturesSheet open={showing === 'pictures'} onLater={askLater} />
      <PrivacySheet
        open={showing === 'privacy'}
        lines={sheets?.privacySheet ?? []}
        webUrl={sheets?.webUrl ?? null}
        onClose={closePrivacy}
      />
    </>
  );
}

/** The content's id, which the skip link moves the keyboard to. */
export const CONTENT_ID = 'content';

const iconButton =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-control text-slate hover:bg-frost hover:text-graphite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:size-11';

/**
 * The one bar, as a toolbar of three groups (A8 step 3 of ROUGHBOOK-APPLE-PLAN.md): home and the
 * project's title, whose document menu holds what the studio can open or copy, then the breadcrumb
 * the canvas moves with its selection; search (the palette) in the centre; the status and one
 * Generate trailing. A narrow window shows the breadcrumb's last item with the way back. What the
 * bar's controls say goes in the <output> under it. It is frosted (A11 step 2 of the plan) and the
 * first pane F6 reaches (step 6).
 */
function Bar() {
  const { state, project, problem } = useStudio();
  const { crumbs, barLine } = useChrome();
  const runApp = useAppCommands();
  const name = project?.tree.name ?? state?.project.slug ?? 'Project';
  const trail = [{ href: '#/', label: name }, ...crumbs];
  const last = trail[trail.length - 1]!;
  const back = trail[trail.length - 2];
  const menu = state
    ? documentItems({
        project: state.project.slug,
        webUrl: state.webUrl,
        complete: completeFeaturesOf(state)
      })
    : [];
  const generate = TOOLBAR_ITEMS.find(item => item.id === 'generate')!;
  const title = menu.length ? (
    <MenuButton
      label={`${name}, project menu`}
      align="start"
      items={menu.map(item => ({ label: item.label, onSelect: () => runApp(asCommand(item)) }))}
    >
      <span className="truncate font-medium text-graphite">{name}</span>
    </MenuButton>
  ) : (
    <span className="truncate px-1 font-medium text-graphite">{name}</span>
  );

  return (
    <header data-pane="bar" className="material-frost sticky top-0 z-30 border-b border-ash">
      <div className="flex h-12 items-center px-4 max-md:px-2">
        <div className="min-w-0 flex-1">
          <Toolbar
            label="Studio"
            leading={
              <>
                <a href="#/" aria-label="Home" className={`${iconButton} max-md:hidden`}>
                  <House className="size-4" strokeWidth={1.5} aria-hidden />
                </a>
                <nav aria-label="Breadcrumb" className="min-w-0">
                  <ol className="flex min-w-0 items-center gap-1.5 text-body max-md:hidden">
                    <li className="flex min-w-0 items-center">
                      {trail.length === 1 ? <h1 className="min-w-0">{title}</h1> : title}
                    </li>
                    {crumbs.map((crumb, index) => (
                      <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden className="text-fog">
                          /
                        </span>
                        {index === crumbs.length - 1 ? (
                          <h1 aria-current="page" className="truncate text-graphite">
                            {crumb.label}
                          </h1>
                        ) : (
                          <a href={crumb.href} className="truncate text-slate hover:text-graphite">
                            {crumb.label}
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="flex min-w-0 items-center gap-1 text-body md:hidden">
                    {back ? (
                      <a
                        href={back.href}
                        aria-label={`Back to ${back.label}`}
                        className={iconButton}
                      >
                        <ChevronLeft className="size-4" strokeWidth={1.5} aria-hidden />
                      </a>
                    ) : null}
                    {back ? (
                      <h1 className="truncate text-graphite">{last.label}</h1>
                    ) : (
                      <h1 className="min-w-0">{title}</h1>
                    )}
                  </div>
                </nav>
              </>
            }
            center={<StudioPalette />}
            trailing={
              <>
                <StatusButton />
                <Button
                  type="button"
                  kind="primary"
                  tier="compact"
                  onClick={() => runApp(asCommand(generate))}
                >
                  {generate.label}
                </Button>
              </>
            }
          />
        </div>
      </div>
      {problem ? (
        <p
          role="alert"
          className="border-t border-ash bg-canvas px-4 py-2 text-center text-body text-danger"
        >
          {problem}
        </p>
      ) : null}
      <OutputLine line={barLine} className="border-t border-ash bg-canvas px-4 py-2 text-center" />
    </header>
  );
}

/**
 * Every screen's frame. `fill` gives the screen the rest of the window, with the terminal dock at
 * its foot, for the canvas; `bare` leaves it the whole page, for the stage, which has its own bar.
 * The <main> is the content pane (`data-pane`, A11 step 6) and the skip link's target.
 */
export function Shell({
  children,
  bare = false,
  fill = false
}: {
  children: ReactNode;
  bare?: boolean;
  fill?: boolean;
}) {
  const { terminals } = useStudio();
  const { dock } = useChrome();
  const docked = dock.open && terminals.length > 0;
  if (bare) {
    return (
      <>
        {children}
        <OneTimeSheets />
      </>
    );
  }
  if (fill) {
    return (
      <div data-dock={docked ? 'open' : undefined} className="flex h-[100dvh] flex-col">
        <Bar />
        <main
          id={CONTENT_ID}
          tabIndex={-1}
          data-pane="content"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {children}
        </main>
        <Dock />
        <OneTimeSheets />
      </div>
    );
  }
  return (
    <div className="min-h-[100dvh]">
      <Bar />
      <main
        id={CONTENT_ID}
        tabIndex={-1}
        data-pane="content"
        className="mx-auto max-w-6xl px-4 py-8"
      >
        {children}
      </main>
      <OneTimeSheets />
    </div>
  );
}
