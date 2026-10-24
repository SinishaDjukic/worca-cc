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
