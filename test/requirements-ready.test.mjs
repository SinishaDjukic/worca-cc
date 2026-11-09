// test/requirements-ready.test.mjs — readiness, displayed state, changes since a start (A2 D1, D2, D4, D11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readiness, unaskedFiles, unaskedRejections, displayState, changedSince, OVERRIDABLE } from '../src/core/requirements/ready.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';

const good = () => {
  const s = emptySpec();
  s.goal = { text: 'Export reports', measure: 'under 5 s' };
  s.criteria = [{ id: 'R-po-1', text: 'Exports CSV' }];
  return s;
};
const feat = (spec, extra = {}) => ({ spec, status: 'done', ...extra });
const done = [{ id: 5, kind: 'round', payload: { done: true, questions: [] } }];
const byKey = (r, k) => r.checks.find((c) => c.key === k);

test('all six pass', () => {
  const r = readiness(feat(good()), { turns: done });
  assert.equal(r.ok, true); assert.equal(r.passed, 6); assert.equal(r.total, 6);
  assert.deepEqual(r.checks.map((c) => c.key), ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions', 'target']);
  assert.equal(r.overridable, false);
  assert.deepEqual([...OVERRIDABLE], ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions']);
});

test('goal', () => {
  const s = good(); s.goal.measure = '';
  let c = byKey(readiness(feat(s), { turns: done }), 'goal');
  assert.equal(c.ok, false); assert.equal(c.hint, 'add a success measure'); assert.equal(c.label, 'Goal with a success measure');
  s.goal.text = '';
  c = byKey(readiness(feat(s), { turns: done }), 'goal');
  assert.equal(c.hint, 'no goal yet');
});

test('criteria labels', () => {
  const s = good();
  assert.equal(byKey(readiness(feat(s), { turns: done }), 'criteria').label, '1 acceptance criterion');
  s.criteria.push({ id: 'R-po-2', text: 'b' });
  assert.equal(byKey(readiness(feat(s), { turns: done }), 'criteria').label, '2 acceptance criteria');
  s.criteria = [];
  const c = byKey(readiness(feat(s), { turns: done }), 'criteria');
  assert.equal(c.ok, false); assert.equal(c.label, 'No acceptance criteria'); assert.equal(c.hint, 'add at least one');
});

test('interview', () => {
  const open = [{ id: 1, kind: 'round', payload: { done: false, questions: [{}] } }];
  let c = byKey(readiness(feat(good()), { turns: open }), 'interview');
  assert.equal(c.ok, false); assert.equal(c.hint, 'not finished'); assert.equal(c.label, 'Interview finished');
  c = byKey(readiness(feat(good(), { pending: { questions: [1] } }), { turns: open }), 'interview');
  assert.equal(c.hint, '1 question waiting');
  c = byKey(readiness(feat(good(), { pending: { questions: [1, 2, 3] } }), { turns: open }), 'interview');
  assert.equal(c.hint, '3 questions waiting');
  assert.equal(byKey(readiness(feat(good())), 'interview').ok, false);
  const t = [{ id: 1, kind: 'round', payload: { done: true } }, { id: 4, kind: 'round', payload: { done: false } }];
  assert.equal(byKey(readiness(feat(good()), { turns: t }), 'interview').ok, false);
});

test('open questions', () => {
  const s = good(); s.openQuestions = ['a', 'b'];
  const c = byKey(readiness(feat(s), { turns: done }), 'openQuestions');
  assert.equal(c.ok, false); assert.equal(c.hint, '2 open'); assert.equal(c.label, 'No open questions');
});

test('assumptions: open and rejected hints', () => {
  const s = good();
  s.assumptions = [{ id: 'A-1', text: 'x', status: 'open' }, { id: 'A-2', text: 'y', status: 'open' }];
  let c = byKey(readiness(feat(s), { turns: done }), 'assumptions');
  assert.equal(c.ok, false); assert.equal(c.hint, '2 to decide'); assert.equal(c.label, 'Every assumption decided');
  s.assumptions = [{ id: 'A-4', text: 'x', status: 'rejected' }];
  c = byKey(readiness(feat(s), { turns: done }), 'assumptions');
  assert.equal(c.hint, 'A-4 rejected: ask about it');
  s.assumptions.push({ id: 'A-7', text: 'z', status: 'rejected' });
  c = byKey(readiness(feat(s), { turns: done }), 'assumptions');
  assert.equal(c.hint, 'A-4, A-7 rejected: ask about them');
});

test('rejected then round after passes; round before fails', () => {
  const s = good(); s.assumptions = [{ id: 'A-4', text: 'x', status: 'rejected' }];
  const rej = { id: 6, kind: 'assumption', payload: { id: 'A-4', status: 'rejected' } };
  const before = [{ id: 2, kind: 'round', payload: { done: true } }, rej];
  assert.deepEqual(unaskedRejections(s, before), ['A-4']);
  assert.equal(byKey(readiness(feat(s), { turns: before }), 'assumptions').ok, false);
  const after = [...before, { id: 7, kind: 'round', payload: { done: false, questions: [{ id: 'q', question: 'Q?', options: ['a', 'b'] }] } }];
  assert.deepEqual(unaskedRejections(s, after), []);
  assert.equal(byKey(readiness(feat(s), { turns: after }), 'assumptions').ok, true);
});

test('rejection: latest rejecting turn counts, bulk form, no turn', () => {
  const s = good(); s.assumptions = [{ id: 'A-1', text: 'x', status: 'rejected' }, { id: 'A-2', text: 'y', status: 'rejected' }];
  const turns = [
    { id: 1, kind: 'assumption', payload: { id: 'A-1', status: 'rejected' } },
    { id: 2, kind: 'round', payload: { done: false } },
    { id: 3, kind: 'assumption', payload: { id: 'A-1', status: 'confirmed' } },
    { id: 4, kind: 'assumption', payload: { ids: ['A-1', 'A-2'], status: 'rejected' } },
  ];
  assert.deepEqual(unaskedRejections(s, turns), ['A-1', 'A-2']);
  assert.deepEqual(unaskedRejections(s, []), ['A-1', 'A-2']);
});

test('target missing', () => {
  let r = readiness(feat(good()), { turns: done, target: { ok: false } });
  assert.equal(r.ok, false); assert.equal(r.passed, 5); assert.equal(byKey(r, 'target').ok, false);
  assert.equal(byKey(r, 'target').hint, 'the project or workspace is missing');
  assert.equal(r.overridable, false);
  r = readiness(feat(good()), { turns: done, target: { ok: false, hint: 'folder gone' } });
  assert.equal(byKey(r, 'target').hint, 'folder gone');
  assert.equal(byKey(readiness(feat(good()), { turns: done }), 'target').label, 'Project or workspace exists');
  const lab = readiness(feat(good()), { turns: done, target: { ok: true, label: 'Project foo is registered' } });
  assert.equal(byKey(lab, 'target').label, 'Project foo is registered');
});

test('overridable', () => {
  const s = good(); s.criteria = [];
  assert.equal(readiness(feat(s), { turns: done }).overridable, true);
  assert.equal(readiness(feat(s), { turns: done, target: { ok: false } }).overridable, false);
});

test('displayState', () => {
  const ok = { ok: true }, no = { ok: false };
  const st = [{ id: 1 }];
  assert.equal(displayState({ status: 'archived' }, { starts: st }), 'archived');
  assert.equal(displayState({ status: 'looking' }), 'looking');
  assert.equal(displayState({ status: 'thinking' }), 'thinking');
  assert.equal(displayState({ status: 'your_turn', busy: 'looking' }), 'looking');
  assert.equal(displayState({ status: 'your_turn', busy: 'thinking' }), 'thinking');
  assert.equal(displayState({ status: 'done', busy: true }, { starts: st }), 'thinking');
  assert.equal(displayState({ status: 'archived', busy: true }, { starts: st }), 'archived');
  assert.equal(displayState({ status: 'your_turn' }, { starts: st }), 'started');
  assert.equal(displayState({ status: 'done' }, { starts: st, ready: no }), 'started');
  assert.equal(displayState({ status: 'your_turn' }), 'your_turn');
  assert.equal(displayState({ status: 'done' }, { ready: ok }), 'ready');
  assert.equal(displayState({ status: 'done' }, { ready: no }), 'decide');
});

test('changedSince', () => {
  const a = good(); a.actors = ['admin']; a.assumptions = [{ id: 'A-1', text: 'x', status: 'open' }];
  assert.deepEqual(changedSince(a, structuredClone(a)), []);
  const b = structuredClone(a);
  b.goal.measure = 'under 2 s';
  b.actors = ['admin', 'guest']; b.rules = ['r1'];
  b.criteria = [{ id: 'R-po-3', text: 'new' }];
  b.assumptions = [{ id: 'A-1', text: 'x', status: 'confirmed' }, { id: 'A-2', text: 'y', status: 'open' }];
  assert.deepEqual(changedSince(a, b), [
    { kind: 'goal', field: 'measure', before: 'under 5 s', after: 'under 2 s' },
    { kind: 'section', section: 'actors', added: ['guest'], removed: [] },
    { kind: 'section', section: 'rules', added: ['r1'], removed: [] },
    { kind: 'criterion', id: 'R-po-3', change: 'added', after: 'new' },
    { kind: 'criterion', id: 'R-po-1', change: 'removed', before: 'Exports CSV' },
    { kind: 'assumption', id: 'A-1', change: 'status', before: 'open', after: 'confirmed' },
    { kind: 'assumption', id: 'A-2', change: 'added', after: 'y' },
  ]);
  const c = structuredClone(a);
  c.goal.text = 'Other'; c.flow = ['s']; c.criteria[0].text = 'Exports XLSX'; c.criteria[0].edited = true; c.actors = [];
  assert.deepEqual(changedSince(a, c), [
    { kind: 'goal', field: 'text', before: 'Export reports', after: 'Other' },
    { kind: 'section', section: 'actors', added: [], removed: ['admin'] },
    { kind: 'section', section: 'flow', added: ['s'], removed: [] },
    { kind: 'criterion', id: 'R-po-1', change: 'edited', before: 'Exports CSV', after: 'Exports XLSX' },
  ]);
  assert.deepEqual(changedSince(null, null), []);
});

test('asked about: a follow-up round for its own ids (even with no questions); an ordinary round only when it asked', () => {
  const s = good(); s.assumptions = [{ id: 'A-4', text: 'x', status: 'rejected' }, { id: 'A-5', text: 'y', status: 'rejected' }];
  const rej = { id: 6, kind: 'assumption', payload: { ids: ['A-4', 'A-5'], status: 'rejected' } };
  const Q1 = [{ id: 'q', question: 'Q?', options: ['a', 'b'] }];
  // a follow-up round that came back done with no questions asked about its ids (nothing was left to ask),
  // never about the others
  const empty = [rej, { id: 7, kind: 'followup', payload: { assumptions: ['A-4'] } },
    { id: 8, kind: 'round', payload: { done: true, questions: [], followUp: ['A-4'] } }];
  assert.deepEqual(unaskedRejections(s, empty), ['A-5']);
  assert.equal(byKey(readiness(feat(s), { turns: empty }), 'assumptions').ok, false);
  const both = [rej, { id: 8, kind: 'round', payload: { done: true, questions: [], followUp: ['A-4', 'A-5'] } }];
  assert.deepEqual(unaskedRejections(s, both), []);
  assert.equal(byKey(readiness(feat(s), { turns: both }), 'assumptions').ok, true);
  // a follow-up round with questions counts for the ids it was about, not for the others
  const one = [rej, { id: 8, kind: 'round', payload: { done: false, questions: Q1, followUp: ['A-4'] } }];
  assert.deepEqual(unaskedRejections(s, one), ['A-5']);
  // an ordinary round counts only when it asked something
  assert.deepEqual(unaskedRejections(s, [rej, { id: 8, kind: 'round', payload: { done: true, questions: [] } }]), ['A-4', 'A-5']);
  assert.deepEqual(unaskedRejections(s, [rej, { id: 8, kind: 'round', payload: { done: false, questions: Q1 } }]), []);
});

// ── A8 D8: files added or replaced after the interview ─────────────────
const fileTurn = (id, action, fileId) => ({ id, kind: 'file', payload: { action, id: fileId, name: `${fileId}.pdf` } });
/** A round; `files`: the files whose text its prompt carried (runRound records them). */
const roundTurn = (id, done = true, files = []) => ({ id, kind: 'round', payload: { questions: [], done, ...(files.length ? { files } : {}) } });
const file = (id, status = 'done') => ({ id, name: `${id}.pdf`, status });

test('unaskedFiles: changed after the last round that carried it; reading counts, failed and unread-budget do not; a start ends it', () => {
  const turns = [fileTurn(1, 'added', 'a'), roundTurn(2, true, ['a']), fileTurn(3, 'added', 'b'), fileTurn(4, 'read', 'a'), fileTurn(5, 'replaced', 'a'), fileTurn(6, 'added', 'c'), fileTurn(7, 'added', 'd')];
  assert.deepEqual(unaskedFiles([file('a'), file('b', 'reading'), file('c', 'failed'), file('d', 'unread-budget')], turns), ['a', 'b']);
  assert.deepEqual(unaskedFiles([file('a')], [...turns, roundTurn(8, true, ['a'])]), []);
  assert.deepEqual(unaskedFiles([file('a')], [...turns, roundTurn(8)]), ['a'], 'a round that did not carry the file has not asked about it');
  assert.deepEqual(unaskedFiles([file('a')], [...turns, { id: 9, kind: 'start', payload: { version: 1 } }]), []);
  assert.deepEqual(unaskedFiles([file('x')], [roundTurn(1)]), [], 'no added turn: nothing to ask');
});

test('readiness: the interview check fails with "<name> to ask about" / "N files to ask about"; waiting questions come first', () => {
  const f = { spec: { goal: { text: 'g', measure: 'm' }, criteria: [{ id: 'R-po-1', text: 'c' }], assumptions: [], openQuestions: [] } };
  const turns = [roundTurn(1), fileTurn(2, 'added', 'a'), fileTurn(3, 'added', 'b')];
  const check = (files, extra = {}) => readiness({ ...f, ...extra }, { turns, files }).checks.find((c) => c.key === 'interview');
  assert.deepEqual([check([file('a')]).ok, check([file('a')]).hint], [false, 'a.pdf to ask about']);
  assert.equal(check([file('a'), file('b')]).hint, '2 files to ask about');
  assert.equal(check([]).ok, true);
  assert.equal(check([file('a')], { pending: { questions: [{}] } }).hint, '1 question waiting');
});

test('changedSince: a file added to the send set, left out of it, or replaced is one line each', () => {
  const was = [{ id: 'a', name: 'a.pdf', sha256: '1' }, { id: 'b', name: 'b.md', sha256: '2' }, { id: 'c', name: 'c.png', sha256: '3' }];
  const now = [{ id: 'a', name: 'a.pdf', sha256: '1' }, { id: 'c', name: 'c-v2.png', sha256: '9' }, { id: 'd', name: 'd.md', sha256: '4' }];
  assert.deepEqual(changedSince({}, {}, { filesBefore: was, filesNow: now }), [
    { kind: 'file', change: 'replaced', name: 'c-v2.png' }, { kind: 'file', change: 'added', name: 'd.md' }, { kind: 'file', change: 'removed', name: 'b.md' }]);
  assert.deepEqual(changedSince({}, {}), [], 'no file lists: no file lines');
  assert.deepEqual(changedSince({}, {}, { filesBefore: was, filesNow: was }), [], 'the same files: no file lines');
});
test('readiness: while a file to ask about is still being read, the interview check says "Reading N files…" (A8 D2/D8)', () => {
  const f = { spec: { goal: { text: 'g', measure: 'm' }, criteria: [{ id: 'R-po-1', text: 'c' }], assumptions: [], openQuestions: [] } };
  const turns = [roundTurn(1), fileTurn(2, 'added', 'a'), fileTurn(3, 'added', 'b')];
  const check = (files, extra = {}) => readiness({ ...f, ...extra }, { turns, files }).checks.find((c) => c.key === 'interview');
  assert.deepEqual([check([file('a', 'reading')]).ok, check([file('a', 'reading')]).hint], [false, 'Reading 1 file…']);
  assert.equal(check([file('a', 'reading'), file('b', 'reading')]).hint, 'Reading 2 files…');
  assert.equal(check([file('a', 'reading'), file('b')]).hint, 'Reading 1 file…', 'the follow-up waits for the read');
  assert.equal(check([file('a', 'reading')], { pending: { questions: [{}] } }).hint, '1 question waiting');
});

test('A6.1 D10 (plan review M4): a ticket file still downloading counts as one still being read: to ask about, and the reading hint', () => {
  const f = { spec: { goal: { text: 'g', measure: 'm' }, criteria: [{ id: 'R-po-1', text: 'c' }], assumptions: [], openQuestions: [] } };
  const turns = [fileTurn(1, 'added', 'a'), roundTurn(2)];   // round 1 ran after its wait, without the file in payload.files
  assert.deepEqual(unaskedFiles([file('a', 'downloading')], turns), ['a']);
  const c = readiness(f, { turns, files: [file('a', 'downloading')] }).checks.find((x) => x.key === 'interview');
  assert.deepEqual([c.ok, c.hint], [false, 'Reading 1 file…']);
});
