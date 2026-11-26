// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/factSplice.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// A fact change, swapped into a section's own files (ROUGHBOOK-FACT-CHANGE-PLAN.md, U3,
// "Splicing"). Each found place's old words are replaced inside its literal's own source, the
// index's [start, end], with the new words escaped for where they stand; nothing outside that range
// is touched. A file whose result no longer parses keeps its old content and its places are
// reported, for the redraw fallback. Pure: files are only parsed, never run.
import { ts } from '../typescript.js';
import { factPattern } from './factChangeApply.js';
import { matchCase, type FoundPlace } from './factFind.js';

/** A file as decoded text. */
export type SpliceFile = { path: string; content: string };

export type SpliceResult = {
  /** Every file given, in the same order: spliced, or as it was. */
  files: SpliceFile[];
  /** The places that could not be swapped, by FoundPlace id, with why in words. */
  failed: { placeId: string; why: string }[];
};

/** The places a splice needs: a found place's range and its old and new words. */
export type SplicePlace = Pick<FoundPlace, 'id' | 'file' | 'start' | 'end' | 'old' | 'new'>;

// --- where a range stands --------------------------------------------------------------------------

type Context =
  | { kind: 'jsx-text' }
  | { kind: 'jsx-attribute'; quote: string }
  | { kind: 'string'; quote: string }
  | { kind: 'template' };

function scriptKind(path: string): ts.ScriptKind | null {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'tsx') return ts.ScriptKind.TSX;
  if (extension === 'ts') return ts.ScriptKind.TS;
  if (extension === 'json') return ts.ScriptKind.JSON;
  return null;
}

const parse = (path: string, content: string, kind: ts.ScriptKind) =>
  ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);

/** The literal or JSX text holding [start, end], as the index read it; null when none does. */
function contextAt(source: ts.SourceFile, start: number, end: number): Context | null {
  let found = null as Context | null;
  const visit = (node: ts.Node): void => {
    if (node.pos > start || node.end < end) return;
    if (ts.isJsxText(node)) {
      found = { kind: 'jsx-text' };
      return;
    }
    if (ts.isStringLiteral(node)) {
      const quote = source.text[node.getStart(source)];
      found =
        node.parent && ts.isJsxAttribute(node.parent)
          ? { kind: 'jsx-attribute', quote }
          : { kind: 'string', quote };
      return;
    }
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found = { kind: 'template' };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// --- reading the source as a visitor reads it, with a map back --------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  pound: '£',
  euro: '€',
  middot: '·',
  copy: '©'
};

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0'
};

/**
 * The raw slice decoded (JSX: entities, as factIndex reads them; strings and templates: escapes),
 * with `at[i]` the raw offset decoded unit i came from and `at[length]` the raw length.
 */
function decode(raw: string, context: Context): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  const emit = (value: string, from: number) => {
    text += value;
    for (let unit = 0; unit < value.length; unit++) at.push(from);
  };
  let index = 0;
  const jsx = context.kind === 'jsx-text' || context.kind === 'jsx-attribute';
  while (index < raw.length) {
    const rest = raw.slice(index);
    if (jsx && raw[index] === '&') {
      const match = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(rest);
      if (match) {
        const body = match[1];
        let value: string | undefined;
        if (body[0] === '#') {
          const code =
            body[1] === 'x' || body[1] === 'X'
              ? parseInt(body.slice(2), 16)
              : parseInt(body.slice(1));
          value = Number.isFinite(code) ? String.fromCodePoint(code) : undefined;
        } else value = ENTITIES[body.toLowerCase()];
        if (value !== undefined) {
          emit(value, index);
          index += match[0].length;
          continue;
        }
      }
    }
    if (!jsx && raw[index] === '\\' && index + 1 < raw.length) {
      const next = raw[index + 1];
      let match: RegExpExecArray | null;
      if (
        (match = /^\\u\{([0-9a-f]+)\}/i.exec(rest)) ||
        (match = /^\\u([0-9a-f]{4})/i.exec(rest))
      ) {
        emit(String.fromCodePoint(parseInt(match[1], 16)), index);
        index += match[0].length;
      } else if ((match = /^\\x([0-9a-f]{2})/i.exec(rest))) {
        emit(String.fromCharCode(parseInt(match[1], 16)), index);
        index += match[0].length;
      } else if ((match = /^\\(\r\n|\n|\r|\u2028|\u2029)/.exec(rest))) {
        index += match[0].length; // a line continuation says nothing
      } else {
        emit(SIMPLE_ESCAPES[next] ?? next, index);
        index += 2;
      }
      continue;
    }
    emit(raw[index], index);
    index++;
  }
  at.push(raw.length);
  return { text, at };
}

// --- writing the new words where they stand --------------------------------------------------------

function escapeFor(text: string, context: Context): string {
  switch (context.kind) {
    case 'jsx-text':
      // JSX text decodes entities and stops at { } < >; quotes are written as entities too, so a
      // linted sketch stays clean.
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    case 'jsx-attribute':
      // A JSX attribute's string has no backslash escapes; it decodes entities and ends at its quote.
      return text
        .replace(/&/g, '&amp;')
        .replace(context.quote === '"' ? /"/g : /'/g, match =>
          match === '"' ? '&quot;' : '&apos;'
        );
    case 'string':
      return text
        .replace(/\\/g, '\\\\')
        .replace(context.quote === '"' ? /"/g : /'/g, match => `\\${match}`)
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u2028/gu, '\\u2028')
        .replace(/\u2029/gu, '\\u2029');
    case 'template':
      return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  }
}

/** The raw slice with every `old` (as read) replaced by `next` (escaped); null when none is there. */
function spliceSlice(raw: string, context: Context, old: string, next: string): string | null {
  const pattern = factPattern(old);
  if (!pattern) return null;
  const { text, at } = decode(raw, context);
  const hits = [...text.matchAll(pattern)];
  if (!hits.length) return null;
  let out = raw;
  for (const hit of hits.reverse()) {
    const from = at[hit.index];
    const to = at[hit.index + hit[0].length];
    // Each hit keeps the case it was written in ("sports injury clinic" in running text).
    out = out.slice(0, from) + escapeFor(matchCase(hit[0], next), context) + out.slice(to);
  }
  return out;
}

// --- checking the result parses ------------------------------------------------------------------------

/** How many syntax errors a file has: JSON by JSON.parse, code by the compiler's parser. */
function syntaxErrors(path: string, content: string, kind: ts.ScriptKind): number {
  if (kind === ts.ScriptKind.JSON) {
    try {
      JSON.parse(content);
      return 0;
    } catch {
      return 1;
    }
  }
  const output = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      noLib: true,
      noResolve: true
    }
  });
  return (output.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
    .length;
}

// --- splicing --------------------------------------------------------------------------------------

/**
 * The places' new words spliced into the files. A file holds the places whose `file` is its path
 * (pass one iteration's files with that iteration's places); places with no file (nav and link
 * labels) are the site map's and are skipped. Within each place's [start, end] the old words are
 * found as a visitor reads them (raw, entity-encoded or escaped) and replaced, the new words escaped
 * for JSX text, a JSX attribute, a quoted string or a template. Splices go from the end of a file
 * backwards. When the result has more syntax errors than the file had, the file is left as it was
 * and all its places fail.
 */
export function spliceFiles(files: SpliceFile[], places: SplicePlace[]): SpliceResult {
  const failed: SpliceResult['failed'] = [];
  const byPath = new Map(files.map(file => [file.path, file]));
  const filed = places.filter(place => place.file !== '');
  for (const place of filed)
    if (!byPath.has(place.file))
      failed.push({ placeId: place.id, why: `The file ${place.file} is not among the files.` });

  const out = files.map(file => {
    const mine = filed.filter(place => place.file === file.path);
    if (!mine.length) return { ...file };
    const kind = scriptKind(file.path);
    if (kind === null) {
      for (const place of mine)
        failed.push({ placeId: place.id, why: `${file.path} is not a file the index reads.` });
      return { ...file };
    }
    const source = parse(file.path, file.content, kind);

    // Places on the same range are applied in turn to that range's slice.
    const ranges = new Map<string, SplicePlace[]>();
    for (const place of mine) {
      const key = `${place.start}:${place.end}`;
      ranges.set(key, [...(ranges.get(key) ?? []), place]);
    }
    const ordered = [...ranges.values()].sort((a, b) => b[0].start - a[0].start);
    const spliced: { start: number; end: number; text: string; places: SplicePlace[] }[] = [];
    let lastStart = Infinity;
    for (const group of ordered) {
      const { start, end } = group[0];
      if (start < 0 || end > file.content.length || start > end) {
        for (const place of group)
          failed.push({ placeId: place.id, why: 'Its place is outside the file.' });
        continue;
      }
      if (end > lastStart) {
        for (const place of group)
          failed.push({ placeId: place.id, why: 'Its place overlaps another place.' });
        continue;
      }
      const context = contextAt(source, start, end);
      if (!context) {
        for (const place of group)
          failed.push({ placeId: place.id, why: 'Its place is not text or a string in the file.' });
        continue;
      }
      let slice = file.content.slice(start, end);
      const applied: SplicePlace[] = [];
      for (const place of group) {
        const next = spliceSlice(slice, context, place.old, place.new);
        if (next === null)
          failed.push({ placeId: place.id, why: `"${place.old}" is not in its place's source.` });
        else {
          slice = next;
          applied.push(place);
        }
      }
      if (applied.length) {
        spliced.push({ start, end, text: slice, places: applied });
        lastStart = start;
      }
    }
    if (!spliced.length) return { ...file };

    let content = file.content;
    for (const item of spliced)
      content = content.slice(0, item.start) + item.text + content.slice(item.end);
    if (syntaxErrors(file.path, content, kind) > syntaxErrors(file.path, file.content, kind)) {
      for (const item of spliced)
        for (const place of item.places)
          failed.push({ placeId: place.id, why: `${file.path} would no longer parse.` });
      return { ...file };
    }
    return { ...file, content };
  });
  return { files: out, failed };
}
