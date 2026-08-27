// test/ask-api-cards.test.mjs
// Cards end to end over WORCA_MOCK: propose (mock card from page context) →
// Start (/api/run link seam) → follower notices, for a project AND a workspace
// target; dismiss incl. the R-B mid-stream dual update; the rejection notice;
// DELETE-while-followed. The full agentgen-api boot (cwd git sandbox — the
// mock pipeline runs for real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import http from 'node:http';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, mod, prevHome;
let projectDir, projectDir2, projectKey, workspaceId;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };

function gitInit(dir) {
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
}

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askcards-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;

  // A registered project (the mock card's target) + a workspace over it.
  // POST /api/workspaces takes `projectPaths` and rejects fewer than 2 members
  // ("a workspace needs at least 2 member projects"), so a second registered
  // project is part of the fixture (dry-run-verified).
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-proj-'));
  gitInit(projectDir);
  projectDir2 = mkdtempSync(join(tmpdir(), 'worca-cc-askcards-proj2-'));
  gitInit(projectDir2);
  const { addProject, listProjects } = await import('../src/core/projects.mjs');
  await addProject({ name: 'demo', path: projectDir });
  await addProject({ name: 'demo2', path: projectDir2 });
  projectKey = (await listProjects()).find((p) => p.path === projectDir).key;
  const wsRes = await fetch(`${base}/api/workspaces`, {
    method: 'POST', headers: JSONH,
    body: JSON.stringify({ name: 'Team', projectPaths: [projectDir, projectDir2] }),
  });
  assert.equal(wsRes.status, 201, 'workspace seeded');
  workspaceId = (await wsRes.json()).workspace.id;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  for (const r of mod.runs.values()) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  mod.runs.clear();
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  // A stopped orchestrator still flushes artifacts for a few ticks, so a plain
  // recursive rm races those writes and ENOTEMPTYs under full-suite load (seen
  // once in ~2 `npm test` runs; never in isolation). Retry, and never let
  // teardown hygiene fail the file.
  // Windows cannot unlink an open file: with the sqlite handle still open the
  // recursive rm retries at EVERY directory level (rimraf compounds maxRetries
  // per level) and the worker never exits — the suite "hung" there. Close the
  // handle first so the reap is a plain delete.
  closeDbForTests();
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  if (cwdSandbox) await reap(cwdSandbox);
  await reap(homeDir);
  await reap(projectDir);
  await reap(projectDir2);
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
function waitFor(pred, timeoutMs = 10000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
const frames = (msgs, threadId, type) => msgs.filter((m) => m.threadId === threadId && m.type === type);

/** /api/run never forwards the orchestrator's `auto` flag, so a REAL mock run
 *  parks at every HITL gate for ever — wf_default's clarify question is the
 *  first one (test/api-sources.test.mjs:179 records the same fact: "HITL gates
 *  may hold a server run open"). This pump answers exactly as orchestrator auto
 *  mode does for every kind these runs hit (orchestrator.mjs:2802-2818:
 *  clarify/questions → the first non-blank option, gates → decision 'continue';
 *  real auto mode answers 'recovery' with 'abort', unreachable here — mock
 *  steps never fail), so a card-linked run
 *  reaches `done` and the follower posts its finish notice (dry-run-measured:
 *  518 ms to done with the pump; parked 60 s+ without). Returns a stopper. */
function autoAnswerRun(runId) {
  let stopped = false;
  let last = null;
  const tick = async () => {
    if (stopped) return;
    const pq = mod.runs.get(runId)?.pendingQuestion;
    if (pq && pq !== last) {
      last = pq;
      const payload = (pq.kind === 'clarify' || pq.kind === 'questions')
        ? { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options || []).find((o) => o && o.trim()) || 'auto' })) }
        : { decision: 'continue' };
      try { await post('/api/answer', { runId, id: pq.id, payload }); } catch { /* run gone */ }
    }
    if (!stopped) { const t = setTimeout(tick, 25); t.unref?.(); }
  };
  const t0 = setTimeout(tick, 25); t0.unref?.();
  return () => { stopped = true; };
}

/** Drive one mock turn whose text triggers the propose scenario; returns the proposed card block. */
async function proposeCard(context, text) {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context });
  assert.equal(r.status, 202);
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  const cardFrame = frames(w.msgs, t.id, 'ask-card')[0];
  w.ws.close();
  return { thread: t, card: cardFrame ? cardFrame.block : null, msgs: w.msgs };
}

test('project card: propose → Start via /api/run → started flip, notice, follower done + run-status', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose a run for this project');
  assert.ok(card, 'the mock propose scenario produced a card');
  assert.equal(card.state, 'proposed');
  assert.equal(card.card.projectKey, projectKey);
  assert.equal(card.card.guardrailsId, 'normal');
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  const snap1 = await snapshot(thread.id);
  const flipped = snap1.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(flipped.state, 'started', 'flip landed synchronously with the 200');
  assert.equal(flipped.runId, runId);
  assert.ok(snap1.messages.some((m) => m.role === 'system' && m.text === `Run started — "${card.card.title}"`));
  assert.equal(snap1.runLinks.length, 1);
  assert.equal(snap1.runLinks[0].runId, runId);
  assert.equal(snap1.runLinks[0].cardId, card.id);
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').some((m) => /Run finished/.test(m.message.text)));
  const statuses = frames(w.msgs, thread.id, 'ask-run-status');
  assert.ok(statuses.length >= 1);
  assert.ok(statuses.some((s) => typeof s.pipelineId === 'string' && s.pipelineId), 'pipeline id captured from state');
  const snap2 = await snapshot(thread.id);
  assert.ok(snap2.runLinks[0].pipelineId, 'link row carries the pipeline id');
  assert.equal(snap2.runLinks[0].status, 'done');
  stopPump();
  w.ws.close();
});

// v22: the propose→launch→state chain also carries diff-comment ids. The mock
// propose scenario cannot pass commentIds through the model, so the card→ids
// mapping is written directly — that IS the seam turn._onProposal writes and the
// only part of the chain this test is not about. What it DOES cover is the two
// ui/server.mjs edits, both of which live in catch-and-log blocks and would
// otherwise fail silently: peek/clearPendingCardComments -> ask_run_links.comment_ids at
// launch, and stampSentRunId on the FIRST state event.
test('a card with pending comment ids: launch moves them onto the link row, the first state event stamps sent_run_id', async () => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { addDiffComment, getDiffComment, setPendingCardComments } = await import('../src/core/diff-comments.mjs');
  const { writeFile } = await import('node:fs/promises');
  const PATCH = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';
  const seeded = await seedPipeline(projectDir, { title: 'Prior run', status: 'done' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), PATCH, 'utf8');
  const comment = addDiffComment({ storeKey: seeded.key, pipelineId: seeded.id, patchText: PATCH,
    path: 'a.js', side: 'new', line: 1, body: 'fix me', author: 'user' });

  const { thread, card } = await proposeCard({ projectKey }, 'propose a run for this project');
  assert.ok(card);
  assert.equal(setPendingCardComments(card.id, [comment.id]), 1);

  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);

  const snap1 = await snapshot(thread.id);
  assert.deepEqual(snap1.runLinks[0].commentIds, [comment.id], 'moved onto the link row at launch');
  assert.equal(getDiffComment(comment.id).sentRunId, null, 'NOT stamped at launch — only on a state event');

  await waitFor(() => frames(w.msgs, thread.id, 'ask-run-status').some((s) => typeof s.pipelineId === 'string' && s.pipelineId));
  const snap2 = await snapshot(thread.id);
  assert.ok(snap2.runLinks[0].pipelineId);
  await waitFor(() => getDiffComment(comment.id).sentRunId === snap2.runLinks[0].pipelineId);
  const stamped = getDiffComment(comment.id);
  assert.equal(stamped.sentRunId, snap2.runLinks[0].pipelineId, 'the 8-hex History id, never the runs-Map UUID');
  assert.notEqual(stamped.sentRunId, runId);
  assert.equal(stamped.resolved, false, 'stamping never auto-resolves');
  stopPump();
  w.ws.close();
});

test('workspace card: Start posts the workspace body; entry kind is workspace-run', async () => {
  const { thread, card } = await proposeCard({ workspaceId }, 'propose a run here');
  assert.ok(card);
  assert.equal(card.card.target, 'workspace');
  assert.equal(card.card.workspaceId, workspaceId);
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    workspaceId, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    sourceBranchByKey: card.card.sourceBranchByKey || undefined,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200);
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  assert.equal(mod.runs.get(runId).kind, 'workspace-run');
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').some((m) => /Run finished/.test(m.message.text)));
  stopPump();
  w.ws.close();
});

test('/api/run pair validation: 400 on half a pair, unknown thread, unknown card; 409 on non-proposed — and NO run is created', async () => {
  const body = { projectDir, prompt: 'x', workflowId: 'wf_default' };
  const rejects = [
    { ...body, askThreadId: 'ask_ffffffff' },
    { ...body, askCardId: 'card_ffffffff' },
    { ...body, askThreadId: 'ask_ffffffff', askCardId: 'card_ffffffff' },
  ];
  for (const b of rejects) {
    const n = mod.runs.size;
    assert.equal((await post('/api/run', b)).status, 400);
    assert.equal(mod.runs.size, n, 'a rejected ask pair creates no run entry (validated BEFORE the run exists)');
  }
  const { thread, card } = await proposeCard({ projectKey }, 'propose again');
  await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' });
  const n = mod.runs.size;
  const r = await post('/api/run', { ...body, askThreadId: thread.id, askCardId: card.id });
  assert.equal(r.status, 409, 'a dismissed card cannot start a run');
  assert.equal(mod.runs.size, n, 'the 409 also creates no run entry');
});

test('dismiss: {block} on success, 400 on other states, 404 unknown, 409 when not proposed; other tabs get the ask-message refresh', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose one more');
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'started' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/card_ffffffff`, { state: 'dismissed' })).status, 404);
  const w = openWs();
  await w.opened;
  const ok = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).block.state, 'dismissed');
  // The card's turn is already over — no live reducer took the flip, so the
  // whole message re-broadcasts as an out-of-turn ask-message (§6.6 upsert key).
  await waitFor(() => frames(w.msgs, thread.id, 'ask-message').find((m) =>
    (m.message.blocks || []).some((b) => b.kind === 'card' && b.id === card.id && b.state === 'dismissed')));
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' })).status, 409);
  w.ws.close();
});

// m3: dismiss is terminal — the card's parked comment ids can never reach a run,
// so the route drops them exactly where the launch path does (ui/server.mjs:1155).
// Nothing reads ask_card_comments back through the API, so assert via the store.
test("dismiss clears the card's pending comment ids (the launch path's only other consumer)", async () => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { addDiffComment, setPendingCardComments, peekPendingCardComments } =
    await import('../src/core/diff-comments.mjs');
  const { writeFile } = await import('node:fs/promises');
  const PATCH = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';
  const seeded = await seedPipeline(projectDir, { title: 'Prior run', status: 'done' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), PATCH, 'utf8');
  const comment = addDiffComment({ storeKey: seeded.key, pipelineId: seeded.id, patchText: PATCH,
    path: 'a.js', side: 'new', line: 1, body: 'fix me', author: 'user' });

  const { thread, card } = await proposeCard({ projectKey }, 'propose one to dismiss');
  assert.ok(card);
  assert.equal(setPendingCardComments(card.id, [comment.id]), 1);
  const res = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'dismissed' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).block.state, 'dismissed');
  assert.deepEqual(peekPendingCardComments(card.id), [], 'dismiss reclaimed the parked rows');
});

test('R-B: dismissing WHILE the turn still streams survives finishMessage (live reducer re-emits)', async () => {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW propose something', ...MODEL, context: { projectKey } });
  const cardFrame = await waitFor(() => frames(w.msgs, t.id, 'ask-card')[0]);
  assert.equal(cardFrame.block.state, 'proposed');
  const flip = await post(`/api/ask/threads/${t.id}/cards/${cardFrame.block.id}`, { state: 'dismissed' });
  assert.equal(flip.status, 200);
  const reEmit = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'dismissed'));
  assert.ok(reEmit.seq > cardFrame.seq, 'the live reducer re-emitted the flipped card as a job frame');
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  const snap = await snapshot(t.id);
  const block = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card');
  assert.equal(block.state, 'dismissed', 'finishMessage did NOT revert the flip');
  w.ws.close();
});

test('resolveAskContext: the workspace members line carries the member names (§6.5)', async () => {
  // Pins the C1 fresh-eyes fix: readWorkspace has NO `projects` field — members
  // come from projectPaths basenames. Without the fix this is always [].
  const t = await newThread();
  const ctx = await mod._testing.resolveAskContext(t.id, { workspaceId }, []);
  assert.equal(ctx.workspace.id, workspaceId);
  assert.ok(ctx.workspace.members.length >= 2, 'both member names resolved');
  for (const m of ctx.workspace.members) assert.equal(typeof m, 'string');
});

test('rejected proposal (no valid target in context) → notice, no card', async () => {
  const { thread, card } = await proposeCard({}, 'propose with no context');
  assert.equal(card, null);
  const snap = await snapshot(thread.id);
  const notice = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'notice');
  assert.match(notice.text, /^Proposal rejected: /);
});

test('preflight failure after 200 {runId}: "Run failed: Preflight failed:" notice + card failed (B-8)', async () => {
  // POST /api/workflows VALIDATES agent keys against the registry, so the ghost
  // workflow is written through the STORE (writeWorkflow only stamps id/dates;
  // key resolution happens at run preflight — orchestrator.mjs:1859-1890).
  const { writeWorkflow } = await import('../src/core/workflows.mjs');
  const ghost = await writeWorkflow({
    name: 'Ghost', steps: [[{ id: 's0_0', key: 'ghost-agent-zz' }]], feedbacks: [],
  });
  const { thread, card } = await proposeCard({ projectKey }, 'propose a doomed run');
  const w = openWs();
  await w.opened;
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: ghost.id,
    guardrailsId: 'normal', title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  assert.equal(start.status, 200, 'preflight runs AFTER the 200 — the link must already exist');
  const failed = await waitFor(() => frames(w.msgs, thread.id, 'ask-message')
    .find((m) => /^Run failed: Preflight failed:/.test(m.message.text)));
  assert.ok(failed, 'the follower attached before orch.run() was scheduled');
  const snap = await snapshot(thread.id);
  const block = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.id === card.id);
  assert.equal(block.state, 'failed');
  assert.match(block.error, /Preflight failed/);
  assert.equal(snap.runLinks[0].status, 'error');
  w.ws.close();
});

test('DELETE while a followed run lives: run unaffected, followers detached, no late writes crash', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose then delete');
  const start = await post('/api/run', {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: 'normal', title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
  });
  const { runId } = await start.json();
  const stopPump = autoAnswerRun(runId);
  const del = await fetch(`${base}/api/ask/threads/${thread.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(mod._testing.askFollowers.get(thread.id), undefined, 'follower set dropped');
  await waitFor(() => ['done', 'error', 'stopped'].includes(String(mod.runs.get(runId)?.status)));
  stopPump();
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
});

// Review of PR #376: the card-state TOCTOU re-check inside POST /api/run threw
// AFTER runs.set/wireRun and the throw was only console.error'd, so a second
// Start for the same card fell through to orch.run() — two full pipelines for
// one card. The loser must get a 409 and leave no run behind.
test('double Start for one card launches exactly one run: the loser is 409 with no run entry', async () => {
  const { thread, card } = await proposeCard({ projectKey }, 'propose a run for this project');
  assert.ok(card && card.state === 'proposed');
  const body = {
    projectDir, prompt: card.card.brief, workflowId: card.card.workflowId,
    guardrailsId: card.card.guardrailsId, title: card.card.title,
    askThreadId: thread.id, askCardId: card.id,
    sourceBranch: 'main',                    // forces the isValidSourceRef git spawn — the real await window
  };
  const runsBefore = mod.runs.size;
  const w = openWs();
  await w.opened;
  // Two DISTINCT sockets (fetch may queue same-origin requests behind one
  // keep-alive connection, which would serialise them and hide the race). Both
  // pass the early `proposed` check before either returns from the git spawn.
  const raw = (p, b) => new Promise((resolve, reject) => {
    const data = JSON.stringify(b);
    const req = http.request(`${base}${p}`, { method: 'POST', agent: false, headers: { ...JSONH, 'Content-Length': Buffer.byteLength(data) } }, (r) => {
      let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', reject); req.end(data);
  });
  const [a, b] = await Promise.all([raw('/api/run', body), raw('/api/run', body)]);
  // Pump EVERY run that got started before asserting, or a regression parks two
  // mock runs at their HITL gates and this test hangs instead of failing.
  const started = [a, b].filter((r) => r.status === 200).map((r) => r.body.runId);
  const pumps = started.map((id) => autoAnswerRun(id));
  try {
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `one winner, one 409 — got ${statuses}`);
    assert.equal(mod.runs.size, runsBefore + 1, 'exactly one run entry was created');
    const loser = a.status === 200 ? b : a;
    assert.match(loser.body.error, /no longer proposed|card is started/);
    const snap = await snapshot(thread.id);
    assert.equal(snap.runLinks.length, 1, 'one link row');
    assert.equal(snap.runLinks[0].runId, started[0]);
    await waitFor(() => frames(w.msgs, thread.id, 'ask-message').some((m) => /Run finished/.test(m.message.text)));
  } finally {
    await waitFor(() => started.every((id) => /^(done|error|stopped)$/.test(mod.runs.get(id)?.status || 'done')), 20000).catch(() => {});
    pumps.forEach((stop) => stop());
    w.ws.close();
  }
});
