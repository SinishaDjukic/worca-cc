// test/github-source-connector.test.mjs — GitHub Issues connector, pure unit
// tests with an injected fake fetch (no network, no shim child). The connector
// is plain ESM so it imports directly from plugins/.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import createTaskSource, { parseFilter, parseIssueRef } from '../plugins/github-source/connector/index.mjs';
import { ghAuthToken } from '../plugins/github-source/connector/gh-cli.mjs';
import { checkRows } from './helpers/rows.mjs';

// ── harness ────────────────────────────────────────────────────────────────────
function res(status, body, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}
function memState(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, _m: m };
}
function makeCtx(config = { token: 'tok' }, state = memState()) {
  return { apiVersion: 1, config, state, log: () => {} };
}
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
const issue = (n, title, extra = {}) => ({
  number: n, title, html_url: `https://github.com/acme/api/issues/${n}`, state: 'open',
  labels: [{ name: 'bug' }], updated_at: '2026-03-01T00:00:00Z', body: `body ${n}`, assignee: null, ...extra,
});

// ── validateConfig ─────────────────────────────────────────────────────────────
test('validateConfig: 200 -> identity cached in state; 401 -> token field error, not a throw', async () => {
  await checkRows([
    { name: 'validateConfig: GET /user -> { ok, identity } and caches the login in state', run: async () => {
      const state = memState();
      const fetch = fakeFetch([{ match: /\/user$/, reply: res(200, { login: 'octo' }) }]);
      const src = createTaskSource(makeCtx({ token: 'tok' }, state), { fetch });
      assert.deepEqual(await src.validateConfig(), { ok: true, identity: 'octo' });
      assert.equal(await state.get('login'), 'octo');
    } },
    { name: 'validateConfig: 401 -> ok:false with a token field error (not a throw)', run: async () => {
      const fetch = fakeFetch([{ match: /\/user$/, reply: res(401, { message: 'Bad credentials' }) }]);
      const src = createTaskSource(makeCtx(), { fetch });
      const v = await src.validateConfig();
      assert.equal(v.ok, false);
      assert.equal(v.errors[0].field, 'token');
      assert.match(v.errors[0].message, /token invalid or expired/);
    } },
  ]);
});

// ── listTasks ──────────────────────────────────────────────────────────────────
test('listTasks filter: parseFilter defaults/tokens; PRs dropped, assignee:@me + label:x reach the URL, client-side search', async () => {
  await checkRows([
    { name: 'listTasks: filters PRs out, parses assignee:@me + label:x, searches client-side', run: async () => {
      const state = memState();
      const fetch = fakeFetch([
        { match: /\/user$/, reply: res(200, { login: 'octo' }) },
        { match: /\/repos\/acme\/api\/issues\?/, reply: res(200, [
          issue(1, 'Alpha task'),
          issue(2, 'Alpha PR', { pull_request: { url: 'x' } }), // GitHub lists PRs in /issues — must be dropped
          issue(3, 'Beta task'),
        ]) },
      ]);
      const src = createTaskSource(makeCtx({ token: 'tok' }, state), { fetch });
      const q = { inputs: { repo: 'acme/api', filter: 'assignee:@me state:open label:bug' } };
      const { tasks, cursor } = await src.listTasks(q);
      assert.deepEqual(tasks.map((t) => t.id), ['acme/api#1', 'acme/api#3']);
      assert.equal(tasks[0].labels[0], 'bug');
      assert.equal(cursor, undefined); // page not full (2 < 30) -> no next cursor
      const listUrl = fetch.calls.find((c) => c.url.includes('/issues?')).url;
      assert.match(listUrl, /assignee=octo/);
      assert.match(listUrl, /state=open/);
      assert.match(listUrl, /labels=bug/);
      assert.match(listUrl, /per_page=30/);
      // @me resolved once, then served from state on the next call.
      const second = await src.listTasks({ ...q, search: 'beta' });
      assert.deepEqual(second.tasks.map((t) => t.id), ['acme/api#3']);
      assert.equal(fetch.calls.filter((c) => /\/user$/.test(c.url)).length, 1);
    } },
    { name: 'parseFilter: defaults + assignee/state/label tokens; unknown tokens ignored', run: () => {
      assert.deepEqual(parseFilter(''), { state: 'open', labels: [], assignee: null });
      assert.deepEqual(parseFilter('assignee:@me state:closed label:x label:y wat:huh'), {
        state: 'closed', labels: ['x', 'y'], assignee: '@me',
      });
    } },
  ]);
});

test('listTasks: sends If-None-Match on page 1 and serves the cached list on 304', async () => {
  const state = memState();
  let hits = 0;
  const fetch = fakeFetch([
    { match: /\/repos\/acme\/api\/issues\?/, reply: (url, init) => {
      hits += 1;
      if (hits === 1) return res(200, [issue(1, 'Alpha task')], { etag: 'W/"abc"' });
      assert.equal(init.headers['if-none-match'], 'W/"abc"');
      return res(304, null);
    } },
  ]);
  const src = createTaskSource(makeCtx({ token: 'tok' }, state), { fetch });
  const first = await src.listTasks({ inputs: { repo: 'acme/api', filter: 'state:open' } });
  const second = await src.listTasks({ inputs: { repo: 'acme/api', filter: 'state:open' } });
  assert.equal(hits, 2);
  assert.deepEqual(second.tasks, first.tasks);
});

// ── listTasks: issue reference lookup ──────────────────────────────────────────
/** Fake fetch serving one issue at /repos/<repo>/issues/<n>; any list call fails the test. */
function refFetch(repo, n, reply) {
  const esc = repo.replace('/', '\\/');
  return fakeFetch([{ match: new RegExp(`/repos/${esc}/issues/${n}$`), reply }]);
}

test('issue references: parseIssueRef forms/nulls; listTasks returns exactly the referenced issue, skipping the Filter', async () => {
  await checkRows([
    { name: 'parseIssueRef: URL, owner/repo#N, #N and N; anything else -> null', run: () => {
      assert.deepEqual(parseIssueRef('https://github.com/octo/tools/issues/42', 'acme/api'), { repo: 'octo/tools', number: 42 });
      assert.deepEqual(parseIssueRef('  https://github.com/octo/tools/issues/42/#issuecomment-1 ', ''), { repo: 'octo/tools', number: 42 });
      assert.deepEqual(parseIssueRef('github.com/octo/tools/pull/9', ''), { repo: 'octo/tools', number: 9 });
      assert.deepEqual(parseIssueRef('octo/tools#7', 'acme/api'), { repo: 'octo/tools', number: 7 });
      assert.deepEqual(parseIssueRef('#12', 'acme/api'), { repo: 'acme/api', number: 12 });
      assert.deepEqual(parseIssueRef('12', 'acme/api'), { repo: 'acme/api', number: 12 });
      assert.equal(parseIssueRef('#12', ''), null, '#N needs a selected repo');
      assert.equal(parseIssueRef('fix #12 please', 'acme/api'), null);
      assert.equal(parseIssueRef('alpha', 'acme/api'), null);
      assert.equal(parseIssueRef('', 'acme/api'), null);
      assert.equal(parseIssueRef('https://gitlab.com/octo/tools/issues/42', 'acme/api'), null);
    } },
    { name: 'listTasks: a pasted issue URL returns exactly that issue, skipping the Filter', run: async () => {
      const closed = issue(42, 'Closed elsewhere', {
        html_url: 'https://github.com/octo/tools/issues/42', state: 'closed', assignee: { login: 'someone' },
      });
      const fetch = refFetch('octo/tools', 42, res(200, closed));
      const src = createTaskSource(makeCtx(), { fetch });
      const out = await src.listTasks({
        inputs: { repo: 'acme/api', filter: 'assignee:@me state:open' },
        search: 'https://github.com/octo/tools/issues/42',
      });
      assert.deepEqual(out.tasks.map((t) => t.id), ['octo/tools#42']);
      assert.equal(out.tasks[0].state, 'closed');
      assert.equal(out.cursor, undefined);
      assert.equal(fetch.calls.length, 1, 'no /user lookup, no list request');
    } },
    { name: 'listTasks: owner/repo#N looks up that repo even with no repo selected', run: async () => {
      const fetch = refFetch('octo/tools', 7, res(200, issue(7, 'Seven')));
      const src = createTaskSource(makeCtx(), { fetch });
      const out = await src.listTasks({ inputs: {}, search: 'octo/tools#7' });
      assert.deepEqual(out.tasks.map((t) => t.id), ['octo/tools#7']);
    } },
    { name: 'listTasks: #N and N look up the selected repo', run: async () => {
      for (const search of ['#12', '12']) {
        const fetch = refFetch('acme/api', 12, res(200, issue(12, 'Twelve')));
        const src = createTaskSource(makeCtx(), { fetch });
        const out = await src.listTasks({ inputs: { repo: 'acme/api', filter: 'state:open' }, search });
        assert.deepEqual(out.tasks.map((t) => t.id), ['acme/api#12'], search);
      }
    } },
  ]);
});

test('reference lookups: a PR or a 404 gives no tasks; a 401 still rejects kind auth', async () => {
  await checkRows([
    { name: 'listTasks: a reference to a pull request returns no tasks', run: async () => {
      const fetch = refFetch('acme/api', 5, res(200, issue(5, 'A PR', { pull_request: { url: 'x' } })));
      const src = createTaskSource(makeCtx(), { fetch });
      const out = await src.listTasks({ inputs: { repo: 'acme/api' }, search: 'https://github.com/acme/api/pull/5' });
      assert.deepEqual(out, { tasks: [] });
    } },
    { name: 'listTasks: a reference to a missing issue (404) returns no tasks, not an error', run: async () => {
      const fetch = refFetch('acme/api', 999, res(404, { message: 'Not Found' }));
      const src = createTaskSource(makeCtx(), { fetch });
      const out = await src.listTasks({ inputs: { repo: 'acme/api' }, search: '#999' });
      assert.deepEqual(out, { tasks: [] });
    } },
    { name: 'listTasks: a reference lookup still surfaces auth errors', run: async () => {
      const fetch = refFetch('acme/api', 3, res(401, {}));
      const src = createTaskSource(makeCtx(), { fetch });
      await assert.rejects(() => src.listTasks({ inputs: { repo: 'acme/api' }, search: '#3' }), (e) => e.kind === 'auth');
    } },
  ]);
});

// ── getTask ────────────────────────────────────────────────────────────────────
test('getTask: assembles issue body + ## Comments section + meta', async () => {
  const fetch = fakeFetch([
    { match: /\/issues\/7\/comments\?per_page=50$/, reply: res(200, [
      { user: { login: 'alice' }, created_at: '2026-02-03T04:05:06Z', body: 'try X' },
    ]) },
    { match: /\/issues\/7$/, reply: res(200, issue(7, 'Fix the flux', { body: 'Fix the flux', assignee: { login: 'alice' } })) },
  ]);
  const src = createTaskSource(makeCtx(), { fetch });
  const t = await src.getTask('acme/api#7');
  assert.equal(t.id, 'acme/api#7');
  assert.equal(t.body, 'Fix the flux\n\n## Comments\n\n**@alice** (2026-02-03T04:05:06Z):\n\ntry X\n');
  assert.deepEqual(t.meta, { repo: 'acme/api', project: 'acme/api', number: 7, labels: ['bug'], assignee: 'alice' });
});

// ── reportResult ───────────────────────────────────────────────────────────────
test('reportResult: posts a comment with summary+links; PATCH-closes only when closeOnComplete=yes', async () => {
  const routes = [
    { match: /\/issues\/7\/comments$/, method: 'POST', reply: res(201, {}) },
    { match: /\/issues\/7$/, method: 'PATCH', reply: res(200, {}) },
  ];
  const args = { status: 'completed', summary: 'All done', links: [{ title: 'PR', url: 'https://x/pr/1' }] };

  const fetchYes = fakeFetch(routes);
  await createTaskSource(makeCtx({ token: 'tok', closeOnComplete: 'yes' }), { fetch: fetchYes })
    .reportResult('acme/api#7', args);
  const post = fetchYes.calls.find((c) => (c.init.method || 'GET') === 'POST');
  assert.match(JSON.parse(post.init.body).body, /All done/);
  assert.match(JSON.parse(post.init.body).body, /- \[PR\]\(https:\/\/x\/pr\/1\)/);
  const patch = fetchYes.calls.find((c) => c.init.method === 'PATCH');
  assert.ok(patch, 'closeOnComplete=yes + status completed must PATCH the issue closed');
  assert.deepEqual(JSON.parse(patch.init.body), { state: 'closed', state_reason: 'completed' });

  const fetchNo = fakeFetch(routes);
  await createTaskSource(makeCtx({ token: 'tok', closeOnComplete: 'no' }), { fetch: fetchNo })
    .reportResult('acme/api#7', args);
  assert.ok(!fetchNo.calls.some((c) => c.init.method === 'PATCH'), 'closeOnComplete=no must never close');
});

// ── error kinds ────────────────────────────────────────────────────────────────
test('error kinds: 401 -> auth, 403+ratelimit-0 -> rate-limit, fetch rejection -> network', async () => {
  const auth = createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(401, {}) }]) });
  await assert.rejects(() => auth.listTasks({ inputs: { repo: 'acme/api' } }), (e) => {
    assert.equal(e.kind, 'auth');
    assert.equal(e.message, 'GitHub token invalid or expired');
    return true;
  });

  const limited = createTaskSource(makeCtx(), {
    fetch: fakeFetch([{ match: /./, reply: res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1750000000' }) }]),
  });
  await assert.rejects(() => limited.listTasks({ inputs: { repo: 'acme/api' } }), (e) => e.kind === 'rate-limit');

  const offline = createTaskSource(makeCtx(), { fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => offline.getTask('acme/api#1'), (e) => e.kind === 'network');
});

// ── token resolution: gh CLI fallback ──────────────────────────────────────────
/** Reads the Authorization header off the first recorded call. */
function authOf(fetch) {
  return fetch.calls[0]?.init?.headers?.authorization ?? null;
}

test('token: a config token wins (gh never consulted); without one the gh CLI token is used', async () => {
  await checkRows([
    { name: 'token: falls back to the gh CLI when no token is configured', run: async () => {
      const fetch = fakeFetch([{ match: /\/user$/, reply: res(200, { login: 'octo' }) }]);
      const src = createTaskSource(makeCtx({}), { fetch, ghAuthToken: () => 'gho_from_cli' });
      assert.deepEqual(await src.validateConfig(), { ok: true, identity: 'octo' });
      assert.equal(authOf(fetch), 'Bearer gho_from_cli');
    } },
    { name: 'token: an explicit config token wins and never shells out to gh', run: async () => {
      const fetch = fakeFetch([{ match: /\/user$/, reply: res(200, { login: 'octo' }) }]);
      const ghAuthToken = () => { throw new Error('gh must not be consulted when a token is configured'); };
      const src = createTaskSource(makeCtx({ token: 'tok' }), { fetch, ghAuthToken });
      await src.validateConfig();
      assert.equal(authOf(fetch), 'Bearer tok');
    } },
  ]);
});

test('token: the gh fallback is lazy and resolved at most once per op', async () => {
  let calls = 0;
  const fetch = fakeFetch([{ match: /\/repos\/acme\/api\/issues\?/, reply: res(200, [issue(1, 'Alpha')]) }]);
  const src = createTaskSource(makeCtx({}), { fetch, ghAuthToken: () => { calls += 1; return 'gho_x'; } });
  assert.equal(calls, 0, 'building the source must not shell out');
  const q = { inputs: { repo: 'acme/api', filter: 'state:open' } };
  await src.listTasks(q);
  await src.listTasks(q);
  assert.equal(calls, 1, 'the resolved token must be memoized across requests');
});

test('gh fallback failure: listTasks rejects kind:auth with no request sent; validateConfig reports a token field error', async () => {
  await checkRows([
    { name: 'token: a gh fallback failure surfaces as kind:auth, not network', run: async () => {
      const fetch = fakeFetch([{ match: /./, reply: res(200, []) }]);
      const boom = () => { throw Object.assign(new Error('gh not logged in'), { kind: 'auth' }); };
      const src = createTaskSource(makeCtx({}), { fetch, ghAuthToken: boom });
      await assert.rejects(() => src.listTasks({ inputs: { repo: 'acme/api' } }), (e) => {
        assert.equal(e.kind, 'auth', 'must not be swallowed by ghFetch\'s network catch');
        assert.equal(e.message, 'gh not logged in');
        return true;
      });
      assert.equal(fetch.calls.length, 0, 'no request may go out without a token');
    } },
    { name: 'validateConfig: a gh fallback failure reports as a token field error', run: async () => {
      const boom = () => { throw Object.assign(new Error('gh not logged in'), { kind: 'auth' }); };
      const src = createTaskSource(makeCtx({}), { fetch: fakeFetch([]), ghAuthToken: boom });
      const v = await src.validateConfig();
      assert.equal(v.ok, false);
      assert.equal(v.errors[0].field, 'token');
      assert.match(v.errors[0].message, /gh not logged in/);
    } },
  ]);
});

// ── gh-cli.mjs: the subprocess seam (injected runner, never spawns in tests) ────
test('ghAuthToken: trims the token; empty output and spawn failure map to kind:auth', () => {
  assert.equal(ghAuthToken(() => 'gho_abc\n'), 'gho_abc');

  assert.throws(() => ghAuthToken(() => '  \n'), (e) => {
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /gh CLI/);
    return true;
  });

  const enoent = () => { throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }); };
  assert.throws(() => ghAuthToken(enoent), (e) => {
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /ENOENT/);
    return true;
  });

  const notLoggedIn = () => { throw Object.assign(new Error('Command failed'), { stderr: Buffer.from('gh: not logged in\n') }); };
  assert.throws(() => ghAuthToken(notLoggedIn), (e) => {
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /not logged in/);
    return true;
  });
});
