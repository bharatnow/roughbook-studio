import { HelpTip } from '@roughbook/ui';
import { useState } from 'react';
import { post } from '../api';
import { describe, localIterations, useStudio } from '../data';
import { Missing } from '../parts/missing';
import { Sessions } from '../parts/shell';
import type { StudioState } from '../types';

function Agents({ state }: { state: StudioState }) {
  const { refreshState, say } = useStudio();
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-card border border-ash bg-canvas p-4">
      <h2 className="flex items-center gap-1 font-display text-base tracking-tight text-graphite">
        Agents
        <HelpTip label="About agents">
          {state.terminal.builtin
            ? 'Sessions open here, in the built-in terminal, or in your own.'
            : state.terminal.reason}
        </HelpTip>
      </h2>
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
              <span className="block text-xs text-steel">
                {agent.signIn ?? (agent.signedIn === false ? 'Not signed in' : 'Signed in')}
                {' · '}
                {agent.headless.ready ? 'can run unattended' : 'terminal only'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Overview() {
  const { state, project, terminals } = useStudio();
  if (!project || !state) return <Missing>Loading the project…</Missing>;
  const webHref = state.webUrl ? `${state.webUrl}/projects/${project.tree.slug}` : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="flex items-center gap-1 font-display text-2xl tracking-tight text-graphite">
            {project.tree.name}
            <HelpTip label="About this project's iterations">
              Iterations in this repo&apos;s <span className="font-mono">rough/</span>, rendered by
              the app&apos;s own dev server. Their code stays here; decisions go to the project.
            </HelpTip>
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
