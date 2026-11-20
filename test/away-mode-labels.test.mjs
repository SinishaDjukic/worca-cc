import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awayAnswersSummary, KIND_LABELS, METHOD_OPTIONS, CRITERIA_LABELS, FIELD_LABELS, RUN_SWITCH_OPTIONS, STATUS_ACTIONS, statusActions, GRACE_NO_HOURS, kindLabel, pillText, KIND_SHORT, kindShort, awayAnswerRows, awayAnswerCounts, checksFirst, DECIDER_WORDS, awayAskCaption } from '../src/shared/away-mode/labels.mjs';
import { floorText } from '../src/shared/cost/breakdown.mjs';
import { NIGHT_KINDS, NIGHT_STRATEGIES, NIGHT_CRITERIA, NIGHT_FIELDS } from '../src/core/night/config.mjs';
import { checkRows } from './helpers/rows.mjs';

test('every kind, method, criterion and field has a label and a short caption (unknown kind falls back to its name)', async () => {
  await checkRows([
    { name: 'every kind, method, criterion and field has a plain label', run: () => {
      for (const k of NIGHT_KINDS) assert.ok(KIND_LABELS[k], k);
      assert.deepEqual(METHOD_OPTIONS.map((m) => m.value).sort(), [...NIGHT_STRATEGIES].sort());
      for (const c of NIGHT_CRITERIA) assert.ok(CRITERIA_LABELS[c], c);
      for (const f of NIGHT_FIELDS) assert.ok(FIELD_LABELS[f]?.label, f);
    } },
    { name: 'kindShort: a short caption for every kind the answers list shows', run: () => {
      for (const k of [...NIGHT_KINDS, 'cost-cap']) assert.ok(KIND_SHORT[k], k);
      assert.equal(kindShort('clarify'), 'Clarifying questions');
      assert.equal(kindShort('gate'), 'Review loop');
      assert.equal(kindShort('mystery'), 'mystery', 'an unknown kind falls back to its name');
    } },
  ]);
});

test('a plan record reads Approved under Plan approval', () => {
  assert.equal(NIGHT_KINDS.includes('plan'), false, 'a record kind only, like cost-cap');
  assert.equal(kindLabel('plan'), 'Approving a plan');
  assert.equal(kindShort('plan'), 'Plan approval');
  const d = { kind: 'plan', choice: 'approve', strategy: 'rule', flagged: true, rationale: 'a reviewer raised a concern on an agreed requirement: X; the requirement stays as agreed' };
  assert.deepEqual(awayAnswerRows(d), [{ q: null, a: 'Approved', why: 'A reviewer raised a concern on an agreed requirement: X; the requirement stays as agreed.', check: true }]);
  assert.deepEqual(awayAskCaption(d, { fmtUsd: (n) => `$${n.toFixed(2)}` }), ['rule', '$0.00']);
  assert.deepEqual(awayAnswerCounts([d]), { answers: 1, checks: 1 });
});

test('awayAskCaption: a review names its model and cost, a stopped one its lower bound; no review → how, $0.00; a pause or an old review → nothing', () => {
  const f = (n) => `$${Number(n).toFixed(2)}`;
  const m = (id) => (id === 'claude-opus-5-5' ? 'Opus 5.5' : null);
  const cap = (d) => awayAskCaption(d, { fmtUsd: f, modelLabel: m, fmtFloor: (v) => floorText(v, f) });
  const review = { kind: 'clarify', choice: 'Redis', strategy: 'analysis', model: 'claude-opus-5-5', reviewId: 'night-decider-ab12cd34', reviewStatus: 'finished', tokens: 900 };
  assert.deepEqual(cap({ ...review, costUsd: 0.05 }), ['Opus 5.5', '$0.05']);
  assert.deepEqual(cap({ ...review, costUsd: 0 }), ['Opus 5.5', '$0.00'], 'a $0 review (mock, free model) still shows its cost');
  assert.deepEqual(cap({ ...review, reviewStatus: 'error', costUsd: 0.01 }), ['Opus 5.5', '$0.01'], 'priced, then failed: its cost was booked');
  assert.deepEqual(cap({ ...review, strategy: 'weights+analysis', costUsd: 0.07 }), ['Opus 5.5', '$0.07'], 'a mixed ask: one review answered it');
  assert.deepEqual(cap({ ...review, model: null, costUsd: 0.05 }), [DECIDER_WORDS.defaultModel, '$0.05'], 'no model named: the CLI default');
  assert.deepEqual(cap({ ...review, model: 'gone-model', costUsd: 0.05 }), [DECIDER_WORDS.defaultModel, '$0.05'], 'modelLabel decides the words; the app passes the id as its fallback');
  const stopped = { ...review, reviewStatus: 'stopped', costUsd: null, tokens: 1800 };
  assert.deepEqual(cap({ ...stopped, floorUsd: 0.0234 }), ['Opus 5.5', 'review stopped', '≥$0.02', 'not in total'], 'a lower bound, apart — never "$0.00"');
  assert.deepEqual(cap({ ...stopped, floorUsd: null }), ['Opus 5.5', 'review stopped'], 'no list price: no figure');
  assert.deepEqual(cap({ ...stopped, floorUsd: 0 }), ['Opus 5.5', 'review stopped'], 'a {free} model: never "≥$0.00"');
  assert.deepEqual(awayAskCaption({ ...stopped, floorUsd: 0.0234 }, { fmtUsd: f, modelLabel: m }), ['Opus 5.5', 'review stopped'], 'no fmtFloor: no figure');
  assert.deepEqual(cap({ kind: 'clarify', choice: 'a', strategy: 'analysis', model: 'claude-opus-5-5', costUsd: 0.04 }), ['Opus 5.5', '$0.04'], 'a booked cost names the review even without its id');
  assert.deepEqual(cap({ kind: 'gate', choice: 'continue', strategy: 'rule' }), ['rule', '$0.00']);
  assert.deepEqual(cap({ kind: 'clarify', choice: 'a', strategy: 'weights' }), ["agent's pick", '$0.00']);
  assert.deepEqual(cap({ kind: 'form', choice: '{}', strategy: 'defaults' }), ['defaults', '$0.00']);
  assert.deepEqual(cap({ kind: 'clarify', choice: 'a', strategy: 'auto' }), ['defaults', '$0.00']);
  assert.deepEqual(cap({ kind: 'clarify', choice: 'a', strategy: 'analysis', model: 'claude-opus-5-5' }), [], 'stored before the cost was kept: nothing invented');
  assert.deepEqual(cap({ kind: 'clarify', choice: 'a | b', strategy: 'analysis+weights', model: 'claude-opus-5-5' }), []);
  assert.deepEqual(cap({ kind: 'clarify', choice: null, strategy: 'guardrail', guardrail: 'maxDecisions' }), [], 'a pause is not an answer');
  assert.deepEqual(cap(null), []);
});

test('status actions: modes per toggle ("I\'m back" = here), same buttons without hours, pill text', async () => {
  await checkRows([
    { name: 'run switch, status actions and pill wording', run: () => {
      assert.deepEqual(RUN_SWITCH_OPTIONS.map((o) => [o.value, o.label]), [['auto', 'As set up'], ['on', 'Answer for me now'], ['off', 'Never on this run']]);
      assert.deepEqual(STATUS_ACTIONS.auto.map((a) => a.label), ["I'm away now", 'Pause away mode']);
      assert.deepEqual(STATUS_ACTIONS.on.map((a) => a.label), ["I'm back"]);
      assert.equal(STATUS_ACTIONS.on[0].mode, 'here', '"I\'m back" counts as here, even inside the away hours');
      assert.deepEqual(STATUS_ACTIONS.off.map((a) => a.label), ['Turn away mode back on']);
      assert.equal(kindLabel('gate'), 'Fix again or continue, in a review loop');
      assert.equal(kindLabel('cost-cap'), "Continuing past the team's cost cap");
      assert.equal(pillText('after', 12), 'answers after 12 min');
      assert.equal(pillText('now'), 'answering');
    } },
    { name: 'no away hours set: no status button talks about away hours', run: () => {
      for (const t of ['auto', 'on', 'off']) {
        const withHours = statusActions(t, { hours: true });
        const none = statusActions(t, { hours: false });
        assert.deepEqual(withHours, STATUS_ACTIONS[t], 'with hours: the table as it is');
        assert.deepEqual(none.map((a) => [a.mode, a.label]), STATUS_ACTIONS[t].map((a) => [a.mode, a.label]), 'same buttons');
        for (const a of none) assert.doesNotMatch(a.tip, /away hours|by day/i, `${t}: ${a.tip}`);
      }
      assert.equal(statusActions('off', { hours: false })[0].tip, 'worca answers again when you say you are away.');
      assert.deepEqual(GRACE_NO_HOURS, { label: 'Marked runs', hint: 'A marked run is answered once a question has waited this long. Unmarked runs wait for you.', never: 'Never', neverHint: 'Marked runs wait for you, like every other run.' });
    } },
  ]);
});

test('awayAnswersSummary: the one line every end-of-run channel uses', () => {
  assert.equal(awayAnswersSummary({ decisions: 5, flagged: 2 }), '5 answers while you were away — 2 to check');
  assert.equal(awayAnswersSummary({ decisions: 1, flagged: 0 }), '1 answer while you were away — nothing to check');
  assert.equal(awayAnswersSummary({ decisions: 0, flagged: 0 }), null);
  assert.equal(awayAnswersSummary(null), null);
  assert.equal(awayAnswersSummary({ decisions: 2, flagged: 9 }), '2 answers while you were away — 2 to check', 'never more to check than answers');
  // Per-question counts win over the per-ask ones when the run has them.
  assert.equal(awayAnswersSummary({ decisions: 1, flagged: 1, answers: 7, checks: 2 }), '7 answers while you were away — 2 to check');
  assert.equal(awayAnswersSummary({ decisions: 1, flagged: 0, answers: 3, checks: 0 }), '3 answers while you were away — nothing to check');
});

test('awayAnswerCounts: counts the rows the answers list shows, not the stored asks', () => {
  const clarify = { kind: 'clarify', choice: 'a | b | c', flagged: true, questions: [
    { id: 'q1', choice: 'a', flagged: false }, { id: 'q2', choice: 'b', flagged: true }, { id: 'q3', choice: 'c', flagged: true },
  ] };
  assert.deepEqual(awayAnswerCounts([clarify]), { answers: 3, checks: 2 });
  // A pause is a row but not an answer; a flagged form with no question marked marks them all.
  const pause = { kind: 'clarify', choice: null, guardrail: 'maxDecisions' };
  const form = { kind: 'form', choice: 'defaults', flagged: true, questions: [{ id: 'a', choice: 'x' }, { id: 'b', choice: 'y' }] };
  const gate = { kind: 'gate', choice: 'continue', flagged: false };
  assert.deepEqual(awayAnswerCounts([clarify, pause, form, gate]), { answers: 6, checks: 4 });
  assert.deepEqual(awayAnswerCounts([]), { answers: 0, checks: 0 });
  assert.deepEqual(awayAnswerCounts(null), { answers: 0, checks: 0 });
});

test('checksFirst: the rows to check lead, each side keeps its order', () => {
  const rows = [{ a: '1', check: false }, { a: '2', check: true }, { a: '3', check: false }, { a: '4', check: true }];
  assert.deepEqual(checksFirst(rows).map((r) => r.a), ['2', '4', '1', '3']);
});

test('awayAnswerRows per question: wording/answer/reason, id fallback, free-text = to check, unmarked flagged ask marks all', async () => {
  await checkRows([
    { name: 'awayAnswerRows: one row per answered question, its wording, the answer and its reason', run: () => {
      const rows = awayAnswerRows({ kind: 'clarify', choice: 'Live | Devs', flagged: true, rationale: 'delivery: x\naudience: y', questions: [
        { id: 'delivery', question: 'How will the deck be delivered?', choice: 'Live', flagged: true, rationale: 'the agent was not sure enough; took the option easiest to undo. It ships narration.' },
        { id: 'audience', question: 'Who is it for?', choice: 'Devs', flagged: false, rationale: 'it fits the brief' },
      ] });
      assert.deepEqual(rows, [
        { q: 'How will the deck be delivered?', a: 'Live', why: 'The agent was not sure enough; took the option easiest to undo. It ships narration.', check: true },
        { q: 'Who is it for?', a: 'Devs', why: 'It fits the brief.', check: false },
      ]);
    } },
    { name: 'awayAnswerRows: a row saved before the question text was stored reads its id', run: () => {
      const qs = [{ id: 'feature-scope' }, { id: 'q2' }, { id: 'brandKit' }, { id: '' }].map((x) => ({ ...x, choice: 'A', flagged: false, rationale: '' }));
      assert.deepEqual(awayAnswerRows({ kind: 'clarify', choice: 'A', questions: qs }).map((r) => [r.q, r.why]),
        [['Feature scope', ''], ['Question 2', ''], ['Brand kit', ''], ['Question', '']]);
    } },
    { name: 'awayAnswerRows: a free-text question has no answer and is to check', run: () => {
      assert.deepEqual(awayAnswerRows({ kind: 'questions', choice: '', flagged: true, questions: [{ id: 'name', question: 'Name it?', choice: '', flagged: true, rationale: 'free-text question; worca cannot answer it' }] }),
        [{ q: 'Name it?', a: 'No answer', why: 'Free-text question; worca cannot answer it.', check: true }]);
    } },
    { name: 'awayAnswerRows: a flagged ask whose questions are not marked marks every row', run: () => {
      const rows = awayAnswerRows({ kind: 'form', choice: '{}', flagged: true, questions: [{ id: 'a', question: 'A?', choice: 'x', flagged: false }, { id: 'b', question: 'B?', choice: 'y', flagged: false }] });
      assert.deepEqual(rows.map((r) => r.check), [true, true]);
    } },
  ]);
});

test('awayAnswerRows: question-less asks read as one outcome; a limit row is a pause, never to check', async () => {
  await checkRows([
    { name: 'awayAnswerRows: asks without questions read as one outcome', run: () => {
      const one = (d) => awayAnswerRows(d);
      assert.deepEqual(one({ kind: 'gate', choice: 'continue', flagged: false, rationale: 'no critical issues left, continuing' }),
        [{ q: null, a: 'Continued', why: 'No critical issues left, continuing.', check: false }]);
      assert.equal(one({ kind: 'gate', choice: 'another', flagged: false })[0].a, 'One more fix round');
      assert.equal(one({ kind: 'workflow', choice: 'accept', flagged: false })[0].a, 'Accepted');
      assert.equal(one({ kind: 'recovery', choice: 'retry', flagged: false })[0].a, 'Retried');
      assert.equal(one({ kind: 'recovery', choice: 'pause', flagged: true })[0].a, 'Stopped retrying');
      assert.equal(one({ kind: 'cost-cap', choice: 'continue', flagged: true })[0].a, 'Continued past the cap');
      assert.deepEqual(one({ kind: 'form', choice: '{"a":1}', strategy: 'defaults', flagged: false, questions: [], rationale: "the form's default values" }),
        [{ q: null, a: 'Default values', why: '', check: false }]);
      assert.equal(one({ kind: 'clarify', choice: '{"answers":[]}', strategy: 'auto', flagged: true, rationale: 'gave the --yes answer instead: x' })[0].a, 'Default answer');
    } },
    { name: 'awayAnswerRows: a limit row is a pause, never one to check', run: () => {
      assert.deepEqual(awayAnswerRows({ kind: 'clarify', choice: null, guardrail: 'maxDecisions', flagged: true, rationale: 'Paused: worca answered 3 times on this run, the limit you set.' }),
        [{ q: null, a: 'Paused: answer limit reached', why: 'Paused: worca answered 3 times on this run, the limit you set.', check: false }]);
      assert.equal(awayAnswerRows({ kind: 'gate', choice: null, guardrail: 'spendCap', flagged: true })[0].a, 'Paused: spending cap reached');
      assert.equal(awayAnswerRows({ kind: 'gate', choice: null, flagged: true })[0].a, 'Paused');
    } },
  ]);
});

test('awayAnswerRows: only an answer the review gave names its model (judged per question)', () => {
  const qs = [
    { id: 'store', question: 'Which store?', choice: 'Redis', strategy: 'analysis', confidence: 80, flagged: false, rationale: 'fits' },
    { id: 'tone', question: 'Which tone?', choice: 'Calm', strategy: 'weights', confidence: 90, flagged: false, rationale: 'the agent recommended this at 90%, well ahead of the next option' },
    { id: 'size', question: 'Which size?', choice: 'S', strategy: 'analysis', confidence: null, flagged: true, rationale: 'could not weigh the options (boom); first option taken' },
  ];
  const rows = awayAnswerRows({ kind: 'clarify', choice: 'Redis | Calm | S', strategy: 'analysis+weights', model: 'claude-opus-5-5', effort: 'high', flagged: true, questions: qs });
  assert.deepEqual(rows.map((r) => r.by), ['claude-opus-5-5', undefined, undefined]);
  assert.equal('by' in rows[1], false, 'no key at all on a row the review did not give');
  assert.equal('by' in rows[2], false, 'a review that failed gave no answer');
  // The review ran with no model named (no run model, nothing set): null = the CLI default.
  assert.equal(awayAnswerRows({ kind: 'clarify', choice: 'Redis', model: null, effort: 'medium', questions: [qs[0]] })[0].by, null);
  // A record stored before the model was kept shows none, even for an answer the review gave.
  assert.equal('by' in awayAnswerRows({ kind: 'clarify', choice: 'Redis', questions: [qs[0]] })[0], false);
  // Rule-based answers never show one.
  assert.equal('by' in awayAnswerRows({ kind: 'gate', choice: 'continue', strategy: 'rule', model: 'claude-opus-5-5' })[0], false);
});
