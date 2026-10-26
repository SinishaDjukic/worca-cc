// test/requirements-helper-proposals.test.mjs — Accept, Reject, Ask again and Clear chat (plans/requirements-a3-design.md D7–D11, D14–D16).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, getFeature, updateFeature, listTurns, setContext, createStart, listStarts, insertHelperMessage, getHelperMessage,
  listHelperMessages, recentHelperCosts,
} from '../src/core/requirements/store.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { applyRound, removedCriteria } from '../src/core/requirements/round.mjs';
import { changedSince, unaskedRejections } from '../src/core/requirements/ready.mjs';
import { setSection, addCriterion, editCriterion, revertToStart } from '../src/core/requirements/edits.mjs';
import { finishInterview } from '../src/core/requirements/interview.mjs';
import { recordRequirementsCostDelta } from '../src/core/cost-budget.mjs';
import {
  normalizeHelperReply, isStale, acceptProposal, rejectProposal, askAgain, clearChat, sendMessage,
} from '../src/core/requirements/helper.mjs';

useTempHome(after, 'worca-req-helper-prop-');
beforeEach(() => {
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; delete process.env.WORCA_MOCK_HELPER_MS;
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
});

const R = 'a reason';
const SPEC = () => ({ ...emptySpec(), goal: { text: 'Customers cancel before it ships', measure: '' }, rules: ['Refund to the card'],
  criteria: [{ id: 'R-po-3', text: 'The confirm dialog is clear' }],
  assumptions: [{ id: 'A-1', text: 'Refunds are full', status: 'open' }, { id: 'A-2', text: 'A cancelled order frees its stock at once', status: 'open' }] });
/** A feature whose interview is done (no pending round), criteria counter at 5. */
function feature() {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'Before it ships' });
  return updateFeature(f.seq, { status: 'done', rounds: 2, criteriaSeq: 5, assumptionSeq: 2, spec: SPEC() });
}
/** A Worca row holding the proposals `raw` gives against the feature's spec now: what a call would have stored. */
function propose(f, raw) {
  const { proposals } = normalizeHelperReply({ text: 'I suggest this.', proposals: raw },
    { spec: getFeature(f.seq).spec, pending: null, removed: removedCriteria(listTurns(f.seq)) });
  assert.equal(proposals.length, raw.length, 'every proposal of the fixture is valid');
  return insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: 'I suggest this.', proposals });
}
function fakeRunner(replies) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const text = JSON.stringify(replies.shift());
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.01, result: text }, costUsd: 0.01 });
    return { text };
  };
  return { calls, runClaudeImpl };
}
function heldRunner(reply) {
  const calls = [];
  let open;
  const gate = new Promise((r) => { open = r; });
  const runClaudeImpl = async (opts) => { calls.push(opts); await gate; return { text: JSON.stringify(reply) }; };
  return { calls, runClaudeImpl, open: () => open() };
}
const deps = (runner, extra = {}) => ({
  runClaudeImpl: runner.runClaudeImpl, listModels: async () => [{ id: 'claude-opus-5-5' }], onChange: () => {}, interviewSlot: () => ({}),
  userSignIn: () => false, budget: () => ({ blocked: false }), ...extra,
});
const until = async (pred) => { for (let i = 0; i < 200 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5)); assert.ok(pred(), 'timed out'); };
const STALE = (e) => e.code === 'CONFLICT' && e.message === 'The spec changed since Worca proposed this.';

test('D10: accepting a section is the product owner\'s edit: the edited mark, the edit turn; a later round never overwrites it', () => {
  const f = feature();
  const m = propose(f, [{ target: 'goal', change: 'set', value: { text: 'Customers cancel from their order history', measure: 'fewer calls' }, reason: R }]);
  const out = acceptProposal(f.seq, m.id, 1, { by: 'po' });
  const g = getFeature(f.seq);
  assert.deepEqual(g.spec.goal, { text: 'Customers cancel from their order history', measure: 'fewer calls' });
  assert.equal(g.spec.edited.goal, true);
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { section: 'goal' });
  assert.deepEqual([out.proposals[0].state, out.proposals[0].decidedBy, !!out.proposals[0].decidedAt], ['accepted', 'po', true]);
  const later = applyRound(g.spec, { spec: { goal: { text: 'Something else', measure: '' } } }, { criteriaSeq: 5, assumptionSeq: 2 });
  assert.equal(later.spec.goal.text, 'Customers cancel from their order history');
});

test('D8/D10: a list section takes its whole new list', () => {
  const f = feature();
  const m = propose(f, [{ target: 'rules', change: 'set', value: ['Refund to the card', 'A refund goes back the way the order was paid'], reason: R }]);
  acceptProposal(f.seq, m.id, 1, { by: 'po' });
  assert.deepEqual(getFeature(f.seq).spec.rules, ['Refund to the card', 'A refund goes back the way the order was paid']);
  assert.equal(getFeature(f.seq).spec.edited.rules, true);
});

test('D10: an added criterion gets the next R-po id, its edit turn, and the card records the id it got', () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'A partly shipped order cancels only what is left', reason: R }]);
  const out = acceptProposal(f.seq, m.id, 1, { by: 'po' });
  const c = getFeature(f.seq).spec.criteria.at(-1);
  assert.deepEqual(c, { id: 'R-po-6', text: 'A partly shipped order cancels only what is left', edited: true });
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { criterion: 'R-po-6', action: 'added' });
  assert.equal(out.proposals[0].appliedId, 'R-po-6');
});

test('D10: reword and remove a criterion as a hand edit; a removed criterion is never proposed again', () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'reword', id: 'R-po-3', value: 'The dialog names the order number and its total.', reason: R }]);
  acceptProposal(f.seq, m.id, 1, { by: 'po' });
  assert.deepEqual(getFeature(f.seq).spec.criteria[0], { id: 'R-po-3', text: 'The dialog names the order number and its total.', edited: true });
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { criterion: 'R-po-3', action: 'edited' });
  const m2 = propose(f, [{ target: 'criterion', change: 'remove', id: 'R-po-3', value: null, reason: R }]);
  acceptProposal(f.seq, m2.id, 1, { by: 'po' });
  assert.equal(getFeature(f.seq).spec.criteria.length, 0);
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { criterion: 'R-po-3', action: 'removed', text: 'The dialog names the order number and its total.' });
  const again = normalizeHelperReply({ text: 't', proposals: [{ target: 'criterion', change: 'add', value: 'the dialog names the order number and its TOTAL.', reason: R }] },
    { spec: getFeature(f.seq).spec, removed: removedCriteria(listTurns(f.seq)) });
  assert.deepEqual(again.proposals, []);
});

test('D7/D10: confirm and reject an assumption; a rejected one after the interview gets A2-D4\'s follow-up offer', () => {
  const f = feature();
  const m = propose(f, [{ target: 'assumption', change: 'confirm', id: 'A-1', reason: R }, { target: 'assumption', change: 'reject', id: 'A-2', reason: R }]);
  acceptProposal(f.seq, m.id, 1, { by: 'po' });
  acceptProposal(f.seq, m.id, 2, { by: 'po' });
  const g = getFeature(f.seq);
  assert.deepEqual(g.spec.assumptions.map((a) => a.status), ['confirmed', 'rejected']);
  assert.deepEqual(listTurns(f.seq).slice(-2).map((t) => [t.kind, t.payload.id, t.payload.status]), [['assumption', 'A-1', 'confirmed'], ['assumption', 'A-2', 'rejected']]);
  assert.deepEqual(unaskedRejections(g.spec, listTurns(f.seq)), ['A-2']);
});

test('D9: stale when the spec changed during the call: Accept is refused on the server and the proposal stays proposed', () => {
  const f = feature();
  const old = getFeature(f.seq).spec;
  setSection(f.seq, 'rules', ['Refund in 3 days'], { by: 'po' });
  const { proposals } = normalizeHelperReply({ text: 't', proposals: [{ target: 'rules', change: 'set', value: ['Refund to the card', 'New rule'], reason: R }] }, { spec: old });
  const m = insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: 't', proposals });
  assert.equal(isStale(getFeature(f.seq).spec, m.proposals[0]), true);
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), STALE);
  assert.equal(getHelperMessage(m.id).proposals[0].state, 'proposed');
  assert.deepEqual(getFeature(f.seq).spec.rules, ['Refund in 3 days']);
});

test('D9 (user decision 2026-10-26): an add whose text is now a criterion is stale: Accept is refused and nothing is added twice; reworded away, it is acceptable again', () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'A partly shipped order cancels only what is left', reason: R }]);
  const g = addCriterion(f.seq, 'A PARTLY shipped order cancels only what is left', { by: 'po' });
  assert.equal(isStale(g.spec, m.proposals[0]), true);
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), STALE);
  assert.equal(getHelperMessage(m.id).proposals[0].state, 'proposed');
  assert.equal(getFeature(f.seq).spec.criteria.length, 2, 'not added twice');
  editCriterion(f.seq, g.spec.criteria.at(-1).id, 'A customer sees the refund amount before cancelling', { by: 'po' });
  assert.equal(acceptProposal(f.seq, m.id, 1, { by: 'po' }).proposals[0].state, 'accepted');
});

test('D9/D10: stale after a later hand edit, acceptable again after Undo; after a start the change shows as a change since the start', () => {
  const f = feature();
  createStart({ featureSeq: f.seq, version: 1, runId: 'run-a3-1', spec: getFeature(f.seq).spec, title: 'Cancel order', ready: true });
  const m = propose(f, [{ target: 'criterion', change: 'reword', id: 'R-po-3', value: 'The dialog names the order number and its total.', reason: R }]);
  editCriterion(f.seq, 'R-po-3', 'The dialog is friendly', { by: 'po' });
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), STALE);
  revertToStart(f.seq, 1, { by: 'po' });
  acceptProposal(f.seq, m.id, 1, { by: 'po' });
  assert.deepEqual(changedSince(listStarts(f.seq)[0].spec, getFeature(f.seq).spec),
    [{ kind: 'criterion', id: 'R-po-3', change: 'edited', before: 'The confirm dialog is clear', after: 'The dialog names the order number and its total.' }]);
});

test('D10: Accept waits while a round runs (the A1 lock): the edit fails and the proposal stays proposed', async () => {
  const f = feature();
  updateFeature(f.seq, { status: 'your_turn' });
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'A partly shipped order cancels only what is left', reason: R }]);
  const round = heldRunner({ spec: {}, criteria: [], questions: [], done: true, note: '' });
  const job = finishInterview(f.seq, {}, deps(round));
  await until(() => round.calls.length === 1);
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), (e) => e.code === 'BUSY' && e.message === 'Worca is still working on this feature. Try again in a moment.');
  assert.equal(getHelperMessage(m.id).proposals[0].state, 'proposed');
  round.open();
  await job;
});

test('D11: while the helper answers, Accept and Clear chat wait; Reject does not', async () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'One', reason: R }, { target: 'criterion', change: 'add', value: 'Two', reason: R }]);
  const h = heldRunner({ text: 'Done.' });
  const p = sendMessage(f.seq, { text: 'Hi' }, {}, deps(h));
  const ANSWERING = (e) => e.code === 'BUSY' && e.message === 'Worca is still answering. Try again in a moment.';
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), ANSWERING);
  assert.throws(() => clearChat(f.seq), ANSWERING);
  assert.equal(rejectProposal(f.seq, m.id, 2, { by: 'po' }).proposals[1].state, 'rejected');
  h.open();
  await p;
});

test('D16: on an archived feature Accept, Reject, Ask again and Clear chat are refused', () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'One', reason: R }]);
  updateFeature(f.seq, { status: 'archived' });
  const ARCHIVED = (e) => e.code === 'CONFLICT' && e.message === 'this feature is archived; restore it first';
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), ARCHIVED);
  assert.throws(() => rejectProposal(f.seq, m.id, 1, {}), ARCHIVED);
  assert.throws(() => askAgain(f.seq, m.id, 1, {}, deps(fakeRunner([]))), ARCHIVED);
  assert.throws(() => clearChat(f.seq), ARCHIVED);
});

test('§5: a message must be a Worca row of this feature and n one of its proposals; a decided proposal is not decided again', () => {
  const f = feature();
  const other = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'One', reason: R }]);
  const theirs = propose(other, [{ target: 'criterion', change: 'add', value: 'One', reason: R }]);
  const po = insertHelperMessage({ featureSeq: f.seq, role: 'po', text: 'Hi' });
  for (const [id, n, msg] of [[999999, 1, 'This message is no longer in the chat.'], [po.id, 1, 'This message is no longer in the chat.'], [theirs.id, 1, 'This message is no longer in the chat.'], [m.id, 9, 'This change is no longer in the chat.']]) {
    assert.throws(() => acceptProposal(f.seq, id, n, {}), (e) => e.code === 'NOT_FOUND' && e.message === msg, `${id}/${n}`);
    assert.throws(() => rejectProposal(f.seq, id, n, {}), (e) => e.code === 'NOT_FOUND' && e.message === msg, `${id}/${n}`);
  }
  rejectProposal(f.seq, m.id, 1, { by: 'po' });
  const DECIDED = (e) => e.code === 'CONFLICT' && e.message === 'This change was already decided.';
  assert.throws(() => acceptProposal(f.seq, m.id, 1, {}), DECIDED);
  assert.throws(() => rejectProposal(f.seq, m.id, 1, {}), DECIDED);
});

test('D10 Ask again: a stale proposal only, once; it sends "Propose this again for the current spec." with the proposal in focus', async () => {
  const f = feature();
  const m = propose(f, [{ target: 'rules', change: 'set', value: ['Refund to the card', 'A refund goes back the way the order was paid'], reason: R }]);
  assert.throws(() => askAgain(f.seq, m.id, 1, {}, deps(fakeRunner([]))), (e) => e.code === 'CONFLICT' && e.message === 'This change is not out of date.');
  setSection(f.seq, 'rules', ['Refund in 3 days'], { by: 'po' });
  const r = fakeRunner([{ text: 'Still needed: I suggest it again.', proposals: [] }]);
  await askAgain(f.seq, m.id, 1, { by: 'po' }, deps(r));
  const po = listHelperMessages(f.seq).find((x) => x.role === 'po');
  assert.deepEqual([po.text, po.focus, po.createdBy], ['Propose this again for the current spec.', { askAgain: { msgId: m.id, n: 1 } }, 'po']);
  assert.ok(r.calls[0].prompt.includes(['<question_in_focus>',
    'Worca proposed: set rules: Refund to the card; A refund goes back the way the order was paid (not decided)', 'Reason: a reason',
    'The spec changed since you proposed this. Propose it again for the current spec, or say it is no longer needed.', '</question_in_focus>'].join('\n')));
  assert.throws(() => askAgain(f.seq, m.id, 1, {}, deps(r)), (e) => e.code === 'CONFLICT' && e.message === 'Worca was already asked again about this change.');
});

test('D14: Clear chat deletes the rows; accepted changes, their edit turns and the ledger rows stay', () => {
  const f = feature();
  const m = propose(f, [{ target: 'criterion', change: 'add', value: 'Kept after clearing', reason: R }]);
  recordRequirementsCostDelta({ featureSeq: f.seq, helperMessageId: m.id, amountUsd: 0.02 });
  acceptProposal(f.seq, m.id, 1, { by: 'po' });
  const costs = recentHelperCosts(50).length;
  assert.equal(clearChat(f.seq), 1);
  assert.deepEqual(listHelperMessages(f.seq), []);
  assert.ok(getFeature(f.seq).spec.criteria.some((c) => c.text === 'Kept after clearing'));
  assert.ok(listTurns(f.seq).some((t) => t.kind === 'edit' && t.payload.action === 'added'));
  assert.equal(recentHelperCosts(50).length, costs);
});
