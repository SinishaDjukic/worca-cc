// test/ui-run-tabs-more.test.mjs — the run pages' tab row: the reading tabs stay in the row, the rest go under "More"
// (initDetailTabs opts.overflow), across both pages, the interface levels, git and the kinds of run; and the plain
// header's CSS. The engine itself is covered by test/ui-detail-tabs.test.mjs. These boot the real app.js: the matrix
// is which tabs each page's own table, level, git and repaint paths leave in the row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { bootDetail, openDetail, ROW, KEY, RESULTS, TABS_DETAIL, ok, click } from './helpers/history-detail-boot.mjs';
import { checkRows } from './helpers/rows.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';
import { applyGit } from '../ui/public/git-gate.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';

const RANK = { simple: 0, advanced: 1, expert: 2 };

/** One run screen's tab row, read the way the CSS draws it (jsdom applies no stylesheet). */
function page(window, prefix) {
  const doc = window.document;
  const host = prefix === 'rd' ? '#run-detail' : '#hist-detail';
  const bar = () => doc.querySelector(`${host} .${prefix}-tabs`);
  const btn = (k) => bar().querySelector(`.${prefix}-tab[data-sec="${k}"]`);
  const gated = (b) => RANK[b.dataset.minLevel || 'simple'] > RANK[doc.documentElement.dataset.level || 'expert']
    || (doc.documentElement.dataset.git === 'off' && 'needsGit' in b.dataset);
  const row = () => [...bar().querySelectorAll('[role="tab"]')]
    .filter((b) => !b.hidden && !gated(b) && (!b.hasAttribute('data-overflow') || b.classList.contains('active')))
    .map((b) => b.dataset.sec);
  const more = () => bar().querySelector('.tab-more');
  const menuEl = () => doc.querySelector('body > .wfv-menu');
  const read = () => [...menuEl().querySelectorAll('.menu-item')].map((i) => {
    const hint = i.querySelector('.wfv-menu-hint');
    return `${i.getAttribute('aria-checked') === 'true' ? '✓ ' : ''}${i.querySelector('.wfv-menu-l').textContent}${hint ? ` ${hint.textContent}` : ''}`;
  });
  /** The menu's rows (open, read, close); null without More. */
  const menu = () => {
    if (!more()) return null;
    click(window, more());
    const rows = read();
    click(window, more());
    assert.equal(menuEl(), null);
    return rows;
  };
  const item = (label) => [...menuEl().querySelectorAll('.menu-item')].find((i) => i.querySelector('.wfv-menu-l').textContent === label);
  const pick = (label) => { click(window, more()); click(window, item(label)); };
  const active = () => {
    const on = [...bar().querySelectorAll('[role="tab"][aria-selected="true"]')];
    assert.equal(on.length, 1, 'exactly one selected tab');
    assert.ok(row().includes(on[0].dataset.sec), `the selected tab ${on[0].dataset.sec} is rendered`);
    return on[0].dataset.sec;
  };
  return { window, doc, bar, btn, row, more, menu, menuEl, item, pick, active };
}

const ARTIFACT_FRAMES = [
  { type: 'artifact', kind: 'plan', path: 'plans/plan.md', nodeId: null, executionId: null, cycle: null },
  { type: 'artifact', kind: 'result', path: 'result.diff', nodeId: null, executionId: null, cycle: null },
];
const stateFrame = (over = {}) => ({ type: 'state', runId: 'r1', id: 'p1', status: 'running', steps: [], subAgents: [],
  sessionHosts: { s1: {} }, branch: { source: 'main', feature: 'worca-cc/dark-p1', worktreeDir: '/tmp/wt' }, ...over });

/** jsdom does no layout: a width for every run-page tab and its More button, a bar as wide as the test says, and a
 *  ResizeObserver and frames the test drives. The default split draws 470px. */
function fakeLayout(window) {
  const widths = { overview: 80, task: 50, diff: 70, artifacts: 100, qa: 55, clarify: 55, logs: 55, actions: 70, workflow: 80, sessions: 80, agents: 60 };
  let room = 0;
  const bars = (node) => node.classList.contains('rd-tabs') || node.classList.contains('hd-tabs');
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return bars(this) ? room : 0; } });
  window.HTMLButtonElement.prototype.getBoundingClientRect = function () {
    return { width: this.classList.contains('tab-more') ? 60 : widths[this.dataset.sec] || 0 };
  };
  const observers = [];
  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; this.live = true; observers.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve() {}
    disconnect() { this.live = false; }
  };
  const frames = [];
  window.requestAnimationFrame = (fn) => frames.push(fn);
  window.cancelAnimationFrame = () => {};
  /** The bar is now `px` wide: its observer reports it, and the frame runs. */
  const resize = (bar, px) => {
    room = px;
    const watching = observers.filter((o) => o.live && o.targets.includes(bar));
    assert.equal(watching.length, 1, 'one live observer on the bar');
    watching[0].cb([]);
    for (const fn of frames.splice(0)) fn(0);
  };
  return { resize };
}

/** A live git run with two artifacts and one session, open on its page. */
async function openLive({ level = 'expert', route = 'running/r1', hello = {}, state = {}, git = 'on', frames = ARTIFACT_FRAMES, layout = false } = {}) {
  const ctx = await bootApp();
  const fake = layout ? fakeLayout(ctx.window) : null;
  const root = ctx.window.document.documentElement;
  root.dataset.level = level;
  if (git === 'off') root.dataset.git = 'off';
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1', ...hello });
  ctx.dispatch(stateFrame(state));
  for (const a of frames) ctx.dispatch({ ...a, runId: 'r1' });
  ctx.dispatch(stateFrame(state));                        // a full repaint: the badges read the artifacts
  ctx.go(route);
  await ctx.settle(8);
  const p = page(ctx.window, 'rd');
  return { ctx, ...p, resize: (px) => fake.resize(p.bar(), px) };
}

const SAVED = {
  ...TABS_DETAIL,
  state: { ...TABS_DETAIL.state, sessionHosts: { s1: {} } },
  artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }, { kind: 'plan', relPath: 'plans/plan.md' }, { kind: 'result', relPath: 'result.diff' }],
};

/** The saved twin of openLive. */
async function openSaved({ level = 'expert', route = 'details/overview', detail = SAVED, row = ROW, git = 'on', arms = null, layout = false } = {}) {
  const ctx = await bootDetail({ detail, rows: [row], arms });
  const fake = layout ? fakeLayout(ctx.window) : null;
  const root = ctx.window.document.documentElement;
  root.dataset.level = level;
  if (git === 'off') root.dataset.git = 'off';
  await openDetail(ctx, route);
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  const p = page(ctx.window, 'hd');
  return { ctx, ...p, resize: (px) => fake.resize(p.bar(), px) };
}

const LIVE_ROW = ['overview', 'task', 'diff', 'artifacts', 'qa', 'logs'];
const SAVED_ROW = ['overview', 'task', 'diff', 'artifacts', 'clarify', 'logs'];

test('row and menu per interface level, live and saved', async () => {
  await checkRows([
    { name: 'live, Expert', run: async () => {
      const p = await openLive();
      assert.deepEqual(p.row(), LIVE_ROW);
      assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1', 'Agents']);
      assert.equal(p.active(), 'overview');
    } },
    { name: 'live, Advanced: Agents is gone', run: async () => {
      const p = await openLive({ level: 'advanced' });
      assert.deepEqual(p.row(), LIVE_ROW);
      assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1']);
    } },
    { name: 'live, Simple: Workflow alone stays in the row, in its usual place', run: async () => {
      const p = await openLive({ level: 'simple' });
      assert.equal(p.more(), null);
      assert.deepEqual(p.row(), ['overview', 'task', 'diff', 'workflow', 'qa']);
    } },
    { name: 'saved, Expert', run: async () => {
      const p = await openSaved();
      assert.deepEqual(p.row(), SAVED_ROW);
      assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1', 'Agents 2']);
    } },
    { name: 'saved, Advanced: the saved Logs tab is Expert, so it is gone', run: async () => {
      const p = await openSaved({ level: 'advanced' });
      assert.deepEqual(p.row(), ['overview', 'task', 'diff', 'artifacts', 'clarify']);
      assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1']);
    } },
    { name: 'saved, Simple', run: async () => {
      const p = await openSaved({ level: 'simple' });
      assert.equal(p.more(), null);
      assert.deepEqual(p.row(), ['overview', 'task', 'diff', 'workflow', 'clarify']);
    } },
  ]);
});

test('git off: Diff and Actions are in neither the row nor the menu', async () => {
  await checkRows([
    { name: 'live, Expert', run: async () => {
      const p = await openLive({ git: 'off' });
      assert.deepEqual(p.row(), ['overview', 'task', 'artifacts', 'qa', 'logs']);
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents']);
    } },
    { name: 'live, Simple: no More', run: async () => {
      const p = await openLive({ git: 'off', level: 'simple' });
      assert.equal(p.more(), null);
      assert.deepEqual(p.row(), ['overview', 'task', 'workflow', 'qa']);
    } },
    { name: 'saved, Expert', run: async () => {
      const p = await openSaved({ git: 'off' });
      assert.deepEqual(p.row(), ['overview', 'task', 'artifacts', 'clarify', 'logs']);
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents 2']);
    } },
    { name: 'git goes missing while the page is open, with an overflow tab open', run: async () => {
      const p = await openLive({ route: 'running/r1/details/actions' });
      assert.equal(p.active(), 'actions');
      applyGit({ available: false }, p.doc);
      await p.ctx.settle(6);
      assert.equal(p.active(), 'overview');
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents']);
      applyGit({ available: true }, p.doc);
      await p.ctx.settle(6);
      assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1', 'Agents']);
    } },
  ]);
});

test('a folder run: Changes in the row, no Actions under More', async () => {
  await checkRows([
    { name: 'live', run: async () => {
      const p = await openLive({ hello: { workMode: 'folder', projectDir: '/tmp/tax' }, state: { workMode: 'folder', branch: { workMode: 'folder', copyDir: '/tmp/copy' } } });
      assert.deepEqual(p.row(), ['overview', 'task', 'changes', 'artifacts', 'qa', 'logs']);
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents']);
    } },
    { name: 'saved', run: async () => {
      const detail = { ...SAVED, results: null, state: { ...SAVED.state, workMode: 'folder', branch: { workMode: 'folder' } } };
      const p = await openSaved({ detail, row: { ...ROW, workMode: 'folder', branch: null } });
      assert.deepEqual(p.row(), ['overview', 'task', 'changes', 'artifacts', 'clarify', 'logs']);
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents 2']);
    } },
  ]);
});

test('a run without a project: Artifacts is in the row and opens first; the rest go under More', async () => {
  await checkRows([
    { name: 'live, Expert', run: async () => {
      const p = await openLive({ hello: { workMode: 'none' }, state: { workMode: 'none', branch: { workMode: 'none' } } });
      assert.deepEqual(p.row(), ['overview', 'task', 'artifacts', 'qa', 'logs']);
      assert.equal(p.active(), 'overview', 'the run route opens Overview');
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents']);
    } },
    { name: 'live, Details with no tab named opens Artifacts first, at Simple too', run: async () => {
      const p = await openLive({ level: 'simple', route: 'running/r1/details/artifacts', hello: { workMode: 'none' }, state: { workMode: 'none', branch: { workMode: 'none' } } });
      assert.equal(p.active(), 'artifacts');
      assert.equal(p.more(), null);
      assert.deepEqual(p.row(), ['overview', 'task', 'artifacts', 'workflow', 'qa']);
    } },
    { name: 'saved', run: async () => {
      const detail = { ...SAVED, results: null, state: { ...SAVED.state, workMode: 'none', branch: { workMode: 'none' } } };
      const p = await openSaved({ detail, row: { ...ROW, workMode: 'none', branch: null }, route: 'details' });
      assert.deepEqual(p.row(), ['overview', 'task', 'artifacts', 'clarify', 'logs']);
      assert.deepEqual(p.menu(), ['Workflow', 'Sessions 1', 'Agents 2']);
    } },
  ]);
});

test('a deep link into an overflow tab: lit just before More and checked in the menu; a row tab takes it out again', async () => {
  await checkRows([
    { name: 'live', run: async () => {
      const p = await openLive({ route: 'running/r1/details/workflow' });
      assert.equal(p.active(), 'workflow');
      assert.deepEqual(p.row(), [...LIVE_ROW, 'workflow']);
      assert.equal(p.btn('workflow').parentElement.lastElementChild, p.more());
      assert.ok(p.menu().includes('✓ Workflow'));
      click(p.window, p.btn('logs'));
      await p.ctx.settle();
      assert.deepEqual(p.row(), LIVE_ROW);
      assert.equal(p.window.location.hash, '#running/r1/details/logs');
    } },
    { name: 'saved', run: async () => {
      const p = await openSaved({ route: 'details/workflow' });
      assert.equal(p.active(), 'workflow');
      assert.deepEqual(p.row(), [...SAVED_ROW, 'workflow']);
      assert.ok(p.menu().includes('✓ Workflow'));
      click(p.window, p.btn('logs'));
      assert.deepEqual(p.row(), SAVED_ROW);
    } },
    { name: 'a click on the live graph', run: async () => {
      const p = await openLive();
      click(p.window, p.doc.querySelector('#run-detail .rd-live'));
      await p.ctx.settle(6);
      assert.equal(p.active(), 'workflow');
      assert.deepEqual(p.row(), [...LIVE_ROW, 'workflow']);
      assert.ok(p.menu().includes('✓ Workflow'));
    } },
  ]);
});

test('a menu pick opens the tab, puts it in the address and focuses it; Esc returns to More', async () => {
  const p = await openLive();
  const more = p.more();
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');
  assert.equal(more.getAttribute('role'), null);
  click(p.window, more);
  assert.equal(p.menuEl().parentElement, p.doc.body, 'never clipped by the scrolling row');
  assert.ok([...p.menuEl().querySelectorAll('.menu-item')].every((i) => i.querySelector('svg')), 'each row has its icon');
  click(p.window, p.item('Sessions'));
  await p.ctx.settle(6);
  assert.equal(p.active(), 'sessions');
  assert.equal(p.window.location.hash, '#running/r1/details/sessions');
  assert.equal(p.doc.activeElement, p.btn('sessions'));
  click(p.window, p.more());
  p.doc.activeElement.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(p.menuEl(), null);
  assert.equal(p.doc.activeElement, p.more());
});

test('counts update: the menu reads the badge when it opens, and every tab keeps its button in the row', async () => {
  const p = await openLive();
  assert.equal(p.btn('artifacts').querySelector('.rd-tab-badge').textContent, '2');
  p.ctx.dispatch({ type: 'artifact', runId: 'r1', kind: 'review', path: 'reviews/review.md', nodeId: null, executionId: null, cycle: null });
  p.ctx.dispatch(stateFrame({ subAgents: [{ id: 'a1', label: 'Explore', status: 'running' }] }));
  await p.ctx.settle(6);
  assert.ok(p.menu().includes('Agents 1'));
  for (const k of ['artifacts', 'actions', 'workflow', 'sessions', 'agents']) assert.ok(p.btn(k), k);
  assert.equal(p.btn('artifacts').querySelector('.rd-tab-badge').textContent, '3');
  assert.equal(p.btn('actions').dataset.needsGit, '');
  assert.equal(p.btn('agents').dataset.minLevel, 'expert');
});

test('the Actions dot still lands on the Actions button under More', async () => {
  const running = [{ instanceId: `act:${ROW.id}:${KEY}:run`, runId: ROW.id, member: KEY, actionId: 'run', label: 'Run', kind: 'service',
    status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now(), histKey: KEY, workspaceId: null, runTitle: 'Log UX' }];
  const p = await openSaved({ detail: { ...SAVED, results: RESULTS }, arms: (url) => (url.endsWith('/api/actions/running') ? ok(running) : null) });
  p.ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'actions-changed', action: 'start' }) });
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  assert.ok(p.btn('actions').hasAttribute('data-overflow'));
  assert.ok(p.btn('actions').querySelector('.tab-dot'));
});

test('a level change while the page is open: the open overflow tab gives way and More follows', async () => {
  const p = await openLive({ route: 'running/r1/details/agents' });
  assert.equal(p.active(), 'agents');
  applyLevel('simple', p.doc);
  await p.ctx.settle(6);
  assert.equal(p.active(), 'overview');
  assert.equal(p.more(), null);
  assert.deepEqual(p.row(), ['overview', 'task', 'diff', 'workflow', 'qa']);
  applyLevel('expert', p.doc);
  await p.ctx.settle(6);
  assert.ok(p.more());
  assert.deepEqual(p.row(), LIVE_ROW);
  assert.equal(p.active(), 'overview');
});

test('a tab hidden while the page is open leaves the menu: a Care run merges Agents away', async () => {
  const agent = (id, key) => ({ id, kind: 'agent', key, label: key });
  const p = await openLive();                               // no manifest yet, so no careRun
  applyFlags({ shaperSmallRuns: true }, p.doc);
  assert.ok(p.menu().includes('Agents'));
  p.pick('Agents');
  assert.equal(p.active(), 'agents');
  const careRun = careRunPlan('balanced', { runRoles: ['product'] });
  p.ctx.dispatch(stateFrame({ stepper: { version: 2, template: { id: 'wf_shape_slice_req' }, careRun,
    graph: { nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer')], wires: [] } } }));
  await p.ctx.settle(8);
  assert.equal(p.btn('agents').hidden, true);
  assert.equal(p.active(), 'overview');
  assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1']);
});

// --- the width fit (tab-fold.mjs) --------------------------------------------

// A 375px screen leaves the bar 311px inside the page's 32px gutters.
const NARROW = 311;
const PAGES = [
  { name: 'live', open: openLive, route: 'running/r1/details/logs', row: LIVE_ROW, qa: 'qa', agents: 'Agents' },
  { name: 'saved', open: openSaved, route: 'details/logs', row: SAVED_ROW, qa: 'clarify', agents: 'Agents 2' },
];
/** A menu row's name, without its count and check. */
const names = (rows) => rows.map((r) => r.replace(/^✓ /, '').replace(/ \d+$/, ''));

test('wide: the default row, with Artifacts in it and the rest under More', async () => {
  await checkRows(PAGES.map(({ name, open, row, agents }) => ({ name, run: async () => {
    const p = await open({ layout: true });
    p.resize(1200);
    assert.deepEqual(p.row(), row);
    assert.deepEqual(p.menu(), ['Actions', 'Workflow', 'Sessions 1', agents]);
  } })));
});

test('narrow (375px): the right-most row tabs fold, Overview and the open tab stay, widening restores the default', async () => {
  await checkRows(PAGES.map(({ name, open, route, row, qa }) => ({ name, run: async () => {
    const p = await open({ route, layout: true });
    assert.equal(p.active(), 'logs');
    p.resize(NARROW);
    assert.deepEqual(p.row(), ['overview', 'task', 'logs']);
    assert.equal(p.active(), 'logs');
    assert.deepEqual(names(p.menu()), ['Diff', 'Artifacts', 'Actions', 'Workflow', 'Q&A', 'Sessions', 'Agents']);
    assert.ok(p.menu().includes('Artifacts 2'), 'a folded tab keeps its count');
    p.resize(1);
    assert.deepEqual(p.row(), ['overview', 'logs']);
    assert.ok(p.more());
    p.resize(360);
    assert.deepEqual(p.row(), ['overview', 'task', 'diff', 'logs'], 'back in reverse order');
    assert.ok(p.btn('artifacts').hasAttribute('data-overflow') && p.btn(qa).hasAttribute('data-overflow'));
    p.resize(1200);
    assert.deepEqual(p.row(), row);
    assert.deepEqual(names(p.menu()), ['Actions', 'Workflow', 'Sessions', 'Agents']);
  } })));
});

test('open a folded tab from More: it returns to the row, lit, and another gives way', async () => {
  await checkRows(PAGES.map(({ name, open }) => ({ name, run: async () => {
    const p = await open({ layout: true });
    p.resize(NARROW);
    assert.deepEqual(p.row(), ['overview', 'task', 'diff']);
    p.pick('Artifacts');
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(p.active(), 'artifacts');
    assert.deepEqual(p.row(), ['overview', 'task', 'artifacts']);
    assert.equal(p.doc.activeElement, p.btn('artifacts'));
  } })));
});

// --- the plain header (CSS) ------------------------------------------------

const css = (file) => readFileSync(new URL(`../ui/public/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the rule whose selector list is exactly `selector` (the first one in the file). */
function rule(file, selector) {
  const hit = [...css(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector);
  assert.ok(hit, `${file}: a rule for ${selector}`);
  return Object.fromEntries(hit[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
}

test('the run headers have no box and sit on the body\'s edges; .pd-header keeps its box; overflow tabs are hidden', () => {
  for (const [file, selector] of [['runs/running-detail-header.css', '.rd-header'], ['history/detail-header.css', '.hd-header']]) {
    const r = rule(file, selector);
    for (const k of Object.keys(r)) assert.doesNotMatch(k, /^(background|border)/, `${selector}: ${k}`);
    assert.equal(r.padding, '0', selector);
    assert.match(r.margin, /^\d+px 32px 0$/, selector);
  }
  assert.equal(rule('runs/running-detail-header.css', '.rd-header').margin, rule('history/detail-header.css', '.hd-header').margin, 'no jump from live to saved');
  assert.match(rule('runs/running-detail-header.css', '.rd-body').padding, /^0 32px /);
  assert.doesNotMatch(css('history/detail-header.css'), /\.hd-header,\s*\.pd-header/, 'the shared box rule is split');
  const pd = rule('history/detail-header.css', '.pd-header');
  assert.deepEqual([pd.background, pd.border, pd['border-radius'], pd.padding], ['var(--panel)', '1px solid var(--line)', 'var(--r-card)', '20px 24px 18px']);
  const panel = rule('chat/chat-run-panel.css', '.crp :is(.rd-header,.hd-header)');
  assert.equal(panel.padding, '0');
  assert.match(panel.margin, /^\d+px 16px 0$/);
  assert.equal(rule('runs/running-detail-tab.css', '.tabs > .tab[data-overflow]:not(.active)').display, 'none');
});
