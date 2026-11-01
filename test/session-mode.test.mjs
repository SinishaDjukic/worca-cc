// test/session-mode.test.mjs — the run-start decision, one row per rule, first match wins (D3: never refuse, never auto-shared).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSessionMode, CLAUDE_AGENTS_FILE_MIN } from '../src/core/session-mode.mjs';
import { checkRows } from './helpers/rows.mjs';

const spec = (mode = 'subagents', n = 2) => ({ sid: 's_aaaaaaaa', members: ['n_a', 'n_b', 'n_c'].slice(0, n), settings: { mode } });
const OK = { spec: spec(), engine: 'claude', caps: {}, flagOn: true, env: {}, cliVersion: '2.1.308', verified: { claude: true }, modelEnvs: ['null', 'null', 'null'] };
const pick = (over) => { const r = chooseSessionMode({ ...OK, ...over }); return [r.mode, r.reason]; };

test('the decision table', async () => {
  assert.equal(CLAUDE_AGENTS_FILE_MIN, '2.1.281');
  await checkRows([
    { name: 'ok', run: () => assert.deepEqual(pick({}), ['subagents', 'ok']) },
    { name: 'one step', run: () => assert.deepEqual(pick({ spec: spec('subagents', 1) }), ['separate', 'one step']) },
    { name: 'kill switch beats everything else', run: () => assert.deepEqual(pick({ env: { WORCA_SESSIONS_DISABLE: '1' }, spec: spec('shared') }), ['separate', 'WORCA_SESSIONS_DISABLE=1']) },
    { name: 'flag off', run: () => assert.deepEqual(pick({ flagOn: false }), ['separate', 'the Labs flag sessionGroups is off']) },
    { name: 'shared opted in, any engine that resumes', run: () => assert.deepEqual(pick({ spec: spec('shared'), engine: 'cursor', caps: { subagents: false } }), ['shared', 'chosen in the session settings']) },
    { name: 'shared on an engine that cannot resume', run: () => assert.deepEqual(pick({ spec: spec('shared'), engine: 'cursor', caps: { resume: false } }), ['separate', 'Cursor cannot resume a session']) },
    { name: 'no sub-agents', run: () => assert.deepEqual(pick({ engine: 'gemini', caps: { subagents: false } }), ['separate', 'Gemini CLI has no sub-agents']) },
    { name: 'gate closed', run: () => assert.deepEqual(pick({ verified: { claude: false } }), ['separate', 'sub-agents are not available on Claude yet']) },
    { name: 'version unknown', run: () => assert.deepEqual(pick({ cliVersion: null }), ['separate', 'the Claude Code version is unknown']) },
    { name: 'old CLI', run: () => assert.deepEqual(pick({ cliVersion: '2.1.278' }), ['separate', 'Claude Code 2.1.278 is older than 2.1.281']) },
    { name: 'the floor itself passes', run: () => assert.deepEqual(pick({ cliVersion: '2.1.281' }), ['subagents', 'ok']) },
    { name: 'no --forward-subagent-text on this CLI', run: () => assert.deepEqual(pick({ cliVersion: '2.1.294', caps: { forwardSubagentText: false } }), ['separate', 'Claude Code 2.1.294 cannot forward sub-agent text']) },
    { name: 'flag present (or not probed) passes', run: () => assert.deepEqual(pick({ caps: { forwardSubagentText: true } }), ['subagents', 'ok']) },
    { name: 'mixed endpoints', run: () => assert.deepEqual(pick({ modelEnvs: ['null', '{"ANTHROPIC_BASE_URL":"x"}', 'null'] }), ['separate', 'the steps use different model endpoints']) },
    { name: 'one bridged model on every member is one endpoint', run: () => assert.deepEqual(pick({ modelEnvs: ['{"ANTHROPIC_BASE_URL":"http://127.0.0.1:7/b"}', '{"ANTHROPIC_BASE_URL":"http://127.0.0.1:7/b"}'] }), ['subagents', 'ok']) },
    { name: 'codex skips the CLI floor', run: () => assert.deepEqual(pick({ engine: 'codex', verified: { codex: true }, cliVersion: null }), ['subagents', 'ok']) },
  ]);
});

// ── v2: every row's order against the next, the exact matches, and the shipped gate (compared, never pinned here) ──
import { SESSION_SUBAGENTS_VERIFIED } from '../src/shared/engine-switch.mjs';

test('v2 — rule order, exact matches and `requested`', async () => {
  await checkRows([
    { name: 'requested is echoed', run: () => {
      assert.equal(chooseSessionMode(OK).requested, 'subagents');
      assert.equal(chooseSessionMode({ ...OK, spec: spec('shared'), flagOn: false }).requested, 'shared');
    } },
    { name: 'one step beats the kill switch', run: () => assert.deepEqual(pick({ spec: spec('subagents', 1), env: { WORCA_SESSIONS_DISABLE: '1' } }), ['separate', 'one step']) },
    { name: 'four steps are fine', run: () => assert.deepEqual(pick({ spec: { ...spec(), members: ['n_a', 'n_b', 'n_c', 'n_d'] } }), ['subagents', 'ok']) },
    { name: 'only "1" is the kill switch', run: () => { for (const v of ['0', 'true', '']) assert.deepEqual(pick({ env: { WORCA_SESSIONS_DISABLE: v } }), ['subagents', 'ok']); } },
    { name: 'the kill switch beats the flag', run: () => assert.deepEqual(pick({ env: { WORCA_SESSIONS_DISABLE: '1' }, flagOn: false }), ['separate', 'WORCA_SESSIONS_DISABLE=1']) },
    { name: 'the flag beats shared', run: () => assert.deepEqual(pick({ flagOn: false, spec: spec('shared') }), ['separate', 'the Labs flag sessionGroups is off']) },
    { name: 'shared on Claude with no resume', run: () => assert.deepEqual(pick({ spec: spec('shared'), caps: { resume: false } }), ['separate', 'Claude cannot resume a session']) },
    { name: 'no sub-agents beats the gate', run: () => assert.deepEqual(pick({ caps: { subagents: false }, verified: { claude: false } }), ['separate', 'Claude has no sub-agents']) },
    { name: 'the gate needs exactly true', run: () => assert.deepEqual(pick({ verified: { claude: 1 } }), ['separate', 'sub-agents are not available on Claude yet']) },
    { name: 'the gate beats the version', run: () => assert.deepEqual(pick({ verified: {}, cliVersion: null }), ['separate', 'sub-agents are not available on Claude yet']) },
    { name: 'an unknown version beats mixed endpoints', run: () => assert.deepEqual(pick({ cliVersion: '', modelEnvs: ['a', 'b'] }), ['separate', 'the Claude Code version is unknown']) },
    { name: 'an old CLI beats the missing flag', run: () => assert.deepEqual(pick({ cliVersion: '2.1.280', caps: { forwardSubagentText: false } }), ['separate', 'Claude Code 2.1.280 is older than 2.1.281']) },
    { name: 'the missing flag beats mixed endpoints', run: () => assert.deepEqual(pick({ caps: { forwardSubagentText: false }, modelEnvs: ['a', 'b'] }), ['separate', 'Claude Code 2.1.308 cannot forward sub-agent text']) },
    { name: 'the Claude-only rows skip other engines', run: () => assert.deepEqual(pick({ engine: 'codex', verified: { codex: true }, cliVersion: '0.1.0', caps: { forwardSubagentText: false } }), ['subagents', 'ok']) },
    { name: 'mixed endpoints on codex', run: () => assert.deepEqual(pick({ engine: 'codex', verified: { codex: true }, modelEnvs: ['a', 'b'] }), ['separate', 'the steps use different model endpoints']) },
    { name: 'no endpoints is one endpoint', run: () => assert.deepEqual(pick({ modelEnvs: [] }), ['subagents', 'ok']) },
  ]);
});

test('v2 — C13: Claude follows SESSION_SUBAGENTS_VERIFIED; a mock run passes { [engine]: true } (Task 44) and runs sub-agents', () => {
  const real = chooseSessionMode({ ...OK, verified: SESSION_SUBAGENTS_VERIFIED });
  assert.deepEqual([real.mode, real.reason], SESSION_SUBAGENTS_VERIFIED.claude === true ? ['subagents', 'ok'] : ['separate', 'sub-agents are not available on Claude yet']);
  assert.deepEqual(pick({ verified: { claude: true }, cliVersion: CLAUDE_AGENTS_FILE_MIN }), ['subagents', 'ok']);
});

// ── v4 ──
test('v4 — null caps, a spec without members or mode; `requested` is echoed on every result', () => {
  assert.deepEqual(chooseSessionMode({ ...OK, caps: null }), { mode: 'subagents', requested: 'subagents', reason: 'ok' }, 'null caps mean capable');
  assert.deepEqual(chooseSessionMode({ ...OK, spec: { settings: { mode: 'subagents' } } }), { mode: 'separate', requested: 'subagents', reason: 'one step' });
  assert.deepEqual(chooseSessionMode({ ...OK, spec: { members: ['n_a', 'n_b'], settings: {} } }), { mode: 'subagents', requested: undefined, reason: 'ok' }, 'no mode set: the default, and requested says so');
  assert.deepEqual(chooseSessionMode({ ...OK, spec: spec('shared') }), { mode: 'shared', requested: 'shared', reason: 'chosen in the session settings' });
});

// ── v5 ──
test('v5 — a caller that passes no flagOn gets the flag-off row; row 4 is for a shared request only; versions compare as numbers', () => {
  const noFlag = { ...OK };
  delete noFlag.flagOn;
  assert.deepEqual(chooseSessionMode(noFlag), { mode: 'separate', requested: 'subagents', reason: 'the Labs flag sessionGroups is off' });
  assert.deepEqual(pick({ caps: { resume: false } }), ['subagents', 'ok'], 'sub-agents do not need the shared mode\'s resume check');
  assert.deepEqual(pick({ cliVersion: '2.1.1000' }), ['subagents', 'ok'], '2.1.1000 is newer than 2.1.281');
  assert.deepEqual(pick({ cliVersion: '2.1.99' }), ['separate', 'Claude Code 2.1.99 is older than 2.1.281']);
});
