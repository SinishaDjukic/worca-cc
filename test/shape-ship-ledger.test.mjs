// test/shape-ship-ledger.test.mjs — Feature D1 (Ship): the requirement rows, the block reason and the Care outcome a
// marked feature's Ship reads (src/shared/shape/ship-ledger.mjs). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipLedger, unownedReason, careOutcome, unmetLines, confirmMarkOf, REASON_FIRST } from '../src/shared/shape/ship-ledger.mjs';
// A namespace read, so a missing new export (openPrReason, the per-run texts) fails only its own tests, not the whole file.
import * as LEDGER from '../src/shared/shape/ship-ledger.mjs';
import { careChoiceText, careRecordLine } from '../src/shared/shape/feature-record.mjs';
import { requirementStatus } from '../src/shared/shape/req-status.mjs';

const AGREED = [
  { id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People pin it' },
  { id: 'R-comp-4', text: 'The data stays in the EU' }, { id: 'R-sec-1', text: 'Only owners pin' },
];
const KINDS = [
  { id: 'R-po-1', kind: 'owned', run: 1 }, { id: 'R-po-2', kind: 'owned', run: 2 },
  { id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }, { id: 'R-sec-1', kind: 'owned', run: null },
];

test('shipLedger: rows; the confirmed one waits, blocked, with the one-role one-id reason', () => {
  const l = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], verify: null });
  assert.deepEqual(l.confirmed, [{ id: 'R-comp-4', text: 'The data stays in the EU', role: 'compliance', roleLabel: 'Compliance', state: 'waiting', mark: null, reason: null, at: null }]);
  assert.deepEqual(l.owned, [
    { id: 'R-po-1', text: 'People see it', run: 1, status: 'holds' }, { id: 'R-po-2', text: 'People pin it', run: 2, status: 'holds' },
    { id: 'R-sec-1', text: 'Only owners pin', run: null, status: 'holds' }]);
  assert.deepEqual(l.waiting, ['R-comp-4']);
  assert.equal(l.blocked, true);
  assert.equal(l.reason, 'Waiting for Compliance to confirm R-comp-4');
  assert.deepEqual(l.met, { met: 3, total: 4 });
});

test('shipLedger: a met mark confirms with its time; not blocked, no reason', () => {
  const at = '2026-11-22T16:55:00.000Z';
  const l = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [{ id: 'R-comp-4', mark: 'met', role: 'compliance', by: 'ana', at }], verify: null });
  assert.equal(l.confirmed[0].state, 'confirmed');
  assert.equal(l.confirmed[0].at, at);
  assert.deepEqual([l.blocked, l.reason, l.waiting], [false, null, []]);
  assert.deepEqual(l.met, { met: 4, total: 4 });
  assert.deepEqual(l.unmet, []);
});

// Owner direction da6198d8d: Met / Not met / Dropped, a reason for the last two, only Met counts.
test('shipLedger: blocked until marked; blocked without a reason; open after Not met with a reason', () => {
  const one = (e) => shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: e ? [e] : [] });
  assert.equal(one(null).blocked, true);
  const bare = one({ id: 'R-comp-4', mark: 'not-met', reason: '   ' });
  assert.deepEqual([bare.blocked, bare.reason, bare.confirmed[0].state, bare.waiting], [true, REASON_FIRST, 'needs-reason', []]);
  assert.equal(REASON_FIRST, 'Give a reason for each one not met or dropped');
  const at = '2026-11-22T17:00:00.000Z';
  const nm = one({ id: 'R-comp-4', mark: 'not-met', reason: ' Legal  has not\nsigned ', at });
  assert.deepEqual([nm.blocked, nm.reason], [false, null]);
  assert.deepEqual(nm.confirmed[0], { id: 'R-comp-4', text: 'The data stays in the EU', role: 'compliance', roleLabel: 'Compliance',
    state: 'confirmed', mark: 'not-met', reason: 'Legal has not signed', at });
  assert.deepEqual(nm.met, { met: 3, total: 4 });
  assert.deepEqual(nm.unmet, [{ id: 'R-comp-4', text: 'The data stays in the EU', mark: 'not-met', reason: 'Legal has not signed' }]);
  const dr = one({ id: 'R-comp-4', mark: 'dropped', reason: 'Out of scope' });
  assert.deepEqual([dr.blocked, dr.met.met], [false, 3]);
  // An unmarked one reads the waiting line before the reason line.
  const two = [...KINDS.slice(0, 3), { id: 'R-sec-1', kind: 'confirmed', role: 'security' }];
  assert.equal(shipLedger({ agreed: AGREED, kinds: two, acceptance: [{ id: 'R-comp-4', mark: 'dropped' }] }).reason, 'Waiting for Security to confirm R-sec-1');
  // An unknown mark is no mark.
  assert.equal(one({ id: 'R-comp-4', mark: 'maybe' }).confirmed[0].state, 'waiting');
});

// Small runs D3 (D2): the status is computed once, here, when the caller passes the runs.
test('shipLedger: with runs every owned and confirmed entry has shown', () => {
  const runs = [{ index: 1, state: 'done' }, { index: 2, state: 'running' }];
  const reruns = [{ id: 'R-po-1', run: 3, why: 'change', at: '2026-11-20T10:00:00Z' }];
  const l = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], verify: null, runs, reruns });
  for (const e of [...l.owned, ...l.confirmed]) {
    const { shown, ...bare } = e;
    assert.deepEqual(shown, requirementStatus(bare, { runs, reruns }), e.id);
  }
  assert.deepEqual(l.owned.map((o) => o.shown.text), ['run 1 · changed · run 3 builds it', 'run 2 · being built', 'owned by no run · confirmed by no person']);
  assert.equal(l.confirmed[0].shown.text, 'confirmed by a person · Compliance');
  assert.deepEqual(l.met, { met: 2, total: 4 }, 'an owner-less requirement is not met');
});

test('shipLedger: without runs the ledger deep-equals the D1 output', () => {
  const acceptance = [{ id: 'R-comp-4', mark: 'not-met', reason: 'no copy', at: '2026-11-22T16:55:00.000Z' }];
  const bare = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance, verify: null });
  assert.deepEqual(shipLedger({ agreed: AGREED, kinds: KINDS, acceptance, verify: null, runs: null, reruns: [] }), bare);
  assert.ok([...bare.owned, ...bare.confirmed].every((e) => !('shown' in e)));
  assert.ok(!('unowned' in bare));
});

test('shipLedger: every id owned: shown is the only key runs add', () => {
  const kinds = KINDS.map((k) => (k.id === 'R-sec-1' ? { ...k, run: 2 } : k));
  const acceptance = [{ id: 'R-comp-4', mark: 'not-met', reason: 'no copy', at: '2026-11-22T16:55:00.000Z' }];
  const bare = shipLedger({ agreed: AGREED, kinds, acceptance, verify: null });
  const withRuns = shipLedger({ agreed: AGREED, kinds, acceptance, verify: null, runs: [] });
  const strip = (l) => ({ ...l, owned: l.owned.map(({ shown, ...e }) => e), confirmed: l.confirmed.map(({ shown, ...e }) => e) });
  assert.deepEqual(strip(withRuns), bare, 'shown is the only key runs add');
});

// Fail closed: an agreed requirement owned by no run and confirmed by no person blocks Ship, whatever is marked.
test('shipLedger: with runs, an owner-less id blocks and the reason names it, over a waiting mark and an accepted gap', () => {
  const reason = 'R-sec-1 is owned by no run and confirmed by no person';
  const waits = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], runs: [] });
  assert.deepEqual([waits.blocked, waits.reason, waits.unowned, waits.waiting], [true, reason, ['R-sec-1'], ['R-comp-4']]);
  assert.deepEqual(waits.owned.map((o) => o.status), ['holds', 'holds', 'unowned']);
  assert.equal(waits.confirmed[0].state, 'waiting');
  const marked = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [{ id: 'R-comp-4', mark: 'met' }], runs: [] });
  assert.deepEqual([marked.blocked, marked.reason, marked.met], [true, reason, { met: 3, total: 4 }]);
  const gap = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], runs: [], verify: { state: 'accepted', gaps: [{ id: 'R-sec-1' }] } });
  assert.equal(gap.owned[2].status, 'unowned');
  const two = shipLedger({ agreed: AGREED, kinds: [{ id: 'R-po-1', kind: 'owned', run: null }, ...KINDS.slice(1)], acceptance: [], runs: [] });
  assert.deepEqual([two.unowned, two.reason], [['R-po-1', 'R-sec-1'], 'R-po-1 and 1 more are owned by no run and confirmed by no person']);
  assert.equal(unownedReason([]), null);
  assert.equal(unownedReason(['R-ops-1']), 'R-ops-1 is owned by no run and confirmed by no person');
});

test('unmetLines: one line each, Not met and Dropped; confirmMarkOf reads not_met', () => {
  const l = shipLedger({ agreed: AGREED, kinds: [KINDS[0], { id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }, { id: 'R-sec-1', kind: 'confirmed', role: 'security' }],
    acceptance: [{ id: 'R-comp-4', mark: 'not-met', reason: 'Legal has not signed' }, { id: 'R-sec-1', mark: 'dropped', reason: 'Owners only later' }] });
  assert.deepEqual(unmetLines(l), ['Not met: R-comp-4 · Legal has not signed', 'Dropped: R-sec-1 · Owners only later']);
  assert.deepEqual(unmetLines(null), []);
  assert.deepEqual(['met', 'not_met', 'not-met', 'dropped', 'x', undefined].map(confirmMarkOf), ['met', 'not-met', 'not-met', 'dropped', null, null]);
});

test('shipLedger: the three reason forms', () => {
  const two = [...KINDS.slice(0, 2), { id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }, { id: 'R-sec-1', kind: 'confirmed', role: 'compliance' }];
  assert.equal(shipLedger({ agreed: AGREED, kinds: two, acceptance: [] }).reason, 'Waiting for Compliance to confirm R-comp-4 and 1 more');
  const roles = [...KINDS.slice(0, 2), { id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }, { id: 'R-sec-1', kind: 'confirmed', role: 'security' }];
  assert.equal(shipLedger({ agreed: AGREED, kinds: roles, acceptance: [] }).reason, 'Waiting for Compliance and Security to confirm 2 requirements');
});

test('shipLedger: an owned id among an accepted check\'s gaps is gap-accepted; a clean check keeps holds', () => {
  const gaps = [{ id: 'R-po-2', why: 'x', run: 5 }];
  const acc = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], verify: { state: 'accepted', gaps } });
  assert.deepEqual(acc.owned.map((o) => o.status), ['holds', 'gap-accepted', 'holds']);
  assert.deepEqual(acc.met, { met: 2, total: 4 });
  const clean = shipLedger({ agreed: AGREED, kinds: KINDS, acceptance: [], verify: { state: 'clean', gaps } });
  assert.deepEqual(clean.owned.map((o) => o.status), ['holds', 'holds', 'holds']);
});

test('shipLedger: no confirmed requirement is never blocked', () => {
  const l = shipLedger({ agreed: AGREED, kinds: KINDS.map((k) => ({ id: k.id, kind: 'owned', run: 1 })), acceptance: [] });
  assert.deepEqual([l.confirmed, l.blocked, l.reason], [[], false, null]);
  assert.deepEqual(shipLedger({}).met, { met: 0, total: 0 });
});

test("careOutcome: Worca's pick and a person's choice; the outcome follows the met passed in; no figures → no outcome", () => {
  const figures = { requirementsMet: { met: 1, total: 9 }, gapsAtEnd: 1, changesAfterShip: 0 };
  const pick = careOutcome({ position: 'balanced', chosenBy: 'default', worcaPick: null }, figures, { met: 16, total: 16 });
  assert.deepEqual(pick, { choice: "Balanced · Worca's pick", outcome: '16 of 16 built requirements met · 1 gap found at the end · 0 changes after ship so far',
    line: "Care: Balanced · Worca's pick · 16 of 16 built requirements met · 1 gap found at the end · 0 changes after ship so far" });
  const mine = careOutcome({ position: 'thorough', chosenBy: 'person', worcaPick: 'balanced' }, { ...figures, gapsAtEnd: 2, changesAfterShip: 3 }, { met: 3, total: 4 });
  assert.equal(mine.line, 'Care: Thorough · your choice · Worca recommended Balanced · 3 of 4 built requirements met · 2 gaps found at the end · 3 changes after ship so far');
  assert.deepEqual(careOutcome(null, null, { met: 0, total: 0 }), { choice: "Balanced · Worca's pick", outcome: null, line: "Care: Balanced · Worca's pick" });
  assert.doesNotMatch(JSON.stringify([pick, mine]), /not enough history/);
});

test('careChoiceText: careRecordLine is "Care: " plus it, as before', () => {
  const p = { position: 'lean', chosenBy: 'person', worcaPick: 'thorough' };
  assert.equal(careChoiceText(p), 'Lean · your choice · Worca recommended Thorough');
  assert.equal(careRecordLine(p), 'Care: Lean · your choice · Worca recommended Thorough');
  assert.equal(careRecordLine({}), "Care: Balanced · Worca's pick");
  assert.equal(careChoiceText({ position: 'balanced', chosenBy: 'person', worcaPick: 'balanced' }), "Balanced · Worca's pick",
    "a person who kept Worca's pick reads as Worca's pick, never 'your choice · Worca recommended Balanced'");
});

// ---- Slice 4 (R-po-1): why One is off, in the words the dialog and the server share ----
const at = (n) => `https://github.com/me/repo/pull/${n}`;

test('openPrReason: an open PR is named with its run and number; a merged one reads already merged', () => {
  assert.equal(LEDGER.openPrReason({ index: 2, pr: { url: at(40), number: 40, state: 'OPEN' } }), 'Run 2 already has pull request #40 open');
  assert.equal(LEDGER.openPrReason({ index: 2, pr: { url: at(40), number: 40 } }), 'Run 2 already has pull request #40 open', 'no state: open');
  assert.equal(LEDGER.openPrReason({ index: 2, pr: { url: at(40), number: 40, state: 'MERGED' } }), "Run 2's pull request #40 is already merged");
});

test('openPrReason: without a number it reads it from a /pull/N or /merge_requests/N url, else names none', () => {
  assert.equal(LEDGER.openPrReason({ index: 3, pr: { url: at(41), state: 'OPEN' } }), 'Run 3 already has pull request #41 open');
  assert.equal(LEDGER.openPrReason({ index: 3, pr: { url: at(41), number: null, state: 'MERGED' } }), "Run 3's pull request #41 is already merged");
  assert.equal(LEDGER.openPrReason({ index: 4, pr: { url: 'https://gitlab.example/me/repo/-/merge_requests/7', state: 'OPEN' } }),
    'Run 4 already has pull request #7 open');
  assert.equal(LEDGER.openPrReason({ index: 1, pr: { url: 'created:1', state: 'OPEN' } }), 'Run 1 already has a pull request open');
});

test('the flag-off reason stays word for word as one legacy constant in pr-auto.mjs; SMALL_RUNS_SHIP is gone from the ledger', async () => {
  const { LEGACY_PER_RUN_REASON } = await import('../src/shared/shape/ship-ledger.mjs');
  assert.equal(LEGACY_PER_RUN_REASON, 'small runs ship a PR per run');
  assert.equal('SMALL_RUNS_SHIP' in LEDGER, false, 'SMALL_RUNS_SHIP is removed');
});
