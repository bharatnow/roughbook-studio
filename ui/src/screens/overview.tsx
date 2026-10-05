import { useState } from 'react';
import { post } from '../api';
import { describe, localIterations, useStudio } from '../data';
import { Sessions } from '../parts/shell';
import type { StudioState } from '../types';

function Agents({ state }: { state: StudioState }) {
  const { refreshState, say } = useStudio();
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-card border border-ash bg-canvas p-4">
      <h2 className="font-display text-base tracking-tight text-graphite">Agents</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {state.agents.map(agent => (
          <li key={agent.id} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className={agent.found ? 'text-graphite' : 'text-fog'}>
                {agent.name}
                {agent.version ? (
                  <span className="ml-2 font-mono text-xs text-steel">{agent.version}</span>
                ) : null}
              </span>
              {agent.found ? (
                <button
                  type="button"
                  disabled={busy || state.defaultAgent === agent.id}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await post('/api/agents/default', { agent: agent.id });
                      await refreshState();
                    } catch (error) {
                      say({ tone: 'error', text: describe(error) });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="text-xs text-violet hover:underline disabled:text-steel disabled:no-underline"
                >
                  {state.defaultAgent === agent.id ? 'Default' : 'Make default'}
                </button>
              ) : (
                <span className="text-xs text-steel">Not found</span>
              )}
            </div>
            {agent.found ? (
              <p className="text-xs text-steel">
                {agent.signIn ?? (agent.signedIn === false ? 'Not signed in' : 'Signed in')}
                {' · '}
                {agent.headless.ready ? 'can run unattended' : 'terminal only'}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-steel">
        {state.terminal.builtin
          ? 'Sessions open here, in the built-in terminal, or in your own.'
          : state.terminal.reason}
      </p>
    </section>
  );
}

export function Overview() {
  const { state, project, terminals } = useStudio();
  if (!project || !state) return <p className="text-sm text-slate">Loading the project…</p>;
  const webHref = state.webUrl ? `${state.webUrl}/projects/${project.tree.slug}` : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl tracking-tight text-graphite">
            {project.tree.name}
          </h1>
          {webHref ? (
            <a
              href={webHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-violet hover:underline"
            >
              Open the brief on the web
            </a>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate">
          Iterations in this repo&apos;s <span className="font-mono">rough/</span>, rendered by the
          app&apos;s own dev server. Their code stays here; decisions go to the project.
        </p>
        {project.tree.pages.map(page => (
          <section key={page.slug} className="mt-8">
            <h2 className="font-mono text-[11px] tracking-[0.12em] text-steel uppercase">
              {page.name}
            </h2>
            <ul className="mt-3 divide-y divide-ash border-y border-ash">
              {page.components.map(component => {
                const local = localIterations(project, page.slug, component);
                const selected = component.iterations.find(
                  item => item.number === component.selectedIteration
                );
                return (
                  <li key={component.slug}>
                    <a
                      href={`#/${page.slug}/${component.slug}/iterations`}
                      className="flex items-center justify-between gap-4 py-3 hover:bg-frost/60"
                    >
                      <span className="font-display text-base tracking-tight text-graphite">
                        {component.name}
                      </span>
                      <span className="flex gap-4 font-mono text-xs text-steel">
                        <span>
                          {local.length} here
                          {component.iterations.length > local.length
                            ? ` of ${component.iterations.length}`
                            : ''}
                        </span>
                        {selected ? (
                          <span className="text-violet">{selected.id} selected</span>
                        ) : null}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <aside className="flex flex-col gap-6">
        <Agents state={state} />
        <Sessions sessions={terminals} />
      </aside>
    </div>
  );
}
