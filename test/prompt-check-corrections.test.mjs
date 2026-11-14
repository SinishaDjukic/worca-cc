// test/prompt-check-corrections.test.mjs — the kind-correction store (src/core/prompt-check/corrections.mjs): ids and
// kinds only, never prompt text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { recordKindCorrection, listKindCorrections } from '../src/core/prompt-check/corrections.mjs';

useTempHome(after, 'worca-pc-corrections-');

test('record returns the stored row with the server time; list is newest first and filters by thread or run', () => {
  const a = recordKindCorrection({ surface: 'chat', threadId: 'th_a', proposedKind: 'bug', chosenKind: 'idea' }, { now: new Date('2026-11-14T10:00:00Z') });
  assert.deepEqual(a, { id: a.id, surface: 'chat', threadId: 'th_a', cardId: null, runId: null, proposedKind: 'bug', chosenKind: 'idea', at: '2026-11-14T10:00:00.000Z' });
  assert.equal(typeof a.id, 'number');
  const b = recordKindCorrection({ surface: 'run-card', threadId: 'th_a', cardId: 'card_1', proposedKind: 'idea', chosenKind: 'plan' }, { now: new Date('2026-11-14T11:00:00Z') });
  const c = recordKindCorrection({ surface: 'new-run', runId: 'run_9', proposedKind: 'requirement', chosenKind: 'bug' }, { now: new Date('2026-11-14T12:00:00Z') });
  assert.deepEqual(listKindCorrections({ threadId: 'th_a' }), [b, a]);
  assert.deepEqual(listKindCorrections({ runId: 'run_9' }), [c]);
  assert.deepEqual(listKindCorrections({ threadId: 'nope' }), []);
});

test('the row has exactly the 8 columns and no text: an extra text key is never stored', () => {
  const r = recordKindCorrection({ surface: 'shaper', threadId: 'th_t', proposedKind: 'bug', chosenKind: 'plan', text: 'zebra secret prompt' });
  const row = { ...getDb().prepare('SELECT * FROM prompt_kind_corrections WHERE id = ?').get(r.id) };
  assert.deepEqual(Object.keys(row), ['id', 'surface', 'thread_id', 'card_id', 'run_id', 'proposed_kind', 'chosen_kind', 'at']);
  assert.ok(!JSON.stringify(row).includes('zebra'));
  assert.ok(!('text' in r));
});

test('an invalid input throws TypeError and writes nothing', () => {
  const n = getDb().prepare('SELECT COUNT(*) AS n FROM prompt_kind_corrections').get().n;
  for (const bad of [
    { surface: 'nope', threadId: 't', proposedKind: 'bug', chosenKind: 'idea' },
    { surface: 'chat', threadId: 't', proposedKind: 'nope', chosenKind: 'idea' },
    { surface: 'chat', threadId: 't', proposedKind: 'bug', chosenKind: 'question' },
    { surface: 'chat', threadId: 7, proposedKind: 'bug', chosenKind: 'idea' },
    null,
  ]) assert.throws(() => recordKindCorrection(bad), TypeError);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM prompt_kind_corrections').get().n, n);
});
