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
import { createFeature, getFeature, listTurns, updateFeature, setContext, listHelperMessages, listAttachments, getBrief, beginBrief, saveBriefResult, updateAttachment } from '../src/core/requirements/store.mjs';
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
  assert.equal(err.payload.message, "OpenAI Codex isn't signed in. Sign in, or change the model.");
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

test('a NULL-model feature runs on Claude Code with today\'s options', async () => {
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

test('Feature chat on OpenAI Codex is locked down and stores its engine', async () => {
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
  assert.equal(row.error.message, "OpenAI Codex isn't signed in. Sign in, or change the model.");
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
  assert.equal(png.error.message, 'screen.png skipped: OpenAI Codex gets files as text only.');
  assert.equal(rows.find((x) => x.name === 'big.txt').error.message, 'big.txt skipped: it is too large for OpenAI Codex.');

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
  assert.equal(r2.calls[0].effort, 'medium', "the interview pair's effort");
});

test('a pre-9c brief (engine NULL, model set) reads a document exactly as a pre-9c feature does', async () => {
  const KEY = 'brief-9c0006';
  const b = beginBrief('project', KEY, { by: 'po' });
  saveBriefResult(b.id, { model: 'claude-sonnet-5', engine: null }, { by: 'po' });
  const owner = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: KEY };
  const rb = fakeRunner([{ summary: 'Policy.' }]);
  addAttachments(owner, [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(rb));
  await readsSettled(owner);
  const f = createFeature({ scopeType: 'project', scopeKey: 'shop-1234abcd', title: 'Old', description: 'x' });
  const rf = fakeRunner([{ summary: 'Policy.' }]);
  addAttachments(own(f), [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(rf));
  await readsSettled(own(f));
  const strip = (o) => { const { signal, onEvent, prompt, ...rest } = o; return rest; };   // the prompt names the owner
  assert.deepEqual(strip(rb.calls[0]), strip(rf.calls[0]));
  assert.equal(rb.calls[0].model, 'claude-opus-5-5');
  assert.equal(rb.calls[0].effort, 'medium');
});

test('mock mode skips a PNG on a Codex feature with the same words, and the failed turn carries the engine', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  addAttachments(own(f), [pngFile()], { by: 'po' }, deps(r, { mockEnabled: () => true }));
  await readsSettled(own(f));
  const row = listAttachments('feature', f.seq)[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.error.code, 'SKIPPED_ENGINE');
  assert.equal(row.error.message, 'screen.png skipped: OpenAI Codex gets files as text only.');
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'file').at(-1).engine, 'codex');
});

test('an ask about a skipped PNG on a Codex feature makes no call', async () => {
  const f = featureOn('codex');
  const r = fakeRunner([]);
  addAttachments(own(f), [pngFile()], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  const row = listAttachments('feature', f.seq)[0];
  // a skipped file cannot be asked about: refused up front, no call
  assert.throws(() => askAttachment(own(f), row.id, 'What is on it?', { by: 'po' }, deps(r)), (e) => e.code === 'CONFLICT');
  // a file read earlier, then the feature moved to Codex: the ask is skipped with the same words, as an ask error, no call
  updateAttachment(row.id, { status: 'done', error: null, summary: 'A screen.' });
  askAttachment(own(f), row.id, 'What is on it?', { by: 'po' }, deps(r));
  await readsSettled(own(f));
  assert.equal(r.calls.length, 0);
  const after = listAttachments('feature', f.seq)[0];
  assert.equal(after.error.code, 'SKIPPED_ENGINE');
  assert.equal(after.error.job, 'ask');
  assert.equal(after.error.message, 'screen.png skipped: OpenAI Codex gets files as text only.');
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
  assert.equal(b.error.message, "OpenAI Codex isn't signed in. Sign in, or change the model.");
  assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE brief_id = ?').get(brief.id).n, 0);
});

// ---------------------------------------------------------------- Task 9: every row books its harness, step, cost kind and tokens

import { unknownCostCount } from '../src/core/requirements/store.mjs';
import { requirementsWindowedSpendUsd } from '../src/core/cost-budget.mjs';
import { requirementsSpend } from '../src/core/requirements/routes.mjs';

const ROWS = (seq) => prepare('SELECT * FROM req_cost_ledger WHERE feature_seq = ? ORDER BY id').all(seq).map((r) => ({ ...r }));
/** A runner whose one result event carries `event`, then the next reply. */
function eventRunner(replies, event) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const reply = replies.shift();
    opts.onEvent?.({ type: 'result', ...event });
    return { text: typeof reply === 'string' ? reply : JSON.stringify(reply) };
  };
  return { calls, runClaudeImpl };
}
const Q = { engines: () => ['claude', 'codex', 'copilot', 'gemini', 'qwen'] };
const noLook = () => setContext('project', 'shop-1234abcd', { lookAtCode: false });

test('a billed Codex round books engine, step, kind and tokens', async () => {
  noLook();
  const f = featureOn('codex');
  startOrientation(f.seq, {}, deps(eventRunner([ROUND1], { costUsd: 0.05, usage: { input_tokens: 120, output_tokens: 30 } })));
  await settled(f.seq);
  const rows = ROWS(f.seq);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].engine, rows[0].step, rows[0].cost_kind, rows[0].input_tokens, rows[0].output_tokens], ['codex', 'round', 'billed', 120, 30]);
  assert.ok(rows[0].amount_usd > 0);
});

test('an estimated Gemini round counts toward the window spend', async () => {
  noLook();
  const f = featureOn('gemini');
  const t0 = Date.now() - 1000;
  const before = requirementsWindowedSpendUsd(t0);
  startOrientation(f.seq, {}, deps(eventRunner([ROUND1], { usage: { input_tokens: 1000, output_tokens: 500 } }), { ratesFor: () => ({ input: 1, output: 2 }) }));
  await settled(f.seq);
  const rows = ROWS(f.seq);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost_kind, 'estimated');
  assert.equal(rows[0].engine, 'gemini');
  assert.ok(rows[0].amount_usd > 0);
  assert.ok(requirementsWindowedSpendUsd(t0) > before);
});

test('an unknown Qwen round books a $0 row, leaves the spend alone and raises unknownSteps', async () => {
  noLook();
  const f = featureOn('qwen');
  const t0 = Date.now() - 1000;
  const spend = requirementsWindowedSpendUsd(t0);
  const unknown = unknownCostCount(t0);
  startOrientation(f.seq, {}, deps(eventRunner([ROUND1], {}), Q));
  await settled(f.seq);
  const rows = ROWS(f.seq);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].engine, rows[0].step, rows[0].cost_kind, rows[0].amount_usd], ['qwen', 'round', 'unknown', 0]);
  assert.equal(requirementsWindowedSpendUsd(t0), spend);
  assert.equal(unknownCostCount(t0), unknown + 1);
});

test('requirementsSpend carries unknownSteps over the budget window', async () => {
  noLook();
  const f = featureOn('qwen');
  const a = requirementsSpend();
  assert.equal(typeof a.unknownSteps, 'number');
  startOrientation(f.seq, {}, deps(eventRunner([ROUND1], {}), Q));
  await settled(f.seq);
  assert.equal(requirementsSpend().unknownSteps, a.unknownSteps + 1);
});

test('a Qwen round that never ran (not signed in) books no row, not even an unknown one', async () => {
  noLook();
  const f = featureOn('qwen');
  const r = fakeRunner([ROUND1]);
  startOrientation(f.seq, {}, deps(r, { ...Q, gate: async () => ({ code: 'NOT_READY', message: "Qwen Code isn't signed in. Sign in, or change the model." }) }));
  await settled(f.seq);
  assert.equal(r.calls.length, 0);
  assert.equal(ROWS(f.seq).length, 0);
});

test('a failed Codex round books its spend with its kind', async () => {
  noLook();
  const f = featureOn('codex');
  startOrientation(f.seq, {}, deps(eventRunner(['not json', 'still not json'], { costUsd: 0.04, usage: { input_tokens: 10, output_tokens: 2 } })));
  await settled(f.seq);
  const rows = ROWS(f.seq);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].engine, rows[0].step, rows[0].cost_kind, rows[0].input_tokens], ['codex', 'round', 'billed', 20]);
});

test('Feature chat books its step: a billed Codex reply and an unknown Qwen reply', async () => {
  const f = featureOn('codex');
  await sendMessage(f.seq, { text: 'Who?' }, { by: 'po' }, deps(eventRunner([CHAT], { costUsd: 0.02, usage: { input_tokens: 50, output_tokens: 9 } })));
  const g = featureOn('qwen');
  await sendMessage(g.seq, { text: 'Who?' }, { by: 'po' }, deps(eventRunner([CHAT], {}), Q));
  const [a] = ROWS(f.seq);
  assert.deepEqual([a.engine, a.step, a.cost_kind, a.input_tokens, a.output_tokens], ['codex', 'chat', 'billed', 50, 9]);
  assert.ok(a.helper_message_id != null);
  const [b] = ROWS(g.seq);
  assert.deepEqual([b.engine, b.step, b.cost_kind, b.amount_usd], ['qwen', 'chat', 'unknown', 0]);
  assert.ok(b.helper_message_id != null);
});

test('a file read books step read; an unknown one leaves a $0 row', async () => {
  const f = featureOn('gemini');
  addAttachments(own(f), [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(eventRunner([{ summary: 'Refunds within 14 days.' }], {})));
  await readsSettled(own(f));
  const rows = ROWS(f.seq);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].engine, rows[0].step, rows[0].cost_kind, rows[0].amount_usd], ['gemini', 'read', 'unknown', 0]);
  const g = featureOn('codex');
  addAttachments(own(g), [textFile('p.md', 'x')], { by: 'po' }, deps(eventRunner([{ summary: 's' }], { costUsd: 0.01, usage: { input_tokens: 5, output_tokens: 1 } })));
  await readsSettled(own(g));
  const [r] = ROWS(g.seq);
  assert.deepEqual([r.engine, r.step, r.cost_kind, r.input_tokens], ['codex', 'read', 'billed', 5]);
});

test('a brief look books step brief with its harness and tokens', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'req-9c-brief-cost-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'hi'); g('add', '.'); g('commit', '-q', '-m', 'init');
  const KEY = 'brief-9c0009';
  setContext('project', KEY, { lookAtCode: true });
  const lookDir = mkdtempSync(join(tmpdir(), 'req-9c-lookdir-'));
  const reply = { product: 'A shop.', users: [], terms: [], areas: [], files: [] };
  const bd = deps(eventRunner([reply], { costUsd: 0.07, usage: { input_tokens: 700, output_tokens: 70 } }), {
    listProjects: async () => [{ key: KEY, name: 'Shop', path: repo, exists: true }],
    openLook: async () => ({ cwd: lookDir, commit: 'abc', close: async () => {} }), budget: () => ({ blocked: false }),
    catalog: async () => ({ models: [{ id: 'gpt-x', harnesses: ['codex'], efforts: [] }] }) });
  const { job } = await makeBrief('project', KEY, { by: 'po', choice: { engine: 'codex', model: 'gpt-x', effort: null } }, bd);
  await job; await briefSettled('project', KEY);
  const b = getBrief('project', KEY);
  const rows = prepare('SELECT * FROM req_cost_ledger WHERE brief_id = ?').all(b.id);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].engine, rows[0].step, rows[0].cost_kind, rows[0].input_tokens, rows[0].output_tokens], ['codex', 'brief', 'billed', 700, 70]);
});

// ---------------------------------------------------------------- Task 14: a whole feature on each harness (fake runner stands in for the harness)

import express from 'express';
import { registerRequirementsRoutes } from '../src/core/requirements/routes.mjs';

const WHOLE = {
  codex: { label: 'OpenAI Codex', model: 'gpt-x', repo: true, keeps: false, estimated: false, files: 'OpenAI Codex gets files as text only.' },
  gemini: { label: 'Gemini CLI', model: 'gem-x', repo: false, keeps: true, estimated: true },
  copilot: { label: 'GitHub Copilot', model: 'cop-x', repo: true, keeps: true, estimated: false },
};
for (const [engine, w] of Object.entries(WHOLE)) {
  test(`a whole ${w.label} feature: create with a model, code look, round, file read, Feature chat, then its costs`, async () => {
    process.env.WORCA_FLAGS = 'requirements';
    configs.length = 0;
    const replies = w.repo ? [LOOK, ROUND1, { summary: 'Refunds within 14 days.' }, CHAT] : [ROUND1, { summary: 'Refunds within 14 days.' }, CHAT];
    const calls = [];
    const projects = [];
    const runClaudeImpl = async (opts) => {
      calls.push(opts);
      const text = JSON.stringify(replies.shift());
      opts.onEvent?.({ type: 'result', ...(w.estimated ? {} : { costUsd: 0.02 }), usage: { input_tokens: 1000, output_tokens: 100 } });
      return { text };
    };
    const d = deps({ runClaudeImpl }, {
      catalog: async () => ({ models: [{ id: w.model, label: w.model, harnesses: [engine], efforts: [] }] }),
      listModels: async () => [{ id: w.model, label: w.model, engine, efforts: [] }],
      ratesFor: () => ({ input: 1, output: 2 }), listProjects: async () => projects,
      readiness: async () => [], resolveEngine: () => ({ engine: 'claude' }), roleModel: () => null, resolveRole: () => null,
      budget: () => ({ blocked: false }),
    });
    const app = express();
    app.use(express.json());
    registerRequirementsRoutes(app, { broadcast: () => {}, deps: d });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const call = async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    try {
      const wholeDir = mkdtempSync(join(tmpdir(), `req-9c-whole-${engine}-`));
      const { addProject } = await import('../src/core/projects.mjs');
      const key = (await addProject({ name: 'shop' + engine, path: wholeDir })).find((p) => p.name === 'shop' + engine).key;
      setContext('project', key, { lookAtCode: true });
      projects.push({ key, name: 'shop' + engine, path: wholeDir, exists: true });
      const made = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: key, title: 'Cancel order', description: 'Before it ships', model: { engine, model: w.model, effort: null } });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      const seq = (made.json.feature || made.json).seq;
      await settled(seq);
      const f = { seq };
      addAttachments(own(f), [textFile('policy.md', 'Refunds in 14 days.'), pngFile('screen.png')], { by: 'po' }, d);
      await readsSettled(own(f));
      await sendMessage(seq, { text: 'Who may cancel?' }, { by: 'po' }, d);

      // each launch: the harness, never Claude's options
      assert.equal(calls.length, w.repo ? 4 : 3);
      assert.ok(calls.every((c) => c.engine === engine));
      const [look, round, read, chat] = w.repo ? calls : [null, ...calls];
      // the look is the repo profile (the classifier's read-only look shape: sandbox read-only + files server + REPO_LOOK_TOOLS), not the lockdown
      if (w.repo) { assert.equal(look.sandbox, 'read-only'); assert.equal(look.askLockdown, undefined); assert.equal(look.envScrub, undefined); assert.ok(look.mcpConfigPath); assert.equal(configs.at(-1).roots.length, 1); }
      for (const c of [round, read, chat]) { assert.equal(c.askLockdown, true); assert.equal(c.envScrub, true); assert.equal(c.sandbox, 'read-only'); assert.equal(c.mcpConfigPath, undefined); assert.equal(c.model, w.model); }
      assert.equal(read.readGuard, undefined);
      // the PNG is skipped with its words and never sent: only policy.md was read
      const png = listAttachments('feature', seq).find((x) => x.name === 'screen.png');
      assert.equal(png.status, 'failed');
      assert.equal(png.error.code, 'SKIPPED_ENGINE');
      assert.equal(png.error.message, `screen.png skipped: ${w.label} gets files as text only.`);

      // the stored notices
      const turns = listTurns(seq);
      const lookTurn = turns.find((t) => t.kind === 'orientation');
      if (!w.repo) assert.deepEqual(lookTurn.notices, [`Repo not read: ${w.label} can't read the repo.`]);
      const kept = `${w.label} keeps its own copy of this step in its history on this computer.`;
      assert.equal(turns.find((t) => t.kind === 'round').notices.includes(kept), w.keeps);
      assert.equal(listHelperMessages(seq).at(-1).notices.includes(kept), w.keeps);
      if (w.estimated) assert.ok(turns.find((t) => t.kind === 'round').notices.includes(`Cost estimated: ${w.label} reports none.`));

      // GET …/costs
      const costs = (await call('GET', `/api/requirements/${seq}/costs`)).json;
      assert.deepEqual(costs.rows.map((r) => r.step), w.repo ? ['look', 'round', 'read', 'chat'] : ['round', 'read', 'chat']);
      assert.ok(costs.rows.every((r) => r.ranOn === `${w.model} on ${w.label}`));
      assert.ok(costs.rows.every((r) => r.kind === (w.estimated ? 'estimated' : 'billed')));
      assert.equal(costs.anyEstimated, w.estimated);
      assert.equal(costs.unknownSteps, 0);
      assert.ok(costs.totalUsd > 0);
    } finally {
      srv.closeAllConnections?.();
      await new Promise((r) => srv.close(r));
      delete process.env.WORCA_FLAGS;
    }
  });
}

// ---- 9c fix B2: the brief keeps the cost of its own make (and whether it was unknown); a refresh replaces it ----
test('B2: a brief stores the cost of its last make: a Copilot refresh of a Claude brief is "unknown", never the Claude cost', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'req-9c-brief-b2-'));
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'hi'); g('add', '.'); g('commit', '-q', '-m', 'init');
  const lookDir = mkdtempSync(join(tmpdir(), 'req-9c-lookdir-b2-'));
  const text = JSON.stringify({ product: 'A shop.', users: [], terms: [], areas: [], files: [] });
  const costs = [0.0946, null, null];   // Claude bills; Copilot reports nothing
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const c = costs.shift();
    opts.onEvent?.({ type: 'result', raw: { type: 'result', ...(c == null ? {} : { total_cost_usd: c }), result: text }, ...(c == null ? {} : { costUsd: c }) });
    return { text };
  };
  const bd = (key) => deps({ runClaudeImpl }, { listProjects: async () => [{ key, name: 'Shop', path: repo, exists: true }],
    openLook: async () => ({ cwd: lookDir, commit: 'abc', close: async () => {} }), budget: () => ({ blocked: false }), ratesFor: () => null,
    catalog: async () => ({ models: [{ id: 'claude-opus-5-5', efforts: [] }, { id: 'cop-1', harnesses: ['copilot'], efforts: [] }] }) });
  const KEY = 'brief-9c00b2';
  setContext('project', KEY, { lookAtCode: true });
  await (await makeBrief('project', KEY, { by: 'po', choice: { engine: 'claude', model: 'claude-opus-5-5', effort: null } }, bd(KEY))).job;
  await briefSettled('project', KEY);
  let b = getBrief('project', KEY);
  assert.deepEqual([b.engine, b.madeCostUsd, b.madeCostKind], ['claude', 0.0946, 'billed']);
  await (await makeBrief('project', KEY, { by: 'po', choice: { engine: 'copilot', model: 'cop-1', effort: null } }, bd(KEY))).job;
  await briefSettled('project', KEY);
  b = getBrief('project', KEY);
  assert.equal(calls.at(-1).engine, 'copilot');
  assert.deepEqual([b.engine, b.model, b.madeCostUsd, b.madeCostKind], ['copilot', 'cop-1', 0, 'unknown'], 'the refresh replaced the Claude cost');
  assert.equal(b.costUsd, 0.0946, 'what the brief cost in all is kept (A7)');
  // a fresh brief made on Copilot: unknown from the start
  const KEY2 = 'brief-9c00b3';
  setContext('project', KEY2, { lookAtCode: true });
  await (await makeBrief('project', KEY2, { by: 'po', choice: { engine: 'copilot', model: 'cop-1', effort: null } }, bd(KEY2))).job;
  await briefSettled('project', KEY2);
  b = getBrief('project', KEY2);
  assert.deepEqual([b.engine, b.madeCostUsd, b.madeCostKind], ['copilot', 0, 'unknown']);
  // a brief saved without a booked make (a pre-9c brief, a mock make) has none
  const pre = beginBrief('project', 'brief-9c00b4', { by: 'po' });
  saveBriefResult(pre.id, { model: 'claude-opus-5-5' }, { by: 'po' });
  assert.deepEqual([getBrief('project', 'brief-9c00b4').madeCostUsd, getBrief('project', 'brief-9c00b4').madeCostKind], [null, null]);
});

// ---------------------------------------------------------------- I1: the credential broker locks every non-Claude step (§4, D13, §9, §8.2)

const BROKER_OFF = 'OpenAI Codex is off while the credential broker is on. Change the model.';
async function withBroker(fn) {
  const saved = process.env.WORCA_BROKER_URL;
  process.env.WORCA_BROKER_URL = 'http://broker:8080';
  try { return await fn(); } finally { if (saved === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = saved; }
}

test('broker on: a round on a Codex feature is a NOT_READY error turn in the broker words, no spawn, nothing booked, still Codex', async () => {
  await withBroker(async () => {
    const f = featureOn('codex');
    const r = fakeRunner([ROUND1]);
    setContext('project', 'shop-1234abcd', { lookAtCode: false });
    startOrientation(f.seq, {}, deps(r));
    await settled(f.seq);
    assert.equal(r.calls.length, 0);
    const err = listTurns(f.seq).find((t) => t.kind === 'error');
    assert.equal(err.payload.code, 'NOT_READY');
    assert.equal(err.payload.message, BROKER_OFF);
    assert.equal(err.payload.job, 'round');
    assert.equal(getFeature(f.seq).model.engine, 'codex', 'never switched to Claude');
    assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0);
  });
});

test('broker on: a code look on a Codex feature is refused the same way', async () => {
  await withBroker(async () => {
    const f = featureOn('codex');
    const r = fakeRunner([]);
    startOrientation(f.seq, {}, deps(r));
    await settled(f.seq);
    assert.equal(r.calls.length, 0);
    const err = listTurns(f.seq).find((t) => t.kind === 'error');
    assert.equal(err.payload.code, 'NOT_READY');
    assert.equal(err.payload.message, BROKER_OFF);
    assert.equal(err.payload.job, 'look');
    assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0);
  });
});

test('broker on: Feature chat on a Copilot feature is a NOT_READY row, no call', async () => {
  await withBroker(async () => {
    const f = featureOn('copilot');
    const r = fakeRunner([CHAT]);
    await sendMessage(f.seq, { text: 'Hi' }, { by: 'po' }, deps(r));
    assert.equal(r.calls.length, 0);
    const row = listHelperMessages(f.seq).at(-1);
    assert.equal(row.error.code, 'NOT_READY');
    assert.equal(row.error.message, 'GitHub Copilot is off while the credential broker is on. Change the model.');
    assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE feature_seq = ?').get(f.seq).n, 0);
  });
});

test("broker on: a document of a brief made on Codex is not read on Codex's own credentials", async () => {
  await withBroker(async () => {
    const KEY = 'brief-9c00c1';
    const b = beginBrief('project', KEY, { by: 'po' });
    saveBriefResult(b.id, { sections: undefined, model: 'gpt-x', engine: 'codex' }, { by: 'po' });
    const owner = { type: 'brief', id: b.id, scopeType: 'project', scopeKey: KEY };
    const r = fakeRunner([{ summary: 'Policy.' }]);
    addAttachments(owner, [textFile('policy.md', 'Refunds in 14 days.')], { by: 'po' }, deps(r));
    await readsSettled(owner);
    assert.equal(r.calls.length, 0);
    const row = listAttachments('brief', b.id)[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.error.code, 'NOT_READY');
    assert.equal(row.error.message, BROKER_OFF);
    assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE brief_id = ?').get(b.id).n, 0);
  });
});

test('broker on: making a brief on Codex fails with the broker sentence, no call, nothing booked', async () => {
  await withBroker(async () => {
    const repo = mkdtempSync(join(tmpdir(), 'req-9c-brief-broker-'));
    const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), 'hi'); g('add', '.'); g('commit', '-q', '-m', 'init');
    const KEY = 'brief-9c00c2';
    setContext('project', KEY, { lookAtCode: true });
    const r = fakeRunner([]);
    const d = deps(r, { listProjects: async () => [{ key: KEY, name: 'Shop', path: repo, exists: true }],
      openLook: async () => ({ cwd: repo, commit: 'abc', close: async () => {} }), budget: () => ({ blocked: false }),
      catalog: async () => ({ models: [{ id: 'gpt-x', harnesses: ['codex'], efforts: [] }] }) });
    const { brief, job } = await makeBrief('project', KEY, { by: 'po', choice: { engine: 'codex', model: 'gpt-x', effort: null } }, d);
    await job; await briefSettled('project', KEY);
    assert.equal(r.calls.length, 0);
    const b = getBrief('project', KEY);
    assert.equal(b.error.code, 'NOT_READY');
    assert.equal(b.error.message, BROKER_OFF);
    assert.equal(prepare('SELECT count(*) AS n FROM req_cost_ledger WHERE brief_id = ?').get(brief.id).n, 0);
  });
});
