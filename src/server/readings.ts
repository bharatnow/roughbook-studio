// The local UI's readings (A6 of ROUGHBOOK-APPLE-PLAN.md): `POST /api/readings` with the selected
// page and component, the words the designer typed, and for Swap the readings on screen and the
// one to replace. Only the words, the readings' labels and ideas and the number go to the backend;
// the page and component name the route. Nothing from the repo goes, and nothing is written here.
import type { ReadingsBody, ReadingsReply, StudioApi } from '../api/client.js';
import { BadRequest } from './studio.js';

/** The readings in a round, as the backend's `READINGS`. */
const READINGS = 3;
/** The longest words the backend reads, as its `MAX_READING_TEXT`. */
const MAX_TEXT = 2000;
const MAX_LABEL = 80;
const MAX_HYPOTHESIS = 300;
const MAX_SLUG = 200;

/** What the route needs from the studio: the client and the linked project. */
export type ReadingsSource = { api: StudioApi; link: { orgId: string; project: string } };

/** The component the readings are for, and the body the backend takes, from the page's request. */
export type ParsedReadings = { page: string; component: string; body: ReadingsBody };

function slug(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SLUG) {
    throw new BadRequest(`Select a component first (no ${what}).`);
  }
  return value;
}

function words(value: unknown, max: number, what: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequest(`${what} is missing.`);
  if (text.length > max) throw new BadRequest(`${what} is longer than ${max} characters.`);
  return text;
}

/**
 * Reads the page's request as the backend's strict schema would, keeping nothing else: a reading
 * kept for Swap loses its plan, and any other key is dropped. Throws BadRequest in words.
 */
export function parseReadings(body: Record<string, unknown>): ParsedReadings {
  const page = slug(body.page, 'page');
  const component = slug(body.component, 'component');
  const text = words(body.text, MAX_TEXT, 'What to draft');
  const parsed: ReadingsBody = { text };

  if (body.keep !== undefined) {
    if (!Array.isArray(body.keep) || body.keep.length > READINGS) {
      throw new BadRequest(`Keep at most ${READINGS} readings.`);
    }
    parsed.keep = body.keep.map((item: unknown) => {
      const reading = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        label: words(reading.label, MAX_LABEL, "A reading's name"),
        hypothesis: words(reading.hypothesis, MAX_HYPOTHESIS, "A reading's idea")
      };
    });
  }
  const kept = parsed.keep?.length ?? 0;

  if (body.replace !== undefined) {
    const replace = body.replace;
    if (typeof replace !== 'number' || !Number.isInteger(replace) || replace < 0) {
      throw new BadRequest('Say which reading to swap.');
    }
    if (replace >= READINGS || replace >= kept) {
      throw new BadRequest('Swap needs the readings on screen.');
    }
    parsed.replace = replace;
  } else if (kept >= READINGS) {
    throw new BadRequest(`Keep fewer than ${READINGS} readings to draft more.`);
  }

  return { page, component, body: parsed };
}

/** Asks the backend for the component's readings; its refusals pass on as ApiErrors. */
export async function planReadings(
  source: ReadingsSource,
  body: Record<string, unknown>
): Promise<ReadingsReply> {
  const { page, component, body: request } = parseReadings(body);
  const { api, link } = source;
  return api.readings(link.orgId, link.project, page, component, request);
}
