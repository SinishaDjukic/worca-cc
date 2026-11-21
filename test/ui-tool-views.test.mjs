// test/ui-tool-views.test.mjs — the Files and Changes tools (issue 1064): what they fetch for a scope, what they draw,
// and how they keep their place; a gone scope closes the tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFilesKind, fmtSize } from '../ui/public/tool-files.mjs';
import { createChangesKind } from '../ui/public/tool-changes.mjs';

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
/** The file view paints after mount returns (the shared viewer loads on its own): wait until it left "Loading…". */
async function settle(host) {
  for (let i = 0; i < 400; i++) {
    const s = host.querySelector('.tool-file-stage');
    if (s && s.textContent !== 'Loading…') return;
    await tick(1);
  }
  throw new Error('the file view never left Loading…');
}
function harness(routes) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  const doc = dom.window.document;
  const calls = [];
  const fetch = async (u) => {
    calls.push(u);
    const [path, q] = u.split('?');
    const h = routes[path];
    const v = typeof h === 'function' ? h(new URLSearchParams(q)) : h;
    const status = v?.__status || (v === undefined ? 404 : 200);
    return { ok: status < 400, status, json: async () => v ?? {} };
  };
  const tabs = new Map();
  const closed = [];
  const api = {
    tab: (id) => tabs.get(id), isMounted: (id) => tabs.has(id), scopeFor: (t) => t.scope,
    setTabState: (id, p) => { const t = tabs.get(id); for (const [k, v] of Object.entries(p)) { if (v === undefined) delete t.state[k]; else t.state[k] = v; } },
    openTab: () => null, close: (id) => { closed.push(id); tabs.delete(id); }, view: () => ({}),
  };
  return { doc, host: doc.getElementById('host'), fetch, calls, tabs, api, closed };
}
const P = { type: 'project', id: 'app-0000aaaa' };

test('Files: lists the folder, opens a sub folder and a file, and goes back through the crumbs', async () => {
  const h = harness({
    '/api/tools/files': (q) => (q.get('path') === 'src'
      ? { root: { scope: 'project', label: 'app' }, path: 'src', entries: [{ name: 'a.js', type: 'file', size: 2048 }], truncated: false }
      : { root: { scope: 'project', label: 'app' }, path: '', entries: [{ name: 'src', type: 'dir' }, { name: 'out', type: 'link', target: null }], truncated: false }),
    '/api/tools/file': { root: { scope: 'project', label: 'app' }, path: 'src/a.js', size: 20, shown: 20, truncated: false, binary: false, text: 'const a = 1;' },
  });
  const kind = createFilesKind({ doc: h.doc, fetch: h.fetch });
  const tab = { id: 'tab_f', kind: 'files', scope: P, state: {} };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await tick();
  assert.equal(h.calls[0], '/api/tools/files?scope=project&projectKey=app-0000aaaa');
  const rows = [...h.host.querySelectorAll('.tool-files-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.tool-files-name').textContent), ['src', 'out']);
  assert.equal(rows[1].disabled, true, 'a link out of the folder cannot be opened');
  rows[0].click();
  await tick();
  assert.equal(tab.state.path, 'src');
  assert.equal(kind.title(tab), 'src');
  assert.equal(h.host.querySelector('.tool-files-size').textContent, '2.0 KB');
  h.host.querySelector('.tool-files-row.is-file').click();   // the first row in a sub folder is Up one folder
  await tick();
  assert.equal(tab.state.file, 'src/a.js');
  await settle(h.host);
  assert.equal(h.host.querySelector('.tool-file-stage pre').textContent, 'const a = 1;');
  assert.equal(kind.title(tab), 'a.js');
  h.host.querySelector('.tool-file-back').click();
  await tick();
  assert.equal(tab.state.file, undefined);
  h.host.querySelector('.tool-crumb').click();                  // the root crumb
  await tick();
  assert.equal(tab.state.path, undefined);
});

test('Files: binary and cut files say so; errors show; SCOPE_GONE closes the tab', async () => {
  const h = harness({
    '/api/tools/file': { root: { scope: 'project', label: 'app' }, path: 'b.bin', size: 900000, shown: 524288, truncated: true, binary: true, text: '' },
    '/api/tools/files': { __status: 404, error: 'gone', code: 'SCOPE_GONE' },
  });
  const kind = createFilesKind({ doc: h.doc, fetch: h.fetch });
  const tab = { id: 'tab_b', kind: 'files', scope: P, state: { file: 'b.bin' } };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await tick();
  await settle(h.host);
  assert.match(h.host.textContent, /No preview for this file type/);
  assert.match(h.host.textContent, /Showing the first 512 KB of 879 KB/);
  const t2 = { id: 'tab_g', kind: 'files', scope: P, state: {} };
  h.tabs.set(t2.id, t2);
  await kind.mount(t2, h.host, h.api);
  await tick();
  assert.deepEqual(h.closed, ['tab_g']);
  assert.equal(fmtSize(5), '5 B');
});

test('Files: a workspace run shows its members; a pick reloads that member\'s folder', async () => {
  const h = harness({ '/api/tools/files': (q) => ({ root: { scope: 'run', label: 'run · app', members: [{ projectKey: 'a', projectName: 'app' }, { projectKey: 'b', projectName: 'web' }], member: q.get('member') || 'a' },
    path: '', entries: [], truncated: false }) });
  const kind = createFilesKind({ doc: h.doc, fetch: h.fetch });
  const tab = { id: 'tab_w', kind: 'files', scope: { type: 'run', id: 'r1', workspaceId: 'w' }, state: {} };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await tick();
  const sel = h.host.querySelector('select.tool-member');
  sel.value = 'b';
  sel.dispatchEvent(new h.doc.defaultView.Event('change'));
  await tick();
  assert.equal(tab.state.member, 'b');
  assert.match(h.calls.at(-1), /member=b/);
});

test('Changes: the source note, the lent renderer with the picked file, Refresh, and the empty states', async () => {
  let body = { source: 'working-tree', results: { summary: { filesNew: 1, filesChanged: 0 } }, patch: 'diff --git a/x b/x\n', untrackedCapped: true };
  const h = harness({ '/api/tools/changes': () => body });
  const drawn = [];
  const kind = createChangesKind({ doc: h.doc, fetch: h.fetch, renderDiff: (host, out, opts) => { drawn.push({ out, picked: opts.picked }); opts.onPick('k1'); } });
  const tab = { id: 'tab_c', kind: 'changes', scope: P, state: { picked: 'k0' } };
  h.tabs.set(tab.id, tab);
  await kind.mount(tab, h.host, h.api);
  await tick();
  assert.equal(h.calls[0], '/api/tools/changes?scope=project&projectKey=app-0000aaaa');
  assert.match(h.host.querySelector('.tool-changes-note').textContent, /Uncommitted changes .* Some new files are not listed\./);
  assert.equal(drawn[0].picked, 'k0');
  assert.equal(tab.state.picked, 'k1');
  body = { source: 'run-live', results: { summary: {} }, patch: '' };
  h.host.querySelector('.tool-changes-refresh').click();
  await tick();
  assert.match(h.host.textContent, /No changes yet\./);
  assert.equal(drawn.length, 1);
});

test('the keyboard keeps its place: each Files step and Changes Refresh leave the focus in the tool, never on <body>', async () => {
  const h = harness({
    '/api/tools/files': (q) => ({ root: { scope: 'project', label: 'app' }, path: q.get('path') || '',
      entries: q.get('path') ? [{ name: 'a.js', type: 'file', size: 1 }] : [{ name: 'src', type: 'dir' }], truncated: false }),
    '/api/tools/file': { root: { scope: 'project', label: 'app' }, path: 'src/a.js', size: 1, shown: 1, truncated: false, binary: false, text: 'x' },
    '/api/tools/changes': { source: 'working-tree', results: { summary: {} }, patch: '' },
  });
  const inHost = () => h.host.contains(h.doc.activeElement) && h.doc.activeElement !== h.doc.body;
  const files = createFilesKind({ doc: h.doc, fetch: h.fetch });
  const tab = { id: 'tab_k', kind: 'files', scope: P, state: {} };
  h.tabs.set(tab.id, tab);
  await files.mount(tab, h.host, h.api);
  await tick();
  h.host.querySelector('.tool-files-row.is-dir').focus();
  h.host.querySelector('.tool-files-row.is-dir').click();
  assert.ok(inHost(), 'while the folder loads');
  await tick();
  assert.ok(inHost(), 'after opening a folder');
  assert.equal(h.doc.activeElement.textContent, 'Up one folder');
  h.host.querySelector('.tool-files-row.is-file').click();
  await tick();
  assert.ok(inHost(), 'after opening a file');
  h.host.querySelector('.tool-file-back').click();
  await tick();
  assert.ok(inHost(), 'after Back');
  h.host.querySelector('.tool-crumb:not([aria-current])').click();
  await tick();
  assert.ok(inHost(), 'after a crumb');
  const changes = createChangesKind({ doc: h.doc, fetch: h.fetch, renderDiff: () => {} });
  const ct = { id: 'tab_kc', kind: 'changes', scope: P, state: {} };
  h.tabs.set(ct.id, ct);
  await changes.mount(ct, h.host, h.api);
  await tick();
  h.host.querySelector('.tool-changes-refresh').focus();
  h.host.querySelector('.tool-changes-refresh').click();
  await tick();
  assert.equal(h.doc.activeElement, h.host.querySelector('.tool-changes-refresh'), 'Refresh keeps the focus');
});
