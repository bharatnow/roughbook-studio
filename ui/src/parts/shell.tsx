import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStudio } from '../data';
import { useChrome } from './chrome';
import { Dock } from './dock';
import { StudioPalette } from './palette';
import { StatusButton } from './status';

/** What the studio has to say, in the corner of every screen until dismissed. */
function Notice() {
  const { notice, say } = useStudio();
  if (!notice) return null;
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`fixed right-4 bottom-4 z-50 flex max-w-md items-start gap-3 rounded-card border bg-canvas px-4 py-3 text-sm shadow-[0_8px_30px_rgba(39,40,53,0.12)] ${
        notice.tone === 'error' ? 'border-danger text-danger' : 'border-ash text-graphite'
      }`}
    >
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button
        type="button"
        onClick={() => say(null)}
        className="-my-1 inline-flex min-h-6 items-center text-xs text-steel hover:text-graphite"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * The one bar (ROUGHBOOK-QUIET-UI-PLAN.md, U5): the logo, the breadcrumb the canvas moves with its
 * selection, the palette, and one status dot whose popover holds the dev server, the outbox and
 * the version. A narrow window shows the breadcrumb's last item with the way back.
 */
function Bar() {
  const { state, project, problem } = useStudio();
  const { crumbs } = useChrome();
  const trail = [
    { href: '#/', label: project?.tree.name ?? state?.project.slug ?? 'Project' },
    ...crumbs
  ];
  const last = trail[trail.length - 1]!;
  const back = trail[trail.length - 2];
  return (
    <header className="sticky top-0 z-30 border-b border-ash bg-cloud/95 backdrop-blur">
      <div className="flex h-12 items-center gap-3 px-4">
        <a href="#/" className="flex shrink-0 items-center gap-2 max-md:hidden">
          <span className="font-display text-base tracking-tight text-graphite">Roughbook</span>
          <span className="rounded-full bg-violet/10 px-2 py-0.5 font-mono text-[11px] text-violet">
            studio
          </span>
        </a>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm max-md:hidden">
            {trail.map((crumb, index) => (
              <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                {index ? (
                  <span aria-hidden className="text-fog">
                    /
                  </span>
                ) : null}
                {index === trail.length - 1 ? (
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
          <div className="flex min-w-0 items-center gap-1 text-sm md:hidden">
            {back ? (
              <a
                href={back.href}
                aria-label={`Back to ${back.label}`}
                className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-slate hover:bg-frost hover:text-graphite"
              >
                <ChevronLeft className="size-4" strokeWidth={1.5} />
              </a>
            ) : null}
            <h1 className="truncate text-graphite">{last.label}</h1>
          </div>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          <StudioPalette />
          <StatusButton />
        </div>
      </div>
      {problem ? (
        <p
          role="alert"
          className="border-t border-ash bg-canvas px-4 py-2 text-center text-sm text-danger"
        >
          {problem}
        </p>
      ) : null}
    </header>
  );
}

/**
 * Every screen's frame. `fill` gives the screen the rest of the window, with the terminal dock at
 * its foot, for the canvas; `bare` leaves it the whole page, for the stage, which has its own bar.
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
        <Notice />
      </>
    );
  }
  if (fill) {
    return (
      <div data-dock={docked ? 'open' : undefined} className="flex h-[100dvh] flex-col">
        <Bar />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
        <Dock />
        <Notice />
      </div>
    );
  }
  return (
    <div className="min-h-[100dvh]">
      <Bar />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <Notice />
    </div>
  );
}
