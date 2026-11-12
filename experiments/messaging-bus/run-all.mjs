#!/usr/bin/env node
// experiments/messaging-bus/run-all.mjs — runs E1–E7 in order and writes results/e1..e7.json.
//   node run-all.mjs [--quick] [--out-dir <dir>]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const di = argv.indexOf('--out-dir');
const outDir = di >= 0 ? argv[di + 1] : join(HERE, 'results');
const scripts = [['e1', 'e1-outbox-bench.mjs'], ['e2', 'e2-mailbox-tokens.mjs'], ['e3', 'e3-contract-change.mjs'], ['e4', 'e4-two-host.mjs'],
  ['e5', 'e5-detector.mjs'], ['e6', 'e6-detector-e3.mjs'], ['e7', 'e7-noise.mjs']];

const summaries = {};
for (const [name, file] of scripts) {
  const args = [join(HERE, file), '--out', join(outDir, `${name}.json`)];
  if (quick) args.push('--quick');
  process.stderr.write(`running ${name}${quick ? ' (quick)' : ''}…\n`);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    process.stderr.write(`${name} failed with exit ${r.status ?? r.signal}\n`);
    process.exit(1);
  }
  summaries[name] = JSON.parse(r.stdout.trim());
}
process.stdout.write(JSON.stringify(summaries) + '\n');
