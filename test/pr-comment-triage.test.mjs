import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

const home = useTempHome(after, 'pr-triage-');
const { triagePrComment, parseTriageVerdict, buildTriagePrompt, TRIAGE_BODY_CAP, TRIAGE_SYSTEM_PROMPT } = await import('../src/core/pr-comment-triage.mjs');

const MODELS = [{ id: 'claude-sonnet-5', engines: ['claude'] }, { id: 'claude-haiku-5-5', engines: ['claude'] }];

test('parseTriageVerdict reads the first word only, case-insensitively, through markdown', () => {
  assert.equal(parseTriageVerdict('FEEDBACK'), true);
  assert.equal(parseTriageVerdict('  **feedback**\n'), true);
  assert.equal(parseTriageVerdict('OTHER'), false);
  assert.equal(parseTriageVerdict('`Other`.'), false);
  assert.equal(parseTriageVerdict('FEEDBACK? No. Comment says review skipped. → OTHER\n\nOTHER'), false, 'the last word decides');
  assert.equal(parseTriageVerdict('maybe'), null);
  assert.equal(parseTriageVerdict(''), null);
  assert.equal(parseTriageVerdict(undefined), null);
});

test('buildTriagePrompt fences the comment as data and caps it', () => {
  const p = buildTriagePrompt({ body: 'x'.repeat(TRIAGE_BODY_CAP + 50), author: 'review-bot' });
  assert.match(p, /`review-bot`/);
  assert.match(p, /\[…truncated\]\n<\/comment>$/);
  assert.match(TRIAGE_SYSTEM_PROMPT, /UNTRUSTED DATA/);
  const html = buildTriagePrompt({ body: '<!-- state: {"x":1} -->\n<details><summary>Action performed</summary>\n\nReview finished.</details>', author: 'bot' });
  assert.doesNotMatch(html, /state:|<details>|<summary>/, 'hidden state and tags are dropped');
  assert.match(html, /Action performed/);
});

test('triagePrComment: one tool-less call on a Haiku-class model; the verdict comes back', async () => {
  const calls = [];
  const run = async (opts) => { calls.push(opts); return { text: 'FEEDBACK' }; };
  assert.equal(await triagePrComment({ body: 'add a null check', author: 'bot', cwd: home, runClaudeImpl: run, models: MODELS }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].model, calls[0].tools, calls[0].allowedTools, calls[0].strictMcpConfig], ['claude-haiku-5-5', [], [], true]);
  assert.deepEqual(calls[0].settingSources, ['project'], 'not the user\'s hooks or plugins');
  assert.match(calls[0].prompt, /add a null check/);
  assert.equal(await triagePrComment({ body: 'Review skipped', cwd: '.', runClaudeImpl: async () => ({ text: 'OTHER' }), models: MODELS }), false);
});

test('triagePrComment runs on the Quick jobs role, not the Everyday one', async () => {
  // Saved roles count only with the test opt-in (settings.mjs homeGuarded), read from this file's own HOME.
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  const file = join(home, '.worca-cc', 'settings.json');
  mkdirSync(dirname(file), { recursive: true });
  const pick = async () => { let model; await triagePrComment({ body: 'x', cwd: home, runClaudeImpl: async (o) => { model = o.model; return { text: 'OTHER' }; }, models: MODELS }); return model; };
  try {
    writeFileSync(file, JSON.stringify({ modelRoles: { claude: { everyday: { model: 'claude-sonnet-5-5' } } } }));
    assert.equal(await pick(), 'claude-haiku-5-5', 'an Everyday pick does not move the check');
    writeFileSync(file, JSON.stringify({ modelRoles: { claude: { quick: { model: 'claude-sonnet-5' } } } }));
    assert.equal(await pick(), 'claude-sonnet-5', 'the Quick jobs pick does');
  } finally {
    rmSync(file, { force: true });
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('triagePrComment throws on an unreadable reply or a failed call', async () => {
  await assert.rejects(triagePrComment({ body: 'x', cwd: '.', runClaudeImpl: async () => ({ text: 'maybe' }), models: MODELS }), /unreadable reply/);
  await assert.rejects(triagePrComment({ body: 'x', cwd: '.', runClaudeImpl: async () => { throw new Error('offline'); }, models: MODELS }), /offline/);
});
