// test/ui-shape-feature-card.test.mjs — Shaper s2: the feature card model (log, open step, controls, notes, watch; the
// run model owns the head, status line, bars and member rows), its log painter, and a feature written before this
// change (DB rows) rendering with its open ask answerable.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readFileSync } from 'node:fs';
import { featureCardModel, paintFeatureLog } from '../ui/public/shape/feature-card.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { setShapeFirst } from './helpers/shape-gate.mjs';
import { getDb } from '../src/core/db.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { shaperCard, liveSliceFrom } from '../src/core/shape/features.mjs';
import { createRunCardController } from '../ui/public/chat/run-card.mjs';
import { PROGRESS_CARD_TYPE } from '../ui/public/ask-run-card.mjs';
import { registerAskRenderer } from '../ui/public/ask/registry.mjs';

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
  setShapeFirst(true);
  registerAskRenderer('plan', { render() {}, collect: () => ({ decision: 'approve' }) });
  try {
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
    assert.equal($('.run-status-text').textContent, 'Run 2 of 3 · needs you');
    assert.equal(painted.at(-1), 'bbbb0002');
    assert.deepEqual([...built.el.querySelectorAll('.run-member-title')].map((n) => n.textContent),
      ['Planning', 'Store charts', 'Chart in Chat', 'Charts on the run page']);
    $('.chat-rc-q .qpanel [data-qpanel-submit]').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(answered, [['bbbb0002', PRE_PQ.id]]);
    built.dispose(); ctl.destroy();
  } finally {
    setShapeFirst(false);
  }
});

test('controls: the current run is the target; halted names Resume', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'error', { pipelineId: 'p2' }), SL(3, 'planned'), SL(4, 'planned')],
    { halted: { index: 2, state: 'error', waiting: [3, 4] }, open: true, approveEach: false, originPipelineId: 'p0' });
  const m = featureCardModel({ own: snap('p0'), card: card(v),
    snapOf: (pid) => (pid === 'p2' ? snap('p2', { status: 'failed', source: 'rest', terminal: true, stageProgress: { label: 'Review', text: 'Review' } }) : null) });
  assert.deepEqual(m.controls, { featureId: v.id, active: true, halted: true, rest: true, approveEach: false, planPipelineId: 'p0',
    target: { index: 2, runId: 'run-p2', pipelineId: 'p2', status: 'failed', asks: false } });   // snap() defaults runId to `run-${pid}`
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
