import { CompareView, latestHumanReview, reviewSummary, type Review } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { get, iterationPath } from '../api';
import { findComponent, localIterations, useStudio } from '../data';
import { Missing } from '../parts/missing';
import { useRatings } from '../parts/ratings';

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
  const { project } = useStudio();
  const summaries = useSummaries(page, component, ids);
  const ratings = useRatings(page, component);
  const found = findComponent(project, page, component);
  if (!project) return <Missing>Loading…</Missing>;
  if (!found) return <Missing back>There is no {`${page}/${component}`} in this project.</Missing>;
  const here = localIterations(project, page, found.component);
  const candidates = ids
    .map(id => here.find(item => item.id === id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  return (
    <CompareView
      project={project.tree.slug}
      page={page}
      component={component}
      base={`/${page}/${component}`}
      candidates={candidates}
      reviewSummaries={summaries}
      ratings={ratings}
    />
  );
}
