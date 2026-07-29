// test/github-source-connector.test.mjs — GitHub Issues connector, pure unit
// tests with an injected fake fetch (no network, no shim child). The connector
// is plain ESM so it imports directly from examples/.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import createTaskSource, { parseFilter } from '../examples/plugins/github-source/connector/index.mjs';

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
test('validateConfig: GET /user -> { ok, identity } and caches the login in state', async () => {
  const state = memState();
  const fetch = fakeFetch([{ match: /\/user$/, reply: res(200, { login: 'octo' }) }]);
  const src = createTaskSource(makeCtx({ token: 'tok' }, state), { fetch });
  assert.deepEqual(await src.validateConfig(), { ok: true, identity: 'octo' });
  assert.equal(await state.get('login'), 'octo');
});

test('validateConfig: 401 -> ok:false with a token field error (not a throw)', async () => {
  const fetch = fakeFetch([{ match: /\/user$/, reply: res(401, { message: 'Bad credentials' }) }]);
  const src = createTaskSource(makeCtx(), { fetch });
  const v = await src.validateConfig();
  assert.equal(v.ok, false);
  assert.equal(v.errors[0].field, 'token');
  assert.match(v.errors[0].message, /token invalid or expired/);
});

// ── listTasks ──────────────────────────────────────────────────────────────────
test('listTasks: filters PRs out, parses assignee:@me + label:x, searches client-side', async () => {
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
  assert.deepEqual(t.meta, { repo: 'acme/api', number: 7, labels: ['bug'], assignee: 'alice' });
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

// ── filter micro-syntax ────────────────────────────────────────────────────────
test('parseFilter: defaults + assignee/state/label tokens; unknown tokens ignored', () => {
  assert.deepEqual(parseFilter(''), { state: 'open', labels: [], assignee: null });
  assert.deepEqual(parseFilter('assignee:@me state:closed label:x label:y wat:huh'), {
    state: 'closed', labels: ['x', 'y'], assignee: '@me',
  });
});
