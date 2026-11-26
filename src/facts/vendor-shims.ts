// What the copied fact rules (src/facts/vendor/) import from backend files that are not copied:
// only what they use, by hand. pagePath and SHARED_PAGE_SLUG are the backend's rules
// (src/utils/rules/sitePlan.ts, src/utils/format/shared.ts) and must stay in step with them; the
// types are the parts of the backend's records the rules read, so the backend's full answers fit.

/** The shared header and footer's page (the backend's SHARED_PAGE_SLUG). */
export const SHARED_PAGE_SLUG = 'shared';

/** A home page's slugs, planned or landed (the backend's HOME_SLUGS). */
const HOME_SLUGS = new Set(['home', 'homepage', 'home-page', 'index']);

/** The path a planned page is reached by: `/` for the home page, `/<slug>` for the rest. */
export function pagePath(slug: string): string {
  return HOME_SLUGS.has(slug) ? '/' : `/${slug}`;
}

/** One file of an iteration, as the index reads it. */
export type SketchFile = { path: string; content: string; encoding: 'utf8' | 'base64' };

/** The site map: the header's navigation and the page-to-page links. */
export type SiteRecord = {
  pageOrder?: string[];
  nav: { label: string; page: string }[];
  links: { from: string; to: string; label?: string }[];
};

/** The landed plan, as far as the index reads it: pages, their names, and each section's claims. */
export type SitePlan = {
  pages: {
    slug: string;
    name: string;
    sections: { id: string; slug: string; claims: string[] }[];
  }[];
};

/** The approved script, as far as the index reads it: its proof items. */
export type SiteScript = {
  proof: { id: string; status: 'real' | 'missing'; claim: { text: string } }[];
};
