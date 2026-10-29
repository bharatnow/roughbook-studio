// The shell's toolbar (A8 step 3 of ROUGHBOOK-APPLE-PLAN.md): a home button and the project's
// title with its document menu leading, search in the centre, the status and one Generate
// trailing. Only what the studio can do: renaming, archiving and deleting a project stay on the
// web. Pure, so the tests can check that every toolbar and menu item is also a command.
import type { CommandRun } from './commands.ts';
import { TASTE_HREF } from './router.ts';

/** What the document menu needs from the studio's state. */
export type DocumentInput = {
  project: string;
  webUrl: string | null;
  /** The Complete features switch: on adds Strategy, Art direction and Library. */
  complete: boolean;
};

/** One item of the document menu, and the command that does the same. */
export type DocumentItem = { id: string; label: string; run: CommandRun };

/** The project's address on the web. */
export function projectLink(input: { project: string; webUrl: string | null }): string | null {
  return input.webUrl ? `${input.webUrl.replace(/\/+$/, '')}/projects/${input.project}` : null;
}

/** What Roughbook learned about you and this brand (A10), on the studio's own taste screen. */
const TASTE: DocumentItem = {
  id: 'document:taste',
  label: 'Your taste',
  run: { kind: 'href', href: TASTE_HREF }
};

/**
 * The document menu: Your taste, here; each other item opens the project's page on the web, or
 * copies its link.
 */
export function documentItems(input: DocumentInput): DocumentItem[] {
  const link = projectLink(input);
  if (!link) return [TASTE];
  const web = (href: string) => ({ kind: 'href', href, external: true }) as const;
  const items: DocumentItem[] = [
    { id: 'document:look', label: 'Your look', run: web(`${link}/design-system`) },
    TASTE,
    { id: 'document:settings', label: 'Project settings', run: web(`${link}/settings`) }
  ];
  if (input.complete) {
    items.push(
      { id: 'document:strategy', label: 'Strategy', run: web(`${link}/strategy`) },
      { id: 'document:art-direction', label: 'Art direction', run: web(`${link}/art-direction`) },
      {
        id: 'document:library',
        label: 'Library',
        run: web(`${input.webUrl!.replace(/\/+$/, '')}/library`)
      }
    );
  }
  items.push({
    id: 'document:copy-link',
    label: 'Copy link',
    run: { kind: 'copy', text: link, done: 'Copied the link to this project.' }
  });
  return items;
}

/** The toolbar's own buttons that are commands too; search is the palette itself. */
export const TOOLBAR_ITEMS: readonly DocumentItem[] = [
  { id: 'home', label: 'Home', run: { kind: 'href', href: '/' } },
  { id: 'status', label: 'Studio status', run: { kind: 'status' } },
  { id: 'generate', label: 'Generate', run: { kind: 'generate' } }
];
