// test/shape-card-flag-off-golden.test.mjs — Shaper small runs B1 (D12): the Chat run card of a shaped run without the
// small-runs marker (no `smallRuns` key on its card) renders exactly as dev's does at the checkpoint (dev b61f7049f, taken when dev was merged in; first taken at 25eac83bb), with the UI
// flag `shaperSmallRuns` off and on. The fixture holds each case's normalized outerHTML (only `data-sig` values are
// stripped). The helpers below are COPIED from test/ui-chat-run-card.test.mjs (not imported), so this file runs on
// its own inside the checkpoint archive.
//
// The fixture was generated ONCE, from a `git archive` of the checkpoint, never from this tree:
//   D=$(mktemp -d "$TMPDIR/golden.XXXXXX"); git archive <checkpoint> | tar -x -C "$D"
//   ln -s "$PWD/node_modules" "$D/node_modules"; cp test/shape-card-flag-off-golden.test.mjs "$D/test/"
//   (cd "$D" && UPDATE_SHAPER_CARD_GOLDEN=1 node --test test/shape-card-flag-off-golden.test.mjs)
//   cp "$D/test/fixtures/shaper/card-flag-off-golden.json" test/fixtures/shaper/
// Do NOT regenerate it on a later tree: it is the proof that flag-off output never moved.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';
import { createChatRunCard } from '../ui/public/chat/run-card.mjs';
import { askKindOf } from '../ui/public/ask/registry.mjs';
import { NOW } from './helpers/run-states.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { stepChip, stepTitle } from '../ui/public/shape/step-card.mjs';
import { renderPlanBody } from '../ui/public/shape/plan-body.mjs';
import { renderOutlineBody } from '../ui/public/shape/outline-body.mjs';
import { buildChatQuestion } from '../ui/public/chat/question.mjs';
import { noteAnswer, forgetAnswer } from '../ui/public/shape/step-receipt.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const FIXTURE = new URL('./fixtures/shaper/card-flag-off-golden.json', import.meta.url);
const CAPTURED_AT = '25eac83bb';
const trackDom = useDomRelease(afterEach);

const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over,
});
const END = { id: 'n_end', kind: 'end', key: null, x: 600, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } };
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', { x: 300, color: 'green' }), END],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false },
  ] } };
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const STATE = (over = {}) => ({ id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'running', runningSince: null, trigger: { wireIds: ['w1'] } })],
  active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], totalCostUsd: 0.42, totalActiveMs: 65_000, startedAt: '2026-09-07T10:00:00Z', ...over });
const IDENT = { cardId: 'card_00000001', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj' };
const live = (over = {}, stateOver = {}, extras = null) => ({ ...snapshotFromState(STATE(stateOver), { now: 0, extras }), source: 'live', runId: 'run-uuid-1', ...over });

function mk({ controls = {}, ctx: ctxOver = {}, ident = {} } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>'));
  const doc = dom.window.document;
  const calls = [];
  const ctx = { openRunPanel: (...a) => calls.push(['panel', ...a]), openArtifact: (...a) => calls.push(['artifact', ...a]), announce: (t) => calls.push(['announce', t]), mountFeature: (host, id) => calls.push(['feature', host, id]), ...ctxOver };
  const refreshed = [];
  const card = createChatRunCard({ doc, win: dom.window, snapshot: null, ctx, controls, ident: { ...IDENT, ...ident }, refresh: () => refreshed.push(1) });
  doc.body.appendChild(card.el);
  const $ = (sel) => card.el.querySelector(sel);
  const $$ = (sel) => [...card.el.querySelectorAll(sel)];
  return { dom, doc, card, calls, refreshed, $, $$, win: dom.window };
}

/** A controls.paintQuestion that mounts the REAL step card (shaper-cards D4/D5): its own buttons post through a submit
 *  that notes the named receipt and resolves true, as app.js stepPost → postAnswer does. */
function stepStub(pq, render, extra = {}) {
  const log = { painted: 0, released: 0, posts: [] };
  return { log,
    paintQuestion(ref, host) {
      log.painted += 1;
      const panel = host.querySelector('.qpanel');
      if (panel.dataset.qid !== pq.id) {
        panel.replaceChildren();
        render(panel, pq, { doc: host.ownerDocument, run: {}, title: stepTitle(pq, 'Implementer'), chip: stepChip(pq, {}), tagLevel() {},
          confirm: async () => true, openFull() {}, fetchPlan: async () => null, markdown: { ensure: async () => false, render: () => ({ kind: 'plain' }) },
          ...extra, submit: async (payload) => { log.posts.push(payload); noteAnswer(ref.runId, pq, payload); return true; } });
        panel.classList.remove('hidden'); panel.dataset.qid = pq.id;
      }
      return { id: pq.id, kind: askKindOf(pq), heading: stepTitle(pq, 'Implementer'), step: 'Implementer', stepCard: true };
    },
    releaseQuestion(host) { log.released += 1; const p = host.querySelector('.qpanel'); p.replaceChildren(); delete p.dataset.qid; },
  };
}

// The Clarify ask's body, as the Chat question (ui/public/chat/question.mjs) builds it.
const clarifyRender = (panel, pq, { doc }) => panel.appendChild(buildChatQuestion(doc, { id: pq.id, heading: 'Clarify', questions: pq.questions, submitLabel: () => 'Send' }).el);

const SL = (i, state, over = {}) => ({ index: i, title: `Part ${i}`, state, runId: null, pipelineId: null, ticketId: `t${i}`, pr: null, ...over });
const VIEW3 = (slices, over = {}) => ({ id: 'feat-1', title: 'Charts', status: 'active', total: 3, done: slices.filter((s) => s.state === 'done').length,
  halted: null, slices, ask: null, log: [], originPipelineId: 'abcd1234', ship: { ready: false, mode: null }, ...over });
const PLAN_PROG = { mode: 'stages', stage: 'plan', label: 'Plan', fraction: 0.1, tone: 'blue', text: 'Plan', stages: [], passes: 0 };
const shaped = (card, snaps = {}, over = {}, stateOver = {}) => live({ shaping: { rounds: [] }, stageProgress: PLAN_PROG, shaper: { card, snaps }, ...over }, stateOver);
const DONE_RUN = { status: 'done', endReached: true };
const WAITING = { ticket: { status: 'scheduled', after: { index: 2 } } };
const ASKING_RUN = { status: 'running', pendingQuestion: { id: 'plan-n_refine-1', kind: 'plan' } };
const featureRow = (members, over = {}) => {
  const model = groupModel({ kind: 'feature', title: 'Charts', planning: DONE_RUN, members }, { now: NOW });
  return { kind: 'chain', groupKind: 'feature', groupId: 'feat-1', title: 'Charts', model, count: model.count.text,
    planning: { title: 'Planning', href: '#running/r0', model: model.planning },
    members: model.members.map((m, i) => ({ position: i + 1, title: `Part ${i + 1}`, href: '#runs', model: m })), ...over };
};

const CLARIFY_LOG = { key: 'clarify', run: null, text: 'Clarify · 2 answers', detail: ['Where? → Redis', 'How? → JSON'] };
const PQ_CLARIFY = { id: 'clarify-n_clarify-1', kind: 'clarify', nodeId: 'n_clarify', questions: [
  { id: 'q1', question: 'Where do charts live?', options: [{ value: 'page', label: 'On the page' }, { value: 'tab', label: 'In a tab' }] },
  { id: 'q2', question: 'Export?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }] };
const PQ_REQ = { id: 'plan-n_reqrefine-1', kind: 'plan', nodeId: 'n_reqrefine', plan: { nodeId: 'n_reqrefine', port: 'requirements', round: 1,
  revisable: true, file: 'requirements.md', check: null, perspectives: ['product'], decisions: [],
  criteria: { ok: true, passed: 1, total: 1, items: [{ id: 'R-po-1', label: 'R-po-1 · Export the report', pass: true }] } } };
const PQ_PLAN = { id: 'plan-n_refine-1', kind: 'plan', nodeId: 'n_refine', plan: { nodeId: 'n_refine', port: 'plan', round: 1, revisable: true,
  file: 'plans/p.md', check: null, perspectives: ['product'] } };
const outlineSlice = (id) => ({ id, title: `Run ${id}`, goal: `Goal ${id}`, inScope: [], outOfScope: [], acceptance: ['works'], dependsOn: [], estimate: 'medium' });
const PQ_OUTLINE = { id: 'plan-n_refine-2', kind: 'plan', nodeId: 'n_refine', plan: { round: 1, outline: { why: 'Three parts', slices: ['s1', 's2', 's3'].map(outlineSlice) } } };
const PQ_SPLIT = { id: 'q-split', kind: 'plan', plan: { outline: { why: 'w', slices: [] } } };

/** The 7 flag-off cases: { controls, snap } per name. None carries a `smallRuns` key. */
const CASES = {
  'clarify-open': () => ({ controls: stepStub(PQ_CLARIFY, clarifyRender),
    snap: shaped({ pipelineId: 'abcd1234', feature: null, log: [] }, {}, { pendingQuestion: PQ_CLARIFY }) }),
  'requirements-ask': () => ({ controls: stepStub(PQ_REQ, renderPlanBody),
    snap: shaped({ pipelineId: 'abcd1234', feature: null, log: [CLARIFY_LOG] }, {}, { pendingQuestion: PQ_REQ }) }),
  'plan-ask': () => ({ controls: stepStub(PQ_PLAN, renderPlanBody),
    snap: shaped({ pipelineId: 'abcd1234', feature: null, log: [CLARIFY_LOG] }, {}, { pendingQuestion: PQ_PLAN }) }),
  'outline-ask': () => ({ controls: stepStub(PQ_OUTLINE, renderOutlineBody),
    snap: shaped({ pipelineId: 'abcd1234', feature: null, log: [CLARIFY_LOG, { key: 'p-3', run: null, text: 'Plan approved', detail: [] }] }, {}, { pendingQuestion: PQ_OUTLINE }) }),
  'feature-one-asking': () => {
    const row = featureRow([DONE_RUN, ASKING_RUN, WAITING]);
    const two = { ...live({}, {}), source: 'live', runId: 'run-2', pipelineId: 'beef0002', status: 'running', pendingQuestion: PQ_PLAN };
    const log = [CLARIFY_LOG, { key: 'p-0', run: null, text: 'Split into 3 runs', detail: ['1 · Part 1', '2 · Part 2', '3 · Part 3'] }];
    const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'approval', { pipelineId: 'beef0002', runId: 'run-2' }), SL(3, 'planned')],
      { ask: { index: 2, runId: 'run-2', pipelineId: 'beef0002', id: PQ_PLAN.id, kind: 'plan' }, log });
    return { controls: { ...stepStub(PQ_PLAN, renderPlanBody), memoFor: () => ({}), groupOf: () => row, modelOpts: () => ({ now: NOW }) },
      snap: shaped({ pipelineId: 'abcd1234', feature: v, log }, { beef0002: two }, { status: 'done', terminal: true }, { status: 'done', active: [] }) };
  },
  'feature-finished': () => {
    const row = featureRow([DONE_RUN, DONE_RUN, DONE_RUN]);
    const log = [CLARIFY_LOG, { key: 'p-0', run: null, text: 'Split into 3 runs', detail: [] }];
    const v = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'done', { pipelineId: 'beef0002' }), SL(3, 'done', { pipelineId: 'beef0003' })],
      { status: 'done', log, ship: { ready: true, mode: null } });
    return { controls: { memoFor: () => ({}), groupOf: () => row, modelOpts: () => ({ now: NOW }) },
      snap: shaped({ pipelineId: 'abcd1234', feature: v, log }, {}, { status: 'done', terminal: true }, { status: 'done', active: [] }) };
  },
  'feature-replanning': () => {
    const view = VIEW3([SL(1, 'done', { pipelineId: 'abcd1234' }), SL(2, 'canceled'), SL(3, 'canceled')],
      { id: 'feat_1', status: 'replanning', replan: { ticketId: 't9', pipelineId: 'rp1', runId: 'run-rp1' } });
    const log = [{ key: 'replan', run: null, text: 'Re-planning runs 2–3', detail: [] }];
    return { controls: stepStub(PQ_SPLIT, renderOutlineBody),
      snap: shaped({ pipelineId: 'abcd1234', feature: { ...view, log }, log: [] },
        { rp1: { source: 'live', status: 'running', runId: 'run-rp1', pipelineId: 'rp1', pendingQuestion: PQ_SPLIT } }) };
  },
};

const normalize = (html) => html.replace(/ data-sig="[^"]*"/g, ' data-sig=""');

function render(name, flagOnUi) {
  const { controls, snap } = CASES[name]();
  const { card, doc } = mk({ controls });
  applyFlags({ shaperSmallRuns: flagOnUi }, doc);
  card.update(snap);
  return normalize(card.el.outerHTML);
}

test('B1 golden: every case without the small-runs marker renders dev\'s card, with the UI flag off and on', () => {
  try {
    if (process.env.UPDATE_SHAPER_CARD_GOLDEN === '1') {
      const cases = Object.fromEntries(Object.keys(CASES).map((n) => [n, render(n, false)]));
      writeFileSync(FIXTURE, `${JSON.stringify({ capturedAt: CAPTURED_AT, cases }, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    assert.equal(golden.capturedAt, CAPTURED_AT);
    assert.deepEqual(Object.keys(golden.cases), Object.keys(CASES), 'the 7 cases');
    for (const name of Object.keys(CASES)) {
      for (const flag of [false, true]) assert.equal(render(name, flag), golden.cases[name], `${name}, UI flag ${flag ? 'on' : 'off'}`);
    }
  } finally {
    for (const id of [PQ_CLARIFY.id, PQ_REQ.id, PQ_PLAN.id, PQ_OUTLINE.id, PQ_SPLIT.id]) forgetAnswer('run-uuid-1', id);
  }
});
