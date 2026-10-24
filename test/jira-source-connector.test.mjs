// test/jira-source-connector.test.mjs — Jira connector, pure unit tests with an injected fake fetch
// (no network, no shim child). The connector is plain ESM so it imports directly from plugins/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { buildJql, pastedKey, isCloud } from '../plugins/jira-source/connector/index.mjs';
import { htmlToMarkdown, markdownToWiki, wikiLink } from '../plugins/jira-source/connector/markup.mjs';
import { checkRows } from './helpers/rows.mjs';

// ── harness ────────────────────────────────────────────────────────────────────
function res(status, body, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => h[k.toLowerCase()] ?? null }, json: async () => body };
}
/** Route table fake fetch: [{ match: /re/, method?, reply: res|fn(url,init) }]. Records calls. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    for (const r of routes) {
      if (r.match.test(String(url)) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(String(url), init) : r.reply;
    }
    throw new Error(`unrouted fetch: ${init.method || 'GET'} ${url}`);
  };
  fn.calls = calls;
  return fn;
}
const CLOUD = { baseUrl: 'https://acme.atlassian.net', email: 'ann@acme.test', token: 'tok', transitionOnComplete: '' };
const DC = { baseUrl: 'https://jira.acme.test/', email: '', token: 'pat', transitionOnComplete: '' };
const logs = [];
/** A ctx whose state already knows the site's deployment (seed: 'cloud' | 'datacenter' | null = unknown), so the
 *  op under test makes no serverInfo call unless it is about that. ctx.state.map is the bag, for assertions. */
const makeCtx = (config = {}, { seed } = {}) => {
  const cfg = { ...CLOUD, ...config };
  const base = String(cfg.baseUrl || '').trim().replace(/\/+$/, '');
  const map = new Map();
  const known = seed === undefined ? (isCloud(base) ? 'cloud' : 'datacenter') : seed;
  if (known) map.set(`deployment:${base}`, known);
  return { apiVersion: 5, profile: 'acme', config: cfg, log: (level, msg) => logs.push([level, msg]),
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
};
/** serverInfo route: deploymentType 'Cloud' | 'Server' | 'DataCenter', or a status code to fail with. */
const info = (type) => ({ match: /\/rest\/api\/2\/serverInfo$/, reply: typeof type === 'number' ? res(type, null) : res(200, { deploymentType: type }) });
const issue = (key, fields = {}) => ({ key, fields: { summary: `Issue ${key}`, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  labels: ['a', 'b'], updated: '2026-09-01T00:00:00.000+0000', ...fields } });
const params = (url) => Object.fromEntries(new URL(url).searchParams);

// ── pure helpers ───────────────────────────────────────────────────────────────
test('buildJql, pastedKey, isCloud', async () => {
  await checkRows([
    { name: 'project + filter + search, newest first', run: () => {
      assert.equal(buildJql({ project: 'SHOP', jql: 'assignee = currentUser()', search: 'say "hi"' }),
        'project = "SHOP" AND (assignee = currentUser()) AND text ~ "say \\"hi\\"" ORDER BY updated DESC');
    } },
    { name: "the filter's own ORDER BY wins and stays last", run: () => {
      assert.equal(buildJql({ project: 'SHOP', jql: 'status = Open order by priority DESC', search: 'x' }),
        'project = "SHOP" AND (status = Open) AND text ~ "x" order by priority DESC');
    } },
    { name: 'nothing → order only', run: () => assert.equal(buildJql({}), 'ORDER BY updated DESC') },
    { name: 'pastedKey: bare key, browse URL, board URL; words are not keys', run: () => {
      assert.equal(pastedKey('shop-12'), 'SHOP-12');
      assert.equal(pastedKey('https://acme.atlassian.net/browse/SHOP-12'), 'SHOP-12');
      assert.equal(pastedKey('https://acme.atlassian.net/jira/software/projects/SHOP/boards/1?selectedIssue=SHOP-7'), 'SHOP-7');
      assert.equal(pastedKey('login bug'), null);
    } },
    { name: 'isCloud by host (the fallback guess)', run: () => {
      assert.equal(isCloud('https://acme.atlassian.net'), true);
      assert.equal(isCloud('https://jira.acme.test'), false);
      assert.equal(isCloud('nope'), false);
    } },
  ]);
});

// ── validateConfig / listProjects ─────────────────────────────────────────────
test('validateConfig and listProjects', async () => {
  await checkRows([
    { name: 'Cloud: /myself with Basic email:token → identity', run: async () => {
      const fetch = fakeFetch([info('Cloud'), { match: /\/rest\/api\/2\/myself$/, reply: res(200, { displayName: 'Ann' }) }]);
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).validateConfig(), { ok: true, identity: 'Ann' });
      assert.equal(fetch.calls[0].url, 'https://acme.atlassian.net/rest/api/2/serverInfo');
      assert.equal(fetch.calls[0].headers.authorization, undefined, 'serverInfo is asked anonymously first');
      assert.equal(fetch.calls[1].url, 'https://acme.atlassian.net/rest/api/2/myself');
      assert.equal(fetch.calls[1].headers.authorization, `Basic ${Buffer.from('ann@acme.test:tok').toString('base64')}`);
    } },
    { name: 'Data Center: no email → Bearer PAT; trailing slash trimmed', run: async () => {
      const fetch = fakeFetch([info('DataCenter'), { match: /\/myself$/, reply: res(200, { name: 'ann' }) }]);
      assert.deepEqual(await createTaskSource(makeCtx(DC), { fetch }).validateConfig(), { ok: true, identity: 'ann' });
      assert.equal(fetch.calls[1].url, 'https://jira.acme.test/rest/api/2/myself');
      assert.equal(fetch.calls[1].headers.authorization, 'Bearer pat');
    } },
    { name: 'missing fields → field errors, no request', run: async () => {
      const fetch = fakeFetch([]);
      assert.equal((await createTaskSource(makeCtx({ baseUrl: '' }), { fetch }).validateConfig()).errors[0].field, 'baseUrl');
      assert.equal((await createTaskSource(makeCtx({ baseUrl: 'acme.atlassian.net' }), { fetch }).validateConfig()).errors[0].field, 'baseUrl');
      assert.equal((await createTaskSource(makeCtx({ token: '' }), { fetch }).validateConfig()).errors[0].field, 'token');
      assert.equal(fetch.calls.length, 0);
    } },
    { name: 'the site says Cloud (custom domain too) and the email is blank → email error, before /myself', run: async () => {
      const fetch = fakeFetch([info('Cloud')]);
      const v = await createTaskSource(makeCtx({ baseUrl: 'https://jira.acme.test', email: '' }), { fetch }).validateConfig();
      assert.deepEqual([v.ok, v.errors[0].field], [false, 'email']);
      assert.match(v.errors[0].message, /Jira Cloud/);
      assert.equal(fetch.calls.length, 1);
    } },
    { name: 'the site says Data Center and an email is set → email error naming the fix', run: async () => {
      const fetch = fakeFetch([info('Server')]);
      const v = await createTaskSource(makeCtx({ ...DC, email: 'ann@acme.test' }), { fetch }).validateConfig();
      assert.equal(v.errors[0].field, 'email');
      assert.match(v.errors[0].message, /leave the email blank/);
    } },
    { name: 'site does not say → hostname guess, and a guess never refuses an email', run: async () => {
      const fetch = fakeFetch([info(404), { match: /\/myself$/, reply: res(200, { name: 'ann' }) }]);
      const ctx = makeCtx({ ...DC, email: 'ann@acme.test' }, { seed: null });
      assert.deepEqual(await createTaskSource(ctx, { fetch }).validateConfig(), { ok: true, identity: 'ann' });
      assert.deepEqual(fetch.calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '')), ['/rest/api/2/serverInfo', '/rest/api/2/serverInfo', '/rest/api/2/myself'],
        'anonymous, then with the token, then on');
      assert.equal(ctx.state.map.size, 0, 'nothing remembered from a guess');
    } },
    { name: '401 → token error; 404 / unreachable → baseUrl error', run: async () => {
      const v401 = await createTaskSource(makeCtx(), { fetch: fakeFetch([info('Cloud'), { match: /./, reply: res(401, null) }]) }).validateConfig();
      assert.deepEqual([v401.ok, v401.errors[0].field], [false, 'token']);
      const v404 = await createTaskSource(makeCtx(), { fetch: fakeFetch([info('Cloud'), { match: /./, reply: res(404, null) }]) }).validateConfig();
      assert.equal(v404.errors[0].field, 'baseUrl');
      const down = await createTaskSource(makeCtx(), { fetch: async () => { throw new Error('ENOTFOUND'); } }).validateConfig();
      assert.equal(down.errors[0].field, 'baseUrl');
    } },
    { name: 'listProjects Cloud: project/search pages until isLast', run: async () => {
      const fetch = fakeFetch([{ match: /\/project\/search/, reply: (url) => (params(url).startAt === '0'
        ? res(200, { values: [{ key: 'SHOP', name: 'Shop' }], isLast: false })
        : res(200, { values: [{ key: 'OPS', name: 'Ops' }], isLast: true })) }]);
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).listProjects(),
        [{ value: 'SHOP', label: 'Shop (SHOP)' }, { value: 'OPS', label: 'Ops (OPS)' }]);
      assert.equal(fetch.calls.length, 2);
    } },
    { name: 'listProjects Data Center: /project array', run: async () => {
      const fetch = fakeFetch([{ match: /\/rest\/api\/2\/project$/, reply: res(200, [{ key: 'SHOP', name: 'Shop' }]) }]);
      assert.deepEqual(await createTaskSource(makeCtx(DC), { fetch }).listProjects(), [{ value: 'SHOP', label: 'Shop (SHOP)' }]);
    } },
    { name: '429 → kind rate-limit with retry-after; 5xx → kind plugin naming Jira errors', run: async () => {
      await assert.rejects(createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(429, null, { 'retry-after': 7 }) }]) }).listProjects(),
        (e) => e.kind === 'rate-limit' && /retry after 7s/.test(e.message));
      await assert.rejects(createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(400, { errorMessages: ['bad JQL'] }) }]) }).listProjects(),
        (e) => e.kind === 'plugin' && /Jira 400: bad JQL/.test(e.message));
    } },
  ]);
});

// ── deployment ────────────────────────────────────────────────────────────────
test('deployment: asked once per profile and URL, remembered in state; the hostname is only the fallback', async () => {
  await checkRows([
    { name: 'a Cloud site on a custom domain pages with /search/jql, and the answer is remembered', run: async () => {
      const ctx = makeCtx({ baseUrl: 'https://jira.acme.test' }, { seed: null });
      const fetch = fakeFetch([info('Cloud'), { match: /\/search\/jql\?/, reply: res(200, { issues: [], isLast: true }) }]);
      await createTaskSource(ctx, { fetch }).listTasks({ inputs: {} });
      await createTaskSource(ctx, { fetch }).listTasks({ inputs: {} });
      assert.equal(fetch.calls.filter((c) => /serverInfo/.test(c.url)).length, 1, 'the second op (a new child) reads state');
      assert.equal(ctx.state.map.get('deployment:https://jira.acme.test'), 'cloud');
    } },
    { name: 'a Data Center site lists projects with /project', run: async () => {
      const ctx = makeCtx(DC, { seed: null });
      const fetch = fakeFetch([info('DataCenter'), { match: /\/rest\/api\/2\/project$/, reply: res(200, []) }]);
      await createTaskSource(ctx, { fetch }).listProjects();
      assert.ok(fetch.calls.some((c) => /\/rest\/api\/2\/project$/.test(c.url)));
    } },
    { name: 'no answer → the hostname decides and nothing is remembered', run: async () => {
      const ctx = makeCtx({}, { seed: null });
      const fetch = fakeFetch([info(500), { match: /\/search\/jql\?/, reply: res(200, { issues: [], isLast: true }) }]);
      await createTaskSource(ctx, { fetch }).listTasks({ inputs: {} });
      assert.equal(ctx.state.map.size, 0);
    } },
    { name: 'a changed URL asks again', run: async () => {
      const ctx = makeCtx(DC, { seed: null });
      ctx.state.map.set('deployment:https://old.acme.test', 'cloud');
      const fetch = fakeFetch([info('DataCenter'), { match: /\/search\?/, reply: res(200, { issues: [], total: 0 }) }]);
      await createTaskSource(ctx, { fetch }).listTasks({ inputs: {} });
      assert.equal(fetch.calls[0].url, 'https://jira.acme.test/rest/api/2/serverInfo');
    } },
  ]);
});

// ── listTasks ─────────────────────────────────────────────────────────────────
test('listTasks: Cloud nextPageToken, Data Center startAt, pasted keys', async () => {
  await checkRows([
    { name: 'Cloud: /search/jql with the wrapped JQL; nextPageToken becomes the cursor', run: async () => {
      const fetch = fakeFetch([{ match: /\/rest\/api\/2\/search\/jql\?/, reply: res(200, { issues: [issue('SHOP-1')], nextPageToken: 'tok2', isLast: false }) }]);
      const src = createTaskSource(makeCtx(), { fetch });
      const out = await src.listTasks({ inputs: { project: 'SHOP', jql: 'assignee = currentUser()' }, search: 'login' });
      const p = params(fetch.calls[0].url);
      assert.equal(p.jql, 'project = "SHOP" AND (assignee = currentUser()) AND text ~ "login" ORDER BY updated DESC');
      assert.equal(p.fields, 'summary,status,labels,updated');
      assert.equal(p.maxResults, '50');
      assert.deepEqual(out, { tasks: [{ id: 'SHOP-1', title: 'Issue SHOP-1', url: 'https://acme.atlassian.net/browse/SHOP-1', state: 'open',
        labels: ['a', 'b'], updatedAt: '2026-09-01T00:00:00.000+0000' }], cursor: 'tok2' });
      await src.listTasks({ inputs: { project: 'SHOP' }, cursor: 'tok2' });
      assert.equal(params(fetch.calls[1].url).nextPageToken, 'tok2');
    } },
    { name: 'Cloud: last page → no cursor; done category → closed', run: async () => {
      const fetch = fakeFetch([{ match: /\/search\/jql/, reply: res(200, { issues: [issue('SHOP-2', { status: { name: 'Done', statusCategory: { key: 'done' } } })], isLast: true }) }]);
      const out = await createTaskSource(makeCtx(), { fetch }).listTasks({ inputs: {} });
      assert.equal(out.tasks[0].state, 'closed');
      assert.equal('cursor' in out, false);
    } },
    { name: 'Data Center: /search with startAt; cursor until total', run: async () => {
      const fetch = fakeFetch([{ match: /\/rest\/api\/2\/search\?/, reply: (url) => res(200, {
        issues: Array.from({ length: Number(params(url).startAt) === 0 ? 50 : 10 }, (_, i) => issue(`SHOP-${i + 1}`)), total: 60 }) }]);
      const src = createTaskSource(makeCtx(DC), { fetch });
      const first = await src.listTasks({ inputs: { project: 'SHOP' } });
      assert.equal(params(fetch.calls[0].url).startAt, '0');
      assert.equal(first.cursor, '50');
      const last = await src.listTasks({ inputs: { project: 'SHOP' }, cursor: '50' });
      assert.equal(params(fetch.calls[1].url).startAt, '50');
      assert.equal('cursor' in last, false);
    } },
    { name: 'a pasted key or URL → that one issue, whatever the filter; 404 → empty', run: async () => {
      const fetch = fakeFetch([{ match: /\/rest\/api\/2\/issue\/SHOP-12\?fields=/, reply: res(200, issue('SHOP-12')) }]);
      const src = createTaskSource(makeCtx(), { fetch });
      assert.deepEqual((await src.listTasks({ inputs: { project: 'OPS' }, search: 'shop-12' })).tasks.map((t) => t.id), ['SHOP-12']);
      assert.equal((await src.listTasks({ inputs: {}, search: 'https://acme.atlassian.net/browse/SHOP-12' })).tasks.length, 1);
      const gone = createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(404, { errorMessages: ['Issue does not exist'] }) }]) });
      assert.deepEqual(await gone.listTasks({ inputs: {}, search: 'SHOP-12' }), { tasks: [] });
    } },
  ]);
});

// ── getTask ───────────────────────────────────────────────────────────────────
test('getTask: rendered description and comments as markdown; meta', async () => {
  const fetch = fakeFetch([{ match: /\/rest\/api\/2\/issue\/SHOP-12\?/, reply: res(200, {
    ...issue('SHOP-12', {
      issuetype: { name: 'Bug' }, project: { key: 'SHOP' }, priority: { name: 'High' }, description: 'Fix *it*',
      comment: { comments: [{ id: '10', author: { displayName: 'Bo' }, created: '2026-09-02T00:00:00.000+0000', body: 'ok' },
        { id: '11', author: { displayName: 'Cy' }, created: '2026-09-03T00:00:00.000+0000', body: 'raw *wiki*' }] },
    }),
    renderedFields: { description: '<p>Fix <b>it</b></p><pre>npm test</pre>', comment: { comments: [{ id: '10', body: '<p>ok <tt>x</tt></p>' }] } },
  }) }]);
  const t = await createTaskSource(makeCtx(), { fetch }).getTask('SHOP-12');
  const p = params(fetch.calls[0].url);
  assert.equal(p.expand, 'renderedFields');
  assert.match(p.fields, /description/);
  assert.match(p.fields, /comment/);
  assert.equal(t.id, 'SHOP-12');
  assert.equal(t.body, 'Fix **it**\n\n```\nnpm test\n```\n\n## Comments\n\n**Bo** (2026-09-02T00:00:00.000+0000):\nok `x`\n\n**Cy** (2026-09-03T00:00:00.000+0000):\nraw *wiki*');
  assert.deepEqual(t.meta, { key: 'SHOP-12', project: 'SHOP', type: 'Bug', status: 'In Progress', priority: 'High' });
  await assert.rejects(createTaskSource(makeCtx(), { fetch }).getTask('bad id'), (e) => e.kind === 'plugin');
});

// ── reportResult / capabilities ───────────────────────────────────────────────
test('reportResult: comment always; named transition only when completed and configured', async () => {
  const TRANSITIONS = { transitions: [{ id: '21', name: 'Start', to: { name: 'In Progress' } }, { id: '31', name: 'Resolve', to: { name: 'Done' } }] };
  const routes = (status = 'In Progress') => [
    { match: /\/issue\/SHOP-12\/comment$/, method: 'POST', reply: res(201, { id: '99' }) },
    { match: /\/issue\/SHOP-12\/transitions$/, method: 'POST', reply: res(204, null) },
    { match: /\/issue\/SHOP-12\/transitions$/, reply: res(200, TRANSITIONS) },
    { match: /\/issue\/SHOP-12\?fields=status$/, reply: res(200, issue('SHOP-12', { status: { name: status } })) },
  ];
  const result = { status: 'completed', summary: 'done', links: [{ title: 'Pull request', url: 'https://github.com/acme/shop/pull/5' }], inputs: { writeBack: 'yes' } };
  await checkRows([
    { name: 'no transition configured → comment only, links as wiki bullets', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx(), { fetch }).reportResult('SHOP-12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST']);
      assert.equal(fetch.calls[0].url, 'https://acme.atlassian.net/rest/api/2/issue/SHOP-12/comment');
      assert.deepEqual(fetch.calls[0].body, { body: 'done\n\n* [Pull request|https://github.com/acme/shop/pull/5]' });
    } },
    { name: 'configured by status name (to.name) → read status, list transitions, POST transition, THEN one comment saying so', run: async () => {
      const fetch = fakeFetch(routes());
      const out = await createTaskSource(makeCtx({ transitionOnComplete: 'done' }), { fetch }).reportResult('SHOP-12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['GET', 'GET', 'POST', 'POST']);
      assert.deepEqual(fetch.calls[2].body, { transition: { id: '31' } });
      assert.match(fetch.calls[3].url, /\/comment$/);
      assert.equal(fetch.calls[3].body.body, 'done\n\nMoved to Done.\n\n* [Pull request|https://github.com/acme/shop/pull/5]');
      assert.deepEqual(out, { commented: true, transitioned: true });
    } },
    { name: 'configured by transition name', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx({ transitionOnComplete: 'Resolve' }), { fetch }).reportResult('SHOP-12', result);
      assert.deepEqual(fetch.calls[2].body, { transition: { id: '31' } });
    } },
    { name: 'a failed transition POST throws before any comment (a retry posts once)', run: async () => {
      const fetch = fakeFetch([{ match: /\/transitions$/, method: 'POST', reply: res(400, { errorMessages: ['Field resolution is required'] }) }, ...routes()]);
      await assert.rejects(createTaskSource(makeCtx({ transitionOnComplete: 'Done' }), { fetch }).reportResult('SHOP-12', result), /resolution is required/);
      assert.equal(fetch.calls.some((c) => /\/comment$/.test(c.url)), false);
    } },
    { name: 'failed run → comment only', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx({ transitionOnComplete: 'Done' }), { fetch }).reportResult('SHOP-12', { ...result, status: 'failed' });
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST']);
    } },
    { name: 'already in the target status → no transition calls', run: async () => {
      const fetch = fakeFetch(routes('Done'));
      await createTaskSource(makeCtx({ transitionOnComplete: 'Done' }), { fetch }).reportResult('SHOP-12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['GET', 'POST']);
      assert.match(fetch.calls[1].body.body, /Already in Done\./);
    } },
    { name: 'no matching transition → the comment says so on the ticket (and the log), no throw', run: async () => {
      logs.length = 0;
      const fetch = fakeFetch(routes());
      const out = await createTaskSource(makeCtx({ transitionOnComplete: 'Shipped' }), { fetch }).reportResult('SHOP-12', result);
      assert.deepEqual(out, { commented: true, transitioned: false });
      assert.deepEqual(fetch.calls.map((c) => c.method), ['GET', 'GET', 'POST']);
      assert.match(fetch.calls[2].body.body, /Could not move to "Shipped" from "In Progress" \(available: Start, Resolve\)\./);
      assert.ok(logs.some(([level, msg]) => level === 'warn' && /Shipped/.test(msg)));
    } },
    { name: 'write-back is opt-in: "no" or no writeBack pinned on the run → nothing posted', run: async () => {
      for (const inputs of [{ writeBack: 'no' }, {}, undefined]) {
        const fetch = fakeFetch(routes());
        await createTaskSource(makeCtx({ transitionOnComplete: 'Done' }), { fetch }).reportResult('SHOP-12', { ...result, inputs });
        assert.equal(fetch.calls.length, 0, JSON.stringify(inputs));
      }
    } },
    { name: 'a bad id throws kind plugin, no request', run: async () => {
      const fetch = fakeFetch(routes());
      await assert.rejects(createTaskSource(makeCtx(), { fetch }).reportResult('nope', result), (e) => e.kind === 'plugin' && /PROJ-123/.test(e.message));
      assert.equal(fetch.calls.length, 0);
    } },
    { name: 'capabilities follow the per-run writeBack input (absent = no)', run: () => {
      const src = createTaskSource(makeCtx(), { fetch: fakeFetch([]) });
      assert.equal(src.capabilities({ inputs: { writeBack: 'no' } }).writeBack, false);
      assert.equal(src.capabilities({ inputs: { writeBack: 'yes' } }).writeBack, true);
      assert.equal(src.capabilities({ inputs: {} }).writeBack, false);
      assert.equal(src.capabilities().writeBack, false);
    } },
  ]);
});

// ── markup ────────────────────────────────────────────────────────────────────
test('markdownToWiki, wikiLink, htmlToMarkdown', async () => {
  await checkRows([
    { name: 'the host summary becomes wiki markup; [brackets] stay text', run: () => {
      const md = ['### Worca CC run `r-1` — completed', '', '**Fix it**', '', '- Diffstat: 2 changed, +3 / -1', '- Branch: `worca/x`', '',
        'Key things to check:', '- [major] Null check (`src/a.mjs`)', '1. first'].join('\n');
      assert.equal(markdownToWiki(md), ['h3. Worca CC run {{r-1}} — completed', '', '*Fix it*', '', '* Diffstat: 2 changed, +3 / -1',
        '* Branch: {{worca/x}}', '', 'Key things to check:', '* \\[major\\] Null check ({{src/a.mjs}})', '# first'].join('\n'));
    } },
    { name: 'wikiLink: http(s) only; | and ] cannot break out', run: () => {
      assert.equal(wikiLink('PR', 'https://x.test/a'), '[PR|https://x.test/a]');
      assert.equal(wikiLink('a|b]', 'https://x.test/a|b'), '[a b|https://x.test/a%7Cb]');
      assert.equal(wikiLink('evil', 'javascript:alert(1)'), 'evil');
    } },
    { name: 'htmlToMarkdown: links, entities, unsafe hrefs dropped', run: () => {
      assert.equal(htmlToMarkdown('<p>See <a href="https://x.test/?a=1&amp;b=2" class="external-link">docs</a> &amp; <a href="javascript:x">no</a></p>'),
        'See [docs](https://x.test/?a=1&b=2) & no');
    } },
  ]);
});
