import { cn } from '@roughbook/ui';
import { useCallback, useMemo, useState } from 'react';
import { errorLine, infoLine, type Line } from '../output';

/**
 * What a control says back, in an <output> beside it (A8 step 5 of ROUGHBOOK-APPLE-PLAN.md): read
 * out politely, an error assertively, and nothing drawn while there is nothing to say.
 */
export function OutputLine({ line, className }: { line: Line | null; className?: string }) {
  return (
    <output
      aria-live={line?.tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'block text-body empty:hidden',
        line?.tone === 'error' ? 'text-danger' : 'text-label',
        className
      )}
    >
      {line?.text ?? ''}
    </output>
  );
}

/** A place's own line: what it last said, and the means to say the next thing. */
export function useLine() {
  const [line, setLine] = useState<Line | null>(null);
  const info = useCallback((text: string) => setLine(infoLine(text)), []);
  const fail = useCallback((error: unknown) => setLine(errorLine(error)), []);
  const clear = useCallback(() => setLine(null), []);
  return useMemo(() => ({ line, show: setLine, info, fail, clear }), [line, info, fail, clear]);
}
