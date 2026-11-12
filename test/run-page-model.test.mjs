// test/run-page-model.test.mjs — the run page's cases say one consistent thing (docs/rail/thing-page.md): an action moves
// this run, and what a state shows follows the state. Reads the prototype's model with no browser, so a new case that
// contradicts itself fails here, before anyone opens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as R from '../ui/public/design-system/components/index.mjs';

const window = { RailUI: R, RailWould: (p) => 'Would ' + p };
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
