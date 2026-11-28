import { TopProgress } from '@roughbook/ui';
import { useEffect, useSyncExternalStore } from 'react';
import { appNavigation, clickedHash } from '../navigation';
import { routeKeyOf } from '../router';

/**
 * The studio's navigation line (reports/Pending feedback audit.md, "Studio"): one TopProgress for
 * the app, as the web has. A hash link's click starts it, as `navigate()` and a hash change do;
 * the shell finishes it when the screen renders, or once its placeholder has its data
 * (parts/loading.tsx). An action's button shows its own pending state, not this.
 */
export function NavigationLine() {
  const active = useSyncExternalStore(appNavigation.subscribe, appNavigation.isActive, () => false);

  useEffect(() => {
    // Bubble phase: React's handlers on the root have run, so a cancelled click is seen as one.
    function onClick(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target.closest('a[href]') : null;
      // An SVG <a> is not one of the studio's links.
      if (!(element instanceof HTMLAnchorElement)) return;
      const hash = clickedHash(event, element);
      if (hash !== null) appNavigation.go(routeKeyOf(hash), routeKeyOf(window.location.hash));
    }
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      appNavigation.finish();
    };
  }, []);

  return <TopProgress active={active} />;
}
