// Laravel with Blade: a route file loaded only in the local environment renders one iteration,
// rough/<page>/<component>/<iteration>/index.blade.php, through Laravel's own views, inside the
// wrapper rough/preview.blade.php. Three pieces:
//
//   routes/rough-preview.php   the route (development only, gitignored)
//   routes/web.php             two lines that load it in the local environment only
//   rough/preview.blade.php    wraps iterations in the app's styles (committed)
//
// In production the route is never registered, so its address answers 404: the runtime gate.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../../repo/root.js';

export const ROUTE_FILE = 'routes/rough-preview.php';
export const WEB_ROUTES = 'routes/web.php';
export const ENTRY = 'index.blade.php';
export const FIXTURE = 'preview.json';
export const WRAPPER = `${ROUGH_DIR}/preview.blade.php`;
const MARKER = 'Roughbook preview route';

/** What routes/web.php gains: the route file, loaded in the local environment only. */
export const WEB_SNIPPET = `
// Roughbook: the development-only preview route (roughbook init), never loaded outside the local environment.
if (app()->environment('local') && is_file(__DIR__.'/rough-preview.php')) {
    require __DIR__.'/rough-preview.php';
}
`;

export const PREVIEW_ROUTE = `<?php

// ${MARKER}: development only, not committed (see .gitignore). routes/web.php loads this file only
// when the app runs in the local environment, so in production it is never registered and
// /rough-preview answers 404 (the runtime gate). It renders one iteration,
// ${ROUGH_DIR}/<page>/<component>/<iteration>/${ENTRY}, inside ${WRAPPER} (the app's styles),
// with the iteration's ${FIXTURE} as the view's variables. Written by roughbook init from the
// Laravel recipe, which rewrites it (roughbook setup --upgrade).

use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Route;
use Illuminate\\Support\\Facades\\View;

Route::get('/rough-preview/{key}', function (Request $request, string $key) {
    // A page that says what went wrong, and posts it to the Roughbook studio (contract point 3).
    $failed = function (int $status, string $message) use ($key) {
        $html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Roughbook preview</title></head><body>'
            .'<pre style="padding: 2rem; white-space: pre-wrap; font-family: ui-monospace, monospace;">'.e($message).'</pre>'
            ."<script>window.parent.postMessage({ roughbook: 'error', id: ".json_encode($key).', message: '.json_encode($message)." }, '*');</script>"
            .'</body></html>';

        return response($html, $status);
    };
    // Loopback only: a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (contract point 5).
    if (! in_array($request->getHost(), ['localhost', '127.0.0.1', '[::1]', '::1'], true)) {
        abort(404);
    }
    View::addNamespace('rough', base_path('${ROUGH_DIR}'));
    $folder = base_path('${ROUGH_DIR}/'.$key);
    if (! preg_match('#^[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*/iteration-\\d{2,}$#', $key) || ! is_file($folder.'/${ENTRY}')) {
        return $failed(404, "There is no iteration {$key} in this repo.");
    }
    $fixture = [];
    if (is_file($folder.'/${FIXTURE}')) {
        $fixture = json_decode((string) file_get_contents($folder.'/${FIXTURE}'), true);
        if (! is_array($fixture)) {
            return $failed(500, '${FIXTURE} is not a JSON object.');
        }
    }
    try {
        $slot = view('rough::'.str_replace('/', '.', $key).'.index', $fixture)->render();
    } catch (\\Throwable $error) {
        return $failed(500, $error->getMessage());
    }
    // The variant the studio asks for in the address (contract point 2).
    $scheme = $request->query('roughbook-scheme') === 'dark' ? 'dark' : 'light';
    $variant = [
        'scheme' => $scheme,
        'dir' => $request->query('roughbook-dir') === 'rtl' ? 'rtl' : 'ltr',
        'lang' => preg_replace('/[^A-Za-z0-9-]/', '', (string) $request->query('roughbook-lang', '')) ?: null,
        'large' => $request->query('roughbook-text') === 'large',
    ];

    return response(view('rough::preview', ['key' => $key, 'slot' => $slot, 'variant' => $variant]));
})->where('key', '.*');
`;

/** The wrapper, loading the app's own Vite entries (those it has) once they are built or served. */
export function previewWrapper(repo: string): string {
  const entries = ['resources/css/app.css', 'resources/js/app.js'].filter(file =>
    fs.existsSync(path.join(repo, ...file.split('/')))
  );
  const vite = entries.length
    ? `    @if (file_exists(public_path('hot')) || file_exists(public_path('build/manifest.json')))
        @vite(${JSON.stringify(entries).replace(/"/g, "'").replace(/,/g, ', ')})
    @endif
`
    : '';
  return `<!DOCTYPE html>
{{-- Wraps every iteration previewed through this app: the app's fonts and styles, as its layout has
     them, the variant the studio asks for, and the ready message Roughbook waits for
     (rough/CONTRACT.md, points 2 and 3). Make it your app's own: its fonts, its head, its body classes. --}}
<html lang="{{ $variant['lang'] ?? str_replace('_', '-', app()->getLocale()) }}" dir="{{ $variant['dir'] }}" @class(['dark' => $variant['scheme'] === 'dark']) style="color-scheme: {{ $variant['scheme'] }};{{ $variant['large'] ? ' font-size: 125%;' : '' }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Roughbook preview: {{ $key }}</title>
${vite}</head>
<body class="antialiased">
    {!! $slot !!}
    <script>
        window.parent.postMessage({ roughbook: 'ready', id: @json($key) }, '*');
    </script>
</body>
</html>
`;
}

export function isOurRoute(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
