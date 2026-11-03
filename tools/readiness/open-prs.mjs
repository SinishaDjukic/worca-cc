// tools/readiness/open-prs.mjs — #919 slice 3: every open PR and dependabot branch, merge-checked against the dev SHA
// and the migration commit with git merge-tree (objects only: PR code is never checked out or run).
export const EXPRESS5 = /\bbump express from 4\.\S+ to 5\./i;
export const ACTIONS = Object.freeze({
  express5: 'rebase after the migration',
  dev: 'resolve the conflict with dev first',
  split: 'catch up after the freeze (runbook recipe)',
  none: 'none: merges cleanly',
});
const LIMIT = 500;

/** The one key of a target: `#N` for a PR (a fork PR's branch name can repeat another's), else the origin branch. */
export const keyOf = (t) => (t.number != null ? `#${t.number}` : t.branch);
/** A branch name as a URL path: each segment percent-encoded, parentheses too, so it cannot end a Markdown link. */
export const branchUrl = (repo, branch) => `https://github.com/${repo}/tree/${branch.split('/')
  .map((s) => encodeURIComponent(s).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`;

export function listTargets(run, { repo, remoteUrl, cwd }) {
  const r = run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', String(LIMIT), '--json', 'number,title,headRefName,headRefOid,url,isCrossRepository']);
  if (r.code !== 0) throw new Error(`gh pr list failed: ${r.stderr.trim()}`);
  const prs = JSON.parse(r.stdout);
  if (prs.length >= LIMIT) throw new Error(`gh pr list returned ${prs.length} PRs (the limit); the table would be incomplete`);
  const out = prs.map((p) => ({ kind: !p.isCrossRepository && p.headRefName.startsWith('dependabot/') ? 'dependabot PR' : 'PR', number: p.number, title: p.title,
    branch: p.headRefName, head: p.headRefOid, url: p.url, ref: `refs/readiness/pr/${p.number}`, src: `refs/pull/${p.number}/head`, fork: !!p.isCrossRepository }));
  const ls = run('git', ['ls-remote', '--heads', remoteUrl, 'refs/heads/dependabot/*'], { cwd });
  if (ls.code !== 0) throw new Error(`git ls-remote failed: ${ls.stderr.trim()}`);
  for (const line of ls.stdout.split('\n').filter(Boolean)) {
    const [head, ref] = line.split('\t'); const branch = ref.slice('refs/heads/'.length);
    if (out.some((t) => !t.fork && t.branch === branch)) continue;      // a fork PR of the same name does not hide it
    out.push({ kind: 'dependabot branch', number: null, title: branch, branch, head,
      url: branchUrl(repo, branch), ref: `refs/readiness/branch/${branch}`, src: ref, fork: false });
  }
  return out.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || (a.branch < b.branch ? -1 : 1));
}

/** One fetch for every head, into the migrated clone only. One missing head (a PR closed or a branch deleted since the
 *  listing) aborts that fetch, so it is retried per head; returns the heads that are gone, and throws when none came. */
export function fetchHeads(run, cwd, remoteUrl, targets) {
  if (!targets.length) return [];
  const fetch = (ts) => run('git', ['-C', cwd, 'fetch', '--quiet', '--no-tags', remoteUrl, ...ts.map((t) => `+${t.src}:${t.ref}`)]);
  const r = fetch(targets);
  if (r.code === 0) return [];
  const gone = targets.filter((t) => fetch([t]).code !== 0);
  if (gone.length === targets.length) throw new Error(`git fetch of ${targets.length} heads failed: ${r.stderr.trim()}`);
  return gone;
}

export function mergeCheck(run, cwd, ours, theirs) {
  const r = run('git', ['-C', cwd, 'merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs]);
  if (r.code === 0) return { conflict: false, files: [] };
  // a conflict prints the tree OID first; git also exits 1 for an unknown ref, with nothing on stdout
  if (r.code === 1 && /^[0-9a-f]{40,64}$/.test(r.stdout.split('\n')[0])) return { conflict: true, files: r.stdout.trim().split('\n').slice(1).filter(Boolean) };
  throw new Error(`git merge-tree ${ours} ${theirs}: exit ${r.code}: ${r.stderr.trim()}`);
}

export function actionFor(t, { dev, split }) {
  if (EXPRESS5.test(t.title)) return ACTIONS.express5;
  if (dev.conflict) return ACTIONS.dev;
  if (split.conflict) return ACTIONS.split;
  return ACTIONS.none;
}

/** The open-prs row passes when there is exactly one row per target (by keyOf), each with two boolean flags and one
 *  known action, and every express 5 bump reads "rebase after the migration". Returns the problems ([] = pass).
 *  Messages name a target by keyOf only: `#N` for every PR, so no fork-controlled text reaches the row detail. */
export function openPrsProblems(targets, rows) {
  const p = [];
  const known = new Set(Object.values(ACTIONS));
  if (rows.length !== targets.length) p.push(`${rows.length} rows for ${targets.length} targets`);
  for (const t of targets) if (rows.filter((r) => keyOf(r) === keyOf(t)).length !== 1) p.push(`${keyOf(t)}: not exactly one row`);
  for (const r of rows) {
    if (typeof r.dev?.conflict !== 'boolean' || typeof r.split?.conflict !== 'boolean') p.push(`${keyOf(r)}: missing a conflict flag`);
    if (!known.has(r.action)) p.push(`${keyOf(r)}: unknown action`);
    if (EXPRESS5.test(r.title) && r.action !== ACTIONS.express5) p.push(`${keyOf(r)}: express 5 bump must read "${ACTIONS.express5}"`);
  }
  return p;
}
