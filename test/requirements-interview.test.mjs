// test/requirements-interview.test.mjs — orientation + rounds with a fake runner; never a real claude (design §4, D7-D9, D13).
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature, appendTurn, setContext } from '../src/core/requirements/store.mjs';
import { REPO_LOOK_TOOLS, REPO_LOOK_TIMEOUT_MS } from '../src/core/auto/classify.mjs';
import {
  startOrientation, submitAnswers, finishInterview, followUp, retry, settled, isBusy, recoverInterrupted, requirementsModel, MAX_JOBS,
} from '../src/core/requirements/interview.mjs';
import { requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';
import { removeCriterion, setAssumption } from '../src/core/requirements/edits.mjs';

useTempHome(after);
beforeEach(() => {
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  setContext('project', 'shop-1234abcd', { lookAtCode: true });   // tests that turn the look off never leak it
});

const ROUND1 = { spec: { goal: { text: 'Cancel before shipping', measure: 'fewer calls' } },
  criteria: [{ id: null, text: 'A customer can cancel an unpaid order' }],
  questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'w' }],
  done: false, note: 'One question.' };
const ROUND2 = { spec: { actors: ['Customer'] }, criteria: [{ id: 'R-po-1', text: 'A customer can cancel an unpaid order' }],
  assumptions: [{ id: null, text: 'Refunds are full' }], questions: [], done: true, note: 'Done.' };

/** A fake runner: answers the queued replies in order, records every call, books $0.10 per call. */
function fakeRunner(replies) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text }, costUsd: 0.1 });
    return { text };
  };
  return { calls, runClaudeImpl };
}
const repoDir = mkdtempSync(join(tmpdir(), 'req-int-repo-'));
function deps(runner, extra = {}) {
  const closed = [];
  return {
    closed,
    runClaudeImpl: runner.runClaudeImpl,
    listModels: async () => [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5-5[1m]' }, { id: 'claude-opus-5-5' }],
    listProjects: async () => [{ key: 'shop-1234abcd', name: 'shop', path: repoDir, exists: true }],
    workspaceTarget: async () => null,
    openLook: async () => ({ cwd: repoDir, close: async () => { closed.push('look'); } }),
    openWorkspaceLook: async () => null,
    onChange: () => {},
    ...extra,
  };
}
const newFeature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'Before it ships' });

test('model: the first plain Opus in the catalog; undefined when none or on error', async () => {
  assert.equal(await requirementsModel(async () => [{ id: 'claude-opus-5-5[1m]' }, { id: 'claude-opus-5-5' }]), 'claude-opus-5-5');
  assert.equal(await requirementsModel(async () => [{ id: 'claude-sonnet-5' }]), undefined);
  assert.equal(await requirementsModel(async () => { throw new Error('x'); }), undefined);
});

test('orientation reads code with the repo-look tools only, closes the look, then round 1 asks', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'Orders have a status.', files: ['src/orders.js'] }, ROUND1]);
  const d = deps(r);
  await startOrientation(f.seq, { by: 'po' }, d);
  await settled(f.seq);
  assert.deepEqual(r.calls[0].tools, [...REPO_LOOK_TOOLS]);
  assert.equal(r.calls[0].strictMcpConfig, true);
  assert.ok(r.calls[0].maxTurns > 0, 'orientation is turn-capped');
  assert.equal(r.calls[1].strictMcpConfig, true);
  assert.equal(r.calls[0].model, 'claude-opus-5-5');
  assert.deepEqual(d.closed, ['look']);
  assert.deepEqual(r.calls[1].tools, [], 'a round has no tools');
  assert.deepEqual(r.calls[1].allowedTools, []);
  assert.match(r.calls[1].prompt, /Orders have a status\./);
  const g = getFeature(f.seq);
  assert.equal(g.status, 'your_turn');
  assert.equal(g.orientation.summary, 'Orders have a status.');
  assert.deepEqual(g.spec.criteria, [{ id: 'R-po-1', text: 'A customer can cancel an unpaid order' }]);
  assert.equal(g.rounds, 1);
  assert.ok(g.costUsd > 0);
  assert.ok(requirementsWindowedSpendUsd(0) > 0, 'spend is on the ledger');
  assert.deepEqual(listTurns(f.seq).map((t) => t.kind), ['orientation', 'round']);
});

test('answers start the next round; the thread carries them; done ends the interview', async () => {
  const f = newFeature();
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  const r = fakeRunner([ROUND1, ROUND2]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 1, 'code look off: no orientation call');
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  assert.throws(() => submitAnswers(f.seq, { roundTurnId: round.id, answers: [] }, {}, d), (e) => e.code === 'BAD_REQUEST');
  await submitAnswers(f.seq, { roundTurnId: round.id, answers: [{ id: 'who', option: 'Support' }] }, { by: 'po' }, d);
  await settled(f.seq);
  assert.match(r.calls[1].prompt, /\[who\] Support/);
  const g = getFeature(f.seq);
  assert.equal(g.status, 'done');
  assert.deepEqual(g.spec.assumptions, [{ id: 'A-1', text: 'Refunds are full', status: 'open' }]);
});

test('use recommended fills unanswered questions; free text wins over an option', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: '' }, { ...ROUND1, questions: [...ROUND1.questions, { id: 'when', question: 'When?', options: ['a', 'b'], recommended: 'b' }] }, ROUND2]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true, answers: [{ id: 'who', option: 'Support', text: 'Only managers' }] }, {}, d);
  await settled(f.seq);
  const ans = listTurns(f.seq).find((t) => t.kind === 'answers').payload.answers;
  assert.deepEqual(ans.map((a) => a.answer), ['Only managers', 'b']);
});

test('busy: a second start is refused while a round runs', async () => {
  const f = newFeature();
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = deps({ runClaudeImpl: async () => { await gate; return { text: JSON.stringify(ROUND1) }; } });
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  const p = startOrientation(f.seq, {}, d);
  assert.equal(isBusy(f.seq), true);
  assert.ok(['looking', 'thinking'].includes(getFeature(f.seq).status));
  assert.throws(() => retry(f.seq, {}, d), (e) => e.code === 'BUSY');
  release();
  await p;
  assert.equal(isBusy(f.seq), false);
});

test('an unreadable reply is retried once, then an error turn; the spec is unchanged; retry recovers', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: '' }, 'not json', 'still not json', ROUND1]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  let g = getFeature(f.seq);
  assert.equal(g.status, 'your_turn');
  assert.equal(g.rounds, 0);
  assert.equal(listTurns(f.seq).at(-1).kind, 'error');
  await retry(f.seq, {}, d);
  await settled(f.seq);
  g = getFeature(f.seq);
  assert.equal(g.rounds, 1);
  assert.equal(listTurns(f.seq).at(-1).kind, 'round');
});

test('a failed look never blocks the interview; a failed call becomes an error turn', async () => {
  const f = newFeature();
  const r = fakeRunner([ROUND1]);
  const d = deps(r, { openLook: async () => { throw new Error('git broke'); } });
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).orientation.skipped, 'failed');
  assert.equal(getFeature(f.seq).rounds, 1);
  const f2 = newFeature();
  await startOrientation(f2.seq, {}, deps(fakeRunner([{ summary: '' }, new Error('CLI exited 1')])));
  await settled(f2.seq);
  assert.equal(getFeature(f2.seq).status, 'your_turn');
  assert.match(listTurns(f2.seq).at(-1).payload.message, /CLI exited 1/);
});

test('finish runs a final round: no questions, open questions become assumptions', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: '' }, ROUND1, { spec: { openQuestions: ['Who pays shipping?'] }, questions: [{ id: 'x', question: 'q?', options: ['a', 'b'] }] }]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  await finishInterview(f.seq, {}, d);
  await settled(f.seq);
  assert.match(r.calls.at(-1).prompt, /final round/i);
  const g = getFeature(f.seq);
  assert.equal(g.status, 'done');
  assert.equal(g.spec.assumptions.at(-1).text, 'Not decided: Who pays shipping?');
});

test('mock mode: canned orientation and rounds, no runner call', async () => {
  process.env.WORCA_MOCK = '1';
  const f = newFeature();
  const r = fakeRunner([]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(d.closed, [], 'no look was opened');
  const g = getFeature(f.seq);
  assert.match(g.orientation.summary, /\[mock\]/);
  assert.equal(g.status, 'your_turn');
  assert.equal(listTurns(f.seq).at(-1).payload.questions.length, 2);
});

test('recoverInterrupted: a feature left looking/thinking goes back to the product owner', () => {
  const f = newFeature();
  updateFeature(f.seq, { status: 'thinking' });
  assert.ok(recoverInterrupted() >= 1);
  assert.equal(getFeature(f.seq).status, 'your_turn');
  assert.match(listTurns(f.seq).at(-1).payload.message, /did not finish/);
});

test('budget: at the limit the round is refused as an error turn; the answers stay', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: '' }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  const blocked = deps(fakeRunner([]), { budget: () => ({ blocked: true, totalLimitUsd: 5 }) });
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, blocked);
  await settled(f.seq);
  const kinds = listTurns(f.seq).map((t) => t.kind);
  assert.deepEqual(kinds.slice(-2), ['answers', 'error']);
  assert.equal(listTurns(f.seq).at(-1).payload.code, 'BUDGET');
  assert.equal(getFeature(f.seq).status, 'your_turn');
  assert.equal(getFeature(f.seq).rounds, 1);
});

// ── fix round 1 ──────────────────────────────────────────────────────────────
const off = () => setContext('project', 'shop-1234abcd', { lookAtCode: false });
const spent = () => requirementsWindowedSpendUsd(0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('a call that throws after it cost money still books it, with the earlier attempt', async () => {
  off();
  const f = newFeature();
  const before = spent();
  const r = fakeRunner(['not json', new Error('CLI died')]);
  const run = r.runClaudeImpl;
  r.runClaudeImpl = async (opts) => {   // the throwing attempt emitted a result before dying
    if (r.calls.length === 1) opts.onEvent?.({ type: 'result', raw: { type: 'result' }, costUsd: 0.1 });
    return run(opts);
  };
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  const last = listTurns(f.seq).at(-1);
  assert.equal(last.kind, 'error');
  near(last.costUsd, 0.2);
  near(getFeature(f.seq).costUsd, 0.2);
  near(spent() - before, 0.2);
});

test('the spending limit is checked before the second attempt too', async () => {
  off();
  const f = newFeature();
  const before = spent();
  const r = fakeRunner(['not json', ROUND1]);
  let n = 0;
  await startOrientation(f.seq, {}, deps(r, { budget: () => ({ blocked: ++n >= 2, totalLimitUsd: 5 }) }));
  await settled(f.seq);
  assert.equal(r.calls.length, 1);
  const last = listTurns(f.seq).at(-1);
  assert.equal(last.payload.code, 'BUDGET');
  near(getFeature(f.seq).costUsd, 0.1);
  near(spent() - before, 0.1);
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('retry needs an error turn; finish is refused once done', async () => {
  off();
  const f = newFeature();
  assert.throws(() => retry(f.seq, {}, deps(fakeRunner([]))), (e) => e.code === 'CONFLICT' && /nothing to retry/.test(e.message));
  const d = deps(fakeRunner([ROUND2]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.throws(() => retry(f.seq, {}, d), (e) => e.code === 'CONFLICT');
  assert.throws(() => finishInterview(f.seq, {}, d), (e) => e.code === 'CONFLICT');
});

test('the sixth round is automatically final', async () => {
  off();
  const f = newFeature();
  const r = fakeRunner([ROUND1, { ...ROUND1, done: false, questions: [{ id: 'x', question: 'q?', options: ['a', 'b'] }] }]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  updateFeature(f.seq, { rounds: 5 });
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, d);
  await settled(f.seq);
  assert.match(r.calls.at(-1).prompt, /final round/i);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.deepEqual(listTurns(f.seq).at(-1).payload.questions, []);
});

test('a job that finishes after the feature was archived leaves it archived', async () => {
  off();
  const f = newFeature();
  let release;
  let entered;
  const gate = new Promise((res) => { release = res; });
  const inCall = new Promise((res) => { entered = res; });
  const d = deps({ runClaudeImpl: async () => { entered(); await gate; return { text: JSON.stringify(ROUND1) }; } });
  const p = startOrientation(f.seq, {}, d);
  await inCall;
  updateFeature(f.seq, { status: 'archived' });
  release();
  await p;
  assert.equal(getFeature(f.seq).status, 'archived');
  // a failing job does not un-archive either
  const f2 = newFeature();
  let boom;
  const gate2 = new Promise((res) => { boom = res; });
  let entered2;
  const inCall2 = new Promise((res) => { entered2 = res; });
  const d2 = deps({ runClaudeImpl: async () => { entered2(); await gate2; throw new Error('boom'); } });
  const p2 = startOrientation(f2.seq, {}, d2);
  await inCall2;
  updateFeature(f2.seq, { status: 'archived' });
  boom();
  await p2;
  assert.equal(getFeature(f2.seq).status, 'archived');
});

test('a failed look-again rests at the feature\'s resting status (done stays done)', async () => {
  off();
  const f = newFeature();
  await startOrientation(f.seq, {}, deps(fakeRunner([ROUND2])));
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
  await startOrientation(f.seq, { thenRound: false }, deps(fakeRunner([]), { budget: () => ({ blocked: true }) }));
  assert.equal(getFeature(f.seq).status, 'done');
  assert.equal(listTurns(f.seq).at(-1).payload.job, 'look');
});

test('a failed round rests at your turn, even on a done feature', async () => {
  off();
  const f = newFeature();
  const d = deps(fakeRunner([ROUND1, ROUND2]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  await submitAnswers(f.seq, { roundTurnId: round.id, answers: [{ id: 'who', option: 'Support' }] }, {}, deps(fakeRunner([]), { budget: () => ({ blocked: true }) }));
  await settled(f.seq);
  assert.equal(listTurns(f.seq).at(-1).payload.code, 'BUDGET');
  assert.equal(listTurns(f.seq).at(-1).payload.job, 'round');
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('retry after a failed look-again re-runs the look, not a round', async () => {
  const f = newFeature();
  await startOrientation(f.seq, {}, deps(fakeRunner([{ summary: 'first' }, ROUND1])));
  await settled(f.seq);
  await startOrientation(f.seq, { thenRound: false }, deps(fakeRunner([]), { budget: () => ({ blocked: true }) }));
  assert.equal(listTurns(f.seq).at(-1).kind, 'error');
  const r = fakeRunner([{ summary: 'second', files: [] }]);
  await retry(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].tools.length > 0, true, 'the look call, not a round');
  assert.equal(getFeature(f.seq).rounds, 1);
  assert.equal(getFeature(f.seq).orientation.summary, 'second');
  assert.equal(listTurns(f.seq).at(-1).kind, 'orientation');
});

test('a job that finds the feature archived before its model call makes no call', async () => {
  off();
  const f = newFeature();
  let release;
  const gate = new Promise((res) => { release = res; });
  const r = fakeRunner([ROUND1]);
  let entered;
  const inModels = new Promise((res) => { entered = res; });
  const d = deps(r, { listModels: async () => { entered(); await gate; return [{ id: 'claude-opus-5-5' }]; } });
  const p = startOrientation(f.seq, {}, d);
  await inModels;
  updateFeature(f.seq, { status: 'archived' });
  release();
  await p;
  assert.equal(r.calls.length, 0);
  assert.equal(getFeature(f.seq).status, 'archived');
  // the same before the orientation call
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
  const f2 = newFeature();
  let release2;
  const gate2 = new Promise((res) => { release2 = res; });
  let entered2;
  const inLook = new Promise((res) => { entered2 = res; });
  const r2 = fakeRunner([{ summary: 'x' }, ROUND1]);
  const d2 = deps(r2, { openLook: async () => { entered2(); await gate2; return { cwd: repoDir, close: async () => {} }; } });
  const p2 = startOrientation(f2.seq, {}, d2);
  await inLook;
  updateFeature(f2.seq, { status: 'archived' });
  release2();
  await p2;
  assert.equal(r2.calls.length, 0);
  assert.equal(getFeature(f2.seq).status, 'archived');
});

test('a throwing in-job change hook does not fail the job', async () => {
  off();
  const f = newFeature();
  const orig = console.error;
  console.error = () => {};
  try {
    await startOrientation(f.seq, {}, deps(fakeRunner([ROUND1]), { onChange: () => { throw new Error('hook down'); } }));
  } finally { console.error = orig; }
  assert.equal(getFeature(f.seq).rounds, 1);
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'error'), false);
});

test('the job promise never rejects, even if the change hook throws', async () => {
  off();
  const f = newFeature();
  const orig = console.error;
  console.error = () => {};
  try {
    await startOrientation(f.seq, {}, deps(fakeRunner([ROUND1]), { onChange: () => { throw new Error('hook down'); } }));
    assert.equal(isBusy(f.seq), false);
  } finally { console.error = orig; }
});

test('the repo look gets an abort signal; a hung checkout is cut at the look timeout', async () => {
  const f = newFeature();
  let seen = null;
  const d = deps(fakeRunner([ROUND1]), {
    openLook: (_p, _b, o) => new Promise((_res, rej) => {
      seen = o?.signal;
      o?.signal?.addEventListener('abort', () => rej(new Error('aborted before the checkout')));
    }),
  });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const p = startOrientation(f.seq, {}, d);
    for (let i = 0; i < 50 && !seen; i += 1) await new Promise((r) => setImmediate(r));
    assert.ok(seen instanceof AbortSignal);
    mock.timers.tick(REPO_LOOK_TIMEOUT_MS + 1);
    await p;
  } finally { mock.timers.reset(); }
  assert.equal(seen.aborted, true);
  assert.equal(getFeature(f.seq).orientation.skipped, 'failed');
});

test('a call cut by its own timer reads as a clear message and keeps the spend', async () => {
  off();
  const f = newFeature();
  let entered;
  const inCall = new Promise((res) => { entered = res; });
  const d = deps({
    runClaudeImpl: (opts) => new Promise((_res, rej) => {
      opts.onEvent?.({ type: 'result', raw: { type: 'result' }, costUsd: 0.1 });
      opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      entered();
    }),
  });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const p = startOrientation(f.seq, {}, d);
    await inCall;
    mock.timers.tick(181_000);
    await p;
  } finally { mock.timers.reset(); }
  const last = listTurns(f.seq).at(-1);
  assert.match(last.payload.message, /Worca got no reply within 180 seconds\. Try again\./);
  near(last.costUsd, 0.1);
});

test('a round never brings back a criterion the product owner removed', async () => {
  off();
  const f = newFeature();
  const d = deps(fakeRunner([ROUND1]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  removeCriterion(f.seq, 'R-po-1');
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  const r = fakeRunner([{ ...ROUND2, criteria: [{ id: null, text: 'a customer can cancel an unpaid order' }, { id: null, text: 'Support is told' }] }]);
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, deps(r));
  await settled(f.seq);
  assert.match(r.calls[0].prompt, /removed criterion R-po-1: A customer can cancel an unpaid order/);
  assert.deepEqual(getFeature(f.seq).spec.criteria.map((c) => c.text), ['Support is told']);
});

test('recoverInterrupted: an interrupted look on a done feature rests at done, and retry re-runs the look, not a round', async () => {
  off();
  const f = newFeature();
  await startOrientation(f.seq, {}, deps(fakeRunner([ROUND2])));
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  updateFeature(f.seq, { status: 'looking' });          // "Look again" cut short by a restart
  assert.ok(recoverInterrupted() >= 1);
  assert.equal(getFeature(f.seq).status, 'done');
  const last = listTurns(f.seq).at(-1);
  assert.equal(last.payload.code, 'INTERRUPTED');
  assert.equal(last.payload.job, 'look');
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
  const r = fakeRunner([{ summary: 'again', files: [] }]);
  await retry(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 1);
  assert.ok(r.calls[0].tools.length > 0, 'the look call, not a paid round');
  assert.equal(getFeature(f.seq).rounds, 1);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.equal(getFeature(f.seq).orientation.summary, 'again');
});

test('recoverInterrupted: an interrupted round records job round', () => {
  const f = newFeature();
  updateFeature(f.seq, { status: 'thinking' });
  recoverInterrupted();
  assert.equal(listTurns(f.seq).at(-1).payload.job, 'round');
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('both call kinds run as aux spawns (the credential broker\'s short-lived token)', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'x', files: [] }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.calls.map((c) => c.spawnKind), ['aux', 'aux']);
});

test('at most MAX_JOBS requirements jobs run at once; one more is BUSY and leaves no trace', async () => {
  off();
  assert.equal(MAX_JOBS, 4);
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = deps({ runClaudeImpl: async () => { await gate; return { text: JSON.stringify(ROUND1) }; } });
  const running = [];
  for (let i = 0; i < MAX_JOBS; i += 1) running.push(startOrientation(newFeature().seq, {}, d));
  const extra = newFeature();
  updateFeature(extra.seq, { status: 'your_turn' });
  const before = listTurns(extra.seq).length;
  assert.throws(() => startOrientation(extra.seq, {}, d),
    (e) => e.code === 'BUSY' && e.message === 'Worca is working on several features; try again in a moment.');
  assert.equal(isBusy(extra.seq), false);
  assert.equal(getFeature(extra.seq).status, 'your_turn', 'the refused feature is untouched');
  assert.equal(listTurns(extra.seq).length, before);
  release();
  await Promise.all(running);
});

test('a round whose questions are all invalid is retried, then an error turn', async () => {
  off();
  const f = newFeature();
  const junk = { spec: {}, questions: [{ question: 'Only one option?', options: ['a'] }], done: false };
  const r = fakeRunner([junk, junk]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 2, 'retried once');
  assert.equal(listTurns(f.seq).at(-1).payload.code, 'BAD_REPLY');
  assert.equal(getFeature(f.seq).status, 'your_turn');
  assert.equal(getFeature(f.seq).rounds, 0);
});


// ── follow-up rounds ─────────────────────────────────────────────────────────
async function doneAfterSix() {
  process.env.WORCA_MOCK = '1';
  off();
  const f = newFeature();
  const d = deps(fakeRunner([]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  updateFeature(f.seq, { rounds: 6, status: 'done', spec: { ...getFeature(f.seq).spec, assumptions: [
    { id: 'A-1', text: 'Refunds are full', status: 'open' }, { id: 'A-2', text: 'Cash only', status: 'open' }] }, assumptionSeq: 2 });
  return { f, d };
}

test('follow-up: past the round cap it asks, then the answers end in a final round', async () => {
  const { f, d } = await doneAfterSix();
  setAssumption(f.seq, 'A-1', 'rejected');
  await followUp(f.seq, {}, d);
  await settled(f.seq);
  const g = getFeature(f.seq);
  assert.equal(g.status, 'your_turn');
  assert.equal(g.rounds, 7);
  const turns = listTurns(f.seq);
  const fu = turns.find((t) => t.kind === 'followup');
  assert.deepEqual(fu.payload, { assumptions: ['A-1'] });
  const round = turns.at(-1);
  assert.equal(round.kind, 'round');
  assert.deepEqual(round.payload.questions.map((x) => x.id), ['replace-a-1']);
  assert.deepEqual(round.payload.followUp, ['A-1']);
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.deepEqual(listTurns(f.seq).at(-1).payload.questions, []);
  assert.throws(() => followUp(f.seq, {}, d), (e) => e.code === 'CONFLICT');
});

test('follow-up: nothing unasked is a CONFLICT; busy is BUSY', async () => {
  const { f, d } = await doneAfterSix();
  assert.throws(() => followUp(f.seq, {}, d), (e) => e.code === 'CONFLICT');
  setAssumption(f.seq, 'A-1', 'rejected');
  const p = followUp(f.seq, {}, d);
  assert.throws(() => followUp(f.seq, {}, d), (e) => e.code === 'BUSY');
  await p;
  await settled(f.seq);
});

test('follow-up: refused at the spending limit becomes a BUDGET error turn', async () => {
  const { f } = await doneAfterSix();
  delete process.env.WORCA_MOCK;
  setAssumption(f.seq, 'A-2', 'rejected');
  await followUp(f.seq, {}, deps(fakeRunner([]), { budget: () => ({ blocked: true, totalLimitUsd: 5 }) }));
  await settled(f.seq);
  assert.equal(listTurns(f.seq).at(-1).payload.code, 'BUDGET');
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('follow-up: a refused follow-up is retried as a follow-up round (rounds >= 6)', async () => {
  const { f, d } = await doneAfterSix();
  setAssumption(f.seq, 'A-2', 'rejected');
  delete process.env.WORCA_MOCK;
  await followUp(f.seq, {}, deps(fakeRunner([]), { budget: () => ({ blocked: true, totalLimitUsd: 5 }) }));
  await settled(f.seq);
  assert.equal(listTurns(f.seq).at(-1).payload.code, 'BUDGET');
  process.env.WORCA_MOCK = '1';
  await retry(f.seq, {}, d);
  await settled(f.seq);
  const last = listTurns(f.seq).at(-1);
  assert.equal(last.kind, 'round');
  assert.deepEqual(last.payload.followUp, ['A-2']);
  assert.deepEqual(last.payload.questions.map((x) => x.id), ['replace-a-2']);
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('follow-up: after an interrupted follow-up, the boot sweep and retry ask the follow-up round', async () => {
  const { f, d } = await doneAfterSix();
  setAssumption(f.seq, 'A-1', 'rejected');
  appendTurn(f.seq, { kind: 'followup', payload: { assumptions: ['A-1'] } });
  updateFeature(f.seq, { status: 'thinking' });
  assert.equal(recoverInterrupted(), 1);
  await retry(f.seq, {}, d);
  await settled(f.seq);
  const last = listTurns(f.seq).at(-1);
  assert.deepEqual(last.payload.followUp, ['A-1']);
  assert.equal(last.payload.questions.length, 1);
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('follow-up: refused (CONFLICT) while a round\'s questions are waiting; nothing is written', async () => {
  const f = newFeature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: ROUND1.questions, done: false } });
  updateFeature(f.seq, { status: 'your_turn', rounds: 1, spec: { ...getFeature(f.seq).spec, assumptions: [{ id: 'A-1', text: 'Full', status: 'rejected' }] }, assumptionSeq: 1 });
  appendTurn(f.seq, { kind: 'assumption', payload: { id: 'A-1', status: 'rejected' } });
  const n = listTurns(f.seq).length;
  assert.throws(() => followUp(f.seq, {}, deps(fakeRunner([]))), (e) => e.code === 'CONFLICT' && /questions/.test(e.message));
  assert.equal(listTurns(f.seq).length, n, 'no followup turn');
  assert.equal(isBusy(f.seq), false);
});
