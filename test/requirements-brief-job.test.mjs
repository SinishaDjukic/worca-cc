// test/requirements-brief-job.test.mjs — the product brief job with a fake runner and fake looks, and its staleness
// check on temp repositories; never a real model call (A7 design D3, D5, D8, D9, D13–D16, §5).
import { test, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import { getBrief, setBriefSections, beginBrief, setContext, insertAttachment, mintAttachmentId, updateAttachment } from '../src/core/requirements/store.mjs';
import { REQUIREMENTS_READ_DENY_RULES } from '../src/core/ask/deny-rules.mjs';
import { recordRequirementsCostDelta } from '../src/core/cost-budget.mjs';
import { REPO_LOOK_TOOLS } from '../src/core/auto/classify.mjs';
import { commitOf, defaultBranchRef } from '../src/core/worktree.mjs';
import { BRIEF_SYSTEM_PROMPT, mockBrief } from '../src/core/requirements/brief.mjs';
import {
  makeBrief, briefSettled, isBriefBusy, recoverBriefs, briefStaleness, briefEstimate, briefTarget,
  MAX_BRIEF_JOBS, BRIEF_MAX_TURNS, BRIEF_TIMEOUT_MS, STALENESS_TIMEOUT_MS, BRIEF_PRESS_PROBE_MS,
} from '../src/core/requirements/brief-job.mjs';

useTempHome(after);
beforeEach(() => { delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; });

const scratch = [];
after(() => { for (const d of scratch) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } } });
const tmp = (prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); scratch.push(d); return d; };

/** A temp repository on `branch` with one commit (README.md). */
function repo(branch = 'main', { empty = false } = {}) {
  const dir = tmp('req-brief-repo-');
  const g = (...a) => { const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  g('init', '-q', '-b', branch); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  const commit = (file, msg = file) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), `${msg}\n${Math.random()}\n`);
    g('add', '.'); g('commit', '-q', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  if (!empty) commit('README.md', 'init');
  /** The clone's origin/HEAD names `b` (what `git clone` sets up), so `b` is the default branch whatever is checked out. */
  const originHead = (b = branch) => { g('update-ref', `refs/remotes/origin/${b}`, `refs/heads/${b}`); g('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${b}`); };
  return { dir, g, commit, originHead, sha: (ref = 'HEAD') => g('rev-parse', ref) };
}
const gitSha = (dir, ref) => spawnSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).stdout.trim() || null;

let seq = 0;
const key = () => `shop-${String(++seq).padStart(8, '0')}`;
const project = (k, dir, name = 'Shop') => ({ key: k, name, path: dir, exists: true });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

/** Replies in order: an object (sent as JSON), a string, an Error, `{ costFirst, error }` (spends, then throws), or a function of the call's options. */
function fakeRunner(replies) {
  const calls = [];
  const runClaudeImpl = async (opts) => {
    calls.push(opts);
    let reply = replies.shift();
    if (typeof reply === 'function') reply = await reply(opts);
    if (reply && reply.costFirst) {
      opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: reply.costFirst, result: '' }, costUsd: reply.costFirst });
      throw reply.error;
    }
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text }, costUsd: 0.1 });
    return { text };
  };
  return { calls, runClaudeImpl };
}

/** Fake checkouts: they record what they were asked for and every close(); the "checkout" is one temp folder. */
function looks() {
  const lk = { opened: [], ws: [], closed: 0, lookDir: tmp('auto-look-') };
  const close = async () => { lk.closed += 1; };
  lk.openLook = async (dir, base, o = {}) => {
    lk.opened.push({ dir, base, ref: o.ref, signal: o.signal });
    return { cwd: lk.lookDir, commit: gitSha(dir, o.ref), close };
  };
  lk.openWorkspaceLook = async (members, base, o = {}) => {
    lk.ws.push({ members: members.map((m) => m.projectKey), refs: o.refs, signal: o.signal });
    const made = members.filter((m) => !lk.failKeys?.includes(m.projectKey));
    return { cwd: lk.lookDir, members: made.map((m) => m.projectKey), commits: Object.fromEntries(made.map((m) => [m.projectKey, gitSha(m.projectDir, o.refs[m.projectKey])])), close };
  };
  return lk;
}

const MODELS = [{ id: 'claude-sonnet-5', label: 'Sonnet 5' }, { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5 (1M)' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }];
function deps({ runner = fakeRunner([]), lk = looks(), projects = [], ws = null, wsRow = null, ...extra } = {}) {
  return {
    runClaudeImpl: runner.runClaudeImpl, listModels: async () => MODELS,
    listProjects: async () => projects, workspaceTarget: async () => ws, readWorkspace: async () => wsRow,
    openLook: lk.openLook, openWorkspaceLook: lk.openWorkspaceLook,
    budget: () => ({ blocked: false, totalLimitUsd: null }), onChange: () => {},
    interviewSlot: () => ({}),   // nothing stored: the interview's default pair (A1.1 D2)
    userSignIn: () => false,     // the hermetic branch; never the real user settings
    ...extra,
  };
}

/** A good reply that names files the way the Read tool does: absolute paths inside the temp checkout. */
const goodReply = (lookDir, over = {}) => ({
  product: 'An online shop for home goods.',
  users: [{ name: 'Shopper', can: 'browses and orders.' }],
  terms: [{ term: 'Packed', meaning: 'in a box.' }],
  areas: [{ name: 'Orders', text: 'checkout; no cancel.', status: 'partly', files: [join(lookDir, 'src', 'orders.mjs')] }],
  files: [join(lookDir, 'README.md'), join(lookDir, 'src', 'orders.mjs')],
  ...over,
});
const ledger = (id) => prepare('SELECT feature_seq, brief_id, amount_usd, model FROM req_cost_ledger WHERE brief_id = ? ORDER BY id').all(id).map((r) => ({ ...r }));

// ---------------------------------------------------------------- estimate (first: no brief spend booked yet)

test('briefEstimate: the median of the last 10 brief looks in cents (null without any); the model labelled from the catalog', async () => {
  const d = { listModels: async () => MODELS, interviewSlot: () => ({}) };
  assert.deepEqual(await briefEstimate(d), { costUsd: null, model: { id: 'claude-opus-5-5', label: 'Opus 5.5' } });
  // the interview's model (A1.1 D2): a stored one the catalog lists labels the estimate
  assert.deepEqual((await briefEstimate({ listModels: async () => MODELS, interviewSlot: () => ({ model: 'claude-sonnet-5', effort: 'high' }) })).model,
    { id: 'claude-sonnet-5', label: 'Sonnet 5' });
  for (const usd of [0.5, 1.004, 2]) recordRequirementsCostDelta({ briefId: 9999, amountUsd: usd, model: 'm' });
  recordRequirementsCostDelta({ featureSeq: 1, amountUsd: 50, model: 'm' });   // a feature's spend is not a brief look
  assert.equal((await briefEstimate(d)).costUsd, 1);
  recordRequirementsCostDelta({ briefId: 9999, amountUsd: 3, model: 'm' });
  assert.equal((await briefEstimate(d)).costUsd, 1.5);                          // (1.004 + 2) / 2, in cents
  assert.deepEqual((await briefEstimate({ listModels: async () => [{ id: 'claude-opus-5-5' }], interviewSlot: () => ({}) })).model, { id: 'claude-opus-5-5', label: 'claude-opus-5-5' });
  assert.equal((await briefEstimate({ listModels: async () => [{ id: 'claude-sonnet-5' }], interviewSlot: () => ({}) })).model, null);
});

// ---------------------------------------------------------------- refusals

test('constants', () => {
  assert.equal(MAX_BRIEF_JOBS, 2);
  assert.equal(BRIEF_MAX_TURNS, 40);
  assert.equal(BRIEF_TIMEOUT_MS, 600_000);
  assert.equal(STALENESS_TIMEOUT_MS, 10_000);
  assert.equal(BRIEF_PRESS_PROBE_MS, 30_000, 'Create / Refresh probe the default branches longer than a page load');
});

test('refusals write nothing and call nothing: switch off, no repository, no default branch, the budget', async () => {
  const r = repo();
  const runner = fakeRunner([]);
  const lk = looks();
  const refused = async (scopeType, scopeKey, d, code, message) => {
    await assert.rejects(makeBrief(scopeType, scopeKey, { by: 'po' }, d), (e) => e.code === code && e.message === message);
    assert.equal(getBrief(scopeType, scopeKey), null, `${scopeType}:${scopeKey} has no row`);
  };
  const k1 = key();
  setContext('project', k1, { lookAtCode: false });
  await refused('project', k1, deps({ runner, lk, projects: [project(k1, r.dir)] }), 'CONFLICT',
    'Looking at the code is off for this project. Turn it on under Your notes for Worca.');
  setContext('workspace', 'ws-off', { lookAtCode: false });
  await refused('workspace', 'ws-off', deps({ runner, lk, ws: { id: 'ws-off', name: 'WS', description: '', members: [{ projectKey: 'a', projectName: 'A', projectDir: r.dir }] } }),
    'CONFLICT', 'Looking at the code is off for this workspace. Turn it on under Your notes for Worca.');

  const NO_REPO = 'There is no repository to look at.';
  const k2 = key();
  await refused('project', k2, deps({ runner, lk, projects: [project(k2, tmp('req-brief-plain-'))] }), 'CONFLICT', NO_REPO);
  await refused('project', key(), deps({ runner, lk, projects: [] }), 'CONFLICT', NO_REPO);                       // not registered
  const k3 = key();
  await refused('project', k3, deps({ runner, lk, projects: [{ ...project(k3, r.dir), exists: false }] }), 'CONFLICT', NO_REPO);
  await refused('workspace', 'ws-none', deps({ runner, lk, ws: null }), 'CONFLICT', NO_REPO);
  // no default branch: a detached HEAD with no branch left and no origin/HEAD; an empty repository
  const det = repo();
  det.g('checkout', '-q', '--detach'); det.g('branch', '-D', 'main');
  const k4 = key();
  await refused('project', k4, deps({ runner, lk, projects: [project(k4, det.dir)] }), 'CONFLICT', NO_REPO);
  const k5 = key();
  await refused('project', k5, deps({ runner, lk, projects: [project(k5, repo('main', { empty: true }).dir)] }), 'CONFLICT', NO_REPO);

  const k6 = key();
  await refused('project', k6, deps({ runner, lk, projects: [project(k6, r.dir)], budget: () => ({ blocked: true, totalLimitUsd: 20 }) }), 'BUDGET',
    'The spending limit of $20 is reached for this period. Worca can make the brief when the limit resets or is raised.');
  assert.equal(runner.calls.length, 0);
  assert.equal(lk.opened.length + lk.ws.length, 0);
});

test('busy: one brief per scope at a time, and at most MAX_BRIEF_JOBS briefs at once', async () => {
  const r = repo();
  const lk = looks();
  const gate = deferred();
  const runner = fakeRunner([() => gate.promise.then(() => goodReply(lk.lookDir)), () => gate.promise.then(() => goodReply(lk.lookDir))]);
  const [a, b, c] = [key(), key(), key()];
  const d = deps({ runner, lk, projects: [a, b, c].map((k) => project(k, r.dir)) });
  await makeBrief('project', a, {}, d);
  assert.equal(isBriefBusy('project', a), true);
  await assert.rejects(makeBrief('project', a, {}, d), (e) => e.code === 'BUSY');
  await makeBrief('project', b, {}, d);
  await assert.rejects(makeBrief('project', c, {}, d), (e) => e.code === 'BUSY' && e.message === 'Worca is making other briefs; try again in a moment.');
  assert.equal(getBrief('project', c), null);
  gate.resolve();
  await briefSettled('project', a);
  await briefSettled('project', b);
  assert.equal(isBriefBusy('project', a), false);
  assert.equal(runner.calls.length, 2);
  assert.equal(getBrief('project', a).status, 'ready');
});

// ---------------------------------------------------------------- the look

test('a look reads the default branch, not the checked-out one: the call, sections, relative files, model, cost, one ledger row', async () => {
  const r = repo();
  const mainSha = r.sha();
  r.originHead();
  r.g('checkout', '-q', '-b', 'feature');
  r.commit('src/feature.mjs');
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir)]);
  const k = key();
  const changes = [];
  const d = deps({ runner, lk, projects: [project(k, r.dir)], onChange: (t, s) => changes.push(`${t}:${s}`) });
  const { brief, job } = await makeBrief('project', k, { by: 'po' }, d);
  assert.equal(brief.status, 'making');
  await job;
  await briefSettled('project', k);

  const call = runner.calls[0];
  assert.deepEqual(call.tools, [...REPO_LOOK_TOOLS]);
  assert.deepEqual(call.allowedTools, [...REPO_LOOK_TOOLS]);
  assert.equal(call.maxTurns, 40);
  assert.equal(call.spawnKind, 'aux');
  assert.ok(call.signal instanceof AbortSignal, 'the call has a signal');
  assert.equal(call.systemPrompt, BRIEF_SYSTEM_PROMPT);
  // A1.1's call path (design §9): replace mode and the hermetic flags (runClaude puts the host-guard preamble first)
  assert.equal(call.systemPromptMode, 'replace');
  assert.deepEqual(call.settingSources, ['project']);
  assert.equal(call.disableSlashCommands, true);
  assert.equal(call.strictMcpConfig, true);
  assert.equal(call.cwd, lk.lookDir);
  assert.equal(call.model, 'claude-opus-5-5');
  assert.equal(call.effort, 'medium', "the interview's default effort");
  assert.ok(call.prompt.startsWith('<scope>Shop</scope>'));
  assert.ok(call.prompt.includes('<project_notes>\n(none)\n</project_notes>'));
  assert.ok(call.prompt.includes(`\n\nThe working directory, ${lk.lookDir}, is a checkout of the project.\n\n`), "A1.1's wording names the directory");
  assert.equal(call.prompt.split('The working directory').length - 1, 1, 'one working-directory line');
  assert.ok(!call.prompt.includes('<current_brief>'));
  assert.equal(lk.opened[0].dir, r.dir);
  assert.equal(lk.opened[0].ref, 'refs/heads/main');
  assert.ok(lk.opened[0].signal instanceof AbortSignal);
  assert.notEqual(lk.opened[0].signal, call.signal, 'the checkout and the call have their own controllers');
  assert.equal(lk.closed, 1);

  const b = getBrief('project', k);
  assert.equal(b.status, 'ready');
  assert.equal(b.error, null);
  assert.equal(b.madeBy, 'po');
  assert.ok(b.madeAt);
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.costUsd, 0.1);
  assert.equal(b.seed, null);
  assert.deepEqual(b.sources, [{ project: k, branch: 'main', ref: 'refs/heads/main', sha: mainSha }]);
  assert.equal(b.sections.product, 'An online shop for home goods.');
  assert.deepEqual(b.sections.areas, [{ name: 'Orders', text: 'checkout; no cancel.', status: 'partly', files: ['src/orders.mjs'], added: null, belongsTo: null }]);
  assert.deepEqual(b.files, ['README.md', 'src/orders.mjs']);
  assert.deepEqual(ledger(b.id), [{ feature_seq: 0, brief_id: b.id, amount_usd: 0.1, model: 'claude-opus-5-5' }]);
  assert.deepEqual(changes, [`project:${k}`, `project:${k}`]);
});

test("the interview's model and effort from Settings run the brief look; user sign-in settings keep the user layer", async () => {
  const r = repo();
  r.originHead();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir), goodReply(lk.lookDir)]);
  const k = key();
  const d = deps({ runner, lk, projects: [project(k, r.dir)], interviewSlot: () => ({ model: 'claude-sonnet-5', effort: 'high' }) });
  await (await makeBrief('project', k, {}, d)).job;
  const call = runner.calls[0];
  assert.equal(call.model, 'claude-sonnet-5');
  assert.equal(call.effort, 'high');
  assert.equal(call.systemPromptMode, 'replace');
  assert.deepEqual(call.settingSources, ['project']);
  assert.deepEqual(call.tools, [...REPO_LOOK_TOOLS]);
  assert.equal(call.maxTurns, 40);
  assert.equal(getBrief('project', k).model, 'claude-sonnet-5');
  // a model picked with no effort runs at the model's own default: no effort key
  await (await makeBrief('project', k, {}, { ...d, interviewSlot: () => ({ model: 'claude-sonnet-5' }), userSignIn: () => true })).job;
  const again = runner.calls[1];
  assert.equal('effort' in again, false);
  assert.equal('settingSources' in again, false, 'sign-in in the user settings: the user layer stays (A1.1 D6)');
  assert.equal(again.systemPromptMode, 'replace');
  assert.equal(again.disableSlashCommands, true);
});

test('one deadline over checkout and call: the call gets the time left, and its timeout says those seconds', async () => {
  const r = repo();
  const lk = looks();
  const open = lk.openLook;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try {
    lk.openLook = async (...a) => { mock.timers.tick(100_000); return open(...a); };   // the checkout takes 100 s
    const called = deferred();
    const runner = fakeRunner([(opts) => { called.resolve(); return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('killed')))); }]);
    const k = key();
    const { job } = await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }));
    await called.promise;
    mock.timers.tick(499_999);
    await new Promise(setImmediate);
    assert.equal(getBrief('project', k).status, 'making');
    mock.timers.tick(1);
    await job;
    const b = getBrief('project', k);
    assert.equal(b.status, 'empty');
    assert.equal(b.error.code, 'TIMEOUT');
    assert.equal(b.error.message, 'Worca got no reply within 500 seconds. Try again.');
    assert.equal(lk.closed, 1);
  } finally { mock.timers.reset(); }
});

test('a checkout that outlives the deadline: TIMEOUT with the checkout message, closed, no call', async () => {
  for (const returnsLook of [true, false]) {
    const r = repo();
    const lk = looks();
    const opened = deferred();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      lk.openLook = async (dir, base, o) => {
        opened.resolve();
        await new Promise((res) => o.signal.addEventListener('abort', res));
        return returnsLook ? { cwd: lk.lookDir, commit: null, close: async () => { lk.closed += 1; } } : null;   // openRepoLook returns null on an abort
      };
      const runner = fakeRunner([]);
      const k = key();
      const { job } = await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }));
      await opened.promise;
      mock.timers.tick(BRIEF_TIMEOUT_MS);
      await job;
      const b = getBrief('project', k);
      assert.deepEqual({ status: b.status, code: b.error.code, message: b.error.message },
        { status: 'empty', code: 'TIMEOUT', message: 'Worca could not check out the code in time. Try again.' });
      assert.equal(runner.calls.length, 0);
      assert.equal(lk.closed, returnsLook ? 1 : 0);
    } finally { mock.timers.reset(); }
  }
});

test('no checkout (not timed out) → NO_REPO; the budget reached before the call → a recorded BUDGET failure, closed, no call', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([]);
  const k = key();
  await (await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)], openLook: async () => null }))).job;
  assert.equal(getBrief('project', k).error.code, 'NO_REPO');
  assert.equal(getBrief('project', k).status, 'empty');

  let checks = 0;
  const k2 = key();
  const budget = () => { checks += 1; return checks === 1 ? { blocked: false, totalLimitUsd: 5 } : { blocked: true, totalLimitUsd: 5 }; };
  await (await makeBrief('project', k2, {}, deps({ runner, lk, projects: [project(k2, r.dir)], budget }))).job;
  const b = getBrief('project', k2);
  assert.equal(b.error.code, 'BUDGET');
  assert.equal(b.error.message, 'The spending limit of $5 is reached for this period. Worca can make the brief when the limit resets or is raised.');
  assert.equal(runner.calls.length, 0);
  assert.equal(lk.closed, 1);
});

test('a refresh sends the current brief and the edited list; an edit made while the look runs survives it', async () => {
  const r = repo();
  const lk = looks();
  const gate = deferred();
  const called = deferred();
  const runner = fakeRunner([
    goodReply(lk.lookDir),
    () => { called.resolve(); return gate.promise.then(() => goodReply(lk.lookDir, { product: 'Second product.', users: [{ name: 'Model', can: 'x' }], terms: [{ term: 'Model', meaning: 'y' }] })); },
  ]);
  const k = key();
  const d = deps({ runner, lk, projects: [project(k, r.dir)] });
  await (await makeBrief('project', k, {}, d)).job;
  const first = getBrief('project', k);
  setBriefSections(first.id, { sections: { ...first.sections, users: [{ name: 'Owner', can: 'decides.' }] }, edited: { users: true } });

  const { job } = await makeBrief('project', k, {}, d);
  await called.promise;
  const now = getBrief('project', k);
  assert.equal(now.status, 'making');
  setBriefSections(now.id, { sections: { ...now.sections, terms: [{ term: 'Mine', meaning: 'kept.' }] }, edited: { users: true, terms: true } });
  gate.resolve();
  await job;

  const prompt = runner.calls[1].prompt;
  assert.ok(prompt.includes('<current_brief>\n'));
  assert.ok(prompt.includes('Who uses it:\n- Owner: decides.'));
  assert.ok(prompt.includes('<edited_by_product_owner>\nWho uses it\n</edited_by_product_owner>'));
  const b = getBrief('project', k);
  assert.equal(b.status, 'ready');
  assert.equal(b.sections.product, 'Second product.');
  assert.deepEqual(b.sections.users, [{ name: 'Owner', can: 'decides.' }]);
  assert.deepEqual(b.sections.terms, [{ term: 'Mine', meaning: 'kept.' }]);
  assert.deepEqual(b.edited, { users: true, terms: true });
  assert.equal(b.costUsd, 0.2);
});

test('an empty reply: "Worca ran out of steps…", the earlier brief kept, the cost booked; a first look stays empty; prose is unreadable', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir), '', '', 'I read the README and the orders.']);
  const k = key();
  const d = deps({ runner, lk, projects: [project(k, r.dir)] });
  await (await makeBrief('project', k, {}, d)).job;
  const made = getBrief('project', k);
  await (await makeBrief('project', k, {}, d)).job;
  const b = getBrief('project', k);
  assert.equal(b.status, 'ready');
  assert.deepEqual(b.error && { code: b.error.code, message: b.error.message }, { code: 'BAD_REPLY', message: 'Worca ran out of steps before writing the brief.' });
  assert.deepEqual(b.sections, made.sections);
  assert.equal(b.madeAt, made.madeAt);
  assert.equal(b.costUsd, 0.2);
  assert.equal(ledger(b.id).length, 2);
  assert.equal(lk.closed, 2);

  const k2 = key();
  await (await makeBrief('project', k2, {}, deps({ runner, lk, projects: [project(k2, r.dir)] }))).job;
  assert.equal(getBrief('project', k2).status, 'empty');
  assert.equal(getBrief('project', k2).error.code, 'BAD_REPLY');
  const k3 = key();
  await (await makeBrief('project', k3, {}, deps({ runner, lk, projects: [project(k3, r.dir)] }))).job;
  assert.equal(getBrief('project', k3).error.message, "Worca's reply could not be read (the reply is not a JSON object). Try again.");
});

test('a call that throws after spending books what it spent; the checkout is closed', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([{ costFirst: 0.07, error: new Error('the model is overloaded') }]);
  const k = key();
  await (await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }))).job;
  const b = getBrief('project', k);
  assert.deepEqual({ code: b.error.code, message: b.error.message }, { code: 'FAILED', message: 'the model is overloaded' });
  assert.equal(b.costUsd, 0.07);
  assert.deepEqual(ledger(b.id), [{ feature_seq: 0, brief_id: b.id, amount_usd: 0.07, model: 'claude-opus-5-5' }]);
  assert.equal(lk.closed, 1);
});

test('the cost of a look is booked on the brief and in the ledger together: a ledger insert that fails leaves neither', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir)]);
  const k = key();
  prepare("CREATE TRIGGER no_brief_ledger BEFORE INSERT ON req_cost_ledger WHEN NEW.brief_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'the ledger is full'); END").run();
  const errors = mock.method(console, 'error', () => {});
  try {
    await (await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }))).job;
  } finally {
    errors.mock.restore();
    prepare('DROP TRIGGER no_brief_ledger').run();
  }
  const b = getBrief('project', k);
  assert.equal(b.status, 'ready', 'the brief itself is saved');
  assert.equal(b.costUsd, 0, 'no cost on the brief without its ledger row');
  assert.deepEqual(ledger(b.id), []);
  assert.ok(errors.mock.calls.some((c) => /could not book a brief look/.test(String(c.arguments[0]))), 'the failure is logged');
});

// ---------------------------------------------------------------- workspace

function workspace(n, { plain = [] } = {}) {
  const members = Array.from({ length: n }, (_, i) => {
    const k = `m${String(i).padStart(2, '0')}`;
    return { projectKey: k, projectName: `Project ${i}`, projectDir: plain.includes(k) ? tmp('req-brief-plain-') : repo().dir };
  });
  return members;
}

test('briefTarget: a workspace in key order, the first 8 repositories, the names past them, the seed', async () => {
  const members = workspace(11, { plain: ['m03'] });
  const ws = { id: 'ws-t', name: 'Shop WS', description: 'How it fits.', members: [...members].reverse() };
  const scannedAt = '2026-10-01T10:00:00.000Z';
  // a generous probe budget: eleven real git probes on a loaded machine must not land in `slow` (that case has its own test)
  const t = await briefTarget('workspace', 'ws-t', deps({ ws, wsRow: { descriptionOrigin: 'generated', mapSummary: { scannedAt } } }), { probeMs: 600_000 });
  assert.deepEqual(t.slow, []);
  assert.equal(t.name, 'Shop WS');
  assert.equal(t.description, 'How it fits.');
  assert.deepEqual(t.seed, { kind: 'workspace-map', scannedAt });
  assert.deepEqual(t.dirs.map((x) => x.project), ['m00', 'm01', 'm02', 'm04', 'm05', 'm06', 'm07', 'm08']);
  assert.deepEqual(t.dirs[0].base, { branch: 'main', ref: 'refs/heads/main' });
  assert.deepEqual(t.leftOut, ['Project 9', 'Project 10']);
  const small = { ...ws, members: members.slice(0, 2) };
  assert.deepEqual((await briefTarget('workspace', 'ws-t', deps({ ws: small, wsRow: { descriptionOrigin: 'edited', mapSummary: { scannedAt } } }))).seed, { kind: 'workspace-description' });
  assert.deepEqual((await briefTarget('workspace', 'ws-t', deps({ ws: small, wsRow: { descriptionOrigin: 'generated', mapSummary: null } }))).seed, { kind: 'workspace-description' });
  assert.equal((await briefTarget('workspace', 'ws-t', deps({ ws: { ...small, description: '  ' }, wsRow: null }))).seed, null);
  const r = repo();
  assert.deepEqual(await briefTarget('project', 'p-1', deps({ projects: [project('p-1', r.dir)] })), { name: 'Shop', dirs: [{ project: 'p-1', name: 'Shop', dir: r.dir, base: { branch: 'main', ref: 'refs/heads/main' } }], slow: [] });
});

test('a workspace look: 8 members on their default branches, the description cut at 8000, the seed, sources for what was checked out', async () => {
  const members = workspace(10);
  const ws = { id: 'ws-look', name: 'Shop WS', description: `${'d'.repeat(9000)}`, members };
  const scannedAt = '2026-10-01T10:00:00.000Z';
  const lk = looks();
  lk.failKeys = ['m07'];                                  // one member's checkout fails
  const runner = fakeRunner([{
    product: 'A shop in two parts.',
    areas: [{ name: 'Orders', text: 't', status: 'exists', files: ['repos/m00/src/a.mjs', join(lk.lookDir, 'repos', 'm01', 'b.mjs'), 'repos/m09/c.mjs'] }],
    files: [join(lk.lookDir, 'repos', 'm00', 'README.md')],
  }]);
  const d = deps({ runner, lk, ws, wsRow: { descriptionOrigin: 'generated', mapSummary: { scannedAt } } });
  await (await makeBrief('workspace', 'ws-look', { by: 'po' }, d)).job;
  const keys8 = ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07'];
  assert.deepEqual(lk.ws[0].members, keys8);
  assert.deepEqual(lk.ws[0].refs, Object.fromEntries(keys8.map((k) => [k, 'refs/heads/main'])));
  const prompt = runner.calls[0].prompt;
  const desc = prompt.slice(prompt.indexOf('<workspace_description>'), prompt.indexOf('</workspace_description>'));
  assert.ok(desc.includes('d'.repeat(8000)) && !desc.includes('d'.repeat(8001)));
  assert.ok(prompt.includes(`The working directory, ${lk.lookDir}, holds one checkout per project under repos/<project>: m00, m01, m02, m03, m04, m05, m06.`));
  const b = getBrief('workspace', 'ws-look');
  assert.equal(b.status, 'ready');
  assert.deepEqual(b.seed, { kind: 'workspace-map', scannedAt });
  assert.deepEqual(b.sources.map((s) => s.project), ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06']);
  assert.deepEqual(b.sources[0], { project: 'm00', branch: 'main', ref: 'refs/heads/main', sha: gitSha(members[0].projectDir, 'HEAD') });
  assert.deepEqual(b.sections.areas[0].files, ['repos/m00/src/a.mjs', 'repos/m01/b.mjs']);
  assert.deepEqual(b.files, ['repos/m00/README.md', 'repos/m00/src/a.mjs', 'repos/m01/b.mjs']);
  assert.equal(lk.closed, 1);
});

// ---------------------------------------------------------------- recovery, mock

test('recoverBriefs: a brief left making by a restart gets INTERRUPTED; a running one is left alone', async () => {
  const k = key();
  beginBrief('project', k);                               // what a restart leaves behind
  const r = repo();
  const lk = looks();
  const gate = deferred();
  const runner = fakeRunner([() => gate.promise.then(() => goodReply(lk.lookDir))]);
  const k2 = key();
  const { job } = await makeBrief('project', k2, {}, deps({ runner, lk, projects: [project(k2, r.dir)] }));
  assert.equal(recoverBriefs(), 1);
  const b = getBrief('project', k);
  assert.equal(b.status, 'empty');
  assert.deepEqual({ code: b.error.code, message: b.error.message },
    { code: 'INTERRUPTED', message: 'The look at the code did not finish because Worca restarted. Try again.' });
  assert.equal(getBrief('project', k2).status, 'making');
  assert.equal(getBrief('project', k2).error, null);
  gate.resolve();
  await job;
  assert.equal(getBrief('project', k2).status, 'ready');
  assert.equal(recoverBriefs(), 0);
});

test('mock mode: no checkout, no call, the canned brief, sources from the project\'s own checkout on its default branch', async () => {
  process.env.WORCA_MOCK = '1';
  const r = repo();
  const mainSha = r.sha();
  r.originHead();
  r.g('checkout', '-q', '-b', 'feature');
  r.commit('x.mjs');
  const never = async () => { throw new Error('mock mode must not get here'); };
  const runner = { calls: [], runClaudeImpl: never };
  const k = key();
  await (await makeBrief('project', k, { by: 'po' }, deps({ runner, projects: [project(k, r.dir)], openLook: never, openWorkspaceLook: never }))).job;
  const b = getBrief('project', k);
  assert.equal(b.status, 'ready', JSON.stringify(b.error));
  assert.deepEqual(b.sections, mockBrief('Shop').sections);
  assert.deepEqual(b.files, ['README.md']);
  assert.deepEqual(b.sources, [{ project: k, branch: 'main', ref: 'refs/heads/main', sha: mainSha }]);
  assert.equal(b.costUsd, 0);
  assert.deepEqual(ledger(b.id), []);
});

test('the mock switch is a dep: mockEnabled() true runs the canned brief without WORCA_MOCK, false the real path with it set', async () => {
  const r = repo();
  r.originHead();
  const never = async () => { throw new Error('mock mode must not get here'); };
  const k = key();
  await (await makeBrief('project', k, {}, deps({ runner: { calls: [], runClaudeImpl: never }, projects: [project(k, r.dir)], openLook: never,
    mockEnabled: () => true }))).job;
  assert.deepEqual(getBrief('project', k).sections, mockBrief('Shop').sections);
  process.env.WORCA_MOCK = '1';
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir)]);
  const k2 = key();
  await (await makeBrief('project', k2, {}, deps({ runner, lk, projects: [project(k2, r.dir)], mockEnabled: () => false }))).job;
  assert.equal(runner.calls.length, 1, 'the real path: one (fake) call');
  assert.equal(getBrief('project', k2).sections.product, 'An online shop for home goods.');
});

// ---------------------------------------------------------------- staleness

let sid = 1000;
const ORDERS = { name: 'Orders', text: 't', status: 'partly', files: ['src/orders.mjs'], added: null, belongsTo: null };
const ACCOUNTS = { name: 'Accounts', text: 't', status: 'exists', files: ['src/accounts.mjs'], added: null, belongsTo: null };
const staleBrief = (k, sha, over = {}) => ({
  id: ++sid, scopeType: 'project', scopeKey: k, status: 'ready', madeAt: '2026-10-01T10:00:00.000Z',
  sections: { product: 'p', users: [], terms: [], areas: [ORDERS, ACCOUNTS] }, edited: {},
  sources: [{ project: k, branch: 'main', ref: 'refs/heads/main', sha }], ...over,
});
const sdeps = (projects, extra = {}) => ({ listProjects: async () => projects, workspaceTarget: async () => null, ...extra });
const head = (s) => ({ known: s.known, commits: s.commits, touching: s.touching, areas: s.areas, checked: s.checked, partial: s.partial });

test('staleness: nothing to compare → null; no commits; two commits of which one touches an area; edited areas are not checked', async () => {
  const r = repo();
  const sha = r.commit('src/orders.mjs');
  const k = key();
  const P = [project(k, r.dir)];
  assert.equal(await briefStaleness(null, sdeps(P)), null);
  assert.equal(await briefStaleness(staleBrief(k, sha, { madeAt: null }), sdeps(P)), null);
  assert.equal(await briefStaleness(staleBrief(k, sha, { sources: [{ project: k, branch: 'main', ref: 'refs/heads/main', sha: null }] }), sdeps(P)), null);
  assert.deepEqual(head(await briefStaleness(staleBrief(k, sha), sdeps(P))), { known: true, commits: 0, touching: 0, areas: [], checked: true, partial: false });
  r.commit('src/orders.mjs', 'change orders');
  r.commit('docs/notes.md');
  const s = await briefStaleness(staleBrief(k, sha), sdeps(P));
  assert.deepEqual(head(s), { known: true, commits: 2, touching: 1, areas: ['Orders'], checked: true, partial: false });
  assert.deepEqual(s.sources, [{ project: k, branch: 'main', ref: 'refs/heads/main', sha, known: true, commits: 2 }]);
  const e = await briefStaleness(staleBrief(k, sha, { edited: { areas: true } }), sdeps(P));
  assert.deepEqual(head(e), { known: true, commits: 2, touching: 0, areas: [], checked: false, partial: false });
});

test('staleness cannot tell: rewritten (reset away), branch-gone, missing folder', async () => {
  const r = repo();
  const first = r.sha();
  const sha = r.commit('src/orders.mjs');
  r.g('reset', '-q', '--hard', first);
  r.commit('other.md');
  const k = key();
  assert.deepEqual(await briefStaleness(staleBrief(k, sha), sdeps([project(k, r.dir)])), { known: false, reason: 'rewritten', branch: 'main', sha });

  const g = repo();
  const gsha = g.sha();
  g.g('checkout', '-q', '-b', 'other');
  g.g('branch', '-D', 'main');
  const k2 = key();
  assert.deepEqual(await briefStaleness(staleBrief(k2, gsha), sdeps([project(k2, g.dir)])), { known: false, reason: 'branch-gone', branch: 'main', sha: gsha });

  const m = repo();
  const msha = m.sha();
  renameSync(m.dir, `${m.dir}-moved`);
  scratch.push(`${m.dir}-moved`);
  const k3 = key();
  assert.deepEqual(await briefStaleness(staleBrief(k3, msha), sdeps([{ ...project(k3, m.dir), exists: false }])), { known: false, reason: 'missing', branch: 'main', sha: msha });
  assert.deepEqual(await briefStaleness(staleBrief(k3, msha), sdeps([project(k3, m.dir)])), { known: false, reason: 'missing', branch: 'main', sha: msha });
  assert.deepEqual(await briefStaleness(staleBrief(k3, msha), sdeps([])), { known: false, reason: 'missing', branch: 'main', sha: msha });
});

test('staleness of a workspace: a removed member is skipped, a missing one is unknown, an added one is named; totals cover the rest', async () => {
  const A = repo();
  const B = repo();
  const D = repo();
  const shaA = A.sha();
  const shaB = B.sha();
  A.commit('src/orders.mjs');
  renameSync(B.dir, `${B.dir}-moved`);
  scratch.push(`${B.dir}-moved`);
  const brief = {
    id: ++sid, scopeType: 'workspace', scopeKey: 'ws-stale', status: 'ready', madeAt: '2026-10-01T10:00:00.000Z', edited: {},
    sections: { product: 'p', users: [], terms: [], areas: [{ ...ORDERS, files: ['repos/a/src/orders.mjs'] }] },
    sources: [
      { project: 'a', branch: 'main', ref: 'refs/heads/main', sha: shaA },
      { project: 'b', branch: 'main', ref: 'refs/heads/main', sha: shaB },
      { project: 'c', branch: 'main', ref: 'refs/heads/main', sha: shaA },
    ],
  };
  const members = [
    { projectKey: 'a', projectName: 'Alpha', projectDir: A.dir },
    { projectKey: 'b', projectName: 'Beta', projectDir: B.dir },
    { projectKey: 'd', projectName: 'Delta', projectDir: D.dir },
  ];
  const s = await briefStaleness(brief, { listProjects: async () => [], workspaceTarget: async () => ({ id: 'ws-stale', name: 'WS', description: '', members }) });
  assert.deepEqual(head(s), { known: true, commits: 1, touching: 1, areas: ['Orders'], checked: true, partial: false });
  assert.deepEqual(s.unknown, ['Beta']);
  assert.deepEqual(s.added, ['Delta']);
  assert.deepEqual(s.sources.map((x) => [x.project, x.known, x.reason || null]), [['a', true, null], ['b', false, 'missing']]);

  const none = await briefStaleness({ ...brief, id: ++sid, sources: [brief.sources[1]] },
    { listProjects: async () => [], workspaceTarget: async () => ({ id: 'ws-stale', name: 'WS', description: '', members }) });
  assert.equal(none.known, false);
  assert.equal(none.reason, 'missing');
  assert.deepEqual(none.unknown, ['Beta']);

  // every member the brief was made from has left the workspace: its own reason, not a missing folder
  const gone = await briefStaleness({ ...brief, id: ++sid },
    { listProjects: async () => [], workspaceTarget: async () => ({ id: 'ws-stale', name: 'WS', description: '', members: [members[2]] }) });
  assert.equal(gone.known, false);
  assert.equal(gone.reason, 'removed');
  assert.deepEqual(gone.unknown, []);
  assert.deepEqual(gone.added, ['Delta']);
  const empty = await briefStaleness({ ...brief, id: ++sid }, { listProjects: async () => [], workspaceTarget: async () => null });
  assert.equal(empty.reason, 'removed', 'the workspace itself is gone');
});

test('staleness: commitsAhead past 2000, or a full page of commits, is partial; an unreadable count is rewritten; no file list is slow', async () => {
  const dir = tmp('req-brief-fake-');
  const k = key();
  const sha = 'a'.repeat(40);
  const page = { commits: Array.from({ length: 2000 }, (_, i) => ({ sha: String(i).padStart(40, '0'), files: i === 0 ? ['src/orders.mjs'] : [] })) };
  const fake = (extra) => sdeps([project(k, dir)], { commitOf: async () => sha, isAncestor: async () => true, commitsAhead: async () => 2500, commitFilesSince: async () => page, ...extra });
  assert.deepEqual(head(await briefStaleness(staleBrief(k, sha), fake())), { known: true, commits: 2500, touching: 1, areas: ['Orders'], checked: true, partial: true });
  assert.equal((await briefStaleness(staleBrief(k, sha), fake({ commitsAhead: async () => 2000 }))).partial, true, 'commitFilesSince hit its max');
  assert.equal((await briefStaleness(staleBrief(k, sha), fake({ commitsAhead: async () => 3, commitFilesSince: async () => ({ commits: page.commits.slice(0, 3) }) }))).partial, false);
  assert.deepEqual(await briefStaleness(staleBrief(k, sha), fake({ commitsAhead: async () => null })), { known: false, reason: 'rewritten', branch: 'main', sha });
  assert.deepEqual(await briefStaleness(staleBrief(k, sha), fake({ isAncestor: async () => false })), { known: false, reason: 'rewritten', branch: 'main', sha });
  assert.deepEqual(await briefStaleness(staleBrief(k, sha), fake({ commitOf: async () => null })), { known: false, reason: 'branch-gone', branch: 'main', sha });
  const slowBrief = staleBrief(k, sha);
  assert.deepEqual(await briefStaleness(slowBrief, fake({ commitFilesSince: async () => null })), { known: false, reason: 'slow', branch: 'main', sha });
  assert.equal((await briefStaleness(slowBrief, fake())).known, true, 'a slow result is not memoised');
});

test('staleness: a check slower than 10 s is "slow" and not memoised; a result is memoised 30 s per brief and made_at', async () => {
  const r = repo();
  const sha = r.sha();
  const k = key();
  const P = [project(k, r.dir)];
  const brief = staleBrief(k, sha);
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try {
    const p = briefStaleness(brief, sdeps(P, { commitOf: () => new Promise(() => {}) }));
    await new Promise(setImmediate);
    mock.timers.tick(STALENESS_TIMEOUT_MS);
    assert.deepEqual(await p, { known: false, reason: 'slow' });

    let n = 0;
    const counting = sdeps(P, { commitOf: async (...a) => { n += 1; return commitOf(...a); } });
    assert.equal((await briefStaleness(brief, counting)).known, true);
    assert.equal(n, 1, 'computed: the slow result was not kept');
    await briefStaleness(brief, counting);
    assert.equal(n, 1, 'memoised');
    mock.timers.tick(29_000);
    await briefStaleness(brief, counting);
    assert.equal(n, 1, 'still memoised at 29 s');
    mock.timers.tick(2_000);
    await briefStaleness(brief, counting);
    assert.equal(n, 2, 'checked again after 30 s');
    await briefStaleness({ ...brief, madeAt: '2026-10-02T10:00:00.000Z' }, counting);
    assert.equal(n, 3, 'a refreshed brief is checked anew');
  } finally { mock.timers.reset(); }
});

// ---------------------------------------------------------------- review fixes

test('a failure before the job first waits (a checkout that throws at once) leaves the scope free: not busy, a second press runs', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir)]);
  const k = key();
  let first = true;
  const open = lk.openLook;
  const openLook = (...a) => { if (first) { first = false; throw new Error('the disk is full'); } return open(...a); };   // not async: throws synchronously
  const d = deps({ runner, lk, projects: [project(k, r.dir)], openLook });
  const { job } = await makeBrief('project', k, {}, d);
  await job;
  assert.equal(getBrief('project', k).error.message, 'the disk is full');
  assert.equal(isBriefBusy('project', k), false);
  await (await makeBrief('project', k, {}, d)).job;
  assert.equal(getBrief('project', k).status, 'ready');
  assert.equal(runner.calls.length, 1);
  assert.equal(recoverBriefs(), 0);
});

test('two presses at the same moment: one starts, the other is BUSY, one job and one call', async () => {
  const r = repo();
  const lk = looks();
  const gate = deferred();   // the first look is still running while the second press is checked
  const runner = fakeRunner([() => gate.promise.then(() => goodReply(lk.lookDir)), goodReply(lk.lookDir)]);
  const k = key();
  const d = deps({ runner, lk, projects: [project(k, r.dir)] });
  const res = await Promise.allSettled([makeBrief('project', k, {}, d), makeBrief('project', k, {}, d)]);
  gate.resolve();
  const ok = res.filter((x) => x.status === 'fulfilled');
  const no = res.filter((x) => x.status === 'rejected');
  assert.equal(ok.length, 1, JSON.stringify(no.map((x) => [x.reason.code, x.reason.message])));
  assert.equal(no.length, 1);
  assert.equal(no[0].reason.code, 'BUSY');
  await ok[0].value.job;
  assert.equal(runner.calls.length, 1);
  assert.equal(lk.opened.length, 1);
});

test('a default branch too slow to read is not "no repository": its own refusal, the slow names on the target', async () => {
  const r = repo();
  const k = key();
  const hang = () => new Promise(() => {});
  const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise(setImmediate); };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // the press has its own, longer probe budget (BRIEF_PRESS_PROBE_MS), not the page's 10 s
    const p = makeBrief('project', k, {}, deps({ projects: [project(k, r.dir)], defaultBranchRef: hang }));
    let e = null;
    const settled = p.then(() => null, (x) => { e = x; return x; });
    await flush();
    mock.timers.tick(STALENESS_TIMEOUT_MS);
    await flush();
    assert.equal(e, null, 'still probing after the page\'s 10 s');
    mock.timers.tick(BRIEF_PRESS_PROBE_MS - STALENESS_TIMEOUT_MS);
    await settled;
    assert.deepEqual({ code: e && e.code, message: e && e.message }, { code: 'CONFLICT', message: 'Worca could not read the repository in time. Try again.' });
    assert.equal(getBrief('project', k), null);

    const members = [{ projectKey: 'a', projectName: 'Alpha', projectDir: r.dir }, { projectKey: 'b', projectName: 'Beta', projectDir: repo().dir }];
    // a workspace with one member too slow at the press: refused, naming it, rather than a brief made from the rest
    const slowFirst = async (dir) => (dir === r.dir ? hang() : { branch: 'main', ref: 'refs/heads/main' });
    const runner = fakeRunner([]);
    const wk = 'ws-press-slow';
    const wp = makeBrief('workspace', wk, {}, deps({ runner, ws: { id: wk, name: 'WS', description: '', members }, defaultBranchRef: slowFirst }));
    let we = null;
    const wsettled = wp.then(() => null, (x) => { we = x; return x; });
    await flush();
    mock.timers.tick(BRIEF_PRESS_PROBE_MS);
    await wsettled;
    assert.deepEqual({ code: we && we.code, message: we && we.message }, { code: 'CONFLICT', message: 'Worca could not read Alpha in time. Try again.' });
    assert.equal(getBrief('workspace', wk), null, 'nothing written');
    assert.equal(runner.calls.length, 0, 'nothing spent');
    assert.equal(isBriefBusy('workspace', wk), false);

    // b answers at once (the mocked clock would also run out a real git call still under way)
    const slowA = async (dir) => (dir === r.dir ? hang() : { branch: 'main', ref: 'refs/heads/main' });
    const tp = briefTarget('workspace', 'ws-slow', deps({ ws: { id: 'ws-slow', name: 'WS', description: '', members }, defaultBranchRef: slowA }));
    for (let i = 0; i < 5; i += 1) await new Promise(setImmediate);
    mock.timers.tick(STALENESS_TIMEOUT_MS);
    const t = await tp;
    assert.deepEqual(t.dirs.map((x) => x.project), ['b']);
    assert.deepEqual(t.slow, ['Alpha']);
    assert.deepEqual(t.leftOut, []);
  } finally { mock.timers.reset(); }
});

test('the switch turned off while the target is read refuses the press, writing nothing', async () => {
  const r = repo();
  const k = key();
  const runner = fakeRunner([]);
  const listProjects = async () => { setContext('project', k, { lookAtCode: false }); return [project(k, r.dir)]; };
  await assert.rejects(makeBrief('project', k, {}, deps({ runner, listProjects })),
    (e) => e.code === 'CONFLICT' && e.message === 'Looking at the code is off for this project. Turn it on under Your notes for Worca.');
  assert.equal(getBrief('project', k), null);
  assert.equal(runner.calls.length, 0);
});

test('a project folder inside another repository (no .git of its own) is refused at the press', async () => {
  const r = repo();
  const sub = join(r.dir, 'packages', 'web');
  mkdirSync(sub, { recursive: true });
  const k = key();
  const lk = looks();
  await assert.rejects(makeBrief('project', k, {}, deps({ lk, projects: [project(k, sub)] })),
    (e) => e.code === 'CONFLICT' && e.message === 'There is no repository to look at.');
  assert.equal(getBrief('project', k), null);
  assert.equal(lk.opened.length, 0);
});

test('a checkout that leaves under 1 s for the call fails with the checkout message, no call', async () => {
  const r = repo();
  const lk = looks();
  const open = lk.openLook;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  try {
    lk.openLook = async (...a) => { mock.timers.tick(BRIEF_TIMEOUT_MS - 500); return open(...a); };
    const runner = fakeRunner([goodReply(lk.lookDir)]);
    const k = key();
    await (await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }))).job;
    const b = getBrief('project', k);
    assert.deepEqual({ code: b.error.code, message: b.error.message }, { code: 'TIMEOUT', message: 'Worca could not check out the code in time. Try again.' });
    assert.equal(runner.calls.length, 0);
    assert.equal(lk.closed, 1);
  } finally { mock.timers.reset(); }
});

// Task 6 review: the memo keeps the git part only; the areas are matched on every call, so an owner's edit of the
// areas (D6: no longer checked) or an added / renamed area shows at once, not after the 30 s memo.
test('staleness: the memo keeps the commits, not the areas; edits and added areas show at once', async () => {
  const r = repo();
  const sha = r.commit('src/orders.mjs');
  const k = key();
  let n = 0;
  const counting = sdeps([project(k, r.dir)], { commitOf: async (...a) => { n += 1; return commitOf(...a); } });
  r.commit('src/orders.mjs', 'change orders');
  const brief = staleBrief(k, sha);
  assert.deepEqual(head(await briefStaleness(brief, counting)), { known: true, commits: 1, touching: 1, areas: ['Orders'], checked: true, partial: false });
  assert.equal(n, 1);
  const edited = await briefStaleness({ ...brief, edited: { areas: true } }, counting);
  assert.deepEqual(head(edited), { known: true, commits: 1, touching: 0, areas: [], checked: false, partial: false });
  const renamed = { ...ORDERS, name: 'Order history' };
  const added = { name: 'Gift', belongsTo: 'Orders', text: 't', status: null, files: ['src/orders.mjs'], added: { feature: 'FEAT-1', at: 'x' } };
  const s = await briefStaleness({ ...brief, sections: { ...brief.sections, areas: [renamed, ACCOUNTS, added] } }, counting);
  assert.deepEqual(s.areas, ['Order history', 'Orders: Gift']);
  assert.equal(n, 1, 'the git part came from the memo every time');
});

test('A8: the brief look carries Ask\'s deny rules (its documents are third-party material)', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir)]);
  const k = key();
  await (await makeBrief('project', k, {}, deps({ runner, lk, projects: [project(k, r.dir)] }))).job;
  assert.deepEqual(runner.calls[0].permissionRules, { deny: [...REQUIREMENTS_READ_DENY_RULES] });
  assert.equal('readGuard' in runner.calls[0], false, 'a look reads its checkout: no one-file guard');
});

test('A8 D6: a refresh hands the brief\'s documents to the look as <brief_documents>; a first look has none', async () => {
  const r = repo();
  const lk = looks();
  const runner = fakeRunner([goodReply(lk.lookDir), goodReply(lk.lookDir)]);
  const k = key();
  const d = deps({ runner, lk, projects: [project(k, r.dir)] });
  await (await makeBrief('project', k, {}, d)).job;
  const doc = insertAttachment({ id: mintAttachmentId(), ownerType: 'brief', ownerId: getBrief('project', k).id, name: 'tone.md', kind: 'text',
    mime: 'text/markdown', bytes: 3, sha256: 'tone1' });
  updateAttachment(doc.id, { status: 'done', summary: 'Friendly and short.' });
  await (await makeBrief('project', k, {}, d)).job;
  assert.equal(runner.calls[0].prompt.includes('<brief_documents>'), false);
  assert.match(runner.calls[1].prompt, /<brief_documents>\ntone\.md: Friendly and short\.\n<\/brief_documents>\n\nThese documents are the product owner's material/);
});
