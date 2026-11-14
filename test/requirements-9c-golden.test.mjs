// test/requirements-9c-golden.test.mjs — 9c's guard: on Claude every Requirements step hands the runner exactly
// today's options (plans/requirements-9c-design.md §8.1). Written before any 9c change; never edited after.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, listTurns, setContext } from '../src/core/requirements/store.mjs';
import { startOrientation, submitAnswers, settled } from '../src/core/requirements/interview.mjs';
import { makeBrief, briefSettled } from '../src/core/requirements/brief-job.mjs';
import { addAttachments, readsSettled } from '../src/core/requirements/attachment-job.mjs';
import { sendMessage } from '../src/core/requirements/helper.mjs';

useTempHome(after);
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });

const h = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
/** Paths and prompts vary per run: keep every key, replace those values by a stable token. */
function normalize(o) {
  const out = {};
  for (const [k, v] of Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) {
    if (k === 'signal' || k === 'onEvent') continue;
    if (k === 'cwd' || k === 'readGuard') out[k] = '<path>';
    else if (k === 'prompt') out[k] = '<prompt>';
    else if (k === 'systemPrompt') out[k] = h(v);
    // The shared deny list is a long constant: keep it as its length and a hash of the exact list (same on every machine).
    else if (k === 'permissionRules') out[k] = { ...v, deny: v.deny && `${v.deny.length} rules #${h(JSON.stringify(v.deny))}` };
    else if (k === 'allowedTools') out[k] = v.map((t) => (t.startsWith('Read(') ? 'Read(<copy>)' : t));
    else out[k] = v;
  }
  return out;
}

const scratch = [];
after(() => { for (const d of scratch) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } } });
const tmp = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); scratch.push(d); return d; };

/** A fake runner that records every call's options and answers the queued replies (objects are sent as JSON). A guarded
 *  call (readGuard set) shows one Read of its copy on the stream and returns the guard's decision for it, as the real runner would. */
function fakeRunner(replies, { guarded = false } = {}) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    const reply = replies.shift();
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    if (guarded && opts.readGuard) {
      const raw = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: opts.readGuard } }] } };
      opts.onEvent?.({ type: 'assistant', raw });
    }
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text, ...(guarded ? { num_turns: 2 } : {}) }, costUsd: 0.1 });
    const decisions = guarded ? [{ tool: 'Read', path: opts.readGuard, decision: 'allow', id: 'tu_1' }] : [];
    return { text, ...(opts.readGuard ? { readGuardDecisions: decisions } : {}) };
  };
  return { calls, runClaudeImpl };
}

const MODELS = [{ id: 'claude-sonnet-5', label: 'Sonnet 5' }, { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5 (1M)' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }];
const lookDir = tmp('golden-look-');
function deps(runner, extra = {}) {
  return {
    runClaudeImpl: runner.runClaudeImpl, listModels: async () => MODELS,
    listProjects: async () => [], workspaceTarget: async () => null, readWorkspace: async () => null,
    openLook: async () => ({ cwd: lookDir, close: async () => {} }), openWorkspaceLook: async () => null,
    budget: () => ({ blocked: false, totalLimitUsd: null }), onChange: () => {}, onBriefChange: () => {},
    interviewSlot: () => ({}), userSignIn: () => false, mockEnabled: () => false, ...extra,
  };
}
let n = 0;
const KEY = 'shop-9c000001';
const newFeature = () => createFeature({ scopeType: 'project', scopeKey: KEY, title: `Cancel order ${++n}`, description: 'Before it ships' });

const ROUND1 = { spec: { goal: { text: 'Cancel before shipping', measure: 'fewer calls' } }, criteria: [{ id: null, text: 'A customer can cancel an unpaid order' }],
  questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'w' }], done: false, note: 'One question.' };
const ROUND2 = { spec: {}, criteria: [], questions: [], done: true, note: 'Done.' };

const EXPECTED_ROUND = {
  allowedTools: [],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  permissionMode: 'acceptEdits',
  prompt: '<prompt>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: 'a4d1e2d87843',
  systemPromptMode: 'replace',
  tools: []
};
const EXPECTED_LOOK = {
  allowedTools: [ 'Read', 'Grep', 'Glob' ],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  maxTurns: 10,
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  permissionMode: 'acceptEdits',
  prompt: '<prompt>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: 'b0b917fd95d1',
  systemPromptMode: 'replace',
  tools: [ 'Read', 'Grep', 'Glob' ]
};
const EXPECTED_BRIEF = {
  allowedTools: [ 'Read', 'Grep', 'Glob' ],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  maxTurns: 40,
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  noSessionPersistence: true,
  permissionMode: 'acceptEdits',
  permissionRules: { deny: '49 rules #3090207c559e' },
  prompt: '<prompt>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: '248c5893e3ae',
  systemPromptMode: 'replace',
  tools: [ 'Read', 'Grep', 'Glob' ]
};
const EXPECTED_INLINE_READ = {
  allowedTools: [],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  noSessionPersistence: true,
  permissionMode: 'acceptEdits',
  permissionRules: { deny: '49 rules #3090207c559e' },
  prompt: '<prompt>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: '37efff645f30',
  systemPromptMode: 'replace',
  tools: []
};
const EXPECTED_GUARDED_READ = {
  allowedTools: [ 'Read(<copy>)' ],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  maxTurns: 5,
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  noSessionPersistence: true,
  permissionMode: 'acceptEdits',
  permissionRules: { deny: '49 rules #3090207c559e' },
  prompt: '<prompt>',
  readGuard: '<path>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: '37efff645f30',
  systemPromptMode: 'replace',
  tools: [ 'Read' ]
};
const EXPECTED_CHAT = {
  allowedTools: [],
  cwd: '<path>',
  disableSlashCommands: true,
  effort: 'medium',
  model: 'claude-opus-5-5',
  modelEnv: undefined,
  noSessionPersistence: true,
  permissionMode: 'acceptEdits',
  prompt: '<prompt>',
  settingSources: [ 'project' ],
  spawnKind: 'aux',
  strictMcpConfig: true,
  systemPrompt: '2997a2eda247',
  systemPromptMode: 'replace',
  tools: []
};

test('round: the options a round hands the runner', async () => {
  const f = newFeature();
  setContext('project', KEY, { lookAtCode: false });
  const r = fakeRunner([ROUND1, ROUND2]);
  const d = deps(r);
  await startOrientation(f.seq, {}, d);
  await settled(f.seq);
  const round = listTurns(f.seq).find((t) => t.kind === 'round');
  await submitAnswers(f.seq, { roundTurnId: round.id, answers: [{ id: 'who', option: 'Support' }] }, { by: 'po' }, d);
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(normalize(r.calls[1]), EXPECTED_ROUND);
});

test('look: the options of the orientation code look', async () => {
  const f = newFeature();
  setContext('project', KEY, { lookAtCode: true });
  const r = fakeRunner([{ summary: 'Orders have a status.', files: ['src/orders.js'] }, ROUND1]);
  await startOrientation(f.seq, {}, deps(r, { listProjects: async () => [{ key: KEY, name: 'shop', path: lookDir, exists: true }] }));
  await settled(f.seq);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(normalize(r.calls[0]), EXPECTED_LOOK);
});

test('brief look: the options of the product-brief look', async () => {
  const dir = tmp('golden-repo-');
  const g = (...a) => { const x = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); if (x.status !== 0) throw new Error(`git ${a.join(' ')}: ${x.stderr}`); return x.stdout.trim(); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'init\n'); g('add', '.'); g('commit', '-q', '-m', 'init');
  g('update-ref', 'refs/remotes/origin/main', 'refs/heads/main'); g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const key = 'shop-9c000002';
  const reply = { product: 'An online shop.', users: [{ name: 'Shopper', can: 'orders.' }], terms: [{ term: 'Packed', meaning: 'in a box.' }],
    areas: [{ name: 'Orders', text: 'checkout.', status: 'partly', files: [join(lookDir, 'README.md')] }], files: [join(lookDir, 'README.md')] };
  const r = fakeRunner([reply]);
  const d = deps(r, { listProjects: async () => [{ key, name: 'Shop', path: dir, exists: true }],
    openLook: async (p, b, o = {}) => ({ cwd: lookDir, commit: g('rev-parse', o.ref), close: async () => {} }) });
  const { job } = await makeBrief('project', key, { by: 'po' }, d);
  await job;
  await briefSettled('project', key);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(normalize(r.calls[0]), EXPECTED_BRIEF);
});

const own = (f) => ({ type: 'feature', id: f.seq });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const KB = 'x'.repeat(1024);

test('inline read: the options of a small text file read', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'Notes.' }]);
  const data = Buffer.from(KB);
  addAttachments(own(f), [{ name: 'notes.txt', kind: 'text', mime: 'text/plain', data, text: KB, bytes: data.length, sha256: sha(data) }], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(normalize(r.calls[0]), EXPECTED_INLINE_READ);
});

test('guarded read: the options of an image read through the Read guard', async () => {
  const f = newFeature();
  const r = fakeRunner([{ summary: 'An image.' }], { guarded: true });
  const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1016, 1)]);
  addAttachments(own(f), [{ name: 'shot.png', kind: 'image', mime: 'image/png', data, bytes: data.length, sha256: sha(data) }], { by: 'po' }, deps(r));
  await readsSettled(own(f));
  assert.equal(r.calls.length, 1);
  assert.deepEqual(normalize(r.calls[0]), EXPECTED_GUARDED_READ);
});

test('Feature chat: the options of one chat message', async () => {
  const f = newFeature();
  setContext('project', KEY, { lookAtCode: false });
  const r = fakeRunner([ROUND1]);
  await startOrientation(f.seq, {}, deps(r));
  await settled(f.seq);
  const chat = fakeRunner([{ text: 'Cancelling until pick-up covers most tickets.', drafts: [], proposals: [] }]);
  await sendMessage(f.seq, { text: 'Who may cancel?' }, { by: 'po' }, deps(chat));
  assert.equal(chat.calls.length, 1);
  assert.deepEqual(normalize(chat.calls[0]), EXPECTED_CHAT);
});
