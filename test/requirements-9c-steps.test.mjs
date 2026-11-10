// test/requirements-9c-steps.test.mjs — rounds and code looks run on the feature's harness (9c Task 7); fake runner only.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import { createFeature, getFeature, listTurns, updateFeature, setContext, listHelperMessages, listAttachments, getBrief, beginBrief, saveBriefResult } from '../src/core/requirements/store.mjs';
import { sendMessage } from '../src/core/requirements/helper.mjs';
import { addAttachments, readsSettled, queueSkippedReads, askAttachment } from '../src/core/requirements/attachment-job.mjs';
import { makeBrief, briefSettled } from '../src/core/requirements/brief-job.mjs';
import { BRIEF_SYSTEM_PROMPT, briefSystemPrompt } from '../src/core/requirements/brief.mjs';
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
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0, 'nothing booked, not even an unknown row');
});

test('a Codex look that is not signed in: the NOT_READY error turn records the engine, nothing booked', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  startOrientation(f.seq, {}, deps(r, { gate: async () => ({ message: 'Codex is not signed in' }) }));
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  const err = listTurns(f.seq).find((t) => t.kind === 'error');
  assert.equal(err.payload.code, 'NOT_READY');
  assert.equal(err.payload.job, 'look');
  assert.equal(err.engine, 'codex');
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0);
});

test('a Copilot feature: the look is read-only with a files server', async () => {
  const f = featureOn('copilot');
  const r = fakeRunner([LOOK, ROUND1]);
  startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  const [look, round] = r.calls;
  assert.equal(look.engine, 'copilot');
  assert.equal(look.sandbox, 'read-only');
  assert.ok(look.mcpConfigPath);
  assert.ok(look.systemPrompt.includes('read_file, grep and glob'));
  assert.equal(round.askLockdown, true);
});

test('a billed attempt then a pre-result failure stays billed in the ledger', async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'x' });
  setContext('project', 'shop-1234abcd', { lookAtCode: false });
  let n = 0;
  const runClaudeImpl = async (opts) => {
    n += 1;
    if (n === 2) throw new Error('the model crashed');
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: 'not json' }, costUsd: 0.1 });
    return { text: 'not json at all' };
  };
  startOrientation(f.seq, {}, deps({ runClaudeImpl }));
  await settled(f.seq);
  assert.equal(n, 2);
  const rows = prepare('SELECT cost_kind, amount_usd FROM req_cost_ledger WHERE feature_seq = ?').all(f.seq);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost_kind, 'billed');
  assert.ok(rows[0].amount_usd > 0);
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

// ---------------------------------------------------------------- Task 8: Feature chat, file reads, the brief

const CHAT = { text: 'Cancelling until pick-up covers it.', drafts: [], proposals: [] };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const textFile = (name, text) => { const data = Buffer.from(text); return { name, kind: 'text', mime: 'text/plain', data, text, bytes: data.length, sha256: sha(data) }; };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngFile = (name = 'screen.png') => ({ name, kind: 'image', mime: 'image/png', data: PNG, bytes: PNG.length, sha256: sha(PNG) });
const own = (f) => ({ type: 'feature', id: f.seq });

test('Feature chat on Codex is locked down and stores its engine', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([CHAT]);
  await sendMessage(f.seq, { text: 'Who may cancel?' }, { by: 'po' }, deps(r));
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].engine, 'codex');
  assert.equal(r.calls[0].askLockdown, true);
  const row = listHelperMessages(f.seq).at(-1);
  assert.equal(row.role, 'worca');
  assert.equal(row.engine, 'codex');
  assert.equal(row.error, null);
});

test('Feature chat on Gemini stores the keeps-copy notice', async () => {
  const f = featureOn('gemini');
  const r = fakeRunner([CHAT]);
  await sendMessage(f.seq, { text: 'Hi' }, { by: 'po' }, deps(r));
  const row = listHelperMessages(f.seq).at(-1);
  assert.equal(row.engine, 'gemini');
  assert.ok(row.notices.includes('Gemini CLI keeps its own copy of this step in its history on this computer.'));
});

test('Feature chat on a harness that is not signed in: NOT_READY row, no call, nothing booked', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([CHAT]);
  await sendMessage(f.seq, { text: 'Hi' }, { by: 'po' }, deps(r, { gate: async () => ({ message: 'Codex is not signed in' }) }));
  assert.equal(r.calls.length, 0);
  const row = listHelperMessages(f.seq).at(-1);
  assert.equal(row.error.code, 'NOT_READY');
  assert.equal(row.error.message, "Codex isn't signed in. Sign in, or change the model.");
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0);
});

test("a NULL-model feature's chat keeps today's options", async () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Cancel order', description: 'x' });
  const r = fakeRunner([CHAT]);
  await sendMessage(f.seq, { text: 'Hi' }, { by: 'po' }, deps(r));
  assert.equal(r.calls[0].engine, undefined);
  assert.equal(r.calls[0].askLockdown, undefined);
});

test('a PNG on a Codex feature is not sent anywhere; a 30 KB text says too large; a 2 KB text on Gemini is read inline', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  addAttachments(own(f), [pngFile(), textFile('big.txt', 'x'.repeat(30 * 1024))], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  assert.equal(r.calls.length, 0);
  const rows = listAttachments('feature', f.seq);
  const png = rows.find((x) => x.name === 'screen.png');
  assert.equal(png.status, 'failed');
  assert.equal(png.error.code, 'SKIPPED_ENGINE');
  assert.equal(png.error.message, 'screen.png skipped: Codex gets files as text only.');
  assert.equal(rows.find((x) => x.name === 'big.txt').error.message, 'big.txt skipped: it is too large for Codex.');

  const g = featureOn('gemini');
  const r2 = fakeRunner([{ summary: 'Refunds within 14 days.' }]);
  addAttachments(own(g), [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(r2));
  await readsSettled(own(g));
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].engine, 'gemini');
  assert.equal(r2.calls[0].askLockdown, true);
  assert.equal(r2.calls[0].readGuard, undefined);
  const row = listAttachments('feature', g.seq)[0];
  assert.equal(row.status, 'done');
  assert.equal(row.readEngine, 'gemini');
});

test('switching the feature to Claude re-queues the skipped files (queueSkippedReads); Codex re-queues neither', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([{ summary: 'Hello.' }]);
  addAttachments(own(f), [pngFile(), textFile('big.txt', 'x'.repeat(30 * 1024)), textFile('small.txt', 'hello')], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  assert.equal(r.calls.length, 1, 'only the small text was read');
  assert.equal(queueSkippedReads(f.seq, 'codex', deps(r)), 0);
  updateFeature(f.seq, { model: { engine: 'claude', model: 'claude-opus-5-5', effort: null } });
  const r2 = fakeRunner([{ summary: 'A screen.' }, { summary: 'A big text.' }]);
  assert.equal(queueSkippedReads(f.seq, 'claude', deps(r2)), 2);
  await readsSettled(own(f));
  assert.equal(r2.calls.length, 2);
  assert.ok(listAttachments('feature', f.seq).every((x) => x.error?.code !== 'SKIPPED_ENGINE'), 'none is skipped any more');
});

test('a brief made with a Codex choice runs read-only with the files server and stores the engine; a no-repo choice is refused', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'req-9c-brief-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'src'), { recursive: true }); writeFileSync(join(repo, 'README.md'), 'hi'); g('add', '.'); g('commit', '-q', '-m', 'init');
  const KEY = 'brief-9c0001';
  setContext('project', KEY, { lookAtCode: true });
  const lookDir = mkdtempSync(join(tmpdir(), 'req-9c-lookdir-'));
  const reply = { product: 'A shop.', users: [], terms: [], areas: [], files: [] };
  const r = fakeRunner([reply, reply, reply]);
  const bd = (runner, key, extra = {}) => deps(runner, { listProjects: async () => [{ key, name: 'Shop', path: repo, exists: true }],
    openLook: async () => ({ cwd: lookDir, commit: 'abc', close: async () => {} }), budget: () => ({ blocked: false }),
    catalog: async () => ({ models: [{ id: 'gpt-x', harnesses: ['codex', 'gemini'], efforts: [] }] }), ...extra });
  await assert.rejects(() => makeBrief('project', KEY, { by: 'po', choice: { engine: 'gemini', model: 'gpt-x', effort: null } }, bd(r, KEY)),
    (e) => e.code === 'BAD_REQUEST' && e.message === "Gemini CLI can't read the repo, so it can't make a Product brief.");
  assert.equal(r.calls.length, 0);
  const { job } = await makeBrief('project', KEY, { by: 'po', choice: { engine: 'codex', model: 'gpt-x', effort: null } }, bd(r, KEY));
  await job; await briefSettled('project', KEY);
  const call = r.calls[0];
  assert.equal(call.engine, 'codex');
  assert.equal(call.sandbox, 'read-only');
  assert.ok(call.mcpConfigPath);
  assert.equal(call.systemPrompt, briefSystemPrompt('codex'));
  assert.ok(call.systemPrompt.includes('read_file, grep and glob'));
  const b = getBrief('project', KEY);
  assert.equal(b.engine, 'codex');
  assert.equal(b.model, 'gpt-x');
  // no choice with Default engine gemini: made on Claude
  const KEY2 = 'brief-9c0002';
  setContext('project', KEY2, { lookAtCode: true });
  const r3 = fakeRunner([reply]);
  const m = await makeBrief('project', KEY2, { by: 'po' }, bd(r3, KEY2, { resolveEngine: () => ({ engine: 'gemini' }), readiness: async () => [{ name: 'gemini', ready: true }] }));
  await m.job; await briefSettled('project', KEY2);
  assert.equal(r3.calls[0].engine, undefined);
  assert.equal(getBrief('project', KEY2).engine, 'claude');
  assert.equal(briefSystemPrompt('claude'), BRIEF_SYSTEM_PROMPT);
});

test("a brief document is read with the brief's own engine; a Claude brief's document reads as ever", async () => {
  const KEY = 'brief-9c0003';
  const b = beginBrief('project', KEY, { by: 'po' });
  saveBriefResult(b.id, { sections: undefined, model: 'gpt-x', engine: 'codex' }, { by: 'po' });
  const owner = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: KEY };
  const r = fakeRunner([{ summary: 'Policy.' }]);
  addAttachments(owner, [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(r));
  await readsSettled(owner);
  assert.equal(r.calls[0].engine, 'codex');
  assert.equal(r.calls[0].askLockdown, true);
  assert.equal(listAttachments('brief', b.id)[0].readEngine, 'codex');
  saveBriefResult(b.id, { model: 'claude-opus-5-5', engine: 'claude' }, { by: 'po' });
  const r2 = fakeRunner([{ summary: 'Policy.' }]);
  addAttachments(owner, [textFile('other.md', 'More.')], { by: 'po' }, deps(r2));
  await readsSettled(owner);
  assert.equal(r2.calls[0].engine, undefined);
});

test('a brief document is read on the brief\'s harness even without a stored model; a Claude brief reads with its stored model', async () => {
  const KEY = 'brief-9c0004';
  const b = beginBrief('project', KEY, { by: 'po' });
  saveBriefResult(b.id, { model: null, engine: 'codex' }, { by: 'po' });
  const owner = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: KEY };
  const cat = { catalog: async () => ({ defaults: { codex: { model: 'gpt-x' } }, models: [{ id: 'gpt-x', harnesses: ['codex'], efforts: [] }] }) };
  const r = fakeRunner([{ summary: 'Policy.' }]);
  addAttachments(owner, [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(r, cat));
  await readsSettled(owner);
  assert.equal(r.calls[0].engine, 'codex');
  assert.equal(r.calls[0].model, 'gpt-x');
  saveBriefResult(b.id, { model: 'claude-sonnet-5', engine: 'claude' }, { by: 'po' });
  const r2 = fakeRunner([{ summary: 'More.' }]);
  addAttachments(owner, [textFile('more.md', 'More.')], { by: 'po' }, deps(r2, { listModels: async () => [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5-5' }] }));
  await readsSettled(owner);
  assert.equal(r2.calls[0].engine, undefined);
  assert.equal(r2.calls[0].model, 'claude-sonnet-5');
});

test('mock mode skips a PNG on a Codex feature with the same words, and the failed turn carries the engine', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  addAttachments(own(f), [pngFile()], { by: 'po' }, deps(r, { mockEnabled: () => true }));
  await readsSettled(own(f));
  const row = listAttachments('feature', f.seq)[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.error.code, 'SKIPPED_ENGINE');
  assert.equal(row.error.message, 'screen.png skipped: Codex gets files as text only.');
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'file').at(-1).engine, 'codex');
});

test('an ask about a skipped PNG on a Codex feature makes no call', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  addAttachments(own(f), [pngFile()], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  const row = listAttachments('feature', f.seq)[0];
  try { askAttachment(own(f), row.id, 'What is on it?', { by: 'po' }, deps(r)); } catch { /* refused up front is fine too */ }
  await readsSettled(own(f));
  assert.equal(r.calls.length, 0);
});

test('a brief whose harness is not signed in fails with the NOT_READY sentence: no call, nothing booked', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'req-9c-brief-nr-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'hi'); g('add', '.'); g('commit', '-q', '-m', 'init');
  const KEY = 'brief-9c0005';
  setContext('project', KEY, { lookAtCode: true });
  const r = fakeRunner([]);
  const d = deps(r, { listProjects: async () => [{ key: KEY, name: 'Shop', path: repo, exists: true }],
    openLook: async () => ({ cwd: repo, commit: 'abc', close: async () => {} }), budget: () => ({ blocked: false }),
    catalog: async () => ({ models: [{ id: 'gpt-x', harnesses: ['codex'], efforts: [] }] }), gate: async () => ({ message: 'Codex is not signed in' }) });
  const { brief, job } = await makeBrief('project', KEY, { by: 'po', choice: { engine: 'codex', model: 'gpt-x', effort: null } }, d);
  await job; await briefSettled('project', KEY);
  assert.equal(r.calls.length, 0);
  const b = getBrief('project', KEY);
  assert.equal(b.error.code, 'NOT_READY');
  assert.equal(b.error.message, "Codex isn't signed in. Sign in, or change the model.");
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE brief_id = ?').get(brief.id).n, 0);
});
