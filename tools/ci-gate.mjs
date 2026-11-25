// tools/ci-gate.mjs — the verdict of ci.yml's `CI gate` job.
//
// The gate runs on every run (`if: always()`), cancelled ones too, because a job skipped by its
// `if` reads as Success to a required check. A covered job that returns `failure` or `cancelled`
// fails the gate; `success` and `skipped` (a docs-only PR) pass it. A run superseded by a newer
// push to the same PR is headed "superseded" in the summary but still exits 1: a green gate on the
// old SHA would satisfy the required check if that SHA became the PR head again before its own run
// reported. The red mark sits only on a SHA that is no longer the head. Only `node:` builtins: the
// gate job runs no `npm ci`.
//
//   NEEDS        ${{ toJSON(needs) }}  — { [jobId]: { result, outputs } }
//   EVENT_NAME   ${{ github.event_name }}
//   RUN_SHA      the head SHA this run tested
//   PR_HEAD_SHA  the PR's head SHA read from the API when the gate runs (empty when the lookup failed)
//
// Exit 0 when the gate passes, 1 when it fails or the run was superseded, 2 when NEEDS is missing or not JSON.
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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

export function renderSummary(verdict, { prHeadSha } = {}) {
  let heading = 'CI gate: passed';
  if (!verdict.ok) heading = 'CI gate: failed';
  else if (verdict.superseded) heading = `CI gate: superseded by ${String(prHeadSha ?? '').slice(0, 7)} (no verdict)`;
  const lines = [heading, '', '| Job | Result |', '|---|---|', ...verdict.rows.map((r) => `| ${r.job} | ${r.result} |`)];
  return lines.join('\n') + '\n';
}

function main() {
  const { NEEDS, EVENT_NAME, RUN_SHA, PR_HEAD_SHA, GITHUB_STEP_SUMMARY } = process.env;
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
  const summary = renderSummary(verdict, { prHeadSha: PR_HEAD_SHA });
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);
  return verdict.ok && !verdict.superseded ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
