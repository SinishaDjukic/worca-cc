// Stillhet slice 9 round trip: the live app host whose Projects and Workspaces reads and writes go to a real server in a
// child process (temp HOME and WORCA_HOME), with two real git folders. Make a workspace by hand, add both, Save: dev's
// GET /api/workspaces lists it with both members, and after the server's own workspaces-changed frame (taken from a real
// WebSocket on that server and forwarded unmodified) the bar's tree shows its row with both projects under it.
// A real server is needed: the point is that the page's request is the one dev's route accepts.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { WebSocket } from 'ws';
import { startServer } from './helpers/stillhet-server.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { liveHost, LISTS, SOURCES, settle, go, clone, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

let srv, sock;
const frames = [];
const real = (u) => u.startsWith('/api/projects') || u.startsWith('/api/sync/projects') || u.startsWith('/api/workspaces');
const call = async (method, u, body) => { const r = await fetch(`${srv.base}${u}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return [r.status, await r.json().catch(() => ({}))]; };
let A, B;

before(async () => {
  srv = await startServer();
  A = realpathSync(gitDir('seed-pair-a')); B = realpathSync(gitDir('seed-pair-b'));
  for (const [name, path] of [['seed-pair-a', A], ['seed-pair-b', B]]) { const [s, b] = await call('POST', '/api/projects', { name, path }); assert.equal(s, 200, JSON.stringify(b)); }
  sock = new WebSocket(`${srv.base.replace('http', 'ws')}/ws`, { headers: { origin: srv.base } });
  sock.on('message', (m) => frames.push(String(m)));
  await new Promise((r, j) => { sock.once('open', r); sock.once('error', j); });
});
after(async () => { sock?.close(); await srv?.stop(); });
afterEach(closeHosts);

test('Make a workspace by hand over two git projects: Save is POST /api/workspaces; dev lists it; its frame draws the bar row with 2 children', async () => {
  const sources = clone(SOURCES); delete sources.projects; delete sources.sync; delete sources.workspaces;
  const h = await liveHost({ hash: '#chat', sources, lists: LISTS, read: (u) => (real(u) ? call('GET', u) : null), write: (u, b, m) => (real(u) ? call(m, u, b) : [200, {}]) });
  h.w.structuredClone ||= structuredClone;   // jsdom's window has none; a browser's has
  for (let i = 0; i < 100 && !h.sockets.length; i++) await settle(30);   // the socket opens after the first read, slower than the host's own hello
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: [] }) });
  await go(h.w, '#projects', 300);
  const keys = h.w.RailProjects.list().map((p) => p.id);
  assert.equal(keys.length, 2, 'the two real projects');
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  const page = h.d.getElementById('route-place');
  page.querySelector('#pj-hand-v').value = 'Seed pair'; page.querySelector('[data-confirm="yes"]').click(); await settle(150);
  for (const k of keys) { page.querySelector('[data-menu="ws-add"]').click(); page.querySelector(`[data-menu-pick="ws-add|${k}"]`).click(); await settle(60); }
  const seen = frames.length;
  page.querySelector('[data-draft-save]').click();
  for (let i = 0; i < 100 && !h.calls.some((c) => c.method === 'POST' && c.url === '/api/workspaces'); i++) await settle(30);
  assert.deepEqual(h.calls.filter((c) => c.method === 'POST' && c.url === '/api/workspaces').map((c) => c.body), [{ name: 'Seed pair', projectPaths: [A, B] }]);
  let list;
  for (let i = 0; i < 200 && !(list = (await call('GET', '/api/workspaces'))[1]).workspaces?.length; i++) await settle(50);   // dev answers once the workspace is made
  assert.equal(list.workspaces.length, 1);
  assert.equal(list.workspaces[0].name, 'Seed pair');
  assert.equal(list.workspaces[0].projectKeys.length, 2);
  let raw;
  for (let i = 0; i < 100 && !(raw = frames.slice(seen).find((f) => JSON.parse(f).type === 'workspaces-changed')); i++) await settle(30);
  assert.ok(raw, 'the server sent workspaces-changed');
  h.sockets.at(-1).onmessage({ data: raw });   // the server's own frame, unmodified
  await settle(500);
  const id = list.workspaces[0].id;
  assert.equal(h.w.location.hash, `#projects/ws:${id}`);
  const row = h.d.querySelector(`#bar-place [data-row="ws:${id}"]`);
  assert.ok(row, 'its row is in the bar');
  assert.equal(row.querySelector('.lr-t').textContent, 'Seed pair');
  row.querySelector(`[data-fold-tree="ws:${id}"]`).click(); await settle(60);   // a healthy workspace starts folded (list.bar-model)
  const kids = [...h.d.querySelectorAll('#bar-place [data-row^="proj:"]')].filter((r) => r.dataset.row.endsWith(`:${id}`));
  assert.deepEqual(kids.map((r) => r.querySelector('.lr-t').textContent).sort(), ['seed-pair-a', 'seed-pair-b'], 'both projects hang under it');
});
