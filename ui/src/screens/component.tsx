import {
  IterationCard,
  LineageTree,
  PromotePanel,
  buildLineageTree,
  decisionOf
} from '@roughbook/ui';
import { useState } from 'react';
import { findComponent, localIterations, useStudio } from '../data';
import { useRatings } from '../parts/ratings';
import { RefineDrawer } from '../parts/refine';
import { RunCard } from '../parts/run-card';
import { RunPanel } from '../parts/run-panel';
import { BriefSummary, Sessions } from '../parts/shell';
import { WebSketches } from '../parts/sketches';
import { navigate } from '../router';

const NO_SOURCE = {
  editorHref: null,
  viewHref: null,
  editorUnavailable: 'Open it from the repo in your editor.'
};

/** "Hero" → "Hero.tsx" in the components folder, as `roughbook promote` names it. */
function defaultFile(componentsDir: string, name: string): string {
  const pascal = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${componentsDir.replace(/\/+$/, '')}/${pascal || 'Component'}.tsx`;
}

export function ComponentScreen({ page, component }: { page: string; component: string }) {
  const { state, project, runs, terminals } = useStudio();
  const [compare, setCompare] = useState<string[]>([]);
  const [showRejected, setShowRejected] = useState(false);
  const ratings = useRatings(page, component);
  const found = findComponent(project, page, component);
  if (!project || !state) return <p className="text-sm text-slate">Loading…</p>;
  if (!found)
    return (
      <p className="text-sm text-slate">
        There is no {page}/{component} in this project.
      </p>
    );

  const record = found.component;
  const base = `/${page}/${component}`;
  const here = localIterations(project, page, record);
  const turnedDown = here.filter(item =>
    ['rejected', 'archived'].includes(decisionOf(item.status))
  );
  const shown = showRejected ? here : here.filter(item => !turnedDown.includes(item));
  const mine = runs.filter(run => run.page === page && run.component === component);
  const open = mine.filter(run => run.status === 'started');
  const recent = mine.filter(run => run.status === 'finished').slice(0, 4);
  const selected = record.iterations.find(item => item.number === record.selectedIteration) ?? null;
  const promoting = terminals.filter(item => item.runId === null);
  const webBase = state.webUrl
    ? `${state.webUrl}/projects/${project.tree.slug}/${page}/${component}`
    : null;
  // A local iteration whose parent is a web sketch was pulled from it.
  const pulledAs = new Map(
    here.flatMap(item => (item.parent ? [[item.parent, item.id] as const] : []))
  );

  return (
    <div>
      <nav className="text-sm text-slate">
        <a href="#/" className="hover:text-graphite">
          {project.tree.name}
        </a>
        <span className="mx-1.5">/</span>
        <span>{found.page.name}</span>
      </nav>
      <h1 className="mt-1 font-display text-2xl tracking-tight text-graphite">{record.name}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <RunPanel page={page} component={component} iterations={here} />
          {open.length || recent.length ? (
            <section>
              <h2 className="font-display text-base tracking-tight text-graphite">Runs</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {[...open, ...recent].map(run => (
                  <RunCard key={run.runId} run={run} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <aside className="flex flex-col gap-6">
          <BriefSummary component={record} webHref={webBase ? `${webBase}/brief` : null} />
          <WebSketches page={page} component={component} pulledAs={pulledAs} webBase={webBase} />
          <Sessions sessions={promoting} />
        </aside>
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg tracking-tight text-graphite">
            Iterations <span className="font-mono text-sm text-steel">{here.length}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {turnedDown.length ? (
              <label className="flex items-center gap-2 text-slate">
                <input
                  type="checkbox"
                  checked={showRejected}
                  onChange={event => setShowRejected(event.target.checked)}
                  className="size-4 accent-[#5e4cff]"
                />
                Show rejected and archived ({turnedDown.length})
              </label>
            ) : null}
            <button
              type="button"
              disabled={compare.length < 2}
              onClick={() => navigate(`${base}/iterations/compare?ids=${compare.join(',')}`)}
              className="inline-flex h-8 items-center rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist hover:bg-frost disabled:opacity-50"
            >
              Compare {compare.length ? `(${compare.length})` : ''}
            </button>
          </div>
        </div>
        {!here.length ? (
          <p className="mt-4 text-sm text-slate">
            None in this repo yet. Start a run above; each iteration gets its own folder in{' '}
            <span className="font-mono">
              rough/{page}/{component}/
            </span>
            .
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
            {shown.map(iteration => {
              const run = mine.find(item => item.iteration === iteration.id);
              return (
                <div key={iteration.id} className="relative">
                  <label className="absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-control border border-ash bg-canvas">
                    <input
                      type="checkbox"
                      aria-label={`Compare ${iteration.id}`}
                      checked={compare.includes(iteration.id)}
                      onChange={() =>
                        setCompare(current =>
                          current.includes(iteration.id)
                            ? current.filter(id => id !== iteration.id)
                            : [...current, iteration.id].slice(-4)
                        )
                      }
                      className="size-4 accent-[#5e4cff]"
                    />
                  </label>
                  <IterationCard
                    project={project.tree.slug}
                    page={page}
                    component={component}
                    componentName={record.name}
                    base={base}
                    iteration={{
                      ...iteration,
                      relativePath: `rough/${page}/${component}/${iteration.id}`
                    }}
                    selected={iteration.number === record.selectedIteration}
                    rating={ratings[iteration.id] ?? null}
                    source={NO_SOURCE}
                    footer={
                      run?.status === 'started' ? (
                        <p className="mt-2 font-mono text-[11px] text-violet">
                          An agent is working on this. Press Done when it has finished.
                        </p>
                      ) : null
                    }
                    renderRefine={({ open: refineOpen, onClose }) => (
                      <RefineDrawer
                        open={refineOpen}
                        onClose={onClose}
                        page={page}
                        component={component}
                        parent={iteration.id}
                        parentName={iteration.name}
                        feedback={iteration.feedback}
                      />
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}
        {here.length > 1 ? (
          <div className="mt-10 border-t border-ash pt-8">
            <h2 className="font-display text-lg tracking-tight text-graphite">Iteration family</h2>
            <div className="mt-4">
              <LineageTree nodes={buildLineageTree(here)} base={base} />
            </div>
          </div>
        ) : null}
      </section>

      <div className="mt-10 max-w-xl border-t border-ash pt-8">
        <PromotePanel
          project={project.tree.slug}
          page={page}
          component={component}
          iteration={selected && here.some(item => item.id === selected.id) ? selected.id : null}
          iterationName={selected?.name ?? ''}
          linked
          defaultFile={defaultFile(project.tree.delivery.componentsDir, record.name)}
          promotions={record.promotions}
          agentName={
            // The agent promote opens: the default, or else the first one found.
            (
              state.agents.find(agent => agent.found && agent.id === state.defaultAgent) ??
              state.agents.find(agent => agent.found)
            )?.name ?? 'your agent'
          }
        />
      </div>
    </div>
  );
}
