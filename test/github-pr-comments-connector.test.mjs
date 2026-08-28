// test/github-pr-comments-connector.test.mjs — GitHub PR comment threads
// connector, pure unit tests with an injected fake fetch (no network, no shim
// child). The connector is plain ESM so it imports directly from plugins/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeManifest } from '../src/core/plugin-manifest.mjs';
import { ghGraphql } from '../plugins/github-source/connector/github-api.mjs';
import createPrCommentsSource, {
  parsePrFilter, searchQuery, parseThreadId, prToThreads, threadSummary, threadToTask,
} from '../plugins/github-source/connector/pr-comments.mjs';

// ── harness ────────────────────────────────────────────────────────────────────
function res(status, body, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h[k.toLowerCase()] ?? null }, json: async () => body };
}
function memState(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); } };
}
const makeCtx = (config = { token: 'tok' }, state = memState()) => ({ apiVersion: 1, profile: 'default', config, state, log: () => {} });
/** Route table fake fetch: [{ match: /re/, method?, reply: res|fn(url,init) }]. Records calls. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const r of routes) {
      if (r.match.test(String(url)) && (!r.method || r.method === (init.method || 'GET'))) {
        return typeof r.reply === 'function' ? r.reply(String(url), init) : r.reply;
      }
    }
    throw new Error(`unrouted fetch: ${init.method || 'GET'} ${url}`);
  };
  fn.calls = calls;
  return fn;
}

// ── ghGraphql ──────────────────────────────────────────────────────────────────
test('ghGraphql: POSTs JSON {query, variables} to /graphql and surfaces `errors` as kind:plugin', async () => {
  const ok = fakeFetch([{ match: /\/graphql$/, method: 'POST', reply: res(200, { data: { viewer: { login: 'octo' } } }) }]);
  const data = await ghGraphql({ fetch: ok, token: 'tok' }, 'query { viewer { login } }', {});
  assert.deepEqual(data, { viewer: { login: 'octo' } });
  assert.equal(ok.calls[0].url, 'https://api.github.com/graphql');
  const sent = JSON.parse(ok.calls[0].init.body);
  assert.equal(sent.query, 'query { viewer { login } }');
  assert.deepEqual(sent.variables, {});
  assert.equal(ok.calls[0].init.headers.authorization, 'Bearer tok');
  assert.equal(ok.calls[0].init.headers['content-type'], 'application/json');

  const bad = fakeFetch([{ match: /\/graphql$/, method: 'POST', reply: res(200, { data: null, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a PullRequest' }] }) }]);
  await assert.rejects(() => ghGraphql({ fetch: bad, token: 'tok' }, 'query{x}', {}), (e) => e.kind === 'plugin' && /Could not resolve/.test(e.message));

  const unauth = fakeFetch([{ match: /\/graphql$/, method: 'POST', reply: res(401, {}) }]);
  await assert.rejects(() => ghGraphql({ fetch: unauth, token: 'tok' }, 'query{x}', {}), (e) => e.kind === 'auth');
});

// ── filter micro-syntax + ids ──────────────────────────────────────────────────
test('parsePrFilter: defaults + PR selectors + thread filters; unknown tokens ignored', () => {
  assert.deepEqual(parsePrFilter(''), {
    state: 'open', reviewRequested: null, prAuthor: null, pr: null, labels: [], resolved: 'unresolved', author: 'not-me',
  });
  assert.deepEqual(parsePrFilter('state:all review-requested:@me pr-author:bob label:api resolved:all author:any wat:huh'), {
    state: 'all', reviewRequested: '@me', prAuthor: 'bob', pr: null, labels: ['api'], resolved: 'all', author: 'any',
  });
  assert.equal(parsePrFilter('pr:123').pr, 123);
  assert.equal(parsePrFilter('author:alice').author, 'alice');
});

test('searchQuery: renders the GitHub search string for the PR selectors', () => {
  assert.equal(searchQuery('acme/api', parsePrFilter('')), 'repo:acme/api is:pr state:open');
  assert.equal(searchQuery('acme/api', parsePrFilter('state:all review-requested:@me pr-author:bob label:api')),
    'repo:acme/api is:pr review-requested:@me author:bob label:"api"');
});

test('thread ids round-trip: kind + repo + number + item id', () => {
  const id = 'acme/api#42:thread:PRRT_kwDOAbc123';
  assert.deepEqual(parseThreadId(id), { repo: 'acme/api', number: 42, kind: 'thread', itemId: 'PRRT_kwDOAbc123' });
  assert.deepEqual(parseThreadId('acme/api#42:review:987'), { repo: 'acme/api', number: 42, kind: 'review', itemId: '987' });
  assert.throws(() => parseThreadId('acme/api#42'), (e) => e.kind === 'plugin');
});

// ── thread normalisation ───────────────────────────────────────────────────────
const PR = {
  number: 42, title: 'Add flux', url: 'https://github.com/acme/api/pull/42', isDraft: false,
  headRefName: 'Feature/Flux', headRefOid: 'abc123', baseRefName: 'main',
  headRepository: { nameWithOwner: 'acme/api' }, repository: { nameWithOwner: 'acme/api' },
  reviewThreads: { nodes: [
    { id: 'PRRT_1', isResolved: false, isOutdated: false, path: 'src/x.mjs', line: 42, startLine: null, diffSide: 'RIGHT',
      comments: { nodes: [
        { databaseId: 1001, url: 'https://github.com/acme/api/pull/42#discussion_r1001', body: 'this null check is wrong', createdAt: '2026-08-01T00:00:00Z',
          diffHunk: '@@ -40,3 +40,4 @@\n foo\n+  if (!x) return;', author: { login: 'alice' } },
        { databaseId: 1002, url: 'https://github.com/acme/api/pull/42#discussion_r1002', body: 'agreed', createdAt: '2026-08-02T00:00:00Z', diffHunk: null, author: { login: 'octo' } },
      ] } },
    { id: 'PRRT_2', isResolved: true, isOutdated: true, path: 'src/y.mjs', line: null, startLine: null, diffSide: 'LEFT',
      comments: { nodes: [{ databaseId: 1003, url: 'u3', body: 'old', createdAt: '2026-07-01T00:00:00Z', diffHunk: '@@', author: { login: 'bob' } }] } },
    { id: 'PRRT_3', isResolved: false, isOutdated: false, path: 'src/z.mjs', line: 7, startLine: 5, diffSide: 'RIGHT',
      comments: { nodes: [{ databaseId: 1004, url: 'u4', body: 'mine', createdAt: '2026-08-03T00:00:00Z', diffHunk: '@@', author: { login: 'octo' } }] } },
  ] },
  reviews: { nodes: [
    { databaseId: 501, url: 'https://github.com/acme/api/pull/42#pullrequestreview-501', body: 'Please split this PR', state: 'CHANGES_REQUESTED', createdAt: '2026-08-01T01:00:00Z', author: { login: 'alice' } },
    { databaseId: 502, url: 'r502', body: '', state: 'APPROVED', createdAt: '2026-08-01T02:00:00Z', author: { login: 'bob' } },
  ] },
  comments: { nodes: [
    { databaseId: 9001, url: 'https://github.com/acme/api/pull/42#issuecomment-9001', body: 'CI is red', createdAt: '2026-08-04T00:00:00Z', author: { login: 'carol' } },
  ] },
};

test('prToThreads: one task per thread, diff_comments-shaped anchors, defaults drop resolved + own threads', () => {
  const all = prToThreads(PR, parsePrFilter('resolved:all author:any'), 'octo');
  assert.deepEqual(all.map((t) => t.id), [
    'acme/api#42:thread:PRRT_1', 'acme/api#42:thread:PRRT_2', 'acme/api#42:thread:PRRT_3',
    'acme/api#42:review:501', 'acme/api#42:comment:9001',
  ]);
  const t1 = all[0];
  assert.equal(t1.path, 'src/x.mjs'); assert.equal(t1.line, 42); assert.equal(t1.side, 'new');
  assert.equal(t1.resolved, false); assert.equal(t1.comments.length, 2); assert.equal(t1.comments[0].author, 'alice');
  assert.deepEqual(t1.head, { ref: 'Feature/Flux', sha: 'abc123', repo: 'acme/api' });
  assert.deepEqual(t1.base, { ref: 'main' });
  assert.equal(t1.isDraft, false);
  assert.equal(t1.updatedAt, '2026-08-02T00:00:00Z');
  assert.equal(all[1].side, 'old'); assert.equal(all[1].outdated, true);

  const def = prToThreads(PR, parsePrFilter(''), 'octo');   // unresolved + not-me
  assert.deepEqual(def.map((t) => t.id), ['acme/api#42:thread:PRRT_1', 'acme/api#42:review:501', 'acme/api#42:comment:9001']);
  const alice = prToThreads(PR, parsePrFilter('resolved:all author:alice'), 'octo');
  assert.deepEqual(alice.map((t) => t.id), ['acme/api#42:thread:PRRT_1', 'acme/api#42:review:501']);
});

// ── summary + task text ────────────────────────────────────────────────────────
test('threadToTask: summary labelled with PR number/kind; body carries file, line, hunk, thread; checkout hint for same-repo PRs', () => {
  const [t1] = prToThreads(PR, parsePrFilter('author:any'), 'octo');
  const s = threadSummary(t1);
  assert.equal(s.id, 'acme/api#42:thread:PRRT_1');
  assert.equal(s.title, '#42 src/x.mjs:42 — this null check is wrong');
  assert.deepEqual(s.labels, ['PR #42', 'review-thread', 'unresolved']);
  assert.equal(s.updatedAt, '2026-08-02T00:00:00Z');
  assert.equal(s.url, 'https://github.com/acme/api/pull/42#discussion_r1001');
  assert.deepEqual(threadSummary({ ...t1, isDraft: true }).labels, ['PR #42', 'review-thread', 'unresolved', 'draft']);

  const task = threadToTask(t1);
  assert.match(task.body, /\*\*PR:\*\* \[acme\/api#42 — Add flux\]\(https:\/\/github.com\/acme\/api\/pull\/42\)/);
  assert.match(task.body, /`Feature\/Flux` → `main`/);
  assert.match(task.body, /\*\*File:\*\* `src\/x.mjs` line 42 \(new side\)/);
  assert.match(task.body, /```diff\n@@ -40,3 \+40,4 @@\n foo\n\+  if \(!x\) return;\n```/);
  assert.match(task.body, /## Thread\n\n\*\*@alice\*\* \(2026-08-01T00:00:00Z\):\n\nthis null check is wrong\n\n\*\*@octo\*\*/);
  assert.deepEqual(task.checkout, { branch: 'Feature/Flux', base: 'main', repo: 'acme/api', sha: 'abc123' });
  assert.equal(task.meta.kind, 'thread'); assert.equal(task.meta.threadId, 'PRRT_1');
  assert.equal(task.meta.rootCommentId, '1001'); assert.equal(task.meta.headRef, 'Feature/Flux');

  const fork = threadToTask({ ...t1, sameRepo: false, head: { ...t1.head, repo: 'alice/api' } });
  assert.equal(fork.checkout, undefined);
  assert.match(fork.body, /fork `alice\/api`/);
});

// ── the source factory ─────────────────────────────────────────────────────────
const gqlRoute = (reply) => ({ match: /\/graphql$/, method: 'POST', reply });
const searchReply = (prs, issueCount = prs.length) => res(200, { data: { viewer: { login: 'octo' }, search: { issueCount, nodes: prs } } });
const prReply = (pr) => res(200, { data: { viewer: { login: 'octo' }, repository: { pullRequest: pr } } });

test('listTasks: one search across all matching PRs, labelled by PR number, newest first (ties: higher PR first), search filters titles+bodies', async () => {
  const other = { ...PR, number: 43, title: 'Other', url: 'https://github.com/acme/api/pull/43', reviews: { nodes: [] }, comments: { nodes: [] } };
  const fetch = fakeFetch([gqlRoute(searchReply([PR, other]))]);
  const src = createPrCommentsSource(makeCtx(), { fetch });
  const { tasks, cursor } = await src.listTasks({ inputs: { repo: 'acme/api', filter: 'state:open review-requested:@me' } });
  const vars = JSON.parse(fetch.calls[0].init.body).variables;
  assert.equal(vars.q, 'repo:acme/api is:pr state:open review-requested:@me');
  assert.equal(vars.first, 20);
  // 42:PRRT_1 and 43:PRRT_1 share updatedAt 2026-08-02 -> D15 tie-break puts PR 43 first.
  assert.deepEqual(tasks.map((t) => t.id), [
    'acme/api#42:comment:9001', 'acme/api#43:thread:PRRT_1', 'acme/api#42:thread:PRRT_1', 'acme/api#42:review:501',
  ]);
  assert.ok(tasks.every((t) => t.labels.some((l) => /^PR #4[23]$/.test(l))));
  assert.equal(cursor, undefined);
  const { tasks: hits } = await src.listTasks({ inputs: { repo: 'acme/api' }, search: 'split' });
  assert.deepEqual(hits.map((t) => t.id), ['acme/api#42:review:501']);
});

test('listTasks: > PR_CAP matches logs a warn naming the count', async () => {
  const logs = [];
  const ctx = { ...makeCtx(), log: (level, msg) => logs.push({ level, msg }) };
  const fetch = fakeFetch([gqlRoute(searchReply([PR], 57))]);
  await createPrCommentsSource(ctx, { fetch }).listTasks({ inputs: { repo: 'acme/api' } });
  assert.ok(logs.some((l) => l.level === 'warn' && /57 PRs match/.test(l.msg) && /first 20/.test(l.msg)));
});

test('listTasks: pr:<n> queries the PR directly; empty repo -> no tasks; login cached from the same response', async () => {
  const state = memState();
  const fetch = fakeFetch([gqlRoute(prReply(PR))]);
  const src = createPrCommentsSource(makeCtx({ token: 'tok' }, state), { fetch });
  const { tasks } = await src.listTasks({ inputs: { repo: 'acme/api', filter: 'pr:42' } });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body).variables, { owner: 'acme', name: 'api', number: 42 });
  assert.equal(tasks.length, 3);
  assert.equal(await state.get('login'), 'octo');
  assert.deepEqual(await src.listTasks({ inputs: {} }), { tasks: [] });
});

test('getTask: fetches the PR and returns the selected thread with body/meta/checkout; unknown item -> plugin error', async () => {
  const fetch = fakeFetch([gqlRoute(prReply(PR))]);
  const src = createPrCommentsSource(makeCtx(), { fetch });
  const t = await src.getTask('acme/api#42:thread:PRRT_1');
  assert.equal(t.title, '#42 src/x.mjs:42 — this null check is wrong');
  assert.deepEqual(t.checkout, { branch: 'Feature/Flux', base: 'main', repo: 'acme/api', sha: 'abc123' });
  // getTask ignores the author/resolved filters: a thread picked under any filter must still resolve.
  const mine = await src.getTask('acme/api#42:thread:PRRT_3');
  assert.equal(mine.meta.rootCommentId, '1004');
  await assert.rejects(() => src.getTask('acme/api#42:thread:PRRT_404'), (e) => e.kind === 'plugin' && /not found/.test(e.message));
  await assert.rejects(() => src.getTask('nonsense'), (e) => e.kind === 'plugin');
});

test('reportResult: thread -> REST reply on the root comment; resolveOnComplete=yes + completed -> resolveReviewThread mutation', async () => {
  const routes = [
    gqlRoute((url, init) => {
      const { query, variables } = JSON.parse(init.body);
      if (/resolveReviewThread/.test(query)) {
        assert.deepEqual(variables, { threadId: 'PRRT_1' });
        return res(200, { data: { resolveReviewThread: { thread: { id: 'PRRT_1', isResolved: true } } } });
      }
      return res(200, { data: { node: { comments: { nodes: [{ databaseId: 1001 }] } } } });
    }),
    { match: /\/repos\/acme\/api\/pulls\/42\/comments\/1001\/replies$/, method: 'POST', reply: res(201, { id: 1005 }) },
  ];
  const args = { status: 'completed', summary: 'All done', links: [{ title: 'Pull request', url: 'https://github.com/acme/api/pull/42' }] };

  const yes = fakeFetch(routes);
  await createPrCommentsSource(makeCtx({ token: 'tok', resolveOnComplete: 'yes' }), { fetch: yes }).reportResult('acme/api#42:thread:PRRT_1', args);
  const reply = yes.calls.find((c) => /\/replies$/.test(c.url));
  assert.match(JSON.parse(reply.init.body).body, /All done/);
  assert.match(JSON.parse(reply.init.body).body, /- \[Pull request\]\(https:\/\/github.com\/acme\/api\/pull\/42\)/);
  assert.ok(yes.calls.some((c) => /resolveReviewThread/.test(c.init.body || '')), 'must resolve the thread');
  const replyIdx = yes.calls.findIndex((c) => /\/replies$/.test(c.url));
  const resolveIdx = yes.calls.findIndex((c) => /resolveReviewThread/.test(c.init.body || ''));
  assert.ok(replyIdx < resolveIdx, 'reply is posted before resolving');

  const no = fakeFetch(routes);
  await createPrCommentsSource(makeCtx({ token: 'tok', resolveOnComplete: 'no' }), { fetch: no }).reportResult('acme/api#42:thread:PRRT_1', args);
  assert.ok(!no.calls.some((c) => /resolveReviewThread/.test(c.init.body || '')), 'resolveOnComplete=no must never resolve');

  const failed = fakeFetch(routes);
  await createPrCommentsSource(makeCtx({ token: 'tok', resolveOnComplete: 'yes' }), { fetch: failed }).reportResult('acme/api#42:thread:PRRT_1', { ...args, status: 'failed' });
  assert.ok(!failed.calls.some((c) => /resolveReviewThread/.test(c.init.body || '')), 'a failed run must not resolve');
});

test('reportResult: review/comment kinds post a PR conversation comment quoting the original; never resolve', async () => {
  const fetch = fakeFetch([
    gqlRoute(prReply(PR)),
    { match: /\/repos\/acme\/api\/issues\/42\/comments$/, method: 'POST', reply: res(201, { id: 9002 }) },
  ]);
  const src = createPrCommentsSource(makeCtx({ token: 'tok', resolveOnComplete: 'yes' }), { fetch });
  await src.reportResult('acme/api#42:review:501', { status: 'completed', summary: 'Split done', links: [] });
  const post = fetch.calls.find((c) => /issues\/42\/comments$/.test(c.url));
  assert.match(JSON.parse(post.init.body).body, /^> Re: review by @alice \(https:\/\/github.com\/acme\/api\/pull\/42#pullrequestreview-501\)\n\nSplit done/);
  assert.ok(!fetch.calls.some((c) => /resolveReviewThread/.test(c.init.body || '')));
});

test('capabilities: writeBack on; error kinds flow through (401 -> auth)', async () => {
  const src = createPrCommentsSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(401, {}) }]) });
  assert.deepEqual(src.capabilities(), { writeBack: true, incrementalSync: false });
  await assert.rejects(() => src.listTasks({ inputs: { repo: 'acme/api' } }), (e) => e.kind === 'auth');
});

// ── manifest ───────────────────────────────────────────────────────────────────
test('manifest: github-source declares both sources; each valid with one task-browser and listRepos allowlisted', () => {
  const raw = JSON.parse(readFileSync(new URL('../plugins/github-source/worca-cc-plugin.json', import.meta.url), 'utf8'));
  const r = normalizeManifest(raw, { dir: 'plugins/github-source' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, [], 'no unknown fields (--strict must stay clean)');
  const ids = r.manifest.taskSources.map((s) => s.id);
  assert.deepEqual(ids, ['github', 'github-pr-comments']);
  const pr = r.manifest.taskSources[1];
  assert.equal(pr.module, './connector/pr-comments.mjs');
  assert.deepEqual(pr.inputs.map((i) => i.type), ['remote-select', 'text', 'task-browser']);
  assert.equal(pr.inputs[0].optionsFrom, 'listRepos');
  assert.ok(pr.configSchema.some((f) => f.key === 'resolveOnComplete'));
  assert.ok(pr.configSchema.some((f) => f.key === 'token' && f.secret === true), 'token declared (shared bucket, D2)');
});
