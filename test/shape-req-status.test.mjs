// test/shape-req-status.test.mjs — Shaper small runs D3 (D1): the ONE requirement status function. Every slice state's
// word and mark, the stop override, change and gap reruns before and after done, gap accepted, the `a run` owner, the
// confirmed words and rerunsOf's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWord, requirementStatus, rerunsOf, MARK_WORDS } from '../src/shared/shape/req-status.mjs';
import { shipLedger, MARK_WORDS as LEDGER_MARK_WORDS } from '../src/shared/shape/ship-ledger.mjs';

test('runWord: one table row per slice state from sliceState, plus the stop override and an unknown state, returns the rule\'s word and mark; an undefined state yields `to do`; no case yields an empty word', () => {
  const table = [
    ['done', 'met', 'check'],
    ['running', 'being built', 'live'], ['shaping', 'being built', 'live'], ['starting', 'being built', 'live'],
    ['approval', 'waiting for you', '?'], ['questions', 'waiting for you', '?'], ['stopped', 'waiting for you', '?'],
    ['error', 'waiting for you', '?'], ['failed', 'waiting for you', '?'], ['missed', 'waiting for you', '?'],
    ['paused', 'paused', 'paused'],
    ['planned', 'to do', 'wait'], ['held', 'to do', 'wait'], ['canceled', 'to do', 'wait'], ['none', 'to do', 'wait'],
    ['who-knows', 'to do', 'wait'], [undefined, 'to do', 'wait'],
  ];
  for (const [state, word, mark] of table) {
    assert.deepEqual(runWord(state), { word, mark }, String(state));
    assert.ok(runWord(state).word, 'never an empty word');
  }
  assert.deepEqual(runWord('running', { reason: 'tests fail', held: false }), { word: 'waiting for you', mark: '?' }, 'an open stop waits for you');
  assert.deepEqual(runWord('running', { reason: 'tests fail', held: true }), { word: 'being built', mark: 'live' }, 'a held answer does not');
});

const owned = (id, run, status = 'holds') => ({ id, text: `${id} text`, run, status });

test('a change rerun reads `changed · run 5 builds it` then `met · changed by run 5`; a gap rerun `gap · run 6 fixes it` then `met · fixed by run 6`; the newer of two wins', () => {
  const reruns = [{ id: 'R-po-4', run: 5, why: 'change', at: '2026-11-20T10:00:00Z' }];
  const before = requirementStatus(owned('R-po-4', 2), { runs: [{ index: 2, state: 'done' }, { index: 5, state: 'running' }], reruns });
  assert.deepEqual(before, { owner: 'run 2', role: null, word: 'changed · run 5 builds it', text: 'run 2 · changed · run 5 builds it', mark: 'live' });
  const after = requirementStatus(owned('R-po-4', 2), { runs: [{ index: 2, state: 'done' }, { index: 5, state: 'done' }], reruns });
  assert.equal(after.text, 'run 2 · met · changed by run 5');
  assert.equal(after.mark, 'check');
  const gaps = [{ id: 'R-po-1', run: 6, why: 'gap', at: '2026-11-21T10:00:00Z' }];
  assert.equal(requirementStatus(owned('R-po-1', 2), { runs: [{ index: 2, state: 'done' }, { index: 6, state: 'planned' }], reruns: gaps }).text, 'run 2 · gap · run 6 fixes it');
  assert.equal(requirementStatus(owned('R-po-1', 2), { runs: [{ index: 2, state: 'done' }, { index: 6, state: 'done' }], reruns: gaps }).text, 'run 2 · met · fixed by run 6');
  const both = [{ id: 'R-po-1', run: 5, why: 'change', at: '2026-11-20T10:00:00Z' }, { id: 'R-po-1', run: 6, why: 'gap', at: '2026-11-21T10:00:00Z' }];
  assert.equal(requirementStatus(owned('R-po-1', 2), { runs: [{ index: 2, state: 'done' }, { index: 5, state: 'done' }, { index: 6, state: 'running' }], reruns: both }).text,
    'run 2 · gap · run 6 fixes it', 'the newest entry wins');
});

test('a change landing on its own owner reads `run 3 · changed` then `run 3 · met`, with no second run number', () => {
  const reruns = [{ id: 'R-po-2', run: 3, why: 'change', at: '2026-11-20T10:00:00Z' }];
  const open = requirementStatus(owned('R-po-2', 3), { runs: [{ index: 3, state: 'approval' }], reruns });
  assert.equal(open.text, 'run 3 · changed');
  assert.equal(open.mark, '?');
  assert.equal(requirementStatus(owned('R-po-2', 3), { runs: [{ index: 3, state: 'done' }], reruns }).text, 'run 3 · met');
});

test('gap-accepted reads `gap accepted` even with a later rerun for the id; run null reads owner `a run`', () => {
  const r = requirementStatus(owned('R-po-1', 2, 'gap-accepted'), { runs: [{ index: 2, state: 'done' }, { index: 6, state: 'done' }],
    reruns: [{ id: 'R-po-1', run: 6, why: 'gap', at: '2026-11-21T10:00:00Z' }] });
  assert.deepEqual(r, { owner: 'run 2', role: null, word: 'gap accepted', text: 'run 2 · gap accepted', mark: 'x' });
  assert.deepEqual(requirementStatus(owned('R-po-9', null), { runs: [], reruns: [] }),
    { owner: 'a run', role: null, word: 'to do', text: 'a run · to do', mark: 'wait' });
});

test('an owner-less entry (status unowned) reads owned by no run, whatever the runs and reruns say', () => {
  const r = requirementStatus(owned('R-po-9', null, 'unowned'), { runs: [{ index: 6, state: 'done' }], reruns: [{ id: 'R-po-9', run: 6, why: 'gap', at: 'x' }] });
  assert.deepEqual(r, { owner: 'no run', role: null, word: 'confirmed by no person', text: 'owned by no run · confirmed by no person', mark: 'x' });
});

test('confirmed entries built by `shipLedger` read `confirmed by a person · Compliance` / confirmed by / Marked Not met by you · reason / Marked Dropped by you · reason / needs-reason', () => {
  const agreed = ['R-comp-1', 'R-comp-2', 'R-comp-3', 'R-comp-4', 'R-comp-5'].map((id) => ({ id, text: `${id} text` }));
  const kinds = agreed.map((a) => ({ id: a.id, kind: 'confirmed', role: 'compliance' }));
  const acceptance = [{ id: 'R-comp-2', mark: 'met', at: '2026-11-22T16:55:00Z' }, { id: 'R-comp-3', mark: 'not-met', reason: 'no signed\ncopy' },
    { id: 'R-comp-4', mark: 'dropped', reason: 'out of scope' }, { id: 'R-comp-5', mark: 'dropped' }];
  const { confirmed } = shipLedger({ agreed, kinds, acceptance });
  const got = confirmed.map((c) => requirementStatus(c, { runs: [], reruns: [] }));
  const role = 'Compliance';
  const owner = 'confirmed by a person';
  assert.deepEqual(got, [
    { owner, role, word: 'Compliance', text: 'confirmed by a person · Compliance', mark: 'wait' },
    { owner, role, word: 'confirmed by Compliance', text: 'confirmed by Compliance', mark: 'check' },
    { owner, role, word: 'Marked Not met by you', text: 'Marked Not met by you · no signed copy', mark: 'x' },
    { owner, role, word: 'Marked Dropped by you', text: 'Marked Dropped by you · out of scope', mark: 'none' },
    { owner, role, word: 'Marked Dropped by you', text: 'Marked Dropped by you', mark: 'x' },
  ]);
});

test('rerunsOf merges changes and every check\'s gap runs by `at`, lands a finished change on `added`, skips case none', () => {
  const outline = {
    changes: [
      { id: 'R-po-1', case: 'running', run: 2, at: '2026-11-20T12:00:00Z' },
      { id: 'R-po-2', case: 'finished', run: 2, added: 5, at: '2026-11-20T09:00:00Z' },
      { id: 'R-po-3', case: 'none', run: null, at: '2026-11-20T08:00:00Z' },
      { id: 'R-po-4', case: 'waiting', run: 3, at: '2026-11-21T08:00:00Z' },
    ],
    verify: { checks: [
      { round: 1, at: '2026-11-20T11:00:00Z', result: { held: [], gaps: [{ id: 'R-po-5' }, { id: 'R-po-6' }] }, gapRuns: [6, 7] },
      { round: 2, at: '2026-11-21T08:00:00Z', result: { held: [], gaps: [{ id: 'R-po-7' }] }, gapRuns: [8] },
      { round: 3, at: '2026-11-22T08:00:00Z', result: null, gapRuns: [] },
    ] },
  };
  assert.deepEqual(rerunsOf(outline), [
    { id: 'R-po-2', run: 5, why: 'change', at: '2026-11-20T09:00:00Z' },
    { id: 'R-po-5', run: 6, why: 'gap', at: '2026-11-20T11:00:00Z' },
    { id: 'R-po-6', run: 7, why: 'gap', at: '2026-11-20T11:00:00Z' },
    { id: 'R-po-1', run: 2, why: 'change', at: '2026-11-20T12:00:00Z' },
    { id: 'R-po-4', run: 3, why: 'change', at: '2026-11-21T08:00:00Z' },
    { id: 'R-po-7', run: 8, why: 'gap', at: '2026-11-21T08:00:00Z' },
  ], 'by at; a tie keeps the source order (changes first)');
  assert.deepEqual(rerunsOf(null), []);
  assert.deepEqual(rerunsOf({}), []);
});

test('MARK_WORDS from ship-ledger is the same frozen object', () => {
  assert.equal(LEDGER_MARK_WORDS, MARK_WORDS);
  assert.ok(Object.isFrozen(MARK_WORDS));
  assert.deepEqual(MARK_WORDS, { met: 'Met', 'not-met': 'Not met', dropped: 'Dropped' });
});
