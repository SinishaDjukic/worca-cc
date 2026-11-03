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
