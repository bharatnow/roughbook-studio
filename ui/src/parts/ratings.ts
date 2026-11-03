import type { RatingSummary } from '@roughbook/ui';

const NONE: Record<string, RatingSummary> = {};

/**
 * The component's rated iterations, by id: none. Ratings are retired (ROUGHBOOK-LEARNING-PLAN.md,
 * decision 1) and the backend no longer serves them, so every iteration reads as unrated.
 */
export function useRatings(_page: string, _component: string): Record<string, RatingSummary> {
  return NONE;
}
