// test/ui-question-shaping.test.mjs — Shape it first (spec §3.3, D3): a shaping run's Clarify ask on the run page
// reads as the step before the plan ("A few questions before the plan"), its submit says "Answer and draft", and a
// "Skip, draft with defaults" button answers every question with its recommended option. A non-shaping run, or the
// gate off, keeps the panel and its heading unchanged.
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

function recorder(status = 200) {
  const answers = [];
  const fetchHandler = (url, opts) => {
    if (url === '/api/answer') {
      answers.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: status === 200, status, json: async () => (status === 200 ? { ok: true } : { error: 'boom' }) });
    }
    return null;
  };
  return { answers, fetchHandler };
}

async function openShaping({ gate = true, shaping = SHAPING, status = 200 } = {}) {
  const rec = recorder(status);
  const ctx = await bootApp({ fetchHandler: rec.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({
    type: 'hello',
    ...(gate ? { features: { shapeFirst: true } } : {}),
    runs: [{ runId: RUN_ID, title: 'Shape demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
      startedAt: '2026-01-01T00:00:00Z', ...(shaping ? { shaping } : {}), pendingQuestion: QUESTIONS }],
  });
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  const panel = runPanel(ctx);
  const head = ctx.window.document.querySelector('#run-detail .rd-ask-head');
  return { ctx, panel, head, ...rec };
}

test('a shaping run\'s Clarify shows Answer and draft, Skip, draft with defaults, and the shaping heading', async () => {
  const { panel, head } = await openShaping();
  assert.ok(panel, 'the run page panel is mounted');
  assert.match(panel.querySelector('.qpanel-foot .btn-go').textContent, /Answer and draft/);
  const skip = panel.querySelector('.qpanel-foot .clarify-defaults');
  assert.ok(skip, 'Skip, draft with defaults is offered');
  assert.equal(skip.textContent, 'Skip, draft with defaults');
  assert.equal(head.textContent, 'A few questions before the plan');
});

test('Skip posts /api/answer with every question\'s recommended (or first) option', async () => {
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

test('Skip with /api/answer answering 500 shows the send-failed line', async () => {
  const { ctx, panel } = await openShaping({ status: 500 });
  const err = panel.querySelector('.clarify-defaults-err');
  assert.ok(err, 'the alert line is mounted');
  assert.equal(err.hidden, true);
  click(ctx, panel.querySelector('.clarify-defaults'));
  await ctx.settle(5);
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /Could not send your answer/);
});

for (const [name, opts] of [['a non-shaping run', { shaping: null }], ['the gate off', { gate: false }]]) {
  test(`${name} keeps the Clarify panel and its heading unchanged`, async () => {
    const { panel, head } = await openShaping(opts);
    assert.ok(panel, 'the run page panel is mounted');
    assert.equal(panel.querySelector('.clarify-defaults'), null, 'no Skip button');
    assert.match(panel.querySelector('.qpanel-foot .btn-go').textContent, /Submit/);
    assert.equal(panel.querySelectorAll('.qblock').length, 2);
    assert.notEqual(head.textContent, 'A few questions before the plan');
    assert.match(head.textContent, /2 questions/);
  });
}
