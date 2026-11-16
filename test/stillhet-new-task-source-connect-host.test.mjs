// test/stillhet-new-task-source-connect-host.test.mjs — gate.real-data F-cov23-04 (docs/rail/forms.md form.run-options): a
// ticket source is checked first, as classic's New run does (app.js mountPluginSourcePane: validateConfig), and an
// unconnected one says so with its ways out (Open the Marketplace page, Test connection) instead of an empty list; the
// source's own inputs come before the search, a remote-select (GitHub's Repository) filled from its optionsFrom op
// (source-pane.mjs renderSourcePane). Live app host (jsdom), the real shell, a stubbed fetch.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveHost, go, settle, closeHosts, posts, LISTS } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const GH = { type: 'plugin', plugin: 'github-source', sourceId: 'issues', displayName: 'GitHub Issues', multiProfile: false, profiles: [],
  inputs: [{ key: 'repo', type: 'remote-select', label: 'Repository', optionsFrom: 'listProjects' }, { key: 'filter', type: 'text', label: 'Filter', default: 'assignee:@me state:open' }, { key: 'task', type: 'task-browser', label: 'Issue' }] };
const SOURCES = { sources: [{ type: 'prompt', displayName: 'Prompt' }, GH] };
const REPOS = [{ value: 'acme/web', label: 'acme/web' }, { value: 'acme/api', label: 'acme/api' }];
const ISSUES = [{ id: '12', title: '#12 Pager breaks' }];
const connected = (b) => [200, { ok: true, result: b.op === 'validateConfig' ? { ok: true } : b.op === 'listProjects' ? REPOS : { tasks: ISSUES } }];
async function open({ call = connected } = {}) {
  const h = await liveHost({ lists: LISTS, read: (u) => (u === '/api/sources' ? [200, SOURCES] : null), write: (u, b) => (u === '/api/sources/call' ? call(b) : [200, { runId: 'r-new' }]) });
  await go(h.w, '#runs', 120);
  h.w.RailCenters.maker('tasks').newPick('form'); await settle(80);
  return h;
}
const q = (d, sel) => d.querySelector(`#center-dlg ${sel}`);
const gh = async (d) => { q(d, '[data-c-src="plugin:0"]').click(); await settle(80); };
const ops = (calls, op) => posts(calls).filter(([, u, b]) => u === '/api/sources/call' && b.op === op).map(([, , b]) => b);
const start = async (d) => { q(d, '[data-dialog="yes"]').click(); await settle(80); };
const NOT = (b) => [200, { ok: true, result: b.op === 'validateConfig' ? { ok: false, errors: [{ message: 'gh is not logged in' }] } : { tasks: [] } }];

test('F-G-G3-01: with a ticket source the tabs take their own row above its note, never laid over it', async () => {
  const { d } = await open({ call: NOT });
  await gh(d);
  const seg = q(d, '[data-c-src="plugin:0"]').closest('.seg'), n = q(d, '.choice-note');
  assert.ok(!seg.parentElement.matches('.cc-lbl'), 'not the label row\'s absolutely placed tabs: there is no label row to sit beside');
  assert.ok(seg.compareDocumentPosition(n) & 4, 'the tabs come first, the note under them');
  assert.match(readFileSync(new URL('../ui/public/stillhet/css/rail.css', import.meta.url), 'utf8'), /\.cc-src > \.seg\{[^}]*justify-self:end/, 'the tabs keep their place at the end of their own row');
});

test('F-cov23-04: an unconnected source says so in classic\'s words, with Open the Marketplace page and Test connection; nothing is listed', async () => {
  const { d, calls } = await open({ call: NOT });
  await gh(d);
  assert.equal(ops(calls, 'validateConfig').length, 1);
  const n = q(d, '.choice-note');
  assert.match(n.textContent, /GitHub Issues is not connected: gh is not logged in/);
  assert.deepEqual([...n.querySelectorAll('button')].map((b) => b.textContent), ['Open the Marketplace page', 'Test connection']);
  assert.equal(ops(calls, 'listTasks').length, 0);
  assert.doesNotMatch(q(d, '.dlg').textContent, /No tasks matched|Type to search/);
  assert.equal(q(d, '#cc-search'), null, 'no search for a source that cannot answer');
});

test('F-cov23-04: Test connection checks again; once connected, the note goes and the list comes', async () => {
  let up = false;
  const { d, calls } = await open({ call: (b) => (up ? connected(b) : NOT(b)) });
  await gh(d);
  up = true;
  q(d, '[data-c-srctest]').click(); await settle(80);
  assert.equal(ops(calls, 'validateConfig').length, 2);
  assert.equal(q(d, '.choice-note'), null);
  assert.ok(ops(calls, 'listTasks').length >= 1);
});

test('F-cov23-04: Open the Marketplace page closes the form and opens Marketplace', async () => {
  const { w, d } = await open({ call: NOT });
  await gh(d);
  q(d, '[data-c-market]').click(); await settle(60);
  assert.equal(w.location.hash, '#marketplace');
  assert.equal(d.querySelector('#center-dlg .dlg'), null);
});

test('F-cov23-04: a pending sign-in shows the connector\'s message, never the not-connected note', async () => {
  const { d } = await open({ call: (b) => [200, { ok: true, result: b.op === 'validateConfig' ? { ok: false, pending: true, message: 'Finish signing in to GitHub in your browser…' } : {} }] });
  await gh(d);
  assert.match(q(d, '.dlg').textContent, /Finish signing in to GitHub in your browser…/);
  assert.equal(q(d, '.choice-note'), null);
});

test('F-cov23-04: the Repository picker lists listProjects; a pick filters the list and goes with Start', async () => {
  const { d, calls } = await open();
  await gh(d);
  assert.equal(ops(calls, 'listProjects').length, 1);
  assert.equal(q(d, '#cc-in-filter').value, 'assignee:@me state:open');
  q(d, '[data-menu="si-repo"]').click(); await settle(10);
  assert.deepEqual([...d.querySelectorAll('#center-dlg [data-menu-pick^="si-repo|"]')].map((x) => x.textContent.trim()), ['acme/web', 'acme/api']);
  q(d, '[data-menu-pick="si-repo|acme/api"]').click(); await settle(400);
  assert.equal(q(d, '[data-menu="si-repo"]').textContent.trim(), 'acme/api');
  assert.deepEqual(ops(calls, 'listTasks').at(-1).args.inputs, { repo: 'acme/api', filter: 'assignee:@me state:open' });
  q(d, 'button[data-c-ticket="12"]').click(); await settle(60);
  await start(d);
  const [b] = posts(calls).filter(([, u]) => u === '/api/run').map(([, , x]) => x);
  assert.deepEqual(b.source, { type: 'plugin', plugin: 'github-source', sourceId: 'issues', taskId: '12', inputs: { repo: 'acme/api', filter: 'assignee:@me state:open' } });
});
