import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after, 'pr-triage-');
const { triagePrComment, parseTriageVerdict, buildTriagePrompt, TRIAGE_BODY_CAP, TRIAGE_SYSTEM_PROMPT } = await import('../src/core/pr-comment-triage.mjs');

const MODELS = [{ id: 'claude-sonnet-5', engines: ['claude'] }, { id: 'claude-haiku-5-5', engines: ['claude'] }];

test('parseTriageVerdict reads the first word only, case-insensitively, through markdown', () => {
  assert.equal(parseTriageVerdict('FEEDBACK'), true);
  assert.equal(parseTriageVerdict('  **feedback**\n'), true);
  assert.equal(parseTriageVerdict('OTHER'), false);
  assert.equal(parseTriageVerdict('`Other`.'), false);
  assert.equal(parseTriageVerdict('I think FEEDBACK'), null);
  assert.equal(parseTriageVerdict(''), null);
  assert.equal(parseTriageVerdict(undefined), null);
});

test('buildTriagePrompt fences the comment as data and caps it', () => {
  const p = buildTriagePrompt({ body: 'x'.repeat(TRIAGE_BODY_CAP + 50), author: 'review-bot' });
  assert.match(p, /`review-bot`/);
  assert.match(p, /\[…truncated\]\n<\/comment>$/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /UNTRUSTED DATA/);
});

test('triagePrComment: one tool-less call on a Haiku-class model; the verdict comes back', async () => {
  const calls = [];
  const run = async (opts) => { calls.push(opts); return { text: 'FEEDBACK' }; };
  assert.equal(await triagePrComment({ body: 'add a null check', author: 'bot', cwd: home, runClaudeImpl: run, models: MODELS }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].model, calls[0].tools, calls[0].allowedTools, calls[0].strictMcpConfig], ['claude-haiku-5-5', [], [], true]);
  assert.match(calls[0].prompt, /add a null check/);
  assert.equal(await triagePrComment({ body: 'Review skipped', cwd: '.', runClaudeImpl: async () => ({ text: 'OTHER' }), models: MODELS }), false);
});

test('triagePrComment throws on an unreadable reply or a failed call', async () => {
  await assert.rejects(triagePrComment({ body: 'x', cwd: '.', runClaudeImpl: async () => ({ text: 'maybe' }), models: MODELS }), /unreadable reply/);
  await assert.rejects(triagePrComment({ body: 'x', cwd: '.', runClaudeImpl: async () => { throw new Error('offline'); }, models: MODELS }), /offline/);
});
