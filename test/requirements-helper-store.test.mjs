// test/requirements-helper-store.test.mjs — the helper chat's rows and its ledger rows (plans/requirements-a3-design.md §3, D13, D14).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, insertHelperMessage, getHelperMessage, listHelperMessages, countHelperMessages, updateHelperMessage, deleteHelperMessages,
  recentHelperCosts,
} from '../src/core/requirements/store.mjs';
import { recordRequirementsCostDelta, requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';
import { prepare } from '../src/core/db.mjs';

useTempHome(after, 'worca-req-helper-store-');
const feature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', description: 'Before it ships' });

test('rows: a product owner message and a reply round-trip, oldest first', () => {
  const f = feature();
  const po = insertHelperMessage({ featureSeq: f.seq, role: 'po', text: 'Until when?', focus: { roundTurnId: 3, questionId: 'when', n: 2 } }, { by: 'po' });
  assert.deepEqual([po.role, po.text, po.focus, po.roundTurnId, po.drafts, po.proposals, po.error, po.costUsd, po.model, po.createdBy],
    ['po', 'Until when?', { roundTurnId: 3, questionId: 'when', n: 2 }, null, [], [], null, null, null, 'po']);
  const w = insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: 'Until pick-up.', roundTurnId: 3,
    drafts: [{ question: 'when', n: 2, option: 'Until pick-up', why: 'Tickets.' }],
    proposals: [{ n: 1, target: 'rules', change: 'set', id: null, value: ['a'], before: [], reason: 'r', state: 'proposed' }],
    costUsd: 0.0213, model: 'claude-opus-5-5' });
  assert.equal(w.roundTurnId, 3);
  assert.equal(w.drafts[0].option, 'Until pick-up');
  assert.equal(w.proposals[0].state, 'proposed');
  assert.equal(w.costUsd, 0.0213);
  assert.deepEqual(listHelperMessages(f.seq).map((m) => m.id), [po.id, w.id]);
  assert.deepEqual(listHelperMessages(f.seq + 1000), []);
  assert.deepEqual([countHelperMessages(f.seq), countHelperMessages(f.seq + 1000)], [2, 0]);
  assert.equal(getHelperMessage(999999), null);
});

test('updates: listed fields only; JSON and null round-trip; a bad role is refused', () => {
  const f = feature();
  const w = insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: '' });
  const u = updateHelperMessage(w.id, { text: 'T', proposals: [{ n: 1, state: 'accepted' }], error: { code: 'STOPPED', message: 'm' }, costUsd: 0.5, model: 'm' }, { by: 'po' });
  assert.deepEqual([u.text, u.proposals[0].state, u.error.code, u.costUsd, u.model, u.updatedBy], ['T', 'accepted', 'STOPPED', 0.5, 'm', 'po']);
  assert.equal(updateHelperMessage(w.id, { error: null }).error, null);
  assert.deepEqual(updateHelperMessage(w.id, { drafts: null }).drafts, []);
  assert.throws(() => updateHelperMessage(w.id, { role: 'po' }), /unknown field "role"/);
  assert.throws(() => insertHelperMessage({ featureSeq: f.seq, role: 'bot' }), /unknown role "bot"/);
});

test('helper spend: the ledger row carries helper_message_id and no turn; recentHelperCosts reads only those, newest first', () => {
  const f = feature();
  const w = insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: 'x' });
  const before = requirementsWindowedSpendUsd(0);
  recordRequirementsCostDelta({ featureSeq: f.seq, turnId: 7, amountUsd: 0.4, model: 'm' });   // a round: not a helper call
  recordRequirementsCostDelta({ featureSeq: f.seq, helperMessageId: w.id, amountUsd: 0.02, model: 'm' });
  recordRequirementsCostDelta({ featureSeq: f.seq, helperMessageId: w.id, amountUsd: 0.05, model: 'm' });
  recordRequirementsCostDelta({ featureSeq: f.seq, helperMessageId: w.id, amountUsd: 0 });   // $0 leaves no row
  assert.deepEqual(recentHelperCosts(), [0.05, 0.02]);
  assert.deepEqual(recentHelperCosts(1), [0.05]);
  const row = prepare('SELECT turn_id, helper_message_id FROM req_cost_ledger WHERE helper_message_id IS NOT NULL ORDER BY id DESC LIMIT 1').get();
  assert.deepEqual([row.turn_id, Number(row.helper_message_id)], [null, w.id]);
  assert.equal(Math.round((requirementsWindowedSpendUsd(0) - before) * 100) / 100, 0.47, 'helper spend counts toward the requirements window');
});

test("clearing a feature's chat deletes its rows only and keeps the ledger rows", () => {
  const a = feature();
  const b = feature();
  const w = insertHelperMessage({ featureSeq: a.seq, role: 'worca', text: 'x' });
  insertHelperMessage({ featureSeq: a.seq, role: 'po', text: 'y' });
  insertHelperMessage({ featureSeq: b.seq, role: 'po', text: 'z' });
  recordRequirementsCostDelta({ featureSeq: a.seq, helperMessageId: w.id, amountUsd: 0.03 });
  const costs = recentHelperCosts(50).length;
  assert.equal(deleteHelperMessages(a.seq), 2);
  assert.deepEqual(listHelperMessages(a.seq), []);
  assert.deepEqual([countHelperMessages(a.seq), countHelperMessages(b.seq)], [0, 1]);
  assert.equal(listHelperMessages(b.seq).length, 1);
  assert.equal(recentHelperCosts(50).length, costs, 'the ledger keeps what the chat cost');
});
