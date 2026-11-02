// test/automations-azure.test.mjs — Git event automations on Azure DevOps (#711): the host adapter (work items as
// issues, PRs as pulls, comments, the review threads) against a fake REST API, the service hook mapping, and the
// engine starting an `azure` run whose work item the draft PR links.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing as azureApi, workItemIdFromSourceRef } from '../src/core/pr/azure.mjs';
import { createAzureAutomationHost, azureWebhookItems, workItemIssue, azurePull, htmlText, parseAzureRepo } from '../src/core/automation-azure.mjs';
import { createRule, createAutomationEngine, listEvents, forgeOfRepo, buildTask, planComment, issueEvent } from '../src/core/automations.mjs';
import { resolveTaskInput } from '../src/core/sources.mjs';

useTempHome(after, 'automations-azure-');

const REPO = 'dev.azure.com/acme/Shop/web';
const C = { org: 'acme', project: 'Shop', repo: 'web' };
const T0 = Date.parse('2026-10-22T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const ENV = { WORCA_ADO_TOKEN: 'code-pat', WORCA_ADO_BOARDS_TOKEN: 'boards-pat' };

const workItem = (id, over = {}) => ({ id, fields: { 'System.Id': id, 'System.Title': `Crash ${id}`, 'System.State': 'New',
  'System.Tags': 'bug; urgent', 'System.CreatedDate': iso(T0 + 60_000), 'System.ChangedDate': iso(T0 + 60_000),
  'System.CreatedBy': { uniqueName: 'jane@acme.com', displayName: 'Jane' }, 'System.Description': '<div>It <b>breaks</b> &amp; dies</div>',
  'System.TeamProject': 'Shop', ...over } });
const pull = (id, over = {}) => ({ pullRequestId: id, title: `PR ${id}`, description: 'Adds', status: 'active', isDraft: false,
  createdBy: { uniqueName: 'bob@acme.com' }, creationDate: iso(T0 + 60_000), sourceRefName: 'refs/heads/feat/x',
  targetRefName: 'refs/heads/main', lastMergeSourceCommit: { commitId: 'abc123' }, labels: [{ name: 'needs-review', active: true }],
  repository: { name: 'web', project: { name: 'Shop' } }, ...over });

/** A fake Azure DevOps REST API: records every call, answers by URL. */
function fakeAzure(routes) {
  const calls = [];
  azureApi.setFetch(async (url, init) => {
    const call = { url, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const hit = routes.find(([re]) => re.test(url));
    const [status, json] = hit ? hit[1](call) : [404, { message: 'no route' }];
    return { status, ok: status < 300, json: async () => json, text: async () => '' };
  });
  return calls;
}
const basic = (t) => `Basic ${Buffer.from(`:${t}`).toString('base64')}`;

beforeEach(() => {
  azureApi.reset();
  getDb().exec('DELETE FROM automation_rules; DELETE FROM automation_events; DELETE FROM automation_cursors');
});
after(() => azureApi.reset());

test('shapes: a work item is an issue, a PR is a pull, HTML is text, every author a member', () => {
  const i = workItemIssue(C, workItem(5));
  assert.deepEqual(i, { number: 5, html_url: 'https://dev.azure.com/acme/Shop/_workitems/edit/5', title: 'Crash 5', body: 'It breaks & dies',
    state: 'open', user: { login: 'jane@acme.com' }, author_association: 'MEMBER', labels: ['bug', 'urgent'], type: null,
    created_at: iso(T0 + 60_000), updated_at: iso(T0 + 60_000) });
  assert.deepEqual(workItemIssue(C, workItem(9, { 'System.WorkItemType': 'User Story' })).type, { name: 'User Story' });
  assert.equal(workItemIssue(C, workItem(6, { 'System.State': 'Done' })).state, 'closed');
  const p = azurePull(C, pull(7, { isDraft: true }));
  assert.equal(p.html_url, 'https://dev.azure.com/acme/Shop/_git/web/pullrequest/7');
  assert.deepEqual([p.draft, p.head.sha, p.head.ref, p.base.ref, p.labels], [true, 'abc123', 'feat/x', 'main', ['needs-review']]);
  assert.equal(htmlText('<p>/worca approve</p><br>ok'), '/worca approve\n\nok');
  assert.deepEqual(parseAzureRepo(REPO), C);
  assert.equal(forgeOfRepo(REPO), 'azure');
  assert.equal(forgeOfRepo('o/r'), 'github');
  // The wording follows the host.
  assert.match(buildTask(issueEvent(REPO, i), { action: 'fix' }), /work item #5 in dev\.azure\.com\/acme\/Shop\/web/);
  assert.match(planComment({ plan: 'x', forge: 'azure' }), /a project member/);
});

test('adapter: listIssues reads changed work items (Boards token) and the active PRs (Code token)', async () => {
  const calls = fakeAzure([
    [/\/_apis\/wit\/wiql/, () => [200, { workItems: [{ id: 5 }, { id: 6 }] }]],
    [/\/_apis\/wit\/workitemsbatch/, () => [200, { value: [workItem(5), null, workItem(6)] }]],
    [/\/pullrequests\?searchCriteria\.status=active/, () => [200, { value: [pull(7)] }]],
  ]);
  const host = createAzureAutomationHost({ env: ENV });
  const r = await host.listIssues({ repo: REPO, since: iso(T0) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => [x.number, !!x.pull_request]), [[5, false], [6, false], [7, true]]);
  const wiql = calls.find((c) => /wiql/.test(c.url));
  assert.match(wiql.url, /^https:\/\/dev\.azure\.com\/acme\/Shop\/_apis\/wit\/wiql\?timePrecision=true/);
  assert.match(wiql.body.query, /\[System\.ChangedDate\] >= '2026-10-22T10:00:00\.000Z'/);
  assert.equal(wiql.auth, basic('boards-pat'));
  assert.equal(calls.find((c) => /pullrequests/.test(c.url)).auth, basic('code-pat'));
});

test('adapter: comments in markdown, approvals read from the waiting work items, review threads, files, own login', async () => {
  const calls = fakeAzure([
    [/workItems\/5\/comments\?format=markdown/, () => [200, { id: 1 }]],
    [/workItems\/5\/comments\?api-version/, () => [200, { comments: [
      { text: '<p>/worca approve</p>', createdBy: { uniqueName: 'ann@acme.com' }, createdDate: iso(T0 + 5000) },
      { text: 'old', createdBy: { uniqueName: 'x' }, createdDate: iso(T0 - 5000) }] }]],
    [/pullRequests\/7\/threads/, (c) => [c.body.threadContext?.filePath === '/gone.js' ? 400 : 200, {}]],
    [/pullRequests\/7\/iterations\/3\/changes/, () => [200, { changeEntries: [{ item: { path: '/src/a.js' } }] }]],
    [/pullRequests\/7\/iterations/, () => [200, { value: [{ id: 1 }, { id: 3 }] }]],
    [/connectionData/, () => [200, { authenticatedUser: { providerDisplayName: 'Worca Bot', properties: { Account: { $value: 'bot@acme.com' } } } }]],
  ]);
  const host = createAzureAutomationHost({ env: ENV });
  assert.equal((await host.comment({ repo: REPO, number: 5, body: '### Plan' })).ok, true);
  const post = calls.find((c) => /format=markdown/.test(c.url));
  assert.deepEqual([post.method, post.body, post.auth], ['POST', { text: '### Plan' }, basic('boards-pat')]);
  assert.match(post.url, /api-version=7\.1-preview\.4/);
  const cm = await host.listComments({ repo: REPO, since: iso(T0), numbers: [5] });
  assert.deepEqual(cm.items.map((c) => [c.body, c.user.login, c.author_association, c.issue_url.split('/').pop()]),
    [['/worca approve', 'ann@acme.com', 'MEMBER', '5']]);
  const rv = await host.review({ repo: REPO, number: 7, review: { body: 'Summary', comments: [
    { path: 'src/a.js', line: 3, body: 'Bad' }, { path: 'gone.js', line: 1, body: 'x' }] } });
  assert.equal(rv.ok, true, 'an inline thread Azure refuses does not fail the review');
  const threads = calls.filter((c) => /threads/.test(c.url));
  assert.deepEqual(threads.map((t) => t.body.status), [4, 1, 1]);
  assert.deepEqual(threads[1].body.threadContext, { filePath: '/src/a.js', rightFileStart: { line: 3, offset: 1 }, rightFileEnd: { line: 3, offset: 1 } });
  assert.ok(threads.every((t) => !('vote' in t.body)));
  assert.deepEqual((await host.prFiles({ repo: REPO, number: 7 })).files, ['src/a.js']);
  assert.deepEqual(await host.ownLogins(REPO), ['bot@acme.com', 'Worca Bot']);
});

test('adapter: a PR head is fetched from its source branch; a fork\'s PR is refused', async () => {
  fakeAzure([[/pullrequests\/7$|pullrequests\/7\?/, () => [200, pull(7)]], [/pullrequests\/8/, () => [200, pull(8, { forkSource: { repository: {} } })]]]);
  const seen = [];
  const host = createAzureAutomationHost({ env: ENV, fetchHead: async (a) => { seen.push(a); return { ok: true, ref: 'origin/worca-pr-7', sha: 'abc123', remote: 'origin' }; } });
  assert.deepEqual(await host.fetchPrHead({ projectDir: '/p', repo: REPO, number: 7, headSha: 'abc123' }), { ok: true, ref: 'origin/worca-pr-7', sha: 'abc123', remote: 'origin' });
  assert.equal(seen[0].branch, 'feat/x');
  assert.equal((await host.fetchPrHead({ projectDir: '/p', repo: REPO, number: 7, headSha: 'zzz' })).ok, false);
  assert.match((await host.fetchPrHead({ projectDir: '/p', repo: REPO, number: 8 })).error, /fork/);
});

test('service hooks: work items go to every rule repo of their project; PRs to their repo; comments are approvals', () => {
  const repos = [REPO, 'dev.azure.com/acme/Shop/api', 'dev.azure.com/acme/Other/web', 'dev.azure.com/zeta/Shop/web'];
  const account = { resourceContainers: { account: { baseUrl: 'https://dev.azure.com/acme/' } } };
  const created = azureWebhookItems({ eventType: 'workitem.created', resource: workItem(5), ...account }, repos);
  assert.deepEqual(created.map((x) => x.ev.repo), [REPO, 'dev.azure.com/acme/Shop/api']);
  assert.equal(created[0].ev.subject, `issue:${REPO}#5`);
  assert.equal(created[0].ev.authorAssociation, 'MEMBER');
  const updated = azureWebhookItems({ eventType: 'workitem.updated', resource: { workItemId: 5, revision: workItem(5) }, ...account }, repos);
  assert.equal(updated[0].ev.number, 5);
  const said = azureWebhookItems({ eventType: 'workitem.commented', ...account,
    resource: workItem(5, { 'System.History': '<div>/worca approve</div>', 'System.ChangedBy': 'Ann <ann@acme.com>' }) }, [REPO]);
  assert.deepEqual([said[0].kind, said[0].comment.body, said[0].comment.user.login], ['comment', '/worca approve', 'ann@acme.com']);
  const pr = azureWebhookItems({ eventType: 'git.pullrequest.created', resource: { ...pull(7), repository: { name: 'web', project: { name: 'Shop' }, url: 'https://dev.azure.com/acme/_apis/git/repositories/1' } } }, repos);
  assert.deepEqual(pr.map((x) => [x.ev.repo, x.ev.subject, x.ev.headSha]), [[REPO, `pr:${REPO}#7`, 'abc123']]);
  assert.deepEqual(azureWebhookItems({ eventType: 'build.complete', ...account, resource: {} }, repos), []);
  assert.deepEqual(azureWebhookItems({ eventType: 'workitem.created', resource: workItem(5) }, repos), [], 'no organization: nothing');
});

test('engine on Azure DevOps: a work item starts an `azure` run, its plan goes back as a comment, a member\'s approval starts the fix', async () => {
  const started = []; const posted = [];
  let status = 'running'; let approved = false;
  const hostCalls = { github: 0 };
  const azureHost = {
    getIssue: async () => ({ ok: true, issue: workItemIssue(C, workItem(5)) }),
    comment: async (a) => { posted.push(a); return { ok: true }; },
    listComments: async ({ numbers }) => ({ ok: true, items: approved && numbers.includes(5) ? [{ body: '/worca approve', user: { login: 'ann@acme.com' },
      author_association: 'MEMBER', issue_url: '.../workItems/5', created_at: iso(T0 + 600_000), updated_at: iso(T0 + 600_000) }] : [] }),
    listIssues: async () => ({ ok: true, items: [] }),
    ownLogins: async () => ['bot@acme.com'],
  };
  const engine = createAutomationEngine({
    now: () => T0 + 120_000,
    hostFor: (repo) => (forgeOfRepo(repo) === 'azure' ? azureHost : (hostCalls.github++, {})),
    ownLogins: (repo) => azureHost.ownLogins(repo),
    ensureTemplate: async (a) => `wf_${a}`,
    startRun: async (body, opts) => { started.push({ body, opts }); return { status: 200, body: { runId: `r${started.length}` } }; },
    pipelineOfRun: (id) => `p-${id}`,
    pipelineStatus: () => status,
    planText: async () => '## Root cause\nnull',
  });
  createRule({ projectKey: 'shop', projectDir: '/shop', repo: REPO, event: 'issue.opened', action: 'propose', now: T0 });
  await engine.handleEvent(issueEvent(REPO, workItemIssue(C, workItem(5))));
  assert.equal(started.length, 1);
  assert.equal(started[0].body.source.type, 'azure');
  assert.equal(started[0].body.source.url, 'https://dev.azure.com/acme/Shop/_workitems/edit/5');
  assert.equal(started[0].opts.startedBy, 'azure:jane@acme.com');
  assert.match(started[0].opts.trigger, /issue #5, opened by @jane@acme\.com/);
  status = 'done';
  await engine.tick();
  assert.equal(listEvents()[0].status, 'awaiting-approval');
  assert.match(posted[0].body, /a project member/);
  status = 'running'; approved = true;
  await engine.tick({ force: true });
  assert.equal(started.length, 2, 'the approval comment starts the fix');
  assert.equal(started[1].body.workflowId, 'wf_fix');
  assert.equal(listEvents()[0].approvedBy, 'azure:ann@acme.com');
  assert.equal(hostCalls.github, 0, 'nothing went to the GitHub host');
});

test('an `azure` run source keeps the work item, and the draft PR links it', async () => {
  const r = await resolveTaskInput({ type: 'azure', kind: 'issue', repo: REPO, number: 5, url: 'https://dev.azure.com/acme/Shop/_workitems/edit/5', title: 'Crash', prompt: 'task' });
  assert.equal(r.promptText, 'task');
  assert.deepEqual(r.sourceMeta, { forge: 'azure', kind: 'issue', repo: REPO, number: 5, taskId: 'acme/Shop#5', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/5', title: 'Crash' });
  assert.equal(workItemIdFromSourceRef(JSON.stringify(r.sourceMeta), { org: 'acme' }), 5);
  assert.equal(workItemIdFromSourceRef(JSON.stringify({ ...r.sourceMeta, kind: 'pr' }), { org: 'acme' }), null);
  assert.equal(workItemIdFromSourceRef(JSON.stringify(r.sourceMeta), { org: 'other' }), null);
  const gh = await resolveTaskInput({ type: 'github', kind: 'issue', repo: 'o/r', number: 2, url: 'https://github.com/o/r/issues/2', prompt: 'p' });
  assert.equal(gh.sourceMeta.taskId, 'o/r#2');
});
