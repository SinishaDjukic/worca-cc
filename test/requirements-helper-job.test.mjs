// test/requirements-helper-job.test.mjs — one Feature chat call per message, with a fake runner; never a real claude
// (plans/requirements-a3-design.md D3, D11–D13, D15, D19, D20).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, getFeature, updateFeature, appendTurn, listTurns, setContext, insertHelperMessage, listHelperMessages, recentHelperCosts,
} from '../src/core/requirements/store.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { roundPromptParts, ROUND_SYSTEM_PROMPT } from '../src/core/requirements/round.mjs';
import { startOrientation, submitAnswers, settled, isBusy, MAX_JOBS, assertCapacity } from '../src/core/requirements/interview.mjs';
import { setSection } from '../src/core/requirements/edits.mjs';
import { markStarting, unmarkStarting } from '../src/core/requirements/starting.mjs';
import {
  HELPER_SYSTEM_PROMPT, HELPER_TIMEOUT_MS, sendMessage, retryMessage, stopHelper, isAnswering, helperSettled, helperEstimate,
} from '../src/core/requirements/helper.mjs';
import { prepare } from '../src/core/db.mjs';

useTempHome(after, 'worca-req-helper-job-');
beforeEach(() => {
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_MOCK_HELPER_MS;
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
});

const QS = [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'w' },
  { id: 'when', question: 'Until when?', options: ['Until it ships', 'Until it is delivered'], recommended: 'Until it ships', why: 'w2' }];
const REPLY = { text: 'Cancelling until pick-up covers most tickets.', drafts: [{ question: 'who', option: 'Support', text: null, why: 'Tickets say so.' }],
  proposals: [{ target: 'criterion', change: 'reword', id: 'R-po-3', value: 'The dialog names the order number.', reason: '“clear” cannot be tested.' }] };
const DONE_ROUND = { spec: {}, criteria: [], questions: [], done: true, note: 'Done.' };

/** A feature waiting for the answers to round 1 (two questions). */
function pendingFeature() {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'Before it ships' });
  const turnId = appendTurn(f.seq, { kind: 'round', payload: { questions: QS, note: '', done: false } });
  updateFeature(f.seq, { status: 'your_turn', rounds: 1, criteriaSeq: 3, assumptionSeq: 2, spec: { ...emptySpec(), goal: { text: 'Cancel', measure: '' },
    criteria: [{ id: 'R-po-3', text: 'The dialog is clear' }], assumptions: [{ id: 'A-2', text: 'Stock frees at once', status: 'open' }] } });
  return { f: getFeature(f.seq), turnId };
}
/** Answers the queued replies in order and books `cost` per call. */
function fakeRunner(replies, cost = 0.1) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: cost, result: text }, costUsd: cost });
    return { text };
  };
  return { calls, runClaudeImpl };
}
/** Holds every call until open() (then answers `reply`) or until its signal aborts (then throws, as a killed CLI does); `spent`
 *  is reported as a result event when the call starts. */
function heldRunner(reply = REPLY, { spent = 0 } = {}) {
  const calls = [];
  let open;
  const gate = new Promise((r) => { open = r; });
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    if (spent) opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: spent, result: '' }, costUsd: spent });
    const stopped = new Promise((_, rej) => { opts.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true }); });
    await Promise.race([gate, stopped]);
    return { text: JSON.stringify(reply) };
  };
  return { calls, runClaudeImpl, open: () => open() };
}
const deps = (runner, extra = {}) => ({
  runClaudeImpl: runner.runClaudeImpl,
  listModels: async () => [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5-5[1m]' }, { id: 'claude-opus-5-5' }],
  listProjects: async () => [], workspaceTarget: async () => null, openLook: async () => null, openWorkspaceLook: async () => null,
  onChange: () => {}, interviewSlot: () => ({}), userSignIn: () => false, budget: () => ({ blocked: false }), ...extra,
});
const until = async (pred) => { for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5)); assert.ok(pred(), 'timed out'); };
const last = (seq) => listHelperMessages(seq).at(-1);

test('D13: no estimate before any helper call was booked', () => {
  assert.equal(helperEstimate(), null);
});

test('D3: one message is one round-kind call: the helper prompt, no tools, no session, the scratch folder, the interview model and effort', async () => {
  const { f, turnId } = pendingFeature();
  const r = fakeRunner([REPLY]);
  const changes = [];
  await sendMessage(f.seq, { text: 'Who may cancel?', focus: { roundTurnId: turnId, questionId: 'who', n: 9 } }, { by: 'po' }, deps(r, { onChange: (s) => changes.push(s) }));
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.systemPrompt, HELPER_SYSTEM_PROMPT);
  assert.notEqual(c.systemPrompt, ROUND_SYSTEM_PROMPT);
  assert.equal(c.systemPromptMode, 'replace');
  assert.deepEqual([c.tools, c.allowedTools], [[], []]);
  assert.equal(c.noSessionPersistence, true);
  assert.equal(c.maxTurns, undefined);
  assert.equal(c.model, 'claude-opus-5-5');
  assert.equal(c.effort, 'medium');
  assert.equal(c.disableSlashCommands, true);
  assert.deepEqual(c.settingSources, ['project']);
  assert.ok(c.cwd.endsWith(join('tmp', 'requirements')), c.cwd);
  assert.ok(c.signal instanceof AbortSignal);
  assert.equal(HELPER_TIMEOUT_MS, 180_000);
  assert.ok(c.prompt.startsWith(`${roundPromptParts({ feature: getFeature(f.seq), context: '', turns: listTurns(f.seq) }).stable}\n\n<thread>\n`));
  assert.match(c.prompt, /<question_in_focus>\n\[who\] Who may cancel\?/);
  assert.match(c.prompt, /<message>\nWho may cancel\?\n<\/message>/);
  const [po, w] = listHelperMessages(f.seq);
  assert.deepEqual([po.role, po.text, po.focus, po.createdBy], ['po', 'Who may cancel?', { roundTurnId: turnId, questionId: 'who', n: 1 }, 'po']);
  assert.deepEqual([w.role, w.text, w.roundTurnId, w.costUsd, w.model, w.error], ['worca', REPLY.text, turnId, 0.1, 'claude-opus-5-5', null]);
  assert.deepEqual(w.drafts, [{ question: 'who', n: 1, option: 'Support', why: 'Tickets say so.' }]);
  assert.deepEqual(w.proposals, [{ n: 1, target: 'criterion', change: 'reword', id: 'R-po-3', value: 'The dialog names the order number.',
    before: 'The dialog is clear', reason: '“clear” cannot be tested.', state: 'proposed' }]);
  assert.ok(changes.filter((s) => s === f.seq).length >= 2, 'a frame when the call starts and when it ends');
  assert.equal(isAnswering(f.seq), false);
});

test('a focus that names no pending question is dropped; the message is still sent', async () => {
  const { f } = pendingFeature();
  await sendMessage(f.seq, { text: 'Hi', focus: { roundTurnId: 999, questionId: 'who' } }, {}, deps(fakeRunner([REPLY])));
  assert.equal(listHelperMessages(f.seq)[0].focus, null);
});

test('D13: every attempt is booked on the feature and in the ledger with helper_message_id and no turn; the chat writes no turn (D15)', async () => {
  const { f } = pendingFeature();
  const r = fakeRunner(['not json', REPLY]);
  const cost0 = getFeature(f.seq).costUsd;
  await sendMessage(f.seq, { text: 'Hi' }, {}, deps(r));
  assert.equal(r.calls.length, 2, 'an unreadable reply is asked once more');
  const w = last(f.seq);
  assert.equal(w.costUsd, 0.2);
  assert.equal(Math.round((getFeature(f.seq).costUsd - cost0) * 100) / 100, 0.2);
  const row = prepare('SELECT feature_seq, turn_id, helper_message_id, amount_usd FROM req_cost_ledger ORDER BY id DESC LIMIT 1').get();
  assert.deepEqual([Number(row.feature_seq), row.turn_id, Number(row.helper_message_id), row.amount_usd], [f.seq, null, w.id, 0.2]);
  assert.equal(recentHelperCosts(1)[0], 0.2);
  assert.deepEqual(listTurns(f.seq).map((t) => t.kind), ['round']);
  const c = recentHelperCosts(10);
  assert.deepEqual(helperEstimate(), { low: Math.min(...c), high: Math.max(...c) });
});

test('D5: two unreadable replies give BAD_REPLY with product copy; a runner failure gives FAILED and never its raw message', async () => {
  const { f } = pendingFeature();
  await sendMessage(f.seq, { text: 'Hi' }, {}, deps(fakeRunner(['nope', '{"text":""}'])));
  assert.deepEqual([last(f.seq).error, last(f.seq).text, last(f.seq).costUsd], [{ code: 'BAD_REPLY', message: 'Worca could not answer. Try again.' }, '', 0.2]);
  await sendMessage(f.seq, { text: 'Again' }, {}, deps(fakeRunner([new Error('spawn failed at /home/someone/secret')])));
  assert.deepEqual(last(f.seq).error, { code: 'FAILED', message: 'Worca could not answer. Try again.' });
  assert.doesNotMatch(JSON.stringify(listHelperMessages(f.seq)), /secret/);
});

test('D13: a spent budget refuses the send (409 BUDGET, code in the data) and writes nothing; it also stops a second attempt', async () => {
  const { f } = pendingFeature();
  const r = fakeRunner([REPLY]);
  assert.throws(() => sendMessage(f.seq, { text: 'Hi' }, {}, deps(r, { budget: () => ({ blocked: true, totalLimitUsd: 5 }) })),
    (e) => e.code === 'BUDGET' && e.data && e.data.code === 'BUDGET' && /spending limit of \$5/.test(e.message));
  assert.equal(r.calls.length, 0);
  assert.deepEqual(listHelperMessages(f.seq), []);
  let n = 0;
  const budget = () => ({ blocked: (n += 1) > 2 });   // the send (1), the first attempt (2), the second attempt (3: spent)
  await sendMessage(f.seq, { text: 'Hi' }, {}, deps(fakeRunner(['nope']), { budget }));
  assert.equal(last(f.seq).error.code, 'BUDGET');
  assert.equal(last(f.seq).costUsd, 0.1, 'the first attempt is booked');
});

test('D12: Stop aborts the call; the message stays; Worca\'s row is STOPPED with what the runner reported', async () => {
  const { f } = pendingFeature();
  const r = heldRunner(REPLY, { spent: 0.03 });
  const p = sendMessage(f.seq, { text: 'Hi' }, {}, deps(r));
  await until(() => r.calls.length === 1);
  assert.equal(isAnswering(f.seq), true);
  await stopHelper(f.seq);
  await p;
  assert.deepEqual(last(f.seq).error, { code: 'STOPPED', message: 'You stopped this reply.' });
  assert.equal(last(f.seq).costUsd, 0.03);
  assert.deepEqual(listHelperMessages(f.seq).map((m) => m.role), ['po', 'worca']);
  assert.equal(isAnswering(f.seq), false);
  assert.throws(() => stopHelper(f.seq), (e) => e.code === 'CONFLICT' && e.message === 'Worca is not answering.');
});

test('D20: Try again re-asks the newest message without a reply or with an error reply; its own message is not in its history', async () => {
  const { f } = pendingFeature();
  const r = fakeRunner(['nope', 'nope', REPLY]);
  await sendMessage(f.seq, { text: 'Hi' }, {}, deps(r));
  await retryMessage(f.seq, {}, deps(r));
  assert.deepEqual(listHelperMessages(f.seq).map((m) => [m.role, m.error && m.error.code]), [['po', null], ['worca', 'BAD_REPLY'], ['worca', null]]);
  assert.match(r.calls[2].prompt, /<chat>\n\(nothing yet: this is the first message\)\n<\/chat>/);
  assert.throws(() => retryMessage(f.seq, {}, deps(r)), (e) => e.code === 'CONFLICT' && e.message === 'There is nothing to try again.');
  const g = pendingFeature().f;
  insertHelperMessage({ featureSeq: g.seq, role: 'po', text: 'Left behind by a restart' });
  const r2 = fakeRunner([REPLY]);
  await retryMessage(g.seq, {}, deps(r2));
  assert.match(r2.calls[0].prompt, /<message>\nLeft behind by a restart\n<\/message>/);
  assert.deepEqual(listHelperMessages(g.seq).map((m) => m.role), ['po', 'worca']);
});

test('D19: mock mode never spawns and costs nothing; the reply drafts and proposes; WORCA_MOCK_HELPER_MS lets Stop catch it', async () => {
  process.env.WORCA_MOCK = '1';
  const { f } = pendingFeature();
  const none = { runClaudeImpl: async () => { throw new Error('no spawn in mock mode'); } };
  await sendMessage(f.seq, { text: 'Hi' }, {}, deps(none, { budget: () => ({ blocked: true }) }));
  const w = last(f.seq);
  assert.equal(w.text, "[mock] Worca's answer to: Hi");
  assert.deepEqual(w.drafts, [{ question: 'who', n: 1, option: 'Support', why: "[mock] Worca's reason for this draft." }]);
  assert.deepEqual(w.proposals.map((p) => [p.target, p.change, p.value]), [['criterion', 'add', '[mock] A criterion Worca suggests.']]);
  assert.equal(w.costUsd, null);
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE helper_message_id = ?').get(w.id).n, 0);
  process.env.WORCA_MOCK_HELPER_MS = '5000';
  const p = sendMessage(f.seq, { text: 'Slow' }, {}, deps(none));
  assert.equal(isAnswering(f.seq), true);
  await stopHelper(f.seq);
  await p;
  assert.equal(last(f.seq).error.code, 'STOPPED');
});

test('D11: Send is refused while answering, while starting, on an archived feature; Try again too', async () => {
  const { f } = pendingFeature();
  const r = heldRunner();
  const p = sendMessage(f.seq, { text: 'Hi' }, {}, deps(r));
  assert.throws(() => sendMessage(f.seq, { text: 'Again' }, {}, deps(r)), (e) => e.code === 'BUSY' && e.message === 'Worca is still answering. Try again in a moment.');
  assert.throws(() => retryMessage(f.seq, {}, deps(r)), (e) => e.code === 'BUSY');
  r.open();
  await p;
  await helperSettled(f.seq);
  markStarting(f.seq);
  try {
    assert.throws(() => sendMessage(f.seq, { text: 'Hi' }, {}, deps(r)), (e) => e.code === 'BUSY' && e.message === 'this feature is starting a run. Try again in a moment.');
  } finally { unmarkStarting(f.seq); }
  updateFeature(f.seq, { status: 'archived' });
  assert.throws(() => sendMessage(f.seq, { text: 'Hi' }, {}, deps(r)), (e) => e.code === 'CONFLICT' && e.message === 'this feature is archived; restore it first');
  assert.throws(() => retryMessage(f.seq, {}, deps(r)), (e) => e.code === 'CONFLICT');
});

test('D11: Send is refused while a round or look runs on the feature', async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Busy', description: 'A round runs' });
  const round = heldRunner(DONE_ROUND);
  const job = startOrientation(f.seq, {}, deps(round));
  await until(() => round.calls.length === 1);
  assert.throws(() => sendMessage(f.seq, { text: 'Hi' }, {}, deps(fakeRunner([REPLY]))),
    (e) => e.code === 'BUSY' && e.message === 'Worca is still working on this feature. Try again in a moment.');
  round.open();
  await job;
});

test('D11/D15: while the helper answers the feature is not busy: an edit, Submit and a round work, and the round never sees the chat', async () => {
  const { f, turnId } = pendingFeature();
  const h = heldRunner();
  const round = fakeRunner([DONE_ROUND]);
  const p = sendMessage(f.seq, { text: 'ZEBRA-QUESTION' }, {}, deps(h));
  await until(() => h.calls.length === 1);
  assert.equal(isBusy(f.seq), false);
  setSection(f.seq, 'actors', ['Customer'], { by: 'po' });
  await submitAnswers(f.seq, { roundTurnId: turnId, useRecommended: true }, {}, deps(round));
  await settled(f.seq);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.doesNotMatch(round.calls[0].prompt, /ZEBRA-QUESTION|<chat>/);
  h.open();
  await p;
});

test('D11: a helper call holds one of MAX_JOBS slots; a send past them is BUSY and writes nothing; the release frees it', async () => {
  const runners = [];
  const calls = [];
  for (let i = 0; i < MAX_JOBS; i += 1) {
    const { f } = pendingFeature();
    const h = heldRunner();
    runners.push(h);
    calls.push(sendMessage(f.seq, { text: 'Hi' }, {}, deps(h)));
  }
  assert.throws(() => assertCapacity(), (e) => e.code === 'BUSY' && e.message === 'Worca is working on several features; try again in a moment.');
  const { f: fifth } = pendingFeature();
  assert.throws(() => sendMessage(fifth.seq, { text: 'Hi' }, {}, deps(fakeRunner([REPLY]))), (e) => e.code === 'BUSY');
  assert.deepEqual(listHelperMessages(fifth.seq), []);
  runners[0].open();
  await calls[0];
  assert.doesNotThrow(() => assertCapacity());
  for (const h of runners) h.open();
  await Promise.all(calls);
});
