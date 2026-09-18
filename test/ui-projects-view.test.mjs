// test/ui-projects-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

class WSStub {
  constructor() { WSStub.last = this; this.readyState = 0; this._listeners = {}; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { this.readyState = 1; (this._listeners.open || []).forEach((fn) => fn({})); }
}

const PROJECTS = [
  { name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: 'alpha-00000001' },
  { name: 'beta', path: '/Users/me/dev/beta', exists: false, key: 'beta-00000002' },
];
// Two finished alpha runs and one beta run: the Overview's RUNS / LAST RUN cards read these.
const HISTORY = [
  { id: 'p-old', projectKey: 'alpha-00000001', projectName: 'alpha', title: 'Old run', status: 'done', startedAt: '2026-09-01T10:00:00.000Z' },
  { id: 'p-new', projectKey: 'alpha-00000001', projectName: 'alpha', title: 'Newest run', status: 'stopped', startedAt: '2026-09-10T09:30:00.000Z' },
  { id: 'p-b', projectKey: 'beta-00000002', projectName: 'beta', title: 'Beta run', status: 'done', startedAt: '2026-09-05T08:00:00.000Z' },
];

const nowIso = new Date().toISOString();
const TM_SCOPES = {
  projects: [
    { key: 'alpha-00000001', name: 'alpha', slug: 'me/alpha', hasOrigin: true, enabled: false },
    { key: 'beta-00000002', name: 'beta', slug: 'me/beta', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: nowIso, record: true, runs: 3, pending: 0 },
  ],
  workspaces: [],
  scopes: { projects: [], workspaces: [] },
  anyEnabled: true,
};

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: HISTORY, ghAvailable: false }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

async function goProjects(window) {
  window.location.hash = 'projects';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

// Set the hash and let jsdom deliver the hashchange (it does — never dispatch it by hand here).
async function goHash(window, hash) {
  window.location.hash = hash;
  await tick(); await tick(); await tick();
}

test('projects view un-hides and renders one row per project', async () => {
  const { window } = await boot();
  await goProjects(window);
  const doc = window.document;
  assert.equal(doc.querySelector('.view[data-view="projects"]').classList.contains('hidden'), false);
  const rows = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.pl-name').textContent.trim().startsWith('alpha'), true);
  assert.equal(rows[0].querySelector('.proj-path').textContent, '/Users/me/dev/alpha');
  // missing flag for non-existent folder
  assert.ok(rows[1].querySelector('.proj-missing'), 'beta should show a missing marker');
});

test('the list row has no trash button and no Memory expander any more', async () => {
  const { window } = await boot();
  await goProjects(window);
  const doc = window.document;
  assert.equal(doc.querySelector('#projects-list .proj-del'), null);
  assert.equal(doc.querySelector('#projects-list .proj-mem-head'), null);
  assert.equal(doc.querySelector('#projects-list .proj-mem-detail'), null);
  const row = doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"] .pl-row');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.tabIndex, 0);
  assert.ok(row.querySelector('.proj-open'), 'the chevron');
});

test('Remove from the detail header: confirm → DELETE → back on the list without the row', async () => {
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/projects') && opts.method === 'DELETE') {
        calls.push(u);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [PROJECTS[1]] }) });
      }
      return null;
    },
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'confirm modal should open');
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /name=alpha/);
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
  assert.equal([...doc.querySelectorAll('#projects-list .pl-item')].length, 1);
});

test('cancelling the Remove confirm issues no DELETE and keeps the detail open', async () => {
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) }); }
      return null;
    },
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  click(window, doc.querySelector('#confirm-cancel'));
  await tick();
  assert.equal(calls.length, 0, 'no DELETE on cancel');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true);
  assert.equal(doc.querySelector('#proj-detail .pd-remove').disabled, false, 're-enabled after cancel');
});

test('add: + picks a folder, prefills the basename, and POSTs the project', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/fs/pick-folder')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'picked', path: '/Users/me/dev/cool-app' }) });
      if (u.includes('/api/projects') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        const next = [...PROJECTS, { name: 'cool-app', path: '/Users/me/dev/cool-app', exists: true }];
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: next }) });
      }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  click(window, doc.querySelector('#project-add-btn'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#project-add-modal').classList.contains('hidden'), false, 'add modal should open');
  assert.equal(doc.querySelector('#proj-add-name').value, 'cool-app', 'name prefilled from basename');
  assert.equal(doc.querySelector('#proj-add-path').value, '/Users/me/dev/cool-app');
  click(window, doc.querySelector('#proj-add-save'));
  await tick(); await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { name: 'cool-app', path: '/Users/me/dev/cool-app' });
  const items = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(items.length, 3);
  // A row with no store key has no project page: no role, no chevron.
  assert.equal(items[2].dataset.key, undefined);
  assert.equal(items[2].querySelector('.pl-row').getAttribute('role'), null, 'a keyless row is not a control');
  assert.equal(items[2].querySelector('.proj-open'), null, 'a keyless row has no chevron');
});

// ---- Agent memory fixtures (the project page's Memory tab reads these) ----

const MEM = {
  scope: 'projects/alpha-00000001',
  project: { key: 'alpha-00000001', name: 'alpha', path: '/Users/me/dev/alpha' },
  files: [{ name: 'conv', description: 'Naming', paths: [], source: 'user', updated: '', bytes: 10, hasFrontmatter: true }],
  state: {}, health: { level: 'ok', reasons: [], files: 1, bytes: 10, writesSinceDefrag: 0 }, defragRunId: null,
};
const memJson = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const memFetch = (u, o = {}) => {
  const method = (o.method || 'GET').toUpperCase();
  if (u.includes('/api/memory/projects/alpha-00000001/files/')) {
    if (method !== 'GET') return memJson({ ok: true });
    return memJson({ name: 'conv', text: '---\nname: conv\n---\nkebab.\n', meta: {}, body: 'kebab.\n' });
  }
  if (u.includes('/api/memory/projects/alpha-00000001/history')) return memJson({ snapshots: [] });
  if (u.includes('/api/memory/projects/alpha-00000001')) return memJson(MEM);
  return null;
};
test('a row click opens the project page: slide, header, focus on Back, hash #projects/<key>', async () => {
  const { window } = await boot();
  await goProjects(window);
  const doc = window.document;
  const row = doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"] .pl-row');
  click(window, row);
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001');
  const shell = doc.getElementById('proj-shell');
  assert.equal(shell.classList.contains('detail-open'), true);
  const d = doc.getElementById('proj-detail');
  assert.equal(d.getAttribute('aria-hidden'), 'false');
  assert.equal(d.querySelector('.pd-title').textContent.trim(), 'alpha');
  assert.equal(d.querySelector('.pd-path').textContent, '/Users/me/dev/alpha');
  assert.equal(doc.activeElement, d.querySelector('.pd-back'), 'focus lands on Back');
  assert.equal(shell.querySelector('.proj-screen-list').hasAttribute('inert'), true, 'the list is inert behind the detail');
  // The Overview pill is lit and its section built.
  assert.equal(d.querySelector('.pd-tab.active').dataset.sec, 'overview');
  assert.ok(d.querySelector('.pd-sec[data-sec="overview"] .pd-ov-card-path'), 'PATH card');
});

test('Enter on a focused row and the chevron button both open the page; a keyless row is inert', async () => {
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/projects')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [...PROJECTS, { name: 'stray', path: '/x/stray', exists: true }] }) })
      : null),
  });
  await goProjects(window);
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#projects-list .pl-row')];
  assert.equal(rows[2].getAttribute('role'), null, 'a keyless project has no page');
  assert.equal(rows[2].querySelector('.proj-open'), null);
  rows[1].focus();
  rows[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/beta-00000002');
  assert.ok(doc.querySelector('#proj-detail .pd-title .proj-missing'), 'a missing folder is badged in the title');
  assert.equal(doc.querySelector('#proj-detail .pd-new').disabled, true, 'New pipeline is off for a missing folder');
  // Back, then the chevron of the other row.
  click(window, doc.querySelector('#proj-detail .pd-back'));
  await tick(); await tick();
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
  assert.equal(doc.activeElement, doc.querySelector('#projects-list .pl-item[data-key="beta-00000002"] .pl-row'), 'focus comes home to the row');
  click(window, doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"] .proj-open'));
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001');
});

test('#projects/<key> on boot: Overview reads the History dataset (RUNS, LAST RUN, KEY) and the History button is live', async () => {
  const { window } = await boot();
  await goHash(window, 'projects/alpha-00000001');
  await tick(); await tick();
  const doc = window.document;
  const ov = doc.querySelector('#proj-detail .pd-sec[data-sec="overview"]');
  assert.equal(ov.querySelector('.pd-ov-card-runs .pd-ov-value').textContent, '2');
  assert.match(ov.querySelector('.pd-ov-card-runs .pd-ov-sub').textContent, /1 done · 0 paused · 1 stopped · 0 error/);
  const last = ov.querySelector('button.pd-ov-card-last');
  assert.ok(last, 'LAST RUN is a button');
  assert.equal(last.querySelector('.pd-ov-sub').textContent, 'Newest run');
  assert.equal(ov.querySelector('.pd-ov-card-key .pd-ov-value').textContent, 'alpha-00000001');
  assert.equal(ov.querySelector('.pd-ov-card-key .pd-ov-sub').textContent, 'memory scope projects/alpha-00000001');
  assert.equal(doc.querySelector('#proj-detail .pd-history').disabled, false);
  click(window, last);
  assert.equal(window.location.hash, '#history/alpha-00000001/p-new');
});

test('a project with no runs: LAST RUN is a dash and Open in History is disabled', async () => {
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/history') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [], ghAvailable: false }) }) : null),
  });
  await goHash(window, 'projects/alpha-00000001');
  await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#proj-detail .pd-ov-card-last .pd-ov-value').textContent, '—');
  assert.equal(doc.querySelector('#proj-detail .pd-ov-card-last .pd-ov-sub').textContent, 'No runs yet');
  const btn = doc.querySelector('#proj-detail .pd-history');
  assert.equal(btn.disabled, true);
  assert.equal(btn.title, 'No runs yet');
});

test('Open in History pre-sets the project filter; New pipeline selects the project and lands on #new', async () => {
  const { window } = await boot();
  await goHash(window, 'projects/alpha-00000001');
  await tick(); await tick();
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-history'));
  assert.equal(window.location.hash, '#history');
  assert.equal(window.localStorage.getItem('worca-cc.history.project'), 'alpha-00000001');
  await goHash(window, 'projects/alpha-00000001');
  click(window, doc.querySelector('#proj-detail .pd-new'));
  assert.equal(window.location.hash, '#new');
  const sel = doc.getElementById('projectSelect');
  assert.equal(sel.options[sel.selectedIndex].dataset.name, 'alpha');
  assert.equal(window.localStorage.getItem('worca-cc.lastProject'), 'alpha');
});

test('Escape on the project page goes back to the list; not while the confirm modal is up', async () => {
  const { window } = await boot();
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001', 'the modal owns Escape');
  await tick();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(window.location.hash, '#projects');
});

test('an unknown key shows the list with the not-registered message; the message clears on the next #projects entry', async () => {
  const { window } = await boot();
  await goHash(window, 'projects/ghost-00000009');
  const doc = window.document;
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
  assert.match(doc.getElementById('projects-msg').textContent, /project "ghost-00000009" is not registered here/);
  await goHash(window, 'workspaces');
  await goHash(window, 'projects');
  assert.equal(doc.getElementById('projects-msg').textContent, '');
});

test('projects-changed while a page is open: the list rebuilds and the page stays; a payload that dropped the project closes it', async () => {
  let projects = PROJECTS;
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects }) }) : null),
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  const frame = () => WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'projects-changed' }) }));
  projects = [{ ...PROJECTS[0], exists: false }, PROJECTS[1]];
  frame();
  await tick(); await tick(); await tick();
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true, 'still open');
  assert.ok(doc.querySelector('#proj-detail .pd-title .proj-missing'), 'the header repainted from the new row');
  projects = [PROJECTS[1]];
  frame();
  await tick(); await tick(); await tick();
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false, 'closed');
  assert.equal(window.location.hash, '#projects');
  assert.match(doc.getElementById('projects-msg').textContent, /project "alpha" was removed/);
});

test('#projects/<key>/memory/<name> lands on the Memory tab with the file open; the Overview pill routes back', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory/conv');
  const doc = window.document;
  const d = doc.getElementById('proj-detail');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true);
  assert.equal(d.querySelector('.pd-tab.active').dataset.sec, 'memory');
  const sec = d.querySelector('.pd-sec[data-sec="memory"]');
  assert.equal(sec.hidden, false);
  assert.deepEqual([...sec.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['conv']);
  const ed = sec.querySelector('.mem-editor');
  assert.ok(ed, 'the file is open');
  assert.equal(ed.querySelector('.mem-name').value, 'conv');
  assert.equal(sec.querySelector('.mem-defrag').disabled, false, 'a project defragment never needs a host');
  assert.equal(sec.querySelector('.mem-host-hint'), null, 'and never names one');
  click(window, doc.getElementById('pd-tab-overview'));
  assert.equal(d.querySelector('.pd-tab.active').dataset.sec, 'overview', 'the engine switched at once');
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001');
  assert.equal(sec.hidden, true);
  assert.ok(sec.querySelector('.mem-editor'), 'the section is hidden, not torn down');
});

test('the Memory pill is hash-first: click → #projects/<key>/memory, one scope load, controller mounted once', async () => {
  const gets = [];
  const { window } = await boot({
    fetchHandler: (u, o = {}) => { if (u.endsWith('/api/memory/projects/alpha-00000001') && (o.method || 'GET') === 'GET') gets.push(u); return memFetch(u, o); },
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.getElementById('pd-tab-memory'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory');
  assert.equal(gets.length, 1, 'exactly one GET of the scope for the pill click (jsdom delivers the one hashchange)');
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  assert.deepEqual([...sec.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['conv']);
  // A file row routes to the file (navigate is ON here, unlike the old expander).
  click(window, sec.querySelector('.mem-row'));
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory/conv');
  await tick(); await tick(); await tick();
  assert.equal(sec.querySelector('.mem-name').value, 'conv');
});

test('a NEW file saved on the page routes to it and shows up as a saved row', async () => {
  const puts = [];
  let saved = false;
  const { window } = await boot({
    fetchHandler: (u, o = {}) => {
      const method = (o.method || 'GET').toUpperCase();
      if (u.includes('/api/memory/projects/alpha-00000001/files/conv2') && method === 'PUT') {
        puts.push(JSON.parse(o.body)); saved = true;
        return memJson({ ok: true, name: 'conv2', created: true, bytes: 2 });
      }
      if (u.includes('/api/memory/projects/alpha-00000001/files/conv2')) return memJson({ name: 'conv2', text: 'x\n', meta: {}, body: 'x\n' });
      if (u.endsWith('/api/memory/projects/alpha-00000001')) {
        return memJson(saved
          ? { ...MEM, files: [...MEM.files, { name: 'conv2', description: '', paths: [], source: 'user', updated: '', bytes: 2, hasFrontmatter: false }] }
          : MEM);
      }
      return memFetch(u, o);
    },
  });
  await goHash(window, 'projects/alpha-00000001/memory');
  const doc = window.document;
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  click(window, sec.querySelector('.mem-new'));
  await tick();
  const ed = sec.querySelector('.mem-editor');
  ed.querySelector('.mem-name').value = 'conv2';
  ed.querySelector('.mem-text').value = 'x\n';
  click(window, ed.querySelector('.mem-save'));
  await tick(); await tick(); await tick();
  assert.deepEqual(puts, [{ text: 'x\n' }]);
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory/conv2', 'Save routes to the file');
  await tick(); await tick(); await tick();
  assert.deepEqual([...sec.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['conv', 'conv2']);
  assert.equal(sec.querySelector('.mem-name').readOnly, true, 'the editor left "new" mode');
});

test('a memory-changed frame for the open scope refetches; other scopes and a closed page do not', async () => {
  const gets = [];
  const { window } = await boot({
    fetchHandler: (u, o = {}) => { if (u.endsWith('/api/memory/projects/alpha-00000001') && (o.method || 'GET') === 'GET') gets.push(u); return memFetch(u, o); },
  });
  await goHash(window, 'projects/alpha-00000001/memory');
  const before = gets.length;
  const frame = (scope) => WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'memory-changed', scope }) }));
  frame('projects/beta-00000002');
  frame('global');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gets.length, before, 'other scopes never refetch this page');
  frame('projects/alpha-00000001');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gets.length, before + 1, 'the open scope refetches once (coalesced)');
  await goHash(window, 'workspaces');
  frame('projects/alpha-00000001');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gets.length, before + 1, 'a torn-down page paints nothing');
  assert.equal(window.document.getElementById('proj-detail').innerHTML, '');
});

test('a malformed escape in a memory deep link is not decoded and does not throw', async () => {
  // memFetch answers ANY /files/<name> GET with conv's body; a 404 for everything but conv is
  // what lets the "not found" line prove the raw (undecoded) name was asked for.
  const { window } = await boot({
    fetchHandler: (u, o = {}) => (u.includes('/api/memory/projects/alpha-00000001/files/') && !u.endsWith('/files/conv')
      ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'memory file not found' }) })
      : memFetch(u, o)),
  });
  await goHash(window, 'projects/alpha-00000001/memory/%E0%A4%A');
  const sec = window.document.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  assert.ok(sec, 'the page opened');
  assert.match(sec.querySelector('.form-msg').textContent, /not found/);
  assert.equal(sec.querySelector('.mem-editor'), null, 'no editor for a file that is not there');
});

test('leaving the view tears the page down instantly', async () => {
  const { window } = await boot();
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  await goHash(window, 'workspaces');
  assert.equal(doc.getElementById('proj-detail').innerHTML, '');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
  assert.equal(doc.body.classList.contains('view-projects'), false);
});

// ---- Review majors (2026-09-14-project-detail-review-majors.md) ----

const WORKFLOWS = [
  { id: 'wf_alpha', name: 'Alpha flow', version: 2, nodes: [], wires: [] },
  { id: 'wf_beta', name: 'Beta flow', version: 2, nodes: [], wires: [] },
];
// /api/config keyed by the project in the query: beta's reply is SLOW, alpha's immediate.
const cfgReply = (wf, delay) => new Promise((r) => setTimeout(() => r({
  ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [], activeWorkflowId: wf }, models: [], efforts: [] }),
}), delay));

test('two /api/config loads in flight: the LAST project picked wins, whatever order the replies land', async () => {
  const { window } = await boot({
    fetchHandler: (u) => {
      if (u.startsWith('/api/config')) return cfgReply(u.includes('beta') ? 'wf_beta' : 'wf_alpha', u.includes('beta') ? 40 : 0);
      if (u.endsWith('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: WORKFLOWS }) });
      return null;
    },
  });
  await tick();
  const doc = window.document;
  const sel = doc.getElementById('projectSelect');
  const pick = (path) => { sel.value = path; sel.dispatchEvent(new window.Event('change', { bubbles: true })); };
  pick('/Users/me/dev/beta');    // slow reply
  pick('/Users/me/dev/alpha');   // fast reply — the project the user ends on
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sel.options[sel.selectedIndex].dataset.name, 'alpha');
  assert.equal(doc.getElementById('workflowSelect').value, 'wf_alpha', 'the earlier, slower reply never painted over the later pick');
});

test('New pipeline from a project page issues ONE config load, for the page project', async () => {
  const cfgDirs = [];
  const { window } = await boot({
    fetchHandler: (u) => { if (u.startsWith('/api/config')) cfgDirs.push(decodeURIComponent(u.split('projectDir=')[1] || '')); return null; },
  });
  await goHash(window, 'projects/alpha-00000001');
  cfgDirs.length = 0;
  click(window, window.document.querySelector('#proj-detail .pd-new'));
  await tick(); await tick();
  assert.deepEqual(cfgDirs, ['/Users/me/dev/alpha']);
});

test('a Memory draft survives Overview → Memory: the pill returns to the open file and the hop keeps the unsaved text', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory/conv');
  const doc = window.document;
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  sec.querySelector('.mem-text').value = 'unsaved edit\n';
  click(window, doc.getElementById('pd-tab-overview'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001');
  click(window, doc.getElementById('pd-tab-memory'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory/conv', 'the pill returns to the open file');
  assert.equal(sec.querySelector('.mem-text').value, 'unsaved edit\n', 'the draft survived the hop');
});

test('a NEW, unsaved memory file survives the same hop', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory');
  const doc = window.document;
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  click(window, sec.querySelector('.mem-new'));
  await tick();
  sec.querySelector('.mem-name').value = 'draft';
  sec.querySelector('.mem-text').value = 'x\n';
  click(window, doc.getElementById('pd-tab-overview'));
  await tick(); await tick(); await tick();
  click(window, doc.getElementById('pd-tab-memory'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory');
  const ed = sec.querySelector('.mem-editor');
  assert.ok(ed, 'the editor is still up');
  assert.equal(ed.querySelector('.mem-name').value, 'draft');
  assert.equal(ed.querySelector('.mem-text').value, 'x\n');
  assert.equal(ed.querySelector('.mem-name').readOnly, false, 'still a NEW file');
});

test('Back with an unsaved memory draft asks first: Cancel stays, Discard leaves', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory/conv');
  const doc = window.document;
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="memory"]');
  sec.querySelector('.mem-text').value = 'unsaved\n';
  click(window, doc.querySelector('#proj-detail .pd-back'));
  await tick();
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), false, 'asks first');
  click(window, doc.getElementById('confirm-cancel'));
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory/conv', 'Cancel stays');
  assert.equal(sec.querySelector('.mem-text').value, 'unsaved\n');
  // Escape goes through the same guard.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), false, 'Escape asks too');
  click(window, doc.getElementById('confirm-ok'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
});

test('the page keeps its Memory grid while it slides out; it is emptied after the slide', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-back'));
  await tick(); await tick();
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false, 'the slide started');
  assert.ok(doc.querySelector('#proj-detail .mem-host .mem-row'), 'the grid is still painted during the slide');
  await new Promise((r) => setTimeout(r, 700));   // jsdom has no transitionend: the 600 ms fallback clears
  assert.equal(doc.getElementById('proj-detail').innerHTML, '', 'emptied after the slide');
});

test('a row opened while the #projects fetch is in flight stays open: the late reply never routes the stale param', async () => {
  let holdNext = false; let release; const gate = new Promise((r) => { release = r; });
  const { window } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/projects') && holdNext) { holdNext = false; return gate.then(() => ({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) })); }
      return null;
    },
  });
  await goProjects(window);                       // first entry paints the list
  await goHash(window, 'new');
  holdNext = true;
  await goHash(window, 'projects');               // second entry: its /api/projects is held
  const doc = window.document;
  click(window, doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"] .pl-row'));   // an in-view hop
  await tick(); await tick();
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true);
  release();
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true, 'the late reply did not close the page');
});

test('leaving Projects while its fetch is in flight mounts nothing in the hidden view', async () => {
  let holdNext = false; let release; const gate = new Promise((r) => { release = r; });
  const { window } = await boot({
    fetchHandler: (u, o = {}) => {
      if (u.includes('/api/projects') && holdNext) { holdNext = false; return gate.then(() => ({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) })); }
      return memFetch(u, o);
    },
  });
  holdNext = true;
  await goHash(window, 'projects/alpha-00000001/memory/conv');   // held
  await goHash(window, 'workspaces');                            // leave before the reply
  release();
  await tick(); await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.getElementById('proj-detail').innerHTML, '', 'nothing mounted behind the Workspaces view');
  assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), false);
});

// ---- Project detail page (2026-09-13-project-detail-design.md) ----

const cssText = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const htmlText = readFileSync(htmlPath, 'utf8');
// Same helper test/ui-running-routing.test.mjs uses: the body of the FIRST rule whose selector
// list contains `selector` (a `,`-separated list counts).
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cssText.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('index.html: the Projects view is a two-screen shell with a detail template, and no new routed view', () => {
  assert.match(htmlText, /<div class="proj-shell" id="proj-shell">\s*<div class="proj-screen proj-screen-list">/);
  assert.match(htmlText, /<div class="proj-screen proj-screen-detail" id="proj-detail" aria-hidden="true"><\/div>/);
  assert.ok(htmlText.includes('<template id="proj-detail-tpl">'), 'the detail template');
  for (const cls of ['pd-back', 'pd-title', 'pd-path', 'pd-new', 'pd-history', 'pd-remove', 'pd-error', 'pd-tabs', 'pd-sections']) {
    assert.ok(htmlText.includes(`class="${cls}`) || htmlText.includes(` ${cls} `) || htmlText.includes(` ${cls}"`), `template carries .${cls}`);
  }
  // The list still lives at the same ids (the controller and every older test read them).
  assert.match(htmlText, /<p id="projects-msg" class="form-msg" aria-live="polite"><\/p>\s*<div class="run-list" id="projects-list"><\/div>/);
  assert.equal((htmlText.match(/data-view/g) || []).length, 14, 'a screen inside the projects view, not a view (Team metrics, Team policy and Getting started are their own views)');
});

test('style.css: the projects shell is a twin of the History track', () => {
  assert.match(ruleBody('.view[data-view="projects"]') || '', /position:relative/);
  assert.match(ruleBody('.view[data-view="projects"]') || '', /padding:0/);
  assert.match(ruleBody('.proj-screen') || '', /transition:transform/);
  assert.match(ruleBody('.proj-shell.detail-open .proj-screen-detail') || '', /translateX\(0\)/);
  assert.match(ruleBody('body.view-projects .main') || '', /padding:0/);
  // pd- twins ride the hd- rules (spec D13): the pd- selector is appended to the hd- selector
  // list and that one rule carries the signature declaration.
  const shared = {
    '.hd-header,.pd-header{': /border-radius:var\(--r-card\)/,
    '.hd-tabs,.pd-tabs{': /position:sticky/,
    '.hd-tab,.pd-tab{': /border-radius:999px/,
    '.hd-sec[hidden],.pd-sec[hidden]{': /display:none/,
    '.hd-ov-grid,.pd-ov-grid{': /grid-template-columns/,
    '.hd-ov-card,.pd-ov-card{': /padding:20px/,
  };
  for (const [head, re] of Object.entries(shared)) {
    const i = cssText.indexOf(head);
    assert.ok(i >= 0, `${head} — the pd- selector rides the hd- rule`);
    assert.match(cssText.slice(i, cssText.indexOf('}', i)), re);
  }
});

test('rows show a .tm-cell; .tm-enable opens the enable dialog; toggling .tm-record PATCHes', async () => {
  const patches = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/team-metrics/scopes')) return Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES });
      if (/\/api\/projects\/beta-00000002\/team-metrics$/.test(u) && opts.method === 'PATCH') {
        patches.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  await goProjects(window);
  await tick(); await tick();
  const doc = window.document;
  const cells = [...doc.querySelectorAll('#projects-list .tm-cell')];
  assert.equal(cells.length, 2);
  const offCell = cells.find((c) => c.dataset.key === 'alpha-00000001');
  const onCell = cells.find((c) => c.dataset.key === 'beta-00000002');
  assert.ok(offCell, 'off project has a .tm-cell');
  assert.ok(onCell, 'on project has a .tm-cell');

  click(window, offCell.querySelector('.tm-enable'));
  await tick(); await tick();
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), false, 'enable dialog opened');
  assert.ok(doc.querySelector('input[name="tm-where"]'), 'dialog has the "where to record" radios');

  const cb = onCell.querySelector('input.tm-record');
  cb.checked = false;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], { record: false });
});
