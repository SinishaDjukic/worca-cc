// test/ui-run-status-card.test.mjs — the one status block (ui/public/run-status-card.mjs, runs redesign slice 4): the
// status text, the dot or symbol, the bars per state (D20), the model actions (D4), member rows and ship lines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { runModel, groupModel } from '../src/shared/run-model.mjs';
import { statusText, memberStatusText, kindLabel, paintRunStatus, syncActions, pauseResumeOwn, renderMemberRows, groupShipLine, FEATURE_KIND, sliceHeadModel } from '../ui/public/run-status-card.mjs';
import { markDot } from '../ui/public/status-dot.mjs';
import { RUN_STATE_ROWS, NOW, REPLAY_FRAMES } from './helpers/run-states.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const trackDom = useDomRelease(afterEach);
const dom = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;

test('statusText: the word leads only when the line does not already say it', async () => {
  await checkRows(RUN_STATE_ROWS.map(({ state, run }) => ({ name: state, run: () => {
    const m = runModel(run, { now: NOW, timeZone: 'UTC' });
    const t = statusText(m);
    assert.equal(t.line, m.line);
    assert.equal(t.text.toLowerCase().split(m.word.toLowerCase()).length - 1, 1, `${state}: the word appears exactly once`);
  } })));
});

test('statusText: head and detail split the line; text stays the one-line form', () => {
  const rows = [
    [{ word: 'Needs you', line: 'Needs you · 1 question' }, 'Needs you', '1 question'],
    [{ word: 'Working', line: 'Running · Round 2 · Plan', lineSaysState: true }, 'Running', 'Round 2 · Plan'],
    [{ word: 'Working', line: 'Refine Plan' }, 'Working', 'Refine Plan'],
    [{ word: 'Working', line: '' }, 'Working', ''],
    [{ word: 'Ready', line: 'Ready to ship · not in dev yet' }, 'Ready to ship', 'not in dev yet'],
    [{ word: 'Failed', line: 'Failed · Build · Implementation' }, 'Failed', 'Build · Implementation'],
    [{ word: 'Failed', line: 'Build · failed · Implementation' }, 'Failed', 'Build · Implementation'],
    [{ word: 'Needs you', line: 'Round 2 · Needs you' }, 'Needs you', 'Round 2'],
    [{ word: 'Starting', line: 'Copying the folder' }, 'Starting', 'Copying the folder'],
    [{ word: 'Finished', line: 'Finished' }, 'Finished', ''],
  ];
  for (const [m, head, detail] of rows) {
    const t = statusText(m);
    assert.deepEqual([t.head, t.detail], [head, detail], m.line);
  }
  assert.equal(statusText({ word: 'Ready', line: 'Ready to ship · not in dev yet' }).text, 'Ready to ship · not in dev yet');
});

test('paintRunStatus: the state word over a detail line; no detail, no line; data-text keeps the one line', () => {
  const host = dom().createElement('div');
  paintRunStatus(host, { state: 'in-review', word: 'In review', dot: 'green', line: 'In review · waiting for a review', lineSaysState: false });
  assert.equal(host.querySelector('.run-status-word').textContent, 'In review');
  const d = host.querySelector('.run-status-detail');
  assert.equal(d.textContent, 'waiting for a review');
  assert.equal(d.title, 'waiting for a review');
  assert.equal(d.hidden, false);
  assert.equal(host.dataset.text, 'In review · waiting for a review');
  assert.equal(host.querySelector('.run-status-text'), null, 'the one-line element is gone');
  paintRunStatus(host, { state: 'merged', word: 'Merged', dot: 'violet', line: 'Merged', lineSaysState: false });
  assert.equal(host.querySelector('.run-status-word').textContent, 'Merged');
  assert.equal(d.hidden, true, 'an empty detail is hidden');
  assert.equal(host.querySelectorAll('.run-status-word').length, 1, 'idempotent');
});

test('statusText and actions for rounds and a stopped Watch PR: the model\'s words, never a second state word', () => {
  const working = RUN_STATE_ROWS.find((r) => r.state === 'working').run;
  const r2 = runModel({ ...working, round: { n: 2, request: 'add a filter', by: 'person' } }, { now: NOW, timeZone: 'UTC' });
  assert.match(statusText(r2).text, /^Running · Round 2 · (Plan|Build|Review)$/, 'no "Working · " in front of "Running"');
  const done = RUN_STATE_ROWS.find((r) => r.state === 'in-review').run;
  const stopped = runModel({ ...done, watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }, { now: NOW });
  assert.equal(statusText(stopped).text, 'Needs you · Watch stopped · 3 fix runs, checks still failing');
  const doc = dom();
  const host = doc.createElement('div');
  syncActions(host, stopped, { onAction: () => {}, disable: { 'ask-changes': "Ask for changes from the run's chat" } });
  const btns = [...host.querySelectorAll('button[data-model-action]')];
  assert.deepEqual(btns.map((b) => [b.textContent, b.disabled]), [['View PR', false], ['Ask for changes', true]]);
  assert.ok(!btns[0].classList.contains('btn-primary'), 'View PR is navigation, never the primary (PR controls)');
  assert.equal(btns[1].title, "Ask for changes from the run's chat");
  // D8: Ask for changes has a flow now (Shaper): with no host reason it is enabled.
  const open = doc.createElement('div');
  syncActions(open, stopped, { onAction: () => {} });
  assert.equal(open.querySelector('[data-model-action="ask-changes"]').disabled, false);
});

test('paintRunStatus: symbol states never paint a plain dot; bars follow D20', async () => {
  await checkRows(RUN_STATE_ROWS.map(({ state, run, symbol, bar }) => ({ name: state, run: () => {
    const doc = dom();
    const host = doc.createElement('div');
    const m = runModel(run, { now: NOW, timeZone: 'UTC' });
    paintRunStatus(host, m);
    paintRunStatus(host, m);                                          // idempotent: no second dot
    const dots = host.querySelectorAll('.status-dot');
    assert.equal(dots.length, 1);
    assert.equal(host.dataset.state, state);
    assert.equal(host.dataset.line, m.line);
    if (symbol) {
      assert.equal(dots[0].dataset.symbol, symbol);
      assert.equal(dots[0].getAttribute('aria-label'), m.word);
    } else assert.equal(dots[0].querySelector('svg'), null);
    assert.equal(host.querySelector('.run-status-bar').hidden, !bar, `${state}: bar ${bar ? 'shown' : 'hidden'}`);
    assert.equal(host.querySelector('.run-status-group').hidden, true, 'a single run has no group bar');
  } })));
});

test('paintRunStatus: live role rows under the status line, the Refine line, hidden without roles (A12)', () => {
  const doc = dom();
  const host = doc.createElement('div');
  const base = runModel({ status: 'running' }, { now: NOW, timeZone: 'UTC' });
  const roles = { rows: [{ key: 'product', label: 'Product', state: 'reviewing', live: true },
    { key: 'ux', label: 'UX', state: '1 major', live: false }], refine: '' };
  paintRunStatus(host, { ...base, roles });
  const rows = [...host.querySelectorAll('.run-status-roles .run-role-row')];
  assert.equal(host.querySelector('.run-status-roles').hidden, false);
  assert.deepEqual(rows.map((r) => [r.dataset.role, r.querySelector('.run-role-name').textContent, r.querySelector('.run-role-state').textContent]),
    [['product', 'Product', 'reviewing'], ['ux', 'UX', '1 major']]);
  assert.ok(rows[0].querySelector('.run-role-dot').classList.contains('is-live'));
  assert.equal(rows[1].querySelector('.run-role-dot').classList.contains('is-live'), false);
  paintRunStatus(host, { ...base, roles: { rows: [], refine: 'Fixing 3 findings from UX and Architect' } });
  assert.equal(host.querySelectorAll('.run-role-row').length, 0);
  assert.equal(host.querySelector('.run-role-refine').textContent, 'Fixing 3 findings from UX and Architect');
  paintRunStatus(host, { ...base, roles: null });
  assert.equal(host.querySelector('.run-status-roles').hidden, true, 'roles:null hides the block');
  assert.equal(host.querySelectorAll('.run-status-roles').length, 1, 'made once');
  // A group model reads its current member's roles.
  const gh = doc.createElement('div');
  const g = groupModel({ kind: 'feature', title: 'F', members: [{ status: 'running' }, { ticket: { status: 'scheduled', after: { index: 1 } } }] }, { now: NOW });
  paintRunStatus(gh, { ...g, current: { ...g.current, roles } });
  assert.equal(gh.querySelectorAll('.run-role-row').length, 2);
  const css = readStyleCss();
  assert.match(css, /prefers-reduced-motion: reduce\)\{[^@]*\.run-role-dot\.is-live\{animation:none;\}/, 'the live dot holds still under reduced motion');
});

test('syncActions: model order, one primary, own buttons follow the model, stale buttons go', () => {
  const doc = dom();
  const host = doc.createElement('div');
  const stop = doc.createElement('button');
  const calls = [];
  syncActions(host, { actions: ['answer', 'stop'] }, { own: { stop }, onAction: (id) => calls.push(id) });
  assert.deepEqual([...host.querySelectorAll('[data-model-action]')].map((b) => b.dataset.modelAction), ['answer']);
  assert.ok(host.querySelector('[data-model-action="answer"]').classList.contains('btn-primary'));
  assert.equal(stop.hidden, false);
  assert.equal(stop.dataset.modelAction, 'stop');
  host.querySelector('[data-model-action="answer"]').click();
  assert.deepEqual(calls, ['answer']);
  syncActions(host, { actions: ['retry', 'report'] }, { own: { stop }, onAction: () => {} });
  assert.deepEqual([...host.querySelectorAll('button[data-model-action]')].map((b) => b.textContent), ['Retry', 'Report']);
  const retry = host.querySelector('[data-model-action="retry"]');
  assert.equal(retry.disabled, true, 'no re-run flow yet (D5)');
  assert.equal(retry.title, 'Start a new run to try again');
  assert.equal(stop.hidden, true);
  assert.equal(stop.dataset.modelAction, undefined);
});

test('syncActions: own buttons inside the host (the chat card footer) are kept and ordered with the made ones', () => {
  const doc = dom();
  const host = doc.createElement('div');
  const pause = doc.createElement('button');
  const stop = doc.createElement('button');
  host.append(pause, stop);
  const own = { pause, resume: pause, stop };
  const shown = () => [...host.children].filter((b) => !b.hidden).map((b) => b.dataset.modelAction);
  syncActions(host, { actions: ['answer', 'stop'] }, { own });
  assert.deepEqual(shown(), ['answer', 'stop'], 'model order, Stop never removed');
  assert.ok(stop.parentNode === host && pause.parentNode === host, 'own buttons stay in the host');
  assert.ok(host.querySelector('[data-model-action="answer"]').classList.contains('btn-primary'));
  syncActions(host, { actions: ['resume', 'stop'] }, { own });
  assert.deepEqual(shown(), ['resume', 'stop']);
  assert.equal(host.querySelector('[data-model-action="answer"]'), null, 'the made Answer went');
  assert.ok(pause.classList.contains('btn-primary'), 'an own Resume inside the host is the primary');
  assert.ok(!stop.classList.contains('btn-primary'));
  syncActions(host, { actions: ['archive'] }, { own });
  assert.deepEqual(shown(), ['archive']);
  assert.ok(!pause.classList.contains('btn-primary'), 'the own button loses the primary once it no longer stands for it');
  assert.equal(host.children.length, 3, 'own buttons stay in the host, hidden');
  syncActions(host, { actions: ['pause', 'ship'] }, { own });
  assert.ok(!pause.classList.contains('btn-primary'), 'Pause is never primary');
  assert.ok(host.querySelector('[data-model-action="ship"]').classList.contains('btn-primary'));
});

test('syncActions: pool hides unowned page buttons; covered actions make no button; disable re-enables', () => {
  const doc = dom();
  const slot = doc.createElement('span');
  const pause = doc.createElement('button');                        // a stale "Pause" the painter left visible
  const cta = doc.createElement('div');                             // the glance's PR call-to-action
  pause.hidden = false;
  syncActions(slot, { actions: ['ship', 'archive'] }, { pool: [pause], covered: { ship: cta } });
  assert.equal(pause.hidden, true, 'an unowned pool button is hidden');
  assert.equal(cta.dataset.modelAction, 'ship');
  assert.deepEqual([...slot.querySelectorAll('button')].map((b) => b.dataset.modelAction), ['archive'], 'no second Ship it');
  syncActions(slot, { actions: ['resume', 'stop'] }, { pool: [pause], disable: { resume: 'Pausing…' } });
  const resume = slot.querySelector('[data-model-action="resume"]');
  assert.equal(resume.disabled, true);
  assert.equal(resume.title, 'Pausing…');
  assert.equal(cta.dataset.modelAction, 'ship', 'a covered element is only re-tagged when passed again');
  syncActions(slot, { actions: ['resume', 'stop'] }, { pool: [pause] });
  assert.equal(slot.querySelector('[data-model-action="resume"]').disabled, false, 'the reason went, so did the disabled state');
});

test('pauseResumeOwn: the button stands for what it reads, never Pause for a parked run', () => {
  const doc = dom();
  const b = doc.createElement('button');
  b.dataset.action = 'pause';
  assert.deepEqual(pauseResumeOwn(b, 'running'), { pause: b });
  for (const st of ['interrupted', 'pausing', 'stopped', 'paused']) assert.deepEqual(pauseResumeOwn(b, st), {}, `${st}: a "Pause" button is not owned`);
  b.dataset.action = 'resume';
  assert.deepEqual(pauseResumeOwn(b, 'paused'), { resume: b });
  assert.deepEqual(pauseResumeOwn(null, 'running'), {});
});

test('kindLabel, member rows and ship lines for a feature group', () => {
  const doc = dom();
  const done = { status: 'done', endReached: true };
  const model = groupModel({ kind: 'feature', title: 'Run tags', planning: done,
    members: [done, { status: 'error' }, { ticket: { status: 'scheduled', after: { index: 2 } } }] }, { now: NOW });
  const row = { kind: 'chain', groupKind: 'feature', title: 'Run tags', model,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: `#history/acme/p${i + 1}`, model: m, cost: 1 })) };
  assert.equal(kindLabel(null), 'Run');
  assert.equal(kindLabel(row), 'Feature · 3 runs');
  assert.equal(FEATURE_KIND, 'Feature', 'B1: the one source of the word');
  assert.equal(kindLabel({ ...row, groupKind: 'chain' }), 'Chain · 3 runs');
  const ol = renderMemberRows(doc, row);
  assert.ok(ol.classList.contains('is-table'), 'one layout for the group page and the chat card');
  const lis = [...ol.querySelectorAll('li.run-member')];
  assert.deepEqual(lis.map((li) => li.querySelector('.run-member-num').textContent), ['', '1', '2', '3']);
  assert.equal(lis[2].querySelector('.status-dot').getAttribute('aria-label'), 'Failed', 'a failed member draws "!"');
  // A13: no Open button; title over its status line, then PR, cost and a quiet chevron; the title link is the target.
  assert.equal(ol.querySelectorAll('.run-member-open').length, 0);
  assert.equal(ol.querySelectorAll('.run-member-go').length, 4);
  for (const li of lis) {
    const main = li.querySelector(':scope > .run-member-main');
    assert.deepEqual([...main.children].map((c) => c.className), ['run-member-title', 'run-member-line']);
    assert.equal(li.querySelector('.run-member-go').getAttribute('aria-hidden'), 'true');
    assert.ok(li.querySelector('.run-member-go svg'), 'the chevron icon');
  }
  assert.equal(lis[1].querySelector('.run-member-title').getAttribute('href'), '#history/acme/p1');
  assert.equal(lis[1].querySelector('.run-member-title').title, 'Slice 1');
  assert.equal(lis[1].querySelector('.run-member-cost').textContent, '$1.00');
  assert.equal(groupShipLine(row), 'Ship card comes when all 3 runs are done, here and in the chat.');
  const ready = groupModel({ kind: 'feature', members: [done, done, done] }, { now: NOW });
  assert.equal(groupShipLine({ ...row, model: ready, members: ready.members.map((m, i) => ({ position: i + 1, model: m })) }),
    'Merge in order 1 → 2 → 3, or ship as one PR');
  assert.equal(groupShipLine({ ...row, groupKind: 'user' }), 'Create PR comes when all 3 runs are done.');
  assert.equal(groupShipLine({ ...row, model: ready, members: ready.members.map((m, i) => ({ position: i + 1, model: m })) }, { stackedOnly: true }),
    'Merge in order 1 → 2 → 3', 'small runs ship a PR per run: One is never offered');
});

test('groupShipLine (one ship flow): a chain waits, then reads the merge order; stacked In review keeps it, One drops it', () => {
  const done = { status: 'done', endReached: true };
  const gh = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  const mk = (members) => { const model = groupModel({ kind: 'chain', members });
    return { groupKind: 'chain', model, members: model.members.map((m, i) => ({ position: i + 1, model: m })) }; };
  assert.equal(groupShipLine(mk([done, { status: 'running' }])), 'Create PR comes when all 2 runs are done.');
  assert.equal(groupShipLine(mk([done, done])), 'Merge in order 1 → 2, or ship as one PR');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(1) }, done, done])), 'Merge in order 1 → 2 → 3', 'partly shipped: One is disabled, so not offered');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(1) }, { ...done, pr: gh(2) }])), 'Merge in order 1 → 2');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(3) }, { ...done, pr: gh(3) }])), '', 'shipped as One');
});

test('groupShipLine (slice 3): a user group reads Any order, or as one PR when the runs combine; Any order in review', () => {
  const done = { status: 'done', endReached: true };
  const gh = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  const mk = (members) => { const model = groupModel({ kind: 'user', members });
    return { groupKind: 'user', model, members: model.members.map((m, i) => ({ position: i + 1, adhoc: true, model: m })) }; };
  assert.equal(groupShipLine(mk([done, { status: 'running' }])), 'Create PR comes when all 2 runs are done.');
  assert.equal(groupShipLine(mk([done, done, done])), 'Any order, or as one PR when the runs combine');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(1) }, done, done])), 'Any order', 'a member PR turns One off');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(1) }, { ...done, pr: gh(2) }, { ...done, pr: gh(3) }])), 'Any order');
  assert.equal(groupShipLine(mk([{ ...done, pr: gh(4) }, { ...done, pr: gh(4) }, { ...done, pr: gh(4) }])), '', 'one PR on every run has no order');
  assert.equal(groupShipLine(mk([done])), '', 'a group of one run');
});

test('QA 3: the run page status text names the reason the chip gives', () => {
  const m = runModel({ status: 'done', pr: { url: 'https://github.com/o/r/pull/803', number: 803, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } } });
  assert.equal(statusText(m).text, 'Needs you · Checks failing · PR #803');
});

test('QA 4: a member row never repeats its chip ("Done" + "Merged"); the dot leads the row; the chip opens the PR', async () => {
  const gh = (o) => ({ url: 'https://github.com/o/r/pull/9', number: 9, state: 'OPEN', ...o });
  await checkRows([
    [{ status: 'done', endReached: true, pr: gh({ state: 'MERGED' }) }, 'Done', 'Merged'],
    [{ status: 'done', endReached: true, pr: gh({ checks: { state: 'failing', total: 4, failed: 1, pending: 0 } }) }, 'Needs you', 'Checks failing'],
    [{ status: 'done', endReached: true, pr: gh({ draft: true }) }, 'In review', 'Draft'],
    [{ status: 'done', endReached: true, pr: gh({ state: 'CLOSED' }) }, 'Ready to ship', 'Closed'],
  ].map(([run, line, chip]) => ({ name: chip, run: () => {
    const m = runModel(run, { now: NOW, timeZone: 'UTC' });
    assert.equal(memberStatusText(m), line);
    const doc = dom();
    const li = renderMemberRows(doc, { members: [{ position: 1, title: 'Slice', href: '#running/r1', model: m }] }).querySelector('.run-member');
    assert.equal(li.querySelector('.run-member-line').textContent, line);
    assert.equal(li.querySelector('.runs-pr-word').textContent, chip);
    assert.ok(li.firstElementChild.classList.contains('status-dot'), 'the dot is the row start, not next to the number');
    const a = li.querySelector('a.runs-pr');
    assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/9');
    assert.equal(a.getAttribute('target'), '_blank');
  } })));
});

test('a run in Needs you only through its PR has finished: no current-run bar (an empty one read as 0%)', () => {
  const doc = dom();
  for (const pr of [{ checks: { state: 'failing', total: 12, failed: 3, pending: 0 } }, { mergeable: 'CONFLICTING' }]) {
    const m = runModel({ status: 'done', pr: { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', ...pr } }, { now: NOW });
    assert.deepEqual([m.state, m.prNeeds], ['needs-you', true]);
    const host = doc.createElement('div');
    paintRunStatus(host, { ...m, progress: m.progress || { mode: 'nodes', fraction: 0, total: 4 } });
    assert.equal(host.querySelector('.run-status-bar').hidden, true);
  }
});

test('D4: a member row draws no chip for a pending PR (open, no verdict yet), and one for a known one', () => {
  const doc = dom();
  const pr = { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN' };
  const rowOf = (p) => renderMemberRows(doc, { members: [{ position: 1, title: 'Slice', href: '#running/r1',
    model: runModel({ status: 'done', pr: p }, { now: NOW }) }] }).querySelector('.run-member');
  const pending = rowOf({ ...pr, pending: true });
  assert.equal(pending.querySelectorAll('.runs-pr').length, 0);
  assert.equal(pending.dataset.state, 'in-review');
  assert.equal(rowOf({ ...pr, checks: { state: 'passing', total: 12, failed: 0, pending: 0 } }).querySelectorAll('.runs-pr').length, 1);
});

test('slice 2: syncActions skip never makes or shows a skipped action', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body><span class="slot"></span></body>')).window.document;
  const slot = doc.querySelector('.slot');
  syncActions(slot, { actions: ['retry', 'report'] }, { skip: ['archive', 'report'] });
  assert.deepEqual([...slot.querySelectorAll('[data-model-action]')].map((b) => b.dataset.modelAction), ['retry']);
  syncActions(slot, { actions: ['archive'] }, { skip: ['archive', 'report'] });
  assert.equal(slot.querySelectorAll('[data-model-action]').length, 0, 'a button made earlier is removed too');
});

test('paintRunStatus: beside the stage bar a working run reads "Working · STEP"; data-line keeps the stage', () => {
  const working = RUN_STATE_ROWS.find((r) => r.state === 'working').run;
  const m = runModel(working, { now: NOW, timeZone: 'UTC' });
  assert.equal(m.progress.mode, 'stages', 'the fixture run is a staged run');
  const host = dom().createElement('div');
  paintRunStatus(host, m);
  assert.equal(host.querySelector('.run-status-bar').hidden, false);
  assert.equal(host.dataset.text, m.barLine ? `Working · ${m.barLine}` : 'Working');
  assert.equal(host.querySelector('.run-status-word').textContent, 'Working');
  assert.equal(host.dataset.line, m.line, 'the canonical line is unchanged');
  assert.ok(!host.dataset.text.includes(`${m.progress.label} ·`), 'the stage is said once, on the bar');
  // statusText without a bar keeps the stage.
  assert.equal(statusText(m).line, m.line);
  assert.equal(statusText(m, { stageBar: true }).line, m.barLine);
  // A model whose bar is hidden (prNeeds) or a non-working state never reads barLine.
  assert.equal(statusText({ ...m, barLine: null }, { stageBar: true }).line, m.line);
});

test('slice 3: without `hold` (the chat card, the run page) a group between runs hides its bar as before', () => {
  const doc = dom();
  const host = doc.createElement('div');
  const F = REPLAY_FRAMES;
  const WAIT2 = { ticket: { status: 'scheduled', after: { index: 1 } } };
  paintRunStatus(host, groupModel({ kind: 'feature', title: 'T', members: [F[15], WAIT2] }, { now: NOW }));
  assert.equal(host.querySelector('.run-status-bar').hidden, false);
  paintRunStatus(host, groupModel({ kind: 'feature', title: 'T', members: [F.at(-1), WAIT2] }, { now: NOW }));
  assert.equal(host.querySelector('.run-status-bar').hidden, true, 'no hold: the waiting group has no bar');
});

// Requirements slices: a reviewed slice row on the chat card unfolds its Requirements check.
const REQ_CHECK = { passed: 2, total: 3, items: [
  { id: 'R-po-1', label: 'R-po-1 · covered by the diff', pass: true, detail: 'People see it' },
  { id: 'R-ux-1', label: 'R-ux-1 · covered by the diff', pass: true, detail: 'It reads well' },
  { id: 'R-ops-1', label: 'R-ops-1 · not covered by the diff', pass: false, detail: 'Turning the flag off removes the export, and a long criterion text wraps inside the row' },
] };
const reqRow = () => ({ members: [
  { position: 1, title: 'Slice 1', href: '#running/r1', pipelineId: 'p1', model: runModel({ status: 'done' }, { now: NOW }) },
  { position: 2, title: 'Slice 2', href: '#running/r2', ticketId: 't2', model: runModel({ status: 'done' }, { now: NOW }) },
] });

test('renderMemberRows draws a Requirements fold for a keyed member, none without checks', () => {
  const doc = dom();
  const ol = renderMemberRows(doc, reqRow(), { checks: { p1: REQ_CHECK } });
  const [one, two] = ol.querySelectorAll('.run-member');
  const line = one.querySelector('.run-member-main > .plan-check-line');
  assert.equal(line.textContent.replace('›', '').trim(), 'Requirements 2/3 · 1 to fix');
  assert.equal(one.querySelector('.run-member-line').nextElementSibling, line, 'the fold line follows the status line');
  assert.equal(line.nextElementSibling.className, 'plan-checks');
  assert.equal(line.nextElementSibling.hidden, true, 'folded by default');
  const bad = [...one.querySelectorAll('.plan-check-row')].find((r) => !r.classList.contains('ok'));
  assert.equal(bad.querySelector('.plan-check-label').textContent, 'R-ops-1 · not covered by the diff');
  assert.match(bad.querySelector('.plan-check-detail').textContent, /^Turning the flag off/);
  assert.equal(two.querySelector('.plan-check-line'), null);
  assert.equal(renderMemberRows(doc, reqRow()).querySelectorAll('.plan-check-line').length, 0);
  assert.equal(renderMemberRows(doc, reqRow(), { checks: {} }).querySelectorAll('.plan-check-line').length, 0);
  assert.equal(renderMemberRows(doc, reqRow(), { checks: { t2: REQ_CHECK } }).querySelectorAll('.run-member')[1].querySelectorAll('.plan-check-line').length, 1, 'a ticket key');
});

test('the fold line toggles aria-expanded; a click on the line or an unfolded row does not follow the title link', async () => {
  const doc = dom();
  const ol = renderMemberRows(doc, reqRow(), { checks: { p1: REQ_CHECK } });
  doc.body.append(ol);
  let followed = 0;
  ol.querySelector('.run-member-title').addEventListener('click', () => { followed += 1; });
  const line = ol.querySelector('.plan-check-line');
  line.click();
  assert.equal(line.getAttribute('aria-expanded'), 'true');
  assert.equal(line.nextElementSibling.hidden, false);
  ol.querySelector('.plan-check-row').click();
  line.click();
  assert.equal(line.getAttribute('aria-expanded'), 'false');
  assert.equal(followed, 0);
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/runs/group-page.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.run-members.is-table .run-member-main :is(.plan-check-line, .plan-checks){position:relative;z-index:1;}'),
    'the fold sits above the stretched title link');
});

test('at 375px the fold and a long criterion detail wrap: scrollWidth <= clientWidth', () => {
  const doc = dom();
  const host = doc.createElement('div');
  host.style.width = '375px';
  const ol = renderMemberRows(doc, reqRow(), { checks: { p1: REQ_CHECK } });
  host.append(ol);
  doc.body.append(host);
  ol.querySelector('.plan-check-line').click();
  for (const el of [ol.querySelector('.run-member-main'), ...ol.querySelectorAll('.plan-check-row')]) assert.ok(el.scrollWidth <= el.clientWidth);
});

// ---- Shaper small runs s4: renderMemberRows takes word and mark from the `status` option (R-ux-1, R-arch-4) ----
const rowsOf = (members, opts) => {
  const d = dom();
  const gm = groupModel({ kind: 'feature', title: 'F', planning: { status: 'done', endReached: true }, members }, { now: NOW });
  const row = { groupKind: 'feature', model: gm, planning: { title: 'Planning', href: '#running/r0', model: gm.planning },
    members: gm.members.map((m, i) => ({ position: i + 1, title: `Run ${i + 1}`, href: '#runs', pipelineId: `p${i + 1}`, model: m })) };
  return renderMemberRows(d, row, opts);
};
const MEMBERS = [{ status: 'done', endReached: true }, { status: 'running' }, { status: 'running' }];
const member = (ol, i) => ol.querySelectorAll('.run-member:not([data-key="planning"])')[i];

test('s4 renderMemberRows: with no `status` the output is byte-identical and no row has data-mark', () => {
  const plain = rowsOf(MEMBERS, { oneLine: true, shortState: () => 'x' });
  const same = rowsOf(MEMBERS, { oneLine: true, shortState: () => 'x', status: undefined });
  assert.equal(plain.outerHTML, same.outerHTML);
  assert.equal(plain.querySelector('[data-mark]'), null);
});

test('s4 renderMemberRows: status gives the word, the markDot dot and data-mark', () => {
  const marks = [{ word: 'done', mark: 'done' }, { word: 'after run 3', mark: 'after' }, { word: 'waiting for you', mark: 'ask' }];
  const ol = rowsOf(MEMBERS, { oneLine: true, status: (mb) => marks[mb.position - 1] });
  const rows = [0, 1, 2].map((i) => member(ol, i));
  assert.deepEqual(rows.map((li) => li.dataset.mark), ['done', 'after', 'ask']);
  assert.deepEqual(rows.map((li) => li.querySelector('.run-member-state').textContent), ['done', 'after run 3', 'waiting for you']);
  assert.ok(rows[1].querySelector('.status-dot').classList.contains('is-dashed-ring'));
  assert.equal(rows[1].querySelector('.status-dot').dataset.symbol, undefined);
  assert.equal(rows[2].querySelector('.status-dot').dataset.symbol, 'question');
  assert.ok(rows[0].querySelector('.status-dot').classList.contains('is-green'));
  assert.equal(rows[1].dataset.state, member(rowsOf(MEMBERS, { oneLine: true }), 1).dataset.state, 'data-state keeps the dev state');
});

test('s4 renderMemberRows: word precedence: a string word (even empty), else shortState, else memberStatusText', () => {
  const ol = rowsOf(MEMBERS, { oneLine: true, shortState: () => 'short', status: (mb) => ([{ word: '', mark: 'ring' }, { word: null, mark: 'live' }, { word: null, mark: null }][mb.position - 1]) });
  assert.equal(member(ol, 0).querySelector('.run-member-state').textContent, '', 'an empty word is kept: no word');
  assert.equal(member(ol, 1).querySelector('.run-member-state').textContent, 'short', 'a null word falls to shortState');
  assert.equal(member(ol, 2).querySelector('.run-member-state').textContent, 'short');
  const bare = rowsOf(MEMBERS, { oneLine: true, status: () => ({ word: null, mark: null }) });
  const dev = rowsOf(MEMBERS, { oneLine: true });
  assert.equal(bare.outerHTML, dev.outerHTML, 'a null word and null mark leave today\'s row');
  assert.equal(member(bare, 0).dataset.mark, undefined);
  const noShort = rowsOf(MEMBERS, { oneLine: true, status: () => ({ word: null, mark: 'live' }) });
  assert.equal(member(noShort, 1).querySelector('.run-member-state').textContent, member(dev, 1).querySelector('.run-member-state').textContent);
  assert.equal(member(noShort, 1).dataset.mark, 'live');
});

test('s4 renderMemberRows: the planning row never calls status and has no data-mark; a null return is today\'s row', () => {
  const seen = [];
  const ol = rowsOf(MEMBERS, { oneLine: true, status: (mb) => { seen.push(mb.isPlanning ? 'planning' : mb.position); return mb.position === 1 ? null : { word: 'x', mark: 'faint' }; } });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(ol.querySelector('.run-member[data-key="planning"]').dataset.mark, undefined);
  assert.equal(member(ol, 0).dataset.mark, undefined);
});

// ---- Shaper small runs s8 (R-ux-2): renderMemberRows makes link rows from the `buildsOn` option ----
const LINK_ATTRS = '[data-run], [data-builds-on], [tabindex]';
const linkAttrs = (li) => [li.getAttribute('data-run'), li.getAttribute('data-builds-on'), li.getAttribute('tabindex')];
const S8_STATUS = () => ({ word: 'x', mark: 'faint' });

test('s8 renderMemberRows: with status and buildsOn a numbered row gets data-run, data-builds-on and tabindex 0', () => {
  const lists = { 1: [], 2: [1, 7, 10], 3: null };
  const ol = rowsOf(MEMBERS, { oneLine: true, status: S8_STATUS, buildsOn: (mb) => lists[mb.position] });
  assert.deepEqual(linkAttrs(member(ol, 0)), ['1', '', '0'], 'an empty list is an empty attribute');
  assert.deepEqual(linkAttrs(member(ol, 1)), ['2', '1 7 10', '0']);
  assert.deepEqual(linkAttrs(member(ol, 2)), [null, null, null], 'a row without a list is not a link row');
  assert.deepEqual(linkAttrs(ol.querySelector('.run-member[data-key="planning"]')), [null, null, null], 'the planning row');
});

test('s8 renderMemberRows: an unnumbered row (ad hoc, user group) is never a link row', () => {
  const gm = groupModel({ kind: 'feature', title: 'F', members: MEMBERS }, { now: NOW });
  const members = gm.members.map((m, i) => ({ position: i + 1, title: `Run ${i + 1}`, href: '#runs', pipelineId: `p${i + 1}`, model: m, adhoc: i === 2 }));
  const opts = { oneLine: true, status: S8_STATUS, buildsOn: () => [1] };
  const feature = renderMemberRows(dom(), { groupKind: 'feature', model: gm, members }, opts);
  assert.deepEqual([...feature.querySelectorAll('.run-member')].map((li) => li.getAttribute('data-run')), ['1', '2', null]);
  const user = renderMemberRows(dom(), { groupKind: 'user', model: gm, members }, opts);
  assert.equal(user.querySelector(LINK_ATTRS), null);
});

test('s8 renderMemberRows without status adds no data-run, data-builds-on or tabindex', () => {
  const plain = rowsOf(MEMBERS, { oneLine: true });
  const asked = rowsOf(MEMBERS, { oneLine: true, buildsOn: () => [1] });
  assert.equal(asked.outerHTML, plain.outerHTML);
  assert.equal(asked.querySelector(LINK_ATTRS), null);
  const marked = rowsOf(MEMBERS, { oneLine: true, status: S8_STATUS });
  assert.equal(marked.querySelector(LINK_ATTRS), null, 'status without buildsOn');
});

test('s4 row words: "waiting for you" reads --amber-ink and "failed" --red-ink, other words keep --ink-2 (owner direction d6dd6d688)', () => {
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  for (const scope of ['.chat-rc-members', 'div.gpage-runs']) {
    const rule = (mark) => css.split('}').find((r) => r.includes(scope) && r.includes(`[data-mark="${mark}"]`) && r.includes('.run-member-state')) || '';
    assert.match(rule('ask'), /color:\s*var\(--amber-ink\)/, `${scope} ask`);
    assert.match(rule('failed'), /color:\s*var\(--red-ink\)/, `${scope} failed`);
    assert.doesNotMatch(css, new RegExp(`${scope.replace('.', '\\.')}[^{}]*\\[data-mark="(?:after|ring|faint|done|live)"\\][^{}]*\\.run-member-state[^{}]*\\{[^}]*color`), `${scope}: no other word is coloured`);
  }
  const tokens = readStyleCss();
  assert.match(tokens, /--amber-ink:/);
  assert.match(tokens, /--red-ink:/);
});

// ── Shaper small runs s5 (R-arch-1, D8, D9): the run page head reads the shared run status ──────────────────────────
const S5_DEV_WORD = /^(needs you|paused|waiting|working|failed|stopped|running)$/i;
const s5Run = (state) => RUN_STATE_ROWS.find((r) => r.state === state).run;
const s5Model = (run) => runModel(run, { now: NOW, timeZone: 'UTC' });
const S5_WORKING = () => s5Run('working');
const S5_ROUND = () => ({ ...S5_WORKING(), round: { n: 2, request: 'add a filter', by: 'person' } });
const S5_AFTER = () => ({ ticket: { status: 'scheduled', after: { index: 3 } } });
const S5_HELD = () => ({ ticket: { status: 'scheduled', held: true, after: { index: 3 } } });
/** The head `m` paints: {word, detail, dot}. */
function s5Head(m) {
  const host = dom().createElement('div');
  paintRunStatus(host, m);
  const detail = host.querySelector('.run-status-detail');
  return { word: host.querySelector('.run-status-word').textContent, detail: detail.hidden ? '' : detail.textContent,
    dot: host.querySelector('.run-status-head .status-dot') };
}
const s5NoDevWord = (detail, where) => {
  for (const seg of detail ? detail.split(' · ') : []) {
    assert.ok(!S5_DEV_WORD.test(seg), `${where}: the detail restates dev's state: "${detail}"`);
    assert.ok(!/^starts /i.test(seg), `${where}: the detail restates dev's "starts after": "${detail}"`);
  }
};

test('s5 sliceHeadModel: the head reads the shared word and the detail holds no dev state word', async () => {
  const rows = [
    ['an open stop', s5Run('needs-you'), { word: 'waiting for you', mark: 'ask' }, (h, dev) => {
      assert.equal(dev.word, 'Needs you');
      assert.equal(h.dot.dataset.symbol, 'question');
      assert.equal(h.detail, 'Plan · 2 questions');
    }],
    ['a building run keeps dev\'s step-only bar detail', S5_WORKING(), { word: 'building', mark: 'live' }, (h, dev) => {
      assert.ok(h.dot.classList.contains('is-pulse'));
      assert.ok(dev.detail, 'dev names the step beside the bar');
      assert.equal(h.detail, dev.detail);
    }],
    ['a failed run', s5Run('failed'), { word: 'failed', mark: 'failed' }, (h) => {
      assert.equal(h.dot.dataset.symbol, 'alert');
      assert.match(h.detail, /^Plan · /, 'the step detail stays');
    }],
    ['a held answer', S5_HELD(), { word: 'after run 3', mark: 'after' }, (h, dev) => {
      assert.equal(dev.word, 'Waiting');
      assert.ok(h.dot.classList.contains('is-dashed-ring'));
    }],
    ['a run that waits to start after another', S5_AFTER(), { word: 'waits for run 3', mark: 'faint' }, (h, dev) => {
      assert.match(dev.detail, /^starts /, 'dev says it');
      assert.equal(h.detail, '');
    }],
    ['a fix round', S5_ROUND(), { word: 'building', mark: 'live' }, (h, dev) => {
      assert.equal(dev.word, 'Running');
      assert.match(h.detail, /^Round 2/);
    }],
    ['a paused run', s5Run('paused'), { word: 'after run 3', mark: 'after' }, () => {}],
    ['a stopped run', s5Run('stopped'), { word: 'next', mark: 'ring' }, (h) => assert.ok(h.dot.classList.contains('is-ink-ring'))],
    ['a starting run', s5Run('starting'), { word: 'planning', mark: 'live' }, () => {}],
  ];
  await checkRows(rows.map(([name, run, st, more]) => ({ name, run: () => {
    const m = s5Model(run);
    const before = structuredClone(m);
    const dev = s5Head(m);
    const out = sliceHeadModel(m, st);
    assert.notEqual(out, m, 'a new object');
    assert.deepEqual(m, before, 'the input is not changed');
    assert.equal(out.word, st.word);
    assert.equal(out.lineSaysState, false);
    const h = s5Head(out);
    assert.equal(h.word, st.word);
    s5NoDevWord(h.detail, name);
    more(h, dev);
  } })));
});

test('s5 sliceHeadModel: dev state words are dropped from line and barLine in any case; the other segments stay in order', () => {
  const m = { state: 'working', word: 'Working', dot: 'peach', pulse: true, symbol: null, actions: [],
    line: 'RUNNING · Build · needs you · Paused · waiting · working · Failed · stopped · Starts after run 3 · Implement · Step 2 of 3',
    barLine: 'Working · Implement · starts after run 3', lineSaysState: true };
  const out = sliceHeadModel(m, { word: 'building', mark: 'live' });
  assert.equal(out.line, 'Build · Implement · Step 2 of 3');
  assert.equal(out.barLine, 'Implement');
});

test('s5 sliceHeadModel: null status, null mark and done return the same object (D9)', () => {
  for (const run of [s5Run('ready'), s5Run('merged')]) {
    const m = s5Model(run);
    assert.equal(sliceHeadModel(m, null), m);
    assert.equal(sliceHeadModel(m, { word: null, mark: null }), m);
    assert.equal(sliceHeadModel(m, { word: 'done', mark: 'done' }), m);
  }
  assert.equal(s5Head(s5Model(s5Run('ready'))).word, 'Ready to ship', 'the ship line');
});

test('s5 sliceHeadModel: an empty word paints an empty head and no detail', () => {
  const m = s5Model(S5_AFTER());
  const out = sliceHeadModel(m, { word: '', mark: 'ring' });
  assert.equal(out.word, '');
  assert.equal(out.line, '');
  assert.equal(out.barLine, null);
  const h = s5Head(out);
  assert.equal(h.word, '');
  assert.equal(h.detail, '');
  assert.ok(h.dot.classList.contains('is-grey-ring'), h.dot.className);
});

test('s5 sliceHeadModel: a stale live mark with no word never pulses over a paused, failed or stopped run', () => {
  for (const state of ['paused', 'failed', 'stopped']) {
    const m = s5Model(s5Run(state));
    assert.equal(sliceHeadModel(m, { word: null, mark: 'live' }), m, state);
    assert.ok(!s5Head(sliceHeadModel(m, { word: null, mark: 'live' })).dot.classList.contains('is-pulse'), state);
  }
});

test('s5 sliceHeadModel: a null word keeps dev\'s head and line, only the dot changes', () => {
  const m = s5Model(S5_AFTER());
  const out = sliceHeadModel(m, { word: null, mark: 'live' });
  assert.deepEqual(out, markDot(m, 'live', m.word));
  const dev = s5Head(m);
  const h = s5Head(out);
  assert.deepEqual([h.word, h.detail], [dev.word, dev.detail]);
  assert.ok(h.dot.classList.contains('is-pulse'));
  assert.ok(!dev.dot.classList.contains('is-pulse'));
});

// ── Slice 7 (D7, D10): the reason links to the Ship card; a feature with no chat says "on this page" ─────────────
const S7_HOLD = 'Needs your confirmation: R-ux-2';
const S7_HREF = '#feature/feat_1/requirements/ship';
const s7Held = () => {
  const done = { status: 'done', endReached: true };
  return groupModel({ kind: 'feature', title: 'F', members: [done, done], hold: S7_HOLD }, { now: NOW });
};
/** The text of `node` without its hidden parts. */
const s7Visible = (node) => { const c = node.cloneNode(true); c.querySelectorAll('[hidden]').forEach((x) => x.remove()); return c.textContent; };

test('s7: with detailHref the status detail is one link, the word is hidden and nothing carries a title', () => {
  const host = dom().createElement('div');
  paintRunStatus(host, s7Held(), { hold: true, detailHref: S7_HREF });
  const detail = host.querySelector('.run-status-detail');
  const links = host.querySelectorAll('a.run-status-link');
  assert.equal(links.length, 1);
  const [link] = links;
  assert.equal(link.parentElement, detail);
  assert.equal(link.getAttribute('href'), S7_HREF);
  assert.equal(link.textContent, S7_HOLD);
  assert.equal(detail.hidden, false);
  assert.equal(host.querySelector('.run-status-word').hidden, true);
  assert.equal(s7Visible(host.querySelector('.run-status-head')).split(S7_HOLD).length - 1, 1, 'the reason, once');
  assert.equal(host.getAttribute('title'), null);
  assert.equal(detail.getAttribute('title'), null);
  paintRunStatus(host, s7Held(), { hold: true, detailHref: S7_HREF });
  assert.equal(host.querySelector('a.run-status-link'), link, 'the link is made once: a repaint keeps it');
  assert.equal(host.querySelectorAll('a.run-status-link').length, 1);
});

test('s7: a paint without detailHref removes the link and leaves the DOM as a plain paint', () => {
  const doc = dom();
  const host = doc.createElement('div');
  paintRunStatus(host, s7Held(), { hold: true, detailHref: S7_HREF });
  assert.equal(host.querySelectorAll('a.run-status-link').length, 1, 'the link was painted first');
  paintRunStatus(host, s7Held(), { hold: true });
  assert.equal(host.querySelector('.run-status-detail').children.length, 0);
  const plain = doc.createElement('div');
  paintRunStatus(plain, s7Held(), { hold: true });
  assert.equal(host.innerHTML, plain.innerHTML);
});

test('s7 R-arch-4: the group ship line of a feature with no chat ends "on this page."', () => {
  const done = { status: 'done', endReached: true };
  const model = groupModel({ kind: 'feature', title: 'F', members: [done, { status: 'running' }, { ticket: { status: 'scheduled' } }] }, { now: NOW });
  const row = { kind: 'chain', groupKind: 'feature', model, members: model.members.map((m, i) => ({ position: i + 1, model: m })) };
  assert.equal(groupShipLine(row, { hasChat: false }), 'Ship card comes when all 3 runs are done, on this page.');
  for (const opts of [{ hasChat: true }, {}]) {
    assert.equal(groupShipLine(row, opts), 'Ship card comes when all 3 runs are done, here and in the chat.', JSON.stringify(opts));
  }
});
