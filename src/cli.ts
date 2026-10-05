#!/usr/bin/env node
import { main } from './commands/index.js';
import { terminalIo } from './io.js';

// The only place that reads the working directory: everything below takes the repo root from it.
process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  io: terminalIo()
});
