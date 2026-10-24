// test/ask-command-tools.test.mjs
// Ask agent mode (#574): the five command tools (tools.mjs) and the MCP child's HTTP bridge (command-deps.mjs).
// The tools are hidden unless the parent handed WORCA_ASK_COMMANDS + ASK_COMMAND_TOKEN to the child.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { defaultCommandDeps } from '../src/core/ask/command-deps.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';

// A reader-only bundle shaped like test/ask-web-tools.test.mjs's `fake`.
const fake = {
  buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
  listAllPipelines: async () => [],
  lookupPipelineRow: () => null,
  findPipelineRowById: () => null,
  totalsFor: () => ({ cost: null, active: null }),
  readStoreMeta: () => null,
  readDiffPatch: async () => null,
  hasDiffPatch: async () => false,
  readAttachment: () => null,
  validateProposal: async (input) => ({ ok: true, card: { echoed: input } }),
  protectedPaths: [],
};
const base = { redact: redactAskText, limits: ASK_LIMITS };
const calls = [];
const commands = {
  run: async (input) => { calls.push(['run', input]); return { ok: true, blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: input.command, cwd: '/w', folder: 'p', warning: null }; },
  read: async (input) => ({ blockId: input.blockId, status: 'done', exitCode: 0, text: 'token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', offset: 0, nextOffset: null, totalChars: 10 }),
  wait: async (input) => ({ blockId: input.blockId, status: 'done', exitCode: 1, matched: null, timedOut: false, tail: 'FAIL' }),
  stop: async (input) => ({ ok: true, stopping: true }),
  list: async () => ({ blocks: [] }),
};
const names = (t) => t.list().map((d) => d.name);

test('no WORCA_ASK_COMMANDS ⇒ no bundle (tools hidden)', () => {
  assert.deepEqual(defaultCommandDeps({ env: {} }), {});
  assert.deepEqual(defaultCommandDeps({ env: { WORCA_ASK_COMMANDS: JSON.stringify({ url: 'http://127.0.0.1:1/api/ask/commands' }) } }), {}); // no token
});

test('the five tools are last, in order, only with the bundle', () => {
  assert.ok(!names(createAskTools({ ...fake, ...base })).includes('run_command'));
  assert.deepEqual(names(createAskTools({ ...fake, ...base, commands })).slice(-5),
    ['run_command', 'read_output', 'wait_for', 'stop_command', 'list_blocks']);
});

test('run_command validates before calling the bridge', async () => {
  const t = createAskTools({ ...fake, ...base, commands });
  await assert.rejects(t.call('run_command', {}), /command is required/);
  await assert.rejects(t.call('run_command', { command: 'a\nb' }), /one line/);
  const r = await t.call('run_command', { command: 'npm test', projectKey: 'p' });
  assert.equal(r.blockId, 't-0000000001:1');
  assert.deepEqual(calls.at(-1), ['run', { command: 'npm test', runId: null, member: null, projectKey: 'p', summary: null }]);
});

test('run_command passes an optional summary through (#911)', async () => {
  const t = createAskTools({ ...fake, ...base, commands });
  await t.call('run_command', { command: 'npm test', projectKey: 'p', summary: 'Running the tests' });
  assert.equal(calls.at(-1)[1].summary, 'Running the tests');
});

test('read_output redacts; wait_for clamps its timeout', async () => {
  const t = createAskTools({ ...fake, ...base, commands });
  const r = await t.call('read_output', { blockId: 't-0000000001:1' });
  assert.doesNotMatch(r.text, /ghp_abcdefghij/);
  let seen = null;
  const t2 = createAskTools({ ...fake, ...base, commands: { ...commands, wait: async (i) => { seen = i; return { status: 'running', timedOut: true, tail: '' }; } } });
  await t2.call('wait_for', { blockId: 't-0000000001:1', timeoutSec: 9999 });
  assert.equal(seen.timeoutSec, ASK_LIMITS.commandWaitMaxSec);
});

test('the HTTP bridge sends op, input and the token header', async () => {
  let req = null;
  const deps = defaultCommandDeps({ env: { WORCA_ASK_COMMANDS: JSON.stringify({ url: 'http://127.0.0.1:9/api/ask/commands' }), ASK_COMMAND_TOKEN: 'tok' },
    fetchImpl: async (url, init) => { req = { url, init }; return { ok: true, json: async () => ({ result: { ok: true } }) }; } });
  await deps.commands.run({ command: 'ls' });
  assert.equal(req.url, 'http://127.0.0.1:9/api/ask/commands');
  assert.equal(req.init.headers['x-worca-ask-command'], 'tok');
  assert.deepEqual(JSON.parse(req.init.body), { op: 'run', input: { command: 'ls' } });
});

test('without the bundle a command tool call is refused, not a crash', async () => {
  const t = createAskTools({ ...fake, ...base });
  await assert.rejects(t.call('run_command', { command: 'ls' }), (e) => /agent mode is off/.test(e.message) && !/switch/i.test(e.message));
});
