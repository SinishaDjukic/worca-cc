#!/usr/bin/env node
// tools/ui-boot-speedup.mjs — the summed per-file CI duration of the UI test files moved onto the shared app boot
// (test/helpers/shared-app-boot.mjs), from 2 ci.yml runs before and 2 after on one runner type, with the run links.
//   node tools/ui-boot-speedup.mjs record --before A,B          writes test/ui-boot-speedup.json, the "before" snapshot
//   node tools/ui-boot-speedup.mjs report --after C,D [--write]  prints the report; --write saves docs/ui-boot-speedup.md
// The snapshot is committed because CI keeps the test-timings-* artifacts for 14 days only. Runs are read with `gh`
// (a developer machine, never CI). A refusal prints its reason on stderr, writes nothing and exits 1 (2 on usage).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumTimings, timingFiles } from './test-timings-merge.mjs';
import { LIST_FILE } from './suite-guard.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const RECORD_FILE = 'test/ui-boot-speedup.json';
export const REPORT_FILE = 'docs/ui-boot-speedup.md';
// Slice 11's offender list: the 196 files that booted app.js in every test before any was converted.
const SLICE_11 = '54ae95625';
const SHARED_BOOT = './helpers/shared-app-boot.mjs';
// The Node 24 fast shards upload the fast tier's timings (ci.yml "This shard's per-file seconds").
const NODE_24_SHARD = /^fast tests \(Node 24, (\d+)\/\d+\)$/;

export class SpeedupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const runnerOf = (run) => `${run.runner.labels.join(',')}/${run.runner.image}`;

function checkRunIds(ids) {
  if (ids.length < 2) throw new SpeedupError('too-few-runs', `need 2 runs before and 2 after, got ${ids.length}`);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new SpeedupError('duplicate-run', `run ${id} is listed twice`);
    seen.add(id);
  }
}

function checkRunner(runs) {
  const [first] = runs;
  const other = runs.find((r) => runnerOf(r) !== runnerOf(first));
  if (other) {
    throw new SpeedupError('runner-mismatch', `run ${first.runId} ran on ${runnerOf(first)}, run ${other.runId} on ${runnerOf(other)}`);
  }
}

function checkTimings(runs, files) {
  for (const run of runs) {
    const [missing] = sumTimings([run.seconds], files).missing;
    if (missing) throw new SpeedupError('missing-timing', `${missing} has no timing in run ${run.runId}`);
  }
}

export function parseRunIds(arg) {
  const ids = String(arg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  checkRunIds(ids);
  return ids;
}

const runGh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });

/** One ci.yml run: its facts, the Node 24 fast shards' runner, and every file's seconds from its timing artifacts. */
export async function readRun(runId, { exec = runGh, dir } = {}) {
  const id = String(runId);
  const gh = async (args) => String(await exec(args));
  const info = JSON.parse(await gh(['api', `repos/{owner}/{repo}/actions/runs/${id}`]));
  const workflow = String(info.path ?? '');
  if (!/(^|\/)ci\.yml$/.test(workflow)) throw new SpeedupError('not-ci', `run ${id} is workflow ${workflow || info.name}, not ci.yml`);
  if (info.conclusion !== 'success') {
    throw new SpeedupError('not-green', `run ${id} is not a successful ci.yml run (conclusion ${info.conclusion})`);
  }
  const { jobs = [] } = JSON.parse(await gh(['api', `repos/{owner}/{repo}/actions/runs/${id}/jobs?per_page=100`]));
  const shards = jobs.filter((j) => NODE_24_SHARD.test(j.name));
  const first = shards.find((j) => j.name.match(NODE_24_SHARD)[1] === '1');
  if (!first) throw new SpeedupError('missing-timing', `run ${id} has no Node 24 fast shard 1 job`);
  const labels = [...new Set(shards.flatMap((j) => j.labels ?? []))].sort();
  const log = await gh(['api', '--allow-escape-sequences', `repos/{owner}/{repo}/actions/jobs/${first.id}/logs`]);
  const image = log.match(/\bImage: (\S+)/)?.[1] ?? 'unknown';

  const own = !dir;
  const base = dir ?? mkdtempSync(join(tmpdir(), 'worca-cc-ui-boot-speedup-'));
  const into = join(base, id);
  try {
    await gh(['run', 'download', id, '--pattern', 'test-timings-*', '--dir', into]);
    const seconds = {};
    for (const f of existsSync(into) ? timingFiles([into]) : []) Object.assign(seconds, JSON.parse(readFileSync(f, 'utf8')));
    return {
      runId: id, url: info.html_url, headSha: info.head_sha, createdAt: info.created_at, event: info.event,
      runner: { labels, image }, seconds,
    };
  } finally {
    if (own) rmSync(base, { recursive: true, force: true });
  }
}

/** The before snapshot: the listed files' seconds in 2 or more runs on one runner. */
export function buildRecord(files, runs) {
  checkRunIds(runs.map((r) => String(r.runId)));
  checkRunner(runs);
  checkTimings(runs, files);
  return {
    about: 'The per-file CI seconds of slice 11\'s per-test-boot UI files (test/suite-guard-offenders.json at '
      + `${SLICE_11}), from 2 green dev-push ci.yml runs before any was moved onto test/helpers/shared-app-boot.mjs. `
      + 'Written by `node tools/ui-boot-speedup.mjs record`; `report` compares later runs with it.',
    files: [...files],
    before: runs.map((r) => ({ ...r, runId: String(r.runId), seconds: Object.fromEntries(files.map((f) => [f, r.seconds[f]])) })),
  };
}

/** The record's files that left the offender list. */
export function convertedFiles(record, offenderList, exists) {
  const listed = new Set(offenderList);
  const out = record.files.filter((f) => !listed.has(f));
  const gone = out.find((f) => !exists(f));
  if (gone) throw new SpeedupError('file-gone', `${gone} is no longer on the offender list and no longer exists`);
  return out;
}

const stemOf = (file) => file.replace(/\.test\.mjs$/, '');

/**
 * The files a converted file's tests moved to: a top-level test file named after it plus `-…`, booting through the
 * shared helper, not excluded (the record's files and the conversions test's BASELINE keys), and counted only for the
 * longest converted stem it starts with.
 */
export function siblingsOf(file, converted, topLevelFiles, usesSharedBoot, excluded) {
  const owner = (candidate) => converted
    .filter((c) => candidate.startsWith(`${stemOf(c)}-`))
    .reduce((best, c) => (!best || c.length > best.length ? c : best), null);
  return topLevelFiles.filter((f) => f !== file && f.startsWith(`${stemOf(file)}-`) && !excluded.has(f)
    && owner(f) === file && usesSharedBoot(f));
}

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Each converted file's mean of 2 runs before and after (its siblings added after), the totals and the headline. */
export function speedupReport(record, afterRuns, converted, siblingsByFile) {
  const before = record.before;
  checkRunIds(afterRuns.map((r) => String(r.runId)));
  checkRunIds([...before, ...afterRuns].map((r) => String(r.runId)));
  checkRunner([...before, ...afterRuns]);
  const family = (file) => [file, ...(siblingsByFile[file] ?? [])];
  checkTimings(before, converted);
  checkTimings(afterRuns, converted.flatMap(family));
  const afterOf = (run, file) => family(file).reduce((a, f) => a + run.seconds[f], 0);
  // `runs`: the file's seconds in each run (its siblings' added in an after run), for the per-run sums of the page
  const rows = converted.map((file) => ({
    file,
    before: mean(before.map((r) => r.seconds[file])),
    after: mean(afterRuns.map((r) => afterOf(r, file))),
    runs: Object.fromEntries([...before.map((r) => [r.runId, r.seconds[file]]), ...afterRuns.map((r) => [r.runId, afterOf(r, file)])]),
  }));
  const total = Math.round(rows.reduce((a, r) => a + r.before, 0));
  const totalAfter = Math.round(rows.reduce((a, r) => a + r.after, 0));
  const ids = (runs) => runs.map((r) => r.runId).join(', ');
  return {
    rows,
    before: total,
    after: totalAfter,
    lower: totalAfter < total,
    headline: `converted ui-* files: ${total} s → ${totalAfter} s (runs ${ids(before)} → ${ids(afterRuns)})`,
  };
}

/** The report page: headline, the 4 linked runs with their sums, the runner, one row per converted file, the total. */
export function renderMarkdown(report, record, afterRuns) {
  const s = (n) => `${Math.round(n)} s`;
  const stem = (f) => stemOf(f).replace(/^test\//, '');
  const before = record.before;
  const runSum = (run) => report.rows.reduce((a, r) => a + r.runs[run.runId], 0);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const runLine = (run, i) => `- ${letters[i]}: [run ${run.runId}](${run.url}), ${s(runSum(run))}`;
  const [one] = before;
  const lettersOf = (from, n) => letters.slice(from, from + n).join('·');
  const lines = [
    `# ${report.headline}`,
    '',
    'From the CI timing artifacts (`test-timings-*`) of two ci.yml runs before the move onto the shared app boot and '
      + 'two after: each file\'s summed per-file duration, the mean of its runs. A file\'s after figure includes the '
      + 'sibling files its tests moved to.',
    '',
    'Before:',
    ...before.map((r, i) => runLine(r, i)),
    '',
    'After:',
    ...afterRuns.map((r, i) => runLine(r, before.length + i)),
    '',
    `Runner, all four: \`${one.runner.labels.join(', ')} / ${one.runner.image}\``,
    '',
    `| File | Before (mean of ${lettersOf(0, before.length)}) | After (mean of ${lettersOf(before.length, afterRuns.length)}) |`,
    '|---|---:|---:|',
    ...[...report.rows].sort((a, b) => b.before - a.before).map((r) => `| ${stem(r.file)} | ${s(r.before)} | ${s(r.after)} |`),
    `| Total | ${report.before} s | ${report.after} s |`,
    '',
  ];
  return lines.join('\n');
}

// ── the CLI ─────────────────────────────────────────────────────────────────
const USAGE = 'usage: ui-boot-speedup record --before A,B | report --after C,D [--write]';

function flag(args, name) {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : null;
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const usesSharedBoot = (rel) => {
  const source = readFileSync(join(ROOT, rel), 'utf8');
  return new RegExp(`^\\s*import\\s[^;]*?from\\s+['"]${SHARED_BOOT.replace(/[.\\/]/g, '\\$&')}['"]`, 'm').test(source);
};

async function readRuns(ids) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-ui-boot-speedup-'));
  try {
    const runs = [];
    for (const id of ids) runs.push(await readRun(id, { dir }));
    return runs;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function record(args) {
  const ids = parseRunIds(flag(args, '--before'));
  const listed = execFileSync('git', ['show', `${SLICE_11}:${LIST_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const rec = buildRecord(JSON.parse(listed).perTestBoot, await readRuns(ids));
  writeFileSync(join(ROOT, RECORD_FILE), `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`${RECORD_FILE}: ${rec.files.length} files, runs ${ids.join(', ')}`);
}

async function report(args) {
  const ids = parseRunIds(flag(args, '--after'));
  const rec = readJson(RECORD_FILE);
  const converted = convertedFiles(rec, readJson(LIST_FILE).perTestBoot, (f) => existsSync(join(ROOT, f)));
  const topLevel = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
  const excluded = new Set(rec.files);
  const siblings = Object.fromEntries(converted.map((f) => [f, siblingsOf(f, converted, topLevel, usesSharedBoot, excluded)]));
  const afterRuns = await readRuns(ids);
  const r = speedupReport(rec, afterRuns, converted, siblings);
  const md = renderMarkdown(r, rec, afterRuns);
  process.stdout.write(md);
  if (!r.lower) throw new SpeedupError('not-lower', `after ${r.after} s is not lower than before ${r.before} s`);
  if (args.includes('--write')) writeFileSync(join(ROOT, REPORT_FILE), md);
}

async function main(args) {
  const [command, ...rest] = args;
  const run = { record, report }[command];
  const needs = { record: '--before', report: '--after' }[command];
  if (!run || !flag(rest, needs)) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    await run(rest);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main(process.argv.slice(2));
