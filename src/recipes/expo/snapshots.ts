// The Expo recipe's snapshot and device commands (rough/CONTRACT.md, the snapshot contract): a
// live preview through the web target is close to the native rendering but not the same, so final
// review renders each iteration on a device. rough/snapshots.mjs opens the preview route by its deep
// link in the app on an attached Android device or emulator (adb), or a booted iOS simulator
// (xcrun simctl, on macOS), sets the size, density and colour scheme of each shot, waits for the
// route to log ready, and takes the screen. With `--open <key>` it only opens the key there. It
// needs the app's dev server running (roughbook start) and the app installed: Expo Go, or a
// development build of this app.
import { ROUGH_DIR } from '../../repo/root.js';

export const SNAPSHOT_SCRIPT = 'snapshots.mjs';
const MARKER = 'Written by Roughbook (the Expo recipe)';

/** The script, run with Node.js, which an Expo app has. */
export const SNAPSHOT_SCRIPT_CONTENT = `// ${MARKER}; roughbook setup --upgrade rewrites it.
// Final-review snapshots: renders each key the studio asks for on an attached Android device or
// emulator, or a booted iOS simulator, through the preview route's deep link, and writes one PNG
// per shot to ROUGHBOOK_OUT (rough/CONTRACT.md, the snapshot contract). \`--open <key>\` opens one
// key there and stops. Needs the dev server running (roughbook start) and the app on the device:
// Expo Go, or a development build (set ROUGHBOOK_APP_URL to its scheme, as myapp://).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const devUrl = new URL(env.ROUGHBOOK_DEV_URL || "http://localhost:8081");
const port = devUrl.port || "8081";
const appUrl = (env.ROUGHBOOK_APP_URL || \`exp://127.0.0.1:\${port}/--/\`).replace(/\\/?$/, "/");

function tool(name, fallback) {
  const named = env[name] || fallback;
  // A script stands in for the tool where it has to (the studio's own tests).
  return /\\.m?js$/.test(named) ? [process.execPath, named] : [named];
}
const adbPath =
  env.ANDROID_HOME && fs.existsSync(path.join(env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"))
    ? path.join(env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
    : "adb";
const adbTool = tool("ROUGHBOOK_ADB", adbPath);
const simctlTool = tool("ROUGHBOOK_XCRUN", "xcrun");

function run([program, ...first], args, options = {}) {
  const result = spawnSync(program, [...first, ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  return { code: result.error ? 127 : result.status ?? 1, out: result.stdout ?? Buffer.alloc(0), err: String(result.stderr ?? "") };
}
const adb = (...args) => run(adbTool, args);
const simctl = (...args) => run(simctlTool, ["simctl", ...args]);
const text = (result) => String(result.out);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function target() {
  if (adb("devices").code === 0 && /\\n\\S+\\tdevice\\b/.test(text(adb("devices")))) return "android";
  if (process.platform === "darwin" && simctl("list", "devices", "booted").code === 0 && /Booted/.test(text(simctl("list", "devices", "booted")))) return "ios";
  return null;
}

function address(key, variant) {
  const query = new URLSearchParams();
  if (variant === "dark") query.set("roughbook-scheme", "dark");
  return \`\${appUrl}rough-preview/\${key}\${query.size ? \`?\${query}\` : ""}\`;
}

function open(device, url) {
  if (device === "android") {
    adb("reverse", \`tcp:\${port}\`, \`tcp:\${port}\`);
    return adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url).code === 0;
  }
  return simctl("openurl", "booted", url).code === 0;
}

/** Waits for the route's word on the key: ready, or an error with its reason. */
function waitFor(device, key, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (device === "android") {
      const log = text(adb("logcat", "-d", "-s", "ReactNativeJS:V"));
      const word = new RegExp(\`roughbook: (ready|error) \${key.replace(/[/-]/g, "\\\\$&")}(?::\\\\s*(.*))?\`).exec(log);
      if (word) return word[1] === "ready" ? null : word[2] || "The iteration failed to render.";
    } else if (Date.now() > until - ms + 4000) {
      return null;
    }
    sleep(500);
  }
  return \`The app did not say the iteration rendered within \${ms / 1000} s. Is the dev server running (roughbook start), and the app open on the device?\`;
}

const keys = (env.ROUGHBOOK_KEYS || "").split(",").filter(Boolean);
const shots = (env.ROUGHBOOK_SHOTS || "").split(",").filter(Boolean).map((item) => {
  const [name, size, variant] = item.split(":");
  const [width, height] = size.split("x").map(Number);
  return { name, width, height, variant };
});
const device = target();
const opening = process.argv.indexOf("--open");
if (opening !== -1) {
  const key = process.argv[opening + 1];
  if (!device) {
    console.error("No Android device or emulator is attached (adb devices), and no iOS simulator is booted.");
    process.exit(1);
  }
  process.exit(open(device, address(key, "light")) ? 0 : 1);
}
if (!device) {
  for (const key of keys) {
    console.log(\`roughbook: error \${key}: No Android device or emulator is attached (adb devices lists none), and no iOS simulator is booted: final-review snapshots render on one.\`);
  }
  process.exit(1);
}

let failed = false;
for (const key of keys) {
  const dir = path.join(env.ROUGHBOOK_ITERATIONS || "${ROUGH_DIR}", ...key.split("/"));
  if (!fs.existsSync(dir)) {
    console.log(\`roughbook: missing \${key}\`);
    failed = true;
    continue;
  }
  let why = null;
  for (const shot of shots) {
    if (device === "android") {
      // The shot's size at three times, and the scheme, on the device for the time it takes.
      adb("shell", "wm", "size", \`\${shot.width * 3}x\${shot.height * 3}\`);
      adb("shell", "wm", "density", "480");
      adb("shell", "cmd", "uimode", "night", shot.variant === "dark" ? "yes" : "no");
      adb("logcat", "-c");
    } else {
      simctl("ui", "booted", "appearance", shot.variant === "dark" ? "dark" : "light");
    }
    if (!open(device, address(key, shot.variant))) {
      why = "The device could not open the preview's address.";
      break;
    }
    why = waitFor(device, key);
    if (why) break;
    sleep(800);
    const file = path.join(env.ROUGHBOOK_OUT, ...key.split("/"), \`\${shot.name}.png\`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (device === "android") {
      const screen = adb("exec-out", "screencap", "-p");
      if (screen.code !== 0 || !screen.out.length) {
        why = \`The screen could not be taken: \${screen.err.trim()}\`;
        break;
      }
      fs.writeFileSync(file, screen.out);
    } else if (simctl("io", "booted", "screenshot", file).code !== 0) {
      why = "The simulator's screen could not be taken.";
      break;
    }
  }
  if (device === "android") {
    adb("shell", "wm", "size", "reset");
    adb("shell", "wm", "density", "reset");
  }
  if (why) {
    failed = true;
    console.log(\`roughbook: error \${key}: \${why}\`);
  } else console.log(\`roughbook: ready \${key}\`);
}
process.exit(failed ? 1 : 0);
`;

export function isOurSnapshotScript(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
