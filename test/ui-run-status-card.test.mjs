// test/ui-run-status-card.test.mjs — the one status block (ui/public/run-status-card.mjs, runs redesign slice 4): the
// status text, the dot or symbol, the bars per state (D20), the model actions (D4), member rows and ship lines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { runModel, groupModel } from '../src/shared/run-model.mjs';
import { statusText, kindLabel, paintRunStatus, syncActions, pauseResumeOwn, renderMemberRows, groupShipLine } from '../ui/public/run-status-card.mjs';
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
  assert.deepEqual(btns.map((b) => [b.textContent, b.disabled]), [['Open PR', false], ['Ask for changes', true]]);
  assert.ok(btns[0].classList.contains('btn-primary'));
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
  const ol = renderMemberRows(doc, row, { openButtons: true });
  const lis = [...ol.querySelectorAll('li.run-member')];
  assert.deepEqual(lis.map((li) => li.querySelector('.run-member-num').textContent), ['', '1', '2', '3']);
  assert.equal(lis[2].querySelector('.status-dot').getAttribute('aria-label'), 'Failed', 'a failed member draws "!"');
  assert.equal(ol.querySelectorAll('.run-member-open').length, 4);
  assert.equal(groupShipLine(row), 'Ship card comes when all 3 runs are done, here and in the chat.');
  const ready = groupModel({ kind: 'feature', members: [done, done, done] }, { now: NOW });
  assert.equal(groupShipLine({ ...row, model: ready, members: ready.members.map((m, i) => ({ position: i + 1, model: m })) }),
    'Merge in order 1 → 2 → 3, or ship as one PR');
  assert.equal(groupShipLine({ ...row, groupKind: 'user' }), '');
});
