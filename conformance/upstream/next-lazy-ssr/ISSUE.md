# The issue to file

For the owner, not part of the issue. File it with the Next.js repository's bug report template.
The template asks for a link to a public reproduction: host this folder (without `node_modules`,
`.next` and the logs) and put its link where the body says so. The body below has no links.
Verified on 2026-10-27, Windows 11, Node 24.11.1: it fails on 16.4.2, 16.4.3 (the latest) and
16.5.0-canary.28, and passes on each with the workaround.

---

**Title:** `turbopackLazyDynamicImportsSSR`: after `next dev` restarts onto its file-system cache, a dynamic import the previous run didn't load fails with "was not activated"

### Link to the code that reproduces this issue

(link to the reproduction)

### To Reproduce

The reproduction is a minimal App Router app with `experimental.turbopackLazyDynamicImportsSSR: true`
and the default development file-system cache. Its one page is a server component that picks a
module from a registry of loaders by a search parameter and awaits it:

```ts
// app/registry.ts
export const loaders = {
  alpha: () => import("./modules/alpha/index"),
  beta: () => import("./modules/beta/index"),
  gamma: () => import("./modules/gamma/index"),
};

// app/page.tsx
const { m } = await searchParams;
const load = m ? loaders[m] : undefined;
const Module = load ? (await load()).default : null;
```

1. `npm install`
2. `node repro.mjs`. It deletes `.next`, then:
   - Run 1: starts `next dev`, requests `/?m=alpha`, waits until Turbopack has written its cache to
     `.next/dev/cache/turbopack` (a few seconds), and stops the server.
   - Run 2: starts `next dev` again on the same `.next`, and requests `/`, `/?m=beta` and
     `/?m=alpha`.
   - It then does the same with `experimental.turbopackFileSystemCacheForDev: false`.

By hand: `next dev`, open `/?m=alpha`, wait a few seconds, stop the server, `next dev` again, open
`/?m=beta`.

### Current vs. Expected behavior

Expected: `/?m=beta` renders module beta in run 2, as it does when the server has not restarted.

Current: `/?m=beta` answers 500. `/` and `/?m=alpha` (loaded in run 1) still answer 200.

```
next 16.4.3, node v24.11.1, win32, port 3917

restart, cache on
  run 1  /?m=alpha  200
  run 2  /  200
  run 2  /?m=beta  500  Lazily compiled dynamic import of [project]/app/modules/beta/index.tsx [app-rsc] (ecmascript, lazy compilation proxy FollowReexports(None)) was not activated
  run 2  /?m=alpha  200
  "was not activated" in run 2's log: yes
  FAIL

restart, cache off
  run 1  /?m=alpha  200
  run 2  /  200
  run 2  /?m=beta  200
  run 2  /?m=alpha  200
  "was not activated" in run 2's log: no
  pass
```

The server's log in run 2:

```
⨯ Error: Lazily compiled dynamic import of [project]/app/modules/beta/index.tsx [app-rsc] (ecmascript, lazy compilation proxy FollowReexports(None)) was not activated
    at module evaluation (.next\dev\server\chunks\ssr\app_modules_beta_index_tsx_07xzgk8r3gg_a._.js:4:40)
    at <unknown> (.next\dev\server\chunks\ssr\app_modules_0didol3jmxte1._.js:22:16)
    at async Page (app\page.tsx:8:26)
   6 |   const { m } = await searchParams;
   7 |   const load = m ? loaders[m] : undefined;
>  8 |   const Module = load ? (await load()).default : null;
     |                          ^
   9 |   return (
  10 |     <main>
  11 |       <Header /> {
  digest: '754870534'
}
 GET /?m=beta 500 in 178ms (next.js: 4ms, application-code: 174ms)
```

What we observed:
- It needs the cache to have been written in run 1. A server stopped right after the first
  request, before Turbopack wrote its cache, leaves run 2 working.
- Changing files while the server is down is not needed, and doesn't change the result. `node
  repro.mjs --all` also tries moving a file the page imports, moving a file the modules import,
  adding a loader to the registry, editing the registry, editing an imported component, and
  editing the module run 2 asks for: each fails the same way.
- With `turbopackFileSystemCacheForDev: false` it never happens.

### Provide environment information

```bash
Operating System:
  Platform: win32
  Arch: x64
  Version: Windows 11 Pro
  Available memory (MB): 16127
  Available CPU cores: 8
Binaries:
  Node: 24.11.1
  npm: 11.6.2
  Yarn: 1.22.21
  pnpm: 8.6.12
Relevant Packages:
  next: 16.4.3 // Latest available version is detected (16.4.3).
  eslint-config-next: N/A
  react: 19.2.9
  react-dom: 19.2.9
  typescript: 5.9.3
Next.js Config:
  output: N/A
```

Also reproduces on 16.4.2 and 16.5.0-canary.28.

### Which area(s) are affected? (Select all that apply)

Turbopack, Lazy Loading

### Which stage(s) are affected? (Select all that apply)

next dev (local)

### Additional context

Workaround: turn off the development file-system cache beside the lazy imports.

```js
experimental: {
  turbopackLazyDynamicImportsSSR: true,
  turbopackFileSystemCacheForDev: false,
},
```
