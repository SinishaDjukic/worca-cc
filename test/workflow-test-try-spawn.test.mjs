// test/workflow-test-try-spawn.test.mjs — workflow tests 3b: the Pretend-try pieces of a Claude spawn, out of
// engines/claude.mjs (file split): the try's settings payload parts, the settings canary and the carry a Pretend spawn reads.
// The spawn-level behaviour (the payload, the argv, the canary verdict through runClaudeProcess) stays covered by
// workflow-test-plugins-off.test.mjs and workflow-test-try-guard.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { tryPayloadParts, addTryHooks, carriesFileSettings, settingsFilePlan, settingsCanary, STAGING_PREFIX } from '../src/core/workflow-tests/try-spawn.mjs';
import { pretendTryCarry, carryStageOpts, carryEnv, CARRY_WARNING_PREFIX } from '../src/core/workflow-tests/try-carry.mjs';
import { TRY_DENY, tryGuardHookEntry, SETTINGS_CANARY_PREFIX, SETTINGS_IGNORED_FILE, SETTINGS_IGNORED_TEXT } from '../src/core/workflow-tests/try-guard-env.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-tspawn-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('tryPayloadParts: no try, no carry: only the permission lists, nothing else', () => {
  const t = tryPayloadParts({ deny: ['Bash(curl:*)'], allow: ['Read'], other: ['x'] });
  assert.deepEqual(t, { tg: null, rules: { deny: ['Bash(curl:*)'], allow: ['Read'] }, safety: null, signIn: null, top: {} });
  assert.equal(tryPayloadParts(null).rules, null);
  assert.equal(tryPayloadParts({ deny: 'Bash(curl:*)' }).rules, null, 'a malformed list is dropped');
});

test('tryPayloadParts: a try guard adds its hook and the try deny rules after the given ones', () => {
  const t = tryPayloadParts({ deny: ['Read(//secret)'] }, { tryGuard: { logFile: '/run/c.ndjson' } });
  assert.deepEqual(t.tg, tryGuardHookEntry());
  assert.deepEqual(t.rules.deny, [...new Set(['Read(//secret)', ...TRY_DENY])]);
});

test('tryPayloadParts: the person\'s deny rules join last (deduplicated), the sandbox and sign-in go on top', () => {
  const sandbox = { enabled: true };
  const t = tryPayloadParts({ deny: ['A'] }, { signInSettings: { apiKeyHelper: 'node k.js', other: 'x', awsAuthRefresh: '' },
    safetySettings: { deny: ['A', 'B', ' ', 3], sandbox } });
  assert.deepEqual(t.rules.deny, ['A', 'B']);
  assert.deepEqual(t.safety, { deny: ['A', 'B'], sandbox });
  assert.deepEqual(t.signIn, { apiKeyHelper: 'node k.js' });
  assert.deepEqual(t.top, { apiKeyHelper: 'node k.js', sandbox });
  assert.equal(tryPayloadParts(null, { safetySettings: { deny: [], sandbox: { enabled: 'yes' } } }).safety, null, 'a sandbox the CLI would reject is never carried');
});

test('addTryHooks: the try hook joins PreToolUse with disableAllHooks off; a canary adds its SessionStart hook; no try: nothing', () => {
  const tg = tryGuardHookEntry();
  const s = { hooks: { PreToolUse: [{ matcher: 'x' }] } };
  addTryHooks(s, tg, { logFile: '/run/c.ndjson' });
  assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'x' }, tg]);
  assert.equal(s.disableAllHooks, false);
  assert.equal('SessionStart' in s.hooks, false);
  const c = {};
  addTryHooks(c, tg, { logFile: '/run/c.ndjson', canary: '/run/.worca-settings-canary-1' });
  assert.equal(c.hooks.SessionStart.length, 1);
  assert.match(c.hooks.SessionStart[0].hooks[0].command, /settings-canary\.mjs" "\/run\/\.worca-settings-canary-1"$/);
  const none = { a: 1 };
  addTryHooks(none, null, null);
  assert.deepEqual(none, { a: 1 });
});

test('carriesFileSettings: only a carried sign-in helper or the person\'s own guards', () => {
  assert.equal(carriesFileSettings({}), false);
  assert.equal(carriesFileSettings({ signInSettings: { apiKeyHelper: '' } }), false);
  assert.equal(carriesFileSettings({ signInSettings: { apiKeyHelper: 'h' } }), true);
  assert.equal(carriesFileSettings({ safetySettings: { deny: ['A'], sandbox: null } }), true);
  assert.equal(carriesFileSettings({ safetySettings: { deny: [], sandbox: null } }), false);
});

test('STAGING_PREFIX is the Claude staging folders\' prefix', () => {
  assert.equal(STAGING_PREFIX, 'worca-claude-');
});

test('settingsCanary: none outside a Pretend try; there, a marker beside the try log', () => {
  const log = join(tmp(), 'connector-calls.ndjson');
  for (const o of [{ pluginsOff: false, tryGuard: { logFile: log } }, { pluginsOff: true, tryGuard: null }, { pluginsOff: true, tryGuard: { logFile: '' } }]) {
    const c = settingsCanary({ ...o, onEvent: () => {} });
    assert.equal(c.path, null);
    assert.equal(c.tryGuard, o.tryGuard, 'the try guard as given');
    c.saw({ type: 'system', subtype: 'init' });
    c.verdict();
    c.remove();
  }
  const c = settingsCanary({ pluginsOff: true, tryGuard: { logFile: log }, onEvent: () => {} });
  assert.equal(dirname(c.path), dirname(log));
  assert.ok(basename(c.path).startsWith(`${SETTINGS_CANARY_PREFIX}${process.pid}-`));
  assert.deepEqual(c.tryGuard, { logFile: log, canary: c.path });
});

test('settingsCanary: a started session without the marker: one verdict, written and said; with it or never started: none', () => {
  const d = tmp();
  const said = [];
  const c = settingsCanary({ pluginsOff: true, tryGuard: { logFile: join(d, 'connector-calls.ndjson') }, onEvent: (e) => said.push(e) });
  c.verdict();
  assert.equal(existsSync(join(d, SETTINGS_IGNORED_FILE)), false, 'no session start: no verdict');
  c.saw({ type: 'assistant' });
  c.verdict();
  assert.equal(said.length, 0);
  c.saw({ type: 'system', subtype: 'init' });
  c.verdict();
  c.verdict();
  assert.deepEqual(said, [{ type: 'stderr', stream: 'err', text: `${CARRY_WARNING_PREFIX}${SETTINGS_IGNORED_TEXT}` }]);
  assert.match(readFileSync(join(d, SETTINGS_IGNORED_FILE), 'utf8'), /"why":"settings canary missing"/);

  const d2 = tmp();
  const said2 = [];
  const ok = settingsCanary({ pluginsOff: true, tryGuard: { logFile: join(d2, 'connector-calls.ndjson') }, onEvent: (e) => said2.push(e) });
  writeFileSync(ok.path, 'ok');
  ok.saw({ type: 'system', subtype: 'init' });
  ok.verdict();
  assert.deepEqual(said2, []);
  assert.equal(existsSync(join(d2, SETTINGS_IGNORED_FILE)), false);
  ok.remove();
  assert.equal(existsSync(ok.path), false, 'the marker removed');
});

test('pretendTryCarry: nothing read outside a Pretend try; there, the spawn\'s own facts', () => {
  const seen = [];
  const carryOf = (o) => { seen.push(o); return { env: {}, settings: {} }; };
  assert.equal(pretendTryCarry({ pluginsOff: false }, { carryOf }), null);
  assert.equal(pretendTryCarry({}, { carryOf }), null);
  assert.equal(seen.length, 0);
  assert.deepEqual(pretendTryCarry({ pluginsOff: true, modelEnv: { A: '1' }, asAgent: true, cwd: '/w', settingSources: ['project'],
    runLoadsUserSettings: true, permissionRules: { deny: ['X'] } }, { carryOf }), { env: {}, settings: {} });
  assert.deepEqual(seen[0], { modelEnv: { A: '1' }, asAgent: true, cwd: '/w', sources: ['project'], userLoaded: true, ownDeny: ['X'] });
  pretendTryCarry({ pluginsOff: true }, { carryOf });
  assert.deepEqual(seen[1], { modelEnv: undefined, asAgent: undefined, cwd: process.cwd(), sources: undefined, userLoaded: false, ownDeny: [] });
});

test('carryStageOpts / carryEnv: what a spawn hands on of its carry; nothing for no carry or empty parts', () => {
  assert.deepEqual(carryStageOpts(null), { signInSettings: null, safetySettings: null });
  assert.equal(carryEnv(null), null);
  const empty = { env: {}, settings: {} };
  assert.deepEqual(carryStageOpts(empty), { signInSettings: null, safetySettings: null });
  assert.equal(carryEnv(empty), null);
  const safety = { deny: ['A'], sandbox: null };
  const full = { env: { ANTHROPIC_API_KEY: 'k' }, settings: { apiKeyHelper: 'h' }, safety };
  assert.deepEqual(carryStageOpts(full), { signInSettings: { apiKeyHelper: 'h' }, safetySettings: safety });
  assert.deepEqual(carryEnv(full), { ANTHROPIC_API_KEY: 'k' });
});

test('settingsFilePlan: only the settings move to a file; the args are built with it, nothing staged', () => {
  const calls = [];
  const buildArgs = (opts, extra) => { calls.push([opts, extra]); return ['-p', opts.prompt, '--settings', extra.settingsFile]; };
  const dir = join(tmpdir(), 'stage-x');
  const plan = settingsFilePlan({ opts: { prompt: 'hi' }, dir, files: [{ path: 'a', content: 'b' }], payload: { settings: { apiKeyHelper: 'h' } },
    inlineLength: 42, buildArgs });
  const settingsFile = join(dir, 'settings.json');
  assert.deepEqual(plan, { args: ['-p', 'hi', '--settings', settingsFile], stdin: null,
    files: [{ path: 'a', content: 'b' }, { path: settingsFile, content: '{"apiKeyHelper":"h"}' }], staged: false, inlineLength: 42 });
  assert.deepEqual(calls, [[{ prompt: 'hi' }, { settingsFile }]]);
});

test('settingsCanary.judgeThen: the verdict first, then the wrapped function\'s own result', () => {
  const d = tmp();
  const order = [];
  const c = settingsCanary({ pluginsOff: true, tryGuard: { logFile: join(d, 'connector-calls.ndjson') }, onEvent: () => order.push('said') });
  c.saw({ type: 'system', subtype: 'init' });
  const done = c.judgeThen((code) => { order.push(`done ${code}`); return { exitCode: code }; });
  assert.deepEqual(done(3), { exitCode: 3 });
  assert.deepEqual(order, ['said', 'done 3']);
  const none = settingsCanary({ pluginsOff: false, tryGuard: null, onEvent: () => {} });
  assert.deepEqual(none.judgeThen((x) => x + 1)(1), 2);
});
