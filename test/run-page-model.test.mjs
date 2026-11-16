// test/run-page-model.test.mjs — the run page's cases say one consistent thing (docs/stillhet/thing-page.md): an action moves
// this run, and what a state shows follows the state. Reads the prototype's model with no browser, so a new case that
// contradicts itself fails here, before anyone opens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as R from '../ui/public/design-system/components/index.mjs';

const window = { StillhetUI: R, StillhetWould: (p) => 'Would ' + p };
vm.runInNewContext(readFileSync(new URL('../ui/public/stillhet/runs/run-page-model.js', import.meta.url), 'utf8'), { window, console, Math, Object, String, Set, JSON, parseFloat, Error });
const M = window.RunCardModel;
const ids = M.cases.map((c) => c.id);
const figure = (v, k) => (v.figs.find((f) => f.k === k) || {}).v;
const tab = (v, id) => v.tabs.find((t) => t.id === id);
const steps = (v) => v.activity.flatMap((st) => st.rows);
const stepsOf = (v, key) => (v.activity.find((st) => st.key === key) || { rows: [] }).rows;
const ran = (rows) => rows.some((y) => !/is-next/.test(y.rowCls));

// Labels the page answers itself, not the flow table: a list of what and why, never a silent pass.
const PAGE_ACTIONS = /^(Pause|Pause after this step|Stop the task|Stop task \d+|Re-plan the rest|Cancel the rest|Ask for changes|Revise|Create \d+ (stacked|separate) PRs instead|Create one PR instead|Previous question|worca-\w+ #\d+)$/;

test('rows and tabs follow the state: what a case shows does not contradict it', () => {
  for (const id of ids) {
    const v = M.view(id, {});
    const group = v.runs.length > 0;
    if (!group && !ran(stepsOf(v, 'build'))) {
      assert.equal(figure(v, 'Changes'), undefined, `${id}: Build never ran, so no changes figure`);
      assert.ok(!tab(v, 'changes'), `${id}: Build never ran, so no Changes tab`);
    }
    if (!v.has.started) {
      assert.ok(!v.ask ? !tab(v, 'decisions') : true, `${id}: never started, so no decisions`);
      assert.equal(v.over.artifacts.length, 0, `${id}: never started, so no documents`);
      assert.equal(v.agents.length, 0, `${id}: never started, so no agents`);
      assert.equal(v.has.try, false, `${id}: never started, nothing to try`);
    }
    if (v.gone) {
      for (const k of ['try', 'worktree', 'report']) assert.equal(v.has[k], false, `${id}: gone, so no ${k}`);
      assert.equal(figure(v, 'Changes'), undefined, `${id}: gone, so no diff`);
    }
    if (v.has.logsGone) assert.equal(v.logs.length, 0, `${id}: the logs went with the worktree`);
    if (v.over.ask) assert.ok(v.finished && steps(v).filter((y) => !/^(pr|merged)/.test(y.ref)).length, `${id}: did what you asked only once finished`);
    if (/^\d+ open issues/.test(v.detail) || /End not reached|No files changed/.test(v.detail)) assert.equal(v.over.ask, null, `${id}: "${v.detail}" beside "Did all parts"`);
    for (const y of steps(v)) assert.ok(y.name !== 'Up to date with dev', `${id}: a step named for what is not so`);
    if (!v.place.branch && !v.place.folder) assert.equal(v.has.worktree, false, `${id}: no git and no folder, so no worktree`);
    const cap = /cap of \$(\d+)|the \$(\d+) cap/.exec(v.detail);
    if (cap) { const n = cap[1] || cap[2]; assert.equal(figure(v, 'Cost'), `$${n}.00`, `${id}: reached the $${n} cap`); assert.equal(v.figs.find((f) => f.k === 'Cost').of, `of $${n}`, id); }
    if (/No model was called/.test(v.detail)) assert.equal(figure(v, 'Cost'), '$0.00', id);
  }
});

test('every action a case offers leads somewhere, once', () => {
  for (const id of ids) {
    const v = M.view(id, {}); if (!v.action) continue;
    const labels = [v.action.label, ...v.action.items.map((x) => x.text)];
    assert.equal(new Set(labels).size, labels.length, `${id}: ${labels} repeats a step`);
    for (const l of labels) assert.ok(v.flow[l] || PAGE_ACTIONS.test(l) || v.runFlow[l], `${id}: ${l} leads nowhere`);
  }
});

test('an action moves this run: a pause keeps its title, step, time, cost and branch, and Resume returns', () => {
  for (const id of ['working', 'parallel', 'roles-live', 'noreview', 'source', 'slice']) {
    const before = M.view(id, {});
    const moved = M.move({ caseId: id }, 'paused-you', {});
    const paused = M.view(moved.id, { run: moved, parent: before.parent });
    assert.equal(paused.word, 'Paused', id);
    assert.match(paused.detail, /Paused by you/, id);
    for (const k of ['title']) assert.equal(paused[k], before[k], `${id}: ${k}`);
    assert.equal(paused.place.branch, before.place.branch, id);
    assert.equal(figure(paused, 'Time'), figure(before, 'Time'), id);
    assert.equal(figure(paused, 'Cost'), figure(before, 'Cost'), id);
    const back = M.move({ caseId: moved.id, run: moved }, 'working', {});
    assert.equal(back.id, id, `${id}: Resume returns to where it was`);
  }
});

test('an action moves this run: its own facts survive every state it can reach', () => {
  for (const id of ids) {
    const v = M.view(id, {});
    for (const [label, f] of Object.entries(v.flow)) {
      if (!f || typeof f !== 'object' || !f.to) continue;
      const moved = M.move({ caseId: id }, f.to, f);
      const after = M.view(moved.id, { run: moved, parent: v.parent });
      assert.equal(after.title, v.title, `${id} › ${label}: the title`);
      if (!v.runs.length && !after.runs.length) { assert.equal(after.place.branch, v.place.branch, `${id} › ${label}: the branch`); assert.equal(after.place.folder, v.place.folder, `${id} › ${label}: the folder`); }
      if (f.step !== 'fresh' && f.to !== 'outline') assert.ok(parseFloat(String(figure(after, 'Cost')).slice(1)) + 0.005 >= parseFloat(String(figure(v, 'Cost')).slice(1)) || /^(plan|outline)/.test(f.to), `${id} › ${label}: cost went back, ${figure(v, 'Cost')} to ${figure(after, 'Cost')}`);
      if (v.runs.length && f.to !== 'outline') assert.ok(after.runs.length, `${id} › ${label}: a group stays on its group page`);
    }
  }
});

test('archive keeps the real state, and restore returns to it', () => {
  const moved = M.move({ caseId: 'ready' }, 'archived', {});
  const v = M.view(moved.id, { run: moved });
  assert.equal(v.word, 'Archived');
  assert.equal(v.place.merged, false, 'a run never merged does not read merged');
  assert.equal(M.restored({ caseId: moved.id, run: moved }).id, 'ready');
});

test('a waiting run that is deleted is Cancelled, this run, and has no changes', () => {
  const moved = M.move({ caseId: 'scheduled' }, 'ticket-canceled', {});
  const v = M.view(moved.id, { run: moved });
  assert.equal(v.word, 'Cancelled');
  assert.equal(v.title, M.view('scheduled', {}).title);
  assert.ok(!tab(v, 'changes'));
});

test('a group\'s figures add up from its runs', () => {
  assert.equal(figure(M.view('group-ready', {}), 'Changes'), '+158 −62');
  assert.equal(figure(M.view('featureready', {}), 'Changes'), '+358 −144');
});

test('Stillhet Tasks words (D15, D16): a ready task offers Create PR, only an approved one Merge; no label, flow key or help says "yourself"', async () => {
  const R = await import('../ui/public/design-system/components/run-state.mjs');
  assert.deepEqual(R.cardAction('ready'), { label: 'Create PR', does: 'pr' });
  assert.deepEqual(R.cardAction('approved'), { label: 'Merge', does: 'merge' });
  const src = (await import('node:fs')).readFileSync(new URL('../ui/public/design-system/components/run-state.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /yourself/);
  for (const id of R.stateIds()) {
    const s = R.runState(id);
    for (const t of [s.action?.label, ...(s.action?.items || [])].filter(Boolean)) assert.doesNotMatch(t, /yourself/, `${id}: ${t}`);
    for (const k of Object.keys(R.actionFlow(id, {}))) assert.doesNotMatch(k, /yourself/, `${id} flow ${k}`);
  }
  const { workingWord } = await import('../ui/public/design-system/components/step-flow.mjs');
  assert.equal(workingWord('Pause after this step'), 'Pausing after this step');
});

test('failureOf: a reason that ends its own sentence gets no second period (web-UI review cycle 2)', () => {
  assert.equal(R.failureOf('Raise the cap', 'the new cap is below what the task already spent ($0.80).').detail, 'The new cap is below what the task already spent ($0.80). Nothing changed.');
  assert.equal(R.failureOf('Merge', 'GitHub refused').detail, 'GitHub refused. Nothing changed.');
});

// The live kind (feature 1 audit fix pass, D9, D10): liveRun keeps the prototype's step shape and gives each step the line
// dev's own data says, never the design's sample.
const page = (o) => Object.assign({ id: 'p1', case: 'working', title: 'T', project: 'web', branch: 'feat/x', base: 'dev', pr: '', detail: '', why: [], cost: 1, mins: 3, stages: [], review: { roles: [], issues: [] }, checks: null, failure: null }, o);
const subsOf = (run, key) => (run.stages.find((x) => x.key === key) || { subs: [] }).subs;
const J = (x) => JSON.parse(JSON.stringify(x));   // the model lives in its own vm realm
test('liveRun: a stopped step is the paused look, Stopped by you; never a "stopped" step state', () => {
  const run = M.liveRun(page({ case: 'stopped', stages: [{ key: 'plan', state: 'done', steps: [{ name: 'Plan', state: 'done' }] }, { key: 'build', state: 'stopped', steps: [{ name: 'implementer', state: 'stopped' }] }] }));
  assert.deepEqual(J(subsOf(run, 'build').map((x) => [x.name, x.state, x.live])), [['implementer', 'paused', 'Stopped by you']]);
  assert.ok(subsOf(run, 'plan').length, 'its Plan stays');
  assert.ok(!run.stages.flatMap((x) => x.subs).some((x) => x.state === 'stopped'));
});
test('liveRun: a plan waiting for approval opens on a step that asks, "Waiting for your approval"; its findings are the run\'s own', () => {
  const roles = [{ role: 'QA', n: 1, t: '1 finding', findings: ['qa: mock finding'] }];
  const run = M.liveRun(page({ case: 'plan', stages: [{ key: 'plan', state: 'done', steps: [{ name: 'Clarify', state: 'done' }, { name: 'Plan', state: 'done' }, { name: 'Refine plan', state: 'done' }] }] , review: { roles, issues: [] } }));
  const asks = subsOf(run, 'plan').filter((x) => x.state === 'ask');
  assert.deepEqual(J(asks.map((x) => x.live)), ['Waiting for your approval']);
  const v = M.view('plan', { run });
  assert.deepEqual(J(v.under.roles), roles);
  assert.notDeepEqual(J(M.view('plan', { run: M.liveRun(page({ case: 'plan', stages: [{ key: 'plan', state: 'now', steps: [{ name: 'Plan', state: 'now' }] }] })) }).under.roles), J(M.view('plan', {}).under.roles), 'never DETAIL.roles');
  assert.deepEqual(J(M.view('plan', { run: M.liveRun(page({ case: 'plan', stages: [{ key: 'plan', state: 'now', steps: [{ name: 'Plan', state: 'now' }] }] })) }).under), { issues: [], roles: [] });
});
test('liveRun: a capped task\'s paused step reads Paused at its cap; Create PR and Checks read the PR\'s own facts', () => {
  const capped = M.liveRun(page({ case: 'capped', stages: [{ key: 'build', state: 'paused', steps: [{ name: 'implementer', state: 'paused' }] }] }));
  assert.equal(subsOf(capped, 'build')[0].live, 'Paused at its cap');
  const done = [{ key: 'build', state: 'done', steps: [{ name: 'implementer', state: 'done' }] }];
  const failing = M.liveRun(page({ case: 'failing', pr: '#43', checks: { total: 3, failed: 2, pending: 0 }, stages: done }));
  assert.deepEqual(J(subsOf(failing, 'pr').slice(0, 2).map((x) => x.live)), ['Opened #43', '2 failed']);
  const approved = M.liveRun(page({ case: 'approved', pr: '#42', checks: { total: 3, failed: 0, pending: 0 }, stages: done }));
  assert.deepEqual(J(subsOf(approved, 'pr').slice(0, 2).map((x) => x.live)), ['Opened #42', '3 of 3 passed']);
});
test('liveRun: a failure is the prototype\'s bold title and its rows, and the head keeps no failure text', () => {
  const run = M.liveRun(page({ case: 'failed', failure: { head: 'Build · 3 tests failed', rows: ['a', 'b', 'c'] }, why: ['✗ a', '✗ b', '✗ c'], stages: [{ key: 'build', state: 'failed', steps: [{ name: 'implementer', state: 'failed' }] }] }));
  window.StillhetTaskLive = { parts: () => ({}) };   // the live kind's parts (task-live.mjs), empty here
  const v = M.view('failed', { run });
  delete window.StillhetTaskLive;
  assert.equal(v.over.focus.kind, 'broke');
  assert.deepEqual(J([v.over.focus.ev.title, v.over.focus.ev.lines]), ['Build · 3 tests failed', ['a', 'b', 'c']]);
  assert.equal(run.detail, '');
});
test('liveRun: a failed task\'s held step wears the failed look, with what broke as its line', () => {
  const run = M.liveRun(page({ case: 'failed', failure: { head: 'Build · 3 tests failed', rows: ['a'] }, stages: [{ key: 'build', state: 'paused', steps: [{ name: 'Implementation', state: 'paused' }] }] }));
  assert.deepEqual(J(subsOf(run, 'build').map((x) => [x.state, x.live])), [['failed', '3 tests failed']]);
});

// B1.6 (#1318): a live task at its review gate, and a review forced on with open issues
const GATE_ISSUES = [{ sev: 'Major', t: 'The pager loses its place', at: 'ui/pager.mjs:42' }];
const gatePage = (o) => page(Object.assign({ case: 'gate', detail: 'Review implementation reached its cycle limit',
  gate: { id: 'gate-w5-3', nodeId: 'n_rev', issues: GATE_ISSUES, count: 1, line: '1 open issue: accept as is, or run another cycle?' },
  review: { roles: [], issues: GATE_ISSUES },
  stages: [{ key: 'plan', state: 'done', steps: [{ name: 'Plan', state: 'done' }] }, { key: 'build', state: 'done', steps: [{ name: 'Implementation', state: 'done' }] },
    { key: 'review', state: 'ask', steps: [{ name: 'Review implementation', state: 'ask' }, { name: 'Manual tests checklist', state: 'next' }] }] }, o));
test('O1, O4: liveRun draws the asking step in Review with the gate\'s line, and the page opens on Review', () => {
  const run = M.liveRun(gatePage());
  assert.deepEqual(J(subsOf(run, 'review').map((x) => [x.name, x.state, x.live])), [['Review implementation', 'ask', '1 open issue: accept as is, or run another cycle?'], ['Manual tests checklist', 'next', '']]);
  assert.ok(!subsOf(run, 'plan').some((x) => x.state === 'ask'), 'Plan asks nothing');
  assert.equal(run.over, false, 'a task waiting at its gate is not over');
  const v = M.view('gate', { run });
  assert.equal(v.open.key, 'review');
  assert.deepEqual(J(v.under), { issues: GATE_ISSUES, roles: [] }, 'the gate\'s own rows, never DETAIL.issues');
  assert.deepEqual(J([v.over.focus.issues, v.over.focus.roles]), [GATE_ISSUES, []], 'the Overview focus reads the run\'s own review (D8)');
  assert.equal(v.ask, null, 'no design sample question');
  window.StillhetTaskLive = { parts: () => ({}) };   // with the live kind's parts the focus is the task's own failure only (liveOver)
  const lp = M.view('gate', { run });
  delete window.StillhetTaskLive;
  assert.equal(lp.over.focus, null);
  // a stage with no known steps draws its ask as one asking step
  const bare = M.liveRun(gatePage({ stages: [{ key: 'review', state: 'ask', steps: [] }] }));
  assert.deepEqual(J(subsOf(bare, 'review').map((x) => [x.state, x.live])), [['ask', '1 open issue: accept as is, or run another cycle?']]);
});
test('O2: a blocked live step is a problem step with its open-issue line, not a tick', () => {
  const run = M.liveRun(page({ case: 'working', stages: [{ key: 'build', state: 'done', steps: [{ name: 'Implementation', state: 'done' }] },
    { key: 'review', state: 'done', steps: [{ name: 'Review implementation', state: 'blocked', open: 2 }, { name: 'Manual tests checklist', state: 'done' }] }] }));
  assert.deepEqual(J(subsOf(run, 'review').map((x) => [x.state, x.live])), [['problem', 'Blocked · accepted with 2 open issues'], ['done', '']]);
  const one = M.liveRun(page({ stages: [{ key: 'review', state: 'done', steps: [{ name: 'Review implementation', state: 'blocked', open: 1 }] }] }));
  assert.equal(subsOf(one, 'review')[0].live, 'Blocked · accepted with 1 open issue');
  assert.notEqual(R.stageState(subsOf(run, 'review')), 'done', 'the Review stage is not ticked');
});
test('O2: the prototype\'s ready-issues case draws its blocked review as a problem', () => {
  const y = stepsOf(M.view('ready-issues', {}), 'review')[0];
  assert.deepEqual(J([y.name, y.rowCls, y.live, y.loops]), ['Review implementation', 'is-problem', 'Blocked · accepted with 2 open issues', 3]);
});

test('B1.7: the prototype\'s "Ready, base unknown" offers no Create PR and names no base; a live page never takes the sample base', () => {
  assert.ok(ids.includes('no-base'), 'the case is in the picker');
  const v = M.view('no-base', {});
  const labels = [v.action.label, ...v.action.items.map((x) => x.text)];
  assert.ok(!labels.some((l) => /^Create/.test(l)), labels.join());
  assert.equal(v.place.base, '');
  assert.equal(v.detail, 'Base unknown: Worca cannot tell where to open a PR');
  assert.equal(M.view('ready', {}).place.base, 'dev', 'I6: the demo keeps its sample base');
  const live = M.liveRun({ id: 'pz', case: 'ready', title: 'Fin', branch: 'feat/x', base: '', stages: [], review: { roles: [], issues: [] } });
  assert.equal(M.view(live.id, { run: live }).place.base, '', 'a live task with no base shows none');
});

test('F-a4-03: liveRun of a running task with no steps yet is not over when liveRunning, and offers Pause and Stop; without liveRunning (or with a question) it is over', () => {
  const idle = ['plan', 'build', 'review'].map((key) => ({ key, state: 'next', steps: [] }));
  const run = M.liveRun(page({ case: 'working', liveRunning: true, stages: idle }));
  assert.equal(run.over, false, 'a running task whose steps have not arrived is not over');
  const v = M.view(run.id, { run });
  assert.equal(v.action.label, 'Pause');
  assert.ok(v.action.items.some((x) => x.text === 'Stop the task'), J(v.action.items.map((x) => x.text)));
  const before = M.liveRun(page({ case: 'working', stages: idle }));
  assert.equal(before.over, true, 'without liveRunning (pipeline unknown, or waiting on a question) it reads as today');
  assert.equal(M.view(before.id, { run: before }).action, null);
});

const grp = (cases, o = {}) => M.liveGroup({ id: 'G', title: 'Pager', kind: 'Feature', cost: 0, members: cases.map((c, i) => ({ pipelineId: c ? 'p' + i : '', title: 'Task ' + (i + 1), case: c, pr: '', prUrl: '', cost: 0, ...(o[i] || {}) })) });
test('liveGroup (F-a4-09): one ready member and two not started reads Waiting, never Working', () => {
  const g = grp(['ready', '', '']);
  assert.equal(g.word, 'Waiting');
  assert.equal(g.state, 'scheduled');
  assert.equal(g.action, null, 'the group\'s own action only: no Create PR before every task is ready');
  window.StillhetTaskLive = { parts: () => ({}) };
  const v = M.view(g.id, { run: g });
  delete window.StillhetTaskLive;
  assert.ok(!v.action || ![v.action.label, ...v.action.items.map((x) => x.text)].includes('Start now'), 'a waiting group never offers Start now');
});
test('liveGroup (F-a4-09): the head follows its members', () => {
  const rows = [
    [['ready', 'working', ''], 'Working'], [['starting', ''], 'Working', 'feature'],
    [['ready', 'question', ''], 'Needs you', 'question'], [['ready', 'stopped', ''], 'Stopped'], [['ready', 'ready'], 'Ready'],
    [['ready', 'failed', ''], 'Needs you', 'chain'], [['merged', 'merged'], 'Merged'], [['zzz-unknown'], 'Ready', 'featureready'],
    [['merged', 'ready'], 'Ready', 'ready'],
  ];
  for (const [cases, word, state] of rows) {
    const g = grp(cases);
    if (state) assert.equal(g.state, state, J(cases));
    assert.equal(g.word, word, J(cases));
  }
  assert.equal(grp(['approved', 'ready'], { 0: { pr: '#41', prUrl: 'u' } }).state, 'ship-applied', 'a member with a PR and none left to start: unchanged');
});
test('view (F-a4-11): a live failed task with restartOff: Restart Build is off and says why', () => {
  const why = 'Needs a plan: this task saved none to build from';
  const run = M.liveRun(page({ case: 'failed', restartOff: why, stages: [{ key: 'build', state: 'failed', steps: [{ name: 'implementer', state: 'failed' }] }] }));
  assert.equal(run.restartOff, why);
  window.StillhetTaskLive = { parts: () => ({}) };
  const v = M.view('failed', { run });
  const on = M.view('failed', { run: M.liveRun(page({ case: 'failed', stages: [{ key: 'build', state: 'failed', steps: [{ name: 'implementer', state: 'failed' }] }] })) });
  delete window.StillhetTaskLive;
  assert.equal(v.action.label, 'Restart Build');
  assert.equal(v.action.offWhy, why);
  assert.equal(on.action.offWhy, '', 'without a reason it is offered');
});

// B4.1: the live page's Decisions and each step's own time, cost and rounds
const DECIDED = [{ step: 'Clarify', q: 'Keep the old address?', a: 'Redirect it', who: 'you' }, { step: 'Implementation · cycle 2', q: 'Split?', a: 'No', who: 'away', note: 'please check: Smaller' }];
test('F-3-04: liveRun passes the task\'s decisions; view shows the Decisions tab with its count; none is no tab', () => {
  const stages = [{ key: 'build', state: 'done', steps: [{ name: 'Implementation', state: 'done', activeMs: 0, costUsd: 0, cycles: 1, ran: true }] }];
  const run = M.liveRun(page({ case: 'ready', stages, decisions: DECIDED }));
  assert.deepEqual(J(run.decisions), DECIDED);
  const v = M.view('ready', { run });
  assert.equal(tab(v, 'decisions').n, '2');
  assert.deepEqual(J(v.tabData.decisions), DECIDED);
  const none = M.view('ready', { run: M.liveRun(page({ case: 'ready', stages })) });
  assert.ok(!tab(none, 'decisions'), 'no Q&A, no Decisions tab (never the design\'s sample)');
});

test('F-3-07: liveRun\'s subs carry each step\'s own time, loops and cost; a step that never ran has none', () => {
  const run = M.liveRun(page({ case: 'working', stages: [
    { key: 'plan', state: 'done', steps: [{ name: 'Plan', state: 'done', activeMs: 45000, costUsd: 0.25, cycles: 1, ran: true }] },
    { key: 'build', state: 'now', steps: [{ name: 'Implementation', state: 'now', activeMs: 180000, costUsd: 1.2, cycles: 3, ran: true }] },
    { key: 'review', state: 'next', steps: [{ name: 'Review implementation', state: 'next', activeMs: 0, costUsd: 0, cycles: 0, ran: false },
      { name: 'Manual tests', state: 'blocked', open: 1, activeMs: 60000, costUsd: 0, cycles: 2, ran: true }] }] }));
  const f = (x) => [x.name, x.time, x.loops, x.cost];
  assert.deepEqual(J(subsOf(run, 'plan').map(f)), [['Plan', '45s', 0, '$0.25']]);
  assert.deepEqual(J(subsOf(run, 'build').map(f)), [['Implementation', '3m', 3, '$1.20']]);
  assert.deepEqual(J(subsOf(run, 'review').map(f)), [['Review implementation', '', 0, null], ['Manual tests', '1m', 2, '$0.00']]);
  assert.equal(subsOf(run, 'review')[0].cost, undefined, 'never ran: no cost (J reads it as null)');
  // every branch keeps them: stopped, ask, capped, failed
  for (const [c, state, extra] of [['stopped', 'stopped', {}], ['working', 'ask', { ask: { id: 'q', questions: [{ q: 'Why?' }] } }], ['capped', 'paused', {}], ['failed', 'paused', { failure: { head: 'Build · broke', rows: [] } }]]) {
    const r = M.liveRun(page(Object.assign({ case: c, stages: [{ key: 'build', state, steps: [{ name: 'Implementation', state, activeMs: 120000, costUsd: 0.5, cycles: 2, ran: true }] }] }, extra)));
    assert.deepEqual(J(f(subsOf(r, 'build')[0])), ['Implementation', '2m', 2, '$0.50'], c + '/' + state);
  }
});

test('F-3-07: view\'s live Activity rows show the step\'s own cost, "so far" while it works; a next step and the model stay empty', () => {
  const run = M.liveRun(page({ case: 'working', stages: [
    { key: 'plan', state: 'done', steps: [{ name: 'Plan', state: 'done', activeMs: 45000, costUsd: 0.25, cycles: 1, ran: true }] },
    { key: 'build', state: 'now', steps: [{ name: 'Implementation', state: 'now', activeMs: 180000, costUsd: 1.2, cycles: 3, ran: true }] },
    { key: 'review', state: 'next', steps: [{ name: 'Review implementation', state: 'next', activeMs: 0, costUsd: 0, cycles: 0, ran: false }] }] }));
  const v = M.view('working', { run });
  const row = (k) => stepsOf(v, k)[0];
  assert.deepEqual(J([row('plan').cost, row('plan').time, row('plan').loops]), ['$0.25', '45s', 0]);
  assert.deepEqual(J([row('build').cost, row('build').time, row('build').loops]), ['$1.20 so far', '3m', 3]);
  assert.deepEqual(J([row('review').cost, row('review').time]), ['', '']);
  assert.ok(steps(v).every((y) => y.model === ''), 'dev\'s rows carry no model');
  assert.equal(v.graph.stages.find((s) => s.label.startsWith('Build')).nodes[0].meta, '3m', 'the graph\'s node meta is the step\'s time');
});

test('F-3-19, F-a4-13: plural says one count with one word', () => {
  assert.equal(M.plural(1, 'file'), '1 file');
  assert.equal(M.plural(2, 'file'), '2 files');
  assert.equal(M.plural(1, 'PR'), '1 PR');
  assert.equal(M.plural(0, 'doc'), '0 docs');
  assert.equal(M.plural(1, 'run waits', 'runs wait'), '1 run waits');
  assert.equal(M.plural(3, 'run waits', 'runs wait'), '3 runs wait');
});

test('F-3-19, F-a4-13: a ready group with one member left to open says "Create 1 PR", its flow holds that key and says "Created 1 PR"', () => {
  const g = grp(['checks', 'ready'], { 0: { pr: '#41', prUrl: 'u' } });
  assert.ok(g.flow['Create 1 PR'], Object.keys(g.flow).join());
  assert.equal(g.flow['Create 1 PR'].say, 'Created 1 PR');
  assert.ok(!Object.keys(g.flow).some((k) => /\b1 PRs\b/.test(k)));
  window.StillhetTaskLive = { parts: () => ({}) };
  const v = M.view(g.id, { run: g });
  delete window.StillhetTaskLive;
  assert.equal(v.action.label, 'Create 1 PR');
  assert.ok(v.flow[v.action.label], 'the label is the flow key');
});

test('F-3-19, F-a4-13: the Changes count names one document "1 doc"', () => {
  const run = M.liveRun(page({ case: 'ready', stages: [{ key: 'build', state: 'done', steps: [{ name: 'implementer', state: 'done' }] }] }));
  window.StillhetTaskLive = { parts: () => ({ changes: { files: [['a.js', 1, 0]], fileMeta: {}, hunks: {} }, docs: [['plan.md', 'Plan', 'docs/plan.md']] }) };
  const v = M.view(run.id, { run });
  delete window.StillhetTaskLive;
  const ch = v.tabs.find((t) => t.id === 'changes');
  assert.ok(ch, 'a Changes part');
  assert.equal(ch.n, '1 · 1 doc');
});

test('F-a4-12: prPushOf reads whether the branch was pushed from dev\'s /api/pr answer', () => {
  assert.equal(M.prPushOf({ status: 500, error: 'GitHub pull request failed: Validation Failed' }), 'pushed');
  assert.equal(M.prPushOf({ status: 500, error: 'git push failed: rejected' }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 500, error: 'git push was rejected: the remote branch moved' }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 409, error: 'the base branch dev is not on origin: fetch it first' }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 400, error: 'id is required' }), 'not-pushed');
  assert.equal(M.prPushOf({ error: 'Failed to fetch' }), 'unknown');
  assert.equal(M.prPushOf({}), 'unknown');
});

test('F-a4-12: prFailDetail says what dev\'s answer proves, never "Nothing changed" after a push', () => {
  assert.equal(M.prFailDetail('validation Failed', 'pushed'), 'Validation Failed. The branch is on the remote; no PR opened.');
  assert.equal(M.prFailDetail('validation Failed.', 'unknown'), 'Validation Failed. The branch may have been pushed; no PR opened.');
  assert.equal(M.prFailDetail('validation Failed', 'not-pushed'), R.failureOf('Create PR', 'validation Failed').detail);
  assert.equal(M.prFailDetail('validation Failed', 'pushed', { group: true }), 'Validation Failed. Some of its branches may have been pushed.');
  assert.equal(M.prFailDetail('validation Failed', 'unknown', { group: true }), 'Validation Failed. Some of its branches may have been pushed.');
  assert.equal(M.prFailDetail('validation Failed', 'not-pushed', { group: true }), 'Validation Failed. Nothing changed.');
});

test('V-TW-15: followUpBodyOf is newTaskBodyOf with the follow-up as the prompt and no source; after a task, dev\'s after and afterPolicy', async () => {
  const { newTaskBodyOf } = await import('../ui/public/stillhet/live/task-page.mjs');
  const state = { projectDir: '/w/web', prompt: 'Page the audit log', source: { type: 'github', ref: 'acme/web#7' }, workflowId: 'wf_lean', guardrailsId: 'strict', engine: 'codex', labels: ['infra', { name: 'ui' }], tags: [{ key: 'team', value: 'web' }] };
  assert.deepEqual(J(M.followUpBodyOf(state, 'Add paging tests')), J(newTaskBodyOf({ ...state, source: null, prompt: 'Add paging tests' })));
  assert.equal(M.followUpBodyOf(state, 'Add paging tests').source, undefined);
  const ws = { workspaceId: 'ws1', projectDir: '/w/x', stepper: { template: { id: 'wf_t' } }, runEngine: 'claude' };
  assert.deepEqual(J(M.followUpBodyOf(ws, 'Next')), J(newTaskBodyOf({ ...ws, source: null, prompt: 'Next' })));
  assert.deepEqual(J(M.followUpBodyOf(state, 'Add paging tests', 'p1')), { ...J(newTaskBodyOf({ ...state, source: null, prompt: 'Add paging tests' })), after: { kind: 'pipeline', id: 'p1' }, afterPolicy: 'done' });
});

// B5.6 review: dev's order. createRunPr's 422 provider refusal (kind unsupported) comes before pushBranch; its 422 after
// the push says "… pull request failed". POST /api/run-groups/:id/ship (ui/routes/runs/run-groups.mjs shipUserGroupNow)
// refuses with 400/409 before any member ships, and the one PR's own refusals are createRunPr's; but separate PRs ship
// member by member, so "could not create the PR for <task>" may follow PRs already opened and branches already pushed.
test('B5.6 review: prPushOf: a 422 before the push is not pushed; a group\'s part-way refusal proves nothing', () => {
  assert.equal(M.prPushOf({ status: 422, error: 'forks are not supported' }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 422, error: 'GitHub pull request failed: unsupported' }), 'pushed');
  assert.equal(M.prPushOf({ status: 409, error: 'could not create the PR for Task 2: the run has no base branch. Create PR again to continue.', group: true }), 'unknown');
  assert.equal(M.prPushOf({ status: 500, error: 'could not create the PR for Task 1: git push failed: rejected. Create PR again to continue.', group: true }), 'unknown');
  assert.equal(M.prPushOf({ status: 409, error: 'this group is already shipping', group: true }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 400, error: 'mode must be one or separate', group: true }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 500, error: 'git push failed: rejected', group: true }), 'not-pushed');
  assert.equal(M.prPushOf({ status: 500, error: 'GitHub pull request failed: x', group: true }), 'pushed');
});

// thing.one-source (fix 2): the demo's page is the task you opened, never its case's sample
test('a page lent to a task of the store shows that task\'s own branch, time, cost, line and findings', () => {
  const task = { id: 't1', title: 'Migrate cron parser', case: 'gate', stage: 2, branch: 'refactor/cron-parser', detail: 'Waits for your OK on the review', facts: { cost: '$6.10', time: '31 min' },
    why: ['Review passed with 2 small notes', 'A name in parser.mjs', 'A leap-year test'] };
  window.StillhetWorld = { rows: () => [{ id: 'r2', case: 'gate', title: 'Migrate cron parser', project: 'web-app', detail: 'Waits for your OK on the review', cost: 6.1, time: '13:40' }] };
  window.StillhetChats = { data: () => ({ chats: [{ id: 'c16', tasks: [task] }] }) };
  M.titles.gate = 'Migrate cron parser';
  try {
    const v = M.view('gate', {});
    assert.equal(v.own, true);
    assert.equal(v.title, 'Migrate cron parser');
    assert.equal(v.place.branch, 'refactor/cron-parser');
    assert.equal(v.crumbs[1].t, 'web-app');
    assert.equal(figure(v, 'Time'), '31 min'); assert.equal(figure(v, 'Cost'), '$6.10');
    assert.equal(v.detail, 'Waits for your OK on the review');
    assert.deepEqual(v.under.issues.map((x) => x.t), ['A name in parser.mjs', 'A leap-year test'], 'the findings are the task\'s, the same lines its card shows');
    assert.equal(v.under.roles.length, 0);
    assert.equal(v.over.checklist, null, 'no sample checklist');
    const text = JSON.stringify([v.stages, v.open, v.figs, v.detail, v.under, v.over.focus]);
    assert.doesNotMatch(text, /4h 15m|82\.65|sent it back 3 times|375px|37m 21s/, 'nothing of the case\'s sample is lent');
    // a task with no figures of its own shows none
    delete task.facts; window.StillhetWorld = { rows: () => [{ id: 'r2', case: 'gate', title: 'Migrate cron parser', project: 'web-app', detail: '', cost: null }] };
    const bare = M.view('gate', {});
    assert.equal(figure(bare, 'Time'), undefined); assert.equal(figure(bare, 'Cost'), undefined);
    // a task one minute into Plan is drawn at Plan, not at its case's sample Review
    Object.assign(task, { case: 'working', stage: 0, detail: 'Plan · writing the plan', why: undefined }); M.titles.working = 'Migrate cron parser';
    window.StillhetWorld = { rows: () => [{ id: 'r2', case: 'working', title: 'Migrate cron parser', project: 'web-app', detail: 'Plan · writing the plan', cost: null, time: 'now' }] };
    const early = M.view('working', {});
    assert.equal(early.stages.map((st) => (st.cells.some((c) => c !== 'is-next') ? 1 : 0)).join(''), '10000');
    assert.ok(!tab(early, 'changes'), 'Build has not run: no Changes');
    assert.equal(figure(early, 'Time'), '1 min');
  } finally { delete window.StillhetWorld; delete window.StillhetChats; delete M.titles.gate; delete M.titles.working; }
});

test('a case nobody opened as a task keeps its sample; the gate\'s step says cycles, never rounds', () => {
  const v = M.view('gate', {});
  assert.equal(v.own, false);
  assert.match(JSON.stringify(v.open), /after 3 cycles/);
  assert.doesNotMatch(JSON.stringify([v.open, v.over]), /\brounds?\b/);
});

test('the stage train at Ready is ink as far as the work has come: PR and Merged are not filled before there is a PR', () => {
  const html = R.stageBar({ labels: ['Plan', 'Build', 'Review', 'PR', 'Merged'], stage: 2, tone: 'ok', knot: () => ({}) });
  assert.deepEqual([...html.matchAll(/class="sb-stop is-(\w+)"/g)].map((m) => m[1]), ['done', 'done', 'done', 'next', 'next']);
  assert.match(html, /aria-label="Stage 3 of 5: Review, ready"/);
  const merged = R.stageBar({ labels: ['Plan', 'Build', 'Review', 'PR', 'Merged'], stage: 4, tone: 'merged', knot: () => ({}) });
  assert.equal([...merged.matchAll(/class="sb-stop is-done"/g)].length, 5);
});
