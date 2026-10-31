import {
  Transcript,
  composerState,
  mergeNewest,
  mergeOlder,
  newestFailure,
  runningComponents,
  type ComposerState,
  type TranscriptEntry,
  type TranscriptPage,
  type TranscriptResult
} from '@roughbook/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../api';
import { describe } from '../data';
import { deleteAddress, requestsAddress, requestsPage } from '../requests';

/** As the web's: the canvas learns of changes this often too. */
const EVERY_MS = 3000;

type History = {
  entries: TranscriptEntry[] | null;
  next: string | null;
  failed: boolean;
  now: number;
};

/**
 * The studio's Transcript (C6 of the composer audit): reads the project's record through the local
 * server, which puts back the paths this machine still holds. As on the web, new lines are read
 * while the panel is open or work it has seen still runs, once at the start for the button, and
 * older pages as the reader scrolls up. A card selects on the canvas, and one's own line can be
 * deleted. Stop and the rest are left out: a studio's run stops on its card, and the actions the
 * shared Transcript offers are for a web sketch, which this host cannot run. The host has no
 * thumbnails to offer: an image here cannot send the token.
 */
export function StudioTranscript({
  project,
  open,
  sections,
  selection,
  fresh,
  onSelectCard,
  onState
}: {
  /** The project's slug. */
  project: string;
  open: boolean;
  /** The canvas's pages, for a component's name. */
  sections: readonly { id: string; frames: readonly { id: string; name: string }[] }[];
  selection: string | null;
  /** Changes when there may be a new line, to read it at once. */
  fresh: number;
  onSelectCard: (key: string) => void;
  /** What the composer's button says while the panel is closed. */
  onState: (state: ComposerState) => void;
}) {
  const [history, setHistory] = useState<History>({
    entries: null,
    next: null,
    failed: false,
    now: 0
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Deleted here: a read already under way may still bring them back.
  const deleted = useRef(new Set<string>());

  const readPage = useCallback(async (cursor?: string | null): Promise<TranscriptPage> => {
    const page = requestsPage(await get<unknown>(requestsAddress(cursor)));
    return { ...page, requests: page.requests.filter(line => !deleted.current.has(line.id)) };
  }, []);

  const running = useMemo(
    () => runningComponents(history.entries ?? []).join('\n'),
    [history.entries]
  );
  // Read once at the start, so the button knows the work before the panel is ever opened.
  const [primed, setPrimed] = useState(false);
  const watching = open || Boolean(running) || !primed;

  useEffect(() => {
    if (!watching) return;
    let current = true;
    let reading = false;
    async function read() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const page = await readPage();
        if (!current) return;
        setHistory(held => ({
          entries: held.entries ? mergeNewest(held.entries, page.requests) : page.requests,
          next: held.entries ? held.next : page.next,
          failed: false,
          now: Date.now()
        }));
      } catch {
        if (current) setHistory(held => ({ ...held, failed: true }));
      } finally {
        reading = false;
        if (current) setPrimed(true);
      }
    }
    void read();
    const timer = window.setInterval(() => void read(), EVERY_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [watching, readPage, fresh]);

  const next = history.next;
  const onOlder = useCallback(async () => {
    if (!next) return;
    setLoadingOlder(true);
    try {
      const page = await readPage(next);
      setHistory(held => ({
        ...held,
        entries: mergeOlder(held.entries ?? [], page.requests),
        next: page.next
      }));
    } catch {
      setHistory(held => ({ ...held, failed: true }));
    } finally {
      setLoadingOlder(false);
    }
  }, [next, readPage]);

  // A failure is seen once it has been on screen in the panel.
  const failure = newestFailure(history.entries ?? [])?.id ?? null;
  const [seen, setSeen] = useState<string | null>(null);
  if (open && failure !== seen) setSeen(failure);

  const names = useMemo(
    () =>
      new Map(
        sections.flatMap(page =>
          page.frames.map(frame => [`${page.id}/${frame.id}`, frame.name] as const)
        )
      ),
    [sections]
  );
  const whereOf = useCallback(
    (entry: TranscriptEntry) => names.get(`${entry.page}/${entry.component}`) ?? null,
    [names]
  );

  const state = useMemo(
    () => composerState(history.entries ?? [], whereOf, seen),
    [history.entries, whereOf, seen]
  );
  useEffect(() => onState(state), [state, onState]);

  async function remove(entry: TranscriptEntry): Promise<TranscriptResult> {
    try {
      await post(deleteAddress(entry.id));
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
    deleted.current.add(entry.id);
    setHistory(held => ({
      ...held,
      entries: held.entries?.filter(item => item.id !== entry.id) ?? null
    }));
    return { ok: true, message: '' };
  }

  return (
    <Transcript
      entries={history.entries}
      now={history.now}
      open={open}
      project={project}
      whereOf={whereOf}
      selection={selection}
      failed={history.failed}
      hasOlder={Boolean(next) && !history.failed}
      loadingOlder={loadingOlder}
      onOlder={() => void onOlder()}
      onSelectCard={onSelectCard}
      onDelete={remove}
    />
  );
}
