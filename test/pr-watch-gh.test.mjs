// test/pr-watch-gh.test.mjs — the GitHub adapter behind Watch PR (#619). Every gh call
// goes through git-info's injectable runner, so nothing here reaches github.com.
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubPrUrl } from '../src/core/forge.mjs';
import { ghPrWatchSnapshot, ghFailedJobLog, ghRerunFailedJobs, ghReplyToThread, ghPrComment, commitSubjects, _testing as gitInfo } from '../src/core/git-info.mjs';
import { collectTriggers } from '../src/core/pr-watch.mjs';

const PR = 'https://github.com/acme/app/pull/7';
const ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN', 'WORCA_GH_APP_ID', 'WORCA_BROKER_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.WORCA_GH_READ_TOKEN = 'read-token';
  process.env.WORCA_GH_WRITE_TOKEN = 'write-token';
});
afterEach(() => {
  gitInfo.reset();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const ok = (data) => ({ ok: true, stdout: JSON.stringify(data), stderr: '', code: 0 });
const fail = (stderr, code = 1) => ({ ok: false, stdout: '', stderr, code });
const page = (nodes, next = null) => ({ nodes, pageInfo: { hasNextPage: !!next, endCursor: next } });

/** Parse `gh api graphql -f query=… -f k=v -F n=1` back into { query, vars, flags } (flags: k -> '-f' | '-F'). */
function graphqlArgs(args) {
  const vars = {}; const flags = {}; let query = null;
  for (let i = 2; i < args.length; i += 2) {
    const [k, ...rest] = args[i + 1].split('='); const v = rest.join('=');
    if (k === 'query') query = v; else { vars[k] = v; flags[k] = args[i]; }
  }
  return { query, vars, flags };
}

function runner(answer) {
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => { calls.push({ cmd, args, opts }); return answer(cmd, args, calls); });
  return calls;
}

const check = (id, extra = {}) => ({ __typename: 'CheckRun', databaseId: id, name: `c${id}`, status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: `https://x/${id}`, isRequired: false, ...extra });
const comment = (id) => ({ databaseId: id, body: `c${id}`, author: { login: 'rev' }, authorAssociation: 'MEMBER' });
const prNode = ({ contexts, threads = page([]), reviews = page([]), rollup } = {}) => ({ data: { repository: { pullRequest: {
  url: PR, state: 'OPEN', headRefName: 'feat/x', headRefOid: 'sha1', author: { login: 'me' },
  statusCheckRollup: rollup !== undefined ? rollup : { contexts: contexts || page([]) }, reviewThreads: threads, reviews,
} } } });

/** Brace depth at the first `needle` (the runner stub never parses the query, GitHub does). */
const depthAt = (q, needle) => { let d = 0; const end = q.indexOf(needle); for (let i = 0; i < end; i++) d += q[i] === '{' ? 1 : q[i] === '}' ? -1 : 0; return d; };

test('every snapshot query is balanced and asks reviewThreads and reviews on the pull request, beside statusCheckRollup', async () => {
  const queries = [];
  runner(async (cmd, args) => {
    const { query } = graphqlArgs(args);
    queries.push(query);
    return ok(prNode({ contexts: page([check(1)]) }));
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.ok(queries.length >= 1);
  for (const q of queries) {
    assert.equal((q.match(/{/g) || []).length, (q.match(/}/g) || []).length, 'balanced braces');
    const field = depthAt(q, 'statusCheckRollup{');
    assert.equal(depthAt(q, 'reviewThreads('), field, 'reviewThreads is a pullRequest field');
    assert.equal(depthAt(q, 'reviews('), field, 'reviews is a pullRequest field');
  }
});

test('parseGithubPrUrl accepts only canonical github.com PR URLs', () => {
  assert.deepEqual(parseGithubPrUrl(PR), { owner: 'acme', repo: 'app', number: 7, url: PR });
  for (const bad of [`${PR}/files`, `${PR}?x=1`, `${PR}#c`, 'https://u:p@github.com/acme/app/pull/7',
    'https://github.com:443/acme/app/pull/7', 'https://ghe.corp/acme/app/pull/7', 'http://github.com/acme/app/pull/7',
    'https://github.com/acme/app/pull/0', 'https://github.com/acme/app/pull/-1', null]) {
    assert.equal(parseGithubPrUrl(bad), null, String(bad));
  }
});

test('snapshot pages every dimension independently and uses the read credential with an explicit repo', async () => {
  const calls = runner(async (cmd, args) => {
    const { query, vars } = graphqlArgs(args);
    if (query.startsWith('query PrWatchComments')) {
      // Two threads, each with its own second comment page.
      return ok({ data: { node: { comments: page([comment(vars.threadId === 'T1' ? 12 : 22)]) } } });
    }
    const contexts = vars.contextsCursor ? page([check(2, { isRequired: true })]) : page([check(1)], 'c1');
    const threads = vars.threadsCursor ? page([{ id: 'T2', isResolved: false, comments: page([comment(21)], 'tc2') }])
      : page([{ id: 'T1', isResolved: false, comments: page([comment(11)], 'tc1') }], 't1');
    const reviews = vars.reviewsCursor ? page([{ databaseId: 32, state: 'CHANGES_REQUESTED', body: 'b', author: { login: 'rev' }, authorAssociation: 'OWNER' }])
      : page([{ databaseId: 31, state: 'COMMENTED', body: 'a', author: { login: 'rev' }, authorAssociation: 'OWNER' }], 'r1');
    return ok(prNode({ contexts, threads, reviews }));
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual(snap.pr.contexts.map((c) => [c.databaseId, c.isRequired]), [[1, false], [2, true]]);
  assert.deepEqual(snap.pr.threads.map((t) => [t.nodeId, t.comments.map((c) => c.databaseId)]), [['T1', [11, 12]], ['T2', [21, 22]]]);
  assert.deepEqual(snap.pr.reviews.map((r) => r.databaseId), [31, 32]);
  assert.equal(snap.pr.headSha, 'sha1');
  for (const c of calls) assert.deepEqual([c.args[0], c.args[1]], ['api', 'graphql']);
  // Comment pages follow each thread's own cursor through node(id:).
  const commentCalls = calls.map((c) => graphqlArgs(c.args)).filter((x) => x.query.startsWith('query PrWatchComments'));
  assert.deepEqual(commentCalls.map((x) => [x.vars.threadId, x.vars.commentsCursor]), [['T1', 'tc1'], ['T2', 'tc2']]);
  const owners = calls.map((c) => graphqlArgs(c.args).vars).filter((v) => v.owner);
  assert.ok(owners.every((v) => v.owner === 'acme' && v.repo === 'app' && v.number === '7'));
});

test('uneven page counts collect every item once and stop asking for finished connections', async () => {
  // contexts=2 pages, threads=1 page, reviews=3 pages.
  const reviewPages = { '': ['r1', 31], r1: ['r2', 32], r2: [null, 33] };
  const calls = runner(async (cmd, args) => {
    const { vars } = graphqlArgs(args);
    const contexts = vars.contextsCursor ? page([check(2)]) : page([check(1)], 'c1');
    const threads = page([{ id: 'T1', isResolved: false, comments: page([comment(11)]) }]);
    const [next, id] = reviewPages[vars.reviewsCursor || ''];
    const reviews = page([{ databaseId: id, state: 'COMMENTED', body: 'x', author: { login: 'rev' }, authorAssociation: 'OWNER' }], next);
    const pr = prNode({ contexts, threads, reviews }).data.repository.pullRequest;
    // A connection left out by @include(if:false) is absent from the response.
    if (vars.withContexts === 'false') pr.statusCheckRollup = {};
    if (vars.withThreads === 'false') delete pr.reviewThreads;
    if (vars.withReviews === 'false') delete pr.reviews;
    return ok({ data: { repository: { pullRequest: pr } } });
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual(snap.pr.contexts.map((c) => c.databaseId), [1, 2]);
  assert.deepEqual(snap.pr.threads.map((t) => t.nodeId), ['T1']);
  assert.deepEqual(snap.pr.reviews.map((r) => r.databaseId), [31, 32, 33]);
  const sent = calls.map((c) => graphqlArgs(c.args).vars);
  assert.deepEqual(sent.map((v) => [v.withContexts, v.withThreads, v.withReviews]),
    [['true', 'true', 'true'], ['true', 'false', 'true'], ['false', 'false', 'true']]);
});

test('snapshot and job logs use the read role, mutations the write role', async () => {
  const calls = runner(async (cmd, args) => {
    if (args[0] === 'api' && graphqlArgs(args).query.startsWith('query PrWatch(')) return ok(prNode());
    if (args[0] === 'run') return { ok: true, stdout: 'log', stderr: '', code: 0 };
    return ok({ data: { addPullRequestReviewThreadReply: { comment: { id: 'x' } } } });
  });
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, true);
  assert.equal((await ghFailedJobLog({ projectDir: '/p', prUrl: PR, databaseId: 1 })).ok, true);
  assert.equal((await ghReplyToThread({ projectDir: '/p', prUrl: PR, threadId: 'PRRT_1', body: 'hi' })).ok, true);
  assert.equal((await ghPrComment({ projectDir: '/p', prUrl: PR, body: 'hi' })).ok, true);
  assert.deepEqual(calls.map((c) => c.opts.env.GH_TOKEN), ['read-token', 'read-token', 'write-token', 'write-token']);
});

test('reply targets the thread Node ID; PR comment passes an explicit repo', async () => {
  const calls = runner(async () => ok({ data: { addPullRequestReviewThreadReply: { comment: { id: 'x' } } } }));
  await ghReplyToThread({ projectDir: '/p', prUrl: PR, threadId: 'PRRT_node', body: 'done' });
  const { query, vars } = graphqlArgs(calls[0].args);
  assert.match(query, /addPullRequestReviewThreadReply/);
  assert.equal(vars.threadId, 'PRRT_node');
  assert.equal(vars.body, 'done');
  await ghPrComment({ projectDir: '/p', prUrl: PR, body: 'b' });
  assert.deepEqual(calls[1].args.slice(0, 5), ['pr', 'comment', '7', '--repo', 'acme/app']);
});

test('null rollup means zero checks; a rollup without contexts is malformed', async () => {
  runner(async () => ok(prNode({ rollup: null })));
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true);
  assert.deepEqual(snap.pr.contexts, []);
  runner(async () => ok(prNode({ rollup: {} })));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, false);
});

test('missing isRequired, GraphQL errors, and omitted pageInfo fail the whole snapshot', async () => {
  runner(async () => ok(prNode({ contexts: page([{ __typename: 'CheckRun', databaseId: 1, status: 'COMPLETED', conclusion: 'FAILURE' }]) })));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, false);
  runner(async () => ok({ ...prNode(), errors: [{ message: 'partial' }] }));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, false);
  runner(async () => ok(prNode({ contexts: { nodes: [] } })));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, false);
  runner(async () => ok(prNode({ contexts: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } })));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, false);
});

test('failures are classified as rate-limit, auth, or failed', async () => {
  runner(async () => fail('API rate limit exceeded for installation'));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).class, 'rate-limit');
  runner(async () => fail('HTTP 401: Bad credentials'));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).class, 'auth');
  runner(async () => fail('something broke'));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).class, 'failed');
  // Only stderr classifies: "author" in a GraphQL payload on stdout is not an auth failure.
  runner(async () => ({ ok: false, stdout: '{"author":{"login":"x"}}', stderr: 'boom', code: 1 }));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).class, 'failed');
  runner(async () => fail('secondary rate limit'));
  assert.equal((await ghPrComment({ projectDir: '/p', prUrl: PR, body: 'x' })).class, 'rate-limit');
});

test('failed job log: explicit repo, job prefixes stripped, secrets redacted, the last 12 KB without runner setup or cleanup', async () => {
  const line = (msg) => `build\tUNKNOWN STEP\t2026-10-08T10:00:00.0000000Z ${msg}`;
  const out = ['\uFEFF2026-10-08T10:00:00.0000000Z Current runner version: 2', 'Runner Image Provisioner', 'Complete job name: build', 'npm test',
    'x'.repeat(20000), 'token wbt_abcdefghijklmnopqrstuvwxyz0123456789', 'FAIL (6) the assertion', '##[error]Process completed with exit code 1.',
    'Post job cleanup.', '[command]/usr/bin/git version'];
  const calls = runner(async () => ({ ok: true, stdout: out.map(line).join('\n'), stderr: '', code: 0 }));
  const r = await ghFailedJobLog({ projectDir: '/p', prUrl: PR, databaseId: 99 });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0].args, ['run', 'view', '--job', '99', '--log-failed', '--repo', 'acme/app']);
  assert.ok(r.text.endsWith('FAIL (6) the assertion\n##[error]Process completed with exit code 1.'), r.text.slice(-120));
  assert.doesNotMatch(r.text, /build\tUNKNOWN STEP|runner version|Provisioner|Post job cleanup|usr\/bin\/git/);
  assert.doesNotMatch(r.text, /wbt_abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.ok(Buffer.byteLength(r.text) <= 12 * 1024);
  // A step-mapped log (no setup or cleanup lines) is kept as it is when short.
  runner(async () => ({ ok: true, stdout: [line('boom'), line('done')].join('\n'), stderr: '', code: 0 }));
  assert.equal((await ghFailedJobLog({ projectDir: '/p', prUrl: PR, databaseId: 1 })).text, 'boom\ndone');
});

test('the snapshot names the checks failing on the base branch head, on the first page only', async () => {
  const seen = [];
  runner(async (cmd, args) => {
    const { vars } = graphqlArgs(args); seen.push(vars.withBase);
    const node = prNode({ contexts: vars.contextsCursor ? page([check(2)]) : page([check(1)], 'c1') });
    if (vars.withBase === 'true') node.data.repository.pullRequest.baseRef = { compare: { behindBy: 3 }, target: { statusCheckRollup: { contexts: { nodes: [
      { __typename: 'CheckRun', name: 'ui proofs', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'slow', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' },
    ] } } } };
    return ok(node);
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual(seen, ['true', 'false']);
  assert.deepEqual(snap.pr.baseFailing, ['ui proofs', 'ci/legacy']);
  assert.deepEqual([snap.pr.basePassing, snap.pr.basePending, snap.pr.baseSettled, snap.pr.behindBy], [['unit'], ['slow'], false, 3]);
});

test('the snapshot asks how far the PR is behind its base and which workflow run each check belongs to', async () => {
  runner(async (cmd, args) => {
    const { query } = graphqlArgs(args);
    assert.match(query, /baseRef @include\(if:\$withBase\)\{compare\(headRef:\$headRef\)\{behindBy\}/);
    assert.match(query, /CheckRun\{[^}]*checkSuite\{workflowRun\{databaseId\}\}/);
    return ok(prNode({ contexts: page([check(1, { checkSuite: { workflowRun: { databaseId: 555 } } }), check(2, { checkSuite: null })]) }));
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual(snap.pr.contexts.map((c) => [c.name, c.runId, Object.hasOwn(c, 'checkSuite')]), [['c1', 555, false], ['c2', null, false]]);
  // No base ref or comparison: not behind, base settled, nothing failing.
  assert.deepEqual([snap.pr.behindBy, snap.pr.baseFailing, snap.pr.baseSettled], [0, [], true]);
});

test('ghRerunFailedJobs re-runs a workflow run\'s failed jobs with the write credential', async () => {
  const calls = runner(async () => ({ ok: true, stdout: '', stderr: '', code: 0 }));
  assert.deepEqual(await ghRerunFailedJobs({ projectDir: '/p', prUrl: PR, runId: 555 }), { ok: true });
  assert.deepEqual(calls[0].args, ['run', 'rerun', '555', '--failed', '--repo', 'acme/app']);
  assert.equal(calls[0].opts.env.GH_TOKEN, 'write-token');
  runner(async () => fail('HTTP 403: API rate limit exceeded'));
  assert.equal((await ghRerunFailedJobs({ projectDir: '/p', prUrl: PR, runId: 555 })).class, 'rate-limit');
  assert.equal((await ghRerunFailedJobs({ projectDir: '/p', prUrl: PR })).ok, false);
});

test('commitSubjects lists subjects between two SHAs', async () => {
  const calls = runner(async () => ({ ok: true, stdout: 'fix a\nfix b\n', stderr: '', code: 0 }));
  assert.deepEqual(await commitSubjects('/p', 'a1', 'b2'), { ok: true, subjects: ['fix a', 'fix b'] });
  assert.deepEqual(calls[0].args, ['log', '--format=%s', 'a1..b2']);
});

test('GraphQL variables are typed explicitly: strings raw (-f), booleans and the PR number typed (-F)', async () => {
  const calls = runner(async () => ok(prNode()));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, true);
  const { query, vars, flags } = graphqlArgs(calls[0].args);
  assert.deepEqual(flags, { owner: '-f', repo: '-f', number: '-F', headRef: '-f', withContexts: '-F', withThreads: '-F', withReviews: '-F', withBase: '-F' });
  assert.deepEqual([vars.number, vars.headRef, vars.withContexts, vars.withThreads, vars.withReviews, vars.withBase], ['7', 'refs/pull/7/head', 'true', 'true', 'true', 'true']);
  // Required-check detection asks GitHub per pull request, on both check kinds.
  assert.match(query, /CheckRun\{[^}]*isRequired\(pullRequestNumber:\$number\)/);
  assert.match(query, /StatusContext\{[^}]*isRequired\(pullRequestNumber:\$number\)/);
});

test('a thread\'s later comment pages are read with the read credential', async () => {
  const calls = runner(async (cmd, args) => (graphqlArgs(args).query.startsWith('query PrWatchComments')
    ? ok({ data: { node: { comments: page([comment(12)]) } } })
    : ok(prNode({ threads: page([{ id: 'T1', isResolved: false, comments: page([comment(11)], 'tc1') }]) }))));
  assert.equal((await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR })).ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.opts.env.GH_TOKEN), ['read-token', 'read-token']);
});

test('a PR with no checks at all (null rollup) still fires its review triggers', async () => {
  runner(async () => ok(prNode({ rollup: null, threads: page([{ id: 'T1', isResolved: false, comments: page([comment(11)]) }]) })));
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  const t = collectTriggers(snap.pr, []);
  assert.deepEqual([t.fire, t.checksSettled, t.handledKeys], [true, true, ['comment:11']]);
});

test('the snapshot carries the base branch and GitHub\'s mergeable verdict', async () => {
  runner(async (cmd, args) => {
    const { query } = graphqlArgs(args);
    assert.match(query, /headRefOid baseRefName baseRefOid mergeable /);
    const node = prNode();
    Object.assign(node.data.repository.pullRequest, { baseRefName: 'dev', baseRefOid: 'b1', mergeable: 'CONFLICTING' });
    return ok(node);
  });
  const snap = await ghPrWatchSnapshot({ projectDir: '/p', prUrl: PR });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual([snap.pr.base, snap.pr.baseSha, snap.pr.mergeable], ['dev', 'b1', 'CONFLICTING']);
  assert.equal(collectTriggers(snap.pr, []).conflict.base, 'dev');
});
