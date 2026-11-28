// Assets from the web in a studio run (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T5): what the backend's
// /runs/:runId/web-assets routes answer. The backend fetches through its own guard; the studio
// takes the confirmed bytes from the backend, never from the source.

/** A web asset as the backend records it: where it came from, its licence, and its stored file. */
export type WebAssetView = {
  id: string;
  status: 'pending' | 'confirmed' | 'rejected';
  sourceUrl: string;
  licence: string;
  /** Who named the licence: the maker, or the run that proposed it. */
  licenceFrom: string;
  reason: string | null;
  /** The web's address for it, once confirmed; a studio run uses its own copy instead. */
  url: string | null;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

/** The project's confirmed web assets, with the rules and caps the run is held to. */
export type RunWebAssets = {
  confirmed: WebAssetView[];
  rules: string[];
  caps: { fileBytes: number; videoBytes: number; projectBytes: number; proposalsPerRun: number };
};

/** The project's web assets for the maker: what is confirmed, and what waits for Confirm. */
export type ProjectWebAssets = { confirmed: WebAssetView[]; pending: WebAssetView[] };

/** A run's proposal: the address and the agent's words, never a file's text or a path. */
export type WebAssetProposal = { url: string; reason: string; licence: string };
