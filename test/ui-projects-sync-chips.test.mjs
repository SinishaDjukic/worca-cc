// test/ui-projects-sync-chips.test.mjs — Projects / Workspaces sync rows and Sync all
// (#527, plan §6.7 / §6.8; design board 1: one row model — icon, branch, status + hint, one
// action — on both lists, a rollup sentence per workspace, and one "Checked … ↻" per list).
// Boot from test/ui-projects-view.test.mjs; the fake socket delivers server frames the way
// test/ui-history-shipit.test.mjs does.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [
  { name: 'alpha', path: '/p/alpha', exists: true, key: 'k1' },
  { name: 'beta', path: '/p/beta', exists: true, key: 'k2' },
];
const WORKSPACES = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# x', projectPaths: ['/p/alpha', '/p/beta'],
    projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
];
const NOW = new Date().toISOString();
const blk = (base, over = {}) => ({ base, remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0, dirty: false,
  checkedOutHere: true, fetchedAt: NOW, stale: false, settings: { beforeRun: true, onDiverged: 'ask' }, ...over });
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ projects = PROJECTS, workspaces = WORKSPACES, git = 'on', chips = () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 3 }), k2: blk('main') } }),
  all = () => ({ projects: { k1: blk('dev'), k2: blk('main') } }), post = () => ({ sync: blk('dev') }) } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  // P0's gitOn() reads <html data-git>; the server renders it, so set it before app.js loads.
  if (git === 'off') window.document.documentElement.dataset.git = 'off';
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/sync/projects')) return ok(chips());
    if (u.includes('/api/sync/all')) return ok(all(opts.body ? JSON.parse(opts.body) : {}));
    if (/\/api\/projects\/[^/]+\/sync/.test(u) && method === 'POST') return ok(post());
    if (u.includes('/api/projects')) return ok({ projects });
    if (u.includes('/api/workspaces')) return ok({ workspaces });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, doc: window.document, calls, recv };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
// Every status read waits out SYNC_CHIPS_MS (300). A test boots on real timers, then drives
// app.js's call-time timers with useAppTimers(t); the helpers below step that mocked clock.
async function waitFor(timers, pred, ms = 3000) {
  for (let waited = 0; !pred(); waited += 10) {
    if (waited > ms) throw new Error('waitFor timed out');
    await timers.advance(10);
  }
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const chipGets = (calls) => calls.filter((c) => c.url.includes('/api/sync/projects')).length;
// jsdom fires hashchange from a timer the mock holds: dispatch it here.
async function go(window, timers, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await timers.settle();
}
// A row's status label and tone (Projects sync bar or Workspaces table row).
const label = (node) => node?.querySelector('.ps-label, .ws-tlabel')?.textContent;
const tone = (node) => (/tone-(\w+)/.exec(node?.className || '') || [])[1];
// A Projects bar that has its answer (it reads "Checking…" until the first status read lands).
const settled = (node) => !!node && !node.hidden && tone(node) !== undefined && label(node) !== 'Checking…';

test('the rows render from /api/sync/projects, and one render makes exactly one GET', async (t) => {
  const ctx = await boot();
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects');
    const slot = () => ctx.doc.querySelector('.proj-sync[data-key="k1"]');
    await waitFor(timers, () => settled(slot()));
    assert.equal(tone(slot()), 'blue');
    assert.equal(slot().querySelector('.ps-bname').textContent, 'dev');
    assert.equal(slot().querySelector('.ps-vs').textContent, 'vs origin/dev', 'the ref it is compared with');
    assert.equal(label(slot()), '3 commits behind');
    assert.equal(slot().querySelector('.ps-hint').textContent, 'Next run syncs it first');
    assert.equal(slot().querySelector('button').textContent, 'Sync');
    assert.equal(tone(ctx.doc.querySelector('.proj-sync[data-key="k2"]')), 'ok');
    assert.equal(ctx.doc.querySelector('.proj-sync[data-key="k2"] button'), null, 'up to date: nothing to do, no button');
    assert.equal(ctx.doc.querySelector('#projects-list .sync-checked-txt').textContent, 'Checked just now');
    // Sync all sits in the card head, beside the last check time — not in the page's topbar.
    assert.equal(ctx.doc.querySelector('#projects-list .saved-head #projects-sync-all').textContent, 'Sync all (1)');
    assert.equal(ctx.doc.querySelectorAll('#projects-sync-all').length, 1);
    // The shared filter chip and a quiet Sync all (docs/design-system.md › Filter chip, Button).
    const chips = [...ctx.doc.querySelectorAll('#projects-list .proj-filters button')];
    assert.ok(chips.length >= 2);
    assert.ok(chips.every((c) => c.classList.contains('filter-chip') && !c.classList.contains('proj-fchip')));
    assert.equal(chips.filter((c) => c.getAttribute('aria-pressed') === 'true').length, 1);
    const sync = ctx.doc.getElementById('projects-sync-all');
    assert.ok(sync.classList.contains('btn-quiet'));
    assert.ok(!sync.classList.contains('btn-primary'));
    click(ctx.window, chips[1]);
    assert.equal(ctx.doc.activeElement?.dataset.filter, chips[1].dataset.filter, 'focus stays on the picked chip');
    await timers.advance(400);
    assert.equal(chipGets(ctx.calls), 1, 'render → refresh never loops back into a render');
  } finally {
    t.mock.timers.reset();
  }
});

test('the project page Branch tile: a sans value holding the branch name as an inner mono span', async (t) => {
  const ctx = await boot();
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects/k1');
    const value = () => ctx.doc.querySelector('#proj-detail .pd-ov-card-branch .pd-ov-value');
    await waitFor(timers, () => value() && value().querySelector('span.mono'));
    assert.equal(value().classList.contains('mono'), false);
    assert.equal(value().querySelector('span.mono').textContent, 'dev');
  } finally {
    t.mock.timers.reset();
  }
});

test('project-sync-changed frames refetch once, coalesced', async (t) => {
  const ctx = await boot();
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects');
    await waitFor(timers, () => chipGets(ctx.calls) === 1);
    await timers.advance(50);
    ctx.recv({ type: 'project-sync-changed', action: 'k1' });
    await timers.advance(299);
    assert.equal(chipGets(ctx.calls), 1, 'nothing before SYNC_CHIPS_MS (300)');
    await timers.advance(1);
    assert.equal(chipGets(ctx.calls), 2, 'the refetch lands at 300 ms');
    await timers.advance(400);
    assert.equal(chipGets(ctx.calls), 2, 'one frame, one refetch');
    for (let i = 0; i < 5; i++) ctx.recv({ type: 'project-sync-changed', action: 'k1' });
    await waitFor(timers, () => chipGets(ctx.calls) === 3);
    await timers.advance(400);
    assert.equal(chipGets(ctx.calls), 3, 'five frames, one refetch');
  } finally {
    t.mock.timers.reset();
  }
});

test('row states: no remote says so (no button) until a frame brings one; diverged offers Review… never Sync; a dirty behind row shows its hint and no Sync', async (t) => {
  // Each row boots with its own status reads.
  await checkRows([
    { name: 'a project with no remote says so; a later frame with a remote fills the bar', run: async () => {
      let remote = null;
      const ctx = await boot({ chips: () => ({ projects: { k1: blk('dev', { remote }), k2: blk('main') } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        await waitFor(timers, () => chipGets(ctx.calls) === 1);
        await timers.advance(20);
        const slot = ctx.doc.querySelector('.proj-sync[data-key="k1"]');
        assert.equal(slot.hidden, false);
        assert.equal(tone(slot), 'none');
        assert.equal(slot.textContent, 'No git remoteLocal folder · nothing to sync');
        assert.equal(slot.querySelector('button'), null);
        remote = 'origin';
        ctx.recv({ type: 'project-sync-changed', action: 'k1' });
        await waitFor(timers, () => label(slot) === 'Up to date');
        assert.equal(tone(slot), 'ok');
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a diverged project offers Review…, never a Sync; dirty does not hide behind', run: async () => {
      const ctx = await boot({ chips: () => ({ projects: {
        k1: blk('dev', { state: 'diverged', ahead: 2, behind: 5 }),
        k2: blk('main', { state: 'behind', behind: 1, dirty: true }),
      } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        const slot = (k) => ctx.doc.querySelector(`.proj-sync[data-key="${k}"]`);
        await waitFor(timers, () => settled(slot('k1')) && settled(slot('k2')));
        assert.equal(label(slot('k1')), 'Diverged');
        assert.equal(tone(slot('k1')), 'amber');
        assert.equal(slot('k1').querySelector('.ps-hint').textContent, '2 ahead, 5 behind · next run will ask');
        assert.equal(slot('k1').querySelector('button').textContent, 'Review…');
        assert.equal(label(slot('k2')), '1 commit behind', 'dirty no longer hides behind');
        assert.match(slot('k2').querySelector('.ps-hint').textContent, /Uncommitted changes/);
        assert.equal(slot('k2').querySelector('button'), null, 'Sync cannot move a dirty checkout');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('a row Sync POSTs by key, repaints, and does not open the project page', async (t) => {
  const ctx = await boot();
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects');
    const slot = () => ctx.doc.querySelector('.proj-sync[data-key="k1"]');
    await waitFor(timers, () => settled(slot()));
    click(ctx.window, slot().querySelector('button'));
    await waitFor(timers, () => label(slot()) === 'Up to date');
    const post = ctx.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/projects/k1/sync'));
    assert.deepEqual(post.body, { mode: 'ff' });
    assert.equal(ctx.window.location.hash, '#projects', 'the row did not open');
    assert.equal(ctx.doc.querySelector('#projects-sync-all').hidden, true, 'nothing behind: no Sync all');
  } finally {
    t.mock.timers.reset();
  }
});

test('Sync all POSTs /api/sync/all {mode:ff} and Check origin now POSTs {mode:fetch}; both paint from the answer', async (t) => {
  // Each row boots with its own /api/sync/all answer.
  await checkRows([
    { name: 'Sync all POSTs /api/sync/all and paints from its answer', run: async () => {
      const ctx = await boot();
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        const slot = () => ctx.doc.querySelector('.proj-sync[data-key="k1"]');
        await waitFor(timers, () => settled(slot()));
        click(ctx.window, ctx.doc.querySelector('#projects-sync-all'));
        await waitFor(timers, () => ctx.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/sync/all')));
        await waitFor(timers, () => label(slot()) === 'Up to date');
        assert.deepEqual(ctx.calls.find((c) => c.url.endsWith('/api/sync/all')).body, { mode: 'ff' });
        assert.equal(ctx.doc.querySelector('#projects-sync-all').disabled, false);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'Check origin now fetches every project and moves nothing', run: async () => {
      const ctx = await boot({ all: () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 5 }), k2: blk('main') } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        const slot = () => ctx.doc.querySelector('.proj-sync[data-key="k1"]');
        await waitFor(timers, () => settled(slot()));
        click(ctx.window, ctx.doc.querySelector('#projects-list .sync-check-now'));
        await waitFor(timers, () => label(slot()) === '5 commits behind');
        assert.deepEqual(ctx.calls.find((c) => c.url.endsWith('/api/sync/all')).body, { mode: 'fetch' });
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('workspace rows: rollup sentence, icon strip, Sync all; the table opens on demand (and by itself for a diverged member), and its Sync does not open the workspace', async (t) => {
  // Each row boots with its own status reads.
  await checkRows([
    { name: 'workspace rows: rollup sentence, icon strip, Sync all; the table opens on demand and its Sync does not open the workspace', run: async () => {
      const ctx = await boot();
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        // The strip paints at once ("Checking…"); the statuses land with /api/sync/projects.
        await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
        assert.equal(item().querySelector('.ws-rollup-txt').textContent, '1 behind · 1 up to date');
        assert.equal(tone(item().querySelector('.ws-rollup')), 'blue');
        assert.deepEqual([...item().querySelectorAll('.ws-strip-name')].map((n) => n.textContent), ['alpha', 'beta']);
        const syncAll = item().querySelector('.ws-sync-all');
        assert.equal(syncAll.hidden, false);
        assert.ok(syncAll.classList.contains('btn-quiet') && !syncAll.classList.contains('btn-primary'));
        assert.equal(syncAll.textContent, 'Sync all (1)');
        const table = item().querySelector('.ws-table');
        assert.equal(table.hidden, true, 'nothing diverged: the table starts closed');
        const toggle = item().querySelector('.ws-toggle');
        assert.equal(toggle.textContent, 'Show 2 projects');
        click(ctx.window, toggle);
        assert.equal(ctx.window.location.hash, '#workspaces', 'Show did not open the workspace');
        assert.equal(table.hidden, false);
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        assert.ok(table.classList.contains('table-wrap'));
        assert.equal(table.querySelectorAll('table.table.ws-members').length, 1);
        const rows = [...table.querySelectorAll('.ws-trow')];
        assert.ok(rows.every((r) => r.tagName === 'TR'));
        for (const r of rows) {
          assert.deepEqual(['.ws-tbranch-cell', '.ws-tstatus-cell', '.ws-tact-cell'].map((c) => r.querySelector(c).dataset.label), ['Branch', 'Status', 'Action']);
          assert.equal(r.querySelector('.ws-tname').tagName, 'TD');
          assert.ok(r.querySelector('.ws-tname').classList.contains('table-main'));
          assert.equal(r.querySelector('td.ws-icon-cell').getAttribute('aria-hidden'), 'true');
          assert.notEqual(r.querySelector('.ws-tstatus-cell').textContent, '', 'the status words carry the tone');
        }
        assert.deepEqual(rows.map((r) => r.querySelector('.ws-tname').textContent), ['alpha', 'beta']);
        assert.deepEqual(rows.map(label), ['3 commits behind', 'Up to date']);
        click(ctx.window, rows[0].querySelector('button'));
        await waitFor(timers, () => ctx.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/projects/k1/sync')));
        await timers.settle();
        assert.equal(ctx.window.location.hash, '#workspaces', 'the workspace did not open');
        await waitFor(timers, () => item().querySelector('.ws-rollup-txt').textContent === 'All 2 up to date');
        assert.equal(item().querySelector('.ws-sync-all').hidden, true);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a diverged member opens the table by itself', run: async () => {
      const ctx = await boot({ chips: () => ({ projects: { k1: blk('dev', { state: 'diverged', ahead: 1, behind: 2 }), k2: blk('main') } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && !item().querySelector('.ws-table').hidden);
        assert.equal(item().querySelector('.ws-rollup-txt').textContent, '1 diverged · 1 up to date');
        assert.equal(tone(item().querySelector('.ws-rollup')), 'amber');
        assert.equal(item().querySelector('.ws-trow button').textContent, 'Details…');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('a workspace row\'s sync parts survive a team-metrics-changed repaint', async (t) => {
  const ctx = await boot();
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'workspaces');
    const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
    await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
    ctx.recv({ type: 'team-metrics-changed', action: 'fetched' });
    await timers.advance(50);
    assert.equal(item().querySelectorAll('.ws-strip-member').length, 2);
    assert.equal(item().querySelector('.ws-rollup-txt').textContent, '1 behind · 1 up to date');
  } finally {
    t.mock.timers.reset();
  }
});

// A status read never fetches, but it reports the server's standing fetch failure (git-sync's
// negative cache): the rows follow the server, with no browser-side memory or clock.
const OLD = '2020-01-01T00:00:00.000Z';
const offlineBlk = (base) => blk(base, { fetchedAt: OLD, stale: true, fetchError: { kind: 'network' } });
const offlineReads = () => ({ projects: { k1: offlineBlk('dev'), k2: offlineBlk('main') } });
const OFFLINE = 'Can’t reach origin';

test('a row Sync or Sync all that could not fetch keeps rows offline with Retry through repaints; a later successful fetch clears it', async (t) => {
  // Each row boots with its own reads and answers.
  await checkRows([
    { name: 'a row Sync that could not fetch stays offline through the following repaint, with Retry', run: async () => {
      let reads = () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 3 }), k2: blk('main') } });
      const ctx = await boot({ chips: () => reads(), post: () => ({ sync: offlineBlk('dev') }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        const slot = () => ctx.doc.querySelector('.proj-sync[data-key="k1"]');
        await waitFor(timers, () => settled(slot()));
        reads = offlineReads;
        click(ctx.window, slot().querySelector('button'));
        await waitFor(timers, () => label(slot()) === OFFLINE);
        const n = chipGets(ctx.calls);
        ctx.recv({ type: 'project-sync-changed', action: 'k1' });
        await waitFor(timers, () => chipGets(ctx.calls) === n + 1);
        await timers.advance(20);
        assert.equal(label(slot()), OFFLINE);
        assert.equal(slot().querySelector('button').textContent, 'Retry');
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'Sync all that could not fetch keeps the rows offline; a later successful fetch clears it', run: async () => {
      let reads = () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 2 }), k2: blk('main') } });
      const ctx = await boot({ chips: () => reads(), all: () => ({ projects: { k1: offlineBlk('dev'), k2: offlineBlk('main') } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'projects');
        const lab = (k) => label(ctx.doc.querySelector(`.proj-sync[data-key="${k}"]`));
        await waitFor(timers, () => lab('k1') === '2 commits behind');
        reads = offlineReads;
        click(ctx.window, ctx.doc.querySelector('#projects-sync-all'));
        await waitFor(timers, () => lab('k1') === OFFLINE && lab('k2') === OFFLINE);
        const n = chipGets(ctx.calls);
        ctx.recv({ type: 'project-sync-changed', action: 'k1' });
        await waitFor(timers, () => chipGets(ctx.calls) === n + 1);
        await timers.advance(20);
        assert.deepEqual([lab('k1'), lab('k2')], [OFFLINE, OFFLINE]);
        // The server says a good fetch happened since; an OLD fetchedAt (server clock behind the
        // browser's) must not keep it offline.
        reads = () => ({ projects: { k1: blk('dev', { fetchedAt: OLD }), k2: offlineBlk('main') } });
        ctx.recv({ type: 'project-sync-changed', action: 'k1' });
        await waitFor(timers, () => chipGets(ctx.calls) === n + 2);
        await timers.advance(20);
        assert.deepEqual([lab('k1'), lab('k2')], ['Up to date', OFFLINE]);
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('a background refresh that could not fetch turns the row offline with no Sync press, and stays so on reload', async (t) => {
  let reads = () => ({ projects: { k1: blk('dev'), k2: blk('main') } });
  const ctx = await boot({ chips: () => reads() });
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects');
    const lab = (doc, k) => label(doc.querySelector(`.proj-sync[data-key="${k}"]`));
    await waitFor(timers, () => lab(ctx.doc, 'k1') === 'Up to date');
    reads = () => ({ projects: { k1: offlineBlk('dev'), k2: blk('main') } });
    const n = chipGets(ctx.calls);
    ctx.recv({ type: 'project-sync-changed', action: 'k1' });   // the background tick's frame
    await waitFor(timers, () => chipGets(ctx.calls) === n + 1);
    await waitFor(timers, () => lab(ctx.doc, 'k1') === OFFLINE);
    assert.equal(lab(ctx.doc, 'k2'), 'Up to date');
    t.mock.timers.reset();                                        // boot on real timers
    const again = await boot({ chips: () => reads() });           // a reload: no client memory at all
    const timers2 = useAppTimers(t);
    await go(again.window, timers2, 'projects');
    await waitFor(timers2, () => lab(again.doc, 'k1') === OFFLINE);
  } finally {
    t.mock.timers.reset();
  }
});

test('Folder rows: a Folder chip, a No git box where the branch bar goes, a Folder N filter; Local only never counts them', async (t) => {
  const projects = [{ ...PROJECTS[0], vcs: 'git' }, { ...PROJECTS[1], vcs: 'git' }, { name: 'notes', path: '/Users/me/notes', displayPath: '~/notes', exists: true, key: 'k3', vcs: 'none' }];
  const ctx = await boot({ projects, chips: () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 3 }), k2: blk('main'), k3: { base: null, remote: null, state: 'unknown' } } }) });
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'projects');
    await waitFor(timers, () => settled(ctx.doc.querySelector('.proj-sync[data-key="k1"]')));
    const row = (k) => ctx.doc.querySelector(`.pl-item[data-key="${k}"]`);
    assert.equal(row('k1').querySelector('.pl-name .kind-chip').textContent, 'Git');
    assert.equal(row('k3').querySelector('.pl-name .kind-chip').textContent, 'Folder');
    assert.equal(row('k3').dataset.vcs, 'none');
    assert.equal(row('k3').querySelector('.proj-path').textContent, '~/notes', 'the S22 display path');
    assert.equal(row('k3').querySelector('.proj-path').title, '/Users/me/notes');
    assert.equal(row('k1').querySelector('.proj-path').textContent, '/p/alpha', 'no displayPath: the path as today');
    assert.equal(row('k3').querySelector('.proj-sync'), null, 'no branch / origin bar');
    assert.equal(row('k3').querySelector('.pl-sync .proj-nogit').textContent, 'No git');
    assert.ok(row('k3').querySelector('.pl-sync').hasAttribute('data-needs-git'), 'gated with the column (P0)');
    assert.match(readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8'),
      /#projects-list \.pl-sync:not\(:has\(> \.proj-sync:not\(\[hidden\]\), > \.proj-nogit\)\)\{display:none;\}/, 'the No git box keeps its column (jsdom has no cascade)');
    assert.deepEqual([...ctx.doc.querySelectorAll('.proj-filters .filter-chip')].map((c) => c.textContent), ['All 3', 'Behind 1', 'Up to date 1', 'Folder 1']);
    click(ctx.window, ctx.doc.querySelector('.filter-chip[data-filter="folder"]'));
    assert.deepEqual([...ctx.doc.querySelectorAll('#projects-list .pl-item')].filter((n) => !n.hidden).map((n) => n.dataset.key), ['k3']);
  } finally { t.mock.timers.reset(); }
});

// P5: a Folder member (annotated vcs 'none') has no branch: it never reads a sync status, and the
// rollup, Sync all and the auto-open count the Git members only.
const MIXED = [{ ...WORKSPACES[0], vcs: ['git', 'none'] }];

test('a workspace with a Folder member: the rollup counts Git members only, the Folder row has its chip and no sync controls', async (t) => {
  await checkRows([
    // The server can answer for a Folder project (a folder inside a repo answers for that repo): never shown.
    { name: 'the Folder member\'s answer is ignored: Git rows set the rollup, Sync all and the auto-open; the Folder row has a chip, no icon, no status', run: async () => {
      const ctx = await boot({ workspaces: MIXED, chips: () => ({ projects: { k1: blk('dev', { state: 'behind', behind: 3 }), k2: blk('main', { state: 'diverged', ahead: 1, behind: 2 }) } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
        assert.equal(item().querySelector('.ws-rollup-txt').textContent, '1 behind');
        assert.equal(tone(item().querySelector('.ws-rollup')), 'blue');
        assert.equal(item().querySelector('.ws-sync-all').textContent, 'Sync all (1)');
        assert.equal(item().querySelector('.ws-table').hidden, true, 'a Folder member never opens the table');
        const strip = [...item().querySelectorAll('.ws-strip-member')];
        assert.ok(strip[0].querySelector('.ws-icon'), 'a Git member keeps its sync icon');
        assert.equal(strip[0].querySelector('.kind-chip'), null, 'git on: a Git entry is unchanged');
        assert.equal(strip[1].querySelector('.ws-strip-name').textContent, 'beta');
        assert.equal(strip[1].querySelector('.kind-chip').textContent, 'Folder');
        assert.equal(strip[1].querySelector('.ws-icon'), null, 'no sync icon for a Folder member');
        assert.equal(tone(strip[1]), 'muted');
        click(ctx.window, item().querySelector('.ws-toggle'));
        const rows = [...item().querySelectorAll('.ws-trow')];
        assert.deepEqual(rows.map((r) => r.querySelector('.kind-chip').textContent), ['Git', 'Folder']);
        assert.equal(label(rows[0]), '3 commits behind');
        assert.equal(rows[1].querySelector('button'), null);
        assert.equal(rows[1].querySelector('.ws-tlabel'), null);
        assert.equal(rows[1].querySelector('.ws-tbranch'), null);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a Folder member that would be behind counts nowhere: the Git member alone is "All 1 up to date", no Sync all', run: async () => {
      const ctx = await boot({ workspaces: MIXED, chips: () => ({ projects: { k1: blk('dev'), k2: blk('main', { state: 'behind', behind: 2 }) } }) });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
        assert.equal(item().querySelector('.ws-rollup-txt').textContent, 'All 1 up to date');
        assert.equal(item().querySelector('.ws-sync-all').hidden, true);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a workspace of Folder members only: no rollup, no Sync all; the table lists both with their chips', run: async () => {
      const ctx = await boot({ workspaces: [{ ...WORKSPACES[0], vcs: ['none', 'none'] }] });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && chipGets(ctx.calls) === 1);
        await timers.advance(50);
        assert.equal(item().querySelector('.ws-rollup').hidden, true, 'no Git member: no rollup');
        assert.equal(item().querySelector('.ws-sync-all').hidden, true);
        assert.deepEqual([...item().querySelectorAll('.ws-strip-member .kind-chip')].map((c) => c.textContent), ['Folder', 'Folder']);
        click(ctx.window, item().querySelector('.ws-toggle'));
        assert.deepEqual([...item().querySelectorAll('.ws-trow')].map((r) => [r.querySelector('.ws-tname').firstChild.textContent, r.querySelector('.kind-chip').textContent]),
          [['alpha', 'Folder'], ['beta', 'Folder']]);
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('git off: the member strip stays (names + kind chips, no sync icons); only the sync parts are gated', async (t) => {
  const ctx = await boot({ workspaces: MIXED, git: 'off' });
  const timers = useAppTimers(t);
  try {
    await go(ctx.window, timers, 'workspaces');
    const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
    await waitFor(timers, () => item() && item().querySelectorAll('.ws-strip-member').length === 2);
    const strip = item().querySelector('.ws-strip-members');
    assert.equal(strip.hasAttribute('data-needs-git'), false, 'the strip is not a git surface');
    assert.equal(item().querySelector('.ws-strip-sep').hasAttribute('data-needs-git'), false);
    assert.deepEqual([...strip.querySelectorAll('.ws-strip-member')].map((m) => [m.querySelector('.ws-strip-name').textContent,
      m.querySelector('.kind-chip').textContent]), [['alpha', 'Git'], ['beta', 'Folder']]);
    assert.equal(strip.querySelector('.ws-icon'), null, 'no sync icon while git is off');
    for (const sel of ['.ws-rollup', '.ws-sync-all', '.ws-toggle', '.ws-table']) {
      assert.equal(item().querySelector(sel).hasAttribute('data-needs-git'), true, `${sel} stays gated`);
    }
    await timers.advance(400);   // past SYNC_CHIPS_MS (300): a read that was queued would have landed
    assert.equal(chipGets(ctx.calls), 0, 'no sync status read while git is off');
  } finally {
    t.mock.timers.reset();
  }
});

test('git going away while the list is open repaints the strip without sync icons; an old list without vcs paints as before', async (t) => {
  await checkRows([
    { name: 'a git frame (available: false) turns every strip entry into name + kind chip', run: async () => {
      const ctx = await boot({ workspaces: MIXED });
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
        assert.ok(item().querySelector('.ws-strip-member .ws-icon'));
        ctx.recv({ type: 'git', git: { available: false } });
        await timers.advance(10);
        assert.equal(item().querySelector('.ws-strip-members .ws-icon'), null, 'no stale sync icon once git is off');
        assert.deepEqual([...item().querySelectorAll('.ws-strip-member .kind-chip')].map((c) => c.textContent), ['Git', 'Folder']);
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'no vcs on the list (an older server): no kind chips anywhere, both members sync', run: async () => {
      const ctx = await boot();
      const timers = useAppTimers(t);
      try {
        await go(ctx.window, timers, 'workspaces');
        const item = () => ctx.doc.querySelector('.ws-item[data-workspace-id="wks-alpha-00000001"]');
        await waitFor(timers, () => item() && item().querySelector('.ws-rollup-txt').textContent !== 'Checking…');
        click(ctx.window, item().querySelector('.ws-toggle'));
        assert.equal(item().querySelector('.kind-chip'), null);
        assert.equal(item().querySelectorAll('.ws-strip-member .ws-icon').length, 2);
        assert.deepEqual([...item().querySelectorAll('.ws-trow')].map((r) => r.querySelector('.ws-tname').textContent), ['alpha', 'beta']);
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});
