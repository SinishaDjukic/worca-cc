// test/requirements-interview.test.mjs — orientation + rounds with a fake runner; never a real claude (design §4, D7-D9, D13).
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, getFeature, listTurns, updateFeature, appendTurn, setContext, getBrief, beginBrief, saveBriefResult, deleteBrief,
  insertAttachment, mintAttachmentId, updateAttachment, getAttachment, deleteAttachmentRow, listAttachments,
} from '../src/core/requirements/store.mjs';
import { REPO_LOOK_TOOLS, REPO_LOOK_MAX_TURNS, REPO_LOOK_TIMEOUT_MS } from '../src/core/auto/classify.mjs';
import {
  startOrientation, submitAnswers, finishInterview, followUp, maybeFollowUpFiles, retry, settled, isBusy, recoverInterrupted, requirementsModel, MAX_JOBS, interviewCallOptions, callModel,
  userClaudeSignIn, interviewModel, DEFAULT_INTERVIEW_EFFORT, assertCapacity,
} from '../src/core/requirements/interview.mjs';
import { addAttachments, removeAttachment, readsSettled } from '../src/core/requirements/attachment-job.mjs';
import { ATTACHMENT_SYSTEM_PROMPT } from '../src/core/requirements/attachments.mjs';
import { requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';
import { ROUND_SYSTEM_PROMPT, ORIENTATION_SYSTEM_PROMPT } from '../src/core/requirements/round.mjs';
import { unaskedFiles, readiness } from '../src/core/requirements/ready.mjs';
import { startFeature, isStarting } from '../src/core/requirements/start.mjs';
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
    interviewSlot: () => ({}),   // nothing stored: the default pair
    userSignIn: () => false,   // the hermetic branch unless a test says otherwise (never the real user settings)
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

// ── A7: the product brief (plans/requirements-a7-design.md D10, D11) ─────────────────────────────────────
const BSCOPE = 'shopb-0000beef';
function savedBrief() {
  const now = getBrief('project', BSCOPE);
  if (now && now.madeAt) return now;
  const b = beginBrief('project', BSCOPE);
  return saveBriefResult(b.id, {
    sections: { product: 'A shop where customers order.', users: [], terms: [],
      areas: [{ name: 'Orders', text: 'checkout and history.', status: 'partly', files: ['src/o.js'], added: null, belongsTo: null }] },
    sources: [{ project: BSCOPE, branch: 'main', ref: 'refs/heads/main', sha: 'abc1234def5678' }], files: ['src/o.js'],
  });
}
const briefOn = () => setContext('project', BSCOPE, { lookAtCode: true });
const newBriefFeature = () => createFeature({ scopeType: 'project', scopeKey: BSCOPE, title: 'Gift message', description: 'A note on an order' });
/** deps for the brief's scope, recording frames (the status at each), budget checks and look checkouts. */
function briefDeps(runner, extra = {}) {
  const seen = { frames: [], budget: 0, opened: 0 };
  const d = deps(runner, {
    listProjects: async () => [{ key: BSCOPE, name: 'shopb', path: repoDir, exists: true }],
    openLook: async () => { seen.opened += 1; return { cwd: repoDir, close: async () => {} }; },
    onChange: (seq) => { seen.frames.push(getFeature(seq).status); },
    budget: () => { seen.budget += 1; return { blocked: false }; },
    ...extra,
  });
  return { d, seen };
}
const provenanceOf = (b) => `Made from main @ abc1234 on ${b.madeAt.slice(0, 10)}.`;

test('brief: a new feature skips its own look: no looking status or frame, no look, no budget check; round 1 reads the brief', async () => {
  briefOn();
  const b = savedBrief();
  const f = newBriefFeature();
  updateFeature(f.seq, { status: 'your_turn' });   // any status: the skip writes none
  const r = fakeRunner([ROUND1]);
  const { d, seen } = briefDeps(r);
  await startOrientation(f.seq, { by: 'po' }, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 1, 'only the round');
  assert.deepEqual(r.calls[0].tools, [], 'the one call is the round');
  assert.equal(seen.opened, 0, 'no checkout');
  assert.equal(seen.budget, 1, 'only the round checked the budget');
  assert.equal(seen.frames[0], 'thinking', 'no frame before round 1\'s thinking');
  assert.ok(!seen.frames.includes('looking'));
  const prompt = r.calls[0].prompt;
  assert.ok(prompt.includes(`</project_context>\n\n<product_brief>\n${provenanceOf(b)}\n\nWhat the product does:\nA shop where customers order.`));
  assert.ok(prompt.indexOf('</product_brief>') < prompt.indexOf('<what_worca_found_in_the_code>'));
  const turns = listTurns(f.seq);
  assert.deepEqual(turns.map((t) => t.kind), ['orientation', 'round']);
  assert.deepEqual(turns[0].payload, { summary: '', files: [], skipped: 'brief', error: null, briefMadeAt: b.madeAt });
  assert.equal(turns[0].costUsd, null);
  assert.deepEqual(turns[1].payload.brief, { id: b.id, madeAt: b.madeAt });
  const g = getFeature(f.seq);
  assert.equal(g.orientation.skipped, 'brief');
  assert.equal(g.orientation.briefMadeAt, b.madeAt);
  assert.equal(g.orientation.summary, '');
  assert.equal(g.status, 'your_turn');
  assert.equal(g.rounds, 1);
});

test('brief: later rounds read it too and record it', async () => {
  briefOn();
  const b = savedBrief();
  const f = newBriefFeature();
  const r = fakeRunner([ROUND1, ROUND2]);
  const { d } = briefDeps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, d);
  await settled(f.seq);
  assert.match(r.calls[1].prompt, /<product_brief>\nMade from main @ abc1234/);
  assert.deepEqual(listTurns(f.seq).at(-1).payload.brief, { id: b.id, madeAt: b.madeAt });
});

test('without a brief: A1 behaviour, and no brief on the prompt or the round', async () => {
  off();
  const f = newFeature();
  const r = fakeRunner([ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.doesNotMatch(r.calls[0].prompt, /product_brief/);
  assert.equal('brief' in listTurns(f.seq).at(-1).payload, false);
  const o = getFeature(f.seq).orientation;
  assert.equal(o.skipped, 'off');
  assert.deepEqual([o.scopeType, o.scopeKey, o.briefId], [f.scopeType, f.scopeKey, null], 'a look without a brief: the scope, no brief id');
});

test('brief, mock mode: the skip and the round\'s brief, no runner call', async () => {
  process.env.WORCA_MOCK = '1';
  briefOn();
  const b = savedBrief();
  const f = newBriefFeature();
  const r = fakeRunner([]);
  const { d, seen } = briefDeps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  assert.equal(seen.opened, 0);
  assert.equal(getFeature(f.seq).orientation.skipped, 'brief');
  assert.deepEqual(listTurns(f.seq).at(-1).payload.brief, { id: b.id, madeAt: b.madeAt });
});

test('Look closer: the explicit look carries the brief, asks for what it does not say, and stores the area', async () => {
  briefOn();
  const b = savedBrief();
  const f = newBriefFeature();
  const { d } = briefDeps(fakeRunner([ROUND1]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  const r = fakeRunner([{ summary: 'Orders have no note yet.', files: ['/tmp/x/auto-look-0000abcd/src/o.js'], area: 'Orders' }]);
  const { d: d2, seen } = briefDeps(r);
  await startOrientation(f.seq, { thenRound: false }, d2);
  await settled(f.seq);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].tools, [...REPO_LOOK_TOOLS]);
  assert.equal(seen.opened, 1);
  assert.match(r.calls[0].prompt, /<product_brief>\nMade from main @ abc1234/);
  assert.match(r.calls[0].prompt, /The product brief above already describes the product\. Look only at what this feature needs that the brief does not say/);
  const g = getFeature(f.seq);
  assert.equal(g.orientation.summary, 'Orders have no note yet.');
  assert.equal(g.orientation.area, 'Orders');
  assert.equal(g.orientation.skipped, null);
  // stamped with the scope it was made for and the brief it was made against (Add this to the brief checks both)
  assert.equal(g.orientation.scopeType, 'project');
  assert.equal(g.orientation.scopeKey, BSCOPE);
  assert.equal(g.orientation.briefId, b.id);
  assert.equal(g.rounds, 1, 'no round');
  assert.equal(g.status, 'your_turn');
});

test('Look closer, mock mode: a canned closer look with an absolute path and an area', async () => {
  process.env.WORCA_MOCK = '1';
  briefOn();
  savedBrief();
  const f = newBriefFeature();
  const { d } = briefDeps(fakeRunner([]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  await startOrientation(f.seq, { thenRound: false }, d);
  await settled(f.seq);
  const o = getFeature(f.seq).orientation;
  assert.match(o.summary, /^\[mock\] A closer look: /);
  assert.deepEqual(o.files, ['/tmp/mock/auto-look-0000abcd/README.md']);
  assert.equal(o.area, 'Orders');
});

test('switch off with a brief: creation still skips; an explicit look is refused and writes nothing', async () => {
  setContext('project', BSCOPE, { lookAtCode: false });
  savedBrief();
  const f = newBriefFeature();
  const { d } = briefDeps(fakeRunner([ROUND1]));
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).orientation.skipped, 'brief');
  const before = { turns: listTurns(f.seq).length, f: getFeature(f.seq) };
  const r = fakeRunner([]);
  assert.throws(() => startOrientation(f.seq, { thenRound: false }, briefDeps(r).d),
    (e) => e.code === 'CONFLICT' && e.message === 'Looking at the code is off for this project.');
  assert.equal(isBusy(f.seq), false);
  assert.equal(r.calls.length, 0);
  assert.equal(listTurns(f.seq).length, before.turns);
  assert.deepEqual(getFeature(f.seq).orientation, before.f.orientation);
  assert.equal(getFeature(f.seq).status, before.f.status);
  assert.equal(getFeature(f.seq).updatedAt, before.f.updatedAt);
});

test('brief: Try again with no orientation yet skips again', async () => {
  briefOn();
  savedBrief();
  const f = newBriefFeature();
  appendTurn(f.seq, { kind: 'error', payload: { code: 'INTERRUPTED', message: 'restart', job: 'look' } });
  updateFeature(f.seq, { status: 'your_turn' });
  const r = fakeRunner([ROUND1]);
  const { d, seen } = briefDeps(r);
  await retry(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(seen.opened, 0);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].tools, []);
  assert.equal(getFeature(f.seq).orientation.skipped, 'brief');
  assert.deepEqual(listTurns(f.seq).map((t) => t.kind), ['error', 'orientation', 'round']);
});

test('brief at the spending limit: the feature is still created (no look to refuse); the round is refused as A1', async () => {
  briefOn();
  savedBrief();
  const f = newBriefFeature();
  const r = fakeRunner([]);
  let checks = 0;
  const { d } = briefDeps(r, { budget: () => { checks += 1; return { blocked: true, totalLimitUsd: 5 }; } });
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  assert.equal(checks, 1, 'the round\'s check only');
  const turns = listTurns(f.seq);
  assert.deepEqual(turns.map((t) => t.kind), ['orientation', 'error']);
  assert.equal(turns[0].payload.skipped, 'brief');
  assert.equal(turns[1].payload.code, 'BUDGET');
  assert.equal(turns[1].payload.job, 'round');
  assert.equal(getFeature(f.seq).status, 'your_turn');
});

test('brief deleted after creation: the next round has no <product_brief> and records no brief', async () => {
  briefOn();
  savedBrief();
  const f = newBriefFeature();
  const r = fakeRunner([ROUND1, ROUND2]);
  const { d } = briefDeps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  assert.equal(getFeature(f.seq).orientation.skipped, 'brief');
  assert.match(r.calls[0].prompt, /<product_brief>/);
  assert.ok(deleteBrief('project', BSCOPE));
  try {
    const round = listTurns(f.seq).find((t) => t.kind === 'round');
    await submitAnswers(f.seq, { roundTurnId: round.id, useRecommended: true }, {}, d);
    await settled(f.seq);
    assert.doesNotMatch(r.calls[1].prompt, /product_brief/);
    assert.equal('brief' in listTurns(f.seq).at(-1).payload, false);
  } finally { savedBrief(); }
});

test('a look without a brief never stores an area, even when the reply names one', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'Orders exist.', files: [], area: 'Orders' }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  const o = getFeature(f.seq).orientation;
  assert.equal(o.summary, 'Orders exist.');
  assert.equal('area' in o, false);
});

// ── the one call path (A1.1 Task 1): the options written out, so every change is deliberate ──
// Task 3: A2's options plus Worca's own system prompt (replace mode) and the hermetic flags.
test('interviewCallOptions: a look is A2\'s options, replace mode and the hermetic flags', () => {
  assert.deepEqual(interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', effort: 'medium' }), {
    cwd: '/c', systemPrompt: ORIENTATION_SYSTEM_PROMPT, systemPromptMode: 'replace', prompt: 'P', model: 'm1', modelEnv: undefined,
    allowedTools: [...REPO_LOOK_TOOLS], tools: [...REPO_LOOK_TOOLS], strictMcpConfig: true,
    settingSources: ['project'], disableSlashCommands: true,
    maxTurns: REPO_LOOK_MAX_TURNS, effort: 'medium', permissionMode: 'acceptEdits', spawnKind: 'aux',
  });
});

test('interviewCallOptions: noSessionPersistence only when it is true; the interview\'s own calls do not carry it', () => {
  for (const kind of ['look', 'round']) {
    assert.equal(interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1', noSessionPersistence: true }).noSessionPersistence, true, kind);
    for (const v of [false, undefined, 'yes', 1]) {
      assert.equal('noSessionPersistence' in interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1', noSessionPersistence: v }), false, `${kind} ${v}`);
    }
    assert.equal('noSessionPersistence' in interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1' }), false, kind);
  }
});

test('interviewCallOptions: no effort key unless one is given', () => {
  for (const kind of ['look', 'round']) assert.equal('effort' in interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1' }), false, kind);
});

test('interviewCallOptions: a round is A2\'s options (no tools, no maxTurns), replace mode and the hermetic flags', () => {
  const o = interviewCallOptions('round', { cwd: '/c', prompt: 'P', model: 'm1', effort: 'medium' });
  assert.deepEqual(o, {
    cwd: '/c', systemPrompt: ROUND_SYSTEM_PROMPT, systemPromptMode: 'replace', prompt: 'P', model: 'm1', modelEnv: undefined,
    allowedTools: [], tools: [], strictMcpConfig: true,
    settingSources: ['project'], disableSlashCommands: true,
    effort: 'medium', permissionMode: 'acceptEdits', spawnKind: 'aux',
  });
  assert.equal('maxTurns' in o, false);
});

test('interviewCallOptions: keepUserSettings drops only settingSources; replace mode and no slash commands stay, whatever the overrides', () => {
  for (const kind of ['look', 'round']) {
    const kept = interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1', systemPrompt: 'B', tools: ['Read'], maxTurns: 3, effort: 'low' }, { keepUserSettings: true });
    assert.equal('settingSources' in kept, false, kind);
    assert.equal(kept.systemPromptMode, 'replace', kind);
    assert.equal(kept.disableSlashCommands, true, kind);
    const herm = interviewCallOptions(kind, { cwd: '/c', prompt: 'P', systemPrompt: 'B' }, { keepUserSettings: false });
    assert.deepEqual(herm.settingSources, ['project'], kind);
    assert.equal(herm.systemPromptMode, 'replace', kind);
    assert.equal(herm.disableSlashCommands, true, kind);
  }
});

test('interviewCallOptions: unknown kind and unknown keys throw TypeError', () => {
  assert.throws(() => interviewCallOptions('brief', { cwd: '/c', prompt: 'P' }), TypeError);
  assert.throws(() => interviewCallOptions('round', { cwd: '/c', prompt: 'P', settingSources: [] }), TypeError);
  assert.throws(() => interviewCallOptions('round', { cwd: '/c', prompt: 'P', tools: 'Read' }), TypeError);
});

test('interviewCallOptions: overrides replace the kind defaults', () => {
  const o = interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', systemPrompt: 'B', maxTurns: 40 });
  assert.equal(o.systemPrompt, 'B');
  assert.equal(o.maxTurns, 40);
  assert.deepEqual(o.tools, [...REPO_LOOK_TOOLS]);
  const r = interviewCallOptions('round', { cwd: '/c', prompt: 'P', tools: ['Read'], effort: 'low' });
  assert.deepEqual(r.allowedTools, ['Read']);
  assert.equal(r.effort, 'low');
});

test("A8 §9: allowedTools overrides the allow list only; its default is the call's tools, so every A1.1 and A7 call is unchanged", () => {
  const read = interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', systemPrompt: 'F', tools: ['Read'], allowedTools: ['Read(//c/a.pdf)'], maxTurns: 5 });
  assert.deepEqual([read.tools, read.allowedTools, read.maxTurns, read.systemPrompt, read.systemPromptMode], [['Read'], ['Read(//c/a.pdf)'], 5, 'F', 'replace']);
  for (const kind of ['look', 'round']) {
    const o = interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1' });
    assert.deepEqual(o.allowedTools, o.tools, kind);
  }
  assert.throws(() => interviewCallOptions('round', { cwd: '/c', prompt: 'P', allowedTools: 'Read' }), TypeError);
  assert.throws(() => interviewCallOptions('round', { cwd: '/c', prompt: 'P', disallowedTools: [] }), TypeError);
});

test("A8: callModel aborts its call when the caller's signal aborts", async () => {
  const ctrl = new AbortController();
  let seen = null;
  const d = { runClaudeImpl: (o) => new Promise((_, rej) => { seen = o.signal; o.signal.addEventListener('abort', () => rej(new Error('stopped'))); }), userSignIn: () => false };
  const p = callModel(d, { kind: 'round', cwd: '/c', prompt: 'P', model: 'm1', timeoutMs: 60_000, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, /stopped/);
  assert.equal(seen.aborted, true);
});

test('A8: callModel returns the normalized events it saw (one shape) and the guard decisions the runner returned', async () => {
  const toolUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/c/a.pdf' } }] } };
  const decisions = [{ tool: 'Read', path: '/c/a.pdf', decision: 'allow', id: 'tu_1' }];
  const d = { userSignIn: () => false, runClaudeImpl: async (opts) => {
    opts.onEvent({ type: 'assistant', raw: toolUse });
    opts.onEvent({ type: 'result', raw: { type: 'result', total_cost_usd: 0.25, result: 'x', num_turns: 2 }, costUsd: 0.25 });
    return { text: 'x', readGuardDecisions: decisions };
  } };
  const out = await callModel(d, { kind: 'look', cwd: '/c', prompt: 'P', model: 'm1', timeoutMs: 5000, tools: ['Read'], readGuard: '/c/a.pdf' });
  assert.deepEqual(out.events.map((e) => e.type), ['tool', 'result'], 'normalized only: no raw envelope beside its normalized event');
  assert.deepEqual(out.events[0].calls, [{ name: 'Read', input: { file_path: '/c/a.pdf' }, toolUseId: 'tu_1' }]);
  assert.equal(out.events[1].numTurns, 2);
  assert.deepEqual(out.readGuardDecisions, decisions);
  const plain = await callModel({ userSignIn: () => false, runClaudeImpl: async () => ({ text: 'y' }) }, { kind: 'round', cwd: '/c', prompt: 'P', model: 'm1', timeoutMs: 5000 });
  assert.deepEqual(plain, { text: 'y', costUsd: 0, events: [] }, 'no decisions key when the runner returned none');
});

test('callModel: sends the built options plus signal and onEvent, and books the cost', async () => {
  const seen = [];
  const d = { userSignIn: () => false, runClaudeImpl: async (opts) => {
    seen.push(opts);
    opts.onEvent({ type: 'result', raw: { type: 'result', total_cost_usd: 0.25, result: 'x' }, costUsd: 0.25 });
    return { text: 'x' };
  } };
  const out = await callModel(d, { kind: 'round', cwd: '/c', prompt: 'P', model: 'm1', timeoutMs: 5000 });
  assert.deepEqual([out.text, out.costUsd, out.events.map((e) => e.type), 'readGuardDecisions' in out], ['x', 0.25, ['result'], false]);
  const { signal, onEvent, ...rest } = seen[0];
  assert.ok(signal && typeof onEvent === 'function');
  assert.deepEqual(rest, interviewCallOptions('round', { cwd: '/c', prompt: 'P', model: 'm1' }));
});

// ── A1.1 Task 3: Worca's own system prompt, and no user plugins in a call ──
test('both calls replace the system prompt and are hermetic; the look keeps its tools and names its directory', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'Orders have a status.', files: [] }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) {
    assert.equal(c.systemPromptMode, 'replace');
    assert.deepEqual(c.settingSources, ['project']);
    assert.equal(c.disableSlashCommands, true);
  }
  assert.equal(r.calls[0].systemPrompt, ORIENTATION_SYSTEM_PROMPT);
  assert.deepEqual(r.calls[0].tools, [...REPO_LOOK_TOOLS]);
  assert.equal(r.calls[0].maxTurns, REPO_LOOK_MAX_TURNS);
  assert.ok(r.calls[0].prompt.includes(`The working directory, ${repoDir}, is a checkout of the project.`), 'the look prompt names repoDir');
  assert.equal(r.calls[1].systemPrompt, ROUND_SYSTEM_PROMPT);
  assert.deepEqual(r.calls[1].tools, []);
  assert.equal('maxTurns' in r.calls[1], false);
});

test('A7\'s brief call shape (a look with its own prompt, 40 turns, high effort) keeps replace mode, the hermetic flags and the look tools', async () => {
  const r = fakeRunner(['{}']);
  await callModel(deps(r), { kind: 'look', cwd: repoDir, prompt: 'P', model: 'm1', timeoutMs: 5000, systemPrompt: 'BRIEF', maxTurns: 40, effort: 'high' });
  const c = r.calls[0];
  assert.equal(c.systemPrompt, 'BRIEF');
  assert.equal(c.systemPromptMode, 'replace');
  assert.deepEqual(c.settingSources, ['project']);
  assert.equal(c.disableSlashCommands, true);
  assert.deepEqual(c.tools, [...REPO_LOOK_TOOLS]);
  assert.equal(c.maxTurns, 40);
  assert.equal(c.effort, 'high');
});

test('deps.userSignIn true: no settingSources on either call, still replace mode and no slash commands; false: project only', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'x', files: [] }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r, { userSignIn: () => true }));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) {
    assert.equal('settingSources' in c, false);
    assert.equal(c.disableSlashCommands, true);
    assert.equal(c.systemPromptMode, 'replace');
  }
  const r2 = fakeRunner(['{}']);
  await callModel(deps(r2, { userSignIn: () => false }), { kind: 'round', cwd: repoDir, prompt: 'P', model: 'm1', timeoutMs: 5000 });
  assert.deepEqual(r2.calls[0].settingSources, ['project']);
});

/** A temp home whose .claude/settings.json holds `body` (a string is written as is; undefined writes nothing). */
function signInHome(body) {
  const home = mkdtempSync(join(tmpdir(), 'req-signin-'));
  if (body !== undefined) {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return home;
}

test('userClaudeSignIn: an apiKeyHelper or a sign-in / network env key in the user settings means keep them', () => {
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ apiKeyHelper: 'cat /run/secrets/key' }) }), true);
  for (const key of ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_PROFILE', 'AWS_REGION',
    'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'HTTPS_PROXY', 'http_proxy', 'NODE_EXTRA_CA_CERTS']) {
    assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ env: { [key]: '1' } }) }), true, key);
  }
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome(`${String.fromCharCode(0xFEFF)}${JSON.stringify({ apiKeyHelper: 'x' })}`) }), true, 'a leading BOM is tolerated');
});

test('userClaudeSignIn: an OAuth token in env, awsAuthRefresh and awsCredentialExport also mean keep them', () => {
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ env: { CLAUDE_CODE_OAUTH_TOKEN: 't' } }) }), true);
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ awsAuthRefresh: 'aws sso login' }) }), true);
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ awsCredentialExport: 'aws configure export-credentials' }) }), true);
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({ awsAuthRefresh: '', awsCredentialExport: 3 }) }), false, 'empty or not a string');
});

test('userClaudeSignIn: no home argument resolves homedir() inside the guard and never throws', () => {
  const missing = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  assert.equal(typeof userClaudeSignIn({ env: {}, read: missing }), 'boolean');
  assert.equal(userClaudeSignIn({ env: {}, read: missing }), false);
});

test('userClaudeSignIn: nothing to keep for other keys, an empty helper, no file, invalid JSON or not an object; never throws', () => {
  const cases = [[{ env: { FOO: '1' } }, 'other env key'], [{}, 'empty object'], [{ apiKeyHelper: '' }, 'empty helper'],
    [undefined, 'no file'], ['null', 'JSON null'], [[{ apiKeyHelper: 'x' }], 'a JSON array'], [{ env: ['ANTHROPIC_BASE_URL'] }, 'env not an object']];
  for (const [body, why] of cases) assert.equal(userClaudeSignIn({ env: {}, home: signInHome(body) }), false, why);
});

test('userClaudeSignIn: a file that exists but cannot be read or parsed means keep the user settings; a missing or blank one is hermetic', () => {
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({}), read: err('EACCES') }), true, 'unreadable');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({}), read: err('EISDIR') }), true, 'not a file');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({}), read: err('ENOENT') }), false, 'missing');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome({}), read: err('ENOTDIR') }), false, 'parent is not a directory');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome('{ not json') }), true, 'invalid JSON');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome('// comment\n{"a":1}') }), true, 'comments');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome('') }), false, 'empty file: nothing to keep');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome(' ' + String.fromCharCode(10, 9) + ' ') }), false, 'whitespace only: nothing to keep');
  assert.equal(userClaudeSignIn({ env: {}, home: signInHome(`${String.fromCharCode(0xFEFF)}  `) }), false, 'BOM and blanks: nothing to keep');
});

test('userClaudeSignIn: CLAUDE_CONFIG_DIR (trimmed) moves the file off <home>/.claude', () => {
  const home = signInHome({});
  const other = signInHome({ apiKeyHelper: 'x' });
  assert.equal(userClaudeSignIn({ env: {}, home }), false);
  assert.equal(userClaudeSignIn({ env: { CLAUDE_CONFIG_DIR: ` ${join(other, '.claude')} ` }, home }), true);
  assert.equal(userClaudeSignIn({ env: { CLAUDE_CONFIG_DIR: '   ' }, home: other }), true, 'blank: back to <home>/.claude');
});

test('the default userSignIn reads the user settings per call and logs the keep line once per process', async () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(signInHome({ apiKeyHelper: 'cat /run/secrets/key' }), '.claude');
  const warn = mock.method(console, 'warn', () => {});
  try {
    const f = newFeature();
    const r = fakeRunner([{ summary: 'x', files: [] }, ROUND1]);
    const d = deps(r);
    delete d.userSignIn;   // the module default
    await startOrientation(f.seq, {}, d);
    await settled(f.seq);
    assert.equal(r.calls.length, 2);
    for (const c of r.calls) assert.equal('settingSources' in c, false);
    const lines = warn.mock.calls.map((c) => c.arguments[0]).filter((a) => /requirements: user Claude settings/.test(a));
    assert.deepEqual(lines, ['[worca] requirements: user Claude settings carry or may carry sign-in; keeping them for interviews']);
  } finally {
    warn.mock.restore();
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// ── the interview's model and effort (A1.1 Task 5, D2) ──
async function runBoth(slot, extra = {}) {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'Orders.', files: [] }, ROUND1]);
  await startOrientation(f.seq, { by: 'po' }, deps(r, { interviewSlot: slot, ...extra }));
  await settled(f.seq);
  return { r, f };
}

test('interview model: nothing stored -> the default Opus and medium effort on the look and the round', async () => {
  const { r } = await runBoth(() => ({}));
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) { assert.equal(c.model, 'claude-opus-5-5'); assert.equal(c.effort, 'medium'); }
  // The unset production call is A2's options byte for byte (plus Task 3's replace mode and hermetic flags).
  const strip = ({ onEvent, signal, cwd, prompt, ...rest }) => rest;
  const a2 = (kind) => { const { cwd, prompt, ...rest } = interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'claude-opus-5-5', effort: 'medium' }); return rest; };
  assert.deepEqual(strip(r.calls[0]), a2('look'));
  assert.deepEqual(strip(r.calls[1]), a2('round'));
});

test('interview model: a stored model alone is used and no effort is sent', async () => {
  const { r, f } = await runBoth(() => ({ model: 'claude-sonnet-5' }));
  for (const c of r.calls) { assert.equal(c.model, 'claude-sonnet-5'); assert.equal('effort' in c, false); }
  assert.equal(listTurns(f.seq).find((t) => t.kind === 'orientation').model, 'claude-sonnet-5');
});

test('interview model: a stored effort alone -> the default Opus with that effort', async () => {
  const { r } = await runBoth(() => ({ effort: 'high' }));
  for (const c of r.calls) { assert.equal(c.model, 'claude-opus-5-5'); assert.equal(c.effort, 'high'); }
});

test('interview model: both stored -> both', async () => {
  const { r } = await runBoth(() => ({ model: 'claude-sonnet-5', effort: 'low' }));
  for (const c of r.calls) { assert.equal(c.model, 'claude-sonnet-5'); assert.equal(c.effort, 'low'); }
});

test('interview model: a stored model that left the catalog -> the default pair', async () => {
  const { r } = await runBoth(() => ({ model: 'gone-model' }));
  for (const c of r.calls) { assert.equal(c.model, 'claude-opus-5-5'); assert.equal(c.effort, 'medium'); }
});

test('interview model: a throwing slot reader -> the default pair', async () => {
  const { r } = await runBoth(() => { throw new Error('unreadable'); });
  for (const c of r.calls) { assert.equal(c.model, 'claude-opus-5-5'); assert.equal(c.effort, 'medium'); }
});

test('interviewModel: the resolved pair and its source', async () => {
  const list = async () => [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5-5' }];
  const at = (slot, listModels = list) => interviewModel({ interviewSlot: () => slot, listModels });
  assert.deepEqual(await at({}), { model: 'claude-opus-5-5', effort: DEFAULT_INTERVIEW_EFFORT, source: 'default' });
  assert.deepEqual(await at({ model: 'CLAUDE-SONNET-5' }), { model: 'claude-sonnet-5', effort: null, source: 'settings' });
  assert.deepEqual(await at({ effort: 'max' }), { model: 'claude-opus-5-5', effort: 'max', source: 'settings' });
  assert.deepEqual(await at({ model: 'gone' }), { model: 'claude-opus-5-5', effort: 'medium', source: 'default' });
  // a failing catalog read: the stored model counts
  assert.deepEqual(await at({ model: 'x-model' }, async () => { throw new Error('no catalog'); }), { model: 'x-model', effort: null, source: 'settings' });
});

test('interviewModel: a stored id matching case-insensitively comes back as the canonical id', async () => {
  const im = await interviewModel({ interviewSlot: () => ({ model: 'CLAUDE-SONNET-5' }), listModels: async () => [{ id: 'claude-sonnet-5' }] });
  assert.equal(im.model, 'claude-sonnet-5');
});

// ── the final review: spend booked in one transaction, one deadline for a look ──

test('a look books its cost on the feature and the ledger together: a ledger write that fails leaves both untouched', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
  const { getDb } = await import('../src/core/db.mjs');
  const f = newFeature();
  const before = spent();
  getDb().exec("CREATE TEMP TRIGGER req_ledger_down BEFORE INSERT ON req_cost_ledger BEGIN SELECT RAISE(ABORT, 'ledger down'); END;");
  const orig = console.error;
  console.error = () => {};
  try {
    await startOrientation(f.seq, {}, deps(fakeRunner([{ summary: 'Orders exist.', files: [] }, ROUND1])));
    await settled(f.seq);
  } finally {
    console.error = orig;
    getDb().exec('DROP TRIGGER IF EXISTS req_ledger_down');
  }
  near(spent(), before);
  near(getFeature(f.seq).costUsd, 0);
});

test('a look has one deadline: the call gets only the time the checkout left', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
  const f = newFeature();
  let release;
  let entered;
  const inCall = new Promise((res) => { entered = res; });
  const round = fakeRunner([ROUND1]);
  let calls = 0;
  const d = deps({
    // the look's call hangs until its timer aborts it; round 1 then answers as usual
    runClaudeImpl: (opts) => (calls++ ? round.runClaudeImpl(opts) : new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      entered();
    })),
  }, { openLook: () => new Promise((res) => { release = () => res({ cwd: repoDir, close: async () => {} }); }) });
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  let done = false;
  try {
    const p = startOrientation(f.seq, {}, d).then(() => settled(f.seq)).then(() => { done = true; });
    for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setImmediate(r));
    mock.timers.tick(100_000);   // the checkout takes 100 s of the look's time
    release();
    await inCall;
    mock.timers.tick(REPO_LOOK_TIMEOUT_MS - 100_000 + 1);
    for (let i = 0; i < 50 && !done; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(done, true, 'the call was cut at the one deadline, not a fresh timeout later');
    await p;
  } finally { mock.timers.reset(); }
  assert.equal(getFeature(f.seq).orientation.skipped, 'failed');
});

test('A8: permissionRules and readGuard are overrides of their own; without them every call is unchanged', () => {
  const o = interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', tools: ['Read'], permissionRules: { deny: ['Read(~/.aws/**)'] }, readGuard: '/c/a.pdf' });
  assert.deepEqual([o.permissionRules, o.readGuard], [{ deny: ['Read(~/.aws/**)'] }, '/c/a.pdf']);
  for (const kind of ['look', 'round']) {
    const plain = interviewCallOptions(kind, { cwd: '/c', prompt: 'P', model: 'm1' });
    assert.equal('permissionRules' in plain, false, kind);
    assert.equal('readGuard' in plain, false, kind);
  }
});

test('A8: readGuard, when given at all, is an absolute path: an empty or relative one never means "no guard"', () => {
  for (const bad of ['', 'a.pdf', 'x/a.pdf', undefined, null, 1]) {
    assert.throws(() => interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', tools: ['Read'], readGuard: bad }), /readGuard/, String(bad));
  }
  assert.equal(interviewCallOptions('look', { cwd: '/c', prompt: 'P', model: 'm1', tools: ['Read'], readGuard: join(tmpdir(), 'a.pdf') }).readGuard, join(tmpdir(), 'a.pdf'));
});

// ── A8: files in the interview (plans/requirements-a8-design.md D2, D5, D6) ─────────────────
const upload = (name, text) => { const data = Buffer.from(text); return { name, kind: 'text', mime: 'text/markdown', data, text, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; };
/** Replies per call: a file read gets its summary, a round the round reply. Like the real runner, a guarded call (a Read-form
 *  read) returns the guard's decisions: none, since the fake stream shows no tool call. */
function fileRunner({ summary = 'Refunds within 14 days.', round = ROUND1 } = {}) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const text = JSON.stringify(opts.systemPrompt === ATTACHMENT_SYSTEM_PROMPT ? { summary } : round);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text }, costUsd: 0.1 });
    return { text, ...(opts.readGuard ? { readGuardDecisions: [] } : {}) };
  };
  return { calls, runClaudeImpl };
}

test('A8 D2: a feature created with files reads them before round 1, and round 1 already uses them', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  const r = fileRunner();
  const f = newFeature();
  addAttachments({ type: 'feature', id: f.seq }, [upload('policy.md', 'Refunds in 14 days.')], {}, deps(r));
  await startOrientation(f.seq, {}, deps(r));
  assert.deepEqual(r.calls.map((c) => c.systemPrompt === ATTACHMENT_SYSTEM_PROMPT ? 'read' : 'round'), ['read', 'round']);
  const prompt = r.calls[1].prompt;
  assert.ok(prompt.includes('<attachments>\npolicy.md (text, 19 B)\nWhat Worca took from it:\nRefunds within 14 days.\nFull text:\nRefunds in 14 days.\n</attachments>'), prompt);
});

test('A8 D2: five creates whose reads end together start round 1 at most MAX_JOBS (4) at a time', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let openReads;
  let openRounds;
  const readGate = new Promise((res) => { openReads = res; });
  const roundGate = new Promise((res) => { openRounds = res; });
  let inflight = 0;
  let most = 0;
  const r = fileRunner();
  const held = { ...r, runClaudeImpl: async (o) => {
    if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT) { await readGate; return r.runClaudeImpl(o); }
    inflight += 1; most = Math.max(most, inflight);
    try { await roundGate; return await r.runClaudeImpl(o); } finally { inflight -= 1; }
  } };
  const five = Array.from({ length: 5 }, (_, i) => {
    const f = newFeature();
    addAttachments({ type: 'feature', id: f.seq }, [upload(`five${i}.md`, `five${i}`)], {}, deps(held));
    startOrientation(f.seq, {}, deps(held, { round1WaitMs: 60_000 }));
    return f;
  });
  await new Promise((res) => setTimeout(res, 30));
  openReads();
  await Promise.all(five.map((f) => readsSettled({ type: 'feature', id: f.seq })));
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual([inflight, most], [MAX_JOBS, MAX_JOBS], 'four rounds run; the fifth waits for a slot');
  openRounds();
  await Promise.all(five.map((f) => settled(f.seq)));
  assert.equal(most, MAX_JOBS);
  assert.equal(r.calls.filter((c) => c.systemPrompt !== ATTACHMENT_SYSTEM_PROMPT).length, 5, 'and then the fifth ran');
});

test('A8 D2: creates waiting for their reads do not count against MAX_JOBS; round 1 runs after ROUND1_WAIT_MS with a file still being read', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let open;
  const gate = new Promise((res) => { open = res; });
  const r = fileRunner();
  const held = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT) await gate; return r.runClaudeImpl(o); } };
  const waiting = Array.from({ length: MAX_JOBS }, (_, i) => {
    const f = newFeature();
    addAttachments({ type: 'feature', id: f.seq }, [upload(`w${i}.md`, `w${i}`)], {}, deps(held));
    startOrientation(f.seq, {}, deps(held, { round1WaitMs: 60_000 }));
    return f;
  });
  await new Promise((res) => setTimeout(res, 30));
  assert.doesNotThrow(() => assertCapacity(), 'creates waiting for reads leave room for other features');
  const late = newFeature();
  addAttachments({ type: 'feature', id: late.seq }, [upload('late.md', 'late')], {}, deps(held));
  await startOrientation(late.seq, {}, deps(held, { round1WaitMs: 50 }));
  const round = r.calls.filter((c) => c.systemPrompt !== ATTACHMENT_SYSTEM_PROMPT).at(-1);
  assert.match(round.prompt, /late\.md \(text, 4 B\): being read; known by name only\./);
  open();
  await Promise.all([...waiting, late].map((f) => settled(f.seq)));
});

test('A8: a round without files reads the budget once (queueUnread makes no budget call)', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let n = 0;
  const f = newFeature();
  await startOrientation(f.seq, {}, deps(fakeRunner([ROUND1]), { budget: () => { n += 1; return { blocked: false }; } }));
  assert.equal(n, 1);
});

test('A8 D5: a file the limit stopped is read again when the next round starts with the budget open', async () => {
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let blocked = true;
  const r = fileRunner({ round: ROUND2 });
  const d = deps(r, { budget: () => ({ blocked }) });
  const f = newFeature();
  const [a] = addAttachments({ type: 'feature', id: f.seq }, [upload('faq.md', 'faq')], {}, d);
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(getAttachment(a.id).status, 'unread-budget');
  blocked = false;
  await finishInterview(f.seq, {}, d);
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(getAttachment(a.id).status, 'done');
});

test('A8 D6: the scope\'s documents ride inside <product_brief>, after its sections', async () => {
  const b = savedBrief();
  const d0 = insertAttachment({ id: mintAttachmentId(), ownerType: 'brief', ownerId: b.id, name: 'glossary.pdf', kind: 'binary', mime: 'application/pdf', bytes: 10, sha256: 'g1' });
  updateAttachment(d0.id, { status: 'done', summary: 'Terms.' });
  try {
    const r = fileRunner({ round: ROUND2 });
    const f = newBriefFeature();
    await startOrientation(f.seq, {}, deps(r));
    const round = r.calls.find((c) => c.systemPrompt !== ATTACHMENT_SYSTEM_PROMPT);
    assert.match(round.prompt, /- Orders \(partly\): checkout and history\.\n\nDocuments:\nglossary\.pdf: Terms\.\n<\/product_brief>/);
  } finally { deleteAttachmentRow(d0.id); }   // the later A7 tests read this brief without documents
});

test('A8 D6: Look closer reads the brief\'s documents inside <product_brief>; without documents its prompt is unchanged', async () => {
  briefOn();
  const b = savedBrief();
  const f = newBriefFeature();
  await startOrientation(f.seq, {}, briefDeps(fakeRunner([ROUND1])).d);
  await settled(f.seq);
  const look = { summary: 'Orders have no note yet.', files: [], area: 'Orders' };
  const r = fakeRunner([look, look]);
  await startOrientation(f.seq, { thenRound: false }, briefDeps(r).d);
  await settled(f.seq);
  const d0 = insertAttachment({ id: mintAttachmentId(), ownerType: 'brief', ownerId: b.id, name: 'glossary.pdf', kind: 'binary', mime: 'application/pdf', bytes: 10, sha256: 'g2' });
  updateAttachment(d0.id, { status: 'done', summary: 'Terms.' });
  try {
    await startOrientation(f.seq, { thenRound: false }, briefDeps(r).d);
    await settled(f.seq);
  } finally { deleteAttachmentRow(d0.id); }
  assert.equal(r.calls.length, 2);
  assert.doesNotMatch(r.calls[0].prompt, /Documents:/);
  assert.equal(r.calls[1].prompt, r.calls[0].prompt.replace('\n</product_brief>', '\n\nDocuments:\nglossary.pdf: Terms.\n</product_brief>'));
});

/** A feature whose interview has finished (looked at, its last round done, status done). */
function doneFeature() {
  const f = newFeature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', rounds: 2, orientation: { summary: '', files: [], skipped: 'off' } });
}
const FOLLOW = { spec: {}, questions: [{ id: 'f1', question: 'What in policy.md matters?', options: ['Rules', 'Examples'], recommended: 'Rules', why: 'w', source: 'policy.md' }], done: false, note: 'n' };

test('A8 D8: a file added after the interview finished gets one follow-up round by itself, once its read has ended', async () => {
  const r = fileRunner({ round: FOLLOW });
  const f = doneFeature();
  const [a] = addAttachments({ type: 'feature', id: f.seq }, [upload('policy.md', 'Refunds in 14 days.')], {}, deps(r));
  await readsSettled({ type: 'feature', id: f.seq });
  await settled(f.seq);
  const turns = listTurns(f.seq);
  assert.deepEqual(turns.find((t) => t.kind === 'followup').payload, { assumptions: [], files: [a.id] });
  const round = turns.filter((t) => t.kind === 'round').at(-1);
  assert.deepEqual([round.payload.followUp, round.payload.followUpFiles], [[], [a.id]]);
  assert.match(r.calls.at(-1).prompt, /these files after the interview finished: “policy\.md”\./);
  assert.deepEqual(round.payload.files, [a.id], 'the follow-up carried the file');
  assert.equal(getFeature(f.seq).status, 'your_turn');
  assert.equal(getFeature(f.seq).rounds, 3, 'outside the cap: it counts as a round, never as the final one');
});

test('A8 D8: when the follow-up cannot start, the file stays unasked, Ready fails, and POST follow-up asks about it', async () => {
  const gate = (() => { let open; const p = new Promise((res) => { open = res; }); return { p, open }; })();
  const r = fileRunner({ round: FOLLOW });
  const looking = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ORIENTATION_SYSTEM_PROMPT) await gate.p; return r.runClaudeImpl(o); } };
  const f = doneFeature();
  let blocked = false;
  const d = deps(looking, { budget: () => ({ blocked }) });
  startOrientation(f.seq, { thenRound: false }, d);      // busy: a look runs
  addAttachments({ type: 'feature', id: f.seq }, [upload('late.md', 'late')], {}, d);
  await readsSettled({ type: 'feature', id: f.seq });
  blocked = true;   // and when the look ends, the spending limit is reached
  gate.open();
  await settled(f.seq);
  assert.equal(isBusy(f.seq), false);
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false, 'busy when the read ended, over the limit when the look ended: not started');
  blocked = false;
  const files = listAttachments('feature', f.seq);
  assert.deepEqual(unaskedFiles(files, listTurns(f.seq)), [files[0].id]);
  assert.equal(readiness(getFeature(f.seq), { turns: listTurns(f.seq), files }).checks.find((c) => c.key === 'interview').hint, 'late.md to ask about');
  await followUp(f.seq, {}, deps(r));
  assert.deepEqual(listTurns(f.seq).find((t) => t.kind === 'followup').payload.files, [files[0].id]);
});

test('A8 D8: during the interview, after a start, and for documents no follow-up starts', async () => {
  const r = fileRunner({ round: FOLLOW });
  const mid = newFeature();
  appendTurn(mid.seq, { kind: 'round', payload: { questions: ROUND1.questions, done: false } });
  updateFeature(mid.seq, { status: 'your_turn', rounds: 1 });
  addAttachments({ type: 'feature', id: mid.seq }, [upload('mid.md', 'mid')], {}, deps(r));
  await readsSettled({ type: 'feature', id: mid.seq });
  assert.equal(listTurns(mid.seq).some((t) => t.kind === 'followup'), false);
  const started = doneFeature();
  appendTurn(started.seq, { kind: 'start', payload: { version: 1, runId: 'r-a8' } });
  addAttachments({ type: 'feature', id: started.seq }, [upload('after.md', 'after')], {}, deps(r));
  await readsSettled({ type: 'feature', id: started.seq });
  assert.equal(maybeFollowUpFiles(started.seq, deps(r)), false);
  assert.equal(listTurns(started.seq).some((t) => t.kind === 'followup'), false);
  assert.throws(() => followUp(started.seq, {}, deps(r)), /nothing is waiting for a follow-up/);
});

test('A8 D8: a file still being read when a round runs is not asked by it; it gets its follow-up once its read ends', async () => {
  let open;
  const gate = new Promise((res) => { open = res; });
  const r = fileRunner({ round: ROUND2 });
  const held = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT) await gate; return r.runClaudeImpl(o); } };
  const f = newFeature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: ROUND1.questions, done: false } });
  updateFeature(f.seq, { status: 'your_turn', rounds: 1, orientation: { summary: '', files: [], skipped: 'off' } });
  const data = Buffer.from('%PDF-1.7\nscan\n');
  const [a] = addAttachments({ type: 'feature', id: f.seq },
    [{ name: 'scan.pdf', kind: 'binary', mime: 'application/pdf', data, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }], {}, deps(held));
  await finishInterview(f.seq, {}, deps(held));   // the final round runs while scan.pdf is still being read
  const last = listTurns(f.seq).filter((t) => t.kind === 'round').at(-1);
  assert.equal((last.payload.files || []).includes(a.id), false);
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), [a.id]);
  open();
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(getAttachment(a.id).status, 'done');
  await settled(f.seq);
  assert.deepEqual(listTurns(f.seq).find((t) => t.kind === 'followup').payload.files, [a.id]);
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), []);
});

test('A8: a file turn after an error never hides it from Try again; a failed files follow-up retries with its files', async () => {
  const f = doneFeature();
  updateFeature(f.seq, { status: 'your_turn' });   // mid-interview while it is read: no automatic follow-up starts
  const [a] = addAttachments({ type: 'feature', id: f.seq }, [upload('again.md', 'again')], {}, deps(fileRunner(), { mockEnabled: () => true }));
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false);
  updateFeature(f.seq, { status: 'done' });
  appendTurn(f.seq, { kind: 'followup', payload: { assumptions: [], files: [a.id] } });
  appendTurn(f.seq, { kind: 'error', payload: { code: 'FAILED', message: 'x', job: 'round' } });
  appendTurn(f.seq, { kind: 'file', payload: { action: 'edited', id: a.id, name: 'again.md' } });
  const r = fileRunner({ round: FOLLOW });
  await retry(f.seq, {}, deps(r));
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'round').at(-1).payload.followUpFiles, [a.id]);
});

const FOLLOW_DONE = { spec: {}, questions: [], done: true, note: 'Nothing more about the files.' };
/** Resolves once `ok()` holds (checked every few milliseconds, at most 2 seconds). */
async function until(ok) {
  for (let i = 0; i < 400 && !ok(); i += 1) await new Promise((res) => setTimeout(res, 5));
  assert.ok(ok(), 'the condition never held');
}

test('A8 D8: no follow-up while another file is still being read; then one for both, and it never starts another', async () => {
  let open;
  const gate = new Promise((res) => { open = res; });
  const r = fileRunner({ round: FOLLOW_DONE });
  const held = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT && o.prompt.includes('Name: slow.md')) await gate; return r.runClaudeImpl(o); } };
  const f = doneFeature();
  const [a, b] = addAttachments({ type: 'feature', id: f.seq }, [upload('quick.md', 'quick'), upload('slow.md', 'slow')], {}, deps(held));
  await until(() => getAttachment(a.id).status === 'done');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false, 'slow.md is still being read');
  assert.equal(isBusy(f.seq), false);
  open();
  await readsSettled({ type: 'feature', id: f.seq });
  await settled(f.seq);
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'followup').map((t) => t.payload.files), [[a.id, b.id]]);
  const rounds = listTurns(f.seq).filter((t) => t.kind === 'round');
  assert.deepEqual([rounds.length, rounds.at(-1).payload.final, rounds.at(-1).payload.files], [2, false, [a.id, b.id]]);
  assert.deepEqual([getFeature(f.seq).status, getFeature(f.seq).rounds], ['done', 3]);
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), []);
  assert.equal(maybeFollowUpFiles(f.seq, deps(r)), false, 'asked: nothing is left for another follow-up');
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'followup').length, 1);
});

test('A8 D8: the budget and an archive keep Worca\'s follow-up from starting; a failed or unstored file never waits for one; a removal that leaves nothing to read starts it', async () => {
  const r = fileRunner({ round: FOLLOW });
  const f = doneFeature();
  const kept = insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'kept.md', kind: 'text', mime: 'text/markdown', bytes: 4, sha256: 'k1' });
  updateAttachment(kept.id, { status: 'done', summary: 'Kept.' });
  appendTurn(f.seq, { kind: 'file', payload: { action: 'added', id: kept.id, name: 'kept.md' } });
  const lost = insertAttachment({ id: mintAttachmentId(), ownerType: 'feature', ownerId: f.seq, name: 'lost.md', kind: 'text', mime: 'text/markdown', bytes: 4, sha256: 'l1' });
  updateAttachment(lost.id, { status: 'failed', error: { code: 'STORE_FAILED', message: 'x', at: 't' } });
  appendTurn(f.seq, { kind: 'file', payload: { action: 'added', id: lost.id, name: 'lost.md' } });
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), [kept.id], 'a file that failed or was not stored is listed by name only');
  assert.equal(maybeFollowUpFiles(f.seq, deps(r, { budget: () => ({ blocked: true }) })), false);
  assert.equal(maybeFollowUpFiles(f.seq, deps(r, { budget: () => { throw new Error('no budget'); } })), false, 'never throws');
  updateFeature(f.seq, { status: 'archived' });
  assert.equal(maybeFollowUpFiles(f.seq, deps(r)), false);
  updateFeature(f.seq, { status: 'done' });
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false);
  removeAttachment({ type: 'feature', id: f.seq }, lost.id, {}, deps(r));   // nothing is left to read: the follow-up starts
  await settled(f.seq);
  assert.deepEqual(listTurns(f.seq).find((t) => t.kind === 'followup').payload, { assumptions: [], files: [kept.id] });
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'round').at(-1).payload.files, [kept.id]);
});

test('A8 D8: a brief document starts no follow-up round for the scope\'s finished features', async () => {
  const b = savedBrief();
  const r = fileRunner({ round: FOLLOW });
  const f = newBriefFeature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  updateFeature(f.seq, { status: 'done', rounds: 2, orientation: { summary: '', files: [], skipped: 'brief' } });
  const owner = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: BSCOPE };
  const [doc] = addAttachments(owner, [upload('terms.md', 'Terms')], {}, deps(r));
  try {
    await readsSettled(owner);
    assert.equal(getAttachment(doc.id).status, 'done');
    assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup' || t.kind === 'file'), false);
    assert.equal(maybeFollowUpFiles(f.seq, deps(r)), false);
    assert.equal(readiness(getFeature(f.seq), { turns: listTurns(f.seq), files: listAttachments('feature', f.seq) }).checks.find((c) => c.key === 'interview').ok, true);
  } finally { deleteAttachmentRow(doc.id); }   // the later tests read this brief without documents
});

// ── A8 D8 review fixes: a start on its way, carried files only, a job's end ─────────────────
test('A8 D8: no follow-up round while a start is on its way: a read ending inside it starts nothing, and followUp waits', async () => {
  let openRead;
  let openStart;
  const readGate = new Promise((res) => { openRead = res; });
  const startGate = new Promise((res) => { openStart = res; });
  const r = fileRunner({ round: FOLLOW });
  const held = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT) await readGate; return r.runClaudeImpl(o); } };
  const f = doneFeature();
  const [a] = addAttachments({ type: 'feature', id: f.seq }, [upload('during.md', 'during')], {}, deps(held));
  const started = startFeature(f.seq, { reason: 'the file is still being read' }, { by: 'po' }, {
    startRun: async (_b, opts) => { await startGate; return { status: 200, body: { runId: opts.runId } }; },
    target: { ok: true, path: repoDir, name: 'shop' } });
  assert.equal(isStarting(f.seq), true);
  openRead();
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(getAttachment(a.id).status, 'done');
  assert.equal(isBusy(f.seq), false, 'the read ended inside the start: no follow-up started');
  assert.equal(maybeFollowUpFiles(f.seq, deps(r)), false);
  assert.throws(() => followUp(f.seq, {}, deps(r)), (e) => e.code === 'BUSY' && e.message === 'this feature is starting a run. Try again in a moment.');
  openStart();
  await started;
  assert.equal(isStarting(f.seq), false);
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false);
  assert.equal(r.calls.filter((c) => c.systemPrompt !== ATTACHMENT_SYSTEM_PROMPT).length, 0, 'no model call but the read');
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), [], 'after the start it is a change since the start');
  assert.equal(maybeFollowUpFiles(f.seq, deps(r)), false);
});

test('A8 D8: a follow-up the product owner asks for carries only the files whose text its prompt has; one still being read waits for its own', async () => {
  let open;
  const gate = new Promise((res) => { open = res; });
  const r = fileRunner({ round: FOLLOW_DONE });
  const held = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ATTACHMENT_SYSTEM_PROMPT) await gate; return r.runClaudeImpl(o); } };
  const f = doneFeature();
  const data = Buffer.from('%PDF-1.7\nlater scan\n');
  const [a] = addAttachments({ type: 'feature', id: f.seq },
    [{ name: 'later.pdf', kind: 'binary', mime: 'application/pdf', data, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }], {}, deps(held));
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), [a.id]);
  assert.throws(() => followUp(f.seq, {}, deps(r)), (e) => e.code === 'CONFLICT' && e.message === 'Worca is reading this file.', 'only a file known by name: nothing to ask yet');
  updateFeature(f.seq, { spec: { ...getFeature(f.seq).spec, assumptions: [{ id: 'A-1', text: 'Full refund', status: 'open' }] } });
  setAssumption(f.seq, 'A-1', 'rejected');
  await followUp(f.seq, {}, deps(r));
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'followup').map((t) => t.payload), [{ assumptions: ['A-1'] }]);
  const round = listTurns(f.seq).filter((t) => t.kind === 'round').at(-1);
  assert.deepEqual([round.payload.followUp, 'followUpFiles' in round.payload, 'files' in round.payload], [['A-1'], false, false]);
  const prompt = r.calls.filter((c) => c.systemPrompt !== ATTACHMENT_SYSTEM_PROMPT).at(-1).prompt;
  assert.doesNotMatch(prompt, /these files after the interview finished/);
  assert.match(prompt, /later\.pdf \(PDF, [^)]*\): being read; known by name only\./);
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), [a.id], 'still unasked');
  open();
  await readsSettled({ type: 'feature', id: f.seq });
  await settled(f.seq);
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'followup').map((t) => t.payload.files || null), [null, [a.id]]);
  assert.deepEqual(unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq)), []);
});

test('A8 D8: a read that ends while a look runs gets its follow-up once the look ends; no second one follows', async () => {
  let open;
  const gate = new Promise((res) => { open = res; });
  const r = fileRunner({ round: FOLLOW_DONE });
  const looking = { ...r, runClaudeImpl: async (o) => { if (o.systemPrompt === ORIENTATION_SYSTEM_PROMPT) await gate; return r.runClaudeImpl(o); } };
  const f = doneFeature();
  startOrientation(f.seq, { thenRound: false }, deps(looking));      // busy: a look runs
  const [a] = addAttachments({ type: 'feature', id: f.seq }, [upload('meanwhile.md', 'meanwhile')], {}, deps(looking));
  await readsSettled({ type: 'feature', id: f.seq });
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'followup'), false, 'busy when the read ended');
  open();
  await settled(f.seq);   // the look
  await settled(f.seq);   // the follow-up its end started
  assert.equal(isBusy(f.seq), false, 'and nothing after it');
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'followup').map((t) => t.payload.files), [[a.id]]);
  assert.deepEqual(listTurns(f.seq).filter((t) => t.kind === 'round').at(-1).payload.files, [a.id]);
  assert.equal(r.calls.filter((c) => c.systemPrompt === ROUND_SYSTEM_PROMPT).length, 1, 'one round');
  assert.deepEqual([getFeature(f.seq).status, unaskedFiles(listAttachments('feature', f.seq), listTurns(f.seq))], ['done', []]);
});
