// test/github-source-ticket-updates.test.mjs — github-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D6, D9,
// D11, §3; plans/ticket-updates-pr2-plan.md decisions 1, 2 and 4) against a fake GitHub Issues API: the capability, the repos
// as projects, the old setting, the three statuses, the ticket's project, and (Task 5) reportResult with a move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createTaskSource, { STATUSES, statusOf } from '../plugins/github-source/connector/index.mjs';
import { fakeGithubIssues } from './helpers/fake-github-issues.mjs';

function site(o = {}) {
  const gh = fakeGithubIssues(o);
  const ctx = { apiVersion: 1, config: { token: 'tok', closeOnComplete: o.close ?? 'no' }, log: () => {},
    state: { get: async () => null, set: async () => {} } };
  return { gh, src: createTaskSource(ctx, { fetch: gh.fetch }) };
}

test('capabilities: ticketUpdates; write-back as before', () => {
  assert.deepEqual(site().src.capabilities(), { writeBack: true, incrementalSync: false, ticketUpdates: true });
});

test('listProjects: the repos, each with its name alone (D5); listRepos unchanged; the Repository input lists projects (D9)', async () => {
  const { src } = site({ repos: [{ full_name: 'Acme/API', name: 'API' }, { full_name: 'Acme/web-site', name: 'web-site' }] });
  assert.deepEqual(await src.listProjects(), [{ value: 'Acme/API', label: 'Acme/API', name: 'API' },
    { value: 'Acme/web-site', label: 'Acme/web-site', name: 'web-site' }]);
  assert.deepEqual(await src.listRepos(), [{ value: 'Acme/API', label: 'Acme/API' }, { value: 'Acme/web-site', label: 'Acme/web-site' }]);
  const manifest = JSON.parse(readFileSync(new URL('../plugins/github-source/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.taskSources[0].inputs.find((i) => i.key === 'repo').optionsFrom, 'listProjects');
});

test('legacyMove (D4): closeOnComplete yes is Any Done status, no or unset is nothing', () => {
  assert.deepEqual(site({ close: 'yes' }).src.legacyMove(), { field: 'closeOnComplete', target: { category: 'done' } });
  assert.deepEqual(site({ close: 'no' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
});

test('listStatuses (D1): open is to do, closed as completed done, closed as not planned cancelled; no request; owner/repo only', async () => {
  const { src, gh } = site();
  assert.deepEqual(await src.listStatuses({ project: 'Acme/API' }), [{ value: 'open', label: 'Open', category: 'todo' },
    { value: 'completed', label: 'Closed', category: 'done' }, { value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }]);
  assert.deepEqual(STATUSES.map((s) => s.value), ['open', 'completed', 'not_planned']);
  await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && e.message === 'a project is required');
  for (const project of ['acme', 'a/b/c', '/a', 'a/', '../x', 'a/..', 'a/.', '-a/b', 'a b/c', 'a/b?c', `${'o'.repeat(40)}/r`]) {
    await assert.rejects(src.listStatuses({ project }), (e) => e.kind === 'plugin' && e.message === 'a project is a repository: owner/repo', project);
  }
  assert.ok(await src.listStatuses({ project: `${'o'.repeat(39)}/${'r'.repeat(100)}` }), 'the longest names GitHub allows');
  assert.equal(gh.requests.length, 0, 'GitHub Issues has fixed statuses: nothing is asked');
});

test("statusOf: an issue's status; reopened is open, a close without a reason completed, a duplicate cancelled", () => {
  assert.deepEqual([{ state: 'open' }, { state: 'open', state_reason: 'reopened' }, { state: 'closed', state_reason: null },
    { state: 'closed', state_reason: 'completed' }, { state: 'closed', state_reason: 'not_planned' }, { state: 'closed', state_reason: 'duplicate' }]
    .map((i) => [statusOf(i).label, statusOf(i).category]), [['Open', 'todo'], ['Open', 'todo'], ['Closed', 'done'], ['Closed', 'done'],
    ['Closed as not planned', 'cancelled'], ['Closed as duplicate', 'cancelled']]);
});

test("getTask: meta.project is the issue's repository as GitHub names it, whatever case the id was typed in (D6)", async () => {
  const { src } = site({ issues: [{ repo: 'Acme/API', number: 7, state: 'open' }] });
  const t = await src.getTask('acme/api#7');
  assert.deepEqual(t.meta, { repo: 'acme/api', project: 'Acme/API', number: 7, labels: [], assignee: null });
});

// ---- reportResult with a move (Task 5) ----
const RESULT = { status: 'completed', summary: 'All done', links: [{ title: 'PR', url: 'https://github.com/Acme/API/pull/9' }] };
const BODY = 'All done\n\n- [PR](https://github.com/Acme/API/pull/9)\n';
/** One report against a fresh fake holding Acme/API#7 in `state` (closed with `reason`). */
async function report(move, { state = 'open', reason = null, ...more } = {}) {
  const s = site({ issues: [{ repo: 'Acme/API', number: 7, state, state_reason: reason }], ...more });
  const out = await s.src.reportResult('Acme/API#7', { ...RESULT, move });
  const i = s.gh.issue('Acme/API', 7);
  return { out, comment: i.comments.at(-1), issue: i, calls: s.gh.requests.map((r) => r.method),
    patches: s.gh.requests.filter((r) => r.method === 'PATCH').map((r) => r.body), ...s };
}

test('Any Done status: closed as completed, moved first, then one comment ending with the line', async () => {
  const r = await report({ category: 'done' });
  assert.deepEqual(r.patches, [{ state: 'closed', state_reason: 'completed' }]);
  assert.deepEqual(r.out, { commented: true, moved: { from: 'Open', to: 'Closed' }, note: 'Moved to Closed.' });
  assert.equal(r.comment, 'All done\n\n- [PR](https://github.com/Acme/API/pull/9)\n\nMoved to Closed.');
  assert.deepEqual(r.calls, ['GET', 'PATCH', 'POST']);
});

test('Any Done status leaves a closed issue as it is, never turning not planned into completed', async () => {
  for (const [reason, label] of [['completed', 'Closed'], [null, 'Closed'], ['not_planned', 'Closed as not planned'], ['duplicate', 'Closed as duplicate']]) {
    const r = await report({ category: 'done' }, { state: 'closed', reason });
    assert.deepEqual([r.out.note, r.patches.length, r.issue.state_reason], [`Already in ${label}.`, 0, reason], String(reason));
  }
});

test('a status move: closed as not planned, reopened, completed from not planned; already there; a value GitHub has not', async () => {
  const np = await report({ status: 'not_planned', name: 'Closed as not planned' });
  assert.deepEqual([np.patches, np.out.note], [[{ state: 'closed', state_reason: 'not_planned' }], 'Moved to Closed as not planned.']);
  const reopen = await report({ status: 'open', name: 'Open' }, { state: 'closed', reason: 'completed' });
  assert.deepEqual([reopen.patches, reopen.out.moved], [[{ state: 'open' }], { from: 'Closed', to: 'Open' }]);
  const fix = await report({ status: 'completed', name: 'Closed' }, { state: 'closed', reason: 'not_planned' });
  assert.deepEqual([fix.patches, fix.out.note], [[{ state: 'closed', state_reason: 'completed' }], 'Moved to Closed.']);
  assert.equal((await report({ status: 'open', name: 'Open' })).out.note, 'Already in Open.');
  const odd = await report({ status: 'wontfix', name: "Won't fix" });
  assert.deepEqual([odd.patches.length, odd.out.note], [0, "Not moved: Acme/API has no status named Won't fix any more."]);
});

test("a 4xx refusal of the move is a line with GitHub's reason and the comment is posted; 401, rate limits and 5xx throw", async () => {
  const r = await report({ category: 'done' }, { refusePatch: { status: 403, body: { message: 'Must have push access to close this issue.' } } });
  assert.deepEqual([r.out.moved, r.out.note], [null, 'Not moved: GitHub refused the move to Closed: Must have push access to close this issue.']);
  assert.equal(r.comment.split('\n').at(-1), r.out.note);
  assert.equal((await report({ category: 'done' }, { refusePatch: { status: 422, body: {} } })).out.note,
    'Not moved: GitHub refused the move to Closed: GitHub gave no reason.');
  for (const [refusal, kind] of [[{ status: 401, body: { message: 'Bad credentials' } }, 'auth'], [{ status: 429, body: {} }, 'plugin'],
    [{ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } }, 'rate-limit'],
    [{ status: 403, body: { message: 'You have exceeded a secondary rate limit.' } }, 'plugin'], [{ status: 502, body: {} }, 'plugin']]) {
    const s = site({ issues: [{ repo: 'Acme/API', number: 7, state: 'open' }], refusePatch: refusal });
    await assert.rejects(s.src.reportResult('Acme/API#7', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === kind, JSON.stringify(refusal));
    assert.deepEqual(s.gh.issue('Acme/API', 7).comments, [], `${refusal.status}: no comment, so the write-back fails and can be retried`);
  }
});

test("Don't move: no read, no move, no line; a run that did not finish passes none and only comments", async () => {
  const r = await report({ none: true });
  assert.deepEqual([r.calls, r.out, r.comment], [['POST'], { commented: true, moved: null, note: '' }, BODY]);
});

test('without a move: exactly the old behaviour (comment first, then closeOnComplete)', async () => {
  const s = site({ close: 'yes', issues: [{ repo: 'Acme/API', number: 7, state: 'open' }] });
  assert.equal(await s.src.reportResult('Acme/API#7', RESULT), undefined);
  assert.deepEqual(s.gh.requests.map((r) => r.method), ['POST', 'PATCH']);
  assert.deepEqual([s.gh.issue('Acme/API', 7).comments, s.gh.issue('Acme/API', 7).state], [[BODY], 'closed']);
});
