// test/ui-group-page.test.mjs — the group page (ui/public/group-page.mjs, runs redesign slice 4 D13): header actions,
// title + kind chip, meta, the status card, the tabs Runs · Overview · Decisions · Logs, the Runs table, the ship line,
// and the plan / review receipts of the Decisions tab (D15).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { buildGroupPage, paintGroupPage, GROUP_TABS, runReceipts } from '../ui/public/group-page.mjs';
import { RUN_STATE_ROWS, NOW, REPLAY_FRAMES } from './helpers/run-states.mjs';

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
  assert.equal(root.querySelector('.gpage-head .kind-chip').textContent, 'Feature · 3 runs');
  assert.equal(root.querySelector('.gpage-meta').textContent, 'acme-app · Cost $4.20 total');
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
  assert.deepEqual([...root.querySelectorAll('.gpage-actions [data-model-action]')].map((b) => b.dataset.modelAction), ['answer', 'stop']);
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
  assert.equal(root.querySelector('.gpage-ship').hidden, true, 'no ship line for a user group');
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

test('QA 7: the header offers Open PR only when the group has exactly one PR', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const gh = (n, o = {}) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN', ...o });
  const mk = (g) => { const model = groupModel({ kind: 'feature', title: 'T', ...g }, { now: NOW });
    return { kind: 'chain', groupKind: 'feature', groupId: 'f', title: 'T', model, costUsd: 0,
      members: model.members.map((m, i) => ({ position: i + 1, title: `S${i + 1}`, href: `#running/r${i}`, model: m })) }; };
  const head = (row) => { const root = buildGroupPage(doc); paintGroupPage(root, { row, project: 'p', tab: 'runs' }, NOOP);
    return [...root.querySelectorAll('.gpage-actions [data-model-action]')].map((b) => b.dataset.modelAction); };
  assert.deepEqual(head(mk({ members: [done, done], pr: gh(1) })), ['open-pr'], 'shipped as one PR');
  assert.deepEqual(head(mk({ members: [{ ...done, pr: gh(2, { state: 'CLOSED' }) }, { ...done, pr: gh(1) }], pr: gh(1) })), ['open-pr'],
    'shipped as one PR: closed slice drafts and the same PR on a member do not count');
  assert.deepEqual(head(mk({ members: [{ ...done, pr: gh(1) }, done] })), ['open-pr'], 'one member PR');
  assert.deepEqual(head(mk({ members: [{ ...done, pr: gh(1) }, { ...done, pr: gh(2) }] })), [], 'two PRs: the rows\' chips');
});
