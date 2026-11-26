// test/ui-shape-feature-card.test.mjs — Shaper s2: the feature card model (log, open step, controls, notes, watch; the
// run model owns the head, status line, bars and member rows), its log painter, and a feature written before this
// change (DB rows) rendering with its open ask answerable.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readFileSync } from 'node:fs';
import { featureCardModel, paintFeatureLog, oneCardModel, ONE_CARD_STEPS } from '../ui/public/shape/feature-card.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { shaperCard, liveSliceFrom } from '../src/core/shape/features.mjs';
import { createRunCardController } from '../ui/public/chat/run-card.mjs';
import { PROGRESS_CARD_TYPE } from '../ui/public/ask-run-card.mjs';
import { registerAskRenderer } from '../ui/public/ask/registry.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { renderStatusDot } from '../ui/public/status-dot.mjs';
import { closeMenus } from '../ui/public/workflows/menu.mjs';
import { featureView } from '../src/core/shape/features.mjs';
import { world, SIXTEEN_RUN_LINKS } from './helpers/shape-sixteen-runs.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
// Slice 7: a namespace read, so a missing new export fails only its own test, not the whole file.
import * as FC from '../ui/public/shape/feature-card.mjs';
import { stopLinesOf } from '../ui/public/shape/stop-list.mjs';
import { renderGateCard, stepChip, stepTitle } from '../ui/public/shape/step-card.mjs';
import { planStop } from '../src/shared/shape/run-stops.mjs';

useTempHome(after, 'worca-shape-feature-card-');

const trackDom = useDomRelease(afterEach);
const prog = (stage, label, tone = 'blue', fraction = 0.3) => ({ mode: 'stages', stage, label, fraction, tone, text: label });
const snap = (pipelineId, over = {}) => ({ source: 'live', terminal: false, runId: `run-${pipelineId}`, pipelineId, status: 'running', pendingQuestion: null, stageProgress: prog('plan', 'Plan'), ...over });
const SL = (i, state, over = {}) => ({ index: i, title: `Part ${i}`, state, runId: null, pipelineId: null, ticketId: `t${i}`, pr: null, ...over });
const VIEW = (slices, over = {}) => ({ id: 'feat-1', title: 'Charts', status: 'active', total: slices.length, done: slices.filter((s) => s.state === 'done').length,
  halted: null, slices, ask: null, log: [], originPipelineId: 'p1', ship: { ready: false, mode: null }, ...over });
const card = (feature, log = feature ? feature.log : []) => ({ pipelineId: 'p1', feature, log });

test('shaping: the open step is the planning run\'s ask; no head fields (D5)', () => {
  const own = snap('p1', { shaping: { rounds: [] }, pendingQuestion: { id: 'clarify-1', kind: 'clarify' } });
  const m = featureCardModel({ own, card: card(null, []) });
  assert.equal(m.phase, 'shaping');
  assert.deepEqual([m.step.index, m.step.kind, m.step.pipelineId], [null, 'clarify', 'p1']);
  assert.deepEqual(Object.keys(m).sort(), ['controls', 'log', 'notesLine', 'phase', 'step', 'watch']);
});

test('after a 3-run split: the feature phase, run 1\'s ask is the open step; no chip, status, group, members or run (D5)', () => {
  const own = snap('p1', { shaping: { feature: { id: 'feat-1' } }, pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } });
  const v = VIEW([SL(1, 'approval', { pipelineId: 'p1', runId: 'run-p1' }), SL(2, 'planned'), SL(3, 'planned')]);
  const m = featureCardModel({ own, card: card(v) });
  assert.equal(m.phase, 'feature');
  assert.deepEqual([m.step.index, m.step.pipelineId], [1, 'p1']);
  for (const k of ['chip', 'icon', 'word', 'status', 'run', 'group', 'members']) assert.equal(k in m, false, k);
});

test('run 2 asks: the open step is run 2\'s (its ref), the server pointer is the fallback', () => {
  const own = snap('p1', { status: 'done', terminal: true, stageProgress: null });
  const two = snap('p2', { pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } });
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1', pr: { url: 'https://x/pr/12', number: 12, state: 'OPEN', draft: true } }), SL(2, 'approval', { pipelineId: 'p2', runId: 'run-p2' }), SL(3, 'planned')],
    { ask: { index: 2, runId: 'run-p2', pipelineId: 'p2', id: 'plan-n_refine-1', kind: 'plan' } });
  const m = featureCardModel({ own, card: card(v), snapOf: (pid) => (pid === 'p2' ? two : null) });
  assert.deepEqual([m.step.index, m.step.pipelineId, m.step.runId, m.step.snap], [2, 'p2', 'run-p2', two]);
  const noLive = featureCardModel({ own, card: card(v) });
  assert.deepEqual([noLive.step.index, noLive.step.pipelineId, noLive.step.snap], [2, 'p2', null]);
});

test('controls follow the feature: a running run 2 is the target; a halted one names it; done, canceled and re-planning have none active', () => {
  const own = snap('p1', { status: 'done', terminal: true });
  const at = (state2, two, over = {}) => featureCardModel({ own, card: card(VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, state2, { pipelineId: 'p2' }), SL(3, 'planned')], over)), snapOf: () => two });
  assert.deepEqual(at('running', snap('p2', { stageProgress: prog('build', 'Build') })).controls.target, { index: 2, runId: 'run-p2', pipelineId: 'p2', status: 'running', asks: false });
  const failed = at('error', snap('p2', { status: 'error', terminal: true, stageProgress: prog('review', 'Review', 'red') }), { halted: { index: 2, state: 'error', waiting: [3] } });
  assert.equal(failed.controls.halted, true);
  const all = featureCardModel({ own, card: card(VIEW([1, 2, 3].map((i) => SL(i, 'done')), { status: 'done', ship: { ready: true, mode: null } })) });
  assert.equal(all.controls.active, false);
  assert.equal(at('canceled', null, { status: 'canceled' }).controls.active, false);
  assert.equal(at('canceled', null, { status: 'replanning' }).controls.active, false);
});

test('paintFeatureLog: a check icon, the run tag, the words; Show unfolds the detail in place and stays open on a repaint', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><ol></ol></body>'));
  const doc = dom.window.document;
  const host = doc.querySelector('ol');
  const LOG = [{ key: 'clarify', run: null, text: 'Clarify · 2 answers', detail: ['Where? → Redis', 'How? → JSON'] },
    { key: '1-2', run: 1, text: 'Plan approved', detail: [] }];
  paintFeatureLog(doc, host, LOG);
  const rows = [...host.querySelectorAll('.chat-rc-log-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.chat-rc-log-text').textContent), ['Clarify · 2 answers', 'Plan approved']);
  assert.ok(rows[0].querySelector('.chat-rc-log-check svg'), 'the check icon (icons.mjs), not the runs-list glyph');
  assert.equal(rows[1].querySelector('.chat-rc-log-run').textContent, 'Run 1');
  assert.equal(rows[1].querySelector('.chat-rc-log-show'), null, 'nothing to show, no Show');
  const show = rows[0].querySelector('.chat-rc-log-show');
  const detail = rows[0].querySelector('.chat-rc-log-detail');
  assert.equal(detail.hidden, true);
  show.click();
  assert.equal(detail.hidden, false);
  assert.equal(show.textContent, 'Hide');
  assert.equal(show.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...detail.children].map((li) => li.textContent), ['Where? → Redis', 'How? → JSON']);
  paintFeatureLog(doc, host, [...LOG, { key: '2-0', run: 2, text: 'Plan approved', detail: [] }]);
  assert.equal(host.querySelector('[data-key="clarify"] .chat-rc-log-detail').hidden, false, 'still unfolded after a rebuild');
});

test('C5 (owner direction d86d13181): a Verifier receipt is a shared .srows row: its mark in the mark column, the text beside it in the gap rows\' text column', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><ol></ol></body>'));
  const doc = dom.window.document;
  const host = doc.querySelector('ol');
  paintFeatureLog(doc, host, [{ key: '1-2', run: 1, text: 'Plan approved', detail: [] },
    { key: 'verify-0', run: null, text: 'Verifier: 3 of 4 hold · 1 gap · run 5 added for it', detail: [], kind: 'verify' }]);
  const li = host.querySelector('li[data-key="verify-0"]');
  assert.ok(li.classList.contains('chat-rc-log-row') && li.classList.contains('srows'), 'a log row that is a .srows list');
  const row = li.querySelector(':scope > .plan-check-row');
  assert.deepEqual([...row.children].map((c) => c.className), ['plan-check-mark', 'plan-check-id', 'plan-check-text'],
    'mark, the empty id column (the gap rows\' text start), then the text: one row, no wrap point before the text');
  assert.ok(row.querySelector('.plan-check-mark svg'), 'the pass mark');
  assert.equal(row.querySelector('.plan-check-id').textContent, '');
  assert.equal(li.querySelector('.chat-rc-log-text').textContent, 'Verifier: 3 of 4 hold · 1 gap · run 5 added for it');
  assert.equal(li.querySelector('.chat-rc-log-check'), null, 'no second mark');
  assert.ok(host.querySelector('li[data-key="1-2"] .chat-rc-log-check'), 'other receipts keep the log row');
});

// ---- T9: a feature written before this change (rows as today's code writes them; nothing migrates, D19) -----------

const PRE = JSON.parse(readFileSync(new URL('./fixtures/shaper/pre-upgrade-feature.json', import.meta.url), 'utf8'));
function seedPre() {
  for (const row of PRE.pipelines) seedPipelineRow({ ...row, projectKey: 'proj-00000001' });
  for (const [table, rows] of Object.entries(PRE)) {
    if (table === 'pipelines') continue;
    for (const row of rows) {
      const cols = Object.keys(row);
      getDb().prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
    }
  }
  const t = createThread({ title: 'charts' });
  linkRun(t.id, { runId: 'run-b1', pipelineId: 'bbbb0001', cardId: 'card_pre' });
}
const PRE_PQ = { id: 'plan-n_refine-1', kind: 'plan', plan: { round: 1 } };

test('pre-upgrade feature: the card route\'s data from the rows, with or without a live entry', () => {
  seedPre();
  const live = (pid) => (pid === 'bbbb0002' ? liveSliceFrom({ runId: 'run-b2', status: 'running', pendingQuestion: PRE_PQ }) : null);
  const c = shaperCard('bbbb0001', { live });
  assert.equal(c.feature.id, 'feat-pre');
  assert.equal(c.feature.ask.pipelineId, 'bbbb0002');
  assert.deepEqual(c.log.map((l) => l.text), ['Clarify · 2 answers', 'Split into 3 runs', 'Plan approved']);
  const restarted = shaperCard('bbbb0001');                       // no live, no shaped: a restarted server
  assert.equal(restarted.feature.id, 'feat-pre');
  assert.equal(restarted.feature.ask, null);
});

test('pre-upgrade feature: the REST snapshot (no shaping) renders the feature card; run 2\'s ask is painted and answered with run 2\'s ref', async () => {
  registerAskRenderer('plan', { render() {}, collect: () => ({ decision: 'approve' }) });
  const live = (pid) => (pid === 'bbbb0002' ? liveSliceFrom({ runId: 'run-b2', status: 'running', pendingQuestion: PRE_PQ }) : null);
  const cardJson = JSON.parse(JSON.stringify(shaperCard('bbbb0001', { live })));
  const rest = { source: 'rest', terminal: true, status: 'done', pipelineId: 'bbbb0001' };   // rowToState: no shaping
  const two = { source: 'live', terminal: false, runId: 'run-b2', pipelineId: 'bbbb0002', status: 'running', pendingQuestion: PRE_PQ,
    stageProgress: { ...prog('plan', 'Plan', 'amber'), stages: [], passes: 0 } };   // runProgress's full shape: the bar reads stages
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'bbbb0001' ? rest : pid === 'bbbb0002' ? two : null), get: () => null };
  const painted = [];
  const answered = [];
  const controls = {
    paintQuestion: (ref, host) => {
      painted.push(ref.pipelineId);
      const panel = host.querySelector('.qpanel');
      if (!panel.querySelector('[data-qpanel-submit]')) { panel.innerHTML = '<button class="btn btn-primary" data-qpanel-submit>Approve</button>'; panel.classList.remove('hidden'); }
      return { id: PRE_PQ.id, kind: 'plan', heading: 'Plan · run 2', stepCard: false };
    },
    releaseQuestion: () => {},
    answer: (ref, id) => { answered.push([ref.pipelineId, id]); return true; },
  };
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  // The merge (D4): the card's status line and member rows are the feature group's (app.js groupRow); a stub row here.
  const gm = groupModel({ kind: 'feature', title: 'Charts', planning: { status: 'done', endReached: true },
    members: [{ status: 'done', endReached: true }, { status: 'running', pendingQuestion: PRE_PQ }, { ticket: { status: 'scheduled', after: { index: 2 } } }] });
  const titles = ['Store charts', 'Chart in Chat', 'Charts on the run page'];
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat-pre', title: 'Charts', model: gm, count: gm.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: gm.planning },
    members: gm.members.map((m, i) => ({ position: i + 1, title: titles[i], href: '#runs', model: m })) };
  controls.groupOf = () => row;
  const ctl = createRunCardController({ controls, runStore, tickMs: 0 });
  const built = ctl.build({ id: 'card_pre', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'bbbb0001', runId: 'run-b1', title: 'Charts' } },
    { doc: dom.window.document, win: dom.window, shaperCard: () => cardJson });
  dom.window.document.body.appendChild(built.el);
  const $ = (sel) => built.el.querySelector(sel);
  assert.equal($('.run-status').dataset.text, 'Run 2 of 3 · needs you');
  assert.equal(painted.at(-1), 'bbbb0002');
  assert.deepEqual([...built.el.querySelectorAll('.run-member-title')].map((n) => n.textContent),
    ['Planning', 'Store charts', 'Chart in Chat', 'Charts on the run page']);
  $('.chat-rc-q .qpanel [data-qpanel-submit]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(answered, [['bbbb0002', PRE_PQ.id]]);
  built.dispose(); ctl.destroy();
});

test('controls: the current run is the target; halted names Resume', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'error', { pipelineId: 'p2' }), SL(3, 'planned'), SL(4, 'planned')],
    { halted: { index: 2, state: 'error', waiting: [3, 4] }, open: true, approveEach: false, originPipelineId: 'p0' });
  const m = featureCardModel({ own: snap('p0'), card: card(v),
    snapOf: (pid) => (pid === 'p2' ? snap('p2', { status: 'failed', source: 'rest', terminal: true, stageProgress: { label: 'Review', text: 'Review' } }) : null) });
  assert.deepEqual(m.controls, { featureId: v.id, active: true, halted: true, rest: true, approveEach: false, planPipelineId: 'p0', held: null,
    target: { index: 2, runId: 'run-p2', pipelineId: 'p2', status: 'failed', asks: false } });   // snap() defaults runId to `run-${pid}`
});

test('controls carry held and the held slice is current', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'held'), SL(3, 'planned')], { open: true, held: { index: 2, ticketId: 't2' }, originPipelineId: 'p0' });
  const m = featureCardModel({ own: snap('p0'), card: card(v) });
  assert.deepEqual(m.controls.held, { index: 2 });
  assert.equal(m.controls.target.index, 2);
  assert.equal(m.controls.rest, true);
  const plain = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'planned')], { open: true, originPipelineId: 'p0' });
  assert.equal(featureCardModel({ own: snap('p0'), card: card(plain) }).controls.held, null);
});

test('controls: a current run that asks (plan approval) is a target that asks, live or from the slice state alone', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'approval', { pipelineId: 'p2' }), SL(3, 'planned')], { open: true, originPipelineId: 'p0' });
  const live = featureCardModel({ own: snap('p0'), card: card(v),
    snapOf: (pid) => (pid === 'p2' ? snap('p2', { status: 'running', pendingQuestion: { id: 'q-plan', kind: 'plan' } }) : null) });
  assert.equal(live.controls.target.status, 'running');
  assert.equal(live.controls.target.asks, true);
  const bare = featureCardModel({ own: snap('p0'), card: card(v) });
  assert.deepEqual([bare.controls.target.status, bare.controls.target.asks], ['running', true]);
});

test('re-planning: the re-plan run\'s outline ask is the open step (live snapshot, else the server pointer)', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'canceled')],
    { status: 'replanning', replan: { ticketId: 't9', pipelineId: 'rp1', runId: 'run-rp1' } });
  const asking = snap('rp1', { runId: 'run-rp1', pendingQuestion: { id: 'q-split', kind: 'plan', plan: { outline: { slices: [] } } } });
  const live = featureCardModel({ own: snap('p1'), card: card(v), snapOf: (pid) => (pid === 'rp1' ? asking : null) });
  assert.equal(live.step.kind, 'outline');
  assert.equal(live.step.pipelineId, 'rp1');
  assert.equal(live.controls.rest, false);
  const ptr = featureCardModel({ own: snap('p1'), card: card({ ...v, ask: { index: null, runId: 'run-rp1', pipelineId: 'rp1', id: 'q-split', kind: 'outline' } }) });
  assert.equal(ptr.step.kind, 'outline');
});

test('featureCardModel returns requirementChecks keyed by pipeline or ticket', () => {
  const check = { items: [{ id: 'R-po-1', label: 'R-po-1 · covered by the diff', pass: true, detail: '' }], passed: 1, total: 1 };
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1', requirements: { ids: ['R-po-1'], check } }), SL(2, 'planned', { requirements: { ids: ['R-qa-1'], check: null } }),
    SL(3, 'planned', { requirements: { ids: ['R-ux-1'], check } })]);
  const m = featureCardModel({ own: snap('p1', { status: 'done', terminal: true }), card: card(v) });
  assert.deepEqual(m.requirementChecks, { p1: check, t3: check });
  assert.deepEqual(featureCardModel({ own: snap('p1'), card: card(VIEW([SL(1, 'running', { pipelineId: 'p1' })])) }).requirementChecks, {});
});

// ── Shaper small runs B1: oneCardModel, the one card per feature (D4, D9, D11; Screens and states S1–S9) ──
const marked = (feature, log = feature ? feature.log : []) => ({ ...card(feature, log), smallRuns: true });
const PQ_CL = { id: 'clarify-1', kind: 'clarify', questions: [{ id: 'q1' }, { id: 'q2' }] };
const PQ_REQ = { id: 'plan-n_reqrefine-1', kind: 'plan', plan: { criteria: { ok: true, passed: 1, total: 1, items: [] } } };
const PQ_PLAN = { id: 'plan-n_refine-1', kind: 'plan', plan: { file: 'p.md' } };
const PQ_OUT = { id: 'plan-outline-n_plan-1', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } };
const L = (text, key = text) => ({ key, run: null, text, detail: [] });
const CL = L('Clarify · 2 answers', 'clarify');
const shapingOwn = (pq = null) => snap('p1', { shaping: { rounds: [] }, pendingQuestion: pq });
const v3 = (states, over = {}) => VIEW(states.map((st, i) => SL(i + 1, st, { pipelineId: st === 'planned' || st === 'canceled' ? null : `p${i + 1}` })), over);
const REPLAN = (over = {}) => v3(['done', 'canceled', 'canceled'], { status: 'replanning', replan: { ticketId: 't9', pipelineId: 'rp1', runId: 'run-rp1' }, ...over });
const RP_SNAP = snap('rp1', { pendingQuestion: PQ_OUT });
/** name → [input, state, step, detail, question id | null] */
const ONE_CASES = {
  S1: [{ own: shapingOwn(PQ_CL), card: marked(null, []) }, 'S1', 'requirements', '2 decisions, then you agree the requirements', PQ_CL.id],
  'S1 (one)': [{ own: shapingOwn({ ...PQ_CL, questions: [{ id: 'q1' }] }), card: marked(null, []) }, 'S1', 'requirements', '1 decision, then you agree the requirements', PQ_CL.id],
  S2: [{ own: shapingOwn(), card: marked(null, [CL]) }, 'S2', 'requirements', 'The roles write the requirements', null],
  S3: [{ own: shapingOwn(PQ_REQ), card: marked(null, [CL]) }, 'S3', 'requirements', 'Agree the requirements, then the Split', PQ_REQ.id],
  'S4 (agreed)': [{ own: shapingOwn(), card: marked(null, [CL, L('Requirements agreed')]) }, 'S4', 'split', 'The Planner proposes the runs', null],
  'S4 (plan)': [{ own: shapingOwn(), card: marked(null, [CL, L('Plan approved · after 1 round of changes')]) }, 'S4', 'split', 'The Planner proposes the runs', null],
  S5: [{ own: shapingOwn(PQ_PLAN), card: marked(null, [CL, L('Requirements agreed')]) }, 'S5', 'split', 'Check the plan, then the Planner proposes the runs', PQ_PLAN.id],
  S6: [{ own: shapingOwn(PQ_OUT), card: marked(null, [CL, L('Requirements agreed'), L('Plan approved')]) }, 'S6', 'split', 'Runs proposed, one after another · check, then approve', PQ_OUT.id],
  'S7 (asking)': [{ own: snap('p1', { status: 'done', terminal: true }), card: marked(REPLAN()), snapOf: (p) => (p === 'rp1' ? RP_SNAP : null) }, 'S7', 'split',
    'Runs proposed, one after another · check, then approve', PQ_OUT.id],
  'S7 (working)': [{ own: snap('p1', { status: 'done', terminal: true }), card: marked(REPLAN()) }, 'S7', 'split', 'The Planner proposes the runs', null],
  S8: [{ own: snap('p1', { status: 'done', terminal: true }), card: marked(v3(['done', 'running', 'planned'])) }, 'S8', 'build', '1 of 3 runs done', null],
  S9: [{ own: snap('p1', { status: 'done', terminal: true }), card: marked(v3(['done', 'done', 'done'], { status: 'done', ship: { ready: true, mode: null } })) }, 'S9', 'ship',
    'Ready to ship', null],
};

test('B1 oneCardModel: null without smallRuns: true, so every flag-off path stays on featureCardModel', () => {
  for (const c of [null, card(null, []), card(v3(['done', 'running', 'planned'])), { ...card(null, []), smallRuns: 'true' }]) {
    assert.equal(oneCardModel({ own: shapingOwn(PQ_CL), card: c }), null);
  }
  assert.deepEqual(ONE_CARD_STEPS, ['start', 'requirements', 'prototype', 'split', 'build', 'ship']);
});

test('B1 oneCardModel: null for a marked planning run that ended without a feature (never split), so dev\'s card shows its result or failure', () => {
  const log = [CL, L('Requirements agreed'), L('Plan approved')];
  for (const status of ['done', 'completed', 'complete', 'failed', 'stopped', 'error', 'aborted']) {
    assert.equal(oneCardModel({ own: snap('p1', { status, terminal: true }), card: marked(null, log) }), null, status);
  }
  assert.equal(oneCardModel({ own: snap('p1', { status: 'running' }), card: marked(null, log) }).state, 'S4', 'a live planning run stays the one card');
  assert.equal(oneCardModel({ own: snap('p1', { status: 'done', terminal: true }), card: marked(v3(['done', 'done', 'done'])) }).state, 'S9', 'a split feature keeps S9');
});

test('B1 oneCardModel: the table\'s state, step and detail for S1–S9; at most one question, the open ask\'s', () => {
  for (const [name, [input, state, step, detail, qid]] of Object.entries(ONE_CASES)) {
    const m = oneCardModel(input);
    assert.deepEqual([m.state, m.step, m.detail], [state, step, detail], name);
    assert.ok(ONE_CARD_STEPS.includes(m.step), name);
    assert.equal(m.question ? m.question.id : null, qid, `${name}: the one open ask`);
    assert.equal(m.kindWord, 'Feature', name);
    assert.equal(m.runs, !!input.card.feature, name);
    assert.equal(m.receipts, m.base.log, name);
    assert.equal(m.base.step, m.question, `${name}: the painted step is the question`);
    assert.doesNotMatch(m.detail, /prototype/i, name);
  }
});

test('B1 oneCardModel picks one question when the planning run and a slice both ask', () => {
  const own = snap('p1', { pendingQuestion: PQ_PLAN });
  const two = snap('p2', { pendingQuestion: { id: 'plan-n_refine-2', kind: 'plan', plan: {} } });
  const v = v3(['approval', 'approval', 'planned']);
  const m = oneCardModel({ own, card: marked(v), snapOf: (p) => (p === 'p2' ? two : null) });
  assert.equal(m.state, 'S8');
  assert.equal(typeof m.question, 'object');
  assert.equal(m.question.id, PQ_PLAN.id, 'the first asking member, one question');
});

test('B1 oneCardModel: in S7 the re-plan ask wins over a member\'s ask, in question and base.step', () => {
  const own = snap('p1', { pendingQuestion: { id: 'gate-1', kind: 'gate' } });
  const m = oneCardModel({ own, card: marked(REPLAN({ slices: [SL(1, 'running', { pipelineId: 'p1' }), SL(2, 'canceled'), SL(3, 'canceled')] })),
    snapOf: (p) => (p === 'rp1' ? RP_SNAP : null) });
  assert.equal(featureCardModel({ own, card: marked(REPLAN({ slices: [SL(1, 'running', { pipelineId: 'p1' }), SL(2, 'canceled'), SL(3, 'canceled')] })),
    snapOf: (p) => (p === 'rp1' ? RP_SNAP : null) }).step.id, 'gate-1', 'featureCardModel unchanged: the member first');
  assert.equal(m.state, 'S7');
  assert.equal(m.question.id, PQ_OUT.id);
  assert.equal(m.base.step, m.question);
  assert.equal(m.question.pipelineId, 'rp1');
});

// ── Shaper small runs B2: S0, the Start step (D18) ──
const PQ_CARE = { id: 'care-1', kind: 'care', care: { pick: { position: 'thorough', reason: 'r' } } };
test('B2 oneCardModel: S0 needs-you for an open care ask, S0 working for a marked run with no Care and no ask, the Care receipt first after Start', () => {
  const ask = oneCardModel({ own: shapingOwn(PQ_CARE), card: marked(null, []) });
  assert.deepEqual([ask.state, ask.step, ask.detail, ask.question.id], ['S0', 'start', 'Pick the Care, then the roles write the requirements', 'care-1']);
  const working = oneCardModel({ own: shapingOwn(), card: marked(null, []) });
  assert.deepEqual([working.state, working.step, working.detail, working.question], ['S0', 'start', 'Worca sizes the feature', null]);
  const CARE_LINE = L('Care: Lean · your choice · Worca recommended Thorough', 'care');
  const after = oneCardModel({ own: shapingOwn(PQ_CL), card: { ...marked(null, [CARE_LINE]), care: { position: 'lean' } } });
  assert.equal(after.state, 'S1');
  assert.equal(after.receipts[0].text, 'Care: Lean · your choice · Worca recommended Thorough');
  const s2 = oneCardModel({ own: shapingOwn(), card: { ...marked(null, [CARE_LINE]), care: { position: 'lean' } } });
  assert.equal(s2.state, 'S2', 'after Start, the roles write the requirements');
});

// Small runs B4 (D12): the host's bar reads the card's foot; a refused Split gives it no primary to mirror.
test('B4: the bar draws no primary while the Split is refused, and Approve again once it passes', async () => {
  const { renderOutlineBody } = await import('../ui/public/shape/outline-body.mjs');
  const { answerFieldOpen, stepTitle } = await import('../ui/public/shape/step-card.mjs');
  const d = new JSDOM('<!doctype html><body></body>').window.document;
  const sl = (id, requirements) => ({ id, title: `Run ${id}`, goal: 'g', inScope: [], outOfScope: [], acceptance: ['GET /x returns 200'], dependsOn: [], estimate: 'medium', requirements });
  const agreed = ['R-po-1', 'R-qa-1'].map((id) => ({ id, text: id }));
  const outline = { why: 'w', slices: [sl('s1', ['R-po-1']), sl('s2', ['R-po-1'])], agreed, leftOut: [] };
  const pq = { id: 'plan-outline-n_plan-1', kind: 'plan', plan: { round: 1, revisable: true, outline, smallRuns: true, care: 'balanced',
    challenge: { roles: [], challenger: true, rounds: 0, open: 0 } } };
  const root = d.createElement('div');
  const panel = d.createElement('div'); panel.className = 'qpanel'; root.appendChild(panel);
  renderOutlineBody(panel, pq, { doc: d, title: stepTitle(pq), chip: 'Runs', submit: async () => true, confirm: async () => true });
  assert.equal(stepTitle(pq), 'Your turn: fix the split');
  assert.equal(answerFieldOpen(root), true, 'refused: the bar keeps Answer plain');
  assert.equal(root.querySelector('.plan-actions .btn-primary'), null);
  const ok = { ...pq, plan: { ...pq.plan, outline: { ...outline, slices: [sl('s1', ['R-po-1']), sl('s2', ['R-qa-1'])] } } };
  const root2 = d.createElement('div');
  const panel2 = d.createElement('div'); panel2.className = 'qpanel'; root2.appendChild(panel2);
  renderOutlineBody(panel2, ok, { doc: d, title: stepTitle(ok), chip: 'Runs', submit: async () => true, confirm: async () => true });
  assert.equal(stepTitle(ok), 'Your turn: approve the runs');
  assert.equal(answerFieldOpen(root2), false);
  assert.equal(root2.querySelector('.plan-actions .btn-primary').textContent, 'Approve 2 runs');
});

// ── Shaper small runs C1: SP, the Prototype step (D21) ──
test('C1 oneCardModel: SP while the Prototype step asks or runs, with its detail per moment; confirmed and skipped show S4', async () => {
  const { ICON_WORD } = await import('../ui/public/shape/feature-card.mjs');
  const log = [L('Requirements agreed')];
  const ask = (prototype) => snap('p1', { pendingQuestion: { id: 'proto-1', kind: 'prototype', prototype } });
  const SCR = [{ section: 'a', name: 'Editor', ids: ['R-ux-1'] }, { section: 'b', name: 'Prefs', ids: [] }];
  const cases = [
    [ask({ moment: 'offered', screenIds: ['R-ux-1', 'R-ux-2', 'R-po-1'] }), null, '3 screen requirements'],
    [ask({ moment: 'built', screens: SCR, costUsd: 2.8 }), null, 'Prototype built · 2 screens · $2.80'],
    [ask({ moment: 'built', screens: SCR, costUsd: 3.2, rebuilt: true }), null, 'Prototype rebuilt with your remark · $3.20'],
    [ask({ moment: 'remark' }), null, 'Your remark changes a requirement'],
    [ask({ moment: 'failed' }), null, 'The prototype did not build'],
    [snap('p1'), { state: 'building', screens: [] }, 'Building the prototype'],
    [snap('p1'), { state: 'building', screens: SCR }, 'Building the prototype · 2 screens'],
    [snap('p1'), { state: 'reviewing', screens: SCR, reviewRounds: 1 }, 'Round 1 of 3'],
    [snap('p1'), { state: 'matching', screens: SCR }, ''],
  ];
  for (const [own, prototype, detail] of cases) {
    const m = oneCardModel({ own, card: { ...marked(null, log), ...(prototype ? { prototype } : {}) } });
    assert.deepEqual([m.state, m.step, m.detail], ['SP', 'prototype', detail], detail);
  }
  for (const state of ['confirmed', 'skipped']) {
    const m = oneCardModel({ own: snap('p1'), card: { ...marked(null, log), prototype: { state, screens: [] } } });
    assert.equal(m.state, 'S4', state);
  }
  assert.equal(ICON_WORD.ask, 'Needs you');
  assert.equal(ICON_WORD.run, 'Running');
});

// ── Small runs C2 (Step 7): a marked card's run rows say one short word ──
import { memberStatusText } from '../ui/public/run-status-card.mjs';
import { careRunPlan } from '../src/shared/shape/feature-record.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';

const C2_CARE = careRunPlan('balanced', { runRoles: ['product', 'architect'] });
const c2Agent = (id, key) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key, ports: { inputs: [], outputs: [] } });
const c2Manifest = (careRun) => ({ version: 2, template: { id: 'wf_shape_slice_req' }, graph: { nodes: [['n_plan', 'planner'], ['n_refine', 'refiner'],
  ['n_roles', 'planReviewer'], ['n_tests', 'testWriter'], ['n_impl', 'implementer'], ['n_review', 'reviewer']].map(([id, key]) => c2Agent(id, key)), wires: [] },
  ...(careRun ? { careRun } : {}) });
const c2Row = (nodeId, status = 'done') => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, ordinal: 1, cycle: 1, status, startedAt: '2026-11-21T10:00:00Z' });
/** A member run's store snapshot: `at` active, the nodes before it done. */
const c2Snap = (pid, { careRun = C2_CARE, at = 'n_tests', status = 'running' } = {}) => {
  const before = ['n_plan', 'n_roles', 'n_refine', 'n_tests', 'n_impl', 'n_review'];
  const done = before.slice(0, before.indexOf(at));
  const live = status === 'running';
  return { ...snapshotFromState({ id: pid, status, stepper: c2Manifest(careRun),
    steps: [...done.map((id) => c2Row(id)), c2Row(at, live ? 'start' : 'paused')], active: live ? [{ nodeId: at, executionId: `x:${at}:1` }] : [] }),
  source: 'live', runId: `run-${pid}` };
};
/** Paints a feature card (marked or not) whose member rows come from `members` (groupModel inputs) and `snaps`. */
function c2Card({ marked = true, members, pids, snaps, slices = {}, view = {} }) {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const v = VIEW(pids.map((pid, i) => SL(i + 1, members[i].status === 'done' ? 'done' : 'running', { pipelineId: pid, runId: `run-${pid}`, ...(slices[i + 1] || {}) })),
    { originPipelineId: 'p0', ...view });
  const cardJson = { pipelineId: 'p0', feature: v, log: [], ...(marked ? { smallRuns: true } : {}) };
  const rest = { source: 'rest', terminal: true, status: 'done', pipelineId: 'p0' };
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'p0' ? rest : snaps[pid] || null), get: () => null };
  const gm = groupModel({ kind: 'feature', title: 'Charts', planning: { status: 'done', endReached: true }, members });
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat-1', title: 'Charts', model: gm, count: gm.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: gm.planning },
    members: gm.members.map((m, i) => ({ position: i + 1, title: `Part ${i + 1}`, href: '#runs', model: m, pipelineId: pids[i], run: members[i] })) };
  const controls = { paintQuestion: () => null, releaseQuestion() {}, groupOf: () => row, memoFor: () => ({}) };
  const ctl = createRunCardController({ controls, runStore, tickMs: 0 });
  const built = ctl.build({ id: 'card_c2', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'p0', runId: 'run-p0', title: 'Charts' } },
    { doc: dom.window.document, win: dom.window, shaperCard: () => cardJson });
  dom.window.document.body.appendChild(built.el);
  const states = () => [...built.el.querySelectorAll('.run-member:not([data-key="planning"]) .run-member-state, .run-member:not([data-key="planning"]) .run-member-line')].map((n) => n.textContent);
  return { built, ctl, row, states };
}

test('C2 one card: run rows show the short word (Care words lowercase, dev fallback as is, held and no-careRun runs keep memberStatusText, done reads done)', () => {
  const members = [{ status: 'done', endReached: true }, { status: 'running' }, { status: 'paused' }, { status: 'running' }];
  const pids = ['p1', 'p2', 'p3', 'p4'];
  const snaps = { p2: c2Snap('p2'), p3: c2Snap('p3', { status: 'paused', at: 'n_impl' }), p4: c2Snap('p4', { careRun: null }) };
  const { built, ctl, row, states } = c2Card({ members, pids, snaps });
  const dev = row.members.map((mb) => memberStatusText(mb.model));
  assert.deepEqual(states(), ['done', 'writing tests', dev[2], dev[3]]);
  assert.notEqual(dev[2], 'paused');
  built.dispose(); ctl.destroy();
});

test('C2 marked card, run without careRun: the row text equals memberStatusText; an unmarked card\'s done member keeps it too', () => {
  const members = [{ status: 'done', endReached: true }, { status: 'running' }];
  const marked = c2Card({ members, pids: ['p1', 'p2'], snaps: { p2: c2Snap('p2', { careRun: null }) } });
  assert.equal(marked.states()[1], memberStatusText(marked.row.members[1].model));
  marked.built.dispose(); marked.ctl.destroy();
  // A finished run whose snapshot has no careRun (resumed from before C2) keeps dev's words too, not `done`.
  const old = c2Card({ members, pids: ['p1', 'p2'], snaps: { p1: c2Snap('p1', { careRun: null }) } });
  assert.equal(old.states()[0], memberStatusText(old.row.members[0].model));
  assert.notEqual(old.states()[0], 'done');
  old.built.dispose(); old.ctl.destroy();
  const plain = c2Card({ marked: false, members, pids: ['p1', 'p2'], snaps: { p2: c2Snap('p2') } });
  assert.deepEqual(plain.states(), plain.row.members.map((mb) => memberStatusText(mb.model)));
  plain.built.dispose(); plain.ctl.destroy();
});

// Small runs C3 (D15): the stopped run reads `waiting for you`, its held answer `after run 3`, a run building on it
// `waits for run 2`; an independent running run keeps its C2 word. The marked card's rows are one line.
test('C3 one card: open stop and held rows, a dependent waits for its builds-on run, and the run list is one line', () => {
  const members = [{ status: 'done', endReached: true }, { status: 'running' }, { status: 'running' }, { status: 'scheduled' }];
  const pids = ['p1', 'p2', 'p3', 'p4'];
  const stopSnap = { ...c2Snap('p2', { at: 'n_review' }), pendingQuestion: { id: 'gate-w9-3', kind: 'gate', stop: { reason: 'objection', run: 2, node: 'n_review', head: 'Run 2 · Code review objects' } } };
  const snaps = { p2: stopSnap, p3: c2Snap('p3') };
  const open = c2Card({ members, pids, snaps, slices: { 2: { stop: { reason: 'objection', held: false } }, 4: { waitsFor: 2 } } });
  assert.deepEqual(open.states(), ['done', 'waiting for you', 'writing tests', 'waits for run 2']);
  assert.ok(open.built.el.querySelector('.run-members.is-one-line'));
  open.built.dispose(); open.ctl.destroy();
  const held = c2Card({ members, pids, snaps, slices: { 2: { stop: { reason: 'objection', held: true, after: 3 } }, 4: { waitsFor: 2 } } });
  assert.deepEqual(held.states().slice(1, 2), ['after run 3']);
  held.built.dispose(); held.ctl.destroy();
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
  assert.match(css, /\.chat-rc-members \.run-members\.is-one-line \.run-member-title\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;\}/);
  // Item 9: the underlined look is the plain Show link's; the Decisions tab's .btn keeps its quiet button.
  assert.match(css, /\n\.chat-rc-log-show\{margin-left:auto;\}/);
  assert.match(css, /\.chat-rc-log-show:not\(\.btn\)\{background:none;[^}]*text-decoration:underline;\}/);
  assert.match(css, /\.chat-rc-log-show:not\(\.btn\):focus-visible\{/);
  assert.doesNotMatch(css, /\.chat-rc-log-show(?:\{[^}]*(?:background|border|text-decoration)|:focus-visible)/);
});

// Item 9: a run that has not started and waits on its chain predecessor (no stop) reads the same short word.
test('C3: a not-started chain run with no stop reads \'waits for run 2\' on the small-runs card; a plain card keeps dev\'s \'Waiting · starts after run 2\'', () => {
  const members = [{ status: 'done', endReached: true }, { status: 'running' }, { ticket: { status: 'scheduled', after: { index: 2 } } }];
  const pids = ['p1', 'p2', null];
  const snaps = { p2: c2Snap('p2') };
  const marked = c2Card({ members, pids, snaps });
  assert.equal(marked.states()[2], 'waits for run 2');
  marked.built.dispose(); marked.ctl.destroy();
  const plain = c2Card({ marked: false, members, pids, snaps });
  assert.equal(plain.states()[2], 'Waiting · starts after run 2');
  plain.built.dispose(); plain.ctl.destroy();
});

// ---- Small runs C5 (D12): the Verifier's readings on the one card ----
{
  const { oneCardModel: one } = await import('../ui/public/shape/feature-card.mjs');
  const { VERIFY_WORDS } = await import('../src/shared/shape/verifier.mjs');
  const DONE4 = [1, 2, 3, 4].map((i) => ({ index: i, state: 'done', pipelineId: `p${i}`, rounds: [] }));
  const vw = (state, slices = DONE4) => ({ id: 'f1', title: 'Sign-up', status: 'done', slices, done: slices.filter((s) => s.state === 'done').length,
    total: slices.length, ship: { ready: state === 'clean' || state === 'accepted', mode: null }, log: [],
    verify: { state, round: 1, fixCycles: 2, held: 3, owned: 4, gaps: [], gapsFound: 0, pipelineId: 'pv', ticketId: 'tv' } });
  const m = (view) => one({ own: null, card: { feature: view, smallRuns: true } });
  test('C5: SV reads Verifying with the walk line; SR reads Ready to ship for clean and accepted', () => {
    const sv = m(vw('verifying'));
    assert.deepEqual([sv.state, sv.step, sv.word, sv.detail], ['SV', 'build', 'Verifying', 'the Verifier walks the main flow · 4 of 4 runs done']);
    for (const st of ['clean', 'accepted']) {
      const sr = m(vw(st));
      assert.deepEqual([sr.state, sr.step, sr.word, sr.detail], ['SR', 'ship', 'Ready to ship', 'Ready to ship']);
    }
  });
  test('C5: asking and paused keep S8 with their word; halted reads Stopped with its own line', () => {
    for (const st of ['asking', 'paused']) {
      const x = m(vw(st));
      assert.deepEqual([x.state, x.word, x.detail], ['S8', VERIFY_WORDS[st], '4 of 4 runs done']);
    }
    const h = m(vw('halted'));
    assert.deepEqual([h.state, h.word, h.detail], ['S8', 'Stopped', 'The Verifier stopped · Resume checks again']);
    // An active feature with a halted Verifier offers the feature's Resume (resumeFeature starts a fresh check); paused does not.
    assert.equal(m({ ...vw('halted'), status: 'active' }).base.controls.halted, true);
    assert.equal(m({ ...vw('paused'), status: 'active' }).base.controls.halted, false);
    assert.equal(m({ ...vw('halted'), status: 'active' }).base.controls.rest, false, 'Re-plan the rest stays the runs\'');
    const gaps = m(vw('gaps', [...DONE4, { index: 5, state: 'planned', pipelineId: null, rounds: [], kind: 'change' }]));
    assert.deepEqual([gaps.state, gaps.word, gaps.detail], ['S8', 'Working', '4 of 5 runs done']);
  });
  test('C5: S9 unchanged without verify; a clean check then a new change run is plain S8 (no word)', () => {
    const plain = vw('clean'); delete plain.verify;
    const s9 = m(plain);
    assert.equal(s9.state, 'S9');
    assert.equal('word' in s9, false);
    assert.equal('verify' in s9, false);
    const later = m(vw('clean', [...DONE4, { index: 5, state: 'running', pipelineId: 'p5', rounds: [], kind: 'change' }]));
    assert.equal(later.state, 'S8');
    assert.equal('word' in later, false);
  });
  test('D1: the ship step says who it waits for (Ship card mounted or not), reads Ready to ship, then N PRs open', () => {
    const sr = (over) => ({ confirmed: [], owned: [], waiting: [], blocked: false, reason: null, order: [], ...over });
    const w = (smallRuns, mode = null) => ({ ...vw('clean'), ship: { ready: !mode, mode, smallRuns } });
    const wait = (id, role, roleLabel) => ({ id, text: '', role, roleLabel, state: 'waiting', at: null });
    const blocked = m(w(sr({ confirmed: [wait('R-comp-4', 'compliance', 'Compliance'), wait('R-sec-1', 'security', 'Security')],
      waiting: ['R-comp-4', 'R-sec-1'], blocked: true, reason: 'x' })));
    // The owner's call: the state detail says who the ready Ship card waits for.
    assert.deepEqual([blocked.state, blocked.step, blocked.detail], ['SR', 'ship', 'waiting for Compliance and Security']);
    const notReady = m({ ...w(sr({ confirmed: [wait('R-comp-4', 'compliance', 'Compliance'), wait('R-sec-1', 'security', 'Security')],
      waiting: ['R-comp-4', 'R-sec-1'], blocked: true, reason: 'x' })), ship: { ready: false, mode: null, smallRuns: sr({ blocked: true,
      confirmed: [wait('R-comp-4', 'compliance', 'Compliance'), wait('R-sec-1', 'security', 'Security')] }) } });
    assert.equal(notReady.detail, 'waiting for Compliance and Security');
    assert.equal(m(w(sr({}))).detail, 'Ready to ship');
    // Fail closed: an owner-less requirement: no "Ready to ship" anywhere, and no "waiting for" without a name.
    const reason = 'R-ops-1 is owned by no run and confirmed by no person';
    const none = { ...w(sr({ blocked: true, reason, unowned: ['R-ops-1'] })), ship: { ready: false, mode: null, smallRuns: sr({ blocked: true, reason, unowned: ['R-ops-1'] }) } };
    const s9none = { ...none }; delete s9none.verify;
    for (const view of [none, s9none]) {
      const x = m(view);
      assert.equal(x.detail, reason);
      assert.doesNotMatch(`${x.word} ${x.detail}`, /Ready to ship|waiting for\s*$/);
    }
    assert.deepEqual([m(none).state, m(none).word], ['SR', 'Waiting']);
    assert.equal('word' in m(s9none), false);
    const pr = (n) => ({ index: n, pr: { number: n, url: `u${n}` }, onto: null });
    const done = m(w(sr({ order: [pr(1), pr(2), pr(3), pr(4)] }), 'stacked'));
    assert.deepEqual([done.step, done.detail], ['ship', '4 PRs open']);
    const s9 = vw('clean'); delete s9.verify;
    assert.deepEqual([m(s9).state, m(s9).step], ['S9', 'ship']);
  });
}

// ---- Feature D1: the one card's ship step mounts the Ship card (ship-card.mjs) ----
test('D1 one card: the ship step mounts the Ship card once: Met unpressed while blocked, one primary when ready, no Answer', () => {
  const members = [{ status: 'done', endReached: true }, { status: 'done', endReached: true }];
  const row = (state) => ({ id: 'R-comp-4', text: 'EU only', role: 'compliance', roleLabel: 'Compliance', state, mark: state === 'confirmed' ? 'met' : null,
    reason: null, at: state === 'confirmed' ? '2026-11-22T16:55:00Z' : null });
  const sr = (blocked) => ({ confirmed: [row(blocked ? 'waiting' : 'confirmed')], owned: [], waiting: blocked ? ['R-comp-4'] : [], blocked,
    reason: blocked ? 'Waiting for Compliance to confirm R-comp-4' : null, met: { met: 0, total: 1 },
    care: { choice: "Balanced · Worca's pick", outcome: null, line: '' }, base: 'main',
    order: [{ index: 1, pipelineId: 'p1', title: 'A', pr: null, onto: null }, { index: 2, pipelineId: 'p2', title: 'B', pr: null, onto: null }] });
  for (const blocked of [true, false]) {
    const { built, ctl } = c2Card({ members, pids: ['p1', 'p2'], snaps: {}, view: { status: 'done', ship: { ready: true, mode: null, smallRuns: sr(blocked) } } });
    const cards = built.el.querySelectorAll('.chat-rc-ship .ask-shipcard.is-small-runs');
    assert.equal(cards.length, 1);
    assert.equal(built.el.querySelector('[data-act="ship-mark-R-comp-4-met"]').getAttribute('aria-pressed'), String(!blocked));
    assert.equal(built.el.querySelectorAll('.btn-primary').length, blocked ? 0 : 1);
    assert.equal(built.el.querySelector('[data-act="ship-create"]').textContent, 'Create 2 PRs');
    assert.equal([...built.el.querySelectorAll('button')].filter((b) => !b.hidden && /^Answer$/.test(b.textContent.trim())).length, 0);
    built.dispose(); ctl.destroy();
  }
  // R-ux-2: shipped, "N PRs open" shows once (the state line), and one view action (the card's View PRs).
  const shipped = { ...sr(false), order: [{ index: 1, pipelineId: 'p1', title: 'A', pr: { number: 11, url: 'https://x/pull/11' }, onto: null },
    { index: 2, pipelineId: 'p2', title: 'B', pr: { number: 12, url: 'https://x/pull/12' }, onto: 11 }] };
  const withPrs = members.map((mb, i) => ({ ...mb, pr: { url: `https://x/pull/${11 + i}`, number: 11 + i, state: 'OPEN' } }));
  const done = c2Card({ members: withPrs, pids: ['p1', 'p2'], snaps: {}, view: { status: 'done', ship: { ready: false, mode: 'stacked', smallRuns: shipped } } });
  assert.ok(done.row.model.actions.includes('open-pr'), 'the model offers View PR: the step card must hold the one view action');
  assert.ok(done.built.el.querySelector('.chat-rc-ship [data-ship-card="applied"]'));
  const shown = (el) => { for (let n = el; n; n = n.parentElement) if (n.hidden) return false; return true; };
  const texts = [...done.built.el.querySelectorAll('*')].filter((e) => shown(e) && [...e.childNodes].some((n) => n.nodeType === 3 && /PRs open/.test(n.textContent)));
  assert.equal(texts.length, 1, texts.map((e) => e.className).join());
  const views = [...done.built.el.querySelectorAll('a, button')].filter((b) => shown(b) && /^View PRs?$/.test(b.textContent.trim()));
  assert.deepEqual(views.map((b) => b.textContent.trim()), ['View PRs']);
  done.built.dispose(); done.ctl.destroy();
  // A step before ship mounts nothing.
  const { built, ctl } = c2Card({ members: [{ status: 'done', endReached: true }, { status: 'running' }], pids: ['p1', 'p2'], snaps: {} });
  assert.equal(built.el.querySelector('.chat-rc-ship'), null);
  built.dispose(); ctl.destroy();
});


// ---- Shaper small runs s4 (R-ux-1, R-arch-4, R-ux-5): the Chat card rows read the shared run status ----
const S4_MEMBER = (sl) => (sl.state === 'done' ? { status: 'done', endReached: true }
  : ['planned', 'held', 'canceled'].includes(sl.state) ? { ticket: { status: 'scheduled' } }
  : sl.state === 'error' ? { status: 'error' } : { status: 'running' });
/** A marked feature card whose rows are `slices` (featureView slice payloads). `flag` is shaperSmallRuns. */
function s4Card(slices, { flag = true, marked = true, snaps = {}, view = {}, controls: over = {} } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  applyFlags({ shaperSmallRuns: flag }, doc);
  const members = slices.map(S4_MEMBER);
  const v = VIEW(slices, { originPipelineId: 'p0', ...view });
  const cardJson = { pipelineId: 'p0', feature: v, log: [], ...(marked ? { smallRuns: true } : {}) };
  const rest = { source: 'rest', terminal: true, status: 'done', pipelineId: 'p0' };
  const runStore = { subscribe: () => () => {}, byPipeline: (pid) => (pid === 'p0' ? rest : snaps[pid] || null), get: () => null };
  const gm = groupModel({ kind: 'feature', title: 'Charts', planning: { status: 'done', endReached: true }, members });
  const row = { kind: 'chain', groupKind: 'feature', groupId: 'feat-1', title: 'Charts', model: gm, count: gm.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: gm.planning },
    members: gm.members.map((m, i) => ({ position: slices[i].index, title: `Part ${slices[i].index}`, href: '#runs', model: m,
      pipelineId: slices[i].pipelineId, ticketId: slices[i].ticketId, run: members[i] })) };
  const controls = { paintQuestion: () => null, releaseQuestion() {}, groupOf: () => row, memoFor: () => ({}), ...over };
  const ctl = createRunCardController({ controls, runStore, tickMs: 0 });
  let changed = null;   // the card's onChange: a new feature view landed (app.js `shape-feature`)
  const built = ctl.build({ id: 'card_s4', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'p0', runId: 'run-p0', title: 'Charts' } },
    { doc, win: dom.window, shaperCard: (_pid, onChange) => { changed = onChange; return cardJson; } });
  doc.body.appendChild(built.el);
  const update = (next) => { cardJson.feature = { ...cardJson.feature, ...next }; changed(); };
  const rowOf = (run) => built.el.querySelector(`.run-member:not([data-key="planning"]):nth-of-type(${slices.findIndex((x) => x.index === run) + 2})`);
  const li = (run) => [...built.el.querySelectorAll('.run-member:not([data-key="planning"])')][slices.findIndex((x) => x.index === run)];
  const word = (run) => li(run).querySelector('.run-member-state').textContent;
  const dot = (run) => li(run).querySelector('.status-dot');
  return { built, ctl, row, li, word, dot, rowOf, update, doc, win: dom.window, done: () => { built.dispose(); ctl.destroy(); } };
}
const S = (i, state, over = {}) => ({ index: i, title: `Part ${i}`, state, runId: null, pipelineId: ['planned', 'held', 'canceled'].includes(state) ? null : `p${i}`,
  ticketId: `t${i}`, pr: null, kind: 'build', waitsFor: [], buildsOn: [], nextTurn: false, cannotStart: false, stop: null, ...over });

test('s4 R-ux-1 card: run 2 open stop shows "?", run 4 (held, after run 3) the dashed ring with no "?", run 5 failed the "!"', () => {
  const slices = [S(1, 'done'), S(2, 'approval', { stop: { reason: 'requirement', held: false }, buildsOn: [1] }), S(3, 'running', { buildsOn: [1] }),
    S(4, 'held', { stop: { reason: 'check', held: true, after: 3 }, buildsOn: [1, 3] }), S(5, 'error', { buildsOn: [3, 4] })];
  const c = s4Card(slices, { snaps: { p3: c2Snap('p3') } });
  assert.equal(c.word(2), 'waiting for you');
  assert.equal(c.dot(2).dataset.symbol, 'question');
  assert.ok(c.dot(2).classList.contains('is-amber') && c.dot(2).classList.contains('has-sym'));
  assert.equal(c.dot(2).getAttribute('aria-label'), 'waiting for you');
  assert.equal(c.word(4), 'after run 3');
  assert.ok(c.dot(4).classList.contains('is-dashed-ring'));
  assert.ok(!c.dot(4).classList.contains('has-sym'));
  assert.equal(c.dot(4).dataset.symbol, undefined);
  assert.equal(c.dot(4).querySelector('svg'), null);
  assert.equal(c.li(4).dataset.mark, 'after');
  assert.equal(c.word(5), 'failed');
  assert.equal(c.dot(5).dataset.symbol, 'alert');
  assert.ok(c.dot(5).classList.contains('is-red'));
  assert.equal(c.dot(5).getAttribute('aria-label'), 'failed');
  assert.equal(c.word(1), 'done');
  assert.ok(c.dot(1).classList.contains('is-green'));
  // Only the open stop shows "?", only the failed run "!".
  assert.deepEqual([...c.built.el.querySelectorAll('.run-members .status-dot[data-symbol]')].map((d) => d.dataset.symbol).sort(), ['alert', 'question']);
  // Held: no row reads next.
  assert.ok(![1, 2, 3, 4, 5].some((r) => /^next/.test(c.word(r))));
  // Live: today's phase word (never `working`) with the pulse, and only that row pulses.
  assert.notEqual(c.word(3), 'working');
  assert.match(c.word(3), /\S/);
  assert.ok(c.dot(3).classList.contains('is-pulse'));
  assert.equal(c.built.el.querySelectorAll('.run-members .status-dot.is-pulse').length, 1);
  c.done();
});

test('s4 card: a held slice with no `after` reads next with the turn, else no word; the dashed ring either way', () => {
  const held = (turn) => [S(1, 'done'), S(2, 'held', { stop: { reason: 'check', held: true }, nextTurn: turn, buildsOn: [1] })];
  const a = s4Card(held(true));
  assert.equal(a.word(2), 'next');
  assert.ok(a.dot(2).classList.contains('is-dashed-ring'));
  a.done();
  const b = s4Card(held(false));
  assert.equal(b.word(2), '');
  assert.ok(b.dot(2).classList.contains('is-dashed-ring'));
  b.done();
});

test('s4 card: next draws the --ink ring, a free run without the turn no word and the grey ring, a cannot-start run keeps today\'s text', () => {
  const slices = [S(1, 'done'), S(2, 'planned', { nextTurn: true, buildsOn: [1] }), S(3, 'planned', { buildsOn: [1] }), S(4, 'planned', { cannotStart: true, waitsFor: [2], buildsOn: [2] })];
  const c = s4Card(slices);
  assert.equal(c.word(2), 'next');
  assert.ok(c.dot(2).classList.contains('is-ink-ring'));
  assert.equal(c.li(2).dataset.mark, 'ring');
  assert.equal(c.word(3), '');
  assert.ok(c.dot(3).classList.contains('is-grey-ring') && !c.dot(3).classList.contains('is-ink-ring'));
  const off = s4Card(slices, { flag: false });
  assert.equal(c.word(4), off.word(4), 'cannot start: today\'s text (D9: the card\'s short word)');
  off.done();
  assert.ok(c.dot(4).classList.contains('is-grey-ring'));
  c.done();
});

test('s4 base state (R-qa-9): run 12 reads "waits for run 7, 10" and run 7 "waits for run 2 (needs you), 6", one line, no second line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worca-s4-base-'));
  try {
    await withEnvVars({ WORCA_FLAGS: 'shaperSmallRuns' }, () => {
      const fx = world(root, 'base');
      const slices = featureView(fx.featureId, { live: fx.live }).slices;
      assert.equal(slices.length, 16);
      const c = s4Card(slices);
      assert.equal(c.word(12), 'waits for run 7, 10');
      assert.equal(c.word(7), 'waits for run 2 (needs you), 6');
      assert.equal(c.word(2), 'waiting for you');
      assert.equal(c.word(9), 'next');
      assert.ok(c.dot(9).classList.contains('is-ink-ring'));
      assert.equal(c.word(13), '', 'a free run without the turn has no word');
      assert.equal(c.word(1), 'done');
      assert.ok(c.built.el.querySelector('.run-members.is-one-line'));
      assert.equal(c.built.el.querySelector('.run-member-line'), null, 'no second line');
      assert.equal(c.built.el.querySelectorAll('.run-member-state').length, 17, 'one state per row, planning included');
      assert.equal([...c.built.el.querySelectorAll('.run-member-state')].filter((n) => n.textContent === 'next').length, 1);
      for (const r of [7, 12]) assert.ok(c.dot(r).classList.contains('is-grey-ring'), `run ${r}: waiting is a grey ring`);
      const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8');
      assert.match(css, /\.chat-rc-members \.run-member-state\{[^}]*white-space:nowrap/);
      c.done();
      // A change run with the turn.
      const fx2 = world(root, 'base');
      fx2.setKind(13, 'change');
      const change = s4Card(featureView(fx2.featureId, { live: fx2.live }).slices);
      assert.equal(change.word(13), 'next · small change run');
      assert.ok(change.dot(13).classList.contains('is-ink-ring'));
      assert.ok(![...change.built.el.querySelectorAll('.run-member-state')].some((n) => n.textContent === 'next'), 'only the change run has the turn');
      change.done();
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('s4 R-arch-4 card: flag off, or a card not marked small-runs, has no data-mark and every dot is the dev model\'s', () => {
  const slices = [S(1, 'done'), S(2, 'approval', { stop: { reason: 'requirement', held: false }, buildsOn: [1] }), S(3, 'held', { stop: { reason: 'check', held: true, after: 2 } }), S(4, 'error')];
  for (const opts of [{ flag: false }, { marked: false }]) {
    const c = s4Card(slices, opts);
    assert.equal(c.built.el.querySelector('[data-mark]'), null);
    for (const [i, mb] of c.row.members.entries()) {
      const want = renderStatusDot(c.built.el.ownerDocument, mb.model);
      assert.equal(c.li(i + 1).querySelector('.status-dot').className, want.className, `run ${i + 1}`);
    }
    assert.equal(c.built.el.querySelector('.status-dot.is-dashed-ring, .status-dot.is-ink-ring'), null);
    c.done();
  }
});

// ---- Shaper small runs slice 6 (R-po-4, R-qa-1): the card lists every open stop and failed run -----------------------
const S6_STATE = { 1: 'done', 2: 'approval', 3: 'done', 4: 'questions', 5: 'error', 6: 'running', 11: 'questions' };
const S6_STOP = { 2: 'requirement', 4: 'check', 11: 'check' };
const S6_SLICES = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => S(run, S6_STATE[run] || 'planned',
  { buildsOn: [...dependsOn], ...(S6_STOP[run] ? { stop: { reason: S6_STOP[run], held: false } } : {}) }));
const s6Open = (index, kind, reason, holdsUp, id = `q${index}`) => ({ index, runId: `r${index}`, pipelineId: `p${index}`, id, kind, reason, failed: false, holdsUp });
const A2 = s6Open(2, 'plan', 'requirement', [7, 8, 12, 15, 16]);
const A4 = s6Open(4, 'gate', 'check', [5, 6, 7, 12, 16]);
const A5 = { index: 5, runId: null, pipelineId: 'p5', id: null, kind: null, reason: null, failed: true, holdsUp: [6, 7, 12, 16] };
const A11 = s6Open(11, 'gate', 'check', [13, 14, 15, 16]);
const S6_ASKS = [A2, A4, A5, A11];
const S6_HALTED = { index: 5, state: 'error', waiting: [7, 8, 9, 10, 12, 13, 14, 15, 16] };
const asksView = (asks = S6_ASKS, over = {}) => ({ asks, ask: asks[0] || null, halted: S6_HALTED, open: true, ...over });
const S6_TEXTS = ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 4 · plan approval · holds up 5, 6, 7, 12, 16',
  'Run 5 failed · holds up 6, 7, 12, 16', 'Run 11 · plan approval · holds up 13, 14, 15, 16'];

/** Controls whose paintQuestion mounts a step card stub: its own Approve button, posting by itself (step-card.mjs). */
function s6Controls() {
  const log = { answered: [], released: [], acted: [] };
  return { log, controls: {
    paintQuestion: (ref, host) => {
      const panel = host.querySelector('.qpanel');
      if (panel.dataset.ref !== ref.pipelineId) {
        const b = host.ownerDocument.createElement('button');
        b.type = 'button'; b.className = 'btn btn-primary s6-approve'; b.textContent = 'Approve';
        b.addEventListener('click', (e) => { e.stopPropagation(); log.answered.push(ref.pipelineId); });
        panel.replaceChildren(b); panel.dataset.ref = ref.pipelineId; panel.classList.remove('hidden');
      }
      return { id: `q${ref.pipelineId.slice(1)}`, kind: 'plan', heading: 'Plan', step: '', stepCard: true, stop: true };
    },
    releaseQuestion: (host) => {
      log.released.push(host);
      const panel = host.querySelector('.qpanel');
      if (panel) { panel.replaceChildren(); delete panel.dataset.ref; panel.classList.add('hidden'); }
    },
    featureAct: (id, action, body) => { log.acted.push([id, action, body]); return Promise.resolve({ ok: true }); },
  } };
}
const stopRows = (c) => [...c.built.el.querySelectorAll('.chat-rc-stops li.chat-rc-stop')];
const stopRow = (c, run) => stopRows(c).find((li) => li.dataset.run === String(run));
const stopTexts = (c) => stopRows(c).map((li) => li.querySelector('.chat-rc-stop-text').textContent);
const qSecOf = (c) => c.built.el.querySelector(':scope > section.chat-rc-q');   // the card's own slot, never a stop line's host
const tickOnce = () => new Promise((r) => setTimeout(r, 0));

test('S6 card busy: four stop lines with their step cards before the question slot, which stays hidden; run 5 has Resume', () => {
  const live2 = snap('p2', { pendingQuestion: { id: 'q2', kind: 'plan', plan: {}, stop: { reason: 'requirement', run: 2 } } });
  for (const snaps of [{}, { p2: live2 }]) {      // run 2 followed by pointer, then by a live snapshot of this tab
    const { controls } = s6Controls();
    const c = s4Card(S6_SLICES, { view: asksView(), controls, snaps });
    assert.deepEqual(stopTexts(c), S6_TEXTS);
    assert.equal(stopTexts(c)[0], 'Run 2 · plan approval · holds up 7, 8, 12, 15, 16');
    assert.equal(stopRow(c, 5).querySelector('.chat-rc-stop-resume').getAttribute('aria-label'), 'Resume run 5');
    for (const r of [2, 4, 11]) {
      assert.equal(stopRow(c, r).querySelectorAll('.qpanel .s6-approve').length, 1, `run ${r} has its own step card`);
      assert.ok(!stopRow(c, r).querySelector('.qpanel').classList.contains('hidden'), `run ${r}`);
    }
    assert.equal(stopRow(c, 5).querySelector('.s6-approve'), null);
    assert.equal(qSecOf(c).hidden, true);
    assert.equal(qSecOf(c).querySelector('.s6-approve'), null, 'the slot never paints a listed run\'s step');
    const list = c.built.el.querySelector('ol.chat-rc-stops');
    assert.ok(list.compareDocumentPosition(qSecOf(c)) & c.win.Node.DOCUMENT_POSITION_FOLLOWING, 'the list comes before the slot');
    c.done();
  }
});

test('S6 slot release: a step that moves from the question slot into the list is released and leaves no receipt', () => {
  const { controls, log } = s6Controls();
  const c = s4Card(S6_SLICES, { view: { ask: A2 }, controls });
  const qBody = c.built.el.querySelector('.chat-rc-qbody');
  assert.equal(qSecOf(c).hidden, false);
  assert.ok(qBody.querySelector('.s6-approve'), 'run 2 is the open step first');
  c.update(asksView());
  assert.equal(stopRows(c).length, 4);
  assert.equal(qSecOf(c).hidden, true);
  assert.ok(log.released.includes(qBody), 'releaseQuestion got the slot');
  assert.equal(qBody.querySelector('.s6-approve'), null);
  assert.equal([...c.built.el.querySelectorAll('.chat-rc-receipt')].filter((r) => !r.hidden).length, 0);
  c.done();
});

test('S6 approve run 4: its line answers run 4; the next view lists 2, 5 and 11 with run 2\'s line untouched', () => {
  const { controls, log } = s6Controls();
  const c = s4Card(S6_SLICES, { view: asksView(), controls });
  assert.equal(stopRows(c).length, 4);
  const [two, button2] = [stopRow(c, 2), stopRow(c, 2).querySelector('.s6-approve')];
  const four = stopRow(c, 4);
  four.querySelector('.s6-approve').click();
  assert.deepEqual(log.answered, ['p4']);
  c.update(asksView([A2, A5, A11], { slices: S6_SLICES.map((x) => (x.index === 4 ? { ...x, state: 'running', stop: null } : x)) }));
  assert.deepEqual(stopTexts(c), [S6_TEXTS[0], S6_TEXTS[2], S6_TEXTS[3]]);
  assert.equal(stopRow(c, 2), two);
  assert.equal(stopRow(c, 2).querySelector('.s6-approve'), button2);
  assert.ok(log.released.some((host) => four.contains(host)), 'run 4\'s host is released');
  assert.equal(qSecOf(c).hidden, true);
  assert.equal([...c.built.el.querySelectorAll('.chat-rc-receipt')].filter((r) => !r.hidden).length, 0);
  c.done();
});

test('S6 Clarify line: a question that is no step card is answered for its own run, with the line\'s current ask id', async () => {
  registerAskRenderer('clarify', { render() {}, collect: (panel) => ({ answers: [{ id: 'q1', choice: panel.dataset.ref }] }) });
  const answered = [];
  const controls = {
    paintQuestion: (ref, host) => {
      const panel = host.querySelector('.qpanel');
      if (!panel.querySelector('[data-qpanel-submit]')) {
        panel.innerHTML = '<button type="button" class="btn btn-primary" data-qpanel-submit>Send</button>';
        panel.dataset.ref = ref.pipelineId; panel.classList.remove('hidden');
      }
      return { id: `q${ref.pipelineId.slice(1)}`, kind: 'clarify', heading: 'Clarify', step: '', stepCard: false };
    },
    releaseQuestion() {},
    answer: (ref, id, payload) => { answered.push([ref.runId, ref.pipelineId, id, payload.answers[0].choice]); return true; },
  };
  const q4 = s6Open(4, 'questions', null, [5, 6, 7, 12, 16]);
  const q11 = s6Open(11, 'questions', null, [13, 14, 15, 16]);
  const c = s4Card(S6_SLICES, { view: { asks: [q4, q11], ask: q4 }, controls });
  assert.equal(stopRows(c).length, 2);
  stopRow(c, 11).querySelector('[data-qpanel-submit]').click();
  await tickOnce();
  assert.deepEqual(answered, [['r11', 'p11', 'q11', 'p11']], 'one post, for run 11');
  c.update({ asks: [q4, { ...q11, id: 'q11b' }] });
  stopRow(c, 11).querySelector('[data-qpanel-submit]').click();
  await tickOnce();
  assert.deepEqual(answered.at(-1), ['r11', 'p11', 'q11b', 'p11'], 'the new ask id');
  assert.equal(answered.length, 2);
  stopRow(c, 4).querySelector('[data-qpanel-submit]').click();
  await tickOnce();
  assert.deepEqual(answered.at(-1), ['r4', 'p4', 'q4', 'p4']);
  c.done();
});

test('S6 Resume once: the failed line holds the only Resume (no footer, no ⋯ item) and posts the run\'s index', async () => {
  for (const asks of [[A5], S6_ASKS]) {
    const { controls, log } = s6Controls();
    const c = s4Card(S6_SLICES, { view: asksView(asks), controls });
    const el = c.built.el;
    assert.equal(el.querySelector('.chat-rc-factions [data-act="feature-resume"]'), null, 'no footer Resume');
    const resumes = [...el.querySelectorAll('button')].filter((b) => !b.hidden && /^Resume/.test(b.textContent.trim()));
    assert.deepEqual(resumes.map((b) => b.getAttribute('aria-label')), ['Resume run 5']);
    el.querySelector('.chat-rc-factions [data-act="feature-more"]').click();
    const items = [...c.doc.querySelectorAll('.wfv-menu-item')].map((i) => i.textContent.trim());
    assert.ok(items.includes('Cancel the rest'), items.join());
    assert.ok(!items.includes('Resume'), `no ⋯ Resume: ${items.join()}`);
    if (asks === S6_ASKS) {           // an open stop line: the footer gives up its other buttons, as for one open stop
      assert.equal(el.querySelector('.chat-rc-factions [data-act="feature-replan"]'), null);
      assert.ok(items.includes('Re-plan the rest'));
    }
    resumes[0].click();
    await tickOnce();
    assert.deepEqual(log.acted, [['feat-1', 'resume', { index: 5 }]]);
    closeMenus();
    c.done();
  }
});

test('S6 off: flag off, an unmarked card, or no entries appends no stop list; a Verifier step stays in the slot', () => {
  for (const opts of [{ flag: false, view: asksView() }, { marked: false, view: asksView() }, { view: asksView([], { halted: null }) }]) {
    const { controls } = s6Controls();
    const c = s4Card(S6_SLICES, { ...opts, controls });
    assert.equal(c.built.el.querySelector('.chat-rc-stops'), null, JSON.stringify({ flag: opts.flag, marked: opts.marked }));
    c.done();
  }
  const { controls } = s6Controls();
  const verifier = { index: null, runId: 'rv', pipelineId: 'pv', id: 'vq', kind: 'gate' };
  const c = s4Card(S6_SLICES.map((x) => S(x.index, 'done')), { view: { asks: [], ask: verifier }, controls });
  assert.equal(qSecOf(c).hidden, false);
  assert.ok(qSecOf(c).querySelector('.s6-approve'), 'an ask that is no run line is still the card\'s open step');
  assert.equal(c.built.el.querySelector('.chat-rc-stops'), null);
  c.done();
});

test('slice 13: a card listing four stop lines has one direct-child section.chat-rc-q, and each open line\'s host is a div.chat-rc-q inside its li', () => {
  const { controls } = s6Controls();
  const c = s4Card(S6_SLICES, { view: asksView(), controls });
  assert.equal(stopRows(c).length, 4);
  assert.equal(c.built.el.querySelectorAll(':scope > section.chat-rc-q').length, 1, 'the card\'s own question slot');
  for (const r of [2, 4, 11]) {
    const hosts = stopRow(c, r).querySelectorAll('div.chat-rc-q.chat-rc-stop-q');
    assert.equal(hosts.length, 1, `run ${r}: its host takes the card question's class`);
    assert.equal(hosts[0].closest('li.chat-rc-stop'), stopRow(c, r), `run ${r}`);
    assert.ok(hosts[0].querySelector('.qpanel .s6-approve'), `run ${r}: the step card mounts in it`);
  }
  assert.equal(stopRow(c, 5).querySelector('.chat-rc-q'), null, 'a failed run has no question host');
  c.done();
});

// ---- Shaper small runs slice 7 (R-po-5, R-qa-2): the feature's state line, the need-you count, two open views ---------
const S7_LINE = 'Run 6 reviewing · next: run 9';
/** The busy slices: runs 1 and 3 done, 2, 4 and 11 at stops, 5 failed, 6 running; run 9 carries the server's nextTurn.
 *  `over`: run → slice keys laid over it. */
const s7Slices = (over = {}) => S6_SLICES.map((x) => ({ ...x, nextTurn: x.index === 9, ...(over[x.index] || {}) }));
const s7View = ({ over = {}, asks = S6_ASKS, ...view } = {}) => VIEW(s7Slices(over), asksView(asks, view));
const s7Snaps = (at = { p6: 'n_review' }) => Object.fromEntries(Object.entries(at).map(([pid, node]) => [pid, c2Snap(pid, { at: node })]));
const s7SnapOf = (snaps) => (pid) => snaps[pid] || null;
const s7Line = (view, snaps = s7Snaps()) => FC.featureStateLine(view, { snapOf: s7SnapOf(snaps) });

test('s7 T1 featureStateLine busy (R-po-5): the line names the working run and the run with the next turn', () => {
  assert.equal(s7Line(s7View()), S7_LINE);
});

test('s7 T2 (D2): with no snapshot word the working run reads its slice state\'s word, never "working"', () => {
  assert.equal(s7Line(s7View(), {}), 'Run 6 building · next: run 9');
  assert.equal(s7Line(s7View(), { p6: c2Snap('p6', { careRun: null }) }), 'Run 6 building · next: run 9', 'a run without a Care plan has no phase word');
  for (const [state, word] of [['starting', 'starting'], ['shaping', 'planning']]) {
    assert.equal(s7Line(s7View({ over: { 6: { state } } }), {}), `Run 6 ${word} · next: run 9`, state);
  }
  assert.doesNotMatch(s7Line(s7View(), {}), /working/i);
});

test('s7 D2: a running run with an open stop is not a working run', () => {
  const view = s7View({ over: { 4: { state: 'running' } } });
  assert.equal(s7Line(view), S7_LINE, 'run 4 asks: only run 6 works');
});

test('s7 T3 (R-arch-8): the next half names the one slice with nextTurn, and nothing else changes with it', () => {
  const moved = s7View({ over: { 9: { nextTurn: false }, 10: { nextTurn: true } } });
  assert.equal(s7Line(moved), 'Run 6 reviewing · next: run 10');
  assert.equal(s7Line(s7View({ over: { 9: { nextTurn: false } } })), 'Run 6 reviewing', 'no nextTurn: only the working half');
});

test('s7 T3b: a held answer with the turn and nothing working reads next: run 2', () => {
  const view = VIEW([S(1, 'done'), S(2, 'approval', { stop: { reason: 'requirement', held: true }, nextTurn: true, buildsOn: [1] }), S(3, 'planned', { buildsOn: [2] })],
    asksView([], { halted: null }));
  assert.equal(s7Line(view, {}), 'next: run 2');
});

test('s7 T4 (R-qa-9, R-qa-10): no working run reads only next: run 9; two working runs are named once each, in run order', () => {
  assert.equal(s7Line(s7View({ over: { 6: { state: 'planned', pipelineId: null } } }), {}), 'next: run 9');
  const two = s7View({ over: { 6: { state: 'planned', pipelineId: null }, 8: { state: 'running', pipelineId: 'p8' }, 10: { state: 'running', pipelineId: 'p10' } } });
  two.slices = [...two.slices].sort((a, b) => b.index - a.index);          // listed out of order
  assert.equal(s7Line(two, s7Snaps({ p8: 'n_impl', p10: 'n_review' })), 'Run 8 building, run 10 reviewing · next: run 9');
});

test('s7 T5 (R-qa-9, D4): with neither half the line says who must act, by the ordered rule, naming no stop-list run', () => {
  const ACT = 'Nothing can go on until you act';
  const bare = (slices, over = {}) => VIEW(slices, asksView([], { halted: null, ...over }));
  const failed = { index: 5, runId: null, pipelineId: 'p5', id: null, kind: null, reason: null, failed: true, holdsUp: [] };
  const cant = S(3, 'planned', { cannotStart: { run: 2, reason: 'was canceled' } });
  const cases = {
    'an open stop': [VIEW([S(1, 'done'), S(2, 'approval', { stop: { reason: 'requirement', held: false } })], asksView([A2], { halted: null })), ACT],
    'a failed run': [VIEW([S(1, 'done'), S(5, 'error')], asksView([failed], { halted: null })), ACT],
    'a paused run': [bare([S(1, 'done'), S(5, 'paused')]), ACT],
    'a stopped run': [bare([S(1, 'done'), S(5, 'stopped')]), ACT],
    'a run that cannot start': [bare([S(1, 'done'), cant]), ACT],
    'a held run and a run that cannot start': [bare([S(1, 'done'), cant, S(9, 'held')], { held: { index: 9, ticketId: 't9' } }), ACT],
    'a stop line and a held run': [VIEW([S(1, 'done'), S(2, 'approval', { stop: { reason: 'requirement', held: false } }), S(9, 'held')],
      asksView([A2], { halted: null, held: { index: 9, ticketId: 't9' } })), ACT],
    'Ask before each run holds run 9': [bare([S(1, 'done'), S(9, 'held')], { held: { index: 9, ticketId: 't9' } }), 'Run 9 waiting for you to start'],
    'none of these': [bare([S(1, 'done'), S(2, 'planned')]), 'Worca is finishing a run'],
  };
  for (const [name, [view, want]] of Object.entries(cases)) {
    const line = s7Line(view, {});
    assert.equal(line, want, name);
    assert.doesNotMatch(line, /need you/i, name);
    for (const a of view.asks) assert.doesNotMatch(line, new RegExp(`\\brun ${a.index}\\b`, 'i'), name);
  }
  // Every run done: no state line, so the page keeps shipWaitText (the Verifier's wait, or Ready to ship) and the card its
  // runs-done figure with the Verifier's word.
  const verify = { state: 'asking', round: 1, fixCycles: 2, held: 3, owned: 4, gaps: [], gapsFound: 0, pipelineId: 'pv', ticketId: 'tv' };
  for (const over of [{}, { verify }]) {
    const view = bare([S(1, 'done'), S(2, 'done')], over);
    assert.equal(s7Line(view, {}), null, `every run done ${over.verify ? 'with' : 'without'} a Verifier check`);
  }
  assert.equal(FC.shipWaitText(bare([S(1, 'done'), S(2, 'done')], { verify, ship: {} })), 'The Verifier waits for your answer');
});

test('s7 T6 (D6): needYouText: nothing at zero, "1 needs you", then "N need you"', () => {
  assert.deepEqual([0, 1, 2, 4, -1, NaN, 1.5].map((n) => FC.needYouText(n)), ['', '1 needs you', '2 need you', '4 need you', '', '', '']);
});

test('s7 T7 (R-arch-7): no asks, or a feature that is not active, gives no line; the card keeps today\'s words and no need key', () => {
  const slices = [SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'running', { pipelineId: 'p2' }), SL(3, 'planned', { nextTurn: true })];
  assert.equal(FC.featureStateLine(VIEW(slices)), null, 'no asks array');
  assert.equal(FC.featureStateLine(VIEW(slices, { asks: [], status: 'replanning' })), null);
  assert.equal(FC.featureStateLine(VIEW(slices, { asks: [], status: 'canceled' })), null);
  assert.equal(FC.featureStateLine(null), null);
  const m = oneCardModel({ own: snap('p1', { status: 'done', terminal: true }), card: marked(VIEW(slices)) });
  assert.equal(m.detail, '1 of 3 runs done');
  assert.equal('need' in m, false);
});

test('s7 T8 (R-qa-7): oneCardModel busy: the state line, then the runs-done figure, and need 4; other states keep their line', () => {
  const own = snap('p1', { status: 'done', terminal: true });
  const model = (view, snaps = s7Snaps()) => oneCardModel({ own, card: marked(view), snapOf: s7SnapOf(snaps) });
  const m = model(s7View());
  assert.equal(m.state, 'S8');
  assert.equal(m.detail, `${S7_LINE} · 2 of 16 runs done`);
  assert.equal(m.need, 4);
  const allDone = [1, 2, 3, 4].map((i) => S(i, 'done'));
  const verifier = (state) => ({ state, round: 1, fixCycles: 2, held: 3, owned: 4, gaps: [], gapsFound: 0, pipelineId: 'pv', ticketId: 'tv' });
  const halted = model(VIEW(allDone, asksView([], { halted: null, verify: verifier('halted') })), {});
  assert.deepEqual([halted.state, halted.detail, halted.need], ['S8', 'The Verifier stopped · Resume checks again', 0]);
  const gaps = model(VIEW([...allDone, S(5, 'running')], asksView([], { halted: null, verify: verifier('halted') })), {});
  assert.deepEqual([gaps.state, gaps.detail], ['S8', 'The Verifier stopped · Resume checks again'], 'halted while gap runs build');
  const sv = model(VIEW(allDone, asksView([], { halted: null, verify: verifier('verifying') })), {});
  assert.deepEqual([sv.state, sv.detail], ['SV', 'the Verifier walks the main flow · 4 of 4 runs done']);
  const asking = model(VIEW(allDone, asksView([], { halted: null, verify: verifier('asking') })), {});
  assert.deepEqual([asking.state, asking.detail, asking.verify.state], ['S8', '4 of 4 runs done', 'asking'],
    'every run done: no state line, the runs-done figure and the Verifier\'s word');
});

const needChips = (c) => [...c.built.el.querySelectorAll('.ask-rc-head [data-need]')];
const s7Card = (over = {}) => s4Card(s7Slices(), { view: asksView(), snaps: s7Snaps(), controls: s6Controls().controls, ...over });

test('s7 T9 (R-po-5): the busy card shows the state line, then "2 of 16 runs done", and "4 need you" once, in its head', () => {
  const c = s7Card();
  const detail = () => c.built.el.querySelector('.chat-rc-status .run-status-detail').textContent;
  assert.equal(c.word(6), 'reviewing', 'the fixture: run 6\'s snapshot is loaded');
  assert.equal(detail(), `${S7_LINE} · 2 of 16 runs done`);
  assert.deepEqual(needChips(c).map((n) => n.textContent), ['4 need you']);
  const chip = needChips(c)[0];
  assert.deepEqual([chip.tagName, chip.className], ['SPAN', 'kind-chip'], 'the neutral chip, no new class');
  assert.equal(chip.previousElementSibling, c.built.el.querySelector('.ask-rc-head .kind-chip:not([data-need])'), 'after the kind chip');
  assert.equal(chip.previousElementSibling.textContent, 'Feature');
  // No trailing \b: the head's textContent runs the chip straight into "Open" ("4 need youOpen").
  assert.equal(c.built.el.textContent.match(/\bneed you/g)?.length, 1, 'the count is said once');
  c.update({});
  assert.deepEqual(needChips(c).map((n) => n.textContent), ['4 need you'], 'a repaint adds no second chip');
  c.update({ asks: [], ask: null });
  assert.equal(c.built.el.querySelector('[data-need]'), null, 'nothing at zero');
  c.update({ asks: [A2], ask: A2 });
  assert.deepEqual(needChips(c).map((n) => n.textContent), ['1 needs you']);
  c.done();
});

test('s7 R-arch-9: a view with no stop lines, the flag off, or an unmarked card adds no count element', () => {
  for (const opts of [{ view: asksView([], { halted: null }) }, { flag: false }, { marked: false }]) {
    const c = s7Card(opts);
    assert.equal(c.built.el.querySelector('[data-need]'), null, JSON.stringify({ flag: opts.flag, marked: opts.marked }));
    assert.doesNotMatch(c.built.el.textContent, /\bneed you\b/);
    c.done();
  }
});

test('s7 T14: the head count is the number of rendered stop lines, before and after run 4 is answered', () => {
  const c = s7Card();
  const chip = () => Number.parseInt(needChips(c)[0]?.textContent, 10);
  assert.equal(stopRows(c).length, 4);
  assert.equal(chip(), stopRows(c).length);
  c.update(asksView([A2, A5, A11], { slices: s7Slices({ 4: { state: 'running', stop: null } }) }));
  assert.equal(stopRows(c).length, 3);
  assert.equal(chip(), 3);
  c.done();
});

// R-qa-2, the card side: two open views of one feature. Each view's line posts for its own run and question id, and the
// second answer shows the server's refusal as today.
const S7_PQ = {
  r2: { id: 'q2', kind: 'plan', plan: { round: 1 }, stop: planStop({ run: 2, outlineChange: 'the runner cache needs its own run' }) },
  r4: { id: 'q4', kind: 'gate', issues: [], stop: planStop({ run: 4 }) },
  r11: { id: 'q11', kind: 'gate', issues: [], stop: planStop({ run: 11 }) },
};
/** One view: each open line mounts today's real step card; `reply()` is what the post resolves (true, or the refusal). */
function s7ViewOf(reply) {
  const posts = [];
  const refs = new Map();
  const controls = { ...s6Controls().controls,
    paintQuestion: (ref, host) => {
      const panel = host.querySelector('.qpanel');
      const pq = S7_PQ[ref.runId];
      refs.set(ref.pipelineId, { runId: ref.runId, pipelineId: ref.pipelineId, id: pq.id });
      if (panel.dataset.ref !== ref.pipelineId) {
        panel.replaceChildren();
        panel.classList.remove('hidden');
        renderGateCard(panel, pq, { doc: host.ownerDocument, title: stepTitle(pq), chip: stepChip(pq), tagLevel: () => {},
          submit: async (payload) => { posts.push([ref.runId, pq.id, payload]); return reply(); } });
        panel.dataset.ref = ref.pipelineId;
      }
      return { id: pq.id, kind: pq.kind, heading: pq.stop.head, step: '', stepCard: true, stop: true };
    } };
  return { card: s4Card(s7Slices(), { view: asksView(), controls }), posts, refs };
}

test('s7 T13 (R-qa-2): two views answer runs 2 and 11 for the same run and question id; the second shows today\'s refusal', async () => {
  const refusals = { 2: 'no plan approval with that id is waiting on this run', 11: 'this stop is already answered' };
  for (const run of [2, 11]) {
    const first = s7ViewOf(() => true);
    const second = s7ViewOf(() => refusals[run]);
    for (const v of [first, second]) {
      assert.deepEqual(v.refs.get('p2'), { runId: 'r2', pipelineId: 'p2', id: 'q2' });
      assert.deepEqual(v.refs.get('p11'), { runId: 'r11', pipelineId: 'p11', id: 'q11' });
      stopRow(v.card, run).querySelector('.btn-primary').click();
      await tickOnce(); await tickOnce();
    }
    const pick = S7_PQ[`r${run}`].stop.options.find((o) => o.value === S7_PQ[`r${run}`].stop.pick).payload;
    assert.deepEqual(first.posts, [[`r${run}`, `q${run}`, pick]]);
    assert.deepEqual(second.posts, first.posts, 'the same run and id from the second view');
    const err = stopRow(second.card, run).querySelector('.chat-rc-q-err');
    assert.equal(err.hidden, false);
    assert.equal(err.textContent, `Not sent: ${refusals[run]}`);
    assert.equal([...second.card.built.el.querySelectorAll('.chat-rc-q-err:not([hidden])')].length, 1, `run ${run}: only its own line`);
    first.card.done(); second.card.done();
  }
  assert.equal(S7_PQ.r2.stop.options.find((o) => o.value === S7_PQ.r2.stop.pick).payload.decision, 'approve', 'run 2\'s pick is an approval');
});
