// test/ui-run-status-card.test.mjs — the one status block (ui/public/run-status-card.mjs, runs redesign slice 4): the
// status text, the dot or symbol, the bars per state (D20), the model actions (D4), member rows and ship lines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { runModel, groupModel } from '../src/shared/run-model.mjs';
import { statusText, memberStatusText, kindLabel, paintRunStatus, syncActions, pauseResumeOwn, renderMemberRows, groupShipLine } from '../ui/public/run-status-card.mjs';
import { RUN_STATE_ROWS, NOW } from './helpers/run-states.mjs';

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

test('unsuccessful run: amber alert badge + reason note; ready run hides the note', () => {
  const host = dom().createElement('div');
  const bad = runModel({ status: 'done', successful: false, outcomeReason: 'Implement produced no changes to the worktree.',
    steps: [], active: [] }, { now: NOW, timeZone: 'UTC' });
  paintRunStatus(host, bad);
  assert.equal(host.dataset.state, 'unsuccessful');
  assert.equal(host.querySelectorAll('.status-dot')[0].dataset.symbol, 'alert');
  const note = host.querySelector('.run-status-reason');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Implement produced no changes to the worktree.');
  // Repaint the SAME host from unsuccessful to a ready run: the note re-hides.
  paintRunStatus(host, runModel({ status: 'done', successful: true, steps: [], active: [] }, { now: NOW, timeZone: 'UTC' }));
  assert.equal(host.querySelector('.run-status-reason').hidden, true);   // re-hidden
  assert.equal(host.querySelectorAll('.run-status-reason').length, 1, 'made once');
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
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
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
  assert.equal(groupShipLine({ ...row, groupKind: 'user' }), '');
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
  assert.equal(host.querySelector('.run-status-text').textContent, m.barLine ? `Working · ${m.barLine}` : 'Working');
  assert.equal(host.dataset.line, m.line, 'the canonical line is unchanged');
  assert.ok(!host.querySelector('.run-status-text').textContent.includes(`${m.progress.label} ·`), 'the stage is said once, on the bar');
  // statusText without a bar keeps the stage.
  assert.equal(statusText(m).line, m.line);
  assert.equal(statusText(m, { stageBar: true }).line, m.barLine);
  // A model whose bar is hidden (prNeeds) or a non-working state never reads barLine.
  assert.equal(statusText({ ...m, barLine: null }, { stageBar: true }).line, m.line);
});
