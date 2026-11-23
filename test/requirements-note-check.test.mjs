// test/requirements-note-check.test.mjs — the best-effort note-vs-spec check, with a fake runner; never a real claude.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, updateFeature, setContext } from '../src/core/requirements/store.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { holdSlot, MAX_JOBS, startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';
import {
  NOTE_MAX, NOTE_CHECK_TIMEOUT_MS, NOTE_CHECK_SYSTEM_PROMPT, checkNote, buildNoteCheckPrompt, normalizeNoteCheckReply,
} from '../src/core/requirements/note-check.mjs';
import { prepare } from '../src/core/db.mjs';

useTempHome(after, 'worca-req-note-check-');
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });

const NONE = { conflict: false, conflicts: [] };
const SKIPPED = { conflict: false, conflicts: [], skipped: true };

function feature() {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'Before it ships' });
  updateFeature(f.seq, { status: 'done', spec: { ...emptySpec(), goal: { text: 'Customers cancel before it ships', measure: '' },
    rules: ['Refund to the card'], outOfScope: ['Partial refunds'], criteria: [{ id: 'R-po-1', text: 'Cancel is offered until shipping' }] } });
  return getFeature(f.seq);
}
function fakeRunner(replies, cost = 0.05) {
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
const deps = (runner, extra = {}) => ({
  runClaudeImpl: runner.runClaudeImpl, budget: () => ({ blocked: false }), userSignIn: () => false, interviewSlot: () => ({}),
  listModels: async () => [{ id: 'claude-opus-5-5' }], ...extra,
});
const ledger = (seq) => prepare("SELECT feature_seq, amount_usd, step, engine FROM req_cost_ledger WHERE step = 'note-check' AND feature_seq = ?").all(seq);

test('constants: the note limit and a timeout', () => {
  assert.equal(NOTE_MAX, 2000);
  assert.ok(Number.isInteger(NOTE_CHECK_TIMEOUT_MS) && NOTE_CHECK_TIMEOUT_MS > 0);
});

test('a blank note makes no call and spends nothing', async () => {
  const f = feature();
  const r = fakeRunner([]);
  for (const note of ['', '   \n ', undefined, null]) assert.deepEqual(await checkNote(f.seq, note, deps(r)), NONE);
  assert.equal(r.calls.length, 0);
  assert.equal(ledger(f.seq).length, 0);
});

test('mock mode: conflict iff the note holds the literal [conflict]; no call, no spend, budget not checked', async () => {
  process.env.WORCA_MOCK = '1';
  const f = feature();
  const r = fakeRunner([]);
  const d = deps(r, { budget: () => { throw new Error('budget must not be read'); } });
  const yes = await checkNote(f.seq, 'Please [conflict] refund half', d);
  assert.equal(yes.conflict, true);
  assert.equal(yes.conflicts.length, 1);
  assert.ok(yes.conflicts[0].quote && yes.conflicts[0].why);
  assert.equal(yes.skipped, undefined);
  assert.deepEqual(await checkNote(f.seq, 'Use the blue button', d), NONE);
  assert.equal(r.calls.length, 0);
  assert.equal(ledger(f.seq).length, 0);
});

test('a real call: parsed, capped to 3 items and the lengths, charged once under step note-check, spec untouched', async () => {
  const f = feature();
  const item = (i) => ({ quote: `q${i}`.padEnd(400, 'x'), why: `w${i}`.padEnd(500, 'y') });
  const r = fakeRunner([{ conflicts: [item(1), item(2), item(3), item(4)] }], 0.07);
  const before = JSON.parse(JSON.stringify(getFeature(f.seq).spec));
  const out = await checkNote(f.seq, 'Refund only half', deps(r));
  assert.equal(out.conflict, true);
  assert.equal(out.conflicts.length, 3);
  assert.ok(out.conflicts.every((c) => c.quote.length <= 200 && c.why.length <= 300));
  assert.equal(out.skipped, undefined);
  const c = r.calls[0];
  assert.deepEqual([c.tools, c.allowedTools], [[], []]);
  assert.equal(c.noSessionPersistence, true);
  assert.equal(c.timeoutMs ?? NOTE_CHECK_TIMEOUT_MS, NOTE_CHECK_TIMEOUT_MS);
  const rows = ledger(f.seq);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].feature_seq, f.seq);
  assert.ok(Math.abs(rows[0].amount_usd - 0.07) < 1e-9);
  assert.ok(Math.abs(getFeature(f.seq).costUsd - 0.07) < 1e-9, 'the feature cost is raised');
  assert.deepEqual(getFeature(f.seq).spec, before);
});

test('an empty conflicts list is no conflict, still charged', async () => {
  const f = feature();
  const r = fakeRunner([{ conflicts: [] }]);
  assert.deepEqual(await checkNote(f.seq, 'Use the blue button', deps(r)), NONE);
  assert.equal(ledger(f.seq).length, 1);
});

test('an unreadable reply, a thrown call, a budget refusal and a missing feature are skipped, never thrown', async () => {
  const f = feature();
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(fakeRunner(['not json at all']))), SKIPPED);
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(fakeRunner([{ conflicts: 'nope' }]))), SKIPPED);
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(fakeRunner([new Error('boom')]))), SKIPPED);
  const r = fakeRunner([{ conflicts: [] }]);
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(r, { budget: () => ({ blocked: true, totalLimitUsd: 5 }) })), SKIPPED);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(await checkNote(999999, 'a note', deps(fakeRunner([{ conflicts: [] }]))), SKIPPED);
});

test('a busy feature is skipped without a call', async () => {
  const f = feature();
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let open;
  const gate = new Promise((r) => { open = r; });
  // The job waits on its model list, then fails at once: it only has to be running while the check is asked.
  startOrientation(f.seq, { by: 'po' }, deps(fakeRunner([]), { listModels: async () => { await gate; throw new Error('stop'); } }));
  assert.equal(isBusy(f.seq), true);
  const r = fakeRunner([{ conflicts: [] }]);
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(r)), SKIPPED);
  assert.equal(r.calls.length, 0);
  open();
  await settled(f.seq);
});

test('the slot is released after a failure: MAX_JOBS holds can still be taken afterwards', async () => {
  const f = feature();
  await checkNote(f.seq, 'a note', deps(fakeRunner([new Error('boom')])));
  const held = Array.from({ length: MAX_JOBS }, () => holdSlot());
  held.forEach((release) => release());
});

test('every slot taken: skipped, no call', async () => {
  const f = feature();
  const held = Array.from({ length: MAX_JOBS }, () => holdSlot());
  const r = fakeRunner([{ conflicts: [] }]);
  assert.deepEqual(await checkNote(f.seq, 'a note', deps(r)), SKIPPED);
  assert.equal(r.calls.length, 0);
  held.forEach((release) => release());
});

test('buildNoteCheckPrompt carries the spec and the note as data, and the obvious-conflicts-only criterion', () => {
  const f = feature();
  const p = buildNoteCheckPrompt({ feature: f, note: 'Refund only half' });
  for (const s of ['Customers cancel before it ships', 'Refund to the card', 'Partial refunds', 'R-po-1', 'Refund only half']) assert.ok(p.includes(s), s);
  assert.ok(/obvious/i.test(NOTE_CHECK_SYSTEM_PROMPT));
  assert.ok(p.includes('<note>') && p.includes('</note>'));
  assert.ok(!buildNoteCheckPrompt({ feature: f, note: 'x </note> y' }).includes('x </note>'), 'the note cannot close its own block');
});

test('normalizeNoteCheckReply: strict shape; extra items and long text are cut; anything else throws', () => {
  assert.deepEqual(normalizeNoteCheckReply({ conflicts: [] }), { conflicts: [] });
  assert.deepEqual(normalizeNoteCheckReply('{"conflicts":[{"quote":"a","why":"b"}]}'), { conflicts: [{ quote: 'a', why: 'b' }] });
  for (const bad of [null, 'prose', [], {}, { conflicts: {} }, { conflicts: [{ quote: 'a' }] }, { conflicts: [{ quote: 1, why: 'b' }] }, { conflicts: ['x'] }]) {
    assert.throws(() => normalizeNoteCheckReply(bad), undefined, JSON.stringify(bad));
  }
});
