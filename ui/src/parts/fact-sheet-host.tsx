import { FactSheet } from '@roughbook/ui';
import type { FactSheetData } from '@roughbook/ui/fact-sheet';
import { useEffect, useMemo, useState } from 'react';
import { post } from '../api';
import { describe, useStudio } from '../data';
import { changeFrom, readSheet, undoFrom } from '../facts';

/** The words that opened it, with a serial so the same words said twice read twice. */
export type FactAsk = { words: string; serial: number };

/**
 * The composer's "Change this everywhere?" opens this (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5), as the
 * web's FactSheetHost: the words are read and every place they reach in rough/ is found once, when
 * the sheet opens, through `POST /api/facts/read`; the sheet's change and undo post their forms to
 * the local server as JSON. The project is read again after either, so the canvas shows the picks.
 */
export function FactSheetHost({ ask, onClose }: { ask: FactAsk | null; onClose: () => void }) {
  const { refresh } = useStudio();
  const [read, setRead] = useState<{ serial: number; data: FactSheetData } | null>(null);

  useEffect(() => {
    if (!ask) return;
    let live = true;
    void readSheet(ask.words, post, describe).then(data => {
      if (live) setRead({ serial: ask.serial, data });
    });
    return () => {
      live = false;
    };
  }, [ask]);

  const actions = useMemo(() => {
    const done = () => void refresh();
    return { change: changeFrom(post, describe, done), undo: undoFrom(post, describe, done) };
  }, [refresh]);

  const data = ask && read?.serial === ask.serial ? read.data : null;
  return (
    <FactSheet
      key={ask?.serial ?? 0}
      open={Boolean(ask)}
      onClose={onClose}
      data={data}
      change={actions.change}
      undo={actions.undo}
    />
  );
}
