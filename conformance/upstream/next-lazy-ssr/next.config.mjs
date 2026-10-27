import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
const config = {
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  agentRules: false,
  experimental: {
    turbopackLazyDynamicImportsSSR: true,
    // repro.mjs sets REPRO_FS_CACHE=off to show the workaround.
    ...(process.env.REPRO_FS_CACHE === "off" ? { turbopackFileSystemCacheForDev: false } : {}),
  },
};

export default config;
