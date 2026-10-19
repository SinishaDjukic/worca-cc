// test/requirements-interview.test.mjs — orientation + rounds with a fake runner; never a real claude (design §4, D7-D9, D13).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature, setContext } from '../src/core/requirements/store.mjs';
import { REPO_LOOK_TOOLS } from '../src/core/auto/classify.mjs';
import {
  startOrientation, submitAnswers, finishInterview, retry, settled, isBusy, recoverInterrupted, requirementsModel,
} from '../src/core/requirements/interview.mjs';
import { requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';

useTempHome(after);
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });

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
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
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
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
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
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
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
