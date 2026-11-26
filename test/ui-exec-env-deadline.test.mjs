// test/ui-exec-env-deadline.test.mjs — an E2B run's waiting question says when its parked sandbox is released
// (state.execEnvWaitUntil, docs/e2b.md): the run page's question panel shows "Answer by …" with what happens then,
// follows later state frames, and a local run never shows the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp as boot, runPanel, openRunPanel } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

const RUN_ID = 'run-e2b-wait-1';
const GATE = { type: 'question', runId: RUN_ID, id: 'gate-w25-3', kind: 'gate', wireId: 'w25', nodeId: 'n_review',
  issues: [{ severity: 'major', title: 'The word "Chat" never appears on screen' }], deliveryNo: 3, holdNo: 1 };
const until = new Date(Date.now() + 240 * 60_000).toISOString();
const note = (panel) => panel && panel.querySelector('.qpanel-deadline');

test('a waiting question on an E2B run shows when the sandbox is released; state frames update and clear it', async () => {
  await checkRows([
    { name: 'the line names the time, the sandbox and what Resume does', run: async () => {
      const ctx = await boot();
      const panel = await openRunPanel(ctx, { runId: RUN_ID, question: GATE, run: { execEnv: 'e2b', execEnvWaitUntil: until } });
      const n = note(panel);
      assert.ok(n, 'the deadline line is shown');
      const hhmm = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      assert.ok(n.textContent.includes(hhmm), n.textContent);
      assert.match(n.textContent, /E2B sandbox/);
      assert.match(n.textContent, /pauses the run/);
      assert.match(n.textContent, /Resume continues in a fresh sandbox/);
    } },
    { name: 'a state frame without the deadline removes the line; one with it brings it back', run: async () => {
      const ctx = await boot();
      await openRunPanel(ctx, { runId: RUN_ID, question: GATE, run: { execEnv: 'e2b' } });
      assert.equal(note(runPanel(ctx)), null, 'no deadline yet: no line');
      ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', execEnv: 'e2b', execEnvWaitUntil: until });
      await ctx.settle();
      assert.ok(note(runPanel(ctx)), 'the parked deadline arrives with a state frame');
      ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', execEnv: 'e2b' });
      await ctx.settle();
      assert.equal(note(runPanel(ctx)), null, 'unparked: the line goes');
    } },
    { name: 'a local run never shows the line', run: async () => {
      const ctx = await boot();
      const panel = await openRunPanel(ctx, { runId: RUN_ID, question: GATE, run: { execEnvWaitUntil: until } });
      assert.equal(note(panel), null);
    } },
  ]);
});
