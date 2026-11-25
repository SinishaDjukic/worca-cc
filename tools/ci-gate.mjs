// tools/ci-gate.mjs — the verdict of ci.yml's `CI gate` job.
//
// The gate runs on every run (`if: always()`), cancelled ones too, because a job skipped by its
// `if` reads as Success to a required check. A covered job that returns `failure` or `cancelled`
// fails the gate; `success` and `skipped` (a docs-only PR) pass it. A run superseded by a newer
// push to the same PR is headed "superseded" in the summary but still exits 1: a green gate on the
// old SHA would satisfy the required check if that SHA became the PR head again before its own run
// reported. The red mark sits only on a SHA that is no longer the head. A failed gate also names
// each failing fast or slow shard and test file (the failure records tools/test.mjs --failures-out
// writes), marking the files on the base branch's quarantine list. Only `node:` builtins plus
// ./quarantine.mjs (itself `node:` only): the gate job runs no `npm ci`.
//
//   NEEDS                 ${{ toJSON(needs) }}  — { [jobId]: { result, outputs } }
//   EVENT_NAME            ${{ github.event_name }}
//   RUN_SHA               the head SHA this run tested
//   PR_HEAD_SHA           the PR's head SHA read from the API when the gate runs (empty when the lookup failed)
//   FAILURES_DIR          this attempt's downloaded failure records (optional; missing or garbage names nothing)
//   BASE_QUARANTINE_ROOT  a folder holding the base branch's test/quarantine.json (optional; unreadable marks nothing)
//
// Exit 0 when the gate passes, 1 when it fails or the run was superseded, 2 when NEEDS is missing or not JSON.
// The failing-test lines never change the exit code.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { quarantinedPaths, readQuarantine } from './quarantine.mjs';

const SHA = /^[0-9a-f]{40}$/;

// A run is superseded only when it is a PR run and the PR's live head is a different, well-formed
// SHA. An unknown head (a failed lookup) never excuses a cancel.
export function isSuperseded({ event, runSha, prHeadSha }) {
  return event === 'pull_request' && SHA.test(String(prHeadSha ?? '')) && prHeadSha !== runSha;
}

export function gateVerdict(needs, { superseded = false } = {}) {
  const ids = Object.keys(needs || {}).sort();
  if (ids.length === 0) return { ok: false, superseded: false, rows: [{ job: '(none)', result: 'no jobs', verdict: 'fail' }] };
  let excused = false;
  const rows = ids.map((job) => {
    const result = needs[job]?.result;
    let verdict = 'fail';
    if (result === 'success' || result === 'skipped') verdict = 'pass';
    else if (result === 'cancelled' && superseded) { verdict = 'pass'; excused = true; }
    return { job, result: result == null ? 'missing' : String(result), verdict };
  });
  const ok = rows.every((r) => r.verdict === 'pass');
  return { ok, superseded: ok && excused, rows };
}

const TIERS = ['fast', 'slow', 'all'];
const SHARD = /^\d+\/\d+$/;
const isRecord = (r) => r?.version === 1 && TIERS.includes(r.tier) && typeof r.shard === 'string' && SHARD.test(r.shard)
  && typeof r.node === 'string' && Array.isArray(r.files) && r.files.every((f) => typeof f === 'string');

/** Every failure record (*.json) in DIR and its direct subfolders (download-artifact puts each artifact in its own
 *  folder). `unreadable` names each file that is not JSON or not a record. A missing dir has none. */
export function readFailureRecords(dir) {
  const records = [], unreadable = [];
  const list = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  const names = [];
  for (const e of list(dir)) {
    if (e.isDirectory()) for (const f of list(join(dir, e.name))) { if (f.isFile() && f.name.endsWith('.json')) names.push(join(e.name, f.name)); }
    else if (e.isFile() && e.name.endsWith('.json')) names.push(e.name);
  }
  for (const name of names.sort()) {
    let r;
    try { r = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { r = null; }
    if (isRecord(r)) records.push(r); else unreadable.push(name);
  }
  return { records, unreadable };
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nodeParts = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
const compareNode = (a, b) => {
  const x = nodeParts(a), y = nodeParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const shardParts = (s) => s.split('/').map(Number);
const NO_FILE = 'no failing test file recorded (see the job log)';

/** The gate summary's failing-test lines, in job order: tier (fast, slow, all), then Node version, then shard index.
 *  A test job that failed with no record of its tier gets one job-level line. */
export function failureLines(records, { quarantined = new Set(), needs = {} } = {}) {
  const sorted = [...records].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || compareNode(a.node, b.node)
    || shardParts(a.shard)[0] - shardParts(b.shard)[0] || shardParts(a.shard)[1] - shardParts(b.shard)[1]);
  const out = [];
  for (const r of sorted) {
    const label = `${r.tier} (Node ${r.node.split('.')[0]}, shard ${r.shard})`;
    if (!r.files.length) { out.push(`${label}: failed, ${NO_FILE}`); continue; }
    for (const f of [...new Set(r.files)].sort(byCodeUnit)) out.push(`${label}: \`${f}\` failed${quarantined.has(f) ? ' (quarantined)' : ''}`);
  }
  for (const [job, tier] of [['test-fast', 'fast'], ['test-slow', 'slow']])
    if (needs[job]?.result === 'failure' && !records.some((r) => r.tier === tier)) out.push(`${job}: failure, ${NO_FILE}`);
  return out;
}

/** The test-file paths on ROOT's test/quarantine.json (a missing list is empty; an invalid one throws). */
export function quarantinedTests(root) {
  return quarantinedPaths(readQuarantine(root), 'test');
}

export function renderSummary(verdict, { prHeadSha, lines = [] } = {}) {
  let heading = 'CI gate: passed';
  if (!verdict.ok) heading = 'CI gate: failed';
  else if (verdict.superseded) heading = `CI gate: superseded by ${String(prHeadSha ?? '').slice(0, 7)} (no verdict)`;
  const failing = !verdict.ok && lines.length ? ['### Failing tests', '', ...lines.map((l) => `- ${l}`), ''] : [];
  const out = [heading, '', ...failing, '| Job | Result |', '|---|---|', ...verdict.rows.map((r) => `| ${r.job} | ${r.result} |`)];
  return out.join('\n') + '\n';
}

/** The failing-test lines for a failed gate; anything unreadable is one stderr note and never fails the step. */
function summaryLines(needs, { failuresDir, quarantineRoot }) {
  let records = [];
  if (failuresDir) {
    const got = readFailureRecords(failuresDir);
    records = got.records;
    for (const name of got.unreadable) process.stderr.write(`ci-gate: ${join(failuresDir, name)} is not a failure record; skipped\n`);
  }
  let quarantined = new Set();
  if (quarantineRoot) {
    try { quarantined = quarantinedTests(quarantineRoot); } catch (e) {
      process.stderr.write(`ci-gate: the base quarantine list is unreadable (${e.message}); nothing is marked quarantined\n`);
    }
  }
  return failureLines(records, { quarantined, needs });
}

function main() {
  const { NEEDS, EVENT_NAME, RUN_SHA, PR_HEAD_SHA, GITHUB_STEP_SUMMARY, FAILURES_DIR, BASE_QUARANTINE_ROOT } = process.env;
  let needs;
  try {
    needs = JSON.parse(NEEDS);
    if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('not an object');
  } catch {
    process.stderr.write('ci-gate: NEEDS is not set or not JSON; set NEEDS: ${{ toJSON(needs) }}\n');
    return 2;
  }
  const superseded = isSuperseded({ event: EVENT_NAME, runSha: RUN_SHA, prHeadSha: PR_HEAD_SHA });
  const verdict = gateVerdict(needs, { superseded });
  const lines = verdict.ok ? [] : summaryLines(needs, { failuresDir: FAILURES_DIR, quarantineRoot: BASE_QUARANTINE_ROOT });
  const summary = renderSummary(verdict, { prHeadSha: PR_HEAD_SHA, lines });
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);
  return verdict.ok && !verdict.superseded ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
