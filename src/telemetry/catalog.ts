import catalog from './catalog.json' with { type: 'json' };

// The analytics catalog, a copy of the backend's contracts/event-catalog.json. The studio sends
// only the events marked `studio`, and checks each against the catalog before keeping it, as the
// backend checks it again: every prop required, nothing else.

export type PropSpec =
  | { kind: 'enum'; values: string[]; nullable?: true }
  | { kind: 'int'; min: number; max: number; nullable?: true }
  | { kind: 'boolean'; nullable?: true }
  | { kind: 'id' }
  | { kind: 'code' }
  | { kind: 'token'; nullable?: true }
  | { kind: 'list'; of: PropSpec; max: number }
  | { kind: 'record'; props: Record<string, PropSpec> };

export type EventSpec = {
  description: string;
  sentBy: 'server' | 'studio';
  props: Record<string, PropSpec>;
};

export const EVENT_CATALOG = catalog as { version: number; events: Record<string, EventSpec> };

/** The events this studio sends. */
export type StudioEventType = 'studio.started' | 'map.ran' | 'error.reported';

const TOKEN = /^[0-9A-Za-z._:/+-]{1,100}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fits(spec: PropSpec, value: unknown): boolean {
  if (value === null) return 'nullable' in spec && spec.nullable === true;
  switch (spec.kind) {
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'int':
      return (
        Number.isInteger(value) && (value as number) >= spec.min && (value as number) <= spec.max
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'id':
      return typeof value === 'string' && ID.test(value);
    case 'code':
      return typeof value === 'string' && CODE.test(value);
    case 'token':
      return typeof value === 'string' && TOKEN.test(value);
    case 'list':
      return (
        Array.isArray(value) && value.length <= spec.max && value.every(item => fits(spec.of, item))
      );
    case 'record':
      return fitsProps(spec.props, value);
  }
}

function fitsProps(specs: Record<string, PropSpec>, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === Object.keys(specs).length &&
    keys.every(key => key in specs && fits(specs[key]!, (value as Record<string, unknown>)[key]))
  );
}

/** Whether the studio may send this event with these props, as the backend will judge it. */
export function fitsCatalog(type: string, props: unknown): boolean {
  const spec = EVENT_CATALOG.events[type];
  return spec?.sentBy === 'studio' && fitsProps(spec.props, props);
}
