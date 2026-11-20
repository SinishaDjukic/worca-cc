// test/workflow-test-judge.test.mjs — the judge call (plans/workflow-tests-part4-plan.md D88–D91), on a fake helperCall: free.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { judgeCriterion, modelCall } from '../src/core/workflow-tests/judge.mjs';
import { JUDGE_SYSTEM_PROMPT, parseJudgeReply, proofFound, mockJudgement, clipText, judgePrompt } from '../src/core/workflow-tests/judge-prompt.mjs';

let home;
before(async () => { home = await mkdtemp(join(tmpdir(), 'worca-cc-wftjudge-')); _resetForTests(); process.env.WORCA_HOME = home; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await rm(home, { recursive: true, force: true }); });

const RESULT = '## Success metric\n\nCut export-related support tickets by 60% within one quarter, counted by the “Export” tag.\n\n## Risks\n\nLarge accounts.';
const reply = (o) => JSON.stringify(o);
/** A fake helperCall: answers from `texts` in turn, each costing `cost`; records every call's arguments. */
function fake(texts, { cost = 0.01, fail = null } = {}) {
  const calls = [];
  return { calls, d: { scratch: () => home, userSignIn: () => false, mock: () => false, budget: () => ({ blocked: false }),
    helperCall: async (args) => {
      calls.push(args);
      if (fail) throw Object.assign(new Error('Worca got no reply within 120 seconds. Try again.'), { costUsd: 0.003, costKind: 'billed' });
      return { text: texts[Math.min(calls.length - 1, texts.length - 1)], costUsd: cost, costKind: 'billed' };
    } } };
}

test('proofFound: curly quotes, spaces, markdown stars, case and an ellipsis; a made-up quote is not found', () => {
  assert.equal(proofFound('cut export-related support tickets by 60%  within one quarter', RESULT), true);
  assert.equal(proofFound('"Cut export-related support tickets … counted by the "Export" tag"', RESULT), true);
  assert.equal(proofFound('**Cut export-related** support tickets by 60%', RESULT), true);
  assert.equal(proofFound('Customers are much happier with exporting', RESULT), false);
  assert.equal(proofFound('by 60%', RESULT), false, 'shorter than 8 characters');
});

test('parseJudgeReply: a fenced object, yes and no, and what cannot be read', () => {
  assert.deepEqual(parseJudgeReply('```json\n{"verdict":"met","reason":"It has 60%.","proof":"by 60%"}\n```'), { verdict: 'met', reason: 'It has 60%.', proof: 'by 60%' });
  assert.equal(parseJudgeReply('{"verdict":"not_met","reason":"No number.","proof":"x"}').verdict, 'not met');
  assert.equal(parseJudgeReply('{"verdict":"no","reason":"No number.","proof":"x"}').verdict, 'not met');
  assert.equal(parseJudgeReply('{"verdict":"maybe","reason":"?","proof":"x"}'), null);
  assert.equal(parseJudgeReply('{"verdict":"met","proof":"x"}'), null, 'a reason is required');
  assert.equal(parseJudgeReply('I think it is met.'), null);
});

test('mockJudgement: met on a longer word of the criterion, with a proof that is always found', () => {
  const m = mockJudgement('Names a success metric with a number', RESULT);
  assert.equal(m.verdict, 'met');
  assert.equal(proofFound(m.proof, RESULT), true);
  const n = mockJudgement('Explains the legal reasons', RESULT);
  assert.equal(n.verdict, 'not met');
  assert.equal(proofFound(n.proof, RESULT), true);
});

test('clipText cuts at a line and the prompt says so', () => {
  assert.deepEqual(clipText('abc\ndef\nghi', 9), { text: 'abc\ndef', cut: true });
  assert.match(judgePrompt({ criterion: 'C', result: 'R', context: 'F', cut: true }), /<criterion>\nC\n<\/criterion>[\s\S]*<files>\nF\n<\/files>[\s\S]*<result>\nR\n<\/result>[\s\S]*cut at the end/);
});

test('the call: no tools, Worca\'s system prompt replaces Claude Code\'s, no transcript, project settings only, aux spawn, empty scratch', async () => {
  const f = fake([reply({ verdict: 'met', reason: 'It has 60%.', proof: 'by 60% within one quarter' })]);
  await modelCall({ model: 'claude-haiku-4-5', system: JUDGE_SYSTEM_PROMPT, prompt: 'P' }, f.d);
  const o = f.calls[0].claudeOptions;
  assert.equal(f.calls[0].engine, 'claude');
  assert.equal(f.calls[0].timeoutMs, 120000);
  assert.deepEqual([o.tools, o.allowedTools, o.systemPrompt, o.systemPromptMode, o.noSessionPersistence, o.strictMcpConfig, o.spawnKind, o.cwd, o.model],
    [[], [], JUDGE_SYSTEM_PROMPT, 'replace', true, true, 'aux', home, 'claude-haiku-4-5']);
  assert.deepEqual(o.settingSources, ['project']);
  const g = fake(['{}']);
  await modelCall({ model: 'm', system: 'S', prompt: 'P' }, { ...g.d, userSignIn: () => true });
  assert.equal(g.calls[0].claudeOptions.settingSources, undefined, 'the user settings carry the sign-in: kept, as the interview does');
});

test('judgeCriterion: met with proof, booked once', async () => {
  const f = fake([reply({ verdict: 'met', reason: 'It names 60% and how it is counted.', proof: 'Cut export-related support tickets by 60%' })]);
  const booked = [];
  const j = await judgeCriterion({ criterion: 'Names a success metric with a number', subject: RESULT, model: 'm', book: (u, k) => booked.push([u, k]) }, f.d);
  assert.deepEqual([j.met, j.proofFound, j.error, j.costUsd], [true, true, null, 0.01]);
  assert.deepEqual(booked, [[0.01, 'billed']]);
  assert.equal(f.calls.length, 1);
  // P4-Q17: a reply whose cost Worca could not learn is booked as $0 'unknown', never skipped.
  const unknown = { ...f.d, helperCall: async () => ({ text: reply({ verdict: 'met', reason: 'It names 60%.', proof: 'Cut export-related support tickets by 60%' }), costUsd: 0, costKind: 'unknown' }) };
  const seen = [];
  await judgeCriterion({ criterion: 'Names a success metric with a number', subject: RESULT, model: 'm', book: (u, k) => seen.push([u, k]) }, unknown);
  assert.deepEqual(seen, [[0, 'unknown']]);
});

test('judgeCriterion: an unreadable reply and a missing proof are asked once more; then not counted', async () => {
  const ok = reply({ verdict: 'not met', reason: 'No number.', proof: 'Large accounts.' });
  const again = fake(['I cannot say.', ok]);
  const j1 = await judgeCriterion({ criterion: 'C', subject: RESULT, model: 'm' }, again.d);
  assert.deepEqual([j1.met, j1.error, again.calls.length], [false, null, 2]);
  const made = reply({ verdict: 'met', reason: 'Quotes a customer.', proof: 'I would pay twice for this' });
  const twice = fake([made, made]);
  const j2 = await judgeCriterion({ criterion: 'C', subject: RESULT, model: 'm' }, twice.d);
  assert.deepEqual([j2.met, j2.error, j2.proof, twice.calls.length, j2.costUsd], [null, 'no-proof', 'I would pay twice for this', 2, 0.02]);
});

test('judgeCriterion: the limit, a failed call, no result and mock make no paid call or say why', async () => {
  const f = fake(['x']);
  const lim = await judgeCriterion({ criterion: 'C', subject: RESULT, model: 'm' }, { ...f.d, budget: () => ({ blocked: true }) });
  assert.deepEqual([lim.error, f.calls.length], ['limit', 0]);
  const booked = [];
  const bad = fake([], { fail: true });
  const failed = await judgeCriterion({ criterion: 'C', subject: RESULT, model: 'm', book: (u) => booked.push(u) }, bad.d);
  assert.deepEqual([failed.error, failed.detail, booked], ['failed', 'Worca got no reply within 120 seconds. Try again.', [0.003]]);
  assert.equal((await judgeCriterion({ criterion: 'C', subject: '  ', model: 'm' }, f.d)).error, 'no-result');
  const mock = await judgeCriterion({ criterion: 'Names a success metric', subject: RESULT, model: 'm', mock: true }, f.d);
  assert.deepEqual([mock.met, mock.costUsd, f.calls.length], [true, 0, 0]);
  const env = await judgeCriterion({ criterion: 'Names a success metric', subject: RESULT, model: 'm' }, { ...f.d, mock: () => true });
  assert.deepEqual([env.met, f.calls.length], [true, 0], 'WORCA_MOCK=1: free');
});
