// test/ui-one-model.test.mjs — spec §5.3: the same recorded run state gives the same dot, symbol, word, status line
// and actions on the Runs list row, the chat run card and the run page. Fails if Needs you / Failed is a plain dot.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { runModel, groupModel, MENU_ACTIONS, HEAD_ACTIONS } from '../src/shared/run-model.mjs';
import { buildRunsModel, renderRunsList, memberPrsOf } from '../ui/public/runs-list.mjs';
import { createChatRunCard } from '../ui/public/chat/run-card.mjs';
import { paintRunStatus, syncActions, statusText, memberStatusText } from '../ui/public/run-status-card.mjs';
import { buildGroupPage, paintGroupPage } from '../ui/public/group-page.mjs';
import { createAlerts, ALERT_KEYS } from '../ui/public/alerts.mjs';
import { RUN_STATE_ROWS, NOW, REPLAY_FRAMES } from './helpers/run-states.mjs';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import * as hd from './helpers/history-detail-boot.mjs';

const trackDom = useDomRelease(afterEach);
const FINISHED = new Set(['failed', 'stopped', 'ready', 'in-review', 'merged']);

function listFacts(doc, run, state) {
  const base = { title: 'Store tags', run, memo: {} };
  const src = state === 'waiting' ? { scheduled: [{ id: 't1', title: 'Store tags', status: 'scheduled', runAt: run.ticket.runAt }] }
    : FINISHED.has(state) ? { history: [{ ...base, id: 'p1', projectKey: 'acme', status: run.status, mtime: NOW - 60000 }] }
    : { live: [{ ...base, runId: 'r1', pipelineId: 'p1', status: run.status || '', ask: run.pendingQuestion ? { kind: run.pendingQuestion.kind, step: '' } : null, startedAt: new Date(NOW - 60000).toISOString() }] };
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ live: [], history: [], scheduled: [], groups: [], now: NOW, ...src })));
  const item = host.querySelector('.runs-item[data-level="top"]');
  const a = item.querySelector('.runs-row');
  return { state: a.dataset.state, word: item.dataset.stateWord, line: a.dataset.line, dot: item.querySelector('.runs-pick > .status-dot') };
}

function cardFacts(doc, run) {
  const card = createChatRunCard({ doc, win: doc.defaultView, ident: { cardId: 'c1', runId: 'r1', pipelineId: 'p1', title: 'Store tags' },
    snapshot: null, ctx: {}, controls: { memoFor: () => ({}), groupOf: () => null, paintQuestion: () => null, releaseQuestion: () => {},
      modelOpts: () => ({ now: NOW, timeZone: 'UTC' }) } });   // the same clock as pageFacts: the waiting line carries a time
  card.update({ source: 'live', runId: 'r1', pipelineId: 'p1', title: 'Store tags', status: run.status || '', pendingQuestion: run.pendingQuestion || null, run });
  const st = card.el.querySelector('.run-status');
  return { state: st.dataset.state, word: st.dataset.word, line: st.dataset.line, text: st.querySelector('.run-status-text').textContent,
    dot: card.el.querySelector('.ask-rc-head > .status-dot'),
    actions: [...card.el.querySelectorAll('[data-model-action]')].filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.dataset.modelAction) };
}

/** The run page's status card and header actions, painted as paintRdStatus paints them (the boot test below proves the wiring). */
function pageFacts(doc, run) {
  const card = doc.createElement('div');
  const acts = doc.createElement('span');
  const m = runModel(run, { memo: {}, now: NOW, timeZone: 'UTC' });
  paintRunStatus(card, m);
  syncActions(acts, m, { onAction: () => {} });
  return { state: card.dataset.state, word: card.dataset.word, line: card.dataset.line, text: card.querySelector('.run-status-text').textContent,
    dot: card.querySelector('.status-dot'), actions: [...acts.querySelectorAll('[data-model-action]')].map((b) => b.dataset.modelAction) };
}

const assertDot = (dot, { dot: want, symbol }, word, where) => {
  assert.ok(dot.classList.contains(`is-${want}`), `${where}: dot is-${want}`);
  if (symbol) {
    assert.equal(dot.dataset.symbol, symbol, `${where}: ${word} draws its symbol, never a plain dot`);
    assert.equal(dot.getAttribute('role'), 'img');
    assert.equal(dot.getAttribute('aria-label'), word);
    assert.ok(dot.querySelector('svg.status-sym[width="12"]'), `${where}: the 12px symbol`);
  } else assert.equal(dot.querySelector('svg'), null, `${where}: a plain dot`);
};

test('§5.3 one model: list row, chat card and run page agree for every §2.1 state', async () => {
  await checkRows(RUN_STATE_ROWS.map((row) => ({ name: row.state, run: () => {
    const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
    const m = runModel(row.run, { now: NOW, timeZone: 'UTC' });
    assert.equal(m.state, row.state, 'the recorded state lands in its §2.1 row');
    const list = listFacts(doc, row.run, row.state);
    const card = cardFacts(doc, row.run);
    const page = pageFacts(doc, row.run);
    for (const [where, f] of [['list', list], ['card', card], ['page', page]]) {
      assert.equal(f.state, row.state, `${where}: state`);
      assert.equal(f.word, m.word, `${where}: word`);
      assertDot(f.dot, row, m.word, where);
    }
    assert.equal(card.line, page.line, 'card and page: the same status line');
    assert.equal(card.text, page.text, 'card and page: the same visible status text');
    assert.equal(card.text, statusText(m).text);
    if (row.state !== 'waiting') assert.equal(list.line, m.line, 'list: the canonical line (data-line)');
    assert.deepEqual(card.actions, m.actions, 'card: the model actions, in order');
    assert.deepEqual(page.actions, m.actions, 'page: the model actions, in order');
  } })));
});

// §5a.5: the Needs you alert says what the list row and the card say. The fake Notification, hidden tab and notify
// flag are test/alerts.test.mjs setup()'s, copied here (no shared harness, by convention).
test('§5a.5 one model: a Needs you alert\'s body equals the card\'s and the list row\'s data-line', () => {
  const row = RUN_STATE_ROWS.find((r) => r.state === 'needs-you');
  const dom = trackDom(new JSDOM('<!doctype html><head><title>Worca</title></head><body></body>'));
  const doc = dom.window.document;
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => 'hidden' });
  doc.hasFocus = () => false;
  class N { constructor(title, opts = {}) { this.title = title; this.body = opts.body; N.shown.push(this); } close() {} }
  N.shown = [];
  N.permission = 'granted';
  const store = new Map([[ALERT_KEYS.notify, '1']]);
  const alerts = createAlerts({ Notification: N, doc, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    win: Object.assign(new dom.window.EventTarget(), { focus() {} }), drawFavicon: () => Promise.resolve(null) });
  alerts.onQuestion({ runId: 'r1', title: 'Store tags', line: runModel(row.run, { now: NOW, timeZone: 'UTC' }).line }, { id: 'q1', kind: row.run.pendingQuestion.kind });
  assert.equal(N.shown.length, 1);
  assert.equal(N.shown[0].body, cardFacts(doc, row.run).line, 'the card\'s data-line');
  assert.equal(N.shown[0].body, listFacts(doc, row.run, row.state).line, 'the list row\'s data-line');
});

const FAIL = { state: 'failing', total: 12, failed: 3, pending: 0 };
const PR = { url: 'https://github.com/acme/app/pull/759', number: 759, state: 'OPEN' };
const working = RUN_STATE_ROWS.find((r) => r.state === 'working').run;
const finished = RUN_STATE_ROWS.find((r) => r.state === 'ready').run;
const ROUND_ROWS = [
  { name: 'round 2', run: { ...working, round: { n: 2, request: 'add a filter', by: 'person' } }, state: 'working', line: /^Running · Round 2 · (Plan|Build|Review)$/ },
  { name: 'Watch PR round (raw marker)', run: { ...working, branch: { feature: 'feat/x', roundOf: { pipelineId: 'p1', round: 2, request: 'fix failing checks', by: 'watch' } } },
    state: 'working', line: /^Running · Round 2 · fix failing checks$/ },
  { name: 'Watch PR fixing', run: { ...finished, pr: { ...PR, checks: FAIL }, watch: { status: 'fixing', reason: null, fixRuns: 1 } },
    state: 'in-review', line: /^In review · PR #759$/, pr: 'Fixing' },
  { name: 'Watch stopped', run: { ...finished, pr: { ...PR, checks: FAIL }, watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } },
    state: 'needs-you', symbol: null, line: /^Needs you · Watch stopped · 3 fix runs, checks still failing$/, actions: ['open-pr', 'ask-changes'] },
];

function groupMemberFacts(doc, run) {
  const done = { status: 'done', endReached: true };
  const model = groupModel({ kind: 'feature', title: 'Run tags', members: [done, run, { ticket: { status: 'scheduled', after: { index: 2 } } }] }, { now: NOW, timeZone: 'UTC' });
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, count: model.count.text, planning: null,
    members: model.members.map((m, i) => ({ position: i + 1, title: `Slice ${i + 1}`, href: '#runs', model: m })) };
  const page = buildGroupPage(doc);
  paintGroupPage(page, { row, project: '', tab: 'runs', overview: false },
    { onAction: () => {}, onTab: () => {}, mountQuestion: () => {}, mountOverview: () => {}, mountDecisions: () => {}, logsHref: () => '#' });
  const li = page.querySelectorAll('.run-member')[1];
  return { rows: page.querySelectorAll('.run-member').length, text: li.querySelector('.run-member-line').textContent,
    dot: li.querySelector('.status-dot'), pr: li.querySelector('.run-member-pr').textContent, state: li.dataset.state };
}

test('D22 / D23: rounds and Watch PR read the same on the list row, the card, the run page and the group page', async () => {
  await checkRows(ROUND_ROWS.map((row) => ({ name: row.name, run: () => {
    const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
    const m = runModel(row.run, { now: NOW, timeZone: 'UTC' });
    assert.equal(m.state, row.state);
    assert.match(m.line, row.line, 'the model words it');
    const list = listFacts(doc, row.run, row.state === 'working' ? 'working' : 'ready');
    const card = cardFacts(doc, row.run);
    const page = pageFacts(doc, row.run);
    const member = groupMemberFacts(doc, row.run);
    assert.equal(list.line, m.line, 'list: data-line');
    for (const [where, f] of [['list', list], ['card', card], ['page', page], ['group page', member]]) {
      assert.equal(f.state, row.state, `${where}: state`);
      // QA 6: a stopped Watch PR is a PR-driven Needs you: the plain amber dot (symbol null) everywhere.
      if (row.symbol !== undefined) assertDot(f.dot, { dot: 'amber', symbol: row.symbol }, 'Needs you', where);
    }
    for (const [where, f] of [['card', card], ['page', page]]) {
      assert.equal(f.text, statusText(m).text, `${where}: the same status text`);
    }
    // QA 4: a member row's text never repeats its own PR chip ("In review · PR #759" → "In review").
    assert.equal(member.text, memberStatusText(m), 'group page: the member status text');
    assert.equal(member.rows, 3, 'a round adds no member row');
    if (row.pr) assert.match(member.pr, new RegExp(row.pr), 'the member row\'s PR chip');
    if (row.actions) {
      assert.deepEqual(card.actions, row.actions, 'card actions');
      assert.deepEqual(page.actions, row.actions, 'page actions');
    }
  } })));
});

// ---- the boot half: app.js wires the shared renderer and the model's actions on the real pages ------------------------
const asking = REPLAY_FRAMES.find((f) => f.pendingQuestion);
const workingFrame = RUN_STATE_ROWS.find((r) => r.state === 'working').run;
const frameOf = (f, over = {}) => ({ type: 'state', runId: 'r1', id: 'p1', status: f.status, stepper: f.stepper, steps: f.steps, active: f.active,
  endReached: f.endReached, tokens: f.tokens, progressFacts: f.progressFacts, subAgents: [], totalCostUsd: 1, ...over });
/** Slice 3 (D5): the run page words a failed run "Failed · Build · Implementation"; the list and the card keep the model's
 *  "Build · failed · Implementation". */
const pageLine = (line) => line.replace(/^(.*?) · failed(?: · (.*))?$/, (_, a, b) => ['Failed', a, b].filter(Boolean).join(' · '));
const shownActions = (root) => [...root.querySelectorAll('[data-model-action]')].filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.dataset.modelAction);

// `row`: the run's History row (the live page reads a finished run's PR and Watch from it, as app.js rdModelRun does).
async function runPage(frames, { row = null } = {}) {
  const ctx = await bootApp(row ? { fetchHandler: (u) => (u.endsWith('/api/history') ? hd.ok({ pipelines: [row], ghAvailable: true }) : null) } : {});
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1' });
  for (const f of frames) ctx.dispatch(f);
  ctx.go('running/r1');
  await ctx.settle(6);
  const doc = ctx.window.document;
  return { ctx, doc, block: doc.querySelector('#run-detail .rd-sheet .run-status'), bar: doc.querySelector('#run-detail .rd-bar-end') };
}

test('§5.3 boot: #running/r1 paints the one status block and the model actions (needs you, failed, working, a round)', async () => {
  const roundOf = { pipelineId: 'p1', round: 2, request: 'add a filter', by: 'person' };
  const CASES = [
    { name: 'needs you', frames: [frameOf(asking, { status: 'running' }), { type: 'question', runId: 'r1', ...asking.pendingQuestion }],
      raw: { ...asking, status: 'running' }, symbol: 'question' },
    { name: 'failed', frames: [frameOf(workingFrame, { status: 'error', active: [] })], raw: { ...workingFrame, status: 'error', active: [] }, symbol: 'alert' },
    { name: 'working', frames: [frameOf(workingFrame)], raw: workingFrame, symbol: null },
    { name: 'round 2', frames: [frameOf(workingFrame, { branch: { feature: 'feat/x', roundOf } })], raw: { ...workingFrame, branch: { feature: 'feat/x', roundOf } }, symbol: null },
  ];
  await checkRows(CASES.map((c) => ({ name: c.name, run: async () => {
    const { block, bar } = await runPage(c.frames);
    const m = runModel({ ...c.raw, pendingQuestion: c.raw.pendingQuestion || null, pr: null });
    assert.equal(block.dataset.state, m.state);
    assert.equal(block.dataset.line, m.state === 'failed' ? pageLine(m.line) : m.line);
    // Slice 2: Archive and Report live in the run page's ⋯, never in its bar; slice 3: the head actions in the card head.
    assert.deepEqual(new Set(shownActions(bar)), new Set(m.actions.filter((id) => !MENU_ACTIONS.includes(id) && !HEAD_ACTIONS.includes(id))), 'the bar shows the model actions');
    assert.equal(bar.querySelector('[data-model-action="report"]'), null);
    const dot = block.querySelector('.status-dot');
    if (c.symbol) assert.equal(dot.dataset.symbol, c.symbol); else assert.equal(dot.querySelector('svg'), null);
  } })));
});

test('§5.3 boot: an interrupted run gets a made Resume (never the "Pause" button), which reaches chatRunControls.resume', async () => {
  const { ctx, bar } = await runPage([frameOf(workingFrame, { status: 'interrupted', active: [] })]);
  const resumed = [];
  ctx.window.__np.chatRunControls.resume = (ref) => { resumed.push(ref.runId); return Promise.resolve(); };
  assert.equal(bar.querySelector('.rd-pause').hidden, true, 'it still reads "Pause": not owned');
  const made = [...bar.querySelectorAll('[data-model-action="resume"]')].filter((b) => !b.hidden);
  assert.equal(made.length, 1);
  assert.ok(made[0].closest('.rd-actions'), 'a made button in the bar\'s actions slot');
  made[0].click();
  await ctx.settle();
  assert.deepEqual(resumed, ['r1']);
});

test('§5.3 boot: stale buttons never linger — done hides Pause; pausing disables the made Resume', async () => {
  await checkRows([
    { name: 'running, then done', run: async () => {
      const { ctx, bar } = await runPage([frameOf(workingFrame)]);
      assert.equal(bar.querySelector('.rd-pause').hidden, false);
      ctx.dispatch(frameOf(REPLAY_FRAMES.at(-1)));
      ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });
      await ctx.settle(4);
      assert.equal(bar.querySelector('.rd-pause').hidden, true);
      assert.equal(bar.querySelector('.rd-resume-split').hidden, true);
      assert.equal(bar.querySelector('.rd-pause').dataset.modelAction, undefined);
    } },
    { name: 'pausing', run: async () => {
      const { bar } = await runPage([frameOf(workingFrame, { status: 'pausing' })]);
      assert.equal(bar.querySelector('.rd-pause').hidden, true);
      const shown = [...bar.querySelectorAll('[data-model-action="resume"]')].filter((b) => !b.hidden);
      assert.equal(shown.length, 1);
      assert.equal(shown[0].disabled, true);
      assert.equal(shown[0].title, 'Pausing…');
    } },
  ]);
});

async function finishedPage({ row, detail, ghAvailable = false, more = () => null } = {}) {
  const arms = (url) => (url.endsWith('/api/history') ? hd.ok({ pipelines: [row], ghAvailable }) : more(url));
  const ctx = await hd.bootDetail({ rows: [row], detail, arms });
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await hd.settle(ctx.window, 4);
  await hd.openDetail(ctx, '');
  await hd.settle(ctx.window, 6);
  return { ctx, end: ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end'), doc: ctx.window.document };
}

test('§5.3 boot: the finished page owns its Resume for a resumable paused row, and makes none for an archived row', async () => {
  await checkRows([
    { name: 'paused, resumable', run: async () => {
      const { ctx, end } = await finishedPage({ row: { ...hd.ROW, status: 'paused' }, detail: { ...hd.DETAIL, state: { ...hd.DETAIL.state, status: 'paused', resumable: true } } });
      const resume = end.querySelector('.hd-resume');
      assert.equal(resume.hidden, false);
      assert.equal(end.querySelector('.hd-resume-split').hidden, false);
      assert.equal(resume.dataset.modelAction, 'resume');
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'state', runId: 'other', id: 'zzz', status: 'running' }) });   // paintHdLive again
      await hd.settle(ctx.window, 4);
      assert.equal(resume.hidden, false);
      assert.equal(end.querySelector('.hd-resume-split').hidden, false);
    } },
    { name: 'paused, archived', run: async () => {
      const { end } = await finishedPage({ row: { ...hd.ROW, status: 'paused' },
        detail: { ...hd.DETAIL, state: { ...hd.DETAIL.state, status: 'paused', archivedAt: '2026-10-18T10:00:00Z' } } });
      assert.equal(end.querySelector('.hd-resume').hidden, true);
      assert.equal(end.querySelector('.rd-actions [data-model-action="resume"]'), null, 'slice 2: never a Resume that cannot work');
    } },
    { name: 'failed: the saved state\'s ledger gives the card\'s line (stage and failed step), not a bare "Failed"', run: async () => {
      const failed = RUN_STATE_ROWS.find((r) => r.state === 'failed').run;
      const { doc } = await finishedPage({ row: { ...hd.ROW, status: 'error' },
        detail: { ...hd.DETAIL, state: { ...hd.DETAIL.state, status: 'error', stepper: failed.stepper, steps: failed.steps, active: [],
          progressFacts: failed.progressFacts || null } } });
      const block = doc.querySelector('#hist-detail .hd-glance .rd-sheet .run-status');
      const card = cardFacts(trackDom(new JSDOM('<!doctype html><body></body>')).window.document, failed);
      assert.equal(block.dataset.state, 'failed');
      assert.notEqual(block.dataset.line, 'Failed', 'the stage is known from the saved state');
      assert.equal(block.dataset.line, pageLine(card.line), 'page and card: the same status line, the page in its own order (D5)');
      assert.match(block.dataset.line, /^Failed · /);
    } },
    { name: 'workspace, a conflicting member PR: the page reads the same rollup as its Runs row (#784)', run: async () => {
      const gh = (n, more = {}) => ({ state: 'OPEN', url: `https://github.com/o/r/pull/${n}`, number: n, isDraft: false, mergeable: 'UNKNOWN', ...more });
      const row = { ...hd.ROW, status: 'done', target: 'workspace', pr: gh(11),
        members: [gh(11), gh(12, { mergeable: 'CONFLICTING' }), gh(13, { isDraft: true })].map((pr, i) => ({ memberKey: `m${i}`, name: `p${i}`, projectDir: `/tmp/p${i}`, branch: `f${i}`, sourceBranch: 'main',
          survived: true, affected: true, added: 1, removed: 0, pr })) };
      // A workspace record loads from /api/workspaces/…/runs/:id (app.js historyDetailUrl).
      const { doc } = await finishedPage({ row, detail: hd.DETAIL, more: (url) => (url.endsWith(`/runs/${row.id}`) ? hd.ok(hd.DETAIL) : null) });
      const block = doc.querySelector('#hist-detail .hd-glance .rd-sheet .run-status');
      const host = doc.createElement('div');
      const run = { status: 'done', pr: row.pr, memberPrs: memberPrsOf(row) };   // as app.js histRun builds the row's run
      host.append(...renderRunsList(doc, buildRunsModel({ history: [{ ...row, run, memo: {}, mtime: NOW - 60000 }], now: NOW })));
      const a = host.querySelector(`a.runs-row[data-pipeline-id="${row.id}"]`);
      assert.equal(a.querySelector('.runs-pr-word').textContent, 'Conflicts · 3 PRs');
      assert.deepEqual([block.dataset.state, block.dataset.line], [a.dataset.state, a.dataset.line], 'page and row: one model');
      assert.equal(block.dataset.state, 'needs-you');
    } },
    { name: 'done, the card head offers Create pull request', run: async () => {
      const { doc, end } = await finishedPage({ row: { ...hd.ROW, status: 'done', pr: null }, detail: hd.DETAIL, ghAvailable: true });
      const slot = doc.querySelector('#hist-detail .hd-glance .rd-head-acts .rd-pr-slot');
      assert.equal(slot.dataset.state, 'create');
      assert.equal(end.querySelectorAll('.rd-actions [data-model-action="ship"]').length, 0, 'no second Ship it');
    } },
  ]);
});

test('slice 2: the run pages\' bars never make Archive or Report (stopped, merged, failed, stopped resumable) at any level', async () => {
  const merged = { state: 'MERGED', url: 'https://github.com/acme/app/pull/759', number: 759 };
  const CASES = [
    { name: 'stopped', status: 'stopped' },
    { name: 'merged', status: 'done', pr: merged },
    { name: 'failed', status: 'error' },
    { name: 'stopped, resumable', status: 'stopped', resumable: true },
  ];
  const none = (root, where) => {
    assert.equal(root.querySelectorAll('.rd-actions [data-model-action="archive"]').length, 0, `${where}: no Archive`);
    assert.equal(root.querySelectorAll('.rd-actions [data-model-action="report"]').length, 0, `${where}: no Report`);
  };
  await checkRows(CASES.flatMap((c) => ['simple', 'advanced', 'expert'].map((level) => ({ name: `${c.name} at ${level}`, run: async () => {
    const live = await runPage([frameOf(workingFrame, { status: c.status, active: [], ...(c.pr ? { pr: c.pr } : {}), ...(c.resumable ? { resumable: true } : {}) })]);
    live.doc.documentElement.dataset.level = level;
    live.ctx.dispatch(frameOf(workingFrame, { status: c.status, active: [], ...(c.pr ? { pr: c.pr } : {}), ...(c.resumable ? { resumable: true } : {}) }));
    await live.ctx.settle(4);
    none(live.doc.querySelector('#run-detail'), 'live');
    const saved = await finishedPage({ row: { ...hd.ROW, status: c.status, ...(c.pr ? { pr: c.pr } : {}) },
      detail: { ...hd.DETAIL, state: { ...hd.DETAIL.state, status: c.status, ...(c.resumable ? { resumable: true } : {}) } } });
    saved.doc.documentElement.dataset.level = level;
    none(saved.doc.querySelector('#hist-detail'), 'saved');
  } }))));
});

// Needle (a), slice 3: the bar keeps only Run after and the live run controls. No ship, View PR, archive, retry, report
// or Ask for changes button in .rd-actions, for every finished state, on both pages, at Simple and Expert.
test('needle (a): the run pages\' bars make no ship, PR, archive, retry, report or ask-for-changes button', async (t) => {
  const url = 'https://github.com/acme/app/pull/866';
  const open = { state: 'OPEN', url, number: 866, isDraft: false, mergeable: 'MERGEABLE' };
  // `state`: the painted status block's state on both pages, so each case is proven to be the state it names.
  const CASES = {
    stopped: { status: 'stopped', state: 'stopped' },
    merged: { status: 'done', pr: { ...open, state: 'MERGED' }, state: 'merged' },
    failed: { status: 'error', state: 'failed' },
    ready: { status: 'done', pr: null, state: 'ready' },
    'in review': { status: 'done', pr: open, state: 'in-review' },
    conflicts: { status: 'done', pr: { ...open, mergeable: 'CONFLICTING' }, state: 'needs-you' },
    'watch stopped': { status: 'done', pr: open, watch: { watching: true, status: 'needs-person', fixRuns: 3, reason: 'cap' }, state: 'needs-you' },
  };
  const SEL = ['ship', 'open-pr', 'archive', 'retry', 'report', 'ask-changes'].map((id) => `.rd-actions [data-model-action="${id}"]`).join(', ');
  for (const [name, c] of Object.entries(CASES)) {
    const over = { status: c.status, active: [] };
    const histRow = { ...hd.ROW, id: 'p1', live: true, status: c.status, pr: c.pr, ...(c.watch ? { watch: c.watch } : {}) };
    for (const level of ['simple', 'expert']) {
      await t.test(`needle (a) live · ${name} · ${level}`, async () => {
        const live = await runPage([frameOf(workingFrame, over)], { row: histRow });
        live.doc.documentElement.dataset.level = level;
        live.ctx.dispatch(frameOf(workingFrame, over));
        await live.ctx.settle(4);
        assert.equal(live.doc.querySelector('#run-detail .rd-sheet .run-status').dataset.state, c.state);
        assert.equal(live.doc.querySelector('#run-detail').querySelector(SEL), null);
      });
      await t.test(`needle (a) saved · ${name} · ${level}`, async () => {
        const row = { ...hd.ROW, status: c.status, pr: c.pr, ...(c.watch ? { watch: c.watch } : {}) };
        const saved = await finishedPage({ row, detail: { ...hd.DETAIL, state: { ...hd.DETAIL.state, status: c.status } }, ghAvailable: true });
        saved.doc.documentElement.dataset.level = level;
        await hd.settle(saved.ctx.window, 2);
        assert.equal(saved.doc.querySelector('#hist-detail .hd-glance .rd-sheet .run-status').dataset.state, c.state);
        assert.equal(saved.doc.querySelector('#hist-detail').querySelector(SEL), null);
      });
    }
  }
});
