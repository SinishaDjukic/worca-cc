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
// --sum test/a.test.mjs,test/b.test.mjs <dir|file>...: the listed files' seconds and their total, as a Markdown table,
// read from the same timing files; it never writes test/timings.json (a before/after speed-up figure).
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

/**
 * The seconds of `files`, in that order, from the measured maps. A file in no map is `missing` (seconds null), a file
 * in 2 or more is `duplicated` (its first timing counts). `total` sums the found seconds, rounded to 0.01 s.
 */
export function sumTimings(measured, files) {
  const rows = [], missing = [], duplicated = [];
  for (const file of files) {
    const found = measured.filter((m) => Object.hasOwn(m, file));
    if (!found.length) missing.push(file);
    if (found.length > 1) duplicated.push(file);
    rows.push({ file, seconds: found.length ? found[0][file] : null });
  }
  const total = Math.round(rows.reduce((a, r) => a + (r.seconds ?? 0), 0) * 100) / 100;
  return { rows, total, missing, duplicated };
}

function sumMain(args) {
  const [list, ...paths] = args;
  if (!list || !paths.length) { console.error('usage: test-timings-merge --sum test/a.test.mjs,test/b.test.mjs <dir|file>...'); process.exit(2); }
  let files;
  try { files = timingFiles(paths); } catch (e) { console.error(e.message); process.exit(2); }
  if (!files.length) { console.error('no .json timing files found'); process.exit(2); }
  const measured = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const r = sumTimings(measured, list.split(',').filter(Boolean));
  console.log('| file | seconds |\n|---|---|');
  for (const { file, seconds } of r.rows) console.log(`| ${file} | ${seconds === null ? '—' : seconds.toFixed(2)} |`);
  console.log(`| Total | ${r.total.toFixed(2)} |`);
  for (const f of r.missing) console.error(`${f} has no timing in the given files`);
  for (const f of r.duplicated) console.error(`${f} appears in ${measured.filter((m) => Object.hasOwn(m, f)).length} timing files`);
  process.exit(r.missing.length || r.duplicated.length ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sum') return sumMain(args.slice(1));
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
