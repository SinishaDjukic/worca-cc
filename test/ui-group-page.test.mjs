// test/ui-group-page.test.mjs — the group page (ui/public/group-page.mjs, runs redesign slice 4 D13): header actions,
// title + kind chip, meta, the status card, the tabs Runs · Overview · Decisions · Logs, the Runs table, the ship line,
// and the plan / review receipts of the Decisions tab (D15).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { buildGroupPage, paintGroupPage, GROUP_TABS, runReceipts, groupPrList } from '../ui/public/group-page.mjs';
import { ACTION_LABEL } from '../src/shared/run-model.mjs';
import { RUN_STATE_ROWS, NOW, REPLAY_FRAMES } from './helpers/run-states.mjs';

const trackDom = useDomRelease(afterEach);
const done = { status: 'done', endReached: true };
const asking = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
const NOOP = { onAction: () => {}, onTab: () => {}, mountQuestion: () => {}, mountOverview: () => {}, mountDecisions: () => {}, logsHref: (mb) => `${mb.href}/logs` };
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
  assert.equal(root.querySelector('.rd-title-row .kind-chip').textContent, 'Feature');   // run 3 (D7): the kind
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
    ['#running/r0/logs', '#running/r1/logs', '#running/r2/logs', '#running/r3/logs']);
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

test('run 3: the group page shares the run page head — kind word, facts in the card, Stop and ⋯', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  doc.body.append(root);
  const more = [];
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: false }, { ...NOOP, onMore: (b) => more.push(b) });
  assert.equal(root.querySelector('.rd-title-row .kind-chip').textContent, 'Feature');
  assert.equal(root.querySelector('.gpage-meta'), null);
  assert.equal(root.querySelector('.rd-crumbs, .rd-crumb'), null, 'the breadcrumb is the top bar\'s (nav/crumbs.mjs)');
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
  assert.equal(root.querySelector('.rd-title-row .kind-chip').textContent, 'Chain');
  paintGroupPage(root, { row: { ...finished, groupKind: 'user' }, project: '', tab: 'runs' }, NOOP);
  assert.equal(root.querySelector('.rd-title-row .kind-chip').textContent, 'Group');
});

test('the title row and the bar sit in .ph, with no Back and no in-page crumbs; D2: the made answer button names the question\'s primary', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const root = buildGroupPage(doc);
  const mountQuestion = (slot) => {
    slot.hidden = false;
    slot.innerHTML = '<div class="qpanel"><div class="plan-actions"><button class="btn-primary">Approve 2 runs</button></div></div>';
  };
  paintGroupPage(root, { row: row(), project: 'acme-app', tab: 'runs', overview: true }, {
    ...NOOP, mountQuestion, answerLabel: () => root.querySelector('.gpage-question .btn-primary').textContent });
  const head = root.querySelector(':scope > .ph');
  assert.equal(root.firstElementChild, head, 'the head is the page\'s first child');
  assert.ok(head.querySelector('.ph-main > .rd-title-row > h1.gpage-title'));
  assert.equal(head.querySelector('.gpage-title').tabIndex, -1, 'a focus landing after a navigation');
  assert.ok(head.querySelector('.ph-actions > .gpage-bar'));
  assert.ok(head.querySelector('.ph-tabs > .gpage-tabs'));
  assert.equal(root.querySelectorAll('.gpage-back, .rd-crumbs, .gpage-head').length, 0);
  assert.equal(root.dataset.tab, 'runs', 'the status card shows on the Runs tab (style.css)');
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
