// test/ui-history-team-runs.test.mjs — teammates' runs in the Runs list (run sharing s2): the pure module
// (ui/public/history-team-runs.mjs), the team row kind in runs-list.mjs, the View record's scope, and the real app
// booted under jsdom with GET /api/history and GET /api/team-runs arms.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { teamRunItems, teamRunTitle, renderTeamRunSummary } from '../ui/public/history-team-runs.mjs';
import { buildRunsModel, renderRunsList, teamRow, TEAM_EMPTY, RUNS_SCOPE } from '../ui/public/runs-list.mjs';
import { loadRunsView, saveRunsView, viewChip, VIEW_KEY } from '../ui/public/runs-view-menu.mjs';

const trackDom = useDomRelease(afterEach);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';
const KEY = 'proj-0000abcd';
const MARKUP = '<img src=x onerror="window.__xss=1">';

const wire = (over = {}) => ({
  local: false, projectKey: KEY, projectName: 'Proj', runId: 'c0ffee01', personKey: 'aaaaaaaaaaaaaaaa',
  startedBy: 'Ana Mate', workflowId: 'wf_default', status: 'done', phase: 'done', stage: null, progress: null,
  costUsd: 1.23, prUrl: 'https://github.com/o/r/pull/7', startedAt: '2026-11-07T09:00:00.000Z',
  updatedAt: '2026-11-07T09:30:00.000Z', finishedAt: '2026-11-07T09:30:00.000Z', stale: false, ...over,
});
const hist = (over = {}) => ({ id: 'deadbeef', projectKey: KEY, projectName: 'Proj', projectDir: '/x/proj', title: 'My own run',
  status: 'done', startedAt: '2026-11-07T08:00:00.000Z', mtime: '2026-11-07T08:10:00.000Z', ...over });
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const rowsOf = (model) => model.sections.flatMap((s) => s.rows);
const NOW = Date.parse('2026-11-07T10:00:00.000Z');

// ---- module rows ----------------------------------------------------------------

test('teamRunItems drops local ids and nulls an http PR link', () => {
  const items = teamRunItems({ rows: [wire(), wire({ runId: 'c0ffee02', prUrl: 'http://evil.example/x' }), wire({ runId: 'c0ffee03' }),
    { ...wire({ runId: 'c0ffee04' }), local: true }] }, { localIds: new Set(['c0ffee03']) });
  assert.deepEqual(items.map((i) => i.runId), ['c0ffee01', 'c0ffee02']);
  assert.equal(items[0].prUrl, 'https://github.com/o/r/pull/7');
  assert.equal(items[1].prUrl, null);
  assert.deepEqual(teamRunItems(null), []);
  assert.equal(teamRunTitle({ workflowId: null }), 'Run');
  assert.equal(teamRunTitle(wire()), 'wf_default');
});

test('buildRunsModel scope team lists only team rows; mine lists none', () => {
  const input = { history: [hist()], team: [wire(), wire({ runId: 'c0ffee02' })], now: NOW };
  const kinds = (scope) => rowsOf(buildRunsModel({ ...input, scope })).map((r) => r.kind).sort();
  assert.deepEqual(kinds('all'), ['hist', 'team', 'team']);
  assert.deepEqual(kinds('team'), ['team', 'team']);
  assert.deepEqual(kinds('mine'), ['hist']);
  assert.deepEqual(kinds('bogus'), ['hist', 'team', 'team']);
  assert.deepEqual([...RUNS_SCOPE], ['all', 'mine', 'team']);
  const t = rowsOf(buildRunsModel({ ...input, scope: 'team' }))[0];
  assert.deepEqual(t.model.actions, []);
  assert.equal(t.needs, false);
  assert.equal(t.key, `team:${KEY}/aaaaaaaaaaaaaaaa/c0ffee01`);
  assert.equal(t.href, '#runs');
});

test('a team row whose run is listed here is dropped (D16)', () => {
  const rows = rowsOf(buildRunsModel({ history: [hist({ id: 'c0ffee01' })], team: [wire()], now: NOW }));
  assert.deepEqual(rows.map((r) => r.kind), ['hist']);
});

const renderTeam = (t, model = buildRunsModel({ team: [t], now: NOW })) => {
  const d = doc();
  const host = d.createElement('div');
  host.append(...renderRunsList(d, model, {}));
  return host;
};

test('a team row renders a badge and no checkbox or more button', () => {
  const host = renderTeam(wire());
  const item = host.querySelector('.runs-item');
  assert.equal(item.dataset.team, '1');
  assert.equal(item.querySelector('.runs-team-badge').textContent, 'Ana Mate');
  assert.equal(host.querySelectorAll('.runs-check').length, 0);
  assert.equal(host.querySelectorAll('.runs-more').length, 0);
  assert.equal(item.querySelector('.runs-pick .status-dot') !== null, true);
  const pr = item.querySelector(':scope > .runs-row-tail a.runs-pr');
  assert.equal(pr.getAttribute('href'), 'https://github.com/o/r/pull/7');
  assert.equal(pr.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(item.querySelector('a.runs-row a'), null, 'no link inside the row link');
});

test('a team row without startedBy shows Teammate', () => {
  const host = renderTeam(wire({ startedBy: null }));
  assert.equal(host.querySelector('.runs-team-badge').textContent, 'Teammate');
  assert.equal(teamRow(wire({ startedBy: null }), NOW).teamBy, 'Teammate');
});

test('record markup is shown as text', () => {
  const t = wire({ startedBy: MARKUP, workflowId: MARKUP, phase: MARKUP });
  const host = renderTeam(t);
  assert.equal(host.querySelectorAll('img').length, 0);
  assert.equal(host.querySelector('.runs-team-badge').textContent, MARKUP);
  const sum = renderTeamRunSummary(doc(), t);
  assert.equal(sum.querySelectorAll('img').length, 0);
  assert.ok(sum.textContent.includes(MARKUP));
});

test('loadRunsView keeps scope and rejects an unknown value', () => {
  const s = mem();
  saveRunsView(s, { show: 'all', groupBy: 'none', person: '', labels: [], scope: 'team' });
  assert.equal(loadRunsView(s).scope, 'team');
  assert.equal(loadRunsView(mem({ [VIEW_KEY]: JSON.stringify({ scope: 'everyone' }) })).scope, 'all');
  assert.equal(loadRunsView(mem()).scope, 'all');
});

test('viewChip names Team', () => {
  const v = { show: 'all', groupBy: 'none', person: '', labels: [], scope: 'team' };
  assert.equal(viewChip(v, { shown: 3, total: 9 }), 'Team · 3 of 9 runs');
  assert.equal(viewChip({ ...v, scope: 'mine' }, { shown: 6, total: 9 }), 'Mine · 6 of 9 runs');
  assert.equal(viewChip({ ...v, scope: 'all' }, { shown: 9, total: 9 }), '');
});

test('renderTeamRunSummary shows status, phase, cost, PR link and no buttons', () => {
  const sum = renderTeamRunSummary(doc(), wire({ stale: true }));
  const dts = [...sum.querySelectorAll('dt')].map((n) => n.textContent);
  assert.deepEqual(dts, ['Status', 'Phase', 'Cost', 'Started by', 'Project', 'Started', 'Updated', 'Pull request']);
  const dd = (label) => sum.querySelectorAll('dd')[dts.indexOf(label)].textContent;
  assert.equal(dd('Cost'), '$1.23');
  assert.equal(dd('Phase'), 'done');
  assert.equal(dd('Started by'), 'Ana Mate');
  assert.ok(dd('Status'));
  const links = sum.querySelectorAll('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), 'https://github.com/o/r/pull/7');
  assert.equal(links[0].textContent, 'github.com/o/r/pull/7');
  assert.match(links[0].getAttribute('rel'), /noopener/);
  assert.equal(sum.querySelectorAll('button, input').length, 0);
  assert.equal(sum.querySelector('.team-run-stale').textContent, 'No update for over 20 minutes');
  const plain = renderTeamRunSummary(doc(), wire({ prUrl: 'http://x.example/p', stale: false }));
  assert.equal(plain.querySelectorAll('a').length, 0);
  assert.equal(plain.querySelector('.team-run-stale'), null);
});

test('Team scope with no team rows shows the empty note', () => {
  const d = doc();
  const out = renderRunsList(d, buildRunsModel({ history: [hist()], scope: 'team', now: NOW }), { emptyText: TEAM_EMPTY });
  assert.ok(out.some((n) => n.textContent === "No teammates' runs yet."));
});

// ---- the real app -----------------------------------------------------------------

async function boot({ flags = 'runSharing', team = () => ({ rows: [wire()], projects: [] }), history = [hist()], view = null } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.document.documentElement.dataset.flags = flags;
  if (view) window.localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {}
    close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  };
  const calls = [];
  const writes = [];
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (opts && opts.method && opts.method !== 'GET') writes.push(`${opts.method} ${u}`);
    if (u.endsWith('/api/team-runs')) return ok(team());
    if (u.endsWith('/api/history')) return ok({ pipelines: history, live: [] });
    if (u.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const showRuns = () => { window.location.hash = 'runs'; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, doc: window.document, calls, writes, showRuns, settle };
}
const items = (d) => [...d.querySelectorAll('#runs-list .runs-item[data-level="top"]')];
const teamItems = (d) => items(d).filter((n) => n.querySelector('.runs-team-badge'));
const click = (w, n, init = {}) => n.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));

test('in the real app: History shows the Mine / Team / All filter', async () => {
  const ctx = await boot();
  ctx.showRuns();
  await ctx.settle();
  const box = ctx.doc.getElementById('runs-scope');
  assert.equal(box.hidden, false);
  const btns = [...box.querySelectorAll('button')];
  assert.deepEqual(btns.map((b) => b.textContent), ['Mine', 'Team', 'All']);
  assert.equal(btns.find((b) => b.textContent === 'All').getAttribute('aria-pressed'), 'true');
  assert.equal(teamItems(ctx.doc).length, 1);
});

test('in the real app: Team lists only badged rows; Mine lists none of them', async () => {
  const ctx = await boot();
  ctx.showRuns();
  await ctx.settle();
  click(ctx.window, ctx.doc.querySelector('[data-runs-scope="team"]'));
  await ctx.settle();
  assert.ok(items(ctx.doc).length >= 1);
  assert.ok(items(ctx.doc).every((n) => n.querySelector('.runs-team-badge')));
  assert.equal(ctx.doc.querySelector('[data-runs-scope="team"]').getAttribute('aria-pressed'), 'true');
  assert.match(ctx.doc.querySelector('#runs-view-chip .runs-view-chip-t').textContent, /^Team · /);
  click(ctx.window, ctx.doc.querySelector('[data-runs-scope="mine"]'));
  await ctx.settle();
  assert.equal(ctx.doc.querySelectorAll('#runs-list .runs-team-badge').length, 0);
  assert.ok(items(ctx.doc).length >= 1, 'my own rows are listed');
  click(ctx.window, ctx.doc.querySelector('[data-runs-scope="all"]'));
  await ctx.settle();
});

test('in the real app: a teammate row offers no stop, resume, delete or rerun control', async () => {
  const ctx = await boot();
  ctx.showRuns();
  await ctx.settle();
  const [item] = teamItems(ctx.doc);
  assert.equal(item.querySelectorAll('.runs-more, .runs-check').length, 0);
  const row = item.querySelector(':scope > a.runs-row');
  click(ctx.window, row);
  await ctx.settle();
  const modal = ctx.doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(modal.querySelectorAll('button').length, 1);
  assert.equal(modal.querySelector('button').textContent, 'Close');
  const links = [...modal.querySelectorAll('a')];
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['https://github.com/o/r/pull/7']);
  assert.equal(ctx.window.location.hash, '#runs');
  modal.querySelector('button').click();
  assert.equal(modal.classList.contains('hidden'), true);
  // Keyboard: Enter on the focused team row opens the same dialog.
  row.focus();
  row.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await ctx.settle();
  assert.equal(modal.classList.contains('hidden'), false);
  modal.querySelector('button').click();
  // Select all, ⌘A and ⌘-click never select a team row.
  const selected = () => [...ctx.doc.querySelectorAll('#runs-list .runs-item.is-checked')];
  const all = ctx.doc.getElementById('runs-all');
  all.checked = true;
  all.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.settle();
  assert.ok(selected().length >= 1, 'my own row is selected');
  assert.equal(selected().filter((n) => n.dataset.team === '1').length, 0);
  all.checked = false;
  all.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.settle();
  const teamRowNow = teamItems(ctx.doc)[0].querySelector(':scope > a.runs-row');
  teamRowNow.focus();
  teamRowNow.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'a', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
  await ctx.settle();
  assert.equal(selected().filter((n) => n.dataset.team === '1').length, 0);
  assert.ok(selected().length >= 1, '⌘A selects my own rows');
  ctx.doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await ctx.settle();
  click(ctx.window, teamItems(ctx.doc)[0].querySelector(':scope > a.runs-row'), { metaKey: true, ctrlKey: true });
  await ctx.settle();
  assert.equal(selected().filter((n) => n.dataset.team === '1').length, 0);
  assert.equal(ctx.doc.getElementById('plugin-modal').classList.contains('hidden'), true, '⌘-click opens nothing');
  // The row letter keys (archive, stop, delete, group, menu) do nothing on a teammate's row.
  ctx.doc.documentElement.dataset.level = 'expert';
  const BOOT_POSTS = /\/api\/(ask\/mcp-preview|history\/pr)$/;   // the app's own background reads
  const acts = () => ctx.writes.filter((w) => !BOOT_POSTS.test(w));
  for (const key of ['e', 's', 'Delete', 'g', '.', ' ']) {
    const link = teamItems(ctx.doc)[0].querySelector(':scope > a.runs-row');
    link.focus();
    link.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await ctx.settle();
    assert.deepEqual(acts(), [], key);
    assert.equal(ctx.doc.getElementById('confirm-modal').classList.contains('hidden'), true, key);
    assert.equal(ctx.doc.querySelector('.wfv-menu:not([hidden])'), null, key);
    assert.equal(selected().filter((n) => n.dataset.team === '1').length, 0, key);
  }
  // Shift+Arrow starts no range from a teammate's row (it would select a local row and anchor on the team key).
  for (const key of ['ArrowDown', 'ArrowUp']) {
    const link = teamItems(ctx.doc)[0].querySelector(':scope > a.runs-row');
    link.focus();
    link.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true }));
    await ctx.settle();
    assert.equal(selected().length, 0, `shift+${key}`);
  }
});

test('in the real app: a teammate row with a local id is not listed twice', async () => {
  const ctx = await boot({ team: () => ({ rows: [wire({ runId: 'deadbeef' })], projects: [] }) });
  ctx.showRuns();
  await ctx.settle();
  assert.equal(teamItems(ctx.doc).length, 0);
  assert.equal(items(ctx.doc).length, 1);
});

test('in the real app: Team with no teammate rows shows the empty note and keeps the filter', async () => {
  const ctx = await boot({ team: () => ({ rows: [], projects: [] }), view: { show: 'all', groupBy: 'none', person: '', labels: [], scope: 'team' } });
  ctx.showRuns();
  await ctx.settle();
  assert.equal(ctx.doc.getElementById('runs-scope').hidden, false, 'a picked scope keeps the way back to All');
  assert.ok([...ctx.doc.querySelectorAll('#runs-list .runs-note')].some((n) => n.textContent === "No teammates' runs yet."));
  assert.equal(items(ctx.doc).length, 0);
});

test('in the real app: flag off: no /api/team-runs request and the filter stays hidden', async () => {
  const ctx = await boot({ flags: '' });
  ctx.showRuns();
  await ctx.settle();
  assert.equal(ctx.calls.filter((u) => u.includes('/api/team-runs')).length, 0);
  assert.equal(ctx.doc.getElementById('runs-scope').hidden, true);
  assert.equal(teamItems(ctx.doc).length, 0);
});

test('in the real app: the badge repaints when startedBy changes', async (t) => {
  let by = 'Ana Mate';
  const ctx = await boot({ team: () => ({ rows: [wire({ startedBy: by })], projects: [] }) });
  const timers = useAppTimers(t);
  try {
    ctx.showRuns();
    await timers.settle(10);
    assert.equal(ctx.doc.querySelector('#runs-list .runs-team-badge').textContent, 'Ana Mate');
    const before = ctx.calls.filter((u) => u.endsWith('/api/team-runs')).length;
    by = 'Bo Mate';
    await timers.advance(60_000);
    await timers.settle(10);
    assert.equal(ctx.calls.filter((u) => u.endsWith('/api/team-runs')).length, before + 1);
    assert.equal(ctx.doc.querySelector('#runs-list .runs-team-badge').textContent, 'Bo Mate');
    // Leaving Runs stops the timer.
    ctx.window.location.hash = 'chat';
    ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
    await timers.settle(10);
    await timers.advance(120_000);
    assert.equal(ctx.calls.filter((u) => u.endsWith('/api/team-runs')).length, before + 1);
  } finally { t.mock.timers.reset(); }
});
