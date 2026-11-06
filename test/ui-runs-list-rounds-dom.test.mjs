// test/ui-runs-list-rounds-dom.test.mjs — a run's PR fix rounds drawn as one stack (plans/pr-fix-rounds-stacking-plan.md
// Task 5, D6/D7/D9): the stack line with its ▸ k rounds toggle, the open list (5, then "+n earlier"), each round a link
// to its own page, the same stack inside a group's members. The last test boots app.js: the toggle and "+n earlier"
// repaint the list, focus returns to the toggle, and the badge counts the stack once.
// boot() follows test/ui-runs-view.test.mjs (no shared harness, by convention). jsdom: the app needs a DOM.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRunsModel, renderRunsList, roundLine } from '../ui/public/runs-list.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const trackDom = useDomRelease(afterEach);
const NOW = new Date(2026, 8, 30, 15, 0).getTime();           // Wed Sep 30 2026, 15:00 local
const at = (d, h, m) => new Date(2026, 8, d, h, m).toISOString();
const PR947 = { url: 'https://github.com/SinishaDjukic/worca-cc/pull/947', number: 947, state: 'OPEN', mergeable: 'CONFLICTING' };
const marker = (n, extra = {}) => ({ pipelineId: 'ba22d7fd', round: n, request: 'merge dev in', by: 'watch', kinds: ['conflicts'],
  outcome: { kind: 'pushed', sha: `${n}e4f5a6` }, ...extra });
const hist = (id, extra = {}) => ({ id, projectKey: 'worca-00000002', title: id, status: 'done', pauseReason: null, startedAt: at(20, 9, 0),
  mtime: Date.parse(at(20, 9, 0)), groupName: 'worca-cc', by: '', pr: null, checks: null, files: null, ...extra });
const roundIt = (n) => hist(`rnd${n}`, { title: 'Merge dev into PR 947', mtime: Date.parse(at(20 + n, 10, 0)), roundOf: marker(n),
  run: { status: 'done', pr: PR947, round: marker(n) } });
const ORIGIN = hist('ba22d7fd', { title: 'Route swallowed step failures', run: { status: 'done', pr: PR947 } });
const ROUNDS = [2, 3, 4, 5, 6, 7, 8].map(roundIt);

function render(model, opts = {}) {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  const host = document.createElement('div');
  host.append(...renderRunsList(document, model, opts));
  return host;
}

test('roundLine (D7): the request and the outcome, else the status; a live round names no time', () => {
  assert.equal(roundLine({ n: 8, request: 'merge dev in', outcome: { kind: 'pushed', sha: '3e4f5a6' }, status: 'done', activityMs: Date.parse(at(24, 9, 0)) }, NOW),
    'Round 8 · merge dev in · pushed 3e4f5a6 · Thu');
  assert.equal(roundLine({ n: 3, request: 'merge dev in', outcome: { kind: 'failed', reason: 'conflict-markers' }, status: 'done' }, NOW),
    'Round 3 · merge dev in · nothing pushed: conflicts remain');
  assert.equal(roundLine({ n: 4, request: 'x', outcome: { kind: 'failed', reason: 'odd-thing' }, status: 'done' }, NOW), 'Round 4 · x · nothing pushed: odd-thing');
  assert.equal(roundLine({ n: 5, request: 'x', outcome: { kind: 'ended', reason: 'merged' }, status: 'done' }, NOW), 'Round 5 · x · PR merged');
  assert.equal(roundLine({ n: 6, request: 'tighten the copy', status: 'error' }, NOW), 'Round 6 · tighten the copy · failed');
  assert.equal(roundLine({ n: 9, request: 'merge dev in', status: 'running', activityMs: NOW }, NOW), 'Round 9 · merge dev in · running');
});

test('a stack draws its line and a closed toggle; open shows the newest 5 and "+2 earlier"; all shows 7', () => {
  const model = buildRunsModel({ history: [ORIGIN, ...ROUNDS], now: NOW });
  const closed = render(model);
  const item = closed.querySelector('.runs-item[data-row-key="hist:worca-00000002/ba22d7fd"]');
  assert.equal(closed.querySelectorAll('.runs-item[data-level="top"]').length, 1, 'one row for the run and its 7 rounds');
  assert.equal(item.querySelector(':scope > a.runs-row .runs-row-sub'), null, 'the stack line stands for the sub-line (D6)');
  assert.match(item.querySelector(':scope > .runs-rounds-line .runs-rounds-text').textContent, /^Round 8 · merge dev in · pushed 8e4f5a6 · /);
  const tog = item.querySelector(':scope > .runs-rounds-line > button.runs-rounds-toggle');
  assert.deepEqual([tog.textContent, tog.getAttribute('aria-expanded'), tog.dataset.roundsKey], ['7 rounds', 'false', 'rounds:ba22d7fd']);
  // The chevron is an icon, never a text glyph (ui-design-language, spec §1.3): right while closed, down while open.
  assert.equal(tog.querySelector(':scope > .ic[aria-hidden="true"] path').getAttribute('d'), 'M9.5 6l6 6-6 6');
  assert.equal(item.querySelector('.runs-rounds'), null, 'closed by default (D9)');
  assert.equal(item.querySelector(':scope > a.runs-row').dataset.roundKeys.split(' ').includes('p:rnd5'), true, 'the selection reads its rounds');

  const open = render(model, { roundsOpen: new Set(['rounds:ba22d7fd']) });
  const t2 = open.querySelector('.runs-rounds-toggle');
  assert.deepEqual([t2.textContent, t2.getAttribute('aria-expanded')], ['7 rounds', 'true']);
  assert.equal(t2.querySelector(':scope > .ic path').getAttribute('d'), 'M6 9.5l6 6 6-6');
  const list = open.querySelector('.runs-item > .runs-rounds[role="list"]');
  const links = [...list.querySelectorAll('a.runs-round')];
  assert.deepEqual(links.map((a) => a.querySelector('.runs-round-n').textContent), ['R8', 'R7', 'R6', 'R5', 'R4']);
  assert.equal(links[0].getAttribute('href'), '#history/worca-00000002/rnd8', 'a round line opens that round\'s page');
  assert.equal(links[0].querySelector('.runs-round-words').textContent, 'merge dev in · pushed 8e4f5a6');
  assert.equal(links[0].querySelector('.runs-round-time').textContent, 'Mon');
  const more = list.querySelector('button.runs-rounds-more');
  assert.deepEqual([more.textContent, more.dataset.roundsKey], ['+2 earlier', 'rounds:ba22d7fd']);

  const all = render(model, { roundsOpen: new Set(['rounds:ba22d7fd']), roundsAll: new Set(['rounds:ba22d7fd']) });
  assert.equal(all.querySelectorAll('a.runs-round').length, 7);
  assert.equal(all.querySelector('.runs-rounds-more'), null);
});

test('inside a group the member carries the stack, within .runs-members; a live round says Running and Fixing', () => {
  const group = { id: 'feat_flag', groupKind: 'feature', title: 'Flag runs', members: [
    { position: 1, title: 'One', pipelineId: 'm1', kind: 'hist', run: { status: 'done' } },
    { position: 3, title: 'Route swallowed step failures', pipelineId: 'ba22d7fd', kind: 'hist', run: { status: 'done', pr: PR947 } }] };
  const model = buildRunsModel({ history: [hist('m1', { run: { status: 'done' } }), ORIGIN, ...ROUNDS], groups: [group],
    toggled: new Map([['chain:feat_flag', true]]), now: NOW });
  const host = render(model, { roundsOpen: new Set(['rounds:ba22d7fd']) });
  const member = host.querySelector('.runs-members > .runs-item[data-row-key="member:feat_flag/ba22d7fd"]');
  assert.ok(member.querySelector(':scope > .runs-rounds-line > .runs-rounds-toggle'), 'the member draws the toggle');
  assert.equal(member.querySelectorAll(':scope > .runs-rounds > a.runs-round').length, 5);
  assert.equal(host.querySelectorAll('.runs-item[data-level="top"]').length, 1, 'no round lists as its own row');

  const run9 = { status: 'running', steps: [{ nodeId: 'n', status: 'start' }], active: [{ nodeId: 'n' }], branch: { roundOf: marker(9, { outcome: undefined }) } };
  const live = [{ runId: 'run9', pipelineId: 'rnd9', title: 'Merge dev into PR 947', status: 'running', ask: null, unread: false, startedAt: at(30, 14, 0),
    roundOf: marker(9, { outcome: undefined }), run: run9 }];
  const lm = buildRunsModel({ live, history: [hist('m1', { run: { status: 'done' } }), ORIGIN, ...ROUNDS], groups: [group],
    toggled: new Map([['chain:feat_flag', true]]), now: NOW });
  const lh = render(lm, { roundsOpen: new Set(['rounds:ba22d7fd']) });
  assert.equal(lh.querySelector('.runs-sec').dataset.section, 'running');
  const lmem = lh.querySelector('.runs-item[data-row-key="member:feat_flag/ba22d7fd"]');
  assert.equal(lmem.querySelector(':scope > .runs-rounds-line .runs-rounds-text').textContent, 'Running · Round 9 · merge dev in');
  assert.equal(lmem.querySelector(':scope > .runs-rounds-line .runs-rounds-toggle').textContent, '8 rounds');
  assert.equal(lmem.querySelector(':scope > a.runs-row .runs-pr-word').textContent, 'Fixing');
  const first = lmem.querySelector('.runs-rounds a.runs-round');
  assert.deepEqual([first.getAttribute('href'), first.classList.contains('is-live')], ['#running/run9', true], 'a live round opens its run page');
});

test('a run that needs you for its own reason keeps its line; the round line comes second (D6)', () => {
  const paused = hist('ba22d7fd', { title: 'Route', status: 'paused', run: { status: 'paused' } });
  const host = render(buildRunsModel({ history: [paused, roundIt(2)], now: NOW }));
  const item = host.querySelector('.runs-item[data-level="top"]');
  assert.ok(item.querySelector(':scope > a.runs-row .runs-row-sub'), 'its own line');
  assert.match(item.querySelector(':scope > .runs-rounds-line .runs-rounds-text').textContent, /^Round 2 · /);
});

test('style.css: the stack is tokens only — indented under the title behind a 1px rule, accent toggle, 12px round links', () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (sel) => { const m = new RegExp(`(?:^|[\\s,}])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css); return m ? m[1] : ''; };
  assert.match(body('.runs-rounds'), /grid-column:2 \/ -1/);
  assert.match(body('.runs-rounds'), /border-left:1px solid var\(--line\)/);
  assert.match(body('.runs-round'), /font-size:var\(--fs-meta\)/);
  assert.match(body('.runs-round'), /color:var\(--ink-2\)/);
  assert.match(body('.runs-round:hover'), /color:var\(--ink\)/);
  assert.match(body('.runs-rounds-toggle,.runs-rounds-more'), /color:var\(--blue-ink\)/);
  const rules = css.match(/[^{}]*\.runs-round[^{}]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 5);
  for (const r of rules) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, `tokens only: ${r}`);
});

// ── app.js: the toggle, "+n earlier", focus, the badge ──
async function settle(window, n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

async function boot({ history, archived = [] }) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = [];
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u) => {
    const s = String(u);
    calls.push(s);
    if (s.endsWith('/api/run-groups')) return ok({ groups: [] });
    if (s.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: '/tmp/proj', exists: true }] });
    if (s.includes('/api/history?archived=1')) return ok({ pipelines: archived, ghAvailable: true });
    if (s.endsWith('/api/history')) return ok({ pipelines: history, ghAvailable: true });
    if (s.includes('/api/workspaces')) return ok({ workspaces: [] });
    if (s.endsWith('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, chains: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public', 'app.js')).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(window);
  lastWs._l.open?.forEach((fn) => fn());
  return { window, doc: window.document, calls };
}

const KEY = 'proj-0000abcd';
const wire = (id, extra = {}) => ({ id, projectKey: KEY, projectName: 'proj', projectDir: '/tmp/proj', title: id, status: 'done',
  startedAt: '2026-09-20T09:00:00Z', mtime: Date.parse('2026-09-20T09:00:00Z'), pr: PR947, ...extra });
const WIRE_ROUNDS = [2, 3, 4, 5, 6, 7, 8].map((n) => wire(`rnd${n}`, { title: 'Merge dev into PR 947 and resolve conflicts',
  mtime: Date.parse(`2026-09-2${n}T10:00:00Z`), roundOf: marker(n) }));

test('app: the stack toggles open and shut, "+2 earlier" shows all 7, focus stays on the toggle, the badge says 1', async () => {
  const { window, doc } = await boot({ history: [wire('ba22d7fd', { title: 'Route swallowed step failures' }), ...WIRE_ROUNDS] });
  go(window, 'runs'); await settle(window, 8);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-item[data-level="top"]').length, 1, 'one row for the run and its rounds');
  assert.equal(host.querySelector('.runs-sec').dataset.section, 'needs');
  assert.equal(doc.querySelector('#nav-needs-count .nav-count-n').textContent, '1', 'the badge counts the PR once');
  const tog = () => host.querySelector('.runs-rounds-toggle');
  assert.equal(tog().getAttribute('aria-expanded'), 'false');
  tog().focus();
  click(window, tog()); await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'true');
  assert.equal(host.querySelectorAll('a.runs-round').length, 5);
  assert.equal(doc.activeElement, tog(), 'focus returns to the rebuilt toggle');
  const more = host.querySelector('.runs-rounds-more');
  more.focus();
  click(window, more); await settle(window);
  assert.equal(host.querySelectorAll('a.runs-round').length, 7);
  assert.equal(doc.activeElement, tog(), '"+n earlier" is gone: focus lands on its toggle');
  click(window, tog()); await settle(window);
  assert.equal(host.querySelector('.runs-rounds'), null, 'shut again');
  click(window, tog()); await settle(window);
  assert.equal(host.querySelectorAll('a.runs-round').length, 5, 'reopened, it shows the newest 5 again');
});

test('app: a letter key on a focused round link does nothing — E never archives the stack\'s head; on the row it does', async () => {
  const { window, doc, calls } = await boot({ history: [wire('ba22d7fd', { title: 'Route swallowed step failures' }), ...WIRE_ROUNDS] });
  go(window, 'runs'); await settle(window, 8);
  const host = doc.getElementById('runs-list');
  click(window, host.querySelector('.runs-rounds-toggle')); await settle(window);
  const press = (node, key) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const bulk = () => calls.filter((u) => u.includes('/api/runs/bulk')).length;
  const round = host.querySelector('a.runs-round');
  round.focus();
  for (const k of ['e', 's', '.', 'g']) assert.equal(press(round, k), true, `${k}: not handled on a round link`);
  press(host.querySelector('.runs-rounds-toggle'), 'e');
  await settle(window, 8);
  assert.equal(bulk(), 0, 'no archive request for the head');
  assert.equal(doc.querySelector('.wfv-menu'), null, 'no ⋯ menu opened');
  // The control: the same key on the row itself archives it.
  press(host.querySelector('a.runs-row'), 'e');
  await settle(window, 8);
  assert.equal(bulk(), 1);
});

test('app (D4): rounds of an archived run stay out of the active list once the archived feed tells', async () => {
  const { window, doc, calls } = await boot({ history: WIRE_ROUNDS, archived: [wire('ba22d7fd', { archived: true, archivedAt: '2026-09-29T10:00:00Z' })] });
  go(window, 'runs'); await settle(window, 12);
  assert.ok(calls.some((u) => u.includes('/api/history?archived=1')), 'an orphan stack loads the archived feed once');
  assert.equal(doc.querySelectorAll('#runs-list .runs-item[data-level="top"]').length, 0);
});
