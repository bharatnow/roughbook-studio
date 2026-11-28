import { ActivityIndicator } from '@roughbook/ui';
import { useEffect, type ReactNode } from 'react';
import { appNavigation, type NavigationProgress } from '../navigation';

/**
 * What the placeholder does to the navigation line: holds it while the data is on its way, and
 * not once the read failed, since the screen has arrived at its problem. Returns the release.
 */
export function holdWhileLoading(
  line: Pick<NavigationProgress, 'hold'>,
  problem: string | null | undefined
): (() => void) | undefined {
  return problem ? undefined : line.hold();
}

/**
 * A screen waiting for its data (reports/Pending feedback audit.md, "Studio"): the activity
 * indicator and a few words, still and quiet, centred where the screen will be, so nothing jumps
 * aside when it arrives. While it shows, it holds the navigation line, which finishes once the
 * data is in. With `problem` (the project could not be read) it says that instead, without the
 * indicator, and lets the line finish. `page` is for the screens that draw the whole window (the
 * stage, a page's view).
 */
export function ScreenLoading({
  children,
  page = false,
  problem = null
}: {
  children: ReactNode;
  page?: boolean;
  problem?: string | null;
}) {
  useEffect(() => holdWhileLoading(appNavigation, problem), [problem]);
  return (
    <div
      role="status"
      data-screen-loading={problem ? 'failed' : ''}
      className={`flex w-full flex-1 items-center justify-center gap-2 px-4 text-body text-label-secondary ${page ? 'min-h-[100dvh]' : 'min-h-[50dvh]'}`}
    >
      {problem ? null : <ActivityIndicator size="md" />}
      <span>{problem ?? children}</span>
    </div>
  );
}
