import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea';

/**
 * The keyboard for a drawer opened from the canvas: into it, which is on the body by the time an
 * effect runs, and back to what opened it when it closes. @roughbook/ui's Drawer leaves the
 * keyboard where it was, behind the drawer.
 */
export function useDialogFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) {
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.querySelector<HTMLElement>(`[role=dialog] :is(${FOCUSABLE})`)?.focus();
  }, [open]);
}
