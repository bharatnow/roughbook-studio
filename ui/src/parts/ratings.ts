import type { RatingSummary } from '@roughbook/ui';
import { useEffect, useState } from 'react';
import { get } from '../api';
import { useStudio } from '../data';

/**
 * The component's rated iterations, by id: this designer's own rating and the team's. Read again
 * with the project, which is read again after every decision.
 */
export function useRatings(page: string, component: string): Record<string, RatingSummary> {
  const { project } = useStudio();
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({});
  useEffect(() => {
    let live = true;
    get<Record<string, RatingSummary>>(
      `/api/ratings/${encodeURIComponent(page)}/${encodeURIComponent(component)}`
    )
      .then(found => live && setRatings(found))
      .catch(() => live && setRatings({}));
    return () => {
      live = false;
    };
  }, [page, component, project]);
  return ratings;
}
