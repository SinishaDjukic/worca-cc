// test/ui-shape-feature-card.test.mjs — Shaper s2: the feature card model (chip, status, bars, log, open step, rows),
// its painters, and a feature written before this change (DB rows) rendering with its open ask answerable.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readFileSync } from 'node:fs';
import { featureCardModel, paintFeatureLog, paintFeatureMembers } from '../ui/public/shape/feature-card.mjs';
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

test('shaping: chip Shaping, "Needs you · Plan" while the planning run asks, its own bar, the open step is its ask', () => {
  const own = snap('p1', { shaping: { rounds: [] }, pendingQuestion: { id: 'clarify-1', kind: 'clarify' } });
  const m = featureCardModel({ own, card: card(null, []) });
  assert.equal(m.chip, 'Shaping');
  assert.equal(m.icon, 'ask');
  assert.equal(m.status, 'Needs you · Plan');
  assert.equal(m.run, own.stageProgress);
  assert.equal(m.group, null);
  assert.deepEqual([m.step.index, m.step.kind, m.step.pipelineId], [null, 'clarify', 'p1']);
  assert.deepEqual(m.members, []);
});

test('after a 3-run split: Feature · 1/3, the group bar counts planning, four member rows', () => {
  const own = snap('p1', { shaping: { feature: { id: 'feat-1' } }, pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } });
  const v = VIEW([SL(1, 'approval', { pipelineId: 'p1', runId: 'run-p1' }), SL(2, 'planned'), SL(3, 'planned')]);
  const m = featureCardModel({ own, card: card(v) });
  assert.equal(m.chip, 'Feature · 1/3');
  assert.equal(m.status, 'Needs you · Run 1 · Plan');
  assert.deepEqual(m.group.parts.map((p) => p.state), ['done', 'current', 'waiting', 'waiting']);
  assert.equal(m.group.text, 'Run 1 of 3');
  assert.deepEqual(m.members.map((r) => `${r.label} · ${r.state}`),
    ['Planning · Done', '1 · Part 1 · Waiting for your plan approval', '2 · Part 2 · Planned', '3 · Part 3 · Planned']);
});

test('run 2 asks: the open step is run 2\'s (its ref), status "Needs you · Run 2 · Plan", the server pointer is the fallback', () => {
  const own = snap('p1', { status: 'done', terminal: true, stageProgress: null });
  const two = snap('p2', { pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan', plan: {} } });
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1', pr: { url: 'https://x/pr/12', number: 12, state: 'OPEN', draft: true } }), SL(2, 'approval', { pipelineId: 'p2', runId: 'run-p2' }), SL(3, 'planned')],
    { ask: { index: 2, runId: 'run-p2', pipelineId: 'p2', id: 'plan-n_refine-1', kind: 'plan' } });
  const m = featureCardModel({ own, card: card(v), snapOf: (pid) => (pid === 'p2' ? two : null) });
  assert.equal(m.chip, 'Feature · 2/3');
  assert.equal(m.status, 'Needs you · Run 2 · Plan');
  assert.deepEqual([m.step.index, m.step.pipelineId, m.step.runId, m.step.snap], [2, 'p2', 'run-p2', two]);
  assert.equal(m.members[1].state, 'Draft PR #12');
  const noLive = featureCardModel({ own, card: card(v) });
  assert.deepEqual([noLive.step.index, noLive.step.pipelineId, noLive.step.snap], [2, 'p2', null]);
});

test('status words: Running · Run 2 · Build, Failed · Run 2 · Review, Ready to ship · 3/3, Canceled, Re-planning', () => {
  const own = snap('p1', { status: 'done', terminal: true });
  const at = (state2, two, over = {}) => featureCardModel({ own, card: card(VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, state2, { pipelineId: 'p2' }), SL(3, 'planned')], over)), snapOf: () => two });
  assert.equal(at('running', snap('p2', { stageProgress: prog('build', 'Build') })).status, 'Running · Run 2 · Build');
  const failed = at('error', snap('p2', { status: 'error', terminal: true, stageProgress: prog('review', 'Review', 'red') }), { halted: { index: 2, state: 'error', waiting: [3] } });
  assert.equal(failed.status, 'Failed · Run 2 · Review');
  assert.equal(failed.icon, 'fail');
  const all = featureCardModel({ own, card: card(VIEW([1, 2, 3].map((i) => SL(i, 'done')), { status: 'done', ship: { ready: true, mode: null } })) });
  assert.equal(all.status, 'Ready to ship · 3/3');
  assert.equal(all.chip, 'Feature · 3/3');
  assert.equal(at('canceled', null, { status: 'canceled' }).status, 'Canceled · 1/3');
  assert.equal(at('canceled', null, { status: 'replanning' }).status, 'Re-planning · 1/3');
});

test('paintFeatureLog: a check glyph, the run tag, the words; Show unfolds the detail in place and stays open on a repaint', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><ol></ol></body>'));
  const doc = dom.window.document;
  const host = doc.querySelector('ol');
  const LOG = [{ key: 'clarify', run: null, text: 'Clarify · 2 answers', detail: ['Where? → Redis', 'How? → JSON'] },
    { key: '1-2', run: 1, text: 'Plan approved', detail: [] }];
  paintFeatureLog(doc, host, LOG);
  const rows = [...host.querySelectorAll('.chat-rc-log-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.chat-rc-log-text').textContent), ['Clarify · 2 answers', 'Plan approved']);
  assert.ok(rows[0].querySelector('svg.runs-glyph-done'));
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

test('paintFeatureMembers: "label · state" buttons; a run with no ids is disabled; a click opens the row', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><ol></ol></body>'));
  const doc = dom.window.document;
  const host = doc.querySelector('ol');
  const opened = [];
  paintFeatureMembers(doc, host, [{ key: 'planning', label: 'Planning', state: 'Done', runId: 'r1', pipelineId: 'p1' },
    { key: 'run-3', label: '3 · Part 3', state: 'Planned', runId: null, pipelineId: null }], { open: (row) => opened.push(row.key) });
  const bs = [...host.querySelectorAll('.chat-rc-member-open')];
  assert.deepEqual(bs.map((b) => b.textContent), ['Planning · Done', '3 · Part 3 · Planned']);
  assert.equal(bs[1].disabled, true);
  bs[0].click();
  assert.deepEqual(opened, ['planning']);
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
        if (!panel.querySelector('.btn-go')) { panel.innerHTML = '<button class="btn-go">Approve</button>'; panel.classList.remove('hidden'); }
        return { id: PRE_PQ.id, kind: 'plan', heading: 'Plan · run 2', stepCard: false };
      },
      releaseQuestion: () => {},
      answer: (ref, id) => { answered.push([ref.pipelineId, id]); return true; },
    };
    const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
    const ctl = createRunCardController({ controls, runStore, tickMs: 0 });
    const built = ctl.build({ id: 'card_pre', card: { type: PROGRESS_CARD_TYPE, pipelineId: 'bbbb0001', runId: 'run-b1', title: 'Charts' } },
      { doc: dom.window.document, win: dom.window, shaperCard: () => cardJson });
    dom.window.document.body.appendChild(built.el);
    const $ = (sel) => built.el.querySelector(sel);
    assert.equal($('.chat-rc-fstatus').textContent, 'Needs you · Run 2 · Plan');
    assert.equal(painted.at(-1), 'bbbb0002');
    assert.deepEqual([...built.el.querySelectorAll('.chat-rc-member-label')].map((n) => n.textContent),
      ['Planning', '1 · Store charts', '2 · Chart in Chat', '3 · Charts on the run page']);
    $('.chat-rc-q .qpanel .btn-go').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(answered, [['bbbb0002', PRE_PQ.id]]);
    built.dispose(); ctl.destroy();
  } finally {
    setShapeFirst(false);
  }
});

test('controls: the current run is the target; halted names Resume; waiting runs read Waiting', () => {
  const v = VIEW([SL(1, 'done', { pipelineId: 'p1' }), SL(2, 'error', { pipelineId: 'p2' }), SL(3, 'planned'), SL(4, 'planned')],
    { halted: { index: 2, state: 'error', waiting: [3, 4] }, open: true, approveEach: false, originPipelineId: 'p0' });
  const m = featureCardModel({ own: snap('p0'), card: card(v),
    snapOf: (pid) => (pid === 'p2' ? snap('p2', { status: 'failed', source: 'rest', terminal: true, stageProgress: { label: 'Review', text: 'Review' } }) : null) });
  assert.equal(m.status, 'Failed · Run 2 · Review');
  assert.deepEqual(m.controls, { featureId: v.id, active: true, halted: true, rest: true, approveEach: false, planPipelineId: 'p0',
    target: { index: 2, runId: 'run-p2', pipelineId: 'p2', status: 'failed', asks: false } });   // snap() defaults runId to `run-${pid}`
  assert.deepEqual(m.members.slice(3).map((r) => r.state), ['Waiting', 'Waiting']);
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
