// test/stillhet-task-page-facts-host.test.mjs — the live task page shows only the task's own facts (R-fit-4: no stand-in that
// only looks real): no sample branch, time, cost, budget, ask or project when dev has none; a finished task offers no Stop;
// its labels and cost tags are dev's and change on dev's routes. Found by the end-of-slice walk. Live app host (jsdom).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
function sources() { const s = clone(SOURCES); for (const p of s.history.pipelines) p.projectKey = 'web-1'; return s; }
const STATE = { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: null, branch: null, totalCostUsd: null, totalActiveMs: null, prompt: 'Page the audit log by 50',
  labels: ['infra'], tags: [{ key: 'team', value: 'web' }] };
const read = (u) => (u === '/api/history/web-1/h2' ? [200, { state: STATE }] : null);
const card = (d) => d.querySelector('#card');
const sent = (calls) => posts(calls).filter(([m, u]) => m !== 'GET' && !/^\/api\/ask\//.test(u));
async function page() {
  const h = await liveHost({ sources: sources(), read, write: (u, b) => [200, b] });
  await go(h.w, '#run/h2', 200); await settle(400);
  return h;
}

test('a finished task with no branch, time or cap draws none of the design\'s: no sample branch, $120, ask or project; no Stop', async () => {
  const { d } = await page();
  const t = card(d).textContent;
  assert.doesNotMatch(t, /feat\/unified-page-navigation|of \$120|One head for the task|worca-cc|Started 25 Oct/);
  assert.match(t, /Page the audit log by 50/, 'what was asked is the task\'s own prompt');
  card(d).querySelector('[data-menu="act"]')?.click(); await settle(20);
  assert.ok(![...card(d).querySelectorAll('[data-menu-pick]')].some((x) => /Stop/.test(x.textContent)), 'a finished task has nothing to stop');
  assert.equal(card(d).querySelectorAll('[data-say]').length, 0, 'no stand-in on a live page');
});

test('labels and cost tags are the task\'s own, and a change is dev\'s PUT labels or PUT tags', async () => {
  const { d, calls } = await page();
  const chips = () => card(d).querySelector('.rc-tags')?.textContent || '';
  assert.match(chips(), /infra/);
  assert.match(chips(), /team: web/);
  card(d).querySelector('[data-tagzone]').click(); await settle(20);
  const inp = card(d).querySelector('#tag-input');
  inp.value = 'hotfix'; inp.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(80);
  const inp2 = card(d).querySelector('#tag-input');   // the editor stays open for the next one
  inp2.value = 'client: acme'; inp2.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(80);
  assert.deepEqual(sent(calls), [['PUT', '/api/runs/h2/labels', { labels: ['infra', 'hotfix'] }], ['PUT', '/api/runs/h2/tags', { tags: ['team:web', 'client:acme'] }]]);
});

test('a live run opened by its pipeline id reads its own parts: its setup offers Save as preset, its log is its own', async () => {
  const log = JSON.stringify({ source: 'agent', level: 'info', text: 'Edited the pager', ts: '2026-11-12T13:00:00Z', nodeId: 'n_impl' });
  const reads = (u) => (u === '/api/history/web-1/pa' ? [200, { state: { ...TASK_DETAILS.failed.state, id: 'pa', status: 'running' } }]
    : u === '/api/pipelines/pa/setup' ? [200, { setup: { workflowId: 'wf_default' } }] : u === '/api/history/web-1/pa/log' ? [200, log] : null);
  const h = await liveHost({ sources: sources(), read: reads });
  await go(h.w, '#run/pa', 200); await settle(400);
  const d = h.d;
  card(d).querySelector('[data-menu="more"]').click(); await settle(20);
  assert.ok(card(d).querySelector('[data-menu-pick="more:preset"]'), 'Save as preset');
  assert.deepEqual(h.w.RailTaskLive.parts('pa').log.map((l) => l.raw), ['Edited the pager']);
});

// web-UI review cycle 1: the live page drew the design's sample (steps' prices and models, skills, memory, worktree, "Open log
// at line 1,284", "Into dev"), the demo PR and base in its words (#959, dev), no cap from Settings, and the cap twice.
const RAW = (key, extra = {}) => ({ key, nodeId: `n_${key}`, agentKey: key, status: 'done', costUsd: 0.2, activeMs: 60000, ...extra });
const PREFLIGHT = { key: 'x:preflight:1', executionId: 'x:preflight:1', nodeId: 'preflight', agentKey: null, status: 'done' };
const CAPPED = { ...TASK_DETAILS.capped.state, projectKey: 'web-1', pipelineCapUsd: undefined, costCapUsd: null, capUsd: 0.5, totalCostUsd: 0.8,
  pauseDetail: 'pipeline cost limit reached ($0.80 >= $0.50)', branch: { source: 'main', feature: 'worca/5eed0001', branchKept: true },
  steps: [PREFLIGHT, RAW('planner'), RAW('plan_review', { status: 'paused' })] };
async function host(id, detail, { checks = null, write = () => [200, { ok: true }] } = {}) {
  const s = sources();
  const row = s.history.pipelines.find((p) => p.id === id);
  if (detail.pauseReason) { row.status = 'paused'; row.pauseReason = detail.pauseReason; row.pauseDetail = detail.pauseDetail; }
  if (detail.pr) row.pr = detail.pr;
  const h = await liveHost({ sources: s, write, read: (u) => (u === `/api/history/web-1/${id}` ? [200, { state: detail }] : checks && u.startsWith(`/api/pr/checks?id=${id}`) ? [200, checks] : null) });
  h.w.RailUI.prefs.setMode('expert');
  await go(h.w, `#run/${id}`, 200); await settle(400);
  return h;
}

test('a capped task in Expert: no sample step prices, models, skills, memory, worktree, log line or "Into dev"; Build is not done; the cap shows once', async () => {
  const { w, d } = await host('h1', CAPPED);
  const part = card(d).querySelector('[data-key="tab:activity"]'); if (part && part.dataset.tab === 'activity') { part.click(); await settle(60); }
  const t = card(d).textContent;
  assert.doesNotMatch(t, /\$41\.52|\$67\.73|\$7\.82|Opus 5\.5|skills mounted|memory changes|frontend-design|run-7b0bfb1e|line 1,284|Into dev/);
  assert.equal(w.RailTaskLive.detail('h1').stages.find((x) => x.key === 'build').state, 'next', 'the preflight bookend is no Build step');
  assert.match(t, /\$0\.80/);
  assert.match(t, /of \$0\.50/, 'the Cost figure carries the Settings cap');
  assert.doesNotMatch(t, />=|cost limit reached \(/, 'the head never repeats the cap\'s numbers');
  card(d).querySelector('[data-key="act-main"]').click(); await settle(40);
  assert.equal(d.querySelector('#fd-value').value, '$0.50', 'Raise the cap starts at the Settings cap');
  assert.match(card(d).textContent, /It is at \$0\.50/);
});

// web-UI review cycle 2: the live page drew the design's fixed step lists (Refine plan, Plan review, Manual tests checklist,
// Manual web UI testing) with their marks, not the task's workflow
const NODE = (id, label, progressStage, kind = 'agent') => ({ id, kind, key: id.slice(2), label, ...(progressStage ? { progressStage } : {}) });
const GRAPH = (...nodes) => ({ version: 2, template: { id: 'wf' }, graph: { nodes, wires: [] } });
const pageView = (w, id) => { const run = w.RunCardModel.liveRun({ ...w.RailTaskLive.detail(id), id }); return JSON.parse(JSON.stringify(w.RunCardModel.view(run.id, { run }))); };   // out of the page's realm
const ROW = (nodeId, status, n = 1) => ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, agentKey: nodeId.slice(2), status, costUsd: 0.4 });
test('the page draws the task\'s own workflow steps and marks: no design step list, no Build done that never ran', async () => {
  const stepper = GRAPH(NODE('n_task', 'Task', '', 'task'), NODE('n_clarify', 'Clarify', 'plan'), NODE('n_plan', 'Plan', 'plan'), NODE('n_impl', 'Implementation', 'build'), NODE('n_rev', 'Review Implementation', 'review'));
  const { w, d } = await host('h1', { ...CAPPED, stepper, steps: [PREFLIGHT, ROW('n_clarify', 'done'), ROW('n_plan', 'paused')] });
  const v = pageView(w, 'h1');
  const marks = v.activity.filter((x) => /^(plan|build|review)$/.test(x.key)).map((x) => [x.key, x.rows.map((y) => `${y.name}:${y.state}`)]);
  assert.deepEqual(marks.map(([k, rows]) => [k, rows.map((r) => r.split(':')[0])]), [['plan', ['Clarify', 'Plan']], ['build', ['Implementation']], ['review', ['Review Implementation']]]);
  assert.deepEqual(v.stages.filter((x) => /^(plan|build|review)$/.test(x.key)).map((x) => [x.key, x.cells]), [['plan', ['is-done', 'is-paused']], ['build', ['is-next']], ['review', ['is-next']]]);
  const t = card(d).textContent;
  assert.doesNotMatch(t, /Refine plan|Plan review|Manual tests checklist|Manual web UI testing/);
});

test('a Restart Build round draws its own workflow: no Plan, and Review is its one review step', async () => {
  const stepper = GRAPH(NODE('n_task', 'Task', '', 'task'), NODE('n_impl', 'Implementation', 'build'), NODE('n_rev', 'Review Implementation', 'review'));
  const done = { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: null, stepper, steps: [ROW('n_impl', 'done'), ROW('n_rev', 'done')] };
  const { w, d } = await host('h2', done);
  const v = pageView(w, 'h2');
  assert.deepEqual(v.stages.filter((x) => /^(plan|build|review)$/.test(x.key)).map((x) => [x.key, x.cells]), [['build', ['is-done']], ['review', ['is-done']]]);
  assert.doesNotMatch(card(d).textContent, /Clarify|Refine plan|Manual tests checklist|Manual web UI testing/);
});

test('a PR\'s words are its own: Merge #42 into main, Fix the 1 failing check on #43, Checks on #43 run again', async () => {
  const pr42 = { url: 'https://github.com/acme/web/pull/42', state: 'OPEN' }, pr43 = { url: 'https://github.com/acme/web/pull/43', state: 'OPEN' };
  const ok = { checks: { state: 'passing', total: 3, failed: 0, pending: 0 }, mergeable: 'MERGEABLE', base: 'main', reviews: [] };
  const a = await host('h2', { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: pr42, branch: { source: 'main', feature: 'worca/a', branchKept: true } }, { checks: ok, write: () => [200, { merged: true, pr: { url: pr42.url, state: 'MERGED' }, next: null }] });
  card(a.d).querySelector('[data-key="act-main"]').click(); await settle(40);
  assert.match(card(a.d).textContent, /Merge #42 into main\?/);
  card(a.d).querySelector('[data-confirm="yes"]').click(); await settle(120);
  assert.match(a.d.body.textContent, /Merged #42 into main/);
  assert.doesNotMatch(a.d.body.textContent, /#959|into dev/);
  const red = { checks: { state: 'failing', total: 5, failed: 1, pending: 0 }, mergeable: 'MERGEABLE', base: 'main', reviews: [], watch: { watching: false } };
  const b = await host('h2', { ...TASK_DETAILS.approved.state, projectKey: 'web-1', pr: pr43, branch: { source: 'main', feature: 'worca/b', branchKept: true } }, { checks: red, write: () => [200, { rerun: 1, failed: 0 }] });
  card(b.d).querySelector('[data-key="act-main"]').click(); await settle(40);
  assert.match(card(b.d).textContent, /Fix the 1 failing check on #43\?/);
  card(b.d).querySelector('[data-confirm="no"], [data-confirm="back"]')?.click(); await settle(40);
  card(b.d).querySelector('[data-menu="act"]').click(); await settle(30);
  [...card(b.d).querySelectorAll('[data-menu-pick]')].find((x) => /Re-run checks/.test(x.textContent)).click(); await settle(150);
  assert.match(b.d.body.textContent, /Checks on #43 run again/);
});

test('a live group\'s page draws its members\' own facts: no "worca-cc", sample times or "Into dev"', async () => {
  const GROUPS = { groups: [{ id: 'G1', kind: 'user', title: 'Audit log', members: [{ position: 1, title: 'Shipped', pipelineId: 'h2', pr: null }, { position: 2, title: 'Broke', pipelineId: 'h3', pr: null }], cost: { usd: 1.5 } }] };
  const h = await liveHost({ sources: sources(), read: (u) => (u === '/api/run-groups' ? [200, GROUPS] : null) });
  h.w.RailUI.prefs.setMode('expert');
  await go(h.w, '#run/group:G1', 200); await settle(400);
  const t = card(h.d).textContent;
  assert.match(t, /Audit log/);
  assert.doesNotMatch(t, /worca-cc|1h 57m|1h 26m|Into dev/);
});
