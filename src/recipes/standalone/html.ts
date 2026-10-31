// An HTML iteration, served as it is: its entry file's markup, a fragment or a whole document,
// inside the environment's HTML wrapper when it names one (the site's header and footer around
// it, with {{roughbook:iteration}} where the iteration goes). The page says ready once it loaded.
//
// A composition puts every section in one document, as the sections of a real page are, and the
// wrapper around them once (see sections.ts for what that takes of each section).
import fs from 'node:fs';
import path from 'node:path';
import { ITERATION_STAND_IN, sectionMarker } from '../../standalone/page.js';
import type { StandaloneRenderer } from '../../standalone/types.js';
import { documentHead, sectionMarkup, splitDocument } from './sections.js';

type Refused = { ok: false; message: string };

function readEntry(file: string, entry: string): { ok: true; text: string } | Refused {
  try {
    return { ok: true, text: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return {
      ok: false,
      message: `${entry} could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/** The wrapper's text, none, or why it cannot be used. */
function readWrapper(
  repoRoot: string,
  wrapper: string | null
): { ok: true; text: string | null } | Refused {
  if (!wrapper) return { ok: true, text: null };
  if (!/\.html?$/i.test(wrapper)) {
    return {
      ok: false,
      message: `The wrapper ${wrapper} is not an HTML file; an HTML iteration is wrapped in an HTML file holding ${ITERATION_STAND_IN} where it goes.`
    };
  }
  let around: string;
  try {
    around = fs.readFileSync(path.join(repoRoot, ...wrapper.split('/')), 'utf8');
  } catch {
    return { ok: false, message: `The wrapper ${wrapper} is not in the repo.` };
  }
  if (!around.includes(ITERATION_STAND_IN)) {
    return {
      ok: false,
      message: `The wrapper ${wrapper} has no ${ITERATION_STAND_IN} where the iteration goes.`
    };
  }
  return { ok: true, text: around };
}

export const html: StandaloneRenderer = {
  id: 'html',
  async render({ repoRoot, environment, dir }) {
    const entry = readEntry(path.join(dir, environment.entry), environment.entry);
    if (!entry.ok) return entry;
    const around = readWrapper(repoRoot, environment.wrapper);
    if (!around.ok) return around;
    const markup = around.text
      ? around.text.replace(ITERATION_STAND_IN, () => entry.text)
      : entry.text;
    return { ok: true, markup, head: [], readyOn: 'load', files: {} };
  },
  async composePage({ repoRoot, environment, page, sections }) {
    const loaded = new Set(environment.stylesheets);
    const marked: string[] = [];
    for (const section of sections) {
      const entry = readEntry(path.join(section.dir, environment.entry), environment.entry);
      if (!entry.ok) return entry;
      const inner = sectionMarkup(entry.text, section.sitePath, section.fixture, loaded);
      marked.push(sectionMarker(page, section.component, inner));
    }
    const around = readWrapper(repoRoot, environment.wrapper);
    if (!around.ok) return around;
    const all = marked.join('\n');
    const shape = { readyOn: 'load' as const, files: {} };
    if (!around.text) return { ok: true, markup: all, head: [], bodyAttributes: '', ...shape };
    const whole = splitDocument(around.text.replace(ITERATION_STAND_IN, () => all));
    return {
      ok: true,
      markup: whole.body,
      head: documentHead(whole.head),
      bodyAttributes: whole.attributes,
      ...shape
    };
  }
};
