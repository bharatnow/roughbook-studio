import { usePaneCycle } from '@roughbook/ui';
import type { MouseEvent } from 'react';
import { StudioDataProvider, useStudio } from './data';
import { StudioUiHost } from './host';
import { ChromeProvider } from './parts/chrome';
import { Missing } from './parts/missing';
import { CONTENT_ID, Shell } from './parts/shell';
import { useDocumentTitle, useRoute } from './router';
import { CanvasScreen } from './screens/canvas';
import { CompareScreen } from './screens/compare';
import { CompositionScreen } from './screens/composition';
import { IterationScreen } from './screens/iteration';
import { PageScreen } from './screens/page';
import { TasteScreen } from './screens/taste';
import { TreatmentsScreen } from './screens/treatments';
import { AssetsScreen } from './screens/assets';

function Screen() {
  const route = useRoute();
  // The tab names the document (A8), from the project as last read.
  useDocumentTitle(route, useStudio().project?.tree);
  switch (route.screen) {
    case 'canvas':
      // One element for every canvas address, so the canvas keeps its state as the address moves.
      return (
        <Shell fill>
          <CanvasScreen focus={route.focus} session={route.session} />
        </Shell>
      );
    case 'compare':
      return (
        <Shell>
          <CompareScreen page={route.page} component={route.component} ids={route.ids} />
        </Shell>
      );
    case 'iteration':
      return (
        <Shell bare>
          <IterationScreen
            page={route.page}
            component={route.component}
            iteration={route.iteration}
            refine={route.refine}
          />
        </Shell>
      );
    case 'page':
      return (
        <Shell bare>
          <PageScreen page={route.page} />
        </Shell>
      );
    case 'composition':
      return (
        <Shell bare>
          <CompositionScreen page={route.page} id={route.id} />
        </Shell>
      );
    case 'taste':
      return (
        <Shell>
          <TasteScreen />
        </Shell>
      );
    case 'treatments':
      return (
        <Shell>
          <TreatmentsScreen />
        </Shell>
      );
    case 'assets':
      return (
        <Shell>
          <AssetsScreen />
        </Shell>
      );
    default:
      return (
        <Shell>
          <Missing back>Nothing here.</Missing>
        </Shell>
      );
  }
}

/**
 * "Skip to content", the first stop for the keyboard (A11 step 6 of ROUGHBOOK-APPLE-PLAN.md): it
 * moves the keyboard past the bar to the screen's <main>, or to its first pane where the screen
 * draws its own frame. The address is the router's, so it moves focus rather than following #content.
 */
function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const target =
      document.getElementById(CONTENT_ID) ??
      document.querySelector<HTMLElement>('[data-pane]:not([data-pane="bar"])');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }
  return (
    <a
      href={`#${CONTENT_ID}`}
      onClick={skip}
      className="sr-only rounded-control bg-window px-3 py-2 text-body text-label shadow-elevation-1 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      Skip to content
    </a>
  );
}

export function App() {
  // F6 and Shift F6 move between the bar, the screen and the dock (A11 step 6).
  usePaneCycle();
  return (
    <StudioDataProvider>
      <ChromeProvider>
        <StudioUiHost>
          <SkipLink />
          <Screen />
        </StudioUiHost>
      </ChromeProvider>
    </StudioDataProvider>
  );
}
