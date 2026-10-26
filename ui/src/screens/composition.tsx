import {
  CompositionSections,
  HelpTip,
  PreviewFrame,
  STACKED_NOTE,
  termLabel,
  useUiHost
} from '@roughbook/ui';
import { CopyPlus } from 'lucide-react';
import {
  composeAddress,
  composedKey,
  compositionName,
  findComposition,
  sectionItems
} from '../composition';
import { useStudio } from '../data';
import { CompositionPromote } from '../parts/composition-promote';
import { Missing } from '../parts/missing';
import { usePromotePlan } from '../parts/promote-plan';
import { useApp } from './iteration';

/**
 * A page's composition's own view (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md): the page as it composes
 * it, in the app's preview route with its layout and styles, Pick selecting a section on the
 * canvas; its sections in order; and Promote into the app's page. Where the stack does not compose
 * yet, each section is in its own frame, one under another, and the frame says so (decision 54).
 */
export function CompositionScreen({ page, id }: { page: string; id: string }) {
  const { state, project, refresh } = useStudio();
  const { previewSrc, Link } = useUiHost();
  const app = useApp(state?.app ?? null);
  const plan = usePromotePlan({ page, component: 'compositions', iteration: id });
  if (!project || !state) return <Missing>Loading…</Missing>;
  const view = findComposition(project, page, id);
  const record = project.tree.pages.find(item => item.slug === page);
  if (!view || !record) {
    return <Missing back>{`${page} has no composition ${id} in this repo.`}</Missing>;
  }
  const environment = state.environment;
  const name = compositionName(view);
  const items = sectionItems(project, view);
  const frame = {
    viewports: environment.viewports,
    variants: environment.variants,
    app: app.status,
    devUrl: state.devUrl,
    progress: app.lastLine,
    reload: environment.reload,
    timeoutMs: environment.timeouts.preview * 1000
  };
  const agentName =
    (
      state.agents.find(agent => agent.found && agent.id === state.defaultAgent) ??
      state.agents.find(agent => agent.found)
    )?.name ?? 'your agent';
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 truncate font-display text-lg tracking-tight text-graphite">
          {record.name}: {name}
        </h1>
        <span className="font-mono text-xs text-steel">{id}</span>
        <Link
          href={composeAddress(page, id)}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-control border border-ash bg-canvas px-3 text-sm text-graphite hover:border-mist"
        >
          <CopyPlus className="size-4" strokeWidth={1.5} />
          Edit as new
        </Link>
      </div>
      {view.address ? (
        <PreviewFrame
          mode="live"
          items={[
            {
              key: composedKey(page),
              label: name,
              src: null,
              inPageSrc: `${state.devUrl}${view.address}`,
              exists: true
            }
          ]}
          kicker={`${termLabel('page', environment.terms)} ${record.name} · ${name}`}
          defaultView="in-page"
          pick
          {...frame}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1 text-sm text-graphite">
            Each section alone
            <HelpTip label="About the sections shown alone">{STACKED_NOTE}</HelpTip>
          </h2>
          {view.sections.map(section => {
            const key = `${page}/${section.component}/${section.iteration}`;
            return (
              <PreviewFrame
                key={key}
                mode={environment.mode}
                items={[
                  {
                    key,
                    label: items.find(item => item.component === section.component)?.name,
                    src: previewSrc({ project: project.tree.slug, page, ...section }),
                    exists: project.local.iterations.includes(key)
                  }
                ]}
                {...frame}
              />
            );
          })}
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-base tracking-tight text-graphite">Sections</h2>
          <CompositionSections sections={items} />
        </section>
        <CompositionPromote
          project={project.tree.slug}
          page={page}
          id={id}
          plan={plan}
          agentName={agentName}
          onChanged={() => void refresh()}
        />
      </div>
    </div>
  );
}
