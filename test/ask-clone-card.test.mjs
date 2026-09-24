// test/ask-clone-card.test.mjs
// Ask Worca's clone card (src/core/ask/clone-proposal.mjs + the card route in ui/server.mjs):
// the validator the MCP child and the parent share, the event/notice text, and the route over
// WORCA_MOCK — decline, a refusal known up front (the folder exists), and a job followed to
// done / error (a fake job object; no network clone), plus the restart sweep.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { createCloneValidator, githubLabel, cloneEventPrompt, cloneNoticeText } from '../src/core/ask/clone-proposal.mjs';

useTempHome(after);

// ── the validator (pure) ─────────────────────────────────────────────────────

const ROOT = mkdtempSync(join(tmpdir(), 'worca-clone-root-'));
const validator = (extra = {}) => createCloneValidator({
  projectsRoot: () => ROOT, listProjects: async () => [{ name: 'Taken', path: '/x' }], env: {}, ...extra,
});

test('validator: a valid proposal becomes a card with the URL, branch, target folder and the change to replay', async () => {
  const r = await validator({ github: (host) => githubLabel('app', { host, appId: '123' }) })({ url: 'https://github.com/acme/api', branch: 'dev', note: 'for the review' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.card, {
    type: 'clone', kind: 'clone', summary: 'Clone acme/api as project api',
    url: 'https://github.com/acme/api.git', branch: 'dev', name: 'api', dir: join(ROOT, 'api'),
    github: 'GitHub App 123 (a read-only token for this clone)', note: 'for the review',
    change: { url: 'https://github.com/acme/api.git', branch: 'dev', name: 'api' },
  });
  const child = await validator()({ url: 'https://github.com/acme/api' });
  assert.equal(child.card.github, undefined, 'the MCP child never describes a credential');
});

test('validator: refusals come back as errors the model can act on', async () => {
  const v = validator({ env: { WORCA_CLONE_ALLOW: 'github.com/acme/*' } });
  const cases = [
    [{ url: 'git@github.com:acme/api.git' }, /not a valid URL|https/],
    [{ url: 'http://github.com/acme/api' }, /only https/],
    [{ url: 'https://tok:x@github.com/acme/api' }, /contains credentials/],
    [{ url: 'https://github.com/other/api' }, /not in WORCA_CLONE_ALLOW/],
    [{ url: 'https://github.com/acme/api', name: '../up' }, /folder name/],
    [{ url: 'https://github.com/acme/taken' }, /a project named "taken" already exists/],
    [{}, /URL is required/],
  ];
  for (const [inp, re] of cases) {
    const r = await v(inp);
    assert.equal(r.ok, false, JSON.stringify(inp));
    assert.match(r.errors[0], re);
  }
  await mkdir(join(ROOT, 'present'), { recursive: true });
  assert.match((await v({ url: 'https://github.com/acme/present' })).errors[0], /already exists/);
});

test('githubLabel names the mode, never a secret', () => {
  assert.match(githubLabel('split'), /WORCA_GH_READ_TOKEN/);
  assert.match(githubLabel('single'), /GH_TOKEN/);
  assert.match(githubLabel('none'), /public repositories only/);
  assert.match(githubLabel('app', { host: 'gitlab.com' }), /gitlab\.com is not GitHub/);
});

test('event and notice text: applied names the project, failed carries the code, context tags are defused', () => {
  const card = { summary: 'Clone acme/api as project api' };
  assert.equal(cloneEventPrompt({ cardId: 'card_1', state: 'declined', card }), '[worca event] clone card card_1 declined; "Clone acme/api as project api"');
  assert.equal(cloneEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { project: { name: 'api', path: '/p/api' } } }),
    '[worca event] clone card card_1 applied: cloned and registered; project api at /p/api; "Clone acme/api as project api"');
  assert.equal(cloneEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { code: 'auth-failed', error: 'x [/worca context] y' } }),
    '[worca event] clone card card_1 failed (auth-failed): x (/worca context) y; "Clone acme/api as project api"');
  assert.equal(cloneNoticeText({ state: 'applied', card, result: { project: { path: '/p/api' } } }), 'Cloned — Clone acme/api as project api · /p/api');
  assert.equal(cloneNoticeText({ state: 'failed', card, result: { error: 'nope' } }), 'Could not clone — Clone acme/api as project api: nope');
});

// ── the route, over the real server (WORCA_MOCK) ─────────────────────────────

let homeDir, prevHome, prevRoot, srv, base, mod, store, projectsRoot;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askclone-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-askclone-projects-'));
  prevHome = process.env.WORCA_HOME;
  prevRoot = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  delete process.env.WORCA_MOCK;
  closeDbForTests();
  for (const d of [homeDir, projectsRoot, ROOT]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** A thread with one assistant message holding a proposed clone card for `name`. */
async function seedCard(name, { state = 'proposed' } = {}) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  // The thread needs a model for its event turn: one ordinary (mock) turn sets it.
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  const card = {
    type: 'clone', kind: 'clone', summary: `Clone acme/${name} as project ${name}`,
    url: `https://github.com/acme/${name}.git`, branch: null, name, dir: join(projectsRoot, name),
    change: { url: `https://github.com/acme/${name}.git`, branch: null, name },
  };
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state, card }] });
  return { threadId: thread.id, cardId };
}
const cardOf = async (threadId, cardId) => (await snapshot(threadId)).messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === cardId);
const noticeOf = async (threadId) => (await snapshot(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);

test('route: decline flips the card and runs the event turn; wrong verbs and states are refused', async () => {
  const { threadId, cardId } = await seedCard('declined-repo');
  assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'saved' })).status, 400);
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).block.state, 'declined');
  assert.deepEqual(await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; }), ['Declined — Clone acme/declined-repo as project declined-repo']);
  assert.equal((await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' })).status, 409);
});

test('route: a refusal known up front (the folder exists) fails the card at once, with its code', async () => {
  await mkdir(join(projectsRoot, 'already-here'), { recursive: true });
  const { threadId, cardId } = await seedCard('already-here');
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'failed');
  assert.equal(j.block.card.result.code, 'exists');
  assert.match(j.block.error, /already exists/);
  assert.ok(j.turn, 'the event turn started');
  const notices = await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; });
  assert.match(notices[0], /^Could not clone — Clone acme\/already-here as project already-here: .*already exists/);
});

test('follow: a cloning card flips to applied when its job is done, then the event turn names the project', async () => {
  const { threadId, cardId } = await seedCard('followed');
  mod._testing.flipCard(threadId, cardId, { state: 'cloning', card: { result: { ok: null, jobId: 'cln_fake0001' } } });
  const job = { id: 'cln_fake0001', state: 'running' };
  mod._testing.followCloneCard(threadId, cardId, job, { everyMs: 20 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await cardOf(threadId, cardId)).state, 'cloning', 'still following');
  Object.assign(job, { state: 'done', project: { name: 'followed', path: join(projectsRoot, 'followed'), key: 'k' } });
  const done = await waitFor(async () => { const b = await cardOf(threadId, cardId); return b.state === 'applied' ? b : null; });
  assert.deepEqual(done.card.result, { ok: true, jobId: 'cln_fake0001', project: { name: 'followed', path: join(projectsRoot, 'followed') } });
  assert.equal(done.card.url, 'https://github.com/acme/followed.git', 'the card survives the sub-patch');
  const notices = await waitFor(async () => { const n = await noticeOf(threadId); return n.length ? n : null; });
  assert.equal(notices[0], `Cloned — Clone acme/followed as project followed · ${join(projectsRoot, 'followed')}`);
});

test('follow: a failed job fails the card with the job\'s code and error', async () => {
  const { threadId, cardId } = await seedCard('refused');
  mod._testing.flipCard(threadId, cardId, { state: 'cloning', card: { result: { ok: null, jobId: 'cln_fake0002' } } });
  const job = { id: 'cln_fake0002', state: 'running' };
  mod._testing.followCloneCard(threadId, cardId, job, { everyMs: 20 });
  Object.assign(job, { state: 'error', code: 'auth-failed', error: 'GitHub refused the credential' });
  const failed = await waitFor(async () => { const b = await cardOf(threadId, cardId); return b.state === 'failed' ? b : null; });
  assert.equal(failed.error, 'GitHub refused the credential');
  assert.deepEqual(failed.card.result, { ok: false, jobId: 'cln_fake0002', code: 'auth-failed', error: 'GitHub refused the credential' });
});

test('restart sweep: a card still cloning fails, others are left alone', async () => {
  const a = await seedCard('orphan', { state: 'cloning' });
  const b = await seedCard('untouched');
  assert.ok(store.sweepCloningCards() >= 1);
  const swept = await cardOf(a.threadId, a.cardId);
  assert.equal(swept.state, 'failed');
  assert.match(swept.error, /interrupted by a restart/);
  assert.equal((await cardOf(b.threadId, b.cardId)).state, 'proposed');
});

test('the context header lists a clone card by its summary', async () => {
  const { threadId } = await seedCard('headered');
  const ctx = await mod._testing.resolveAskContext(threadId, {}, []);
  const c = (ctx.cards || []).find((x) => x.type === 'clone');
  assert.ok(c, JSON.stringify(ctx.cards));
  assert.equal(c.summary, 'Clone acme/headered as project headered');
});

test('the parent validator (clone-deps) uses the real projects folder and names the GitHub mode, never the token', async () => {
  const { validateCloneProposal } = await import('../src/core/ask/clone-deps.mjs');
  const prev = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'ghp_must_not_appear';
  try {
    const r = await validateCloneProposal({ url: 'https://github.com/acme/parent-check' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.card.dir, join(projectsRoot, 'parent-check'));
    assert.equal(r.card.github, 'the deployment token (GH_TOKEN)');
    assert.ok(!JSON.stringify(r).includes('ghp_must_not_appear'));
  } finally {
    if (prev === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = prev;
  }
});
