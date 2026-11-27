// test/ui-held-resume-words.test.mjs — Shaper slice 16 (R-qa-4): a run held for its turn reads that it waits, not
// "paused", on the Runs list's group line, in "More ways to resume" and on the chat run card's Resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildRunsModel, countNeedsYou, groupRow, listLine, needsYouItems, renderRunsList } from '../ui/public/runs-list.mjs';
import { activityCounts } from '../ui/public/activity-model.mjs';
// Namespace reads, so a missing new export fails only its own test, not the whole file.
import * as RS from '../src/shared/shape/run-status.mjs';
import * as FA from '../ui/public/shape/feature-actions.mjs';

const NOW = new Date(2026, 8, 30, 15, 0).getTime();

/** A marked feature as GET /api/run-groups sends it (the app's rows carry `run`): runs 1 and 2 done, run 3 in `three`,
 *  run 4 paused (`four` is its slice's extra facts), run 5 not started. */
function featureGroup({ three = 'done', four = { heldResume: { after: 3 } } } = {}) {
  const member = (position, status, slice = {}) => ({ position, title: `Slice ${position}`, pipelineId: `p${position}`, kind: 'hist',
    run: { status }, slice: { index: position, pipelineId: `p${position}`, state: status, ...slice } });
  return { id: 'feat_four', groupKind: 'feature', title: 'Five runs', smallRuns: true, members: [
    member(1, 'done'), member(2, 'done'), member(3, three), member(4, 'paused', four),
    { position: 5, title: 'Slice 5', ticketId: 't5', kind: 'sched', run: { ticket: { status: 'scheduled', after: { index: 4 } } },
      slice: { index: 5, state: 'planned' } }] };
}
const rowOf = (over) => groupRow(featureGroup(over), { now: NOW });
/** The `.resume-on-saved` small of a "More ways to resume" menu. */
const smallOf = (menu) => menu.querySelector('.resume-on-saved small');
/** The two menus as the shipped runs page declares them. */
function resumeMenus() {
  const { document } = new JSDOM(readFileSync(new URL('../ui/public/runs/runs.html', import.meta.url), 'utf8')).window;
  // The menus sit inside <template>s: search their contents too.
  const roots = [document, ...[...document.querySelectorAll('template')].map((t) => t.content)];
  return ['.rd-resume-menu', '.hd-resume-menu'].map((sel) => {
    const menu = roots.map((r) => r.querySelector(sel)).find(Boolean);
    assert.ok(menu, `runs.html has ${sel}`);
    assert.equal(smallOf(menu).textContent, 'Where it left off', `${sel}: as shipped`);
    // A <template>'s content has no window: adopt the menu into the page so a MutationObserver can watch it.
    if (menu.ownerDocument.defaultView) return menu;
    const live = document.importNode(menu, true);
    document.body.append(live);
    return live;
  });
}

test('s16: run 4 waiting for run 3 reads "waiting for its turn" on the group line, in More ways to resume and on the chat card\'s Resume', () => {
  const row = rowOf({ three: 'running' });
  const line = listLine(row, { section: 'needs' });
  assert.equal(line, 'Run 4 waiting for its turn');
  assert.doesNotMatch(line, /paused/i);

  const slices = featureGroup().members.map((m) => m.slice);
  assert.equal(typeof RS.heldAfterOf, 'function', 'run-status.mjs exports heldAfterOf');
  const heldAfter = RS.heldAfterOf(slices, 'p4');
  assert.equal(heldAfter, 3);
  assert.equal(typeof FA.paintResumeMenuTurn, 'function', 'feature-actions.mjs exports paintResumeMenuTurn');
  for (const menu of resumeMenus()) {
    FA.paintResumeMenuTurn(menu, heldAfter);
    assert.equal(smallOf(menu).textContent, 'Waiting for its turn after run 3');
  }
  assert.equal(RS.resumeLabel(null, { heldAfter }), 'Waiting for its turn');
});

test('s16 D7: with run 4 held and another run current, every section\'s group line reads "Run 4 waiting for its turn"', () => {
  const row = rowOf({ three: 'running' });
  assert.equal(row.model.current, row.members[2].model, 'the fixture: run 3 is the current member');
  for (const section of ['needs', 'running', '']) assert.equal(listLine(row, { section }), 'Run 4 waiting for its turn', `section "${section}"`);
});

test('s16 D7: with run 4 held and current, the group line reads "Waiting for its turn · Run 4" and the model line "Run 4 of 5 · waiting for its turn"', () => {
  const row = rowOf();
  assert.equal(row.model.current, row.members[3].model, 'the fixture: run 4 is the current member');
  for (const section of ['needs', 'running', '']) assert.equal(listLine(row, { section }), 'Waiting for its turn · Run 4', `section "${section}"`);
  assert.equal(row.model.line, 'Run 4 of 5 · waiting for its turn');
});

// Owner direction d8b70366c (replaces the plan's D8): a run whose resume or answer the person already gave and that is
// only held for its turn does not need the person: it leaves Needs you, the group line still says it waits.
const historyOf = (three, four = 'paused') => [1, 2, 3, 4].map((n) => ({ id: `p${n}`, projectKey: 'k-00000001', title: `Slice ${n}`,
  status: n === 4 ? four : n === 3 ? three : 'done', pauseReason: null, startedAt: new Date(NOW - 3600000).toISOString(), mtime: 0,
  groupName: 'k', by: '', pr: null, checks: null, files: null, run: { status: n === 4 ? four : n === 3 ? three : 'done' } }));

test('s16 direction: the held run leaves Needs you; its group row says once that it waits, never "paused"', () => {
  for (const [three, want] of [['running', 'Run 4 waiting for its turn'], ['done', 'Waiting for its turn · Run 4']]) {
    const model = buildRunsModel({ history: historyOf(three), groups: [featureGroup({ three })], now: NOW });
    const needs = model.sections.find((s) => s.id === 'needs');
    assert.ok(!needs?.rows.some((r) => r.key === 'chain:feat_four'), `${three}: the held run is not in Needs you`);
    assert.equal(model.counts.needs, 0, three);
    assert.ok(model.sections.some((s) => s.rows.some((r) => r.key === 'chain:feat_four')), `${three}: the group is still listed`);
    const doc = new JSDOM('<!doctype html><body></body>').window.document;
    doc.body.append(...renderRunsList(doc, model));
    const sub = doc.querySelector('.runs-item[data-row-key="chain:feat_four"] > a.runs-row > .runs-row-sub').textContent;
    assert.equal(sub, want, three);
    assert.doesNotMatch(sub, /paused/i, three);
  }
});

test('s16 direction: the Runs badge and Activity do not count a held resume or a held answer', () => {
  const resumeHeld = { history: historyOf('done'), groups: [featureGroup()] };
  assert.equal(countNeedsYou(resumeHeld), 0, 'held resume');
  assert.deepEqual(needsYouItems(resumeHeld).history, []);
  assert.equal(activityCounts(resumeHeld).needs, 0);
  // A held answer: run 4 is live and asks, its stop answer held after run 3.
  const answerHeld = { live: [{ runId: 'r4', pipelineId: 'p4', status: 'running', ask: true }], history: historyOf('running', 'running'),
    active: [{ runId: 'r4' }], groups: [featureGroup({ three: 'running', four: { state: 'running', stop: { held: true, after: 3 } } })] };
  assert.equal(countNeedsYou(answerHeld), 0, 'held answer');
  assert.deepEqual(activityCounts(answerHeld), { needs: 0, running: 1 }, 'Activity lists the held answer under Running');
});

test('s16 direction: a feature with another reason to need you still counts it', () => {
  const g = featureGroup({ three: 'paused' });             // run 3 paused on its own: it needs you
  const history = historyOf('paused');
  assert.equal(countNeedsYou({ history, groups: [g] }), 1, 'run 3 counts, held run 4 does not');
  const model = buildRunsModel({ history, groups: [g], now: NOW });
  assert.ok(model.sections.find((s) => s.id === 'needs')?.rows.some((r) => r.key === 'chain:feat_four'));
});

test('s16 direction, flag off: the server sends no slice and app.js no groups, so a paused run still needs you', () => {
  const g = featureGroup();
  const flagOff = { ...g, smallRuns: undefined, members: g.members.map(({ slice, ...m }) => m) };
  assert.equal(countNeedsYou({ history: historyOf('done') }), 1, 'no groups passed (flag off)');
  assert.equal(countNeedsYou({ history: historyOf('done'), groups: [flagOff] }), 1);
  assert.equal(activityCounts({ history: historyOf('done') }).needs, 1);
  const model = buildRunsModel({ history: historyOf('done'), groups: [flagOff], now: NOW });
  assert.ok(model.sections.find((s) => s.id === 'needs')?.rows.some((r) => r.key === 'chain:feat_four'), 'stays in Needs you');
  assert.equal(listLine(groupRow(flagOff, { now: NOW }), { section: 'needs' }), 'Paused · Run 4');
});

test('s16 D7: a paused run of a marked feature that is not held reads as today', () => {
  assert.equal(listLine(rowOf({ three: 'running', four: {} }), { section: 'needs' }), 'Run 4 paused');
  assert.equal(listLine(rowOf({ four: {} }), { section: 'needs' }), 'Paused · Run 4');
  assert.equal(rowOf({ four: {} }).model.line, 'Run 4 of 5 · paused');
});

test('s16 D10: paintResumeMenuTurn writes only a changed text, restores "Where it left off", and ignores a missing menu or item', () => {
  assert.equal(typeof FA.paintResumeMenuTurn, 'function', 'feature-actions.mjs exports paintResumeMenuTurn');
  const [menu] = resumeMenus();
  const others = () => [...menu.querySelectorAll('.menu-item:not(.resume-on-saved)')].map((b) => b.textContent);
  const before = others();
  const seen = new (menu.ownerDocument.defaultView.MutationObserver)(() => {});
  seen.observe(menu, { subtree: true, childList: true, characterData: true, attributes: true });
  FA.paintResumeMenuTurn(menu, null);
  FA.paintResumeMenuTurn(menu, undefined);
  assert.deepEqual(seen.takeRecords(), [], 'not held: nothing to write');
  FA.paintResumeMenuTurn(menu, 3);
  assert.equal(smallOf(menu).textContent, 'Waiting for its turn after run 3');
  assert.ok(seen.takeRecords().length > 0);
  FA.paintResumeMenuTurn(menu, 3);
  assert.deepEqual(seen.takeRecords(), [], 'the same hold: nothing to write');
  FA.paintResumeMenuTurn(menu, null);
  assert.equal(smallOf(menu).textContent, 'Where it left off');
  assert.deepEqual(others(), before, 'only the saved item changes');
  assert.equal(menu.querySelector('.resume-on-saved b').textContent, 'Resume');
  assert.doesNotThrow(() => FA.paintResumeMenuTurn(null, 3));
  assert.doesNotThrow(() => FA.paintResumeMenuTurn(menu.ownerDocument.createElement('div'), 3));
});
