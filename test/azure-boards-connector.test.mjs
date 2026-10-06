// test/azure-boards-connector.test.mjs — Azure Boards connector, pure unit tests with an injected fake fetch
// (no network, no shim child). The connector is plain ESM so it imports directly from plugins/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { wrapWiql, parseWorkItemRef } from '../plugins/azure-boards-source/connector/index.mjs';
import { htmlToMarkdown, markdownToHtml } from '../plugins/azure-boards-source/connector/html-md.mjs';
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
const makeCtx = (config = {}) => ({ apiVersion: 1, config: { organization: 'acme', token: 'pat', closeOnComplete: 'no', ...config },
  state: { get: async () => null, set: async () => {} }, log: () => {} });
const wi = (id, fields = {}) => ({ id, fields: { 'System.Id': id, 'System.Title': `Item ${id}`, 'System.State': 'Active', 'System.Tags': 'a; b',
  'System.ChangedDate': '2026-09-01T00:00:00Z', 'System.WorkItemType': 'Bug', 'System.TeamProject': 'Shop', ...fields } });
const DEFAULT_QUERY = "[System.AssignedTo] = @Me AND [System.State] <> 'Closed'";

// ── validateConfig / listProjects ─────────────────────────────────────────────
test('validateConfig and listProjects', async () => {
  await checkRows([
    { name: 'connectionData → identity; Basic auth with an empty user; no api-version on connectionData', run: async () => {
      const fetch = fakeFetch([{ match: /\/_apis\/connectionData$/, reply: res(200, { authenticatedUser: { providerDisplayName: 'Ann' } }) }]);
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).validateConfig(), { ok: true, identity: 'Ann' });
      assert.equal(fetch.calls[0].url, 'https://dev.azure.com/acme/_apis/connectionData');
      assert.equal(fetch.calls[0].headers.authorization, `Basic ${Buffer.from(':pat').toString('base64')}`);
      assert.equal(fetch.calls[0].headers['x-tfs-fedauthredirect'], 'Suppress');
    } },
    { name: '401 and 203 → token field error, not a throw', run: async () => {
      for (const status of [401, 203]) {
        const v = await createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(status, null) }]) }).validateConfig();
        assert.equal(v.ok, false);
        assert.equal(v.errors[0].field, 'token');
      }
    } },
    { name: 'missing organization / token → field errors, no request', run: async () => {
      const fetch = fakeFetch([]);
      assert.equal((await createTaskSource(makeCtx({ organization: '' }), { fetch }).validateConfig()).errors[0].field, 'organization');
      assert.equal((await createTaskSource(makeCtx({ token: '' }), { fetch }).validateConfig()).errors[0].field, 'token');
      assert.equal(fetch.calls.length, 0);
    } },
    { name: '404 → organization field error', run: async () => {
      const v = await createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(404, { message: 'nope' }) }]) }).validateConfig();
      assert.equal(v.errors[0].field, 'organization');
    } },
    { name: 'listProjects → value/label pairs', run: async () => {
      const fetch = fakeFetch([{ match: /\/_apis\/projects/, reply: res(200, { value: [{ name: 'Shop' }, { name: 'My Project' }] }) }]);
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).listProjects(), [{ value: 'Shop', label: 'Shop' }, { value: 'My Project', label: 'My Project' }]);
      assert.equal(fetch.calls[0].url, 'https://dev.azure.com/acme/_apis/projects?$top=500&api-version=7.1');
    } },
    { name: 'listProjects 401/203 → kind auth naming the Project and Team (Read) scope', run: async () => {
      for (const status of [401, 203]) {
        await assert.rejects(createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(status, null) }]) }).listProjects(),
          (e) => e.kind === 'auth' && /Project and Team \(Read\)/.test(e.message));
      }
    } },
  ]);
});

// ── WIQL + listTasks ──────────────────────────────────────────────────────────
test('wrapWiql scopes to the project, wraps the filter, quotes the search', () => {
  assert.equal(wrapWiql("[System.State] = 'Active'", "it's"),
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([System.State] = 'Active') AND [System.Title] CONTAINS 'it''s' ORDER BY [System.ChangedDate] DESC");
  assert.equal(wrapWiql('', ''), 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC');
});

test('listTasks: WIQL ids, one workitemsbatch POST per 50-id page, cursor paging', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const routes = [
    { match: /\/_apis\/wit\/wiql/, method: 'POST', reply: res(200, { workItems: ids.map((id) => ({ id })) }) },
    { match: /\/_apis\/wit\/workitemsbatch/, method: 'POST', reply: (_url, init) => res(200, { value: JSON.parse(init.body).ids.map((id) => wi(id)) }) },
  ];
  await checkRows([
    { name: 'first page', run: async () => {
      const fetch = fakeFetch(routes);
      const out = await createTaskSource(makeCtx(), { fetch }).listTasks({ inputs: { project: 'Shop', query: DEFAULT_QUERY } });
      assert.equal(fetch.calls[0].url, 'https://dev.azure.com/acme/Shop/_apis/wit/wiql?$top=1000&api-version=7.1');
      assert.deepEqual(fetch.calls[0].body, { query: wrapWiql(DEFAULT_QUERY, undefined) });
      const batches = fetch.calls.filter((c) => /workitemsbatch/.test(c.url));
      assert.equal(batches.length, 1, 'one batch POST of 50 ids');
      assert.equal(batches[0].url, 'https://dev.azure.com/acme/_apis/wit/workitemsbatch?api-version=7.1');
      assert.deepEqual(batches[0].body.ids, ids.slice(0, 50));
      assert.ok(batches[0].body.fields.includes('System.Title'));
      assert.equal(out.tasks.length, 50);
      assert.equal(out.cursor, '50');
      assert.deepEqual(out.tasks[0], { id: 'acme/Shop#1', title: 'Item 1', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/1',
        state: 'open', labels: ['a', 'b'], updatedAt: '2026-09-01T00:00:00Z' });
    } },
    { name: 'last page: no cursor', run: async () => {
      const fetch = fakeFetch(routes);
      const out = await createTaskSource(makeCtx(), { fetch }).listTasks({ inputs: { project: 'Shop' }, cursor: '200' });
      assert.deepEqual(fetch.calls.find((c) => /workitemsbatch/.test(c.url)).body.ids, ids.slice(200, 250));
      assert.equal(out.tasks.length, 50);
      assert.equal('cursor' in out, false);
    } },
    { name: 'no project → empty, no request', run: async () => {
      const fetch = fakeFetch([]);
      assert.deepEqual(await createTaskSource(makeCtx(), { fetch }).listTasks({ inputs: {} }), { tasks: [] });
      assert.equal(fetch.calls.length, 0);
    } },
    { name: 'a pasted #12 or work item URL → that one item; 404 → empty', run: async () => {
      const one = fakeFetch([{ match: /\/_apis\/wit\/workitems\/12\?\$expand=fields&api-version=7\.1$/, reply: res(200, wi(12, { 'System.State': 'Closed' })) }]);
      const src = createTaskSource(makeCtx(), { fetch: one });
      assert.deepEqual((await src.listTasks({ inputs: { project: 'Shop' }, search: '#12' })).tasks.map((t) => [t.id, t.state]), [['acme/Shop#12', 'closed']]);
      assert.equal((await src.listTasks({ inputs: { project: 'Shop' }, search: 'https://dev.azure.com/acme/Shop/_workitems/edit/12' })).tasks.length, 1);
      const gone = createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(404, { message: 'gone' }) }]) });
      assert.deepEqual(await gone.listTasks({ inputs: { project: 'Shop' }, search: '#12' }), { tasks: [] });
    } },
  ]);
});

// ── getTask ───────────────────────────────────────────────────────────────────
test('getTask: description and comments as markdown; meta', async () => {
  const fetch = fakeFetch([
    { match: /\/workItems\/12\/comments/, reply: res(200, { comments: [{ createdBy: { displayName: 'Bo' }, createdDate: '2026-09-02T00:00:00Z', text: '<p>ok</p>' }] }) },
    { match: /\/workitems\/12\?/, reply: res(200, wi(12, { 'System.Description': '<p>Fix <b>it</b></p>' })) },
  ]);
  const t = await createTaskSource(makeCtx(), { fetch }).getTask('acme/Shop#12');
  assert.equal(t.id, 'acme/Shop#12');
  assert.equal(t.body, 'Fix **it**\n\n## Comments\n\n**Bo** (2026-09-02T00:00:00Z):\nok');
  assert.deepEqual(t.meta, { organization: 'acme', project: 'Shop', id: 12, type: 'Bug' });
  assert.equal(fetch.calls.find((c) => /comments/.test(c.url)).url, 'https://dev.azure.com/acme/Shop/_apis/wit/workItems/12/comments?api-version=7.1-preview.4');
  await assert.rejects(createTaskSource(makeCtx(), { fetch }).getTask('bad'), (e) => e.kind === 'plugin');
});

// ── reportResult ──────────────────────────────────────────────────────────────
test('reportResult: comment always; Completed-category state only when completed and closeOnComplete', async () => {
  const STATES = { value: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' },
    { name: 'Resolved', category: 'Resolved' }, { name: 'Closed', category: 'Completed' }] };
  const routes = (state = 'Active') => [
    { match: /\/comments/, method: 'POST', reply: res(200, {}) },
    { match: /\/workitems\/12\?api-version/, method: 'PATCH', reply: res(200, {}) },
    { match: /\/workitemtypes\/Bug\/states/, reply: res(200, STATES) },
    { match: /\/workitems\/12\?\$expand/, reply: res(200, wi(12, { 'System.State': state })) },
  ];
  const result = { status: 'completed', summary: 'done', links: [{ title: 'PR', url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/5' }] };
  await checkRows([
    { name: 'yes + completed → comment, read type, read states, PATCH to Closed (json-patch)', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx({ closeOnComplete: 'yes' }), { fetch }).reportResult('acme/Shop#12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST', 'GET', 'GET', 'PATCH']);
      assert.equal(fetch.calls[0].body.text, '<p>done</p><ul><li><a href="https://dev.azure.com/acme/Shop/_git/api/pullrequest/5">PR</a></li></ul>');
      const patch = fetch.calls[3];
      assert.equal(patch.url, 'https://dev.azure.com/acme/Shop/_apis/wit/workitems/12?api-version=7.1');
      assert.equal(patch.headers['content-type'], 'application/json-patch+json');
      assert.deepEqual(patch.body, [{ op: 'add', path: '/fields/System.State', value: 'Closed' }]);
    } },
    { name: 'no → comment only', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx({ closeOnComplete: 'no' }), { fetch }).reportResult('acme/Shop#12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST']);
    } },
    { name: 'yes + failed → comment only', run: async () => {
      const fetch = fakeFetch(routes());
      await createTaskSource(makeCtx({ closeOnComplete: 'yes' }), { fetch }).reportResult('acme/Shop#12', { ...result, status: 'failed' });
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST']);
    } },
    { name: 'already in the Completed category → no PATCH', run: async () => {
      const fetch = fakeFetch(routes('Closed'));
      await createTaskSource(makeCtx({ closeOnComplete: 'yes' }), { fetch }).reportResult('acme/Shop#12', result);
      assert.deepEqual(fetch.calls.map((c) => c.method), ['POST', 'GET', 'GET']);
      assert.match(fetch.calls[2].url, /\/workitemtypes\/Bug\/states\?api-version=7\.1-preview\.1$/);
    } },
    { name: 'a multi-line markdown summary becomes HTML, not one escaped line', run: async () => {
      const fetch = fakeFetch(routes());
      const summary = ['### Worca CC run `r-1` — completed', '', '**Fix <it>**', '', '- Diffstat: 2 changed, 0 new, 0 deleted, +3 / -1',
        '- Branch: `worca/x`', '', 'Key things to check:', '- [major] Null check (`src/a.mjs`)'].join('\n');
      await createTaskSource(makeCtx(), { fetch }).reportResult('acme/Shop#12', { status: 'completed', summary, links: [] });
      assert.equal(fetch.calls[0].body.text,
        '<h3>Worca CC run <code>r-1</code> — completed</h3><p><b>Fix &lt;it&gt;</b></p>'
        + '<ul><li>Diffstat: 2 changed, 0 new, 0 deleted, +3 / -1</li><li>Branch: <code>worca/x</code></li></ul>'
        + '<p>Key things to check:</p><ul><li>[major] Null check (<code>src/a.mjs</code>)</li></ul>');
    } },
    { name: 'a bad id throws kind plugin, no request (the host must not record ok:true)', run: async () => {
      const fetch = fakeFetch(routes());
      await assert.rejects(createTaskSource(makeCtx(), { fetch }).reportResult('nope', result), (e) => e.kind === 'plugin' && /org\/project#123/.test(e.message));
      assert.equal(fetch.calls.length, 0);
    } },
  ]);
});

test('listTasks: workitemsbatch sends errorPolicy Omit and drops the null slot of a deleted item', async () => {
  const fetch = fakeFetch([
    { match: /\/_apis\/wit\/wiql/, method: 'POST', reply: res(200, { workItems: [{ id: 1 }, { id: 2 }, { id: 3 }] }) },
    { match: /\/_apis\/wit\/workitemsbatch/, method: 'POST', reply: res(200, { value: [wi(1), null, wi(3)] }) },
  ]);
  const out = await createTaskSource(makeCtx(), { fetch }).listTasks({ inputs: { project: 'Shop' } });
  assert.equal(fetch.calls[1].body.errorPolicy, 'Omit');
  assert.deepEqual(out.tasks.map((t) => t.id), ['acme/Shop#1', 'acme/Shop#3']);
});

// ── error kinds, helpers ──────────────────────────────────────────────────────
test('error kinds: auth, rate-limit, network, plugin', async () => {
  const kind = async (fetch) => { try { await createTaskSource(makeCtx(), { fetch }).listProjects(); return 'ok'; } catch (e) { return e.kind; } };
  assert.equal(await kind(fakeFetch([{ match: /./, reply: res(401, null) }])), 'auth');
  assert.equal(await kind(fakeFetch([{ match: /./, reply: res(203, null) }])), 'auth');
  assert.equal(await kind(fakeFetch([{ match: /./, reply: res(429, null, { 'Retry-After': '7' }) }])), 'rate-limit');
  assert.equal(await kind(async () => { throw new Error('ECONNRESET'); }), 'network');
  assert.equal(await kind(fakeFetch([{ match: /./, reply: res(500, { message: 'boom' }) }])), 'plugin');
  try { await createTaskSource(makeCtx(), { fetch: fakeFetch([{ match: /./, reply: res(429, null, { 'Retry-After': '7' }) }]) }).listProjects(); }
  catch (e) { assert.match(e.message, /retry after 7s/); }
});

test('htmlToMarkdown, markdownToHtml, parseWorkItemRef, capabilities', () => {
  assert.equal(markdownToHtml('done'), '<p>done</p>');
  assert.equal(markdownToHtml('a\nb'), '<p>a<br>b</p>');
  assert.equal(markdownToHtml(''), '');
  assert.equal(htmlToMarkdown('<p>Hi <b>there</b></p><ul><li>a</li></ul><a href="https://x">x</a>&amp;'), 'Hi **there**\n\n- a\n\n[x](https://x)&');
  assert.equal(htmlToMarkdown(''), '');
  assert.equal(htmlToMarkdown('<img src="x.png"> see <i>this</i>'), 'see _this_');
  assert.equal(htmlToMarkdown('<blockquote>q <b>bold</b></blockquote>'), 'q **bold**');
  // s1: hex and decimal entities, astral code points; unknown entities stay as written
  assert.equal(htmlToMarkdown('it&#x27;s &#39;q&#39; &#128512; &#x1F600; &bogus; &#0;'), "it's 'q' 😀 😀 &bogus; &#0;");
  // s2: only http(s) links survive as links, in both directions; ordered lists render as <ol>
  assert.equal(htmlToMarkdown('<a href="javascript:alert(1)">click</a> <a href="https://ok">ok</a>'), 'click [ok](https://ok)');
  assert.equal(markdownToHtml('1. one\n2. two\n- a\n- b'), '<ol><li>one</li><li>two</li></ol><ul><li>a</li><li>b</li></ul>');
  assert.equal(markdownToHtml('### T\n\n1) x\n\ntext'), '<h3>T</h3><ol><li>x</li></ol><p>text</p>');
  assert.deepEqual(parseWorkItemRef('acme/My Project#12'), { org: 'acme', project: 'My Project', id: 12 });
  assert.equal(parseWorkItemRef('bad'), null);
  assert.deepEqual(createTaskSource(makeCtx(), { fetch: fakeFetch([]) }).capabilities(), { writeBack: true, incrementalSync: false });
});
