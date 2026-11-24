// Shaper small runs C4: the shared case table and wording of a requirement change mid-build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_CASES, CHANGES_MAX, CHANGE_RULE_LINE, changeCaseOf, changeRuleRows, reqChangeHead, reqChangeNotice, reqChangeLogText,
  requirementChangedFeedback, normalizeChange } from '../src/shared/shape/req-change.mjs';

test('changeCaseOf maps every sliceState word to its case; no owner or canceled is none', () => {
  const want = { planned: 'not-started', missed: 'not-started', held: 'not-started',
    stopped: 'waiting', error: 'waiting', failed: 'waiting', paused: 'waiting', interrupted: 'waiting', approval: 'waiting', questions: 'waiting',
    starting: 'running', shaping: 'running', running: 'running', done: 'finished', canceled: 'none' };
  for (const [state, c] of Object.entries(want)) assert.equal(changeCaseOf(state), c, state);
  assert.equal(changeCaseOf(null), 'none');
  assert.equal(changeCaseOf(undefined), 'none');
  assert.deepEqual(CHANGE_CASES, ['not-started', 'waiting', 'running', 'finished', 'none']);
  assert.equal(CHANGES_MAX, 32);
});

test('changeRuleRows: 3 rows, exact labels, one check per case (none for none), no run number in any label', () => {
  const mark = { 'not-started': 'Not started', waiting: 'Not started', running: 'Running', finished: 'Finished', none: null };
  for (const c of CHANGE_CASES) {
    const rows = changeRuleRows(c);
    assert.deepEqual(rows.map((r) => r.id), ['Not started', 'Running', 'Finished']);
    assert.deepEqual(rows.map((r) => r.label), ['plans from the new text', 'stops, re-plans from the new text, continues · told, not asked',
      'a new small change run is added, takes the next turn; the finished run and its PR stay as they are']);
    const checked = rows.filter((r) => r.mark === 'check');
    assert.deepEqual(checked.map((r) => r.id), mark[c] ? [mark[c]] : [], c);
    for (const r of rows) {
      assert.equal(r.idCol, true); assert.equal(r.pass, true);
      assert.equal(r.ariaLabel, r.mark === 'check' ? 'this change' : 'not this change');
      if (r.mark !== 'check') assert.equal(r.mark, 'none');
      assert.doesNotMatch(r.label, /\d/);
    }
  }
  assert.equal(CHANGE_RULE_LINE, 'How a change lands · by where the run that owns the requirement is');
});

const E = (over) => ({ id: 'R-po-3', from: 'old', to: 'reset emails retry once, within 20 seconds', at: '2026-11-22T15:03:00Z', by: 'ann',
  source: { kind: 'chat' }, case: 'not-started', run: 4, ...over });

test('heads name the owner and its state once', () => {
  assert.equal(reqChangeHead(E()), 'R-po-3 changed · run 4 has not started');
  assert.equal(reqChangeHead(E({ case: 'waiting' })), 'R-po-3 changed · run 4 is waiting');
  assert.equal(reqChangeHead(E({ case: 'running' })), 'R-po-3 changed · run 4 was running');
  assert.equal(reqChangeHead(E({ case: 'finished', run: 7, added: 9 })), 'R-po-3 changed · run 7 is finished');
  assert.equal(reqChangeHead(E({ case: 'none', run: null })), 'R-po-3 changed');
});

test('notices: one line, verbatim, the owner run never repeated', () => {
  const t = { time: '15:03' };
  const q = '“reset emails retry once, within 20 seconds”';
  assert.equal(reqChangeNotice(E(), t), `Changed in chat at 15:03: ${q}. It plans from the new text. You are told, not asked.`);
  assert.equal(reqChangeNotice(E({ case: 'waiting' }), t), `Changed in chat at 15:03: ${q}. It plans from the new text when it resumes. You are told, not asked.`);
  assert.equal(reqChangeNotice(E({ case: 'waiting', closedAsk: true }), t),
    `Changed in chat at 15:03: ${q}. Its open question was closed; it plans from the new text when it resumes. You are told, not asked.`);
  assert.equal(reqChangeNotice(E({ case: 'running', source: { kind: 'run', run: 5 } }), t),
    `Changed from run 5's review at 15:03: ${q}. It stopped, re-plans from the new text and continues. You are told, not asked.`);
  assert.equal(reqChangeNotice(E({ case: 'finished', run: 2, added: 9, source: { kind: 'run', run: 5 } }), t),
    `Changed from run 5's review at 15:03: ${q}. Run 9, a small change run, takes the next turn. You are told, not asked.`);
  const self = reqChangeNotice(E({ case: 'waiting', self: true, source: { kind: 'run', run: 4 } }), t);
  assert.match(self, /It re-plans from the new text now\. You are told, not asked\.$/);
  for (const c of ['not-started', 'waiting', 'running', 'finished']) {
    const e = E({ case: c, self: c === 'waiting', source: { kind: 'run', run: 4 }, ...(c === 'finished' ? { added: 9 } : {}) });
    const both = `${reqChangeHead(e)} ${reqChangeNotice(e, t)}`;
    assert.equal((both.match(/\b[Rr]un 4\b/g) || []).length, 1, `${c}: ${both}`);
  }
  const long = reqChangeNotice(E({ to: 'x'.repeat(300) }), t);
  assert.ok(long.includes(`“${'x'.repeat(119)}…”`));
});

test('log rows', () => {
  assert.equal(reqChangeLogText(E({ case: 'finished', run: 7, added: 9 })), 'R-po-3 changed · run 9 added: a small change run');
  assert.equal(reqChangeLogText(E({ case: 'running' })), 'R-po-3 changed · run 4 re-planned from the new text');
  assert.equal(reqChangeLogText(E({ case: 'waiting', self: true })), 'R-po-3 changed · run 4 re-planned from the new text');
  assert.equal(reqChangeLogText(E()), 'R-po-3 changed · run 4 plans from the new text');
  assert.equal(reqChangeLogText(E({ case: 'waiting' })), 'R-po-3 changed · run 4 plans from the new text');
  assert.equal(reqChangeLogText(E({ case: 'none', run: null })), 'R-po-3 changed');
});

test('requirementChangedFeedback: a section, one line per id, the change run for a non-owner asker', () => {
  const ch = [{ id: 'R-po-3', from: 'a', to: 'b b' }, { id: 'R-arch-1', from: 'c', to: 'd' }];
  assert.equal(requirementChangedFeedback(ch), '## Requirement changed\n\nR-po-3 now reads: b b\nR-arch-1 now reads: d\n');
  assert.equal(requirementChangedFeedback(ch.slice(0, 1), { changeRun: 9 }),
    '## Requirement changed\n\nR-po-3 now reads: b b\n\nRun 9 builds this change; plan your own requirements against the new text.\n');
});

test('normalizeChange: the codes', () => {
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'a', to: '  b  ' }), { ok: true, change: { id: 'R-po-3', from: 'a', to: 'b' } });
  assert.deepEqual(normalizeChange({ id: 'R-3', from: 'a', to: 'b' }), { ok: false, code: 'INVALID_ID' });
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'a', to: '  ' }), { ok: false, code: 'INVALID_TEXT' });
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'a', to: 'x'.repeat(301) }), { ok: false, code: 'INVALID_TEXT' });
  assert.equal(normalizeChange({ id: 'R-po-3', from: 'a', to: 'x'.repeat(300) }).ok, true);
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'b', to: 'b' }), { ok: false, code: 'UNCHANGED' });
  assert.deepEqual(normalizeChange(null), { ok: false, code: 'INVALID_ID' });
  // One line: a newline can add no criterion line and no prompt line.
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'a', to: ' b\n- R-po-9: c\r\n\n## Prompt\t d ' }),
    { ok: true, change: { id: 'R-po-3', from: 'a', to: 'b - R-po-9: c ## Prompt d' } });
  assert.deepEqual(normalizeChange({ id: 'R-po-3', from: 'b c', to: 'b\nc' }), { ok: false, code: 'UNCHANGED' });
});
