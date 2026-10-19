// test/requirements-interview.test.mjs — orientation + rounds with a fake runner; never a real claude (design §4, D7-D9, D13).
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature, setContext } from '../src/core/requirements/store.mjs';
import { REPO_LOOK_TOOLS, REPO_LOOK_TIMEOUT_MS } from '../src/core/auto/classify.mjs';
import {
  startOrientation, submitAnswers, finishInterview, retry, settled, isBusy, recoverInterrupted, requirementsModel,
} from '../src/core/requirements/interview.mjs';
import { requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';

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

test('a failed job rests at done when the latest round said done', async () => {
  off();
  const f = newFeature();
  await startOrientation(f.seq, {}, deps(fakeRunner([ROUND2])));
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  const orig = console.error;
  console.error = () => {};
  try {
    let n = 0;
    const bad = deps(fakeRunner([]), { onChange: () => { if (++n === 1) throw new Error('hook'); } });
    await startOrientation(f.seq, { thenRound: false }, bad);
  } finally { console.error = orig; }
  assert.equal(getFeature(f.seq).status, 'done');
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
