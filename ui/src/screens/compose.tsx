import { CompositionEditor, termLabel } from '@roughbook/ui';
import {
  appSections,
  canCompose,
  composedSrc,
  compositionAddress,
  compositionComponents,
  findComposition
} from '../composition';
import { useStudio } from '../data';
import { Missing } from '../parts/missing';
import { navigate } from '../router';
import { useApp } from './iteration';

/**
 * A page's composition editor (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 46, 47 and 52), on an
 * adopted page: it starts from the app's own order on the baselines, or from a saved composition;
 * the preview is the composed page where the recipe composes; Save numbers it on the backend and
 * keeps it in rough/, then opens it.
 */
export function ComposeScreen({ page, from }: { page: string; from: string | null }) {
  const { state, project } = useStudio();
  const app = useApp(state?.app ?? null);
  if (!project || !state) return <Missing>Loading…</Missing>;
  const record = project.tree.pages.find(item => item.slug === page);
  if (!record || !canCompose(project, page)) {
    return (
      <Missing back>
        {`A composition is made of one of the app's pages, adopted: adopt ${record?.name ?? page} first, with roughbook adopt ${page}.`}
      </Missing>
    );
  }
  const start = from ? findComposition(project, page, from) : null;
  const environment = state.environment;
  const order = appSections(project, page);
  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-4 overflow-y-auto p-4">
      <h1 className="font-display text-lg tracking-tight text-graphite">Compose {record.name}</h1>
      <CompositionEditor
        key={`${page}/${from ?? ''}`}
        project={project.tree.slug}
        page={page}
        components={compositionComponents(project, page)}
        initialSections={start ? start.sections : order}
        appSections={order}
        parent={start ? start.id : null}
        frame={{
          mode: environment.mode,
          viewports: environment.viewports,
          variants: environment.variants,
          app: app.status,
          devUrl: state.devUrl,
          timeoutMs: environment.timeouts.preview * 1000,
          kicker: `${termLabel('page', environment.terms)} ${record.name}`
        }}
        composedSrc={composedSrc(project, state.devUrl, page)}
        pick
        onSaved={result => {
          if (result.id) navigate(`#${compositionAddress(page, result.id)}`);
        }}
      />
    </div>
  );
}
