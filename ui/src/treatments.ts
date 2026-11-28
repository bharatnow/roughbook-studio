// The project's treatments in the local UI (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T6), read-only: the
// studio shows them with @roughbook/ui's TreatmentList and changes them only on the web, where Add,
// Change, Remove and New ideas live. They come in the project read (`designSystem.treatments`,
// [] for none), which the local server passes on whole. Pure, so a test can read it.
import {
  TREATMENT_KINDS,
  TREATMENT_SOURCES,
  type Treatment,
  type TreatmentKind,
  type TreatmentSource
} from '@roughbook/ui/treatments';
import { projectLink } from './toolbar.ts';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function readOne(raw: unknown): Treatment | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = text(item.id);
  const name = text(item.name);
  if (!id || !name) return null;
  const kind = (TREATMENT_KINDS as readonly string[]).includes(text(item.kind))
    ? (item.kind as TreatmentKind)
    : 'other';
  const source = (TREATMENT_SOURCES as readonly string[]).includes(text(item.source))
    ? (item.source as TreatmentSource)
    : 'maker';
  return {
    id,
    name,
    kind,
    words: text(item.words),
    where: Array.isArray(item.where)
      ? item.where.filter((place): place is string => typeof place === 'string')
      : [],
    techniqueId: text(item.techniqueId) || null,
    css: text(item.css),
    source,
    sourceRef: text(item.sourceRef) || null,
    updatedAt: text(item.updatedAt)
  };
}

/**
 * The project's treatments as the backend's project read carries them; [] for an older backend
 * that sends none, or anything it cannot read.
 */
export function projectTreatments(tree: unknown): Treatment[] {
  const ds =
    tree && typeof tree === 'object' ? (tree as { designSystem?: unknown }).designSystem : null;
  const list = ds && typeof ds === 'object' ? (ds as { treatments?: unknown }).treatments : null;
  if (!Array.isArray(list)) return [];
  return list.map(readOne).filter((item): item is Treatment => item !== null);
}

/** "Edit on the web": the web's look tuner for the project, where its treatments change. */
export function treatmentsWebHref(input: {
  project: string;
  webUrl: string | null;
}): string | null {
  const link = projectLink(input);
  return link ? `${link}/look/tune` : null;
}
