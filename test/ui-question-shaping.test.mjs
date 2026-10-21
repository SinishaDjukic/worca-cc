// test/ui-question-shaping.test.mjs — Shape it first (spec §3.3, D3; shaper-cards D2–D4, D16): a shaping run's Clarify
// ask on the run page is a step card ("A few questions before the plan", chip Clarify) with Answer and Use defaults
// (every question's recommended option). A non-shaping run, or the gate off, keeps the Clarify panel and its heading.
// Every step kind draws the same card on the run page and in the paintAsk host (the chat card's and the feature page's
// path), and the paintAsk host — which has no click delegate, like the feature page — still posts.
//
// The run arrives in the FIRST hello, so it is built through makeRun: a page loaded while a shaping run waits at
// Clarify must still know it is shaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';

const RUN_ID = 'run-shape';
const SHAPING = { perspectives: ['ux'], rounds: [], approved: null, savedTo: null };
const QUESTIONS = {
  id: 'q-shape-1',
  kind: 'questions',
  agent: 'Planner',
  questions: [
    { id: 'q1', question: 'Who uses it?', options: ['Admins', 'Everyone', ''], recommended: 'Everyone' },
    { id: 'q2', question: 'Where does it live?', options: ['Settings', 'Chat', ''] },
  ],
};

const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));

// The group page's feature (#feature/feat_1): its ask points at the shaping run (s3: one step card in three hosts).
const FEATURE = (pq) => ({ id: 'feat_1', title: 'Charts', projectKey: 'p', status: 'active', approveEach: true, total: 2, done: 0,
  halted: null, open: true, replacedBy: null, replan: null, originPipelineId: null, log: [],
  ship: { ready: false, mode: null, prUrl: null, suggested: null, linesAdded: null },
  slices: [{ index: 1, title: 'One', state: 'approval', runId: RUN_ID, pipelineId: null, pr: null }, { index: 2, title: 'Two', state: 'planned', runId: null, pipelineId: null, pr: null }],
  ask: { index: 1, runId: RUN_ID, pipelineId: null, id: pq.id, kind: pq.kind } });

// The same feature as a run group (GET /api/run-groups): #feature/feat_1 is the group page, whose status card holds the
// open step (.gpage-question) of the member that asks.
const GROUPS = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Charts', projectKey: null, planning: null, cost: { usd: 0, byPipeline: {} },
  members: [{ position: 1, title: 'One', pipelineId: 'pshape01', ticketId: null, status: 'running', pr: null, ticket: null, adhoc: false, after: null }] }] };

function recorder(status = 200, currentPq = QUESTIONS) {
  const answers = [];
  const fetchHandler = (url, opts) => {
    if (url.startsWith('/api/shape/features/feat_1')) return Promise.resolve({ ok: true, status: 200, json: async () => FEATURE(currentPq) });
    if (url.startsWith('/api/run-groups')) return Promise.resolve({ ok: true, status: 200, json: async () => GROUPS });
    if (url === '/api/answer') {
      answers.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: status === 200, status, json: async () => (status === 200 ? { ok: true } : { error: 'boom' }) });
    }
    return null;
  };
  return { answers, fetchHandler };
}

async function openShaping({ gate = true, shaping = SHAPING, status = 200, pq = QUESTIONS } = {}) {
  const rec = recorder(status, pq);
  const ctx = await bootApp({ fetchHandler: rec.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    flags: { shapeFirst: !!gate },
    runs: [{ runId: RUN_ID, pipelineId: 'pshape01', title: 'Shape demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
      startedAt: '2026-01-01T00:00:00Z', ...(shaping ? { shaping } : {}), pendingQuestion: pq }],
  });
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  const panel = runPanel(ctx);
  const head = ctx.window.document.querySelector('#run-detail .rd-ask-head');
  return { ctx, panel, head, ...rec };
}

test('a shaping run\'s Clarify is a step card: Answer, Use defaults, the head says it once', async () => {
  const { panel, head } = await openShaping();
  assert.ok(panel, 'the run page panel is mounted');
  assert.equal(panel.querySelector('.qpanel-foot [data-qpanel-submit]').textContent, 'Answer');
  const defaults = panel.querySelector('.qpanel-foot .clarify-defaults');
  assert.ok(defaults, 'Use defaults is offered');
  assert.equal(defaults.textContent, 'Use defaults');
  assert.equal(panel.querySelector('.ask-mcard-title').textContent, 'A few questions before the plan');
  assert.equal(panel.querySelector('.ask-mcard-kind').textContent, 'Clarify');
  assert.equal(head.textContent, '', 'the run page heading stays empty for a step card');
});

test('run 4 D2, D3: on a Clarify ask the bar reads "Answer", and its click focuses the first option', async () => {
  const { ctx, panel } = await openShaping();
  const bar = ctx.window.document.querySelector('#run-detail .rd-bar .rd-actions [data-model-action="answer"]');
  assert.equal(bar.textContent, 'Answer');
  click(ctx, bar);
  assert.equal(ctx.window.document.activeElement, panel.querySelector('.qopt'));
});

test('Answer posts the picked answers once', async () => {
  const { ctx, panel, answers } = await openShaping();
  click(ctx, panel.querySelectorAll('.qblock')[1].querySelector('.qopt'));
  click(ctx, panel.querySelector('.qpanel-foot [data-qpanel-submit]'));
  await ctx.settle();
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].payload.answers.map((a) => a.choice), ['', 'Settings']);
});

test('Use defaults posts /api/answer with every question\'s recommended (or first) option', async () => {
  const { ctx, panel, answers } = await openShaping();
  click(ctx, panel.querySelector('.clarify-defaults'));
  await ctx.settle();
  assert.equal(answers.length, 1);
  assert.equal(answers[0].runId, RUN_ID);
  assert.equal(answers[0].id, 'q-shape-1');
  assert.deepEqual(answers[0].payload, {
    answers: [
      { id: 'q1', question: 'Who uses it?', choice: 'Everyone' },
      { id: 'q2', question: 'Where does it live?', choice: 'Settings' },
    ],
  });
});

test('Use defaults with /api/answer answering 500 says why it was not sent', async () => {
  const { ctx, panel } = await openShaping({ status: 500 });
  const err = panel.querySelector('.plan-err');
  assert.ok(err, 'the alert line is mounted');
  assert.equal(err.hidden, true);
  click(ctx, panel.querySelector('.clarify-defaults'));
  await ctx.settle(5);
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Not sent: boom');
});

for (const [name, opts] of [['a non-shaping run', { shaping: null }], ['the gate off', { gate: false }]]) {
  test(`${name} keeps the Clarify panel and its heading unchanged`, async () => {
    const { panel, head } = await openShaping(opts);
    assert.ok(panel, 'the run page panel is mounted');
    assert.equal(panel.querySelector('.clarify-defaults'), null, 'no Use defaults button');
    assert.equal(panel.querySelector('.ask-mcard-head'), null, 'not a step card');
    assert.match(panel.querySelector('.qpanel-foot [data-qpanel-submit]').textContent, /Submit/);
    assert.equal(panel.querySelectorAll('.qblock').length, 2);
    assert.notEqual(head.textContent, 'A few questions before the plan');
    assert.match(head.textContent, /2 questions/);
  });
}

// ---- every step kind: the run page and the paintAsk host draw the same card (shaper-cards D2/D16)
const slice = (id) => ({ id, title: `Run ${id}`, goal: `Goal ${id}`, inScope: [], outOfScope: [], acceptance: ['works'], dependsOn: [], estimate: 'medium' });
const PLAN = { id: 'q-plan', kind: 'plan', plan: { round: 1, revisable: true, file: 'plans/p.md', perspectives: [],
  check: { ok: false, passed: 1, total: 2, items: [{ id: 'a', label: 'A', pass: true }, { id: 'b', label: 'B', pass: false, detail: 'b' }] } } };
const KINDS = [
  ['Clarify', QUESTIONS, SHAPING, 'A few questions before the plan', 'Clarify'],
  ['Plan', PLAN, SHAPING, 'Your turn: approve the plan', 'Plan'],
  ['Split', { id: 'q-split', kind: 'plan', plan: { round: 1, revisable: true, outline: { why: 'big', slices: [slice('s1'), slice('s2'), slice('s3')] } } },
    SHAPING, 'Your turn: approve the runs', 'Runs'],
  ['run-k Plan', { ...PLAN, id: 'q-plan-2' }, { ...SHAPING, feature: { id: 'f1', index: 2, total: 3 } }, 'Your turn: approve the plan', 'Plan · run 2'],
  ['Gate', { id: 'q-gate', kind: 'gate', issues: [{ severity: 'major', title: 'Flaky', detail: 'd' }] }, SHAPING, 'A decision is needed', 'Gate'],
  ['Recovery', { id: 'q-rec', kind: 'recovery', recovery: { cls: 'auth', message: 'token expired', options: [{ id: 'retry' }, { id: 'pause' }] } },
    SHAPING, 'A step failed', 'Recovery'],
];

function paintAskHost(ctx) {
  const doc = ctx.window.document;
  const host = doc.createElement('div');
  host.className = 'shape-feature-ask';                    // the feature page's host: no click delegate
  host.innerHTML = '<div class="qpanel hidden"></div>';
  doc.body.appendChild(host);
  const q = ctx.window.__shapeFeature.paintAsk({ runId: RUN_ID, pipelineId: null }, host);
  return { q, panel: host.querySelector('.qpanel') };
}
const look = (panel) => ({
  title: panel.querySelector('.ask-mcard-title')?.textContent,
  chip: panel.querySelector('.ask-mcard-kind')?.textContent,
  text: panel.textContent,
  buttons: [...panel.querySelectorAll('button')].map((b) => b.textContent),
});

async function groupPageHost(ctx) {
  ctx.go('feature/feat_1');
  await ctx.settle();
  return ctx.window.document.querySelector('#group-detail .gpage-card .gpage-question .qpanel');
}

for (const [name, pq, shaping, title, chip] of KINDS) {
  test(`${name}: the run page, the chat host and the group page show the same head, chip, body text and buttons`, async () => {
    const { ctx, panel } = await openShaping({ pq, shaping });
    await ctx.settle();
    const page = look(panel);
    const chat = paintAskHost(ctx);
    await ctx.settle();
    const group = await groupPageHost(ctx);
    assert.equal(page.title, title);
    assert.equal(page.chip, chip);
    assert.deepEqual(look(chat.panel), page);
    assert.equal(chat.q.stepCard, true);
    assert.ok(group, 'the group page mounts the open step');
    assert.deepEqual(look(group), page);
  });
}

test('a gate button in the paintAsk host (no delegate, the feature page) posts /api/answer {decision:"another"} exactly once', async () => {
  const { ctx, answers } = await openShaping({ pq: KINDS[4][1] });
  const { panel } = paintAskHost(ctx);
  click(ctx, panel.querySelector('.gate-another'));
  await ctx.settle();
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].payload, { decision: 'another' });
});
