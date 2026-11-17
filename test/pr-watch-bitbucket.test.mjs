// test/pr-watch-bitbucket.test.mjs — the Bitbucket adapter behind Watch PR (#619 parity). Every REST call goes through
// pr/bitbucket.mjs's injectable fetch (a fake api.bitbucket.org), so nothing here reaches bitbucket.org.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as bb from '../src/core/pr/bitbucket.mjs';
import { prWatchSnapshot, prWatchJobLog, prWatchReply, prWatchComment, prChecks, PR_WATCH_LOG_BYTES, _testing as gitInfo } from '../src/core/git-info.mjs';
import { collectTriggers, replyBody, fixSummary, WATCH_MARKER } from '../src/core/pr-watch.mjs';
import { withEnv } from './helpers/with-env.mjs';

const PR = 'https://bitbucket.org/acme/api/pull-requests/12';
const API = 'https://api.bitbucket.org/2.0/repositories/acme/api';
const ENV = { WORCA_BB_READ_TOKEN: 'read-tok', WORCA_BB_WRITE_TOKEN: 'write-tok' };
const HEAD = 'a'.repeat(40); const BASE = 'b'.repeat(40);
const ME = '{me}'; const REV = '{rev}'; const STRANGER = '{x}';
const res = (status, body, { location = null, text = null } = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) }, json: async () => body, text: async () => (text ?? JSON.stringify(body)) });
function fakeFetch(routes) {
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
afterEach(() => { bb._testing.reset(); gitInfo.reset(); });

const prBody = (extra = {}) => ({ id: 12, state: 'OPEN', draft: false, title: 'T',
  source: { branch: { name: 'feat/x' }, commit: { hash: HEAD.slice(0, 12) }, repository: { full_name: 'acme/api' } },
  destination: { branch: { name: 'main' } }, author: { uuid: ME },
  reviewers: [{ uuid: REV }], participants: [{ user: { uuid: REV, display_name: 'Rev' }, state: 'changes_requested' }, { user: { uuid: ME }, state: 'approved' }],
  ...extra });
const comments = [
  { id: 1, content: { raw: 'please rename' }, user: { uuid: REV } },
  { id: 2, content: { raw: 'and this' }, user: { uuid: STRANGER }, parent: { id: 1 } },
  { id: 3, content: { raw: 'done already' }, user: { uuid: REV }, resolution: { type: 'resolved' } },
  { id: 4, content: { raw: 'draft' }, user: { uuid: REV }, pending: true },
  { id: 5, content: { raw: 'gone' }, user: { uuid: REV }, deleted: true, parent: { id: 1 } },
];
function routes({ pr = prBody(), priv = false, conflicts = [], headStatuses, baseStatuses = [], behind = 2 } = {}) {
  // Pipelines names a status after its build and (in this form) links the legacy result page.
  const hs = headStatuses || [
    { key: '{pipe-41}', name: 'Pipeline #41 for feat/x', state: 'FAILED', url: 'https://bitbucket.org/acme/api/addon/pipelines/home#!/results/41' },
    { key: 'sonar', name: 'Sonar', state: 'SUCCESSFUL', url: 'https://sonar.example.com/x' },
  ];
  return [
    { match: /\/pullrequests\/12$/, reply: res(200, pr) },
    { match: /\/refs\/branches\?q=/, reply: (u) => res(200, { values: [decodeURIComponent(u).includes('"main"')
      ? { name: 'main', target: { hash: BASE } } : { name: 'feat/x', target: { hash: HEAD } }] }) },
    { match: new RegExp(`/commit/${HEAD}/statuses`), reply: res(200, { values: hs }) },
    { match: new RegExp(`/commit/${BASE}/statuses`), reply: res(200, { values: baseStatuses }) },
    { match: /\/pullrequests\/12\/comments\?/, reply: res(200, { values: comments }) },
    { match: /\/repositories\/acme\/api\?fields=is_private$/, reply: res(200, { is_private: priv }) },
    { match: /\/pullrequests\/12\/conflicts\?/, reply: res(200, { values: conflicts }) },
    { match: /\/commits\?include=/, reply: res(200, { values: Array.from({ length: behind }, (_, i) => ({ hash: String(i) })) }) },
  ];
}

test('snapshot: facts with FULL shas, statuses as checks, threads by root, trust and reviews in the watcher\'s shape', async () => {
  const f = fakeFetch(routes());
  bb._testing.setFetch(f);
  const snap = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.ok, true, snap.error);
  const { contexts, threads, reviews, ...facts } = snap.pr;
  assert.deepEqual(facts, { url: PR, state: 'OPEN', branch: 'feat/x', base: 'main', author: { login: ME }, headSha: HEAD, baseSha: BASE,
    mergeable: 'MERGEABLE', behindBy: 2, baseFailing: [], basePassing: [], basePending: [], baseSettled: true });
  assert.deepEqual(contexts.map((c) => [c.type, c.databaseId ?? c.context, c.conclusion ?? c.state, c.runId ?? null, c.isRequired]),
    [['check', 41, 'FAILURE', null, false], ['status', 'Sonar', 'SUCCESS', null, false]]);
  assert.equal(contexts[0].name, bb.PIPELINES_CHECK, 'a Pipelines status has one stable name, whatever its build number');
  assert.deepEqual(threads.map((t) => [t.nodeId, t.isResolved, t.comments.map((c) => [c.databaseId, c.authorAssociation])]),
    [[1, false, [[1, 'MEMBER'], [2, 'NONE']]], [3, true, [[3, 'MEMBER']]]], 'public repo: a stranger is NONE; drafts and deleted comments are out');
  assert.deepEqual(reviews, [{ databaseId: `${REV}:changes_requested`, state: 'CHANGES_REQUESTED', body: 'Rev requested changes.',
    author: { login: REV }, authorAssociation: 'MEMBER' }]);
  for (const c of f.calls) { assert.equal(c.method, 'GET'); assert.equal(c.headers.authorization, 'Bearer read-tok'); }
});

test('snapshot: a private repository trusts every commenter; a file conflict makes Resolve fire', async () => {
  bb._testing.setFetch(fakeFetch(routes({ priv: true, conflicts: [{ path: 'CHANGELOG.md', scenario: 'content' }] })));
  const snap = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.pr.threads[0].comments[1].authorAssociation, 'MEMBER');
  assert.equal(snap.pr.mergeable, 'CONFLICTING');
  const t = collectTriggers(snap.pr, []);
  assert.deepEqual(t.conflict, { base: 'main', baseSha: BASE });
  assert.deepEqual(t.handledKeys, [`conflict:${HEAD}@${BASE}`]);
});

test('triggers: the failing Pipelines check and the trusted comments fire; the stranger never does; no re-run is asked', async () => {
  bb._testing.setFetch(fakeFetch(routes()));
  const { pr } = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  const t = collectTriggers(pr, []);
  assert.equal(t.fire, true);
  assert.deepEqual(t.reruns, []);
  assert.deepEqual(t.failures.map((c) => c.databaseId), [41]);
  assert.deepEqual(t.threads.map((x) => x.commentIds), [[1]]);
  assert.deepEqual(t.reviews.map((r) => r.databaseId), [`${REV}:changes_requested`]);
});

test('snapshot: a Pipelines failure that also fails on the base head (another build number) is skipped; a running base holds it back', async () => {
  const basePipe = (state) => [{ key: '{pipe-40}', name: 'Pipeline #40 for main', state, url: 'https://bitbucket.org/acme/api/pipelines/results/40' }];
  bb._testing.setFetch(fakeFetch(routes({ baseStatuses: basePipe('FAILED') })));
  const a = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.deepEqual(a.pr.baseFailing, [bb.PIPELINES_CHECK]);
  assert.deepEqual(collectTriggers(a.pr, []).skipped, [bb.PIPELINES_CHECK]);
  bb._testing.setFetch(fakeFetch(routes({ baseStatuses: basePipe('INPROGRESS') })));
  const b = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(b.pr.baseSettled, false);
  assert.deepEqual(collectTriggers(b.pr, []).waitingOnBase, [bb.PIPELINES_CHECK]);
});

test('statuses: the newest Pipelines build of a commit wins; only this repository\'s result links are checks', async () => {
  const f = fakeFetch(routes({ headStatuses: [
    { key: '{pipe-41}', name: 'Pipeline #41 for feat/x', state: 'FAILED', url: 'https://bitbucket.org/acme/api/pipelines/results/41' },
    { key: '{pipe-42}', name: 'Pipeline #42 for feat/x', state: 'SUCCESSFUL', url: 'https://bitbucket.org/acme/api/pipelines/results/42' },
    { key: 'other', name: 'Other repo', state: 'FAILED', url: 'https://bitbucket.org/someone/else/pipelines/results/7' },
  ] }));
  bb._testing.setFetch(f);
  const { pr } = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.deepEqual(pr.contexts.map((c) => [c.type, c.databaseId ?? c.context, c.conclusion ?? c.state]),
    [['check', 42, 'SUCCESS'], ['status', 'Other repo', 'FAILURE']], 'a re-run (#42) replaces the failed #41');
  assert.deepEqual(collectTriggers(pr, []).failures.map((c) => c.context), ['Other repo']);
});

test('poll budget: no failure → no base-head or behind reads; visibility and the merge verdict are read once', async () => {
  const f = fakeFetch(routes({ headStatuses: [{ key: 'sonar', name: 'Sonar', state: 'SUCCESSFUL', url: 'https://sonar.example.com/x' }] }));
  bb._testing.setFetch(f);
  const first = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.deepEqual([first.pr.behindBy, first.pr.baseSettled, first.pr.mergeable], [0, true, 'MERGEABLE']);
  await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  const count = (re) => f.calls.filter((c) => re.test(c.url)).length;
  assert.equal(count(new RegExp(`/commit/${BASE}/statuses`)), 0);
  assert.equal(count(/\/commits\?include=/), 0);
  assert.equal(count(/\?fields=is_private$/), 1);
  assert.equal(count(/\/conflicts\?/), 1);
  assert.equal(count(/\/pullrequests\/12$/), 2, 'the PR itself is read on every poll');
});

test('trust: an app user is never MEMBER; a comment without a user never matches a PR author without one', async () => {
  const bot = [{ id: 7, content: { raw: 'Snyk found 2 issues' }, user: { uuid: '{bot}', type: 'app_user' } }];
  const f = fakeFetch([{ match: /\/pullrequests\/12\/comments\?/, reply: res(200, { values: bot }) }, ...routes({ priv: true })]);
  bb._testing.setFetch(f);
  const a = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(a.pr.threads[0].comments[0].authorAssociation, 'NONE');
  const anon = [{ id: 8, content: { raw: 'fix this' }, user: { display_name: 'Former user' } }];
  bb._testing.setFetch(fakeFetch([{ match: /\/pullrequests\/12\/comments\?/, reply: res(200, { values: anon }) },
    ...routes({ pr: prBody({ author: {} }) })]));
  const b = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(b.pr.author.login, null);
  assert.deepEqual(collectTriggers(b.pr, []).threads, [], 'a public-repo comment from nobody never counts');
});

test('failure classes: 429 → rate-limit (never swallowed by a best-effort read), 401/403 → auth, 404 → failed', async () => {
  for (const [status, cls] of [[429, 'rate-limit'], [401, 'auth'], [403, 'auth'], [404, 'failed']]) {
    bb._testing.setFetch(fakeFetch([{ match: /./, reply: res(status, {}) }]));
    assert.equal((await bb.prWatchSnapshot({ prUrl: PR, env: ENV })).class, cls, String(status));
  }
  const base = routes();
  bb._testing.setFetch(fakeFetch([{ match: /\?fields=is_private$/, reply: res(429, {}) }, ...base]));
  assert.equal((await bb.prWatchSnapshot({ prUrl: PR, env: ENV })).class, 'rate-limit');
});

test('build log: the pipeline by build number, its failed steps\' log tails; a storage redirect gets no credential', async () => {
  const f = fakeFetch([
    { match: /\/pipelines\/41$/, reply: res(200, { build_number: 41, uuid: '{p-41}' }) },
    { match: /\/steps\/\?pagelen/, reply: res(200, { values: [
      { uuid: '{s1}', name: 'Build', state: { result: { name: 'SUCCESSFUL' } } },
      { uuid: '{s2}', name: 'Test', state: { result: { name: 'FAILED' } } }] }) },
    { match: /\/steps\/%7Bs2%7D\/log$/, reply: res(307, null, { location: 'https://logs.example-storage.net/s2' }) },
    { match: /^https:\/\/logs\.example-storage\.net\/s2$/, reply: res(200, null, { text: 'setup\nexpected 1 got 2\n' }) },
  ]);
  bb._testing.setFetch(f);
  const r = await bb.failedBuildLog({ prUrl: PR, databaseId: 41, env: ENV });
  assert.deepEqual(r, { ok: true, text: '## Test\nsetup\nexpected 1 got 2\n' });
  assert.equal('authorization' in f.calls.at(-1).headers, false);
  assert.equal((await bb.failedBuildLog({ prUrl: PR, databaseId: 0, env: ENV })).ok, false);
});

test('reply and comment post with the write token: a reply under the root comment, a comment at PR level', async () => {
  const f = fakeFetch([{ match: /\/pullrequests\/12\/comments$/, method: 'POST', reply: res(201, { id: 9 }) }]);
  bb._testing.setFetch(f);
  assert.deepEqual(await bb.replyToThread({ prUrl: PR, threadId: 1, body: 'fixed', env: ENV }), { ok: true });
  assert.deepEqual(await bb.prComment({ prUrl: PR, body: 'done', env: ENV }), { ok: true });
  assert.deepEqual(f.calls.map((c) => c.body), [{ content: { raw: 'fixed' }, parent: { id: 1 } }, { content: { raw: 'done' } }]);
  for (const c of f.calls) assert.equal(c.headers.authorization, 'Bearer write-tok');
  assert.equal((await bb.replyToThread({ prUrl: PR, threadId: 'T_node', body: 'x', env: ENV })).ok, false);
});

test('a watch reply hides its marker and renders its list on Bitbucket, and still reads back as worca\'s own', async () => {
  assert.equal(bb.HTML_WATCH_MARKER, WATCH_MARKER, 'the adapter mirrors pr-watch\'s marker');
  const f = fakeFetch([{ match: /\/pullrequests\/12\/comments$/, method: 'POST', reply: res(201, { id: 9 }) }]);
  bb._testing.setFetch(f);
  const body = replyBody({ summary: fixSummary('da672aeffff', ['second', 'first']) });
  assert.deepEqual(await bb.replyToThread({ prUrl: PR, threadId: 1, body, env: ENV }), { ok: true });
  assert.deepEqual(await bb.prComment({ prUrl: PR, body, env: ENV }), { ok: true });
  const sent = `${bb.BB_WATCH_MARKER}\nWorca pushed da672ae to address this:\n\n- first\n- second`;
  assert.deepEqual(f.calls.map((c) => c.body.content.raw), [sent, sent], 'Bitbucket escapes HTML comments and needs a blank line before a list');
  // Read back: worca's reply from the PR author's own account in a private repo is MEMBER, so only the marker keeps it out.
  const own = [{ id: 9, content: { raw: sent }, user: { uuid: ME } }];
  bb._testing.setFetch(fakeFetch([{ match: /\/pullrequests\/12\/comments\?/, reply: res(200, { values: own }) }, ...routes({ priv: true })]));
  const snap = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.pr.threads[0].comments[0].body.startsWith(WATCH_MARKER), true);
  assert.deepEqual(collectTriggers(snap.pr, []).threads, [], 'worca never answers its own reply');
});

test('guards: a fork PR is refused; delete-scenario and cut-off conflict lists; a failed behind read; a long step log keeps its tail', async () => {
  const forkPr = prBody({ source: { branch: { name: 'feat/x' }, commit: { hash: HEAD.slice(0, 12) }, repository: { full_name: 'someone/api' } } });
  bb._testing.setFetch(fakeFetch(routes({ pr: forkPr })));
  const fork = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.deepEqual([fork.ok, fork.class], [false, 'failed']);
  assert.match(fork.error, /from a fork/);
  bb._testing.setFetch(fakeFetch(routes({ conflicts: [{ path: 'gone.txt', scenario: 'delete' }] })));
  assert.equal((await bb.prWatchSnapshot({ prUrl: PR, env: ENV })).pr.mergeable, 'CONFLICTING', 'deleted on one side, changed on the other');
  let page = 1;
  const cut = fakeFetch([{ match: /\/conflicts\?/, reply: () => res(200, { values: [], next: `${API}/pullrequests/12/conflicts?page=${++page}` }) }, ...routes()]);
  bb._testing.setFetch(cut);
  assert.equal((await bb.prWatchSnapshot({ prUrl: PR, env: ENV })).pr.mergeable, 'UNKNOWN', 'a listing cut off by its page cap proves nothing');
  await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(cut.calls.filter((c) => c.url.includes('/conflicts?')).length, 20, 'an UNKNOWN verdict is not memoised');
  bb._testing.setFetch(fakeFetch([{ match: /\/commits\?include=/, reply: res(500, { error: { message: 'boom' } }) }, ...routes()]));
  const behind = await bb.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.deepEqual([behind.ok, behind.pr.behindBy], [true, 0], 'the behind count is best effort');
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
  bb._testing.setFetch(fakeFetch([
    { match: /\/pipelines\/41$/, reply: res(200, { build_number: 41, uuid: '{p-41}' }) },
    { match: /\/steps\/\?pagelen/, reply: res(200, { values: [{ uuid: '{s2}', name: 'Test', state: { result: { name: 'FAILED' } } }] }) },
    { match: /\/log$/, reply: res(200, null, { text: lines }) },
  ]));
  const log = await bb.failedBuildLog({ prUrl: PR, databaseId: 41, env: ENV });
  assert.equal(log.text.split('\n').length, 201, 'the step name and the last 200 lines');
  assert.match(log.text, /^## Test\nline 50\n[^]*\nline 249$/);
});

test('git-info dispatch: snapshot, redacted log, reply, comment and the checks line go to the Bitbucket adapter', () => withEnv(ENV, async () => {
  gitInfo.setRunner(() => Promise.resolve({ ok: false, stdout: '', stderr: 'gh must not run for Bitbucket', code: 1 }));
  const f = fakeFetch([
    ...routes({ headStatuses: [{ key: 'k', name: 'Pipeline #41', state: 'FAILED', url: 'https://bitbucket.org/acme/api/pipelines/results/41' }] }),
    { match: /\/pipelines\/41$/, reply: res(200, { build_number: 41, uuid: '{p}' }) },
    { match: /\/steps\/\?pagelen/, reply: res(200, { values: [{ uuid: '{s}', name: 'Test', state: { result: { name: 'FAILED' } } }] }) },
    // A broker token (wbt_, the only shape redactSecrets knows) at the END: the 12 KB tail keeps it, so only redaction can remove it.
    { match: /\/log$/, reply: res(200, null, { text: `${'y'.repeat(20000)}\ntoken=wbt_${'a'.repeat(30)}` }) },
    { match: /\/comments$/, method: 'POST', reply: res(201, { id: 9 }) },
  ]);
  bb._testing.setFetch(f);
  assert.equal((await prWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, true);
  const log = await prWatchJobLog({ projectDir: '/p', prUrl: PR, databaseId: 41 });
  assert.equal(log.ok, true);
  assert.ok(Buffer.byteLength(log.text) <= PR_WATCH_LOG_BYTES);
  assert.doesNotMatch(log.text, /wbt_a{30}/, 'redacted like every other adapter\'s log');
  assert.deepEqual(await prWatchReply({ projectDir: '/p', prUrl: PR, threadId: 1, body: 'fixed' }), { ok: true });
  assert.deepEqual(await prWatchComment({ projectDir: '/p', prUrl: PR, body: 'done' }), { ok: true });
  const card = await prChecks({ projectDir: '/p', prUrl: PR });
  assert.equal(card.checks.state, 'failing');
  assert.equal(card.status.label, 'Changes requested');
}));

test('the checks line says Merge conflicts on a conflicting Bitbucket PR (the Resolve button keys on it)', () => withEnv(ENV, async () => {
  bb._testing.setFetch(fakeFetch(routes({ conflicts: [{ path: 'CHANGELOG.md', scenario: 'content' }], headStatuses: [] })));
  assert.equal((await prChecks({ projectDir: '/p', prUrl: PR })).status.label, 'Merge conflicts');
}));
