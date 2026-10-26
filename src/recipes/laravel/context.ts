// The in-page view's switch for Laravel with Blade (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions
// 41 and 42), in the local environment only. It is part of the preview route file, which
// routes/web.php loads only there, and runs for requests to this machine: the view factory's finder
// sends each adopted view through a small PHP template, which renders the view (or, for
// `?roughbook-swap=<page>/<component>/<iteration>`, the iteration's copy of it) with the variables
// the page gave it, inside its marker. With `?roughbook-pick=1` the first marker also carries the
// script that names a clicked section to the frame.
//
//   routes/rough-preview.php           the route, with the switch after it (gitignored)
//   routes/rough-preview-section.php   the marker's template (gitignored)
//   routes/rough-preview.json          the adopted views and their iterations (generated, gitignored)
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_SENTINEL,
  MARKER_ELEMENT,
  MARKERS_PARAM,
  PICK_PARAM,
  SECTION_ATTRIBUTE,
  SWAP_PARAM,
  SWAPPED_ATTRIBUTE,
  contextSections,
  type ContextSection
} from '../context.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const CONTEXT_LIST = 'routes/rough-preview.json';
export const SECTION_TEMPLATE = 'routes/rough-preview-section.php';
const ENTRY = 'index.blade.php';

/** What the route file gains for a mapped app, after the route itself. */
export const CONTEXT_BLOCK = `
// The in-page view (${CONTEXT_SENTINEL}): each adopted view renders inside its marker, and with
// ?${SWAP_PARAM}=<page>/<component>/<iteration> the iteration renders in its place, with the variables the
// page gave the view. For this machine only, as the route is; ${CONTEXT_LIST} lists the adopted views.
(function () {
    $list = __DIR__.'/rough-preview.json';
    $template = __DIR__.'/rough-preview-section.php';
    $request = request();
    if (! is_file($list) || ! is_file($template) || ! in_array($request->getHost(), ['localhost', '127.0.0.1', '[::1]', '::1'], true)) {
        return;
    }
    $context = json_decode((string) file_get_contents($list), true);
    if (! is_array($context) || empty($context['views']) || ! is_array($context['views'])) {
        return;
    }
    View::addNamespace('rough', base_path('${ROUGH_DIR}'));
    $path = '/'.trim($request->path(), '/');
    // A dynamic segment ([slug], {post}) matches any one segment.
    $matches = function (?string $address) use ($path): bool {
        if ($address === null) {
            return false;
        }
        $want = explode('/', rtrim($address, '/'));
        $have = explode('/', rtrim($path, '/'));
        if (count($want) !== count($have)) {
            return false;
        }
        foreach ($want as $index => $part) {
            if (! preg_match('/^\\[.*\\]$|^\\{.*\\}$|^:/', $part) && $part !== $have[$index]) {
                return false;
            }
        }

        return true;
    };
    $views = $context['views'];
    $inner = app('view')->getFinder();
    $finder = new class($inner->getFilesystem(), $inner->getPaths(), $inner->getExtensions(), $views, $template) extends \\Illuminate\\View\\FileViewFinder
    {
        public function __construct($files, array $paths, array $extensions, private array $roughbookViews, private string $roughbookTemplate)
        {
            parent::__construct($files, $paths, $extensions);
        }

        public function find($name)
        {
            return isset($this->roughbookViews[$name]) ? $this->roughbookTemplate : parent::find($name);
        }

        public function original(string $name): string
        {
            return parent::find($name);
        }
    };
    foreach ($inner->getHints() as $namespace => $hints) {
        $finder->replaceNamespace($namespace, $hints);
    }
    app('view')->setFinder($finder);
    $swap = (string) $request->query('${SWAP_PARAM}', '');
    $markers = $request->query('${MARKERS_PARAM}') !== '0';
    $pick = $request->query('${PICK_PARAM}') === '1';
    // Each section is swapped once a request, so an iteration that renders the view itself shows the original.
    $swapped = [];
    foreach ($views as $name => $keys) {
        View::creator($name, function ($view) use ($name, $keys, $finder, $matches, $swap, $markers, &$pick, $context, &$swapped) {
            $key = $keys[0]['key'];
            foreach ($keys as $item) {
                if ($matches($item['address'] ?? null)) {
                    $key = $item['key'];
                    break;
                }
            }
            $file = $finder->original($name);
            $shown = null;
            if ($swap !== '' && str_starts_with($swap, $key.'/') && isset($context['iterations'][$swap]) && ! isset($swapped[$key])) {
                $swapped[$key] = true;
                $shown = $swap;
                $file = base_path($context['iterations'][$swap]);
            }
            $view->with('__roughbook', ['key' => $markers ? $key : null, 'file' => $file, 'swap' => $shown, 'pick' => $markers && $pick]);
            if ($markers) {
                $pick = false;
            }
        });
    }
})();
`;

/** The marker's template: the view, or the iteration in its place, with the page's variables, inside its marker. */
export const SECTION_FILE = `<?php

// Roughbook preview route: the in-page view's marker (${CONTEXT_SENTINEL}). Development only, not
// committed (see .gitignore): routes/rough-preview.php shows each adopted view through this file, in the
// local environment and for this machine only. It renders the view, or the iteration swapped in, with the
// variables the page gave the view.
$__roughbookShown = $__env->file($__roughbook['file'], \\Illuminate\\Support\\Arr::except(get_defined_vars(), ['__data', '__path', '__roughbook']))->render();
if ($__roughbook['key'] === null) {
    echo $__roughbookShown;
} else {
    echo '<${MARKER_ELEMENT} ${SECTION_ATTRIBUTE}="'.e($__roughbook['key']).'"'
        .($__roughbook['swap'] !== null ? ' ${SWAPPED_ATTRIBUTE}="'.e($__roughbook['swap']).'"' : '')
        .' style="display: contents">'.$__roughbookShown
        // With ?${PICK_PARAM}=1, once a page: a click names the section it fell in to the frame instead of following the page.
        .($__roughbook['pick'] ? "<script>(function(){if(window.roughbookPick)return;window.roughbookPick=1;document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var s=e.target instanceof Element?e.target.closest('[${SECTION_ATTRIBUTE}]'):null;if(s)window.parent.postMessage({roughbook:'section',key:s.getAttribute('${SECTION_ATTRIBUTE}')},'*');},true);})();</script>" : '')
        .'</${MARKER_ELEMENT}>';
}
`;

/** The view name Blade renders a component by, from its file under resources/views/; null for none. */
export function viewName(section: Pick<ContextSection, 'source'>): string | null {
  if (section.source.export.startsWith('livewire')) return null;
  const blade = section.source.files.find(file => /^resources\/views\/.+\.blade\.php$/.test(file));
  if (!blade) return null;
  return blade.slice('resources/views/'.length, -'.blade.php'.length).split('/').join('.');
}

/** routes/rough-preview.json, as the adopted views are now. */
export function renderContextList(sections: ContextSection[]): string {
  const views: Record<string, { key: string; address: string | null }[]> = {};
  const iterations: Record<string, string> = {};
  for (const section of sections) {
    const name = viewName(section);
    if (!name) continue;
    (views[name] ??= []).push({ key: section.key, address: section.address });
    for (const iteration of section.iterations) iterations[iteration.key] = iteration.shown;
  }
  return `${JSON.stringify({ views, iterations }, null, 2)}\n`;
}

/** Rewrites routes/rough-preview.json when the adopted views changed. Returns whether it wrote. */
export function writeContextList(repo: string): boolean {
  const file = path.join(repo, ...CONTEXT_LIST.split('/'));
  if (!fs.existsSync(path.dirname(file))) return false;
  const text = renderContextList(contextSections(repo, ENTRY));
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.writeFileSync(file, text);
  return true;
}
