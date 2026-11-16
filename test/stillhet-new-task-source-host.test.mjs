// test/stillhet-new-task-source-host.test.mjs — COV-2 D8 (docs/rail/forms.md form.run-options): New task's ticket source.
// A plugin task source is a segment beside Write it and From file; its profile gate binds a profile; the search lists
// tickets; the picked one's preview comes from getTask; Start sends it as `source`, with no prompt. Live app host (jsdom).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const JIRA = { type: 'plugin', plugin: 'jira', sourceId: 'issues', displayName: 'Jira', inputs: [{ key: 'project', type: 'text', default: 'WEB' }, { key: 'pick', type: 'task-browser' }], multiProfile: true, profiles: [{ id: 'work' }, { id: 'home' }] };
const SOURCES = { sources: [{ type: 'prompt', displayName: 'Prompt' }, { type: 'markdown', displayName: 'Markdown' }, JIRA] };
const BINDING = '/api/source-bindings?projectDir=%2Fsrc%2Fweb&plugin=jira&sourceId=issues';
const TICKETS = [{ id: 'WEB-1', title: 'WEB-1 Pager breaks on page 2', labels: ['bug'] }, { id: 'WEB-2', title: 'WEB-2 Export to CSV' }];
async function open({ sources = SOURCES, binding = [200, { profile: 'work', via: 'binding' }], call = (b) => [200, { ok: true, result: b.op === 'validateConfig' ? { ok: true } : b.op === 'getTask' ? { title: 'WEB-1 Pager breaks on page 2', body: 'Page 2 shows page 1.' } : { tasks: TICKETS.filter((t) => t.title.toLowerCase().includes(String(b.args.search || '').toLowerCase())) } }], hold, write = () => [200, { runId: 'r-new' }] } = {}) {
  const h = await liveHost({ lists: LISTS, hold, read: (u) => (u === '/api/sources' ? [200, sources] : u === BINDING ? binding : null), write: (u, b, m) => (u === '/api/sources/call' ? call(b) : write(u, b, m)) });
  await go(h.w, '#runs', 120);
  h.w.RailCenters.maker('tasks').newPick('form'); await settle(80);
  return h;
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const segs = (d) => [...d.querySelectorAll('#center-dlg [data-c-src]')].map((b) => b.textContent);
const jira = async (d) => { q(d, '[data-c-src="plugin:0"]').click(); await settle(60); };
const type = (w, d, sel, v) => { const t = q(d, sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const runs = (calls) => posts(calls).filter(([, u]) => u === '/api/run').map(([, , b]) => b);
const lists = (calls) => posts(calls).filter(([, u, b]) => u === '/api/sources/call' && b.op === 'listTasks').map(([, , b]) => b);

test('COV-2 source: with no plugin source nothing changes, and the start body is today\'s', async () => {
  const { w, d, calls } = await open({ sources: { sources: SOURCES.sources.slice(0, 2) } });
  assert.deepEqual(segs(d), ['Write it', 'From file']);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.deepEqual(runs(calls)[0], { projectDir: '/src/web', prompt: 'Add a pager' });
});

test('COV-2 source: each plugin source is a segment after Write it and From file', async () => {
  const { d } = await open();
  assert.deepEqual(segs(d), ['Write it', 'From file', 'Jira']);
});

test('COV-2 source: no bound profile shows the gate in classic\'s words; Use this profile binds it, then lists', async () => {
  const { d, calls } = await open({ binding: [200, { profile: null, via: 'none' }] });
  await jira(d);
  const n = q(d, '.choice-note');
  assert.match(n.textContent, /Which Jira profile does web pull from\? Asked once, then remembered\./);
  assert.equal(lists(calls).length, 0, 'no ticket list before a profile is bound');
  q(d, '[data-menu="f-gprofile"]').click(); await settle(10); q(d, '[data-menu-pick="f-gprofile|home"]').click(); await settle(30);
  q(d, '[data-c-bind]').click(); await settle(60);
  assert.deepEqual(posts(calls).find(([m]) => m === 'PUT'), ['PUT', '/api/source-bindings', { projectDir: '/src/web', plugin: 'jira', sourceId: 'issues', profile: 'home' }]);
  assert.equal(q(d, '.choice-note'), null);
  assert.equal(lists(calls)[0].profile, 'home');
});

test('COV-2 source: a conflict and a source with no profiles say so, as classic does', async () => {
  const c = await open({ binding: [200, { profile: null, via: 'conflict', candidates: ['work', 'home'] }] });
  await jira(c.d);
  assert.match(q(c.d, '.choice-note').textContent, /The projects in web disagree about which Jira profile to use \(work, home\)\. Pick the one this task should read from\./);
  closeHosts();
  const none = await open({ sources: { sources: [{ ...JIRA, profiles: [] }] }, binding: [200, { profile: null, via: 'none' }] });
  await jira(none.d);
  assert.match(q(none.d, '.choice-note').textContent, /Jira has no profiles configured yet\./);
  assert.equal(q(none.d, '[data-c-bind]'), null);
});

test('COV-2 source: a bound profile lists the tickets with its inputs; typing searches after 300 ms', async () => {
  const { w, d, calls } = await open();
  await jira(d);
  assert.deepEqual(lists(calls)[0], { plugin: 'jira', sourceId: 'issues', op: 'listTasks', args: { inputs: { project: 'WEB' }, search: '' }, profile: 'work' });
  assert.equal(d.querySelectorAll('#center-dlg [data-c-ticket]').length >= 2, true);
  type(w, d, '#cc-search', 'csv'); await settle(100);
  assert.equal(lists(calls).length, 1, 'still waiting for the pause');
  await settle(300);
  assert.equal(lists(calls).at(-1).args.search, 'csv');
  assert.deepEqual([...d.querySelectorAll('#center-dlg .lr-t')].map((x) => x.textContent), ['WEB-2 Export to CSV']);
});

test('COV-2 source: a stale search answer is dropped', async () => {
  let n = 0, release; const held = new Promise((r) => { release = r; });
  const { w, d } = await open({ call: async (b) => { if (b.op !== 'listTasks') return [200, { ok: true, result: { ok: true } }]; n++; if (b.args.search === 'pag') await held; return [200, { ok: true, result: { tasks: TICKETS.filter((t) => t.title.toLowerCase().includes(b.args.search)) } }]; } });
  await jira(d);
  type(w, d, '#cc-search', 'pag'); await settle(350);
  type(w, d, '#cc-search', 'csv'); await settle(350);
  release(); await settle(60);
  assert.ok(n >= 3);
  assert.deepEqual([...d.querySelectorAll('#center-dlg .lr-t')].map((x) => x.textContent), ['WEB-2 Export to CSV'], 'the older answer never lands');
});

test('COV-2 source: a picked ticket shows its preview from getTask; Start sends source and no prompt', async () => {
  const { d, calls } = await open();
  await jira(d);
  q(d, 'button[data-c-ticket="WEB-1"]').click(); await settle(60);
  assert.deepEqual(posts(calls).find(([, u, b]) => u === '/api/sources/call' && b.op === 'getTask')[2], { plugin: 'jira', sourceId: 'issues', op: 'getTask', args: { id: 'WEB-1' }, profile: 'work' });
  assert.match(q(d, '.prose').textContent, /Page 2 shows page 1\./);
  await start(d);
  const [b] = runs(calls);
  assert.equal(b.prompt, undefined);
  assert.deepEqual(b.source, { type: 'plugin', plugin: 'jira', sourceId: 'issues', taskId: 'WEB-1', inputs: { project: 'WEB' }, profile: 'work' });
});

test('COV-2 source: Start with no ticket picked says so under the search and starts nothing', async () => {
  const { d, calls } = await open();
  await jira(d);
  await start(d);
  assert.equal(runs(calls).length, 0);
  assert.match(q(d, '.dlg').textContent, /Pick a task from the list first\./);
});

test('COV-2 source: a connector refusal shows search failed with its message', async () => {
  const { d } = await open({ call: (b) => (b.op === 'validateConfig' ? [200, { ok: true, result: { ok: true } }] : [200, { ok: false, error: { kind: 'auth', message: 'token expired' } }]) });
  await jira(d);
  assert.match(q(d, '.dlg').textContent, /search failed: token expired/);
  assert.equal(d.querySelectorAll('#center-dlg [data-c-ticket]').length, 0);
});

test('COV-2 source: Write it again starts from the words, as before', async () => {
  const { w, d, calls } = await open();
  await jira(d);
  q(d, '[data-c-src="write"]').click(); await settle(30);
  type(w, d, '#cc-text', 'Add a pager'); await start(d);
  assert.deepEqual(runs(calls)[0], { projectDir: '/src/web', prompt: 'Add a pager' });
});
