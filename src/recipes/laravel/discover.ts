// What a Laravel app with Blade has (B1 of the brownfield plan), read from its files and never by
// running it: its pages from the route files (closures, Route::view, controllers and resources,
// through groups with their prefixes and middleware, which say when a page needs a sign-in), each
// page's view, its sections from the view's @include, <x-…> and Livewire tags in order, and Shared
// from the layouts it extends or is wrapped in. `php artisan route:list` would know more, and runs
// the app's code to say it; the map run reads what this misses.
import path from 'node:path';
import { humanName } from '../../map/build.js';
import { isAtom } from '../../map/kinds.js';
import type {
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Known,
  Missed
} from '../../map/types.js';
import { listFiles, readText } from '../../map/walk.js';
import { ROUTE_FILE } from './preview.js';
import { chainCalls, closing, methodBody, statementEnd, strings, withoutComments } from './php.js';

const VIEWS = 'resources/views';
/** Route files that hold no web pages. */
const NOT_WEB = new Set(['api.php', 'console.php', 'channels.php']);
/** Folders of views that are no page's parts: mail, error pages, packages' published views. */
const NOT_PARTS = ['mail', 'emails', 'vendor', 'errors', 'pdf'];

type Context = { prefix: string; signIn: Known; names: string; controller: string | null };

type Route = {
  address: string;
  name: string | null;
  signIn: Known;
  /** The view it renders, or why there is none the discoverer can read. */
  view: string | null;
  livewire: string | null;
  why: string | null;
  from: string;
};

function joinAddress(prefix: string, uri: string): string {
  const parts = [prefix, uri].map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${parts.join('/')}`;
}

function signInOf(middleware: string[], current: Known): Known {
  if (middleware.some(item => /^(auth|verified|can:|password\.confirm)|^auth:/.test(item))) {
    return 'yes';
  }
  if (middleware.includes('guest')) return 'no';
  return current;
}

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

class Laravel {
  readonly routes: Route[] = [];
  readonly missed: Missed[] = [];
  private readonly files: string[];
  private readonly php: string[];

  constructor(private readonly input: DiscoverInput) {
    this.files = listFiles(input);
    this.php = this.files.filter(file => file.endsWith('.php'));
  }

  exists(file: string): boolean {
    return this.files.includes(file);
  }

  /** A view's file: `pages.about` is resources/views/pages/about.blade.php. */
  viewFile(name: string): string | null {
    if (name.includes('::')) return null;
    const base = `${VIEWS}/${name.replace(/\./g, '/')}`;
    return (
      [`${base}.blade.php`, `${base}/index.blade.php`, `${base}.php`].find(file =>
        this.exists(file)
      ) ?? null
    );
  }

  /** A controller's file, by its class's short name. */
  controllerFile(className: string): string | null {
    const short = className.split('\\').at(-1)!;
    const candidates = this.php.filter(file => path.posix.basename(file) === `${short}.php`);
    return (
      candidates.find(file => file.startsWith('app/Http/Controllers/')) ??
      candidates.find(file => file.startsWith('app/')) ??
      null
    );
  }

  /** What a controller's method renders: its view, or a Livewire or Inertia page, or nothing. */
  rendersOf(className: string, method: string): Pick<Route, 'view' | 'livewire' | 'why'> {
    const file = this.controllerFile(className);
    if (!file) return { view: null, livewire: null, why: `${className} is not in app/` };
    const text = withoutComments(readText(this.input.repo, file) ?? '');
    if (/extends\s+(?:\\?Livewire\\)?Component\b/.test(text) && file.includes('Livewire')) {
      const name = file
        .replace(/^app\/(?:Http\/)?Livewire\//, '')
        .replace(/\.php$/, '')
        .split('/')
        .map(part => part.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
        .join('.');
      return { view: null, livewire: name, why: null };
    }
    const body = methodBody(text, method) ?? '';
    return this.rendered(body, `${file}, ${method}()`);
  }

  /** What a closure, an action or a method body renders. */
  rendered(text: string, where: string): Pick<Route, 'view' | 'livewire' | 'why'> {
    const view = /\b(?:view|View::make)\(\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    if (view) return { view, livewire: null, why: null };
    const inertia = /\b(?:Inertia::render|inertia)\(\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    if (inertia) {
      return {
        view: null,
        livewire: null,
        why: `an Inertia page, ${inertia}: its sections are its JavaScript page's, which the map run reads`
      };
    }
    return { view: null, livewire: null, why: `${where} renders no view the discoverer can read` };
  }

  /** The routes in one file, and in every file it requires. */
  readFile(file: string, context: Context, seen: Set<string>): void {
    if (seen.has(file) || this.input.own.includes(file)) return;
    seen.add(file);
    const text = readText(this.input.repo, file);
    if (text !== null) this.readText(withoutComments(text), context, file, seen);
  }

  readText(text: string, context: Context, file: string, seen: Set<string>): void {
    const pattern =
      /\bRoute::|\brequire(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+\.php)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[1] !== undefined) {
        const required = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        this.readFile(required, context, seen);
        continue;
      }
      const end = statementEnd(text, match.index);
      this.readStatement(text.slice(match.index, end), context, file, seen);
      pattern.lastIndex = end + 1;
    }
  }

  readStatement(statement: string, context: Context, file: string, seen: Set<string>): void {
    const calls = chainCalls(statement);
    const groupAt = calls.findIndex(call => call.name === 'group');
    const middleware: string[] = [];
    let prefix = context.prefix;
    let names = context.names;
    let controller = context.controller;
    let routeName: string | null = null;
    for (const call of calls.slice(0, groupAt === -1 ? calls.length : groupAt)) {
      if (call.name === 'middleware') middleware.push(...strings(call.args));
      else if (call.name === 'prefix') prefix = joinAddress(prefix, strings(call.args)[0] ?? '');
      else if (call.name === 'name' && groupAt !== -1) names += strings(call.args)[0] ?? '';
      else if (call.name === 'name') routeName = strings(call.args)[0] ?? null;
      else if (call.name === 'controller') {
        controller = /([\w\\]+)::class/.exec(call.args)?.[1] ?? controller;
      }
    }
    if (groupAt !== -1) {
      const group = calls[groupAt]!;
      // Route::group(['prefix' => …, 'middleware' => …], function () { … })
      const options = /^\s*\[/.test(group.args)
        ? group.args.slice(0, closing(group.args, group.args.indexOf('[')) + 1)
        : '';
      if (options) {
        const groupPrefix = /['"]prefix['"]\s*=>\s*['"]([^'"]*)['"]/.exec(options)?.[1];
        if (groupPrefix !== undefined) prefix = joinAddress(prefix, groupPrefix);
        const listed = /['"]middleware['"]\s*=>\s*(\[[^\]]*\]|['"][^'"]*['"])/.exec(options)?.[1];
        if (listed) middleware.push(...strings(listed));
      }
      const inner: Context = {
        prefix,
        signIn: signInOf(middleware, context.signIn),
        names,
        controller
      };
      const brace = group.args.indexOf('{');
      if (brace !== -1) {
        this.readText(group.args.slice(brace + 1, closing(group.args, brace)), inner, file, seen);
      } else {
        const required = /['"]([^'"]+\.php)['"]/.exec(group.args)?.[1];
        if (required) {
          // base_path('routes/admin.php') is the repo's; __DIR__.'/admin.php' is beside this file.
          const from = /\bbase_path\s*\(/.test(group.args) ? '' : path.posix.dirname(file);
          this.readFile(
            path.posix.normalize(path.posix.join(from, required.replace(/^\/+/, ''))),
            inner,
            seen
          );
        }
      }
      return;
    }
    const [first] = calls;
    if (!first) return;
    const signIn = signInOf(middleware, context.signIn);
    const name = routeName ? `${names}${routeName}` : null;
    const args = first.args;
    const literal = strings(args);
    const afterUri = () => {
      // The action: what follows the first argument at the top level.
      let depth = 0;
      for (let i = 0; i < args.length; i++) {
        const char = args[i]!;
        if (char === "'" || char === '"') {
          for (i++; i < args.length && args[i] !== char; i++) if (args[i] === '\\') i++;
          continue;
        }
        if ('([{'.includes(char)) depth++;
        else if (')]}'.includes(char)) depth--;
        else if (char === ',' && depth === 0) return args.slice(i + 1);
      }
      return '';
    };
    const add = (uri: string, renders: Pick<Route, 'view' | 'livewire' | 'why'>, routeAs = name) =>
      this.routes.push({
        address: joinAddress(prefix, uri),
        name: routeAs,
        signIn,
        ...renders,
        from: file
      });
    if (first.name === 'view') {
      add(literal[0] ?? '', {
        view: literal[1] ?? null,
        livewire: null,
        why: literal[1] ? null : 'it names no view'
      });
      return;
    }
    if (first.name === 'resource' || first.name === 'resources') {
      const resource = literal[0] ?? '';
      const className = /([\w\\]+)::class/.exec(args)?.[1];
      if (!className) return;
      const only = calls.find(call => call.name === 'only');
      const except = calls.find(call => call.name === 'except');
      const param = (resource.split('.').at(-1) ?? 'item').replace(/s$/, '').replace(/-/g, '_');
      const actions: [string, string][] = [
        ['index', ''],
        ['create', 'create'],
        ['show', `{${param}}`],
        ['edit', `{${param}}/edit`]
      ];
      for (const [action, tail] of actions) {
        if (only && !strings(only.args).includes(action)) continue;
        if (except && strings(except.args).includes(action)) continue;
        add(
          `${resource.replace(/\./g, '/')}/${tail}`,
          this.rendersOf(className, action),
          `${names}${resource}.${action}`
        );
      }
      return;
    }
    const gets =
      first.name === 'get' ||
      first.name === 'any' ||
      (first.name === 'match' && /['"]get['"]/i.test(args.slice(0, args.indexOf(']') + 1)));
    if (!gets) return;
    const uri =
      first.name === 'match'
        ? (strings(args.slice(args.indexOf(']') + 1))[0] ?? '')
        : (literal[0] ?? '');
    const action = first.name === 'match' ? afterUri().replace(/^[^,]*,/, '') : afterUri();
    const pair = /\[\s*\\?([\w\\]+)::class\s*,\s*['"](\w+)['"]\s*\]/.exec(action);
    const at = /^\s*['"]([\w\\]+)@(\w+)['"]/.exec(action);
    const invokable = /^\s*\\?([\w\\]+)::class\s*$/.exec(action);
    const method = /^\s*['"](\w+)['"]\s*$/.exec(action);
    if (pair) add(uri, this.rendersOf(pair[1]!, pair[2]!));
    else if (at) add(uri, this.rendersOf(at[1]!, at[2]!));
    else if (invokable) add(uri, this.rendersOf(invokable[1]!, '__invoke'));
    else if (method && controller) add(uri, this.rendersOf(controller, method[1]!));
    else add(uri, this.rendered(action, `${file}'s route for ${joinAddress(prefix, uri)}`));
  }
}

// Blade views.

type Node = {
  kind: 'include' | 'component' | 'livewire';
  /** A view's name for an include, a tag's name (x- left off) for a component, a Livewire name. */
  name: string;
  repeated: boolean;
  /** A component tag that holds something between its opening and closing tags. */
  content: boolean;
  children: Node[];
};

type View = { extends: string | null; nodes: Node[] };

/** A Blade view's parts, in order, with their nesting. */
export function readBlade(source: string): View {
  const text = source.replace(/\{\{--[\s\S]*?--\}\}/g, match => ' '.repeat(match.length));
  const roots: Node[] = [];
  const open: { node: Node; tag: string; contentFrom: number }[] = [];
  let repeats = 0;
  let extendsView: string | null = null;
  const place = (node: Node) => {
    (open.length ? open.at(-1)!.node.children : roots).push(node);
  };
  const viewArgument = (args: string, kind: string): string | null => {
    const list = strings(args).filter(item => /^[\w.\-:/]+$/.test(item));
    if (kind === 'includeWhen' || kind === 'includeUnless') {
      const comma = args.indexOf(',');
      return strings(args.slice(comma + 1)).find(item => /^[\w.\-:/]+$/.test(item)) ?? null;
    }
    return list[0] ?? null;
  };
  const pattern =
    /@(extends|include|includeIf|includeWhen|includeUnless|includeFirst|each|livewire|component)\s*\(|@(foreach|forelse|for|while)\b|@(endforeach|endforelse|endfor|endwhile)\b|<livewire:([\w.-]+)|<x-([\w.:-]+)|<\/x-([\w.:-]+)\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const [whole, directive, loop, endLoop, livewireTag, opening, closingTag] = match;
    if (directive) {
      const open = match.index + whole.length - 1;
      const close = closing(text, open);
      const args = text.slice(open + 1, close);
      pattern.lastIndex = close + 1;
      if (directive === 'extends') {
        extendsView = strings(args)[0] ?? null;
        continue;
      }
      const name = viewArgument(args, directive);
      if (!name) continue;
      place({
        kind: directive === 'livewire' ? 'livewire' : 'include',
        name,
        repeated: repeats > 0 || directive === 'each',
        content: false,
        children: []
      });
    } else if (loop) {
      repeats++;
    } else if (endLoop) {
      repeats = Math.max(0, repeats - 1);
    } else if (livewireTag) {
      place({
        kind: 'livewire',
        name: livewireTag,
        repeated: repeats > 0,
        content: false,
        children: []
      });
    } else if (opening) {
      if (opening === 'slot' || opening.startsWith('slot:')) continue;
      // The tag's end: its `>`, past quoted attributes and {{ }}.
      let end = match.index + whole.length;
      for (; end < text.length && text[end] !== '>'; end++) {
        const char = text[end]!;
        if (char === '"' || char === "'") {
          const quote = text.indexOf(char, end + 1);
          end = quote === -1 ? text.length : quote;
        }
      }
      const node: Node = {
        kind: 'component',
        name: opening,
        repeated: repeats > 0,
        content: false,
        children: []
      };
      place(node);
      if (text[end - 1] !== '/') open.push({ node, tag: opening, contentFrom: end + 1 });
      pattern.lastIndex = end + 1;
    } else if (closingTag) {
      if (closingTag === 'slot' || closingTag.startsWith('slot:')) continue;
      const at = open.map(item => item.tag).lastIndexOf(closingTag);
      if (at === -1) continue;
      const [current] = open.splice(at);
      const inner = text
        .slice(current!.contentFrom, match.index)
        .replace(/<\/?x-slot[^>]*>/g, '')
        .trim();
      current!.node.content = inner.length > 0;
    }
  }
  return { extends: extendsView, nodes: roots };
}

const LAYOUT_TAG = /(^|[.-])layouts?([.-]|$)|-layout$/;
const VIEW_NAME = /(^|[.-])(content|page|view|main|body|index)$/;

export async function discoverLaravel(given: DiscoverInput): Promise<Discovered> {
  // The studio's own preview route is never one of the app's.
  const input = { ...given, own: [...given.own, ROUTE_FILE] };
  const app = new Laravel(input);
  const routeFiles = listFiles(input, 'routes').filter(
    file => file.endsWith('.php') && !NOT_WEB.has(path.posix.basename(file))
  );
  const seen = new Set<string>();
  const top: Context = { prefix: '', signIn: 'unknown', names: '', controller: null };
  // routes/web.php first, as the app loads it, and the files it requires with it.
  for (const file of ['routes/web.php', ...routeFiles]) app.readFile(file, top, seen);

  const views = new Map<string, View | null>();
  const viewOf = (file: string): View | null => {
    if (!views.has(file)) {
      const text = readText(input.repo, file);
      views.set(file, text === null ? null : readBlade(text));
    }
    return views.get(file)!;
  };
  const componentFile = (tag: string): string | null => {
    if (tag.includes('::')) return null;
    const anonymous = app.viewFile(`components.${tag}`);
    if (anonymous) return anonymous;
    const className = tag
      .split('.')
      .map(part => pascal(part))
      .join('/');
    const file = `app/View/Components/${className}.php`;
    return app.exists(file) ? file : null;
  };
  const livewireFiles = (name: string): string[] => {
    const parts = name.split('.');
    return [
      `app/Livewire/${parts.map(pascal).join('/')}.php`,
      `app/Http/Livewire/${parts.map(pascal).join('/')}.php`,
      `${VIEWS}/livewire/${parts.join('/')}.blade.php`
    ].filter(file => app.exists(file));
  };

  const components = new Map<string, FoundComponent>();
  const keep = (node: Node, kind: FoundComponent['kind']): string | null => {
    let files: string[];
    let exported: string;
    if (node.kind === 'include') {
      const file = app.viewFile(node.name);
      if (!file) return null;
      files = [file];
      exported = `view ${node.name}`;
    } else if (node.kind === 'component') {
      const file = componentFile(node.name);
      if (!file) return null;
      files = [file];
      exported = `x-${node.name}`;
    } else {
      files = livewireFiles(node.name);
      exported = `livewire ${node.name}`;
    }
    const key = `${files[0] ?? ''}#${exported}`;
    if (!components.has(key)) {
      const name = node.name.split(/[.:]/).at(-1)!;
      components.set(key, {
        key,
        name,
        kind: kind === 'atom' || isAtom(files[0] ?? '', pascal(name)) ? 'atom' : kind,
        files,
        export: exported,
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };

  type Made = { sections: string[]; shared: string[]; sharedFiles: string[]; blocks: string[] };
  /** The parts of a list of nodes: sections in order, a layout component's parts for Shared. */
  const partsOf = (nodes: Node[], kind: 'section' | 'shared', made: Made, depth: number) => {
    for (const node of nodes) {
      if (node.repeated) {
        keep(node, 'atom');
        continue;
      }
      if (node.kind === 'component' && LAYOUT_TAG.test(node.name)) {
        const file = componentFile(node.name);
        if (file && depth < 4) {
          made.sharedFiles.push(file);
          const own = viewOf(file);
          if (own) {
            const inner: Made = { sections: [], shared: [], sharedFiles: [], blocks: [] };
            partsOf(own.nodes, 'shared', inner, depth + 1);
            made.shared.push(...inner.sections, ...inner.shared);
          }
        }
        partsOf(node.children, kind, made, depth);
        continue;
      }
      if (node.kind === 'component') {
        const file = componentFile(node.name);
        if (file && isAtom(file, pascal(node.name.split('.').at(-1)!))) {
          keep(node, 'atom');
          partsOf(node.children, kind, made, depth);
          continue;
        }
      }
      if (node.kind === 'component' && (node.children.length || node.content)) {
        const before = made.sections.length;
        partsOf(node.children, kind, made, depth);
        if (made.sections.length === before && node.content) made.blocks.push(`x-${node.name}`);
        continue;
      }
      const key = keep(node, kind);
      if (key && components.get(key)!.kind !== 'atom' && !made.sections.includes(key)) {
        made.sections.push(key);
      }
    }
  };
  /** A view's own parts and its layouts', following @extends. */
  const pageOf = (file: string): Made => {
    const made: Made = { sections: [], shared: [], sharedFiles: [], blocks: [] };
    const view = viewOf(file);
    if (!view) return made;
    partsOf(view.nodes, 'section', made, 0);
    let layout = view.extends;
    for (let depth = 0; layout && depth < 4; depth++) {
      const layoutFile = app.viewFile(layout);
      if (!layoutFile) break;
      made.sharedFiles.push(layoutFile);
      const own = viewOf(layoutFile);
      if (!own) break;
      const inner: Made = { sections: [], shared: [], sharedFiles: [], blocks: [] };
      partsOf(own.nodes, 'shared', inner, 0);
      made.shared.push(...inner.sections, ...inner.shared);
      made.sharedFiles.push(...inner.sharedFiles);
      layout = own.extends;
    }
    // A view that only includes one view of its own: that view's sections.
    if (made.sections.length === 1) {
      const only = components.get(made.sections[0]!)!;
      if (only.export.startsWith('view ') && only.files[0]) {
        const inner = pageOf(only.files[0]);
        if (inner.sections.length >= 2 || (inner.sections.length && VIEW_NAME.test(only.export))) {
          return {
            ...inner,
            shared: [...made.shared, ...inner.shared],
            sharedFiles: made.sharedFiles
          };
        }
      }
    }
    return made;
  };

  const pages: FoundPage[] = [];
  const shared: FoundPage = {
    address: null,
    name: null,
    files: [],
    sections: [],
    signIn: 'unknown',
    example: null
  };
  const pageViews = new Set<string>();
  const byAddress = new Map<string, FoundPage>();
  for (const route of app.routes) {
    if (byAddress.has(route.address)) continue;
    const page: FoundPage = {
      address: route.address,
      name: route.name ? humanName(route.name.replace(/[.]/g, '-')) : null,
      files: [],
      sections: [],
      signIn: route.signIn,
      example: null
    };
    byAddress.set(route.address, page);
    pages.push(page);
    if (route.livewire) {
      const key = keep(
        { kind: 'livewire', name: route.livewire, repeated: false, content: false, children: [] },
        'section'
      );
      if (key) page.sections.push(key);
      page.files.push(...livewireFiles(route.livewire));
      continue;
    }
    const file = route.view ? app.viewFile(route.view) : null;
    if (!file) {
      app.missed.push({
        what: route.from,
        why: route.view
          ? `the page at ${route.address} renders the view ${route.view}, which is not in ${VIEWS}/`
          : `the page at ${route.address}: ${route.why}`
      });
      continue;
    }
    pageViews.add(file);
    page.files.push(file);
    const made = pageOf(file);
    page.sections.push(...made.sections);
    for (const key of made.shared) if (!shared.sections.includes(key)) shared.sections.push(key);
    for (const sharedFile of made.sharedFiles) {
      if (!shared.files.includes(sharedFile)) shared.files.push(sharedFile);
    }
    const reasons: string[] = [];
    if (made.blocks.length) {
      const containers = [...new Set(made.blocks)];
      reasons.push(
        `${made.blocks.length} block${made.blocks.length === 1 ? '' : 's'} of its content ${made.blocks.length === 1 ? 'is' : 'are'} written inline inside ${containers.join(', ')}, part of the view rather than sections of their own`
      );
    }
    if (!made.sections.length && !reasons.length) {
      reasons.push(
        'its content is written inline in the view, so it has no section of its own to show alone'
      );
    }
    if (reasons.length) app.missed.push({ what: file, why: reasons.join('; ') });
  }
  // Shared's parts are no page's sections.
  for (const page of pages)
    page.sections = page.sections.filter(key => !shared.sections.includes(key));
  for (const key of shared.sections) components.get(key)!.kind = 'shared';
  if (shared.sections.length || shared.files.length) pages.unshift(shared);

  // The views nothing the pages render reaches.
  const reached = new Set<string>();
  const visit = (file: string) => {
    if (reached.has(file)) return;
    reached.add(file);
    const view = viewOf(file);
    if (!view) return;
    if (view.extends) {
      const layout = app.viewFile(view.extends);
      if (layout) visit(layout);
    }
    const walk = (nodes: Node[]) => {
      for (const node of nodes) {
        const target =
          node.kind === 'include'
            ? app.viewFile(node.name)
            : node.kind === 'component'
              ? componentFile(node.name)
              : (livewireFiles(node.name).find(item => item.endsWith('.blade.php')) ?? null);
        if (target?.endsWith('.blade.php')) visit(target);
        else if (target && node.kind === 'component') {
          const view = app.viewFile(`components.${node.name}`);
          if (view) visit(view);
        }
        walk(node.children);
      }
    };
    walk(view.nodes);
  };
  for (const file of pageViews) visit(file);
  // The atoms the pages reach, deeper than their sections: by their folders or their names.
  for (const file of [...reached].sort()) {
    if (!file.startsWith(`${VIEWS}/components/`)) continue;
    const tag = file
      .slice(`${VIEWS}/components/`.length)
      .replace(/(\/index)?\.blade\.php$/, '')
      .replace(/\//g, '.');
    if (isAtom(file, pascal(tag.split('.').at(-1)!))) {
      keep({ kind: 'component', name: tag, repeated: false, content: false, children: [] }, 'atom');
    }
  }
  const unplaced = listFiles(input, VIEWS).filter(
    file =>
      file.endsWith('.blade.php') &&
      !reached.has(file) &&
      !NOT_PARTS.some(folder => file.startsWith(`${VIEWS}/${folder}/`)) &&
      !file.startsWith(`${VIEWS}/livewire/`)
  );
  pages.sort((a, b) =>
    a.address === null ? -1 : b.address === null ? 1 : a.address.localeCompare(b.address)
  );
  return {
    by: 'laravel',
    pages,
    components: [...components.values()],
    missed: app.missed,
    unplaced
  };
}
