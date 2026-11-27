// test/ui-group-page.test.mjs — the group page (ui/public/group-page.mjs, runs redesign slice 4 D13): header actions,
// title + kind chip, meta, the status card, the tabs Runs · Overview · Decisions · Logs, the Runs table, the ship line,
// and the plan / review receipts of the Decisions tab (D15).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { buildGroupPage, paintGroupPage, GROUP_TABS, runReceipts, groupPrList, syncRequirementsTab } from '../ui/public/group-page.mjs';
import * as GroupPage from '../ui/public/group-page.mjs';
import { ACTION_LABEL } from '../src/shared/run-model.mjs';
import { RUN_STATE_ROWS, NOW, REPLAY_FRAMES } from './helpers/run-states.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { featureView } from '../src/core/shape/features.mjs';
import { world, SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';
import { runStatus } from '../src/shared/shape/run-status.mjs';
import { icon } from '../ui/public/icons.mjs';
import { groupRow } from '../ui/public/runs-list.mjs';
import { stopLinesOf } from '../ui/public/shape/stop-list.mjs';

useTempHome(after, 'worca-group-page-s4-');
const trackDom = useDomRelease(afterEach);
const done = { status: 'done', endReached: true };
const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
const NOOP = { onAction: () => {}, onTab: () => {}, mountQuestion: () => {}, mountOverview: () => {}, mountDecisions: () => {}, logsHref: (mb) => `${mb.href}/details/logs` };
const row = () => {
  const model = groupModel({ kind: 'feature', title: 'Run tags', planning: done, members: [done, asking, { ticket: { status: 'scheduled', after: { index: 2 } } }] }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, costUsd: 4.2,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning, cost: 0.4 },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: `#running/r${i + 1}`, runId: `r${i + 1}`, model: m, cost: 1 })) };
};

test('the group page: header, title + kind, meta, status card, tabs, Runs table, ship line', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: true }, NOOP);
  assert.equal(root.querySelector('.gpage-title').textContent, 'Run tags');
  assert.equal(root.querySelector('.gpage-head .kind-chip').textContent, 'Feature');   // run 3 (D7): the kind
  assert.equal(root.querySelector('.gpage-meta'), null, 'run 3 (D15): the facts block replaced the meta line');
  assert.equal(root.querySelector('.gpage-card .run-status').dataset.state, 'needs-you');
  assert.equal(root.querySelector('.gpage-card .run-status .status-dot').getAttribute('aria-label'), 'Needs you');
  assert.deepEqual([...root.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.textContent), GROUP_TABS.map(([, l]) => l));
  assert.equal(root.querySelector('.gpage-tabs .rd-tab[aria-selected="true"]').dataset.tab, 'runs');
  // A6/A13: no Open button; each row is the target (its title link stretches over it) with a quiet chevron.
  assert.equal(root.querySelectorAll('.gpage-panel[data-tab="runs"] .run-member-open').length, 0);
  assert.equal(root.querySelectorAll('.gpage-panel[data-tab="runs"] .run-member-go').length, 4);
  assert.ok(root.querySelector('.gpage-panel[data-tab="runs"] .run-members').classList.contains('is-table'));
  assert.equal(root.querySelector('.gpage-title').title, 'Run tags', 'D13: the clamped heading carries the full title');
  assert.equal(root.querySelector('.gpage-ship').textContent, 'Ship card comes when all 3 runs are done, here and in the chat.');
  // Run 3 (D13): the bar is the primary action, Stop (its own button), then ⋯.
  assert.deepEqual([...root.querySelectorAll('.gpage-bar [data-model-action]')].filter((b) => !b.hidden).map((b) => b.dataset.modelAction), ['answer', 'stop']);
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: true }, NOOP);
  assert.equal(root.querySelectorAll('.gpage-card .status-dot').length, 1, 'a repaint never doubles the dot');
});

test('Overview is offered only when the host says so; Logs links each member', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row: { ...row(), groupKind: 'user' }, project: '', tab: 'logs', overview: false, logs: true }, NOOP);
  assert.equal(root.querySelector('.rd-tab[data-tab="overview"]').hidden, true);
  assert.equal(root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'logs');
  assert.deepEqual([...root.querySelectorAll('.gpage-panel[data-tab="logs"] a')].map((a) => a.getAttribute('href')),
    ['#running/r0/details/logs', '#running/r1/details/logs', '#running/r2/details/logs', '#running/r3/details/logs']);
  assert.equal(root.querySelector('.gpage-ship').textContent, 'Create PR comes when all 3 runs are done.');
});

test('Logs is offered only when the host says so (the run page\'s Logs tab is Expert): /logs falls back to Runs', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row: row(), project: '', tab: 'logs', overview: true, logs: false }, NOOP);
  assert.equal(root.querySelector('.rd-tab[data-tab="logs"]').hidden, true);
  assert.equal(root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'runs');
  assert.equal(root.querySelector('.gpage-panel[data-tab="logs"]').hidden, true);
  paintGroupPage(root, { row: row(), project: '', tab: 'logs', overview: true, logs: true }, NOOP);
  assert.equal(root.querySelector('.rd-tab[data-tab="logs"]').hidden, false, 'it comes back with the level');
  assert.equal(root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'logs');
});

test('runReceipts: plan and review receipts from the recorded run, no fetch; none for a bare History row', () => {
  const last = REPLAY_FRAMES[REPLAY_FRAMES.length - 1];
  assert.deepEqual(runReceipts(last), ['Plan accepted', 'Refine Plan · pass 2 · passed', 'Review Implementation · pass 2 · passed']);
  const sentBack = { ...last, progressFacts: { tasks: {}, reviews: { n_review: { pass: 1, blocking: 2 } } } };
  assert.equal(runReceipts(sentBack).at(-1), 'Review Implementation · pass 1 · 2 blocking, sent back');
  // A refine pass that fixed its blockers says so instead of reading as a bare clean pass (#996's `fixed` list).
  const refined = { ...last, progressFacts: { tasks: {}, reviews: { n_refine: { pass: 1, blocking: 0, fixed: 3 } } } };
  assert.equal(runReceipts(refined).at(-1), 'Refine Plan · pass 1 · passed, 3 fixed');
  assert.deepEqual(runReceipts({ status: 'done', pr: null }), []);
});

test('one ship flow: PR controls sit on the status line, never in the bar; Create PR, View PR ▾ or View PRs ▾', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const gh = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  const mk = (kind, g) => { const model = groupModel({ kind, title: 'T', ...g }, { now: NOW });
    return { kind: 'chain', groupKind: kind, groupId: 'g', title: 'T', model, costUsd: 0,
      members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, pipelineId: `p${i + 1}`, href: `#running/r${i}`, model: m })) }; };
  const paint = (row) => { const heads = []; const root = buildGroupPage(doc);
    paintGroupPage(root, { row, project: 'p', tab: 'runs' }, { ...NOOP, paintHead: (acts, slot, head) => heads.push({ acts, slot, head }) });
    const bar = [...root.querySelectorAll('.gpage-bar [data-model-action]')].filter((b) => !b.hidden).map((b) => b.dataset.modelAction);
    return { root, bar, ...heads.at(-1) }; };
  const ready = paint(mk('chain', { members: [done, done] }));
  assert.deepEqual(ready.bar, []);
  assert.deepEqual(ready.head.cta, { state: 'create' });
  assert.ok(ready.slot.matches('.gpage-card .rd-sheet-head > .rd-head-acts > .rd-pr-slot'));
  assert.ok(ready.acts.matches('.gpage-card .rd-sheet-head > .rd-head-acts'));
  const two = paint(mk('chain', { members: [{ ...done, pr: gh(1) }, { ...done, pr: gh(2) }] }));
  assert.deepEqual(two.bar, []);
  assert.deepEqual(two.head.cta, { state: 'view', label: 'View PRs', menu: true, ws: true });
  assert.ok(two.root.querySelector('.gpage-card .run-status').dataset.text.includes('In review · 2 PRs'));
  assert.equal(two.root.querySelector('.gpage-ship').textContent, 'Merge in order 1 → 2');
  assert.equal(two.root.querySelectorAll('.gpage-runs .run-member-pr .runs-pr').length, 2);
  const one = paint(mk('chain', { members: [{ ...done, pr: gh(3) }, { ...done, pr: gh(3) }] }));
  assert.deepEqual(one.head.cta, { state: 'view', href: gh(3).url, menu: true });
  assert.ok(one.root.querySelector('.gpage-card .run-status').dataset.text.includes('In review · 1 PR'));
  const feature = paint(mk('feature', { members: [done, done], pr: gh(4) }));
  assert.deepEqual(feature.bar, [], 'a feature shipped as one PR: no Open PR in the bar either');
});

test('groupPrList: distinct, not closed, in merge order, named Run K', () => {
  const r = { model: { pr: null }, members: [
    { position: 1, pipelineId: 'p1', model: { pr: { url: 'u1', number: 1, id: 'ready' } } },
    { position: 2, pipelineId: 'p2', model: { pr: { url: 'u1', number: 1, id: 'ready' } } },
    { position: 3, pipelineId: 'p3', model: { pr: { url: 'u3', number: 3, id: 'closed' } } }] };
  assert.deepEqual(groupPrList(r).map((p) => [p.name, p.url, p.key]), [['Run 2', 'u1', 'p2']]);
});

test('groupPrList: a chain\'s One PR shared by its 2 runs is listed once, owned by run 2 (its head branch)', () => {
  const r = { model: { pr: null }, members: [
    { position: 1, pipelineId: 'p1', model: { pr: { url: 'u1', number: 7, id: 'conflicts' } } },
    { position: 2, pipelineId: 'p2', model: { pr: { url: 'u1', number: 7, id: 'conflicts' } } }] };
  const list = groupPrList(r);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].pipelineId, list[0].key, list[0].name, list[0].position, list[0].conflicts], ['p2', 'p2', 'Run 2', 2, true]);
});

test('said once: an ended group has no group bar, so the Runs fact keeps "{done} done"', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const model = groupModel({ kind: 'feature', title: 'Run tags', planning: done, members: [done, done, done] }, { now: NOW });
  const ended = { ...row(), model, members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: `#running/r${i + 1}`, runId: `r${i + 1}`, model: m, cost: 1 })) };
  paintGroupPage(root, { row: ended, project: 'acme-app', tab: 'runs', overview: false }, NOOP);
  assert.ok(['ready', 'in-review', 'merged'].includes(model.state), model.state);
  assert.equal(root.querySelector('.run-status-group').hidden, true, 'no group bar once the group has ended');
  assert.equal(root.querySelector('.rd-kv [data-fact="runs"] .rd-kv-v').textContent, '3 runs · 3 done');
});

test('run 3: the group page shares the run page head — kind word, crumbs, facts in the card, Stop and ⋯', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  doc.body.append(root);
  const more = [];
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: false }, { ...NOOP, onMore: (b) => more.push(b) });
  assert.equal(root.querySelector('.gpage-head .kind-chip').textContent, 'Feature');
  assert.equal(root.querySelector('.gpage-meta'), null);
  assert.deepEqual([...root.querySelectorAll('.gpage-bar .rd-crumb')].map((c) => c.textContent), ['Runs', 'Run tags']);
  assert.ok(root.querySelector('.gpage-bar.rd-bar'), 'the run page\'s bar look');
  const kv = root.querySelector('.gpage-card.rd-sheet > .rd-kv');
  assert.ok(kv.previousElementSibling.matches('.rd-sheet-head') && kv.previousElementSibling.querySelector(':scope > .run-status'),
    'facts right under the status head (the one ship flow\'s status line + PR slot)');
  const gHead = root.querySelector('.gpage-card.rd-sheet > .rd-sheet-head');
  assert.ok(gHead.querySelector(':scope > .run-status:first-child'), 's1: a bare .run-status opens the head, so the card-head CSS reaches it');
  assert.ok(gHead.querySelector(':scope > .rd-head-acts'), 's1: the buttons sit beside it in the same head');
  const shown = [...kv.querySelectorAll('.rd-kv-row:not([hidden])')].map((r) => [r.dataset.fact, r.querySelector('.rd-kv-v').textContent]);
  assert.deepEqual(shown, [['project', 'acme-app'], ['runs', '3 runs'], ['cost', '$4.20']]);
  assert.equal(root.querySelector('.run-status-group .run-chain-label').textContent, '1 done', 'said once: on the group bar');
  const moreBtn = root.querySelector('.gpage-bar .gpage-more[aria-haspopup="menu"]');
  assert.ok(moreBtn);
  moreBtn.click();
  assert.deepEqual(more, [moreBtn], 'the ⋯ hands its anchor to the host');
  const stop = root.querySelector('.gpage-bar .gpage-stop.btn.btn-danger');
  assert.ok(stop);
  assert.equal(stop.hidden, false, 'a member runs (it asks): Stop shows');
  assert.equal(stop.title, 'Stop Run 2', 'Stop names the member it stops');
  assert.equal(root.querySelectorAll('.gpage-actions [data-model-action="stop"]').length, 0, 'never a second Stop');
  assert.equal(ACTION_LABEL['open-pr'], 'View PR');
});

test('run 3: the Labels fact is the members\' labels, read-only; a cost of 0 says nothing; Stop hides once all are done', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row: { ...row(), costUsd: 0 }, project: 'acme-app', tab: 'runs', labels: ['hotfix'] }, NOOP);
  const kv = root.querySelector('.gpage-card > .rd-kv');
  const labels = kv.querySelector('[data-fact="labels"]');
  assert.equal(labels.hidden, false);
  assert.deepEqual([...labels.querySelectorAll('.rd-kv-v > *')].map((c) => c.textContent), ['hotfix']);
  assert.equal(labels.querySelector('button'), null, 'read-only: a group has no labels of its own');
  assert.equal(kv.querySelector('[data-fact="cost"]').hidden, true, 'never "$0.00"');
  const model = groupModel({ kind: 'feature', title: 'Run tags', members: [done, done] }, { now: NOW });
  const finished = { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, costUsd: 1,
    members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: `#history/k/p${i}`, model: m })) };
  paintGroupPage(root, { row: finished, project: 'acme-app', tab: 'runs' }, NOOP);
  assert.equal(root.querySelector('.gpage-stop').hidden, true, 'nothing runs: no Stop');
  assert.equal(kv.querySelector('[data-fact="labels"]').hidden, true, 'no member label: no row');
  paintGroupPage(root, { row: { ...finished, groupKind: 'chain' }, project: '', tab: 'runs' }, NOOP);
  assert.equal(root.querySelector('.gpage-head .kind-chip').textContent, 'Chain');
  paintGroupPage(root, { row: { ...finished, groupKind: 'user' }, project: '', tab: 'runs' }, NOOP);
  assert.equal(root.querySelector('.gpage-head .kind-chip').textContent, 'Group');
});

test('run 4 D13: the Back link carries the run page\'s chevron; D2: the made answer button names the question\'s primary', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const mountQuestion = (slot) => {
    slot.hidden = false;
    slot.innerHTML = '<div class="qpanel"><div class="plan-actions"><button class="btn-primary">Approve 2 runs</button></div></div>';
  };
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: true }, {
    ...NOOP, mountQuestion, answerLabel: () => root.querySelector('.gpage-question .btn-primary').textContent });
  const back = root.querySelector('.gpage-back');
  assert.ok(back.querySelector('.ic svg'), 'the chevron');
  // Slice 2: the run page's 28px quiet icon Back, named for the list.
  assert.equal(back.textContent.trim(), '');
  assert.equal(back.getAttribute('aria-label'), 'Back to Runs');
  for (const c of ['btn-sm', 'btn-quiet', 'btn-icon']) assert.ok(back.classList.contains(c), c);
  assert.equal(root.querySelector('.gpage-actions [data-model-action="answer"]').textContent, 'Approve 2 runs');
});

test('slice 3: a user group\'s PR controls sit on the status line; separate reads In review · 3 PRs and Any order, One reads In review · 1 PR', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const gh = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  const mk = (members) => { const model = groupModel({ kind: 'user', title: 'Login polish', members }, { now: NOW });
    return { kind: 'chain', groupKind: 'user', groupId: 'grp_a1b2c3d4e5f6', title: 'Login polish', model, costUsd: 0,
      members: model.members.map((m, i) => ({ position: i + 1, title: `R${i + 1}`, pipelineId: `p${i + 1}`, href: `#running/r${i}`, adhoc: true, model: m })) }; };
  const paint = (row) => { const heads = []; const root = buildGroupPage(doc);
    paintGroupPage(root, { row, project: 'p', tab: 'runs' }, { ...NOOP, paintHead: (acts, slot, head) => heads.push({ acts, slot, head }) });
    const bar = [...root.querySelectorAll('.gpage-bar [data-model-action]')].filter((b) => !b.hidden).map((b) => b.dataset.modelAction);
    return { root, bar, ...heads.at(-1) }; };
  const ready = paint(mk([done, done, done]));
  assert.deepEqual(ready.bar, []);
  assert.deepEqual(ready.head.cta, { state: 'create' });
  assert.equal(ready.root.querySelector('.gpage-ship').textContent, 'Any order, or as one PR when the runs combine');
  const sep = paint(mk([1, 2, 3].map((k) => ({ ...done, pr: gh(k) }))));
  assert.deepEqual(sep.bar, [], 'no Open PR in the bar (D10)');
  assert.deepEqual(sep.head.cta, { state: 'view', label: 'View PRs', menu: true, ws: true });
  assert.ok(sep.root.querySelector('.gpage-card .run-status').dataset.text.includes('In review · 3 PRs'));
  assert.equal(sep.root.querySelector('.gpage-ship').textContent, 'Any order');
  assert.equal(sep.root.querySelectorAll('.gpage-runs .run-member-pr .runs-pr').length, 3);
  const one = paint(mk([1, 2, 3].map(() => ({ ...done, pr: gh(9) }))));
  assert.deepEqual(one.bar, [], 'QA 7\'s Open PR moved to the head');
  assert.deepEqual(one.head.cta, { state: 'view', href: gh(9).url, menu: true });
  assert.ok(one.root.querySelector('.gpage-card .run-status').dataset.text.includes('In review · 1 PR'));
  assert.equal(one.root.querySelector('.gpage-ship').hidden, true, 'no ship line after One');
});

// Slice 3 (no layout jump): the live hand-off the reproduction logged. Run 1 ends → run 2 waits → its ticket fires →
// it runs before its graph is known → it has its graph. The card's stage bar is never hidden or rebuilt.
const F = REPLAY_FRAMES;
const WAIT2 = { ticket: { status: 'scheduled', after: { index: 1 } } };
const liveRow = (raws, pr = null) => {
  const model = groupModel({ kind: 'feature', title: 'Run tags', members: raws, pr }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, costUsd: 0, planning: null,
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: `#running/r${i + 1}`, runId: `r${i + 1}`, model: m, cost: null })) };
};
const livePage = (opts = {}) => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  doc.body.append(root);
  const paint = (raws, more = {}) => paintGroupPage(root, { row: liveRow(raws, more.pr), project: '', tab: 'runs', overview: false, logs: !!opts.logs }, NOOP);
  return { doc, root, paint, bar: () => root.querySelector('.gpage-card .run-status-bar') };
};

test('slice 3: a live hand-off keeps the last stage bar — never hidden, same nodes, edge still', () => {
  const { paint, bar: barOf, root } = livePage();
  paint([F[15], WAIT2]);
  const bar = barOf();
  const track = bar.querySelector('.run-prog-track');
  const marks = bar.querySelector('.run-prog-marks');
  assert.equal(bar.hidden, false);
  assert.equal(bar.dataset.mode, 'stages');
  const text = () => root.querySelector('.gpage-card .run-status').dataset.text;
  for (const [label, raws, line] of [
    ['run 1 done, run 2 waiting', [F.at(-1), WAIT2], 'Run 2 of 2 · waiting for run 1'],
    ['run 2 ticket fired', [F.at(-1), { ticket: { status: 'fired' } }], 'Run 2 of 2 · starting'],
    ['run 2 running before its graph (a blank nodes progress)', [F.at(-1), { status: 'running' }], 'Run 2 of 2 · starting'],
  ]) {
    paint(raws);
    assert.equal(text(), line, `${label}: the status line is the one the model gives, unchanged by the hold`);
    assert.equal(bar.hidden, false, `${label}: the bar row stays`);
    assert.equal(bar.dataset.mode, 'stages', `${label}: no flip to the markless bar`);
    assert.equal(bar.querySelector('.run-prog-track'), track, `${label}: same track node`);
    assert.equal(bar.querySelector('.run-prog-marks'), marks, `${label}: same marks node`);
    assert.equal(bar.dataset.pulse, 'off', `${label}: nothing works on the kept bar`);
  }
  paint([F.at(-1), F[3]]);                                           // run 2 has its graph
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('.run-prog-track'), track, 'run 2\'s stages reuse the same skeleton');
  assert.match(text(), /Run 2 of 2/);
});

test('slice 3: the hold never covers a real change — PR needs you, failed, stopped, ready and in review hide the bar', () => {
  const PR = (extra = {}) => ({ url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', ...extra });
  const prNeedsRun = { status: 'done', pr: PR({ checks: { state: 'failing', total: 12, failed: 3, pending: 0 } }) };
  const openPrRun = { ...F.at(-1), pr: PR() };
  for (const [label, raws, state] of [
    ['a run in Needs you only through its PR', [prNeedsRun, WAIT2], 'needs-you'],
    ['a failed member', [F.at(-1), { status: 'error' }], 'failed'],
    ['a stopped member', [F.at(-1), { status: 'stopped' }], 'stopped'],
    ['a group ready to ship', [F.at(-1), F.at(-1)], 'ready'],
    ['a group in review', [openPrRun, openPrRun], 'in-review'],
  ]) {
    const { paint, bar } = livePage();
    paint([F[15], WAIT2]);
    assert.equal(bar().hidden, false, `${label}: painted first`);
    assert.equal(liveRow(raws).model.state, state, `${label}: the fixture is the state it names`);
    paint(raws);
    assert.equal(bar().hidden, true, `${label}: hides the bar, as before`);
  }
});

test('slice 3 (guard): a real nodes workflow (a step is active) repaints a painted stages bar as nodes', () => {
  const { paint, bar: barOf } = livePage();
  paint([F[15], WAIT2]);
  const nodesRun = { status: 'running', stepper: { version: 2, graph: { nodes: [{ id: 'n1', kind: 'agent', key: 'build', label: 'Build' }] } },
    steps: [], active: [{ nodeId: 'n1', executionId: 'e1' }] };
  const prog = liveRow([F.at(-1), nodesRun]).model.current.progress;
  assert.equal(prog.mode, 'nodes');
  assert.ok(prog.step, 'the fixture has an active step, so it is not a blank progress');
  paint([F.at(-1), nodesRun]);
  const bar = barOf();
  assert.equal(bar.hidden, false);
  assert.equal(bar.dataset.mode, 'nodes', 'a known graph with no stages is the markless bar');
});

test('slice 3: an unchanged repaint keeps the Runs table and the Logs items (same nodes, focus kept); a change replaces them', () => {
  const { doc, root, paint } = livePage({ logs: true });
  paint([F[15], WAIT2]);
  const ol = root.querySelector('.gpage-runs .run-members');
  const log = root.querySelector('.gpage-logs .gpage-log');
  const link = ol.querySelector('.run-member-title');
  link.focus();
  assert.equal(doc.activeElement, link);
  paint([F[15], WAIT2]);
  assert.equal(root.querySelector('.gpage-runs .run-members'), ol, 'same table node');
  assert.equal(root.querySelector('.gpage-logs .gpage-log'), log, 'same Logs item');
  assert.equal(doc.activeElement, link, 'focus stays on the member link');
  paint([F.at(-1), WAIT2]);                                           // run 1's row now reads done
  assert.notEqual(root.querySelector('.gpage-runs .run-members'), ol, 'a changed table is replaced');
});

test('slice 3: a focused member link keeps focus when ANOTHER row changes and the table is replaced', () => {
  const { doc, root, paint } = livePage();
  paint([F.at(-1), WAIT2]);
  const ol = root.querySelector('.gpage-runs .run-members');
  ol.querySelector('.run-member-title').focus();                    // row 1, done
  paint([F.at(-1), F[3]]);                                            // row 2 starts running
  const next = root.querySelector('.gpage-runs .run-members');
  assert.notEqual(next, ol, 'the table was replaced');
  assert.equal(doc.activeElement, next.querySelector('.run-member-title'), 'focus moved to the new row 1 link');
});

test('D3: syncRequirementsTab inserts a role=tab button after Runs and a role=tabpanel panel, and removes them; a repaint keeps one Requirements tab and the focused link; requirements falls back to runs when off', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  doc.body.appendChild(root);
  syncRequirementsTab(root, true);
  syncRequirementsTab(root, true);
  const tabs = () => [...root.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.dataset.tab);
  assert.deepEqual(tabs(), ['runs', 'requirements', 'overview', 'decisions', 'logs'], 'once, after Runs');
  const tab = root.querySelector('.rd-tab[data-tab="requirements"]');
  assert.ok(tab.matches('button.rd-tab.tab[type="button"][role="tab"]'));
  assert.equal(tab.textContent, 'Requirements');
  const panel = root.querySelector('.gpage-panel[data-tab="requirements"]');
  assert.ok(panel.matches('div.gpage-panel[role="tabpanel"]'));
  assert.equal(panel.previousElementSibling.dataset.tab, 'runs');
  assert.ok(panel.querySelector(':scope > div.gpage-requirements'));
  syncRequirementsTab(root, false);
  assert.deepEqual(tabs(), GROUP_TABS.map(([id]) => id), 'removed from the DOM, not hidden');
  assert.equal(root.querySelector('.gpage-panel[data-tab="requirements"]'), null);

  let n = 0;
  const node = (key) => { const d = doc.createElement('div'); d.className = 'shape-feature-reqs'; d.innerHTML = `<div class="plan-check-row" data-key="R-po-1"><span class="plan-check-detail"><a class="rd-fact-link" href="#running/r2">run 2</a> · ${key}</span></div>`; return d; };
  let word = 'being built';
  const deps = { ...NOOP, mountRequirements: () => { n += 1; return node(word); } };
  paintGroupPage(root, { row: row(), project: '', tab: 'requirements', overview: true, requirements: true }, deps);
  assert.equal(root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'requirements');
  assert.equal(root.querySelector('.gpage-panel[data-tab="requirements"]').hidden, false);
  assert.equal(root.querySelectorAll('.rd-tab[data-tab="requirements"]').length, 1);
  const link = root.querySelector('.gpage-requirements a.rd-fact-link');
  link.focus();
  paintGroupPage(root, { row: row(), project: '', tab: 'requirements', overview: true, requirements: true }, deps);
  assert.equal(root.querySelector('.gpage-requirements a.rd-fact-link'), link, 'an unchanged repaint keeps the node');
  word = 'met';
  paintGroupPage(root, { row: row(), project: '', tab: 'requirements', overview: true, requirements: true }, deps);
  const fresh = root.querySelector('.gpage-requirements a.rd-fact-link');
  assert.notEqual(fresh, link);
  assert.equal(doc.activeElement, fresh, 'the focus moves to the same row\'s link');
  assert.equal(root.querySelectorAll('.rd-tab[data-tab="requirements"]').length, 1);
  assert.equal(n, 3);
  paintGroupPage(root, { row: row(), project: '', tab: 'requirements', overview: true, requirements: false }, deps);
  assert.equal(root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab, 'runs', 'off: requirements falls back to Runs');
  assert.equal(root.querySelector('.rd-tab[data-tab="requirements"]'), null);
  assert.equal(n, 3, 'nothing mounted while off');
});

// ── small runs: an open stop on the feature page, the one-line rows, Create N PRs and the visible reason ──
const visibleBar = (root) => [...root.querySelectorAll('.gpage-actions [data-model-action]')].filter((b) => !b.hidden);
test('item 6: a stop in the question slot leaves the bar without an answer, so one primary stays; any other ask keeps it', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const mount = (stop) => (slot) => {
    slot.hidden = false;
    if (stop) slot.dataset.stop = ''; else delete slot.dataset.stop;
    slot.innerHTML = '<div class="qpanel"><button class="btn btn-primary" data-qpanel-submit>Re-plan</button></div>';
  };
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row: row(), project: 'p', tab: 'runs' }, { ...NOOP, mountQuestion: mount(true), answerLabel: () => 'Re-plan' });
  assert.deepEqual(visibleBar(root).map((b) => b.dataset.modelAction), []);
  assert.deepEqual([...root.querySelectorAll('.btn-primary')].filter((b) => !b.closest('[hidden]')).map((b) => b.textContent), ['Re-plan']);
  paintGroupPage(root, { row: row(), project: 'p', tab: 'runs' }, { ...NOOP, mountQuestion: mount(false), answerLabel: () => 'Agree and plan' });
  assert.deepEqual(visibleBar(root).map((b) => b.textContent), ['Agree and plan']);
});

test('item 7: shortState draws one-line rows with its words; without it the rows are dev\'s', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const words = { 1: 'done', 2: 'waiting for you', 3: null };
  paintGroupPage(root, { row: row(), project: 'p', tab: 'runs', shortState: (mb) => words[mb.position] }, NOOP);
  const list = root.querySelector('.gpage-runs .run-members');
  assert.ok(list.classList.contains('is-one-line'));
  assert.deepEqual([...list.querySelectorAll('.run-member-state')].map((x) => x.textContent).slice(1), ['done', 'waiting for you', 'Waiting · starts after run 2']);
  assert.equal(list.querySelector('.run-member-line'), null);
  paintGroupPage(root, { row: row(), project: 'p', tab: 'runs' }, NOOP);
  const dev = root.querySelector('.gpage-runs .run-members');
  assert.equal(dev.className, 'run-members is-table');
  assert.equal(dev.querySelectorAll('.run-member-line').length, 4);
});

test('item 8 (D11): while Ship is blocked the status line ends with the reason; a held row says it itself; unblocked as before', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const reason = 'Waiting for Compliance to confirm R-comp-4';
  const text = (view, hold = null) => {
    const root = buildGroupPage(doc);
    const heads = [];
    const model = groupModel({ kind: 'feature', title: 'T', members: [done, done], hold }, { now: NOW });
    paintGroupPage(root, { row: { ...row(), planning: null, model, members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: '#x', model: m })) },
      project: 'p', tab: 'runs', ...view }, { ...NOOP, paintHead: (a, s, head) => heads.push(head) });
    return [root.querySelector('.gpage-card .run-status').textContent, heads.at(-1).cta];
  };
  const [blocked, cta] = text({ ship: { n: 2, blocked: true, reason } });
  assert.equal(blocked.split(reason).length - 1, 1, blocked);
  assert.match(blocked, /^Ready to ship/);
  // Slice 7 (D8): the lock's words travel as `tip`, so no native tooltip opens over the status line.
  assert.deepEqual(cta, { state: 'create', label: 'Create 2 PRs', disabled: true, quiet: true, tip: reason });
  const [open, cta2] = text({ ship: { n: 2, blocked: false, reason: '' } });
  assert.equal(open, text({})[0]);
  assert.deepEqual(cta2, { state: 'create', label: 'Create 2 PRs' });
  const [held] = text({ ship: { n: 2, blocked: true, reason: 'R-ops-1 is owned by no run' } }, 'R-ops-1 is owned by no run');
  assert.equal(held.split('R-ops-1 is owned by no run').length - 1, 1, held);
  // The Overview tab's ready Ship card says the reason: the status line does not repeat it.
  const [onOverview] = text({ ship: { n: 2, blocked: true, reason }, overview: true, tab: 'overview' });
  assert.equal(onOverview.includes(reason), false, onOverview);
});


// ---- Shaper small runs s4 (R-ux-1, R-arch-4): the feature page's Runs rows read the shared run status ----
const S4_MEMBER = (sl) => (sl.state === 'done' ? { status: 'done', endReached: true }
  : ['planned', 'held', 'canceled'].includes(sl.state) ? { ticket: { status: 'scheduled' } }
  : sl.state === 'error' ? { status: 'error' } : { status: 'running' });
const s4Row = (slices) => {
  const model = groupModel({ kind: 'feature', title: 'F', planning: done, members: slices.map(S4_MEMBER) }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'F', model, costUsd: 0,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning, cost: 0 },
    members: model.members.map((m, i) => ({ position: slices[i].index, title: `Run ${slices[i].index}`, href: `#running/r${i}`, model: m, slice: slices[i] })) };
};
const s4Slices = (row) => new Map(row.members.map((mb) => [mb.position, mb.slice]));
const s4Status = (row) => { const slices = s4Slices(row); return (mb) => runStatus({ slice: mb.slice || null, slices, snap: null }); };
const s4Paint = (row, view = {}) => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  paintGroupPage(root, { row, project: 'acme', tab: 'runs', overview: true, requirements: true, ...view }, NOOP);
  const li = (n) => [...root.querySelectorAll('.gpage-runs .run-member:not([data-key="planning"])')].find((x) => x.querySelector('.run-member-num').textContent === String(n));
  return { root, li, word: (n) => li(n).querySelector('.run-member-state').textContent, dot: (n) => li(n).querySelector('.status-dot') };
};
const SL4 = (i, state, over = {}) => ({ index: i, state, kind: 'build', waitsFor: [], buildsOn: [], nextTurn: false, cannotStart: false, stop: null, ...over });

test('s4 feature page: with `status` the rows show the dashed ring, "?" and "!" with their words (R-ux-1)', () => {
  const row = s4Row([SL4(1, 'done'), SL4(2, 'approval', { stop: { reason: 'requirement', held: false }, buildsOn: [1] }), SL4(3, 'running', { buildsOn: [1] }),
    SL4(4, 'held', { stop: { reason: 'check', held: true, after: 3 }, buildsOn: [1, 3] }), SL4(5, 'error', { buildsOn: [3, 4] })]);
  const p = s4Paint(row, { shortState: () => 'dev short', status: s4Status(row) });
  assert.equal(p.word(4), 'after run 3');
  assert.ok(p.dot(4).classList.contains('is-dashed-ring') && !p.dot(4).classList.contains('has-sym'));
  assert.equal(p.dot(4).dataset.symbol, undefined);
  assert.equal(p.word(2), 'waiting for you');
  assert.equal(p.dot(2).dataset.symbol, 'question');
  assert.equal(p.word(5), 'failed');
  assert.equal(p.dot(5).dataset.symbol, 'alert');
  assert.equal(p.li(4).dataset.mark, 'after');
  assert.equal(p.word(1), 'done');
  assert.equal(p.word(3), 'dev short', 'a live run with no snapshot keeps the surface\'s own short word');
  assert.ok(p.dot(3).classList.contains('is-pulse'));
  assert.ok(![1, 2, 3, 4, 5].some((n) => /^next/.test(p.word(n))));
});

test('s4 feature page base state: run 7 waits for run 2 (needs you), 6; run 12 waits for run 7, 10; run 9 next; a free run no word; run 1 done', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-s4-page-'));
  try {
    await withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, () => {
      const fx = world(root, 'base');
      const row = s4Row(featureView(fx.featureId, { live: fx.live }).slices);
      const p = s4Paint(row, { shortState: () => 'dev short', status: s4Status(row) });
      assert.equal(p.word(7), 'waits for run 2 (needs you), 6');
      assert.equal(p.word(12), 'waits for run 7, 10');
      assert.equal(p.word(9), 'next');
      assert.ok(p.dot(9).classList.contains('is-ink-ring'));
      assert.equal(p.word(13), '');
      assert.ok(p.dot(13).classList.contains('is-grey-ring'));
      assert.equal(p.word(1), 'done');
      assert.ok(p.dot(1).classList.contains('is-green'));
      assert.ok(p.dot(12).classList.contains('is-grey-ring'));
      assert.equal(p.root.querySelector('.gpage-runs .run-member-line'), null);
      assert.equal([...p.root.querySelectorAll('.gpage-runs .run-member-state')].filter((n) => n.textContent === 'next').length, 1);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('s4 feature page: without `status` the Runs rows are today\'s (no data-mark, no new dot class)', () => {
  const row = s4Row([SL4(1, 'done'), SL4(2, 'held', { stop: { reason: 'check', held: true, after: 1 } })]);
  const a = s4Paint(row, { shortState: () => 'x' });
  assert.equal(a.root.querySelector('[data-mark]'), null);
  assert.equal(a.root.querySelector('.is-dashed-ring, .is-ink-ring'), null);
  const b = s4Paint(row, { shortState: () => 'x', status: undefined });
  assert.equal(a.root.querySelector('.gpage-runs').outerHTML, b.root.querySelector('.gpage-runs').outerHTML);
});

// ---- Shaper small runs slice 7 (R-po-5): the feature page's state line and need-you count ---------------------------
const S7_LINE = 'Run 6 reviewing · next: run 9';
function s7Page(base = row()) {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const paint = (more = {}, r = base) => paintGroupPage(root, { row: r, project: 'p', tab: 'runs', overview: true, requirements: true, ...more }, NOOP);
  return { root, paint, detail: () => root.querySelector('.gpage-card .run-status-detail').textContent,
    chips: () => [...root.querySelectorAll('.rd-title-row .kind-chip[data-need]')] };
}

test('s7 T16 feature page: `stateLine` is the status line and `needCount` is one "4 need you" chip after the kind chip', () => {
  const p = s7Page();
  p.paint({ stateLine: S7_LINE, needCount: 4 });
  assert.equal(p.detail(), S7_LINE);
  assert.deepEqual(p.chips().map((c) => c.textContent), ['4 need you']);
  assert.deepEqual([p.chips()[0].tagName, p.chips()[0].className], ['SPAN', 'kind-chip']);
  assert.equal(p.chips()[0].previousElementSibling, p.root.querySelector('.gpage-head .kind-chip:not([data-need])'));
  assert.equal(p.root.querySelector('.gpage-head .kind-chip').textContent, 'Feature', 'the kind chip is untouched');
  // No trailing \b: textContent runs the chip straight into the next word.
  assert.equal(p.root.textContent.match(/\bneed you/g)?.length, 1, 'the count is said once on the page');
  p.paint({ stateLine: S7_LINE, needCount: 4 });
  assert.equal(p.chips().length, 1, 'a repaint adds no second chip');
  p.paint({ stateLine: S7_LINE, needCount: 1 });
  assert.deepEqual(p.chips().map((c) => c.textContent), ['1 needs you']);
  p.paint({ stateLine: S7_LINE, needCount: 0 });
  assert.equal(p.root.querySelector('[data-need]'), null, 'nothing at zero');
  assert.equal(p.detail(), S7_LINE);
});

test('s7 T16 feature page: without `stateLine` and `needCount` the page is today\'s, also after a paint that had them', () => {
  const today = s7Page();
  today.paint();
  assert.equal(today.root.querySelector('[data-need]'), null);
  const empty = s7Page();
  empty.paint({ stateLine: null, needCount: 0 });
  assert.equal(empty.root.outerHTML, today.root.outerHTML);
  const p = s7Page();
  p.paint({ stateLine: S7_LINE, needCount: 4 });
  assert.notEqual(p.detail(), today.detail(), 'the state line replaced the model\'s line');
  p.paint();
  assert.equal(p.root.querySelector('[data-need]'), null);
  assert.equal(p.detail(), today.detail());
});

test('s7 T16 feature page: while Ship is blocked the reason still ends the state line', () => {
  const reason = 'Waiting for Compliance to confirm R-comp-4';
  const model = groupModel({ kind: 'feature', title: 'T', members: [done, done] }, { now: NOW });
  const ready = { ...row(), planning: null, model, members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: '#x', model: m })) };
  assert.equal(model.state, 'ready');
  const p = s7Page(ready);
  p.paint({ stateLine: S7_LINE, needCount: 0, ship: { n: 2, blocked: true, reason } });
  assert.equal(p.detail(), `${S7_LINE} · ${reason}`);
});

// ---- Shaper small runs slice 10 (R-ux-3): "Show order" on the feature page's Runs tab ------------------------------
const ORDER_HINT = 'A run sits to the right of every run it builds on. A line joins a run that is not done to the runs waiting for it; links that are already met are not drawn.';
/** featureView slice rows from `[run, buildsOn]` pairs; `done` run numbers are finished, every other run is planned. */
const orderRows = (pairs, done = []) => pairs.map(([index, buildsOn]) => SL4(index, done.includes(index) ? 'done' : 'planned',
  { title: `Run ${index}`, buildsOn: [...buildsOn], waitsFor: done.includes(index) ? [] : buildsOn.filter((d) => !done.includes(d)) }));
const SIXTEEN = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => [run, dependsOn]);
const FOUR_BRANCHING = [[1, []], [2, [1]], [3, [1]], [4, [2, 3]]];
const SIX_CHAIN = [[1, []], [2, [1]], [3, [2]], [4, [3]], [5, [4]], [6, [5]]];
/** A marked feature's page in a document (so focus works), painted with the 16 runs as `view.order`. */
function orderPage() {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  doc.body.append(root);
  const paint = (view = {}, r = row()) => paintGroupPage(root,
    { row: r, project: 'p', tab: 'runs', overview: true, requirements: true, order: orderRows(SIXTEEN), ...view }, NOOP);
  paint();
  const q = (s) => root.querySelector(s);
  return { doc, root, paint, q, toggle: () => q('.gpage-order-toggle'), body: () => q('.gpage-order-body'),
    maps: () => root.querySelectorAll('.rom').length, panel: () => q('.gpage-panel[data-tab="runs"]') };
}
/** The toggle, which must be there. */
function toggleOf(p) {
  const t = p.toggle();
  assert.ok(t, 'the Runs tab offers Show order');
  return t;
}
function assertClosed(p, why) {
  const t = toggleOf(p);
  assert.equal(t.textContent, 'Show order', why);
  assert.equal(t.getAttribute('aria-expanded'), 'false', why);
  assert.equal(p.body().hidden, true, why);
  assert.equal(p.maps(), 0, why);
  assert.equal(t.lastElementChild.outerHTML, icon(p.doc, 'chevron-down', 12).outerHTML, why);
}
function assertOpen(p, why) {
  const t = toggleOf(p);
  assert.equal(t.textContent, 'Hide order', why);
  assert.equal(t.getAttribute('aria-expanded'), 'true', why);
  assert.equal(p.body().hidden, false, why);
  assert.equal(p.maps(), 1, why);
  assert.equal(t.lastElementChild.outerHTML, icon(p.doc, 'chevron-up', 12).outerHTML, why);
}

test('s10 syncShowOrder: no order slices → no node', async () => {
  const { syncShowOrder } = await import('../ui/public/group-page.mjs');
  assert.equal(typeof syncShowOrder, 'function', 'group-page.mjs exports syncShowOrder');
  const today = s7Page();   // a page that never had the field
  today.paint();
  const todayPanel = today.root.querySelector('.gpage-panel[data-tab="runs"]').innerHTML;
  for (const order of [undefined, null, orderRows(FOUR_BRANCHING), orderRows(SIX_CHAIN)]) {
    const p = orderPage();   // painted with the 16 runs first: the node goes, it is not just hidden
    p.paint({ order });
    assert.equal(p.q('.gpage-order'), null, JSON.stringify(order?.length ?? order));
    assert.equal(p.panel().innerHTML, todayPanel, 'the Runs panel is as without the field');
    syncShowOrder(p.root, order || null, 'feat_1');
    assert.equal(p.q('.gpage-order'), null);
  }
});

test('s10 first paint closed: one Show order toggle above the rows, with the run page\'s quiet button', () => {
  const p = orderPage();
  assert.equal(p.root.querySelectorAll('.gpage-order').length, 1);
  assert.equal(p.root.querySelectorAll('.gpage-order-toggle').length, 1);
  assertClosed(p, 'first paint');
  const t = p.toggle();
  assert.equal(t.tagName, 'BUTTON');
  assert.equal(t.getAttribute('type'), 'button');
  for (const c of ['btn', 'btn-sm', 'btn-quiet']) assert.ok(t.classList.contains(c), c);
  assert.equal(p.panel().firstElementChild, p.q('.gpage-order'), 'first in the Runs panel');
  assert.ok(p.q('.gpage-order').compareDocumentPosition(p.q('.gpage-runs')) & 4, 'before the rows');
  assert.match(p.body().id, /^gpage-order-\d+$/);
  assert.equal(t.getAttribute('aria-controls'), p.body().id);
  const other = orderPage();
  assert.notEqual(other.body()?.id, p.body().id, 'two pages, two ids');
});

test('s10 click opens and closes the drawing', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.click();
  assertOpen(p, 'after a click');
  assert.equal(p.toggle(), t, 'the button is not replaced');
  assert.equal(t.getAttribute('aria-controls'), p.body().id);
  const map = p.body().querySelector('.rom');
  assert.ok(map, 'the drawing is in the body the button controls');
  assert.equal(map.getAttribute('aria-hidden'), 'true');
  assert.equal(map.querySelectorAll('.rom-run').length, 16);
  t.click();
  assertClosed(p, 'after a second click');
  assert.equal(p.toggle(), t);
});

test('s10 click keeps focus; a repaint keeps the node', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.focus();
  t.click();
  assert.equal(p.doc.activeElement, t);
  const map = p.q('.rom');
  p.paint();
  p.paint();   // fresh arrays with the same slices
  assert.equal(p.root.querySelectorAll('.gpage-order').length, 1);
  assert.equal(p.toggle(), t);
  assert.equal(p.doc.activeElement, t, 'focus stays on the toggle');
  assert.equal(p.q('.rom'), map, 'an unchanged drawing keeps its node');
  assertOpen(p, 'repaint while open keeps it open');
});

test('s10 a run turning done repaints the drawing', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.focus();
  t.click();
  const before = p.q('.rom');
  assert.ok(before.querySelector('.rom-link[data-from="2"]'), 'the fixture: links from run 2 are drawn');
  p.paint({ order: orderRows(SIXTEEN, [2]) });
  assert.notEqual(p.q('.rom'), before);
  assert.equal(p.root.querySelectorAll('.rom-link[data-from="2"]').length, 0);
  assert.ok(p.root.querySelector('.rom-link'), 'the other links stay');
  assert.equal(p.toggle(), t);
  assert.equal(p.doc.activeElement, t);
  assertOpen(p, 'still open');
});

test('s10 opening after a repaint draws the latest slices', () => {
  const p = orderPage();
  toggleOf(p);
  p.paint({ order: orderRows(SIXTEEN, [2]) });
  p.toggle().click();
  assertOpen(p, 'opened');
  assert.equal(p.root.querySelectorAll('.rom-link[data-from="2"]').length, 0, 'run 2 is done in the latest paint');
});

test('s10 another groupId resets to closed', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.click();
  assertOpen(p, 'opened');
  p.paint({}, { ...row(), groupId: 'feat_2' });
  assertClosed(p, 'another feature');
  assert.equal(p.toggle(), t, 'the button is kept');
  p.paint();
  assertClosed(p, 'back on the first feature');
});

test('s10 a tab switch keeps the choice', () => {
  const p = orderPage();
  toggleOf(p).click();
  const map = p.q('.rom');
  p.paint({ tab: 'overview' });
  p.paint({ tab: 'runs' });
  assertOpen(p, 'back on Runs');
  assert.equal(p.q('.rom'), map);
});

test('s10 a missing state repaints the kept node closed', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.click();
  assertOpen(p, 'opened');
  delete p.root.__order;
  p.paint();
  assert.equal(p.toggle(), t);
  assertClosed(p, 'no state');
});

test('s10 dropping below the threshold moves focus to the Runs tab', () => {
  const p = orderPage();
  const t = toggleOf(p);
  t.focus();
  assert.equal(p.doc.activeElement, t);
  p.paint({ order: orderRows(FOUR_BRANCHING) });
  assert.equal(p.q('.gpage-order'), null);
  assert.equal(p.doc.activeElement, p.q('.gpage-tabs .rd-tab[data-tab="runs"]'));
  const elsewhere = orderPage();
  toggleOf(elsewhere);
  const more = elsewhere.q('.gpage-tabs .rd-tab[data-tab="decisions"]');
  more.focus();
  elsewhere.paint({ order: orderRows(FOUR_BRANCHING) });
  assert.equal(elsewhere.q('.gpage-order'), null);
  assert.equal(elsewhere.doc.activeElement, more, 'focus elsewhere is left where it is');
});

test('s10 the toggle bar is right-aligned and holds only the toggle; the body carries the one hint, readable', () => {
  const p = orderPage();
  const t = toggleOf(p);
  const bar = p.q('.gpage-order > .gpage-order-bar');
  assert.ok(bar);
  assert.deepEqual([...bar.children], [t]);
  assert.equal(p.q('.gpage-order > .gpage-order-body'), p.body());
  for (const state of ['closed', 'open']) {
    const hints = p.body().querySelectorAll('p.gpage-order-hint');
    assert.equal(hints.length, 1, state);
    assert.equal(hints[0].textContent, ORDER_HINT);
    assert.equal(hints[0].closest('[aria-hidden="true"]'), null, 'only the drawing is hidden from screen readers');
    assert.equal(p.root.textContent.split(ORDER_HINT).length - 1, 1, 'said once on the page');
    t.click();
  }
});

// ── Shaper small runs slice 11 (R-ux-2): the footer's Resume is named by the host ────────────────────────────────
test('s11: deps.resumeLabel names the footer Resume; without it, or when it is empty, it reads "Resume"', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  // Run 2 paused before a working run 3: the group's current member is the paused one.
  const view = { row: liveRow([done, { status: 'paused' }, { status: 'running' }]), project: '', tab: 'runs' };
  const resumes = () => visibleBar(root).filter((b) => b.dataset.modelAction === 'resume').map((b) => b.textContent);
  paintGroupPage(root, view, { ...NOOP, resumeLabel: () => 'Resume after run 6' });
  assert.deepEqual(resumes(), ['Resume after run 6']);
  paintGroupPage(root, view, NOOP);
  assert.deepEqual(resumes(), ['Resume'], 'no dep');
  paintGroupPage(root, view, { ...NOOP, resumeLabel: () => 'Resume after run 6' });
  paintGroupPage(root, view, { ...NOOP, resumeLabel: () => '' });
  assert.deepEqual(resumes(), ['Resume'], 'an empty label');
});

// ── Feature page slice 6 (R-ux-3): the tabs Runs · Requirements · Decisions · Cost · Log, and Mark and ship ──────
const S6_TABS = ['runs', 'requirements', 'decisions', 'cost', 'logs'];
const s6Doc = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
const s6Root = () => { const doc = s6Doc(); const root = buildGroupPage(doc); doc.body.append(root); return { doc, root }; };
const s6TabIds = (root) => [...root.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.dataset.tab);
const s6Shown = (root) => [...root.querySelectorAll('.gpage-tabs .rd-tab')].filter((t) => !t.hidden).map((t) => t.textContent);
const s6Panel = (root, id) => root.querySelector(`.gpage-panel[data-tab="${id}"]`);
const s6Selected = (root) => root.querySelector('.rd-tab[aria-selected="true"]').dataset.tab;
/** The skeleton's tabs and panels, as buildGroupPage draws them. */
const s6Shape = (root) => ({
  tabs: [...root.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => [t.dataset.tab, t.textContent, t.className, t.getAttribute('type'), t.getAttribute('role')]),
  panels: [...root.querySelectorAll(':scope > .gpage-panel')].map((p) => [p.dataset.tab, p.className, p.getAttribute('role'), [...p.children].map((c) => c.className)]),
});
const S6_COST = { rows: [{ key: 'p1', num: 1, label: 'Slice 1', usd: 11.5 }], totalLabel: 'Total', totalUsd: 11.5 };
const s6View = (more = {}) => ({ row: row(), project: 'p', tab: 'runs', overview: true, logs: true, requirements: true, expert: true, cost: S6_COST, markOpen: false, ...more });
const s6Deps = (calls = {}) => ({ ...NOOP, mountRequirements: () => null,
  mountOverview: (...a) => { (calls.overview ||= []).push(a); }, mountStepLog: (...a) => { (calls.steps ||= []).push(a); },
  onMarkShip: () => { calls.mark = (calls.mark || 0) + 1; } });

test('syncFeatureLayout: the tabs read Runs, Requirements, Decisions, Cost, Log, and the Overview\'s node is the first child of Requirements', () => {
  const { root } = s6Root();
  const overview = root.querySelector('.gpage-overview');
  GroupPage.syncFeatureLayout(root, true);
  GroupPage.syncFeatureLayout(root, true);
  assert.deepEqual(s6TabIds(root), S6_TABS, 'once each');
  assert.deepEqual([...root.querySelectorAll('.gpage-tabs .rd-tab')].map((t) => t.textContent), ['Runs', 'Requirements', 'Decisions', 'Cost', 'Log']);
  const cost = root.querySelector('.rd-tab[data-tab="cost"]');
  assert.ok(cost.matches('button.rd-tab.tab[type="button"][role="tab"]'));
  assert.ok(s6Panel(root, 'cost').matches('div.gpage-panel[role="tabpanel"]'));
  assert.equal(s6Panel(root, 'cost').previousElementSibling, s6Panel(root, 'decisions'));
  assert.equal(s6Panel(root, 'overview'), null, 'removed, not hidden');
  assert.equal(s6Panel(root, 'requirements').firstElementChild, overview, 'the same node, moved');
  assert.ok(s6Panel(root, 'requirements').querySelector(':scope > .gpage-requirements'));
  assert.equal(root.querySelectorAll('.gpage-overview').length, 1);
  assert.equal(root.querySelectorAll('.gpage-steplog').length, 1);
  assert.ok(s6Panel(root, 'logs').querySelector('.gpage-steplog'));
});

test('R-arch-8: the layout turned on then off leaves the tabs, panels and Overview node of a fresh page', () => {
  const { doc, root } = s6Root();
  const overview = root.querySelector('.gpage-overview');
  GroupPage.syncFeatureLayout(root, true);
  root.querySelector('ul.gpage-logs').hidden = true;
  GroupPage.syncFeatureLayout(root, false);
  GroupPage.syncFeatureLayout(root, false);
  assert.deepEqual(s6TabIds(root), ['runs', 'overview', 'decisions', 'logs']);
  assert.deepEqual(s6Shape(root), s6Shape(buildGroupPage(doc)));
  assert.equal(s6Panel(root, 'overview').firstElementChild, overview, 'the same node, back under Overview');
  assert.equal(root.querySelector('ul.gpage-logs').hidden, false);
  assert.equal(root.querySelector('.gpage-steplog'), null);
});

test('a marked feature\'s page offers the five tabs; Requirements mounts the Overview view Ship first', () => {
  const { root } = s6Root();
  const overview = root.querySelector('.gpage-overview');
  const calls = {};
  paintGroupPage(root, s6View({ tab: 'requirements' }), s6Deps(calls));
  assert.deepEqual(s6Shown(root), ['Runs', 'Requirements', 'Decisions', 'Cost', 'Log']);
  assert.equal(s6Selected(root), 'requirements');
  assert.equal(calls.overview.length, 1);
  assert.equal(calls.overview[0][0], overview);
  assert.deepEqual(calls.overview[0][1], { shipFirst: true });
  assert.equal(s6Panel(root, 'requirements').firstElementChild, overview);
});

test('in the layout the old overview address selects Requirements; without it Overview stays', () => {
  const { root } = s6Root();
  paintGroupPage(root, s6View({ tab: 'overview' }), s6Deps());
  assert.equal(s6Selected(root), 'requirements');
  assert.equal(s6Panel(root, 'requirements').hidden, false);
  paintGroupPage(root, s6View({ tab: 'overview', requirements: false }), s6Deps());
  assert.equal(s6Selected(root), 'overview', 'a repaint with the layout off restores Overview');
  assert.deepEqual(s6Shown(root), ['Runs', 'Overview', 'Decisions', 'Logs']);
  assert.equal(root.querySelector('.rd-tab[data-tab="cost"]'), null);
});

test('the Cost tab paints the cost table in its panel', () => {
  const { root } = s6Root();
  paintGroupPage(root, s6View({ tab: 'cost' }), s6Deps());
  assert.equal(s6Selected(root), 'cost');
  assert.equal(s6Panel(root, 'cost').hidden, false);
  assert.equal(root.querySelectorAll('.gpage-cost').length, 1);
  assert.match(s6Panel(root, 'cost').querySelector('.gpage-cost tfoot').textContent, /Total\s*\$11\.50/);
  paintGroupPage(root, s6View({ tab: 'cost', cost: { ...S6_COST, totalUsd: 12 } }), s6Deps());
  assert.match(s6Panel(root, 'cost').querySelector('.gpage-cost tfoot').textContent, /\$12\.00/);
  assert.equal(root.querySelectorAll('.gpage-cost').length, 1, 'a repaint replaces the table');
});

test('Log: the Open logs rows then the step log; below Expert the tab stays and only the Open logs rows hide', () => {
  const { doc, root } = s6Root();
  for (const expert of [false, true]) {
    const calls = {};
    const r = row();
    paintGroupPage(root, s6View({ row: r, tab: 'logs', expert }), s6Deps(calls));
    assert.equal(s6Selected(root), 'logs', `expert ${expert}`);
    assert.equal(root.querySelector('.rd-tab[data-tab="logs"]').textContent, 'Log');
    assert.equal(root.querySelector('.rd-tab[data-tab="logs"]').hidden, false);
    const list = root.querySelector('ul.gpage-logs');
    assert.equal(list.hidden, !expert, `expert ${expert}`);
    assert.equal(list.querySelectorAll('li.gpage-log').length, 4);
    assert.equal(calls.steps.length, 1);
    const [host, passed] = calls.steps[0];
    assert.equal(passed, r);
    assert.ok(host.closest('.gpage-steplog'), 'the step log part');
    assert.equal(host.closest('.gpage-panel'), s6Panel(root, 'logs'));
    assert.ok(list.compareDocumentPosition(host) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING, 'the step log follows the rows');
  }
});

test('the status line does not repeat the ship reason on the tab that shows the Ship card (Requirements in the layout)', () => {
  const reason = 'Waiting for Compliance to confirm R-comp-4';
  const model = groupModel({ kind: 'feature', title: 'T', members: [done, done] }, { now: NOW });
  const ready = { ...row(), planning: null, model, members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: '#x', model: m })) };
  const { root } = s6Root();
  const status = (tab) => {
    paintGroupPage(root, s6View({ row: ready, tab, ship: { n: 2, blocked: true, reason } }), s6Deps());
    return root.querySelector('.gpage-card .run-status').textContent;
  };
  assert.ok(status('runs').includes(reason));
  assert.equal(status('requirements').includes(reason), false);
  assert.equal(status('overview').includes(reason), false, 'the old address shows the Ship card too');
});

test('Mark and ship: a primary button before the bar\'s actions while a mark is open; one node across repaints; removed when none is', () => {
  const { root } = s6Root();
  const calls = {};
  const paint = (markOpen) => paintGroupPage(root, s6View({ markOpen }), s6Deps(calls));
  paint(false);
  assert.equal(root.querySelector('.gpage-markship'), null);
  paint(true);
  const b = root.querySelector('.gpage-bar > .gpage-markship');
  assert.ok(b, 'in the page bar');
  assert.ok(b.matches('button.btn.btn-primary[type="button"]'));
  assert.equal(b.textContent, 'Mark and ship');
  assert.equal(b.nextElementSibling, root.querySelector('.gpage-bar > .gpage-actions'));
  for (const kept of ['.gpage-back', '.rd-crumbs', '.gpage-stop', '.gpage-more']) assert.ok(root.querySelector(`.gpage-bar > ${kept}`), `${kept} stays`);
  b.focus();
  paint(true);
  assert.equal(root.querySelector('.gpage-markship'), b, 'the same node');
  assert.equal(root.querySelectorAll('.gpage-markship').length, 1);
  assert.equal(b.ownerDocument.activeElement, b);
  b.click();
  assert.equal(calls.mark, 1);
  paint(false);
  assert.equal(root.querySelector('.gpage-markship'), null, 'removed, not hidden');
});

test('syncMarkShip: removing the focused button moves focus to the selected tab; an unfocused one takes no focus', () => {
  const { doc, root } = s6Root();
  paintGroupPage(root, s6View({ tab: 'decisions' }), s6Deps());
  GroupPage.syncMarkShip(root, true);
  GroupPage.syncMarkShip(root, true);
  assert.equal(root.querySelectorAll('.gpage-markship').length, 1);
  root.querySelector('.gpage-markship').focus();
  GroupPage.syncMarkShip(root, false);
  assert.equal(root.querySelector('.gpage-markship'), null);
  assert.equal(doc.activeElement, root.querySelector('.rd-tab[data-tab="decisions"]'));
  GroupPage.syncMarkShip(root, true);
  root.querySelector('.gpage-more').focus();
  GroupPage.syncMarkShip(root, false);
  assert.equal(doc.activeElement, root.querySelector('.gpage-more'));
});

test('R-arch-7: a page never in the layout gets no Cost tab, step log or Mark and ship, and its Overview stays put', () => {
  const { root } = s6Root();
  const overview = root.querySelector('.gpage-overview');
  const calls = {};
  for (const tab of ['runs', 'overview', 'decisions', 'logs', 'cost']) {
    paintGroupPage(root, s6View({ tab, requirements: false, markOpen: true }), s6Deps(calls));
    assert.equal(root.querySelector('.rd-tab[data-tab="cost"], .gpage-cost, .gpage-steplog, .gpage-markship'), null, tab);
    assert.deepEqual(s6TabIds(root), ['runs', 'overview', 'decisions', 'logs'], tab);
    assert.equal(s6Panel(root, 'overview').firstElementChild, overview, tab);
    assert.equal(root.querySelector('ul.gpage-logs').hidden, false, tab);
  }
  assert.equal(calls.steps, undefined);
  assert.equal(calls.overview.length, 1);
  assert.equal(calls.overview[0][1]?.shipFirst ?? false, false);
});

// ── Slice 7 (D7): the confirmation hold's reason links to the Ship card, only in the marked feature's layout ─────
test('s7: the layout page links a confirmation hold to the Ship card, and the hold wins over the state line', () => {
  const hold = 'Needs your confirmation: R-ux-2';
  const held = (more = {}) => {
    const model = groupModel({ kind: 'feature', title: 'Run tags', members: [done, done], hold }, { now: NOW });
    return { ...row(), planning: null, model, members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: '#x', model: m })), ...more };
  };
  const { root } = s6Root();
  paintGroupPage(root, s6View({ row: held(), stateLine: 'Run 2 is being built' }), s6Deps());
  const status = root.querySelector('.gpage-card .run-status');
  const link = status.querySelector('a.run-status-link');
  assert.ok(link, status.outerHTML);
  assert.equal(link.getAttribute('href'), '#feature/feat_1/requirements/ship');
  assert.equal(link.textContent, hold);
  assert.doesNotMatch(status.textContent, /Run 2 is being built/);
  const dev = s6Root().root;
  paintGroupPage(dev, { row: held(), project: 'p', tab: 'runs' }, NOOP);
  assert.equal(dev.querySelector('a.run-status-link'), null, 'no layout: no link');
  const unowned = s6Root().root;
  const model = groupModel({ kind: 'feature', title: 'T', members: [done, done], hold: 'R-ops-1 is owned by no run and confirmed by no person' }, { now: NOW });
  paintGroupPage(unowned, s6View({ row: { ...held(), model } }), s6Deps());
  assert.equal(unowned.querySelector('a.run-status-link'), null, 'another hold is plain text');
});

// ── Slice 11 (R-ux-4): the page's header line takes the Verifier's state; the Runs tab lists no round ────────────────
test('s11 group page: the header line of a failed-round feature reads the Verifier line', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const built = groupRow({ id: 'feat_1', groupKind: 'feature', title: 'Run tags', smallRuns: true, cost: { usd: 3, byPipeline: { p1: 2, v1: 1 } },
    members: [{ position: 1, title: 'Slice 1', pipelineId: 'p1', kind: 'hist', href: '#history/k/p1', run: { status: 'done' } }],
    checks: [{ kind: 'check', round: 2, state: 'failed', gaps: 1, pipelineId: 'v1', runId: '', href: '#history/k/v1', cost: 1 }] }, { now: NOW });
  // A marked feature's page names its members in the card's short word (app.js gives `shortState`), as in the app.
  paintGroupPage(root, { row: built, project: 'acme', tab: 'runs', overview: true, requirements: true, shortState: () => 'done' }, NOOP);
  const status = root.querySelector('.gpage-card .run-status');
  assert.equal(status.querySelector('.run-status-detail').textContent, 'Verifier round 2 failed · 1 gap');
  assert.equal(status.dataset.state, 'failed');
  assert.doesNotMatch(root.textContent, /Ready to ship/);
  assert.equal(root.querySelectorAll('.gpage-runs .run-member').length, 1, 'rounds stay absent from the Runs tab');
});

// ── Slice 12 (R-ux-5): the feature page's stop list, first in the Runs panel; one step card, for the opened stop ─────
const paused = RUN_STATE_ROWS.find((r) => r.state === 'paused').run;
/** A marked feature's group: run 1 done, runs 2, 3 and 4 wait for an answer, run 5 paused. The current member is run 2.
 *  `two` swaps run 2's raw run (it moves on once answered). */
function s12Row(two = asking) {
  const model = groupModel({ kind: 'feature', title: 'Run tags', members: [done, two, asking, asking, paused] }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, costUsd: 4.2, planning: null,
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: `p${i + 1}`, href: `#running/r${i + 1}`, runId: `r${i + 1}`, model: m, cost: 1 })) };
}
const s12Ask = (index) => ({ index, runId: `r${index}`, pipelineId: `p${index}`, id: `q${index}`, kind: 'gate', reason: 'check', failed: false, holdsUp: [] });
const s12Lines = (runs) => stopLinesOf({ asks: runs.map(s12Ask), slices: runs.map((i) => SL4(i, 'questions')) });
/** The page in a document, with recording stop deps and a question slot that behaves as app.js's: shown for a member,
 *  hidden for null. */
function s12Page({ focusOut = null } = {}) {
  const { doc, root } = s6Root();
  const log = { painted: [], bound: [], released: [], disposed: [], mounted: [] };
  const stopDeps = {
    paintQuestion: (ref, host) => {
      const panel = host.querySelector('.qpanel');
      log.painted.push(ref.pipelineId);
      if (!panel.querySelector('input')) { panel.append(doc.createElement('input')); panel.classList.remove('hidden'); }
      return null;
    },
    releaseQuestion: (host) => log.released.push(host),
    bindQuestion: (host, line) => { log.bound.push(line.index); return () => log.disposed.push(line.index); },
    resume: async () => ({ ok: true }),
    ...(focusOut ? { focusOut: () => focusOut(root) } : {}),
  };
  const mountQuestion = (slot, mb) => {
    log.mounted.push(mb ? mb.position : null);
    slot.hidden = !mb;
    if (mb) slot.innerHTML = '<div class="qpanel"><button type="button" class="btn btn-primary" data-qpanel-submit>Send</button></div>';
    else slot.replaceChildren();
  };
  const paint = (view = {}) => paintGroupPage(root, s6View({ row: s12Row(), ...view }), { ...s6Deps(), mountQuestion, stopDeps });
  const q = (sel) => root.querySelector(sel);
  const panel = () => s6Panel(root, 'runs');
  const list = () => q('ol.chat-rc-stops');
  const line = (run) => list()?.querySelector(`li[data-run="${run}"]`);
  const press = (run) => { const b = line(run)?.querySelector('button.chat-rc-stop-line'); assert.ok(b, `run ${run}'s line is a button`); b.click(); };
  const kids = () => [...panel().children].map((c) => c.classList[0]);
  return { doc, root, log, paint, q, panel, list, line, press, kids, cards: () => [...root.querySelectorAll('.chat-rc-stop-q')] };
}
const S12_HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

test('S12 feature layout with view.stops: the Runs panel\'s first child is ol.chat-rc-stops with 3 lines and 0 step cards; no heading added', () => {
  const today = s12Page();
  today.paint();
  const p = s12Page();
  p.paint({ stops: s12Lines([2, 3, 4]) });
  const list = p.panel().firstElementChild;
  assert.ok(list.matches('ol.chat-rc-stops'), `the first child is ${list.tagName}.${list.className}`);
  assert.equal(list.getAttribute('aria-label'), 'Open stops');
  assert.equal(list.hidden, false);
  assert.deepEqual([...list.querySelectorAll(':scope > li.chat-rc-stop')].map((li) => li.dataset.run), ['2', '3', '4']);
  assert.deepEqual([...list.querySelectorAll('.chat-rc-stop-text')].map((x) => x.textContent),
    ['Run 2 · plan approval', 'Run 3 · plan approval', 'Run 4 · plan approval']);
  assert.equal(p.cards().length, 0);
  assert.deepEqual([p.log.painted, p.log.bound], [[], []]);
  assert.equal(list.querySelector(S12_HEADINGS), null);
  assert.equal(p.root.querySelectorAll(S12_HEADINGS).length, today.root.querySelectorAll(S12_HEADINGS).length, 'no new heading on the page');
  p.paint({ stops: s12Lines([2, 3, 4]) });
  assert.equal(p.root.querySelectorAll('ol.chat-rc-stops').length, 1, 'one list');
  assert.equal(p.panel().firstElementChild, list, 'the same node');
});

test('S12: opening line 2 mounts 1 step card and .gpage-question stays hidden when the current member is listed', () => {
  const p = s12Page();
  p.paint({ stops: s12Lines([2, 3, 4]) });
  assert.deepEqual(p.log.mounted, [null], 'the listed current member draws no question slot');
  assert.equal(p.q('.gpage-question').hidden, true);
  p.press(3);                                       // the second line
  assert.equal(p.cards().length, 1);
  assert.equal(p.cards()[0].closest('li.chat-rc-stop'), p.line(3));
  assert.deepEqual(p.log.bound, [3]);
  const input = p.cards()[0].querySelector('input');
  input.value = 'half typed';
  input.focus();
  p.paint({ stops: s12Lines([2, 3, 4]) });          // a run frame repaints the page
  assert.equal(p.cards().length, 1);
  assert.equal(p.line(3).querySelector('input'), input);
  assert.equal(input.value, 'half typed');
  assert.equal(p.doc.activeElement, input);
  assert.deepEqual(p.log.bound, [3]);
  assert.equal(p.q('.gpage-question').hidden, true);
  assert.deepEqual(p.log.mounted, [null, null]);
});

test('S12 R-arch-10: no view.stops (flag off, unmarked), none listed, or no feature layout: no .chat-rc-stops node and the question slot is as today', () => {
  for (const view of [{}, { stops: [] }, { requirements: false, stops: s12Lines([2, 3, 4]) }]) {
    const p = s12Page();
    p.paint(view);
    const label = JSON.stringify({ requirements: view.requirements, stops: view.stops?.length });
    assert.equal(p.q('.chat-rc-stops'), null, label);
    assert.deepEqual(p.log.mounted, [2], `${label}: the current member keeps its question`);
    assert.equal(p.q('.gpage-question').hidden, false, label);
    assert.deepEqual(visibleBar(p.root).map((b) => b.dataset.modelAction), ['answer'], label);
  }
});

test('S12: when the last stop leaves, the list stays hidden and empty, the open card is released, and the question slot is as today', () => {
  const p = s12Page();
  p.paint({ stops: s12Lines([2, 3, 4]) });
  p.press(3);
  p.paint({ stops: [] });
  assert.ok(p.list(), 'the list node');
  assert.equal(p.list().hidden, true);
  assert.equal(p.list().children.length, 0);
  assert.deepEqual(p.log.disposed, [3]);
  assert.equal(p.log.released.length, 1);
  assert.equal(p.log.mounted.at(-1), 2);
  assert.deepEqual(visibleBar(p.root).map((b) => b.dataset.modelAction), ['answer']);
});

test('S12: with view.order offered, the Runs panel reads ol.chat-rc-stops, .gpage-order, .gpage-runs, on the first paint and after Show order is removed and rebuilt', () => {
  const p = s12Page();
  const stops = s12Lines([2, 3, 4]);
  const order = ['chat-rc-stops', 'gpage-order', 'gpage-runs'];
  p.paint({ stops, order: orderRows(SIXTEEN) });
  assert.deepEqual(p.kids().slice(0, 3), order, 'first paint');
  p.paint({ stops, order: orderRows(SIX_CHAIN) });  // not offered: removed
  assert.deepEqual(p.kids().slice(0, 2), ['chat-rc-stops', 'gpage-runs']);
  assert.equal(p.q('.gpage-order'), null);
  p.paint({ stops, order: orderRows(SIXTEEN) });    // built again: it prepends itself, so the list is put back on top
  assert.deepEqual(p.kids().slice(0, 3), order, 'after a rebuild');
});

test('S12: lines listed, all closed: the head shows no Answer and .gpage-question stays hidden, on the Runs tab and on the Cost tab', () => {
  for (const tab of ['runs', 'cost']) {
    const control = s12Page();
    control.paint({ tab });
    assert.deepEqual(visibleBar(control.root).map((b) => b.dataset.modelAction), ['answer'], `${tab}: the fixture offers Answer with no list`);
    const p = s12Page();
    p.paint({ tab, stops: s12Lines([2, 3, 4]) });
    assert.equal(s6Selected(p.root), tab);
    assert.deepEqual(visibleBar(p.root).map((b) => b.dataset.modelAction), [], tab);
    assert.equal(p.q('.gpage-question').hidden, true, tab);
    assert.equal(p.cards().length, 0, tab);
    assert.equal(s6Panel(p.root, 'cost').querySelector('.chat-rc-stops'), null, 'the Cost tab shows no list');
    assert.equal(p.root.querySelectorAll('.chat-rc-stops').length, 1, 'the one list, in the Runs panel');
    assert.ok(s6Panel(p.root, 'runs').querySelector(':scope > .chat-rc-stops'), tab);
  }
});

test('S12: the last listed line leaves with focus inside: the focus lands in .gpage-runs once the page has painted', () => {
  let calls = 0;
  const p = s12Page({ focusOut: (root) => { calls += 1; root.querySelector('.gpage-runs button, .gpage-runs a[href]')?.focus(); } });
  p.paint({ stops: s12Lines([2]) });
  p.press(2);
  p.cards()[0].querySelector('input').focus();
  // Run 2 is answered and moves on: its row is repainted in the same paint that drops its line.
  p.paint({ stops: [], row: s12Row({ status: 'running' }) });
  assert.equal(calls, 1);
  const runs = p.q('.gpage-runs');
  assert.ok(runs.contains(p.doc.activeElement), `focus is on ${p.doc.activeElement.tagName}.${p.doc.activeElement.className}`);
});
