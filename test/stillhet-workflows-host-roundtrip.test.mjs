// test/stillhet-workflows-host-roundtrip.test.mjs — Stillhet's Workflows export then import against a real server (slice 7):
// the live module (workflow-live.mjs) on dev's routes, a temp HOME and WORCA_HOME (test/helpers/stillhet-server.mjs). A
// child process server, because the round trip must cross dev's real import and export cores; the jsdom page that calls
// the same module is covered by stillhet-workflows-host-actions.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/stillhet-server.mjs';
import { startWorkflowLive } from '../ui/public/stillhet/live/workflow-live.mjs';
import { wfTemplate } from './helpers/stillhet-workflows-host.mjs';

let srv, live, calls = [], downloads = [];
const ids = async () => (await (await fetch(`${srv.base}/api/workflows`)).json()).workflows.map((w) => w.id).sort();
const shape = (t) => ({ nodes: t.nodes.map((n) => [n.kind, n.key ?? null]).sort((a, b) => `${a}`.localeCompare(`${b}`)),
  wires: t.wires.map((w) => { const k = (id) => t.nodes.find((n) => n.id === id); return [k(w.from.node).kind, k(w.from.node).key ?? '', w.from.port, k(w.to.node).kind, k(w.to.node).key ?? '', w.to.port, w.config?.maxCycles ?? null]; }).sort((a, b) => `${a}`.localeCompare(`${b}`)) });
const file = (name, text) => ({ name, text: async () => text });

before(async () => {
  srv = await startServer({ flags: 'rail' });
  const { id, origin, createdAt, updatedAt, archivedAt, ...body } = wfTemplate('wf_mine');
  const r = await fetch(`${srv.base}/api/workflows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, id: 'wf_mine' }) });
  assert.equal(r.status, 201, await r.text());
  live = startWorkflowLive({ fetch: (u, o = {}) => { calls.push([o.method || 'GET', u]); return fetch(srv.base + u, o); }, download: (u, n) => downloads.push([u, n]) });
  await live.load();
});
after(async () => { await srv?.stop(); });

test('export wf_mine, import the file: a new id with equal node kinds, keys and wires', async () => {
  const before0 = await ids();
  const out = await live.exportAs('wf_mine', 'a JSON file');
  assert.equal(out.ok, true);
  const [[url, name]] = downloads;
  assert.equal(url, '/api/workflows/wf_mine/json'); assert.equal(name, 'mine.json');
  const text = await (await fetch(srv.base + url)).text();
  const a = await live.importFile(file(name, text));
  assert.equal(a.ok, true, a.text);
  assert.match(a.text, /^Imported as Mine \(2\)$/);
  const after0 = await ids();
  assert.deepEqual(after0.filter((x) => !before0.includes(x)), [a.id]);
  const orig = await (await fetch(`${srv.base}/api/workflows/wf_mine`)).json(), copy = await (await fetch(`${srv.base}/api/workflows/${a.id}`)).json();
  assert.deepEqual(shape(copy), shape(orig));
});

test('a non-JSON file is refused with zero requests and the id list unchanged', async () => {
  const was = await ids(), n = calls.length;
  const a = await live.importFile(file('notes.txt', 'not json'));
  assert.equal(a.ok, false); assert.match(a.text, /^Could not import notes\.txt: /);
  assert.equal(calls.length, n);
  assert.deepEqual(await ids(), was);
});

test('a JSON file with an invalid graph: 422, Could not import, the id list unchanged', async () => {
  const was = await ids();
  const bad = { version: 2, name: 'Broken', domain: 'coding', nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_x', kind: 'agent', key: 'planner', x: 1, y: 1, config: {} }], wires: [] };
  const n = calls.length;
  const a = await live.importFile(file('broken.json', JSON.stringify(bad)));
  assert.equal(a.ok, false); assert.match(a.text, /^Could not import broken\.json: /);
  assert.ok(calls.slice(n).every(([m, u]) => m === 'GET' || u === '/api/workflows/import-json'));
  assert.deepEqual(await ids(), was);
});

test('a file with a script node asks first; No sends no real import', async () => {
  const exported = await (await fetch(`${srv.base}/api/workflows/wf_default/json`)).json();
  const withShell = { ...exported, name: 'With shell', nodes: [...exported.nodes, { id: 'n_sh', kind: 'script', key: 'shell', x: 900, y: 300, config: { params: { command: 'npm run lint' },
    ports: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] } } }],
  wires: [...exported.wires, { id: 'w_sh', from: { node: 'n_task', port: 'task' }, to: { node: 'n_sh', port: 'in' } }] };
  const was = await ids(), n = calls.length;
  let asked = 0;
  const a = await live.importFile(file('with-shell.json', JSON.stringify(withShell)), { confirm: async (k) => { asked = k; return false; } });
  assert.equal(asked, 1); assert.equal(a.ok, false);
  assert.deepEqual(calls.slice(n).filter(([m]) => m !== 'GET'), [['POST', '/api/workflows/import-json']], 'the dry run only');
  assert.deepEqual(await ids(), was);
});
