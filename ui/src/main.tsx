import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
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
        <h1 className="font-display text-xl tracking-tight text-graphite">
          Open the studio&apos;s link
        </h1>
        <p className="mt-2 text-sm text-slate">
          This page answers only the link <span className="font-mono">roughbook start</span> printed
          in your terminal. Open that link, or run it again.
        </p>
      </main>
    )}
  </StrictMode>
);
