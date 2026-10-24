// test/ui-projects-view.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, toastTitles, cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, dragOut, pressEscape, discardPrompt, discardChanges } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

async function boot({ fetchHandler, storage = {} } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
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
  // Seeded BEFORE app.js loads: the Runs list reads its folded groups at module load.
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
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

test('cancelling the Remove confirm issues no DELETE and keeps the page; the modal owns Escape, and Escape without it goes back to the list', async () => {
  // One boot: the page stays open after the cancelled confirm, so the Escape row starts there.
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) }); }
      return null;
    },
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  await checkRows([
    { name: 'cancelling the Remove confirm issues no DELETE and keeps the detail open', run: async () => {
      click(window, doc.querySelector('#proj-detail .pd-remove'));
      await tick();
      click(window, doc.querySelector('#confirm-cancel'));
      await tick();
      assert.equal(calls.length, 0, 'no DELETE on cancel');
      assert.equal(doc.getElementById('proj-shell').classList.contains('detail-open'), true);
      assert.equal(doc.querySelector('#proj-detail .pd-remove').disabled, false, 're-enabled after cancel');
    } },
    { name: 'Escape on the project page goes back to the list; not while the confirm modal is up', run: async () => {
      click(window, doc.querySelector('#proj-detail .pd-remove'));
      await tick();
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await tick();
      assert.equal(window.location.hash, '#projects/alpha-00000001', 'the modal owns Escape');
      await tick();
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(window.location.hash, '#projects');
    } },
  ]);
});

test('the shared confirm: press + release on the overlay is the safe No; a prompt never closes on the backdrop, and Escape on typed text asks first', async () => {
  const { window } = await boot();
  await goProjects(window);
  const doc = window.document;
  const modal = doc.getElementById('confirm-modal');
  await checkRows([
    { name: 'confirm: a selection dragged out of the card does not answer; a backdrop click answers No', run: async () => {
      const p = window.__projects.confirmModal({ title: 'Remove it?', message: 'Gone for good.' });
      dragOut(window, doc.getElementById('confirm-message'), modal);
      assert.equal(modal.classList.contains('hidden'), false);
      backdropClick(window, modal);
      assert.equal(await p, false);
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'prompt: no backdrop close; Escape on typed text asks; an Enter meant for the question does not submit; Discard answers null', run: async () => {
      const p = window.__projects.promptModal({ title: 'Name it', fields: [{ id: 'name', label: 'Name' }] });
      const input = doc.getElementById('confirm-f-name');
      input.value = 'draft';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      backdropClick(window, modal);
      assert.equal(modal.classList.contains('hidden'), false);
      pressEscape(window);
      const q = discardPrompt(doc);
      assert.ok(q, 'asks first');
      q.querySelector('.discard-keep').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      assert.equal(modal.classList.contains('hidden'), false, 'that Enter belonged to the question');
      doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      assert.equal(modal.classList.contains('hidden'), false, 'and so does one with the focus on the page, while the question is up');
      discardChanges(doc);
      assert.equal(await p, null);
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'prompt: an untouched one (prefilled by the caller) closes on Escape with no question', run: async () => {
      const p = window.__projects.promptModal({ title: 'Name it', fields: [{ id: 'name', label: 'Name', value: 'prefilled' }] });
      pressEscape(window);
      assert.equal(discardPrompt(doc), null);
      assert.equal(await p, null);
    } },
    { name: 'two calls stacked on the one shell (a double-click): the newer settles the older as No, so Escape leaves none live and a later OK answers only its own', run: async () => {
      const answers = [];
      const ask = (id) => { void window.__projects.confirmModal({ title: `${id}?` }).then((v) => answers.push([id, v])); };
      ask('A');
      ask('B');
      pressEscape(window);
      await tick();
      assert.deepEqual(answers, [['A', false], ['B', false]], 'Escape answers both No');
      ask('C');
      click(window, doc.getElementById('confirm-ok'));
      await tick();
      assert.deepEqual(answers, [['A', false], ['B', false], ['C', true]], 'the OK answers C alone');
    } },
    { name: 'a new call takes the shell while a prompt\'s "Discard changes?" is open: Discard then settles nothing more, and the new call stays up', run: async () => {
      const answers = [];
      void window.__projects.promptModal({ title: 'Name it', fields: [{ id: 'name', label: 'Name' }] }).then((v) => answers.push(['P', v]));
      const input = doc.getElementById('confirm-f-name');
      input.value = 'draft';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'asks first');
      void window.__projects.confirmModal({ title: 'C?' }).then((v) => answers.push(['C', v]));
      discardChanges(doc);
      await tick();
      assert.equal(modal.classList.contains('hidden'), false, 'the new call is still on screen');
      click(window, doc.getElementById('confirm-ok'));
      await tick();
      assert.deepEqual(answers, [['P', null], ['C', true]]);
    } },
  ]);
});

test('add: Add project opens the dialog, Choose folder… picks a folder, prefills the basename, and POSTs the project', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/fs/pick-folder') && (opts.method || 'GET') === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true }) });
      if (u.includes('/api/fs/pick-folder')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'picked', path: '/Users/me/dev/cool-app' }) });
      if (u.endsWith('/api/projects') && opts.method === 'POST') {
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
  assert.equal(doc.querySelector('#proj-add-tab-new').getAttribute('aria-selected'), 'true', 'the dialog opens on New');
  click(window, doc.querySelector('#proj-add-tab-folder'));
  assert.equal(doc.querySelector('#proj-add-path').value, '', 'no folder until one is chosen');
  click(window, doc.querySelector('#proj-add-browse'));
  await tick(); await tick();
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
test('a row opens the project page by click, Enter or chevron (hash, header, focus on Back, list inert); a keyless row is inert; Back returns focus to the row', async () => {
  // One boot; the list carries a keyless third project for the second row.
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/projects')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [...PROJECTS, { name: 'stray', path: '/x/stray', exists: true }] }) })
      : null),
  });
  await goProjects(window);
  const doc = window.document;
  await checkRows([
    { name: 'a row click opens the project page: slide, header, focus on Back, hash #projects/<key>', run: async () => {
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
      // The path lives in the header only (with a copy button); the Overview opens on BRANCH instead.
      assert.ok(d.querySelector('.pd-meta .pd-path-copy'), 'the header path has a copy button');
      assert.equal(d.querySelector('.pd-sec[data-sec="overview"] .pd-ov-card-path'), null, 'no PATH card repeating the header');
      assert.ok(d.querySelector('.pd-sec[data-sec="overview"] .pd-ov-card-branch'), 'BRANCH card');
      // Tile labels are sentence case; only the Key tile's value is mono (an id).
      const labels = [...d.querySelectorAll('.pd-sec[data-sec="overview"] .pd-ov-label')].map((l) => l.textContent);
      assert.deepEqual(labels.slice(0, 2), ['Branch', 'Runs']);
      assert.deepEqual(labels.filter((l) => /^[A-Z ]{3,}$/.test(l)), [], 'no capitals-only label');
      assert.deepEqual([...d.querySelectorAll('.pd-ov-value.mono')], [d.querySelector('.pd-ov-card-key .pd-ov-value')]);
      assert.equal(d.querySelector('.pd-ov-card-last').tagName, 'BUTTON', 'Last run still opens the run');
    } },
    { name: 'Enter on a focused row and the chevron button both open the page; a keyless row is inert', run: async () => {
      await goProjects(window);                   // back on the list: the first row left alpha's page open
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
    } },
  ]);
});

test('Show in Runs unfolds the project group; New pipeline selects the project, lands on #new and issues ONE config load for it', async () => {
  // One boot walks Show in Runs, then New pipeline; each step's state is recorded as it
  // happens, and the rows read the records.
  const cfgDirs = [];
  const { window } = await boot({
    storage: { 'worca-cc.runs.collapsed': JSON.stringify(['project:alpha-00000001']) },   // Group by Project sections fold by project:KEY
    fetchHandler: (u) => { if (u.startsWith('/api/config')) cfgDirs.push(decodeURIComponent(u.split('projectDir=')[1] || '')); return null; },
  });
  await goHash(window, 'projects/alpha-00000001');
  await tick(); await tick();
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-history'));
  const afterHistory = { hash: window.location.hash, collapsed: JSON.parse(window.localStorage.getItem('worca-cc.runs.collapsed')) };
  await goHash(window, 'projects/alpha-00000001');
  cfgDirs.length = 0;
  click(window, doc.querySelector('#proj-detail .pd-new'));
  const sel = doc.getElementById('projectSelect');
  const afterNew = { hash: window.location.hash, name: sel.options[sel.selectedIndex].dataset.name,
    lastProject: window.localStorage.getItem('worca-cc.lastProject') };
  await tick(); await tick();
  await checkRows([
    { name: 'Show in Runs unfolds the project group on the Runs list; New pipeline selects the project and lands on #new', run: () => {
      assert.equal(afterHistory.hash, '#runs');
      assert.deepEqual(afterHistory.collapsed, [],
        'the project group is unfolded (the folded key is gone)');
      assert.equal(afterNew.hash, '#new');
      assert.equal(afterNew.name, 'alpha');
      assert.equal(afterNew.lastProject, 'alpha');
    } },
    { name: 'New pipeline from a project page issues ONE config load, for the page project', run: () => {
      assert.deepEqual(cfgDirs, ['/Users/me/dev/alpha']);
    } },
  ]);
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
  assert.match(lastToast(doc).title, /project "alpha" was removed/);
});

test('memory deep link opens the file on the Memory tab; the Memory pill is hash-first with one scope load; the Overview pill hides (not tears down) the section', async () => {
  // Each row boots: after the deep link the pill returns to the open file and the controller is already mounted.
  await checkRows([
    { name: '#projects/<key>/memory/<name> lands on the Memory tab with the file open; the Overview pill routes back', run: async () => {
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
    } },
    { name: 'the Memory pill is hash-first: click → #projects/<key>/memory, one scope load, controller mounted once', run: async () => {
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
    } },
  ]);
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

test('rows carry compact team chips (status only, no controls); the project page\'s Team tab has the full block: .tm-enable opens the enable dialog, toggling .tm-record PATCHes', async () => {
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
  // The row: one .pl-team column with a metrics chip and a policy chip, expert-level, no buttons.
  const rows = [...doc.querySelectorAll('#projects-list .pl-item')];
  const alphaTeam = rows[0].querySelector('.pl-team');
  const betaTeam = rows[1].querySelector('.pl-team');
  assert.equal(alphaTeam.dataset.minLevel, 'expert');
  assert.equal(alphaTeam.querySelector('.pl-tm').textContent, 'Metrics off');
  assert.equal(alphaTeam.querySelector('.pl-tm').dataset.kind, 'off');
  assert.equal(betaTeam.querySelector('.pl-tm').textContent, 'Metrics on · 3 runs');
  assert.ok(betaTeam.querySelector('.pl-tm .tm-dot.green'));
  assert.equal(doc.querySelector('#projects-list .tm-cell'), null, 'no cell on the list any more');
  assert.equal(doc.querySelector('#projects-list .pl-item button:not(.proj-open)'), null, 'the chevron is the only button on a row');
  // The page: Overview carries a TEAM METRICS card that opens the Team tab; the tab carries the block.
  click(window, rows[0].querySelector('.pl-row'));
  await tick(); await tick(); await tick();
  const ov = doc.querySelector('#proj-detail .pd-sec[data-sec="overview"]');
  const card = ov.querySelector('button.pd-ov-card-metrics');
  assert.equal(card.dataset.minLevel, 'expert');
  assert.equal(card.querySelector('.pd-ov-value').textContent, 'Off');
  assert.equal(card.querySelector('.pd-ov-sub').textContent, 'runs stay on this machine');
  click(window, card);
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/team');
  assert.ok(doc.querySelector('#proj-detail .pd-tab[data-sec="team"]').classList.contains('active'));
  const offCell = doc.querySelector('#proj-detail .pd-team-metrics .tm-cell');
  assert.equal(offCell.dataset.key, 'alpha-00000001');
  assert.equal(offCell.querySelector('.tm-label'), null, 'the panel head names the feature; the block has no title of its own');
  click(window, offCell.querySelector('.tm-enable'));
  await tick(); await tick();
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), false, 'enable dialog opened');
  assert.ok(doc.querySelector('input[name="tm-where"]'), 'dialog has the "where to record" radios');
  // The switch on beta's page.
  window.location.hash = 'projects/beta-00000002/team';
  await tick(); await tick(); await tick(); await tick();
  const onCell = doc.querySelector('#proj-detail .pd-team-metrics .tm-cell');
  assert.equal(onCell.dataset.key, 'beta-00000002');
  const cb = onCell.querySelector('input.tm-record');
  cb.checked = false;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0], { record: false });
});

test('zero projects: one empty card says so; its Add project opens the dialog', async () => {
  const { window } = await boot({ fetchHandler: (u, o) => (u.endsWith('/api/projects') && (o.method || 'GET') === 'GET'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) }) : null) });
  await goProjects(window);
  const doc = window.document;
  assert.equal(doc.querySelector('#projects-list .proj-zero-txt').textContent, 'No projects yet');
  assert.equal(doc.querySelector('#projects-list .proj-zero-add').textContent, 'Add project');
  click(window, doc.querySelector('#projects-list .proj-zero-add')); await tick(); await tick();
  assert.equal(doc.querySelector('#project-add-modal').classList.contains('hidden'), false);
});
test('the project page names its kind: Folder (no BRANCH card) or Git', async () => {
  const projects = [{ ...PROJECTS[0], vcs: 'git' }, { name: 'notes', path: '/Users/me/notes', exists: true, key: 'notes-00000003', vcs: 'none' }];
  const { window } = await boot({ fetchHandler: (u, o) => (u.includes('/api/projects') && (o.method || 'GET') === 'GET'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects }) }) : null) });
  await goHash(window, 'projects/notes-00000003');
  const doc = window.document;
  assert.equal(doc.querySelector('#proj-detail .pd-kind .kind-chip').textContent, 'Folder');
  assert.equal(doc.querySelector('#proj-detail .pd-title').textContent.trim(), 'notes', 'the title stays the name');
  assert.equal(doc.querySelector('#proj-detail .pd-ov-card-branch'), null);
  await goHash(window, 'projects/alpha-00000001');
  assert.equal(doc.querySelector('#proj-detail .pd-kind .kind-chip').textContent, 'Git');
  assert.ok(doc.querySelector('#proj-detail .pd-ov-card-branch'));
});

test('Set up team metrics: while the enable POST is out, Escape and the header Close do nothing; a failure lands in the dialog that stayed open', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/team-metrics/scopes')) return Promise.resolve({ ok: true, status: 200, json: async () => TM_SCOPES });
      if (/\/team-metrics\/enable$/.test(u) && opts.method === 'POST') return gate;
      return null;
    },
  });
  await goHash(window, 'projects/alpha-00000001/team');
  await tick(); await tick();
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-team-metrics .tm-enable'));
  await tick(); await tick();
  const modal = doc.getElementById('plugin-modal');
  click(window, modal.querySelector('.tm-enable-submit'));
  await tick();
  pressEscape(window);
  click(window, doc.getElementById('plugin-modal-close'));
  assert.equal(modal.classList.contains('hidden'), false, 'no way out while the request is out');
  release({ ok: false, status: 500, json: async () => ({ error: 'push rejected' }) });
  await tick(); await tick();
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(modal.querySelector('.tm-enable-err').textContent, 'push rejected');
  pressEscape(window);
  assert.equal(modal.classList.contains('hidden'), true, 'once it answered, Escape closes it');
});

// A Folder project in worca's projects folder: GET /api/projects marks it ownedFolder (ui/server.mjs projectsForApi).
const OWNED = [{ ...PROJECTS[0], path: '/Users/me/.worca-cc/projects/alpha', displayPath: '~/.worca-cc/projects/alpha', vcs: 'none', ownedFolder: true }, PROJECTS[1]];
const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Remove of worca\'s own Folder project: a danger confirm naming the folder, then DELETE with deleteFolder=1', async () => {
  const calls = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return reply(200, { projects: [PROJECTS[1]], folder: { path: OWNED[0].path, deleted: true } }); }
    if (u.includes('/api/projects')) return reply(200, { projects: OWNED });
    return null;
  } });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false);
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.ok(msg.includes('~/.worca-cc/projects/alpha'), msg);
  assert.match(msg, /every file in it will be deleted permanently/);
  assert.match(msg, /This cannot be undone/);
  assert.match(msg, /Run history stays/);
  assert.doesNotMatch(msg, /left untouched/);
  assert.equal(doc.querySelector('#confirm-message strong').textContent, '~/.worca-cc/projects/alpha', 'the folder stands out');
  assert.ok(doc.querySelector('#confirm-ok').classList.contains('danger'), 'destructive styling');
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\?name=alpha&deleteFolder=1$/);
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects');
});

test('Remove of any other project keeps today\'s confirm and sends no deleteFolder', async () => {
  const calls = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return reply(200, { projects: [PROJECTS[1]] }); }
    return null;
  } });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  assert.match(doc.querySelector('#confirm-message').textContent, /The folder on disk and its run history are left untouched\./);
  assert.equal(doc.querySelector('#confirm-ok').classList.contains('danger'), false);
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /deleteFolder/);
});

test('Remove of a converted project (vcs git, ownedFolder false): the plain confirm, and no deleteFolder', async () => {
  const CONVERTED = [{ ...OWNED[0], vcs: 'git', workMode: 'git', ownedFolder: false }, PROJECTS[1]];
  const calls = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return reply(200, { projects: [PROJECTS[1]] }); }
    if (u.includes('/api/projects')) return reply(200, { projects: CONVERTED });
    return null;
  } });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  assert.equal(doc.querySelector('#proj-detail .pd-kind .kind-chip').textContent, 'Git');
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#confirm-title').textContent, 'Remove project');
  const msg = doc.querySelector('#confirm-message').textContent;
  assert.match(msg, /The folder on disk and its run history are left untouched\./);
  assert.doesNotMatch(msg, /deleted permanently/);
  assert.equal(doc.querySelector('#confirm-ok').classList.contains('danger'), false);
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\?name=alpha$/, 'no deleteFolder');
});

test('a 409 DELETE_FOLDER_REQUIRED (an older list) asks again naming the folder; a folder that could not be deleted is reported', async () => {
  const calls = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.includes('/api/projects') && opts.method === 'DELETE') {
      calls.push(u);
      return /deleteFolder=1/.test(u)
        ? reply(200, { projects: [PROJECTS[1]], folder: { path: '/Users/me/dev/alpha', deleted: false, error: 'EBUSY' },
          warning: 'Removed "alpha", but its folder could not be deleted (EBUSY). What is left of it is still at ~/dev/alpha.' })
        : reply(409, { error: 'Removing "alpha" also deletes its folder ~/dev/alpha and every file in it.', code: 'DELETE_FOLDER_REQUIRED', displayPath: '~/dev/alpha' });
    }
    return null;
  } });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  click(window, doc.querySelector('#proj-detail .pd-remove'));
  await tick();
  assert.match(doc.querySelector('#confirm-message').textContent, /left untouched/, 'the list said nothing about the folder');
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick(); await tick();
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'asked again');
  assert.equal(doc.querySelector('#confirm-message strong').textContent, '~/dev/alpha');
  assert.ok(doc.querySelector('#confirm-ok').classList.contains('danger'));
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick(); await tick();
  assert.deepEqual(calls.map((u) => /deleteFolder=1/.test(u)), [false, true]);
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects');
  const t = lastToast(doc);
  assert.ok(t && `${t.title} ${t.detail}`.includes('could not be deleted (EBUSY)'), JSON.stringify(t));
});
test('#693: a worca-made nested repository shows a "Nested repo" badge with the fix, on the list and the page', async () => {
  const hint = '/Users/me/dev/mono/svc has its own git repository inside your repository at /Users/me/dev/mono. An older Worca created it.';
  const projects = [PROJECTS[0], { name: 'svc', path: '/Users/me/dev/mono/svc', exists: true, key: 'svc-00000003', nestedRepo: { repoRoot: '/Users/me/dev/mono', hint } }];
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects }) }) : null),
  });
  await goProjects(window);
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(rows[0].querySelector('.proj-nested'), null);
  const badge = rows[1].querySelector('.proj-nested');
  assert.equal(badge.textContent, 'Nested repo');
  assert.equal(badge.title, hint);
  await goHash(window, 'projects/svc-00000003');
  assert.ok(doc.querySelector('#proj-detail .pd-title .proj-nested'));
  const line = doc.querySelector('#proj-detail .pd-nested-hint');
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, hint);
  await goHash(window, 'projects/alpha-00000001');
  assert.equal(doc.querySelector('#proj-detail .pd-nested-hint').hidden, true);
});

// ---- Memory › Team (team memory 1b) ----
const TEAM_ST = (over = {}) => ({
  projectKey: 'alpha-00000001', enabled: true, branch: 'worca-memory', caps: { localMaxFiles: 50, teamMaxFiles: 50 },
  remote: { exists: true, headSha: 'abcdef1234', fetchedAt: '2026-10-17T10:00:00.000Z', lastSyncAt: null, lastError: null, lastErrorCode: null, lastErrorAt: null, hint: null, lastFetchError: null },
  counts: { local: 1 }, notes: [{ name: 'conv', state: 'local', local: true, team: false, mounted: false, updated: null, author: null, shadows: false }],
  seed: { offer: 'pending', last: null }, ...over,
});
const PREVIEW = { projectKey: 'alpha-00000001', fetchedAt: '2026-10-17T10:00:00.000Z', fetchError: null, branchExists: true, offer: 'pending',
  notes: [{ name: 'conv', state: 'local', hash: 'c'.repeat(40), description: 'Naming', blocked: null, team: null }] };

test('Memory › Team: the deep link opens the Team view; switching on PATCHes memory.team and raises the offer; Share sends only the picked note', async () => {
  const calls = [];
  let status = TEAM_ST({ enabled: false, counts: {}, notes: [], remote: null });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    if (u.includes('/api/memory/team/') || u.endsWith('/settings')) calls.push({ u, method, body: o.body ? JSON.parse(o.body) : null });
    if (u.endsWith('/api/projects/alpha-00000001/settings') && method === 'PATCH') { status = TEAM_ST(); return memJson({ own: { 'memory.team': true }, effective: {}, layers: {}, roles: [] }); }
    if (u.endsWith('/api/memory/team/alpha-00000001/seed') && method === 'GET') return memJson(PREVIEW);
    if (u.endsWith('/api/memory/team/alpha-00000001/seed') && method === 'POST') {
      status = TEAM_ST({ counts: { shared: 1 }, notes: [{ ...TEAM_ST().notes[0], state: 'shared', team: true }], seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 's', shared: 1, tookTeam: 0, held: 0 } } });
      return memJson({ ok: true, snapshotId: 's', shared: ['conv'], blocked: [], tookTeam: [], held: [], flush: { ok: true, pushed: 1 }, status });
    }
    if (u.endsWith('/api/memory/team/alpha-00000001')) return memJson(status);
    return memFetch(u, o);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  assert.deepEqual([sec.querySelector('.mem-host').hidden, sec.querySelector('.mem-team-host').hidden], [true, false]);
  assert.equal(sec.querySelector('.mem-view.on').dataset.view, 'team');
  const sw = sec.querySelector('.mem-team-switch');
  assert.equal(sw.checked, false);
  sw.checked = true;
  sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { 'memory.team': true });
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the first switch-on raises the offer');
  const pick = modal.querySelector('.mem-seed-check[data-name="conv"]');
  assert.equal(pick.checked, false, 'nothing is ticked');
  pick.click();   // HTMLElement.click(): jsdom toggles a checkbox only for a MouseEvent click, then fires change
  const submit = modal.querySelector('.mem-seed-submit');
  assert.equal(submit.textContent, 'Share 1 note');
  click(window, submit);
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(calls.find((c) => c.method === 'POST' && c.u.endsWith('/seed')).body, { decisions: [{ name: 'conv', action: 'share', hash: 'c'.repeat(40), teamHash: null }] });
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(sec.querySelector('.mem-team-row[data-name="conv"] .badge').textContent, 'Shared');
  assert.ok(sec.querySelector('.mem-team-undo'));
  click(window, sec.querySelector('.mem-view[data-view="notes"]'));
  await tick(); await tick();
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory');
});

test('Memory › Team: a memory-team-changed frame for the open project refetches the status; another project\'s does not', async () => {
  const gets = [];
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    if (u.endsWith('/api/memory/team/alpha-00000001')) { gets.push(u); return memJson(TEAM_ST()); }
    return memFetch(u, o);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const n = gets.length;
  assert.ok(n >= 1);
  const frame = (projectKey) => WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'memory-team-changed', projectKey, action: 'flushed' }) }));
  frame('beta-00000002');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(gets.length, n);
  frame('alpha-00000001');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(gets.length, n + 1);
});

test('Memory › Team: Compare sends the reviewed hashes and opens again on STALE; Take team is not offered for a team version over the cap, Keep mine not for a blocked version, neither for a note recorded blocked; a Keep mine the remote refused says it is blocked', async () => {
  const posts = [];
  let previews = 0;
  let reply = { ok: false, status: 409, body: { error: 'Some notes changed since you reviewed them — review them again.', code: 'STALE', names: ['build'] } };
  const team = (name, over = {}) => ({ name, hash: 'd'.repeat(40), text: `---\nname: ${name}\n---\nTheirs.\n`, author: 'Ana', updated: null, bytes: 40, same: false, tooBig: false, ...over });
  const NOTES = {
    build: { name: 'build', state: 'held', hash: 'b'.repeat(40), description: 'Build', blocked: null, text: '---\nname: build\n---\nMine.\n', team: team('build') },
    lint: { name: 'lint', state: 'local', hash: 'e'.repeat(40), description: 'Lint', blocked: { reason: 'line 4: an email address', findings: [] }, text: 'x\n', team: team('lint', { tooBig: true }) },
    oncall: { name: 'oncall', state: 'blocked', hash: 'a'.repeat(40), description: 'Paging', blocked: { reason: 'the remote refused it', findings: [] }, text: 'z\n', team: team('oncall') },
    docs: { name: 'docs', state: 'held', hash: 'f'.repeat(40), description: 'Docs', blocked: null, text: '---\nname: docs\n---\nMine.\n', team: team('docs') },
  };
  const row = (name, state) => ({ name, state, local: true, team: true, mounted: false, updated: null, author: 'Ana', shadows: state === 'local' });
  const status = TEAM_ST({ counts: { held: 3, local: 1 }, notes: [row('build', 'held'), row('lint', 'local'), row('oncall', 'held'), row('docs', 'held')], seed: { offer: 'done', last: null } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    const m = u.match(/\/api\/memory\/team\/alpha-00000001\/seed\?name=(\w+)$/);
    if (m) { previews++; return memJson({ ...PREVIEW, notes: [NOTES[m[1]]] }); }
    if (u.endsWith('/api/memory/team/alpha-00000001/resolve') && method === 'POST') {
      posts.push(JSON.parse(o.body));
      return Promise.resolve({ ok: reply.ok, status: reply.status, json: async () => reply.body });
    }
    if (u.endsWith('/api/memory/team/alpha-00000001')) return memJson(status);
    return memFetch(u, o);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const modal = doc.getElementById('plugin-modal');
  const compare = async (name) => { click(window, sec.querySelector(`.mem-team-compare[data-name="${name}"]`)); for (let i = 0; i < 5; i++) await tick(); };
  const offered = () => [!!modal.querySelector('.mem-cmp-take'), !!modal.querySelector('.mem-cmp-keep')];
  await compare('build');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.ok(modal.querySelector('.mem-cmp-mine .mem-cmp-diff'), 'side by side, the differing line marked');
  assert.deepEqual(offered(), [true, true]);
  click(window, modal.querySelector('.mem-cmp-keep'));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(posts, [{ name: 'build', action: 'share', hash: 'b'.repeat(40), teamHash: 'd'.repeat(40) }]);
  assert.deepEqual([previews, modal.classList.contains('hidden'), offered()], [2, false, [true, true]], 'STALE: Compare opens again on a fresh preview');
  reply = { ok: false, status: 502, body: { error: 'Could not reach the team branch to check it before sharing (fatal: unable to access) — try again.', code: 'FETCH_FAILED' } };
  click(window, modal.querySelector('.mem-cmp-keep'));
  for (let i = 0; i < 10; i++) await tick();
  const foot = doc.getElementById('plugin-modal-actions').parentElement;
  assert.deepEqual(cardAlertOf(foot), { title: 'Not changed', detail: reply.body.error }, 'keep mine that cannot fetch first says why — in the pinned foot');
  assert.equal(foot.querySelector('.card-alert').nextElementSibling.id, 'plugin-modal-actions', 'above the actions');
  assert.deepEqual([previews, modal.classList.contains('hidden')], [2, false], 'the dialog stays open: try again');
  assert.deepEqual([modal.querySelector('.mem-cmp-take').disabled, modal.querySelector('.mem-cmp-keep').disabled], [false, false], 'a refusal gives both sides back');
  reply = { ok: true, status: 200, body: { ok: true, snapshotId: 's', shared: [], blocked: [], tookTeam: ['build'], held: [], flush: null,
    status: { ...status, notes: [row('build', 'shared'), ...status.notes.slice(1)] } } };
  click(window, modal.querySelector('.mem-cmp-take'));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(posts.slice(1).map((p) => p.action), ['share', 'take-team']);
  assert.deepEqual(posts[2], { name: 'build', action: 'take-team', hash: 'b'.repeat(40), teamHash: 'd'.repeat(40) });
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(lastToast(doc).title, 'build.md: the team\'s version is here now');
  assert.equal(sec.querySelector('.mem-team-row[data-name="build"] .badge').textContent, 'Shared');
  await compare('lint');
  assert.deepEqual(offered(), [false, false], 'the team\'s version is over the cap here; mine is blocked');
  assert.match(doc.getElementById('plugin-modal-body').textContent, /blocked by the secret check: line 4: an email address/);
  await compare('oncall');   // the Team view still shows it held; the fresh preview says it is recorded blocked
  assert.deepEqual(offered(), [false, false], 'a note recorded blocked stays here: no side can be picked');
  // Keep mine the remote refused: the returned status records it blocked — never "waits to be pushed" (seedSummary's rule).
  reply = { ok: true, status: 200, body: { ok: true, snapshotId: null, shared: ['docs'], blocked: [], tookTeam: [], held: [], flush: { ok: false, code: 'PUSH_REJECTED', pushed: 0 },
    status: { ...status, notes: [row('build', 'shared'), ...status.notes.slice(1, 3), row('docs', 'blocked')] } } };
  await compare('docs');
  click(window, modal.querySelector('.mem-cmp-keep'));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['warn', 'docs.md: your version is blocked — the Team view says why']);
});

test('Memory › Team: Undo asks first and says what it put back; Remove from team of a team-only note promises no local copy; a STALE Share warns and opens the review again; a Share that cannot fetch first says why in the dialog', async () => {
  const calls = [];
  let previews = 0;
  let seedReply = { status: 409, body: { error: 'Some notes changed since you reviewed them — review them again.', code: 'STALE', names: ['conv'] } };
  const status = TEAM_ST({ counts: { local: 1, team: 1 }, notes: [...TEAM_ST().notes, { name: 'ana', state: 'team', local: false, team: true, mounted: true, updated: null, author: 'Ana' }],
    seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 's', shared: 1, tookTeam: 1, held: 1 } } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    if (u.includes('/api/memory/team/')) calls.push(`${method} ${u.slice('/api/memory/team/alpha-00000001'.length)}`);
    if (u.endsWith('/seed/undo') && method === 'POST') return memJson({ ok: true, restored: ['build'], released: ['lint'], cancelled: [], failed: [], status: { ...status, seed: { offer: 'done', last: null } } });
    if (u.endsWith('/api/memory/team/alpha-00000001/seed') && method === 'GET') { previews++; return memJson(PREVIEW); }
    if (u.endsWith('/api/memory/team/alpha-00000001/seed') && method === 'POST') return Promise.resolve({ ok: false, status: seedReply.status, json: async () => seedReply.body });
    if (u.endsWith('/api/memory/team/alpha-00000001')) return memJson(status);
    return memFetch(u, o);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const confirm = doc.getElementById('confirm-modal');
  click(window, sec.querySelector('.mem-team-undo'));
  assert.deepEqual([confirm.classList.contains('hidden'), doc.getElementById('confirm-title').textContent], [false, 'Undo last seeding'], 'Undo asks first');
  click(window, doc.getElementById('confirm-ok'));
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(calls.includes('POST /seed/undo'));
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['ok', 'Seeding undone: 1 put back · 1 released']);
  assert.equal(sec.querySelector('.mem-team-undo'), null, 'no seeding left to undo');
  click(window, sec.querySelector('.mem-team-remove[data-name="ana"]'));
  assert.doesNotMatch(doc.getElementById('confirm-message').textContent, /copy on this machine/, 'a team-only note has no local copy');
  click(window, doc.getElementById('confirm-cancel'));
  for (let i = 0; i < 3; i++) await tick();
  // Share on a review that went stale meanwhile: a warning, then the review again from a fresh preview.
  click(window, sec.querySelector('.mem-team-seed'));
  for (let i = 0; i < 5; i++) await tick();
  const modal = doc.getElementById('plugin-modal');
  modal.querySelector('.mem-seed-check[data-name="conv"]').click();
  click(window, modal.querySelector('.mem-seed-submit'));
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(calls.includes('POST /seed'));
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['warn', 'Some notes changed since you opened this — review them again.']);
  assert.deepEqual([previews, modal.classList.contains('hidden')], [2, false]);
  assert.equal(modal.querySelector('.mem-seed-check[data-name="conv"]').checked, false, 'the review starts again');
  seedReply = { status: 502, body: { error: 'Could not reach the team branch to check it before sharing (fatal: unable to access) — try again.', code: 'FETCH_FAILED' } };
  modal.querySelector('.mem-seed-check[data-name="conv"]').click();
  click(window, modal.querySelector('.mem-seed-submit'));
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(cardAlertOf(doc.getElementById('plugin-modal-actions').parentElement), { title: 'Nothing was applied', detail: seedReply.body.error }, 'not even a take team or a skip');
  assert.equal(modal.classList.contains('hidden'), false, 'the dialog stays open: Share again');
  const controls = [...sec.querySelectorAll('.mem-team-host button, .mem-team-host input')];
  assert.ok(controls.length && controls.every((c) => !c.disabled), 'a refusal gives every control of the view back');
});

/** A held request: `replies` releases each one in order, answering `body`. */
const holdReplies = () => {
  const replies = [];
  const held = (body) => new Promise((resolve) => replies.push(() => resolve({ ok: true, status: 200, json: async () => body })));
  return { replies, held };
};
const HELD_BUILD = { name: 'build', state: 'held', hash: 'b'.repeat(40), description: 'Build', blocked: null, text: '---\nname: build\n---\nMine.\n',
  team: { name: 'build', hash: 'd'.repeat(40), text: '---\nname: build\n---\nTheirs.\n', author: 'Ana', updated: null, bytes: 40, same: false, tooBig: false } };
const teamRow = (name, state, over = {}) => ({ name, state, local: true, team: true, mounted: false, updated: null, author: 'Ana', ...over });

test('Memory › Team: one request at a time — while a Compare side, an Undo or a Remove from team runs, every control waits for it; a Keep mine whose push failed says the note waits', async () => {
  const sent = [];
  const { replies, held } = holdReplies();
  const ana = teamRow('ana', 'team', { local: false, mounted: true });
  const status = TEAM_ST({ counts: { held: 1, team: 1 }, notes: [ana, teamRow('build', 'held')], seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 's', shared: 0, tookTeam: 0, held: 1 } } });
  const after = { ...status, notes: [ana, teamRow('build', 'pending')] };
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    const p = (u.match(/\/api\/memory\/team\/alpha-00000001(.*)$/) || [])[1];
    if (p === undefined) return memFetch(u, o);
    if (method !== 'GET') sent.push(`${method} ${p}`);
    if (p === '/seed?name=build') return memJson({ ...PREVIEW, notes: [HELD_BUILD] });
    if (p === '/resolve') return held({ ok: true, snapshotId: null, shared: ['build'], blocked: [], tookTeam: [], held: [], flush: { ok: false, code: 'PUSH_REJECTED', pushed: 0 }, status: after });
    if (p === '/seed/undo') return held({ ok: true, restored: [], released: [], cancelled: [], failed: [], status: { ...after, seed: { offer: 'done', last: null } } });
    if (p === '/notes/ana') return held({ ok: true, status: { ...after, notes: [teamRow('build', 'pending')], seed: { offer: 'done', last: null } } });
    return memJson(status);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const modal = doc.getElementById('plugin-modal');
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
  const controls = () => [...sec.querySelectorAll('.mem-team-host button, .mem-team-host input')];
  // Compare: while Keep mine runs, Take team waits — and so does every control of the view behind the dialog.
  click(window, sec.querySelector('.mem-team-compare[data-name="build"]'));
  await settle();
  click(window, modal.querySelector('.mem-cmp-keep'));
  await settle();
  assert.equal(modal.querySelector('.mem-cmp-take').disabled, true);
  click(window, modal.querySelector('.mem-cmp-take'));
  await settle();
  assert.deepEqual(sent, ['POST /resolve'], 'the other side never posts');
  assert.ok(controls().length && controls().every((c) => c.disabled), 'the view waits too');
  replies.shift()();
  await settle();
  assert.equal(modal.classList.contains('hidden'), true);
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['warn', 'build.md: your version waits to be pushed — the Team view says why'], 'its push failed: not shared yet');
  // Undo: while it runs, a second Undo — or any other control — waits.
  click(window, sec.querySelector('.mem-team-undo'));
  click(window, doc.getElementById('confirm-ok'));
  await settle();
  assert.ok(controls().every((c) => c.disabled));
  click(window, sec.querySelector('.mem-team-undo'));
  await settle();
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), true, 'no second Undo');
  replies.shift()();
  await settle();
  // Remove from team: the same.
  click(window, sec.querySelector('.mem-team-remove[data-name="ana"]'));
  click(window, doc.getElementById('confirm-ok'));
  await settle();
  assert.ok(controls().every((c) => c.disabled));
  click(window, sec.querySelector('.mem-team-remove[data-name="ana"]'));
  await settle();
  assert.deepEqual(sent, ['POST /resolve', 'POST /seed/undo', 'DELETE /notes/ana']);
  replies.shift()();
  await settle();
  assert.ok(controls().length && controls().every((c) => !c.disabled), 'every control is back');
});

test('Memory › Team: the dialog belongs to its page — leaving closes the one it opened, never another feature\'s, and nothing posts; a late preview never takes over another dialog; a late switch-on reply opens none over another page', async () => {
  const sent = [];
  const { replies, held } = holdReplies();
  let status = TEAM_ST({ counts: { held: 1 }, notes: [teamRow('build', 'held')], seed: { offer: 'done', last: null } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    if (u.endsWith('/api/projects/alpha-00000001/settings') && method === 'PATCH') { sent.push('PATCH settings'); return held({ own: { 'memory.team': true }, effective: {}, layers: {}, roles: [] }); }
    const p = (u.match(/\/api\/memory\/team\/alpha-00000001(.*)$/) || [])[1];
    if (p === undefined) return memFetch(u, o);
    sent.push(`${method} ${p}`);
    if (p === '/seed?name=build') return memJson({ ...PREVIEW, notes: [HELD_BUILD] });
    if (p === '/seed') return held(PREVIEW);   // the seeding dialog's preview, answered when the test says
    return memJson(status);
  } });
  const doc = window.document;
  const modal = doc.getElementById('plugin-modal');
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
  const sec = () => doc.querySelector('.pd-sec[data-sec="memory"]');
  const teardown = () => new Promise((r) => setTimeout(r, 700));   // a closed page is torn down after its slide-out
  const writes = () => sent.filter((s) => !s.startsWith('GET '));
  // Compare open, then the page left (browser Back): while the page slides out, Keep mine posts nothing and its other
  // controls open nothing — then the dialog goes with its page.
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const share = sec().querySelector('.mem-team-seed');
  click(window, sec().querySelector('.mem-team-compare[data-name="build"]'));
  await settle();
  const keep = modal.querySelector('.mem-cmp-keep');
  assert.ok(keep && !modal.classList.contains('hidden'));
  await goHash(window, 'projects');
  click(window, keep);
  click(window, share);
  await settle();
  assert.deepEqual(replies, [], 'no seeding preview fetched');
  await teardown();
  assert.equal(modal.classList.contains('hidden'), true, 'the dialog went with its page');
  assert.deepEqual(writes(), [], 'nothing posted');
  // A late preview: the seeding dialog is cancelled while it loads, and another dialog takes #plugin-modal — the reply
  // leaves that one alone.
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  click(window, sec().querySelector('.mem-team-seed'));
  await settle();
  click(window, [...doc.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Cancel'));
  const other = doc.createElement('div');
  doc.getElementById('plugin-modal-body').replaceChildren(other);
  modal.classList.remove('hidden');
  replies.shift()();
  await settle();
  assert.equal(doc.getElementById('plugin-modal-body').firstElementChild, other, 'another dialog keeps #plugin-modal');
  // The page leaves with that dialog still up: its teardown closes only a dialog this page opened.
  await goHash(window, 'projects');
  await teardown();
  assert.deepEqual([modal.classList.contains('hidden'), doc.getElementById('plugin-modal-body').firstElementChild], [false, other], 'the page left: another dialog keeps #plugin-modal');
  modal.classList.add('hidden');
  // A late switch-on reply: switched on, then the page left before the PATCH answered — no seeding dialog over the
  // other page, and no preview is even fetched.
  status = TEAM_ST({ enabled: false, counts: {}, notes: [], remote: null });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  await settle();
  const sw = sec().querySelector('.mem-team-switch');
  sw.checked = true;
  sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(writes(), ['PATCH settings']);
  await goHash(window, 'projects');
  status = TEAM_ST();   // on, the offer pending, a note to share: the reply would raise the seeding dialog
  replies.shift()();
  await settle();
  assert.equal(modal.classList.contains('hidden'), true, 'no dialog over the other page');
  assert.deepEqual(replies, [], 'no preview fetched');
  await teardown();
});

test('Memory › Team: a seeding dialog closed while its request runs leaves #plugin-modal alone — another dialog there stays — and the view waits; a refusal (a STALE too) then is a toast', async () => {
  let answer = null;   // what the next held POST /seed answers
  const replies = [];
  const status = TEAM_ST({ seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 's', shared: 1, tookTeam: 0, held: 0 } } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    const p = (u.match(/\/api\/memory\/team\/alpha-00000001(.*)$/) || [])[1];
    if (p === undefined) return memFetch(u, o);
    if (p === '/seed' && method === 'GET') return memJson(PREVIEW);
    if (p === '/seed' && method === 'POST') { const a = answer; return new Promise((resolve) => replies.push(() => resolve(a))); }
    return memJson(status);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const modal = doc.getElementById('plugin-modal');
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
  const reply = (code, body) => ({ ok: code < 400, status: code, json: async () => body });
  const offline = 'Could not reach the team branch to check it before sharing (offline) — try again.';
  const stale = 'Some notes changed since you reviewed them — review them again.';
  for (const [a, toast] of [
    [reply(502, { error: offline, code: 'FETCH_FAILED' }), ['err', 'Nothing was applied', offline]],
    [reply(409, { error: stale, code: 'STALE', names: ['conv'] }), ['err', 'Nothing was applied', stale]],   // nothing reopened either
    // The remote refused the share: blocked, never "pending" (seedSummary's rule).
    [reply(200, { ok: true, snapshotId: 's', shared: ['conv'], blocked: [], tookTeam: [], held: [], flush: { ok: false, code: 'PUSH_REJECTED', pushed: 0 },
      status: { ...status, notes: [{ ...status.notes[0], state: 'blocked' }] } }), ['warn', '1 blocked by the secret check', 'The push failed (PUSH_REJECTED); the Team view says why.']],
    [reply(200, { ok: true, snapshotId: 's', shared: ['conv'], blocked: [], tookTeam: [], held: [], flush: { ok: true, pushed: 1 },
      status: { ...status, notes: [{ ...status.notes[0], state: 'shared', team: true }] } }), ['ok', '1 note shared', '']],
  ]) {
    answer = a;
    click(window, sec.querySelector('.mem-team-seed'));
    await settle();
    modal.querySelector('.mem-seed-check[data-name="conv"]').click();
    click(window, modal.querySelector('.mem-seed-submit'));
    await settle();
    click(window, [...doc.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Cancel'));
    const other = doc.createElement('div');   // another feature's dialog opens meanwhile
    doc.getElementById('plugin-modal-body').replaceChildren(other);
    modal.classList.remove('hidden');
    click(window, sec.querySelector('.mem-team-undo'));   // the view waits for the seeding
    assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), true, 'no Undo while the seeding runs');
    doc.getElementById('toasts').replaceChildren();   // at most TOAST_MAX stay: count this reply's alone
    replies.shift()();
    await settle();
    assert.deepEqual([modal.classList.contains('hidden'), doc.getElementById('plugin-modal-body').firstElementChild], [false, other], `${a.status}: the other dialog stays`);
    const t = lastToast(doc);
    assert.deepEqual([toastTitles(doc).length, t.tone, t.title, t.detail], [1, ...toast], `${a.status}: a toast says what happened`);
    modal.classList.add('hidden');
  }
});

test('Memory › Team: a refusal that lands after the page left is a toast — not a card alert in the dialog that closes with its page — and nothing opens again', async () => {
  const replies = [];
  let previews = 0;
  const status = TEAM_ST({ counts: { held: 1 }, notes: [teamRow('build', 'held')], seed: { offer: 'done', last: null } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const p = (u.match(/\/api\/memory\/team\/alpha-00000001(.*)$/) || [])[1];
    if (p === undefined) return memFetch(u, o);
    if (p === '/seed?name=build') { previews++; return memJson({ ...PREVIEW, notes: [HELD_BUILD] }); }
    if (p === '/resolve') return new Promise((resolve) => replies.push(resolve));   // Keep mine: answered when the test says
    return memJson(status);
  } });
  const doc = window.document;
  const modal = doc.getElementById('plugin-modal');
  const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
  const teardown = () => new Promise((r) => setTimeout(r, 700));   // a closed page is torn down after its slide-out
  const reply = (code, body) => ({ ok: code < 400, status: code, json: async () => body });
  const offline = 'Could not reach the team branch to check it before sharing (offline) — try again.';
  const stale = 'Some notes changed since you reviewed them — review them again.';
  for (const [a, detail] of [
    [reply(502, { error: offline, code: 'FETCH_FAILED' }), offline],
    [reply(409, { error: stale, code: 'STALE', names: ['build'] }), stale],   // nothing reopened either
  ]) {
    await goHash(window, 'projects/alpha-00000001/memory/~team');
    click(window, doc.querySelector('.pd-sec[data-sec="memory"] .mem-team-compare[data-name="build"]'));
    await settle();
    click(window, modal.querySelector('.mem-cmp-keep'));
    await settle();
    await goHash(window, 'projects');   // Back while Keep mine runs: the dialog stays up while the page slides out
    const fetched = previews;
    doc.getElementById('toasts').replaceChildren();   // at most TOAST_MAX stay: count this reply's alone
    replies.shift()(a);
    await settle();
    const t = lastToast(doc) || {};
    assert.deepEqual([toastTitles(doc).length, t.tone, t.title, t.detail], [1, 'err', 'Not changed', detail], `${a.status}: a toast says it`);
    assert.equal(cardAlertOf(doc.getElementById('plugin-modal-body').closest('.dlg')), null, `${a.status}: nothing is said in a dialog that is closing`);
    assert.deepEqual([previews, modal.classList.contains('hidden')], [fetched, false], `${a.status}: no Compare opens again; the dialog is still up`);
    await teardown();
    assert.equal(modal.classList.contains('hidden'), true, `${a.status}: the dialog went with its page`);
  }
});

test('Memory › Team: a refused Sync, Undo or Remove from team says why and gives every control of the view back', async () => {
  const ana = teamRow('ana', 'team', { local: false, mounted: true });
  const status = TEAM_ST({ counts: { held: 1, team: 1 }, notes: [ana, teamRow('build', 'held')], seed: { offer: 'done', last: { at: '2026-10-17T10:01:00.000Z', snapshotId: 's', shared: 0, tookTeam: 0, held: 1 } } });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const p = (u.match(/\/api\/memory\/team\/alpha-00000001(.*)$/) || [])[1];
    if (p === undefined) return memFetch(u, o);
    if ((o.method || 'GET').toUpperCase() !== 'GET') return Promise.resolve({ ok: false, status: 502, json: async () => ({ error: `offline: ${p}` }) });
    return memJson(status);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const controls = () => [...sec.querySelectorAll('.mem-team-host button, .mem-team-host input')];
  const refused = async (title, detail) => {
    for (let i = 0; i < 10; i++) await tick();
    const t = lastToast(doc) || {};
    assert.deepEqual([t.tone, t.title, t.detail], ['err', title, detail]);
    assert.ok(controls().length && controls().every((c) => !c.disabled), 'every control is back');
  };
  await checkRows([
    { name: 'Sync now', run: async () => { click(window, sec.querySelector('.mem-team-sync')); await refused('Sync failed', 'offline: /sync'); } },
    { name: 'Undo last seeding', run: async () => { click(window, sec.querySelector('.mem-team-undo')); click(window, doc.getElementById('confirm-ok')); await refused('Not undone', 'offline: /seed/undo'); } },
    { name: 'Remove from team', run: async () => { click(window, sec.querySelector('.mem-team-remove[data-name="ana"]')); click(window, doc.getElementById('confirm-ok')); await refused('Not removed', 'offline: /notes/ana'); } },
  ]);
});

test('Memory › Team: a refetch older than a Remove from team never repaints over its answer (m8); a failed refetch keeps the view (m9); the switch waits while a request runs (m14)', async () => {
  const ana = teamRow('ana', 'team', { local: false, mounted: true });
  let status = TEAM_ST({ counts: { team: 1, local: 1 }, notes: [ana, TEAM_ST().notes[0]] });
  let hold = null, failGet = false, releaseDelete;
  const deleteHeld = new Promise((r) => { releaseDelete = r; });
  const { window } = await boot({ fetchHandler: (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase();
    if (u.endsWith('/api/memory/team/alpha-00000001/notes/ana') && method === 'DELETE') {
      status = TEAM_ST({ notes: [{ ...ana, state: 'deleting' }, TEAM_ST().notes[0]] });
      return deleteHeld.then(() => memJson({ ok: true, status }));
    }
    if (u.endsWith('/api/memory/team/alpha-00000001')) {
      if (failGet) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'team.json unreadable' }) });
      const old = status;
      if (hold) return hold.then(() => memJson(old));   // a slow GET answers with the status of when it started
      return memJson(status);
    }
    return memFetch(u, o);
  } });
  await goHash(window, 'projects/alpha-00000001/memory/~team');
  const doc = window.document;
  const sec = doc.querySelector('.pd-sec[data-sec="memory"]');
  const badge = () => sec.querySelector('.mem-team-row[data-name="ana"] .badge').textContent;
  const before = badge();
  let release;
  hold = new Promise((r) => { release = r; });
  WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'memory-team-changed', projectKey: 'alpha-00000001', action: 'flushed' }) }));
  await new Promise((r) => setTimeout(r, 400));   // the frame's GET is out, held
  click(window, sec.querySelector('.mem-team-remove[data-name="ana"]'));
  click(window, doc.getElementById('confirm-ok'));
  for (let i = 0; i < 5; i++) await tick();
  const sw = sec.querySelector('.mem-team-switch');   // disabled while the DELETE runs; a change that slips through waits too
  sw.checked = false;
  sw.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), true, 'no switch-off while a request runs');
  assert.equal(sec.querySelector('.mem-team-switch').checked, true, 'the switch is painted back');
  releaseDelete();
  for (let i = 0; i < 10; i++) await tick();
  const after = badge();
  assert.notEqual(after, before, 'the DELETE\'s status is painted');
  hold = null; release();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(badge(), after, 'the older GET never repaints over it');
  failGet = true;
  WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'memory-team-changed', projectKey: 'alpha-00000001', action: 'flushed' }) }));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(badge(), after, 'a failed refetch keeps the last status on screen');
  assert.ok(sec.querySelector('.mem-team-switch'), 'and the switch');
});

test('E10: the Overview line "Your team shares memory for this repository" — advanced, no dialog; Turn on is the normal switch, Not now its own POST, and the line goes', async () => {
  let offered = [PROJECTS[0].key];   // the projects whose row carries teamMemoryOffer, as GET /api/projects marks them
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (/\/api\/projects\/[^/]+\/settings$/.test(u) && method === 'PATCH') {
        calls.push([method, u, JSON.parse(opts.body)]);
        offered = offered.filter((k) => !u.includes(k));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ own: {}, effective: {}, layers: {}, roles: [] }) });
      }
      if (u.includes('/available/dismiss')) {
        calls.push([method, u]);
        offered = offered.filter((k) => !u.includes(k));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, available: { state: 'dismissed', offer: false } }) });
      }
      if (u.endsWith('/api/projects') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS.map((p) => (offered.includes(p.key) ? { ...p, teamMemoryOffer: true } : p)) }) });
      }
      return null;
    },
  });
  await goHash(window, 'projects/alpha-00000001');
  const doc = window.document;
  // The list: a small mark on the row (Add projects closes on success; this list is what it added).
  const marks = [...doc.querySelectorAll('#projects-list .pl-item')].map((r) => [r.dataset.key, r.querySelector('.team-mem-mark')?.textContent || null]);
  assert.deepEqual(marks, [['alpha-00000001', 'team memory available'], ['beta-00000002', null]]);
  assert.equal(doc.querySelector('#projects-list .team-mem-mark').dataset.minLevel, 'advanced');
  const line = () => doc.querySelector('#proj-detail .pd-sec[data-sec="overview"] .mem-team-available');
  const projectsChanged = async () => {
    for (const fn of WSStub.last._listeners.message || []) fn({ data: JSON.stringify({ type: 'projects-changed', action: 'updated' }) });
    for (let i = 0; i < 6; i++) await tick();
  };
  assert.ok(line(), 'the line shows while origin has the branch and the project is off');
  assert.equal(line().dataset.minLevel, 'advanced');
  assert.equal(line().querySelector('span').textContent, 'Your team shares memory for this repository');
  click(window, line().querySelector('.mem-team-turn-on'));
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(calls, [['PATCH', '/api/projects/alpha-00000001/settings', { 'memory.team': true }]], 'the switch itself — no route of its own');
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), true, 'no dialog');
  assert.equal(line(), null, 'hidden once on');
  assert.equal(doc.querySelector('#projects-list .team-mem-mark'), null, 'and the mark with it');
  assert.equal(lastToast(doc).title, 'Team memory is on');
  // A project the branch is on, Not now.
  offered = [PROJECTS[0].key];
  calls.length = 0;
  await projectsChanged();
  assert.ok(line(), 'a projects-changed frame (the check answered) brings it back');
  click(window, line().querySelector('.mem-team-not-now'));
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(calls, [['POST', '/api/memory/team/alpha-00000001/available/dismiss']]);
  assert.equal(line(), null);
  await projectsChanged();
  assert.equal(line(), null, 'Not now holds');
});
