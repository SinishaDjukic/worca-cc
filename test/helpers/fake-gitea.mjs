// test/helpers/fake-gitea.mjs — canned Gitea 28 and Forgejo 17 (Codeberg) bodies, trimmed from real captures to the
// fields pr/gitea-family.mjs reads (test/fixtures/gitea-family.json), and a fake fetch that routes one repository's
// API by path. Nothing here reaches a host.
import { readFileSync } from 'node:fs';

export const FIX = JSON.parse(readFileSync(new URL('../fixtures/gitea-family.json', import.meta.url), 'utf8'));
export const res = (status, body, { text = null } = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: () => null }, json: async () => body, text: async () => (text ?? JSON.stringify(body)) });

export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    for (const r of routes) if (r.match.test(u) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(u, init) : r.reply;
    throw new Error(`unrouted ${init.method || 'GET'} ${u}`);
  };
  fn.calls = calls;
  return fn;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every read the module makes on one repository, answered from the fixtures of `flavour` (each overridable):
 * `pr` the PR behind /pulls/<n>, `list` the listing, `statuses` by sha ({ [sha]: rows }, default: the PR's head),
 * `reviews`, `reviewComments` by review id, `issueComments`, `runs`, `jobs` by run id, `jobDetail` by job id,
 * `jobLog` by job id, `byBranches` the /pulls/{base}/{head} answer (default 404), `compare` total_commits.
 * The listing's second page is empty. Specific paths come before the by-branches catch-all.
 */
export function routesFor(flavour, api, o = {}) {
  const F = FIX[flavour];
  const pr = o.pr ?? F.prOpen;
  const n = pr.number;
  const A = esc(api);
  // The captured status links point at the repository they were captured on (Gitea as a path, Forgejo as a URL); a
  // test's host and slug take their place (runOf keys a check on the run in a link that is on THIS repository).
  const [, host, owner, repo] = /^https:\/\/([^/]+)\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(api);
  const here = (rows) => rows.map((s) => ({ ...s, target_url: typeof s.target_url === 'string' && s.target_url.includes('/actions/runs/')
    ? s.target_url.replace(/^(?:https:\/\/[^/]+)?\/[^/]+\/[^/]+\//, (m) => (m.startsWith('https://') ? `https://${host}/${owner}/${repo}/` : `/${owner}/${repo}/`)) : s.target_url }));
  const statuses = Object.fromEntries(Object.entries(o.statuses ?? { [pr.head.sha]: F.statuses }).map(([sha, rows]) => [sha, here(rows)]));
  const reviews = o.reviews ?? F.reviews;
  const rc = o.reviewComments ?? { [F.reviews[0].id]: F.reviewComments };
  const runs = o.runs ?? F.runs;
  const failedId = F.failedRun.id;
  const jobs = o.jobs ?? { [failedId]: flavour === 'gitea' ? { total_count: F.failedRunJobs.length, jobs: F.failedRunJobs } : F.failedRunJobs };
  const jobDetail = o.jobDetail ?? (F.failedJobDetail ? { [F.failedJobDetail.id]: F.failedJobDetail } : {});
  const jobLog = o.jobLog ?? { [F.failedRunJobs[0].id]: F.jobLog };
  const page = (u) => Number(new URL(u).searchParams.get('page') || 1);
  const paged = (rows) => (u) => res(200, page(u) > 1 ? [] : rows);
  return [
    { match: new RegExp(`^${A}/pulls/${n}$`), reply: res(200, pr) },
    // (every route below answers GET only, see the map at the end)
    { match: new RegExp(`^${A}/pulls/${n}/reviews\\?`), reply: paged(reviews) },
    { match: new RegExp(`^${A}/pulls/${n}/reviews/(\\d+)/comments$`), reply: (u) => res(200, rc[/reviews\/(\d+)\/comments$/.exec(u)[1]] || []) },
    { match: new RegExp(`^${A}/issues/${n}/comments\\?`), reply: paged(o.issueComments ?? F.issueComments) },
    { match: new RegExp(`^${A}/commits/([0-9a-f]+)/statuses\\?`), reply: (u) => { const sha = /commits\/([0-9a-f]+)\/statuses/.exec(u)[1]; return page(u) > 1 ? res(200, []) : res(200, statuses[sha] || []); } },
    { match: new RegExp(`^${A}/compare/`), reply: res(200, { total_commits: o.compare ?? 2 }) },
    { match: new RegExp(`^${A}/actions/runs\\?`), reply: (u) => res(200, { total_count: runs.length, workflow_runs: page(u) > 1 ? [] : runs }) },
    { match: new RegExp(`^${A}/actions/runs/(\\d+)/jobs$`), reply: (u) => { const j = jobs[/runs\/(\d+)\/jobs$/.exec(u)[1]]; return j ? res(200, j) : res(404, { message: 'not found' }); } },
    { match: new RegExp(`^${A}/actions/jobs/(\\d+)$`), reply: (u) => { const d = jobDetail[/jobs\/(\d+)$/.exec(u)[1]]; return d ? res(200, d) : res(404, { message: 'not found' }); } },
    { match: new RegExp(`^${A}/actions/jobs/(\\d+)/logs$`), reply: (u) => { const t = jobLog[/jobs\/(\d+)\/logs$/.exec(u)[1]]; return t != null ? res(200, null, { text: t }) : res(404, { message: 'job has not been executed yet' }); } },
    { match: new RegExp(`^${A}/git/commits/`), reply: res(200, { commit: { committer: { date: '2026-11-11T10:00:31Z' } } }) },
    { match: new RegExp(`^${A}/pulls\\?`), reply: paged(o.list ?? F.prList) },
    { match: new RegExp(`^${A}/pulls/[^/?]+/[^?]+$`), reply: o.byBranches === undefined ? res(404, { message: 'not found' }) : res(200, o.byBranches) },
  ].map((r) => ({ ...r, method: 'GET' }));
}
