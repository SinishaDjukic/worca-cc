#!/usr/bin/env node
// tools/test-timings-merge.mjs — `npm run test:timings:merge -- <dir|file>...`: fold per-shard timings
// that CI measured into test/timings.json. Every test and slow-test shard in ci.yml runs with
// --timings-out and uploads the file as a test-timings-<tier>-<shard> artifact, so the weights come
// from the runners that run the shards, not from a developer's machine (whose speed differs file by
// file). Refresh after a green run on dev:
//   gh run download <run-id> --pattern 'test-timings-*' --dir .test-timings
//   npm run test:timings:merge -- .test-timings && rm -rf .test-timings
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTimings, writeTimings } from './test.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function timingFiles(paths) {
  const out = [];
  const walk = (p) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) walk(join(p, e));
    else if (p.endsWith('.json')) out.push(p);
  };
  for (const p of paths) walk(resolve(p));
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('usage: test-timings-merge <dir|file>...'); process.exit(2); }
  let files;
  try { files = timingFiles(args); } catch (e) { console.error(e.message); process.exit(2); }
  if (!files.length) { console.error('no .json timing files found'); process.exit(2); }
  const measured = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const base = JSON.parse(readFileSync(join(ROOT, 'test', 'timings.json'), 'utf8'));
  const merged = mergeTimings(base, measured, (k) => existsSync(join(ROOT, k)));
  writeTimings(ROOT, merged);
  const n = new Set(measured.flatMap((m) => Object.keys(m))).size;
  console.log(`test/timings.json: ${n} files re-timed from ${files.length} file(s), ${Object.keys(merged).length} files in all`);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
