import type { ReactNode } from 'react';
import { useStudio } from '../data';
import { endedLabel, type Component, type TerminalInfo } from '../types';

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
 * The bar every screen shares: the project, the dev server, and what waits in the outbox.
 * `bare` leaves the screen the whole page, for the stage, which has its own bar.
 */
export function Shell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { state, project, problem } = useStudio();
  if (bare) {
    return (
      <>
        {children}
        <Notice />
      </>
    );
  }
  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-ash bg-cloud/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <a href="#/" className="font-display text-base tracking-tight text-graphite">
            Roughbook
          </a>
          <span className="rounded-full bg-violet/10 px-2 py-0.5 font-mono text-[11px] text-violet">
            studio
          </span>
          <a href="#/" className="truncate text-sm text-slate hover:text-graphite">
            {project?.tree.name ?? state?.project.slug ?? ''}
          </a>
          <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-[11px] text-steel">
            {state ? <span>previews from {state.devUrl}</span> : null}
            {state?.outbox.pending ? (
              <span className="text-violet">{state.outbox.pending} waiting to send</span>
            ) : null}
            {state ? <span>v{state.version}</span> : null}
          </span>
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
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <Notice />
    </div>
  );
}

/** What the brief says, read-only: it is edited on the web. */
export function BriefSummary({
  component,
  webHref
}: {
  component: Component;
  webHref: string | null;
}) {
  const approved = component.copy.versions.find(item => item.number === component.copy.approved);
  return (
    <section className="rounded-card border border-ash bg-canvas p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base tracking-tight text-graphite">Brief</h2>
        {webHref ? (
          <a
            href={webHref}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-violet hover:underline"
          >
            Edit on the web
          </a>
        ) : null}
      </div>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {component.messages.primary ? (
          <div>
            <dt className="text-xs text-steel">Must say</dt>
            <dd className="text-graphite">{component.messages.primary}</dd>
          </div>
        ) : null}
        {component.userQuestion ? (
          <div>
            <dt className="text-xs text-steel">The visitor asks</dt>
            <dd className="text-graphite">{component.userQuestion}</dd>
          </div>
        ) : null}
        {approved ? (
          <div>
            <dt className="text-xs text-steel">Approved copy, version {approved.number}</dt>
            <dd className="font-display text-graphite">{approved.headline}</dd>
            {approved.supporting.map(line => (
              <dd key={line} className="text-slate">
                {line}
              </dd>
            ))}
          </div>
        ) : (
          <p className="text-xs text-steel">
            No approved copy yet; iterations use placeholder text.
          </p>
        )}
        {component.brief ? <p className="text-slate">{component.brief}</p> : null}
      </dl>
    </section>
  );
}

/** The built-in terminal's sessions: runs' agents and promotions. */
export function Sessions({ sessions }: { sessions: TerminalInfo[] }) {
  if (!sessions.length) return null;
  return (
    <section>
      <h2 className="font-display text-base tracking-tight text-graphite">Sessions</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {sessions.map(session => (
          <li key={session.id}>
            <a
              href={`#/terminals/${session.id}`}
              className="flex items-center justify-between gap-3 rounded-control border border-ash bg-canvas px-3 py-2 text-sm text-graphite hover:border-mist"
            >
              <span className="truncate">{session.title}</span>
              <span className="font-mono text-[11px] text-steel">{endedLabel(session)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
