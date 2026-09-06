// test/ask-api-workflow-cards.test.mjs
// The workflow card state machine end to end over WORCA_MOCK: building →
// proposed, then POST /api/ask/threads/:id/cards/:cardId with `saved` (adopt an
// existing twin, or write a new origin:'auto' row with the node tunables baked
// in), `declined`, and {action:'run'} — each flipping the card, storing the
// synthetic user-row notice and starting (or queueing) the event turn; the
// context header's workflow arm; and the queued turn that cannot start. The
// full agentgen-api boot (cwd git sandbox — the mock pipeline runs for real).
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
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-askwfcards-cwd-'));
  gitInit(cwdSandbox);
  process.chdir(cwdSandbox);
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askwfcards-'));
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
  projectDir = mkdtempSync(join(tmpdir(), 'worca-cc-askwfcards-proj-'));
  gitInit(projectDir);
  projectDir2 = mkdtempSync(join(tmpdir(), 'worca-cc-askwfcards-proj2-'));
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
// A hang detector, not a budget: the waits here cover a real mock pipeline run
// (git init + worktree + spawn) that the loaded Windows 11 VM finishes 5-10x
// slower than macOS — its 10 s default timed out mid-suite there. win32 gets
// the headroom; POSIX keeps the tight deadline.
const WAIT_FOR_MS = process.platform === 'win32' ? 60000 : 10000;
function waitFor(pred, timeoutMs = WAIT_FOR_MS) {
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

/** Drive one mock turn whose text triggers the workflow arm; resolves once the card is PROPOSED (the flip is a second ask-card frame). */
async function proposeWorkflow(context, text) {
  const t = await newThread();
  const w = openWs(`?threadId=${t.id}`);
  await w.opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text, ...MODEL, context });
  assert.equal(r.status, 202);
  const building = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'building'));
  const proposed = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'proposed'));
  await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1);
  w.ws.close();
  return { thread: t, building: building.block, card: proposed.block, msgs: w.msgs };
}
// v5: every socket opened AFTER proposeWorkflow() is a BARE openWs(). `?threadId=` makes ui/server.mjs REPLAY the
// thread's job ring — and a finished job stays in askJobs for jobGraceMs (30 s) — so such a socket would receive the FIRST
// turn's ask-done at once and `waitFor(ask-done >= 1)` would return before the event turn even started.
// A heading makes the mock classifier pick the implement-only recipe (no twin anywhere ⇒ Save CREATES a row). A plain prompt
// (≥ 80 chars, no heading, none of recipes.mjs WEB_RE's words) picks the `prompt` recipe = the built-in Default's twin (adopt path).
const NEW_TEXT = 'build me an auto workflow for this plan:\n# Rename\nrename pauseReason to pauseCause everywhere';
const TWIN_TEXT = 'make a workflow: refactor the auth module so that sessions expire after thirty minutes and refresh tokens rotate on every use';

test('workflow card: building → proposed with the REAL manifest, card.type=workflow, the tool row labelled, cost 0 in mock', async () => {
  const { building, card } = await proposeWorkflow({ projectKey }, NEW_TEXT);
  assert.equal(building.id, card.id); assert.equal(building.card.type, 'workflow'); assert.equal(building.card.trace.step, 1);
  assert.equal(card.card.projectKey, projectKey); assert.equal(card.card.match, null);
  assert.ok(card.card.manifest.graph.nodes.length >= 3 && card.card.order.length === 1, 'implement-only: task → implementer → end');
  assert.equal(card.card.shape.taskKind, 'plan-complete-small');
  assert.equal(card.card.costUsd, 0);
});

test('save (new row): writes origin=auto with the node tunables baked in, flips to saved with workflowId, stores the synthetic notice row and starts the event turn — whose mock proposes a run when thenRun', async () => {
  const { thread, card } = await proposeWorkflow({ projectKey }, `${NEW_TEXT} and run it`);
  assert.equal(card.card.thenRun, true, 'the mock derives thenRun from "run"');
  const nodeId = card.card.order[0];
  const w = openWs(); await w.opened;                                        // bare: no replay of the finished job (see above)
  // 'claude-opus-5' / 'high' exist in the test home's catalog (config.mjs listModels('')) — pick another pair if the predefined list changes.
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved', name: 'Rename fix', nodes: { [nodeId]: { model: 'claude-opus-5', effort: 'high' } } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.block.state, 'saved'); assert.match(body.block.workflowId, /^wf_rename-fix/); assert.equal(body.block.card.name, 'Rename fix');
  assert.equal(body.block.card.adopted, false);
  assert.equal(body.block.card.nodes[nodeId].model, 'claude-opus-5', 'the card mirrors the accepted tunables');
  assert.ok(body.turn && body.turn.assistantMessageId, 'the event turn started at once (no turn was running)');
  const rows = await (await fetch(`${base}/api/workflows`)).json();
  const row = rows.workflows.find((x) => x.id === body.block.workflowId);
  assert.equal(row.origin, 'auto'); assert.equal(row.name, 'Rename fix');
  // deepEqual holds because the implement-only recipe carries NO stage tunables (measured: the assembled agent node has config {}); a recipe
  // with a stage model/effort would add keys here — assert the two accepted keys, not the whole config, if the recipe ever changes (v6).
  assert.deepEqual(row.nodes.find((n) => n.kind === 'agent').config, { model: 'claude-opus-5', effort: 'high' });
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 1);
  const snap = await snapshot(thread.id);
  const notice = snap.messages.find((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic));
  assert.ok(notice, 'the synthetic user row exists');
  assert.equal(notice.blocks[0].text, 'Workflow "Rename fix" saved · Auto will propose a run next');
  assert.equal(notice.text, `[worca event] workflow card ${card.id} saved as ${body.block.workflowId} "Rename fix"; thenRun=true; project=${projectKey}`);
  const last = snap.messages.at(-1);
  const runCard = (last.blocks || []).find((b) => b.kind === 'card' && !b.card.type);
  assert.ok(runCard && runCard.state === 'proposed', 'the mock event arm proposed a run');
  assert.equal(runCard.card.workflowId, body.block.workflowId, 'with the saved workflow');
  // The first turn's D13 title job is fire-and-forget (turn.mjs _kickoffTitle, never awaited) and may land AFTER that turn's
  // ask-done, so "unchanged since before" is a flake; what must hold is that the EVENT turn (firstTurn:false) never titles the thread from the event line.
  assert.ok(!/worca event|workflow card/i.test(snap.thread.title || ''), `an event never titles the thread (got ${JSON.stringify(snap.thread.title)})`);
  w.ws.close();
});

test('save (twin = the built-in Default): adopts it, writes nothing, ignores name/nodes; declined ⇒ declined + the three-option reply; 409s and 400s', async () => {
  const before = (await (await fetch(`${base}/api/workflows`)).json()).workflows.length;
  const { thread, card } = await proposeWorkflow({ projectKey }, TWIN_TEXT);
  assert.deepEqual(card.card.match, { id: 'wf_default', name: 'Default' }, 'a plain prompt is the Default\'s twin (the only candidate in a fresh home)');
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved', name: 'Ignored' });
  const body = await r.json();
  assert.equal(body.block.workflowId, 'wf_default'); assert.equal(body.block.card.name, 'Default'); assert.equal(body.block.card.adopted, true);
  assert.equal((await (await fetch(`${base}/api/workflows`)).json()).workflows.length, before, 'no row written');
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved' })).status, 409);
  assert.equal((await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' })).status, 409);
  const d = await proposeWorkflow({ projectKey }, NEW_TEXT);
  const w = openWs(); await w.opened;
  assert.equal((await post(`/api/ask/threads/${d.thread.id}/cards/${d.card.id}`, { action: 'run' })).status, 409, 'run needs saved');
  assert.equal((await post(`/api/ask/threads/${d.thread.id}/cards/${d.card.id}`, { state: 'dismissed' })).status, 400, 'run-card verbs are refused on a workflow card');
  const dec = await post(`/api/ask/threads/${d.thread.id}/cards/${d.card.id}`, { state: 'declined' });
  assert.equal((await dec.json()).block.state, 'declined');
  await waitFor(() => frames(w.msgs, d.thread.id, 'ask-done').length >= 1);
  const snap = await snapshot(d.thread.id);
  assert.match(snap.messages.at(-1).text, /another auto workflow|what to change|saved workflow/i);
  assert.equal(snap.messages.find((m) => m.role === 'user' && m.blocks?.[0]?.synthetic).blocks[0].text, `Workflow "${d.card.card.name}" declined`);
  w.ws.close();
});

test('run with this: {action:"run"} on a saved card starts the saved+thenRun event turn; a save DURING a running turn is queued until it ends', async () => {
  const { thread, card } = await proposeWorkflow({ projectKey }, NEW_TEXT);   // by now a twin exists (test 2 wrote wf_rename-fix) — Save adopts it
  assert.match(card.card.match?.id || '', /^wf_rename-fix/);
  const w = openWs(); await w.opened;
  const saved = await (await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved' })).json();
  assert.equal(saved.block.card.adopted, true);
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 1);               // the save's event turn (thenRun=false ⇒ text only)
  const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { action: 'run' });
  assert.equal(r.status, 200);
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 2);               // the run's event turn
  const snap = await snapshot(thread.id);
  assert.equal(snap.messages.filter((m) => m.role === 'user' && m.blocks?.[0]?.synthetic).at(-1).blocks[0].text, `Run requested with "${saved.block.card.name}" · Auto will propose a run next`);
  assert.ok((snap.messages.at(-1).blocks || []).some((b) => b.kind === 'card' && !b.card.type && b.state === 'proposed'), 'a run card followed');
  w.ws.close();
  // queued: propose while a slow turn streams, save immediately — the event turn starts after ask-done
  const t2 = await newThread();
  const w2 = openWs(`?threadId=${t2.id}`); await w2.opened;
  await post(`/api/ask/threads/${t2.id}/messages`, { text: `MOCK_SLOW ${NEW_TEXT}`, ...MODEL, context: { projectKey } });
  const proposed = await waitFor(() => frames(w2.msgs, t2.id, 'ask-card').find((f) => f.block.state === 'proposed'));
  const s = await post(`/api/ask/threads/${t2.id}/cards/${proposed.block.id}`, { state: 'saved' });
  assert.deepEqual((await s.json()).turn, { deferred: true });
  await waitFor(() => frames(w2.msgs, t2.id, 'ask-done').length >= 2, 15_000);
  const snap2 = await snapshot(t2.id);
  assert.ok(snap2.messages.some((m) => m.role === 'user' && m.blocks?.[0]?.synthetic), 'the queued event turn ran after the first turn settled');
  w2.ws.close();
});

test('context header: the event turn\'s prompt lists the workflow card by type and name', async () => {
  const { thread, card } = await proposeWorkflow({ projectKey }, NEW_TEXT);
  const w = openWs(); await w.opened;
  await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' });
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 1);
  // The mock echoes the FIRST line of the user text as its answer, and the context block precedes it — read the
  // header the SERVER built from the turn's own restored prompt instead: resolveAskContext's cards line.
  // targetName is the seeded project's name ('demo'): the MOCK child returns projectName:null,
  // so this passes only through the parent's own lookup in revalidateWorkflowProposal (v4).
  assert.equal(card.card.projectName, 'demo', 'the parent resolved the project name the mock child could not');
  const ctx = await mod._testing.resolveAskContext(thread.id, { projectKey }, [], null);
  const mine = (ctx.cards || []).find((c) => c.id === card.id);
  assert.deepEqual(mine, { id: card.id, type: 'workflow', state: 'declined', name: card.card.name, workflowId: null, targetName: 'demo' });
  w.ws.close();
});

test('a queued event turn that cannot start (total cost window spent by the turn it waited on) posts a system notice instead of vanishing; the queue is not stranded', async () => {
  // v7 (PD5/PD26/PD29): the starter runs from settleJob AFTER the finished turn booked its spend, so budgetStatus().blocked can be true exactly then.
  const { setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
  const { recordAskCostDelta, budgetStatus } = await import('../src/core/cost-budget.mjs');
  const t = await newThread();
  const w = openWs(); await w.opened;                                        // bare: opened BEFORE the turn — live frames reach every socket
  try {
    await post(`/api/ask/threads/${t.id}/messages`, { text: `MOCK_SLOW ${NEW_TEXT}`, ...MODEL, context: { projectKey } });
    const proposed = await waitFor(() => frames(w.msgs, t.id, 'ask-card').find((f) => f.block.state === 'proposed'));
    await setTotalCostLimitUsd(1);
    recordAskCostDelta({ threadId: t.id, messageId: 'msg_budget02', amountUsd: 1.5 });
    assert.equal(budgetStatus().blocked, true, 'fixture: the window is spent while the slow turn still streams');
    const s = await post(`/api/ask/threads/${t.id}/cards/${proposed.block.id}`, { state: 'saved' });
    assert.equal(s.status, 200);
    const body = await s.json();
    assert.equal(body.block.state, 'saved', 'the flip stands (PD5)');
    assert.deepEqual(body.turn, { deferred: true });
    await waitFor(() => frames(w.msgs, t.id, 'ask-done').length >= 1, 15_000);   // the slow turn ends → settleJob → drainAskDeferred → 403 at START
    const notice = await waitFor(() => frames(w.msgs, t.id, 'ask-message').find((f) => f.message.role === 'system' && /could not reply to the workflow card/.test(f.message.text)));
    assert.equal(notice.message.text, 'Ask Worca could not reply to the workflow card: total cost limit reached');
    assert.equal(notice.message.blocks[0].kind, 'notice');
    const snap = await snapshot(t.id);
    assert.equal(snap.messages.filter((m) => m.status === 'streaming').length, 0, 'no assistant row was opened');
    assert.equal(snap.messages.filter((m) => m.role === 'user' && m.blocks?.[0]?.synthetic).length, 0, 'no synthetic user row either: the reservation failed before any write');
    assert.equal(frames(w.msgs, t.id, 'ask-start').length, 1, 'only the typed turn ever started');
  } finally {
    await setTotalCostLimitUsd(null);
    w.ws.close();
  }
});

test('{action:"run"} is refused while a turn streams: the run verb has no state transition, so only this guard keeps a click from queueing another PAID turn', async () => {
  const { thread, card } = await proposeWorkflow({ projectKey }, NEW_TEXT);
  const w = openWs(); await w.opened;                                        // bare: no replay of the finished job
  const saved = await (await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'saved' })).json();
  assert.equal(saved.block.state, 'saved');
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 1);     // the save's own event turn
  // Hold the thread with a slow typed turn and hammer Run: the save/decline verbs are
  // one-shot (the `proposed` check refuses the second POST), the run verb is not.
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'MOCK_SLOW hold the thread', ...MODEL, context: { projectKey } });
  await waitFor(() => frames(w.msgs, thread.id, 'ask-start').length >= 2);
  const rs = await Promise.all([1, 2, 3].map(() => post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { action: 'run' })));
  assert.deepEqual(rs.map((r) => r.status), [409, 409, 409], 'every impatient click is refused, exactly as the typed-message route refuses a second turn');
  assert.equal((await rs[0].json()).error, 'turn in flight');
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 2, 15_000);
  const runRows = (s) => s.messages.filter((m) => m.role === 'user' && /^Run requested/.test(m.blocks?.[0]?.text || ''));
  assert.equal(runRows(await snapshot(thread.id)).length, 0, 'nothing was queued: no run event turn ran');
  // The verb still works once the thread is idle.
  const ok = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { action: 'run' });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).turn.assistantMessageId, 'the event turn started at once');
  await waitFor(() => frames(w.msgs, thread.id, 'ask-done').length >= 3, 15_000);
  assert.equal(runRows(await snapshot(thread.id)).length, 1, 'exactly one paid run turn, from the one accepted click');
  w.ws.close();
});

test('an event turn that fails IMMEDIATELY (no turn was running) posts the same system notice — the flip has already replaced the card element the inline error would have landed on', async () => {
  const { setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
  const { recordAskCostDelta, budgetStatus } = await import('../src/core/cost-budget.mjs');
  const { thread, card } = await proposeWorkflow({ projectKey }, NEW_TEXT);
  const w = openWs(); await w.opened;
  try {
    await setTotalCostLimitUsd(1);
    recordAskCostDelta({ threadId: thread.id, messageId: 'msg_budget03', amountUsd: 1.5 });
    assert.equal(budgetStatus().blocked, true, 'fixture: the window is spent with NO turn running');
    const r = await post(`/api/ask/threads/${thread.id}/cards/${card.id}`, { state: 'declined' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.block.state, 'declined', 'the flip stands');
    assert.equal(body.turn.status, 403);
    assert.equal(body.turn.error, 'total cost limit reached', 'the API client still gets the machine-readable error');
    const notice = await waitFor(() => frames(w.msgs, thread.id, 'ask-message').find((f) => f.message.role === 'system' && /could not reply to the workflow card/.test(f.message.text)));
    assert.equal(notice.message.text, 'Ask Worca could not reply to the workflow card: total cost limit reached');
    assert.equal(notice.message.blocks[0].kind, 'notice');
    assert.equal(frames(w.msgs, thread.id, 'ask-start').length, 0, 'no turn ever started');
  } finally {
    await setTotalCostLimitUsd(null);
    w.ws.close();
  }
});
