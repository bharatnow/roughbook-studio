import { StudioDataProvider } from './data';
import { StudioUiHost } from './host';
import { Shell } from './parts/shell';
import { useRoute } from './router';
import { CompareScreen } from './screens/compare';
import { ComponentScreen } from './screens/component';
import { IterationScreen } from './screens/iteration';
import { Overview } from './screens/overview';
import { TerminalScreen } from './screens/terminal';

function Screen() {
  const route = useRoute();
  switch (route.screen) {
    case 'overview':
      return (
        <Shell>
          <Overview />
        </Shell>
      );
    case 'component':
      return (
        <Shell>
          <ComponentScreen page={route.page} component={route.component} />
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
    case 'terminal':
      return (
        <Shell>
          <TerminalScreen id={route.id} />
        </Shell>
      );
    default:
      return (
        <Shell>
          <p className="text-sm text-slate">
            Nothing here.{' '}
            <a href="#/" className="text-violet hover:underline">
              Back to the project
            </a>
          </p>
        </Shell>
      );
  }
}

export function App() {
  return (
    <StudioDataProvider>
      <StudioUiHost>
        <Screen />
      </StudioUiHost>
    </StudioDataProvider>
  );
}
