// Fixtures from an app's own Storybook stories (the brownfield plan's table: "Storybook stories"
// for the module stacks). A story's `args` are its component's inputs, so the first story's,
// over the meta's, become the component's fixture. Only what is written out as a value is taken:
// strings, numbers, booleans, null, and objects and arrays of them; a function, a variable or a
// computed value is left out, since nothing of the app's code is ever run to read it.
import type { ComponentRef, ModuleGraph } from './graph.js';
import { definingExport, readModule, refKey, resolveImport } from './graph.js';

const NOT_A_VALUE = Symbol('not a value');
type Read = unknown | typeof NOT_A_VALUE;

/** Skips whitespace from `i`. */
function blank(code: string, i: number): number {
  while (i < code.length && /\s/.test(code[i]!)) i++;
  return i;
}

/** Skips an expression that is not a value, to the `,` or closing bracket that ends it. */
function skipExpression(code: string, i: number): number {
  let depth = 0;
  for (; i < code.length; i++) {
    const char = code[i]!;
    if (char === '"' || char === "'" || char === '`') {
      for (i++; i < code.length && code[i] !== char; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (char === ',' && depth === 0) return i;
  }
  return i;
}

function readString(code: string, i: number): [string, number] {
  const quote = code[i]!;
  let text = '';
  for (i++; i < code.length && code[i] !== quote; i++) {
    if (code[i] === '\\') {
      i++;
      const escaped = code[i]!;
      text += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped;
      continue;
    }
    text += code[i];
  }
  return [text, i + 1];
}

/** The value written at `i`, and where it ends; NOT_A_VALUE for an expression. */
export function readValue(code: string, start: number): [Read, number] {
  let i = blank(code, start);
  const char = code[i];
  if (char === '{') {
    const value: Record<string, unknown> = {};
    i++;
    for (;;) {
      i = blank(code, i);
      if (code[i] === '}') return [value, i + 1];
      if (i >= code.length) return [NOT_A_VALUE, i];
      let key: string | null = null;
      if (code[i] === '"' || code[i] === "'") [key, i] = readString(code, i);
      else {
        const name = /^[A-Za-z_$][\w$]*|^\d+/.exec(code.slice(i, i + 200));
        if (name) {
          key = name[0];
          i += key.length;
        }
      }
      i = blank(code, i);
      if (key !== null && code[i] === ':') {
        const [item, end] = readValue(code, i + 1);
        if (item !== NOT_A_VALUE) value[key] = item;
        i = end;
      } else {
        // A spread, a shorthand, a method or a computed key: not a value.
        i = skipExpression(code, i);
      }
      i = blank(code, i);
      if (code[i] === ',') i++;
      else if (code[i] !== '}') i = skipExpression(code, i);
    }
  }
  if (char === '[') {
    const value: unknown[] = [];
    i++;
    for (;;) {
      i = blank(code, i);
      if (code[i] === ']') return [value, i + 1];
      if (i >= code.length) return [NOT_A_VALUE, i];
      const [item, end] = readValue(code, i);
      if (item !== NOT_A_VALUE) value.push(item);
      i = blank(code, end);
      if (code[i] === ',') i++;
      else if (code[i] !== ']') i = skipExpression(code, i);
    }
  }
  if (char === '"' || char === "'") return readString(code, i);
  if (char === '`') {
    const end = code.indexOf('`', i + 1);
    const text = code.slice(i + 1, end === -1 ? code.length : end);
    return text.includes('${') ? [NOT_A_VALUE, end + 1] : [text, end + 1];
  }
  const word = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\b/.exec(code.slice(i, i + 40));
  if (word) {
    const text = word[1]!;
    const after = blank(code, i + text.length);
    if (/[,}\]\n;)]/.test(code[after] ?? ',') || after >= code.length) {
      return [
        text === 'true' ? true : text === 'false' ? false : text === 'null' ? null : Number(text),
        i + text.length
      ];
    }
  }
  return [NOT_A_VALUE, skipExpression(code, i)];
}

/** The object written right after `at` in the code, or null when there is none. */
function objectAfter(code: string, at: number): Record<string, unknown> | null {
  const i = blank(code, at);
  if (code[i] !== '{') return null;
  const [value] = readValue(code, i);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Where an object literal starting at `i` ends, string-aware. */
function objectEnd(code: string, i: number): number {
  let depth = 0;
  for (; i < code.length; i++) {
    const char = code[i]!;
    if (char === '"' || char === "'" || char === '`') {
      for (i++; i < code.length && code[i] !== char; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

/** The text of a top-level property's value in the object at `i`: `component: Hero` gives Hero. */
function property(code: string, objectStart: number, name: string): number | null {
  const end = objectEnd(code, objectStart);
  let depth = 0;
  for (let i = objectStart + 1; i < end; i++) {
    const char = code[i]!;
    if (char === '"' || char === "'" || char === '`') {
      for (i++; i < end && code[i] !== char; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    else if (
      depth === 0 &&
      code.startsWith(name, i) &&
      !/[\w$]/.test(code[i - 1] ?? ' ') &&
      /^\s*:/.test(code.slice(i + name.length, i + name.length + 10))
    ) {
      return code.indexOf(':', i + name.length) + 1;
    }
  }
  return null;
}

export type StoryFixture = { ref: ComponentRef; fixture: Record<string, unknown>; from: string };

/** The stories Roughbook prefers, before any other: the one a component looks like by default. */
const PREFERRED = ['Default', 'Primary', 'Basic', 'Base', 'Example'];

/** The fixture each story file gives its component, by the component's key. */
export function storyFixtures(
  repo: string,
  graph: ModuleGraph,
  files: string[]
): Map<string, StoryFixture> {
  const fixtures = new Map<string, StoryFixture>();
  for (const file of files) {
    const info = readModule(repo, file);
    if (!info) continue;
    const { code } = info;
    let metaAt = /^export\s+default\s*\{/m.exec(code)?.index;
    if (metaAt !== undefined) metaAt = code.indexOf('{', metaAt);
    else {
      const named = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;/m.exec(code)?.[1];
      const declared = named
        ? new RegExp(`^(?:const|let|var)\\s+${named.replace(/\$/g, '\\$')}\\s*=\\s*\\{`, 'm').exec(
            code
          )
        : null;
      if (declared) metaAt = code.indexOf('{', declared.index);
    }
    if (metaAt === undefined) continue;
    const componentAt = property(code, metaAt, 'component');
    const identifier =
      componentAt === null ? null : /^\s*([A-Za-z_$][\w$]*)/.exec(code.slice(componentAt))?.[1];
    const imported = identifier ? info.imports.get(identifier) : undefined;
    const target = imported ? resolveImport(graph, file, imported.spec) : null;
    if (!target || !imported) continue;
    const ref = definingExport(
      repo,
      graph,
      target,
      imported.name === '*' ? 'default' : imported.name
    );
    const metaArgsAt = property(code, metaAt, 'args');
    const metaArgs = metaArgsAt === null ? {} : (objectAfter(code, metaArgsAt) ?? {});
    const stories: { name: string; args: Record<string, unknown> }[] = [];
    for (const match of code.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gm)) {
      const at = code.indexOf('{', match.index);
      const argsAt = property(code, at, 'args');
      stories.push({
        name: match[1]!,
        args: argsAt === null ? {} : (objectAfter(code, argsAt) ?? {})
      });
    }
    for (const match of code.matchAll(/^([A-Za-z_$][\w$]*)\.args\s*=\s*/gm)) {
      const args = objectAfter(code, match.index + match[0].length);
      const story = stories.find(item => item.name === match[1]);
      if (story && args) story.args = args;
      else if (args) stories.push({ name: match[1]!, args });
    }
    const story =
      PREFERRED.map(name => stories.find(item => item.name === name)).find(Boolean) ?? stories[0];
    const fixture = { ...metaArgs, ...(story?.args ?? {}) };
    if (!Object.keys(fixture).length || fixtures.has(refKey(ref))) continue;
    fixtures.set(refKey(ref), {
      ref,
      fixture,
      from: story ? `${file} ${story.name}` : file
    });
  }
  return fixtures;
}
