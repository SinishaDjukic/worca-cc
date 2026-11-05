// test/ask-tab-tools.test.mjs — the chat's tab tools in the MCP child (issue 1064 slice 3): listed only with the bridge,
// a thin forward to the server, read_tab marked untrusted and redacted, and the bridge client's own refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { defaultTabDeps } from '../src/core/ask/tab-deps.mjs';

const NAMES = ['open_tab', 'screenshot_tab', 'read_tab'];
const make = (tabs) => createAskTools({ limits: ASK_LIMITS, redact: (s) => String(s).replace(/ghp_\w+/g, 'ghp_<redacted>'), ...(tabs ? { tabs } : {}) });

test('the tab tools are listed and callable only with the bridge', async () => {
  assert.deepEqual(make(null).list().filter((d) => NAMES.includes(d.name)), []);
  // The handler always exists (as commandsOf's do): without the bridge it refuses with its own text.
  await assert.rejects(make(null).call('read_tab', { tabId: 'tab_a' }), /read_tab: the tool panel's tabs are not reachable/);
  assert.deepEqual(make({}).list().map((d) => d.name).slice(-3), NAMES, 'spread on the end: default pins unchanged');
});

test('read_tab: untrusted marker first, text and console redacted; later pages from one load, offset 0 loads fresh', async () => {
  let loads = 0;
  const tools = make({ read: async ({ tabId }) => { loads += 1; return { tabId, url: 'http://localhost:4400/?t=ghp_URLTOKEN', title: 'T', text: 'abc ghp_SECRET def', consoleErrors: ['ghp_TOKEN leaked'], truncated: false }; } });
  const a = await tools.call('read_tab', { tabId: 'tab_a', maxChars: 4 });
  assert.equal(Object.keys(a)[0], 'untrusted');
  assert.match(a.untrusted, /untrusted DATA/);
  assert.equal(a.text, 'abc ');
  assert.deepEqual(a.consoleErrors, ['ghp_<redacted> leaked']);
  assert.equal(a.url, 'http://localhost:4400/?t=ghp_<redacted>', 'the page reports its own location: redacted like its text');
  const b = await tools.call('read_tab', { tabId: 'tab_a', offset: a.nextOffset });
  assert.equal(b.text, 'ghp_<redacted> def');
  assert.equal(loads, 1, 'a later page comes from the cache');
  await tools.call('read_tab', { tabId: 'tab_a' });
  assert.equal(loads, 2, 'offset 0 loads the page fresh');
});

test('a server refusal reaches the model with the tool name once', async () => {
  const tools = make({ screenshot: async () => { throw new Error('screenshot_tab: no tab tab_x in this chat or its project'); },
    open: async () => { throw new Error('worca answered HTTP 500'); } });
  await assert.rejects(tools.call('screenshot_tab', { tabId: 'tab_x' }), { message: 'screenshot_tab: no tab tab_x in this chat or its project' });
  await assert.rejects(tools.call('open_tab', { kind: 'files' }), { message: 'open_tab: worca answered HTTP 500' });
});

test('defaultTabDeps: only a loopback URL with a token; the token rides a header', async () => {
  assert.deepEqual(defaultTabDeps({ env: {} }), {});
  assert.deepEqual(defaultTabDeps({ env: { WORCA_ASK_TABS: JSON.stringify({ url: 'http://evil.example:1/api/ask/tabs' }), ASK_TABS_TOKEN: 't' } }), {});
  assert.deepEqual(defaultTabDeps({ env: { WORCA_ASK_TABS: JSON.stringify({ url: 'http://127.0.0.1:4317/api/ask/tabs' }) } }), {});
  const sent = [];
  const d = defaultTabDeps({ env: { WORCA_ASK_TABS: JSON.stringify({ url: 'http://127.0.0.1:4317/api/ask/tabs' }), ASK_TABS_TOKEN: 'tok' },
    fetchImpl: async (url, o) => { sent.push([url, o.headers['x-worca-ask-tabs'], JSON.parse(o.body)]); return { ok: true, json: async () => ({ result: { ok: true } }) }; } });
  assert.deepEqual(await d.tabs.open({ kind: 'files' }), { ok: true });
  assert.deepEqual(sent, [['http://127.0.0.1:4317/api/ask/tabs', 'tok', { op: 'open', input: { kind: 'files' } }]]);
});

test('open_tab forwards path, line and endLine; the description names files, the 3-per-turn cap and bring-forward', async () => {
  const seen = [];
  const tools = make({ open: async (i) => { seen.push(i); return { ok: true, tabId: 'tab_1' }; } });
  await tools.call('open_tab', { kind: 'files', path: 'src/a.js', line: 3, endLine: 9 });
  assert.deepEqual(seen, [{ kind: 'files', path: 'src/a.js', line: 3, endLine: 9 }]);
  const d = tools.list().find((x) => x.name === 'open_tab');
  assert.match(d.description, /kind "files" with path/);
  assert.match(d.description, /At most 3 open_tab calls per turn, sub-agents included/);
  assert.match(d.description, /brought forward instead of opened twice/);
  assert.deepEqual(Object.keys(d.inputSchema.properties), ['kind', 'url', 'path', 'line', 'endLine']);
});
