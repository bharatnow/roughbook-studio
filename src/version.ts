import { readFileSync } from 'node:fs';

/** The studio's version, from package.json one folder above both src/ and dist/. */
export const STUDIO_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
