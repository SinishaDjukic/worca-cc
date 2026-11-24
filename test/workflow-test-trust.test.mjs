// test/workflow-test-trust.test.mjs — D14, D95, D96, P4-Q6: trust marks from the person's answers.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import { trustOf, agreementOf, TRUST } from '../src/shared/workflow-tests/criteria.mjs';
import { trustLine, TRUST_BADGE } from '../src/shared/workflow-tests/criteria-text.mjs';
import * as cs from '../src/core/workflow-tests/criteria-store.mjs';
import { trustFor } from '../src/core/workflow-tests/criteria-read.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wfttrust-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const ans = (judgeMet, agree, n = 1) => Array.from({ length: n }, () => ({ judgeMet, agree }));

test('never unreliable below 10 answers (D14); confirm until a round is done, then collecting; both decide', () => {
  assert.deepEqual(trustOf({ roundDone: false, answers: ans(true, false, 9) }), { state: TRUST.CONFIRM, n: 9, agree: 0, decides: true });
  assert.deepEqual(trustOf({ roundDone: true, answers: ans(true, true, 4) }), { state: TRUST.COLLECTING, n: 4, agree: 4, decides: true });
});

test('from 10 answers: 80% overall, and 70% on each side that has 3 answers or more (P4-Q6)', () => {
  assert.equal(trustOf({ answers: [...ans(true, true, 9), ...ans(false, true, 1)] }).state, TRUST.RELIABLE);
  assert.deepEqual(trustOf({ answers: [...ans(true, true, 6), ...ans(true, false, 4)] }), { state: TRUST.UNRELIABLE, n: 10, agree: 6, decides: false });
  // 85% overall, but Worca's "not met" agrees only 1 of 3: it fails the side rule.
  const side = [...ans(true, true, 16), ...ans(false, true, 1), ...ans(false, false, 2), ...ans(true, false, 1)];
  assert.equal(trustOf({ answers: side }).state, TRUST.UNRELIABLE);
  assert.deepEqual(agreementOf(side).saidNot, { n: 3, agree: 1 });
  // 2 "not met" answers, both wrong: too few for the side rule; 18 of 20 overall.
  assert.equal(trustOf({ answers: [...ans(true, true, 18), ...ans(false, false, 2)] }).state, TRUST.RELIABLE);
});

test('the trust words (P4-C1)', () => {
  assert.equal(trustLine({ state: 'reliable', n: 20, agree: 19 }), 'Worca agrees with people 19 of 20 times');
  assert.equal(trustLine({ state: 'unreliable', n: 10, agree: 6 }), 'Agrees with people 6 of 10 times. Shown, but does not decide better or worse.');
  assert.equal(trustLine({ state: 'collecting', n: 4, agree: 4 }), 'Worca has 4 of the 10 answers it needs');
  assert.deepEqual(TRUST_BADGE.confirm, ['badge amber', 'Confirm 4 results']);
});

test('answers: one per person and verdict, replaced and removed; counted per key and model; pairs never count', () => {
  const j = (purpose, met, model = 'm') => cs.insertJudgement({ workflowId: 'wf', exampleId: 1, fp: 'f1', model, purpose, tryId: 1,
    j: { met, reason: 'r', proof: 'p', proofFound: true } }).id;
  const a = j('try', true); const b = j('planted', false); const p = j('pair', null); const other = j('try', true, 'n');
  cs.setAnswer(a, { agree: true, by: 'ana' });
  cs.setAnswer(a, { agree: false, by: 'ana' });
  cs.setAnswer(a, { agree: true, by: 'bo' });
  cs.setAnswer(b, { agree: true, by: 'ana' });
  cs.setAnswer(p, { agree: true, by: 'ana' });
  cs.setAnswer(other, { agree: true, by: 'ana' });
  assert.equal(cs.answerOf(a, 'ana'), false);
  assert.equal(cs.answerOf(a, null), null, 'without identities the key is "", nobody else\'s');
  assert.equal(cs.latestAnswerOf(a), true, 'I9: anyone\'s newest answer (bo answered last)');
  assert.deepEqual(cs.answersFor('wf', 'f1', 'm').map((x) => [x.judgeMet, x.agree]).sort(), [[false, true], [true, false], [true, true]]);
  cs.setAnswer(a, { agree: null, by: 'ana' });
  assert.equal(cs.answerOf(a, 'ana'), null);
  assert.equal(trustFor('wf', 'f1', 'm').n, 2);
  prepare(`INSERT INTO wf_test_checker_rounds (workflow_id, example_id, criterion_id, criterion_fp, model, source, status, created_at)
    VALUES ('wf', 1, 'k_1', 'f1', 'm', '{}', 'done', 'now')`).run();
  assert.equal(trustFor('wf', 'f1', 'm').state, 'collecting');
});

// Rules pinned at their edges (Task 8 fix round 1).
const mk = (purpose, met, { fp = 'f1', model = 'm' } = {}) => cs.insertJudgement({ workflowId: 'wf', exampleId: 1, fp, model, purpose, tryId: 1,
  j: { met, reason: 'r', proof: 'p', proofFound: true } }).id;

test('answers on another criterion, on a null verdict, and on again / padded judgements do not count', () => {
  cs.setAnswer(mk('try', true), { agree: true, by: 'ana' });
  cs.setAnswer(mk('try', true, { fp: 'f2' }), { agree: true, by: 'ana' });
  cs.setAnswer(mk('try', null), { agree: true, by: 'ana' });
  cs.setAnswer(mk('again', true), { agree: true, by: 'ana' });
  cs.setAnswer(mk('padded', false), { agree: true, by: 'ana' });
  assert.deepEqual(cs.answersFor('wf', 'f1', 'm'), [{ judgeMet: true, agree: true }]);
  assert.equal(cs.answersFor('wf', 'f2', 'm').length, 1);
});

test('the exact edges: 8 of 10 is reliable, 7 of 10 is not; a side at 7 of 10 is fine, at 6 of 10 it is not', () => {
  assert.equal(trustOf({ answers: [...ans(true, true, 8), ...ans(true, false, 2)] }).state, TRUST.RELIABLE);
  assert.equal(trustOf({ answers: [...ans(true, true, 7), ...ans(true, false, 3)] }).state, TRUST.UNRELIABLE);
  assert.equal(trustOf({ answers: [...ans(true, true, 7), ...ans(true, false, 3), ...ans(false, true, 10)] }).state, TRUST.RELIABLE);
  assert.equal(trustOf({ answers: [...ans(true, true, 6), ...ans(true, false, 4), ...ans(false, true, 10)] }).state, TRUST.UNRELIABLE);
});
