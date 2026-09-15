// test/kiro-claude-shim.test.mjs
// The Kiro route is a DROP-IN BINARY (scripts/kiro-claude-shim.mjs), not a change to
// src/ — worca reaches it through the existing WORCA_CLAUDE_BIN seam. So these tests
// assert the two halves of that contract:
//   1. the pure translators (argv in, ACP out; ACP in, stream-json out)
//   2. an end-to-end spawn driven by runClaude() against a SCRIPTED FAKE kiro-cli,
//      which proves the real parser in claude-runner.mjs accepts what the shim emits.
// Nothing here touches the network or spends Kiro credits.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import {
  parseArgs, foldSystemPrompt, mapModel, hasPermissionRules, translate,
  parseUsdPerCredit, usdFromCredits,
} from '../scripts/kiro-claude-shim.mjs';

const SHIM = resolve(import.meta.dirname, '../scripts/kiro-claude-shim.mjs');

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-kiro-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// The end-to-end tests exercise the REAL spawn path, so mock must be off.
let prevMock, prevOrch, prevKiroBin, prevKiroModel, prevKiroRate;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK;
  prevKiroBin = process.env.WORCA_KIRO_BIN; prevKiroModel = process.env.WORCA_KIRO_MODEL;
  prevKiroRate = process.env.WORCA_KIRO_USD_PER_CREDIT;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  delete process.env.WORCA_KIRO_MODEL;
  // Unset by default: the baseline contract is "no rate configured -> no dollars".
  delete process.env.WORCA_KIRO_USD_PER_CREDIT;
});
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
  if (prevKiroBin === undefined) delete process.env.WORCA_KIRO_BIN; else process.env.WORCA_KIRO_BIN = prevKiroBin;
  if (prevKiroModel === undefined) delete process.env.WORCA_KIRO_MODEL; else process.env.WORCA_KIRO_MODEL = prevKiroModel;
  if (prevKiroRate === undefined) delete process.env.WORCA_KIRO_USD_PER_CREDIT; else process.env.WORCA_KIRO_USD_PER_CREDIT = prevKiroRate;
});

// ── pure: argv ───────────────────────────────────────────────────────────────

test('parseArgs reads the argv worca actually emits (buildClaudeArgs)', () => {
  const o = parseArgs([
    '-p', 'do the thing', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--resume', 'sid-1',
    '--append-system-prompt', 'you are a planner', '--model', 'claude-sonnet-4-6',
    '--effort', 'high', '--allowedTools', 'Read,Write',
  ]);
  assert.equal(o.prompt, 'do the thing');
  assert.equal(o.systemPrompt, 'you are a planner');
  assert.equal(o.model, 'claude-sonnet-4-6');
  assert.equal(o.effort, 'high');
  assert.equal(o.resume, 'sid-1');
  // --output-format / --permission-mode values are consumed, never mistaken for the prompt
  assert.equal(o.prompt, 'do the thing');
});

test('foldSystemPrompt carries the system prompt into the user message', () => {
  assert.equal(foldSystemPrompt('', 'hi'), 'hi');           // no system prompt: untouched
  const folded = foldSystemPrompt('BE TERSE', 'hi');
  assert.match(folded, /<system-instructions>\nBE TERSE\n<\/system-instructions>/);
  assert.ok(folded.endsWith('hi'));
});

test('mapModel routes worca catalog ids onto real Kiro models', () => {
  assert.deepEqual(mapModel('claude-sonnet-4.5'), { model: 'claude-sonnet-4.5', note: '' });  // known: untouched
  assert.equal(mapModel('claude-sonnet-4-6').model, 'claude-sonnet-4.5');
  assert.equal(mapModel('claude-sonnet-4-6[1m]').model, 'claude-sonnet-4.5');                 // 1M twin
  assert.equal(mapModel('claude-haiku-4-5-20251001').model, 'claude-haiku-4.5');              // title model
  assert.equal(mapModel('claude-opus-4-8').model, 'claude-sonnet-4.5');                       // no Opus on Kiro
  assert.ok(mapModel('claude-opus-4-8').note, 'a substitution must be reported, never silent');
  assert.equal(mapModel('glm-5').note, '', 'a native Kiro id needs no note');
  assert.equal(mapModel('').model, '');
});

test('mapModel honors WORCA_KIRO_MODEL as a hard override', () => {
  process.env.WORCA_KIRO_MODEL = 'qwen3-coder-next';
  assert.equal(mapModel('claude-opus-4-8').model, 'qwen3-coder-next');
});

test('hasPermissionRules only fires on real guardrail rules', () => {
  assert.equal(hasPermissionRules(''), false);
  assert.equal(hasPermissionRules(JSON.stringify({ hooks: {} })), false);
  assert.equal(hasPermissionRules(JSON.stringify({ permissions: { deny: [] } })), false);
  assert.equal(hasPermissionRules('not json'), false);
  assert.equal(hasPermissionRules(JSON.stringify({ permissions: { deny: ['Bash(curl:*)'] } })), true);
});

// ── pure: credits -> dollars ─────────────────────────────────────────────────

test('parseUsdPerCredit treats an unusable rate as unset, never as a number', () => {
  assert.equal(parseUsdPerCredit('0.04'), 0.04);
  assert.equal(parseUsdPerCredit(' 0.04 '), 0.04);       // env vars arrive with whitespace
  assert.equal(parseUsdPerCredit(undefined), null);
  assert.equal(parseUsdPerCredit(''), null);
  assert.equal(parseUsdPerCredit('four cents'), null);   // a typo must not become NaN dollars
  assert.equal(parseUsdPerCredit('0'), null);
  assert.equal(parseUsdPerCredit('-0.04'), null);
});

test('usdFromCredits converts, and stays silent when it cannot', () => {
  assert.equal(usdFromCredits(0.0176, 0.04), 0.0176 * 0.04);
  assert.equal(usdFromCredits(2, 0.5), 1);
  assert.equal(usdFromCredits(0.0176, null), null, 'no rate -> no dollars');
  // 0 credits means the meter was never seen (metadata has no ordering guarantee vs
  // the prompt response), NOT that the step was free — reporting $0.00 would lie.
  assert.equal(usdFromCredits(0, 0.04), null);
});

// ── pure: ACP -> stream-json ─────────────────────────────────────────────────

const upd = (update) => ({ jsonrpc: '2.0', method: 'session/update', params: { update } });

test('translate maps the three ACP update kinds onto claude event shapes', () => {
  const state = { replaying: false };

  const [txt] = translate(upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } }), state);
  assert.equal(txt.type, 'assistant');
  assert.deepEqual(txt.message.content, [{ type: 'text', text: 'hello' }]);

  const [call] = translate(upd({
    sessionUpdate: 'tool_call', toolCallId: 'tc1', kind: 'edit', title: 'Creating a.txt', rawInput: { path: 'a.txt' },
  }), state);
  assert.equal(call.type, 'assistant');
  assert.equal(call.message.content[0].type, 'tool_use');
  assert.equal(call.message.content[0].id, 'tc1');
  assert.equal(call.message.content[0].name, 'Edit');       // kind -> claude-style name

  const [done] = translate(upd({
    sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed', title: 'Creating a.txt',
  }), state);
  assert.equal(done.type, 'user');
  assert.equal(done.message.content[0].type, 'tool_result');
  assert.equal(done.message.content[0].tool_use_id, 'tc1');

  // in-flight updates are not finishes
  assert.deepEqual(translate(upd({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'in_progress' }), state), []);
});

test('translate drops the history session/load replays', () => {
  const chunk = upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'stale' } });
  assert.deepEqual(translate(chunk, { replaying: true }), [], 'replayed history must never reach worca');
  assert.equal(translate(chunk, { replaying: false }).length, 1);
});

// ── end-to-end: runClaude -> shim -> fake kiro-cli ───────────────────────────

/**
 * Write a fake `kiro-cli acp` that answers the JSON-RPC handshake and then emits a
 * scripted turn. `extra` lets a test inject replayed history before the live text.
 */
async function fakeKiro(dir, { replayText = null } = {}) {
  const path = join(dir, 'fake-kiro.mjs');
  await writeFile(path, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const upd = (u) => out({ jsonrpc: '2.0', method: 'session/update', params: { update: u } });
createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1 } });
  if (m.method === 'session/new' || m.method === 'session/load') {
    ${replayText ? `if (m.method === 'session/load') upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ${JSON.stringify(replayText)} } });` : ''}
    return out({ jsonrpc: '2.0', id: m.id, result: { sessionId: 'kiro-sid-42' } });
  }
  if (m.method === 'session/prompt') {
    globalThis.__prompt = m.params.prompt[0].text;
    upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PROMPT=' + globalThis.__prompt.length + ';' } });
    upd({ sessionUpdate: 'tool_call', toolCallId: 'tc9', kind: 'execute', title: 'Running tests', rawInput: { cmd: 'npm test' } });
    upd({ sessionUpdate: 'tool_call_update', toolCallId: 'tc9', status: 'completed', title: 'Running tests' });
    out({ jsonrpc: '2.0', method: '_kiro.dev/metadata', params: { meteringUsage: [{ value: 0.0176, unit: 'credit' }] } });
    upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ALL GREEN' } });
    return out({ jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn' } });
  }
});
`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

test('runClaude drives the shim end to end and reads back text, session and tools', async () => {
  const dir = await makeTmpDir();
  process.env.WORCA_KIRO_BIN = await fakeKiro(dir);

  const events = [];
  const { text, exitCode } = await runClaude({
    cwd: dir,
    bin: SHIM,                                   // the WORCA_CLAUDE_BIN seam, no src/ change
    prompt: 'implement the plan',
    systemPrompt: 'you are the implementer',
    model: 'claude-opus-4-8',                    // exercises the alias substitution
    effort: 'high',
    onEvent: (e) => events.push(e),
  });

  assert.equal(exitCode, 0);
  // Terminal result carries the full assistant text, so worca's `resultText` wins.
  assert.match(text, /ALL GREEN$/);

  // The session id reached worca's runner -> it can be persisted for --resume.
  const session = events.find((e) => e.type === 'session');
  assert.equal(session?.sessionId, 'kiro-sid-42');

  // Tool lifecycle survived the translation (this is what the UI's pills read).
  const toolUse = events.find((e) => e.raw?.message?.content?.[0]?.type === 'tool_use');
  assert.equal(toolUse.raw.message.content[0].name, 'Bash');       // ACP kind 'execute'
  const toolResult = events.find((e) => e.raw?.message?.content?.[0]?.type === 'tool_result');
  assert.equal(toolResult.raw.message.content[0].tool_use_id, 'tc9');

  // Credits are logged, and with NO rate configured they are never passed off as USD.
  const logs = events.filter((e) => e.type === 'log').map((e) => e.text).join('\n');
  assert.match(logs, /credits: 0\.0176/);
  assert.match(logs, /claude-opus-4-8 -> claude-sonnet-4\.5/);
  assert.equal(events.some((e) => e.costUsd != null), false, 'credits must not be passed off as USD');
  assert.match(logs, /set WORCA_KIRO_USD_PER_CREDIT/, 'and the operator is told how to get dollars');

  // The system prompt was folded in, so the model saw more than the bare prompt.
  assert.match(text, /PROMPT=\d+/);
  const seen = Number(text.match(/PROMPT=(\d+)/)[1]);
  assert.ok(seen > 'implement the plan'.length, 'system prompt must reach the model');
});

test('WORCA_KIRO_USD_PER_CREDIT turns metered credits into a real costUsd', async () => {
  const dir = await makeTmpDir();
  process.env.WORCA_KIRO_BIN = await fakeKiro(dir);
  process.env.WORCA_KIRO_USD_PER_CREDIT = '0.04';

  const events = [];
  const { exitCode } = await runClaude({ cwd: dir, bin: SHIM, prompt: 'x', onEvent: (e) => events.push(e) });

  assert.equal(exitCode, 0);
  // The whole point: extractResultCost() in claude-runner.mjs reads it, so the number
  // flows on into per-phase spend, the budget cap and the stats rollups unchanged.
  const costed = events.filter((e) => e.costUsd != null);
  assert.equal(costed.length, 1, 'exactly the terminal result carries the cost');
  assert.ok(Math.abs(costed[0].costUsd - 0.0176 * 0.04) < 1e-12);
  const logs = events.filter((e) => e.type === 'log').map((e) => e.text).join('\n');
  // Derivation is logged, so a wrong dollar figure is always traceable to the rate.
  assert.match(logs, /0\.0176 credits x \$0\.04\/credit = \$0\.0007/);
});

test('a garbled rate reports no dollars rather than NaN or zero', async () => {
  const dir = await makeTmpDir();
  process.env.WORCA_KIRO_BIN = await fakeKiro(dir);
  process.env.WORCA_KIRO_USD_PER_CREDIT = 'four cents';

  const events = [];
  await runClaude({ cwd: dir, bin: SHIM, prompt: 'x', onEvent: (e) => events.push(e) });

  assert.equal(events.some((e) => e.costUsd != null), false);
});

test('a resumed run reports the session id and drops replayed history', async () => {
  const dir = await makeTmpDir();
  process.env.WORCA_KIRO_BIN = await fakeKiro(dir, { replayText: 'STALE-HISTORY' });

  const { text, exitCode } = await runClaude({
    cwd: dir, bin: SHIM, prompt: 'continue', resumeSessionId: 'kiro-sid-42',
  });

  assert.equal(exitCode, 0);
  assert.ok(!text.includes('STALE-HISTORY'), 'session/load replay must not leak into the step result');
  assert.match(text, /ALL GREEN$/);
});

test('the shim refuses to run when guardrail permission rules are set', async () => {
  const dir = await makeTmpDir();
  process.env.WORCA_KIRO_BIN = await fakeKiro(dir);

  await assert.rejects(
    runClaude({
      cwd: dir, bin: SHIM, prompt: 'x',
      permissionRules: { deny: ['Bash(curl:*)'] },   // -> --settings, unsupported on Kiro
    }),
    // Non-zero exit; worca surfaces the is_error result text as the failure detail.
    /guardrail permission rules are not supported/,
  );
});

test('a kiro-cli that dies mid-turn fails the step instead of returning empty text', async () => {
  const dir = await makeTmpDir();
  const path = join(dir, 'dying-kiro.mjs');
  await writeFile(path, `#!/usr/bin/env node\nprocess.stderr.write('boom\\n');\nprocess.exit(7);\n`, 'utf8');
  await chmod(path, 0o755);
  process.env.WORCA_KIRO_BIN = path;

  await assert.rejects(
    runClaude({ cwd: dir, bin: SHIM, prompt: 'x' }),
    /exited with code 7|boom/,
  );
});
