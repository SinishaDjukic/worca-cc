// test/helpers/history-shipit-fixtures.mjs — the saved run, its detail, the GET /api/pr/remotes answer and the History
// route table of the "Ship it?" suites (test/ui-history-shipit.test.mjs and its sibling
// test/ui-history-shipit-slice-breadcrumb.test.mjs, which need different load-time state; see
// test/helpers/shared-app-boot.mjs, C5). One copy, imported by both.
//
// ROW and DETAIL are live objects: a suite may give them its own run id per test (ROW.id, DETAIL.state.id), so
// historyArms() reads the detail addresses through `detailUrls` at call time.

export const PROJECT = '/tmp/proj';

export async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

export function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

export const KEY = 'proj-alpha-abcd1234';
export const WKS_KEY = 'workspaces/team-a';
export const ROW = {
  id: 'fcec04e8', projectKey: KEY, projectName: 'Alpha', projectDir: '/tmp/proj',
  title: 'Implement Log-UX Review Fixes', status: 'done',
  startedAt: '2026-08-17T20:54:42Z', branch: 'worca-cc/log-ux-fcec04e8',
  sourceBranch: 'feat/log-ux', survived: true, added: 12, removed: 3,
  totalCostUsd: 153.21, totalActiveMs: 6000000, mtime: 1,
  pauseReason: null, retainedWork: null, pr: null,     // resolved: no PR yet
};
// Fresh object per boot: a successful ship MUTATES the row it is handed
// (`record.pr = pr`, and the record IS the object in state.historyAll), so a
// shared const would hand the next test a run that already has an open PR.
export const row = (over = {}) => ({ ...ROW, ...over });
export const DETAIL = {
  state: {
    id: ROW.id, title: ROW.title, status: 'done', startedAt: ROW.startedAt,
    stepper: null, steps: [], subAgents: [], totalCostUsd: 153.21, totalActiveMs: 6000000,
    branch: { source: 'feat/log-ux', feature: ROW.branch, worktreeDir: '/tmp/wt' },
    prompt: 'Fix the log UX.',
  },
  results: null, overview: null, clarify: { questions: [], answers: [] },
  reviews: [], stepQuestions: [], artifacts: [], auditMarkdown: '# saved',
};
export const RESULTS = {
  summary: {
    filesNew: 1, filesChanged: 13, filesDeleted: 0,
    linesAdded: 412, linesRemoved: 188, blockingIssues: 0, nitpicks: 0,
  },
  newFiles: [], changedFiles: [], keyThingsToCheck: [], nitpicks: [],
};

export const DAY = 86400000;
export const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});

export const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
export const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

// Shapes mirror GET /api/pr/remotes.
export const remote = (name, owner, url) => ({ name, fetchUrl: url, pushUrl: url, host: 'github.com', owner, repo: 'repo', slug: `${owner}/repo` });
// A run outside a chain: `chain` is just its source; `branches` are each remote's
// remote-tracking branches (the server drops HEAD and the run's own branch only).
export const REMOTES = { ok: true, remotes: [remote('origin', 'me', 'https://github.com/me/repo.git')],
  defaults: { pushRemote: 'origin', baseRemote: 'origin' }, remembered: null,
  chain: ['feat/log-ux'], defaultBase: 'feat/log-ux', branches: { origin: ['feat/log-ux', 'main'] } };

// ARM ORDER IS LOAD-BEARING (ui-history-routing.test.mjs:119-127): the detail URL
// is a PREFIX of the /log and /diff URLs, and `/api/history` is a prefix of the
// POST /api/history/pr enrichment call. Most-specific first, and every history arm
// matches with endsWith, never includes — except the remotes arm, whose URL carries
// a query string (it can never collide with the `/api/pr` endsWith matchers).
// `detailUrls()` lists the addresses that answer `box.detail` (read per request).
export function historyArms(box, detailUrls = () => [`/api/history/${KEY}/${ROW.id}`]) {
  return (url) => {
    if (/\/api\/pr\/remotes\?/.test(url)) return box.remotes ? ok(box.remotes) : fail(500, { error: 'git remote failed' });
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return fail(404, { error: 'no diff' });
    if (url.endsWith('/log')) return fail(404, { error: 'no log' });
    if (url.endsWith('/api/history')) return ok({ pipelines: box.rows, ghAvailable: box.gh, ...(box.prHosts ? { prHosts: box.prHosts } : {}) });
    if (detailUrls().some((d) => url.endsWith(d))) return ok(box.detail);
    if (url.endsWith('/api/budget')) return ok(box.budget);
    return null;
  };
}

// The run groups GET /api/run-groups answers, and the hello that makes the app read them.
export const groupsArm = (groups) => (url) => (url.startsWith('/api/run-groups') ? ok(groups) : null);
export const hello = (ctx) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
