#!/usr/bin/env node
// tools/test-timings-merge.mjs — `npm run test:timings:merge -- <dir|file>...`: fold per-shard timings
// that CI measured into test/timings.json. Every test and slow-test shard in ci.yml runs with
// --timings-out and uploads the file as a test-timings-<tier>-<shard> artifact, so the weights come
// from the runners that run the shards, not from a developer's machine (whose speed differs file by
// file). The weekly Refresh test timings workflow (.github/workflows/refresh-test-timings.yml) runs this on the newest
// green dev push run and opens or updates one PR. After writing, it prints how many fast and slow tier files are still
// untimed. Manual fallback, after a green run on dev:
//   gh run download <run-id> --pattern 'test-timings-*' --dir .test-timings
//   npm run test:timings:merge -- .test-timings && rm -rf .test-timings
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeTimings, tierFiles, untimedWarning, writeTimings } from './test.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The merger's closing line: the untimed warning, or that every given file has a recorded time. */
export const completenessLine = (files, timings) => untimedWarning(files, timings) ?? '0 test files have no recorded timing';

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
  console.log(completenessLine([...tierFiles(ROOT, 'fast').files, ...tierFiles(ROOT, 'slow').files], merged));
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
