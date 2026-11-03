// A page's versions on the canvas (decided 3 November 2026, reports/Composite audit.md section 15,
// as on the web): Save version is one click that keeps the page as the canvas shows it, named by
// the date and time, says "Version saved." and offers its Undo on the bar, which deletes it again;
// the Versions list opens each one and renames it. Only slugs, ids and the typed name reach the
// local server, which keeps the version in rough/ and on the backend.
import { Button, Sheet, TextInput, useUiHost, useUndo } from '@roughbook/ui';
import { useState } from 'react';
import { post } from '../api';
import type { StudioCanvas } from '../canvas-input';
import { compositionAddress, compositionName, versionName, versionOf } from '../composition';
import { errorLine, infoLine, lineOf, type Line } from '../output';
import type { CompositionView } from '../types';
import { OutputLine } from './output-line';

/** What Save version says once the version is kept. */
export const VERSION_SAVED = 'Version saved.';

/** What its Undo says once the version is gone. */
export const VERSION_UNDONE = 'Version deleted.';

/** A version's name holds at most this many characters, as the backend takes it. */
const MAX_NAME = 80;

const versionPath = (page: string, id: string) =>
  `/api/compositions/${encodeURIComponent(page)}/${encodeURIComponent(id)}`;

/** Save version: one click, its line, and its Undo on the bar. */
export function useSaveVersion(refresh: () => Promise<unknown>) {
  const undo = useUndo();
  /** The page being saved, so its button waits. */
  const [saving, setSaving] = useState<string | null>(null);
  const [line, setLine] = useState<Line | null>(null);

  async function save(canvas: StudioCanvas, page: string): Promise<void> {
    if (saving) return;
    const version = versionOf(canvas, page);
    if ('problem' in version) {
      setLine(lineOf('error', version.problem));
      return;
    }
    setSaving(page);
    try {
      const saved = await post<{ id: string }>('/api/compositions', {
        page,
        name: versionName(new Date()),
        sections: version.sections
      });
      setLine(infoLine(VERSION_SAVED));
      await refresh();
      // A version something depends on stays: the server says why, and the bar shows it.
      undo.offer('Save version', async () => {
        await post(`${versionPath(page, saved.id)}/delete`);
        setLine(infoLine(VERSION_UNDONE));
        await refresh();
      });
    } catch (error) {
      setLine(errorLine(error));
    } finally {
      setSaving(null);
    }
  }

  return { save, saving, line };
}

/** The Versions list of one page: newest first, each opened by its name and renamed in place. */
export function VersionsSheet({
  open,
  pageName,
  versions,
  onClose,
  refresh
}: {
  open: boolean;
  pageName: string;
  versions: CompositionView[];
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const { Link } = useUiHost();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line | null>(null);

  async function rename(version: CompositionView, name: string) {
    setBusy(true);
    try {
      const renamed = await post<{ name: string }>(
        `${versionPath(version.page, version.id)}/rename`,
        { name }
      );
      setRenaming(null);
      setLine(infoLine(`Renamed to ${renamed.name}.`));
      await refresh();
    } catch (error) {
      setLine(errorLine(error));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setRenaming(null);
    setLine(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title={`Versions of ${pageName}`}>
      <p className="mb-3 text-body text-label-secondary">
        The page is always its components&apos; chosen iterations. A version saves that as it
        stands, to come back to.
      </p>
      {versions.length ? (
        <ul className="flex flex-col gap-2">
          {versions.map(version => (
            <li
              key={version.id}
              className="flex min-h-11 flex-wrap items-center gap-2 rounded-control border border-ash bg-canvas px-3 py-2"
            >
              {renaming === version.id ? (
                <form
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get('name');
                    void rename(version, typeof value === 'string' ? value : '');
                  }}
                >
                  <TextInput
                    name="name"
                    aria-label="The version's name"
                    defaultValue={compositionName(version)}
                    maxLength={MAX_NAME}
                    required
                    autoFocus
                    className="min-w-0 flex-1"
                  />
                  <Button type="submit" kind="primary" tier="compact" disabled={busy}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    kind="cancel"
                    tier="compact"
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <Link
                    href={compositionAddress(version.page, version.id)}
                    className="min-w-0 flex-1 truncate text-body text-label hover:underline"
                  >
                    {compositionName(version)}
                  </Link>
                  <Button
                    type="button"
                    tier="compact"
                    onClick={() => {
                      setLine(null);
                      setRenaming(version.id);
                    }}
                  >
                    Rename
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-label">No versions yet: Save version keeps the page.</p>
      )}
      <OutputLine line={line} className="mt-3" />
    </Sheet>
  );
}
