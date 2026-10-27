// Reproduces "Lazily compiled dynamic import … was not activated" with
// experimental.turbopackLazyDynamicImportsSSR and the development file-system cache.
//
//   node repro.mjs          a plain restart, with the cache on (fails) and off (passes)
//   node repro.mjs --all    a plain restart and each change tried while the server is down, cache on
//
// Each case: delete .next; run 1 starts `next dev`, requests /?m=alpha, waits until Turbopack
// has written its cache, and stops; the change, if any, is made while the server is down; run 2
// starts `next dev` on the same .next and requests /, then /?m=beta (which run 1 never loaded),
// then /?m=alpha; then app/ is put back as it was. Logs go to repro-<case>-run<n>.log.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(root, "app");
const port = Number(process.env.PORT ?? 3917);
const ERROR = "was not activated";

/** What run 1 requests, and what changes while the server is down. */
const CASES = {
  // Nothing changes.
  restart: { first: "/?m=alpha", change: () => {} },
  // The component the page imports moves, and the page follows.
  "move-page-import": {
    first: "/?m=alpha",
    change: () => {
      move("components/header.tsx", "components/masthead.tsx");
      edit("page.tsx", "components/header", "components/masthead");
    },
  },
  // The component every module imports moves, and the modules follow.
  "move-module-import": {
    first: "/?m=alpha",
    change: () => {
      move("components/label.tsx", "components/tag.tsx");
      for (const name of ["alpha", "beta", "gamma"]) edit(`modules/${name}/index.tsx`, "components/label", "components/tag");
    },
  },
  // The registry is written again with one more loader.
  "registry-add": {
    first: "/?m=alpha",
    change: () => {
      fs.cpSync(path.join(app, "modules", "gamma"), path.join(app, "modules", "delta"), { recursive: true });
      edit("registry.ts", "};", '  delta: () => import("./modules/delta/index"),\n};');
    },
  },
  // The registry is written again, unchanged but for a comment.
  "registry-touch": { first: "/?m=alpha", change: () => edit("registry.ts", "export const", "// regenerated\nexport const") },
  // The component every module imports changes in place.
  "edit-module-import": { first: "/?m=alpha", change: () => edit("components/label.tsx", "<strong>", "<strong data-edited>") },
  // The module run 2 asks for changes.
  "edit-unloaded-module": { first: "/?m=alpha", change: () => edit("modules/beta/index.tsx", "module beta", "module beta, edited") },
};

const all = process.argv.includes("--all");
const runs = all
  ? Object.keys(CASES).map((name) => ({ name, cache: true }))
  : [
      { name: "restart", cache: true },
      { name: "restart", cache: false },
    ];

if (!fs.existsSync(path.join(root, "node_modules", "next"))) {
  console.log("npm install …");
  const result = spawnSync("npm install --no-audit --no-fund", { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(1);
}
const next = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "next", "package.json"), "utf8"));
console.log(`next ${next.version}, node ${process.version}, ${process.platform}, port ${port}\n`);

const baseline = snapshot();
const results = [];
try {
  for (const { name, cache } of runs) {
    const label = `${name}, cache ${cache ? "on" : "off"}`;
    const env = cache ? {} : { REPRO_FS_CACHE: "off" };
    fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });

    const run1 = await serve(env, `${name}-cache-${cache ? "on" : "off"}-run1`);
    const first = await get(CASES[name].first);
    if (cache) await cacheWritten();
    await run1.stop();

    CASES[name].change();

    const run2 = await serve(env, `${name}-cache-${cache ? "on" : "off"}-run2`);
    const answers = [first];
    console.log(label);
    console.log(`  run 1  ${CASES[name].first}  ${first.status}`);
    for (const pathname of ["/", "/?m=beta", "/?m=alpha"]) {
      const answer = await get(pathname);
      answers.push(answer);
      console.log(`  run 2  ${pathname}  ${answer.status}${answer.error ? `  ${answer.error}` : ""}`);
    }
    await run2.stop();
    restore(baseline);

    const failed = answers.some((answer) => answer.status !== 200) || run2.log().includes(ERROR);
    console.log(`  "${ERROR}" in run 2's log: ${run2.log().includes(ERROR) ? "yes" : "no"}`);
    console.log(`  ${failed ? "FAIL" : "pass"}\n`);
    results.push(failed);
  }
} finally {
  restore(baseline);
}

if (!all) {
  const shown = results[0] === true && results[1] === false;
  console.log(shown ? "Reproduced: fails with the cache on, passes with it off." : "Not reproduced.");
  process.exit(shown ? 0 : 1);
}

/** Starts `next dev` and resolves once it is ready. */
function serve(env, name) {
  let output = "";
  const bin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [bin, "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, ...env, NEXT_TELEMETRY_DISABLED: "1", NO_COLOR: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`next dev did not start:\n${output}`)), 120_000);
    let ready = false;
    const onData = (chunk) => {
      output += chunk;
      if (ready || !/Ready in/.test(output)) return;
      ready = true;
      clearTimeout(timer);
      resolve({
        log: () => output,
        stop: async () => {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
          } else {
            process.kill(-child.pid, "SIGTERM");
          }
          await exited;
          await portFree();
          fs.writeFileSync(path.join(root, `repro-${name}.log`), output);
        },
      });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

/** Requests a path: its status and, on an error page, the error. */
async function get(pathname) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(240_000) });
    const body = await response.text();
    return { status: response.status, error: body.match(/Lazily compiled dynamic import[^"<\\]*/)?.[0] };
  } catch (error) {
    return { status: `no answer (${error.message})` };
  }
}

/**
 * Turbopack writes its cache once the server has been idle a moment. A server stopped before then
 * leaves run 2 nothing to restore, and the fault does not show; so wait until the cache has
 * grown and then stayed the same size for 3 s.
 */
async function cacheWritten() {
  const dir = path.join(root, ".next", "dev", "cache", "turbopack");
  const size = () => {
    let sum = 0;
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []) {
      try {
        sum += fs.statSync(path.join(dir, file)).size;
      } catch {
        // Turbopack replaced it while we looked.
      }
    }
    return sum;
  };
  const start = Date.now();
  let last = -1;
  let since = Date.now();
  while (Date.now() - start < 120_000) {
    const now = size();
    if (now !== last) [last, since] = [now, Date.now()];
    else if (now > 100_000 && Date.now() - since > 3000) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`  (the cache stayed at ${last} bytes)`);
}

async function portFree() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function move(from, to) {
  fs.renameSync(path.join(app, from), path.join(app, to));
}

function edit(file, from, to) {
  const text = fs.readFileSync(path.join(app, file), "utf8");
  if (!text.includes(from)) throw new Error(`app/${file} has no ${from}`);
  fs.writeFileSync(path.join(app, file), text.replace(from, to));
}

/** app/'s files, to put back after each case. */
function snapshot() {
  const files = new Map();
  for (const entry of fs.readdirSync(app, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.set(path.join(entry.parentPath, entry.name), fs.readFileSync(path.join(entry.parentPath, entry.name)));
  }
  return files;
}

function restore(files) {
  for (const entry of fs.readdirSync(app, { recursive: true, withFileTypes: true }).reverse()) {
    const full = path.join(entry.parentPath, entry.name);
    const kept = entry.isFile() ? files.has(full) : [...files.keys()].some((file) => file.startsWith(full + path.sep));
    if (!kept) fs.rmSync(full, { recursive: true, force: true });
  }
  for (const [file, content] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content)) fs.writeFileSync(file, content);
  }
}
