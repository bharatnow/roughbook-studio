import type { ReactNode } from 'react';

/** A screen with nothing to show yet, or nothing at its address: one line, and the way back. */
export function Missing({ children, back = false }: { children: ReactNode; back?: boolean }) {
  return (
    <p role="status" className="text-body text-slate">
      {children}
      {back ? (
        <>
          {' '}
          <a href="#/" className="text-accent-text hover:underline">
            Back to the project
          </a>
        </>
      ) : null}
    </p>
  );
}
