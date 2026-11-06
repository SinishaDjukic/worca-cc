// test/ui-tool-overview-sources.test.mjs — the Overview's section builders (issue 1064, ui/public/tool-overview-sources.mjs)
// over fake deps and a fake fetch, drawn by the real renderer (tool-overview.mjs): a chat's Environment, Context, Runs,
// Pull requests, Artifacts and Background; a run's and a project's sections.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOverview } from '../ui/public/tool-overview.mjs';
import { overviewSourceFor, chatOverviewSections } from '../ui/public/tool-overview-sources.mjs';
import { registerBuiltinFileRenderers } from '../ui/public/chat/files-card.mjs';

registerBuiltinFileRenderers();   // the app registers them at boot (registerFilesCard): filePreviewOf reads them

const TID = 'ask_0000aaaa';
const CHAT_VIEW = { project: 'app-0000aaaa', side: { type: 'chat', id: TID, projectKey: 'app-0000aaaa' } };
const opened = [];
afterEach(() => { for (const o of opened.splice(0)) { o.ov.unmount(); o.win.close(); } });
const tick = (n = 4) => new Promise((r) => { let i = 0; const step = () => (++i >= n ? r() : setTimeout(step, 0)); setTimeout(step, 0); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

const OVERVIEW = () => ({
  environment: { followedRun: { pipelineId: 'aaaa0003', title: 'Followed', branch: 'feat/x' } },
  runs: [
    { runId: 'r-1', pipelineId: 'aaaa0001', title: 'First', status: 'done', phase: 'done', costUsd: 1.25, runEngine: 'claude', startedAt: 't', href: '#history/app-0000aaaa/aaaa0001', branch: 'feat/a' },
    { runId: 'r-2', pipelineId: 'aaaa0002', title: 'Second', status: 'done', phase: 'done', costUsd: null, runEngine: 'cursor', startedAt: 't', href: '#history/app-0000aaaa/aaaa0002', branch: null },
  ],
  prs: [{ url: 'https://github.com/o/r/pull/7', label: 'o/r#7', refKey: 'gh:o/r#7', title: 'First', state: 'open', runId: 'r-1', source: 'run' }],
  artifacts: [
    { source: 'shown', attId: 'att_1', name: 'plan.md', bytes: 2048, kind: 'text', mime: 'Markdown', at: '2026-10-05T00:00:00.000Z' },
    { source: 'shown', attId: 'att_2', name: 'shot.png', bytes: 10, kind: 'image', mime: 'image/png', at: '2026-10-04T00:00:00.000Z' },
    { source: 'out', path: 'out/report.md', name: 'report.md', bytes: 5, at: '2026-10-03T00:00:00.000Z' },
  ],
  artifactsTotal: 3,
});

function fakeAsk(over = {}) {
  const listeners = new Set();
  const stops = [];
  const refreshes = [];
  const ap = {
    threadId: () => TID, host: () => 'page',
    scope: () => ({ pinned: true, projectKey: 'app-0000aaaa', workspaceId: null }),
    threadFacts: () => ({ threadId: TID, engineLabel: 'Claude', modelLabel: 'Sonnet 5.5' }),
    contextSnapshot: () => ({ threadId: TID, ctx: 120400, win: 1000000, turns: 1, pct: 12, level: 'ok', contexts: [], agents: [], worktrees: [], showAgents: true, showWorktrees: false }),
    contextActions: Object.freeze({ openTopic: () => {}, removeWorktree: () => {}, copyPath: () => {}, refresh: () => refreshes.push(1) }),
    runningCommands: () => [],
    stopCommand: async (sid) => { stops.push(sid); },
    watch: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: (k) => { for (const fn of [...listeners]) fn(k); },
    stops, refreshes, listeners,
    ...over,
  };
  return ap;
}
function fakeStore() {
  const subs = new Set();
  const live = new Map();
  return { get: (id) => [...live.values()].find((s) => s.runId === id) || null, byPipeline: (pid) => live.get(pid) || null,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    poke: (runId, type) => { for (const fn of [...subs]) fn(runId, type); }, live, subs };
}
function makeDeps(over = {}) {
  const calls = { fetch: [], go: [], panel: [], files: [], out: [], session: [], stopAction: [], service: [], resolve: [], artifact: [] };
  const actionSubs = new Set();
  const state = { overview: OVERVIEW(), actions: [], links: true };
  const deps = {
    fetch: async (url) => { calls.fetch.push(url); if (url.endsWith('/overview')) return ok(structuredClone(state.overview)); if (url.startsWith('/api/ask/runs/')) return ok(state.run || {}); return ok({}); },
    askPanel: fakeAsk(),
    runStore: fakeStore(),
    projectOf: (k) => (k === 'app-0000aaaa' ? { name: 'app', path: '/Users/me/code/app' } : null),
    workspaceOf: (id) => (id === 'wks-1' ? { name: 'Shop' } : null),
    actionsRunning: () => state.actions,
    onActions: (fn) => { actionSubs.add(fn); return () => actionSubs.delete(fn); },
    stopAction: async (s) => { calls.stopAction.push(s.instanceId); },
    openService: (s) => calls.service.push(s.url),
    showSession: (id) => calls.session.push(id),
    go: (h) => calls.go.push(h),
    openInPanel: (a) => calls.panel.push(a.item.attId),
    openFiles: (a) => calls.files.push([a.items.map((i) => i.attId), a.index]),
    linksInPanel: () => state.links,
    openOutFile: (tid, path) => calls.out.push([tid, path]),
    openRunArtifact: (ref, a) => calls.artifact.push([ref.pipelineId, a.relPath]),
    historyRows: () => state.history || [],
    historyRow: (pid) => (state.history || []).find((h) => h.id === pid) || null,
    liveRunsOf: () => state.liveRuns || [],
    resolveRefs: async (keys) => { calls.resolve.push(keys); if (state.resolveFails) throw new Error('offline'); return { 'gh:o/r#7': { state: 'merged', title: 'Fix it' } }; },
    now: () => Date.parse('2026-10-06T00:00:00.000Z'),
    ...over,
  };
  return { deps, calls, state, actionSubs };
}
function mount(view, deps, pre) {
  const dom = new JSDOM('<!doctype html><body><div id="h"></div></body>', { url: 'http://localhost/' });
  const win = dom.window;
  if (pre) pre(win);   // e.g. spy on win.setInterval before the renderer starts its ticks
  const host = win.document.getElementById('h');
  const ov = createOverview({ doc: win.document, win, source: (v) => overviewSourceFor(v, deps) });
  ov.mount(host, view);
  const o = { win, doc: win.document, host, ov,
    sec: (id) => host.querySelector(`[data-tov-section="${id}"]`),
    rows: (id) => [...host.querySelectorAll(`[data-tov-section="${id}"] .tov-item:not([hidden])`)].map((li) => [li.querySelector('.tov-text').textContent, li.querySelector('.tov-meta').textContent]),
    row: (id, i = 0) => host.querySelectorAll(`[data-tov-section="${id}"] .tov-row`)[i] };
  opened.push(o);
  return o;
}

test('environment filled / no project / workspace / no branch; sections in the chat order', async () => {
  const { deps, calls } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick();
  assert.deepEqual([...o.host.querySelectorAll('.tov-sec')].map((s) => s.dataset.tovSection), ['environment', 'context', 'runs', 'prs', 'artifacts', 'background']);
  assert.deepEqual(o.rows('environment'), [['app', '~/code/app'], ['Claude · Sonnet 5.5', ''], ['feat/x', 'Followed']]);
  assert.equal(calls.fetch.filter((u) => u === `/api/ask/threads/${TID}/overview`).length, 1, 'one fetch shared by the sections');
  const none = makeDeps();
  none.deps.askPanel = fakeAsk({ scope: () => ({ pinned: false, projectKey: null, workspaceId: null }) });
  none.state.overview.environment.followedRun = null;
  const n = mount(CHAT_VIEW, none.deps);
  await tick();
  assert.deepEqual(n.rows('environment'), [['No project', ''], ['Claude · Sonnet 5.5', '']], 'no branch row without a followed run');
  const ws = makeDeps();
  ws.deps.askPanel = fakeAsk({ scope: () => ({ pinned: true, projectKey: null, workspaceId: 'wks-1' }) });
  const w = mount(CHAT_VIEW, ws.deps);
  await tick();
  assert.deepEqual(w.rows('environment')[0], ['Shop', 'Workspace']);
});

test('context hidden off-page or in the dock or for another chat; the body uses the shared renderer; refresh on expand', async () => {
  const { deps } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick();
  const head = o.sec('context').querySelector('.tov-head');
  assert.equal(o.sec('context').hidden, false);
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(head.querySelector('.tov-count').textContent, '12%');
  head.click();
  assert.ok(o.sec('context').querySelector('.tov-body .ask-ctx-stat[data-stat="used"]'), 'the popover\'s stats');
  assert.equal(o.sec('context').querySelector('[role="menuitem"]'), null);
  assert.equal(deps.askPanel.refreshes.length, 1);
  deps.askPanel.emit('context');
  assert.equal(deps.askPanel.refreshes.length, 1, 'a redraw does not refetch the worktrees again (no loop)');
  for (const over of [{ host: () => 'dock' }, { threadId: () => 'ask_0000bbbb' }, { contextSnapshot: () => null }, { contextSnapshot: () => ({ ctx: 5, win: null, pct: null }) }]) {
    const m = makeDeps();
    m.deps.askPanel = fakeAsk(over);
    const x = mount(CHAT_VIEW, m.deps);
    await tick();
    assert.equal(x.sec('context').hidden, true, JSON.stringify(Object.keys(over)));
  }
});

test('runs: live overlay without a fetch; a done poke → one debounced refetch; click routes', async () => {
  const { deps, calls } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick();
  assert.deepEqual(o.rows('runs'), [['First', 'Done · $1.25'], ['Second', 'Done · cost unknown']]);
  deps.runStore.live.set('aaaa0001', { source: 'live', runId: 'r-1', pipelineId: 'aaaa0001', title: 'First', status: 'running', active: [], costUsd: 0.5, run: { status: 'running' } });
  deps.runStore.poke('r-1', 'state');
  await tick();
  assert.deepEqual(o.rows('runs')[0], ['First', 'Running · $0.50']);
  assert.ok(o.sec('runs').querySelector('.tov-row .status-dot'), 'the dot');
  const fetches = () => calls.fetch.filter((u) => u.endsWith('/overview')).length;
  assert.equal(fetches(), 1, 'a live poke redraws without a fetch');
  o.row('runs', 0).click();
  assert.deepEqual(calls.go, ['#running/r-1'], 'live: the run page');
  o.row('runs', 1).click();
  assert.deepEqual(calls.go.at(-1), '#history/app-0000aaaa/aaaa0002', 'saved: its History page');
  deps.runStore.poke('r-9', 'done');
  deps.runStore.poke('r-1', 'done');
  await wait(450);
  await tick();
  assert.equal(fetches(), 2, 'two done pokes: one debounced refetch');
  deps.askPanel.emit('links');
  await wait(450);
  await tick();
  assert.equal(fetches(), 3, 'a new run link: a refetch');
  o.ov.unmount();
  deps.askPanel.emit('links');
  deps.runStore.poke('r-1', 'done');
  await wait(450);
  assert.equal(fetches(), 3, 'unmounted: nothing more');
});

test('fetch after poke keeps live status (the store wins at draw time)', async () => {
  const { deps } = makeDeps();
  let release;
  const held = new Promise((r) => { release = r; });
  const base = deps.fetch;
  deps.fetch = async (u) => { await held; return base(u); };
  const o = mount(CHAT_VIEW, deps);
  deps.runStore.live.set('aaaa0001', { source: 'live', runId: 'r-1', pipelineId: 'aaaa0001', title: 'First', status: 'running', active: [], costUsd: 0.1, run: { status: 'running' } });
  deps.runStore.poke('r-1', 'state');
  release();
  await tick();
  assert.equal(o.rows('runs')[0][1], 'Running · $0.10', 'the saved "done" never overwrites the live run');
});

test('pr pill upgraded by resolve; resolve failure keeps the stored state; the row is an external link', async () => {
  const { deps, calls } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick(8);
  assert.deepEqual(calls.resolve, [['gh:o/r#7']]);
  const a = o.sec('prs').querySelector('a.tov-row');
  assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/7');
  assert.equal(a.querySelector('.tov-pill').textContent, 'Merged');
  assert.equal(o.rows('prs')[0][1], 'Fix it');
  const f = makeDeps();
  f.state.resolveFails = true;
  const x = mount(CHAT_VIEW, f.deps);
  await tick(8);
  assert.equal(x.sec('prs').querySelector('.tov-pill').textContent, 'Open');
  assert.ok(x.sec('prs').querySelector('.tov-pill').classList.contains('tone-green'));
});

test('artifacts: routing by kind and setting; out files always open in the panel; Show all and the note', async () => {
  const { deps, calls, state } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick();
  assert.deepEqual(o.rows('artifacts').map((r) => r[0]), ['plan.md', 'shot.png', 'out/report.md']);
  assert.match(o.rows('artifacts')[0][1], /^2(\.0)? KB · 1 h ago$|^2(\.0)? KB · /);
  o.row('artifacts', 0).click();
  assert.deepEqual(calls.panel, ['att_1'], 'markdown with the setting on: a Files tab');
  o.row('artifacts', 1).click();
  assert.deepEqual(calls.files, [[['att_1', 'att_2'], 1]], 'an image: the pop-up at its index');
  state.links = false;
  o.row('artifacts', 0).click();
  assert.deepEqual(calls.files.at(-1), [['att_1', 'att_2'], 0], 'setting off: the pop-up');
  o.row('artifacts', 2).click();
  assert.deepEqual(calls.out, [[TID, 'out/report.md']], 'an out file: always the panel (root out)');
  const big = makeDeps();
  big.state.overview.artifacts = Array.from({ length: 7 }, (_, i) => ({ source: 'out', path: `f${i}.md`, name: `f${i}.md`, bytes: 1, at: 't' }));
  big.state.overview.artifactsTotal = 73;
  const b = mount(CHAT_VIEW, big.deps);
  await tick();
  assert.equal(b.rows('artifacts').length, 5);
  assert.equal(b.sec('artifacts').querySelector('.tov-more').textContent, 'Show all 7');
  assert.equal(b.sec('artifacts').querySelector('.tov-note').textContent, 'Showing the newest 50 of 73');
  big.deps.askPanel.emit('cards');
  await wait(450);
  assert.equal(big.calls.fetch.filter((u) => u.endsWith('/overview')).length, 2, 'cards → a refetch');
});

test('background: running commands with Stop and a tick; actions only of the chat\'s started runs', async () => {
  const { deps, calls, state, actionSubs } = makeDeps();
  let cmds = [{ blockId: 'b1', sessionId: 't-1', command: 'npm test', startedAt: '2026-10-05T23:59:58.000Z', runBy: 'ask:x' }];
  deps.askPanel = fakeAsk({ runningCommands: () => cmds });
  state.actions = [
    { instanceId: 'i1', runId: 'aaaa0001', kind: 'service', label: 'Web', url: 'http://localhost:4417/', startedAt: '2026-10-05T23:58:00.000Z' },
    { instanceId: 'i2', runId: 'ffff0000', kind: 'service', label: 'Other run', startedAt: 't' },
  ];
  const o = mount(CHAT_VIEW, deps);
  await tick();
  assert.deepEqual(o.rows('background'), [['npm test', '2.0s'], ['Web', '2m 0s']], 'the other run\'s action is absent');
  const stops = o.sec('background').querySelectorAll('.tov-stop');
  stops[0].click();
  stops[1].click();
  await tick();
  assert.deepEqual(deps.askPanel.stops, ['t-1']);
  assert.deepEqual(calls.stopAction, ['i1']);
  o.row('background', 0).click();
  assert.deepEqual(calls.session, ['t-1']);
  o.row('background', 1).click();
  assert.deepEqual(calls.service, ['http://localhost:4417/']);
  cmds = [];
  deps.askPanel.emit('commands');
  await tick();
  assert.deepEqual(o.rows('background').map((r) => r[0]), ['Web']);
  state.actions = [];
  for (const fn of actionSubs) fn();
  await tick();
  assert.equal(o.sec('background').hidden, true);
  assert.equal(o.ov.viewKey(), 'app-0000aaaa|chat:ask_0000aaaa');
});

test('run sections: status, branch, project, checkout; its PR; artifacts open the run viewer; its actions', async () => {
  const { deps, calls, state } = makeDeps();
  state.run = { state: { status: 'done', branch: { feature: 'feat/r' } }, live: null,
    extras: { pr: { url: 'https://github.com/o/r/pull/3', state: 'OPEN', draft: true }, artifacts: [{ kind: 'plan', relPath: 'plan.md', bytes: 100, nodeId: 'n', cycle: 1 }] } };
  state.history = [{ id: 'cccc0001', title: 'A run', status: 'done', branch: 'feat/r', checkout: { members: [{ projectKey: 'app-0000aaaa', worktreeDir: '/Users/me/wt/r' }] } }];
  state.actions = [{ instanceId: 'i3', runId: 'cccc0001', kind: 'task', label: 'Tests', startedAt: '2026-10-05T23:59:00.000Z' }, { instanceId: 'i4', runId: 'other', label: 'x', startedAt: 't' }];
  const o = mount({ project: 'app-0000aaaa', side: { type: 'run', id: 'cccc0001', projectKey: 'app-0000aaaa' } }, deps);
  await tick();
  assert.deepEqual([...o.host.querySelectorAll('.tov-sec')].map((s) => s.dataset.tovSection), ['environment', 'pr', 'artifacts', 'background']);
  assert.deepEqual(o.rows('environment'), [['Done', ''], ['feat/r', 'Branch'], ['app', '~/code/app'], ['Checked out', '~/wt/r']]);
  assert.deepEqual(calls.fetch, ['/api/ask/runs/cccc0001']);
  assert.equal(o.sec('pr').querySelector('.tov-pill').textContent, 'Draft');
  assert.equal(o.rows('pr')[0][0], 'o/r#3');
  o.row('artifacts', 0).click();
  assert.deepEqual(calls.artifact, [['cccc0001', 'plan.md']]);
  assert.deepEqual(o.rows('background'), [['Tests', '1m 0s']]);
});

test('project sections: live runs first, then History (at most 10); their pull requests', async () => {
  const { deps, calls, state } = makeDeps();
  state.liveRuns = [{ source: 'live', runId: 'r-live', pipelineId: 'dddd0001', title: 'Live one', status: 'running', active: [], run: { status: 'running' } }];
  state.history = [{ id: 'dddd0001', title: 'dup', status: 'running' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `eeee00${String(i).padStart(2, '0')}`, title: `H${i}`, status: 'done', startedAt: '2026-10-05T00:00:00.000Z',
      ...(i === 1 ? { pr: { url: 'https://github.com/o/r/pull/11', state: 'MERGED' } } : {}) }))];
  const o = mount({ project: 'app-0000aaaa', side: null }, deps);
  await tick();
  assert.deepEqual([...o.host.querySelectorAll('.tov-sec')].map((s) => s.dataset.tovSection), ['runs', 'prs']);
  const runs = o.rows('runs');
  assert.equal(runs.length, 10);
  assert.deepEqual(runs[0], ['Live one', 'Running']);
  assert.equal(runs.some((r) => r[0] === 'dup'), false, 'the live run is not listed twice');
  assert.match(runs[1][1], /^Done · 1 d(ay)? ago$|^Done · /);
  o.row('runs', 1).click();
  assert.deepEqual(calls.go, ['#history/app-0000aaaa/eeee0000']);
  assert.deepEqual(o.rows('prs'), [['o/r#11', 'H1']]);
  assert.equal(o.sec('prs').querySelector('.tov-pill').textContent, 'Merged');
  assert.equal(overviewSourceFor({ project: null, side: null, blocked: 'x' }, deps), null);
  assert.equal(overviewSourceFor(null, deps), null);
  assert.equal(chatOverviewSections(TID, deps).length, 6);
});

const RUN_VIEW = { project: 'app-0000aaaa', side: { type: 'run', id: 'cccc0001', projectKey: 'app-0000aaaa' } };
const liveRun = (over = {}) => ({ source: 'live', runId: 'r-c1', pipelineId: 'cccc0001', title: 'A run', status: 'running', active: [], run: { status: 'running' }, ...over });

test('run environment: the live store\'s status wins over the fetched one, and a store change redraws it', async () => {
  const a = makeDeps();
  a.state.run = { state: { status: 'done' }, extras: {} };
  a.deps.runStore.live.set('cccc0001', liveRun());
  const o = mount(RUN_VIEW, a.deps);
  await tick();
  assert.deepEqual(o.rows('environment')[0], ['Running', ''], 'live "running" over the fetched "done"');
  const n = makeDeps();   // nothing saved yet (no fetched state, no History row): the live status alone makes the row
  n.state.run = {};
  n.deps.runStore.live.set('cccc0001', liveRun());
  const y = mount(RUN_VIEW, n.deps);
  await tick();
  assert.deepEqual(y.rows('environment')[0], ['Running', ''], 'a live run with no saved status still shows it');
  const b = makeDeps();
  b.state.run = { state: { status: 'done' }, extras: {} };
  const x = mount(RUN_VIEW, b.deps);
  await tick();
  assert.deepEqual(x.rows('environment')[0], ['Done', '']);
  b.deps.runStore.live.set('cccc0001', liveRun());
  b.deps.runStore.poke('r-c1', 'state');
  await tick();
  assert.deepEqual(x.rows('environment')[0], ['Running', ''], 'a store change redraws without a fetch');
  assert.equal(b.calls.fetch.length, 1);
});

test('chat runs: a resumed run (new runId, same pipeline) still shows its live state', async () => {
  const { deps, calls } = makeDeps();
  deps.runStore.live.set('aaaa0001', { source: 'live', runId: 'r-1-resumed', pipelineId: 'aaaa0001', title: 'First', status: 'running', active: [], costUsd: 0.7, run: { status: 'running' } });
  const o = mount(CHAT_VIEW, deps);
  await tick();
  assert.deepEqual(o.rows('runs')[0], ['First', 'Running · $0.70'], 'found by its pipeline id, not the saved runId');
  o.row('runs', 0).click();
  assert.deepEqual(calls.go, ['#running/r-1-resumed'], 'and opened on the live run');
});

test('chat pull requests: PRs that arrive after the first lookup are resolved on the next refetch', async () => {
  const asked = [];
  const { deps, state } = makeDeps({ resolveRefs: async (keys) => { asked.push(keys); return Object.fromEntries(keys.map((k) => [k, { state: 'merged', title: `T ${k}` }])); } });
  const o = mount(CHAT_VIEW, deps);
  await tick(8);
  assert.deepEqual(asked, [['gh:o/r#7']]);
  state.overview.prs.push({ url: 'https://github.com/o/r/pull/8', label: 'o/r#8', refKey: 'gh:o/r#8', title: 'Eight', state: 'open', source: 'run' });
  deps.askPanel.emit('links');
  await wait(450);
  await tick(8);
  assert.deepEqual(asked, [['gh:o/r#7'], ['gh:o/r#8']], 'only the new ref is asked, and it is asked');
  assert.deepEqual(o.rows('prs'), [['o/r#7', 'T gh:o/r#7'], ['o/r#8', 'T gh:o/r#8']]);
  assert.equal(o.sec('prs').querySelectorAll('.tov-pill')[1].textContent, 'Merged');
});

test('background: the time column ticks every second, in a chat and in a run', async () => {
  const intervals = [];
  const spy = (win) => { const real = win.setInterval.bind(win); win.setInterval = (fn, ms) => { intervals.push([fn, ms]); return real(fn, ms); }; };
  let clock = Date.parse('2026-10-06T00:00:00.000Z');
  const { deps, state } = makeDeps({ now: () => clock });
  state.actions = [{ instanceId: 'i1', runId: 'aaaa0001', kind: 'service', label: 'Web', startedAt: '2026-10-05T23:58:00.000Z' }];
  const o = mount(CHAT_VIEW, deps, spy);
  await tick();
  assert.deepEqual(o.rows('background'), [['Web', '2m 0s']]);
  assert.deepEqual(intervals.map((i) => i[1]), [1000], 'one ticking section (Background), every second');
  clock += 5000;
  assert.deepEqual(o.rows('background'), [['Web', '2m 0s']], 'nothing moves without a tick');
  intervals[0][0]();
  await tick();
  assert.deepEqual(o.rows('background'), [['Web', '2m 5s']], 'the tick re-reads the meta');
  const r = makeDeps({ now: () => clock });
  r.state.actions = [{ instanceId: 'i3', runId: 'cccc0001', kind: 'task', label: 'Tests', startedAt: '2026-10-05T23:59:00.000Z' }];
  intervals.length = 0;
  const x = mount(RUN_VIEW, r.deps, spy);
  await tick();
  assert.deepEqual(x.rows('background'), [['Tests', '1m 5s']]);
  assert.deepEqual(intervals.map((i) => i[1]), [1000]);
  clock += 10000;
  intervals[0][0]();
  await tick();
  assert.deepEqual(x.rows('background'), [['Tests', '1m 15s']]);
});

test('a refetch pending at unmount never fires: nothing is fetched afterwards', async () => {
  const { deps, calls } = makeDeps();
  const o = mount(CHAT_VIEW, deps);
  await tick();
  const fetches = () => calls.fetch.filter((u) => u.endsWith('/overview')).length;
  assert.equal(fetches(), 1);
  deps.askPanel.emit('links');       // schedules the 400 ms refetch
  deps.runStore.poke('r-1', 'done'); // and restarts it
  await wait(100);
  o.ov.unmount();
  await wait(500);
  assert.equal(fetches(), 1, 'the pending refetch died with the mount');
});
