// Helper-call profiles per harness (plans/requirements-9c-design.md D4, D6, D11, D12, D13, D18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES, requirementsEngines, capabilities, launchOptions, stepNotices, notReadyWords, companyOf, sameCompany, harnessLine, noRepoStartsOn,
} from '../src/core/helper-call/profiles.mjs';
import { REPO_LOOK_TOOLS } from '../src/core/auto/classify.mjs';

const base = { cwd: '/w', systemPrompt: 's', prompt: 'p', model: 'm', effort: 'high' };

test('PROFILES', () => assert.deepEqual([...PROFILES], ['none', 'repo', 'file']));

test('requirementsEngines: claude first, never cursor, drops an engine without a lockdown', () => {
  const all = requirementsEngines({ lockdown: () => true });
  assert.equal(all[0], 'claude');
  assert.ok(!all.includes('cursor'));
  assert.ok(all.includes('codex'));
  assert.ok(!requirementsEngines({ lockdown: (e) => e !== 'codex' }).includes('codex'));
  assert.ok(!requirementsEngines().includes('cursor'));
});

test('capabilities', () => {
  assert.deepEqual(capabilities('claude'), { repo: true, files: true, keepsCopy: false, reportsCost: true, deletesSession: false });
  assert.deepEqual(capabilities('codex'), { repo: true, files: false, keepsCopy: false, reportsCost: true, deletesSession: true });
  assert.deepEqual(capabilities('copilot'), { repo: true, files: false, keepsCopy: true, reportsCost: false, deletesSession: false });
  assert.equal(capabilities('gemini').repo, false);
  assert.equal(capabilities('gemini').keepsCopy, true);
  assert.equal(capabilities('goose').reportsCost, true);
  assert.equal(capabilities('opencode').keepsCopy, false);
});

test('launchOptions: none on every lockdown engine', () => {
  for (const engine of ['codex', 'copilot', 'gemini', 'goose', 'opencode', 'qwen']) {
    const o = launchOptions({ ...base, engine, profile: 'none' });
    assert.equal(o.askLockdown, true, engine);
    assert.equal(o.envScrub, true);
    assert.equal(o.sandbox, 'read-only');
    assert.deepEqual(o.allowedTools, []);
    assert.equal(o.spawnKind, 'aux');
    assert.equal(o.permissionMode, 'acceptEdits');
    assert.ok(!('tools' in o) && !('mcpConfigPath' in o));
    assert.equal(o.effort, 'high');
  }
  assert.ok(!('effort' in launchOptions({ ...base, effort: undefined, engine: 'codex', profile: 'none' })));
});

test('launchOptions: repo on codex and copilot', () => {
  for (const engine of ['codex', 'copilot']) {
    const o = launchOptions({ ...base, engine, profile: 'repo', mcpConfigPath: '/m.json', maxTurns: 7 });
    assert.equal(o.mcpConfigPath, '/m.json');
    assert.deepEqual(o.allowedTools, [...REPO_LOOK_TOOLS]);
    assert.deepEqual(o.tools, [...REPO_LOOK_TOOLS]);
    assert.equal(o.sandbox, 'read-only');
    assert.equal(o.maxTurns, 7);
    assert.ok(!('askLockdown' in o));
  }
  assert.throws(() => launchOptions({ ...base, engine: 'codex', profile: 'repo' }), TypeError);
  assert.throws(() => launchOptions({ ...base, engine: 'gemini', profile: 'repo', mcpConfigPath: '/m.json' }), /cannot read the repo/);
});

test('launchOptions: file off Claude, Claude and Cursor throw', () => {
  assert.throws(() => launchOptions({ ...base, engine: 'codex', profile: 'file' }), /runs on Claude only/);
  for (const profile of PROFILES) {
    assert.throws(() => launchOptions({ ...base, engine: 'claude', profile }), /interviewCallOptions/);
    assert.throws(() => launchOptions({ ...base, engine: 'cursor', profile }), /Cursor is never offered/);
  }
});

test('stepNotices: verbatim, in order', () => {
  const files = [{ name: 'a.png', kind: 'image', bytes: 10 }, { name: 'b.txt', kind: 'text', bytes: 30 * 1024 }, { name: 'c.txt', kind: 'text', bytes: 5 }];
  assert.deepEqual(stepNotices({ engine: 'gemini', profile: 'repo', files, estimated: true }), [
    "Repo not read: Gemini CLI can't read the repo.",
    'a.png skipped: Gemini CLI gets files as text only.',
    'b.txt skipped: it is too large for Gemini CLI.',
    'Gemini CLI keeps its own copy of this step in its history on this computer.',
    'Cost estimated: Gemini CLI reports none.',
  ]);
  assert.deepEqual(stepNotices({ engine: 'claude', profile: 'repo', files }), []);
  assert.deepEqual(stepNotices({ engine: 'codex', profile: 'repo' }), []);
});

test('notReadyWords: four shapes and Cursor', () => {
  assert.deepEqual(notReadyWords('codex', 'codex is not signed in - run codex login'), {
    short: 'Not signed in', sentence: "Codex isn't signed in. Sign in, or change the model.", startsOn: "Codex isn't signed in, so this starts on Claude." });
  assert.deepEqual(notReadyWords('copilot', 'cannot run copilot (ENOENT) - x'), {
    short: 'Not installed', sentence: "Copilot isn't installed. Install it, or change the model.", startsOn: "Copilot isn't installed, so this starts on Claude." });
  const b = notReadyWords('codex', 'whatever', { broker: true });
  assert.equal(b.sentence, 'Codex is off while the credential broker is on. Change the model.');
  assert.equal(b.startsOn, 'Codex is off while the credential broker is on, so this starts on Claude.');
  const o = notReadyWords('qwen', 'boom');
  assert.equal(o.short, 'Not ready');
  assert.equal(o.sentence, "Qwen Code can't run this step: boom. Change the model, or try again.");
  assert.equal(notReadyWords('cursor', '').startsOn, "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.");
});

test('companyOf and sameCompany', () => {
  assert.equal(companyOf('claude', { id: 'opus' }), 'Anthropic');
  assert.equal(companyOf('codex', { id: 'gpt' }), 'OpenAI');
  assert.equal(companyOf('copilot', { id: 'x' }), 'GitHub');
  assert.equal(companyOf('gemini', { id: 'x' }), 'Google');
  assert.equal(companyOf('qwen', { id: 'x' }), 'Alibaba Cloud');
  assert.equal(companyOf('claude', { id: 'k', custom: 'global', hasEnv: true }), 'the provider of k');
  assert.equal(companyOf('claude', { id: 'k', custom: 'global', hasEnv: false }), 'Anthropic');
  assert.equal(companyOf('claude', { id: 'k', bridged: 'openrouter' }), 'the provider of k');
  assert.equal(companyOf('goose', { id: 'g' }), 'the provider of g');
  assert.equal(companyOf('opencode', { id: 'o' }), 'the provider of o');
  assert.ok(sameCompany('Anthropic', companyOf('claude', { id: 'a' })));
  assert.ok(!sameCompany('Anthropic', 'OpenAI'));
  assert.ok(!sameCompany(companyOf('goose', { id: 'g' }), companyOf('goose', { id: 'g' })));
});

test('harnessLine and noRepoStartsOn', () => {
  assert.equal(harnessLine('claude'), null);
  assert.equal(harnessLine('codex'), 'Codex reads the repo read-only. Files go to it as text.');
  assert.equal(harnessLine('gemini'), "Gemini CLI can't read the repo. Files go to it as text.");
  assert.equal(noRepoStartsOn('gemini'), "Your default engine is Gemini CLI, which can't read the repo, so this brief is made on Claude.");
});
