import { StudioDataProvider, useStudio } from './data';
import { StudioUiHost } from './host';
import { ChromeProvider } from './parts/chrome';
import { Missing } from './parts/missing';
import { Shell } from './parts/shell';
import { useDocumentTitle, useRoute } from './router';
import { CanvasScreen } from './screens/canvas';
import { CompareScreen } from './screens/compare';
import { ComposeScreen } from './screens/compose';
import { CompositionScreen } from './screens/composition';
import { IterationScreen } from './screens/iteration';
import { PageScreen } from './screens/page';
import { TasteScreen } from './screens/taste';

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
    case 'compose':
      return (
        <Shell bare>
          <ComposeScreen page={route.page} from={route.from} />
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
    default:
      return (
        <Shell>
          <Missing back>Nothing here.</Missing>
        </Shell>
      );
  }
}

export function App() {
  return (
    <StudioDataProvider>
      <ChromeProvider>
        <StudioUiHost>
          <Screen />
        </StudioUiHost>
      </ChromeProvider>
    </StudioDataProvider>
  );
}
