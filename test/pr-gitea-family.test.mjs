// test/pr-gitea-family.test.mjs — src/core/pr/gitea-family.mjs through its three bindings (Gitea, Forgejo, Codeberg)
// over an injectable fetch answering trimmed real captures (test/helpers/fake-gitea.mjs): create with the open-PR
// recovery, view, find-by-branch, ready, close, comments, the metrics listing, the Watch PR snapshot and checks, the
// failed build log and thread replies in each flavour, and the rule that a token never leaves its host.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as gitea from '../src/core/pr/gitea.mjs';
import * as forgejo from '../src/core/pr/forgejo.mjs';
import * as codeberg from '../src/core/pr/codeberg.mjs';
import { prWatchSnapshot as giWatch, prWatchJobLog, _testing as gitInfo } from '../src/core/git-info.mjs';
import { FIX, res, fakeFetch, routesFor } from './helpers/fake-gitea.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const G = FIX.gitea; const F = FIX.forgejo;
const HOST = 'pgit.example.org';
const ENV = { WORCA_GITEA_HOSTS: HOST, WORCA_GITEA_READ_TOKEN_PGIT_EXAMPLE_ORG: 'read-tok', WORCA_GITEA_WRITE_TOKEN_PGIT_EXAMPLE_ORG: 'write-tok' };
const REPO = { name: 'origin', host: HOST, owner: 'tests', repo: 'worca-tests', forge: 'gitea' };
const API = `https://${HOST}/api/v1/repos/tests/worca-tests`;
const PR = (n) => `https://${HOST}/tests/worca-tests/pulls/${n}`;
// The fixtures were captured on tests/worca-tests (pgit) and mirinimi/worca-integration-test-repo (Codeberg): the
// Gitea PR bodies name tests/worca-tests as their head repository, so REPO above is "ours" to the fork check.
const FENV = { WORCA_FORGEJO_HOSTS: 'forge.example.org', WORCA_FORGEJO_TOKEN_FORGE_EXAMPLE_ORG: 'fj-tok' };
const FREPO = { host: 'forge.example.org', owner: 'mirinimi', repo: 'worca-integration-test-repo', forge: 'forgejo' };
const FAPI = 'https://forge.example.org/api/v1/repos/mirinimi/worca-integration-test-repo';
const FPR = (n) => `https://forge.example.org/mirinimi/worca-integration-test-repo/pulls/${n}`;
const CENV = { WORCA_CODEBERG_TOKEN: 'cb-tok' };
const CAPI = 'https://codeberg.org/api/v1/repos/mirinimi/worca-integration-test-repo';
const CPR = (n) => `https://codeberg.org/mirinimi/worca-integration-test-repo/pulls/${n}`;
const use = (mod, routes) => { const f = fakeFetch(routes); mod._testing.setFetch(f); return f; };
afterEach(() => { gitea._testing.reset(); forgejo._testing.reset(); codeberg._testing.reset(); gitInfo.reset(); });

test('Gitea PR provider: create, view, find, ready, close, comment, listing', async () => {
  await checkRows([
    { name: 'create: no PR for the pair (404 by branches, empty listing), POST with the WIP title; read then write token', run: async () => {
      const f = use(gitea, [...routesFor('gitea', API, { list: [] }), { match: new RegExp(`^${API}/pulls$`), method: 'POST', reply: res(201, { number: 9 }) }]);
      const r = await gitea.createPr({ base: 'master', head: 'feat/new', title: 'T', body: 'B', baseRepo: REPO, pushRepo: REPO, draft: true, env: ENV });
      assert.deepEqual(r, { ok: true, url: PR(9), number: 9, existed: false });
      const post = f.calls.find((c) => c.method === 'POST');
      assert.equal(f.calls[0].url, `${API}/pulls/master/feat/new`, 'plain names pass through unchanged');
      assert.equal(f.calls[0].headers.authorization, 'token read-tok');
      assert.equal(post.headers.authorization, 'token write-tok');
      assert.deepEqual(post.body, { head: 'feat/new', base: 'master', title: 'WIP: T', body: 'B' });
    } },
    { name: 'create: the by-branches answer settles it only when OPEN; a merged answer falls through to the listing', run: async () => {
      use(gitea, routesFor('gitea', API, { byBranches: G.prOpen }));
      assert.deepEqual(await gitea.createPr({ base: 'master', head: 'feat/failing', title: 'T', baseRepo: REPO, env: ENV }), { ok: true, url: PR(3), number: 3, existed: true });
      const f = use(gitea, [...routesFor('gitea', API, { byBranches: G.prMerged, list: [G.prMerged] }), { match: new RegExp(`^${API}/pulls$`), method: 'POST', reply: res(201, { number: 10 }) }]);
      assert.deepEqual(await gitea.createPr({ base: 'master', head: 'feat/clean', title: 'T', baseRepo: REPO, env: ENV }), { ok: true, url: PR(10), number: 10, existed: false });
      assert.ok(f.calls.some((c) => /\/pulls\?state=all&sort=recentupdate&head=feat%2Fclean/.test(c.url)), 'the listing carries the head filter (Forgejo narrows on it, Gitea ignores it)');
    } },
    { name: 'create: a base with a slash skips the by-branches read; 409 recovers the open PR; 404 head, fork and no token are refusals', run: async () => {
      const g = use(gitea, [...routesFor('gitea', API, { list: [] }), { match: new RegExp(`^${API}/pulls$`), method: 'POST', reply: res(201, { number: 11 }) }]);
      await gitea.createPr({ base: 'v1.0', head: 'fix/#12 50%', title: 'T', baseRepo: REPO, env: ENV });
      assert.equal(g.calls[0].url, `${API}/pulls/v1.0/fix/%2312%2050%25`, 'each segment encoded, the slash kept');
      const f = use(gitea, [...routesFor('gitea', API, { list: [G.prOpen] })]);
      await gitea.createPr({ base: 'release/1.x', head: 'feat/failing', title: 'T', baseRepo: REPO, env: ENV });
      assert.ok(f.calls.every((c) => !/\/pulls\/release/.test(c.url)));
      use(gitea, [...routesFor('gitea', API, { list: [G.prOpen] }), { match: new RegExp(`^${API}/pulls$`), method: 'POST', reply: res(409, G.errors['pr-create-duplicate']) }]);
      assert.deepEqual(await gitea.createPr({ base: 'master', head: 'feat/failing', title: 'T', baseRepo: REPO, env: ENV }), { ok: true, url: PR(3), number: 3, existed: true });
      use(gitea, [...routesFor('gitea', API, { list: [] }), { match: new RegExp(`^${API}/pulls$`), method: 'POST', reply: res(404, G.errors['pr-create-missing-head']) }]);
      const miss = await gitea.createPr({ base: 'master', head: 'feat/nope', title: 'T', baseRepo: REPO, env: ENV });
      assert.deepEqual([miss.ok, miss.kind], [false, 'failed']); assert.match(miss.error, /^Gitea 404: ref "feat\/nope" does not exist/);
      const fork = await gitea.createPr({ base: 'master', head: 'x', title: 'T', baseRepo: REPO, pushRepo: { ...REPO, owner: 'me' }, env: ENV });
      assert.deepEqual([fork.ok, fork.kind], [false, 'unsupported']); assert.match(fork.error, /Gitea pull requests between repositories/);
      const none = await gitea.createPr({ base: 'master', head: 'x', title: 'T', baseRepo: REPO, env: { WORCA_GITEA_HOSTS: HOST } });
      assert.deepEqual([none.ok, none.kind], [false, 'auth']); assert.match(none.error, /no Gitea credential for pgit\.example\.org: list the host/);
      const other = await gitea.createPr({ base: 'master', head: 'x', title: 'T', baseRepo: { ...REPO, host: 'other.org' }, env: ENV });
      assert.deepEqual(other, { ok: false, kind: 'failed', error: 'the base remote is not a Gitea repository' });
    } },
    { name: 'view: state, draft and the server\'s merge verdict; CLOSED unmerged; 404 → null', run: async () => {
      use(gitea, routesFor('gitea', API, { pr: G.prDraft }));
      assert.deepEqual(await gitea.viewPr({ prUrl: PR(2), env: ENV }), { state: 'OPEN', url: PR(2), number: 2, isDraft: true, mergeable: 'CONFLICTING' });
      use(gitea, routesFor('gitea', API, { pr: G.prMerged }));
      assert.deepEqual(await gitea.viewPr({ prUrl: PR(1), env: ENV }), { state: 'MERGED', url: PR(1), number: 1, isDraft: false, mergeable: 'UNKNOWN' });
      use(gitea, routesFor('gitea', API, { pr: G.prClosed }));
      assert.equal((await gitea.viewPr({ prUrl: PR(3), env: ENV })).state, 'CLOSED');
      use(gitea, [{ match: /./, reply: res(404, G.errors['pr-get-missing']) }]);
      assert.equal(await gitea.viewPr({ prUrl: PR(99), env: ENV }), null);
      assert.equal(await gitea.viewPr({ prUrl: 'https://other.org/a/b/pulls/1', env: ENV }), null);
    } },
    { name: 'findPrForBranch: OPEN first, then MERGED, CLOSED only when asked; matched by head here', run: async () => {
      use(gitea, routesFor('gitea', API, { list: [G.prClosed, G.prMerged, { ...G.prOpen, head: { ...G.prOpen.head, ref: 'feat/clean' } }] }));
      assert.equal((await gitea.findPrForBranch({ head: 'feat/clean', baseRepo: REPO, env: ENV })).state, 'OPEN');
      use(gitea, routesFor('gitea', API, { list: [G.prClosed, G.prMerged] }));
      assert.equal((await gitea.findPrForBranch({ head: 'feat/clean', baseRepo: REPO, env: ENV })).state, 'MERGED');
      assert.equal(await gitea.findPrForBranch({ head: 'feat/failing', baseRepo: REPO, env: ENV }), null, 'closed and unmerged: not without includeClosed');
      assert.equal((await gitea.findPrForBranch({ head: 'feat/failing', baseRepo: REPO, includeClosed: true, env: ENV })).state, 'CLOSED');
      const fork = { ...G.prOpen, head: { ...G.prOpen.head, repo: { full_name: 'someone/worca-tests', private: false } } };
      use(gitea, routesFor('gitea', API, { list: [fork] }));
      assert.equal(await gitea.findPrForBranch({ head: 'feat/failing', baseRepo: REPO, env: ENV }), null, 'a fork\'s same-named branch is not ours');
    } },
    { name: 'markReady drops the WIP prefix; a ready PR is a no-op; a custom prefix is left alone', run: async () => {
      const f = use(gitea, [...routesFor('gitea', API, { pr: G.prDraft }), { match: new RegExp(`^${API}/pulls/2$`), method: 'PATCH', reply: res(201, {}) }]);
      assert.deepEqual(await gitea.markReady({ prUrl: PR(2), env: ENV }), { ok: true });
      assert.deepEqual(f.calls.find((c) => c.method === 'PATCH').body, { title: 'Change line A' });
      const g = use(gitea, routesFor('gitea', API, { pr: G.prOpen }));
      assert.deepEqual(await gitea.markReady({ prUrl: PR(3), env: ENV }), { ok: true }); assert.equal(g.calls.length, 1);
      use(gitea, routesFor('gitea', API, { pr: { ...G.prDraft, title: 'Draft: x' } }));
      assert.match((await gitea.markReady({ prUrl: PR(2), env: ENV })).error, /prefix worca does not know/);
    } },
    { name: 'closePr comments first, then PATCHes state closed; prComment posts the body as is', run: async () => {
      const f = use(gitea, [...routesFor('gitea', API), { match: new RegExp(`^${API}/issues/3/comments$`), method: 'POST', reply: res(201, {}) }, { match: new RegExp(`^${API}/pulls/3$`), method: 'PATCH', reply: res(201, {}) }]);
      assert.deepEqual(await gitea.closePr({ prUrl: PR(3), comment: 'why <!-- worca:pr-watch -->', env: ENV }), { ok: true });
      assert.deepEqual(f.calls.map((c) => [c.method, c.url.slice(API.length), c.body]), [['POST', '/issues/3/comments', { body: 'why <!-- worca:pr-watch -->' }], ['PATCH', '/pulls/3', { state: 'closed' }]]);
      use(gitea, [{ match: /./, reply: res(401, G.errors['auth-bad-token']) }]);
      assert.deepEqual(await gitea.prComment({ prUrl: PR(3), body: 'x', env: ENV }), { ok: false, class: 'auth', error: 'Gitea pgit.example.org refused the token (expired, revoked, or missing a scope)' });
      use(gitea, [{ match: /./, reply: res(429, { message: 'slow down' }) }]);
      assert.equal((await gitea.prComment({ prUrl: PR(3), body: 'x', env: ENV })).class, 'rate-limit');
    } },
    { name: 'listPullRequestsForBranches: one listing, matched by head, forks out; mergedAt: merged_at, the merge commit, updated_at', run: async () => {
      use(gitea, routesFor('gitea', API, { list: [G.prMerged, G.prDraft, G.prOpen] }));
      const r = await gitea.listPullRequestsForBranches(REPO, ['feat/clean', 'feat/conflict', 'nope'], { env: ENV });
      assert.deepEqual([r.complete, r.prs.map((p) => p.number)], [true, [1, 2]]);
      assert.equal(await gitea.mergedAt(REPO, G.prMerged, { env: ENV }), G.prMerged.merged_at);
      assert.equal(await gitea.mergedAt(REPO, { ...G.prMerged, merged_at: null }, { env: ENV }), '2026-11-11T10:00:31Z');
      assert.equal(await gitea.mergedAt(REPO, { merged_at: null, merge_commit_sha: null, updated_at: '2026-01-01T00:00:00Z' }, { env: ENV }), '2026-01-01T00:00:00Z');
    } },
    { name: 'the token goes to the host\'s API only; available() per host', run: async () => {
      use(gitea, [{ match: /./, reply: res(200, {}) }]);
      await assert.rejects(gitea._testing.apiFetch('read', HOST, 'https://evil.org/api/v1/x', { env: ENV }), { kind: 'failed', message: 'not a Gitea API URL on pgit.example.org' });
      await assert.rejects(gitea._testing.apiFetch('read', HOST, `https://${HOST}.evil.org/api/v1/x`, { env: ENV }), /not a Gitea API URL/);
      await assert.rejects(gitea._testing.apiFetch('read', 'evil.org', 'https://evil.org/api/v1/x', { env: ENV }), { kind: 'failed', message: 'evil.org is not a Gitea host worca knows' });
      assert.deepEqual(await gitea.available({ host: HOST, env: ENV }), { ok: true });
      assert.match((await gitea.available({ host: 'git.example.org', env: ENV })).reason, /^Gitea host git\.example\.org has no token: set WORCA_GITEA_TOKEN_GIT_EXAMPLE_ORG/);
      assert.match((await gitea.available({ env: {} })).reason, /^Gitea is not configured/);
      assert.deepEqual(await codeberg.available({ env: CENV }), { ok: true });
    } },
  ]);
});

const HEAD = G.prOpen.head.sha; const BASE = G.prOpen.base.sha;
test('Watch PR on the family: snapshot, checks, build log and replies in both flavours', async () => {
  await checkRows([
    { name: 'gitea snapshot: facts, statuses as checks (run link) or statuses, newest per context, base results and behind on a failure', run: async () => {
      const f = use(gitea, routesFor('gitea', API, { statuses: { [HEAD]: G.statuses, [BASE]: [{ id: 1, context: 'ci/lint', status: 'success', target_url: null }] } }));
      const snap = await gitea.prWatchSnapshot({ prUrl: PR(3), env: ENV });
      assert.equal(snap.ok, true, snap.error);
      const { contexts, threads, reviews, ...facts } = snap.pr;
      assert.deepEqual(facts, { url: PR(3), state: 'OPEN', branch: 'feat/failing', base: 'master', author: { login: 'mirinimi' }, headSha: HEAD, baseSha: BASE,
        mergeable: 'MERGEABLE', behindBy: 2, baseFailing: [], basePassing: ['ci/lint'], basePending: [], baseSettled: true });
      assert.deepEqual(contexts.map((c) => [c.type, c.databaseId ?? c.context, c.type === 'check' ? c.conclusion : c.state, c.name ?? null]),
        [['status', 'ci/worca', 'SUCCESS', null], ['status', 'ci/lint', 'FAILURE', null], ['check', 1945, null, 'echo / echo (pull_request)'], ['check', 1940, 'SUCCESS', 'echo / echo (push)']],
        'the newest status per context wins (ci/worca pending → success); Actions job statuses are checks keyed by the run in their link');
      assert.deepEqual(threads, [{ nodeId: 1721, isResolved: false, comments: [{ databaseId: 1721, body: 'Inline: consider a trailing newline check.', author: { login: 'mirinimi' }, authorAssociation: 'MEMBER' }] },
        { nodeId: 'c1720', isResolved: false, comments: [{ databaseId: 1720, body: 'A plain PR comment from worca (edited).', author: { login: 'mirinimi' }, authorAssociation: 'MEMBER' }] }],
        'a private repository trusts every commenter; PR-level comments are c-threads');
      assert.deepEqual(reviews, []);
      assert.ok(f.calls.some((c) => c.url.includes('/compare/')), 'a failing check reads how far behind the PR is');
    } },
    { name: 'snapshot: trust on a public repository, a request-changes review, a resolved old-side thread, a closed PR', run: async () => {
      const pub = { ...G.prOpen, base: { ...G.prOpen.base, repo: { full_name: 'tests/worca-tests', private: false } }, requested_reviewers: [{ login: 'rev' }] };
      const reviews = [...G.reviews, { id: 6, state: 'REQUEST_CHANGES', body: 'rename it', dismissed: false, comments_count: 1, user: { login: 'rev' } }, { id: 7, state: 'APPROVED', body: '', dismissed: false, comments_count: 0, user: { login: 'stranger' } }];
      const old = { ...G.oldSideComments[0], resolver: { login: 'rev' }, user: { login: 'stranger' } };
      use(gitea, routesFor('gitea', API, { pr: pub, statuses: { [HEAD]: [] }, reviews, reviewComments: { 4: G.reviewComments, 6: [old] } }));
      const snap = await gitea.prWatchSnapshot({ prUrl: PR(3), env: ENV });
      assert.equal(snap.ok, true, snap.error);
      assert.deepEqual(snap.pr.threads.map((t) => [t.nodeId, t.isResolved, t.comments.map((c) => c.authorAssociation)]), [[1721, false, ['MEMBER']], [1729, true, ['NONE']], ['c1720', false, ['MEMBER']]],
        'the author and requested reviewers are MEMBER, a stranger NONE; an old-side comment is its own thread, resolved by its resolver');
      assert.deepEqual(snap.pr.reviews, [{ databaseId: 6, state: 'CHANGES_REQUESTED', body: 'rename it', author: { login: 'rev' }, authorAssociation: 'MEMBER' }]);
      assert.deepEqual([snap.pr.behindBy, snap.pr.baseSettled], [0, true], 'no failure: no base read');
      use(gitea, routesFor('gitea', API, { pr: G.prMerged }));
      assert.deepEqual(await gitea.prWatchSnapshot({ prUrl: PR(1), env: ENV }), { ok: true, pr: { url: PR(1), state: 'MERGED', branch: 'feat/clean', base: 'master', author: { login: 'mirinimi' }, headSha: G.prMerged.head.sha, contexts: [], threads: [], reviews: [] } });
    } },
    { name: 'prCheckFacts: items in GitHub\'s terms, the review decision, draft and base; null when closed or failing', run: async () => {
      const reviews = [{ id: 6, state: 'REQUEST_CHANGES', body: 'x', dismissed: false, comments_count: 0, user: { login: 'rev' } }, { id: 8, state: 'APPROVED', body: '', dismissed: false, comments_count: 0, user: { login: 'rev' } }];
      use(gitea, routesFor('gitea', API, { pr: G.prDraft, statuses: { [G.prDraft.head.sha]: G.statuses.slice(0, 2) }, reviews }));
      const facts = await gitea.prCheckFacts({ prUrl: PR(2), env: ENV });
      assert.deepEqual(facts, { items: [{ __typename: 'StatusContext', context: 'ci/worca', state: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci/lint', state: 'FAILURE' }],
        mergeable: 'CONFLICTING', mergeState: null, reviewDecision: 'APPROVED', draft: true, base: 'master', baseFailing: [] }, 'a user\'s newest review counts: the approval after the request');
      use(gitea, routesFor('gitea', API, { pr: G.prClosed }));
      assert.equal(await gitea.prCheckFacts({ prUrl: PR(3), env: ENV }), null);
    } },
    { name: 'failedBuildLog: Gitea finds the run by the id in the status link, the failed job\'s step from the job list, the log tail', run: async () => {
      use(gitea, routesFor('gitea', API));
      const r = await gitea.failedBuildLog({ prUrl: PR(3), databaseId: 1950, env: ENV });
      assert.equal(r.ok, true, r.error);
      assert.match(r.text, /^## fail › Run echo "this job fails on purpose" && exit 1\n/);
      assert.match(r.text, /job 'fail' failed\s*$/);
      assert.match((await gitea.failedBuildLog({ prUrl: PR(3), databaseId: 4242, env: ENV })).error, /Actions run #4242 not found/);
      assert.deepEqual(await gitea.requeueEvaluation({ prUrl: PR(3), env: ENV }), { ok: false, class: 'failed', error: 'Gitea checks cannot be re-run from worca' });
    } },
    { name: 'failedBuildLog: Forgejo finds the run by index_in_repo, reads the job for its steps, same log shape', run: () => withEnv(FENV, async () => {
      use(forgejo, routesFor('forgejo', FAPI));
      const r = await forgejo.failedBuildLog({ prUrl: FPR(3), databaseId: 20 });
      assert.equal(r.ok, true, r.error);
      assert.match(r.text, /^## fail › echo "this job fails on purpose" && exit 1\n/);
      assert.match(r.text, /Job 'fail' failed\s*$/);
    }) },
    { name: 'forgejo snapshot: the same shape from Codeberg\'s bodies; checks keyed by index_in_repo', run: () => withEnv(FENV, async () => {
      use(forgejo, routesFor('forgejo', FAPI, { statuses: { [F.prOpen.head.sha]: F.statuses } }));
      const snap = await forgejo.prWatchSnapshot({ prUrl: FPR(3) });
      assert.equal(snap.ok, true, snap.error);
      assert.deepEqual(snap.pr.contexts.map((c) => [c.type, c.databaseId, c.conclusion]), [['check', 20, 'FAILURE'], ['check', 19, 'SUCCESS'], ['check', 17, 'FAILURE'], ['check', 16, 'SUCCESS']]);
      assert.deepEqual(snap.pr.baseFailing, [], 'the base sha had no statuses routed');
    }) },
    { name: 'replyToThread: Gitea answers with a new review on the root\'s path and line; old side → old_position', run: async () => {
      const f = use(gitea, [...routesFor('gitea', API, { reviews: [...G.reviews, { id: 6, state: 'COMMENT', body: '', dismissed: false, comments_count: 1, user: { login: 'mirinimi' } }], reviewComments: { 4: G.reviewComments, 6: G.oldSideComments } }),
        { match: new RegExp(`^${API}/pulls/3/reviews$`), method: 'POST', reply: res(200, { id: 9 }) }]);
      assert.deepEqual(await gitea.replyToThread({ prUrl: PR(3), threadId: 1721, body: 'done', env: ENV }), { ok: true });
      assert.deepEqual(f.calls.at(-1).body, { event: 'COMMENT', body: '', comments: [{ path: 'clean.txt', body: 'done', new_position: 1 }] });
      await gitea.replyToThread({ prUrl: PR(3), threadId: '1729', body: 'old', env: ENV });
      assert.deepEqual(f.calls.at(-1).body.comments, [{ path: 'README.md', body: 'old', old_position: 5 }]);
      assert.match((await gitea.replyToThread({ prUrl: PR(3), threadId: 4242, body: 'x', env: ENV })).error, /review comment 4242 not found/);
      assert.equal((await gitea.replyToThread({ prUrl: PR(3), threadId: 'x1', body: 'x', env: ENV })).error, 'invalid thread reply request');
    } },
    { name: 'replyToThread: a c-thread is a PR-level comment; Forgejo adds the reply to the existing review', run: () => withEnv(FENV, async () => {
      const f = use(gitea, [...routesFor('gitea', API), { match: new RegExp(`^${API}/issues/3/comments$`), method: 'POST', reply: res(201, {}) }]);
      assert.deepEqual(await gitea.replyToThread({ prUrl: PR(3), threadId: 'c1720', body: 'top', env: ENV }), { ok: true });
      assert.deepEqual([f.calls.at(-1).method, f.calls.at(-1).body], ['POST', { body: 'top' }]);
      const g = use(forgejo, [...routesFor('forgejo', FAPI), { match: new RegExp(`^${FAPI}/pulls/3/reviews/2293236/comments$`), method: 'POST', reply: res(200, { id: 1 }) }]);
      assert.deepEqual(await forgejo.replyToThread({ prUrl: FPR(3), threadId: 27615336, body: 'done' }), { ok: true });
      assert.deepEqual(g.calls.at(-1).body, { path: 'clean.txt', body: 'done', new_position: 1 });
    }) },
    { name: 'codeberg binding: the fixed host, WORCA_CODEBERG_* tokens, the Forgejo flavour', run: () => withEnv(CENV, async () => {
      const f = use(codeberg, routesFor('forgejo', CAPI, { pr: F.prDraft }));
      assert.deepEqual(await codeberg.viewPr({ prUrl: CPR(2) }), { state: 'OPEN', url: CPR(2), number: 2, isDraft: true, mergeable: 'CONFLICTING' });
      assert.equal(f.calls[0].headers.authorization, 'token cb-tok');
      assert.match(codeberg.forkRefusal({ name: 'origin' }), /^Codeberg pull requests between repositories/);
      assert.equal(await codeberg.viewPr({ prUrl: FPR(2) }), null, 'a Forgejo host is not Codeberg');
    }) },
    { name: 'git-info dispatches a family PR URL to its binding', run: () => withEnv({ ...ENV, ...FENV }, async () => {
      use(gitea, routesFor('gitea', API, { statuses: { [HEAD]: [] } }));
      const snap = await giWatch({ prUrl: PR(3) });
      assert.equal(snap.ok, true, snap.error); assert.equal(snap.pr.branch, 'feat/failing');
      use(forgejo, routesFor('forgejo', FAPI));
      const log = await prWatchJobLog({ prUrl: FPR(3), databaseId: 20 });
      assert.equal(log.ok, true, log.error); assert.match(log.text, /Job 'fail' failed/);
    }) },
  ]);
});
