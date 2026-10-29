// One variable family, Host Grotesk, for every sans weight (ROUGHBOOK-APPLE-PLAN.md, decision 29).
// Studio rule 4: it replaces two packages (Inter and Space Grotesk) and adds no runtime code; it is
// CSS and woff2 files only. IBM Plex Mono stays for code.
import '@fontsource-variable/host-grotesk';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readToken } from './api';
import { App } from './app';

const token = readToken();
const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {token ? (
      <App />
    ) : (
      <main className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-title text-label">Open the studio&apos;s link</h1>
        <p className="mt-2 text-body text-slate">
          This page answers only the link <span className="font-mono">roughbook start</span> printed
          in your terminal. Open that link, or run it again.
        </p>
      </main>
    )}
  </StrictMode>
);
