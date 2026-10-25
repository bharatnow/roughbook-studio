// Just enough of PHP to read a Laravel app's route files and controllers without running them:
// comments taken out, brackets matched, string literals read. Reading only (decision 19 of the
// brownfield plan): `php artisan route:list` would run the app's code.

/** The text with its comments blanked out, strings kept, so offsets stay where they were. */
export function withoutComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "'" || char === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
      continue;
    }
    const line = (char === '/' && text[i + 1] === '/') || (char === '#' && text[i + 1] !== '[');
    if (line) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += char;
  }
  return out;
}

const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Where the bracket at `open` closes, string-aware; the text's end when it never does. */
export function closing(text: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const char = text[i]!;
    if (char === "'" || char === '"') {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (CLOSE[char]) stack.push(CLOSE[char]);
    else if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return text.length;
}

/** Where the statement starting at `start` ends: its `;` outside every bracket and string. */
export function statementEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (char === "'" || char === '"') {
      for (i++; i < text.length && text[i] !== char; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (CLOSE[char]) {
      i = closing(text, i);
      continue;
    }
    if (char === ';') return i;
  }
  return text.length;
}

/** Every string literal in the text, in order, with its quotes' escapes undone. */
export function strings(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
    found.push((match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1'));
  }
  return found;
}

/** One call of a chain, `Route::get(...)->name(...)`: its name and the text between its brackets. */
export type ChainCall = { name: string; args: string };

/** The calls of a statement's chain, outermost level only. */
export function chainCalls(statement: string): ChainCall[] {
  const calls: ChainCall[] = [];
  const pattern = /(?:::|->)\s*([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(statement))) {
    const open = match.index + match[0].length - 1;
    const close = closing(statement, open);
    calls.push({ name: match[1]!, args: statement.slice(open + 1, close) });
    pattern.lastIndex = close + 1;
  }
  return calls;
}

/** A function's or a method's body: from its name's `function` to its closing brace. */
export function methodBody(text: string, name: string): string | null {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(text);
  if (!match) return null;
  const brace = text.indexOf('{', closing(text, match.index + match[0].length - 1));
  if (brace === -1) return null;
  return text.slice(brace, closing(text, brace) + 1);
}
