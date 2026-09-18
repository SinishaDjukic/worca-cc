// test/ask-api-policy-cards.test.mjs
// The team-policy card end to end over WORCA_MOCK (docs/team-policy.md "Ask Worca"), against a
// real bare origin: the mock's propose_policy_change → the parent re-validates and mints the card
// → POST /api/ask/threads/:id/cards/:cardId `applied` publishes ONE commit to the worca-policy
// branch (the change happens HERE, behind the click) or `declined` changes nothing; each flips the
// card, stores the synthetic notice row and starts the "[worca event] policy card …" turn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;
useGitSandbox(before, after);   // FIRST: pins HOME / GIT_CONFIG_GLOBAL for the server and the git calls
useTempHome(after);

const origCwd = process.cwd();
let root, homeDir, srv, base, wsBase, mod, prevHome;
let gwBare, gw, gwKey;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };
const POLICY = (bare) => JSON.parse(git(bare, 'show', 'worca-policy:.worca-policy/policy.json'));
const commits = (bare) => Number(git(bare, 'rev-list', '--count', 'worca-policy'));

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'worca-cc-askpcards-'));
  gwBare = makeOrigin(root, 'gateway'); gw = cloneAs(root, 'm', gwBare, 'gateway');
  process.chdir(gw);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askpcards-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'gateway', path: gw });
  gwKey = (await listProjects()).find((p) => p.path === gw).key;
  if (skip) return;
  // The policy the PM already published: a soft per-pipeline cap of $25 that asks for a reason.
  const { enableTeamPolicy, publishPolicy, resolveProjectPolicy } = await import('../src/core/policy/sync.mjs');
  await enableTeamPolicy(gw, { mode: 'here', title: 'Gateway team policy' });
  const cur = (await resolveProjectPolicy(gw)).doc;
  await publishPolicy(gw, { ...cur, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25, requireReason: true } } });
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  mod.runs.clear();
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  closeDbForTests();
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  await reap(homeDir);
  await reap(root);
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
const WAIT_MS = 15000;
async function waitFor(pred, timeoutMs = WAIT_MS) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const frames = (msgs, threadId, type) => msgs.filter((m) => m.threadId === threadId && m.type === type);

async function proposePolicy(text = 'raise the policy cap to $40 for the Q4 push') {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context: { projectKey: gwKey } });
  assert.equal(r.status, 202);
  const found = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'proposed')
    || frames(w.msgs, t.id, 'ask-done').length && { done: true });
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  w.ws.close();
  return { thread: t, card: found.block || null, msgs: w.msgs };
}
async function eventReply(threadId, beforeCount) {
  return waitFor(async () => {
    const s = await snapshot(threadId);
    const asst = s.messages.filter((m) => m.role === 'assistant');
    return asst.length > beforeCount && asst.at(-1).status === 'done' ? asst.at(-1) : null;
  });
}
const noticeOf = (s) => s.messages.find((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic));

test('the mock proposes an edit: the parent re-validates it over the real policy and mints the card', { skip }, async () => {
  const { card, msgs, thread } = await proposePolicy();
  assert.ok(card, 'a proposed card');
  const c = card.card;
  assert.deepEqual([c.type, c.kind, c.projectKey, c.projectName, c.home], ['policy', 'edit', gwKey, 'gateway', 'gateway']);
  assert.equal(c.summary, "Edit gateway's team policy — Per-pipeline cap (USD): $25.00 → $40.00");
  assert.deepEqual(c.changes.map((x) => [x.before, x.after]), [['soft $25.00 · reason required', 'soft $40.00 · reason required']], 'the reason rule is kept');
  assert.ok(frames(msgs, thread.id, 'ask-label').some((f) => f.label === 'Proposing a policy change'), 'the tool row is labelled');
  const s = await snapshot(thread.id);
  assert.equal(s.messages.flatMap((m) => m.blocks || []).find((b) => b.id === card.id).state, 'proposed', 'persisted');
});

test('apply: one commit on the branch, the card applied with the result, the notice row and the event turn', { skip }, async () => {
  const { card, thread } = await proposePolicy();
  const n = commits(gwBare);
  const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'applied' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'applied');
  assert.match(j.block.card.result.detail, /^published [0-9a-f]{7} to gateway$/);
  assert.equal(j.block.card.summary, "Edit gateway's team policy — Per-pipeline cap (USD): $25.00 → $40.00", 'the sub-patch keeps the card');
  assert.equal(commits(gwBare), n + 1);
  assert.deepEqual(POLICY(gwBare).fields['cost.pipelineLimitUsd'], { kind: 'soft', value: 40, requireReason: true });
  const reply = await eventReply(thread.id, before);
  assert.match(reply.text, /Applied\./);
  const notice = noticeOf(await snapshot(thread.id));
  assert.match(notice.blocks[0].text, /^Applied — Edit gateway's team policy — Per-pipeline cap \(USD\): \$25\.00 → \$40\.00 · published [0-9a-f]{7} to gateway$/);
  assert.match(notice.text, /^\[worca event\] policy card card_[0-9a-f]{8} applied; "Edit gateway's team policy — Per-pipeline cap \(USD\): \$25\.00 → \$40\.00"; published [0-9a-f]{7} to gateway$/);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'applied' })).status, 409);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' })).status, 400);
});

test('decline: nothing is published; the event turn confirms', { skip }, async () => {
  const { card, thread } = await proposePolicy('change the policy cap to $55');
  const n = commits(gwBare);
  const before = (await snapshot(thread.id)).messages.filter((m) => m.role === 'assistant').length;
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).block.state, 'declined');
  assert.equal(commits(gwBare), n, 'no commit');
  const reply = await eventReply(thread.id, before);
  assert.match(reply.text, /Declined — nothing changed\./);
  assert.equal(noticeOf(await snapshot(thread.id)).blocks[0].text, "Declined — Edit gateway's team policy — Per-pipeline cap (USD): $40.00 → $55.00");
});

test('a proposal the real validator refuses leaves a notice, never a card', { skip }, async () => {
  // The branch already says $40: proposing $40 again is "nothing changes".
  const { card, thread } = await proposePolicy('set the policy cap to $40');
  assert.equal(card, null);
  const s = await snapshot(thread.id);
  const notices = s.messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'notice');
  assert.ok(notices.some((b) => /^Policy change rejected: nothing changes/.test(b.text)), JSON.stringify(notices));
});

test('the next turn\'s context names the policy card by type, and the Team policy page scope with its home', { skip }, async () => {
  const { card, thread } = await proposePolicy('lower the policy cap to $20');
  const ctx = await mod._testing.resolveAskContext(thread.id, { view: 'team-policy', tpScope: `project:${gwKey}` });
  assert.deepEqual(ctx.cards.find((c) => c.id === card.id), { id: card.id, type: 'policy', state: 'proposed', summary: "Edit gateway's team policy — Per-pipeline cap (USD): $40.00 → $20.00" });
  assert.deepEqual(ctx.teamPolicy, { kind: 'project', id: gwKey, name: 'gateway', home: 'gateway' });
});
