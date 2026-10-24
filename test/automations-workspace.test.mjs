// test/automations-workspace.test.mjs — workspace Git event automations: a workspace rule watches every member's
// repository, answers an issue with a WORKSPACE run (a PR's review stays in its member's project), wins over a
// member project's rules for the same event, opens one draft PR per changed member, and owns an Azure DevOps
// project's work items once. The engine runs against an in-memory host and run launcher (automations.test.mjs's).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import {
  validateRule, normalizeLimits, createRule, listRules, getRule, setAutoHandle, autoHandleState, pollTargets, listEvents, getEvent,
  issueEvent, prEvent, subjectFor, memberForEvent, fixComment, buildTask, createAutomationEngine,
  DEFAULT_WORKSPACE_LIMITS, workspaceOwnerKey, limitsError,
} from '../src/core/automations.mjs';
import { azureWebhookItems } from '../src/core/automation-azure.mjs';

useTempHome(after, 'automations-ws-');

const T0 = Date.parse('2026-10-22T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const WS = 'wks-shop-0123abcd';
const WSKEY = workspaceOwnerKey(WS);
const MEMBERS = [
  { name: 'api', repo: 'o/api', projectDir: '/ws/api', projectKey: 'api-11111111' },
  { name: 'web', repo: 'o/web', projectDir: '/ws/web', projectKey: 'web-22222222' },
  { name: 'docs', repo: null, projectDir: '/ws/docs', projectKey: 'docs-33333333' },
];

beforeEach(() => {
  getDb().exec('DELETE FROM automation_rules; DELETE FROM automation_events; DELETE FROM automation_cursors; DELETE FROM automation_deliveries');
});

const issue = (repo, n, over = {}) => ({
  number: n, html_url: `https://github.com/${repo}/issues/${n}`, title: `Bug ${n}`, body: 'It breaks', state: 'open',
  user: { login: 'alice' }, author_association: 'COLLABORATOR', labels: [], created_at: iso(T0 + 60_000), updated_at: iso(T0 + 60_000), ...over,
});
const pull = (repo, n, over = {}) => ({
  number: n, html_url: `https://github.com/${repo}/pull/${n}`, title: `PR ${n}`, body: 'Adds things', state: 'open', draft: false,
  user: { login: 'bob' }, author_association: 'MEMBER', labels: [], created_at: iso(T0 + 60_000), updated_at: iso(T0 + 60_000),
  head: { sha: 'abc1234def', ref: 'feat/x', repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } }, ...over,
});
const wsRule = (over = {}) => createRule({ workspaceId: WS, projectDir: '/ws/api', event: 'issue.opened', action: 'run',
  workflowId: 'wf_default', limits: normalizeLimits({}, DEFAULT_WORKSPACE_LIMITS), now: T0, ...over });
const projRule = (repo, over = {}) => createRule({ projectKey: `proj-${repo.replace(/\W/g, '')}`, projectDir: `/p/${repo}`, repo,
  event: 'issue.opened', action: 'run', workflowId: 'wf_default', now: T0, ...over });

/** An in-memory host per repository, a run launcher and a workspace of MEMBERS. */
function harness({ members = MEMBERS, prs = null } = {}) {
  const clock = { t: T0 + 120_000 };
  const host = { items: new Map(), issues: new Map(), prs: new Map(), posted: [], reviews: [], listed: [] };
  const runs = new Map();
  const calls = { start: [], notify: [], draft: [] };
  let seq = 0;
  const deps = {
    now: () => clock.t,
    host: {
      listIssues: async ({ repo, since }) => { host.listed.push(repo); return { ok: true, items: (host.items.get(repo) || []).filter((i) => i.updated_at >= since) }; },
      getIssue: async ({ repo, number }) => { const i = host.issues.get(`${repo}#${number}`); return i ? { ok: true, issue: i } : { ok: false }; },
      getPr: async ({ repo, number }) => { const p = host.prs.get(`${repo}#${number}`); return p ? { ok: true, pr: p } : { ok: false }; },
      listComments: async () => ({ ok: true, items: [] }),
      comment: async (a) => { host.posted.push(a); return { ok: true }; },
      review: async (a) => { host.reviews.push(a); return { ok: true }; },
      prFiles: async () => ({ ok: true, files: [] }),
      fetchPrHead: async ({ projectDir, number }) => ({ ok: true, ref: `origin/worca-pr-${number}`, remote: 'origin', projectDir }),
    },
    ownLogins: async () => ['worca-bot'],
    isOwnPr: async () => false,
    workspaceMembers: async (id) => (id === WS ? { name: 'Shop', members } : null),
    ensureTemplate: async (action, o = {}) => `wf_tpl_${action}${o.approved ? '_approved' : ''}`,
    startRun: async (body, opts) => {
      const runId = `run-${++seq}`;
      calls.start.push({ body, opts });
      runs.set(runId, { pipelineId: `pipe-${seq}`, status: 'running', cost: 0 });
      return { status: 200, body: { runId } };
    },
    pipelineOfRun: (runId) => runs.get(runId)?.pipelineId || null,
    pipelineStatus: (id) => [...runs.values()].find((r) => r.pipelineId === id)?.status || null,
    pipelineCost: (id) => [...runs.values()].find((r) => r.pipelineId === id)?.cost || 0,
    planText: async (id) => `plan of ${id}`,
    reviews: () => [{ cycle: 1, summary: 'ok', issues: [] }],
    openDraftPr: async (id, ctx) => {
      calls.draft.push({ id, ctx });
      return prs ? { ok: true, url: prs.find((p) => p.closes)?.url || prs[0].url, prs } : { ok: true, url: 'https://github.com/o/api/pull/1' };
    },
    notify: (n) => calls.notify.push(n),
  };
  const engine = createAutomationEngine(deps);
  const finish = (n, status = 'done') => { for (const r of runs.values()) if (r.pipelineId === `pipe-${n}`) r.status = status; };
  return { engine, host, calls, clock, finish, runs };
}

test('a workspace rule: scope, its owner key, no repository, the workspace limits (5 a day, $15, 1 at a time)', () => {
  assert.deepEqual(validateRule({ event: 'issue.opened', action: 'fix' }, { scope: 'workspace' }).rule.limits, { dailyRuns: 5, maxCostUsd: 15, maxConcurrent: 1 });
  assert.deepEqual(validateRule({ event: 'issue.opened', action: 'fix' }).rule.limits, { dailyRuns: 10, maxCostUsd: 5, maxConcurrent: 1 });
  const r = createRule({ workspaceId: WS, projectDir: '/ws/api', event: 'issue.opened', action: 'fix', now: T0 });
  assert.deepEqual([r.scope, r.workspaceId, r.projectKey, r.repo], ['workspace', WS, WSKEY, null]);
  assert.deepEqual(r.limits, { dailyRuns: 5, maxCostUsd: 15, maxConcurrent: 1 });
  const p = projRule('o/api');
  assert.deepEqual([p.scope, p.workspaceId], ['project', null]);
  assert.deepEqual(listRules({ scope: 'workspace' }).map((x) => x.id), [r.id]);
  // Its switches are its own, with the workspace limits; project polling never lists a workspace rule.
  assert.deepEqual(setAutoHandle({ workspaceId: WS, key: 'propose', on: true }), { propose: true, fix: false, review: false });
  const sw = listRules({ projectKey: WSKEY }).find((x) => x.origin === 'auto-handle');
  assert.deepEqual([sw.scope, sw.workspaceId, sw.repo, sw.limits.maxCostUsd], ['workspace', WS, null, 15]);
  assert.deepEqual(autoHandleState(WSKEY), { propose: true, fix: false, review: false });
  assert.deepEqual(pollTargets().map((t) => t.repo), ['o/api']);
});

test('memberForEvent and subjectFor: a GitHub event is its repository\'s; an Azure work item is its project\'s, once', () => {
  const az = [
    { name: 'a', repo: 'dev.azure.com/acme/Shop/api' }, { name: 'b', repo: 'dev.azure.com/acme/Shop/web' }, { name: 'c', repo: 'o/c' },
  ];
  assert.equal(memberForEvent(MEMBERS, { kind: 'issue', repo: 'O/Web' }).name, 'web');
  assert.equal(memberForEvent(MEMBERS, { kind: 'issue', repo: 'o/elsewhere' }), null);
  // A work item offered through either repository of the Azure project belongs to its first member.
  assert.equal(memberForEvent(az, { kind: 'issue', repo: 'dev.azure.com/acme/Shop/web' }).name, 'a');
  assert.equal(memberForEvent(az, { kind: 'issue', repo: 'dev.azure.com/acme/Shop/other' }).name, 'a');
  assert.equal(memberForEvent(az, { kind: 'pr', repo: 'dev.azure.com/acme/Shop/web' }).name, 'b');
  assert.equal(memberForEvent(az, { kind: 'issue', repo: 'dev.azure.com/acme/Other/web' }), null);
  const ws = { scope: 'workspace', action: 'fix' };
  const viaWeb = { kind: 'issue', repo: 'dev.azure.com/acme/Shop/web', number: 7, subject: 'issue:dev.azure.com/acme/Shop/web#7' };
  assert.equal(subjectFor(ws, viaWeb), 'issue:dev.azure.com/acme/shop#7');
  assert.equal(subjectFor(ws, { ...viaWeb, repo: 'dev.azure.com/acme/Shop/api' }), 'issue:dev.azure.com/acme/shop#7');
  assert.equal(subjectFor({ scope: 'project', action: 'fix' }, viaWeb), viaWeb.subject);
  assert.equal(subjectFor(ws, issueEvent('o/web', issue('o/web', 3))), 'issue:o/web#3');
});

test('an issue in any member repository starts ONE workspace run that names every repository', async () => {
  const h = harness();
  wsRule({ action: 'fix', workflowId: null });
  await h.engine.handleEvent(issueEvent('o/web', issue('o/web', 4)), { via: 'webhook' });
  assert.equal(h.calls.start.length, 1);
  const { body } = h.calls.start[0];
  assert.equal(body.workspaceId, WS);
  assert.equal(body.projectDir, undefined, 'a workspace run, not a project run');
  assert.equal(body.workflowId, 'wf_tpl_fix');
  assert.equal(body.humanInLoop, false);
  assert.equal(body.guardrailsId, 'secure');
  assert.equal(body.source.url, 'https://github.com/o/web/issues/4');
  assert.match(body.source.prompt, /"Shop" workspace's repositories: api \(o\/api\), web \(o\/web\), docs\. The issue was opened in o\/web/);
  assert.match(body.source.prompt, /leave the others untouched/);
  const ev = listEvents()[0];
  assert.deepEqual([ev.projectKey, ev.repo, ev.subject], [WSKEY, 'o/web', 'issue:o/web#4']);
  // Never twice; and the workspace is the concurrency unit: a second issue, in the other repository, queues.
  await h.engine.handleEvent(issueEvent('o/web', issue('o/web', 4)));
  await h.engine.handleEvent(issueEvent('o/api', issue('o/api', 5)));
  assert.equal(h.calls.start.length, 1);
  assert.equal(listEvents({ status: 'queued' })[0].repo, 'o/api');
  // An issue outside the workspace is not its business.
  await h.engine.handleEvent(issueEvent('o/elsewhere', issue('o/elsewhere', 1)));
  assert.equal(listEvents().length, 2);
});

test('overlap: the workspace\'s rule wins for its event; the project keeps the events the workspace has no rule for', async () => {
  const h = harness();
  projRule('o/api', { action: 'fix', workflowId: null });
  projRule('o/api', { event: 'pr.opened', action: 'review', workflowId: null });
  wsRule({ action: 'propose', workflowId: null });
  await h.engine.handleEvent(issueEvent('o/api', issue('o/api', 1)));
  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.start[0].body.workspaceId, WS);
  assert.match(h.calls.start[0].body.title, /^Propose a fix for #1/);
  assert.deepEqual(listEvents().map((e) => e.projectKey), [WSKEY], 'the project\'s full fix stayed out');
  // No workspace PR rule: the project's review still runs, in the project.
  await h.engine.handleEvent(prEvent('o/api', pull('o/api', 2)));
  assert.equal(h.calls.start.length, 2);
  assert.equal(h.calls.start[1].body.projectDir, '/p/o/api');
  // A workspace review rule takes PRs over too, and reviews in the member's own project directory.
  // (Room for it: the workspace's propose run still counts against its one-at-a-time cap.)
  wsRule({ event: 'pr.opened', action: 'review', workflowId: null, limits: normalizeLimits({ maxConcurrent: 3 }, DEFAULT_WORKSPACE_LIMITS) });
  await h.engine.handleEvent(prEvent('o/api', pull('o/api', 3)));
  assert.equal(h.calls.start.length, 3);
  assert.equal(h.calls.start[2].body.projectDir, '/ws/api');
  assert.equal(h.calls.start[2].body.workspaceId, undefined, 'a review stays per PR');
  assert.equal(h.calls.start[2].body.sourceBranch, 'origin/worca-pr-3');
  assert.equal(listEvents().find((e) => e.number === 3).projectKey, WSKEY);
  // A push to a PR (head only) is the workspace's alone now: the project's review rule does not see it.
  await h.engine.handleEvent(prEvent('o/api', pull('o/api', 3, { head: { sha: 'fff0001', ref: 'feat/x' } })), { headOnly: true });
  assert.equal(h.calls.start.length, 4);
  assert.equal(h.calls.start[3].body.projectDir, '/ws/api');
});

test('polling covers every member repository with a remote, each with its own cursor; a repository is read once', async () => {
  const h = harness();
  wsRule();
  projRule('o/api', { event: 'pr.opened', action: 'review', workflowId: null });
  const targets = await h.engine.targets();
  assert.deepEqual(targets.map((t) => [t.repo, t.cursorKey || t.projectKey]), [['o/api', 'proj-oapi'], ['o/web', `${WSKEY}@o/web`]]);
  await h.engine.tick({ force: true });            // first polls: cursors only
  assert.equal(h.calls.start.length, 0);
  h.clock.t += 60_000;
  h.host.items.set('o/web', [issue('o/web', 9, { created_at: iso(h.clock.t), updated_at: iso(h.clock.t) })]);
  h.host.items.set('o/api', [issue('o/api', 8, { created_at: iso(h.clock.t), updated_at: iso(h.clock.t) })]);
  h.host.listed.length = 0;
  await h.engine.tick({ force: true });
  assert.deepEqual(h.host.listed.sort(), ['o/api', 'o/web']);
  // One run (the workspace's concurrency is 1), the other issue queued: both answered by the workspace rule.
  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.start[0].body.workspaceId, WS);
  assert.deepEqual(listEvents().map((e) => e.projectKey), [WSKEY, WSKEY]);
});

test('the fix ends with one draft PR per changed member, linked; the issue comment lists them all', async () => {
  const prs = [
    { name: 'api', repo: 'o/api', url: 'https://github.com/o/api/pull/11', closes: false },
    { name: 'web', repo: 'o/web', url: 'https://github.com/o/web/pull/12', closes: true },
  ];
  const h = harness({ prs });
  wsRule({ action: 'fix', workflowId: null });
  await h.engine.handleEvent(issueEvent('o/web', issue('o/web', 4)));
  h.finish(1);
  await h.engine.tick();
  assert.equal(h.calls.draft.length, 1);
  assert.equal(h.calls.draft[0].ctx.rule.scope, 'workspace');
  const ev = listEvents()[0];
  assert.equal(ev.status, 'done');
  assert.equal(ev.prUrl, 'https://github.com/o/web/pull/12', 'the issue\'s own repository\'s PR');
  assert.deepEqual(ev.prs.map((p) => p.url), prs.map((p) => p.url));
  const posted = h.host.posted.at(-1);
  assert.deepEqual([posted.repo, posted.number], ['o/web', 4]);
  assert.match(posted.body, /2 draft pull requests, linked to each other/);
  assert.match(posted.body, /- api: https:\/\/github\.com\/o\/api\/pull\/11\n- web: https:\/\/github\.com\/o\/web\/pull\/12 \(closes this issue\)/);
  assert.match(h.calls.notify.at(-1).message, /^Draft PRs opened for #4 · .*pull\/11, .*pull\/12$/);
  // The comment names a member whose PR failed.
  assert.match(fixComment({ prs: [prs[1], { name: 'api', error: 'push refused' }] }), /- api: not opened \(push refused\)/);
});

test('triage and propose, then approval: the fix after approval is a workspace run with the plan', async () => {
  const h = harness();
  wsRule({ action: 'propose', workflowId: null });
  await h.engine.handleEvent(issueEvent('o/api', issue('o/api', 6, { labels: ['bug'] })));
  h.finish(1);
  await h.engine.tick();
  const ev = listEvents()[0];
  assert.equal(ev.status, 'awaiting-approval');
  h.host.issues.set('o/api#6', issue('o/api', 6, { labels: ['bug'] }));
  const r = await h.engine.approve(ev.id, { by: 'local' });
  assert.equal(r.ok, true);
  const fix = h.calls.start[1].body;
  assert.equal(fix.workspaceId, WS);
  assert.equal(fix.workflowId, 'wf_tpl_fix_approved');
  assert.match(fix.source.prompt, /A person approved this plan[\s\S]*plan of pipe-1/);
  assert.match(fix.source.prompt, /workspace's repositories/);
  assert.equal(getEvent(ev.id).phase, 'fix');
});

test('Azure DevOps: the workspace owns its project\'s work items: one event and one run, never one per repository', async () => {
  const members = [
    { name: 'api', repo: 'dev.azure.com/acme/Shop/api', projectDir: '/ws/api', projectKey: 'api-1' },
    { name: 'web', repo: 'dev.azure.com/acme/Shop/web', projectDir: '/ws/web', projectKey: 'web-2' },
  ];
  const h = harness({ members });
  wsRule({ action: 'fix', workflowId: null });
  // A project rule on one of the Azure project's repositories: the workspace takes the work items over.
  projRule('dev.azure.com/acme/Shop/web', { action: 'fix', workflowId: null });
  const payload = { eventType: 'workitem.created', resourceContainers: { account: { baseUrl: 'https://dev.azure.com/acme/' } },
    resource: { id: 42, fields: { 'System.TeamProject': 'Shop', 'System.Title': 'Checkout fails', 'System.State': 'New',
      'System.CreatedBy': 'Jane <jane@acme.com>', 'System.CreatedDate': iso(T0 + 60_000), 'System.ChangedDate': iso(T0 + 60_000), 'System.WorkItemType': 'Bug' } } };
  const items = azureWebhookItems(payload, ['dev.azure.com/acme/Shop/web', ...members.map((m) => m.repo)]);
  assert.equal(items.length, 3, 'offered through every repository of the project');
  await h.engine.handleItems(items);
  assert.equal(h.calls.start.length, 1);
  assert.equal(h.calls.start[0].body.workspaceId, WS);
  assert.equal(h.calls.start[0].body.source.type, 'azure');
  assert.equal(h.calls.start[0].body.source.repo, 'dev.azure.com/acme/Shop/api', 'its first member\'s: that PR links it');
  const all = listEvents();
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].subject, all[0].projectKey], ['issue:dev.azure.com/acme/shop#42', WSKEY]);
  // The poll offering it again through either repository changes nothing.
  for (const it of items) await h.engine.handleEvent(it.ev, { via: 'poll' });
  assert.equal(h.calls.start.length, 1);
  assert.equal(listEvents().length, 1);
});

test('a deleted workspace\'s rules match nothing; buildTask without a workspace is unchanged', async () => {
  const h = harness();
  createRule({ workspaceId: 'wks-gone-deadbeef', projectDir: '', event: 'issue.opened', action: 'fix', now: T0 });
  await h.engine.handleEvent(issueEvent('o/api', issue('o/api', 1)));
  assert.equal(h.calls.start.length, 0);
  assert.deepEqual(await h.engine.targets(), []);
  const ev = issueEvent('o/api', issue('o/api', 1));
  assert.doesNotMatch(buildTask(ev, { action: 'fix' }), /workspace/);
  assert.ok(getRule(listRules()[0].id));
});

test('limitsError: a value outside its range is named; empty or absent values keep the defaults', () => {
  assert.equal(limitsError(undefined), null);
  assert.equal(limitsError({ dailyRuns: '', maxCostUsd: null }), null);
  assert.equal(limitsError({ dailyRuns: 200, maxCostUsd: 0.1, maxConcurrent: 10 }), null);
  assert.match(limitsError({ dailyRuns: 0 }), /Runs per day must be between 1 and 200/);
  assert.match(limitsError({ maxCostUsd: 'lots' }), /Cost cap per run must be between 0.1 and 1000/);
  assert.match(limitsError({ maxConcurrent: 11 }), /Runs at a time must be between 1 and 10/);
  assert.equal(limitsError([]), 'limits must be an object');
  assert.match(validateRule({ event: 'issue.opened', action: 'fix', limits: { dailyRuns: 999 } }).error, /Runs per day/);
});
