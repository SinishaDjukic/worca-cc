#!/usr/bin/env node
// tools/timings-refresh.mjs — the logic behind .github/workflows/refresh-test-timings.yml ("Refresh test timings"),
// kept out of shell so it is unit-tested (test/timings-refresh.test.mjs). Subcommands:
//   check-secrets                                  refuse (exit 1) when a TIMINGS_APP_* secret is empty
//   pick --dir D                                   download the newest green dev push run of ci.yml that still has
//                                                  every timing artifact into D, and write D/../source-run.json
//   push                                           force-push HEAD to the one timings-refresh branch; on a Workflows
//                                                  refusal, close our open PR, delete the branch and push it afresh
//   body --source F --before F --after F --out F   write the PR body
// Exit codes: 0 ok, 1 a refusal with a message, 2 a usage or `gh` error.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tierFiles } from './test.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const TIMINGS_BRANCH = 'timings-refresh';
export const PR_TITLE = 'Refresh test timings';
export const SPREAD_TARGET_S = 120;
export const SECRETS_MESSAGE = 'Refresh test timings needs the GitHub App secrets: see the CI gate admin checklist step 2';
const SECRETS = ['TIMINGS_APP_ID', 'TIMINGS_APP_PRIVATE_KEY'];
const RUNS_LOOKED_AT = 30;
const RUNS_SINCE_MERGE_LOOKED_AT = 200;
const RECOVERY_HINT = `close the open "${PR_TITLE}" PR and delete the ${TIMINGS_BRANCH} branch; the next run opens a fresh one`;
const WORKFLOWS_REFUSAL = 'refusing to allow a GitHub App to create or update workflow';

/** Both App secrets set (not only whitespace), or the refusal naming the missing one(s). */
export function checkSecrets(env) {
  const missing = SECRETS.filter((k) => !String(env[k] ?? '').trim());
  if (!missing.length) return { ok: true };
  return { ok: false, missing, message: `${SECRETS_MESSAGE} (docs/required-checks.md, "2. Set up the timings PR identity"): missing ${missing.join(' and ')}` };
}

/** The timing artifact names ci.yml uploads: one per test-fast shard, then one per test-slow shard. */
export function expectedTimingArtifacts(ciDoc) {
  const shards = (id) => ciDoc?.jobs?.[id]?.strategy?.matrix?.shard;
  const fast = shards('test-fast'), slow = shards('test-slow');
  if (!Array.isArray(fast) || !Array.isArray(slow)) throw new Error('ci.yml has no test-fast/test-slow shard matrix');
  return [...fast.map((s) => `test-timings-fast-${s}`), ...slow.map((s) => `test-timings-slow-${s}`)];
}

const greenDevPush = (r) => r.event === 'push' && r.headBranch === 'dev' && r.status === 'completed' && r.conclusion === 'success';

/** The newest green dev push run (runs are newest first) whose unexpired artifacts include every expected name, or null. */
export async function pickTimingsRun(runs, artifactsOf, expected) {
  for (const run of runs) {
    if (!greenDevPush(run)) continue;
    const have = new Set((await artifactsOf(run.databaseId)).filter((a) => !a.expired).map((a) => a.name));
    if (expected.every((n) => have.has(n))) return run;
  }
  return null;
}

/** The oldest green dev push run created at or after `mergedAt` (the previous refresh PR's merge), or null. */
export function postMergeRun(runs, mergedAt) {
  if (!mergedAt) return null;
  const since = Date.parse(mergedAt);
  const after = runs.filter((r) => greenDevPush(r) && Date.parse(r.createdAt) >= since);
  return after.length ? after.reduce((a, b) => (Date.parse(b.createdAt) < Date.parse(a.createdAt) ? b : a)) : null;
}

/** The Node 24 fast shards' spread: the last shard's end minus the first one's, or null when fewer than `shards` completed. */
export function shardSpread(jobs, shards) {
  const done = jobs.filter((j) => /^fast tests \(Node 24, \d+\/\d+\)$/.test(j.name) && j.conclusion && j.completed_at)
    .map((j) => ({ name: j.name, end: Date.parse(j.completed_at) }));
  if (done.length < shards) return null;
  const slowest = done.reduce((a, b) => (b.end > a.end ? b : a));
  const fastest = done.reduce((a, b) => (b.end < a.end ? b : a));
  return { spreadS: Math.round((slowest.end - fastest.end) / 1000), slowest: slowest.name, fastest: fastest.name };
}

/** How many keys the merge added, removed and re-timed (in both maps with a different value). */
export function diffTimings(before, after) {
  const keys = (m) => Object.keys(m);
  return {
    added: keys(after).filter((k) => !(k in before)).length,
    removed: keys(before).filter((k) => !(k in after)).length,
    retimed: keys(after).filter((k) => k in before && before[k] !== after[k]).length,
  };
}

/** git's own stderr, the Workflows cause when git says so, and the recovery hint. */
export function pushFailureMessage(stderr) {
  const cause = stderr.includes(WORKFLOWS_REFUSAL)
    ? '\nCause: dev changed a .github/workflows file since this branch\'s previous base, and the timings App has no Workflows permission (docs/required-checks.md step 2).'
    : '';
  return `git push to ${TIMINGS_BRANCH} failed:\n${stderr}${cause}\nTo recover: ${RECOVERY_HINT}`;
}

const runLink = (run) => `[ci.yml run ${run.id ?? run.databaseId}](${run.url})`;

/** The jq filter that keeps only same-repo PRs (a fork can open a PR from a branch of the same name). */
export const SAME_REPO_PR = '[.[] | select(.isCrossRepository | not)][0].number // empty';

/**
 * The refresh PR's description. `postMerge` is null when no refresh PR has merged yet, else `{ mergedAt, run, spread }`;
 * `run` is null when no green dev push run followed the merge, or when more runs followed than were listed (`truncated`).
 */
export function prBody({ run, diff, untimed, postMerge }) {
  let check;
  if (!postMerge) check = 'no refresh PR merged yet';
  else if (postMerge.truncated) check = `not measured (more than ${RUNS_SINCE_MERGE_LOOKED_AT} green dev push runs since the refresh merged on ${postMerge.mergedAt})`;
  else if (!postMerge.run) check = `no green dev push run since the refresh merged on ${postMerge.mergedAt}`;
  else if (!postMerge.spread) check = `${runLink(postMerge.run)}, fast-shard spread: not measured (the run's jobs were not readable)`;
  else {
    const s = postMerge.spread.spreadS;
    check = `${runLink(postMerge.run)}, fast-shard spread ${s} s against the 2 min target (${SPREAD_TARGET_S} s)`
      + (s > SPREAD_TARGET_S ? `: over the 2 min target` : '');
  }
  return [
    `Refreshes \`test/timings.json\` from the newest green \`dev\` push run of \`ci.yml\` that has every timing artifact.`,
    '',
    `- Source run: ${runLink(run)} at \`${run.headSha}\``,
    `- Entries: ${diff.added} added, ${diff.removed} removed, ${diff.retimed} re-timed`,
    `- untimed after merge: ${untimed}`,
    `- Post-merge check (the first green dev push run after the previous refresh PR merged): ${check}`,
    '',
    'This branch is rebuilt from dev each week; do not push to it.',
    '',
  ].join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

class GhError extends Error {}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new GhError(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}
const jsonLines = (out) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A workflow command's data is one line: escape it the way the runner reads it back.
const annotate = (kind, message) => `::${kind}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`;

function flags(argv, names) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    if (!names.includes(name) || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    o[name] = argv[i + 1];
  }
  for (const n of names) if (!o[n]) throw new Error(`--${n} is required`);
  return o;
}

async function pick(dir) {
  const { default: YAML } = await import('yaml');
  const expected = expectedTimingArtifacts(YAML.parse(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')));
  const listRuns = (limit, extra = []) => JSON.parse(gh(['run', 'list', '-w', 'ci.yml', '-b', 'dev', '-e', 'push', '-s', 'success', '-L', String(limit),
    ...extra, '--json', 'databaseId,headSha,url,event,headBranch,status,conclusion,createdAt']));
  const runs = listRuns(RUNS_LOOKED_AT);
  const run = await pickTimingsRun(runs, async (id) => jsonLines(gh(['api', '--paginate',
    `repos/{owner}/{repo}/actions/runs/${id}/artifacts?per_page=100`, '--jq', '.artifacts[]'])), expected);
  if (!run) {
    console.error(annotate('error', `no green dev push run among the last ${RUNS_LOOKED_AT} has every timing artifact (${expected.join(', ')})`));
    return 1;
  }
  gh(['run', 'download', String(run.databaseId), '--pattern', 'test-timings-*', '--dir', dir]);
  const [merged] = JSON.parse(gh(['pr', 'list', '--head', TIMINGS_BRANCH, '--base', 'dev', '--state', 'merged', '-L', '1', '--json', 'mergedAt']) || '[]');
  const mergedAt = merged?.mergedAt ?? null;
  let postMerge = null;
  if (mergedAt) {
    // Every run since the merge, not the 30 above: a busy week pushes more than 30 times to dev.
    const since = listRuns(RUNS_SINCE_MERGE_LOOKED_AT, ['--created', `>=${mergedAt}`]);
    postMerge = since.length >= RUNS_SINCE_MERGE_LOOKED_AT ? { mergedAt, run: null, truncated: true } : { mergedAt, run: postMergeRun(since, mergedAt) };
  }
  const after = postMerge?.run;
  if (after) {
    let spread = null;
    try {
      const jobs = jsonLines(gh(['api', '--paginate', `repos/{owner}/{repo}/actions/runs/${after.databaseId}/jobs?per_page=100`, '--jq', '.jobs[]']));
      spread = shardSpread(jobs, expected.filter((n) => n.startsWith('test-timings-fast-')).length);
    } catch (e) { if (!(e instanceof GhError)) throw e; /* unreadable jobs: the body says "not measured" */ }
    postMerge.spread = spread;
  }
  const source = { id: run.databaseId, url: run.url, headSha: run.headSha, postMerge };
  const sourceFile = join(dirname(resolve(dir)), 'source-run.json');
  mkdirSync(dirname(sourceFile), { recursive: true });
  writeFileSync(sourceFile, JSON.stringify(source, null, 1) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${run.databaseId}\nurl=${run.url}\n`);
  console.log(`source: ${runLink(source)} (${run.headSha})`);
  return 0;
}

function gitPush(force) {
  const r = spawnSync('git', ['push', ...(force ? ['--force'] : []), 'origin', `HEAD:refs/heads/${TIMINGS_BRANCH}`], { encoding: 'utf8' });
  if (r.error) throw new Error(`git: ${r.error.message}`);
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.status === 0 ? r.stderr || '' : '');
  return { ok: r.status === 0, stderr: (r.stderr || '').trimEnd() };
}

/**
 * Force-push HEAD to the branch. When GitHub refuses it because dev changed a workflow file (the App has no Workflows
 * permission), close our open refresh PR, delete the branch and push it again as a new ref; the PR step then opens a
 * fresh PR (plan open question 2, its third choice).
 */
function push() {
  let r = gitPush(true);
  if (!r.ok && r.stderr.includes(WORKFLOWS_REFUSAL)) {
    console.log(`the push was refused for a workflow change on dev: replacing the ${TIMINGS_BRANCH} branch and its PR`);
    const pr = gh(['pr', 'list', '--head', TIMINGS_BRANCH, '--base', 'dev', '--state', 'open', '--json', 'number,isCrossRepository', '-q', SAME_REPO_PR]).trim();
    if (pr) gh(['pr', 'close', pr, '--comment', `dev changed a workflow file, so GitHub refused to update ${TIMINGS_BRANCH}; a fresh "${PR_TITLE}" PR replaces this one.`]);
    gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${TIMINGS_BRANCH}`]);
    r = gitPush(false);
  }
  if (r.ok) return 0;
  console.error(annotate('error', pushFailureMessage(r.stderr)));
  return 1;
}

function body(o) {
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const source = read(o.source), after = read(o.after);
  const tier = [...tierFiles(ROOT, 'fast').files, ...tierFiles(ROOT, 'slow').files];
  const untimed = tier.filter((f) => !(f in after)).length;
  writeFileSync(o.out, prBody({ run: source, diff: diffTimings(read(o.before), after), untimed, postMerge: source.postMerge }));
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'check-secrets') {
      const r = checkSecrets(process.env);
      if (r.ok) return 0;
      console.error(annotate('error', r.message));
      return 1;
    }
    if (cmd === 'pick') return await pick(flags(rest, ['dir']).dir);
    if (cmd === 'push') return push();
    if (cmd === 'body') return body(flags(rest, ['source', 'before', 'after', 'out']));
    console.error('usage: timings-refresh <check-secrets | pick --dir D | push | body --source F --before F --after F --out F>');
    return 2;
  } catch (e) {
    console.error(annotate('error', e.message));
    return 2;
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) process.exitCode = await main(process.argv.slice(2));
