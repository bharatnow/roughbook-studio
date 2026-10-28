import {
  CompareView,
  PreviewSurface,
  latestHumanReview,
  reviewSummary,
  useUiHost,
  type Review
} from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { get, iterationPath } from '../api';
import { compareBaseline } from '../canvas-actions';
import { compareCommands } from '../commands';
import { findComponent, localIterations, useStudio } from '../data';
import { completeFeaturesOf } from '../features';
import { useHostLine } from '../host';
import { newest } from '../output';
import { useChrome } from '../parts/chrome';
import { Missing } from '../parts/missing';
import { OutputLine } from '../parts/output-line';
import { useAppCommands } from '../parts/palette';
import { useRatings } from '../parts/ratings';
import { useRunVerb } from '../parts/verb-run';

/** Each candidate's latest review in one line, as the web's Compare shows it. */
function useSummaries(page: string, component: string, ids: string[]) {
  const [summaries, setSummaries] = useState<Record<string, string | null>>({});
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(
      key
        .split(',')
        .filter(Boolean)
        .map(async id => {
          const reviews = await get<Review[]>(
            `${iterationPath(page, component, id)}/reviews`
          ).catch(() => []);
          return [id, reviewSummary(latestHumanReview(reviews))] as const;
        })
    ).then(entries => live && setSummaries(Object.fromEntries(entries)));
    return () => {
      live = false;
    };
  }, [page, component, key]);
  return summaries;
}

export function CompareScreen({
  page,
  component,
  ids
}: {
  page: string;
  component: string;
  ids: string[];
}) {
  const { project, state, changes } = useStudio();
  const { previewSrc, actions } = useUiHost();
  const verbs = useRunVerb();
  const runApp = useAppCommands();
  // The candidates' verbs and their notes and ratings (the host's), said above the columns.
  const hostLine = useHostLine();
  const [since] = useState(() => Date.now());
  const summaries = useSummaries(page, component, ids);
  const ratings = useRatings(page, component);
  const found = findComponent(project, page, component);
  const { setCrumbs, palette } = useChrome();
  const pageName = found?.page.name;
  const componentName = found?.component.name;
  useEffect(() => {
    if (!pageName || !componentName) return;
    setCrumbs([
      { href: `#/${page}`, label: pageName },
      { href: `#/${page}/${component}`, label: componentName },
      { href: window.location.hash, label: 'Compare' }
    ]);
    return () => setCrumbs([]);
  }, [page, component, pageName, componentName, setCrumbs]);
  // The palette runs the candidates' verbs (A7) while Compare is open; Not this asks why on the stage.
  useEffect(() => {
    if (!project || !found) return;
    const shown = localIterations(project, page, found.component).filter(item =>
      ids.includes(item.id)
    );
    palette.current = {
      commands: () =>
        compareCommands(
          { page, component },
          shown.map(item => ({
            id: item.id,
            name: item.name,
            selected: item.number === found.component.selectedIteration
          })),
          actions.runVerb ? (actions.verbs ?? []) : [],
          {
            complete: completeFeaturesOf(state),
            project: state?.project.slug,
            webUrl: state?.webUrl ?? null
          }
        ),
      run: command => {
        if (runApp(command)) return;
        const what = command.run;
        if (what.kind === 'verb') {
          const iteration = what.key.slice(what.key.lastIndexOf('/') + 1);
          void verbs.run(
            what.verb,
            { project: project.tree.slug, page, component, iteration },
            what.fields
          );
        } else if (what.kind === 'complete-features') {
          void actions.setCompleteFeatures?.(what.on);
        }
      }
    };
    return () => {
      palette.current = null;
    };
  });
  if (!project || !state) return <Missing>Loading…</Missing>;
  if (!found) return <Missing back>There is no {`${page}/${component}`} in this project.</Missing>;
  const here = localIterations(project, page, found.component);
  const candidates = ids
    .map(id => here.find(item => item.id === id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const environment = state.environment;
  const variant = environment.variants[0] ?? null;
  // A change to an iteration's files reloads its column where the stack has no hot reload.
  const reloadSeq = environment.reload === 'studio' ? changes.seq : 0;

  return (
    <>
      <OutputLine
        line={newest(verbs.line, hostLine && hostLine.at >= since ? hostLine : null)}
        className="px-4 pt-3"
      />
      <CompareView
        project={project.tree.slug}
        page={page}
        component={component}
        base={`/${page}/${component}`}
        candidates={candidates}
        baseline={compareBaseline(
          ids,
          found.component,
          candidates.map(item => item.id)
        )}
        reviewSummaries={summaries}
        ratings={ratings}
        viewports={environment.viewports.map(viewport => ({
          id: viewport.name,
          label: viewport.name,
          width: viewport.width
        }))}
        frame={(iteration, width) => {
          const key = `${page}/${component}/${iteration.id}`;
          const viewport =
            environment.viewports.find(item => item.width === width) ?? environment.viewports[0];
          if (!viewport) return null;
          return (
            <PreviewSurface
              mode={environment.mode}
              previewKey={key}
              src={previewSrc({
                project: project.tree.slug,
                page,
                component,
                iteration: iteration.id
              })}
              viewport={viewport}
              variant={variant}
              app={state.app.status}
              devUrl={state.devUrl}
              timeoutMs={environment.timeouts.preview * 1000}
              reloadToken={changes.keys.includes(key) ? reloadSeq : 0}
              lazy
              title={iteration.name}
              className="w-full"
            />
          );
        }}
      />
    </>
  );
}
