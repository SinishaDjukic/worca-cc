// test/requirements-9c-steps.test.mjs — rounds and code looks run on the feature's harness (9c Task 7); fake runner only.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature, setContext } from '../src/core/requirements/store.mjs';
import { startOrientation, settled } from '../src/core/requirements/interview.mjs';
import { ORIENTATION_SYSTEM_PROMPT, orientationSystemPrompt } from '../src/core/requirements/round.mjs';

useTempHome(after);
beforeEach(() => {
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  setContext('project', 'shop-1234abcd', { lookAtCode: true });
});

const ROUND1 = { spec: { goal: { text: 'Cancel before shipping', measure: 'fewer calls' } },
  criteria: [{ id: null, text: 'A customer can cancel an unpaid order' }],
  questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'w' }],
  done: false, note: 'One question.' };
const LOOK = { summary: 'Orders have a status.', files: ['src/orders.js'] };

function fakeRunner(replies) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const reply = replies.shift();
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text }, costUsd: 0.1 });
    return { text };
  };
  return { calls, runClaudeImpl };
}
const repoDir = mkdtempSync(join(tmpdir(), 'req-9c-steps-'));
const configs = [];
function deps(runner, extra = {}) {
  return {
    runClaudeImpl: runner.runClaudeImpl,
    listModels: async () => [{ id: 'claude-opus-5-5' }],
    listProjects: async () => [{ key: 'shop-1234abcd', name: 'shop', path: repoDir, exists: true }],
    workspaceTarget: async () => null,
    openLook: async () => ({ cwd: repoDir, close: async () => {} }),
    openWorkspaceLook: async () => null,
    onChange: () => {},
    interviewSlot: () => ({}),
    userSignIn: () => false,
    validate: async (model) => ({ ok: true, model }),
    engines: () => ['claude', 'codex', 'copilot', 'gemini'],
    gate: async () => null,
    writeFilesMcpConfig: (o) => { configs.push(o); return join(repoDir, 'files-mcp.json'); },
    removeCodexThread: () => true,
    scratch: repoDir,
    ...extra,
  };
}
const featureOn = (engine, model = 'some-model') => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'Before it ships' });
  updateFeature(f.seq, { model: { engine, model, effort: null } });
  return f;
};

test('orientationSystemPrompt: Claude gets the same string; Codex and Copilot the read-tools sentence', () => {
  assert.equal(orientationSystemPrompt('claude'), ORIENTATION_SYSTEM_PROMPT);
  assert.equal(orientationSystemPrompt(), ORIENTATION_SYSTEM_PROMPT);
  for (const e of ['codex', 'copilot']) {
    const p = orientationSystemPrompt(e);
    assert.ok(p.includes('You can only read, with the read_file, grep and glob tools (absolute paths under the folder the message names). You cannot run commands or change anything, and you have only a few steps: answer before they run out.'));
    assert.ok(!p.includes('Glob finds files'));
  }
});

test('a Codex feature: the round is locked down; the look is read-only with a files server rooted at its cwd', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([LOOK, ROUND1]);
  startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  const [look, round] = r.calls;
  assert.equal(look.engine, 'codex');
  assert.equal(look.sandbox, 'read-only');
  assert.ok(look.mcpConfigPath);
  assert.deepEqual(configs.at(-1).roots, [repoDir]);
  assert.ok(look.systemPrompt.includes('read_file, grep and glob'));
  assert.equal(round.engine, 'codex');
  assert.equal(round.askLockdown, true);
  const turns = listTurns(f.seq);
  assert.equal(turns.find((t) => t.kind === 'orientation').engine, 'codex');
  assert.equal(turns.find((t) => t.kind === 'round').engine, 'codex');
});

test('a Gemini feature: the look makes no call and says why; the round notes the kept copy', async () => {
  const f = featureOn('gemini');
  const r = fakeRunner([ROUND1]);
  startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 1);
  const turns = listTurns(f.seq);
  const look = turns.find((t) => t.kind === 'orientation');
  assert.equal(look.payload.skipped, 'engine');
  assert.deepEqual(look.notices, ["Repo not read: Gemini CLI can't read the repo."]);
  const round = turns.find((t) => t.kind === 'round');
  assert.equal(round.engine, 'gemini');
  assert.ok(round.notices.includes('Gemini CLI keeps its own copy of this step in its history on this computer.'));
});

test('a Codex feature that is not signed in: a NOT_READY error turn, nothing charged', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([ROUND1]);
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  startOrientation(f.seq, {}, deps(r, { gate: async () => ({ message: 'Codex is not signed in' }) }));
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  const err = listTurns(f.seq).find((t) => t.kind === 'error');
  assert.equal(err.payload.code, 'NOT_READY');
  assert.equal(err.payload.message, "Codex isn't signed in. Sign in, or change the model.");
  assert.equal(err.payload.job, 'round');
  assert.ok(err.payload.docsUrl === null || typeof err.payload.docsUrl === 'string');
  assert.equal(getFeature(f.seq).status, 'your_turn');
  assert.ok(!(getFeature(f.seq).costUsd > 0));
});

test('a NULL-model feature runs on Claude with today\'s options', async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'x' });
  const r = fakeRunner([LOOK, ROUND1]);
  startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  for (const c of r.calls) { assert.equal(c.engine, undefined); assert.equal(c.askLockdown, undefined); assert.equal(c.sandbox, undefined); }
  assert.deepEqual([...r.calls[0].tools].sort(), ['Glob', 'Grep', 'Read']);
});
