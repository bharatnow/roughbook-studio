import { PreviewFrame, termLabel } from '@roughbook/ui';
import { useStudio } from '../data';
import { pageViewSrc } from '../in-page';
import { Missing } from '../parts/missing';
import { useApp } from './iteration';

/**
 * An adopted page's own view, in the app as it runs (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md): the
 * page at its address with its sections marked, where Pick selects the clicked section on the
 * canvas. Only where the recipe has the in-page view and it is set up.
 */
export function PageScreen({ page }: { page: string }) {
  const { state, project } = useStudio();
  const app = useApp(state?.app ?? null);
  if (!project || !state) return <Missing>Loading…</Missing>;
  const record = project.tree.pages.find(item => item.slug === page);
  const src = pageViewSrc(project.local, state.devUrl, page);
  if (!record || !src) {
    return (
      <Missing back>
        {record
          ? `${record.name} has no view in the app here: its stack shows components alone, or roughbook setup --upgrade has not set the in-page view up yet.`
          : `${page} is not in this project.`}
      </Missing>
    );
  }
  const environment = state.environment;
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-3 p-4">
      <PreviewFrame
        mode="live"
        items={[{ key: page, label: record.name, src: null, inPageSrc: src, exists: true }]}
        viewports={environment.viewports}
        variants={environment.variants}
        kicker={`${termLabel('page', environment.terms)} ${record.name} · in the app`}
        app={app.status}
        devUrl={state.devUrl}
        progress={app.lastLine}
        reload={environment.reload}
        timeoutMs={environment.timeouts.preview * 1000}
        defaultView="in-page"
        pick
      />
    </div>
  );
}
