#!/usr/bin/env node
// bin/worca-bench-ui.js
//
// Launches the worca-bench dashboard server. Resolves the results target
// directory from --target-dir, then WORCA_BENCH_DIR, then ./worca-bench-out.

import { createServer } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

/** Parse argv into { port, host, targetDir }. Exported for testing. */
export function parseArgs(argv) {
  const args = {
    port: Number(process.env.PORT) || 3500,
    host: process.env.HOST || '127.0.0.1',
    targetDir: process.env.WORCA_BENCH_DIR || './worca-bench-out',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (a === '--host' && argv[i + 1]) {
      args.host = argv[++i];
    } else if ((a === '--target-dir' || a === '--target') && argv[i + 1]) {
      args.targetDir = argv[++i];
    }
  }
  args.targetDir = isAbsolute(args.targetDir)
    ? args.targetDir
    : resolve(process.cwd(), args.targetDir);
  return args;
}

export function startServer({ port, host, targetDir }) {
  const app = createApp({ targetDir });
  const server = createServer(app);
  return new Promise((res) => {
    server.listen(port, host, () => res(server));
  });
}

// Only auto-run when invoked as a script (not when imported by tests).
const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  startServer(args).then(() => {
    console.log(`worca-bench-ui listening on http://${args.host}:${args.port}`);
    console.log(`reading results from ${args.targetDir}`);
  });
}
