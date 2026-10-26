// test/workflow-test-checks.test.mjs — D18: the Basics and the built-in automatic checks, counted exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseCheck, checkLabel, runCheck, wordCount, headingsOf, normaliseBasics, basicsList, judgeTry, fmtUsd,
} from '../src/shared/workflow-tests/checks.mjs';

const BRIEF = ['# Bulk invoice export', '', '## Problem', 'Customers with more than 200 invoices wait.', '', '## Users',
  '- finance admins', '', '**Success metric:**', 'Cut tickets by 60%.', ''].join('\n');
const check = (raw) => normaliseCheck(raw).check;

test('words: tokens with a letter or a digit; markdown marks do not count', () => {
  assert.equal(wordCount('# Title\n\n- one two | three — 4'), 5);
  assert.equal(wordCount(''), 0);
  const c = check({ kind: 'words', min: 3, max: 5 });
  assert.deepEqual(runCheck(c, { text: 'one two three four' }), { met: true, value: '4 words' });
  assert.deepEqual(runCheck(c, { text: 'one two' }), { met: false, value: '2 words' });
});

test('sections: headings and bold-only lines, compared without case, numbering or a trailing colon', () => {
  assert.deepEqual(headingsOf(BRIEF), ['bulk invoice export', 'problem', 'users', 'success metric']);
  const c = check({ kind: 'sections', names: 'Problem, Users, Success metric, Risks' });
  assert.deepEqual(c.names, ['Problem', 'Users', 'Success metric', 'Risks']);
  assert.deepEqual(runCheck(c, { text: BRIEF }), { met: false, value: 'Missing Risks' });
  assert.deepEqual(runCheck({ ...c, names: ['Risks', 'Costs'] }, { text: BRIEF }), { met: false, value: 'Missing Risks and Costs' });
  assert.deepEqual(runCheck({ ...c, names: ['1. problem', 'USERS'] }, { text: BRIEF }), { met: true, value: 'Met' });
});

test('must and must not mention: case, spacing and curly quotes do not matter; no result is never met', () => {
  const m = check({ kind: 'mentions', text: 'more than 200' });
  const n = check({ kind: 'not-mentions', text: 'Lorem ipsum' });
  assert.deepEqual(runCheck(m, { text: BRIEF }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(n, { text: BRIEF }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(n, { text: 'LOREM   IPSUM dolor' }), { met: false, value: 'Not met' });
  assert.deepEqual(runCheck(check({ kind: 'mentions', text: 'it’s' }), { text: "it's here" }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(m, { text: null }), { met: false, value: 'No result' });
  assert.deepEqual(runCheck(n, { text: '  ' }), { met: false, value: 'No result' });
});

test('a file is in the result by its name or its path under work/', () => {
  const c = check({ kind: 'file', name: 'Summary.md' });
  assert.equal(runCheck(c, { files: ['work/out/summary.md'] }).met, true);
  assert.equal(runCheck(check({ kind: 'file', name: 'out/summary.md' }), { files: ['work/out/summary.md'] }).met, true);
  assert.equal(runCheck(c, { files: ['work/summary.txt'] }).met, false);
  assert.throws(() => runCheck(check({ kind: 'script', key: 'lint-md' }), {}), /not a built-in check/);
});

test('labels read like the board', () => {
  assert.equal(checkLabel(check({ kind: 'words', min: 400, max: 900 })), 'Length is 400 to 900 words');
  assert.equal(checkLabel(check({ kind: 'words', min: 400 })), 'Length is at least 400 words');
  assert.equal(checkLabel(check({ kind: 'words', max: '900' })), 'Length is at most 900 words');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Problem', 'Users', 'Success metric', 'Risks'] })), 'Has the sections Problem, Users, Success metric and Risks');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Problem', 'Risks'] })), 'Has the sections Problem and Risks');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Risks'] })), 'Has the section Risks');
  assert.equal(checkLabel(check({ kind: 'mentions', text: ' 200  invoices ' })), 'Mentions "200 invoices"');
  assert.equal(checkLabel(check({ kind: 'not-mentions', text: 'lorem' })), 'Does not mention "lorem"');
  assert.equal(checkLabel(check({ kind: 'file', name: 'summary.md' })), 'Has a file named summary.md');
  assert.equal(checkLabel(check({ kind: 'script', key: 'lint-md' }), { scriptName: 'Markdown lint' }), 'The Library script "Markdown lint" passes');
});

test('bad checks are refused with a plain reason; a valid id is kept', () => {
  assert.equal(normaliseCheck({ kind: 'words' }).error, 'give a smallest or a largest number of words');
  assert.equal(normaliseCheck({ kind: 'words', min: 10, max: 5 }).error, 'the smallest number of words is larger than the largest');
  assert.equal(normaliseCheck({ kind: 'sections', names: [' ', ''] }).error, 'name at least one section');
  assert.equal(normaliseCheck({ kind: 'file', name: '../x' }).error, 'give a file name inside the result, such as summary.md');
  assert.equal(normaliseCheck({ kind: 'script', key: '' }).error, 'pick a script from the Library');
  assert.equal(normaliseCheck({ kind: 'magic' }).error, 'unknown check kind "magic"');
  assert.deepEqual(normaliseCheck({ id: 'c_ab12', kind: 'mentions', text: 'x' }).check, { id: 'c_ab12', kind: 'mentions', text: 'x' });
  assert.deepEqual(normaliseCheck({ id: 'nope', kind: 'mentions', text: 'x' }).check, { kind: 'mentions', text: 'x' });
});

test('basics: defaults, limits and the board labels', () => {
  assert.deepEqual(normaliseBasics(undefined).basics, { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null });
  const { basics } = normaliseBasics({ noError: true, noHelp: false, maxCostUsd: '1.5', maxSentBack: 2 });
  assert.deepEqual(basicsList(basics).map((b) => b.label), ['Finishes without an error', 'Costs at most $1.50', 'Sent back for fixes at most 2 times']);
  assert.equal(basicsList({ ...basics, maxSentBack: 1 }).at(-1).label, 'Sent back for fixes at most once');
  assert.equal(basicsList({ ...basics, maxSentBack: 0 }).at(-1).label, 'Never sent back for fixes');
  assert.equal(normaliseBasics({ maxCostUsd: -1 }).error, 'the cost limit must be more than $0 and at most $10,000');
  assert.equal(normaliseBasics({ maxSentBack: 1.5 }).error, 'the fix limit must be a whole number from 0 to 50');
});

test('a try passes only when every Basic switched on and every check is met', () => {
  const example = { basics: { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null } };
  const facts = { status: 'done', costUsd: 0.86, durationMs: 1000, sentBack: 1, help: [], failReason: null };
  const ok = judgeTry(example, facts, [{ id: 'c_1', label: 'Length is 400 to 900 words', met: true, value: '742 words' }],
    { name: 'brief.md', source: 'end-file', words: 742 });
  assert.equal(ok.passed, true);
  assert.deepEqual(ok.basics.map((b) => [b.label, b.met, b.value]), [
    ['Finishes without an error', true, 'Met'],
    ['Finishes without needing help from someone', true, 'Met'],
    ['Costs at most $1.50', true, '$0.86'],
  ]);
  assert.deepEqual(ok.result, { name: 'brief.md', source: 'end-file', words: 742 });
  const helped = judgeTry(example, { ...facts, help: [{ kind: 'questions', question: 'Which formats?' }] }, []);
  assert.equal(helped.passed, false);
  assert.equal(helped.basics[1].detail, 'Worca asked: "Which formats?"');
  const why = 'Worca asked "Who?", and this example has no answer for it.';
  const stopped = judgeTry(example, { ...facts, status: 'stopped', failReason: why }, []);
  assert.deepEqual([stopped.passed, stopped.basics[0].met, stopped.basics[0].detail], [false, false, why]);
  assert.equal(judgeTry(example, { ...facts, costUsd: 2 }, []).passed, false);
  assert.equal(judgeTry(example, facts, [{ id: 'c_1', label: 'x', met: false, value: 'Not met' }]).passed, false);
  const sent = judgeTry({ basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: 0 } }, { ...facts, sentBack: 1 }, []);
  assert.deepEqual(sent.basics.map((b) => [b.label, b.met, b.value]), [['Never sent back for fixes', false, '1 time']]);
  assert.equal(fmtUsd(10.26), '$10.26');
  assert.equal(fmtUsd(0.5), '$0.50');
});
